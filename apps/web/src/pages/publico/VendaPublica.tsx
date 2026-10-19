import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeCheck, CircleCheck, Clock, Loader2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, BadgeCor, Button, Card, Input, tomPorStatus } from '@/components/ui';
import { data, dataHora, moeda, numero, rotulo } from '@/lib/format';
import { LayoutPublico } from './LayoutPublico';
import type { VendaPublicaResposta } from '@/types';

/** Página pública do pedido de venda / orçamento (o cliente aprova o orçamento por aqui) */
export default function VendaPublica() {
  const { token } = useParams();
  const qc = useQueryClient();
  const [nome, setNome] = useState('');
  const { data: resp, isLoading, error } = useQuery({ queryKey: ['publico-venda', token], queryFn: () => api.get<VendaPublicaResposta>(`/publico/venda/${token}`), retry: 0 });
  const aprovar = useMutation({
    mutationFn: () => api.post(`/publico/venda/${token}/aprovar`, { nome: nome.trim() }),
    onSuccess: () => {
      toast.success('Orçamento aprovado. Obrigado! Vamos preparar o seu pedido.');
      qc.invalidateQueries({ queryKey: ['publico-venda', token] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading)
    return (
      <LayoutPublico>
        <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
      </LayoutPublico>
    );
  if (error || !resp?.venda)
    return (
      <LayoutPublico>
        <Card><p className="py-8 text-center text-sm text-slate-500">{error ? mensagemErro(error) : 'Pedido não encontrado.'}</p></Card>
      </LayoutPublico>
    );

  const v = resp.venda;
  const orcamento = v.tipo === 'ORCAMENTO';
  const temAjustes = (v.desconto ?? 0) > 0 || (v.frete ?? 0) > 0 || (v.outrasDespesas ?? 0) > 0;

  return (
    <LayoutPublico empresa={resp.empresa}>
      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{orcamento ? 'Orçamento' : 'Pedido'}</p>
              <h1 className="text-2xl font-bold text-slate-900">nº {v.numero}</h1>
              {v.cliente && <p className="text-sm text-slate-600">Olá, {v.cliente}!</p>}
              <p className="text-xs text-slate-400">{data(v.data)}{v.vendedor ? ` · atendimento: ${v.vendedor}` : ''}{!orcamento && v.dataPrevista ? ` · previsão ${data(v.dataPrevista)}` : ''}</p>
              {orcamento && v.validade && (
                <p className={`mt-1 inline-flex items-center gap-1 text-xs ${v.expirado ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                  <Clock className="h-3.5 w-3.5" /> {v.expirado ? 'Venceu em' : 'Válido até'} {data(v.validade)}
                </p>
              )}
            </div>
            <BadgeCor cor={v.situacao?.cor} tamanho="md">{v.situacao?.nome}</BadgeCor>
          </div>
          {v.observacoes && <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-600">{v.observacoes}</p>}
        </Card>
        <Card semPadding>
          <table className="tbl">
            <thead><tr><th>Item</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {v.itens.map((i, k) => <tr key={k}><td>{i.descricao}</td><td className="num text-right">{numero(i.quantidade)} {i.unidade ?? ''}</td><td className="num text-right">{moeda(i.valorUnitario)}</td><td className="num text-right">{moeda(i.total)}</td></tr>)}
              {temAjustes && (
                <>
                  <tr><td colSpan={3} className="text-right text-slate-500">Produtos</td><td className="num text-right">{moeda(v.totalProdutos)}</td></tr>
                  {(v.desconto ?? 0) > 0 && <tr><td colSpan={3} className="text-right text-slate-500">Desconto</td><td className="num text-right text-red-600">- {moeda(v.desconto)}</td></tr>}
                  {(v.frete ?? 0) > 0 && <tr><td colSpan={3} className="text-right text-slate-500">Frete</td><td className="num text-right">{moeda(v.frete)}</td></tr>}
                  {(v.outrasDespesas ?? 0) > 0 && <tr><td colSpan={3} className="text-right text-slate-500">Outras despesas</td><td className="num text-right">{moeda(v.outrasDespesas)}</td></tr>}
                </>
              )}
              <tr className="bg-slate-50 font-semibold"><td colSpan={3} className="px-3 py-2 text-right">Total</td><td className="num px-3 py-2 text-right text-base">{moeda(v.total)}</td></tr>
            </tbody>
          </table>
        </Card>
        {orcamento && (
          <Card>
            {v.aprovadoEm ? (
              <div className="flex items-center gap-3 text-emerald-700">
                <CircleCheck className="h-6 w-6" />
                <div>
                  <p className="font-semibold">Orçamento aprovado</p>
                  <p className="text-sm text-emerald-600">em {dataHora(v.aprovadoEm)} — já estamos preparando o seu pedido.</p>
                </div>
              </div>
            ) : v.podeAprovar ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-amber-700"><BadgeCheck className="h-5 w-5" /><p className="font-semibold">Aguardando sua aprovação</p></div>
                <p className="text-sm text-slate-600">Confira os itens acima. Ao aprovar, fechamos o pedido no valor de <strong className="num">{moeda(v.total)}</strong>.</p>
                <Input label="Seu nome (para registro)" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome de quem aprova" />
                <Button variante="sucesso" tamanho="lg" className="w-full" disabled={nome.trim().length < 2} carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>Aprovar orçamento</Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">{v.expirado ? 'Este orçamento venceu. Fale com a gente para atualizar os valores.' : 'Este orçamento não está mais disponível para aprovação. Fale com a gente se tiver dúvidas.'}</p>
            )}
          </Card>
        )}

        {v.parcelas && v.parcelas.length > 0 && (
          <Card titulo={orcamento ? 'Condições de pagamento' : 'Pagamento'} semPadding>
            <table className="tbl">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {v.parcelas.map((p) => (
                  <tr key={p.numero}><td>{p.numero}</td><td>{data(p.dataVencimento)}</td><td>{p.formaPagamento ?? '—'}</td><td className="num text-right">{moeda(p.valor)}</td><td>{!orcamento && p.situacao && <Badge tom={tomPorStatus(p.situacao)}>{rotulo(p.situacao)}</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </LayoutPublico>
  );
}
