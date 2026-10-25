import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Pencil, Printer, Trash2, Undo2, Zap } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, PageHeader, StatusChanger, Tabs, tomPorStatus } from '@/components/ui';
import { HistoricoSituacoes } from '@/components/compartilhados/HistoricoSituacoes';
import { chaveNfe, data, moeda, numero, rotulo } from '@/lib/format';
import type { Compra } from '@/types';

/** Detalhe do pedido de compra */
export default function CompraDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('itens');
  const [excluir, setExcluir] = useState(false);
  const { data: compra, isLoading, error } = useQuery({ queryKey: ['compra', id], queryFn: () => api.get<Compra>(`/compras/${id}`) });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['compra', id] });
    qc.invalidateQueries({ queryKey: ['compras'] });
  };
  const acoes = useMutation({
    mutationFn: (lista: string[]) => api.post(`/compras/${id}/acoes`, { acoes: lista }),
    onSuccess: (_, lista) => {
      toast.success(`Ação executada: ${lista.join(', ')}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (isLoading) return <FormSkeleton />;
  if (error || !compra) return <EmptyState titulo="Compra não encontrada" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/compras"><Button>Voltar</Button></Link>} />;

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Compras', para: '/compras' }, { rotulo: `Compra nº ${compra.numero}` }]}
        titulo={`Compra nº ${compra.numero}`}
        extra={<StatusChanger modulo="COMPRA" caminho={`/compras/${compra.id}`} situacaoAtual={compra.situacao} situacoesPermitidas={compra.situacoesPermitidas} invalidar={[['compra', id ?? ''], ['compras']]} />}
        descricao={`${data(compra.data)} · ${compra.fornecedor?.nome ?? ''}`}
        acoes={
          <>
            <Button variante="secundario" icone={<Printer className="h-4 w-4" />} onClick={() => abrirEmNovaAba(`/compras/${id}/imprimir`).catch((e) => toast.error(mensagemErro(e)))}>Imprimir</Button>
            <Link to={`/compras/${compra.id}/editar`}><Button variante="primario" icone={<Pencil className="h-4 w-4" />}>Editar</Button></Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Definicoes
            colunas={4}
            itens={[
              { rotulo: 'Fornecedor', valor: <Link to={`/contatos/${compra.fornecedorId}`} className="font-medium text-brand-600 hover:underline">{compra.fornecedor?.nome}</Link> },
              { rotulo: 'Depósito', valor: compra.deposito?.nome },
              { rotulo: 'Data', valor: data(compra.data) },
              { rotulo: 'Previsão', valor: compra.dataPrevista ? data(compra.dataPrevista) : '—' },
              { rotulo: 'Pedido no fornecedor', valor: compra.ordemCompra },
              { rotulo: 'NF nº', valor: compra.nfeNumero },
              { rotulo: 'Chave NF-e', valor: compra.nfeChave ? <span className="font-mono text-xs">{chaveNfe(compra.nfeChave)}</span> : '—', largo: true },
              ...(compra.observacoes ? [{ rotulo: 'Observações', valor: <span className="whitespace-pre-line">{compra.observacoes}</span>, largo: true }] : []),
            ]}
          />
        </Card>
        <Card titulo="Totais e lançamentos">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Produtos</span><span className="num">{moeda(compra.totalProdutos)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Desconto</span><span className="num text-red-600">- {moeda(compra.descontoValor)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Frete</span><span className="num">{moeda(compra.frete)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Outras</span><span className="num">{moeda(compra.outrasDespesas)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-semibold">Total</span><span className="num font-bold">{moeda(compra.total)}</span></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button tamanho="sm" variante={compra.estoqueLancado ? 'perigo' : 'secundario'} icone={compra.estoqueLancado ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([compra.estoqueLancado ? 'estornarEstoque' : 'lancarEstoque'])}>
              {compra.estoqueLancado ? 'Estornar estoque' : 'Dar entrada'}
            </Button>
            <Button tamanho="sm" variante={compra.contasLancadas ? 'perigo' : 'secundario'} icone={compra.contasLancadas ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([compra.contasLancadas ? 'estornarContas' : 'lancarContas'])}>
              {compra.contasLancadas ? 'Estornar contas' : 'Lançar contas'}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tom={compra.estoqueLancado ? 'verde' : 'cinza'}>Estoque {compra.estoqueLancado ? 'lançado' : 'pendente'}</Badge>
            <Badge tom={compra.contasLancadas ? 'verde' : 'cinza'}>Contas {compra.contasLancadas ? 'lançadas' : 'pendentes'}</Badge>
          </div>
        </Card>
      </div>

      <Card semPadding>
        <Tabs className="px-3" ativa={aba} onMudar={setAba} abas={[{ id: 'itens', rotulo: 'Itens', contador: compra.itens.length }, { id: 'parcelas', rotulo: 'Parcelas / Contas a pagar', contador: compra.parcelas.length }, { id: 'historico', rotulo: 'Histórico', contador: compra.historico?.length ?? 0 }]} />
        <div className="p-4">
          {aba === 'itens' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead>
                <tr><th>#</th><th>Produto</th><th>Cód. fornecedor</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">IPI %</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {compra.itens.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{i + 1}</td>
                    <td className="pilha-cheio">{it.produtoId ? <Link to={`/produtos/${it.produtoId}`} className="hover:text-brand-600">{it.descricao}</Link> : it.descricao}</td>
                    <td className="text-slate-500" data-rotulo="Cód. fornecedor">{it.codigoFornecedor ?? '—'}</td>
                    <td className="num text-right" data-rotulo="Qtd">{numero(it.quantidade)} {it.unidade}</td>
                    <td className="num text-right" data-rotulo="Unitário">{moeda(it.valorUnitario)}</td>
                    <td className="num text-right" data-rotulo="IPI %">{numero(it.ipiPct)}%</td>
                    <td className="num text-right font-medium" data-rotulo="Total">{moeda(it.total ?? it.quantidade * it.valorUnitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'parcelas' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead><tr><th>#</th><th>Vencimento</th><th>Forma</th><th className="text-right">Valor</th><th>Conta a pagar</th><th className="text-right">Pago</th></tr></thead>
              <tbody>
                {compra.parcelas.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-xs text-slate-400">Sem parcelas.</td></tr>}
                {compra.parcelas.map((p, i) => (
                  <tr key={p.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{p.numero ?? i + 1}</td>
                    <td data-rotulo="Vencimento">{data(p.dataVencimento)}</td>
                    <td data-rotulo="Forma">{p.formaPagamento?.nome ?? '—'}</td>
                    <td className="num text-right" data-rotulo="Valor">{moeda(p.valor)}</td>
                    <td data-rotulo="Conta a pagar">{p.contaPagar ? <Link to={`/financeiro/pagar?pesquisa=${compra.numero}`} className="inline-flex items-center gap-1.5 hover:underline">#{p.contaPagar.id} <Badge tom={tomPorStatus(p.contaPagar.situacao)}>{rotulo(p.contaPagar.situacao)}</Badge></Link> : <span className="text-xs text-slate-400">não lançada</span>}</td>
                    <td className="num text-right" data-rotulo="Pago">{p.contaPagar ? moeda(p.contaPagar.valorPago) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'historico' && <HistoricoSituacoes historico={compra.historico} />}
        </div>
      </Card>

      {!compra.estoqueLancado && !compra.contasLancadas && (
        <div className="flex justify-end">
          <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir compra</Button>
        </div>
      )}
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir compra?" descricao={`A compra nº ${compra.numero} será removida.`} textoConfirmar="Excluir" onConfirmar={async () => { try { await api.del(`/compras/${id}`); toast.success('Compra excluída.'); qc.invalidateQueries({ queryKey: ['compras'] }); nav('/compras'); } catch (e) { toast.error(mensagemErro(e)); } }} />
    </div>
  );
}
