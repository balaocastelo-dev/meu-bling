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

/** Maior número já gravado na tabela dona da sequência (null = sequência sem tabela conhecida). */
async function maiorNumeroGravado(nome: string, tx: Tx | typeof prisma): Promise<number | null> {
  const db = tx as typeof prisma;
  switch (nome) {
    case 'VENDA':
      return (await db.venda.aggregate({ where: { tipo: 'PEDIDO' }, _max: { numero: true } }))._max.numero ?? 0;
    case 'ORCAMENTO':
      return (await db.venda.aggregate({ where: { tipo: 'ORCAMENTO' }, _max: { numero: true } }))._max.numero ?? 0;
    case 'COMPRA':
      return (await db.compra.aggregate({ _max: { numero: true } }))._max.numero ?? 0;
    case 'OS':
      return (await db.ordemServico.aggregate({ _max: { numero: true } }))._max.numero ?? 0;
    case 'EMPRESTIMO':
      return (await db.emprestimo.aggregate({ _max: { numero: true } }))._max.numero ?? 0;
    case 'CONSIGNACAO':
      return (await db.consignacao.aggregate({ _max: { numero: true } }))._max.numero ?? 0;
    default:
      return null;
  }
}

/**
 * Próximo número sequencial (VENDA, ORCAMENTO, COMPRA, OS). Executar dentro da transação.
 * Nunca devolve um número já usado: se a sequência ficou para trás (importação do Bling,
 * restauração de backup, seed rodado de novo…), ela é avançada para depois do maior número gravado.
 * Sem isso, cada "Salvar" batia no mesmo número, dava erro de valor único e a transação desfazia
 * o incremento — o sistema ficava travado para sempre no mesmo número.
 */
export async function proximoNumero(nome: string, tx: Tx | typeof prisma = prisma): Promise<number> {
  const seq = await tx.sequencia.upsert({
    where: { nome },
    create: { nome, valor: 1 },
    update: { valor: { increment: 1 } },
  });
  const maior = await maiorNumeroGravado(nome, tx);
  if (maior !== null && seq.valor <= maior) {
    const ajustado = await tx.sequencia.update({ where: { nome }, data: { valor: maior + 1 } });
    return ajustado.valor;
  }
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    // data inexistente (31/02, mês 13) vira null em vez de "Invalid Date" ou de pular para o mês seguinte
    const [a, m, dia] = v.split('-').map(Number);
    const d = new Date(v + 'T12:00:00');
    return isNaN(d.getTime()) || d.getFullYear() !== a || d.getMonth() + 1 !== m || d.getDate() !== dia ? null : d;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export const dataSchema = z
  .union([z.string(), z.date()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || v === '') return null;
    const d = toDate(v as any);
    if (!d) {
      ctx.addIssue({ code: 'custom', message: `data inválida: ${String(v)}` });
      return z.NEVER;
    }
    return d;
  });

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
