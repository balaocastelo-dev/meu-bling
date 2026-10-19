import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, MoneyInput } from '@/components/ui';
import { numero } from '@/lib/format';
import type { Tecnico } from '@/types';

/** Cadastro de técnicos da assistência */
export default function Tecnicos() {
  return (
    <CrudSimples<Tecnico>
      titulo="Técnicos"
      descricao="Técnicos responsáveis pelas ordens de serviço, com comissão padrão sobre serviços."
      rota="/tecnicos"
      invalidar={['tecnicos']}
      rotuloNovo="Novo técnico"
      vazio={{ nome: '', email: '', telefone: '', especialidade: '', comissaoPadraoPct: 0, ativo: true }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      colunas={[
        { titulo: 'Nome', render: (t) => <span className="font-medium">{t.nome}</span> },
        { titulo: 'Especialidade', render: (t) => <span className="text-slate-500">{t.especialidade || '—'}</span> },
        { titulo: 'Contato', render: (t) => <span className="text-slate-500">{[t.telefone, t.email].filter(Boolean).join(' · ') || '—'}</span> },
        { titulo: 'Comissão', className: 'text-right num', render: (t) => `${numero(t.comissaoPadraoPct)}%` },
        { titulo: 'Situação', render: (t) => <Badge tom={t.ativo ? 'verde' : 'cinza'}>{t.ativo ? 'Ativo' : 'Inativo'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <Input label="Especialidade" value={f.especialidade ?? ''} onChange={(e) => set({ especialidade: e.target.value })} placeholder="Notebooks, impressoras, celulares…" />
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
