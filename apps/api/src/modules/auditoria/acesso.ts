/**
 * ACESSO AO PAINEL — só ADMIN, e ainda com a senha do dia:
 *   prefixo (56676009) + data de hoje em DDMMAAAA (fuso de São Paulo)  →  ex.: 5667600929102026
 * O prefixo pode ser trocado em Configuracao (chave auditoria.prefixoSenha) ou por AUDITORIA_PREFIXO_SENHA.
 * Depois da senha certa, o painel recebe um token próprio (4 h) que vai no cabeçalho x-auditoria.
 */
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { env } from '../../lib/env.js';
import { AppError } from '../../lib/errors.js';
import { clienteSemTrilha } from './trilha.js';

const PREFIXO_PADRAO = '56676009';
const VALIDADE_MS = 4 * 60 * 60 * 1000;
const CHAVE_CONFIG = 'auditoria.prefixoSenha';

export function dataDeHoje(agora = new Date()): string {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(agora);
  const pega = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${pega('day')}${pega('month')}${pega('year')}`;
}

export async function prefixoSenha(): Promise<string> {
  if (process.env.AUDITORIA_PREFIXO_SENHA) return process.env.AUDITORIA_PREFIXO_SENHA;
  const c = await clienteSemTrilha().configuracao.findUnique({ where: { chave: CHAVE_CONFIG } }).catch(() => null);
  return c?.valor || PREFIXO_PADRAO;
}

export async function senhaDoDia(agora = new Date()): Promise<string> {
  return `${await prefixoSenha()}${dataDeHoje(agora)}`;
}

/** Compara sem vazar tempo (mesmo tamanho) */
function iguais(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function conferirSenha(senha: string): Promise<boolean> {
  const s = String(senha ?? '').trim();
  if (!s) return false;
  const hoje = await senhaDoDia();
  if (iguais(s, hoje)) return true;
  // tolerância de 5 minutos na virada do dia (quem digitou 23:58 e enviou 00:01)
  const agora = new Date();
  const minutosSP = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', hour12: false }).format(agora).replace(':', ''));
  if (minutosSP < 5) return iguais(s, await senhaDoDia(new Date(agora.getTime() - 10 * 60 * 1000)));
  return false;
}

function chave() {
  return crypto.createHash('sha256').update(`painel-auditoria:${env.APP_SECRET}`).digest();
}

export function emitirTokenPainel(usuarioId: number): { token: string; expiraEm: string } {
  const exp = Date.now() + VALIDADE_MS;
  const corpo = `${usuarioId}.${exp}`;
  const assinatura = crypto.createHmac('sha256', chave()).update(corpo).digest('base64url');
  return { token: `${corpo}.${assinatura}`, expiraEm: new Date(exp).toISOString() };
}

export function tokenValido(token: string | undefined, usuarioId: number): boolean {
  if (!token) return false;
  const partes = String(token).split('.');
  if (partes.length !== 3) return false;
  const [uid, exp, assinatura] = partes;
  if (Number(uid) !== usuarioId || Number(exp) < Date.now()) return false;
  const esperada = crypto.createHmac('sha256', chave()).update(`${uid}.${exp}`).digest('base64url');
  return iguais(assinatura, esperada);
}

/** preHandler das rotas do painel: ADMIN + token do painel válido */
export async function exigirPainel(req: FastifyRequest) {
  if (req.user?.perfil !== 'ADMIN' || req.chaveApi) throw new AppError('O Painel de auditoria é só do administrador.', 403, 'SEM_PERMISSAO');
  const token = (req.headers['x-auditoria'] as string | undefined) ?? ((req.query as any)?.auditoria as string | undefined);
  // 403 (não 401): 401 faria a tela achar que a sessão caiu e mandar para o login
  if (!tokenValido(token, req.user.id)) throw new AppError('Digite a senha do dia para abrir o Painel de auditoria.', 403, 'PAINEL_SENHA');
}
