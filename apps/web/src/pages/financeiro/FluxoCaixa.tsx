/**
 * FLUXO DE CAIXA — painel ao vivo (estilo BI): saldo hoje, entradas × saídas, saldo acumulado + projeção,
 * de onde vem e para onde vai o dinheiro, saldo por conta, últimos lançamentos e próximos vencimentos.
 * Atualiza sozinho a cada 30 s. Transferências entre contas e acertos de saldo não contam como entrada/saída.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Landmark, Radio, Scale, TrendingUp, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { intervaloPeriodo } from '@/lib/periodo';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { EmptyState, PeriodoFiltro, SelectFiltro, Skeleton } from '@/components/ui';
import { Aparecer, BarraAnimada, CabecalhoV18, CardV18, Grupo, KpiV18, PaginaV18 } from '@/components/dashboard/v18';
import { data as fmtData, dataHora, moeda } from '@/lib/format';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';

interface Linha { nome: string; valor: number }
interface Dados {
  saldoInicial: number;
  series: { periodo: string; entradas: number; saidas: number; ajustes: number; saldo: number }[];
  realizado: { entradas: number; saidas: number; ajustes: number; saldoFinal: number };
  previsto: { periodo: string; receber: number; pagar: number; saldoProjetado: number }[];
  quebras: { entradasPorCategoria: Linha[]; saidasPorCategoria: Linha[]; entradasPorOrigem: Linha[]; saidasPorOrigem: Linha[] };
  saldoAgora: number;
  contas: { id: number; nome: string; cor: string | null; saldoAtual: number }[];
  ultimos: { id: number; data: string; criadoEm: string; tipo: 'ENTRADA' | 'SAIDA'; valor: number; descricao: string; conta: { id: number; nome: string; cor: string | null }; foraDoResultado: boolean }[];
  proximos: {
    receber: { id: number; descricao: string; contato: string | null; vencimento: string; valor: number; atrasada: boolean }[];
    pagar: { id: number; descricao: string; contato: string | null; vencimento: string; valor: number; atrasada: boolean }[];
  };
  atualizadoEm: string;
}

/** moeda sem quebrar a linha no sinal de menos */
const moedaKpi = (n: number) => moeda(n).replace('-', '\u2212\u2060').replace(/\s/g, '\u00a0');

const COR_CONTA = ['#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#0ea5e9', '#64748b', '#ec4899'];

/** Barras horizontais com o maior valor = 100% */
function Ranking({ itens, cor, vazio }: { itens: Linha[]; cor: string; vazio: string }) {
  if (!itens.length) return <p className="py-4 text-center text-xs text-slate-400">{vazio}</p>;
  const max = Math.max(...itens.map((i) => i.valor), 1);
  const total = itens.reduce((s, i) => s + i.valor, 0);
  return (
    <ul className="space-y-2.5">
      {itens.map((i) => (
        <li key={i.nome}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-slate-700">{i.nome}</span>
            <span className="num shrink-0 font-semibold text-slate-900">
              {moeda(i.valor)} <span className="font-normal text-slate-400">{total ? Math.round((i.valor / total) * 100) : 0}%</span>
            </span>
          </div>
          <BarraAnimada pct={(i.valor / max) * 100} cor={cor} />
        </li>
      ))}
    </ul>
  );
}

export default function FluxoCaixa() {
  const nav = useNavigate();
  const [periodo, setPeriodo] = useState(() => { const r = intervaloPeriodo('mes'); return { i: r.dataInicial, f: r.dataFinal }; });
  const [agrupar, setAgrupar] = useState<'dia' | 'semana' | 'mes'>('dia');
  const [contaId, setContaId] = useState('');
  const { data: contasLista } = useContasFinanceiras();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fluxo-caixa', periodo, agrupar, contaId],
    queryFn: () => api.get<Dados>('/financeiro/fluxo-caixa', { dataInicial: periodo.i, dataFinal: periodo.f, agrupar, contaFinanceiraId: contaId }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const series = (data?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo), resultado: s.entradas - s.saidas }));
  const r = data?.realizado;
  const resultado = r ? r.entradas - r.saidas : 0;
  const hojeIso = format(new Date(), 'yyyy-MM-dd');
  const futuro = (data?.previsto ?? []).filter((p) => p.periodo >= hojeIso.slice(0, p.periodo.length));
  const aReceber = futuro.reduce((s, p) => s + p.receber, 0);
  const aPagar = futuro.reduce((s, p) => s + p.pagar, 0);
  const projetadoFim = (data?.saldoAgora ?? 0) + aReceber - aPagar;
  // saldo realizado até hoje + projeção (receber − pagar) depois de hoje, na mesma linha do tempo
  const linhaSaldo = (() => {
    if (!data) return [];
    let proj = data.saldoAgora;
    const prevMap = new Map(data.previsto.map((p) => [p.periodo, p]));
    return data.series.map((s) => {
      const passado = s.periodo <= hojeIso.slice(0, s.periodo.length);
      if (!passado) {
        const p = prevMap.get(s.periodo);
        proj += (p?.receber ?? 0) - (p?.pagar ?? 0);
      }
      return { rotulo: rotuloPeriodo(s.periodo), saldo: passado ? s.saldo : null, projetado: passado ? (s.periodo === hojeIso.slice(0, s.periodo.length) ? s.saldo : null) : Math.round(proj * 100) / 100 };
    });
  })();
  const contas = (data?.contas ?? []).filter((c) => c.saldoAtual > 0.009);
  const totalContas = contas.reduce((s, c) => s + c.saldoAtual, 0);

  return (
    <PaginaV18 className="space-y-4">
      <CabecalhoV18
        titulo="Fluxo de caixa"
        descricao={
          <span className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className={clsx('absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75', isFetching ? 'animate-ping' : '')} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Ao vivo · atualiza a cada 30 s{data ? ` · ${dataHora(data.atualizadoEm)}` : ''}
          </span>
        }
        filtros={
          <>
            <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} label="" limpavel={false} />
            <SelectFiltro valor={agrupar} onChange={(v) => setAgrupar(v as typeof agrupar)} placeholder="" opcoes={[{ valor: 'dia', rotulo: 'Por dia' }, { valor: 'semana', rotulo: 'Por semana' }, { valor: 'mes', rotulo: 'Por mês' }]} />
            <SelectFiltro valor={contaId} onChange={setContaId} opcoes={opcoesDe(contasLista)} placeholder="Todas as contas" />
          </>
        }
      />

      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiV18 rotulo="Saldo hoje" valor={data?.saldoAgora} formato={moedaKpi} icone={<Wallet className="h-4 w-4" />} tom="azul" carregando={isLoading} sub="todas as contas, agora" onClick={() => nav('/financeiro/bancos')} />
        <KpiV18 rotulo="Entrou no período" valor={r?.entradas} formato={moedaKpi} icone={<ArrowDownRight className="h-4 w-4" />} tom="verde" carregando={isLoading} />
        <KpiV18 rotulo="Saiu no período" valor={r?.saidas} formato={moedaKpi} icone={<ArrowUpRight className="h-4 w-4" />} tom="vermelho" carregando={isLoading} />
        <KpiV18 rotulo="Resultado do período" valor={resultado} formato={moedaKpi} icone={<Scale className="h-4 w-4" />} tom={resultado < 0 ? 'vermelho' : 'verde'} carregando={isLoading} sub="entrou − saiu" />
        <KpiV18 rotulo="A receber × a pagar" valor={aReceber - aPagar} formato={moedaKpi} icone={<CalendarClock className="h-4 w-4" />} tom="amarelo" carregando={isLoading} sub={`${moeda(aReceber)} / ${moeda(aPagar)}`} />
        <KpiV18 rotulo="Saldo projetado" valor={projetadoFim} formato={moedaKpi} icone={<TrendingUp className="h-4 w-4" />} tom={projetadoFim < 0 ? 'vermelho' : 'neutro'} carregando={isLoading} sub="no fim do período" />
      </Grupo>

      <Grupo className="grid gap-4 xl:grid-cols-3">
        <CardV18 className="xl:col-span-2" titulo="Saldo acumulado" descricao="linha cheia = realizado · tracejada = projeção pelas contas a receber/pagar" icone={<TrendingUp className="h-4 w-4" />} tom="azul">
          {isLoading ? (
            <Skeleton className="h-72" />
          ) : linhaSaldo.length ? (
            <div className="h-72">
              <ResponsiveContainer>
                <AreaChart data={linhaSaldo} margin={{ left: 0, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gSaldo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CORES.receita} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={CORES.receita} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={CORES.grade} vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={16} />
                  <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={64} />
                  <Tooltip content={<TooltipPadrao />} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Area type="monotone" dataKey="saldo" name="Saldo" stroke={CORES.receita} strokeWidth={2} fill="url(#gSaldo)" connectNulls={false} animationDuration={900} />
                  <Area type="monotone" dataKey="projetado" name="Projeção" stroke={CORES.receita} strokeWidth={2} strokeDasharray="5 4" fill="none" connectNulls animationDuration={1100} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem movimentos no período" />
          )}
        </CardV18>

        <CardV18 titulo="Onde está o dinheiro" descricao={`saldo por conta · ${moeda(totalContas)}`} icone={<Landmark className="h-4 w-4" />}>
          {contas.length ? (
            <>
              <div className="relative h-40">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={contas} dataKey="saldoAtual" nameKey="nome" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="#fff" strokeWidth={2} animationDuration={900}>
                      {contas.map((c, i) => <Cell key={c.id} fill={c.cor || COR_CONTA[i % COR_CONTA.length]} />)}
                    </Pie>
                    <Tooltip content={<TooltipPadrao />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 space-y-1.5">
                {contas.map((c, i) => (
                  <li key={c.id}>
                    <Link to={`/financeiro/bancos/${c.id}`} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-slate-50">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.cor || COR_CONTA[i % COR_CONTA.length] }} />
                      <span className="flex-1 truncate text-slate-700">{c.nome}</span>
                      <span className="num font-semibold text-slate-900">{moeda(c.saldoAtual)}</span>
                      <span className="w-9 text-right text-slate-400">{totalContas ? Math.round((c.saldoAtual / totalContas) * 100) : 0}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="py-6 text-center text-xs text-slate-400">Nenhuma conta com saldo.</p>
          )}
        </CardV18>
      </Grupo>

      <Grupo className="grid gap-4 xl:grid-cols-3">
        <CardV18 className="xl:col-span-2" titulo="Entradas × saídas" descricao="dinheiro que entrou e saiu da loja (sem transferências entre contas)" icone={<Scale className="h-4 w-4" />}>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : series.some((s) => s.entradas || s.saidas) ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }} barGap={2}>
                  <CartesianGrid stroke={CORES.grade} vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
                  <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={64} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="entradas" name="Entrou" fill={CORES.entrada} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} />
                  <Bar dataKey="saidas" name="Saiu" fill={CORES.saida} radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={1100} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState compacto titulo="Nenhuma entrada ou saída no período" />
          )}
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES.entrada }} /> Entrou</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES.saida }} /> Saiu</span>
            {r && Math.abs(r.ajustes) > 0.009 && <span>Transferências/acertos no período (só mexem no saldo): {moeda(r.ajustes)}</span>}
          </div>
        </CardV18>

        <CardV18 titulo="Últimos lançamentos" descricao="ao vivo" icone={<Radio className="h-4 w-4" />} tom="verde" semPadding>
          {data?.ultimos.length ? (
            <ul className="max-h-[340px] divide-y divide-slate-100 overflow-auto">
              {data.ultimos.map((u) => (
                <li key={u.id} className="flex items-start gap-2.5 px-4 py-2">
                  <span className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', u.foraDoResultado ? 'bg-slate-100 text-slate-500' : u.tipo === 'ENTRADA' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600')}>
                    {u.tipo === 'ENTRADA' ? <ArrowDownRight className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-slate-800">{u.descricao}</p>
                    <p className="truncate text-[11px] text-slate-400">{u.conta.nome} · {dataHora(u.criadoEm)}</p>
                  </div>
                  <span className={clsx('num shrink-0 text-xs font-semibold', u.foraDoResultado ? 'text-slate-500' : u.tipo === 'ENTRADA' ? 'text-emerald-700' : 'text-red-600')}>
                    {u.tipo === 'ENTRADA' ? '+' : '−'}{moeda(u.valor)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Sem lançamentos no período.</p>
          )}
        </CardV18>
      </Grupo>

      <Grupo className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <CardV18 titulo="De onde veio" descricao="entradas por origem" tom="verde" icone={<ArrowDownRight className="h-4 w-4" />}>
          <Ranking itens={data?.quebras.entradasPorOrigem ?? []} cor={CORES.entrada} vazio="Sem entradas." />
        </CardV18>
        <CardV18 titulo="Para onde foi" descricao="saídas por destino" tom="vermelho" icone={<ArrowUpRight className="h-4 w-4" />}>
          <Ranking itens={data?.quebras.saidasPorOrigem ?? []} cor={CORES.saida} vazio="Sem saídas." />
        </CardV18>
        <CardV18 titulo="Entradas por categoria" tom="verde">
          <Ranking itens={data?.quebras.entradasPorCategoria ?? []} cor={CORES.entrada} vazio="Sem entradas." />
        </CardV18>
        <CardV18 titulo="Saídas por categoria" tom="vermelho">
          <Ranking itens={data?.quebras.saidasPorCategoria ?? []} cor={CORES.saida} vazio="Sem saídas." />
        </CardV18>
      </Grupo>

      <Grupo className="grid gap-4 md:grid-cols-2">
        {(['receber', 'pagar'] as const).map((tipo) => {
          const lista = data?.proximos[tipo] ?? [];
          const total = lista.reduce((s, c) => s + c.valor, 0);
          return (
            <CardV18
              key={tipo}
              titulo={tipo === 'receber' ? 'A receber · próximos 7 dias' : 'A pagar · próximos 7 dias'}
              descricao={`${lista.length} título${lista.length === 1 ? '' : 's'} · ${moeda(total)} (inclui atrasados)`}
              icone={<CalendarClock className="h-4 w-4" />}
              tom={tipo === 'receber' ? 'verde' : 'vermelho'}
              acoes={<Link to={tipo === 'receber' ? '/financeiro/receber' : '/financeiro/pagar'} className="text-xs font-medium text-brand-700 hover:underline">ver todos</Link>}
              semPadding
            >
              {lista.length ? (
                <ul className="max-h-72 divide-y divide-slate-100 overflow-auto">
                  {lista.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                      <span className={clsx('w-12 shrink-0 font-medium', c.atrasada ? 'text-red-600' : 'text-slate-500')}>{fmtData(c.vencimento).slice(0, 5)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-slate-800">{c.descricao}</p>
                        {c.contato && <p className="truncate text-[11px] text-slate-400">{c.contato}</p>}
                      </div>
                      {c.atrasada && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">atrasada</span>}
                      <span className="num shrink-0 font-semibold text-slate-900">{moeda(c.valor)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-slate-400">Nada {tipo === 'receber' ? 'a receber' : 'a pagar'} nos próximos 7 dias.</p>
              )}
            </CardV18>
          );
        })}
      </Grupo>

      <Aparecer>
        <CardV18 titulo="Detalhamento" descricao="só os períodos com movimento" semPadding>
          {series.length ? (
            <div className="max-h-[420px] overflow-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Período</th><th className="text-right">Entrou</th><th className="text-right">Saiu</th><th className="text-right">Resultado</th><th className="text-right">Transf./acertos</th><th className="text-right">Saldo</th></tr></thead>
                <tbody>
                  {series.filter((s) => s.entradas || s.saidas || s.ajustes).map((s) => (
                    <tr key={s.periodo}>
                      <td data-rotulo="Período">{s.rotulo}</td>
                      <td data-rotulo="Entrou" className="num text-right text-emerald-700">{moeda(s.entradas)}</td>
                      <td data-rotulo="Saiu" className="num text-right text-red-600">{moeda(s.saidas)}</td>
                      <td data-rotulo="Resultado" className={clsx('num text-right font-medium', s.resultado < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(s.resultado)}</td>
                      <td data-rotulo="Transf./acertos" className="num text-right text-slate-500">{Math.abs(s.ajustes) > 0.009 ? moeda(s.ajustes) : '—'}</td>
                      <td data-rotulo="Saldo" className={clsx('num text-right font-semibold', s.saldo < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(s.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Sem dados no período.</p>
          )}
        </CardV18>
      </Aparecer>
    </PaginaV18>
  );
}
