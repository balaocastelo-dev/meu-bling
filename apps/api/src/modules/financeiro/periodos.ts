/**
 * Utilidades de período para fluxo de caixa, dashboards e DRE.
 * Agrupamento por dia / semana (segunda-feira) / mês, com chaves ordenáveis.
 */
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
} from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { toDate } from '../../lib/util.js';

export type Agrupar = 'dia' | 'semana' | 'mes';

/**
 * "Todo o período" (desde sempre): a tela manda dataInicial = 2000-01-01 (lib/periodo.ts → DESDE_SEMPRE).
 * Qualquer data inicial anterior ao primeiro registro do sistema é recuada até ele, para as séries
 * começarem onde os dados começam (e não em 2000).
 */
let cacheInicio: { em: number; data: Date } | null = null;
export async function inicioDoSistema(): Promise<Date> {
  if (cacheInicio && Date.now() - cacheInicio.em < 5 * 60_000) return cacheInicio.data;
  const [v, o, c, m] = await Promise.all([
    prisma.venda.aggregate({ _min: { data: true } }),
    prisma.ordemServico.aggregate({ _min: { dataEntrada: true } }),
    prisma.compra.aggregate({ _min: { data: true } }),
    prisma.movimentoFinanceiro.aggregate({ _min: { data: true } }),
  ]);
  const datas = [v._min.data, o._min.dataEntrada, c._min.data, m._min.data].filter((d): d is Date => d instanceof Date && d.getFullYear() > 1990);
  const data = startOfDay(datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : new Date());
  cacheInicio = { em: Date.now(), data };
  return data;
}

/** Recua o início para o primeiro registro quando a tela pediu "todo o período"; devolve se recuou. */
export async function desdeSempre(ini: Date, fim: Date): Promise<{ ini: Date; fim: Date; tudo: boolean }> {
  const primeiro = await inicioDoSistema();
  if (ini < primeiro) return { ini: primeiro <= fim ? primeiro : ini, fim, tudo: true };
  return { ini, fim, tudo: false };
}

/** Chave do período: dia "2026-10-19", semana "2026-10-19" (segunda), mês "2026-10". */
export function chavePeriodo(d: Date, agrupar: Agrupar): string {
  if (agrupar === 'mes') return format(d, 'yyyy-MM');
  if (agrupar === 'semana') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  return format(d, 'yyyy-MM-dd');
}

/** Todas as chaves de período entre as datas (para séries sem buracos). */
export function listarPeriodos(ini: Date, fim: Date, agrupar: Agrupar): string[] {
  const out: string[] = [];
  let cursor = agrupar === 'mes' ? startOfMonth(ini) : agrupar === 'semana' ? startOfWeek(ini, { weekStartsOn: 1 }) : startOfDay(ini);
  let guard = 0;
  while (cursor <= fim && guard++ < 2000) {
    out.push(chavePeriodo(cursor, agrupar));
    cursor = agrupar === 'mes' ? addMonths(cursor, 1) : agrupar === 'semana' ? addWeeks(cursor, 1) : addDays(cursor, 1);
  }
  return out;
}

/**
 * Resolve dataInicial/dataFinal (padrão: mês atual) e devolve limites de dia completos.
 * `tudo` = a tela pediu "todo o período" (início recuado até o primeiro registro; sem comparativo com o período anterior).
 */
export async function resolverPeriodo(q: { dataInicial?: Date | null; dataFinal?: Date | null }, padrao: 'mes' | '30dias' = 'mes'): Promise<{ ini: Date; fim: Date; tudo: boolean }> {
  const hoje = new Date();
  let ini = q.dataInicial ? startOfDay(q.dataInicial) : null;
  let fim = q.dataFinal ? endOfDay(q.dataFinal) : null;
  if (!ini && !fim) {
    if (padrao === 'mes') {
      ini = startOfMonth(hoje);
      fim = endOfMonth(hoje);
    } else {
      ini = startOfDay(subDays(hoje, 29));
      fim = endOfDay(hoje);
    }
  } else if (!ini) {
    ini = startOfDay(subDays(fim!, 29));
  } else if (!fim) {
    fim = endOfDay(addDays(ini, 29));
  }
  return desdeSempre(ini!, fim!);
}

/** Período anterior de mesma duração (para comparativos). */
export function periodoAnterior(ini: Date, fim: Date) {
  const dias = differenceInCalendarDays(fim, ini) + 1;
  const fimAnt = endOfDay(subDays(ini, 1));
  const iniAnt = startOfDay(subDays(fimAnt, dias - 1));
  return { ini: iniAnt, fim: fimAnt };
}

export function agruparPadrao(ini: Date, fim: Date): Agrupar {
  const dias = differenceInCalendarDays(fim, ini) + 1;
  if (dias <= 45) return 'dia';
  if (dias <= 180) return 'semana';
  return 'mes';
}

export function dataDe(v: unknown): Date | null {
  return toDate(v as any);
}
