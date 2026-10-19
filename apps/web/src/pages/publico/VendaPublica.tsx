import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, BadgeCor, Card, tomPorStatus } from '@/components/ui';
import { data, moeda, numero, rotulo } from '@/lib/format';
import { LayoutPublico } from './LayoutPublico';
import type { VendaPublicaResposta } from '@/types';

/** Página pública de resumo do pedido de venda */
export default function VendaPublica() {
  const { token } = useParams();
  const { data: resp, isLoading, error } = useQuery({ queryKey: ['publico-venda', token], queryFn: () => api.get<VendaPublicaResposta>(`/publico/venda/${token}`), retry: 0 });

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
  const temAjustes = (v.desconto ?? 0) > 0 || (v.frete ?? 0) > 0 || (v.outrasDespesas ?? 0) > 0;

  return (
    <LayoutPublico empresa={resp.empresa}>
      <div className="space-y-4">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Pedido</p>
              <h1 className="text-2xl font-bold text-slate-900">nº {v.numero}</h1>
              {v.cliente && <p className="text-sm text-slate-600">Olá, {v.cliente}!</p>}
              <p className="text-xs text-slate-400">{data(v.data)}{v.vendedor ? ` · atendimento: ${v.vendedor}` : ''}{v.dataPrevista ? ` · previsão ${data(v.dataPrevista)}` : ''}</p>
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
        {v.parcelas && v.parcelas.length > 0 && (
          <Card titulo="Pagamento" semPadding>
            <table className="tbl">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {v.parcelas.map((p) => (
                  <tr key={p.numero}><td>{p.numero}</td><td>{data(p.dataVencimento)}</td><td>{p.formaPagamento ?? '—'}</td><td className="num text-right">{moeda(p.valor)}</td><td>{p.situacao && <Badge tom={tomPorStatus(p.situacao)}>{rotulo(p.situacao)}</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </LayoutPublico>
  );
}
