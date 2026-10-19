import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, mensagemErro } from '@/lib/api';
import { Button, Drawer, Input, Select } from '@/components/ui';
import { somenteDigitos } from '@/lib/format';
import type { Contato, TipoContato } from '@/types';

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onCriado: (c: Contato) => void;
  tipo?: TipoContato;
}

/** Drawer de cadastro rápido de contato (cliente/fornecedor) a partir de um formulário */
export function ContatoRapidoDrawer({ aberto, onFechar, onCriado, tipo = 'CLIENTE' }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ nome: '', tipoPessoa: 'F', documento: '', celular: '', email: '', telefone: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const criar = useMutation({
    mutationFn: () =>
      api.post<Contato>('/contatos', {
        tipo,
        tipoPessoa: form.tipoPessoa,
        nome: form.nome.trim(),
        documento: somenteDigitos(form.documento) || null,
        celular: somenteDigitos(form.celular) || null,
        telefone: somenteDigitos(form.telefone) || null,
        email: form.email.trim() || null,
      }),
    onSuccess: (c) => {
      toast.success(`${tipo === 'FORNECEDOR' ? 'Fornecedor' : 'Cliente'} cadastrado.`);
      qc.invalidateQueries({ queryKey: ['contatos'] });
      onCriado(c);
      setForm({ nome: '', tipoPessoa: 'F', documento: '', celular: '', email: '', telefone: '' });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Drawer
      aberto={aberto}
      onFechar={onFechar}
      titulo={tipo === 'FORNECEDOR' ? 'Novo fornecedor' : 'Novo cliente'}
      descricao="Cadastro rápido — você pode completar os dados depois."
      largura="max-w-md"
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
      <div className="space-y-3">
        <Input label="Nome" obrigatorio value={form.nome} onChange={(e) => set('nome', e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Pessoa" value={form.tipoPessoa} onChange={(e) => set('tipoPessoa', e.target.value)} opcoes={[{ valor: 'F', rotulo: 'Física' }, { valor: 'J', rotulo: 'Jurídica' }]} />
          <Input label={form.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'} value={form.documento} onChange={(e) => set('documento', e.target.value)} inputMode="numeric" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Celular (WhatsApp)" value={form.celular} onChange={(e) => set('celular', e.target.value)} placeholder="(19) 99999-9999" inputMode="tel" />
          <Input label="Telefone" value={form.telefone} onChange={(e) => set('telefone', e.target.value)} inputMode="tel" />
        </div>
        <Input label="E-mail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </div>
    </Drawer>
  );
}
