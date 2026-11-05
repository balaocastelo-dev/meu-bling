/**
 * Peças do Painel de auditoria: linha de operação, selo de categoria/origem, valor antes/depois,
 * e a gaveta da operação (todos os registros gravados com antes/depois + reversão).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertTriangle, ArrowLeftRight, Bot, ChevronDown, ChevronRight, ExternalLink, Globe, History, Monitor, Plug, RotateCcw, ShieldCheck, Undo2, User } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Drawer, Skeleton } from '@/components/ui';
import { mensagemErro } from '@/lib/api';
import { dataHora } from '@/lib/format';
import { painel, ROTULO_CATEGORIA, ROTULO_ORIGEM, TOM_CATEGORIA, type Evento, type Operacao, type OperacaoDetalhe } from './apiPainel';

export function SeloCategoria({ categoria }: { categoria: string }) {
  return <Badge tom={TOM_CATEGORIA[categoria] ?? 'neutro'}>{ROTULO_CATEGORIA[categoria] ?? categoria}</Badge>;
}

export function IconeOrigem({ origem, className = 'h-4 w-4' }: { origem: string; className?: string }) {
  if (origem === 'SERVICO' || origem === 'SISTEMA') return <Bot className={clsx(className, 'text-violet-500')} />;
  if (origem === 'API' || origem === 'MCP') return <Plug className={clsx(className, 'text-sky-500')} />;
  if (origem === 'SITE') return <Globe className={clsx(className, 'text-emerald-500')} />;
  if (origem === 'REVERSAO') return <Undo2 className={clsx(className, 'text-amber-500')} />;
  return <Monitor className={clsx(className, 'text-slate-400')} />;
}

const hora = (d: string | null | undefined) => (d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

/** Uma operação na lista (ao vivo / histórico) */
export function LinhaOperacao({ op, onAbrir, nova, mostrarData }: { op: Operacao; onAbrir: (id: string) => void; nova?: boolean; mostrarData?: boolean }) {
  const erro = (op.status ?? 200) >= 500;
  const semGravacao = op.eventos === 0;
  return (
    <li
      className={clsx(
        'group flex cursor-pointer gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50 sm:px-4',
        nova && 'aud-nova',
        op.revertidaEm && 'opacity-70',
      )}
      onClick={() => onAbrir(op.id)}
    >
      <div className="flex w-14 shrink-0 flex-col items-start pt-0.5 text-[11px] leading-tight text-slate-400 sm:w-16">
        {mostrarData && <span>{new Date(op.inicio).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
        <span className="num font-medium text-slate-500">{hora(op.inicio)}</span>
        <IconeOrigem origem={op.origem} className="mt-1 h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold text-slate-900">{op.usuario}</span>
          <SeloCategoria categoria={op.categoria} />
          {op.revertidaEm && <Badge tom="amarelo">revertida</Badge>}
          {op.reverteOpId && <Badge tom="azul">reversão</Badge>}
          {erro && <Badge tom="vermelho">erro {op.status}</Badge>}
          {semGravacao && !op.reverteOpId && <span className="text-[11px] text-slate-400">sem gravação</span>}
        </div>
        <p className="mt-0.5 break-words text-sm text-slate-700">{op.descricao || op.rotulo || op.rota || 'Operação'}</p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {op.rotulo && op.descricao && !op.descricao.startsWith(op.rotulo) ? `${op.rotulo} · ` : ''}
          {op.eventos} gravaç{op.eventos === 1 ? 'ão' : 'ões'}
          {op.ip ? ` · ${op.ip}` : ''}
        </p>
      </div>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" />
    </li>
  );
}

// ---------------------------------------------------------------- valores antes/depois
function pareceData(v: unknown) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}
export function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined || v === '') return <span className="text-slate-300">—</span>;
  if (typeof v === 'boolean') return <span>{v ? 'Sim' : 'Não'}</span>;
  if (typeof v === 'number') return <span className="num">{Number.isInteger(v) ? v : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</span>;
  if (pareceData(v)) return <span className="num">{dataHora(v as string)}</span>;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('__binario' in o) return <span className="text-slate-400">(arquivo binário)</span>;
    if ('__resumo' in o) return <span className="text-slate-600">{String(o.__resumo)}</span>;
    return <code className="break-all text-[11px] text-slate-600">{JSON.stringify(v)}</code>;
  }
  const s = String(v);
  return <span className="break-words">{s.length > 300 ? s.slice(0, 300) + '…' : s}</span>;
}

const CAMPOS_TECNICOS = new Set(['id', 'criadoEm', 'atualizadoEm']);

/** Um registro gravado: cabeçalho + tabela campo / antes / depois */
export function EventoLinha({ e, onTrilha }: { e: Evento; onTrilha?: (tabela: string, id: number) => void }) {
  const [aberto, setAberto] = useState(e.tipo === 'ALTERAR' && e.campos.length <= 6);
  const linhas = useMemo(() => {
    if (e.tipo === 'ALTERAR') return e.campos.filter((c) => !CAMPOS_TECNICOS.has(c) || c === 'id').map((c) => ({ campo: c, antes: e.antes?.[c], depois: e.depois?.[c] }));
    const snap = (e.tipo === 'CRIAR' ? e.depois : e.antes) ?? {};
    return Object.entries(snap)
      .filter(([k, v]) => v !== null && v !== '' && !CAMPOS_TECNICOS.has(k))
      .map(([k, v]) => ({ campo: k, antes: e.tipo === 'CRIAR' ? undefined : v, depois: e.tipo === 'CRIAR' ? v : undefined }));
  }, [e]);
  const tom = e.tipo === 'CRIAR' ? 'verde' : e.tipo === 'EXCLUIR' ? 'vermelho' : 'azul';
  const verbo = e.tipo === 'CRIAR' ? 'criado' : e.tipo === 'EXCLUIR' ? 'excluído' : 'alterado';
  return (
    <div className={clsx('rounded-xl border bg-white', e.revertidoEm ? 'border-amber-200' : 'border-slate-200')}>
      <button type="button" onClick={() => setAberto((a) => !a)} className="flex w-full items-start gap-2 px-3 py-2 text-left">
        {aberto ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Badge tom={tom}>{verbo}</Badge>
            <span className="text-sm font-medium text-slate-900">{e.rotulo}</span>
            <span className="text-[11px] text-slate-400">{e.tabelaNome}</span>
            {e.modo !== 'DIRETO' && <span className="text-[11px] text-slate-400">({e.modo === 'ANINHADO' ? 'dentro do pai' : 'em cascata'})</span>}
            {!e.reversivel && <Badge tom="cinza">não reversível</Badge>}
            {e.revertidoEm && <Badge tom="amarelo">revertido</Badge>}
          </div>
          {e.tipo === 'ALTERAR' && !aberto && <p className="mt-0.5 truncate text-xs text-slate-500">{e.campos.join(', ')}</p>}
        </div>
      </button>
      {aberto && (
        <div className="border-t border-slate-100 px-3 py-2">
          {linhas.length === 0 ? (
            <p className="text-xs text-slate-400">Sem detalhes.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[320px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="py-1 pr-2 font-medium">Campo</th>
                    {e.tipo !== 'CRIAR' && <th className="py-1 pr-2 font-medium">Antes</th>}
                    {e.tipo !== 'EXCLUIR' && <th className="py-1 font-medium">Depois</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {linhas.map((l) => (
                    <tr key={l.campo} className="align-top">
                      <td className="py-1 pr-2 font-mono text-[11px] text-slate-500">{l.campo}</td>
                      {e.tipo !== 'CRIAR' && (
                        <td className={clsx('py-1 pr-2', e.tipo === 'ALTERAR' && 'text-red-700 line-through decoration-red-300')}>
                          <Valor v={l.antes} />
                        </td>
                      )}
                      {e.tipo !== 'EXCLUIR' && (
                        <td className={clsx('py-1', e.tipo === 'ALTERAR' && 'font-medium text-emerald-700')}>
                          <Valor v={l.depois} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {e.link && (
              <Link to={e.link} className="inline-flex items-center gap-1 text-brand-600 hover:underline" onClick={(ev) => ev.stopPropagation()}>
                <ExternalLink className="h-3 w-3" /> Abrir no sistema
              </Link>
            )}
            {onTrilha && e.registroId && (
              <button type="button" className="inline-flex items-center gap-1 text-slate-600 hover:underline" onClick={() => onTrilha(e.tabela, e.registroId!)}>
                <History className="h-3 w-3" /> Vida deste registro
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- gaveta da operação
export function OperacaoDrawer({ id, onFechar, onAbrirOutra, onTrilha }: { id: string | null; onFechar: () => void; onAbrirOutra: (id: string) => void; onTrilha?: (tabela: string, id: number) => void }) {
  const qc = useQueryClient();
  const { data: op, isLoading, error } = useQuery({ queryKey: ['painel-op', id], queryFn: () => painel.get<OperacaoDetalhe>(`/operacoes/${id}`), enabled: !!id, staleTime: 0 });
  const [confirmar, setConfirmar] = useState(false);
  const reverter = useMutation({
    mutationFn: (forcar: boolean) => painel.post<{ ok: boolean; feitos: string[]; pulados: string[]; reversaoId: string | null }>(`/reverter/${id}`, { forcar }),
    onSuccess: (r) => {
      toast.success(`Operação revertida: ${r.feitos.length} ação(ões) desfeita(s)${r.pulados.length ? `, ${r.pulados.length} pulada(s)` : ''}`);
      void qc.invalidateQueries({ queryKey: ['painel-op', id] });
      void qc.invalidateQueries({ queryKey: ['painel'] });
      setConfirmar(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const porTabela = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of op?.eventos ?? []) m.set(e.tabelaNome, [...(m.get(e.tabelaNome) ?? []), e]);
    return [...m.entries()];
  }, [op]);
  const previa = op?.previa;
  const podeReverter = !!previa?.podeReverter && !op?.revertidaEm;
  return (
    <Drawer
      aberto={!!id}
      onFechar={onFechar}
      titulo={op ? `${op.usuario} · ${dataHora(op.inicio)}` : 'Operação'}
      descricao={op ? (op.rotulo ?? op.rota ?? ROTULO_ORIGEM[op.origem]) : undefined}
      largura="max-w-3xl"
      rodape={
        op && (
          <>
            {op.revertidaEm ? (
              <span className="mr-auto flex items-center gap-1.5 text-sm text-amber-700">
                <ShieldCheck className="h-4 w-4" /> Revertida em {dataHora(op.revertidaEm)} por {op.revertidaPor}
                {op.reversao && (
                  <button type="button" className="ml-1 text-brand-600 hover:underline" onClick={() => onAbrirOutra(op.reversao!.id)}>
                    ver reversão
                  </button>
                )}
              </span>
            ) : (
              <span className="mr-auto text-xs text-slate-400">{previa?.bloqueios?.length ? previa.bloqueios[0] : previa?.avisos?.length ? `${previa.avisos.length} aviso(s) — confira antes de reverter` : op.eventos.length ? 'A reversão desfaz tudo o que esta operação gravou, na ordem inversa.' : 'Esta operação não gravou nada.'}</span>
            )}
            <Button variante="secundario" onClick={onFechar}>Fechar</Button>
            {podeReverter && (
              <Button variante="perigo" icone={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirmar(true)} carregando={reverter.isPending}>
                {op.reverteOpId ? 'Refazer (reverter a reversão)' : 'Reverter esta operação'}
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading || !op ? (
        error ? (
          <p className="text-sm text-red-600">{mensagemErro(error)}</p>
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-16" />
            <Skeleton className="h-40" />
          </div>
        )
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-4">
            <Info rotulo="Quem"><span className="flex items-center gap-1"><User className="h-3.5 w-3.5 text-slate-400" />{op.usuario}</span></Info>
            <Info rotulo="Origem"><span className="flex items-center gap-1"><IconeOrigem origem={op.origem} className="h-3.5 w-3.5" />{ROTULO_ORIGEM[op.origem] ?? op.origem}</span></Info>
            <Info rotulo="Categoria"><SeloCategoria categoria={op.categoria} /></Info>
            <Info rotulo="Resultado">{op.status ? <Badge tom={op.status >= 500 ? 'vermelho' : op.status >= 400 ? 'amarelo' : 'verde'}>HTTP {op.status}</Badge> : <span className="text-slate-400">—</span>}</Info>
            <Info rotulo="Rota"><code className="break-all text-[11px]">{op.rota ?? '—'}</code></Info>
            <Info rotulo="IP">{op.ip ?? '—'}</Info>
            <Info rotulo="Início">{dataHora(op.inicio)}{hora(op.inicio).slice(5)}</Info>
            <Info rotulo="Operação"><code className="text-[11px]">{op.id.slice(0, 8)}</code></Info>
          </div>

          {op.descricao && <p className="text-sm text-slate-800">{op.descricao}</p>}

          {op.original && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <ArrowLeftRight className="h-4 w-4 shrink-0" />
              <span>
                Esta operação desfez a operação de {op.original.usuario} ({dataHora(op.original.inicio)}).{' '}
                <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => onAbrirOutra(op.original!.id)}>abrir a original</button>
              </span>
            </div>
          )}

          {op.acoes.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações registradas</h3>
              <ul className="space-y-1">
                {op.acoes.map((a) => (
                  <li key={a.id} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.tom === 'verde' ? 'bg-emerald-500' : a.tom === 'vermelho' ? 'bg-red-500' : a.tom === 'amarelo' ? 'bg-amber-500' : a.tom === 'azul' ? 'bg-blue-500' : 'bg-slate-400')} />
                    <span className="break-words">
                      {op.usuario} {a.texto}
                      {a.link && <Link to={a.link} className="ml-1 text-brand-600 hover:underline">abrir</Link>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              O que foi gravado no banco <span className="font-normal normal-case text-slate-400">({op.eventos.length} registro{op.eventos.length === 1 ? '' : 's'})</span>
            </h3>
            {op.eventos.length === 0 ? (
              <p className="text-sm text-slate-500">Nada foi gravado (consulta, impressão ou ação sem efeito).</p>
            ) : (
              <div className="space-y-3">
                {porTabela.map(([tabela, lista]) => (
                  <div key={tabela}>
                    <p className="mb-1 text-xs font-medium text-slate-500">
                      {tabela} <span className="text-slate-400">× {lista.length}</span>
                    </p>
                    <div className="space-y-1.5">
                      {lista.map((e) => (
                        <EventoLinha key={e.id} e={e} onTrilha={onTrilha} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {previa && !op.revertidaEm && (previa.bloqueios.length > 0 || previa.avisos.length > 0) && (
            <div className="space-y-2">
              {previa.bloqueios.map((b, i) => (
                <div key={`b${i}`} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{b}</span>
                </div>
              ))}
              {previa.avisos.map((a, i) => (
                <div key={`a${i}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {a.texto}
                    {a.operacaoId && (
                      <button type="button" className="ml-1 font-medium text-brand-600 hover:underline" onClick={() => onAbrirOutra(a.operacaoId!)}>abrir essa operação</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        aberto={confirmar}
        onFechar={() => setConfirmar(false)}
        onConfirmar={() => reverter.mutateAsync(true).then(() => undefined)}
        titulo={op?.reverteOpId ? 'Refazer esta operação?' : 'Reverter esta operação?'}
        textoConfirmar={op?.reverteOpId ? 'Refazer' : 'Reverter agora'}
        descricao={
          previa && (
            <div className="space-y-2 text-left">
              <p>O sistema vai desfazer, na ordem inversa, tudo o que esta operação gravou:</p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
                {previa.passos.map((p, i) => (
                  <li key={i} className={clsx('flex gap-1.5', p.acao === 'PULAR' && 'text-slate-400')}>
                    <span className="w-16 shrink-0 font-semibold">{p.acao === 'EXCLUIR' ? 'excluir' : p.acao === 'RECRIAR' ? 'recriar' : p.acao === 'RESTAURAR' ? 'restaurar' : 'pular'}</span>
                    <span className="break-words">
                      {p.rotulo}
                      {p.acao === 'RESTAURAR' && p.campos.length > 0 && <span className="text-slate-400"> ({p.campos.join(', ')})</span>}
                      {p.motivo && <span className="text-slate-400"> — {p.motivo}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {previa.avisos.length > 0 && <p className="text-amber-700">{previa.avisos.length} aviso(s) acima: a reversão vai passar por cima de alterações feitas depois.</p>}
              <p className="text-xs text-slate-500">A reversão também fica na trilha e pode ser desfeita.</p>
            </div>
          )
        }
      />
    </Drawer>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{rotulo}</p>
      <div className="truncate text-slate-800">{children}</div>
    </div>
  );
}
