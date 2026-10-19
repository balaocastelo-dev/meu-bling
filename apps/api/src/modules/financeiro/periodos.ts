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
import { toDate } from '../../lib/util.js';

export type Agrupar = 'dia' | 'semana' | 'mes';

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

/** Resolve dataInicial/dataFinal (padrão: mês atual) e devolve limites de dia completos. */
export function resolverPeriodo(q: { dataInicial?: Date | null; dataFinal?: Date | null }, padrao: 'mes' | '30dias' = 'mes') {
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
  return { ini: ini!, fim: fim! };
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
