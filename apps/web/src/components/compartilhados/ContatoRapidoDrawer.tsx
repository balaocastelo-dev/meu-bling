import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Search } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Drawer, Input, Select } from '@/components/ui';
import { somenteDigitos } from '@/lib/format';
import type { Contato, DadosCnpj, TipoContato } from '@/types';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriado: (c: Contato) => void;
  tipo?: TipoContato;
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const VAZIO = {
  nome: '',
  tipoPessoa: 'F',
  documento: '',
  ie: '',
  celular: '',
  email: '',
  telefone: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  uf: 'SP',
  codigoMunicipio: '',
};

/**
 * Drawer de cadastro rápido de contato (cliente/fornecedor) a partir de um formulário.
 * Traz o endereço junto — antes era preciso salvar, abrir outra aba e editar o cadastro
 * só para informar a rua. Com CNPJ, o botão "Importar da Receita" preenche tudo.
 */
export function ContatoRapidoDrawer({ aberto, onFechar, onCriado, tipo = 'CLIENTE' }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...VAZIO });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const ultimoCep = useRef('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const ehJuridica = form.tipoPessoa === 'J';

  /** CEP com 8 dígitos preenche rua, bairro, cidade, UF e código IBGE. */
  const buscarCep = async (valor?: string) => {
    const c = somenteDigitos(valor ?? form.cep);
    if (c.length !== 8) return toast.error('O CEP deve ter 8 dígitos.');
    setBuscandoCep(true);
    try {
      const r = await api.get<{ logradouro?: string; bairro?: string; municipio?: string; uf?: string; codigoMunicipio?: string }>(`/contatos/cep/${c}`);
      setForm((f) => ({ ...f, logradouro: r.logradouro || f.logradouro, bairro: r.bairro || f.bairro, municipio: r.municipio || f.municipio, uf: r.uf || f.uf, codigoMunicipio: r.codigoMunicipio || f.codigoMunicipio }));
    } catch (e) {
      toast.error(mensagemErro(e, 'CEP não encontrado.'));
    } finally {
      setBuscandoCep(false);
    }
  };

  /** "Importar do SEFAZ" do Bling: puxa razão social, endereço e contato pelo CNPJ. */
  const importarCnpj = async () => {
    const d = somenteDigitos(form.documento);
    if (d.length !== 14) return toast.error('Digite o CNPJ completo (14 dígitos) para importar.');
    setBuscandoCnpj(true);
    try {
      const r = await api.get<DadosCnpj>(`/contatos/cnpj/${d}`);
      setForm((f) => ({
        ...f,
        tipoPessoa: 'J',
        nome: r.nome || f.nome,
        documento: r.documento,
        ie: r.ie || f.ie,
        email: r.email || f.email,
        telefone: r.telefone || f.telefone,
        cep: r.cep || f.cep,
        logradouro: r.logradouro || f.logradouro,
        numero: r.numero || f.numero,
        complemento: r.complemento || f.complemento,
        bairro: r.bairro || f.bairro,
        municipio: r.municipio || f.municipio,
        uf: r.uf || f.uf,
        codigoMunicipio: r.codigoMunicipio || f.codigoMunicipio,
      }));
      ultimoCep.current = somenteDigitos(r.cep);
      if (r.irregular) toast.warning(`Atenção: na Receita esta empresa está ${r.situacaoCadastral}.`, { description: 'Confira antes de emitir nota para ela.' });
      else toast.success('Cadastro preenchido pela Receita Federal.', { description: r.ieEncontrada ? undefined : 'A Inscrição Estadual não é publicada — preencha à mão se precisar.' });
    } catch (e) {
      toast.error(mensagemErro(e, 'Não encontrei esse CNPJ.'));
    } finally {
      setBuscandoCnpj(false);
    }
  };

  const criar = useMutation({
    mutationFn: () =>
      api.post<Contato>('/contatos', {
        tipo,
        tipoPessoa: form.tipoPessoa,
        nome: form.nome.trim(),
        documento: somenteDigitos(form.documento) || null,
        ie: ehJuridica ? form.ie.trim() || null : null,
        celular: somenteDigitos(form.celular) || null,
        telefone: somenteDigitos(form.telefone) || null,
        email: form.email.trim() || null,
        cep: somenteDigitos(form.cep) || null,
        logradouro: form.logradouro.trim() || null,
        numero: form.numero.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        municipio: form.municipio.trim() || null,
        uf: form.uf || null,
        codigoMunicipio: form.codigoMunicipio.trim() || null,
      }),
    onSuccess: (c) => {
      toast.success(`${tipo === 'FORNECEDOR' ? 'Fornecedor' : 'Cliente'} cadastrado.`);
      qc.invalidateQueries({ queryKey: ['contatos'] });
      onCriado(c);
      setForm({ ...VAZIO });
      ultimoCep.current = '';
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Drawer
      aberto={aberto}
      onFechar={onFechar}
      titulo={tipo === 'FORNECEDOR' ? 'Novo fornecedor' : 'Novo cliente'}
      descricao="Nome, contato e endereço — já dá para emitir nota sem abrir outra tela."
      largura="max-w-lg"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            Cancelar
          </Button>
          <Button variante="primario" carregando={criar.isPending} disabled={!form.nome.trim()} onClick={() => criar.mutate()}>
            Salvar e selecionar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Pessoa" value={form.tipoPessoa} onChange={(e) => set('tipoPessoa', e.target.value)} opcoes={[{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }]} />
            <Input
              label={ehJuridica ? 'CNPJ' : 'CPF'}
              value={form.documento}
              onChange={(e) => set('documento', e.target.value)}
              inputMode="numeric"
              onKeyDown={(e) => ehJuridica && e.key === 'Enter' && (e.preventDefault(), importarCnpj())}
            />
          </div>
          {ehJuridica && (
            <Button variante="secundario" tamanho="sm" className="w-full" icone={<Download className="h-4 w-4" />} carregando={buscandoCnpj} disabled={somenteDigitos(form.documento).length !== 14} onClick={importarCnpj}>
              Importar dados da Receita pelo CNPJ
            </Button>
          )}
          <Input label={ehJuridica ? 'Razão social' : 'Nome'} obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus />
          {ehJuridica && <Input label="Inscrição estadual" value={form.ie} onChange={(e) => set('ie', e.target.value)} ajuda="Deixe vazio se a empresa não é contribuinte do ICMS" />}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Celular (WhatsApp)" value={form.celular} onChange={(e) => set('celular', e.target.value)} placeholder="(19) 99999-9999" inputMode="tel" />
            <Input label="Telefone" value={form.telefone} onChange={(e) => set('telefone', e.target.value)} inputMode="tel" />
          </div>
          <Input label="E-mail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="text-xs font-medium text-slate-600">Endereço</p>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="CEP"
              value={form.cep}
              onChange={(e) => {
                const v = e.target.value;
                set('cep', v);
                const d = somenteDigitos(v);
                if (d.length === 8 && d !== ultimoCep.current) {
                  ultimoCep.current = d;
                  void buscarCep(v);
                }
              }}
              inputMode="numeric"
              sufixo={
                <button type="button" onClick={() => buscarCep()} className="pointer-events-auto text-brand-600 hover:text-brand-700" title="Buscar CEP">
                  {buscandoCep ? '…' : <Search className="h-4 w-4" />}
                </button>
              }
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), buscarCep())}
            />
            <Input className="col-span-2" label="Logradouro" value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input label="Nº" value={form.numero} onChange={(e) => set('numero', e.target.value)} />
            <Input className="col-span-2" label="Complemento" value={form.complemento} onChange={(e) => set('complemento', e.target.value)} />
          </div>
          <div className="grid grid-cols-6 gap-3">
            <Input className="col-span-3" label="Bairro" value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
            <Input className="col-span-2" label="Município" value={form.municipio} onChange={(e) => set('municipio', e.target.value)} />
            <Select label="UF" value={form.uf} onChange={(e) => set('uf', e.target.value)} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} placeholder="—" />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
