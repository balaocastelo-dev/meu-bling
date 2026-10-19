/**
 * WHATSAPP (QR Code) — sessão via @whiskeysockets/baileys 7.x.
 *
 * Estado em memória: DESCONECTADO | AGUARDANDO_QR | CONECTANDO | CONECTADO.
 * A sessão fica em `${STORAGE_DIR}/whatsapp` (multi-file auth state).
 *
 * Cuidados que evitam o "Aguardando mensagem. Essa ação pode levar alguns instantes"
 * no celular do cliente (sessão Signal dessincronizada / "Bad MAC"):
 *  - só existe UM socket por vez: antes de abrir outro, o anterior é encerrado e seus
 *    listeners removidos (dois sockets na mesma pasta corrompem as chaves);
 *  - eventos de um socket antigo são ignorados (guarda por geração);
 *  - `getMessage` devolve as mensagens enviadas (guardadas em disco) para o WhatsApp
 *    reenviar quando o celular pede "retry" — é assim que a mensagem presa se resolve;
 *  - endereços @lid (nova identidade do WhatsApp) são aceitos no recebimento e
 *    convertidos para o número de telefone;
 *  - ao desconectar, a pasta da sessão só é apagada depois que o socket morreu, para
 *    nenhum arquivo velho ser gravado por cima da sessão nova.
 * Baileys é instável: todo erro é capturado para nunca derrubar a API.
 */
import path from 'node:path';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import pino from 'pino';
import QRCode from 'qrcode';
import { env } from '../../lib/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { somenteDigitos } from '../../lib/util.js';

export type StatusWhatsApp = 'DESCONECTADO' | 'AGUARDANDO_QR' | 'CONECTANDO' | 'CONECTADO';

export interface EstadoWhatsApp {
  status: StatusWhatsApp;
  qrDataUrl?: string | null;
  numero?: string | null;
  nome?: string | null;
  desde?: Date | null;
  ultimoErro?: string | null;
}

const PASTA_SESSAO = path.join(env.STORAGE_DIR, 'whatsapp');
const ARQUIVO_ENVIADAS = path.join(env.STORAGE_DIR, 'whatsapp-enviadas.json');
const MAX_ENVIADAS = 1000;
const LOG_LEVEL = process.env.WHATSAPP_LOG_LEVEL || 'warn';

const estado: EstadoWhatsApp = { status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: null, desde: null, ultimoErro: null };
/** emite 'estado' a cada mudança (usado pelo SSE) e 'mensagem' ao receber texto */
export const whatsappEventos = new EventEmitter();
whatsappEventos.setMaxListeners(50);

let sock: any = null;
/** cresce a cada socket criado; eventos de gerações antigas são ignorados */
let geracao = 0;
let conectando = false;
let reconectarTimer: NodeJS.Timeout | null = null;
let tentativasReconexao = 0;
let encerradoManualmente = false;
let baileysMod: any = null;

function setEstado(parcial: Partial<EstadoWhatsApp>) {
  Object.assign(estado, parcial);
  whatsappEventos.emit('estado', { ...estado });
}

export function status(): EstadoWhatsApp {
  return { ...estado, qrDataUrl: estado.status === 'AGUARDANDO_QR' ? estado.qrDataUrl : undefined };
}

export function temSessaoSalva(): boolean {
  try {
    return fs.existsSync(path.join(PASTA_SESSAO, 'creds.json'));
  } catch {
    return false;
  }
}

async function baileys(): Promise<any> {
  if (!baileysMod) baileysMod = await import('@whiskeysockets/baileys');
  return baileysMod;
}

async function atualizarEmpresa(ativo: boolean) {
  try {
    await prisma.empresa.update({ where: { id: 1 }, data: { whatsappAtivo: ativo } });
  } catch {
    /* não crítico */
  }
}

/** Normaliza para JID: só dígitos; 10-11 dígitos (DDD+número) ganham o DDI 55. */
export function normalizarNumero(numero: string): string {
  let n = somenteDigitos(numero);
  if (n.length === 10 || n.length === 11) n = '55' + n;
  if (!n) throw new AppError('Número de WhatsApp inválido.', 422, 'NUMERO_INVALIDO');
  return n;
}

export function jidDe(numero: string): string {
  return `${normalizarNumero(numero)}@s.whatsapp.net`;
}

// ---------------------------------------------------------------------
// Mensagens enviadas (para o WhatsApp pedir reenvio quando o celular não
// conseguir decifrar — é o que tira a mensagem do "Aguardando mensagem")
// ---------------------------------------------------------------------
type Enviada = { jid: string; t: number; message: any };
const enviadas = new Map<string, Enviada>();
let salvarEnviadasTimer: NodeJS.Timeout | null = null;

async function carregarEnviadas() {
  try {
    if (!fs.existsSync(ARQUIVO_ENVIADAS)) return;
    const { BufferJSON } = await baileys();
    const dados = JSON.parse(fs.readFileSync(ARQUIVO_ENVIADAS, 'utf8'), BufferJSON.reviver) as Record<string, Enviada>;
    for (const [id, e] of Object.entries(dados)) enviadas.set(id, e);
  } catch {
    /* arquivo corrompido: ignora, recomeça vazio */
  }
}

function salvarEnviadas() {
  if (salvarEnviadasTimer) return;
  salvarEnviadasTimer = setTimeout(async () => {
    salvarEnviadasTimer = null;
    try {
      const { BufferJSON } = await baileys();
      // mantém só as mais recentes
      while (enviadas.size > MAX_ENVIADAS) {
        const primeira = enviadas.keys().next().value;
        if (primeira === undefined) break;
        enviadas.delete(primeira);
      }
      const tmp = ARQUIVO_ENVIADAS + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(enviadas), BufferJSON.replacer));
      fs.renameSync(tmp, ARQUIVO_ENVIADAS);
    } catch {
      /* não crítico */
    }
  }, 500);
  salvarEnviadasTimer.unref();
}

function guardarEnviada(jid: string, info: any) {
  const id = info?.key?.id;
  if (!id || !info?.message) return;
  enviadas.set(id, { jid, t: Date.now(), message: info.message });
  salvarEnviadas();
}

// ---------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------
function encerrarSocket(s: any) {
  if (!s) return;
  try {
    s.ev?.removeAllListeners?.();
  } catch {
    /* ignora */
  }
  try {
    s.ws?.removeAllListeners?.();
  } catch {
    /* ignora */
  }
  try {
    s.end?.(undefined);
  } catch {
    /* ignora */
  }
}

export async function conectar(): Promise<EstadoWhatsApp> {
  if (estado.status === 'CONECTADO' || conectando) return status();
  conectando = true;
  encerradoManualmente = false;
  if (reconectarTimer) {
    clearTimeout(reconectarTimer);
    reconectarTimer = null;
  }
  // "Gerar novo QR Code" / reconexão: nunca deixa dois sockets vivos na mesma sessão
  const anterior = sock;
  sock = null;
  encerrarSocket(anterior);

  const minhaGeracao = ++geracao;
  const souAtual = () => minhaGeracao === geracao;

  try {
    const b = await baileys();
    const makeWASocket = b.makeWASocket || b.default;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, normalizeMessageContent, isJidGroup } = b;

    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
    if (enviadas.size === 0) await carregarEnviadas();
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    let version: any;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined; // usa a versão embutida no pacote
    }
    const logger = pino({ level: LOG_LEVEL, base: { modulo: 'whatsapp' } });

    if (!souAtual()) return status();
    setEstado({ status: 'CONECTANDO', qrDataUrl: null, ultimoErro: null });

    const novoSock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: ['MEU BLING', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      // não desligar shouldSyncHistoryMessage: o sync inicial traz os mapeamentos LID↔telefone;
      // sem eles a sessão volta a dar "Bad MAC" / "Aguardando mensagem". O padrão já pula o histórico completo.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      // reenvio sob demanda + recriação automática de sessão quando o outro lado não decifra
      enableRecentMessageCache: true,
      enableAutoSessionRecreation: true,
      getMessage: async (key: any) => enviadas.get(String(key?.id || ''))?.message,
    });
    sock = novoSock;

    novoSock.ev.on('creds.update', () => {
      if (!souAtual() || sock !== novoSock) return;
      saveCreds().catch(() => undefined);
    });

    novoSock.ev.on('connection.update', async (u: any) => {
      if (!souAtual() || sock !== novoSock) return; // evento de um socket antigo
      try {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 300 });
            setEstado({ status: 'AGUARDANDO_QR', qrDataUrl });
          } catch (e: any) {
            setEstado({ status: 'AGUARDANDO_QR', qrDataUrl: null, ultimoErro: 'Falha ao gerar QR: ' + e?.message });
          }
        }
        if (connection === 'open') {
          tentativasReconexao = 0;
          const user = novoSock.user || {};
          const numero = somenteDigitos(String(user.id || '').split(':')[0].split('@')[0]);
          setEstado({ status: 'CONECTADO', qrDataUrl: null, numero, nome: user.name || user.verifiedName || null, desde: new Date(), ultimoErro: null });
          await atualizarEmpresa(true);
        }
        if (connection === 'close') {
          const erro: any = lastDisconnect?.error;
          const codigo = erro?.output?.statusCode ?? erro?.statusCode;
          const motivo = String(erro?.message || codigo || 'conexão encerrada');
          const deslogado = codigo === DisconnectReason.loggedOut || codigo === 401 || codigo === 403;
          sock = null;
          encerrarSocket(novoSock);
          if (deslogado) {
            setEstado({ status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: null, desde: null, ultimoErro: 'Sessão encerrada no celular (' + motivo + ')' });
            apagarSessao();
            await atualizarEmpresa(false);
            return;
          }
          setEstado({ status: 'DESCONECTADO', qrDataUrl: null, ultimoErro: motivo });
          if (!encerradoManualmente) agendarReconexao();
        }
      } catch (e: any) {
        setEstado({ ultimoErro: 'Erro na atualização de conexão: ' + (e?.message || e) });
      }
    });

    novoSock.ev.on('messages.upsert', async (m: any) => {
      if (!souAtual() || sock !== novoSock) return;
      try {
        if (m.type !== 'notify') return;
        for (const msg of m.messages || []) {
          if (!msg.message) continue;
          const jid: string = msg.key?.remoteJid || '';
          if (msg.key?.fromMe) {
            guardarEnviada(jid, msg); // mensagens enviadas pelo celular/outros aparelhos também podem precisar de reenvio
            continue;
          }
          if (!jid || isJidGroup(jid) || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) continue;
          const jidTelefone = await resolverTelefone(novoSock, jid, msg.key?.remoteJidAlt);
          if (!jidTelefone) continue;
          const conteudo = normalizeMessageContent ? normalizeMessageContent(msg.message) : msg.message;
          const texto: string =
            conteudo?.conversation ||
            conteudo?.extendedTextMessage?.text ||
            conteudo?.buttonsResponseMessage?.selectedDisplayText ||
            conteudo?.listResponseMessage?.title ||
            conteudo?.templateButtonReplyMessage?.selectedDisplayText ||
            conteudo?.imageMessage?.caption ||
            conteudo?.videoMessage?.caption ||
            conteudo?.documentMessage?.caption ||
            '';
          if (!texto) continue;
          const numero = somenteDigitos(jidTelefone.split('@')[0]);
          whatsappEventos.emit('mensagem', { numero, texto, nome: msg.pushName || null, data: new Date() });
          await tratarMensagemRecebida(numero, texto);
        }
      } catch (e: any) {
        setEstado({ ultimoErro: 'Erro ao processar mensagem recebida: ' + (e?.message || e) });
      }
    });
  } catch (e: any) {
    sock = null;
    setEstado({ status: 'DESCONECTADO', qrDataUrl: null, ultimoErro: 'Falha ao iniciar WhatsApp: ' + (e?.message || e) });
  } finally {
    conectando = false;
  }
  return status();
}

/** Converte um JID (telefone ou @lid) para o JID de telefone `55...@s.whatsapp.net`. */
async function resolverTelefone(s: any, jid: string, alternativo?: string | null): Promise<string | null> {
  if (jid.endsWith('@s.whatsapp.net')) return jid;
  if (alternativo && alternativo.endsWith('@s.whatsapp.net')) return alternativo;
  if (jid.endsWith('@lid')) {
    try {
      const pn = await s?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pn && String(pn).endsWith('@s.whatsapp.net')) return String(pn);
    } catch {
      /* sem mapeamento ainda */
    }
  }
  return null;
}

function agendarReconexao() {
  if (reconectarTimer || encerradoManualmente) return;
  tentativasReconexao += 1;
  const espera = Math.min(60000, 3000 * tentativasReconexao);
  reconectarTimer = setTimeout(() => {
    reconectarTimer = null;
    conectar().catch(() => undefined);
  }, espera);
  reconectarTimer.unref();
}

function apagarSessao() {
  try {
    fs.rmSync(PASTA_SESSAO, { recursive: true, force: true });
    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
  } catch {
    /* ignora */
  }
  try {
    fs.rmSync(ARQUIVO_ENVIADAS, { force: true });
  } catch {
    /* ignora */
  }
  enviadas.clear();
}

export async function desconectar(): Promise<EstadoWhatsApp> {
  encerradoManualmente = true;
  if (reconectarTimer) {
    clearTimeout(reconectarTimer);
    reconectarTimer = null;
  }
  geracao += 1; // qualquer evento atrasado do socket atual passa a ser ignorado
  const s = sock;
  sock = null;
  if (s) {
    try {
      s.ev?.removeAllListeners?.(); // nada mais é gravado na pasta da sessão a partir daqui
    } catch {
      /* ignora */
    }
    try {
      await Promise.race([s.logout(), new Promise((r) => setTimeout(r, 5000))]);
    } catch {
      /* já desconectado */
    }
    encerrarSocket(s);
    await new Promise((r) => setTimeout(r, 300)); // deixa gravações pendentes terminarem antes de apagar
  }
  apagarSessao();
  setEstado({ status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: null, desde: null, ultimoErro: null });
  await atualizarEmpresa(false);
  return status();
}

/** Apaga a sessão e abre uma nova (novo QR Code). Resolve sessões corrompidas ("Aguardando mensagem"). */
export async function reconectarDoZero(): Promise<EstadoWhatsApp> {
  await desconectar();
  return conectar();
}

// ---------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------
export async function enviarTexto(numero: string, texto: string): Promise<{ id: string | null; jid: string }> {
  const s = sock;
  if (estado.status !== 'CONECTADO' || !s) throw new AppError('WhatsApp desconectado', 422, 'WHATSAPP_DESCONECTADO');
  let jid = jidDe(numero);
  try {
    if (typeof s.onWhatsApp === 'function') {
      const r = await Promise.race([s.onWhatsApp(jid), new Promise<undefined>((res) => setTimeout(() => res(undefined), 8000))]);
      const info = Array.isArray(r) ? r[0] : undefined;
      if (info && info.exists === false) throw new AppError(`O número ${numero} não possui WhatsApp.`, 422, 'SEM_WHATSAPP');
      // usa o JID de telefone devolvido (pode corrigir o 9º dígito); nunca troca por @lid
      if (info?.jid && String(info.jid).endsWith('@s.whatsapp.net')) jid = info.jid;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    /* verificação opcional: segue com o jid calculado */
  }
  try {
    const r = await s.sendMessage(jid, { text: texto });
    guardarEnviada(jid, r);
    return { id: r?.key?.id ?? null, jid };
  } catch (e: any) {
    throw new AppError('Falha ao enviar WhatsApp: ' + (e?.message || e), 502, 'WHATSAPP_ERRO');
  }
}

/** Envia um arquivo (PDF do orçamento/pedido, DANFE...) como documento. */
export async function enviarDocumento(numero: string, caminho: string, nomeArquivo?: string, legenda?: string): Promise<{ id: string | null; jid: string }> {
  if (estado.status !== 'CONECTADO' || !sock) throw new AppError('WhatsApp desconectado', 422, 'WHATSAPP_DESCONECTADO');
  if (!fs.existsSync(caminho)) throw new AppError('Arquivo do anexo não encontrado.', 422, 'ANEXO');
  const jid = jidDe(numero);
  const nome = nomeArquivo || path.basename(caminho);
  const mimetype = /\.pdf$/i.test(nome) ? 'application/pdf' : /\.xml$/i.test(nome) ? 'application/xml' : /\.(jpe?g)$/i.test(nome) ? 'image/jpeg' : /\.png$/i.test(nome) ? 'image/png' : 'application/octet-stream';
  try {
    const r = await sock.sendMessage(jid, { document: fs.readFileSync(caminho), mimetype, fileName: nome, caption: legenda || undefined });
    return { id: r?.key?.id ?? null, jid };
  } catch (e: any) {
    throw new AppError('Falha ao enviar documento pelo WhatsApp: ' + (e?.message || e), 502, 'WHATSAPP_ERRO');
  }
}

// ---------------------------------------------------------------------
// Recebimento: "APROVAR" em OS aguardando aprovação / orçamento de venda enviado
// ---------------------------------------------------------------------
async function tratarMensagemRecebida(numero: string, texto: string) {
  if (!/\bAPROV(AR|O|ADO)\b/i.test(texto.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return;
  const variantes = [...new Set([numero, numero.replace(/^55/, ''), '55' + numero.replace(/^55/, '')])];
  const contatos = await prisma.contato.findMany({ where: { celular: { in: variantes } }, select: { id: true } });
  if (!contatos.length) return;
  // orçamentos de venda enviados e ainda não aprovados (o mais recente primeiro)
  const orcamentos = await prisma.venda.findMany({
    where: { tipo: 'ORCAMENTO', contatoId: { in: contatos.map((c) => c.id) }, aprovadoEm: null, orcamentoId: null, situacao: { nome: { in: ['Enviado', 'Em aberto'] } } },
    orderBy: { id: 'desc' },
    take: 1,
  });
  for (const o of orcamentos) {
    try {
      const svc = await import('../../modules/vendas/service.js');
      await svc.aprovarOrcamento(o.id, { aprovadoPor: `WhatsApp ${numero}`, usuarioId: null });
      await enviarTexto(numero, `✅ Recebemos a aprovação do orçamento nº ${o.numero}. Já vamos preparar o seu pedido!`).catch(() => undefined);
    } catch (e: any) {
      whatsappEventos.emit('estado', { ...estado, ultimoErro: 'Aprovação de orçamento: ' + (e?.message || e) });
    }
  }
  const sitAguardando = await prisma.situacao.findFirst({ where: { modulo: 'OS', nome: { contains: 'Aguardando aprova' } } });
  if (!sitAguardando) return;
  const ordens = await prisma.ordemServico.findMany({
    where: { contatoId: { in: contatos.map((c) => c.id) }, situacaoId: sitAguardando.id, orcamentoAprovado: false },
    orderBy: { id: 'desc' },
    take: 3,
  });
  if (!ordens.length) return;
  const sitAprovada = await prisma.situacao.findFirst({ where: { modulo: 'OS', nome: 'Aprovada', ativo: true } });
  for (const os of ordens) {
    await prisma.ordemServico.update({ where: { id: os.id }, data: { orcamentoAprovado: true, orcamentoAprovadoEm: new Date(), orcamentoAprovadoPor: `WhatsApp ${numero}` } });
    if (sitAprovada) {
      try {
        const core = await import('../../core/situacoes.js');
        await core.mudarSituacao({ modulo: 'OS', entidadeId: os.id, situacaoDestinoId: sitAprovada.id, usuarioId: null, observacao: `Orçamento aprovado pelo cliente via WhatsApp (${numero})` });
      } catch (e: any) {
        // transição pode não estar cadastrada ou módulo OS ainda não registrado: só marca a aprovação
        whatsappEventos.emit('estado', { ...estado, ultimoErro: 'Aprovação de OS: ' + (e?.message || e) });
      }
    }
    try {
      await enviarTexto(numero, `✅ Recebemos a aprovação do orçamento da OS nº ${os.numero}. Vamos iniciar o serviço e avisamos quando estiver pronto!`);
    } catch {
      /* resposta automática é opcional */
    }
  }
}

// ---------------------------------------------------------------------
// Inicialização automática
// ---------------------------------------------------------------------
export async function iniciarSeNecessario() {
  try {
    const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { whatsappAtivo: true } });
    if (temSessaoSalva() || e?.whatsappAtivo) {
      conectar().catch(() => undefined);
      return true;
    }
  } catch {
    /* ignora */
  }
  return false;
}
