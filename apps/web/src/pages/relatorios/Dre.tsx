import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download } from 'lucide-react';
import { api } from '@/lib/api';
import { intervaloPeriodo } from '@/lib/periodo';
import { Button, Card, Checkbox, EmptyState, PageHeader, PeriodoFiltro, Segmentado, Skeleton } from '@/components/ui';
import { moeda, numero } from '@/lib/format';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import type { Dre as Dados, DreLinha } from '@/types';

/** DRE gerencial (competência / caixa) com comparativo e gráfico mensal */
export default function Dre() {
  const [periodo, setPeriodo] = useState(() => { const r = intervaloPeriodo('mes'); return { i: r.dataInicial, f: r.dataFinal }; });
  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia');
  const [comparar, setComparar] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ['dre', periodo, regime, comparar],
    queryFn: () => api.get<Dados>('/relatorios/dre', { dataInicial: periodo.i, dataFinal: periodo.f, regime, comparar }),
    retry: 0,
  });

  const receita = data?.linhas.find((l) => l.codigo === '1')?.valor ?? 0;
  const compMap = new Map((data?.comparativo?.linhas ?? []).map((l) => [l.codigo, l]));
  const mensal = (data?.mensal ?? []).map((m) => ({ ...m, rotulo: rotuloPeriodo(m.competencia) }));

  const pctReceita = (v: number) => (receita ? (v / receita) * 100 : 0);

  const exportarCsv = () => {
    if (!data) return;
    const linhas: string[] = ['Código;Conta;Valor;% Receita'];
    data.linhas.forEach((l) => {
      linhas.push(`${l.codigo};${l.nome};${l.valor.toFixed(2).replace('.', ',')};${pctReceita(l.valor).toFixed(1).replace('.', ',')}`);
      l.itens?.forEach((i) => linhas.push(`;  ${i.nome};${i.valor.toFixed(2).replace('.', ',')};${pctReceita(i.valor).toFixed(1).replace('.', ',')}`));
    });
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `DRE_${periodo.i}_${periodo.f}_${regime}.csv`;
    a.click();
  };

  const Linha = ({ l }: { l: DreLinha }) => {
    const comp = compMap.get(l.codigo);
    const ehTotal = !!l.total;
    const ehNegativa = /^\(-\)/.test(l.nome);
    return (
      <>
        <tr className={clsx(ehTotal ? 'bg-slate-50 font-semibold' : 'font-medium', ehTotal && 'border-t border-slate-200')}>
          <td className="px-3 py-2 text-xs text-slate-400">{l.codigo}</td>
          <td className={clsx('px-3 py-2', ehTotal ? 'text-slate-900' : 'text-slate-800')}>{l.nome}</td>
          <td className={clsx('num px-3 py-2 text-right', l.valor < 0 || (ehNegativa && l.valor > 0) ? 'text-red-600' : ehTotal ? 'text-slate-900' : 'text-slate-800')}>{ehNegativa && l.valor > 0 ? `(${moeda(l.valor)})` : moeda(l.valor)}</td>
          <td className="num px-3 py-2 text-right text-xs text-slate-500">{l.pct !== undefined ? numero(l.pct, 1) : numero(pctReceita(l.valor), 1)}%</td>
          {comparar && (
            <>
              <td className="num px-3 py-2 text-right text-slate-500">{comp ? moeda(comp.valor) : '—'}</td>
              <td className="num px-3 py-2 text-right text-xs">
                {comp && comp.valor !== 0 ? (
                  <span className={clsx(((l.valor - comp.valor) / Math.abs(comp.valor)) * (ehNegativa ? -1 : 1) >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                    {((l.valor - comp.valor) / Math.abs(comp.valor)) * 100 > 0 ? '+' : ''}
                    {numero(((l.valor - comp.valor) / Math.abs(comp.valor)) * 100, 1)}%
                  </span>
                ) : (
                  <span className="text-slate-300">—</span>
                )}
              </td>
            </>
          )}
        </tr>
        {l.itens?.map((i, k) => {
          const compItem = comp?.itens?.find((x) => x.nome === i.nome);
          return (
            <tr key={k} className="text-sm text-slate-600">
              <td className="px-3 py-1" />
              <td className="px-3 py-1 pl-8">{i.nome}</td>
              <td className="num px-3 py-1 text-right">{moeda(i.valor)}</td>
              <td className="num px-3 py-1 text-right text-xs text-slate-400">{numero(pctReceita(i.valor), 1)}%</td>
              {comparar && (
                <>
                  <td className="num px-3 py-1 text-right text-slate-400">{compItem ? moeda(compItem.valor) : '—'}</td>
                  <td />
                </>
              )}
            </tr>
          );
        })}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="DRE — Demonstrativo de resultado"
        descricao={regime === 'competencia' ? 'Regime de competência: vendas/OS concluídas pela data; CMV = compras reais de mercadoria; todas as despesas por competência/vencimento.' : 'Regime de caixa: recebimentos e pagamentos efetivos nas contas (transferências e ajustes de saldo ficam fora).'}
        acoes={
          <div className="flex flex-wrap items-end gap-2">
            <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} label="" limpavel={false} />
            <Segmentado valor={regime} onMudar={setRegime} opcoes={[{ valor: 'competencia', rotulo: 'Competência' }, { valor: 'caixa', rotulo: 'Caixa' }]} />
            <label className="flex h-8 items-center"><Checkbox label="Comparar período anterior" checked={comparar} onChange={(e) => setComparar(e.target.checked)} /></label>
            <Button variante="secundario" icone={<Download className="h-4 w-4" />} onClick={exportarCsv} disabled={!data}>CSV</Button>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" semPadding>
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-96" /></div>
          ) : !data ? (
            <EmptyState titulo="DRE indisponível" descricao="A rota de relatórios ainda não respondeu." />
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="w-12 px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Conta</th>
                    <th className="px-3 py-2 text-right">Período</th>
                    <th className="px-3 py-2 text-right">% Rec.</th>
                    {comparar && (
                      <>
                        <th className="px-3 py-2 text-right">Anterior</th>
                        <th className="px-3 py-2 text-right">Var.</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.linhas.map((l) => <Linha key={l.codigo} l={l} />)}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card titulo="Resultado mensal">
            {isLoading ? (
              <Skeleton className="h-56" />
            ) : mensal.length ? (
              <div className="h-56">
                <ResponsiveContainer>
                  <ComposedChart data={mensal} margin={{ left: 0, right: 4 }}>
                    <CartesianGrid stroke={CORES.grade} vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 10, fill: CORES.eixo }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip content={<TooltipPadrao />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="receita" name="Receita" fill={CORES.receita} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="despesas" name="Despesas" fill={CORES.saida} radius={[3, 3, 0, 0]} />
                    <Line type="monotone" dataKey="resultado" name="Resultado" stroke={CORES.saldo} strokeWidth={2} dot={{ r: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState compacto titulo="Sem dados mensais" />
            )}
          </Card>
          <Card titulo="Margens">
            {data ? (
              <div className="h-40">
                <ResponsiveContainer>
                  <BarChart data={data.linhas.filter((l) => l.total && l.codigo !== '3').map((l) => ({ nome: l.nome.replace(/^= /, '').replace(/ \(.*\)/, ''), pct: l.pct ?? pctReceita(l.valor) }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <XAxis type="number" domain={['auto', 'auto']} tick={{ fontSize: 10, fill: CORES.eixo }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(Number(v))}%`} />
                    <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<TooltipPadrao moedaFmt={false} />} />
                    <Bar dataKey="pct" name="% da receita" radius={[0, 4, 4, 0]} barSize={14}>
                      {data.linhas
                        .filter((l) => l.total && l.codigo !== '3')
                        .map((l, i) => (
                          <Cell key={i} fill={(l.pct ?? pctReceita(l.valor)) < 0 ? CORES.saida : CORES.lucro} />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Skeleton className="h-40" />
            )}
          </Card>
          {!!data?.informativo?.length && (
            <Card titulo="Fora do resultado (só para conferência)">
              <p className="mb-2 text-xs text-slate-500">Lançados no financeiro, mas fora do resultado para não contar duas vezes: o custo de cada venda já inclui produto, imposto e frete, e de cada empréstimo só os juros são despesa.</p>
              <div className="space-y-1 text-sm">
                {data.informativo.map((i) => (
                  <div key={i.nome} className="flex justify-between"><span className="text-slate-600">{i.nome}</span><span className="num">{moeda(i.valor)}</span></div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
