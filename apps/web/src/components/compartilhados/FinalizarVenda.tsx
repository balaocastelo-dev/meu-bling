/**
 * "Finalizar venda": pergunta se deseja finalizar e só deixa confirmar com a venda completa
 * (cliente com nome, CPF, telefone, e-mail e endereço — ou Consumidor final —, produto, custo,
 * forma de pagamento e vendedor). Funciona a partir de qualquer situação.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import type { PendenciaFinalizacao } from '@/types';

interface Checagem {
  podeFinalizar: boolean;
  pendencias: PendenciaFinalizacao[];
  jaFinalizada: boolean;
  situacaoAtual: { id: number; nome: string };
  destino: { id: number; nome: string; cor: string };
  contatoId: number;
}

/** Lista do que falta, com link para abrir e corrigir. */
export function ListaPendencias({ pendencias, vendaId, contatoId, onNavegar }: { pendencias: PendenciaFinalizacao[]; vendaId: number; contatoId?: number | null; onNavegar?: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> Para finalizar, complete:
      </p>
      <ul className="mt-2 space-y-1.5">
        {pendencias.map((p) => {
          const para = p.onde === 'cliente' && contatoId ? `/contatos/${contatoId}/editar` : `/vendas/${vendaId}/editar`;
          return (
            <li key={p.campo} className="flex flex-wrap items-start justify-between gap-2">
              <span>• {p.mensagem}</span>
              <Link to={para} onClick={onNavegar} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-700 hover:underline">
                {p.onde === 'cliente' ? 'Abrir cadastro do cliente' : 'Editar venda'} <ExternalLink className="h-3 w-3" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FinalizarVendaModal({ vendaId, numero, aberto, onFechar }: { vendaId: number; numero: number; aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const [obs, setObs] = useState('');
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['venda-finalizacao', vendaId],
    queryFn: () => api.get<Checagem>(`/vendas/${vendaId}/finalizacao`),
    enabled: aberto,
    staleTime: 0,
  });

  const finalizar = useMutation({
    mutationFn: () => api.post<{ situacao: { nome: string }; acoesExecutadas: string[] }>(`/vendas/${vendaId}/finalizar`, { observacao: obs || undefined }),
    onSuccess: (r) => {
      toast.success(`Venda nº ${numero} finalizada (${r.situacao.nome}).`);
      ['vendas', 'dashboard-geral', 'painel-vendedor', 'contas-receber', 'caixa'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['venda', String(vendaId)] });
      qc.invalidateQueries({ queryKey: ['venda-finalizacao', vendaId] });
      setObs('');
      onFechar();
    },
    onError: (e) => {
      toast.error(mensagemErro(e));
      qc.invalidateQueries({ queryKey: ['venda-finalizacao', vendaId] });
    },
  });

  const pode = !!c?.podeFinalizar && !c.jaFinalizada;
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`Finalizar venda nº ${numero}`}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            {pode ? 'Não' : 'Fechar'}
          </Button>
          {pode && (
            <Button variante="sucesso" icone={<CheckCircle2 className="h-4 w-4" />} carregando={finalizar.isPending} onClick={() => finalizar.mutate()}>
              Sim, finalizar
            </Button>
          )}
        </>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Conferindo a venda…</p>}
      {error && <p className="text-sm text-red-600">{mensagemErro(error)}</p>}
      {c && c.jaFinalizada && <p className="text-sm text-emerald-700">Esta venda já está finalizada ({c.situacaoAtual.nome}).</p>}
      {c && !c.jaFinalizada && !c.podeFinalizar && <ListaPendencias pendencias={c.pendencias} vendaId={vendaId} contatoId={c.contatoId} onNavegar={onFechar} />}
      {c && pode && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700">
            Deseja finalizar a venda nº <b>{numero}</b>? Ela sai de <b>{c.situacaoAtual.nome}</b> e vai para <b>{c.destino.nome}</b> — o estoque é baixado e o pagamento é lançado no financeiro.
          </p>
          <Textarea label="Observação (opcional)" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Fica no histórico da venda" />
        </div>
      )}
    </Modal>
  );
}
