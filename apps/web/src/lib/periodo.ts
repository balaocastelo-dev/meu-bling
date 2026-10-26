/**
 * Períodos do filtro de data do sistema (dashboards e listas usam os mesmos):
 * Hoje · 7 dias · 30 dias · Este mês · Mês passado · Período (datas livres) — e "Tudo" nas listas.
 */
import { format, startOfMonth, subDays } from 'date-fns';

export type Periodo = 'tudo' | 'hoje' | '7d' | '30d' | 'mes' | 'mesPassado' | 'custom';

export const OPCOES_PERIODO: { valor: Exclude<Periodo, 'tudo'>; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: '30d', rotulo: '30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mesPassado', rotulo: 'Mês passado' },
  { valor: 'custom', rotulo: 'Período' },
];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Datas (AAAA-MM-DD) de um período; "tudo" = sem datas. */
export function intervaloPeriodo(p: Periodo, custom: { i: string; f: string } = { i: '', f: '' }): { dataInicial: string; dataFinal: string } {
  const h = new Date();
  switch (p) {
    case 'tudo':
      return { dataInicial: '', dataFinal: '' };
    case 'hoje':
      return { dataInicial: iso(h), dataFinal: iso(h) };
    case '7d':
      return { dataInicial: iso(subDays(h, 6)), dataFinal: iso(h) };
    case '30d':
      return { dataInicial: iso(subDays(h, 29)), dataFinal: iso(h) };
    case 'mes':
      return { dataInicial: iso(startOfMonth(h)), dataFinal: iso(h) };
    case 'mesPassado':
      return { dataInicial: iso(startOfMonth(subDays(startOfMonth(h), 1))), dataFinal: iso(subDays(startOfMonth(h), 1)) };
    default:
      return { dataInicial: custom.i, dataFinal: custom.f };
  }
}

/** Qual atalho corresponde a estas datas (ou "custom"/"tudo"). */
export function periodoDe(inicial: string, final: string): Periodo {
  if (!inicial && !final) return 'tudo';
  for (const o of OPCOES_PERIODO) {
    if (o.valor === 'custom') continue;
    const r = intervaloPeriodo(o.valor);
    if (r.dataInicial === inicial && r.dataFinal === final) return o.valor;
  }
  return 'custom';
}
