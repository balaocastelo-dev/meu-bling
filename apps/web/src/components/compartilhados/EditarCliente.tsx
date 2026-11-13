/**
 * Corrige o cadastro do cliente (nome, documento, telefone, e-mail e endereço)
 * sem sair da OS. O CPF/CNPJ aceita máscara; dígito errado não impede salvar.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { Button, Input, Modal, Select } from '@/components/ui';
import { somenteDigitos } from '@/lib/format';
import type { Contato } from '@/types';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

interface Props {
  contatoId: number | null;
  aberto: boolean;
  onFechar: () => void;
}

type Form = {
  nome: string;
  tipoPessoa: 'F' | 'J' | 'E';
  documento: string;
  celular: string;
  telefone: string;
  email: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
};

const vazio = (): Form => ({ nome: '', tipoPessoa: 'F', documento: '', celular: '', telefone: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: 'SP' });

export function EditarCliente({ contatoId, aberto, onFechar }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(vazio);
  const { data, isLoading } = useQuery({
    queryKey: ['contato', String(contatoId)],
    queryFn: () => api.get<Contato>(`/contatos/${contatoId}`),
    enabled: aberto && !!contatoId,
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      nome: data.nome ?? '',
      tipoPessoa: data.tipoPessoa ?? 'F',
      documento: data.documento ?? '',
      celular: data.celular ?? '',
      telefone: data.telefone ?? '',
      email: data.email ?? '',
      cep: data.cep ?? '',
      logradouro: data.logradouro ?? '',
      numero: data.numero ?? '',
      complemento: data.complemento ?? '',
      bairro: data.bairro ?? '',
      municipio: data.municipio ?? '',
      uf: data.uf ?? 'SP',
    });
  }, [data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const salvar = useMutation({
    mutationFn: () =>
      api.put<Contato & { avisoDocumento?: string | null }>(`/contatos/${contatoId}`, {
        nome: form.nome.trim(),
        tipoPessoa: form.tipoPessoa,
        documento: somenteDigitos(form.documento) || null,
        celular: somenteDigitos(form.celular) || null,
        telefone: form.telefone.trim() || null,
        email: form.email.trim() || null,
        cep: somenteDigitos(form.cep) || null,
        logradouro: form.logradouro.trim() || null,
        numero: form.numero.trim() || null,
        complemento: form.complemento.trim() || null,
        bairro: form.bairro.trim() || null,
        municipio: form.municipio.trim() || null,
        uf: form.uf || null,
      }),
    onSuccess: (c) => {
      toast.success('Cadastro do cliente atualizado.');
      if (c.avisoDocumento) toast.warning(c.avisoDocumento, { duration: 8000 });
      qc.invalidateQueries({ queryKey: ['contato', String(contatoId)] });
      qc.invalidateQueries({ queryKey: ['contatos'] });
      qc.invalidateQueries({ queryKey: ['os'] });
      qc.invalidateQueries({ queryKey: ['ordens-servico'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const ehJuridica = form.tipoPessoa === 'J';

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Corrigir cadastro do cliente"
      descricao="Altera o cadastro usado nesta OS e nas próximas vendas."
      tamanho="lg"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={salvar.isPending || isLoading} onClick={() => { if (form.nome.trim().length < 2) return toast.error('Informe o nome.'); salvar.mutate(); }}>Salvar</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input className="sm:col-span-2" label="Nome" obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus />
        <Select label="Pessoa" value={form.tipoPessoa} onChange={(e) => set('tipoPessoa', e.target.value as Form['tipoPessoa'])} opcoes={[{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }, { valor: 'E', rotulo: 'Estrangeiro' }]} />
        <Input label={ehJuridica ? 'CNPJ' : 'CPF'} value={form.documento} onChange={(e) => set('documento', e.target.value)} inputMode="numeric" ajuda="Pode digitar com pontos e traço. Se o dígito não bater, salvamos assim mesmo." />
        <Input label="Celular" value={form.celular} onChange={(e) => set('celular', e.target.value)} inputMode="tel" placeholder="(19) 99999-9999" />
        <Input label="Telefone" value={form.telefone} onChange={(e) => set('telefone', e.target.value)} inputMode="tel" />
        <Input className="sm:col-span-2" label="E-mail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        <Input label="CEP" value={form.cep} onChange={(e) => set('cep', e.target.value)} inputMode="numeric" />
        <Input label="Logradouro" value={form.logradouro} onChange={(e) => set('logradouro', e.target.value)} />
        <Input label="Número" value={form.numero} onChange={(e) => set('numero', e.target.value)} />
        <Input label="Complemento" value={form.complemento} onChange={(e) => set('complemento', e.target.value)} />
        <Input label="Bairro" value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
        <Input label="Município" value={form.municipio} onChange={(e) => set('municipio', e.target.value)} />
        <Select label="UF" value={form.uf} onChange={(e) => set('uf', e.target.value)} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} placeholder="—" />
      </div>
    </Modal>
  );
}
