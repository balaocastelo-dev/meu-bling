import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertTriangle, ChevronDown, ExternalLink, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useSituacoes } from '@/hooks/useListas';
import { BadgeCor } from './Badge';
import { Button } from './Button';
import { Modal } from './Modal';
import { Textarea } from './Input';
import type { Modulo, PendenciaCusto, PendenciaFinalizacao, SituacaoRef } from '@/types';
import { ListaPendencias } from '@/components/compartilhados/FinalizarVenda';

export function StatusBadge({ situacao, tamanho }: { situacao?: SituacaoRef | null; tamanho?: 'sm' | 'md' }) {
  if (!situacao) return <span className="text-slate-400">—</span>;
  return (
    <BadgeCor cor={situacao.cor} tamanho={tamanho}>
      {situacao.nome}
    </BadgeCor>
  );
}

interface StatusChangerProps {
  modulo: Modulo;
  /** caminho base da entidade: /vendas/12, /ordens-servico/3, /compras/5 */
  caminho: string;
  situacaoAtual: SituacaoRef;
  situacoesPermitidas?: SituacaoRef[];
  /** chaves de query a invalidar após a troca */
  invalidar?: readonly (string | number)[][];
  onAlterado?: (nova: SituacaoRef) => void;
  tamanho?: 'sm' | 'md';
}

/**
 * Dropdown que lista as `situacoesPermitidas` e chama POST .../situacao.
 * Em erro 422 TRANSICAO_INVALIDA mostra as permitidas; ADMIN pode "forçar".
 */
export function StatusChanger({ modulo, caminho, situacaoAtual, situacoesPermitidas, invalidar, onAlterado, tamanho = 'md' }: StatusChangerProps) {
  const qc = useQueryClient();
  const ehAdmin = useAuth((s) => s.usuario?.perfil === 'ADMIN');
  const { data: todas } = useSituacoes(modulo);
  const [aberto, setAberto] = useState(false);
  const [confirmar, setConfirmar] = useState<{ destino: SituacaoRef; forcar: boolean; erroPermitidas?: SituacaoRef[]; pendencias?: { lista: PendenciaFinalizacao[]; vendaId: number; contatoId?: number }; custoPendente?: { lista: PendenciaCusto[]; osId: number; numero?: number } } | null>(null);
  const [observacao, setObservacao] = useState('');
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => raiz.current && !raiz.current.contains(e.target as Node) && setAberto(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const mutacao = useMutation({
    mutationFn: (p: { situacaoId: number; observacao?: string; forcar?: boolean; confirmarCusto?: boolean }) => api.post<{ situacao: SituacaoRef; acoesExecutadas: string[] }>(`${caminho}/situacao`, p),
    onSuccess: (r, vars) => {
      const nova = r?.situacao ?? todas?.find((s) => s.id === vars.situacaoId) ?? confirmar?.destino;
      toast.success(`Situação alterada para "${nova?.nome ?? ''}"`, {
        description: r?.acoesExecutadas?.length ? `Ações: ${r.acoesExecutadas.join(', ')}` : undefined,
      });
      invalidar?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (nova) onAlterado?.(nova);
      setConfirmar(null);
      setObservacao('');
    },
    onError: (e: unknown, vars) => {
      if (e instanceof ApiError && e.status === 422 && e.code === 'TRANSICAO_INVALIDA') {
        const det = (e.detalhes ?? {}) as { permitidas?: SituacaoRef[] };
        const destino = todas?.find((s) => s.id === vars.situacaoId);
        setConfirmar({ destino: destino ?? { id: vars.situacaoId, nome: '?', cor: '#64748b' }, forcar: true, erroPermitidas: det.permitidas ?? [] });
        return;
      }
      // LEMBRETE NO FECHAMENTO da OS: peça sem custo. Mostra o que falta com "Preencher agora" e deixa fechar assim mesmo.
      if (e instanceof ApiError && e.status === 422 && e.code === 'OS_CUSTO_PENDENTE') {
        const det = (e.detalhes ?? {}) as { pendencias?: PendenciaCusto[]; osId?: number; numero?: number };
        const destino = todas?.find((s) => s.id === vars.situacaoId) ?? confirmar?.destino;
        setConfirmar({ destino: destino ?? { id: vars.situacaoId, nome: '?', cor: '#64748b' }, forcar: vars.forcar ?? false, custoPendente: { lista: det.pendencias ?? [], osId: det.osId ?? Number(caminho.split('/').pop()), numero: det.numero } });
        return;
      }
      if (e instanceof ApiError && e.status === 422 && e.code === 'VENDA_INCOMPLETA') {
        const det = (e.detalhes ?? {}) as { pendencias?: PendenciaFinalizacao[]; vendaId?: number; contatoId?: number };
        const destino = todas?.find((s) => s.id === vars.situacaoId) ?? confirmar?.destino;
        setConfirmar({ destino: destino ?? { id: vars.situacaoId, nome: '?', cor: '#64748b' }, forcar: false, pendencias: { lista: det.pendencias ?? [], vendaId: det.vendaId ?? Number(caminho.split('/').pop()), contatoId: det.contatoId } });
        return;
      }
      toast.error(mensagemErro(e));
    },
  });

  // Lista de destinos: as permitidas pelo backend; ADMIN vê também as demais (marcadas como "forçar")
  const permitidasIds = new Set((situacoesPermitidas ?? []).map((s) => s.id));
  const permitidas = situacoesPermitidas ?? [];
  const outras = ehAdmin ? (todas ?? []).filter((s) => s.ativo && s.id !== situacaoAtual.id && !permitidasIds.has(s.id)) : [];

  const escolher = (s: SituacaoRef, forcar: boolean) => {
    setAberto(false);
    setConfirmar({ destino: s, forcar });
  };

  return (
    <div ref={raiz} className="relative inline-block">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-full border border-transparent transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30',
          tamanho === 'md' ? 'px-1 py-0.5' : 'px-0.5',
        )}
        title="Alterar situação"
      >
        <StatusBadge situacao={situacaoAtual} tamanho={tamanho} />
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {aberto && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-pop anim-in">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mover para</p>
          {permitidas.length === 0 && outras.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Nenhuma transição disponível.</p>}
          {permitidas.map((s) => (
            <button key={s.id} type="button" onClick={() => escolher(s, false)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.cor }} />
              {s.nome}
            </button>
          ))}
          {outras.length > 0 && (
            <>
              <p className="mt-1 border-t border-slate-100 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">Forçar (admin)</p>
              {outras.map((s) => (
                <button key={s.id} type="button" onClick={() => escolher(s, true)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-amber-50">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.cor }} />
                  {s.nome}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <Modal
        aberto={!!confirmar}
        onFechar={() => setConfirmar(null)}
        titulo="Alterar situação"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            {confirmar?.custoPendente ? (
              <>
                <Button
                  variante="secundario"
                  carregando={mutacao.isPending}
                  onClick={() => confirmar && mutacao.mutate({ situacaoId: confirmar.destino.id, observacao: observacao || undefined, forcar: confirmar.forcar || undefined, confirmarCusto: true })}
                >
                  Fechar assim mesmo
                </Button>
                <Link to={`/ordens-servico/${confirmar.custoPendente.osId}/editar`} onClick={() => setConfirmar(null)}>
                  <Button variante="primario">Preencher agora</Button>
                </Link>
              </>
            ) : (confirmar?.erroPermitidas && !ehAdmin) || confirmar?.pendencias ? null : (
              <Button
                variante={confirmar?.forcar ? 'primario' : 'sucesso'}
                carregando={mutacao.isPending}
                onClick={() => confirmar && mutacao.mutate({ situacaoId: confirmar.destino.id, observacao: observacao || undefined, forcar: confirmar.forcar || undefined })}
              >
                {confirmar?.forcar ? 'Forçar alteração' : 'Confirmar'}
              </Button>
            )}
          </>
        }
      >
        {confirmar && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-sm">
              <StatusBadge situacao={situacaoAtual} />
              <span className="text-slate-400">→</span>
              <StatusBadge situacao={confirmar.destino} />
            </div>
            {confirmar.erroPermitidas && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="h-4 w-4" /> Transição não permitida pela configuração.
                </p>
                <p className="mt-1 text-xs">
                  A partir de "{situacaoAtual.nome}" só é permitido ir para:{' '}
                  {confirmar.erroPermitidas.length ? confirmar.erroPermitidas.map((p) => p.nome).join(', ') : 'nenhuma situação'}.
                  {ehAdmin ? ' Como administrador você pode forçar a alteração.' : ''}
                </p>
              </div>
            )}
            {confirmar.pendencias && <ListaPendencias pendencias={confirmar.pendencias.lista} vendaId={confirmar.pendencias.vendaId} contatoId={confirmar.pendencias.contatoId} onNavegar={() => setConfirmar(null)} />}
            {confirmar.custoPendente && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Antes de fechar a OS{confirmar.custoPendente.numero ? ` nº ${confirmar.custoPendente.numero}` : ''}, falta o custo:
                </p>
                <ul className="mt-2 space-y-1.5">
                  {confirmar.custoPendente.lista.map((p) => (
                    <li key={p.campo} className="flex flex-wrap items-start justify-between gap-2">
                      <span>• {p.mensagem}</span>
                      <Link to={`/ordens-servico/${confirmar.custoPendente!.osId}/editar`} onClick={() => setConfirmar(null)} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-700 hover:underline">
                        Editar OS <ExternalLink className="h-3 w-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">Sem o custo da peça, o lucro da assistência e o DRE não ficam reais. Dá para fechar assim mesmo e preencher depois — o Robô da Saúde deixa o lembrete no seu painel até o custo entrar.</p>
              </div>
            )}
            {confirmar.forcar && !confirmar.erroPermitidas && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta transição não está na matriz configurada. Será registrada como forçada (admin).</div>
            )}
            <Textarea label="Observação (opcional)" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Motivo da alteração, para o histórico" />
          </div>
        )}
      </Modal>
    </div>
  );
}
