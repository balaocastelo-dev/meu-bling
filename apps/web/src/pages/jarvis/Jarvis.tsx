/**
 * JARVIS — painel do gestor (só ADMIN). docs/JARVIS.md
 * Caixa livre de hoje, quanto falta para R$ 1 milhão, o ritmo por dia útil, a evolução,
 * o feed de sugestões com Aceitar/Adiar/Recusar, o modo pergunta e o placar do JARVIS.
 * Estilo V18/Power BI: o mais importante no topo, detalhes embaixo.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, Clock, Landmark, RefreshCw, Send, Settings, Target, TrendingUp, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, EmptyState, Input, Skeleton } from '@/components/ui';
import { Aparecer, CardV18, FaixaKpis, KpiV18, PaginaV18, SecaoDetalhes, listaVariants } from '@/components/dashboard/v18';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { CORES, TooltipPadrao, eixoMoeda } from '@/components/compartilhados/graficos';
import { CartaoSugestao, type SugestaoJarvis } from '@/components/dashboard/SugestoesJarvis';
import { dataHora, moeda, percentual } from '@/lib/format';

interface Painel {
  caixaLivre: number;
  saldoBancos: number;
  saldoCaixa: number;
  aPagar30d: number;
  caixinhas: number;
  emprestimos: number;
  meta: number;
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

interface Placar {
  aceitas: number;
  recusadas: number;
  abertas: number;
  estimado: number;
  real: number;
  acerto: number | null;
  medidas: { regra: string; titulo: string; impactoEstimado: number | null; resultadoReal: number | null }[];
}

export default function Jarvis() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard('30d');
  const [pergunta, setPergunta] = useState('');
  const [resposta, setResposta] = useState<string | null>(null);

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
      api.post(`/jarvis/sugestoes/${id}/${o}`, o === 'adiar' ? { dias: 7 } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
      qc.invalidateQueries({ queryKey: ['jarvis-placar'] });
      qc.invalidateQueries({ queryKey: ['jarvis-feed'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const perguntar = useMutation({
    mutationFn: () => api.post<{ resposta: string }>('/jarvis/perguntar', { pergunta }),
    onSuccess: (r) => {
      setResposta(r.resposta);
      setPergunta('');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const serie = evo?.serie ?? [];

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

      {/* ===== o número principal ===== */}
      <FaixaKpis colunas={4}>
        <KpiV18
          destaque
          className="col-span-2"
          rotulo="Caixa livre hoje"
          valor={p?.caixaLivre}
          formato={moeda}
          anterior={p && p.variacao7d !== null ? p.caixaLivre - p.variacao7d : undefined}
          icone={<Wallet className="h-4 w-4" />}
          tom={p && p.caixaLivre > 0 ? 'verde' : 'vermelho'}
          carregando={isLoading}
          sub={p ? `${percentual(p.percentual)} da meta de ${moeda(p.meta)}` : undefined}
        />
        <KpiV18
          rotulo="Falta para o milhão"
          valor={p?.falta}
          formato={moeda}
          icone={<Target className="h-4 w-4" />}
          tom="azul"
          carregando={isLoading}
          sub={p ? `em ${p.diasUteis} dias úteis` : undefined}
        />
        <KpiV18
          rotulo="Precisa entrar por dia útil"
          valor={p?.porDiaUtil}
          formato={moeda}
          icone={<TrendingUp className="h-4 w-4" />}
          tom="amarelo"
          carregando={isLoading}
          sub={p?.emJogo ? `${moeda(p.emJogo)} em jogo nas sugestões` : undefined}
        />
      </FaixaKpis>

      {/* ===== sugestões: o que fazer agora ===== */}
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
        ) : (p?.sugestoes.length ?? 0) === 0 ? (
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

      {/* ===== modo pergunta ===== */}
      <CardV18 titulo="Perguntar ao JARVIS" descricao="Ex.: o que faço com R$ 20 mil que entraram hoje?" icone={<Send className="h-4 w-4" />}>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="min-w-0 flex-1"
            label="Sua pergunta"
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pergunta.trim().length > 2) perguntar.mutate();
            }}
            placeholder="O que faço com o dinheiro que entrou hoje?"
          />
          <Button
            variante="primario"
            icone={<Send className="h-4 w-4" />}
            carregando={perguntar.isPending}
            disabled={pergunta.trim().length < 3}
            onClick={() => perguntar.mutate()}
          >
            Perguntar
          </Button>
        </div>
        {resposta && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-200">{resposta}</p>}
      </CardV18>

      <SecaoDetalhes dica="role para ver a evolução e o placar" />

      {/* ===== evolução ===== */}
      <Aparecer className="flex flex-wrap items-end gap-2">
        <FiltroPeriodo id="periodo-jarvis" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
      </Aparecer>

      <CardV18 titulo="Evolução do caixa livre" descricao={faixa} icone={<TrendingUp className="h-4 w-4" />} tom="verde">
        {serie.length === 0 ? (
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

      {/* ===== de onde sai o número ===== */}
      <CardV18 titulo="De onde sai o caixa livre" icone={<Landmark className="h-4 w-4" />}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Conta rotulo="Saldo dos bancos" valor={p?.saldoBancos} tom="positivo" />
          <Conta rotulo="Caixa da loja" valor={p?.saldoCaixa} tom="positivo" />
          <Conta rotulo="A pagar nos próximos 30 dias" valor={p?.aPagar30d} tom="negativo" />
          <Conta rotulo="Ainda a guardar nas caixinhas" valor={p?.caixinhas} tom="negativo" />
          <Conta rotulo="Empréstimos a devolver" valor={p?.emprestimos} tom="negativo" />
          <Conta rotulo="= Caixa livre" valor={p?.caixaLivre} tom="total" />
        </div>
      </CardV18>

      {/* ===== placar ===== */}
      <CardV18 titulo="Placar do JARVIS" descricao="O que ele estimou × o que entrou de verdade" icone={<Clock className="h-4 w-4" />}>
        {!placar || placar.medidas.length === 0 ? (
          <EmptyState compacto titulo="Sem medições ainda" descricao="Sete dias depois de aceitar uma sugestão, o JARVIS confere quanto ela rendeu." />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              {placar.aceitas} aceita(s) · {placar.recusadas} recusada(s) · estimado {moeda(placar.estimado)} · medido {moeda(placar.real)}
              {placar.acerto !== null && ` · acerto ${placar.acerto}%`}
            </p>
            {placar.medidas.slice(0, 6).map((m, i) => (
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
    </PaginaV18>
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
