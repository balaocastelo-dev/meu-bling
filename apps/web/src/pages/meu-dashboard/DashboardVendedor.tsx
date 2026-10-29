/**
 * Meu Dashboard do VENDEDOR — estilo Power BI: as vendas dele no topo, meta e ranking, desafios,
 * alertas com "Corrija" e lembretes; embaixo vendas por dia, últimas vendas e produtos que ele mais vende.
 * Nunca mostra custo, lucro ou margem (a API nem manda).
 */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, Package, Plus, Receipt, ShoppingCart, TrendingUp, Trophy } from 'lucide-react';
import { Button, BadgeCor, EmptyState, Skeleton } from '@/components/ui';
import { Aparecer, CardV18, FaixaKpis, KpiV18, PaginaV18, SecaoDetalhes } from '@/components/dashboard/v18';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import { DesafioCard } from '@/components/compartilhados/DesafioCard';
import { data as fmtData, inteiro, moeda, numero } from '@/lib/format';
import type { MeuDashboard, PainelVendedor } from '@/types';
import { AlertasCorrija, Cabecalho, Lembretes, MetaDoMes, RankingDoMes } from './partes';
import { MensagensCard } from '@/components/chat/MensagensCard';
import SugestoesJarvis from '@/components/dashboard/SugestoesJarvis';

export interface PropsRole {
  dados?: MeuDashboard;
  carregando: boolean;
  faixa: string;
  filtros: ReactNode;
  verComo: ReactNode;
}

/** Faixa dos 6 períodos do painel (Hoje em destaque) */
export function PeriodosRapidos({ periodos }: { periodos?: PainelVendedor['periodos'] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
      {(periodos ?? Array.from({ length: 6 }, () => null)).map((per, i) => (
        <div key={per?.chave ?? i} className={clsx('v18-card v18-hover relative min-w-0 overflow-hidden rounded-2xl border bg-white p-3 pl-4 shadow-card', per?.chave === 'hoje' ? 'border-brand-200 ring-1 ring-brand-100' : 'border-slate-200')}>
          <span aria-hidden className={clsx('absolute inset-y-0 left-0 w-1', per?.chave === 'hoje' ? 'bg-brand-600' : 'bg-slate-300')} />
          {per ? (
            <>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{per.rotulo}</p>
              <p className="mt-1 truncate text-base font-bold leading-tight text-slate-900 num sm:text-lg">{moeda(per.faturamento)}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500 num">
                {inteiro(per.qtd)} {per.qtd === 1 ? 'venda' : 'vendas'} · comissão {moeda(per.comissao)}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-5 w-24" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DashboardVendedor({ dados, carregando, faixa, filtros, verComo }: PropsRole) {
  const nav = useNavigate();
  const v = dados?.vendas ?? null;
  const p = v?.periodo;
  const serie = (v?.serie ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const temSerie = serie.some((s) => s.valor > 0);
  return (
    <PaginaV18 className="space-y-4 pb-6 sm:space-y-5">
      <Cabecalho
        nome={dados?.usuario.nome}
        descricao="Suas vendas, sua meta e seus desafios — e o que falta corrigir."
        acoes={
          <>
            {verComo}
            <Link to="/vendas/nova">
              <Button variante="primario" icone={<Plus className="h-4 w-4" />}>Nova venda</Button>
            </Link>
          </>
        }
      />
      <Aparecer className="flex flex-wrap items-end gap-2">{filtros}</Aparecer>

      {/* ===== topo: as vendas do período ===== */}
      <FaixaKpis colunas={4}>
        <KpiV18 destaque className="col-span-2" rotulo={`Minhas vendas · ${faixa}`} valor={p?.faturamento} anterior={p?.anterior?.faturamento} formato={moeda} icone={<TrendingUp className="h-4 w-4" />} tom="vermelho" carregando={carregando} sub={p ? `${inteiro(p.qtd)} ${p.qtd === 1 ? 'venda' : 'vendas'}${p.anterior ? ` · período anterior ${moeda(p.anterior.faturamento)}` : ' · desde o primeiro registro'}` : undefined} onClick={() => nav('/vendas')} />
        <KpiV18 rotulo="Vendas" valor={p?.qtd} anterior={p?.anterior?.qtd} formato={(n) => inteiro(Math.round(n))} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={carregando} sub="no período" />
        <KpiV18 rotulo="Ticket médio" valor={p?.ticketMedio} formato={moeda} icone={<Receipt className="h-4 w-4" />} tom="neutro" carregando={carregando} sub={p ? `comissão ${moeda(p.comissao)}` : undefined} />
      </FaixaKpis>

      {/* ===== meta e ranking ===== */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <MetaDoMes className="lg:col-span-2" meta={v?.meta} formato={moeda} rotuloMeta="Meta do mês" rotuloAtingido="vendido" carregando={carregando} />
        <RankingDoMes
          carregando={carregando}
          posicao={v?.ranking.posicao}
          total={v?.ranking.total}
          lista={v?.ranking.lista.map((r) => ({ posicao: r.posicao, nome: r.nome, eu: r.eu, valor: r.faturamento }))}
          rodape={v?.ranking.paraPassar && v.ranking.paraPassar.falta > 0 ? `Faltam ${moeda(v.ranking.paraPassar.falta)} para passar ${v.ranking.paraPassar.nome}` : undefined}
        />
      </div>

      {/* ===== desafios ===== */}
      <Aparecer>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Trophy className="h-4 w-4 text-amber-500" /> Desafios</h2>
          {v && v.meta.bonusDesafios > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{moeda(v.meta.bonusDesafios)} em prêmios este mês</span>}
        </div>
        {carregando ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
        ) : v?.desafios.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{v.desafios.map((d) => <DesafioCard key={d.id} d={d} />)}</div>
        ) : (
          <CardV18><EmptyState compacto icone={<Award className="h-5 w-5" />} titulo="Nenhum desafio no momento" descricao="Quando a gestão lançar um desafio, ele aparece aqui valendo prêmio em comissão." /></CardV18>
        )}
      </Aparecer>

      {/* ===== mensagens da equipe (some quando não há nada novo) ===== */}
      <MensagensCard />
      <SugestoesJarvis />

      {/* ===== alertas e lembretes ===== */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <AlertasCorrija alertas={dados?.alertas} carregando={carregando} />
        <Lembretes lembretes={dados?.lembretes} carregando={carregando} usuarioId={dados?.usuario.id} verComo={dados?.verComo} />
      </div>

      <SecaoDetalhes titulo="Detalhes" dica="hoje · semana · mês" />
      <Aparecer><PeriodosRapidos periodos={v?.periodos} /></Aparecer>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <CardV18 className="lg:col-span-2" titulo="Vendas no período" descricao={faixa} icone={<TrendingUp className="h-4 w-4" />} tom="vermelho">
          {carregando ? (
            <Skeleton className="h-52 sm:h-64" />
          ) : !temSerie ? (
            <EmptyState compacto titulo="Sem vendas no período" />
          ) : (
            <div className="h-52 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CORES.grade} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="valor" name="Vendido" fill="#dc2626" radius={[6, 6, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardV18>
        <CardV18 titulo="O que mais vendi" descricao={faixa} icone={<Package className="h-4 w-4" />} tom="azul" semPadding>
          {carregando ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : !v?.topProdutos.length ? (
            <EmptyState compacto titulo="Nenhum produto no período" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {v.topProdutos.map((t, i) => (
                <li key={`${t.produtoId}-${i}`} className="flex items-center gap-3 px-4 py-2 text-sm sm:px-5">
                  <span className="w-5 text-center text-xs font-bold text-slate-400 num">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-800">{t.produtoId ? <Link to={`/produtos/${t.produtoId}`} className="hover:underline">{t.nome}</Link> : t.nome}</span>
                  <span className="shrink-0 text-right text-xs text-slate-500 num">
                    {numero(t.qtd, 0)} un · <span className="font-semibold text-slate-800">{moeda(t.valor)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardV18>
      </div>

      <CardV18 titulo="Últimas vendas" icone={<ShoppingCart className="h-4 w-4" />} semPadding acoes={<Link to="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>}>
        {carregando ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : !v?.ultimasVendas.length ? (
          <EmptyState compacto titulo="Nenhuma venda ainda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead>
                <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Situação</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {v.ultimasVendas.map((x) => (
                  <tr key={x.id}>
                    <td data-rotulo="Nº"><Link to={`/vendas/${x.id}`} className="font-medium text-brand-600 hover:underline">{x.numero}</Link></td>
                    <td className="whitespace-nowrap text-slate-500" data-rotulo="Data">{fmtData(x.data)}</td>
                    <td className="max-w-[16rem] truncate" data-rotulo="Cliente">{x.contato?.nome}</td>
                    <td data-rotulo="Situação"><BadgeCor cor={x.situacao.cor}>{x.situacao.nome}</BadgeCor></td>
                    <td className="whitespace-nowrap text-right num" data-rotulo="Total">{moeda(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardV18>
      <p className="text-center text-[11px] text-slate-400">Contam todas as vendas assim que são salvas (em aberto, fechadas, com NF). Cancelada sai da conta; orçamento não conta.</p>
    </PaginaV18>
  );
}
