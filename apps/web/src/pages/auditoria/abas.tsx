/**
 * Abas do Painel de auditoria: Ao vivo · Histórico · Funcionários · Achados · Agentes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Bot, Check, CheckCircle2, Clock, Eye, EyeOff, Info, KeyRound, Pause, Play, RefreshCw, ShieldAlert, Sparkles, Users, X } from 'lucide-react';
import { Badge, BuscaFiltro, Button, Card, EmptyState, Input, Pagination, PeriodoFiltro, Select, SelectFiltro, Skeleton, Switch } from '@/components/ui';
import { Avatar, BarraAnimada } from '@/components/dashboard/v18';
import { mensagemErro } from '@/lib/api';
import { dataHora, inteiro } from '@/lib/format';
import { intervaloPeriodo } from '@/lib/periodo';
import { painel, ROTULO_CATEGORIA, ROTULO_ORIGEM, TOM_CATEGORIA, type Achado, type AgentesResposta, type ConfigAgentes, type Funcionario, type Operacao } from './apiPainel';
import { LinhaOperacao, SeloCategoria } from './partes';

export interface FiltrosHistorico {
  dataInicial: string;
  dataFinal: string;
  usuarioId: string;
  categoria: string;
  origem: string;
  tabela: string;
  registroId: string;
  q: string;
  semRobos: boolean;
  revertidas: boolean;
}
export const FILTROS_PADRAO: FiltrosHistorico = { dataInicial: '', dataFinal: '', usuarioId: '', categoria: '', origem: '', tabela: '', registroId: '', q: '', semRobos: false, revertidas: false };

// ================================================================= AO VIVO
export function AoVivo({ onAbrir }: { onAbrir: (id: string) => void }) {
  const [pausado, setPausado] = useState(false);
  const [semRobos, setSemRobos] = useState(true);
  const [itens, setItens] = useState<Operacao[]>([]);
  const [novas, setNovas] = useState<Set<string>>(new Set());
  const desde = useRef<string>(new Date(Date.now() - 60 * 60_000).toISOString());
  const vistos = useRef<Map<string, Operacao>>(new Map());
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    vistos.current = new Map();
    setItens([]);
    desde.current = new Date(Date.now() - 60 * 60_000).toISOString();
  }, [semRobos]);

  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buscar = async () => {
      if (pausado) return;
      try {
        const r = await painel.get<{ agora: string; itens: Operacao[] }>('/ao-vivo', { desde: desde.current, semRobos: semRobos ? 1 : 0, limite: 100 });
        if (!vivo) return;
        const chegaram: string[] = [];
        for (const op of r.itens) {
          if (!vistos.current.has(op.id)) chegaram.push(op.id);
          vistos.current.set(op.id, op);
        }
        // a próxima pergunta cobre os últimos 10 s de novo (a descrição é gravada no fim da requisição)
        desde.current = new Date(new Date(r.agora).getTime() - 10_000).toISOString();
        const lista = [...vistos.current.values()].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime()).slice(0, 300);
        setItens(lista);
        if (chegaram.length && vistos.current.size > chegaram.length) {
          setNovas(new Set(chegaram));
          setTimeout(() => setNovas(new Set()), 1500);
        }
        setErro(null);
      } catch (e) {
        if (vivo) setErro(mensagemErro(e));
      }
    };
    void buscar();
    timer = setInterval(buscar, 3000) as unknown as ReturnType<typeof setTimeout>;
    return () => {
      vivo = false;
      if (timer) clearInterval(timer as unknown as number);
    };
  }, [pausado, semRobos]);

  const grupos = useMemo(() => {
    const m = new Map<string, Operacao[]>();
    for (const op of itens) {
      const dia = new Date(op.inicio).toLocaleDateString('pt-BR');
      m.set(dia, [...(m.get(dia) ?? []), op]);
    }
    return [...m.entries()];
  }, [itens]);

  return (
    <Card
      titulo={
        <span className="flex items-center gap-2">
          <span className={clsx('relative flex h-2.5 w-2.5', pausado ? '' : '')}>
            {!pausado && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
            <span className={clsx('relative inline-flex h-2.5 w-2.5 rounded-full', pausado ? 'bg-slate-400' : 'bg-emerald-500')} />
          </span>
          Ao vivo
        </span>
      }
      descricao={pausado ? 'Pausado — nada novo entra até você continuar' : 'Tudo o que entra no sistema aparece aqui em segundos (clique para abrir)'}
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={!semRobos} onChange={(e) => setSemRobos(!e.target.checked)} /> mostrar robôs
          </label>
          <Button variante="secundario" tamanho="sm" icone={pausado ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} onClick={() => setPausado((p) => !p)}>
            {pausado ? 'Continuar' : 'Pausar'}
          </Button>
        </div>
      }
      semPadding
    >
      {erro && <p className="px-4 py-2 text-xs text-red-600">{erro}</p>}
      {itens.length === 0 ? (
        <EmptyState compacto icone={<Clock className="h-5 w-5 text-slate-400" />} titulo="Nada na última hora" descricao="Assim que alguém fizer qualquer coisa no sistema, aparece aqui." />
      ) : (
        <div className="max-h-[70vh] overflow-y-auto">
          {grupos.map(([dia, lista]) => (
            <div key={dia}>
              <p className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur">{dia}</p>
              <ul className="divide-y divide-slate-100">
                {lista.map((op) => (
                  <LinhaOperacao key={op.id} op={op} onAbrir={onAbrir} nova={novas.has(op.id)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ================================================================= HISTÓRICO
export function Historico({ filtros, onFiltros, onAbrir, usuarios, categorias }: { filtros: FiltrosHistorico; onFiltros: (f: FiltrosHistorico) => void; onAbrir: (id: string) => void; usuarios: { id: number; nome: string }[]; categorias: { chave: string; rotulo: string }[] }) {
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [modo, setModo] = useState<'trilha' | 'antigo'>('trilha');
  useEffect(() => setPagina(1), [filtros, modo]);
  const params = { ...filtros, usuarioId: filtros.usuarioId || undefined, registroId: filtros.registroId || undefined, semRobos: filtros.semRobos ? 1 : 0, revertidas: filtros.revertidas ? 1 : 0, pagina, limite };
  const trilha = useQuery({ queryKey: ['painel', 'operacoes', params], queryFn: () => painel.get<{ total: number; itens: Operacao[] }>('/operacoes', params), enabled: modo === 'trilha', placeholderData: (p) => p });
  const antigo = useQuery({
    queryKey: ['painel', 'antigo', filtros, pagina, limite],
    queryFn: () => painel.get<{ total: number; itens: { id: number; quando: string; usuario: string; texto: string; tom: string; link: string | null; categoria: string; acao: string; entidade: string; ip: string | null; operacaoId: string | null }[] }>('/historico-antigo', { dataInicial: filtros.dataInicial, dataFinal: filtros.dataFinal, usuarioId: filtros.usuarioId || undefined, q: filtros.q, pagina, limite }),
    enabled: modo === 'antigo',
    placeholderData: (p) => p,
  });
  const set = (p: Partial<FiltrosHistorico>) => onFiltros({ ...filtros, ...p });
  const total = modo === 'trilha' ? trilha.data?.total ?? 0 : antigo.data?.total ?? 0;
  return (
    <div className="space-y-3">
      <Card semPadding>
        <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 px-3 py-2.5">
          <PeriodoFiltro inicial={filtros.dataInicial} final={filtros.dataFinal} onChange={(i, f) => set({ dataInicial: i, dataFinal: f })} />
          <SelectFiltro label="Funcionário" valor={filtros.usuarioId} onChange={(v) => set({ usuarioId: v })} placeholder="Todos" opcoes={usuarios.map((u) => ({ valor: u.id, rotulo: u.nome }))} />
          <SelectFiltro label="Categoria" valor={filtros.categoria} onChange={(v) => set({ categoria: v })} placeholder="Todas" opcoes={categorias.map((c) => ({ valor: c.chave, rotulo: c.rotulo }))} />
          {modo === 'trilha' && <SelectFiltro label="Origem" valor={filtros.origem} onChange={(v) => set({ origem: v })} placeholder="Todas" opcoes={Object.entries(ROTULO_ORIGEM).map(([v, r]) => ({ valor: v, rotulo: r }))} />}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-slate-500">Buscar</span>
            <BuscaFiltro valor={filtros.q} onChange={(v) => set({ q: v })} placeholder="descrição, nome, rota…" />
          </div>
          {modo === 'trilha' && (
            <>
              <label className="flex h-8 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={filtros.semRobos} onChange={(e) => set({ semRobos: e.target.checked })} /> esconder robôs
              </label>
              <label className="flex h-8 cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={filtros.revertidas} onChange={(e) => set({ revertidas: e.target.checked })} /> só revertidas
              </label>
            </>
          )}
          {(filtros.tabela || filtros.registroId) && (
            <Badge tom="azul" className="h-8">
              registro {filtros.tabela} #{filtros.registroId}
              <button type="button" className="ml-1" onClick={() => set({ tabela: '', registroId: '' })} aria-label="Tirar filtro de registro">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white p-0.5 text-xs">
            <button type="button" className={clsx('rounded-full px-2.5 py-1', modo === 'trilha' ? 'bg-slate-900 text-white' : 'text-slate-600')} onClick={() => setModo('trilha')}>
              Trilha completa
            </button>
            <button type="button" className={clsx('rounded-full px-2.5 py-1', modo === 'antigo' ? 'bg-slate-900 text-white' : 'text-slate-600')} onClick={() => setModo('antigo')} title="Registro legível de tudo, desde o primeiro dia do sistema (antes da trilha com antes/depois)">
              Desde o 1º dia
            </button>
          </div>
        </div>

        {modo === 'trilha' ? (
          trilha.isLoading ? (
            <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : !trilha.data?.itens.length ? (
            <EmptyState compacto titulo="Nenhuma operação com esses filtros" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {trilha.data.itens.map((op) => (
                <LinhaOperacao key={op.id} op={op} onAbrir={onAbrir} mostrarData />
              ))}
            </ul>
          )
        ) : antigo.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : !antigo.data?.itens.length ? (
          <EmptyState compacto titulo="Nada no registro antigo com esses filtros" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {antigo.data.itens.map((a) => (
              <li key={a.id} className="flex gap-3 px-3 py-2 text-sm sm:px-4">
                <span className="num w-28 shrink-0 text-[11px] text-slate-400">{dataHora(a.quando)}</span>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{a.usuario}</span> <span className="text-slate-700">{a.texto}</span>
                  {a.link && <Link to={a.link} className="ml-1 text-xs text-brand-600 hover:underline">abrir</Link>}
                  {a.operacaoId && (
                    <button type="button" className="ml-1 text-xs text-slate-500 hover:underline" onClick={() => onAbrir(a.operacaoId!)}>
                      operação
                    </button>
                  )}
                </div>
                <SeloCategoria categoria={a.categoria} />
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-slate-100 px-2">
          <Pagination pagina={pagina} totalPaginas={Math.max(1, Math.ceil(total / limite))} total={total} limite={limite} onPagina={setPagina} onLimite={(l) => { setLimite(l); setPagina(1); }} />
        </div>
      </Card>
    </div>
  );
}

// ================================================================= FUNCIONÁRIOS
export function Funcionarios({ onVerTrilha }: { onVerTrilha: (usuarioId: number) => void }) {
  const [periodo, setPeriodo] = useState(() => intervaloPeriodo('30d'));
  const { data, isLoading } = useQuery({ queryKey: ['painel', 'funcionarios', periodo], queryFn: () => painel.get<{ itens: Funcionario[]; semUsuario: number; horario: { inicio: number; fim: number } }>('/funcionarios', periodo) });
  const max = Math.max(1, ...(data?.itens.map((f) => f.operacoes) ?? [1]));
  return (
    <div className="space-y-3">
      <Card semPadding>
        <div className="flex flex-wrap items-end gap-2 px-3 py-2.5">
          <PeriodoFiltro inicial={periodo.dataInicial} final={periodo.dataFinal} onChange={(i, f) => setPeriodo({ dataInicial: i, dataFinal: f })} limpavel={false} />
          {data && <span className="ml-auto self-center text-xs text-slate-400">Horário da loja: {data.horario.inicio}h às {data.horario.fim}h (fora disso conta como "fora do horário")</span>}
        </div>
      </Card>
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data?.itens.map((f, i) => {
            const alertas = (f.achados.alto ?? 0) + (f.achados.medio ?? 0) + (f.achados.baixo ?? 0);
            return (
              <div key={f.usuarioId} className="v18-card flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
                <div className="flex items-start gap-3">
                  <Avatar nome={f.nome} indice={i} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {f.nome} {!f.ativo && <Badge tom="cinza">inativo</Badge>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {f.perfil} · {f.logins} login{f.logins === 1 ? '' : 's'} · último acesso {f.ultimoLogin ? dataHora(f.ultimoLogin) : '—'}
                    </p>
                  </div>
                  {alertas > 0 && (
                    <Badge tom={f.achados.alto ? 'vermelho' : f.achados.medio ? 'amarelo' : 'neutro'} ponto>
                      {alertas} achado{alertas === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline justify-between text-xs text-slate-500">
                    <span>Operações no período</span>
                    <span className="num text-base font-bold text-slate-900">{inteiro(f.operacoes)}</span>
                  </div>
                  <BarraAnimada pct={(f.operacoes / max) * 100} cor="#dc2626" className="mt-1" />
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-emerald-50 py-1.5"><p className="num font-bold text-emerald-700">{f.criados}</p><p className="text-[10px] text-emerald-700/70">criados</p></div>
                  <div className="rounded-lg bg-blue-50 py-1.5"><p className="num font-bold text-blue-700">{f.alterados}</p><p className="text-[10px] text-blue-700/70">alterados</p></div>
                  <div className="rounded-lg bg-red-50 py-1.5"><p className="num font-bold text-red-700">{f.excluidos}</p><p className="text-[10px] text-red-700/70">excluídos</p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {Object.entries(f.porCategoria)
                    .sort((a, b) => b[1] - a[1])
                    .map(([c, n]) => (
                      <Badge key={c} tom={TOM_CATEGORIA[c] ?? 'neutro'}>
                        {ROTULO_CATEGORIA[c] ?? c} {n}
                      </Badge>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span className={clsx(f.foraHorario > 0 && 'font-medium text-amber-700')}>fora do horário: {f.foraHorario}</span>
                  <span className={clsx(f.revertidas > 0 && 'font-medium text-amber-700')}>revertidas: {f.revertidas}</span>
                  <span className={clsx(f.comErro > 0 && 'font-medium text-red-700')}>com erro: {f.comErro}</span>
                  {f.apis > 0 && <span>via API: {f.apis}</span>}
                </div>
                <div className="mt-auto flex items-center justify-between pt-3 text-xs">
                  <span className="text-slate-400">última: {f.ultima ? dataHora(f.ultima) : '—'}</span>
                  <Button variante="link" tamanho="sm" onClick={() => onVerTrilha(f.usuarioId)}>
                    Ver tudo que fez →
                  </Button>
                </div>
              </div>
            );
          })}
          {!data?.itens.length && <EmptyState titulo="Nenhuma operação no período" />}
        </div>
      )}
      {!!data?.semUsuario && <p className="text-xs text-slate-400">+ {data.semUsuario} operações sem usuário (site/PDV, cliente pelo link, robôs).</p>}
    </div>
  );
}

// ================================================================= ACHADOS
const ESTILO_NIVEL = {
  alto: { icone: AlertOctagon, cor: 'text-red-600', fundo: 'border-red-200 bg-red-50/40', rotulo: 'Alto' },
  medio: { icone: AlertTriangle, cor: 'text-amber-600', fundo: 'border-amber-200 bg-amber-50/40', rotulo: 'Médio' },
  baixo: { icone: Info, cor: 'text-blue-600', fundo: 'border-slate-200', rotulo: 'Baixo' },
} as const;

export function Achados({ onAbrirOperacao, onVerRegistro, agentes }: { onAbrirOperacao: (id: string) => void; onVerRegistro: (tabela: string, id: number) => void; agentes: { codigo: string; nome: string }[] }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('ABERTO,VISTO');
  const [nivel, setNivel] = useState('');
  const [agente, setAgente] = useState('');
  const [pagina, setPagina] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['painel', 'achados', status, nivel, agente, pagina], queryFn: () => painel.get<{ total: number; itens: Achado[] }>('/achados', { status, nivel: nivel || undefined, agente: agente || undefined, pagina, limite: 30 }), placeholderData: (p) => p });
  const mudar = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => painel.post(`/achados/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['painel'] }),
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <div className="space-y-3">
      <Card semPadding>
        <div className="flex flex-wrap items-end gap-2 px-3 py-2.5">
          <SelectFiltro label="Situação" valor={status} onChange={(v) => { setStatus(v); setPagina(1); }} opcoes={[{ valor: 'ABERTO,VISTO', rotulo: 'Abertos e vistos' }, { valor: 'ABERTO', rotulo: 'Só novos' }, { valor: 'VISTO', rotulo: 'Vistos' }, { valor: 'RESOLVIDO', rotulo: 'Resolvidos' }, { valor: 'IGNORADO', rotulo: 'Ignorados' }, { valor: 'ABERTO,VISTO,RESOLVIDO,IGNORADO', rotulo: 'Todos' }]} />
          <SelectFiltro label="Nível" valor={nivel} onChange={(v) => { setNivel(v); setPagina(1); }} placeholder="Todos" opcoes={[{ valor: 'alto', rotulo: 'Alto' }, { valor: 'medio', rotulo: 'Médio' }, { valor: 'baixo', rotulo: 'Baixo' }]} />
          <SelectFiltro label="Agente" valor={agente} onChange={(v) => { setAgente(v); setPagina(1); }} placeholder="Todos" opcoes={[...agentes.map((a) => ({ valor: a.codigo, rotulo: a.nome })), { valor: 'analista', rotulo: 'Analista (Claude)' }]} />
          <span className="ml-auto self-center text-xs text-slate-400">{data ? `${data.total} achado${data.total === 1 ? '' : 's'}` : ''}</span>
        </div>
      </Card>
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      ) : !data?.itens.length ? (
        <Card>
          <EmptyState icone={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} titulo="Nada encontrado" descricao="Os agentes não têm nada a apontar com esses filtros." />
        </Card>
      ) : (
        <div className="space-y-2">
          {data.itens.map((a) => {
            const E = ESTILO_NIVEL[a.nivel] ?? ESTILO_NIVEL.baixo;
            return (
              <div key={a.id} className={clsx('v18-card rounded-2xl border bg-white p-4 shadow-card', E.fundo, a.status !== 'ABERTO' && 'opacity-80')}>
                <div className="flex items-start gap-3">
                  <E.icone className={clsx('mt-0.5 h-5 w-5 shrink-0', E.cor)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 className="text-sm font-semibold text-slate-900">{a.titulo}</h3>
                      <Badge tom={a.nivel === 'alto' ? 'vermelho' : a.nivel === 'medio' ? 'amarelo' : 'azul'}>{E.rotulo}</Badge>
                      <SeloCategoria categoria={a.categoria} />
                      {a.status !== 'ABERTO' && <Badge tom="cinza">{a.status.toLowerCase()}</Badge>}
                      {a.vezes > 1 && <span className="text-[11px] text-slate-400">confirmado {a.vezes}×</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{a.explicacao}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {a.agenteNome} · {dataHora(a.criadoEm)}
                      {a.vistoPor && a.status !== 'ABERTO' ? ` · ${a.status.toLowerCase()} por ${a.vistoPor}` : ''}
                    </p>
                    {a.evidencias.length > 0 && (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {a.evidencias.map((ev, i) => (
                          <li key={i} className="flex flex-wrap items-center gap-2 text-slate-600">
                            <span className="break-words">{ev.rotulo}</span>
                            {ev.operacaoId && (
                              <button type="button" className="text-brand-600 hover:underline" onClick={() => onAbrirOperacao(ev.operacaoId!)}>
                                abrir operação
                              </button>
                            )}
                            {ev.link && <Link to={ev.link} className="text-brand-600 hover:underline">abrir no sistema</Link>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.operacaoId && (
                        <Button variante="secundario" tamanho="xs" onClick={() => onAbrirOperacao(a.operacaoId!)}>
                          Ver operação
                        </Button>
                      )}
                      {a.tabela && a.registroId && (
                        <Button variante="secundario" tamanho="xs" onClick={() => onVerRegistro(a.tabela!, a.registroId!)}>
                          Vida do registro
                        </Button>
                      )}
                      {a.status === 'ABERTO' && (
                        <Button variante="fantasma" tamanho="xs" icone={<Eye className="h-3.5 w-3.5" />} onClick={() => mudar.mutate({ id: a.id, status: 'VISTO' })}>
                          Visto
                        </Button>
                      )}
                      {a.status !== 'RESOLVIDO' && (
                        <Button variante="fantasma" tamanho="xs" icone={<Check className="h-3.5 w-3.5" />} onClick={() => mudar.mutate({ id: a.id, status: 'RESOLVIDO' })}>
                          Resolvido
                        </Button>
                      )}
                      {a.status !== 'IGNORADO' && (
                        <Button variante="fantasma" tamanho="xs" icone={<EyeOff className="h-3.5 w-3.5" />} onClick={() => mudar.mutate({ id: a.id, status: 'IGNORADO' })}>
                          Ignorar
                        </Button>
                      )}
                      {a.status === 'IGNORADO' && (
                        <Button variante="fantasma" tamanho="xs" onClick={() => mudar.mutate({ id: a.id, status: 'ABERTO' })}>
                          Reabrir
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {data.total > 30 && <Pagination pagina={pagina} totalPaginas={Math.ceil(data.total / 30)} total={data.total} limite={30} onPagina={setPagina} />}
        </div>
      )}
    </div>
  );
}

// ================================================================= AGENTES
export function Agentes() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['painel', 'agentes'], queryFn: () => painel.get<AgentesResposta>('/agentes') });
  const [cfg, setCfg] = useState<Partial<ConfigAgentes>>({});
  const [chave, setChave] = useState('');
  useEffect(() => {
    if (data) setCfg(data.config);
  }, [data]);
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['painel'] });
  const rodar = useMutation({ mutationFn: (apenas?: string[]) => painel.post('/agentes/rodar', { apenas }), onSuccess: () => { toast.success('Agentes rodaram'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const salvar = useMutation({ mutationFn: (p: Partial<ConfigAgentes>) => painel.put('/agentes/config', p), onSuccess: () => { toast.success('Configuração salva'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const analisar = useMutation({ mutationFn: () => painel.post<{ erro?: string | null }>('/analista/analisar'), onSuccess: (r) => { r.erro ? toast.error(r.erro) : toast.success('Análise pronta'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const gravarChave = useMutation({ mutationFn: (c: string | null) => painel.put('/analista/chave', { chave: c }), onSuccess: () => { toast.success('Chave atualizada'); setChave(''); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  if (isLoading || !data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const ligar = (codigo: string, ligado: boolean) => {
    const desligados = new Set(data.config.desligados);
    if (ligado) desligados.delete(codigo);
    else desligados.add(codigo);
    salvar.mutate({ desligados: [...desligados] });
  };
  const an = data.analista;
  return (
    <div className="space-y-3">
      <div className="v18-card flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
        <Bot className="h-8 w-8 text-brand-600" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-slate-900">Agentes de auditoria</p>
          <p className="text-sm text-slate-500">
            Rodam sozinhos a cada {data.intervaloMin} min sobre a trilha e os dados.{' '}
            {data.estado?.ultimaVez ? `Última rodada ${dataHora(data.estado.ultimaVez)} (${data.estado.novos} novos, ${data.estado.confirmados} confirmados, ${data.estado.resolvidosSozinhos} resolvidos sozinhos).` : 'Ainda não rodaram.'}
            {data.estado?.erro && <span className="text-red-600"> Erro: {data.estado.erro}</span>}
          </p>
        </div>
        <Switch checked={data.config.ligado} onChange={(v) => salvar.mutate({ ligado: v })} label="Ligados (24h)" />
        <Button variante="primario" icone={<RefreshCw className={clsx('h-4 w-4', rodar.isPending && 'animate-spin')} />} carregando={rodar.isPending} onClick={() => rodar.mutate(undefined)}>
          Rodar todos agora
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {data.agentes.map((a) => (
          <div key={a.codigo} className={clsx('v18-card rounded-2xl border bg-white p-4 shadow-card', a.ligado ? 'border-slate-200/80' : 'border-slate-200 opacity-70')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{a.nome}</p>
                <p className="mt-0.5 text-xs text-slate-500">{a.descricao}</p>
              </div>
              <Switch checked={a.ligado} onChange={(v) => ligar(a.codigo, v)} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>janela: {a.janelaDias} dias</span>
              <span className={clsx(a.abertos > 0 && 'font-semibold text-amber-700')}>{a.abertos} aberto{a.abertos === 1 ? '' : 's'}</span>
              {a.ultima && <span>última rodada: {a.ultima.achados} achado(s) em {a.ultima.ms} ms</span>}
              {a.ultima?.erro && <span className="text-red-600">erro: {a.ultima.erro}</span>}
              <Button variante="link" tamanho="xs" className="ml-auto" onClick={() => rodar.mutate([a.codigo])}>
                rodar agora
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Card titulo="Regras dos agentes" descricao="Limites que definem o que é 'suspeito'">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Loja abre às (h)" type="number" min={0} max={23} value={cfg.horaInicio ?? 7} onChange={(e) => setCfg({ ...cfg, horaInicio: Number(e.target.value) })} />
          <Input label="Loja fecha às (h)" type="number" min={1} max={24} value={cfg.horaFim ?? 22} onChange={(e) => setCfg({ ...cfg, horaFim: Number(e.target.value) })} />
          <Input label="Desconto máximo sem alerta (%)" type="number" min={0} max={100} value={cfg.descontoMaxPct ?? 15} onChange={(e) => setCfg({ ...cfg, descontoMaxPct: Number(e.target.value) })} />
          <Input label="Saída manual de caixa: alerta alto a partir de (R$)" type="number" min={0} value={cfg.saidaManualAlerta ?? 500} onChange={(e) => setCfg({ ...cfg, saidaManualAlerta: Number(e.target.value) })} />
        </div>
        <div className="mt-3 flex justify-end">
          <Button variante="primario" carregando={salvar.isPending} onClick={() => salvar.mutate({ horaInicio: cfg.horaInicio, horaFim: cfg.horaFim, descontoMaxPct: cfg.descontoMaxPct, saidaManualAlerta: cfg.saidaManualAlerta })}>
            Salvar regras
          </Button>
        </div>
      </Card>

      <Card
        titulo={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-600" /> Analista (Claude)</span>}
        descricao="Uma vez por dia (e quando você pedir) a IA lê o resumo das últimas 24 h e os achados dos agentes e escreve padrões, inconsistências e perguntas para investigar."
        acoes={
          <Button variante="primario" icone={<Sparkles className="h-4 w-4" />} carregando={analisar.isPending} disabled={!an.chaveConfigurada} onClick={() => analisar.mutate()}>
            Analisar agora
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <p className="flex items-center gap-1.5 text-sm">
              <KeyRound className="h-4 w-4 text-slate-400" />
              {an.chaveConfigurada ? <span className="text-emerald-700">Chave da Anthropic configurada</span> : <span className="text-amber-700">Sem chave: cole a chave da API da Anthropic (console.anthropic.com)</span>}
            </p>
            <div className="flex gap-2">
              <Input placeholder="sk-ant-…" value={chave} onChange={(e) => setChave(e.target.value)} type="password" className="flex-1" />
              <Button variante="secundario" disabled={!chave.trim()} carregando={gravarChave.isPending} onClick={() => gravarChave.mutate(chave.trim())}>
                Salvar
              </Button>
            </div>
            {an.chaveConfigurada && (
              <Button variante="link" tamanho="xs" onClick={() => gravarChave.mutate(null)}>
                remover chave
              </Button>
            )}
            <Select label="Modelo" value={cfg.modeloIa ?? an.modelo} onChange={(e) => { setCfg({ ...cfg, modeloIa: e.target.value }); salvar.mutate({ modeloIa: e.target.value }); }} opcoes={[{ valor: 'claude-sonnet-5-5', rotulo: 'Claude Sonnet 5.5 (recomendado)' }, { valor: 'claude-haiku-5-5', rotulo: 'Claude Haiku 5.5 (mais barato)' }, { valor: 'claude-opus-5-5', rotulo: 'Claude Opus 5.5 (mais caro)' }]} />
            <p className="text-[11px] text-slate-400">Vai para a IA só o resumo (nomes de funcionários, números de pedidos e valores) — nunca senhas, documentos ou dados de clientes.</p>
          </div>
          <div className="lg:col-span-2">
            {an.ultimo ? (
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400">
                  Última análise {dataHora(an.ultimo.geradoEm)} · {an.ultimo.modelo}
                  {an.ultimo.erro && <span className="text-red-600"> · {an.ultimo.erro}</span>}
                </p>
                {an.ultimo.resumo && <p className="rounded-xl bg-violet-50 p-3 text-sm text-slate-800">{an.ultimo.resumo}</p>}
                {an.ultimo.pontos.length > 0 && (
                  <ul className="space-y-1.5">
                    {an.ultimo.pontos.map((p, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Badge tom={p.nivel === 'alto' ? 'vermelho' : p.nivel === 'medio' ? 'amarelo' : 'azul'}>{p.nivel}</Badge>
                        <span>
                          <span className="font-medium text-slate-900">{p.titulo}</span> <span className="text-slate-600">{p.explicacao}</span>
                          {p.usuario && <span className="text-slate-400"> · {p.usuario}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {an.ultimo.perguntas.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Perguntas para investigar</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                      {an.ultimo.perguntas.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState compacto icone={<ShieldAlert className="h-5 w-5 text-slate-400" />} titulo="Nenhuma análise ainda" descricao={an.chaveConfigurada ? 'Clique em "Analisar agora".' : 'Configure a chave para ligar o analista.'} />
            )}
          </div>
        </div>
      </Card>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Users className="h-3.5 w-3.5" /> Os achados são sinais para investigar, não provas. Quem decide é você.</p>
    </div>
  );
}
