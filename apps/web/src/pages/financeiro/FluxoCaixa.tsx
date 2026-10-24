import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { endOfMonth, format, startOfMonth, subDays } from 'date-fns';
import { api } from '@/lib/api';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Card, EmptyState, PageHeader, PeriodoFiltro, Segmentado, SelectFiltro, Skeleton, StatCard } from '@/components/ui';
import { hoje, moeda } from '@/lib/format';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import type { FluxoCaixa as Dados, ResumoFinanceiro } from '@/types';

/** Fluxo de caixa: realizado (movimentos) + previsto (contas a receber/pagar) */
export default function FluxoCaixa() {
  const [periodo, setPeriodo] = useState({ i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: format(endOfMonth(new Date()), 'yyyy-MM-dd') });
  const [agrupar, setAgrupar] = useState<'dia' | 'semana' | 'mes'>('dia');
  const [contaId, setContaId] = useState('');
  const { data: contas } = useContasFinanceiras();
  const { data, isLoading } = useQuery({
    queryKey: ['fluxo-caixa', periodo, agrupar, contaId],
    queryFn: () => api.get<Dados>('/financeiro/fluxo-caixa', { dataInicial: periodo.i, dataFinal: periodo.f, agrupar, contaFinanceiraId: contaId }),
    retry: 0,
  });
  const { data: resumo } = useQuery({ queryKey: ['financeiro-resumo'], queryFn: () => api.get<ResumoFinanceiro>('/financeiro/resumo').catch(() => null) });

  const series = (data?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const totEntradas = series.reduce((s, x) => s + x.entradas, 0);
  const totSaidas = series.reduce((s, x) => s + x.saidas, 0);
  const saldoFinal = series.length ? series[series.length - 1].saldo : data?.saldoInicial ?? 0;
  const previsto = data?.previsto ?? [];
  const totReceberPrev = previsto.reduce((s, x) => s + x.receber, 0);
  const totPagarPrev = previsto.reduce((s, x) => s + x.pagar, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Fluxo de caixa"
        descricao="Entradas e saídas realizadas nas contas, com saldo acumulado e previsão de títulos."
        acoes={
          <div className="flex flex-wrap items-end gap-2">
            <Segmentado
              valor="custom"
              onMudar={(v) => {
                const h = new Date();
                if (v === '30d') setPeriodo({ i: format(subDays(h, 29), 'yyyy-MM-dd'), f: hoje() });
                if (v === 'mes') setPeriodo({ i: format(startOfMonth(h), 'yyyy-MM-dd'), f: format(endOfMonth(h), 'yyyy-MM-dd') });
                if (v === '90d') setPeriodo({ i: format(subDays(h, 89), 'yyyy-MM-dd'), f: hoje() });
              }}
              opcoes={[{ valor: '30d', rotulo: '30 dias' }, { valor: 'mes', rotulo: 'Este mês' }, { valor: '90d', rotulo: '90 dias' }, { valor: 'custom', rotulo: 'Período' }]}
            />
            <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} label="" limpavel={false} />
            <SelectFiltro valor={agrupar} onChange={(v) => setAgrupar(v as typeof agrupar)} placeholder="" opcoes={[{ valor: 'dia', rotulo: 'Por dia' }, { valor: 'semana', rotulo: 'Por semana' }, { valor: 'mes', rotulo: 'Por mês' }]} />
            <SelectFiltro valor={contaId} onChange={setContaId} opcoes={opcoesDe(contas)} placeholder="Todas as contas" />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard rotulo="Saldo inicial" valor={moeda(data?.saldoInicial)} carregando={isLoading} />
        <StatCard rotulo="Entradas" valor={moeda(totEntradas)} tom="verde" carregando={isLoading} />
        <StatCard rotulo="Saídas" valor={moeda(totSaidas)} tom="vermelho" carregando={isLoading} />
        <StatCard rotulo="Saldo final" valor={moeda(saldoFinal)} tom={saldoFinal < 0 ? 'vermelho' : 'azul'} carregando={isLoading} />
        <StatCard rotulo="Previsto (a receber − a pagar)" valor={moeda(totReceberPrev - totPagarPrev)} sub={`${moeda(totReceberPrev)} / ${moeda(totPagarPrev)}`} tom="amarelo" carregando={isLoading} />
      </div>

      <Card titulo="Entradas × saídas e saldo acumulado">
        {isLoading ? (
          <Skeleton className="h-72" />
        ) : series.length ? (
          <div className="h-72">
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid stroke={CORES.grade} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="v" tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={64} />
                <YAxis yAxisId="s" orientation="right" tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={64} />
                <Tooltip content={<TooltipPadrao />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="v" dataKey="entradas" name="Entradas" fill={CORES.entrada} radius={[3, 3, 0, 0]} />
                <Bar yAxisId="v" dataKey="saidas" name="Saídas" fill={CORES.saida} radius={[3, 3, 0, 0]} />
                <Line yAxisId="s" type="monotone" dataKey="saldo" name="Saldo acumulado" stroke={CORES.saldo} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compacto titulo="Sem movimentos no período" />
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card titulo="Detalhamento" className="xl:col-span-2" semPadding>
          {series.length ? (
            <div className="max-h-[420px] overflow-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Período</th><th className="text-right">Entradas</th><th className="text-right">Saídas</th><th className="text-right">Resultado</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {series.map((s) => (
                    <tr key={s.periodo}>
                      <td data-rotulo="Período">{s.rotulo}</td>
                      <td className="num text-right text-emerald-700" data-rotulo="Entradas">{moeda(s.entradas)}</td>
                      <td className="num text-right text-red-600" data-rotulo="Saídas">{moeda(s.saidas)}</td>
                      <td className={clsx('num text-right font-medium', s.entradas - s.saidas < 0 ? 'text-red-600' : 'text-slate-800')} data-rotulo="Resultado">{moeda(s.entradas - s.saidas)}</td>
                      <td className={clsx('num text-right font-semibold', s.saldo < 0 ? 'text-red-600' : 'text-slate-900')} data-rotulo="Saldo">{moeda(s.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="num px-3 py-2 text-right text-emerald-700">{moeda(totEntradas)}</td>
                    <td className="num px-3 py-2 text-right text-red-600">{moeda(totSaidas)}</td>
                    <td className="num px-3 py-2 text-right">{moeda(totEntradas - totSaidas)}</td>
                    <td className="num px-3 py-2 text-right">{moeda(saldoFinal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </Card>
        <div className="space-y-4">
          <Card titulo="Previsto (títulos em aberto)" semPadding>
            {previsto.length ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Período</th><th className="text-right">A receber</th><th className="text-right">A pagar</th></tr></thead>
                <tbody>
                  {previsto.map((p) => (
                    <tr key={p.periodo}><td data-rotulo="Período">{rotuloPeriodo(p.periodo)}</td><td className="num text-right text-emerald-700" data-rotulo="A receber">{moeda(p.receber)}</td><td className="num text-right text-red-600" data-rotulo="A pagar">{moeda(p.pagar)}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <EmptyState compacto titulo="Sem previsões" />
            )}
          </Card>
          {resumo && (
            <Card titulo="Saldo por conta" semPadding>
              <ul className="divide-y divide-slate-100">
                {resumo.saldoContas.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.cor || '#2563eb' }} />
                    <span className="flex-1 truncate">{c.nome}</span>
                    <span className={clsx('num font-medium', c.saldoAtual < 0 && 'text-red-600')}>{moeda(c.saldoAtual)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between px-4 py-2 text-sm font-semibold"><span>Total</span><span className="num">{moeda(resumo.saldoTotal)}</span></li>
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
