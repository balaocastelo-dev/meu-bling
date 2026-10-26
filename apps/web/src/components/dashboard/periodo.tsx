/**
 * Filtro de período dos dashboards (o mesmo no Dashboard e no de Assistência):
 * Hoje · 7 dias · 30 dias · Este mês · Mês passado · Período (datas livres).
 * A escolha fica lembrada por tela neste navegador.
 */
import { useEffect, useMemo, useState } from 'react';
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

const VALIDOS = OPCOES_PERIODO.map((o) => o.valor);

function ler<T>(chave: string, padrao: T, valido: (v: unknown) => boolean): T {
  try {
    const v = JSON.parse(localStorage.getItem(chave) || 'null');
    return valido(v) ? (v as T) : padrao;
  } catch {
    return padrao;
  }
}

function gravar(chave: string, v: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(v));
  } catch {
    /* navegador sem armazenamento: só não lembra */
  }
}

/** Estado do período de um dashboard, lembrado em `chave` (por tela). */
export function usePeriodoDashboard(chave: string, padrao: Periodo = 'mes') {
  const [periodo, setPeriodo] = useState<Periodo>(() => ler(`${chave}.periodo`, padrao, (v) => VALIDOS.includes(v as Periodo)));
  const [custom, setCustom] = useState<{ i: string; f: string }>(() =>
    ler(`${chave}.custom`, { i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: hoje() }, (v: any) => !!v && typeof v.i === 'string' && typeof v.f === 'string' && !!v.i && !!v.f),
  );
  useEffect(() => gravar(`${chave}.periodo`, periodo), [chave, periodo]);
  useEffect(() => gravar(`${chave}.custom`, custom), [chave, custom]);
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
