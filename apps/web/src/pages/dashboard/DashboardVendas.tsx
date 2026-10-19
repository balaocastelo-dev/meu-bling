import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, startOfMonth, subDays } from 'date-fns';
import { api } from '@/lib/api';
import { useVendedores, opcoesDe } from '@/hooks/useListas';
import { Card, EmptyState, KpiCard, PageHeader, PeriodoFiltro, Segmentado, SelectFiltro, Skeleton } from '@/components/ui';
import { hoje, inteiro, moeda, numero, percentual } from '@/lib/format';
import { CORES, PALETA, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import type { DashboardVendas as Dados } from '@/types';

type Periodo = 'hoje' | '7d' | '30d' | 'mes' | 'custom';

function intervalo(p: Periodo, custom: { i: string; f: string }): { dataInicial: string; dataFinal: string } {
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
    default:
      return { dataInicial: custom.i, dataFinal: custom.f };
  }
}

/** Dashboard de vendas com filtros de período e vendedor */
export default function DashboardVendas() {
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [custom, setCustom] = useState({ i: format(startOfMonth(new Date()), 'yyyy-MM-dd'), f: hoje() });
  const [vendedorId, setVendedorId] = useState('');
  const { data: vendedores } = useVendedores();

  const { dataInicial, dataFinal } = useMemo(() => intervalo(periodo, custom), [periodo, custom]);
  const agrupar = periodo === 'hoje' || periodo === '7d' || periodo === '30d' || periodo === 'mes' ? 'dia' : 'dia';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-vendas', dataInicial, dataFinal, vendedorId],
    queryFn: () => api.get<Dados>('/dashboard/vendas', { dataInicial, dataFinal, vendedorId, agrupar, comparar: true }),
    retry: 0,
  });

  const r = data?.resumo;
  const comp = r?.comparativo;
  const series = (data?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));

  return (
    <div className="space-y-5">
      <PageHeader
        titulo="Dashboard de vendas"
        descricao="Faturamento, vendedores, formas de pagamento e produtos mais vendidos."
        acoes={
          <div className="flex flex-wrap items-end gap-2">
            <Segmentado
              valor={periodo}
              onMudar={setPeriodo}
              opcoes={[
                { valor: 'hoje', rotulo: 'Hoje' },
                { valor: '7d', rotulo: '7 dias' },
                { valor: '30d', rotulo: '30 dias' },
                { valor: 'mes', rotulo: 'Este mês' },
                { valor: 'custom', rotulo: 'Período' },
              ]}
            />
            {periodo === 'custom' && <PeriodoFiltro inicial={custom.i} final={custom.f} onChange={(i, f) => setCustom({ i, f })} label="" />}
            <SelectFiltro valor={vendedorId} onChange={setVendedorId} opcoes={opcoesDe(vendedores)} placeholder="Todos os vendedores" />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard rotulo="Faturamento" valor={moeda(r?.faturamento)} atual={r?.faturamento} anterior={comp?.faturamento} carregando={isLoading} sub="vs. período anterior" />
        <KpiCard rotulo="Vendas" valor={inteiro(r?.qtdVendas)} atual={r?.qtdVendas} anterior={comp?.qtdVendas} carregando={isLoading} />
        <KpiCard rotulo="Ticket médio" valor={moeda(r?.ticketMedio)} atual={r?.ticketMedio} anterior={comp?.ticketMedio} carregando={isLoading} />
        <KpiCard rotulo="Itens vendidos" valor={inteiro(r?.itensVendidos)} carregando={isLoading} />
        <KpiCard rotulo="Lucro bruto" valor={moeda(r?.lucroBruto)} carregando={isLoading} />
        <KpiCard rotulo="Margem" valor={percentual(r?.margemPct)} carregando={isLoading} />
      </div>

      <Card titulo="Faturamento por dia" descricao={`${dataInicial.split('-').reverse().join('/')} a ${dataFinal.split('-').reverse().join('/')}`}>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : series.length ? (
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.receita} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={CORES.receita} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CORES.grade} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<TooltipPadrao />} />
                <Area type="monotone" dataKey="faturamento" name="Faturamento" stroke={CORES.receita} fill="url(#gradFat)" strokeWidth={2} />
                <Area type="monotone" dataKey="lucro" name="Lucro" stroke={CORES.lucro} fill="transparent" strokeWidth={1.5} strokeDasharray="4 3" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compacto titulo="Sem vendas no período" descricao="Apenas vendas em situação final (Fechada / NF emitida) entram no faturamento." />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titulo="Por vendedor">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : data?.porVendedor.length ? (
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={data.porVendedor} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke={CORES.grade} horizontal={false} />
                  <XAxis type="number" tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="nome" width={110} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<TooltipPadrao />} />
                  <Bar dataKey="faturamento" name="Faturamento" fill={CORES.receita} radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
          {data?.porVendedor.length ? (
            <table className="tbl mt-3">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th className="text-right">Vendas</th>
                  <th className="text-right">Faturamento</th>
                  <th className="text-right">Comissão</th>
                </tr>
              </thead>
              <tbody>
                {data.porVendedor.map((v) => (
                  <tr key={v.id}>
                    <td>{v.nome}</td>
                    <td className="num text-right">{inteiro(v.qtd)}</td>
                    <td className="num text-right">{moeda(v.faturamento)}</td>
                    <td className="num text-right text-slate-500">{moeda(v.comissao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>

        <Card titulo="Formas de pagamento">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : data?.porFormaPagamento.length ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.porFormaPagamento} dataKey="valor" nameKey="nome" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="#fff">
                      {data.porFormaPagamento.map((_, i) => (
                        <Cell key={i} fill={PALETA[i % PALETA.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<TooltipPadrao />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-1.5 text-sm">
                {data.porFormaPagamento.map((f, i) => {
                  const total = data.porFormaPagamento.reduce((s, x) => s + x.valor, 0);
                  return (
                    <li key={f.nome} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PALETA[i % PALETA.length] }} />
                      <span className="flex-1 truncate text-slate-700">{f.nome}</span>
                      <span className="num text-xs text-slate-400">{total ? numero((f.valor / total) * 100, 0) : 0}%</span>
                      <span className="num font-medium">{moeda(f.valor)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card titulo="Produtos mais vendidos" semPadding>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-48" />
            </div>
          ) : data?.topProdutos.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.topProdutos.map((p) => (
                  <tr key={p.produtoId}>
                    <td className="max-w-[200px] truncate">
                      <Link to={`/produtos/${p.produtoId}`} className="hover:text-brand-600">
                        {p.nome}
                      </Link>
                    </td>
                    <td className="num text-right">{numero(p.qtd)}</td>
                    <td className="num text-right">{moeda(p.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </Card>
        <Card titulo="Melhores clientes" semPadding>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-48" />
            </div>
          ) : data?.topClientes.length ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th className="text-right">Vendas</th>
                  <th className="text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.topClientes.map((c) => (
                  <tr key={c.contatoId}>
                    <td className="max-w-[200px] truncate">
                      <Link to={`/contatos/${c.contatoId}`} className="hover:text-brand-600">
                        {c.nome}
                      </Link>
                    </td>
                    <td className="num text-right">{inteiro(c.qtd)}</td>
                    <td className="num text-right">{moeda(c.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </Card>
        <Card titulo="Por situação e origem">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-4">
              <ul className="space-y-1.5 text-sm">
                {(data?.porSituacao ?? []).map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.cor }} />
                    <span className="flex-1 text-slate-700">{s.nome}</span>
                    <span className="num text-slate-500">{inteiro(s.qtd)}</span>
                    {s.valor !== undefined && <span className="num w-24 text-right font-medium">{moeda(s.valor)}</span>}
                  </li>
                ))}
                {!data?.porSituacao?.length && <li className="text-xs text-slate-400">Sem dados</li>}
              </ul>
              {data?.porOrigem?.length ? (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Origem</p>
                  <ul className="space-y-1 text-sm">
                    {data.porOrigem.map((o) => (
                      <li key={o.nome} className="flex items-center justify-between">
                        <span className="text-slate-700">{o.nome}</span>
                        <span className="num">{moeda(o.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
