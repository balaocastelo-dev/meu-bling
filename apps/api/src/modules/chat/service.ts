/**
 * CHAT DA EQUIPE — regras (29/10/2026)
 *
 * Decisões do Thiago:
 *   - qualquer funcionário manda mensagem para qualquer outro (conversa direta, uma por par de pessoas);
 *   - todo mundo pode criar sala de reunião privada com as pessoas que escolher;
 *   - o ADMIN pode abrir e ler qualquer conversa;
 *   - áudios e arquivos ficam guardados para sempre (quando encher, compra-se servidor);
 *   - a pessoa fora do sistema recebe aviso no celular (Web Push) de mensagem e de chamada.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import type { Perfil, UsuarioJwt } from '../../plugins/auth.js';
import * as hub from './hub.js';
import { chavePublicaPush, enviarPush } from './push.js';

export type TipoConversa = 'DIRETA' | 'SALA';
export type TipoMensagem = 'TEXTO' | 'AUDIO' | 'ARQUIVO' | 'SISTEMA' | 'CHAMADA';
export type TipoChamada = 'VOZ' | 'VIDEO';

const selUsuario = { id: true, nome: true, perfil: true } as const;
const selMensagem = {
  id: true,
  conversaId: true,
  autorId: true,
  autor: { select: selUsuario },
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
} as const;

export const ehGestor = (perfil: Perfil) => perfil === 'ADMIN' || perfil === 'GERENTE';
export const ehAdmin = (perfil: Perfil) => perfil === 'ADMIN';

/** Mensagem como vai para a tela: apagada vira "Mensagem apagada" sem conteúdo. */
export function publicarMensagem<T extends { apagadaEm: Date | null; texto: string | null; arquivo: string | null }>(m: T) {
  if (!m.apagadaEm) return m;
  return { ...m, texto: null, arquivo: null, arquivoNome: null, arquivoTamanho: null, arquivoMime: null, duracaoSeg: null };
}

// =====================================================================
// PESSOAS E PRESENÇA
// =====================================================================

export async function listarColegas(usuarioId: number) {
  const usuarios = await prisma.usuario.findMany({ where: { ativo: true }, select: { ...selUsuario, ultimoLogin: true }, orderBy: { nome: 'asc' } });
  return usuarios.map((u) => ({ ...u, eu: u.id === usuarioId, ...hub.estadoDe(u.id) }));
}

// =====================================================================
// CONVERSAS
// =====================================================================

export async function participantesAtivos(conversaId: number): Promise<number[]> {
  const ps = await prisma.conversaParticipante.findMany({ where: { conversaId, saiuEm: null }, select: { usuarioId: true } });
  return ps.map((p) => p.usuarioId);
}

/** Conversa com participantes; confere o acesso (participante, mesmo que já tenha saído; ADMIN vê tudo). */
export async function carregarConversa(conversaId: number, usuario: UsuarioJwt) {
  const c = await prisma.conversa.findUnique({
    where: { id: conversaId },
    include: { participantes: { include: { usuario: { select: selUsuario } }, orderBy: { entrouEm: 'asc' } }, criadoPor: { select: selUsuario } },
  });
  if (!c) throw new NotFound('Conversa');
  const minha = c.participantes.find((p) => p.usuarioId === usuario.id);
  if (!minha && !ehAdmin(usuario.perfil)) throw new Forbidden('Você não participa desta conversa.');
  return { conversa: c, minha: minha ?? null };
}

export function resumoConversa(
  c: { id: number; tipo: string; nome: string | null; criadoPorId: number | null; ultimaMensagemEm: Date | null; criadoEm: Date; participantes: { usuarioId: number; lidaAteId: number; saiuEm: Date | null; silenciadaAte: Date | null; usuario: { id: number; nome: string; perfil: string } }[] },
  usuarioId: number,
) {
  const ativos = c.participantes.filter((p) => !p.saiuEm);
  const outros = ativos.filter((p) => p.usuarioId !== usuarioId);
  const minha = c.participantes.find((p) => p.usuarioId === usuarioId);
  const nome = c.tipo === 'DIRETA' ? outros[0]?.usuario.nome ?? c.participantes.find((p) => p.usuarioId !== usuarioId)?.usuario.nome ?? 'Conversa' : c.nome || 'Sala';
  return {
    id: c.id,
    tipo: c.tipo as TipoConversa,
    nome,
    criadoPorId: c.criadoPorId,
    ultimaMensagemEm: c.ultimaMensagemEm,
    criadoEm: c.criadoEm,
    /** na conversa direta, a outra pessoa (presença no topo da conversa) */
    outroUsuarioId: c.tipo === 'DIRETA' ? outros[0]?.usuarioId ?? null : null,
    participantes: ativos.map((p) => ({ ...p.usuario, lidaAteId: p.lidaAteId, ...hub.estadoDe(p.usuarioId) })),
    souParticipante: !!minha && !minha.saiuEm,
    silenciadaAte: minha?.silenciadaAte ?? null,
    lidaAteId: minha?.lidaAteId ?? 0,
  };
}

/** Caixa de entrada: minhas conversas (ou TODAS, para o ADMIN ler qualquer uma) com última mensagem e não lidas. */
export async function listarConversas(usuario: UsuarioJwt, todas = false) {
  const admTodas = todas && ehAdmin(usuario.perfil);
  const conversas = await prisma.conversa.findMany({
    where: admTodas ? {} : { participantes: { some: { usuarioId: usuario.id } } },
    include: {
      participantes: { include: { usuario: { select: selUsuario } }, orderBy: { entrouEm: 'asc' } },
      mensagens: { orderBy: { id: 'desc' }, take: 1, select: selMensagem },
    },
    orderBy: [{ ultimaMensagemEm: { sort: 'desc', nulls: 'last' } }, { criadoEm: 'desc' }],
    take: 300,
  });
  const naoLidas = await contarNaoLidas(usuario.id);
  return conversas.map((c) => {
    const r = resumoConversa(c, usuario.id);
    const ultima = c.mensagens[0] ? publicarMensagem(c.mensagens[0]) : null;
    return { ...r, ultimaMensagem: ultima, naoLidas: naoLidas.porConversa[c.id] ?? 0 };
  });
}

/** Mensagens não lidas por conversa (das conversas em que ainda estou) e o total. */
export async function contarNaoLidas(usuarioId: number): Promise<{ total: number; porConversa: Record<number, number> }> {
  const linhas = await prisma.$queryRaw<{ conversaId: number; qtd: number | bigint }[]>`
    SELECT m.conversaId AS conversaId, COUNT(*) AS qtd
    FROM Mensagem m
    JOIN ConversaParticipante p ON p.conversaId = m.conversaId AND p.usuarioId = ${usuarioId}
    WHERE p.saiuEm IS NULL AND m.id > p.lidaAteId AND m.apagadaEm IS NULL AND m.tipo <> 'SISTEMA'
      AND (m.autorId IS NULL OR m.autorId <> ${usuarioId})
    GROUP BY m.conversaId`;
  const porConversa: Record<number, number> = {};
  let total = 0;
  for (const l of linhas) {
    const n = Number(l.qtd);
    porConversa[l.conversaId] = n;
    total += n;
  }
  return { total, porConversa };
}

/** Conversa direta entre duas pessoas: uma só por par (cria na primeira vez). */
export async function abrirDireta(usuario: UsuarioJwt, outroId: number) {
  if (outroId === usuario.id) throw new AppError('Escolha outra pessoa para conversar.', 422, 'MESMA_PESSOA');
  const outro = await prisma.usuario.findUnique({ where: { id: outroId }, select: { id: true, ativo: true } });
  if (!outro || !outro.ativo) throw new AppError('Usuário não encontrado ou inativo.', 422, 'USUARIO');
  const chaveDireta = `${Math.min(usuario.id, outroId)}:${Math.max(usuario.id, outroId)}`;
  let c = await prisma.conversa.findUnique({ where: { chaveDireta } });
  let nova = false;
  if (!c) {
    c = await prisma.conversa.create({
      data: { tipo: 'DIRETA', chaveDireta, criadoPorId: usuario.id, participantes: { create: [{ usuarioId: usuario.id }, { usuarioId: outroId }] } },
    });
    nova = true;
  } else {
    // alguém pode ter "saído" de uma direta (não faz sentido, mas garante que volta)
    await prisma.conversaParticipante.updateMany({ where: { conversaId: c.id, saiuEm: { not: null } }, data: { saiuEm: null } });
  }
  const { conversa } = await carregarConversa(c.id, usuario);
  const r = resumoConversa(conversa, usuario.id);
  if (nova) hub.enviarPara(outroId, { tipo: 'conversa', conversa: resumoConversa(conversa, outroId) });
  return { ...r, ultimaMensagem: null, naoLidas: 0, nova };
}

/** Sala de reunião privada: quem cria escolhe as pessoas. */
export async function criarSala(usuario: UsuarioJwt, nome: string, usuarioIds: number[]) {
  const ids = [...new Set([usuario.id, ...usuarioIds])];
  const validos = await prisma.usuario.findMany({ where: { id: { in: ids }, ativo: true }, select: { id: true, nome: true } });
  if (validos.length < 2) throw new AppError('Escolha pelo menos uma pessoa para a sala.', 422, 'SALA_VAZIA');
  const c = await prisma.conversa.create({
    data: {
      tipo: 'SALA',
      nome: nome.trim(),
      criadoPorId: usuario.id,
      ultimaMensagemEm: new Date(),
      participantes: { create: validos.map((u) => ({ usuarioId: u.id })) },
      mensagens: { create: { tipo: 'SISTEMA', texto: `${usuario.nome} criou a sala "${nome.trim()}" com ${validos.filter((u) => u.id !== usuario.id).map((u) => u.nome.split(' ')[0]).join(', ')}` } },
    },
  });
  const { conversa } = await carregarConversa(c.id, usuario);
  for (const p of conversa.participantes) {
    const r = resumoConversa(conversa, p.usuarioId);
    hub.enviarPara(p.usuarioId, { tipo: 'conversa', conversa: r });
    if (p.usuarioId !== usuario.id && !hub.estaOnline(p.usuarioId)) {
      void enviarPush(p.usuarioId, { titulo: `Nova sala: ${nome.trim()}`, corpo: `${usuario.nome} incluiu você na sala`, link: `/chat/${c.id}`, tag: `conversa-${c.id}` });
    }
  }
  return { ...resumoConversa(conversa, usuario.id), ultimaMensagem: null, naoLidas: 0 };
}

function podeMexerNaSala(conversa: { tipo: string; criadoPorId: number | null }, usuario: UsuarioJwt, souParticipante: boolean) {
  if (conversa.tipo !== 'SALA') throw new AppError('Só salas podem ser alteradas.', 422, 'NAO_E_SALA');
  if (ehGestor(usuario.perfil) || conversa.criadoPorId === usuario.id) return;
  // qualquer participante pode chamar mais gente (sala é de quem está nela); só o criador/gestão tira ou renomeia
  if (!souParticipante) throw new Forbidden();
}

export async function renomearSala(conversaId: number, usuario: UsuarioJwt, nome: string) {
  const { conversa } = await carregarConversa(conversaId, usuario);
  if (conversa.tipo !== 'SALA') throw new AppError('Só salas têm nome.', 422, 'NAO_E_SALA');
  if (!ehGestor(usuario.perfil) && conversa.criadoPorId !== usuario.id) throw new Forbidden('Só quem criou a sala (ou a gestão) muda o nome.');
  await prisma.conversa.update({ where: { id: conversaId }, data: { nome: nome.trim() } });
  await mensagemSistema(conversaId, `${usuario.nome} mudou o nome da sala para "${nome.trim()}"`);
  return avisarConversa(conversaId, usuario);
}

export async function incluirNaSala(conversaId: number, usuario: UsuarioJwt, usuarioIds: number[]) {
  const { conversa, minha } = await carregarConversa(conversaId, usuario);
  podeMexerNaSala(conversa, usuario, !!minha && !minha.saiuEm);
  const novos = await prisma.usuario.findMany({ where: { id: { in: usuarioIds }, ativo: true }, select: { id: true, nome: true } });
  const incluidos: string[] = [];
  for (const u of novos) {
    const ja = conversa.participantes.find((p) => p.usuarioId === u.id);
    if (ja && !ja.saiuEm) continue;
    if (ja) await prisma.conversaParticipante.update({ where: { id: ja.id }, data: { saiuEm: null, entrouEm: new Date() } });
    else await prisma.conversaParticipante.create({ data: { conversaId, usuarioId: u.id } });
    incluidos.push(u.nome);
    if (!hub.estaOnline(u.id)) void enviarPush(u.id, { titulo: `Sala: ${conversa.nome}`, corpo: `${usuario.nome} incluiu você na sala`, link: `/chat/${conversaId}`, tag: `conversa-${conversaId}` });
  }
  if (incluidos.length) await mensagemSistema(conversaId, `${usuario.nome} incluiu ${incluidos.map((n) => n.split(' ')[0]).join(', ')} na sala`);
  return avisarConversa(conversaId, usuario);
}

export async function removerDaSala(conversaId: number, usuario: UsuarioJwt, usuarioId: number) {
  const { conversa } = await carregarConversa(conversaId, usuario);
  if (conversa.tipo !== 'SALA') throw new AppError('Só de salas se pode sair.', 422, 'NAO_E_SALA');
  const proprio = usuarioId === usuario.id;
  if (!proprio && !ehGestor(usuario.perfil) && conversa.criadoPorId !== usuario.id) throw new Forbidden('Só quem criou a sala (ou a gestão) tira alguém.');
  const p = conversa.participantes.find((x) => x.usuarioId === usuarioId && !x.saiuEm);
  if (!p) throw new AppError('Esta pessoa não está na sala.', 422, 'NAO_PARTICIPA');
  await prisma.conversaParticipante.update({ where: { id: p.id }, data: { saiuEm: new Date() } });
  await mensagemSistema(conversaId, proprio ? `${usuario.nome} saiu da sala` : `${usuario.nome} tirou ${p.usuario.nome.split(' ')[0]} da sala`);
  hub.enviarPara(usuarioId, { tipo: 'conversa.saiu', conversaId });
  return avisarConversa(conversaId, usuario, usuarioId);
}

export async function silenciar(conversaId: number, usuario: UsuarioJwt, ate: Date | null) {
  const { minha } = await carregarConversa(conversaId, usuario);
  if (!minha) throw new Forbidden();
  await prisma.conversaParticipante.update({ where: { id: minha.id }, data: { silenciadaAte: ate } });
  return { ok: true, silenciadaAte: ate };
}

/** Reenvia a conversa atualizada (nome, participantes) para todo mundo que está nela. */
async function avisarConversa(conversaId: number, usuario: UsuarioJwt, exceto?: number) {
  const { conversa } = await carregarConversa(conversaId, usuario);
  for (const p of conversa.participantes) {
    if (p.saiuEm || p.usuarioId === exceto) continue;
    hub.enviarPara(p.usuarioId, { tipo: 'conversa', conversa: resumoConversa(conversa, p.usuarioId) });
  }
  return resumoConversa(conversa, usuario.id);
}

// =====================================================================
// MENSAGENS
// =====================================================================

export async function listarMensagens(conversaId: number, usuario: UsuarioJwt, antesDe?: number, limite = 50) {
  await carregarConversa(conversaId, usuario);
  const lista = await prisma.mensagem.findMany({
    where: { conversaId, ...(antesDe ? { id: { lt: antesDe } } : {}) },
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(limite, 1), 200),
    select: selMensagem,
  });
  return lista.reverse().map(publicarMensagem);
}

async function mensagemSistema(conversaId: number, texto: string) {
  const m = await prisma.mensagem.create({ data: { conversaId, tipo: 'SISTEMA', texto }, select: selMensagem });
  await prisma.conversa.update({ where: { id: conversaId }, data: { ultimaMensagemEm: m.criadoEm } });
  hub.enviarParaVarios(await participantesAtivos(conversaId), { tipo: 'mensagem', conversaId, mensagem: m });
  return m;
}

export interface NovaMensagem {
  tipo: Exclude<TipoMensagem, 'SISTEMA'>;
  texto?: string | null;
  arquivo?: string | null;
  arquivoNome?: string | null;
  arquivoTamanho?: number | null;
  arquivoMime?: string | null;
  duracaoSeg?: number | null;
  respondeAId?: number | null;
  chamadaId?: number | null;
}

/** Resumo curto da mensagem para avisos (toast, push, caixa de entrada). */
export function resumoMensagem(m: { tipo: string; texto: string | null; arquivoNome?: string | null; duracaoSeg?: number | null; apagadaEm?: Date | null }) {
  if (m.apagadaEm) return 'Mensagem apagada';
  if (m.tipo === 'AUDIO') return `🎤 Áudio${m.duracaoSeg ? ` (${Math.floor(m.duracaoSeg / 60)}:${String(m.duracaoSeg % 60).padStart(2, '0')})` : ''}`;
  if (m.tipo === 'ARQUIVO') return `📎 ${m.arquivoNome || 'Arquivo'}`;
  if (m.tipo === 'CHAMADA') return m.texto || '📞 Chamada';
  return (m.texto || '').slice(0, 140);
}

export async function enviarMensagem(conversaId: number, usuario: UsuarioJwt, dados: NovaMensagem) {
  const { conversa, minha } = await carregarConversa(conversaId, usuario);
  if (!minha || minha.saiuEm) throw new Forbidden('Você não está mais nesta conversa.');
  if (dados.tipo === 'TEXTO' && !(dados.texto || '').trim()) throw new AppError('Escreva a mensagem.', 422, 'MENSAGEM_VAZIA');
  if (dados.respondeAId) {
    const r = await prisma.mensagem.findFirst({ where: { id: dados.respondeAId, conversaId }, select: { id: true } });
    if (!r) dados.respondeAId = null;
  }
  const m = await prisma.mensagem.create({
    data: {
      conversaId,
      autorId: usuario.id,
      tipo: dados.tipo,
      texto: dados.texto?.trim() || null,
      arquivo: dados.arquivo ?? null,
      arquivoNome: dados.arquivoNome ?? null,
      arquivoTamanho: dados.arquivoTamanho ?? null,
      arquivoMime: dados.arquivoMime ?? null,
      duracaoSeg: dados.duracaoSeg ?? null,
      respondeAId: dados.respondeAId ?? null,
      chamadaId: dados.chamadaId ?? null,
    },
    select: selMensagem,
  });
  await prisma.$transaction([
    prisma.conversa.update({ where: { id: conversaId }, data: { ultimaMensagemEm: m.criadoEm } }),
    // quem mandou já leu até ela
    prisma.conversaParticipante.update({ where: { id: minha.id }, data: { lidaAteId: m.id } }),
  ]);
  const ativos = conversa.participantes.filter((p) => !p.saiuEm);
  hub.enviarParaVarios(ativos.map((p) => p.usuarioId), { tipo: 'mensagem', conversaId, mensagem: m });
  // aviso no celular para quem está fora do sistema (e não silenciou a conversa)
  const titulo = conversa.tipo === 'DIRETA' ? usuario.nome : `${usuario.nome} · ${conversa.nome || 'Sala'}`;
  for (const p of ativos) {
    if (p.usuarioId === usuario.id || hub.estaOnline(p.usuarioId)) continue;
    if (p.silenciadaAte && p.silenciadaAte > new Date()) continue;
    void enviarPush(p.usuarioId, { titulo, corpo: resumoMensagem(m), link: `/chat/${conversaId}`, tag: `conversa-${conversaId}`, dados: { conversaId } });
  }
  return m;
}

export async function marcarLida(conversaId: number, usuario: UsuarioJwt, ateId?: number) {
  const { minha } = await carregarConversa(conversaId, usuario);
  if (!minha) return { ok: true, lidaAteId: 0 };
  const ultima = ateId ?? (await prisma.mensagem.aggregate({ where: { conversaId }, _max: { id: true } }))._max.id ?? 0;
  if (ultima <= minha.lidaAteId) return { ok: true, lidaAteId: minha.lidaAteId };
  await prisma.conversaParticipante.update({ where: { id: minha.id }, data: { lidaAteId: ultima } });
  hub.enviarParaVarios(await participantesAtivos(conversaId), { tipo: 'lida', conversaId, usuarioId: usuario.id, ateId: ultima });
  return { ok: true, lidaAteId: ultima };
}

export async function apagarMensagem(mensagemId: number, usuario: UsuarioJwt) {
  const m = await prisma.mensagem.findUnique({ where: { id: mensagemId }, select: { id: true, conversaId: true, autorId: true, apagadaEm: true } });
  if (!m) throw new NotFound('Mensagem');
  if (m.autorId !== usuario.id && !ehAdmin(usuario.perfil)) throw new Forbidden('Só quem escreveu (ou o ADMIN) apaga a mensagem.');
  if (!m.apagadaEm) await prisma.mensagem.update({ where: { id: mensagemId }, data: { apagadaEm: new Date() } });
  hub.enviarParaVarios(await participantesAtivos(m.conversaId), { tipo: 'mensagem.apagada', conversaId: m.conversaId, mensagemId });
  return { ok: true };
}

export async function digitando(conversaId: number, usuario: UsuarioJwt) {
  const ids = await participantesAtivos(conversaId);
  if (!ids.includes(usuario.id)) return;
  hub.marcarDigitando(usuario.id, conversaId, ids, usuario.nome);
}

// =====================================================================
// ANEXOS (áudio gravado e arquivos) — ficam em storage/chat/aaaa-mm/
// =====================================================================

const MIME_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-m4a', 'audio/mp4;codecs=mp4a.40.2'];
const EXT_POR_MIME: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

export function salvarAnexo(buffer: Buffer, mime: string, nomeOriginal: string | undefined, audio: boolean): { arquivo: string; nome: string; tamanho: number; mime: string } {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (audio && !MIME_AUDIO.some((m) => m.split(';')[0] === base)) throw new AppError(`Formato de áudio não aceito (${base}).`, 422, 'AUDIO_FORMATO');
  if (!audio && !EXT_POR_MIME[base] && !base.startsWith('image/')) throw new AppError('Envie imagens (PNG, JPG, WEBP, GIF) ou PDF.', 422, 'ARQUIVO_FORMATO');
  const pasta = new Date().toISOString().slice(0, 7); // aaaa-mm
  const dir = path.join(env.STORAGE_DIR, 'chat', pasta);
  fs.mkdirSync(dir, { recursive: true });
  const ext = EXT_POR_MIME[base] || path.extname(nomeOriginal || '').toLowerCase() || '.bin';
  const nomeArq = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  fs.writeFileSync(path.join(dir, nomeArq), buffer);
  const nome = (nomeOriginal || (audio ? `audio${ext}` : `arquivo${ext}`)).replace(/[\r\n]/g, ' ').slice(0, 120);
  return { arquivo: `/uploads/chat/${pasta}/${nomeArq}`, nome, tamanho: buffer.length, mime: base };
}

// =====================================================================
// CHAMADAS DE VOZ E VÍDEO (WebRTC: o áudio/vídeo vai de navegador a navegador; aqui só a "apresentação")
// =====================================================================

const CHAMADA_SEM_RESPOSTA_MS = 45_000;
const temporizadores = new Map<number, NodeJS.Timeout>();

function lerParticipantes(c: { participantes: string }): number[] {
  try {
    const v = JSON.parse(c.participantes);
    return Array.isArray(v) ? v.map(Number) : [];
  } catch {
    return [];
  }
}

export function publicarChamada(c: { id: number; conversaId: number; tipo: string; iniciadoPorId: number; situacao: string; participantes: string; iniciadaEm: Date; atendidaEm: Date | null; encerradaEm: Date | null; iniciadoPor?: { id: number; nome: string; perfil: string } }) {
  return { id: c.id, conversaId: c.conversaId, tipo: c.tipo as TipoChamada, iniciadoPorId: c.iniciadoPorId, iniciadoPor: c.iniciadoPor ?? null, situacao: c.situacao, participantes: lerParticipantes(c), iniciadaEm: c.iniciadaEm, atendidaEm: c.atendidaEm, encerradaEm: c.encerradaEm };
}

async function chamadaCompleta(id: number) {
  const c = await prisma.chamada.findUnique({ where: { id }, include: { iniciadoPor: { select: selUsuario } } });
  if (!c) throw new NotFound('Chamada');
  return c;
}

async function avisarChamada(acao: string, chamadaId: number, exceto?: number) {
  const c = await chamadaCompleta(chamadaId);
  const pub = publicarChamada(c);
  hub.enviarParaVarios(await participantesAtivos(c.conversaId), { tipo: 'chamada', acao, chamada: pub }, exceto);
  return pub;
}

/** Chamadas ativas das conversas em que estou (para a tela ao abrir/reconectar). */
export async function chamadasAtivas(usuarioId: number) {
  const lista = await prisma.chamada.findMany({
    where: { situacao: 'ATIVA', conversa: { participantes: { some: { usuarioId, saiuEm: null } } } },
    include: { iniciadoPor: { select: selUsuario } },
    orderBy: { id: 'desc' },
  });
  return lista.map(publicarChamada);
}

export async function iniciarChamada(conversaId: number, usuario: UsuarioJwt, tipo: TipoChamada) {
  const { conversa, minha } = await carregarConversa(conversaId, usuario);
  if (!minha || minha.saiuEm) throw new Forbidden('Você não está nesta conversa.');
  const ativa = await prisma.chamada.findFirst({ where: { conversaId, situacao: 'ATIVA' } });
  if (ativa) {
    // já tem chamada rolando nesta conversa: entra nela em vez de abrir outra
    return entrarChamada(ativa.id, usuario);
  }
  const c = await prisma.chamada.create({ data: { conversaId, tipo, iniciadoPorId: usuario.id, participantes: JSON.stringify([usuario.id]) }, include: { iniciadoPor: { select: selUsuario } } });
  const pub = publicarChamada(c);
  const outros = conversa.participantes.filter((p) => !p.saiuEm && p.usuarioId !== usuario.id).map((p) => p.usuarioId);
  hub.enviarParaVarios(outros, { tipo: 'chamada', acao: 'convite', chamada: pub });
  const nomeConversa = conversa.tipo === 'DIRETA' ? usuario.nome : `${usuario.nome} · ${conversa.nome || 'Sala'}`;
  for (const id of outros) {
    if (!hub.estaOnline(id)) void enviarPush(id, { titulo: `📞 ${tipo === 'VIDEO' ? 'Chamada de vídeo' : 'Chamada de voz'}`, corpo: `${nomeConversa} está chamando você`, link: `/chat/${conversaId}`, tag: `chamada-${c.id}`, urgente: true, dados: { chamadaId: c.id, conversaId } });
  }
  // ninguém atendeu em 45 s: perdida
  temporizadores.set(
    c.id,
    setTimeout(() => {
      void encerrarSemResposta(c.id);
    }, CHAMADA_SEM_RESPOSTA_MS),
  );
  return pub;
}

async function encerrarSemResposta(chamadaId: number) {
  temporizadores.delete(chamadaId);
  const c = await prisma.chamada.findUnique({ where: { id: chamadaId } });
  if (!c || c.situacao !== 'ATIVA' || c.atendidaEm) return;
  await prisma.chamada.update({ where: { id: chamadaId }, data: { situacao: 'PERDIDA', encerradaEm: new Date() } });
  await registrarChamadaNaConversa(chamadaId);
  await avisarChamada('perdida', chamadaId);
}

export async function entrarChamada(chamadaId: number, usuario: UsuarioJwt) {
  const c = await chamadaCompleta(chamadaId);
  if (c.situacao !== 'ATIVA') throw new AppError('Esta chamada já terminou.', 422, 'CHAMADA_ENCERRADA');
  const ids = await participantesAtivos(c.conversaId);
  if (!ids.includes(usuario.id)) throw new Forbidden('Você não está nesta conversa.');
  const atuais = lerParticipantes(c);
  if (!atuais.includes(usuario.id)) atuais.push(usuario.id);
  const t = temporizadores.get(chamadaId);
  if (t) {
    clearTimeout(t);
    temporizadores.delete(chamadaId);
  }
  await prisma.chamada.update({ where: { id: chamadaId }, data: { participantes: JSON.stringify(atuais), atendidaEm: c.atendidaEm ?? (atuais.length > 1 ? new Date() : null) } });
  return avisarChamada('entrou', chamadaId);
}

export async function recusarChamada(chamadaId: number, usuario: UsuarioJwt) {
  const c = await chamadaCompleta(chamadaId);
  if (c.situacao !== 'ATIVA') return publicarChamada(c);
  const ids = await participantesAtivos(c.conversaId);
  if (!ids.includes(usuario.id)) throw new Forbidden();
  const conversa = await prisma.conversa.findUnique({ where: { id: c.conversaId }, select: { tipo: true } });
  // conversa direta: recusou, acabou; sala: só avisa que fulano recusou
  if (conversa?.tipo === 'DIRETA') {
    const t = temporizadores.get(chamadaId);
    if (t) clearTimeout(t);
    temporizadores.delete(chamadaId);
    await prisma.chamada.update({ where: { id: chamadaId }, data: { situacao: 'RECUSADA', encerradaEm: new Date() } });
    await registrarChamadaNaConversa(chamadaId);
    return avisarChamada('encerrada', chamadaId);
  }
  hub.enviarParaVarios(ids, { tipo: 'chamada', acao: 'recusou', chamada: publicarChamada(c), usuarioId: usuario.id });
  return publicarChamada(c);
}

/**
 * Sair da chamada (desligar). A chamada termina quando: sobra menos de duas pessoas depois de atendida
 * (chamada precisa de pelo menos duas), ou quem ligou desiste antes de alguém atender.
 */
export async function sairChamada(chamadaId: number, usuario: UsuarioJwt) {
  const c = await chamadaCompleta(chamadaId);
  if (c.situacao !== 'ATIVA') return publicarChamada(c);
  const atuais = lerParticipantes(c).filter((id) => id !== usuario.id);
  const ninguemAtendeu = !c.atendidaEm;
  if (atuais.length === 0 || (!ninguemAtendeu && atuais.length < 2) || (ninguemAtendeu && c.iniciadoPorId === usuario.id)) {
    const t = temporizadores.get(chamadaId);
    if (t) clearTimeout(t);
    temporizadores.delete(chamadaId);
    await prisma.chamada.update({ where: { id: chamadaId }, data: { participantes: JSON.stringify(atuais), situacao: ninguemAtendeu ? 'PERDIDA' : 'ENCERRADA', encerradaEm: new Date() } });
    await registrarChamadaNaConversa(chamadaId);
    return avisarChamada('encerrada', chamadaId);
  }
  await prisma.chamada.update({ where: { id: chamadaId }, data: { participantes: JSON.stringify(atuais) } });
  return avisarChamada('saiu', chamadaId);
}

/** Deixa o registro da chamada na conversa ("Chamada de voz · 3 min", "Chamada perdida"). */
async function registrarChamadaNaConversa(chamadaId: number) {
  const c = await chamadaCompleta(chamadaId);
  const ja = await prisma.mensagem.findFirst({ where: { chamadaId }, select: { id: true } });
  if (ja) return;
  const rotulo = c.tipo === 'VIDEO' ? 'Chamada de vídeo' : 'Chamada de voz';
  let texto: string;
  if (c.situacao === 'PERDIDA') texto = `📞 ${rotulo} perdida`;
  else if (c.situacao === 'RECUSADA') texto = `📞 ${rotulo} recusada`;
  else {
    const seg = Math.max(0, Math.round(((c.encerradaEm ?? new Date()).getTime() - (c.atendidaEm ?? c.iniciadaEm).getTime()) / 1000));
    const dur = seg >= 60 ? `${Math.floor(seg / 60)} min ${seg % 60 ? `${seg % 60} s` : ''}`.trim() : `${seg} s`;
    texto = `📞 ${rotulo} · ${dur}`;
  }
  const m = await prisma.mensagem.create({ data: { conversaId: c.conversaId, autorId: c.iniciadoPorId, tipo: 'CHAMADA', texto, chamadaId }, select: selMensagem });
  await prisma.conversa.update({ where: { id: c.conversaId }, data: { ultimaMensagemEm: m.criadoEm } });
  hub.enviarParaVarios(await participantesAtivos(c.conversaId), { tipo: 'mensagem', conversaId: c.conversaId, mensagem: m });
}

/** Repassa a sinalização WebRTC (oferta, resposta, candidatos ICE) para a outra pessoa da chamada. */
export async function repassarRtc(de: UsuarioJwt, chamadaId: number, para: number, dados: unknown) {
  const c = await prisma.chamada.findUnique({ where: { id: chamadaId }, select: { situacao: true, participantes: true, conversaId: true } });
  if (!c || c.situacao !== 'ATIVA') return;
  const ids = await participantesAtivos(c.conversaId);
  if (!ids.includes(de.id) || !ids.includes(para)) return;
  hub.enviarPara(para, { tipo: 'rtc', chamadaId, de: de.id, dados });
}

/** Ao reiniciar a API, chamadas que ficaram "ATIVA" no banco viram encerradas. */
export async function encerrarChamadasPenduradas() {
  const r = await prisma.chamada.updateMany({ where: { situacao: 'ATIVA' }, data: { situacao: 'ENCERRADA', encerradaEm: new Date() } });
  return r.count;
}

// =====================================================================
// CONFIGURAÇÃO PARA O NAVEGADOR: onde ligar o tempo real, STUN/TURN e chave do push
// =====================================================================

/**
 * Credenciais temporárias do TURN (coturn com `use-auth-secret`): usuário = validade:id,
 * senha = HMAC-SHA1(segredo, usuário) em base64. Valem 12 h.
 */
function credenciaisTurn(usuarioId: number) {
  const host = process.env.TURN_HOST?.trim();
  const segredo = process.env.TURN_SECRET?.trim();
  if (!host || !segredo) return [];
  const porta = process.env.TURN_PORT?.trim() || '3478';
  const validade = Math.floor(Date.now() / 1000) + 12 * 3600;
  const username = `${validade}:mb${usuarioId}`;
  const credential = crypto.createHmac('sha1', segredo).update(username).digest('base64');
  const urls = [`turn:${host}:${porta}?transport=udp`, `turn:${host}:${porta}?transport=tcp`];
  const tls = process.env.TURN_TLS_PORT?.trim();
  if (tls) urls.push(`turns:${host}:${tls}?transport=tcp`);
  return [{ urls, username, credential }];
}

export function configChat(usuario: UsuarioJwt) {
  const realtime = (process.env.CHAT_REALTIME_URL || '').trim().replace(/\/$/, '');
  return {
    /** base (http/https) onde o navegador liga o WebSocket; vazio = mesma origem do sistema */
    realtimeUrl: realtime || null,
    /** quando o WebSocket não conecta, o navegador usa GET /chat/eventos (long polling) */
    pollingMs: 25_000,
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, ...credenciaisTurn(usuario.id)],
    turn: !!process.env.TURN_HOST,
    pushPublicKey: chavePublicaPush(),
    chamadaSemRespostaSeg: CHAMADA_SEM_RESPOSTA_MS / 1000,
  };
}
