/**
 * JARVIS — painel do gestor (só ADMIN). docs/JARVIS.md
 * Caixa livre de hoje, quanto falta para R$ 1 milhão, o ritmo por dia útil, a evolução,
 * o feed de sugestões com Aceitar/Adiar/Recusar, o modo pergunta e o placar do JARVIS.
 * Estilo V18/Power BI: o mais importante no topo, detalhes embaixo.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  Bot,
  Check,
  BarChart3,
  Boxes,
  CalendarClock,
  Clock,
  HandCoins,
  Landmark,
  PackageSearch,
  PhoneCall,
  RefreshCw,
  Send,
  Settings,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, EmptyState, Input, Skeleton } from '@/components/ui';
import { Aparecer, CardV18, FaixaKpis, KpiV18, PaginaV18, SecaoDetalhes, listaVariants } from '@/components/dashboard/v18';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { CORES, TooltipPadrao, eixoMoeda } from '@/components/compartilhados/graficos';
import { CartaoSugestao, type SugestaoJarvis } from '@/components/dashboard/SugestoesJarvis';
import ChatJarvis, { type ControleChat } from '@/components/dashboard/ChatJarvis';
import tabletPng from './tablet.svg';
import { BarraRanking, MedidorMeta } from './medidor';
import { dataHora, moeda, numero, percentual } from '@/lib/format';
import './jarvis.css';

interface Painel {
  caixaLivre: number;
  compromissosTotais: number;
  saldoBancos: number;
  saldoCaixa: number;
  aPagar30d: number;
  caixinhasDevidas: number;
  caixinhasFuturas: number;
  emprestimos30d: number;
  emprestimosDepois: number;
  meta: number;
  escada: {
    degraus: { valor: number; nome: string; o: string; conquistado: boolean }[];
    atual: { valor: number; nome: string; o: string } | null;
    proximo: { valor: number; nome: string; o: string } | null;
    faltaProximo: number;
    progresso: number;
    vencidos: number;
    total: number;
  };
  porDiaDoDegrau: number;
  falta: number;
  percentual: number;
  diasUteis: number;
  porDiaUtil: number;
  variacao7d: number | null;
  variacao30d: number | null;
  dataAlvo: string;
  sugestoes: SugestaoJarvis[];
  emJogo: number;
  ia: { ligada: boolean; modelo: string; ultimoErro: string | null };
  ultimaRodadaEm: string | null;
  ligado: boolean;
}

interface Panorama {
  resumo: {
    faturamento: number;
    custo: number;
    lucro: number;
    margemPct: number;
    qtd: number;
    ticketMedio: number;
    vendas: { valor: number; qtd: number; lucro: number; margemPct: number; ticketMedio: number };
    assistencia: { valor: number; qtd: number; lucro: number; margemPct: number; ticketMedio: number };
    caixa: { entradas: number; saidas: number; saldo: number };
    comparativo?: { faturamento: number; lucro: number; margemPct: number; ticketMedio: number };
  };
  series: { periodo: string; vendas: number; assistencia: number; lucro: number; entradas: number; saidas: number }[];
  porVendedor: { id: number | null; nome: string; valor: number; qtd: number; lucro: number }[];
  porTecnico: { id: number | null; nome: string; valor: number; qtd: number; lucro: number }[];
}

interface Placar {
  aceitas: number;
  recusadas: number;
  abertas: number;
  estimado: number;
  real: number;
  acerto: number | null;
  medidas: { regra: string; titulo: string; impactoEstimado: number | null; resultadoReal: number | null }[];
}

/** Os nove atalhos: o que o gestor mais pede, a um toque. */
const ATALHOS: { icone: typeof Wallet; cor: string; titulo: string; dica: string; pergunta?: string; acao?: 'rodar' | 'ligar' }[] = [
  {
    icone: Wallet,
    cor: 'bg-emerald-50 text-emerald-600',
    titulo: 'Caixa livre',
    dica: 'quanto sobra hoje',
    pergunta: 'Quanto tenho de caixa livre hoje e o que mudou nos últimos 7 dias? Seja curto.',
  },
  {
    icone: Target,
    cor: 'bg-brand-50 text-brand-600',
    titulo: 'O que fazer',
    dica: '3 ações de maior impacto',
    pergunta: 'Quais são as 3 ações de maior impacto no caixa que eu deveria fazer agora? Diga o valor estimado de cada uma.',
  },
  {
    icone: HandCoins,
    cor: 'bg-amber-50 text-amber-600',
    titulo: 'Atrasados',
    dica: 'crediário vencido',
    pergunta: 'Quem está em atraso no crediário, quanto soma e quem são os 5 maiores? Pode preparar a cobrança por WhatsApp.',
  },
  {
    icone: PackageSearch,
    cor: 'bg-sky-50 text-sky-600',
    titulo: 'Estoque parado',
    dica: 'dinheiro preso',
    pergunta: 'Qual estoque está parado há mais tempo e quanto dinheiro está preso nele? Sugira o que fazer com os 5 piores.',
  },
  {
    icone: Tag,
    cor: 'bg-violet-50 text-violet-600',
    titulo: 'Avaliar usado',
    dica: 'quanto pagar',
    pergunta: 'Vou avaliar um usado para comprar no balcão. Me pergunte o que precisa saber e depois calcule quanto pagar pelas minhas regras.',
  },
  {
    icone: CalendarClock,
    cor: 'bg-rose-50 text-rose-600',
    titulo: 'Contas da semana',
    dica: 'o que vence em 7 dias',
    pergunta: 'O que vence nos próximos 7 dias, quanto soma e sobra caixa para pagar tudo?',
  },
  {
    icone: TrendingDown,
    cor: 'bg-orange-50 text-orange-600',
    titulo: 'Margem baixa',
    dica: 'onde estou perdendo',
    pergunta: 'Onde estou perdendo margem? Liste os produtos e vendas com margem mais baixa do mês.',
  },
  { icone: RefreshCw, cor: 'bg-slate-100 text-slate-600', titulo: 'Nova análise', dica: 'olhar a loja agora', acao: 'rodar' },
  { icone: PhoneCall, cor: 'bg-emerald-50 text-emerald-600', titulo: 'Ligar', dica: 'conversar por voz', acao: 'ligar' },
];

/**
 * O posto do JARVIS: o aparelho em pé com a conversa dentro, e ao lado os nove
 * atalhos. O tablet é uma imagem (tablet.svg) — o vidro é só um recorte por onde
 * o chat aparece, nas medidas exatas do desenho.
 */
function PostoJarvis({ rodar, rodando }: { rodar: () => void; rodando: boolean }) {
  const [hora, setHora] = useState(() => new Date());
  const controle = useRef<ControleChat | null>(null);
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const acionar = (a: (typeof ATALHOS)[number]) => {
    if (a.acao === 'rodar') return rodar();
    if (a.acao === 'ligar') return controle.current?.ligar();
    if (a.pergunta) controle.current?.perguntar(a.pergunta);
  };

  return (
    <div className="jv-posto">
      <div className="jv-aparelho">
        <img src={tabletPng} alt="" />
        <div className="jv-tela">
          <div className="jv-barra">
            <span>
              <b>JARVIS</b> · Balão
            </span>
            <span className="flex items-center gap-1.5">
              <span className="jv-hora">{hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="jv-ponto" aria-hidden />
            </span>
          </div>
          <ChatJarvis controle={controle} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Atalhos</p>
        <div className="jv-atalhos">
          {ATALHOS.map((a) => (
            <button key={a.titulo} type="button" className="jv-atalho" onClick={() => acionar(a)} disabled={a.acao === 'rodar' && rodando}>
              <span className={`jv-icone ${a.cor}`}>
                <a.icone className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <b className="block">{a.titulo}</b>
                <span className="block">{a.dica}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Jarvis() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard('30d');

  const { data: p, isLoading } = useQuery({
    queryKey: ['jarvis-painel'],
    queryFn: () => api.get<Painel>('/jarvis/painel'),
    refetchInterval: 60_000,
    retry: 0,
  });

  const { data: evo } = useQuery({
    queryKey: ['jarvis-evolucao', dataInicial, dataFinal],
    queryFn: () => api.get<{ serie: { rotulo: string; caixaLivre: number }[] }>('/jarvis/evolucao', { dataInicial, dataFinal }),
    retry: 0,
  });

  const { data: placar } = useQuery({ queryKey: ['jarvis-placar'], queryFn: () => api.get<Placar>('/jarvis/placar'), retry: 0 });

  // números reais da operação, do mesmo lugar que alimenta os dashboards do sistema
  const { data: pano } = useQuery({
    queryKey: ['jarvis-panorama', dataInicial, dataFinal],
    queryFn: () => api.get<Panorama>('/dashboard/panorama', { dataInicial, dataFinal }),
    retry: 0,
  });

  const rodar = useMutation({
    mutationFn: () => api.post('/jarvis/rodar', {}),
    onSuccess: () => {
      toast.success('JARVIS passou os olhos em tudo de novo.');
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
      qc.invalidateQueries({ queryKey: ['jarvis-evolucao'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const decidirM = useMutation({
    mutationFn: ({ id, o }: { id: number; o: 'aceitar' | 'adiar' | 'recusar' }) =>
      api.post<{ feito?: string | null }>(`/jarvis/sugestoes/${id}/${o}`, o === 'adiar' ? { dias: 7 } : {}),
    onSuccess: (r, v) => {
      // quando a sugestão tem ação (cobrar, dar desconto), o JARVIS conta o que fez
      if (r?.feito) toast.success(r.feito, { duration: 8000 });
      else toast.success(v.o === 'aceitar' ? 'Aceita.' : v.o === 'adiar' ? 'Adiada por 7 dias.' : 'Recusada.');
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
      qc.invalidateQueries({ queryKey: ['jarvis-placar'] });
      qc.invalidateQueries({ queryKey: ['jarvis-feed'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const serie = evo?.serie ?? [];
  const temSugestoes = (p?.sugestoes.length ?? 0) > 0;
  const temEvolucao = serie.length > 0;
  const temPlacar = (placar?.medidas.length ?? 0) > 0;
  const temContas = !!p;

  const cardSugestoes = (
    <CardV18
      titulo="O que fazer agora"
      descricao={p ? `${p.sugestoes.length} sugestão(ões) aberta(s)` : undefined}
      icone={<Bot className="h-4 w-4" />}
      tom="azul"
    >
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : !temSugestoes ? (
        <EmptyState
          compacto
          titulo="Nada pendente por aqui"
          descricao="Quando o JARVIS achar dinheiro parado, conta vencida ou consignado no prazo, aparece aqui."
        />
      ) : (
        <motion.div variants={listaVariants} initial="oculto" animate="visivel" className="space-y-2">
          {p!.sugestoes.map((s) => (
            <CartaoSugestao key={s.id} s={s} decidindo={decidirM.isPending} decidir={(id, o) => decidirM.mutate({ id, o })} />
          ))}
        </motion.div>
      )}
    </CardV18>
  );

  const cardEvolucao = (
    <div className="space-y-4 sm:space-y-5">
      <CardV18 titulo="Evolução do caixa livre" descricao={faixa} icone={<TrendingUp className="h-4 w-4" />} tom="verde">
        {!temEvolucao ? (
          <EmptyState compacto titulo="Ainda sem histórico" descricao="O JARVIS grava uma medição a cada 30 minutos; em algumas horas o gráfico aparece." />
        ) : (
          <div className="h-52 sm:h-64">
            <ResponsiveContainer>
              <AreaChart data={serie} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
                <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                <Area type="monotone" dataKey="caixaLivre" stroke={CORES.lucro} fill={CORES.lucro} fillOpacity={0.15} strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardV18>
    </div>
  );

  const serieOperacao = pano?.series ?? [];
  const temOperacao = serieOperacao.length > 0;
  const maxVendedor = Math.max(1, ...(pano?.porVendedor ?? []).map((v) => v.valor));
  const maxTecnico = Math.max(1, ...(pano?.porTecnico ?? []).map((t) => t.valor));

  /** Vendas x assistência x lucro no período — de onde o caixa vem. */
  const cardOperacao = (
    <CardV18 titulo="Vendas, assistência e lucro" descricao={faixa} icone={<BarChart3 className="h-4 w-4" />} tom="azul">
      {!temOperacao ? (
        <EmptyState compacto titulo="Sem movimento no período" descricao="Escolha outro período no filtro acima." />
      ) : (
        <div className="h-56 sm:h-64">
          <ResponsiveContainer>
            <ComposedChart data={serieOperacao} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
              <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="vendas" name="Vendas" fill={CORES.receita} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="assistencia" name="Assistência" fill={CORES.entrada} radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line type="monotone" dataKey="lucro" name="Lucro" stroke={CORES.lucro} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </CardV18>
  );

  /** Quem está vendendo e quem está consertando — ranking real do período. */
  const cardEquipe = (
    <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
      <CardV18 titulo="Vendas por vendedor" descricao={faixa} icone={<Users className="h-4 w-4" />}>
        {!(pano?.porVendedor.length) ? (
          <EmptyState compacto titulo="Sem vendas no período" descricao="Assim que houver venda, o ranking aparece." />
        ) : (
          <div className="space-y-3">
            {pano!.porVendedor.map((v) => (
              <BarraRanking
                key={`${v.id ?? 'sem'}-${v.nome}`}
                nome={v.nome}
                valor={v.valor}
                maximo={maxVendedor}
                moeda={moeda}
                sub={`${numero(v.qtd)} venda(s) · lucro ${moeda(v.lucro)}`}
              />
            ))}
          </div>
        )}
      </CardV18>

      <CardV18 titulo="Assistência por técnico" descricao={faixa} icone={<Wrench className="h-4 w-4" />}>
        {!(pano?.porTecnico.length) ? (
          <EmptyState compacto titulo="Sem OS no período" descricao="O ranking usa as ordens de serviço do filtro de data." />
        ) : (
          <div className="space-y-3">
            {pano!.porTecnico.map((t) => (
              <BarraRanking
                key={`${t.id ?? 'sem'}-${t.nome}`}
                nome={t.nome}
                valor={t.valor}
                maximo={maxTecnico}
                moeda={moeda}
                cor="#8b5cf6"
                sub={`${numero(t.qtd)} OS · lucro ${moeda(t.lucro)}`}
              />
            ))}
          </div>
        )}
      </CardV18>
    </div>
  );

  /** Entrou x saiu do caixa, por período. */
  const cardCaixa = (
    <CardV18 titulo="Entrou e saiu do caixa" descricao={faixa} icone={<Wallet className="h-4 w-4" />} tom="verde">
      {!temOperacao ? (
        <EmptyState compacto titulo="Sem movimento de caixa" descricao="Nada entrou nem saiu no período escolhido." />
      ) : (
        <div className="h-48 sm:h-56">
          <ResponsiveContainer>
            <BarChart data={serieOperacao} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="periodo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} minTickGap={12} />
              <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={52} />
              <Tooltip content={<TooltipPadrao />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="entradas" name="Entrou" fill={CORES.lucro} radius={[3, 3, 0, 0]} maxBarSize={24} />
              <Bar dataKey="saidas" name="Saiu" fill={CORES.saida} radius={[3, 3, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </CardV18>
  );

  const cardContas = (
    <CardV18 titulo="De onde sai o caixa livre" icone={<Landmark className="h-4 w-4" />}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Conta rotulo="Saldo dos bancos" valor={p?.saldoBancos} tom="positivo" />
        <Conta rotulo="Caixa da loja" valor={p?.saldoCaixa} tom="positivo" />
        <Conta rotulo="Contas a pagar em 30 dias" valor={p?.aPagar30d} tom="negativo" />
        <Conta rotulo="Caixinhas a usar em 30 dias (+ atraso das distantes)" valor={p?.caixinhasDevidas} tom="negativo" />
        <Conta rotulo="Empréstimos que vencem em 30 dias" valor={p?.emprestimos30d} tom="negativo" />
        <Conta rotulo="= Caixa livre" valor={p?.caixaLivre} tom="total" />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        O caixa livre olha os próximos 30 dias — é com ele que dá para decidir o que fazer hoje. Caixinha que será
        usada nesse prazo entra inteira; as mais distantes entram só pelo que já deveria estar guardado. O resto
        ({moeda(p?.caixinhasFuturas ?? 0)} de caixinhas e {moeda(p?.emprestimosDepois ?? 0)} de empréstimos) aparece
        nos compromissos totais, logo abaixo dos números do topo.
      </p>
    </CardV18>
  );

  const cardPlacar = (
    <CardV18 titulo="Placar do JARVIS" descricao="O que ele estimou × o que entrou de verdade" icone={<Clock className="h-4 w-4" />}>
      {!temPlacar ? (
        <EmptyState compacto titulo="Sem medições ainda" descricao="Sete dias depois de aceitar uma sugestão, o JARVIS confere quanto ela rendeu." />
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            {placar!.aceitas} aceita(s) · {placar!.recusadas} recusada(s) · estimado {moeda(placar!.estimado)} · medido {moeda(placar!.real)}
            {placar!.acerto !== null && ` · acerto ${placar!.acerto}%`}
          </p>
          {placar!.medidas.slice(0, 6).map((m, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-slate-700">{m.titulo}</span>
              <span className="text-slate-500">
                {moeda(m.impactoEstimado ?? 0)} → <strong className="text-slate-800">{moeda(m.resultadoReal ?? 0)}</strong>
              </span>
            </div>
          ))}
        </div>
      )}
    </CardV18>
  );

  // com informação primeiro; o divisor; depois os vazios. O chat fica sempre logo abaixo
  // do que tem conteúdo, porque é por onde se pede as coisas.
  const comConteudo = [
    { chave: 'sugestoes', tem: temSugestoes, conteudo: cardSugestoes },
    { chave: 'evolucao', tem: temEvolucao, conteudo: cardEvolucao },
    { chave: 'operacao', tem: temOperacao, conteudo: cardOperacao },
    { chave: 'equipe', tem: !!(pano?.porVendedor.length || pano?.porTecnico.length), conteudo: cardEquipe },
    { chave: 'caixa', tem: temOperacao, conteudo: cardCaixa },
    { chave: 'contas', tem: temContas, conteudo: cardContas },
    { chave: 'placar', tem: temPlacar, conteudo: cardPlacar },
  ];
  const cheios = comConteudo.filter((b) => b.tem);
  const vazios = comConteudo.filter((b) => !b.tem);

  const blocos = [
    ...cheios.slice(0, 1),
    { chave: 'chat', conteudo: <PostoJarvis rodar={() => rodar.mutate()} rodando={rodar.isPending} /> },
    ...cheios.slice(1),
    ...(vazios.length
      ? [{ chave: 'divisor', conteudo: <SecaoDetalhes titulo="Ainda sem dados" dica="assim que houver, sobem para o topo" /> }]
      : []),
    ...vazios,
  ];


  return (
    <PaginaV18 className="space-y-4 sm:space-y-5">
      <Aparecer className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">Agente do gestor</p>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            <Bot className="h-6 w-6 text-brand-600" /> JARVIS
          </h1>
          <p className="hidden text-sm text-slate-500 sm:block">
            O caminho até R$ 1 milhão livres no caixa — com as contas do próprio sistema.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p && !p.ia.ligada && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
              IA desligada — cadastre a chave
            </span>
          )}
          {p?.ultimaRodadaEm && <span className="text-xs text-slate-400">Última olhada: {dataHora(p.ultimaRodadaEm)}</span>}
          <Button variante="secundario" icone={<RefreshCw className="h-4 w-4" />} carregando={rodar.isPending} onClick={() => rodar.mutate()}>
            Rodar agora
          </Button>
          <Button variante="secundario" icone={<Settings className="h-4 w-4" />} onClick={() => nav('/configuracoes/jarvis')}>
            Ajustes
          </Button>
        </div>
      </Aparecer>

      {/* o filtro vale para tudo que tem data nesta tela: fica no topo, não no meio */}
      <Aparecer className="flex flex-wrap items-end gap-2">
        <FiltroPeriodo id="periodo-jarvis" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
      </Aparecer>

      {/* ===== o milhão e os números do período ===== */}
      <div className="grid gap-3 sm:gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <CardV18
          titulo={p?.escada.proximo ? p.escada.proximo.nome : 'O milhão'}
          descricao={p?.escada.proximo ? p.escada.proximo.o : 'objetivo alcançado'}
          icone={<Target className="h-4 w-4" />}
          tom="verde"
        >
          {/* o medidor mede o DEGRAU de agora: o milhão inteiro não muda de semana para semana */}
          <MedidorMeta
            valor={p?.caixaLivre}
            meta={p?.escada.proximo?.valor ?? p?.meta}
            percentual={p?.escada.progresso}
            falta={p?.escada.faltaProximo}
            porDiaUtil={p?.porDiaDoDegrau}
            diasUteis={22}
            moeda={moeda}
            carregando={isLoading}
          />
          {p && <Degraus escada={p.escada} />}
        </CardV18>

        <div className="grid min-w-0 content-start gap-3 sm:gap-4">
          <FaixaKpis colunas={4}>
            <KpiV18
              rotulo="Faturamento"
              valor={pano?.resumo.faturamento}
              formato={moeda}
              anterior={pano?.resumo.comparativo?.faturamento}
              icone={<BarChart3 className="h-4 w-4" />}
              tom="azul"
              sub={pano ? `${numero(pano.resumo.qtd)} venda(s) e OS` : undefined}
            />
            <KpiV18
              rotulo="Lucro"
              valor={pano?.resumo.lucro}
              formato={moeda}
              anterior={pano?.resumo.comparativo?.lucro}
              icone={<TrendingUp className="h-4 w-4" />}
              tom={pano && pano.resumo.lucro >= 0 ? 'verde' : 'vermelho'}
              sub={pano ? `margem ${percentual(pano.resumo.margemPct)}` : undefined}
            />
            <KpiV18
              rotulo="Ticket médio"
              valor={pano?.resumo.ticketMedio}
              formato={moeda}
              anterior={pano?.resumo.comparativo?.ticketMedio}
              icone={<HandCoins className="h-4 w-4" />}
              tom="neutro"
            />
            <KpiV18
              rotulo="Caixa do período"
              valor={pano?.resumo.caixa.saldo}
              formato={moeda}
              icone={<Wallet className="h-4 w-4" />}
              tom={pano && pano.resumo.caixa.saldo >= 0 ? 'verde' : 'vermelho'}
              sub={pano ? `${moeda(pano.resumo.caixa.entradas)} entrou · ${moeda(pano.resumo.caixa.saidas)} saiu` : undefined}
            />
          </FaixaKpis>

          <FaixaKpis colunas={4}>
            <KpiV18
              rotulo={p?.escada.proximo ? `Falta: ${p.escada.proximo.nome}` : 'Falta para o milhão'}
              valor={p?.escada.faltaProximo ?? p?.falta}
              formato={moeda}
              icone={<Target className="h-4 w-4" />}
              tom="amarelo"
              carregando={isLoading}
              sub={p ? `em ${p.diasUteis} dias úteis` : undefined}
            />
            <KpiV18
              rotulo="Por dia útil, neste degrau"
              valor={p?.porDiaDoDegrau}
              formato={moeda}
              icone={<TrendingUp className="h-4 w-4" />}
              tom="azul"
              carregando={isLoading}
              sub={p?.emJogo ? `${moeda(p.emJogo)} em jogo` : undefined}
            />
            <KpiV18
              rotulo="Vendas no período"
              valor={pano?.resumo.vendas.valor}
              formato={moeda}
              icone={<Tag className="h-4 w-4" />}
              tom="neutro"
              sub={pano ? `${numero(pano.resumo.vendas.qtd)} venda(s) · margem ${percentual(pano.resumo.vendas.margemPct)}` : undefined}
            />
            <KpiV18
              rotulo="Assistência no período"
              valor={pano?.resumo.assistencia.valor}
              formato={moeda}
              icone={<Wrench className="h-4 w-4" />}
              tom="neutro"
              sub={pano ? `${numero(pano.resumo.assistencia.qtd)} OS · lucro ${moeda(pano.resumo.assistencia.lucro)}` : undefined}
            />
          </FaixaKpis>
        </div>
      </div>

      {p && (p.caixinhasFuturas > 0 || p.emprestimosDepois > 0) && (
        <Aparecer className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
          Olhando além dos 30 dias, ainda há {moeda(p.caixinhasFuturas)} a guardar nas caixinhas e{' '}
          {moeda(p.emprestimosDepois)} de empréstimos a devolver — com tudo isso na conta, os compromissos totais dão{' '}
          <strong className={p.compromissosTotais < 0 ? 'text-rose-600' : 'text-slate-900'}>{moeda(p.compromissosTotais)}</strong>.
        </Aparecer>
      )}

      {/* Os blocos com informação sobem; os vazios descem (pedido do Thiago).
          Os números do topo e o chat ficam sempre à mão. */}
      {blocos.map((b) => (
        <div key={b.chave}>{b.conteudo}</div>
      ))}
    </PaginaV18>
  );
}

/**
 * Os degraus até o milhão.
 *
 * Um milhão visto de longe não motiva: o número não muda de uma semana para a outra.
 * Em degraus, cada semana tem um alvo alcançável — e o que já foi vencido fica à vista,
 * porque chegar até aqui também conta.
 */
function Degraus({ escada }: { escada: Painel['escada'] }) {
  return (
    <ol className="mt-4 flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">
      {escada.degraus.map((d) => {
        const agora = escada.proximo?.valor === d.valor;
        return (
          <li
            key={d.valor}
            title={`${d.o} · ${moeda(d.valor)}`}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ${
              d.conquistado
                ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                : agora
                  ? 'bg-brand-50 font-semibold text-brand-700 ring-brand-300'
                  : 'bg-white text-slate-400 ring-slate-200'
            }`}
          >
            {d.conquistado && <Check className="h-3 w-3" />}
            {d.nome}
          </li>
        );
      })}
    </ol>
  );
}

function Conta({ rotulo, valor, tom }: { rotulo: string; valor?: number; tom: 'positivo' | 'negativo' | 'total' }) {
  const cor = tom === 'negativo' ? 'text-rose-600' : tom === 'total' ? 'text-slate-900' : 'text-emerald-600';
  return (
    <div className={`rounded-xl px-3 py-2 ring-1 ${tom === 'total' ? 'bg-slate-50 ring-slate-300' : 'ring-slate-200'}`}>
      <p className="text-xs text-slate-500">{rotulo}</p>
      <p className={`text-base font-semibold ${cor}`}>
        {tom === 'negativo' ? '− ' : ''}
        {moeda(valor ?? 0)}
      </p>
    </div>
  );
}
