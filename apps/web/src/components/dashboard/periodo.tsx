/**
 * Filtro de período dos dashboards (o mesmo no Dashboard e no de Assistência):
 * Todo o período · Hoje · Ontem · 7 dias · 30 dias · Este mês · Mês passado · Este ano · Ano passado · Últimos 12 meses · Período.
 * Sempre abre em "Hoje". "Todo o período" manda DESDE_SEMPRE..hoje e a API recua o início até o primeiro registro.
 */
import { useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { PeriodoFiltro } from '@/components/ui';
import { hoje } from '@/lib/format';
import { SegmentadoV18 } from './v18';

import { OPCOES_PERIODO, intervaloPeriodo, type Periodo } from '@/lib/periodo';

export { OPCOES_PERIODO, intervaloPeriodo, type Periodo };

/** Estado do período de um dashboard. Todo dashboard abre sempre em "Hoje" (pedido do Thiago, 26/10/2026). */
export function usePeriodoDashboard(padrao: Periodo = 'hoje') {
  const [periodo, setPeriodo] = useState<Periodo>(padrao);
  const [custom, setCustom] = useState<{ i: string; f: string }>(() => ({ i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: hoje() }));
  const { dataInicial, dataFinal } = useMemo(() => intervaloPeriodo(periodo, custom, true), [periodo, custom]);
  const faixa = periodo === 'tudo' ? 'todo o período' : dataInicial === dataFinal ? dataInicial.split('-').reverse().join('/') : `${dataInicial.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}`;
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
