import { CrudSimples } from '@/components/compartilhados/CrudSimples';
import { Badge, Checkbox, Input, MoneyInput, SearchSelect, Select } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { buscarContatos } from '@/lib/buscas';
import { numero, rotulo } from '@/lib/format';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import type { FormaPagamento } from '@/types';

const TIPOS = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'CREDIARIO', 'CREDITO_BANCARIO', 'CARNE', 'OUTRO'];
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
        { titulo: 'Bancos', render: (f) => <span className="text-slate-600">{(f.contasPermitidas?.length ? f.contasPermitidas.map((id) => nomeConta(id)).filter(Boolean).join(', ') : nomeConta(f.contaFinanceiraId)) ?? '— todos —'}</span> },
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
            <MoneyInput label={f.tipo === 'CREDITO_BANCARIO' ? 'Juros do empréstimo (%)' : 'Taxa (%)'} prefixo="" value={f.taxaPct ?? 0} onChange={(v) => set({ taxaPct: v })} />
            <Input label={f.tipo === 'CREDITO_BANCARIO' ? 'Prazo para devolver (dias)' : 'Dias para receber'} type="number" min={0} value={f.diasRecebimento ?? 0} onChange={(e) => set({ diasRecebimento: Number(e.target.value) })} />
            {f.tipo === 'CREDITO_BANCARIO' && (
              <div className="col-span-2 space-y-1">
                <CredorSelect valor={f.credorId ?? null} onChange={(id) => set({ credorId: id })} />
                <p className="text-xs text-slate-500">Venda ou compra paga com esta forma vira um empréstimo: o valor entra no banco abaixo e a devolução + juros vai para o contas a pagar (Financeiro › Empréstimos).</p>
              </div>
            )}
            <Input label="Máximo de parcelas" type="number" min={1} value={f.maxParcelas ?? 1} onChange={(e) => set({ maxParcelas: Number(e.target.value) })} />
            <Select
              className="col-span-2"
              label="Banco onde o dinheiro cai"
              value={f.contaFinanceiraId ?? ''}
              onChange={(e) => set({ contaFinanceiraId: e.target.value ? Number(e.target.value) : null })}
              opcoes={opcoesDe(contas)}
              placeholder="Conta padrão"
            />
            <div className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-slate-600">Bancos que recebem esta forma (aparecem no fechamento da venda)</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {(contas ?? []).map((c) => {
                  const lista = f.contasPermitidas ?? [];
                  return (
                    <Checkbox
                      key={c.id}
                      label={c.nome}
                      checked={lista.includes(c.id)}
                      onChange={(e) => set({ contasPermitidas: e.target.checked ? [...lista, c.id] : lista.filter((x) => x !== c.id) })}
                    />
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-slate-400">Nenhum marcado = todos os bancos aparecem.</p>
            </div>
          </div>
          <Checkbox label="Ativa" checked={f.ativo ?? true} onChange={(e) => set({ ativo: e.target.checked })} />
        </>
      )}
    />
  );
}

/** Credor da forma "Crédito bancário" (mostra o nome do contato já escolhido) */
function CredorSelect({ valor, onChange }: { valor: number | null; onChange: (id: number | null) => void }) {
  const { data: atual } = useQuery({ queryKey: ['contato-nome', valor], enabled: !!valor, queryFn: () => api.get<{ id: number; nome: string }>(`/contatos/${valor}`) });
  return <SearchSelect label="Credor (quem empresta)" valor={valor} rotuloAtual={atual?.nome ?? null} buscar={(t) => buscarContatos(t)} onChange={(id) => onChange(id)} placeholder="ex.: Lumicred" />;
}
