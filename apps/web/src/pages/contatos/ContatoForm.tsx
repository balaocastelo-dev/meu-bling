import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Save, Search, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useVendedores, opcoesDe } from '@/hooks/useListas';
import { Button, Checkbox, FormSkeleton, Input, MoneyInput, PageHeader, Secao, Select, Textarea } from '@/components/ui';
import { somenteDigitos } from '@/lib/format';
import type { Contato, TipoContato } from '@/types';

type Form = Omit<Contato, 'id' | 'resumo' | 'vendedor' | 'criadoEm'>;

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function vazio(tipo: TipoContato): Form {
  return {
    tipo,
    tipoPessoa: 'F',
    nome: '',
    fantasia: '',
    documento: '',
    ie: '',
    ieIsento: false,
    rg: '',
    email: '',
    telefone: '',
    celular: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    codigoMunicipio: '',
    municipio: '',
    uf: 'SP',
    cep: '',
    observacoes: '',
    limiteCredito: 0,
    indicadorIe: 9,
    ativo: true,
    vendedorId: null,
  };
}

/** Cadastro completo de contato (cliente / fornecedor / transportadora) */
export default function ContatoForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const editando = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: vendedores } = useVendedores();
  const [form, setForm] = useState<Form>(() => vazio((sp.get('tipo') as TipoContato) || 'CLIENTE'));
  const [buscandoCep, setBuscandoCep] = useState(false);

  const { data: contato, isLoading } = useQuery({ queryKey: ['contato', id], queryFn: () => api.get<Contato>(`/contatos/${id}`), enabled: editando });
  useEffect(() => {
    if (contato) {
      const { id: _id, resumo: _r, vendedor: _v, criadoEm: _c, ...resto } = contato;
      setForm({ ...vazio(contato.tipo), ...resto });
    }
  }, [contato]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  // CEP completo (8 dígitos) → preenche rua, bairro, cidade, UF e código IBGE sozinho
  const ultimoCep = useRef('');
  useEffect(() => {
    const c = somenteDigitos(form.cep);
    if (c.length === 8 && c !== ultimoCep.current && (!form.codigoMunicipio || !form.logradouro)) {
      ultimoCep.current = c;
      buscarCep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cep]);

  const buscarCep = async () => {
    const c = somenteDigitos(form.cep);
    if (c.length !== 8) return toast.error('CEP deve ter 8 dígitos.');
    setBuscandoCep(true);
    try {
      const r = await api.get<{ logradouro?: string; bairro?: string; municipio?: string; uf?: string; codigoMunicipio?: string }>(`/contatos/cep/${c}`);
      setForm((f) => ({ ...f, logradouro: r.logradouro || f.logradouro, bairro: r.bairro || f.bairro, municipio: r.municipio || f.municipio, uf: r.uf || f.uf, codigoMunicipio: r.codigoMunicipio || f.codigoMunicipio }));
      toast.success('Endereço preenchido pelo CEP.');
    } catch (e) {
      toast.error(mensagemErro(e, 'CEP não encontrado.'));
    } finally {
      setBuscandoCep(false);
    }
  };

  const salvar = useMutation({
    mutationFn: (p: Form) => {
      const body = { ...p, documento: somenteDigitos(p.documento) || null, celular: somenteDigitos(p.celular) || null, telefone: somenteDigitos(p.telefone) || null, cep: somenteDigitos(p.cep) || null, email: p.email?.trim() || null };
      return editando ? api.put<Contato>(`/contatos/${id}`, body) : api.post<Contato>('/contatos', body);
    },
    onSuccess: (c) => {
      toast.success(editando ? 'Contato atualizado.' : 'Contato cadastrado.');
      qc.invalidateQueries({ queryKey: ['contatos'] });
      qc.invalidateQueries({ queryKey: ['contato', String(c.id)] });
      nav(`/contatos/${c.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const submeter = () => {
    if (!form.nome.trim()) return toast.error('Informe o nome.');
    salvar.mutate(form);
  };

  if (editando && isLoading) return <FormSkeleton />;
  const ehJuridica = form.tipoPessoa === 'J';

  return (
    <div className="pb-6">
      <PageHeader
        migalhas={[{ rotulo: 'Contatos', para: '/contatos' }, { rotulo: editando ? contato?.nome ?? '' : 'Novo contato' }]}
        titulo={editando ? `Editar ${contato?.nome ?? ''}` : 'Novo contato'}
        acoes={
          <>
            <Button variante="secundario" icone={<X className="h-4 w-4" />} onClick={() => nav(editando ? `/contatos/${id}` : '/contatos')}>Cancelar</Button>
            <Button variante="primario" icone={<Save className="h-4 w-4" />} carregando={salvar.isPending} onClick={submeter}>Salvar</Button>
          </>
        }
      />
      <div className="space-y-4">
        <Secao titulo="Identificação">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <Select className="xl:col-span-3" label="Tipo de contato" value={form.tipo} onChange={(e) => set('tipo', e.target.value as TipoContato)} opcoes={[{ valor: 'CLIENTE', rotulo: 'Cliente' }, { valor: 'FORNECEDOR', rotulo: 'Fornecedor' }, { valor: 'TRANSPORTADORA', rotulo: 'Transportadora' }, { valor: 'AMBOS', rotulo: 'Cliente e fornecedor' }]} />
            <Select className="xl:col-span-2" label="Pessoa" value={form.tipoPessoa} onChange={(e) => set('tipoPessoa', e.target.value as Form['tipoPessoa'])} opcoes={[{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }, { valor: 'E', rotulo: 'Estrangeiro' }]} />
            <Input className="sm:col-span-2 xl:col-span-7" label={ehJuridica ? 'Razão social' : 'Nome completo'} obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus />
            <Input className="xl:col-span-4" label={ehJuridica ? 'Nome fantasia' : 'Apelido'} value={form.fantasia ?? ''} onChange={(e) => set('fantasia', e.target.value)} />
            <Input className="xl:col-span-3" label={ehJuridica ? 'CNPJ' : 'CPF'} value={form.documento ?? ''} onChange={(e) => set('documento', e.target.value)} inputMode="numeric" />
            {ehJuridica ? (
              <>
                <Input className="xl:col-span-3" label="Inscrição estadual" value={form.ie ?? ''} onChange={(e) => set('ie', e.target.value)} disabled={form.ieIsento} />
                <div className="flex items-end pb-2 xl:col-span-2"><Checkbox label="IE isento" checked={form.ieIsento} onChange={(e) => set('ieIsento', e.target.checked)} /></div>
              </>
            ) : (
              <Input className="xl:col-span-3" label="RG" value={form.rg ?? ''} onChange={(e) => set('rg', e.target.value)} />
            )}
            <Select className="xl:col-span-3" label="Indicador IE (NF-e)" value={form.indicadorIe} onChange={(e) => set('indicadorIe', Number(e.target.value))} opcoes={[{ valor: 9, rotulo: '9 — Não contribuinte' }, { valor: 1, rotulo: '1 — Contribuinte ICMS' }, { valor: 2, rotulo: '2 — Isento' }]} />
          </div>
        </Secao>

        <Secao titulo="Contato">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <Input className="xl:col-span-3" label="Celular (WhatsApp)" value={form.celular ?? ''} onChange={(e) => set('celular', e.target.value)} placeholder="(19) 99999-9999" inputMode="tel" ajuda="Usado para notificações por WhatsApp" />
            <Input className="xl:col-span-3" label="Telefone" value={form.telefone ?? ''} onChange={(e) => set('telefone', e.target.value)} inputMode="tel" />
            <Input className="xl:col-span-6" label="E-mail" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
        </Secao>

        <Secao titulo="Endereço">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <div className="xl:col-span-3">
              <Input label="CEP" value={form.cep ?? ''} onChange={(e) => set('cep', e.target.value)} inputMode="numeric" sufixo={<button type="button" onClick={buscarCep} className="pointer-events-auto text-brand-600 hover:text-brand-700" title="Buscar CEP">{buscandoCep ? '…' : <Search className="h-4 w-4" />}</button>} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), buscarCep())} />
            </div>
            <Input className="xl:col-span-6" label="Logradouro" value={form.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} />
            <Input className="xl:col-span-1" label="Nº" value={form.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
            <Input className="xl:col-span-2" label="Complemento" value={form.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} />
            <Input className="xl:col-span-4" label="Bairro" value={form.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
            <Input className="xl:col-span-4" label="Município" value={form.municipio ?? ''} onChange={(e) => set('municipio', e.target.value)} />
            <Select className="xl:col-span-2" label="UF" value={form.uf ?? ''} onChange={(e) => set('uf', e.target.value)} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} placeholder="—" />
            <Input className="xl:col-span-2" label="Cód. IBGE" value={form.codigoMunicipio ?? ''} onChange={(e) => set('codigoMunicipio', e.target.value)} />
          </div>
        </Secao>

        <Secao titulo="Comercial">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
            <Select className="xl:col-span-4" label="Vendedor responsável" value={form.vendedorId ?? ''} onChange={(e) => set('vendedorId', e.target.value ? Number(e.target.value) : null)} opcoes={opcoesDe(vendedores)} placeholder="—" />
            <MoneyInput className="xl:col-span-3" label="Limite de crédito" value={form.limiteCredito} onChange={(v) => set('limiteCredito', v)} />
            <div className="flex items-end pb-2 xl:col-span-2"><Checkbox label="Ativo" checked={form.ativo} onChange={(e) => set('ativo', e.target.checked)} /></div>
            <Textarea className="sm:col-span-2 xl:col-span-12" label="Observações" rows={3} value={form.observacoes ?? ''} onChange={(e) => set('observacoes', e.target.value)} />
          </div>
        </Secao>
      </div>
    </div>
  );
}
