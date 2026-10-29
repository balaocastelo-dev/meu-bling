/**
 * Períodos do filtro de data do sistema (dashboards e listas usam os mesmos):
 * Todo o período · Hoje · Ontem · 7 dias · 30 dias · Este mês · Mês passado · Este ano · Ano passado · Últimos 12 meses · Período (datas livres).
 * Pedido do Thiago (28/10/2026): todo filtro de data do sistema completo assim; "Ontem" e "Todo o período" em 29/10/2026.
 *
 * "Todo o período" (desde sempre):
 *   - nas listas = sem datas (a API não filtra);
 *   - nos dashboards, DRE, fluxo de caixa e relatórios = de DESDE_SEMPRE até hoje; a API recua o início para a data do
 *     primeiro registro do sistema (venda, OS, compra, movimento), então as séries começam onde os dados começam.
 */
import { addDays, format, startOfMonth, startOfYear, subDays, subMonths, subYears, endOfYear } from 'date-fns';

export type Periodo = 'tudo' | 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | 'mesPassado' | 'ano' | 'anoPassado' | '12m' | 'custom';

/** Data inicial que significa "desde o primeiro registro do sistema" (a API recua até ele). */
export const DESDE_SEMPRE = '2000-01-01';

export const OPCOES_PERIODO: { valor: Periodo; rotulo: string }[] = [
  { valor: 'tudo', rotulo: 'Todo o período' },
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: 'ontem', rotulo: 'Ontem' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: '30d', rotulo: '30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mesPassado', rotulo: 'Mês passado' },
  { valor: 'ano', rotulo: 'Este ano' },
  { valor: 'anoPassado', rotulo: 'Ano passado' },
  { valor: '12m', rotulo: 'Últimos 12 meses' },
  { valor: 'custom', rotulo: 'Período' },
];

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/**
 * Datas (AAAA-MM-DD) de um período.
 * "tudo" = sem datas (listas) ou, com `desdeSempre`, de DESDE_SEMPRE até hoje (dashboards/relatórios, que exigem datas).
 */
export function intervaloPeriodo(p: Periodo, custom: { i: string; f: string } = { i: '', f: '' }, desdeSempre = false): { dataInicial: string; dataFinal: string } {
  const h = new Date();
  switch (p) {
    case 'tudo':
      return desdeSempre ? { dataInicial: DESDE_SEMPRE, dataFinal: iso(h) } : { dataInicial: '', dataFinal: '' };
    case 'hoje':
      return { dataInicial: iso(h), dataFinal: iso(h) };
    case 'ontem': {
      const o = subDays(h, 1);
      return { dataInicial: iso(o), dataFinal: iso(o) };
    }
    case '7d':
      return { dataInicial: iso(subDays(h, 6)), dataFinal: iso(h) };
    case '30d':
      return { dataInicial: iso(subDays(h, 29)), dataFinal: iso(h) };
    case 'mes':
      return { dataInicial: iso(startOfMonth(h)), dataFinal: iso(h) };
    case 'mesPassado':
      return { dataInicial: iso(startOfMonth(subDays(startOfMonth(h), 1))), dataFinal: iso(subDays(startOfMonth(h), 1)) };
    case 'ano':
      return { dataInicial: iso(startOfYear(h)), dataFinal: iso(h) };
    case 'anoPassado': {
      const a = subYears(h, 1);
      return { dataInicial: iso(startOfYear(a)), dataFinal: iso(endOfYear(a)) };
    }
    case '12m':
      // de hoje-12 meses (+1 dia) até hoje: 29/10/2025 a 28/10/2026
      return { dataInicial: iso(addDays(subMonths(h, 12), 1)), dataFinal: iso(h) };
    default:
      return { dataInicial: custom.i, dataFinal: custom.f };
  }
}

/** Qual atalho corresponde a estas datas (ou "custom"/"tudo"). */
export function periodoDe(inicial: string, final: string): Periodo {
  if (!inicial && !final) return 'tudo';
  if (inicial === DESDE_SEMPRE) return 'tudo';
  for (const o of OPCOES_PERIODO) {
    if (o.valor === 'custom' || o.valor === 'tudo') continue;
    const r = intervaloPeriodo(o.valor);
    if (r.dataInicial === inicial && r.dataFinal === final) return o.valor;
  }
  return 'custom';
}
