import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, UserPlus, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useCategoriasFinanceiras, useDepositos, useSituacoes, useTecnicos, useVendedores, opcoesDe } from '@/hooks/useListas';
import { useAuth } from '@/stores/auth';
import { buscarContatos, buscarProdutos } from '@/lib/buscas';
import { Button, Checkbox, DateInput, FormSkeleton, Input, MoneyInput, PageHeader, SearchSelect, Secao, Select, Textarea } from '@/components/ui';
import { ParcelasEditor, parcelasValidas } from '@/components/compartilhados/ParcelasEditor';
import { ContatoRapidoDrawer } from '@/components/compartilhados/ContatoRapidoDrawer';
import { arred, dataIso, hoje, moeda, rotulo } from '@/lib/format';
import type { Contato, OrdemServico, OsItem, OsPayload, Produto } from '@/types';

const EQUIPAMENTOS = ['Notebook', 'Desktop', 'All-in-one', 'Impressora', 'Monitor', 'Celular', 'Tablet', 'Console', 'Nobreak', 'Roteador', 'Outro'];

function vazio(vendedorId: number | null): OsPayload {
  return {
    contatoId: null,
    vendedorId,
    tecnicoId: null,
    depositoId: null,
    categoriaFinanceiraId: null,
    situacaoId: null,
    dataEntrada: hoje(),
    dataPrevista: null,
    prioridade: 'NORMAL',
    equipamento: '',
    marca: '',
    modelo: '',
    numeroSerie: '',
    acessorios: '',
    senhaEquipamento: '',
    estadoFisico: '',
    defeitoRelatado: '',
    diagnostico: '',
    servicoExecutado: '',
    observacoes: '',
    observacoesInternas: '',
    orcar: false,
    garantiaDias: 90,
    descontoValor: 0,
    custoPeca: 0,
    custoLogistica: 0,
    custoMaoObraTerceiro: 0,
    itens: [],
    parcelas: [],
  };
}

function deOs(o: OrdemServico): OsPayload {
  return {
    contatoId: o.contatoId,
    vendedorId: o.vendedorId,
    tecnicoId: o.tecnicoId,
    depositoId: o.depositoId,
    categoriaFinanceiraId: o.categoriaFinanceiraId,
    situacaoId: o.situacao?.id ?? null,
    dataEntrada: dataIso(o.dataEntrada),
    dataPrevista: o.dataPrevista ? dataIso(o.dataPrevista) : null,
    prioridade: o.prioridade,
    equipamento: o.equipamento ?? '',
    marca: o.marca ?? '',
    modelo: o.modelo ?? '',
    numeroSerie: o.numeroSerie ?? '',
    acessorios: o.acessorios ?? '',
    senhaEquipamento: o.senhaEquipamento ?? '',
    estadoFisico: o.estadoFisico ?? '',
    defeitoRelatado: o.defeitoRelatado ?? '',
    diagnostico: o.diagnostico ?? '',
    servicoExecutado: o.servicoExecutado ?? '',
    observacoes: o.observacoes ?? '',
    observacoesInternas: o.observacoesInternas ?? '',
    orcar: o.orcar,
    garantiaDias: o.garantiaDias,
    descontoValor: o.descontoValor,
    custoPeca: o.custoPeca ?? 0,
    custoLogistica: o.custoLogistica ?? 0,
    custoMaoObraTerceiro: o.custoMaoObraTerceiro ?? 0,
    itens: o.itens.map((i) => ({ tipo: i.tipo, produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, comissaoVendedorPct: i.comissaoVendedorPct, comissaoTecnicoPct: i.comissaoTecnicoPct, depositoId: i.depositoId })),
    parcelas: o.parcelas.map((p) => ({ dataVencimento: dataIso(p.dataVencimento), valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes ?? '' })),
  };
}

const totalItem = (i: OsItem) => arred(i.quantidade * i.valorUnitario - (i.desconto || 0));

/** Grid de itens (peças ou serviços) */
function GridItens({ tipo, itens, onChange, comissaoTecnico, comissaoVendedor, depositos, bloqueado }: { tipo: 'PECA' | 'SERVICO'; itens: OsItem[]; onChange: (lista: OsItem[]) => void; comissaoTecnico: number; comissaoVendedor: number; depositos: { id: number; nome: string }[]; bloqueado: boolean }) {
  const lista = itens.filter((i) => i.tipo === tipo);
  const substituir = (nova: OsItem[]) => onChange([...itens.filter((i) => i.tipo !== tipo), ...nova]);
  const atualizar = (idx: number, patch: Partial<OsItem>) => substituir(lista.map((it, j) => (j === idx ? { ...it, ...patch } : it)));
  const remover = (idx: number) => substituir(lista.filter((_, j) => j !== idx));
  const adicionarProduto = (p: Produto) =>
    substituir([...lista, { tipo, produtoId: p.id, descricao: p.nome, quantidade: 1, valorUnitario: p.preco, desconto: 0, comissaoVendedorPct: comissaoVendedor, comissaoTecnicoPct: comissaoTecnico, depositoId: null }]);
  const adicionarLivre = () => substituir([...lista, { tipo, produtoId: null, descricao: '', quantidade: 1, valorUnitario: 0, desconto: 0, comissaoVendedorPct: comissaoVendedor, comissaoTecnicoPct: comissaoTecnico, depositoId: null }]);

  return (
    <div>
      {!bloqueado && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <SearchSelect className="min-w-0 flex-1" placeholder={tipo === 'PECA' ? 'Buscar peça/produto… (Enter adiciona)' : 'Buscar serviço cadastrado… (Enter adiciona)'} valor={null} onChange={(_, op) => op?.dados && adicionarProduto(op.dados as Produto)} buscar={(t) => buscarProdutos(t, tipo === 'PECA' ? 'P' : 'S')} limparAoSelecionar />
          <Button variante="secundario" icone={<Plus className="h-4 w-4" />} onClick={adicionarLivre}>
            Linha livre
          </Button>
        </div>
      )}
      <div className="overflow-auto rounded-md border border-slate-200">
        <table className="tbl tbl-pilha">
          <thead>
            <tr>
              <th>Descrição</th>
              {tipo === 'PECA' && <th className="w-40">Depósito</th>}
              <th className="w-20 text-right">Qtd</th>
              <th className="w-28 text-right">Unitário</th>
              <th className="w-24 text-right">Desc.</th>
              <th className="w-20 text-right">Com. téc. %</th>
              <th className="w-20 text-right">Com. vend. %</th>
              <th className="w-28 text-right">Total</th>
              {!bloqueado && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-center text-xs text-slate-400">
                  Nenhum {tipo === 'PECA' ? 'peça' : 'serviço'} adicionado.
                </td>
              </tr>
            )}
            {lista.map((it, i) => (
              <tr key={i}>
                <td className="pilha-cheio"><input disabled={bloqueado} value={it.descricao} onChange={(e) => atualizar(i, { descricao: e.target.value })} className="input-base h-8 py-0" placeholder="Descrição" /></td>
                {tipo === 'PECA' && (
                  <td data-rotulo="Depósito">
                    <select disabled={bloqueado} value={it.depositoId ?? ''} onChange={(e) => atualizar(i, { depositoId: e.target.value ? Number(e.target.value) : null })} className="input-base h-8 py-0 text-xs">
                      <option value="">(da OS)</option>
                      {depositos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
                    </select>
                  </td>
                )}
                <td data-rotulo="Qtd"><MoneyInput value={it.quantidade} onChange={(v) => atualizar(i, { quantidade: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                <td data-rotulo="Unitário"><MoneyInput value={it.valorUnitario} onChange={(v) => atualizar(i, { valorUnitario: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                <td data-rotulo="Desc."><MoneyInput value={it.desconto} onChange={(v) => atualizar(i, { desconto: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                <td data-rotulo="Com. téc. %"><MoneyInput value={it.comissaoTecnicoPct} onChange={(v) => atualizar(i, { comissaoTecnicoPct: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                <td data-rotulo="Com. vend. %"><MoneyInput value={it.comissaoVendedorPct} onChange={(v) => atualizar(i, { comissaoVendedorPct: v })} prefixo="" disabled={bloqueado} inputClassName="h-8 py-0" /></td>
                <td className="num text-right font-medium" data-rotulo="Total">{moeda(totalItem(it))}</td>
                {!bloqueado && (
                  <td className="pilha-canto"><button type="button" onClick={() => remover(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Formulário de ordem de serviço */
export default function OsForm() {
  const { id } = useParams();
  const editando = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const usuario = useAuth((s) => s.usuario);
  const { data: vendedores } = useVendedores();
  const { data: tecnicos } = useTecnicos();
  const { data: depositos } = useDepositos();
  const { data: categorias } = useCategoriasFinanceiras();
  const { data: situacoes } = useSituacoes('OS');

  const [form, setForm] = useState<OsPayload>(() => vazio(usuario?.vendedorId ?? null));
  const [clienteNome, setClienteNome] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  const { data: os, isLoading } = useQuery({ queryKey: ['os', id], queryFn: () => api.get<OrdemServico>(`/ordens-servico/${id}`), enabled: editando });

  // Cliente pré-selecionado via ?contatoId=
  const [sp] = useSearchParams();
  const contatoInicial = sp.get('contatoId');
  const { data: contatoPre } = useQuery({ queryKey: ['contato', contatoInicial], queryFn: () => api.get<Contato>(`/contatos/${contatoInicial}`), enabled: !editando && !!contatoInicial });
  useEffect(() => {
    if (contatoPre) {
      setForm((f) => ({ ...f, contatoId: contatoPre.id }));
      setClienteNome(contatoPre.nome);
    }
  }, [contatoPre]);

  useEffect(() => {
    if (os) {
      setForm(deOs(os));
      setClienteNome(os.contato?.nome ?? null);
    }
  }, [os]);

  useEffect(() => {
    if (editando) return;
    setForm((f) => ({
      ...f,
      depositoId: f.depositoId ?? depositos?.find((d) => d.padrao)?.id ?? null,
      categoriaFinanceiraId: f.categoriaFinanceiraId ?? categorias?.find((c) => c.tipo === 'RECEITA' && /servi/i.test(c.nome))?.id ?? null,
      tecnicoId: f.tecnicoId ?? usuario?.tecnicoId ?? null,
    }));
  }, [depositos, categorias, editando, usuario]);

  const set = <K extends keyof OsPayload>(k: K, v: OsPayload[K]) => setForm((f) => ({ ...f, [k]: v }));
  const totais = useMemo(() => {
    const totalPecas = arred(form.itens.filter((i) => i.tipo === 'PECA').reduce((s, i) => s + totalItem(i), 0));
    const totalServicos = arred(form.itens.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + totalItem(i), 0));
    const total = arred(totalPecas + totalServicos - (form.descontoValor || 0));
    return { totalPecas, totalServicos, total };
  }, [form.itens, form.descontoValor]);
  const bloqueado = !!os && (os.estoqueLancado || os.contasLancadas);
  const comissaoTec = tecnicos?.find((t) => t.id === form.tecnicoId)?.comissaoPadraoPct ?? 0;
  const comissaoVend = vendedores?.find((v) => v.id === form.vendedorId)?.comissaoPadraoPct ?? 0;

  const salvar = useMutation({
    mutationFn: (p: OsPayload) => (editando ? api.put<OrdemServico>(`/ordens-servico/${id}`, p) : api.post<OrdemServico>('/ordens-servico', p)),
    onSuccess: (o) => {
      toast.success(editando ? 'OS atualizada.' : `OS nº ${o.numero} aberta.`);
      qc.invalidateQueries({ queryKey: ['ordens-servico'] });
      qc.invalidateQueries({ queryKey: ['os-kanban'] });
      qc.invalidateQueries({ queryKey: ['os', String(o.id)] });
      nav(`/ordens-servico/${o.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    const e: Record<string, string> = {};
    if (!form.contatoId) e.contatoId = 'Selecione o cliente';
    if (!form.equipamento.trim()) e.equipamento = 'Informe o equipamento';
    if (!form.defeitoRelatado.trim()) e.defeitoRelatado = 'Descreva o defeito relatado';
    if (form.itens.some((i) => !i.descricao.trim())) e.itens = 'Há itens sem descrição';
    if (!parcelasValidas(form.parcelas, totais.total)) e.parcelas = 'A soma das parcelas deve ser igual ao total';
    setErros(e);
    if (Object.keys(e).length) return toast.error(Object.values(e)[0]);
    salvar.mutate(form);
  };

  if (editando && isLoading) return <FormSkeleton />;

  return (
    <div className="pb-24">
      <PageHeader
        migalhas={[{ rotulo: 'Ordens de serviço', para: '/ordens-servico' }, { rotulo: editando ? `OS nº ${os?.numero ?? ''}` : 'Nova OS' }]}
        titulo={editando ? `Editar OS nº ${os?.numero ?? ''}` : 'Nova ordem de serviço'}
        descricao={bloqueado ? 'Peças/contas já lançadas — estorne antes de alterar itens.' : 'Registre o equipamento, o defeito relatado e, quando houver, peças e serviços.'}
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav(editando ? `/ordens-servico/${id}` : '/ordens-servico')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </>
        }
      />

      <div className="space-y-4">
        <Secao titulo="Cliente e responsáveis">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <SearchSelect
              className="sm:col-span-2 xl:col-span-4"
              label="Cliente"
              obrigatorio
              erro={erros.contatoId}
              valor={form.contatoId}
              rotuloAtual={clienteNome}
              buscar={(t) => buscarContatos(t, 'CLIENTE')}
              onChange={(v, op) => {
                set('contatoId', v);
                setClienteNome(op?.rotulo ?? null);
              }}
              rodape={<button type="button" onClick={() => setDrawer(true)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-brand-600 hover:bg-brand-50"><UserPlus className="h-4 w-4" /> Cadastrar novo cliente</button>}
            />
            <Select className="xl:col-span-2" label="Atendente / vendedor" value={form.vendedorId ?? ''} onChange={(e) => set('vendedorId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(vendedores)} placeholder="—" />
            <Select className="xl:col-span-2" label="Técnico" value={form.tecnicoId ?? ''} onChange={(e) => set('tecnicoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(tecnicos)} placeholder="—" />
            <Select className="xl:col-span-2" label="Prioridade" value={form.prioridade} onChange={(e) => set('prioridade', e.target.value as OsPayload['prioridade'])} opcoes={['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'].map((p) => ({ valor: p, rotulo: rotulo(p) }))} />
            <DateInput className="xl:col-span-2" label="Entrada" obrigatorio value={form.dataEntrada} onChange={(v) => set('dataEntrada', v)} />
            <DateInput className="xl:col-span-2" label="Previsão" value={form.dataPrevista} onChange={(v) => set('dataPrevista', v || null)} />
            <Select className="xl:col-span-3" label="Depósito (peças)" value={form.depositoId ?? ''} onChange={(e) => set('depositoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(depositos)} placeholder="—" />
            <Select className="xl:col-span-3" label="Categoria financeira" value={form.categoriaFinanceiraId ?? ''} onChange={(e) => set('categoriaFinanceiraId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(categorias?.filter((c) => c.tipo === 'RECEITA'))} placeholder="—" />
            <Input className="xl:col-span-2" label="Garantia (dias)" type="number" min={0} value={form.garantiaDias} onChange={(e) => set('garantiaDias', Number(e.target.value))} />
            {!editando && <Select className="xl:col-span-2" label="Situação inicial" value={form.situacaoId ?? ''} onChange={(e) => set('situacaoId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(situacoes)} placeholder="Padrão (Aberta)" />}
          </div>
        </Secao>

        <Secao titulo="Equipamento">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <div className="xl:col-span-3">
              <Input label="Tipo de equipamento" obrigatorio erro={erros.equipamento} list="equipamentos" value={form.equipamento} onChange={(e) => set('equipamento', e.target.value)} placeholder="Notebook, Desktop…" />
              <datalist id="equipamentos">{EQUIPAMENTOS.map((e) => <option key={e} value={e} />)}</datalist>
            </div>
            <Input className="xl:col-span-3" label="Marca" value={form.marca} onChange={(e) => set('marca', e.target.value)} />
            <Input className="xl:col-span-3" label="Modelo" value={form.modelo} onChange={(e) => set('modelo', e.target.value)} />
            <Input className="xl:col-span-3" label="Nº de série" value={form.numeroSerie} onChange={(e) => set('numeroSerie', e.target.value)} />
            <Input className="sm:col-span-2 xl:col-span-4" label="Acessórios entregues" value={form.acessorios} onChange={(e) => set('acessorios', e.target.value)} placeholder="Fonte, bolsa, mouse…" />
            <Input className="xl:col-span-3" label="Senha do equipamento" value={form.senhaEquipamento} onChange={(e) => set('senhaEquipamento', e.target.value)} />
            <Input className="sm:col-span-2 xl:col-span-5" label="Estado físico" value={form.estadoFisico} onChange={(e) => set('estadoFisico', e.target.value)} placeholder="Riscos, trincas, tampa solta…" />
          </div>
        </Secao>

        <Secao titulo="Diagnóstico e serviço">
          <div className="grid gap-3 md:grid-cols-3">
            <Textarea label="Defeito relatado pelo cliente" obrigatorio erro={erros.defeitoRelatado} rows={4} value={form.defeitoRelatado} onChange={(e) => set('defeitoRelatado', e.target.value)} />
            <Textarea label="Diagnóstico técnico" rows={4} value={form.diagnostico} onChange={(e) => set('diagnostico', e.target.value)} />
            <Textarea label="Serviço executado" rows={4} value={form.servicoExecutado} onChange={(e) => set('servicoExecutado', e.target.value)} />
          </div>
          <div className="mt-3">
            <Checkbox label="Orçar antes de executar" descricao="O cliente precisa aprovar o orçamento (pelo link público ou pelo botão Aprovar) antes do serviço." checked={form.orcar} onChange={(e) => set('orcar', e.target.checked)} />
          </div>
        </Secao>

        <Secao titulo="Serviços" descricao="Mão de obra e serviços executados.">
          <GridItens tipo="SERVICO" itens={form.itens} onChange={(l) => set('itens', l)} comissaoTecnico={comissaoTec} comissaoVendedor={comissaoVend} depositos={depositos ?? []} bloqueado={bloqueado} />
        </Secao>
        <Secao titulo="Peças" descricao="Peças com produto cadastrado baixam do estoque ao lançar.">
          {erros.itens && <p className="mb-2 text-xs text-red-600">{erros.itens}</p>}
          <GridItens tipo="PECA" itens={form.itens} onChange={(l) => set('itens', l)} comissaoTecnico={comissaoTec} comissaoVendedor={comissaoVend} depositos={depositos ?? []} bloqueado={bloqueado} />
        </Secao>

        <div className="grid gap-4 xl:grid-cols-3">
          <Secao titulo="Observações" className="xl:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Textarea label="Observações (visíveis ao cliente)" rows={3} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
              <Textarea label="Observações internas" rows={3} value={form.observacoesInternas} onChange={(e) => set('observacoesInternas', e.target.value)} />
            </div>
          </Secao>
          <Secao titulo="Totais">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Serviços</span><span className="num">{moeda(totais.totalServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Peças</span><span className="num">{moeda(totais.totalPecas)}</span></div>
              <div className="flex items-center gap-2"><span className="flex-1 text-slate-500">Desconto</span><MoneyInput value={form.descontoValor} onChange={(v) => set('descontoValor', v)} prefixo="" disabled={bloqueado} className="w-28" inputClassName="h-8 py-0" /></div>
              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3"><span className="font-semibold">TOTAL</span><span className="num text-2xl font-bold">{moeda(totais.total)}</span></div>
            </div>
          </Secao>
        </div>

        <Secao titulo="Custos internos (fechamento)" descricao="Só para o cálculo do fechamento. Não aparecem na impressão da OS nem para o cliente. Podem ser lançados depois da OS concluída.">
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyInput label="Custo da peça" value={form.custoPeca} onChange={(v) => set('custoPeca', v)} ajuda={form.custoPeca ? undefined : 'Vazio = usa o custo das peças cadastradas'} />
            <MoneyInput label="Custo de logística" value={form.custoLogistica} onChange={(v) => set('custoLogistica', v)} ajuda="Frete, motoboy, envio" />
            <MoneyInput label="Mão de obra de terceiro" value={form.custoMaoObraTerceiro} onChange={(v) => set('custoMaoObraTerceiro', v)} ajuda="Técnico ou laboratório de fora" />
          </div>
        </Secao>

        <Secao titulo="Pagamento / parcelas">
          {erros.parcelas && <p className="mb-2 text-xs text-red-600">{erros.parcelas}</p>}
          <ParcelasEditor parcelas={form.parcelas} onChange={(p) => set('parcelas', p)} total={totais.total} disabled={bloqueado} />
        </Secao>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur sm:px-4 sm:py-3 lg:left-64">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0 text-xs text-slate-500 sm:text-sm">Total <span className="num font-semibold text-slate-900">{moeda(totais.total)}</span></div>
          <div className="flex shrink-0 gap-2">
            <Button variante="secundario" onClick={() => nav(editando ? `/ordens-servico/${id}` : '/ordens-servico')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar OS</Button>
          </div>
        </div>
      </div>

      <ContatoRapidoDrawer aberto={drawer} onFechar={() => setDrawer(false)} onCriado={(c: Contato) => { set('contatoId', c.id); setClienteNome(c.nome); }} />
    </div>
  );
}
