/**
 * ROBÔ DA SAÚDE (só ADMIN) — confere a Saúde do sistema 24h, corrige sozinho o que é seguro e deixa o resto
 * com o botão pronto para resolver com um clique.
 *   <SinoRobo />          sino no topo com o número de pendências
 *   <CardRoboSaude />     card do dashboard: % de saúde, o que precisa de você e o que ele corrigiu
 *   <ListaAvisosRobo />   a lista com os botões (usada no card, no sino e em Configurações → Saúde)
 */
import { useEffect, useRef, useState } from 'react';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Bell, Bot, CheckCircle2, ChevronRight, Info, Loader2, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, ConfirmDialog } from '@/components/ui';
import { dataHora } from '@/lib/format';

export interface AcaoRobo {
  codigo: string;
  rotulo: string;
  estilo?: 'primario' | 'sucesso' | 'secundario' | 'perigo';
  confirmar?: string;
  lote?: boolean;
}
export interface AvisoRobo {
  id: number;
  chave: string;
  tipo: 'CORRECAO' | 'SUGESTAO' | 'ALERTA';
  nivel: 'erro' | 'aviso' | 'info';
  area: string;
  titulo: string;
  mensagem: string;
  link: string | null;
  acoes: AcaoRobo[];
  status: string;
  lida: boolean;
  resolvidoPor: string | null;
  resolvidoEm: string | null;
  criadoEm: string;
}
export interface PainelRobo {
  config: { ligado: boolean; autoCorrigir: boolean };
  estado: { ultimaVez: string | null; saudePct: number; resumo: Record<string, number>; verificacoes: number; corrigidasNaRodada: number; origem: string; erro?: string | null } | null;
  rodando: boolean;
  intervaloMin: number;
  pendentes: number;
  sugestoesEmLote: number;
  naoLidas: number;
  corrigidasHoje: number;
  abertas: AvisoRobo[];
  correcoes: AvisoRobo[];
  resolvidasPorClique: AvisoRobo[];
}

export const CHAVE_ROBO = ['robo-saude'] as const;

export function useRoboSaude(ativo = true) {
  return useQuery({ queryKey: CHAVE_ROBO, queryFn: () => api.get<PainelRobo>('/robo-saude'), refetchInterval: 60_000, enabled: ativo });
}

function useAtualizarRobo() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: CHAVE_ROBO });
    void qc.invalidateQueries({ queryKey: ['robo-saude-contagem'] });
    void qc.invalidateQueries({ queryKey: ['diagnostico'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useRodarRobo() {
  const qc = useQueryClient();
  const atualizar = useAtualizarRobo();
  return useMutation({
    mutationFn: () => api.post<PainelRobo>('/robo-saude/rodar'),
    onSuccess: (p) => {
      qc.setQueryData(CHAVE_ROBO, p);
      atualizar();
      const n = p.estado?.corrigidasNaRodada ?? 0;
      toast.success(n ? `Robô corrigiu ${n} coisa${n > 1 ? 's' : ''} sozinho · saúde ${p.estado?.saudePct ?? 0}%` : `Conferido · saúde ${p.estado?.saudePct ?? 0}%`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
}

export function useResolverTudo() {
  const atualizar = useAtualizarRobo();
  return useMutation({
    mutationFn: () => api.post<{ resolvidas: number; falhas: string[] }>('/robo-saude/resolver-tudo'),
    onSuccess: (r) => {
      atualizar();
      if (r.resolvidas) toast.success(`${r.resolvidas} resolvida${r.resolvidas > 1 ? 's' : ''} de uma vez`);
      if (r.falhas.length) toast.error(`${r.falhas.length} não deu: ${r.falhas[0]}`);
      if (!r.resolvidas && !r.falhas.length) toast.info('Nada para resolver em lote agora.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
}

export const corSaude = (p: number) => (p >= 95 ? 'text-emerald-600' : p >= 80 ? 'text-amber-600' : 'text-red-600');
const traco = (p: number) => (p >= 95 ? '#059669' : p >= 80 ? '#d97706' : '#dc2626');

/** Anel com a % de saúde */
export function AnelSaude({ pct, tamanho = 64 }: { pct: number; tamanho?: number }) {
  const r = (tamanho - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} className="-rotate-90">
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="currentColor" strokeWidth={6} className="text-slate-100" />
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke={traco(pct)} strokeWidth={6} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .8s ease' }} />
      </svg>
      <span className={clsx('absolute inset-0 flex items-center justify-center font-bold tracking-tight num', corSaude(pct))} style={{ fontSize: Math.max(10, Math.round(tamanho * 0.19)) }}>{pct}%</span>
    </div>
  );
}

const ICONE = { erro: AlertOctagon, aviso: AlertTriangle, info: Info };
const COR = { erro: 'text-red-600', aviso: 'text-amber-600', info: 'text-sky-600' };

/** Lista de pendências com os botões de 1 clique */
export function ListaAvisosRobo({ avisos, compacto, limite, onFeito }: { avisos: AvisoRobo[]; compacto?: boolean; limite?: number; onFeito?: () => void }) {
  const atualizar = useAtualizarRobo();
  const [executando, setExecutando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ aviso: AvisoRobo; acao: AcaoRobo } | null>(null);

  const executar = async (a: AvisoRobo, acao: AcaoRobo) => {
    setExecutando(`${a.id}:${acao.codigo}`);
    try {
      const r = await api.post<{ texto: string }>(`/robo-saude/avisos/${a.id}/executar`, { acao: acao.codigo });
      toast.success(r.texto);
      atualizar();
      onFeito?.();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setExecutando(null);
    }
  };
  const ignorar = async (a: AvisoRobo) => {
    try {
      await api.post(`/robo-saude/avisos/${a.id}/ignorar`);
      toast.success('Ok, não aviso disso por 7 dias.');
      atualizar();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const lista = limite ? avisos.slice(0, limite) : avisos;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {lista.map((a) => {
          const I = ICONE[a.nivel] ?? Info;
          return (
            <li key={a.id} className={clsx('flex items-start gap-3', compacto ? 'px-3 py-2.5' : 'px-4 py-3')}>
              <I className={clsx('mt-0.5 h-4 w-4 shrink-0', COR[a.nivel])} />
              <div className="min-w-0 flex-1">
                <p className={clsx('break-words text-sm', a.nivel === 'erro' ? 'font-semibold text-red-800' : 'font-medium text-slate-800')}>{a.titulo}</p>
                {!compacto && <p className="mt-0.5 break-words text-xs text-slate-500"><TextoValores texto={a.mensagem} /></p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {a.acoes.map((ac) => (
                    <Button
                      key={ac.codigo}
                      tamanho="xs"
                      variante={ac.estilo ?? 'primario'}
                      icone={<Wand2 className="h-3 w-3" />}
                      carregando={executando === `${a.id}:${ac.codigo}`}
                      disabled={!!executando}
                      onClick={() => (ac.confirmar ? setConfirmar({ aviso: a, acao: ac }) : executar(a, ac))}
                    >
                      {ac.rotulo}
                    </Button>
                  ))}
                  {a.link && (
                    <Link to={a.link} className="inline-flex h-7 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-brand-700 hover:bg-brand-50">
                      Abrir <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                  {!compacto && (
                    <button onClick={() => ignorar(a)} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Não avisar disso por 7 dias">
                      <X className="h-3 w-3" /> Ignorar
                    </button>
                  )}
                </div>
              </div>
              {!compacto && <span className="hidden shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-400 sm:block">{a.area}</span>}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        aberto={!!confirmar}
        onFechar={() => setConfirmar(null)}
        onConfirmar={() => (confirmar ? executar(confirmar.aviso, confirmar.acao) : undefined)}
        titulo={confirmar?.acao.rotulo}
        descricao={confirmar?.acao.confirmar}
        textoConfirmar="Sim, fazer"
        perigo={confirmar?.acao.estilo === 'perigo'}
      />
    </>
  );
}

/** Lista do que o robô já corrigiu sozinho */
export function ListaCorrecoes({ itens, limite }: { itens: AvisoRobo[]; limite?: number }) {
  const lista = limite ? itens.slice(0, limite) : itens;
  if (!lista.length) return <p className="px-4 py-3 text-sm text-slate-500">Ainda não precisei corrigir nada.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {lista.map((c) => (
        <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-slate-700">
              {!c.lida && <span className="mr-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">novo</span>}
              {c.mensagem}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {dataHora(c.criadoEm)} · {c.area}
              {c.link && (
                <>
                  {' · '}
                  <Link to={c.link} className="text-brand-600 hover:underline">ver</Link>
                </>
              )}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Card do dashboard do ADMIN */
export function CardRoboSaude({ className }: { className?: string }) {
  const ehAdmin = useAuth((s) => s.usuario?.perfil === 'ADMIN');
  const { data: p } = useRoboSaude(ehAdmin);
  const rodar = useRodarRobo();
  const tudo = useResolverTudo();
  const qc = useQueryClient();
  const avisado = useRef(false);

  // notificação: avisa uma vez quando o robô corrigiu coisas desde a última vez que você viu
  useEffect(() => {
    if (!p || avisado.current || !p.naoLidas) return;
    avisado.current = true;
    toast(`🤖 Robô da Saúde corrigiu ${p.naoLidas} coisa${p.naoLidas > 1 ? 's' : ''} sozinho`, {
      description: p.correcoes.find((c) => !c.lida)?.mensagem,
      action: { label: 'Ok', onClick: () => void api.post('/robo-saude/marcar-lidas').then(() => qc.invalidateQueries({ queryKey: CHAVE_ROBO })) },
    });
  }, [p, qc]);

  if (!ehAdmin || !p) return null;
  const pct = p.estado?.saudePct ?? 100;
  const sugestoes = p.abertas;
  return (
    <div className={clsx('overflow-hidden rounded-2xl border bg-white shadow-card', pct >= 95 && !sugestoes.length ? 'border-emerald-200' : pct >= 80 ? 'border-amber-200' : 'border-red-200', className)}>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <AnelSaude pct={pct} tamanho={56} />
        <div className="min-w-0 flex-[1_1_10rem]">
          <p className="flex flex-wrap items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-slate-900">
            <Bot className="h-4 w-4 shrink-0 text-brand-600" /> Robô da Saúde
            {!p.config.ligado && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">desligado</span>}
          </p>
          <p className="text-xs text-slate-500">
            {sugestoes.length ? `${sugestoes.length} ${sugestoes.length > 1 ? 'coisas precisam' : 'coisa precisa'} de você` : 'Tudo em dia'}
            {p.corrigidasHoje > 0 && ` · corrigi ${p.corrigidasHoje} sozinho hoje`}
            {p.estado?.ultimaVez && ` · conferido ${dataHora(p.estado.ultimaVez)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.sugestoesEmLote > 1 && (
            <Button tamanho="sm" variante="sucesso" icone={<Sparkles className="h-3.5 w-3.5" />} carregando={tudo.isPending} onClick={() => tudo.mutate()}>
              Resolver {p.sugestoesEmLote} de uma vez
            </Button>
          )}
          <Button tamanho="sm" variante="secundario" icone={rodar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} onClick={() => rodar.mutate()} disabled={rodar.isPending}>
            Conferir agora
          </Button>
        </div>
      </div>
      {sugestoes.length ? (
        <ListaAvisosRobo avisos={sugestoes} compacto limite={5} />
      ) : (
        <p className="flex items-start gap-2 px-4 py-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Sistema 100%: nada para você resolver agora.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-xs">
        <span className="min-w-0 truncate text-slate-500">{p.correcoes[0] ? `Última correção: ${p.correcoes[0].mensagem}` : `Confiro a cada ${p.intervaloMin} min e logo depois de cada venda, pagamento ou NF.`}</span>
        <Link to="/configuracoes/saude" className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
          {sugestoes.length > 5 ? `Ver as ${sugestoes.length}` : 'Ver tudo'} <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

/** Sino do topo (só ADMIN): número de pendências e acesso rápido */
export function SinoRobo() {
  const ehAdmin = useAuth((s) => s.usuario?.perfil === 'ADMIN');
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: c } = useQuery({
    queryKey: ['robo-saude-contagem'],
    queryFn: () => api.get<{ pendentes: number; erros: number; naoLidas: number }>('/robo-saude/contagem'),
    enabled: ehAdmin,
    refetchInterval: 60_000,
  });
  const { data: p } = useRoboSaude(ehAdmin && aberto);
  const qc = useQueryClient();

  useEffect(() => {
    if (!aberto) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [aberto]);

  if (!ehAdmin) return null;
  const n = c?.pendentes ?? 0;
  const abrir = () => {
    setAberto((a) => !a);
    if (c?.naoLidas) void api.post('/robo-saude/marcar-lidas').then(() => qc.invalidateQueries({ queryKey: ['robo-saude-contagem'] }));
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={abrir} aria-label={`Robô da Saúde: ${n} pendência${n === 1 ? '' : 's'}`} title="Robô da Saúde" className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 sm:h-9 sm:w-9">
        <Bell className="h-5 w-5" />
        {n > 0 && (
          <span className={clsx('absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white num', c?.erros ? 'bg-red-600' : 'bg-amber-500')}>{n > 99 ? '99+' : n}</span>
        )}
        {!n && !!c?.naoLidas && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />}
      </button>
      {aberto && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop anim-in">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
            {p ? <AnelSaude pct={p.estado?.saudePct ?? 100} tamanho={40} /> : <Bot className="h-5 w-5 text-brand-600" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Robô da Saúde</p>
              <p className="truncate text-[11px] text-slate-500">{n ? `${n} para resolver` : 'Tudo em dia'}{p?.corrigidasHoje ? ` · ${p.corrigidasHoje} corrigida${p.corrigidasHoje > 1 ? 's' : ''} hoje` : ''}</p>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {!p ? (
              <p className="px-3 py-4 text-sm text-slate-400">Carregando…</p>
            ) : p.abertas.length ? (
              <ListaAvisosRobo avisos={p.abertas} compacto limite={6} />
            ) : (
              <>
                <p className="flex items-center gap-2 px-3 py-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Sistema 100%.</p>
                <ListaCorrecoes itens={p.correcoes} limite={3} />
              </>
            )}
          </div>
          <Link to="/configuracoes/saude" onClick={() => setAberto(false)} className="flex items-center justify-center gap-1 border-t border-slate-100 py-2 text-xs font-semibold text-brand-700 hover:bg-slate-50">
            Abrir a Saúde do sistema <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
