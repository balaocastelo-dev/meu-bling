/**
 * CHAMAR ATENÇÃO — o "nudge" do MSN, dentro do chat da equipe.
 *
 * Quem clica em Atenção faz a tela da outra pessoa tremer na hora (evento `atencao`
 * no mesmo tempo real do chat: WebSocket, ou a fila do long polling) e deixa no
 * histórico "Fulano chamou sua atenção". O robô de WhatsApp da loja (Evolution API
 * ou a sessão Baileys — o que estiver ligado em Configurações → WhatsApp) manda
 * um aviso no celular cadastrado do usuário.
 *
 * Anti-spam por remetente → destinatário: tremor a cada 30 s; WhatsApp a cada 5 min.
 * Sem celular, com número inválido ou com o WhatsApp da loja desligado, o tremor
 * acontece mesmo assim — o WhatsApp só é pulado.
 */
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import { somenteDigitos } from '../../lib/util.js';
import type { UsuarioJwt } from '../../plugins/auth.js';
import { conectado, enviarTexto } from '../../integracoes/whatsapp/provedor.js';
import { normalizarNumero } from '../../integracoes/whatsapp/servico.js';
import * as hub from './hub.js';
import { carregarConversa } from './service.js';
import { podeAtencao, podeWhatsapp, registrarAtencao, registrarWhatsapp } from './atencao-limite.js';

const WHATSAPP_TIMEOUT_MS = 8_000;

export type SituacaoWhatsapp = 'enviado' | 'sem_telefone' | 'telefone_invalido' | 'aguardando' | 'desconectado' | 'erro';

export interface DestinatarioAtencao {
  usuarioId: number;
  nome: string;
  whatsapp: SituacaoWhatsapp;
}

/** Link absoluto da conversa (APP_URL + BASE_PATH, ex.: https://www.balao.info/sistema/chat/12). */
export function linkDaConversa(conversaId: number) {
  const origem = env.APP_URL.replace(/\/$/, '');
  const prefixo = env.BASE_PATH ? (env.BASE_PATH.startsWith('/') ? env.BASE_PATH : `/${env.BASE_PATH}`) : '';
  return `${origem}${prefixo}/chat/${conversaId}`;
}

function telefoneUtil(...candidatos: (string | null | undefined)[]) {
  for (const c of candidatos) {
    const d = somenteDigitos(c);
    if (d.length >= 10) return d;
  }
  return null;
}

async function avisarWhatsapp(deId: number, paraId: number, nomeDe: string, telefone: string | null, link: string, agora: number): Promise<SituacaoWhatsapp> {
  if (!podeWhatsapp(deId, paraId, agora).ok) return 'aguardando';
  if (!telefone) return 'sem_telefone';
  try {
    normalizarNumero(telefone);
  } catch {
    return 'telefone_invalido';
  }
  let ligado = false;
  try {
    ligado = await conectado();
  } catch {
    return 'desconectado';
  }
  if (!ligado) return 'desconectado';
  const texto = `${nomeDe} está chamando sua atenção no sistema: ${link}`;
  try {
    await Promise.race([
      enviarTexto(telefone, texto),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), WHATSAPP_TIMEOUT_MS)),
    ]);
    registrarWhatsapp(deId, paraId, agora);
    return 'enviado';
  } catch (e) {
    console.warn('[chat/atencao] WhatsApp não enviado', String((e as Error)?.message || e).slice(0, 160));
    return 'erro';
  }
}

/**
 * Chama a atenção de quem está na conversa (a outra pessoa, na direta; os demais, na sala).
 * Devolve a mensagem de sistema e o que aconteceu com o WhatsApp de cada um.
 */
export async function chamarAtencao(conversaId: number, usuario: UsuarioJwt) {
  const { conversa, minha } = await carregarConversa(conversaId, usuario);
  if (!minha || minha.saiuEm) throw new Forbidden('Você não está mais nesta conversa.');

  const agora = Date.now();
  const outros = conversa.participantes.filter((p) => !p.saiuEm && p.usuarioId !== usuario.id);
  if (!outros.length) throw new AppError('Não há ninguém nesta conversa para chamar.', 422, 'SEM_DESTINATARIO');

  const liberados = [];
  let menorEspera = Infinity;
  for (const p of outros) {
    const d = podeAtencao(usuario.id, p.usuarioId, agora);
    if (d.ok) liberados.push(p);
    else menorEspera = Math.min(menorEspera, d.esperaMs);
  }
  if (!liberados.length) {
    const esperaSeg = Math.max(1, Math.ceil(menorEspera / 1000));
    throw new AppError(`Espere ${esperaSeg}s para chamar a atenção de novo.`, 429, 'ATENCAO_RAPIDO', { esperaSeg });
  }

  for (const p of liberados) registrarAtencao(usuario.id, p.usuarioId, agora);

  const texto = `${usuario.nome} chamou sua atenção`;
  const m = await prisma.mensagem.create({
    data: { conversaId, tipo: 'SISTEMA', texto },
    select: {
      id: true,
      conversaId: true,
      autorId: true,
      autor: { select: { id: true, nome: true, perfil: true } },
      tipo: true,
      texto: true,
      arquivo: true,
      arquivoNome: true,
      arquivoTamanho: true,
      arquivoMime: true,
      duracaoSeg: true,
      respondeAId: true,
      chamadaId: true,
      editadaEm: true,
      apagadaEm: true,
      criadoEm: true,
    },
  });
  await prisma.conversa.update({ where: { id: conversaId }, data: { ultimaMensagemEm: m.criadoEm } });
  const participantes = conversa.participantes.filter((p) => !p.saiuEm).map((p) => p.usuarioId);
  hub.enviarParaVarios(participantes, { tipo: 'mensagem', conversaId, mensagem: m });

  const ids = liberados.map((p) => p.usuarioId);
  const cadastros = await prisma.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, telefone: true, vendedor: { select: { telefone: true } }, tecnico: { select: { telefone: true } } },
  });
  const porId = new Map(cadastros.map((c) => [c.id, c]));
  const link = linkDaConversa(conversaId);

  const destinatarios: DestinatarioAtencao[] = [];
  for (const p of liberados) {
    hub.enviarPara(p.usuarioId, { tipo: 'atencao', conversaId, de: { id: usuario.id, nome: usuario.nome }, mensagemId: m.id });
    const c = porId.get(p.usuarioId);
    const tel = telefoneUtil(c?.telefone, c?.vendedor?.telefone, c?.tecnico?.telefone);
    const whatsapp = await avisarWhatsapp(usuario.id, p.usuarioId, usuario.nome, tel, link, agora);
    destinatarios.push({ usuarioId: p.usuarioId, nome: p.usuario.nome, whatsapp });
  }

  return { ok: true as const, mensagem: m, destinatarios };
}
