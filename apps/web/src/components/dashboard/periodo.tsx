/**
 * Filtro de período dos dashboards (o mesmo no Dashboard e no de Assistência):
 * Hoje · 7 dias · 30 dias · Este mês · Mês passado · Período (datas livres).
 * Sempre abre em "Hoje".
 */
import { useMemo, useState } from 'react';
import { format, startOfMonth, subDays } from 'date-fns';
import { PeriodoFiltro } from '@/components/ui';
import { hoje } from '@/lib/format';
import { SegmentadoV18 } from './v18';

export type Periodo = 'hoje' | '7d' | '30d' | 'mes' | 'mesPassado' | 'custom';

export const OPCOES_PERIODO: { valor: Periodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'Hoje' },
  { valor: '7d', rotulo: '7 dias' },
  { valor: '30d', rotulo: '30 dias' },
  { valor: 'mes', rotulo: 'Este mês' },
  { valor: 'mesPassado', rotulo: 'Mês passado' },
  { valor: 'custom', rotulo: 'Período' },
];

export function intervaloPeriodo(p: Periodo, custom: { i: string; f: string }): { dataInicial: string; dataFinal: string } {
  const h = new Date();
  switch (p) {
    case 'hoje':
      return { dataInicial: hoje(), dataFinal: hoje() };
    case '7d':
      return { dataInicial: format(subDays(h, 6), 'yyyy-MM-dd'), dataFinal: hoje() };
    case '30d':
      return { dataInicial: format(subDays(h, 29), 'yyyy-MM-dd'), dataFinal: hoje() };
    case 'mes':
      return { dataInicial: format(startOfMonth(h), 'yyyy-MM-dd'), dataFinal: hoje() };
    case 'mesPassado': {
      const ini = startOfMonth(subDays(startOfMonth(h), 1));
      return { dataInicial: format(ini, 'yyyy-MM-dd'), dataFinal: format(subDays(startOfMonth(h), 1), 'yyyy-MM-dd') };
    }
    default:
      return { dataInicial: custom.i, dataFinal: custom.f };
  }
}

/** Estado do período de um dashboard. Todo dashboard abre sempre em "Hoje" (pedido do Thiago, 26/10/2026). */
export function usePeriodoDashboard(padrao: Periodo = 'hoje') {
  const [periodo, setPeriodo] = useState<Periodo>(padrao);
  const [custom, setCustom] = useState<{ i: string; f: string }>(() => ({ i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: hoje() }));
  const { dataInicial, dataFinal } = useMemo(() => intervaloPeriodo(periodo, custom), [periodo, custom]);
  const faixa = dataInicial === dataFinal ? dataInicial.split('-').reverse().join('/') : `${dataInicial.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}`;
  return { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa };
}

/** Botões de período + datas livres quando "Período" está marcado. */
export function FiltroPeriodo({ id, periodo, onPeriodo, custom, onCustom }: { id: string; periodo: Periodo; onPeriodo: (p: Periodo) => void; custom: { i: string; f: string }; onCustom: (c: { i: string; f: string }) => void }) {
  return (
    <>
      <SegmentadoV18 id={id} valor={periodo} onMudar={onPeriodo} opcoes={OPCOES_PERIODO} />
      {periodo === 'custom' && <PeriodoFiltro inicial={custom.i} final={custom.f} onChange={(i, f) => onCustom({ i, f })} label="" atalhos={false} limpavel={false} />}
    </>
  );
}
