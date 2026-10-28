import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, MoneyInput, Select } from '@/components/ui';
import { numero, rotulo } from '@/lib/format';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import type { FormaPagamento } from '@/types';

const TIPOS = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'CREDIARIO', 'OUTRO'];
const TPAG = [['01', 'Dinheiro'], ['02', 'Cheque'], ['03', 'Cartão de crédito'], ['04', 'Cartão de débito'], ['05', 'Crédito loja'], ['15', 'Boleto'], ['16', 'Depósito'], ['17', 'PIX'], ['18', 'Transferência'], ['90', 'Sem pagamento'], ['99', 'Outros']];

/** Formas de pagamento */
export default function FormasPagamento() {
  const { data: contas } = useContasFinanceiras();
  const nomeConta = (id?: number | null) => contas?.find((c) => c.id === id)?.nome;
  return (
    <CrudSimples<FormaPagamento>
      titulo="Formas de pagamento"
      descricao="Banco onde o dinheiro cai, taxas, prazos de recebimento e código fiscal (tPag) usado na NF-e."
      rota="/formas-pagamento"
      invalidar={['formas-pagamento']}
      rotuloNovo="Nova forma"
      vazio={{ nome: '', tipo: 'OUTRO', codigoFiscal: '99', taxaPct: 0, diasRecebimento: 0, maxParcelas: 1, ativo: true }}
      validar={(f) => (!f.nome?.trim() ? 'Informe o nome.' : null)}
      colunas={[
        { titulo: 'Nome', render: (f) => <span className="font-medium">{f.nome}</span> },
        { titulo: 'Tipo', render: (f) => <span className="text-slate-500">{rotulo(f.tipo)}</span> },
        { titulo: 'Cai no banco', render: (f) => <span className="text-slate-600">{nomeConta(f.contaFinanceiraId) ?? '— padrão —'}</span> },
        { titulo: 'tPag', render: (f) => <span className="font-mono text-xs">{f.codigoFiscal}</span> },
        { titulo: 'Taxa', className: 'text-right num', render: (f) => `${numero(f.taxaPct)}%` },
        { titulo: 'Recebe em', className: 'text-right num', render: (f) => `${f.diasRecebimento} d` },
        { titulo: 'Máx. parcelas', className: 'text-right num', render: (f) => f.maxParcelas },
        { titulo: 'Situação', render: (f) => <Badge tom={f.ativo ? 'verde' : 'cinza'}>{f.ativo ? 'Ativa' : 'Inativa'}</Badge> },
      ]}
      formulario={(f, set) => (
        <>
          <Input label="Nome" obrigatorio value={f.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} autoFocus />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Tipo" value={f.tipo ?? 'OUTRO'} onChange={(e) => set({ tipo: e.target.value as FormaPagamento['tipo'] })} opcoes={TIPOS.map((t) => ({ valor: t, rotulo: rotulo(t) }))} />
            <Select label="Código fiscal (tPag)" value={f.codigoFiscal ?? '99'} onChange={(e) => set({ codigoFiscal: e.target.value })} opcoes={TPAG.map(([v, r]) => ({ valor: v, rotulo: `${v} — ${r}` }))} />
            <MoneyInput label="Taxa (%)" prefixo="" value={f.taxaPct ?? 0} onChange={(v) => set({ taxaPct: v })} />
            <Input label="Dias para receber" type="number" min={0} value={f.diasRecebimento ?? 0} onChange={(e) => set({ diasRecebimento: Number(e.target.value) })} />
            <Input label="Máximo de parcelas" type="number" min={1} value={f.maxParcelas ?? 1} onChange={(e) => set({ maxParcelas: Number(e.target.value) })} />
            <Select
              className="col-span-2"
              label="Banco onde o dinheiro cai"
              value={f.contaFinanceiraId ?? ''}
              onChange={(e) => set({ contaFinanceiraId: e.target.value ? Number(e.target.value) : null })}
              opcoes={opcoesDe(contas)}
              placeholder="Conta padrão"
            />
          </div>
          <Checkbox label="Ativa" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}
