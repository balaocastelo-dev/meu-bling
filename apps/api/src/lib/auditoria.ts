import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

export type AcaoAuditoria = 'CRIAR' | 'ALTERAR' | 'EXCLUIR' | 'SITUACAO' | 'LOGIN' | 'ACAO';

/** Registra uma ação no log de auditoria (nunca lança erro). */
export async function auditar(
  req: FastifyRequest | null,
  entidade: string,
  entidadeId: number | null,
  acao: AcaoAuditoria,
  detalhes?: unknown,
) {
  try {
    await prisma.auditoria.create({
      data: {
        usuarioId: req?.user?.id ?? null,
        entidade,
        entidadeId,
        acao,
        detalhes: detalhes === undefined ? null : JSON.stringify(detalhes).slice(0, 8000),
        ip: req?.ip ?? null,
      },
    });
  } catch (e) {
    req?.log?.warn({ e }, 'falha ao auditar');
  }
}
