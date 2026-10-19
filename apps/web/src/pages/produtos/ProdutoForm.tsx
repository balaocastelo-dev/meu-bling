import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Save, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useCategoriasProduto } from '@/hooks/useListas';
import { Button, Checkbox, FormSkeleton, Input, MoneyInput, PageHeader, Secao, Select, Textarea } from '@/components/ui';
import { moeda, numero } from '@/lib/format';
import type { Produto } from '@/types';

type Form = Omit<Produto, 'id' | 'categoria' | 'estoqueTotal' | 'estoqueReservado' | 'saldos'>;

const vazio: Form = {
  tipo: 'P',
  nome: '',
  codigo: '',
  gtin: '',
  unidade: 'UN',
  preco: 0,
  precoCusto: 0,
  descricaoCurta: '',
  descricaoDetalhada: '',
  imagemUrl: '',
  marca: '',
  peso: null,
  estoqueMinimo: 0,
  controlaEstoque: true,
  garantiaDias: 90,
  ativo: true,
  ncm: '',
  cest: '',
  cfopPadrao: '',
  origem: 0,
  csosn: '102',
  cst: '',
  icmsAliquota: 0,
  pisCst: '49',
  cofinsCst: '49',
  ipiCst: '',
  codigoServico: '',
  issAliquota: 0,
  categoriaId: null,
};

/** Cadastro de produto/serviço com aba fiscal */
export default function ProdutoForm() {
  const { id } = useParams();
  const editando = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: categorias } = useCategoriasProduto();
  const [form, setForm] = useState<Form>(vazio);
  const { data: produto, isLoading } = useQuery({ queryKey: ['produto', id], queryFn: () => api.get<Produto>(`/produtos/${id}`), enabled: editando });

  useEffect(() => {
    if (produto) {
      const { id: _i, categoria: _c, estoqueTotal: _e, estoqueReservado: _r, saldos: _s, ...resto } = produto;
      setForm({ ...vazio, ...resto });
    }
  }, [produto]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = useMutation({
    mutationFn: (p: Form) => {
      const body = { ...p, codigo: p.codigo?.trim() || null, gtin: p.gtin?.trim() || null, ncm: p.ncm?.trim() || null, cest: p.cest?.trim() || null, cfopPadrao: p.cfopPadrao?.trim() || null, imagemUrl: p.imagemUrl?.trim() || null, marca: p.marca?.trim() || null };
      return editando ? api.put<Produto>(`/produtos/${id}`, body) : api.post<Produto>('/produtos', body);
    },
    onSuccess: (p) => {
      toast.success(editando ? 'Produto atualizado.' : 'Produto cadastrado.');
      qc.invalidateQueries({ queryKey: ['produtos'] });
      qc.invalidateQueries({ queryKey: ['produto', String(p.id)] });
      nav(`/produtos/${p.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    if (!form.nome.trim()) return toast.error('Informe o nome do produto.');
    salvar.mutate(form);
  };

  if (editando && isLoading) return <FormSkeleton />;
  const ehServico = form.tipo === 'S';
  const margem = form.precoCusto > 0 ? ((form.preco - form.precoCusto) / form.precoCusto) * 100 : null;

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Produtos', para: '/produtos' }, { rotulo: editando ? produto?.nome ?? '' : 'Novo produto' }]}
        titulo={editando ? `Editar ${produto?.nome ?? ''}` : 'Novo produto'}
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav(editando ? `/produtos/${id}` : '/produtos')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </>
        }
      />
      <div className="space-y-4">
        <Secao titulo="Dados gerais">
          <div className="grid gap-3 md:grid-cols-12">
            <Select className="md:col-span-2" label="Tipo" value={form.tipo} onChange={(e) => set('tipo', e.target.value as 'P' | 'S')} opcoes={[{ valor: 'P', rotulo: 'Produto' }, { valor: 'S', rotulo: 'Serviço' }]} />
            <Input className="md:col-span-7" label="Nome" obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus />
            <Input className="md:col-span-3" label="Código (SKU)" value={form.codigo ?? ''} onChange={(e) => set('codigo', e.target.value)} />
            <Input className="md:col-span-3" label="GTIN / EAN" value={form.gtin ?? ''} onChange={(e) => set('gtin', e.target.value)} inputMode="numeric" />
            <Input className="md:col-span-3" label="Marca" value={form.marca ?? ''} onChange={(e) => set('marca', e.target.value)} />
            <Select className="md:col-span-3" label="Categoria" value={form.categoriaId ?? ''} onChange={(e) => set('categoriaId', e.target.value ? Number(e.target.value) : null)} opcoes={(categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))} placeholder="—" />
            <Input className="md:col-span-1" label="Unidade" value={form.unidade} onChange={(e) => set('unidade', e.target.value.toUpperCase())} maxLength={6} />
            <Input className="md:col-span-2" label="Garantia (dias)" type="number" min={0} value={form.garantiaDias} onChange={(e) => set('garantiaDias', Number(e.target.value))} />
            <Input className="md:col-span-8" label="Descrição curta" value={form.descricaoCurta ?? ''} onChange={(e) => set('descricaoCurta', e.target.value)} />
            <Input className="md:col-span-4" label="URL da imagem" value={form.imagemUrl ?? ''} onChange={(e) => set('imagemUrl', e.target.value)} />
            <Textarea className="md:col-span-12" label="Descrição detalhada" rows={3} value={form.descricaoDetalhada ?? ''} onChange={(e) => set('descricaoDetalhada', e.target.value)} />
          </div>
        </Secao>

        <div className="grid gap-4 lg:grid-cols-2">
          <Secao titulo="Preços">
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput label="Preço de venda" value={form.preco} onChange={(v) => set('preco', v)} />
              <MoneyInput label="Preço de custo" value={form.precoCusto} onChange={(v) => set('precoCusto', v)} />
            </div>
            {margem !== null && (
              <p className="mt-2 text-xs text-slate-500">
                Margem sobre o custo: <strong className={margem < 0 ? 'text-red-600' : 'text-emerald-700'}>{numero(margem, 1)}%</strong> · lucro unitário {moeda(form.preco - form.precoCusto)}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">O custo é atualizado automaticamente pela última compra atendida.</p>
          </Secao>
          <Secao titulo="Estoque">
            {ehServico ? (
              <p className="text-sm text-slate-500">Serviços não movimentam estoque.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyInput label="Estoque mínimo" prefixo="" value={form.estoqueMinimo} onChange={(v) => set('estoqueMinimo', v)} />
                <MoneyInput label="Peso (kg)" prefixo="" casas={3} value={form.peso ?? 0} onChange={(v) => set('peso', v)} />
                <div className="sm:col-span-2 space-y-2">
                  <Checkbox label="Controla estoque" descricao="Desmarque para itens sem controle de saldo (ex.: brindes)" checked={form.controlaEstoque} onChange={(e) => set('controlaEstoque', e.target.checked)} />
                  <Checkbox label="Ativo" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} />
                </div>
              </div>
            )}
          </Secao>
        </div>

        <Secao titulo="Fiscal" descricao={ehServico ? 'Dados para NFS-e / ISS.' : 'Dados usados na emissão de NF-e/NFC-e (Simples Nacional).'}>
          {ehServico ? (
            <div className="grid gap-3 md:grid-cols-4">
              <Input label="Código do serviço (LC 116)" value={form.codigoServico ?? ''} onChange={(e) => set('codigoServico', e.target.value)} />
              <MoneyInput label="Alíquota ISS %" prefixo="" value={form.issAliquota} onChange={(v) => set('issAliquota', v)} />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-12">
              <Input className="md:col-span-2" label="NCM" value={form.ncm ?? ''} onChange={(e) => set('ncm', e.target.value)} placeholder="8471.30.12" />
              <Input className="md:col-span-2" label="CEST" value={form.cest ?? ''} onChange={(e) => set('cest', e.target.value)} />
              <Input className="md:col-span-2" label="CFOP padrão" value={form.cfopPadrao ?? ''} onChange={(e) => set('cfopPadrao', e.target.value)} placeholder="5102" />
              <Select className="md:col-span-3" label="Origem" value={form.origem} onChange={(e) => set('origem', Number(e.target.value))} opcoes={[{ valor: 0, rotulo: '0 — Nacional' }, { valor: 1, rotulo: '1 — Estrangeira (importação direta)' }, { valor: 2, rotulo: '2 — Estrangeira (mercado interno)' }, { valor: 3, rotulo: '3 — Nacional >40% importado' }, { valor: 5, rotulo: '5 — Nacional <40% importado' }]} />
              <Input className="md:col-span-3" label="CSOSN (Simples)" value={form.csosn ?? ''} onChange={(e) => set('csosn', e.target.value)} placeholder="102" />
              <Input className="md:col-span-2" label="CST ICMS (regime normal)" value={form.cst ?? ''} onChange={(e) => set('cst', e.target.value)} />
              <MoneyInput className="md:col-span-2" label="Alíquota ICMS %" prefixo="" value={form.icmsAliquota} onChange={(v) => set('icmsAliquota', v)} />
              <Input className="md:col-span-2" label="CST PIS" value={form.pisCst} onChange={(e) => set('pisCst', e.target.value)} />
              <Input className="md:col-span-2" label="CST COFINS" value={form.cofinsCst} onChange={(e) => set('cofinsCst', e.target.value)} />
              <Input className="md:col-span-2" label="CST IPI" value={form.ipiCst ?? ''} onChange={(e) => set('ipiCst', e.target.value)} />
            </div>
          )}
        </Secao>
      </div>
    </div>
  );
}
