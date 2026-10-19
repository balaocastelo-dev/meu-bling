import crypto from 'node:crypto';
import { env } from '../../lib/env.js';
import { prisma } from '../../lib/prisma.js';

export type TipoPublico = 'os' | 'venda';

/**
 * Token público (sem login) para acompanhamento de OS/venda pelo cliente.
 * = primeiros 24 caracteres de sha256(`${id}:${APP_SECRET}`).
 * O `tipo` só define a rota (/p/os/<token> ou /p/venda/<token>).
 */
export function tokenPublico(_tipo: TipoPublico, id: number): string {
  return crypto.createHash('sha256').update(`${id}:${env.APP_SECRET}`).digest('hex').slice(0, 24);
}

/** Link público completo, ex.: http://localhost:5173/p/os/abc123... */
export function linkPublico(tipo: TipoPublico, id: number): string {
  return `${env.APP_URL.replace(/\/$/, '')}/p/${tipo}/${tokenPublico(tipo, id)}`;
}

/**
 * Localiza o id da entidade a partir do token (o token não é reversível, então
 * percorre os ids do tipo — tabelas de uma loja são pequenas o suficiente).
 */
export async function idPorToken(tipo: TipoPublico, token: string): Promise<number | null> {
  if (!/^[0-9a-f]{24}$/.test(token || '')) return null;
  const ids =
    tipo === 'os'
      ? await prisma.ordemServico.findMany({ select: { id: true }, orderBy: { id: 'desc' } })
      : await prisma.venda.findMany({ select: { id: true }, orderBy: { id: 'desc' } });
  for (const { id } of ids) {
    if (tokenPublico(tipo, id) === token) return id;
  }
  return null;
}
