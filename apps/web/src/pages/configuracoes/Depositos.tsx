import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input } from '@/components/ui';
import type { Deposito } from '@/types';

/** Cadastro de depósitos (lojas e distribuidores) */
export default function Depositos() {
  return (
    <CrudSimples<Deposito>
      titulo="Depósitos"
      descricao="Locais de estoque. Depósitos de distribuidores podem ser marcados para não somar no saldo disponível."
      rota="/depositos"
      invalidar={['depositos']}
      rotuloNovo="Novo depósito"
      vazio={{ nome: '', padrao: false, ativo: true, desconsiderarSaldo: false }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      colunas={[
        { titulo: 'Nome', render: (d) => <span className="font-medium">{d.nome}</span> },
        { titulo: 'Padrão', render: (d) => (d.padrao ? <Badge tom="azul">Padrão</Badge> : null) },
        { titulo: 'Conta no saldo', render: (d) => <Badge tom={d.desconsiderarSaldo ? 'amarelo' : 'verde'}>{d.desconsiderarSaldo ? 'Não (distribuidor)' : 'Sim'}</Badge> },
        { titulo: 'Situação', render: (d) => <Badge tom={d.ativo ? 'verde' : 'cinza'}>{d.ativo ? 'Ativo' : 'Inativo'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <Checkbox label="Depósito padrão" descricao="Pré-selecionado em vendas, compras e OS" checked={f.padrao ?? false} onChange={(e) => set({ padrao: e.target.checked })} />
          <Checkbox label="Desconsiderar saldo" descricao="Estoque de distribuidor: não entra na soma do estoque disponível" checked={f.desconsiderarSaldo ?? false} onChange={(e) => set({ desconsiderarSaldo: e.target.checked })} />
          <Checkbox label="Ativo" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
