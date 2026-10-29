/** Link de pagamento do Mercado Pago dentro do pedido: o vendedor gera, copia ou manda pelo WhatsApp. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, CreditCard, MessageCircle, RefreshCw } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { MoneyInput } from '@/components/ui';
import { dataHora, moeda } from '@/lib/format';

export function LinkPagamento({ venda }: { venda: { id: number; numero: number; total: number; linkPagamentoUrl?: string | null; linkPagamentoValor?: number | null; linkPagamentoEm?: string | null; contato?: { celular?: string | null; nome?: string | null } | null } }) {
  const qc = useQueryClient();
  const [valor, setValor] = useState(venda.total);
  const [erroConfig, setErroConfig] = useState(false);
  const gerar = useMutation({
    mutationFn: () => api.post<{ url: string; valor: number }>(`/vendas/${venda.id}/link-pagamento`, { valor }),
    onSuccess: async (r) => {
      setErroConfig(false);
      try {
        await navigator.clipboard.writeText(r.url);
        toast.success(`Link de ${moeda(r.valor)} gerado e copiado.`);
      } catch {
        toast.success(`Link de ${moeda(r.valor)} gerado.`);
      }
      qc.invalidateQueries({ queryKey: ['venda', String(venda.id)] });
    },
    onError: (e: any) => {
      if (e?.code === 'MERCADOPAGO_SEM_TOKEN' || e?.code === 'MERCADOPAGO_TOKEN') setErroConfig(true);
      toast.error(mensagemErro(e));
    },
  });
  const url = venda.linkPagamentoUrl;
  const fone = (venda.contato?.celular || '').replace(/\D/g, '');
  const msg = encodeURIComponent(`Olá${venda.contato?.nome ? ` ${venda.contato.nome.split(' ')[0]}` : ''}! Segue o link para pagamento do pedido nº ${venda.numero} da Balão da Informática (${moeda(venda.linkPagamentoValor ?? venda.total)}): ${url}`);
  return (
    <div className="space-y-2 rounded-md border border-sky-200 bg-sky-50/60 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-sky-900">
        <CreditCard className="h-4 w-4" /> Link de pagamento (Mercado Pago)
      </p>
      {url ? (
        <>
          <div className="flex items-center gap-2">
            <input readOnly value={url} className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700" onFocus={(e) => e.target.select()} />
            <Button tamanho="sm" variante="secundario" icone={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard.writeText(url).then(() => toast.success('Link copiado.'))}>Copiar</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{moeda(venda.linkPagamentoValor ?? 0)}{venda.linkPagamentoEm ? ` · gerado em ${dataHora(venda.linkPagamentoEm)}` : ''}</span>
            {fone && (
              <a className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={`https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${msg}`} target="_blank" rel="noreferrer">
                <MessageCircle className="h-3.5 w-3.5" /> Mandar no WhatsApp
              </a>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-600">O cliente paga no cartão (até 12x) ou PIX pelo Mercado Pago.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <MoneyInput label="Valor do link" value={valor} onChange={setValor} className="w-40" />
        <Button tamanho="sm" variante={url ? 'secundario' : 'primario'} icone={url ? <RefreshCw className="h-3.5 w-3.5" /> : <CreditCard className="h-3.5 w-3.5" />} disabled={!(valor > 0)} carregando={gerar.isPending} onClick={() => gerar.mutate()}>
          {url ? 'Gerar novo link' : 'Gerar link de pagamento'}
        </Button>
      </div>
      {erroConfig && (
        <p className="text-xs text-amber-800">
          Falta configurar o Mercado Pago. <Link to="/configuracoes/mercado-pago" className="font-medium underline">Abrir configuração</Link> (só o administrador).
        </p>
      )}
    </div>
  );
}
