import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, UserPlus, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useCategoriasFinanceiras, useDepositos, useSituacoes, useVendedores, opcoesDe } from '@/hooks/useListas';
import { useAuth } from '@/stores/auth';
import { FotoProduto, SeloProntaEntrega } from '@/components/compartilhados/ProdutoSite';
import { buscarContatos, buscarProdutos } from '@/lib/buscas';
import { Button, DateInput, FormSkeleton, Input, MoneyInput, PageHeader, SearchSelect, Secao, Select, Textarea } from '@/components/ui';
import { ParcelasEditor, parcelasValidas } from '@/components/compartilhados/ParcelasEditor';
import { ContatoRapidoDrawer } from '@/components/compartilhados/ContatoRapidoDrawer';
import { arred, dataIso, hoje, moeda, rotulo } from '@/lib/format';
import type { Contato, Produto, TipoVenda, Venda, VendaItem, VendaPayload } from '@/types';

const ORIGENS = ['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'] as const;

/** data (yyyy-mm-dd) + n dias */
function maisDias(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dataIso(d.toISOString());
}

function vazio(vendedorId: number | null, tipo: TipoVenda): VendaPayload {
  return {
    tipo,
    validade: tipo === 'ORCAMENTO' ? maisDias(hoje(), 7) : null,
    contatoId: null,
    vendedorId,
    data: hoje(),
    dataPrevista: null,
    depositoId: null,
    situacaoId: null,
    origem: 'BALCAO',
    categoriaFinanceiraId: null,
    observacoes: '',
    observacoesInternas: '',
    descontoTipo: 'REAL',
    descontoValor: 0,
    frete: 0,
    outrasDespesas: 0,
    custoLogistica: 0,
    transportadoraId: null,
    fretePorConta: 9,
    quantidadeVolumes: 0,
    pesoBruto: 0,
    itens: [],
    parcelas: [],
  };
}

function deVenda(v: Venda): VendaPayload {
  return {
    validade: v.validade ? dataIso(v.validade) : null,
    contatoId: v.contatoId,
    vendedorId: v.vendedorId,
    data: dataIso(v.data),
    dataPrevista: v.dataPrevista ? dataIso(v.dataPrevista) : null,
    depositoId: v.depositoId,
    situacaoId: v.situacao?.id ?? null,
    origem: v.origem,
    categoriaFinanceiraId: v.categoriaFinanceiraId,
    observacoes: v.observacoes ?? '',
    observacoesInternas: v.observacoesInternas ?? '',
    descontoTipo: v.descontoTipo,
    descontoValor: v.descontoValor,
    frete: v.frete,
    outrasDespesas: v.outrasDespesas,
    custoLogistica: v.custoLogistica ?? 0,
    transportadoraId: v.transportadoraId ?? null,
    fretePorConta: v.fretePorConta,
    quantidadeVolumes: v.quantidadeVolumes,
    pesoBruto: v.pesoBruto,
    itens: v.itens.map((i) => ({ produtoId: i.produtoId, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, comissaoPct: i.comissaoPct, custoUnitario: i.custoUnitario ?? 0, custoInformado: !!i.custoInformado, imagemUrl: i.produto?.imagemUrl ?? null, prontaEntrega: Boolean(i.produto?.prontaEntrega) })),
    parcelas: v.parcelas.map((p) => ({ dataVencimento: dataIso(p.dataVencimento), valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes ?? '' })),
  };
}

/** Calcula totais no cliente (o servidor recalcula ao salvar) */
export function calcularTotais(f: { itens: { quantidade: number; valorUnitario: number; desconto: number }[]; descontoTipo: 'REAL' | 'PERCENTUAL'; descontoValor: number; frete: number; outrasDespesas: number }) {
  const totalProdutos = arred(f.itens.reduce((s, i) => s + arred(i.quantidade * i.valorUnitario - (i.desconto || 0)), 0));
  const desconto = f.descontoTipo === 'PERCENTUAL' ? arred(totalProdutos * (f.descontoValor / 100)) : arred(f.descontoValor);
  const total = arred(totalProdutos - desconto + (f.frete || 0) + (f.outrasDespesas || 0));
  return { totalProdutos, desconto, total };
}

/** Formulário de venda / orçamento (novo e edição) */
export default function VendaForm({ tipo = 'PEDIDO' }: { tipo?: TipoVenda }) {
  const { id } = useParams();
  const editando = !!id;
  const nav = useNavigate();
  const orcamento = tipo === 'ORCAMENTO';
  const base = orcamento ? '/orcamentos' : '/vendas';
  const nomeDoc = orcamento ? 'orçamento' : 'venda';
  const qc = useQueryClient();
  const usuario = useAuth((s) => s.usuario);

  const { data: vendedores } = useVendedores();
  const { data: depositos } = useDepositos();
  const { data: categorias } = useCategoriasFinanceiras();
  const { data: situacoes } = useSituacoes(orcamento ? 'ORCAMENTO' : 'VENDA');

  const [form, setForm] = useState<VendaPayload>(() => vazio(usuario?.vendedorId ?? null, tipo));
  const [clienteNome, setClienteNome] = useState<string | null>(null);
  const [cliente, setCliente] = useState<Contato | null>(null);
  const [drawerCliente, setDrawerCliente] = useState(false);
  const [produtoSel, setProdutoSel] = useState<number | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});

  const { data: venda, isLoading } = useQuery({ queryKey: ['venda', id], queryFn: () => api.get<Venda>(`/vendas/${id}`), enabled: editando });

  // Cliente pré-selecionado via ?contatoId= (vindo da ficha do cliente)
  const [sp] = useSearchParams();
  const contatoInicial = sp.get('contatoId');
  const { data: contatoPre } = useQuery({ queryKey: ['contato', contatoInicial], queryFn: () => api.get<Contato>(`/contatos/${contatoInicial}`), enabled: !editando && !!contatoInicial });
  useEffect(() => {
    if (contatoPre) {
      setForm((f) => ({ ...f, contatoId: contatoPre.id }));
      setClienteNome(contatoPre.nome);
      setCliente(contatoPre);
    }
  }, [contatoPre]);

  // Preenche o formulário ao editar
  useEffect(() => {
    if (venda) {
      setForm(deVenda(venda));
      setClienteNome(venda.contato?.nome ?? null);
      if ('tipo' in venda.contato) setCliente(venda.contato as Contato);
    }
  }, [venda]);

  // Depósito padrão e categoria padrão no novo
  useEffect(() => {
    if (editando) return;
    setForm((f) => ({
      ...f,
      depositoId: f.depositoId ?? depositos?.find((d) => d.padrao)?.id ?? depositos?.[0]?.id ?? null,
      categoriaFinanceiraId: f.categoriaFinanceiraId ?? categorias?.find((c) => c.tipo === 'RECEITA' && /venda/i.test(c.nome))?.id ?? null,
    }));
  }, [depositos, categorias, editando]);

  const set = <K extends keyof VendaPayload>(k: K, v: VendaPayload[K]) => setForm((f) => ({ ...f, [k]: v }));
  const totais = useMemo(() => calcularTotais(form), [form]);
  const bloqueado = !!venda && (venda.estoqueLancado || venda.contasLancadas);
  const comissaoPadrao = vendedores?.find((v) => v.id === form.vendedorId)?.comissaoPadraoPct ?? 0;
  const veLucro = usuario?.perfil === 'ADMIN' || usuario?.perfil === 'GERENTE';
  const custos = useMemo(() => {
    const produtos = arred(form.itens.reduce((s, i) => s + (i.custoUnitario || 0) * i.quantidade, 0));
    const total = arred(produtos + (form.custoLogistica || 0));
    const lucro = arred(totais.total - total);
    return { produtos, total, lucro, margem: totais.total > 0 ? (lucro / totais.total) * 100 : 0, semCusto: form.itens.filter((i) => !i.custoUnitario).length };
  }, [form.itens, form.custoLogistica, totais.total]);

  // ---- Itens
  const adicionarProduto = (p: Produto) => {
    setForm((f) => {
      const existente = f.itens.findIndex((i) => i.produtoId === p.id);
      if (existente >= 0) {
        const itens = f.itens.map((i, idx) => (idx === existente ? { ...i, quantidade: i.quantidade + 1 } : i));
        return { ...f, itens };
      }
      const novo: VendaItem = { produtoId: p.id, codigo: p.codigo ?? null, descricao: p.nome, unidade: p.unidade, quantidade: 1, valorUnitario: p.preco, desconto: 0, comissaoPct: comissaoPadrao, custoUnitario: p.precoCusto ?? 0, custoInformado: false, imagemUrl: p.imagemUrl ?? null, prontaEntrega: Boolean(p.prontaEntrega) };
      return { ...f, itens: [...f.itens, novo] };
    });
    setProdutoSel(null);
  };
  const adicionarLinhaLivre = () => setForm((f) => ({ ...f, itens: [...f.itens, { produtoId: null, descricao: '', quantidade: 1, valorUnitario: 0, desconto: 0, comissaoPct: comissaoPadrao, custoUnitario: 0, custoInformado: false }] }));
  const atualizarItem = (i: number, patch: Partial<VendaItem>) => setForm((f) => ({ ...f, itens: f.itens.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  // linha livre → produto do cadastro (mantém quantidade e preço digitados)
  const [vincular, setVincular] = useState<number | null>(null);
  const vincularProduto = (i: number, p: Produto) => {
    atualizarItem(i, { produtoId: p.id, codigo: p.codigo ?? null, descricao: p.nome, unidade: p.unidade, ...(form.itens[i]?.custoInformado ? {} : { custoUnitario: p.precoCusto ?? 0 }), imagemUrl: p.imagemUrl ?? null, prontaEntrega: Boolean(p.prontaEntrega) });
    setVincular(null);
  };
  const removerItem = (i: number) => setForm((f) => ({ ...f, itens: f.itens.filter((_, j) => j !== i) }));

  // ---- Salvar
  const salvar = useMutation({
    mutationFn: (p: VendaPayload) => (editando ? api.put<Venda>(`/vendas/${id}`, { ...p, tipo: undefined }) : api.post<Venda>('/vendas', { ...p, tipo })),
    onSuccess: (v) => {
      const Nome = orcamento ? 'Orçamento' : 'Venda';
      toast.success(editando ? `${Nome} atualizado.` : `${Nome} nº ${v.numero} criado.`, orcamento && !editando ? { description: 'Agora é só enviar por e-mail ou WhatsApp em "Mais ações".' } : undefined);
      qc.invalidateQueries({ queryKey: ['vendas'] });
      qc.invalidateQueries({ queryKey: ['venda', String(v.id)] });
      nav(`${base}/${v.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const validar = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.contatoId) e.contatoId = 'Selecione o cliente';
    if (!form.data) e.data = 'Informe a data';
    if (form.itens.length === 0) e.itens = 'Adicione ao menos um item';
    form.itens.forEach((it, i) => {
      if (!it.descricao.trim()) e[`item${i}`] = 'Descrição obrigatória';
      if (it.quantidade <= 0) e[`item${i}`] = 'Quantidade inválida';
    });
    if (!parcelasValidas(form.parcelas, totais.total)) e.parcelas = 'A soma das parcelas deve ser igual ao total';
    setErros(e);
    if (Object.keys(e).length) toast.error(Object.values(e)[0]);
    return Object.keys(e).length === 0;
  };

  const submeter = () => {
    if (!validar()) return;
    // custo só vai como "informado" quando o vendedor digitou; senão o servidor usa o do cadastro
    salvar.mutate({ ...form, itens: form.itens.map((i, idx) => ({ ...i, custoUnitario: i.custoInformado ? i.custoUnitario ?? 0 : null, ordem: idx })) as VendaItem[] });
  };

  if (editando && isLoading) return <FormSkeleton />;

  return (
    <div className="espaco-barra-fixa">
      <PageHeader
        migalhas={[{ rotulo: orcamento ? 'Orçamentos' : 'Vendas', para: base }, { rotulo: editando ? `${orcamento ? 'Orçamento' : 'Venda'} nº ${venda?.numero ?? ''}` : orcamento ? 'Novo orçamento' : 'Nova venda' }]}
        titulo={editando ? `Editar ${nomeDoc} nº ${venda?.numero ?? ''}` : orcamento ? 'Novo orçamento' : 'Nova venda'}
        descricao={
          bloqueado
            ? 'Estoque/contas já lançados: só observações, transporte e custos internos podem ser alterados. Estorne antes para editar itens.'
            : orcamento
              ? 'O orçamento não mexe no estoque nem no financeiro. Depois de salvar, envie ao cliente e converta em venda quando ele aprovar.'
              : 'Preencha cliente, itens e condições de pagamento.'
        }
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav(editando ? `${base}/${id}` : base)}>
              Cancelar
            </Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>
              {editando ? 'Salvar alterações' : orcamento ? 'Salvar orçamento' : 'Salvar venda'}
            </Button>
          </>
        }
      />

      <div className="space-y-4">
        {/* Cabeçalho */}
        <Secao titulo={orcamento ? 'Dados do orçamento' : 'Dados do pedido'}>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <SearchSelect
              className="sm:col-span-2 xl:col-span-5"
              label="Cliente"
              obrigatorio
              erro={erros.contatoId}
              valor={form.contatoId}
              rotuloAtual={clienteNome}
              disabled={bloqueado}
              buscar={(t) => buscarContatos(t, 'CLIENTE')}
              onChange={(idSel, op) => {
                set('contatoId', idSel);
                setClienteNome(op?.rotulo ?? null);
                setCliente((op?.dados as Contato) ?? null);
              }}
              rodape={
                <button type="button" onClick={() => setDrawerCliente(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-brand-600 hover:bg-brand-50">
                  <UserPlus className="h-4 w-4" /> Cadastrar novo cliente
                </button>
              }
            />
            <Select className="xl:col-span-3" label="Vendedor" value={form.vendedorId ?? ''} onChange={(e) => set('vendedorId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(vendedores)} placeholder="—" disabled={bloqueado} />
            <DateInput className="xl:col-span-2" label="Data" obrigatorio erro={erros.data} value={form.data} onChange={(v) => set('data', v)} disabled={bloqueado} />
            {orcamento ? (
              <DateInput className="xl:col-span-2" label="Válido até" value={form.validade ?? null} onChange={(v) => set('validade', v || null)} ajuda="Padrão: 7 dias" />
            ) : (
              <DateInput className="xl:col-span-2" label="Previsão de entrega" value={form.dataPrevista} onChange={(v) => set('dataPrevista', v || null)} />
            )}
            <Select className="xl:col-span-3" label="Depósito" value={form.depositoId ?? ''} onChange={(e) => set('depositoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(depositos)} placeholder="—" disabled={bloqueado} />
            <Select className="xl:col-span-3" label="Origem" value={form.origem} onChange={(e) => set('origem', e.target.value as VendaPayload['origem'])} opcoes={ORIGENS.map((o) => ({ valor: o, rotulo: rotulo(o) }))} />
            <Select className="xl:col-span-3" label="Categoria financeira" value={form.categoriaFinanceiraId ?? ''} onChange={(e) => set('categoriaFinanceiraId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(categorias?.filter((c) => c.tipo === 'RECEITA'))} placeholder="—" disabled={bloqueado} />
            {!editando && (
              <Select className="xl:col-span-3" label="Situação inicial" value={form.situacaoId ?? ''} onChange={(e) => set('situacaoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(situacoes)} placeholder="Padrão (inicial)" ajuda={orcamento ? undefined : 'Ações da situação (lançar estoque/contas) rodam ao salvar.'} />
            )}
          </div>
          {cliente && (
            <p className="mt-2 text-xs text-slate-500">
              {[cliente.celular && `Cel: ${cliente.celular}`, cliente.email, cliente.municipio && `${cliente.municipio}/${cliente.uf}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </Secao>

        {/* Itens */}
        <Secao
          titulo="Itens"
          descricao="Pressione Enter no produto para adicionar. Use linha livre para item sem cadastro."
          acoes={
            !bloqueado && (
              <Button tamanho="sm" variante="fantasma" icone={<Plus className="h-4 w-4" />} onClick={adicionarLinhaLivre}>
                Linha livre
              </Button>
            )
          }
        >
          {!bloqueado && (
            <SearchSelect
              placeholder="Buscar produto por nome, código ou GTIN… (Enter adiciona)"
              valor={produtoSel}
              onChange={(idSel, op) => {
                if (op?.dados) adicionarProduto(op.dados as Produto);
                else setProdutoSel(idSel);
              }}
              buscar={(t) => buscarProdutos(t)}
              limparAoSelecionar
              className="mb-3"
            />
          )}
          {erros.itens && <p className="mb-2 text-xs text-red-600">{erros.itens}</p>}
          <div className="overflow-auto rounded-md border border-slate-200">
            <table className="tbl tbl-pilha">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Descrição</th>
                  <th className="w-24 text-right">Qtd</th>
                  <th className="w-32 text-right">Unitário</th>
                  <th className="w-28 text-right">Desc. R$</th>
                  <th className="w-20 text-right">Com. %</th>
                  <th className="w-28 text-right" title="Custo interno: não aparece para o cliente">Custo un. 🔒</th>
                  <th className="w-32 text-right">Total</th>
                  {!bloqueado && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {form.itens.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-sm text-slate-400">
                      Nenhum item. Busque um produto acima.
                    </td>
                  </tr>
                )}
                {form.itens.map((it, i) => (
                  <tr key={i}>
                    <td className="pilha-oculto text-slate-400">{i + 1}</td>
                    <td className="pilha-cheio">
                      <div className="flex items-start gap-2">
                        {it.produtoId && <FotoProduto url={it.imagemUrl} tamanho="sm" />}
                        <div className="min-w-0 flex-1">
                          <input disabled={bloqueado} value={it.descricao} onChange={(e) => atualizarItem(i, { descricao: e.target.value })} className={`input-base h-8 py-0 ${erros[`item${i}`] ? 'input-erro' : ''}`} placeholder="Descrição do item" />
                          <span className="flex items-center gap-2">
                            {it.codigo && <span className="text-[10px] text-slate-400">cód. {it.codigo}</span>}
                            {it.prontaEntrega && <SeloProntaEntrega compacto />}
                            {!it.produtoId && !bloqueado && (
                              <span className="text-[11px] text-amber-700">
                                Sem cadastro: não baixa estoque nem vai na NF ·{' '}
                                <button type="button" className="font-semibold underline" onClick={() => setVincular(vincular === i ? null : i)}>Escolher produto</button>
                              </span>
                            )}
                          </span>
                          {vincular === i && (
                            <SearchSelect
                              className="mt-1"
                              tamanho="sm"
                              autoFocus
                              placeholder="Buscar o produto deste item…"
                              valor={null}
                              onChange={(_id, op) => op?.dados && vincularProduto(i, op.dados as Produto)}
                              buscar={(t) => buscarProdutos(t || it.descricao)}
                            />
                          )}
                        </div>
                      </div>
                    </td>
                    <td data-rotulo="Qtd">
                      <MoneyInput value={it.quantidade} onChange={(v) => atualizarItem(i, { quantidade: v })} prefixo="" casas={2} disabled={bloqueado} inputClassName="h-8 py-0" />
                    </td>
                    <td data-rotulo="Unitário">
                      <MoneyInput value={it.valorUnitario} onChange={(v) => atualizarItem(i, { valorUnitario: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" />
                    </td>
                    <td data-rotulo="Desconto R$">
                      <MoneyInput value={it.desconto} onChange={(v) => atualizarItem(i, { desconto: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" />
                    </td>
                    <td data-rotulo="Comissão %">
                      <MoneyInput value={it.comissaoPct ?? 0} onChange={(v) => atualizarItem(i, { comissaoPct: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" />
                    </td>
                    <td data-rotulo="Custo un. (interno)">
                      <MoneyInput
                        value={it.custoUnitario ?? 0}
                        onChange={(v) => atualizarItem(i, { custoUnitario: v, custoInformado: true })}
                        prefixo=""
                        inputClassName={`h-8 py-0 ${it.custoInformado ? 'bg-amber-50/60' : !it.custoUnitario ? 'border-amber-300' : 'text-slate-500'}`}
                        title={it.custoInformado ? 'Custo informado por você' : it.custoUnitario ? 'Custo do cadastro do produto (digite para trocar)' : 'Sem custo: digite o custo deste item'}
                      />
                    </td>
                    <td data-rotulo="Total" className="num pilha-cheio text-right font-medium">{moeda(arred(it.quantidade * it.valorUnitario - (it.desconto || 0)))}</td>
                    {!bloqueado && (
                      <td className="pilha-canto">
                        <button type="button" onClick={() => removerItem(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remover">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>

        {/* Custos internos — só para uso interno, nunca saem para o cliente */}
        <Secao titulo="Custos internos 🔒" descricao="Só para o fechamento. Não aparecem no pedido, no PDF, no link do cliente, no e-mail, no WhatsApp nem na nota. Podem ser lançados depois da venda fechada.">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Custo dos produtos</p>
              <p className="num text-base font-semibold text-slate-800">{moeda(custos.produtos)}</p>
              <p className={`text-[11px] ${custos.semCusto ? 'text-amber-700' : 'text-slate-400'}`}>{custos.semCusto ? `${custos.semCusto} ${custos.semCusto === 1 ? 'item' : 'itens'} sem custo: preencha na coluna "Custo un."` : 'pela coluna "Custo un." dos itens'}</p>
            </div>
            <MoneyInput label="Custo de logística" value={form.custoLogistica} onChange={(v) => set('custoLogistica', v)} ajuda="Frete pago, motoboy, envio" />
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-500">Custo total</p>
              <p className="num text-base font-semibold text-slate-800">{moeda(custos.total)}</p>
              <p className="text-[11px] text-slate-400">produtos + logística</p>
            </div>
            {veLucro && (
              <div className={`rounded-md border px-3 py-2 ${custos.lucro < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
                <p className="text-xs text-slate-500">Lucro estimado</p>
                <p className={`num text-base font-bold ${custos.lucro < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{moeda(custos.lucro)}</p>
                <p className="num text-[11px] text-slate-500">margem {custos.margem.toFixed(1).replace('.', ',')}%</p>
              </div>
            )}
          </div>
        </Secao>

        {/* Totais + transporte */}
        <div className="grid gap-4 xl:grid-cols-3">
          <Secao titulo="Transporte" className="xl:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Frete por conta"
                value={form.fretePorConta}
                onChange={(e) => set('fretePorConta', Number(e.target.value))}
                opcoes={[
                  { valor: 9, rotulo: 'Sem frete' },
                  { valor: 0, rotulo: 'Emitente' },
                  { valor: 1, rotulo: 'Destinatário' },
                  { valor: 2, rotulo: 'Terceiros' },
                ]}
              />
              <Input label="Volumes" type="number" min={0} value={form.quantidadeVolumes} onChange={(e) => set('quantidadeVolumes', Number(e.target.value))} />
              <MoneyInput label="Peso bruto (kg)" prefixo="" casas={3} value={form.pesoBruto} onChange={(v) => set('pesoBruto', v)} />
              <SearchSelect label="Transportadora" valor={form.transportadoraId} rotuloAtual={venda?.transportadora?.nome ?? null} onChange={(v) => set('transportadoraId', v)} buscar={(t) => buscarContatos(t, 'TRANSPORTADORA')} placeholder="Buscar…" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Textarea label="Observações (aparecem no pedido/NF)" value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} rows={3} />
              <Textarea label="Observações internas" value={form.observacoesInternas} onChange={(e) => set('observacoesInternas', e.target.value)} rows={3} />
            </div>
          </Secao>

          <Secao titulo="Totais">
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Produtos</span>
                <span className="num">{moeda(totais.totalProdutos)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-slate-500">Desconto</span>
                <select disabled={bloqueado} value={form.descontoTipo} onChange={(e) => set('descontoTipo', e.target.value as 'REAL' | 'PERCENTUAL')} className="input-base h-8 !w-16 shrink-0 py-0 pl-2 pr-1 text-xs">
                  <option value="REAL">R$</option>
                  <option value="PERCENTUAL">%</option>
                </select>
                <MoneyInput value={form.descontoValor} onChange={(v) => set('descontoValor', v)} prefixo="" disabled={bloqueado} className="w-28 shrink-0" inputClassName="h-8 py-0" />
              </div>
              {form.descontoTipo === 'PERCENTUAL' && <p className="text-right text-xs text-slate-400">= {moeda(totais.desconto)}</p>}
              <div className="flex items-center gap-2">
                <span className="flex-1 text-slate-500">Frete</span>
                <MoneyInput value={form.frete} onChange={(v) => set('frete', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" />
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-slate-500">Outras despesas</span>
                <MoneyInput value={form.outrasDespesas} onChange={(v) => set('outrasDespesas', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" />
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="font-semibold text-slate-800">TOTAL</span>
                <span className="num text-2xl font-bold tracking-tight text-slate-900">{moeda(totais.total)}</span>
              </div>
            </div>
          </Secao>
        </div>

        {/* Parcelas */}
        <Secao
          titulo={orcamento ? 'Condições de pagamento' : 'Pagamento / parcelas'}
          descricao={orcamento ? 'Aparecem no PDF do orçamento e passam para a venda ao converter.' : 'Sem parcelas a API gera uma à vista. Ao lançar contas, cada parcela vira uma conta a receber.'}
        >
          {erros.parcelas && <p className="mb-2 text-xs text-red-600">{erros.parcelas}</p>}
          <ParcelasEditor parcelas={form.parcelas} onChange={(p) => set('parcelas', p)} total={totais.total} disabled={bloqueado} />
        </Secao>
      </div>

      {/* Barra fixa de ações */}
      <div className="barra-fixa fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pt-2.5 backdrop-blur sm:pt-3 lg:left-64">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0 text-xs text-slate-500 sm:text-sm">
            {form.itens.length} {form.itens.length === 1 ? 'item' : 'itens'} · Total <span className="num font-semibold text-slate-900">{moeda(totais.total)}</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variante="secundario" onClick={() => nav(editando ? `${base}/${id}` : base)}>
              Cancelar
            </Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>
              <span className="sm:hidden">Salvar</span>
              <span className="hidden sm:inline">{editando ? 'Salvar alterações' : orcamento ? 'Salvar orçamento' : 'Salvar venda'}</span>
            </Button>
          </div>
        </div>
      </div>

      <ContatoRapidoDrawer
        aberto={drawerCliente}
        onFechar={() => setDrawerCliente(false)}
        onCriado={(c) => {
          set('contatoId', c.id);
          setClienteNome(c.nome);
          setCliente(c);
        }}
      />
    </div>
  );
}
