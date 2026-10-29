/**
 * Peças compartilhadas do "Meu Dashboard" (vendedor, técnico, gerente e gestor):
 * cabeçalho com saudação, barra "ver como", alertas com botão Corrija, lembretes, meta e ranking.
 * Tudo no estilo V18 / Power BI já usado nos outros dashboards.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { AlertOctagon, AlertTriangle, Bell, Check, CheckCircle2, ChevronDown, ChevronRight, Crown, Eye, Info as InfoIcon, Plus, Send, Target, Trash2, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, EmptyState, Input, Select, Skeleton } from '@/components/ui';
import { Aparecer, Avatar, BarraAnimada, CardV18, LinhaV18, listaVariants } from '@/components/dashboard/v18';
import { data as fmtData, hoje, inteiro, moeda, numero } from '@/lib/format';
import type { AlertaDashboard, EquipeUsuario, Lembrete, MetaPainel, Perfil } from '@/types';

export const NOME_PERFIL: Record<Perfil, string> = { ADMIN: 'Gestor', GERENTE: 'Gerente', VENDEDOR: 'Vendedor', TECNICO: 'Técnico', FINANCEIRO: 'Financeiro' };

// =====================================================================================
// Cabeçalho
// =====================================================================================
export function Cabecalho({ nome, descricao, acoes }: { nome?: string; descricao: ReactNode; acoes?: ReactNode }) {
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const extenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <Aparecer className="flex flex-wrap items-end justify-between gap-2 sm:gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-400">{extenso.charAt(0).toUpperCase() + extenso.slice(1)}</p>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {saudacao}, {nome?.split(' ')[0]} <motion.span className="inline-block origin-[70%_70%]" animate={{ rotate: [0, 14, -8, 14, 0] }} transition={{ duration: 1.4, delay: 0.4 }}>👋</motion.span>
        </h1>
        <p className="hidden text-sm text-slate-500 sm:block">{descricao}</p>
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </Aparecer>
  );
}

// =====================================================================================
// "Ver como" — gestor/gerente abrem o dashboard de alguém da equipe
// =====================================================================================
export function VerComo({ atual, onMudar, verComo }: { atual: number | null; onMudar: (usuarioId: number | null) => void; verComo?: { nome: string; perfil: Perfil } | null }) {
  const gestor = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const { data: equipe } = useQuery({ queryKey: ['meu-dashboard-equipe'], queryFn: () => api.get<EquipeUsuario[]>('/meu-dashboard/equipe'), enabled: gestor, staleTime: 5 * 60_000, retry: 0 });
  if (!gestor) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        className="w-full sm:w-64"
        value={atual ?? ''}
        onChange={(e) => onMudar(e.target.value ? Number(e.target.value) : null)}
        opcoes={[{ valor: '', rotulo: '👁 Ver como… (meu dashboard)' }, ...(equipe ?? []).map((u) => ({ valor: u.id, rotulo: `${u.nome} · ${NOME_PERFIL[u.perfil]}` }))]}
      />
      {verComo && (
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
          <Eye className="h-3.5 w-3.5" /> Vendo como {verComo.nome} ({NOME_PERFIL[verComo.perfil]}) — exatamente o que ele vê
          <button type="button" onClick={() => onMudar(null)} className="ml-1 rounded-full p-0.5 hover:bg-amber-100" aria-label="Voltar ao meu dashboard">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}

// =====================================================================================
// Alertas do sistema com botão "Corrija"
// =====================================================================================
const NIVEL = {
  erro: { icone: <AlertOctagon className="h-4 w-4 text-red-600" />, borda: 'border-l-red-500', fundo: 'bg-red-50/40' },
  aviso: { icone: <AlertTriangle className="h-4 w-4 text-amber-600" />, borda: 'border-l-amber-500', fundo: 'bg-amber-50/40' },
  info: { icone: <InfoIcon className="h-4 w-4 text-sky-600" />, borda: 'border-l-sky-500', fundo: '' },
};

export function AlertasCorrija({ alertas, carregando, titulo = 'Alertas do sistema', descricao }: { alertas?: AlertaDashboard[]; carregando?: boolean; titulo?: string; descricao?: string }) {
  const nav = useNavigate();
  const [aberto, setAberto] = useState<string | null>(null);
  const erros = alertas?.filter((a) => a.nivel === 'erro').length ?? 0;
  return (
    <CardV18
      titulo={titulo}
      descricao={descricao ?? (carregando ? 'Conferindo…' : !alertas?.length ? 'Tudo em dia' : `${alertas.length} ${alertas.length === 1 ? 'pendência' : 'pendências'}${erros ? ` · ${erros} para corrigir agora` : ''}`)}
      icone={<Bell className="h-4 w-4" />}
      tom={erros ? 'vermelho' : alertas?.length ? 'amarelo' : 'verde'}
      semPadding
    >
      {carregando ? (
        <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : !alertas?.length ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-emerald-700 sm:px-5">
          <CheckCircle2 className="h-4 w-4" /> Nenhuma pendência. Tudo preenchido e em dia.
        </div>
      ) : (
        <motion.ul className="divide-y divide-slate-100" variants={listaVariants} initial="oculto" animate="visivel">
          {alertas.map((a) => {
            const n = NIVEL[a.nivel];
            const expandido = aberto === a.id;
            return (
              <motion.li key={a.id} variants={{ oculto: { opacity: 0, x: -8 }, visivel: { opacity: 1, x: 0 } }} className={clsx('border-l-4', n.borda, n.fundo)}>
                <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
                  <span className="mt-0.5 shrink-0">{n.icone}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{a.titulo}</p>
                    <p className="text-xs text-slate-500">{a.mensagem}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {a.qtd > 1 && a.itens.length > 0 && (
                      <Button tamanho="xs" variante="fantasma" onClick={() => setAberto(expandido ? null : a.id)} icone={expandido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}>
                        {a.qtd}
                      </Button>
                    )}
                    <Button tamanho="xs" variante={a.nivel === 'erro' ? 'primario' : 'secundario'} onClick={() => nav(a.link)}>
                      {a.botao}
                    </Button>
                  </div>
                </div>
                {expandido && (
                  <ul className="mb-2 ml-10 mr-3 space-y-1 sm:ml-11">
                    {a.itens.map((i) => (
                      <li key={i.link + i.rotulo}>
                        <Link to={i.link} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                          <span className="truncate">{i.rotulo}</span>
                          <span className="shrink-0 font-semibold text-brand-600">{a.botao} →</span>
                        </Link>
                      </li>
                    ))}
                    {a.qtd > a.itens.length && (
                      <li>
                        <Link to={a.link} className="block px-3 py-1 text-xs text-slate-500 hover:underline">… e mais {a.qtd - a.itens.length}. Ver todos</Link>
                      </li>
                    )}
                  </ul>
                )}
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </CardV18>
  );
}

// =====================================================================================
// Lembretes
// =====================================================================================
export function Lembretes({ lembretes, carregando, usuarioId, verComo }: { lembretes?: Lembrete[]; carregando?: boolean; /** de quem é o dashboard (ver como) */ usuarioId?: number | null; verComo?: boolean }) {
  const qc = useQueryClient();
  const eu = useAuth((s) => s.usuario);
  const gestor = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const [novo, setNovo] = useState('');
  const [quando, setQuando] = useState(hoje());
  const [para, setPara] = useState<number | ''>('');
  const { data: equipe } = useQuery({ queryKey: ['meu-dashboard-equipe'], queryFn: () => api.get<EquipeUsuario[]>('/meu-dashboard/equipe'), enabled: gestor, staleTime: 5 * 60_000, retry: 0 });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['meu-dashboard'] });
    qc.invalidateQueries({ queryKey: ['lembretes'] });
  };
  const criar = useMutation({
    mutationFn: () => api.post('/lembretes', { titulo: novo.trim(), data: quando, paraUsuarioId: verComo && usuarioId ? usuarioId : para || undefined }),
    onSuccess: () => {
      toast.success(para || (verComo && usuarioId) ? 'Lembrete enviado.' : 'Lembrete salvo.');
      setNovo('');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const acao = useMutation({
    mutationFn: ({ id, tipo }: { id: number; tipo: 'concluir' | 'reabrir' | 'excluir' }) => (tipo === 'excluir' ? api.del(`/lembretes/${id}`) : api.post(`/lembretes/${id}/${tipo}`, {})),
    onSuccess: invalidar,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const atrasados = lembretes?.filter((l) => l.situacao === 'ATRASADO').length ?? 0;
  const deHoje = lembretes?.filter((l) => l.situacao === 'HOJE').length ?? 0;
  return (
    <CardV18
      titulo="Lembretes"
      descricao={carregando ? '…' : !lembretes?.length ? 'Nada pendente' : [atrasados ? `${atrasados} atrasado${atrasados > 1 ? 's' : ''}` : '', deHoje ? `${deHoje} para hoje` : ''].filter(Boolean).join(' · ') || `${lembretes.length} ${lembretes.length === 1 ? 'pendente' : 'pendentes'}`}
      icone={<Bell className="h-4 w-4" />}
      tom={atrasados ? 'vermelho' : deHoje ? 'amarelo' : 'azul'}
      semPadding
    >
      <ul className="divide-y divide-slate-100">
        {carregando && <li className="p-4"><Skeleton className="h-16" /></li>}
        {!carregando && !lembretes?.length && <li className="px-4 py-3 text-sm text-slate-500">Nenhum lembrete. Escreva um abaixo — ele fica aqui até você marcar como feito.</li>}
        {lembretes?.map((l) => (
          <li key={l.id} className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
            <button
              type="button"
              onClick={() => acao.mutate({ id: l.id, tipo: l.concluidoEm ? 'reabrir' : 'concluir' })}
              className={clsx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition', l.concluidoEm ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 hover:border-brand-500')}
              aria-label={l.concluidoEm ? 'Reabrir' : 'Marcar como feito'}
            >
              {l.concluidoEm ? <Check className="h-3 w-3" /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p className={clsx('text-sm text-slate-800', l.concluidoEm && 'line-through text-slate-400')}>
                {l.link ? <Link to={l.link} className="hover:underline">{l.titulo}</Link> : l.titulo}
              </p>
              <p className="text-[11px] text-slate-500">
                <span className={clsx('font-semibold', l.situacao === 'ATRASADO' ? 'text-red-600' : l.situacao === 'HOJE' ? 'text-amber-600' : 'text-slate-500')}>
                  {l.situacao === 'ATRASADO' ? 'Atrasado · ' : l.situacao === 'HOJE' ? 'Hoje' : fmtData(l.data)}
                  {l.situacao === 'ATRASADO' && fmtData(l.data)}
                </span>
                {l.criadoPor && l.criadoPor.id !== l.paraUsuarioId && <> · de {l.criadoPor.nome}</>}
                {l.descricao && <> · {l.descricao}</>}
              </p>
            </div>
            <button type="button" onClick={() => acao.mutate({ id: l.id, tipo: 'excluir' })} className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-red-600" aria-label="Excluir lembrete">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-3 py-2.5 sm:px-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (novo.trim().length >= 2) criar.mutate();
        }}
      >
        <Input className="min-w-0 flex-1 basis-full sm:basis-auto" placeholder={verComo && usuarioId ? 'Mandar um lembrete para esta pessoa…' : 'Novo lembrete (ex.: ligar para o cliente do notebook)'} value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Input type="date" className="w-36" value={quando} onChange={(e) => setQuando(e.target.value)} />
        {gestor && !verComo && (
          <Select className="w-40" value={para} onChange={(e) => setPara(e.target.value ? Number(e.target.value) : '')} opcoes={[{ valor: '', rotulo: 'Para mim' }, ...(equipe ?? []).filter((u) => u.id !== eu?.id).map((u) => ({ valor: u.id, rotulo: u.nome }))]} />
        )}
        <Button type="submit" tamanho="sm" variante="primario" carregando={criar.isPending} icone={para || (verComo && usuarioId) ? <Send className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}>
          {para || (verComo && usuarioId) ? 'Enviar' : 'Adicionar'}
        </Button>
      </form>
    </CardV18>
  );
}

// =====================================================================================
// Meta do mês (vendedor: R$ vendido · técnico: R$ de OS ou nº de OS)
// =====================================================================================
const RITMO: Record<MetaPainel['ritmo'], { cor: string; texto: string; rotulo: string }> = {
  batida: { cor: '#16a34a', texto: 'text-emerald-700', rotulo: 'Meta batida! 🎉' },
  ok: { cor: '#16a34a', texto: 'text-emerald-700', rotulo: 'No ritmo' },
  atencao: { cor: '#f59e0b', texto: 'text-amber-700', rotulo: 'Um pouco atrás' },
  atrasado: { cor: '#dc2626', texto: 'text-red-700', rotulo: 'Bem atrás do ritmo' },
  'sem-meta': { cor: '#94a3b8', texto: 'text-slate-500', rotulo: 'Sem meta' },
};

export function MetaDoMes({
  meta,
  formato,
  rotuloMeta,
  rotuloAtingido = 'realizado',
  descricao,
  carregando,
  className,
}: {
  meta?: Pick<MetaPainel, 'valor' | 'vendido' | 'pct' | 'falta' | 'diasRestantes' | 'porDia' | 'esperadoAteHoje' | 'ritmo' | 'competencia' | 'bonusDesafios'>;
  formato: (n: number) => string;
  rotuloMeta: string;
  rotuloAtingido?: string;
  descricao?: ReactNode;
  carregando?: boolean;
  className?: string;
}) {
  const r = meta ? RITMO[meta.ritmo] : RITMO['sem-meta'];
  const esperadoPct = meta && meta.valor ? Math.min(100, (meta.esperadoAteHoje / meta.valor) * 100) : 0;
  return (
    <CardV18 titulo={rotuloMeta} descricao={descricao} icone={<Target className="h-4 w-4" />} tom={meta?.ritmo === 'batida' || meta?.ritmo === 'ok' ? 'verde' : meta?.ritmo === 'atencao' ? 'amarelo' : meta?.ritmo === 'atrasado' ? 'vermelho' : 'neutro'} className={className}>
      {carregando || !meta ? (
        <Skeleton className="h-24" />
      ) : !meta.valor ? (
        <EmptyState compacto icone={<Target className="h-5 w-5" />} titulo="Meta ainda não definida" descricao="A gestão define a meta em Metas e desafios." />
      ) : (
        <div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-2xl font-bold tracking-tight text-slate-900 num sm:text-3xl">{formato(meta.vendido)}</p>
              <p className="text-xs text-slate-500">{rotuloAtingido} de <span className="font-medium text-slate-700 num">{formato(meta.valor)}</span></p>
            </div>
            <div className="text-right">
              <p className={clsx('text-2xl font-bold num sm:text-3xl', r.texto)}>{numero(meta.pct, 1)}%</p>
              <p className={clsx('text-xs font-semibold', r.texto)}>{r.rotulo}</p>
            </div>
          </div>
          <div className="relative mt-3">
            <BarraAnimada pct={meta.pct} cor={r.cor} className="h-3" />
            {meta.ritmo !== 'batida' && <div className="absolute inset-y-0 w-0.5 bg-slate-500/70" style={{ left: `${esperadoPct}%` }} title={`Esperado até hoje: ${formato(meta.esperadoAteHoje)}`} />}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
            <Info rotulo="Falta" valor={formato(meta.falta)} />
            <Info rotulo="Precisa por dia" valor={meta.falta > 0 ? formato(meta.porDia) : '—'} />
            <Info rotulo="Dias restantes" valor={inteiro(meta.diasRestantes)} />
            <Info rotulo="Esperado até hoje" valor={formato(meta.esperadoAteHoje)} />
          </div>
          {meta.bonusDesafios > 0 && <p className="mt-2 text-xs font-medium text-emerald-700">+ {moeda(meta.bonusDesafios)} em prêmios de desafios este mês</p>}
        </div>
      )}
    </CardV18>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className="truncate text-sm font-semibold text-slate-800 num">{valor}</p>
    </div>
  );
}

// =====================================================================================
// Ranking do mês
// =====================================================================================
export function RankingDoMes({
  posicao,
  total,
  lista,
  rodape,
  titulo = 'Ranking do mês',
  formato = moeda,
  carregando,
}: {
  posicao?: number;
  total?: number;
  lista?: { posicao: number; nome: string; eu: boolean; valor: number | null }[];
  rodape?: ReactNode;
  titulo?: string;
  formato?: (n: number) => string;
  carregando?: boolean;
}) {
  const lider = lista?.find((l) => l.valor !== null)?.valor ?? 0;
  return (
    <CardV18 titulo={titulo} icone={<Crown className="h-4 w-4" />} tom="amarelo" semPadding>
      {carregando || !lista ? (
        <div className="p-4"><Skeleton className="h-24" /></div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
            <span className="text-3xl font-extrabold text-slate-900 num">{posicao}º</span>
            <div className="text-xs text-slate-500">
              de {total} na equipe
              {rodape && <p className="mt-0.5 font-medium text-slate-700">{rodape}</p>}
              {posicao === 1 && lider > 0 && <p className="mt-0.5 font-medium text-emerald-700">Você está na frente! 🥇</p>}
            </div>
          </div>
          <motion.ol className="max-h-64 overflow-y-auto px-2 pb-2" variants={listaVariants} initial="oculto" animate="visivel">
            {lista.map((r, i) => (
              <LinhaV18 key={r.posicao} className={clsx(r.eu && 'bg-brand-50/60')}>
                <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', r.posicao === 1 ? 'bg-amber-400 text-white' : r.posicao === 2 ? 'bg-slate-300 text-white' : r.posicao === 3 ? 'bg-orange-300 text-white' : 'bg-slate-100 text-slate-500')}>{r.posicao}</span>
                <Avatar nome={r.nome} indice={i} className="h-7 w-7" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={clsx('truncate text-sm text-slate-800', r.eu && 'font-semibold')}>{r.nome}{r.eu && ' (você)'}</span>
                    {r.valor !== null && <span className="num shrink-0 text-xs text-slate-500">{formato(r.valor)}</span>}
                  </div>
                  {r.valor !== null && lider > 0 && <BarraAnimada pct={(r.valor / lider) * 100} cor={r.eu ? '#dc2626' : '#cbd5e1'} className="mt-1 h-1" />}
                </div>
              </LinhaV18>
            ))}
          </motion.ol>
        </>
      )}
    </CardV18>
  );
}
