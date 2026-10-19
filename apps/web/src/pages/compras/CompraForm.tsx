import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, UserPlus, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useCategoriasFinanceiras, useDepositos, useSituacoes, opcoesDe } from '@/hooks/useListas';
import { buscarContatos, buscarProdutos } from '@/lib/buscas';
import { Button, DateInput, FormSkeleton, Input, MoneyInput, PageHeader, SearchSelect, Secao, Select, Textarea } from '@/components/ui';
import { ParcelasEditor, parcelasValidas } from '@/components/compartilhados/ParcelasEditor';
import { ContatoRapidoDrawer } from '@/components/compartilhados/ContatoRapidoDrawer';
import { arred, dataIso, hoje, moeda } from '@/lib/format';
import type { Compra, CompraItem, CompraPayload, Produto } from '@/types';

function vazio(): CompraPayload {
  return {
    fornecedorId: null,
    data: hoje(),
    dataPrevista: null,
    depositoId: null,
    situacaoId: null,
    categoriaFinanceiraId: null,
    ordemCompra: '',
    nfeChave: '',
    nfeNumero: '',
    descontoValor: 0,
    frete: 0,
    outrasDespesas: 0,
    observacoes: '',
    observacoesInternas: '',
    itens: [],
    parcelas: [],
  };
}

function deCompra(c: Compra): CompraPayload {
  return {
    fornecedorId: c.fornecedorId,
    data: dataIso(c.data),
    dataPrevista: c.dataPrevista ? dataIso(c.dataPrevista) : null,
    depositoId: c.depositoId,
    situacaoId: c.situacao?.id ?? null,
    categoriaFinanceiraId: c.categoriaFinanceiraId,
    ordemCompra: c.ordemCompra ?? '',
    nfeChave: c.nfeChave ?? '',
    nfeNumero: c.nfeNumero ?? '',
    descontoValor: c.descontoValor,
    frete: c.frete,
    outrasDespesas: c.outrasDespesas,
    observacoes: c.observacoes ?? '',
    observacoesInternas: c.observacoesInternas ?? '',
    itens: c.itens.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, codigoFornecedor: i.codigoFornecedor, unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, ipiPct: i.ipiPct })),
    parcelas: c.parcelas.map((p) => ({ dataVencimento: dataIso(p.dataVencimento), valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes ?? '' })),
  };
}

function totalItem(i: CompraItem) {
  const base = i.quantidade * i.valorUnitario;
  return arred(base + base * ((i.ipiPct || 0) / 100));
}

/** Formulário de pedido de compra */
export default function CompraForm() {
  const { id } = useParams();
  const editando = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: depositos } = useDepositos();
  const { data: categorias } = useCategoriasFinanceiras();
  const { data: situacoes } = useSituacoes('COMPRA');

  const [form, setForm] = useState<CompraPayload>(vazio);
  const [fornecedorNome, setFornecedorNome] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  const { data: compra, isLoading } = useQuery({ queryKey: ['compra', id], queryFn: () => api.get<Compra>(`/compras/${id}`), enabled: editando });

  useEffect(() => {
    if (compra) {
      setForm(deCompra(compra));
      setFornecedorNome(compra.fornecedor?.nome ?? null);
    }
  }, [compra]);

  useEffect(() => {
    if (editando) return;
    setForm((f) => ({
      ...f,
      depositoId: f.depositoId ?? depositos?.find((d) => d.padrao)?.id ?? null,
      categoriaFinanceiraId: f.categoriaFinanceiraId ?? categorias?.find((c) => c.tipo === 'DESPESA' && /CMV|mercadoria/i.test(c.nome))?.id ?? null,
    }));
  }, [depositos, categorias, editando]);

  const set = <K extends keyof CompraPayload>(k: K, v: CompraPayload[K]) => setForm((f) => ({ ...f, [k]: v }));
  const totais = useMemo(() => {
    const totalProdutos = arred(form.itens.reduce((s, i) => s + totalItem(i), 0));
    const total = arred(totalProdutos - form.descontoValor + form.frete + form.outrasDespesas);
    return { totalProdutos, total };
  }, [form]);
  const bloqueado = !!compra && (compra.estoqueLancado || compra.contasLancadas);

  const adicionarProduto = (p: Produto) =>
    setForm((f) => ({ ...f, itens: [...f.itens, { produtoId: p.id, descricao: p.nome, codigoFornecedor: '', unidade: p.unidade, quantidade: 1, valorUnitario: p.precoCusto || 0, ipiPct: 0 }] }));
  const atualizarItem = (i: number, patch: Partial<CompraItem>) => setForm((f) => ({ ...f, itens: f.itens.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const removerItem = (i: number) => setForm((f) => ({ ...f, itens: f.itens.filter((_, j) => j !== i) }));

  const salvar = useMutation({
    mutationFn: (p: CompraPayload) => (editando ? api.put<Compra>(`/compras/${id}`, p) : api.post<Compra>('/compras', p)),
    onSuccess: (c) => {
      toast.success(editando ? 'Compra atualizada.' : `Compra nº ${c.numero} criada.`);
      qc.invalidateQueries({ queryKey: ['compras'] });
      qc.invalidateQueries({ queryKey: ['compra', String(c.id)] });
      nav(`/compras/${c.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    const e: Record<string, string> = {};
    if (!form.fornecedorId) e.fornecedorId = 'Selecione o fornecedor';
    if (form.itens.length === 0) e.itens = 'Adicione ao menos um item';
    if (!parcelasValidas(form.parcelas, totais.total)) e.parcelas = 'A soma das parcelas deve ser igual ao total';
    setErros(e);
    if (Object.keys(e).length) return toast.error(Object.values(e)[0]);
    salvar.mutate(form);
  };

  if (editando && isLoading) return <FormSkeleton />;

  return (
    <div className="pb-24">
      <PageHeader
        migalhas={[{ rotulo: 'Compras', para: '/compras' }, { rotulo: editando ? `Compra nº ${compra?.numero ?? ''}` : 'Nova compra' }]}
        titulo={editando ? `Editar compra nº ${compra?.numero ?? ''}` : 'Nova compra'}
        descricao={bloqueado ? 'Estoque/contas já lançados — estorne antes de alterar itens.' : 'Pedido de compra ao fornecedor. Ao atender, o estoque entra e o custo do produto é atualizado.'}
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav(editando ? `/compras/${id}` : '/compras')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </>
        }
      />

      <div className="space-y-4">
        <Secao titulo="Dados do pedido">
          <div className="grid gap-3 md:grid-cols-12">
            <SearchSelect
              className="md:col-span-5"
              label="Fornecedor"
              obrigatorio
              erro={erros.fornecedorId}
              valor={form.fornecedorId}
              rotuloAtual={fornecedorNome}
              disabled={bloqueado}
              buscar={(t) => buscarContatos(t, 'FORNECEDOR')}
              onChange={(v, op) => {
                set('fornecedorId', v);
                setFornecedorNome(op?.rotulo ?? null);
              }}
              rodape={
                <button type="button" onClick={() => setDrawer(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-brand-600 hover:bg-brand-50">
                  <UserPlus className="h-4 w-4" /> Cadastrar novo fornecedor
                </button>
              }
            />
            <DateInput className="md:col-span-2" label="Data" obrigatorio value={form.data} onChange={(v) => set('data', v)} disabled={bloqueado} />
            <DateInput className="md:col-span-2" label="Previsão de entrega" value={form.dataPrevista} onChange={(v) => set('dataPrevista', v || null)} />
            <Select className="md:col-span-3" label="Depósito de entrada" value={form.depositoId ?? ''} onChange={(e) => set('depositoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(depositos)} placeholder="—" disabled={bloqueado} />
            <Input className="md:col-span-3" label="Nº pedido no fornecedor" value={form.ordemCompra} onChange={(e) => set('ordemCompra', e.target.value)} />
            <Input className="md:col-span-2" label="NF nº" value={form.nfeNumero} onChange={(e) => set('nfeNumero', e.target.value)} />
            <Input className="md:col-span-4" label="Chave da NF-e" value={form.nfeChave} onChange={(e) => set('nfeChave', e.target.value.replace(/\D/g, ''))} maxLength={44} inputMode="numeric" />
            <Select className="md:col-span-3" label="Categoria financeira" value={form.categoriaFinanceiraId ?? ''} onChange={(e) => set('categoriaFinanceiraId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(categorias?.filter((c) => c.tipo === 'DESPESA'))} placeholder="—" disabled={bloqueado} />
            {!editando && <Select className="md:col-span-3" label="Situação inicial" value={form.situacaoId ?? ''} onChange={(e) => set('situacaoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(situacoes)} placeholder="Padrão (inicial)" />}
          </div>
        </Secao>

        <Secao
          titulo="Itens"
          acoes={!bloqueado && <Button tamanho="sm" variante="fantasma" icone={<Plus className="h-4 w-4" />} onClick={() => setForm((f) => ({ ...f, itens: [...f.itens, { produtoId: null, descricao: '', codigoFornecedor: '', quantidade: 1, valorUnitario: 0, ipiPct: 0 }] }))}>Linha livre</Button>}
        >
          {!bloqueado && <SearchSelect placeholder="Buscar produto… (Enter adiciona)" valor={null} onChange={(_, op) => op?.dados && adicionarProduto(op.dados as Produto)} buscar={(t) => buscarProdutos(t, 'P')} limparAoSelecionar className="mb-3" />}
          {erros.itens && <p className="mb-2 text-xs text-red-600">{erros.itens}</p>}
          <div className="overflow-auto rounded-md border border-slate-200">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Descrição</th>
                  <th className="w-32">Cód. fornecedor</th>
                  <th className="w-24 text-right">Qtd</th>
                  <th className="w-32 text-right">Unitário</th>
                  <th className="w-20 text-right">IPI %</th>
                  <th className="w-32 text-right">Total</th>
                  {!bloqueado && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {form.itens.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-sm text-slate-400">Nenhum item.</td>
                  </tr>
                )}
                {form.itens.map((it, i) => (
                  <tr key={i}>
                    <td className="text-slate-400">{i + 1}</td>
                    <td><input disabled={bloqueado} value={it.descricao} onChange={(e) => atualizarItem(i, { descricao: e.target.value })} className="input-base h-8 py-0" /></td>
                    <td><input disabled={bloqueado} value={it.codigoFornecedor ?? ''} onChange={(e) => atualizarItem(i, { codigoFornecedor: e.target.value })} className="input-base h-8 py-0" /></td>
                    <td><MoneyInput value={it.quantidade} onChange={(v) => atualizarItem(i, { quantidade: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                    <td><MoneyInput value={it.valorUnitario} onChange={(v) => atualizarItem(i, { valorUnitario: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                    <td><MoneyInput value={it.ipiPct} onChange={(v) => atualizarItem(i, { ipiPct: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                    <td className="num text-right font-medium">{moeda(totalItem(it))}</td>
                    {!bloqueado && (
                      <td>
                        <button type="button" onClick={() => removerItem(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>

        <div className="grid gap-4 lg:grid-cols-3">
          <Secao titulo="Observações" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Observações" value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} rows={3} />
              <Textarea label="Observações internas" value={form.observacoesInternas} onChange={(e) => set('observacoesInternas', e.target.value)} rows={3} />
            </div>
          </Secao>
          <Secao titulo="Totais">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Produtos (c/ IPI)</span><span className="num">{moeda(totais.totalProdutos)}</span></div>
              <div className="flex items-center gap-2"><span className="flex-1 text-slate-500">Desconto</span><MoneyInput value={form.descontoValor} onChange={(v) => set('descontoValor', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" /></div>
              <div className="flex items-center gap-2"><span className="flex-1 text-slate-500">Frete</span><MoneyInput value={form.frete} onChange={(v) => set('frete', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" /></div>
              <div className="flex items-center gap-2"><span className="flex-1 text-slate-500">Outras despesas</span><MoneyInput value={form.outrasDespesas} onChange={(v) => set('outrasDespesas', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" /></div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3"><span className="font-semibold">TOTAL</span><span className="num text-2xl font-bold">{moeda(totais.total)}</span></div>
            </div>
          </Secao>
        </div>

        <Secao titulo="Pagamento / parcelas" descricao="Ao lançar contas, cada parcela vira uma conta a pagar.">
          {erros.parcelas && <p className="mb-2 text-xs text-red-600">{erros.parcelas}</p>}
          <ParcelasEditor parcelas={form.parcelas} onChange={(p) => set('parcelas', p)} total={totais.total} disabled={bloqueado} />
        </Secao>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3">
          <div className="text-sm text-slate-500">Total <span className="num font-semibold text-slate-900">{moeda(totais.total)}</span></div>
          <div className="flex gap-2">
            <Button variante="secundario" onClick={() => nav(editando ? `/compras/${id}` : '/compras')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </div>
        </div>
      </div>

      <ContatoRapidoDrawer tipo="FORNECEDOR" aberto={drawer} onFechar={() => setDrawer(false)} onCriado={(c) => { set('fornecedorId', c.id); setFornecedorNome(c.nome); }} />
    </div>
  );
}
