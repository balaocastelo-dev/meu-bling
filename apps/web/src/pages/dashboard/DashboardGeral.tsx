import { useQuery } from '@tanstack/react-query';
import { MensagensCard } from '@/components/chat/MensagensCard';
import SugestoesJarvis from '@/components/dashboard/SugestoesJarvis';
import { BlocosAlerta } from '@/components/dashboard/BlocosAlerta';
import { CardRoboSaude } from '@/components/compartilhados/RoboSaude';
import { Link, useNavigate } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import clsx from 'clsx';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertCircle, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BadgePercent, BarChart3, Boxes, CheckCircle2, ChevronRight, CircleDollarSign, Clock, Crown, FileText, FileWarning, Inbox,
  HardHat, Landmark, ListChecks, MessageCircle, Package, PieChart as PieIcon, Receipt, ShoppingCart, Sparkles, TrendingUp, TriangleAlert, Trophy, Wallet, Wrench,
} from 'lucide-react';
import { api, rotaIndisponivel } from '@/lib/api';
import { Badge, EmptyState, Skeleton, tomPorStatus } from '@/components/ui';
import { inteiro, moeda, numero, percentual, rotulo } from '@/lib/format';
import { Aparecer, Avatar, BarraAnimada, CardV18, FaixaKpis, KpiV18, LinhaV18, PaginaV18, SaldosContas, SecaoDetalhes, SegmentadoV18, TONS, listaVariants, type Tom } from '@/components/dashboard/v18';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { CardAnunciosEquipe } from '@/components/dashboard/CardAnunciosEquipe';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import { useAuth } from '@/stores/auth';
import type { DashboardGeral as Dados, DashboardPanorama, StatusSefaz } from '@/types';
import { UltimosAcontecimentos } from './UltimasAtividades';
import { useState } from 'react';

/** cada bloco entra subindo, em cascata */
const entradaBloco: Variants = {
  oculto: { opacity: 0, y: 14 },
  visivel: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

const COR_VENDAS = CORES.receita; // azul
const COR_ASSIST = '#dc2626'; // vermelho da marca
const COR_LUCRO = CORES.lucro; // verde

/**
 * Distribuição por situação em BLOCOS (estilo Power BI) — Thiago, 29/10/2026.
 * Cada situação vira um bloco com o número grande, o percentual e a barra de proporção.
 * As situações zeradas ficam apagadas (sem clique), mas seguem na ordem do fluxo de trabalho.
 */
function BlocosSituacao({ itens, total, onClick }: { itens: { id: number; nome: string; cor: string; qtd: number }[]; total: number; onClick?: (id: number) => void }) {
  if (!itens.length) return <EmptyState compacto titulo="Sem dados" />;
  return (
    <motion.ul className="grid grid-cols-2 gap-2" variants={listaVariants} initial="oculto" animate="visivel">
      {itens.map((s) => {
        const pct = total > 0 ? (s.qtd / total) * 100 : 0;
        const vazio = s.qtd === 0;
        const abre = onClick && !vazio ? () => onClick(s.id) : undefined;
        return (
          <motion.li
            key={s.id}
            variants={entradaBloco}
            whileHover={abre ? { y: -3 } : undefined}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            onClick={abre}
            className={clsx(
              'min-w-0 rounded-xl border p-2.5 transition-colors',
              vazio ? 'border-slate-200/60 bg-slate-50/60' : 'border-slate-200/80 bg-white hover:border-slate-300',
              abre && 'cursor-pointer',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: vazio ? '#cbd5e1' : s.cor }} />
              <span className={clsx('min-w-0 flex-1 truncate text-[11px] font-medium', vazio ? 'text-slate-400' : 'text-slate-500')}>{s.nome}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className={clsx('num text-xl font-bold leading-none', vazio ? 'text-slate-300' : 'text-slate-900')}>{inteiro(s.qtd)}</span>
              <span className="num text-[11px] text-slate-400">{numero(pct, 0)}%</span>
            </div>
            <BarraAnimada pct={pct} cor={vazio ? '#e2e8f0' : s.cor} className="mt-2 h-1.5" />
          </motion.li>
        );
      })}
    </motion.ul>
  );
}

/** Pílula de status (WhatsApp / SEFAZ) com ponto pulsando quando online */
function StatusPilula({ icone, nome, ok, texto, tom }: { icone: React.ReactNode; nome: string; ok: boolean; texto: string; tom: Parameters<typeof Badge>[0]['tom'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-card">
      <span className="relative flex h-2 w-2">
        {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      </span>
      {icone} {nome}
      <Badge tom={tom}>{texto}</Badge>
    </span>
  );
}

/** "cobrado − custo = lucro" de vendas ou de assistência */
function BlocoLucro({ titulo, icone, cor, receita, custo, rotuloCusto, qtd, rotuloQtd, onClick }: { titulo: string; icone: React.ReactNode; cor: string; receita: number; custo: number; rotuloCusto: string; qtd: number; rotuloQtd: string; onClick?: () => void }) {
  const lucro = receita - custo;
  const margem = receita > 0 ? (lucro / receita) * 100 : 0;
  return (
    <motion.div whileHover={{ y: -3 }} onClick={onClick} className={clsx('min-w-0 rounded-xl border border-slate-200/80 bg-white p-3', onClick && 'cursor-pointer')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span className="flex h-5 w-5 items-center justify-center rounded-md text-white" style={{ backgroundColor: cor }}>{icone}</span>
          {titulo}
        </p>
        <span className="num rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">{inteiro(qtd)} {rotuloQtd}</span>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-2"><span className="text-slate-500">Faturado</span><span className="num font-medium">{moeda(receita)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-500">{rotuloCusto}</span><span className="num text-red-600">- {moeda(custo)}</span></div>
        <div className="flex justify-between gap-2 border-t border-slate-100 pt-1"><span className="font-semibold text-slate-700">Lucro</span><span className={clsx('num font-bold', lucro < 0 ? 'text-red-600' : 'text-emerald-600')}>{moeda(lucro)}</span></div>
      </div>
      <BarraAnimada pct={Math.max(0, Math.min(100, margem))} cor={cor} className="mt-2 h-1.5" />
      <p className="mt-1 text-[11px] text-slate-400 num">margem {numero(margem, 1)}%</p>
    </motion.div>
  );
}

/** Ranking curto (vendedores ou técnicos) */
function Ranking({ itens, cor, vazio, rotuloQtd }: { itens: DashboardPanorama['porVendedor']; cor: string; vazio: string; rotuloQtd: [string, string] }) {
  if (!itens.length) return <EmptyState compacto titulo={vazio} />;
  const lider = itens[0]?.valor ?? 0;
  return (
    <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
      {itens.map((v, i) => (
        <LinhaV18 key={v.id ?? `sem-${i}`}>
          <span className="w-5 shrink-0 text-center text-xs font-bold text-slate-400 num">{i === 0 ? <Crown className="mx-auto h-4 w-4 text-amber-500" /> : `${i + 1}º`}</span>
          <Avatar nome={v.nome} indice={i} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-slate-800">{v.nome}</span>
              <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(v.valor)}</span>
            </div>
            <BarraAnimada pct={lider > 0 ? (v.valor / lider) * 100 : 0} cor={i === 0 ? cor : '#94a3b8'} className="mt-1.5 h-1.5" />
            <p className="mt-1 text-[11px] text-slate-400 num">
              {inteiro(v.qtd)} {v.qtd === 1 ? rotuloQtd[0] : rotuloQtd[1]} · lucro <span className={v.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}>{moeda(v.lucro)}</span>
            </p>
          </div>
        </LinhaV18>
      ))}
    </motion.ul>
  );
}

/**
 * "Meu Dashboard" do gestor (tela inicial do ADMIN) — vendas + assistência no período, com lucro, DRE,
 * saldo por banco, lançamentos e Saúde. `acoesExtras` = o seletor "ver como" (abre o dashboard de alguém da equipe).
 */
export default function DashboardGeral({ acoesExtras }: { acoesExtras?: React.ReactNode } = {}) {
  const nav = useNavigate();
  const usuario = useAuth((s) => s.usuario);
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard();
  const [base, setBase] = useState<'entrada' | 'conclusao'>('entrada');

  const { data: pano, isLoading: carregando } = useQuery({
    queryKey: ['dashboard-panorama', dataInicial, dataFinal, base],
    queryFn: () => api.get<DashboardPanorama>('/dashboard/panorama', { dataInicial, dataFinal, base }),
    refetchInterval: 60_000,
    retry: 0,
  });
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard-geral'], queryFn: () => api.get<Dados>('/dashboard/geral'), refetchInterval: 60_000 });
  const { data: sefaz } = useQuery({ queryKey: ['sefaz-status'], queryFn: () => api.get<StatusSefaz>('/fiscal/status-sefaz').catch(() => null), staleTime: 5 * 60 * 1000 });

  const indisponivel = !!error && rotaIndisponivel(error);
  const r = pano?.resumo;
  const comp = r?.comparativo;
  const h = data?.hoje;
  const f = data?.financeiro;
  const totalOs = data?.os.porSituacao.reduce((s, x) => s + x.qtd, 0) ?? 0;
  const totalVendas = data?.vendas.porSituacao.reduce((s, x) => s + x.qtd, 0) ?? 0;
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const hojeExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const qtd = (n: number) => inteiro(Math.round(n));
  const series = (pano?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo), total: s.vendas + s.assistencia }));
  const temMovimento = series.some((s) => s.total > 0);
  const temCaixa = series.some((s) => s.entradas > 0 || s.saidas > 0);
  const pctVendas = r && r.faturamento > 0 ? (r.vendas.valor / r.faturamento) * 100 : 0;
  const pctAssist = r && r.faturamento > 0 ? (r.assistencia.valor / r.faturamento) * 100 : 0;
  const mix = r ? [{ nome: 'Vendas', valor: r.vendas.valor, cor: COR_VENDAS }, { nome: 'Assistência', valor: r.assistencia.valor, cor: COR_ASSIST }].filter((x) => x.valor > 0) : [];
  const nomeAgrupado = pano?.periodo.agrupar === 'mes' ? 'mês' : pano?.periodo.agrupar === 'semana' ? 'semana' : 'dia';

  // composição do faturamento: custos + lucros de cada lado
  const composicao = r
    ? [
        { nome: 'Custos das vendas', valor: r.vendas.custo, cor: '#93c5fd' },
        { nome: 'Custos da assistência', valor: r.assistencia.custo, cor: '#fca5a5' },
        { nome: 'Lucro das vendas', valor: r.vendas.lucro, cor: COR_VENDAS },
        { nome: 'Lucro da assistência', valor: r.assistencia.lucro, cor: COR_ASSIST },
      ]
    : [];

  const pendencias: { nome: string; qtd?: number; link: string; icone: React.ReactNode; tom: Tom; mostrar: boolean }[] = [
    { nome: 'NF-e pendentes', qtd: data?.fiscal.pendentes, link: '/notas-fiscais?situacao=PENDENTE', icone: <FileText className="h-4 w-4" />, tom: 'azul', mostrar: true },
    { nome: 'NF-e rejeitadas', qtd: data?.fiscal.rejeitadas, link: '/notas-fiscais?situacao=REJEITADA', icone: <FileWarning className="h-4 w-4" />, tom: data && data.fiscal.rejeitadas > 0 ? 'vermelho' : 'neutro', mostrar: true },
    { nome: 'Comissões pendentes', qtd: data?.comissoes?.pendentes, link: '/comissoes', icone: <BadgePercent className="h-4 w-4" />, tom: 'amarelo', mostrar: isLoading || !!data?.comissoes },
    { nome: 'OS concluídas hoje', qtd: h?.osConcluidasHoje, link: '/ordens-servico', icone: <CheckCircle2 className="h-4 w-4" />, tom: 'verde', mostrar: true },
  ];

  return (
    <PaginaV18 className="space-y-4 sm:space-y-5">
      {/* cabeçalho */}
      <Aparecer className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">{hojeExtenso.charAt(0).toUpperCase() + hojeExtenso.slice(1)}</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {saudacao}, {usuario?.nome?.split(' ')[0]} <motion.span className="inline-block origin-[70%_70%]" animate={{ rotate: [0, 14, -8, 14, 0] }} transition={{ duration: 1.4, delay: 0.4 }}>👋</motion.span>
          </h1>
          <p className="hidden text-sm text-slate-500 sm:block">Meu Dashboard · vendas e assistência técnica somadas, no período que você escolher.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {acoesExtras}
          <StatusPilula icone={<MessageCircle className="h-3.5 w-3.5 text-slate-400" />} nome="WhatsApp" ok={data?.whatsapp.status === 'CONECTADO'} texto={rotulo(data?.whatsapp.status ?? 'DESCONECTADO')} tom={tomPorStatus(data?.whatsapp.status)} />
          <StatusPilula icone={<FileText className="h-3.5 w-3.5 text-slate-400" />} nome="SEFAZ" ok={!!sefaz?.online} texto={sefaz ? (sefaz.online ? 'Online' : 'Offline') : '—'} tom={sefaz?.online ? 'verde' : sefaz ? 'vermelho' : 'neutro'} />
        </div>
      </Aparecer>

      <Aparecer>
        <Link
          to="/financeiro/lancamentos-automaticos"
          className={clsx(
            'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition',
            (data?.lancamentosAutomaticos?.pendentes ?? 0) > 0
              ? 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Inbox className="h-4 w-4 shrink-0" />
            <span>
              <strong className="num">{isLoading ? '…' : inteiro(data?.lancamentosAutomaticos?.pendentes ?? 0)}</strong>
              {' '}
              {(data?.lancamentosAutomaticos?.pendentes ?? 0) === 1 ? 'lançamento automático pendente' : 'lançamentos automáticos pendentes'} de revisão
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
            Revisar <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      </Aparecer>

      {/* filtros — os mesmos do dashboard de assistência */}
      <Aparecer className="flex flex-wrap items-end gap-2">
        <FiltroPeriodo id="periodo-geral" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
        <SegmentadoV18
          id="base-geral"
          valor={base}
          onMudar={setBase}
          opcoes={[
            { valor: 'entrada', rotulo: 'OS por entrada' },
            { valor: 'conclusao', rotulo: 'OS por conclusão' },
          ]}
        />
      </Aparecer>

      {indisponivel && (
        <Aparecer className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" /> A rota do dashboard ainda não está disponível na API. Os indicadores aparecerão assim que o backend responder.
        </Aparecer>
      )}

      {/* ===== TOPO (estilo Power BI): o mais importante primeiro — saldo do banco e o que foi vendido ===== */}
      <FaixaKpis colunas={4}>
        <KpiV18
          destaque
          className="col-span-2"
          rotulo="Saldo em bancos + caixa"
          valor={f?.saldoTotal}
          formato={moeda}
          icone={<Landmark className="h-4 w-4" />}
          tom="verde"
          carregando={isLoading}
          sub={f ? `agora, somando todas as contas · a pagar hoje ${moeda(f.pagarHoje)}` : 'agora, somando todas as contas'}
          onClick={() => nav('/financeiro/bancos')}
        />
        <KpiV18
          destaque
          className="col-span-2"
          rotulo={`Faturamento · ${faixa}`}
          valor={r?.faturamento}
          anterior={comp?.faturamento}
          formato={moeda}
          icone={<Sparkles className="h-4 w-4" />}
          tom="azul"
          carregando={carregando}
          sub={r ? `${inteiro(r.vendas.qtd)} ${r.vendas.qtd === 1 ? 'venda' : 'vendas'} + ${inteiro(r.assistencia.qtd)} OS · ticket médio ${moeda(r.ticketMedio)}` : undefined}
        />
      </FaixaKpis>

      {/* saldo de cada conta (Cora, Asaas, SumUp, caixa…) */}
      <SaldosContas contas={f?.saldoContas} carregando={isLoading} formato={moeda} onClick={() => nav('/financeiro/bancos')} />

      <FaixaKpis>
        <KpiV18 rotulo="Vendas" valor={r?.vendas.valor} anterior={comp?.vendas.valor} formato={moeda} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={carregando} sub={r ? `${inteiro(r.vendas.qtd)} pedidos · ticket ${moeda(r.vendas.ticketMedio)}` : undefined} onClick={() => nav('/dashboard/vendas')} />
        <KpiV18 rotulo="Assistência" valor={r?.assistencia.valor} anterior={comp?.assistencia.valor} formato={moeda} icone={<Wrench className="h-4 w-4" />} tom="vermelho" carregando={carregando} sub={r ? `${inteiro(r.assistencia.qtd)} OS · ticket ${moeda(r.assistencia.ticketMedio)}` : undefined} onClick={() => nav('/dashboard/assistencia')} />
        <KpiV18 rotulo="Lucro" valor={r?.lucro} anterior={comp?.lucro} formato={moeda} icone={<TrendingUp className="h-4 w-4" />} tom="verde" carregando={carregando} sub={r ? `margem ${percentual(r.margemPct)}` : undefined} />
        <KpiV18 rotulo="Entrou (banco + caixa)" valor={r?.caixa.entradas} anterior={comp?.caixa.entradas} formato={moeda} icone={<ArrowDownRight className="h-4 w-4" />} tom="verde" carregando={carregando} sub="recebimentos no período" onClick={() => nav('/financeiro/fluxo-caixa')} />
        <KpiV18 rotulo="Saiu (banco + caixa)" valor={r?.caixa.saidas} anterior={comp?.caixa.saidas} inverter formato={moeda} icone={<ArrowUpRight className="h-4 w-4" />} tom="neutro" carregando={carregando} sub="pagamentos no período" onClick={() => nav('/financeiro/pagar')} />
        <KpiV18 rotulo="A receber hoje" valor={f?.receberHoje} formato={moeda} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={isLoading} sub={f ? `a pagar hoje ${moeda(f.pagarHoje)}` : undefined} onClick={() => nav('/financeiro/receber')} />
      </FaixaKpis>

      {/* ===== PRECISA DE VOCÊ: tudo que pede atenção agora, em blocos ===== */}
      <Aparecer>
        <MensagensCard />
        <SugestoesJarvis />
      </Aparecer>
      {data && data.alertas.length > 0 && (
        <Aparecer>
          <CardV18
            titulo="Precisa de você"
            descricao={`${data.alertas.length} ${data.alertas.length > 1 ? 'pontos pedem' : 'ponto pede'} atenção · caixinhas, contas e pendências do sistema`}
            icone={<TriangleAlert className="h-4 w-4" />}
            tom="amarelo"
          >
            <BlocosAlerta alertas={data.alertas} />
          </CardV18>
        </Aparecer>
      )}

      {/* evolução do período */}
      <CardV18
        titulo={`Faturamento por ${nomeAgrupado}`}
        descricao={faixa}
        icone={<BarChart3 className="h-4 w-4" />}
        tom="azul"
        acoes={r?.melhorPeriodo && series.length > 1 ? <span className="num hidden rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700 sm:inline">melhor {nomeAgrupado}: {rotuloPeriodo(r.melhorPeriodo.periodo)} · {moeda(r.melhorPeriodo.valor)}</span> : undefined}
      >
        {/* divisão vendas x assistência */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <motion.div initial={{ width: 0 }} animate={{ width: `${pctVendas}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} style={{ backgroundColor: COR_VENDAS }} title={`Vendas ${numero(pctVendas, 0)}%`} />
          <motion.div initial={{ width: 0 }} animate={{ width: `${pctAssist}%` }} transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }} style={{ backgroundColor: COR_ASSIST }} title={`Assistência ${numero(pctAssist, 0)}%`} />
        </div>
        <div className="mb-3 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link to="/dashboard/vendas" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COR_VENDAS }} />Vendas <span className="num font-semibold">{moeda(r?.vendas.valor ?? 0)}</span><span className="num text-slate-400">{numero(pctVendas, 0)}%</span></Link>
          <Link to="/dashboard/assistencia" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COR_ASSIST }} />Assistência <span className="num font-semibold">{moeda(r?.assistencia.valor ?? 0)}</span><span className="num text-slate-400">{numero(pctAssist, 0)}%</span></Link>
          <span className="inline-flex items-center gap-1.5 text-slate-600"><span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: COR_LUCRO }} />Lucro</span>
        </div>
        {carregando ? (
          <Skeleton className="h-52 sm:h-64" />
        ) : temMovimento ? (
          <div className="h-52 sm:h-64">
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
                <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Bar dataKey="vendas" name="Vendas" stackId="fat" fill={COR_VENDAS} maxBarSize={36} animationDuration={900} />
                <Bar dataKey="assistencia" name="Assistência" stackId="fat" fill={COR_ASSIST} radius={[6, 6, 0, 0]} maxBarSize={36} animationDuration={1100} />
                <Line type="monotone" dataKey="lucro" name="Lucro" stroke={COR_LUCRO} strokeWidth={2.5} dot={series.length <= 12 ? { r: 3, strokeWidth: 2, stroke: '#fff' } : false} animationDuration={1300} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compacto titulo="Sem vendas nem OS no período" descricao="Contam as vendas não canceladas e as OS não canceladas do período." />
        )}
      </CardV18>

      {!!r?.osSemCusto && (
        <Aparecer className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {r.osSemCusto} OS concluída{r.osSemCusto > 1 ? 's' : ''} com peça e sem custo da peça lançado — o lucro da assistência está maior do que o real.{' '}
            <Link to="/dashboard/assistencia" className="font-medium underline">Ver no dashboard de assistência</Link>
          </span>
        </Aparecer>
      )}

      {/* ===== DETALHES (menos importante) daqui para baixo ===== */}
      <SecaoDetalhes dica="role para ver mais" />

      {/* Robô da Saúde (só ADMIN): corrige sozinho e deixa o resto com o botão pronto */}
      <Aparecer>
        <CardRoboSaude />
      </Aparecer>

      {/* fechamento + mix */}
      <div className="grid gap-4 xl:grid-cols-3">
        <CardV18 className="xl:col-span-2" titulo="Fechamento do período" descricao={faixa} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde">
          {carregando ? (
            <Skeleton className="h-56" />
          ) : r && r.faturamento > 0 ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-500">Para onde foi o faturamento</span>
                  <span className="num text-lg font-bold text-slate-900">{moeda(r.faturamento)}</span>
                </div>
                <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  {composicao.map((c) => (
                    <motion.div key={c.nome} initial={{ width: 0 }} animate={{ width: `${Math.max(0, (c.valor / r.faturamento) * 100)}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} style={{ backgroundColor: c.cor }} title={`${c.nome}: ${moeda(c.valor)}`} />
                  ))}
                </div>
                <motion.ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2" variants={listaVariants} initial="oculto" animate="visivel">
                  {composicao.map((c) => (
                    <LinhaV18 key={c.nome} className="px-0 py-0.5">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{c.nome}</span>
                      <span className="num text-xs text-slate-400">{numero((c.valor / r.faturamento) * 100, 0)}%</span>
                      <span className={clsx('num w-28 text-right text-sm font-semibold', c.valor < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(c.valor)}</span>
                    </LinhaV18>
                  ))}
                </motion.ul>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <BlocoLucro titulo="Vendas" icone={<ShoppingCart className="h-3 w-3" />} cor={COR_VENDAS} receita={r.vendas.valor} custo={r.vendas.custo} rotuloCusto="Mercadorias e logística" qtd={r.vendas.qtd} rotuloQtd={r.vendas.qtd === 1 ? 'pedido' : 'pedidos'} onClick={() => nav('/dashboard/vendas')} />
                <BlocoLucro titulo="Assistência" icone={<Wrench className="h-3 w-3" />} cor={COR_ASSIST} receita={r.assistencia.valor} custo={r.assistencia.custo} rotuloCusto="Peças, logística e terceiros" qtd={r.assistencia.qtd} rotuloQtd="OS" onClick={() => nav('/dashboard/assistencia')} />
              </div>
            </div>
          ) : (
            <EmptyState compacto icone={<CircleDollarSign className="h-5 w-5" />} titulo="Nada faturado no período" />
          )}
        </CardV18>

        <CardV18 titulo="Vendas x assistência" descricao="quanto cada lado trouxe" icone={<PieIcon className="h-4 w-4" />} tom="azul">
          {carregando ? (
            <Skeleton className="h-56" />
          ) : mix.length ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={mix} dataKey="valor" nameKey="nome" innerRadius={54} outerRadius={78} paddingAngle={mix.length > 1 ? 3 : 0} cornerRadius={6} stroke="#fff" animationDuration={1000}>
                      {mix.map((m) => (
                        <Cell key={m.nome} fill={m.cor} />
                      ))}
                    </Pie>
                    <Tooltip content={<TooltipPadrao />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[11px] text-slate-400">Lucro</span>
                  <span className="num text-sm font-bold text-slate-900">{moeda(r!.lucro)}</span>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border border-slate-200/80 p-2">
                  <p className="text-[11px] text-slate-500">Lucro vendas</p>
                  <p className="num text-sm font-bold" style={{ color: COR_VENDAS }}>{moeda(r!.vendas.lucro)}</p>
                  <p className="num text-[11px] text-slate-400">{percentual(r!.vendas.margemPct)}</p>
                </div>
                <div className="rounded-xl border border-slate-200/80 p-2">
                  <p className="text-[11px] text-slate-500">Lucro assistência</p>
                  <p className="num text-sm font-bold" style={{ color: COR_ASSIST }}>{moeda(r!.assistencia.lucro)}</p>
                  <p className="num text-[11px] text-slate-400">{percentual(r!.assistencia.margemPct)}</p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </CardV18>
      </div>

      {/* equipe + caixa */}
      <div className="grid gap-4 xl:grid-cols-3">
        <CardV18 titulo="Vendedores" descricao={faixa} icone={<Trophy className="h-4 w-4" />} tom="amarelo" semPadding acoes={<Link to="/dashboard/vendas" className="text-xs font-medium text-brand-600 hover:underline">Detalhes</Link>}>
          {carregando ? <div className="p-4"><Skeleton className="h-48" /></div> : <Ranking itens={pano?.porVendedor ?? []} cor={COR_VENDAS} vazio="Sem vendas no período" rotuloQtd={['venda', 'vendas']} />}
        </CardV18>
        <CardV18 titulo="Técnicos" descricao={faixa} icone={<HardHat className="h-4 w-4" />} tom="vermelho" semPadding acoes={<Link to="/dashboard/assistencia" className="text-xs font-medium text-brand-600 hover:underline">Detalhes</Link>}>
          {carregando ? <div className="p-4"><Skeleton className="h-48" /></div> : <Ranking itens={pano?.porTecnico ?? []} cor={COR_ASSIST} vazio="Sem OS no período" rotuloQtd={['OS', 'OS']} />}
        </CardV18>
        <CardV18 titulo="Banco + caixa no período" descricao="o que entrou e saiu de todas as contas (transferências e ajustes de saldo ficam fora)" icone={<Landmark className="h-4 w-4" />} tom="verde">
          {carregando ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50/70 px-3 py-1.5"><span className="text-emerald-700">Entrou</span><span className="num font-bold text-emerald-700">{moeda(r?.caixa.entradas ?? 0)}</span></div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50/70 px-3 py-1.5"><span className="text-red-700">Saiu</span><span className="num font-bold text-red-700">{moeda(r?.caixa.saidas ?? 0)}</span></div>
                <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5"><span className="text-slate-600">Saldo</span><span className={clsx('num font-bold', (r?.caixa.saldo ?? 0) < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(r?.caixa.saldo ?? 0)}</span></div>
              </div>
              {temCaixa ? (
                <div className="h-36">
                  <ResponsiveContainer>
                    <BarChart data={series} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                      <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                      <Bar dataKey="entradas" name="Entrou" fill={CORES.entrada} radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={900} />
                      <Bar dataKey="saidas" name="Saiu" fill={CORES.saida} radius={[4, 4, 0, 0]} maxBarSize={14} animationDuration={1100} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-slate-400">Nenhum recebimento ou pagamento baixado no período.</p>
              )}
              <p className="text-[11px] text-slate-400">Transferências entre contas não contam.</p>
            </div>
          )}
        </CardV18>
      </div>

      {/* Vitrine da equipe: o lucro que os anúncios trouxeram e o pagamento extra que sai dele */}
      <CardAnunciosEquipe dataInicial={dataInicial} dataFinal={dataFinal} faixa={faixa} />

      <SecaoDetalhes titulo="Agora na loja" dica="não depende do período" />

      <FaixaKpis colunas={4}>
        <KpiV18 rotulo="OS abertas" valor={h?.osAbertas} formato={qtd} sub={data ? `${inteiro(data.os.atrasadas)} atrasadas` : undefined} icone={<Wrench className="h-4 w-4" />} tom={data && data.os.atrasadas > 0 ? 'amarelo' : 'neutro'} carregando={isLoading} onClick={() => nav('/ordens-servico')} />
        <KpiV18 rotulo="Custos no período" valor={r?.custo} anterior={comp?.custo} inverter formato={moeda} icone={<Receipt className="h-4 w-4" />} tom="amarelo" carregando={carregando} sub="vendas + assistência" />
        <KpiV18 rotulo="Receber atrasado" valor={f?.receberAtrasado} formato={moeda} icone={<TriangleAlert className="h-4 w-4" />} tom={f && f.receberAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/receber?situacao=ATRASADO')} />
        <KpiV18 rotulo="Pagar atrasado" valor={f?.pagarAtrasado} formato={moeda} icone={<Wallet className="h-4 w-4" />} tom={f && f.pagarAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/pagar')} />
      </FaixaKpis>

      <div className="grid gap-4 lg:grid-cols-3">
        <UltimosAcontecimentos className="lg:col-span-2" />
        <CardV18 titulo="Pendências" descricao="O que está esperando alguém" icone={<ListChecks className="h-4 w-4" />} className="self-start" semPadding>
          <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
            {pendencias
              .filter((p) => p.mostrar)
              .map((p) => (
                <LinhaV18 key={p.nome} onClick={() => nav(p.link)}>
                  <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONS[p.tom].chip)}>{p.icone}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{p.nome}</span>
                  <span className={clsx('num rounded-full px-2 py-0.5 text-xs font-semibold', p.qtd ? TONS[p.tom].chip : 'bg-slate-50 text-slate-400')}>{isLoading ? '…' : inteiro(p.qtd)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </LinhaV18>
              ))}
          </motion.ul>
        </CardV18>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CardV18 titulo="OS em aberto por situação" descricao={`${inteiro(totalOs)} ordens`} icone={<Wrench className="h-4 w-4" />} tom="azul" acoes={<Link to="/ordens-servico" className="text-xs font-medium text-brand-600 hover:underline">Ver kanban</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BlocosSituacao itens={data?.os.porSituacao ?? []} total={totalOs} onClick={(id) => nav(`/ordens-servico?situacoes=${id}&visao=lista`)} />}
        </CardV18>
        <CardV18 titulo="Vendas do mês por situação" descricao={`${inteiro(totalVendas)} pedidos`} icone={<ShoppingCart className="h-4 w-4" />} tom="verde" acoes={<Link to="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver vendas</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BlocosSituacao itens={data?.vendas.porSituacao ?? []} total={totalVendas} onClick={(id) => nav(`/vendas?situacoes=${id}`)} />}
        </CardV18>
        <CardV18
          titulo="Estoque abaixo do mínimo"
          descricao={data ? `${inteiro(data.estoque.qtdAbaixoMinimo)} produtos` : undefined}
          icone={<Package className="h-4 w-4" />}
          tom={data && data.estoque.qtdAbaixoMinimo > 0 ? 'vermelho' : 'neutro'}
          acoes={<Link to="/estoque?abaixoMinimo=true" className="text-xs font-medium text-brand-600 hover:underline">Ver todos</Link>}
          semPadding
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data?.estoque.abaixoMinimo.length ? (
            <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {data.estoque.abaixoMinimo.slice(0, 8).map((p) => {
                const pct = p.estoqueMinimo > 0 ? (Math.max(0, p.saldo) / p.estoqueMinimo) * 100 : 0;
                return (
                  <LinhaV18 key={p.produtoId} onClick={() => nav(`/produtos/${p.produtoId}`)} bloco>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{p.nome}</span>
                      <span className="num shrink-0 text-xs">
                        <span className={p.saldo <= 0 ? 'font-semibold text-red-600' : 'text-amber-600'}>{numero(p.saldo)}</span>
                        <span className="text-slate-400"> / mín {numero(p.estoqueMinimo)}</span>
                      </span>
                    </div>
                    <BarraAnimada pct={pct} cor={p.saldo <= 0 ? '#dc2626' : '#f59e0b'} className="mt-1.5 h-1.5" />
                  </LinhaV18>
                );
              })}
            </motion.ul>
          ) : (
            <EmptyState compacto icone={<Boxes className="h-5 w-5" />} titulo="Estoque em dia" descricao="Nenhum produto abaixo do mínimo." />
          )}
        </CardV18>
      </div>
    </PaginaV18>
  );
}
