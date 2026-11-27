/**
 * Sessão do navegador: JWT e cookie `mb_token` duram 30 dias.
 * Enquanto a pessoa usa o sistema, POST /auth/renovar emite outro token de 30 dias
 * (o anterior continua válido até o exp original — não há sessão única).
 */
import type { FastifyReply } from 'fastify';
import { env } from '../../lib/env.js';
import { COOKIE_PATH, COOKIE_SESSAO } from '../../plugins/arquivos.js';

/** 30 dias, em segundos (cookie maxAge). */
export const SESSAO_SEGUNDOS = 30 * 24 * 60 * 60;
/** Formato do fast-jwt (`ms`). Número cru seria milissegundos — por isso a string. */
export const SESSAO_EXPIRES_IN = '30d';

export function gravarCookieSessao(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE_SESSAO, token, {
    path: COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd && env.APP_URL.startsWith('https'),
    maxAge: SESSAO_SEGUNDOS,
  });
}
