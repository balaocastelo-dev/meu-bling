import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../lib/errors.js';

/** Booleano vindo de query string ("true"/"false"/"1"/"0") ou JSON. */
export const boolQuery = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1'));

/** Lista de ids separados por vírgula ("1,2,3"). */
export const idsQuery = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      : undefined,
  );

/** Lê e valida o parâmetro :id da rota. */
export function idDe(req: FastifyRequest, nome = 'id'): number {
  const v = Number((req.params as Record<string, string>)[nome]);
  if (!Number.isInteger(v) || v <= 0) throw new AppError(`Parâmetro "${nome}" inválido.`, 400, 'PARAMETRO_INVALIDO');
  return v;
}

export const numeroOpcional = z.coerce.number().optional();
export const inteiroOpcional = z.coerce.number().int().optional();
export const idNullable = z.coerce.number().int().positive().nullable().optional();
