import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';

export type AcaoAuditoria = 'CRIAR' | 'ALTERAR' | 'EXCLUIR' | 'SITUACAO' | 'LOGIN' | 'ACAO';

/** Campos que nunca podem ir para o log em texto (senha, tokens, segredos, certificado). */
const SENSIVEL = /senha|password|secret|segredo|token|csc|pfx|certificadoSenha|apiKey|chavePrivada/i;

/** Copia os detalhes trocando o valor de campos sensíveis por "***". */
export function mascarar(v: unknown, prof = 0): unknown {
  if (prof > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => mascarar(x, prof + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = SENSIVEL.test(k) && val !== null && val !== undefined && val !== '' ? '***' : mascarar(val, prof + 1);
  }
  return out;
}

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
        detalhes: detalhes === undefined ? null : JSON.stringify(mascarar(detalhes)).slice(0, 8000),
        ip: req?.ip ?? null,
      },
    });
  } catch (e) {
    req?.log?.warn({ e }, 'falha ao auditar');
  }
}
