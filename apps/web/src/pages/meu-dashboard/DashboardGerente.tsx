/**
 * Meu Dashboard da GERENTE (e do financeiro) — estilo Power BI: saldo em bancos + caixa e o que vence hoje
 * no topo, receita (vendas + assistência) e entradas/saídas do período, caixinhas e avisos, alertas da loja
 * com "Corrija", lembretes (os dela e os que manda para a equipe), a equipe contra as metas e os desafios;
 * embaixo receita por dia, vendas por vendedor e os últimos acontecimentos.
 * Sem lucro, margem ou DRE (decisão do Thiago, 29/10/2026) — isso fica só no dashboard do gestor.
 */
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, ChevronRight, Clock, HardHat, History, Info, Landmark, PiggyBank, ShoppingCart, TrendingUp, TriangleAlert, Trophy, Users, Wallet, Wrench } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui';
import { Aparecer, Avatar, BarraAnimada, CardV18, FaixaKpis, KpiV18, LinhaV18, PaginaV18, SaldosContas, SecaoDetalhes, listaVariants } from '@/components/dashboard/v18';
import { BlocosAlerta } from '@/components/dashboard/BlocosAlerta';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import { textoAlvo } from '@/components/compartilhados/DesafioCard';
import { data as fmtData, inteiro, moeda, numero } from '@/lib/format';
import { quandoRelativo } from '@/pages/dashboard/UltimasAtividades';
import { LembretesParaVoce } from '@/components/compartilhados/Lembretes';
import type { BlocoGerenteDashboard } from '@/types';
import { AlertasCorrija, Cabecalho, Lembretes } from './partes';
import { MensagensCard } from '@/components/chat/MensagensCard';
import SugestoesJarvis from '@/components/dashboard/SugestoesJarvis';
import type { PropsRole } from './DashboardVendedor';

const ATALHOS = [
  { para: '/vendas', rotulo: 'Pedidos de venda', icone: ShoppingCart },
  { para: '/ordens-servico', rotulo: 'Ordens de serviço', icone: Wrench },
  { para: '/financeiro/pagar', rotulo: 'Contas a pagar', icone: Banknote },
  { para: '/financeiro/receber', rotulo: 'Contas a receber', icone: Wallet },
  { para: '/financeiro/caixinhas', rotulo: 'Caixinhas', icone: PiggyBank },
  { para: '/metas-desafios', rotulo: 'Metas e desafios', icone: Trophy },
];

const TOM_ACONT: Record<string, string> = { verde: 'bg-emerald-500', vermelho: 'bg-red-500', azul: 'bg-blue-500', amarelo: 'bg-amber-500', neutro: 'bg-slate-300' };

/** Caixinhas no prazo (prioridade) e contas vencidas/de hoje — os avisos do gestor e da gerente */
function AvisosGestao({ g, carregando }: { g?: BlocoGerenteDashboard; carregando?: boolean }) {
  const icone = (t: string) => (t === 'erro' ? <AlertOctagon className="h-4 w-4 text-red-600" /> : t === 'aviso' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <Info className="h-4 w-4 text-sky-600" />);
  const caixinhas = g?.caixinhas.lista.filter((c) => c.situacao !== 'COMPLETA') ?? [];
  return (
    <CardV18
      titulo="Avisos importantes"
      descricao={carregando ? '…' : g && g.caixinhas.sugestaoHojeTotal > 0 ? `Hoje: guardar ${moeda(g.caixinhas.sugestaoHojeTotal)} nas caixinhas` : 'O que precisa de atenção hoje'}
      icone={<PiggyBank className="h-4 w-4" />}
      tom={g?.avisos.some((a) => a.tipo === 'erro') ? 'vermelho' : g?.avisos.length ? 'amarelo' : 'verde'}
      semPadding
      acoes={<Link to="/financeiro/caixinhas" className="text-xs font-medium text-brand-600 hover:underline">Caixinhas</Link>}
    >
      {carregando ? (
        <div className="p-4"><Skeleton className="h-20" /></div>
      ) : (
        <>
          {caixinhas.length > 0 && (
            <ul className="divide-y divide-slate-100 border-b border-slate-100">
              {caixinhas.slice(0, 4).map((c) => (
                <li key={c.id} className="px-4 py-2 sm:px-5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-slate-700">{c.nome}</span>
                    <span className="num shrink-0 text-slate-500">{moeda(c.saldo)} de {moeda(c.valorMeta)} · {c.diasRestantes === 0 ? 'uso hoje' : c.diasRestantes < 0 ? 'atrasada' : `${c.diasRestantes} d`}</span>
                  </div>
                  <BarraAnimada pct={c.pct} cor={c.situacao === 'VENCIDA' || c.situacao === 'ATRASADA' ? '#dc2626' : '#16a34a'} className="mt-1 h-1.5" />
                </li>
              ))}
            </ul>
          )}
          {g?.avisos.length ? (
            <BlocosAlerta alertas={g.avisos} className="px-4 pb-4 pt-3 sm:px-5" />
          ) : (
            <p className="px-4 py-3 text-sm text-emerald-700 sm:px-5">Tudo em dia. Caixinhas no prazo e nenhuma conta vencida.</p>
          )}
        </>
      )}
    </CardV18>
  );
}

/** Equipe contra a meta do mês (vendedores em R$ vendido; técnicos em R$ de OS ou nº de OS) */
function Equipe({ g, carregando }: { g?: BlocoGerenteDashboard; carregando?: boolean }) {
  const nav = useNavigate();
  const barra = (pct: number) => (pct >= 100 ? '#16a34a' : pct >= 70 ? '#f59e0b' : '#dc2626');
  return (
    <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
      <CardV18 titulo="Vendedores × meta do mês" icone={<Users className="h-4 w-4" />} tom="vermelho" semPadding acoes={<Link to="/metas-desafios?aba=metas" className="text-xs font-medium text-brand-600 hover:underline">Definir metas</Link>}>
        {carregando ? (
          <div className="p-4"><Skeleton className="h-32" /></div>
        ) : !g?.equipe.vendedores.length ? (
          <EmptyState compacto titulo="Nenhum vendedor ativo" />
        ) : (
          <motion.ul className="px-2 pb-2 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
            {g.equipe.vendedores.map((v, i) => (
              <LinhaV18 key={v.id} onClick={() => nav(`/meu-painel?vendedorId=${v.id}`)}>
                <Avatar nome={v.nome} indice={i} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{v.nome}</span>
                    <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(v.vendido)}</span>
                  </div>
                  <BarraAnimada pct={v.meta ? Math.min(100, v.pct) : 0} cor={v.meta ? barra(v.pct) : '#cbd5e1'} className="mt-1.5 h-1.5" />
                  <p className="mt-1 text-[11px] text-slate-400 num">{v.meta ? `${numero(v.pct, 0)}% da meta de ${moeda(v.meta)}` : 'sem meta'} · {inteiro(v.qtd)} {v.qtd === 1 ? 'venda' : 'vendas'}</p>
                </div>
              </LinhaV18>
            ))}
          </motion.ul>
        )}
      </CardV18>
      <CardV18 titulo="Técnicos × meta do mês" icone={<HardHat className="h-4 w-4" />} tom="azul" semPadding acoes={<Link to="/metas-desafios?aba=metas" className="text-xs font-medium text-brand-600 hover:underline">Definir metas</Link>}>
        {carregando ? (
          <div className="p-4"><Skeleton className="h-32" /></div>
        ) : !g?.equipe.tecnicos.length ? (
          <EmptyState compacto titulo="Nenhum técnico ativo" />
        ) : (
          <motion.ul className="px-2 pb-2 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
            {g.equipe.tecnicos.map((t, i) => (
              <LinhaV18 key={t.id} onClick={() => nav(`/ordens-servico?tecnicoId=${t.id}`)}>
                <Avatar nome={t.nome} indice={i + 3} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{t.nome}</span>
                    <span className="num shrink-0 text-sm font-semibold text-slate-900">{t.tipo === 'QTD_OS' ? `${inteiro(t.osConcluidas)} OS` : moeda(t.valorServicos)}</span>
                  </div>
                  <BarraAnimada pct={t.meta ? Math.min(100, t.pct) : 0} cor={t.meta ? barra(t.pct) : '#cbd5e1'} className="mt-1.5 h-1.5" />
                  <p className="mt-1 text-[11px] text-slate-400 num">
                    {t.meta ? `${numero(t.pct, 0)}% da meta de ${t.tipo === 'QTD_OS' ? `${inteiro(t.meta)} OS` : moeda(t.meta)}` : 'sem meta'} · {inteiro(t.osConcluidas)} OS · {moeda(t.valorServicos)}
                  </p>
                </div>
              </LinhaV18>
            ))}
          </motion.ul>
        )}
      </CardV18>
    </div>
  );
}

export default function DashboardGerente({ dados, carregando, faixa, filtros, verComo }: PropsRole) {
  const nav = useNavigate();
  const g = dados?.gerente;
  const f = g?.financeiro;
  const p = g?.periodo;
  const serie = (g?.serie ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const temReceita = serie.some((s) => s.vendas > 0 || s.assistencia > 0);
  const temCaixa = serie.some((s) => s.entradas > 0 || s.saidas > 0);
  const lider = g?.porVendedor[0]?.valor ?? 0;
  return (
    <PaginaV18 className="space-y-4 pb-6 sm:space-y-5">
      <Cabecalho nome={dados?.usuario.nome} descricao="O que precisa de atenção hoje, a receita da loja e a equipe contra as metas." acoes={verComo} />
      <Aparecer className="flex flex-wrap items-end gap-2">{filtros}</Aparecer>

      {/* ===== topo: saldo e o que vence hoje ===== */}
      <FaixaKpis colunas={4}>
        <KpiV18 destaque className="col-span-2" rotulo="Saldo em bancos + caixa" valor={f?.saldoTotal} formato={moeda} icone={<Landmark className="h-4 w-4" />} tom="verde" carregando={carregando} sub="agora, somando todas as contas" onClick={() => nav('/financeiro/bancos')} />
        <KpiV18 rotulo="A receber hoje" valor={f?.receberHoje} formato={moeda} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={carregando} sub={f ? `na semana ${moeda(f.receberSemana)}` : undefined} onClick={() => nav('/financeiro/receber')} />
        <KpiV18 rotulo="A pagar hoje" valor={f?.pagarHoje} formato={moeda} icone={<Banknote className="h-4 w-4" />} tom="amarelo" carregando={carregando} sub={f ? `na semana ${moeda(f.pagarSemana)}` : undefined} onClick={() => nav('/financeiro/pagar')} />
      </FaixaKpis>
      <SaldosContas contas={f?.saldoContas} carregando={carregando} formato={moeda} onClick={(id) => nav(`/financeiro/bancos/${id}`)} />

      {/* ===== receita e caixa do período ===== */}
      <FaixaKpis colunas={6}>
        <KpiV18 destaque className="col-span-2" rotulo={`Receita · ${faixa}`} valor={p?.receita} anterior={p?.anterior?.receita} formato={moeda} icone={<TrendingUp className="h-4 w-4" />} tom="vermelho" carregando={carregando} sub={p ? `vendas ${moeda(p.vendas.valor)} + assistência ${moeda(p.assistencia.valor)}` : 'vendas + assistência'} />
        <KpiV18 rotulo="Vendas" valor={p?.vendas.valor} anterior={p?.anterior?.vendas} formato={moeda} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={carregando} sub={p ? `${inteiro(p.vendas.qtd)} ${p.vendas.qtd === 1 ? 'venda' : 'vendas'}` : undefined} onClick={() => nav('/vendas')} />
        <KpiV18 rotulo="Assistência" valor={p?.assistencia.valor} anterior={p?.anterior?.assistencia} formato={moeda} icone={<Wrench className="h-4 w-4" />} tom="vermelho" carregando={carregando} sub={p ? `${inteiro(p.assistencia.qtd)} OS concluídas` : undefined} onClick={() => nav('/ordens-servico')} />
        <KpiV18 rotulo="Entradas" valor={p?.entradas} formato={moeda} icone={<ArrowUpRight className="h-4 w-4" />} tom="verde" carregando={carregando} sub="dinheiro que entrou" onClick={() => nav('/financeiro/fluxo-caixa')} />
        <KpiV18 rotulo="Saídas" valor={p?.saidas} formato={moeda} icone={<ArrowDownRight className="h-4 w-4" />} tom="amarelo" carregando={carregando} sub="dinheiro que saiu" onClick={() => nav('/financeiro/fluxo-caixa')} />
      </FaixaKpis>
      <FaixaKpis colunas={4}>
        <KpiV18 rotulo="Receber atrasado" valor={f?.receberAtrasado} formato={moeda} icone={<TriangleAlert className="h-4 w-4" />} tom={f && f.receberAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={carregando} onClick={() => nav('/financeiro/receber?situacao=ATRASADO')} />
        <KpiV18 rotulo="Pagar atrasado" valor={f?.pagarAtrasado} formato={moeda} icone={<Wallet className="h-4 w-4" />} tom={f && f.pagarAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={carregando} onClick={() => nav('/financeiro/pagar?situacao=ATRASADO')} />
      </FaixaKpis>

      {/* ===== avisos, alertas e lembretes ===== */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <AvisosGestao g={g} carregando={carregando} />
        <Lembretes lembretes={dados?.lembretes} carregando={carregando} usuarioId={dados?.usuario.id} verComo={dados?.verComo} />
      </div>
      <MensagensCard />
      <SugestoesJarvis />
      <AlertasCorrija alertas={dados?.alertas} carregando={carregando} titulo="Alertas do sistema (loja inteira)" />
      {/* lembretes do Robô da Saúde para a equipe (quem precisa preencher custo de peça/produto) — some quando não há nada */}
      {!dados?.verComo && <Aparecer><LembretesParaVoce /></Aparecer>}

      {/* ===== equipe e desafios ===== */}
      <SecaoDetalhes titulo="Equipe" dica={g ? `metas de ${g.equipe.competencia.split('-').reverse().join('/')}` : undefined} />
      <Equipe g={g} carregando={carregando} />
      <CardV18 titulo="Desafios em andamento" icone={<Trophy className="h-4 w-4" />} tom="amarelo" semPadding acoes={<Link to="/metas-desafios" className="text-xs font-medium text-brand-600 hover:underline">Lançar desafio</Link>}>
        {carregando ? (
          <div className="p-4"><Skeleton className="h-16" /></div>
        ) : !g?.desafios.length ? (
          <EmptyState compacto titulo="Nenhum desafio em andamento" descricao="Lance um desafio para vendedores ou técnicos valendo prêmio em comissão." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {g.desafios.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', d.publico === 'TECNICOS' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700')}>{d.publico === 'TECNICOS' ? 'Técnicos' : 'Vendedores'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-800">{d.titulo}</p>
                  <p className="truncate text-xs text-slate-500">{textoAlvo(d)} · até {fmtData(d.fim)}{d.conquistados.length ? ` · já bateu: ${d.conquistados.join(', ')}` : ''}</p>
                </div>
                <span className="num shrink-0 font-bold text-amber-600">+{moeda(d.premio)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardV18>

      {/* ===== detalhes ===== */}
      <SecaoDetalhes titulo="Detalhes" dica={faixa} />
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <CardV18 className="lg:col-span-2" titulo="Receita por dia" descricao="vendas e assistência" icone={<TrendingUp className="h-4 w-4" />} tom="vermelho">
          {carregando ? (
            <Skeleton className="h-52 sm:h-64" />
          ) : !temReceita ? (
            <EmptyState compacto titulo="Sem receita no período" />
          ) : (
            <div className="h-52 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CORES.grade} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="vendas" name="Vendas" stackId="r" fill={CORES.receita} maxBarSize={56} />
                  <Bar dataKey="assistencia" name="Assistência" stackId="r" fill="#dc2626" radius={[6, 6, 0, 0]} maxBarSize={56} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardV18>
        <CardV18 titulo="Vendas por vendedor" descricao={faixa} icone={<Users className="h-4 w-4" />} tom="azul" semPadding>
          {carregando ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : !g?.porVendedor.length ? (
            <EmptyState compacto titulo="Sem vendas no período" />
          ) : (
            <motion.ul className="px-2 pb-2 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {g.porVendedor.map((v, i) => (
                <LinhaV18 key={v.id ?? `sem-${i}`}>
                  <Avatar nome={v.nome} indice={i} className="h-7 w-7" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-slate-800">{v.nome}</span>
                      <span className="num shrink-0 text-xs font-semibold text-slate-900">{moeda(v.valor)}</span>
                    </div>
                    <BarraAnimada pct={lider ? (v.valor / lider) * 100 : 0} cor={i === 0 ? '#dc2626' : '#cbd5e1'} className="mt-1 h-1" />
                  </div>
                </LinhaV18>
              ))}
            </motion.ul>
          )}
        </CardV18>
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <CardV18 className="lg:col-span-2" titulo="Entradas e saídas" descricao="banco + caixa, por dia" icone={<Landmark className="h-4 w-4" />} tom="verde">
          {carregando ? (
            <Skeleton className="h-52 sm:h-64" />
          ) : !temCaixa ? (
            <EmptyState compacto titulo="Nenhum movimento no período" />
          ) : (
            <div className="h-52 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CORES.grade} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<TooltipPadrao />} cursor={{ fill: '#f1f5f9' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="entradas" name="Entradas" fill={CORES.entrada} radius={[6, 6, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="saidas" name="Saídas" fill={CORES.saida} radius={[6, 6, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardV18>
        <CardV18 titulo="Últimos acontecimentos" icone={<History className="h-4 w-4" />} tom="neutro" semPadding>
          {carregando ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : !g?.acontecimentos.length ? (
            <EmptyState compacto titulo="Nada registrado ainda" />
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {g.acontecimentos.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5 px-4 py-2 text-xs sm:px-5">
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', TOM_ACONT[a.tom] ?? TOM_ACONT.neutro)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-800">{a.link ? <Link to={a.link} className="hover:underline">{a.texto}</Link> : a.texto}</p>
                    <p className="text-[11px] text-slate-400">{a.usuario} · {quandoRelativo(a.quando)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardV18>
      </div>

      <SecaoDetalhes titulo="Atalhos" />
      <Aparecer className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-6">
        {ATALHOS.map((a) => (
          <Link key={a.para} to={a.para} className="v18-card v18-hover flex min-h-[52px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm font-medium text-slate-800 shadow-card sm:p-4">
            <a.icone className="h-5 w-5 shrink-0 text-brand-600" /> <span className="min-w-0 truncate">{a.rotulo}</span>
          </Link>
        ))}
      </Aparecer>
    </PaginaV18>
  );
}
