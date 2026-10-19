/**
 * WHATSAPP (QR Code) — sessão via @whiskeysockets/baileys.
 *
 * Estado em memória: DESCONECTADO | AGUARDANDO_QR | CONECTANDO | CONECTADO.
 * A sessão fica em `${STORAGE_DIR}/whatsapp` (multi-file auth state).
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
const estado: EstadoWhatsApp = { status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: null, desde: null, ultimoErro: null };
/** emite 'estado' a cada mudança (usado pelo SSE) e 'mensagem' ao receber texto */
export const whatsappEventos = new EventEmitter();
whatsappEventos.setMaxListeners(50);

let sock: any = null;
let conectando = false;
let reconectarTimer: NodeJS.Timeout | null = null;
let tentativasReconexao = 0;
let encerradoManualmente = false;

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
// Conexão
// ---------------------------------------------------------------------
export async function conectar(): Promise<EstadoWhatsApp> {
  if (estado.status === 'CONECTADO' || conectando) return status();
  conectando = true;
  encerradoManualmente = false;
  if (reconectarTimer) {
    clearTimeout(reconectarTimer);
    reconectarTimer = null;
  }
  try {
    const baileys: any = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.makeWASocket || baileys.default;
    const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = baileys;

    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(PASTA_SESSAO);
    let version: any;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined; // usa a versão embutida no pacote
    }
    const logger = pino({ level: 'silent' });

    setEstado({ status: 'CONECTANDO', qrDataUrl: null, ultimoErro: null });

    const novoSock = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ['MEU BLING', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 30000,
      keepAliveIntervalMs: 25000,
      getMessage: async () => undefined,
    });
    sock = novoSock;

    novoSock.ev.on('creds.update', () => {
      saveCreds().catch(() => undefined);
    });

    novoSock.ev.on('connection.update', async (u: any) => {
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
          const codigo = (lastDisconnect?.error as any)?.output?.statusCode ?? (lastDisconnect?.error as any)?.statusCode;
          const motivo = String((lastDisconnect?.error as any)?.message || codigo || 'conexão encerrada');
          const deslogado = codigo === DisconnectReason.loggedOut || codigo === 401 || codigo === 403;
          sock = null;
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
      try {
        if (m.type !== 'notify') return;
        for (const msg of m.messages || []) {
          if (!msg.message || msg.key?.fromMe) continue;
          const jid: string = msg.key?.remoteJid || '';
          if (!jid.endsWith('@s.whatsapp.net')) continue; // ignora grupos/status
          const texto: string =
            msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.buttonsResponseMessage?.selectedDisplayText || msg.message.listResponseMessage?.title || '';
          if (!texto) continue;
          const numero = somenteDigitos(jid.split('@')[0]);
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
}

export async function desconectar(): Promise<EstadoWhatsApp> {
  encerradoManualmente = true;
  if (reconectarTimer) {
    clearTimeout(reconectarTimer);
    reconectarTimer = null;
  }
  const s = sock;
  sock = null;
  if (s) {
    try {
      await Promise.race([s.logout(), new Promise((r) => setTimeout(r, 5000))]);
    } catch {
      /* já desconectado */
    }
    try {
      s.end?.(undefined);
    } catch {
      /* ignora */
    }
  }
  apagarSessao();
  setEstado({ status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: null, desde: null, ultimoErro: null });
  await atualizarEmpresa(false);
  return status();
}

// ---------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------
export async function enviarTexto(numero: string, texto: string): Promise<{ id: string | null; jid: string }> {
  if (estado.status !== 'CONECTADO' || !sock) throw new AppError('WhatsApp desconectado', 422, 'WHATSAPP_DESCONECTADO');
  let jid = jidDe(numero);
  try {
    if (typeof sock.onWhatsApp === 'function') {
      const r = await Promise.race([sock.onWhatsApp(jid), new Promise<undefined>((res) => setTimeout(() => res(undefined), 8000))]);
      const info = Array.isArray(r) ? r[0] : undefined;
      if (info && info.exists === false) throw new AppError(`O número ${numero} não possui WhatsApp.`, 422, 'SEM_WHATSAPP');
      if (info?.jid) jid = info.jid;
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    /* verificação opcional: segue com o jid calculado */
  }
  try {
    const r = await sock.sendMessage(jid, { text: texto });
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
