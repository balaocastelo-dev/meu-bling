import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, CircleDollarSign, Crown, Layers, Package, PieChart as PieIcon, Percent, Receipt, ShoppingCart, Trophy, TrendingUp, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { useVendedores, opcoesDe } from '@/hooks/useListas';
import { EmptyState, SelectFiltro, Skeleton } from '@/components/ui';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { FotoProduto } from '@/components/compartilhados/ProdutoSite';
import { Aparecer, Avatar, BarraAnimada, CardV18, Grupo, KpiV18, LinhaV18, PaginaV18, listaVariants } from '@/components/dashboard/v18';
import { inteiro, moeda, numero, percentual } from '@/lib/format';
import { CORES, PALETA, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import type { DashboardVendas as Dados } from '@/types';

/** Dashboard de vendas — estilo V18 com as cores do sistema */
export default function DashboardVendas() {
  const nav = useNavigate();
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard();
  const [vendedorId, setVendedorId] = useState('');
  const { data: vendedores } = useVendedores();

  const agrupar = 'dia';

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-vendas', dataInicial, dataFinal, vendedorId],
    queryFn: () => api.get<Dados>('/dashboard/vendas', { dataInicial, dataFinal, vendedorId, agrupar, comparar: true }),
    retry: 0,
  });

  const r = data?.resumo;
  const comp = r?.comparativo;
  const series = (data?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const lider = data?.porVendedor[0]?.faturamento ?? 0;
  const totalVend = (data?.porVendedor ?? []).reduce((s, v) => s + v.faturamento, 0);
  const totalFormas = (data?.porFormaPagamento ?? []).reduce((s, x) => s + x.valor, 0);
  const maiorCliente = data?.topClientes[0]?.valor ?? 0;
  const qtd = (n: number) => inteiro(Math.round(n));

  return (
    <PaginaV18 className="space-y-5">
      <Aparecer className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Dashboard de vendas</h1>
          <p className="text-sm text-slate-500">Faturamento, vendedores, formas de pagamento e produtos mais vendidos.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <FiltroPeriodo id="periodo-vendas" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
          <SelectFiltro valor={vendedorId} onChange={setVendedorId} opcoes={opcoesDe(vendedores)} placeholder="Todos os vendedores" />
        </div>
      </Aparecer>

      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiV18 rotulo="Faturamento" valor={r?.faturamento} anterior={comp?.faturamento} formato={moeda} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde" carregando={isLoading} sub="vs. período anterior" />
        <KpiV18 rotulo="Vendas" valor={r?.qtdVendas} anterior={comp?.qtdVendas} formato={qtd} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={isLoading} onClick={() => nav('/vendas')} />
        <KpiV18 rotulo="Ticket médio" valor={r?.ticketMedio} anterior={comp?.ticketMedio} formato={moeda} icone={<Receipt className="h-4 w-4" />} tom="vermelho" carregando={isLoading} />
        <KpiV18 rotulo="Itens vendidos" valor={r?.itensVendidos} formato={qtd} icone={<Package className="h-4 w-4" />} tom="neutro" carregando={isLoading} />
        <KpiV18 rotulo="Lucro bruto" valor={r?.lucroBruto} formato={moeda} icone={<TrendingUp className="h-4 w-4" />} tom="verde" carregando={isLoading} />
        <KpiV18 rotulo="Margem" valor={r?.margemPct} formato={(n) => percentual(n)} icone={<Percent className="h-4 w-4" />} tom="amarelo" carregando={isLoading} />
      </Grupo>

      {!!r?.semCusto && (
        <Aparecer className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="mt-0.5">⚠️</span>
          <span>
            {r.semCusto} venda{r.semCusto > 1 ? 's' : ''} com item sem custo — o lucro delas está contando o item como 100% lucro. Abra a venda, clique em Editar e preencha a coluna “Custo un.”.
          </span>
        </Aparecer>
      )}

      <CardV18 titulo="Faturamento por dia" descricao={faixa} icone={<BarChart3 className="h-4 w-4" />} tom="azul">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : series.length ? (
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.receita} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CORES.receita} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradLucro" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.lucro} stopOpacity={0.15} />
                    <stop offset="100%" stopColor={CORES.lucro} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<TooltipPadrao />} cursor={{ stroke: CORES.eixo, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="faturamento" name="Faturamento" stroke={CORES.receita} fill="url(#gradFat)" strokeWidth={2.5} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={1100} />
                <Area type="monotone" dataKey="lucro" name="Lucro" stroke={CORES.lucro} fill="url(#gradLucro)" strokeWidth={1.5} strokeDasharray="4 3" animationDuration={1300} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compacto titulo="Sem vendas no período" descricao="Contam todas as vendas salvas no período (em aberto, fechadas, com NF); canceladas e orçamentos ficam de fora." />
        )}
      </CardV18>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Ranking de vendedores */}
        <CardV18 titulo="Ranking de vendedores" descricao={data?.porVendedor.length ? `${data.porVendedor.length} vendedores · ${moeda(totalVend)}` : faixa} icone={<Trophy className="h-4 w-4" />} tom="amarelo" semPadding>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-56" />
            </div>
          ) : data?.porVendedor.length ? (
            <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {data.porVendedor.map((v, i) => (
                <LinhaV18 key={v.id ?? `sem-${i}`}>
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400 num">{i === 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" /> : `${i + 1}º`}</span>
                  <Avatar nome={v.nome} indice={i} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{v.nome}</span>
                      <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(v.faturamento)}</span>
                    </div>
                    <BarraAnimada pct={lider > 0 ? (v.faturamento / lider) * 100 : 0} cor={i === 0 ? '#dc2626' : '#94a3b8'} className="mt-1.5 h-1.5" />
                    <p className="mt-1 text-[11px] text-slate-400 num">
                      {inteiro(v.qtd)} {v.qtd === 1 ? 'venda' : 'vendas'} · {totalVend > 0 ? numero((v.faturamento / totalVend) * 100, 0) : 0}% do total · comissão {moeda(v.comissao)}
                    </p>
                  </div>
                </LinhaV18>
              ))}
            </motion.ul>
          ) : (
            <EmptyState compacto icone={<Users className="h-5 w-5" />} titulo="Sem vendas no período" />
          )}
        </CardV18>

        <CardV18 titulo="Formas de pagamento" descricao={totalFormas ? moeda(totalFormas) : faixa} icone={<PieIcon className="h-4 w-4" />} tom="azul">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : data?.porFormaPagamento.length ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
              <div className="relative h-52 w-52 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={data.porFormaPagamento} dataKey="valor" nameKey="nome" innerRadius={62} outerRadius={88} paddingAngle={3} cornerRadius={6} stroke="#fff" animationDuration={1000}>
                      {data.porFormaPagamento.map((_, i) => (
                        <Cell key={i} fill={PALETA[i % PALETA.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<TooltipPadrao />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] text-slate-400">Total</span>
                  <span className="num text-sm font-bold text-slate-900">{moeda(totalFormas)}</span>
                </div>
              </div>
              <motion.ul className="w-full min-w-0 space-y-2.5 text-sm" variants={listaVariants} initial="oculto" animate="visivel">
                {data.porFormaPagamento.map((f, i) => {
                  const pct = totalFormas ? (f.valor / totalFormas) * 100 : 0;
                  return (
                    <LinhaV18 key={f.nome} bloco className="px-0 py-0.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: PALETA[i % PALETA.length] }} />
                        <span className="min-w-0 flex-1 truncate text-slate-700">{f.nome}</span>
                        <span className="num text-xs text-slate-400">{numero(pct, 0)}%</span>
                        <span className="num font-medium">{moeda(f.valor)}</span>
                      </div>
                      <BarraAnimada pct={pct} cor={PALETA[i % PALETA.length]} className="ml-[18px] mt-1 h-1" />
                    </LinhaV18>
                  );
                })}
              </motion.ul>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </CardV18>
      </div>

      {/* Mais vendidos em cards com foto (estilo "Saved for later" do V18) */}
      <CardV18 titulo="Produtos mais vendidos" descricao={faixa} icone={<Package className="h-4 w-4" />} tom="vermelho">
        {isLoading ? (
          <Skeleton className="h-48" />
        ) : data?.topProdutos.length ? (
          <motion.div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5" variants={listaVariants} initial="oculto" animate="visivel">
            {data.topProdutos.map((p, i) => (
              <motion.div
                key={p.produtoId ?? `p-${i}`}
                variants={{ oculto: { opacity: 0, y: 14, scale: 0.97 }, visivel: { opacity: 1, y: 0, scale: 1 } }}
                whileHover={{ y: -4, boxShadow: '0 14px 30px -12px rgba(15, 23, 42, 0.18)' }}
                className="min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white"
              >
                <Link to={p.produtoId ? `/produtos/${p.produtoId}` : '#'} className="block">
                  <div className="relative flex h-24 items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100/60 p-2 sm:h-28">
                    <FotoProduto url={p.imagemUrl} alt={p.nome} tamanho="lg" className="!h-full !w-full !border-0 !bg-transparent" />
                    <span className={`absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold num ${i < 3 ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 shadow-card'}`}>#{i + 1}</span>
                  </div>
                  <div className="p-2.5">
                    <p className="line-clamp-2 min-h-[2.5em] break-words text-xs font-medium leading-tight text-slate-800">{p.nome}</p>
                    <div className="mt-1.5 flex items-baseline justify-between gap-1">
                      <span className="num text-sm font-semibold text-slate-900">{moeda(p.valor)}</span>
                      <span className="num text-[11px] text-slate-400">{numero(p.qtd)} un</span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <EmptyState compacto titulo="Sem dados" />
        )}
      </CardV18>

      <div className="grid gap-4 md:grid-cols-2">
        <CardV18 titulo="Melhores clientes" descricao={faixa} icone={<Users className="h-4 w-4" />} tom="verde" semPadding>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-48" />
            </div>
          ) : data?.topClientes.length ? (
            <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {data.topClientes.map((c, i) => (
                <LinhaV18 key={c.contatoId} onClick={() => nav(`/contatos/${c.contatoId}`)}>
                  <Avatar nome={c.nome} indice={i + 2} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{c.nome}</span>
                      <span className="num shrink-0 text-sm font-semibold">{moeda(c.valor)}</span>
                    </div>
                    <BarraAnimada pct={maiorCliente > 0 ? (c.valor / maiorCliente) * 100 : 0} cor="#16a34a" className="mt-1.5 h-1" />
                    <p className="mt-0.5 text-[11px] text-slate-400 num">{inteiro(c.qtd)} {c.qtd === 1 ? 'compra' : 'compras'}</p>
                  </div>
                </LinhaV18>
              ))}
            </motion.ul>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </CardV18>

        <CardV18 titulo="Por situação e origem" descricao={faixa} icone={<Layers className="h-4 w-4" />} tom="neutro">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-5">
              {(() => {
                const tot = (data?.porSituacao ?? []).reduce((s, x) => s + x.qtd, 0);
                return (
                  <motion.ul className="space-y-1" variants={listaVariants} initial="oculto" animate="visivel">
                    {(data?.porSituacao ?? []).map((s) => (
                      <LinhaV18 key={s.id} onClick={() => nav(`/vendas?situacoes=${s.id}`)} bloco>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.cor }} />
                          <span className="min-w-0 flex-1 truncate text-slate-700">{s.nome}</span>
                          <span className="num text-slate-500">{inteiro(s.qtd)}</span>
                          {s.valor !== undefined && <span className="num w-24 text-right font-medium">{moeda(s.valor)}</span>}
                        </div>
                        <BarraAnimada pct={tot ? (s.qtd / tot) * 100 : 0} cor={s.cor} className="ml-4 mt-1 h-1" />
                      </LinhaV18>
                    ))}
                    {!data?.porSituacao?.length && <li className="text-xs text-slate-400">Sem dados</li>}
                  </motion.ul>
                );
              })()}
              {data?.porOrigem?.length ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Origem</p>
                  <div className="flex flex-wrap gap-2">
                    {data.porOrigem.map((o, i) => (
                      <motion.span key={o.nome} whileHover={{ y: -2 }} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs shadow-card">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PALETA[i % PALETA.length] }} />
                        <span className="text-slate-600">{o.nome}</span>
                        <span className="num font-semibold text-slate-900">{moeda(o.valor)}</span>
                      </motion.span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardV18>
      </div>
    </PaginaV18>
  );
}
