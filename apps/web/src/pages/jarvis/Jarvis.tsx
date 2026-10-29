/**
 * JARVIS — o painel do gestor (só ADMIN). docs/JARVIS.md
 *
 * Tela à parte do resto do sistema: escura, feita como painel de instrumento. Entra-se
 * pela porta (Entrada.tsx) e aqui dentro o assunto é um só — onde está o caixa livre no
 * caminho de R$ 1 milhão e o que fazer agora.
 *
 * Os blocos se ordenam pelo conteúdo: o que tem informação sobe, o que está vazio desce.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Bot, Clock, Landmark, RefreshCw, Settings, Target, TrendingUp, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { CartaoSugestao, type SugestaoJarvis } from '@/components/dashboard/SugestoesJarvis';
import ChatJarvis from '@/components/dashboard/ChatJarvis';
import { dataHora, moeda, percentual } from '@/lib/format';
import Entrada from './Entrada';
import { Cartao, Divisor, Numero, Vazio } from './pecas';
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

/**
 * O aparelho onde o JARVIS atende.
 *
 * O chat é o mesmo componente do dashboard — aqui ele ganha corpo: bisel de
 * grafite, vidro embutido, câmera e barra de status. Nenhuma imagem: tudo é
 * desenhado em CSS, para ficar nítido em qualquer tela.
 */
function Tablet({ children }: { children: ReactNode }) {
  const [hora, setHora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="jv-tablet">
      <span className="jv-tablet-camera" aria-hidden>
        <i />
        <i />
      </span>
      <div className="jv-tablet-vidro">
        <div className="jv-tablet-barra">
          <span>
            <b>JARVIS</b> · Balão da Informática
          </span>
          <span className="flex items-center gap-2">
            <span className="jv-num">{hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            <span className="jv-tablet-ponto vivo" aria-hidden />
            <span>agente ativo</span>
          </span>
        </div>
        {children}
      </div>
      <div className="jv-tablet-home" aria-hidden />
    </div>
  );
}

export default function Jarvis() {
  const { token, usuario } = useAuth();
  const [dentro, setDentro] = useState(false);

  // a porta só some quando o gestor entra; quem desloga volta para ela
  useEffect(() => {
    if (!token || usuario?.perfil !== 'ADMIN') setDentro(false);
  }, [token, usuario?.perfil]);

  if (!dentro) return <Entrada aoEntrar={() => setDentro(true)} />;
  return <PainelJarvis aoSair={() => setDentro(false)} />;
}

function PainelJarvis({ aoSair }: { aoSair: () => void }) {
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

  const cardSugestoes = (
    <Cartao
      titulo="O que fazer agora"
      descricao={p ? `${p.sugestoes.length} sugestão(ões) aberta(s)${p.emJogo ? ` · ${moeda(p.emJogo)} em jogo` : ''}` : undefined}
      icone={<Bot className="h-4 w-4" />}
      destaque={temSugestoes}
    >
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-20 animate-pulse rounded-xl" style={{ background: 'var(--jv-superficie)' }} />
          <div className="h-20 animate-pulse rounded-xl" style={{ background: 'var(--jv-superficie)' }} />
        </div>
      ) : !temSugestoes ? (
        <Vazio
          titulo="Nada pendente por aqui"
          descricao="Quando o JARVIS achar dinheiro parado, conta vencida ou consignado chegando no prazo, aparece aqui."
        />
      ) : (
        <div className="space-y-2">
          {p!.sugestoes.map((s) => (
            <CartaoSugestao key={s.id} s={s} decidindo={decidirM.isPending} decidir={(id, o) => decidirM.mutate({ id, o })} />
          ))}
        </div>
      )}
    </Cartao>
  );

  const cardEvolucao = (
    <div className="space-y-4">
      <FiltroPeriodo id="periodo-jarvis" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
      <Cartao titulo="Evolução do caixa livre" descricao={faixa} icone={<TrendingUp className="h-4 w-4" />}>
        {!temEvolucao ? (
          <Vazio titulo="Ainda sem histórico" descricao="O JARVIS grava uma medição a cada 30 minutos; em algumas horas o gráfico aparece." />
        ) : (
          <div className="h-52 sm:h-64">
            <ResponsiveContainer>
              <AreaChart data={serie} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="jvArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e39b3c" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#e39b3c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1d3344" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: '#7d97ac' }} axisLine={false} tickLine={false} minTickGap={12} />
                <YAxis
                  tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                  tick={{ fontSize: 11, fill: '#7d97ac' }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip
                  contentStyle={{ background: '#13222e', border: '1px solid #2a4a61', borderRadius: 10, color: '#e4edf4' }}
                  labelStyle={{ color: '#7d97ac' }}
                  formatter={(v: any) => [moeda(Number(v) || 0), 'Caixa livre'] as [string, string]}
                />
                <Area type="monotone" dataKey="caixaLivre" stroke="#e39b3c" fill="url(#jvArea)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Cartao>
    </div>
  );

  const cardContas = (
    <Cartao titulo="De onde sai o caixa livre" icone={<Landmark className="h-4 w-4" />}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Linha rotulo="Saldo dos bancos" valor={p?.saldoBancos} tom="bom" />
        <Linha rotulo="Caixa da loja" valor={p?.saldoCaixa} tom="bom" />
        <Linha rotulo="Contas a pagar em 30 dias" valor={p?.aPagar30d} tom="ruim" />
        <Linha rotulo="Caixinhas a usar em 30 dias" valor={p?.caixinhasDevidas} tom="ruim" />
        <Linha rotulo="Empréstimos que vencem em 30 dias" valor={p?.emprestimos30d} tom="ruim" />
        <Linha rotulo="= Caixa livre" valor={p?.caixaLivre} tom="total" />
      </div>
      <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--jv-apagado)' }}>
        O caixa livre olha os próximos 30 dias — é com ele que dá para decidir hoje. Caixinha usada nesse prazo entra
        inteira; as mais distantes entram só pelo que já deveria estar guardado. O que vem depois (
        {moeda(p?.caixinhasFuturas ?? 0)} de caixinhas e {moeda(p?.emprestimosDepois ?? 0)} de empréstimos) está nos
        compromissos totais, lá em cima.
      </p>
    </Cartao>
  );

  const cardPlacar = (
    <Cartao titulo="Placar do JARVIS" descricao="O que ele estimou × o que entrou de verdade" icone={<Clock className="h-4 w-4" />}>
      {!temPlacar ? (
        <Vazio titulo="Sem medições ainda" descricao="Sete dias depois de aceitar uma sugestão, o JARVIS confere quanto ela rendeu." />
      ) : (
        <div className="space-y-2">
          <p className="text-sm" style={{ color: 'var(--jv-suave)' }}>
            {placar!.aceitas} aceita(s) · {placar!.recusadas} recusada(s) · estimado {moeda(placar!.estimado)} · medido{' '}
            {moeda(placar!.real)}
            {placar!.acerto !== null && ` · acerto ${placar!.acerto}%`}
          </p>
          {placar!.medidas.slice(0, 6).map((m, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0c1620', border: '1px solid var(--jv-linha)' }}
            >
              <span className="min-w-0 flex-1 truncate">{m.titulo}</span>
              <span className="jv-num" style={{ color: 'var(--jv-suave)' }}>
                {moeda(m.impactoEstimado ?? 0)} →{' '}
                <strong style={{ color: (m.resultadoReal ?? 0) >= 0 ? 'var(--jv-menta)' : 'var(--jv-coral)' }}>
                  {moeda(m.resultadoReal ?? 0)}
                </strong>
              </span>
            </div>
          ))}
        </div>
      )}
    </Cartao>
  );

  const blocosComConteudo = [
    { chave: 'sugestoes', tem: temSugestoes, conteudo: cardSugestoes },
    { chave: 'evolucao', tem: temEvolucao, conteudo: cardEvolucao },
    { chave: 'contas', tem: !!p, conteudo: cardContas },
    { chave: 'placar', tem: temPlacar, conteudo: cardPlacar },
  ];
  const cheios = blocosComConteudo.filter((b) => b.tem);
  const vazios = blocosComConteudo.filter((b) => !b.tem);

  const blocos = [
    ...cheios.slice(0, 1),
    { chave: 'chat', conteudo: <Tablet><ChatJarvis /></Tablet> },
    ...cheios.slice(1),
    ...(vazios.length ? [{ chave: 'divisor', conteudo: <Divisor titulo="Ainda sem dados" dica="assim que houver, sobem" /> }] : []),
    ...vazios,
  ];

  return (
    <div className="jv jv-tela jv-grade">
      <div className="relative mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* cabeçalho */}
        <header className="jv-acende mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
              <Bot className="h-6 w-6" style={{ color: 'var(--jv-cobre)' }} />
              JARVIS
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--jv-suave)' }}>
              {p?.ultimaRodadaEm ? `última olhada ${dataHora(p.ultimaRodadaEm)}` : 'o caminho até R$ 1 milhão livres no caixa'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p && !p.ia.ligada && (
              <span
                className="rounded-full px-3 py-1 text-xs"
                style={{ background: 'rgba(227,155,60,.12)', color: 'var(--jv-cobre)', border: '1px solid rgba(227,155,60,.3)' }}
              >
                IA desligada
              </span>
            )}
            <button type="button" className="jv-btn jv-btn-quieto" disabled={rodar.isPending} onClick={() => rodar.mutate()}>
              <RefreshCw className={`h-4 w-4 ${rodar.isPending ? 'animate-spin' : ''}`} />
              Rodar agora
            </button>
            <button type="button" className="jv-btn jv-btn-quieto" onClick={() => nav('/configuracoes/jarvis')}>
              <Settings className="h-4 w-4" />
              Ajustes
            </button>
            <button type="button" className="jv-btn jv-btn-quieto" onClick={aoSair} title="Voltar para a porta">
              <ArrowLeft className="h-4 w-4" />
              Sair
            </button>
          </div>
        </header>

        {/* o instrumento principal */}
        <div className="jv-acende jv-card jv-card-destaque mb-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm" style={{ color: 'var(--jv-suave)' }}>
                Caixa livre hoje
              </p>
              <p
                className="jv-num mt-1 text-4xl font-semibold sm:text-5xl"
                style={{ color: (p?.caixaLivre ?? 0) >= 0 ? 'var(--jv-menta)' : 'var(--jv-coral)' }}
              >
                {isLoading ? '—' : moeda(p?.caixaLivre ?? 0)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm" style={{ color: 'var(--jv-suave)' }}>
                falta para o milhão
              </p>
              <p className="jv-num mt-1 text-2xl font-semibold" style={{ color: 'var(--jv-cobre)' }}>
                {isLoading ? '—' : moeda(p?.falta ?? 0)}
              </p>
            </div>
          </div>

          <div className="jv-trilho mt-5">
            <i style={{ width: `${Math.max(0, Math.min(100, p?.percentual ?? 0))}%` }} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: 'var(--jv-suave)' }}>
            <span>{p ? `${percentual(p.percentual)} de ${moeda(p.meta)}` : ''}</span>
            <span>
              {p ? (
                <>
                  precisa entrar{' '}
                  <strong className="jv-num" style={{ color: 'var(--jv-texto)' }}>
                    {moeda(p.porDiaUtil)}
                  </strong>{' '}
                  por dia útil
                </>
              ) : null}
            </span>
          </div>
        </div>

        {/* números de apoio */}
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Numero rotulo="Bancos + caixa" valor={moeda((p?.saldoBancos ?? 0) + (p?.saldoCaixa ?? 0))} carregando={isLoading} tom="bom" />
          <Numero rotulo="A pagar em 30 dias" valor={moeda(p?.aPagar30d ?? 0)} carregando={isLoading} tom="ruim" />
          <Numero rotulo="Empréstimos no mês" valor={moeda(p?.emprestimos30d ?? 0)} carregando={isLoading} tom="ruim" />
          <Numero
            rotulo="Compromissos totais"
            valor={moeda(p?.compromissosTotais ?? 0)}
            carregando={isLoading}
            tom={(p?.compromissosTotais ?? 0) >= 0 ? 'neutro' : 'ruim'}
            sub="com o que vem depois dos 30 dias"
          />
        </div>

        <div className="space-y-5">
          {blocos.map((b) => (
            <div key={b.chave}>{b.conteudo}</div>
          ))}
        </div>

        <p className="py-8 text-center text-xs" style={{ color: 'var(--jv-apagado)' }}>
          O JARVIS calcula e sugere. Quem decide onde colocar o dinheiro é você.
        </p>
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, tom }: { rotulo: string; valor?: number; tom: 'bom' | 'ruim' | 'total' }) {
  const cor = tom === 'ruim' ? 'var(--jv-coral)' : tom === 'total' ? 'var(--jv-texto)' : 'var(--jv-menta)';
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        background: tom === 'total' ? 'rgba(227,155,60,.07)' : '#0c1620',
        border: `1px solid ${tom === 'total' ? 'rgba(227,155,60,.3)' : 'var(--jv-linha)'}`,
      }}
    >
      <p className="text-xs" style={{ color: 'var(--jv-suave)' }}>
        {rotulo}
      </p>
      <p className="jv-num mt-0.5 text-lg font-semibold" style={{ color: cor }}>
        {tom === 'ruim' ? '− ' : ''}
        {moeda(valor ?? 0)}
      </p>
    </div>
  );
}
