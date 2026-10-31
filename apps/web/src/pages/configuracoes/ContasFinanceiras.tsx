import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { OpenFinanceConta } from '@/components/financeiro/OpenFinanceConta';
import { Badge, Checkbox, Input, MoneyInput, Select } from '@/components/ui';
import { moeda, rotulo } from '@/lib/format';
import type { ContaFinanceira } from '@/types';

/** Contas financeiras (caixa, bancos, cartões) */
export default function ContasFinanceiras() {
  return (
    <CrudSimples<ContaFinanceira>
      titulo="Contas financeiras"
      descricao="Caixa, contas bancárias e cartões onde entram e saem os valores."
      rota="/contas-financeiras"
      invalidar={['contas-financeiras', 'financeiro-resumo']}
      rotuloNovo="Nova conta"
      vazio={{ nome: '', tipo: 'BANCO', banco: '', agencia: '', conta: '', saldoInicial: 0, taxaRecebimentoPct: 0, padrao: false, ativo: true, cor: '#2563eb' }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      antesDeSalvar={(f) => { const { saldoAtual: _s, saldoBanco: _b, saldoBancoEm: _e, openFinanceItemId: _i, openFinanceAccountId: _a, openFinanceStatus: _st, ultimaSincronizacao: _u, ...resto } = f; return resto; }}
      colunas={[
        { titulo: 'Conta', render: (c) => <span className="inline-flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.cor || '#2563eb' }} />{c.nome}{c.padrao && <Badge tom="azul">Padrão</Badge>}</span> },
        { titulo: 'Tipo', render: (c) => <span className="text-slate-500">{rotulo(c.tipo)}</span> },
        { titulo: 'Banco', render: (c) => <span className="text-slate-500">{[c.banco, c.agencia && `ag. ${c.agencia}`, c.conta && `cc. ${c.conta}`].filter(Boolean).join(' · ') || '—'}</span> },
        { titulo: 'Saldo atual', className: 'text-right num', render: (c) => <span className={c.saldoAtual < 0 ? 'text-red-600' : ''}>{moeda(c.saldoAtual)}</span> },
        { titulo: 'Open Finance', render: (c) => <OpenFinanceConta conta={c} compacto /> },
        { titulo: 'Situação', render: (c) => <Badge tom={c.ativo ? 'verde' : 'cinza'}>{c.ativo ? 'Ativa' : 'Inativa'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo" value={f.tipo ?? 'BANCO'} onChange={(e) => set({ tipo: e.target.value as ContaFinanceira['tipo'] })} opcoes={['CAIXA', 'BANCO', 'CARTAO', 'INVESTIMENTO', 'OUTRO'].map((t) => ({ valor: t, rotulo: rotulo(t) }))} />
            <div className="flex flex-col gap-1"><span className="text-xs font-medium text-slate-600">Cor</span><input type="color" value={f.cor ?? '#2563eb'} onChange={(e) => set({ cor: e.target.value })} className="h-9 w-full cursor-pointer rounded border border-slate-300" /></div>
            <Input label="Banco" value={f.banco ?? ''} onChange={(e) => set({ banco: e.target.value })} />
            <Input label="Agência" value={f.agencia ?? ''} onChange={(e) => set({ agencia: e.target.value })} />
            <Input label="Conta" value={f.conta ?? ''} onChange={(e) => set({ conta: e.target.value })} />
            <MoneyInput label="Saldo inicial" value={f.saldoInicial ?? 0} onChange={(v) => set({ saldoInicial: v })} ajuda={f.id ? 'Mudar aqui ajusta o saldo atual pela diferença.' : undefined} />
            <MoneyInput label="Taxa nos recebimentos (%)" prefixo="" value={f.taxaRecebimentoPct ?? 0} onChange={(v) => set({ taxaRecebimentoPct: v })} ajuda="Ex.: Mercado Pago 5% — entra o valor menos a taxa." />
          </div>
          <Checkbox label="Conta padrão" checked={f.padrao ?? false} onChange={(e) => set({ padrao: e.target.checked })} />
          <Checkbox label="Ativa" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
