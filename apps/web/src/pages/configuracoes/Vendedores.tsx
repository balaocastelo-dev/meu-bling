import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, MoneyInput } from '@/components/ui';
import { numero } from '@/lib/format';
import type { Vendedor } from '@/types';

/** Cadastro de vendedores */
export default function Vendedores() {
  return (
    <CrudSimples<Vendedor>
      titulo="Vendedores"
      descricao="Vendedores com comissão padrão aplicada nos itens de venda."
      rota="/vendedores"
      invalidar={['vendedores']}
      rotuloNovo="Novo vendedor"
      vazio={{ nome: '', email: '', telefone: '', comissaoPadraoPct: 0, ativo: true }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      colunas={[
        { titulo: 'Nome', render: (v) => <span className="font-medium">{v.nome}</span> },
        { titulo: 'E-mail', render: (v) => <span className="text-slate-500">{v.email || '—'}</span> },
        { titulo: 'Telefone', render: (v) => <span className="text-slate-500">{v.telefone || '—'}</span> },
        { titulo: 'Comissão', className: 'text-right num', render: (v) => `${numero(v.comissaoPadraoPct)}%` },
        { titulo: 'Situação', render: (v) => <Badge tom={v.ativo ? 'verde' : 'cinza'}>{v.ativo ? 'Ativo' : 'Inativo'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Input label="E-mail" type="email" value={f.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
            <Input label="Telefone" value={f.telefone ?? ''} onChange={(e) => set({ telefone: e.target.value })} />
          </div>
          <MoneyInput label="Comissão padrão (%)" prefixo="" value={f.comissaoPadraoPct ?? 0} onChange={(v) => set({ comissaoPadraoPct: v })} />
          <Checkbox label="Ativo" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
