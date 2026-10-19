import { z } from 'zod';
import { prisma, type Tx } from './prisma.js';

/** Paginação padrão: ?pagina=1&limite=50 */
export const paginacaoSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(500).default(50),
});

export function paginar(q: { pagina: number; limite: number }) {
  return { skip: (q.pagina - 1) * q.limite, take: q.limite };
}

export function respostaPaginada<T>(data: T[], total: number, q: { pagina: number; limite: number }) {
  return {
    data,
    meta: {
      total,
      pagina: q.pagina,
      limite: q.limite,
      totalPaginas: Math.max(1, Math.ceil(total / q.limite)),
    },
  };
}

/** Próximo número sequencial (VENDA, COMPRA, OS). Executar dentro da transação. */
export async function proximoNumero(nome: string, tx: Tx | typeof prisma = prisma): Promise<number> {
  const seq = await tx.sequencia.upsert({
    where: { nome },
    create: { nome, valor: 1 },
    update: { valor: { increment: 1 } },
  });
  return seq.valor;
}

export function arredondar(v: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round((v + Number.EPSILON) * f) / f;
}

export function competenciaDe(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

export function somenteDigitos(v?: string | null): string {
  return (v || '').replace(/\D+/g, '');
}

export function parseJsonArray(v: string | null | undefined): string[] {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

/** Converte "2026-10-19" ou ISO em Date (sem quebrar com fuso). */
export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T12:00:00');
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const dataSchema = z
  .union([z.string(), z.date()])
  .nullable()
  .optional()
  .transform((v) => toDate(v as any));

/** Substitui {{variaveis}} em templates ("{{cliente.nome}}"). */
export function renderTemplate(texto: string, vars: Record<string, any>): string {
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, caminho: string) => {
    const val = caminho.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), vars);
    return val === undefined || val === null ? '' : String(val);
  });
}

export function formatarMoeda(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarData(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('pt-BR');
}
