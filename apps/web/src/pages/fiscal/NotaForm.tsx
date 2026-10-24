import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { buscarContatos, buscarProdutos } from '@/lib/buscas';
import { Button, FormSkeleton, Input, MoneyInput, PageHeader, SearchSelect, Secao, Select, Textarea } from '@/components/ui';
import { arred, moeda } from '@/lib/format';
import type { NotaFiscal, NotaFiscalItem, Produto } from '@/types';

interface Form {
  tipo: 0 | 1;
  modelo: 55 | 65;
  contatoId: number | null;
  naturezaOperacao: string;
  finalidade: number;
  formaPagamentoFiscal: string;
  informacoesComplementares: string;
  valorFrete: number;
  valorDesconto: number;
  itens: NotaFiscalItem[];
}

const TPAG = [
  { valor: '01', rotulo: '01 — Dinheiro' },
  { valor: '03', rotulo: '03 — Cartão de crédito' },
  { valor: '04', rotulo: '04 — Cartão de débito' },
  { valor: '15', rotulo: '15 — Boleto' },
  { valor: '17', rotulo: '17 — PIX' },
  { valor: '18', rotulo: '18 — Transferência' },
  { valor: '90', rotulo: '90 — Sem pagamento' },
  { valor: '99', rotulo: '99 — Outros' },
];

/** Nota fiscal manual (sem venda vinculada) */
export default function NotaForm() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const editarId = sp.get('editar');
  const { data: empresa } = useEmpresa();
  const [form, setForm] = useState<Form>({ tipo: 1, modelo: 55, contatoId: null, naturezaOperacao: 'Venda de mercadoria', finalidade: 1, formaPagamentoFiscal: '01', informacoesComplementares: '', valorFrete: 0, valorDesconto: 0, itens: [] });
  const [contatoNome, setContatoNome] = useState<string | null>(null);

  const { data: nota, isLoading } = useQuery({ queryKey: ['nota', editarId], queryFn: () => api.get<NotaFiscal>(`/notas-fiscais/${editarId}`), enabled: !!editarId });

  useEffect(() => {
    if (empresa && !editarId) setForm((f) => ({ ...f, naturezaOperacao: empresa.naturezaOperacaoPadrao || f.naturezaOperacao }));
  }, [empresa, editarId]);
  useEffect(() => {
    if (nota) {
      setForm({ tipo: nota.tipo, modelo: nota.modelo, contatoId: nota.contato?.id ?? null, naturezaOperacao: nota.naturezaOperacao, finalidade: nota.finalidade, formaPagamentoFiscal: nota.formaPagamentoFiscal, informacoesComplementares: nota.informacoesComplementares ?? '', valorFrete: nota.valorFrete, valorDesconto: nota.valorDesconto, itens: nota.itens });
      setContatoNome(nota.contato?.nome ?? null);
    }
  }, [nota]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const totalProdutos = useMemo(() => arred(form.itens.reduce((s, i) => s + i.quantidade * i.valorUnitario - (i.desconto || 0), 0)), [form.itens]);
  const total = arred(totalProdutos - form.valorDesconto + form.valorFrete);

  const cfopPadrao = empresa?.cfopPadraoDentroUf ?? '5102';
  const adicionarProduto = (p: Produto) =>
    set('itens', [...form.itens, { produtoId: p.id, codigo: p.codigo ?? String(p.id), gtin: p.gtin ?? null, descricao: p.nome, ncm: p.ncm ?? '', cest: p.cest ?? null, cfop: p.cfopPadrao || cfopPadrao, unidade: p.unidade, quantidade: 1, valorUnitario: p.preco, desconto: 0, origem: p.origem, csosn: p.csosn ?? empresa?.csosnPadrao ?? '102', cst: p.cst ?? null, icmsAliquota: p.icmsAliquota }]);
  const atualizar = (i: number, patch: Partial<NotaFiscalItem>) => set('itens', form.itens.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remover = (i: number) => set('itens', form.itens.filter((_, j) => j !== i));

  const salvar = useMutation({
    mutationFn: (p: Form) => (editarId ? api.put<NotaFiscal>(`/notas-fiscais/${editarId}`, p) : api.post<NotaFiscal>('/notas-fiscais', p)),
    onSuccess: (n) => {
      toast.success(editarId ? 'Nota atualizada.' : 'Nota criada (pendente).');
      qc.invalidateQueries({ queryKey: ['notas-fiscais'] });
      qc.invalidateQueries({ queryKey: ['nota', String(n.id)] });
      nav(`/notas-fiscais/${n.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    if (form.modelo === 55 && !form.contatoId) return toast.error('NF-e exige destinatário.');
    if (!form.itens.length) return toast.error('Adicione ao menos um item.');
    if (form.itens.some((i) => !i.ncm || i.ncm.replace(/\D/g, '').length < 8)) return toast.error('Todos os itens precisam de NCM com 8 dígitos.');
    salvar.mutate(form);
  };

  if (editarId && isLoading) return <FormSkeleton />;

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Notas fiscais', para: '/notas-fiscais' }, { rotulo: editarId ? `Editar nota ${nota?.numero ?? ''}` : 'Nota manual' }]}
        titulo={editarId ? `Editar nota nº ${nota?.numero ?? ''}` : 'Nova nota fiscal manual'}
        descricao="Para notas de vendas use o botão “Gerar NF-e” na venda. A nota é criada pendente e transmitida depois."
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav('/notas-fiscais')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </>
        }
      />
      <div className="space-y-4">
        <Secao titulo="Cabeçalho">
          <div className="grid gap-3 md:grid-cols-12">
            <Select className="md:col-span-2" label="Modelo" value={form.modelo} onChange={(e) => set('modelo', Number(e.target.value) as 55 | 65)} opcoes={[{ valor: 55, rotulo: 'NF-e (55)' }, { valor: 65, rotulo: 'NFC-e (65)' }]} />
            <Select className="md:col-span-2" label="Tipo" value={form.tipo} onChange={(e) => set('tipo', Number(e.target.value) as 0 | 1)} opcoes={[{ valor: 1, rotulo: 'Saída' }, { valor: 0, rotulo: 'Entrada' }]} />
            <SearchSelect className="md:col-span-5" label="Destinatário" obrigatorio={form.modelo === 55} valor={form.contatoId} rotuloAtual={contatoNome} onChange={(v, op) => { set('contatoId', v); setContatoNome(op?.rotulo ?? null); }} buscar={(t) => buscarContatos(t)} placeholder={form.modelo === 65 ? 'Opcional (consumidor final)' : 'Buscar…'} />
            <Select className="md:col-span-3" label="Finalidade" value={form.finalidade} onChange={(e) => set('finalidade', Number(e.target.value))} opcoes={[{ valor: 1, rotulo: '1 — Normal' }, { valor: 2, rotulo: '2 — Complementar' }, { valor: 3, rotulo: '3 — Ajuste' }, { valor: 4, rotulo: '4 — Devolução' }]} />
            <Input className="md:col-span-5" label="Natureza da operação" value={form.naturezaOperacao} onChange={(e) => set('naturezaOperacao', e.target.value)} />
            <Select className="md:col-span-3" label="Forma de pagamento (tPag)" value={form.formaPagamentoFiscal} onChange={(e) => set('formaPagamentoFiscal', e.target.value)} opcoes={TPAG} />
            <MoneyInput className="md:col-span-2" label="Frete" value={form.valorFrete} onChange={(v) => set('valorFrete', v)} />
            <MoneyInput className="md:col-span-2" label="Desconto" value={form.valorDesconto} onChange={(v) => set('valorDesconto', v)} />
            <Textarea className="md:col-span-12" label="Informações complementares" rows={2} value={form.informacoesComplementares} onChange={(e) => set('informacoesComplementares', e.target.value)} />
          </div>
        </Secao>

        <Secao titulo="Itens" acoes={<Button tamanho="sm" variante="fantasma" icone={<Plus className="h-4 w-4" />} onClick={() => set('itens', [...form.itens, { produtoId: null, codigo: '', descricao: '', ncm: '', cfop: cfopPadrao, unidade: 'UN', quantidade: 1, valorUnitario: 0, desconto: 0, origem: 0, csosn: empresa?.csosnPadrao ?? '102' }])}>Linha livre</Button>}>
          <SearchSelect placeholder="Buscar produto… (Enter adiciona)" valor={null} onChange={(_, op) => op?.dados && adicionarProduto(op.dados as Produto)} buscar={(t) => buscarProdutos(t, 'P')} limparAoSelecionar className="mb-3" />
          <div className="overflow-auto rounded-md border border-slate-200">
            <table className="tbl tbl-pilha">
              <thead><tr><th className="w-24">Código</th><th>Descrição</th><th className="w-28">NCM</th><th className="w-20">CFOP</th><th className="w-20">CSOSN</th><th className="w-20 text-right">Qtd</th><th className="w-28 text-right">Unitário</th><th className="w-24 text-right">Desc.</th><th className="w-28 text-right">Total</th><th className="w-10" /></tr></thead>
              <tbody>
                {form.itens.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-sm text-slate-400">Nenhum item.</td></tr>}
                {form.itens.map((it, i) => (
                  <tr key={i}>
                    <td data-rotulo="Código"><input value={it.codigo} onChange={(e) => atualizar(i, { codigo: e.target.value })} className="input-base h-8 py-0 font-mono text-xs" /></td>
                    <td className="pilha-cheio"><input value={it.descricao} onChange={(e) => atualizar(i, { descricao: e.target.value })} className="input-base h-8 py-0" /></td>
                    <td data-rotulo="NCM"><input value={it.ncm} onChange={(e) => atualizar(i, { ncm: e.target.value })} className={`input-base h-8 py-0 font-mono text-xs ${it.ncm.replace(/\D/g, '').length < 8 ? 'input-erro' : ''}`} placeholder="00000000" /></td>
                    <td data-rotulo="CFOP"><input value={it.cfop} onChange={(e) => atualizar(i, { cfop: e.target.value })} className="input-base h-8 py-0 font-mono text-xs" /></td>
                    <td data-rotulo="CSOSN"><input value={it.csosn ?? ''} onChange={(e) => atualizar(i, { csosn: e.target.value })} className="input-base h-8 py-0 font-mono text-xs" /></td>
                    <td data-rotulo="Qtd"><MoneyInput value={it.quantidade} onChange={(v) => atualizar(i, { quantidade: v })} prefixo="" inputClassName="h-8 py-0" /></td>
                    <td data-rotulo="Unitário"><MoneyInput value={it.valorUnitario} onChange={(v) => atualizar(i, { valorUnitario: v })} prefixo="" inputClassName="h-8 py-0" /></td>
                    <td data-rotulo="Desc."><MoneyInput value={it.desconto} onChange={(v) => atualizar(i, { desconto: v })} prefixo="" inputClassName="h-8 py-0" /></td>
                    <td className="num text-right font-medium" data-rotulo="Total">{moeda(it.quantidade * it.valorUnitario - (it.desconto || 0))}</td>
                    <td className="pilha-canto"><button type="button" onClick={() => remover(i)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end gap-6 text-sm">
            <span className="text-slate-500">Produtos <strong className="num text-slate-800">{moeda(totalProdutos)}</strong></span>
            <span className="text-slate-500">Total da nota <strong className="num text-lg text-slate-900">{moeda(total)}</strong></span>
          </div>
        </Secao>
      </div>
    </div>
  );
}
