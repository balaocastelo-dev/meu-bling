/**
 * "Finalizar venda": resolve tudo na saída da venda.
 * - Só deixa confirmar com a venda completa (cliente, produto, custo, pagamento, vendedor).
 * - Recebimento: cada parcela marcada como recebida no banco certo (sugerido pela forma de pagamento) ou em aberto.
 * - Compra: pergunta se registra a compra da mercadoria (com o custo da venda) e se ela já está paga (e de qual banco saiu).
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { DateInput, SearchSelect, Select } from '@/components/ui';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { buscarContatos } from '@/lib/buscas';
import { hoje, moeda } from '@/lib/format';
import type { PendenciaFinalizacao } from '@/types';

interface Checagem {
  podeFinalizar: boolean;
  pendencias: PendenciaFinalizacao[];
  jaFinalizada: boolean;
  situacaoAtual: { id: number; nome: string };
  destino: { id: number; nome: string; cor: string };
  contatoId: number;
  custoProdutos: number;
  compraRegistrada: { id: number; numero: number; total: number } | null;
  parcelas: {
    id: number;
    numero: number;
    valor: number;
    formaPagamento: { id: number; nome: string; tipo: string } | null;
    recebida: boolean;
    contaSugeridaId: number | null;
    recebidoSugerido: boolean;
    creditoPagador?: 'CLIENTE' | 'LOJA' | null;
  }[];
  formas: { id: number; nome: string; tipo: string; contaFinanceiraId: number | null; contasPermitidas: number[] }[];
}

const PAGO_NA_HORA = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'TRANSFERENCIA'];

type Escolha = 'sim' | 'nao' | null;
type Pagador = 'CLIENTE' | 'LOJA';
type EscolhaCompra = 'sim' | 'nao' | 'credito' | null;

function SimNao({ valor, onChange }: { valor: Escolha; onChange: (v: Escolha) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
      {(['sim', 'nao'] as const).map((v) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={valor === v ? 'bg-brand-600 px-4 py-1.5 font-medium text-white' : 'bg-white px-4 py-1.5 text-slate-700 hover:bg-slate-50'}>
          {v === 'sim' ? 'Sim' : 'Não'}
        </button>
      ))}
    </div>
  );
}

/** Lista do que falta, com link para abrir e corrigir. */
export function ListaPendencias({ pendencias, vendaId, contatoId, onNavegar }: { pendencias: PendenciaFinalizacao[]; vendaId: number; contatoId?: number | null; onNavegar?: () => void }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> Para finalizar, complete:
      </p>
      <ul className="mt-2 space-y-1.5">
        {pendencias.map((p) => {
          const para = p.onde === 'cliente' && contatoId ? `/contatos/${contatoId}/editar` : `/vendas/${vendaId}/editar`;
          return (
            <li key={p.campo} className="flex flex-wrap items-start justify-between gap-2">
              <span>• {p.mensagem}</span>
              <Link to={para} onClick={onNavegar} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-700 hover:underline">
                {p.onde === 'cliente' ? 'Abrir cadastro do cliente' : 'Editar venda'} <ExternalLink className="h-3 w-3" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function FinalizarVendaModal({ vendaId, numero, aberto, onFechar }: { vendaId: number; numero: number; aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const [obs, setObs] = useState('');
  const { data: contasFin } = useContasFinanceiras();
  const { data: c, isLoading, error } = useQuery({
    queryKey: ['venda-finalizacao', vendaId],
    queryFn: () => api.get<Checagem>(`/vendas/${vendaId}/finalizacao`),
    enabled: aberto,
    staleTime: 0,
  });

  // recebimento de cada parcela
  const [receb, setReceb] = useState<Record<number, { formaPagamentoId: number | ''; recebido: boolean; contaFinanceiraId: number | ''; creditoPagador?: Pagador }>>({});
  // compra da mercadoria
  const [registrarCompra, setRegistrarCompra] = useState<Escolha>(null);
  const [fornecedorId, setFornecedorId] = useState<number | null>(null);
  const [fornecedorNome, setFornecedorNome] = useState<string | null>(null);
  const [compraPaga, setCompraPaga] = useState<EscolhaCompra>(null);
  const [contaCompra, setContaCompra] = useState<number | ''>('');
  const [vencCompra, setVencCompra] = useState(hoje());

  const contaPadrao = contasFin?.find((x) => x.padrao)?.id ?? contasFin?.[0]?.id ?? '';
  useEffect(() => {
    if (!c) return;
    setReceb(Object.fromEntries(c.parcelas.map((p) => [p.id, { formaPagamentoId: p.formaPagamento?.id ?? '', recebido: p.recebidoSugerido, contaFinanceiraId: p.contaSugeridaId ?? '', creditoPagador: (p.creditoPagador ?? 'CLIENTE') as Pagador }])));
    setRegistrarCompra(c.compraRegistrada || !(c.custoProdutos > 0) ? 'nao' : null);
    setCompraPaga(null);
  }, [c]);
  useEffect(() => {
    if (contaCompra === '' && contaPadrao !== '') setContaCompra(contaPadrao);
  }, [contaPadrao, contaCompra]);

  const finalizar = useMutation({
    mutationFn: () =>
      api.post<{ situacao: { nome: string }; compra?: { compra: { numero: number }; jaExistia: boolean; paga: boolean } | null }>(`/vendas/${vendaId}/finalizar`, {
        observacao: obs || undefined,
        recebimentos: (c?.parcelas ?? []).map((p) => {
          const credito = ehCredito(receb[p.id]?.formaPagamentoId);
          return { parcelaId: p.id, formaPagamentoId: receb[p.id]?.formaPagamentoId || null, recebido: !credito && !!receb[p.id]?.recebido, contaFinanceiraId: credito ? null : receb[p.id]?.contaFinanceiraId || null, creditoPagador: credito ? receb[p.id]?.creditoPagador ?? 'CLIENTE' : null };
        }),
        compra:
          registrarCompra === 'sim'
            ? { fornecedorId, paga: compraPaga === 'sim', creditoBancario: compraPaga === 'credito', contaFinanceiraId: compraPaga === 'sim' ? contaCompra || null : null, vencimento: compraPaga === 'nao' ? vencCompra : undefined }
            : undefined,
      }),
    onSuccess: (r) => {
      const compra = r.compra && !r.compra.jaExistia ? ` Compra nº ${r.compra.compra.numero} registrada${compraPaga === 'credito' ? ' e paga com o crédito bancário' : r.compra.paga ? ' e paga' : ' (a pagar)'}.` : '';
      if (Object.values(receb).some((x) => ehCredito(x.formaPagamentoId)) || compraPaga === 'credito') qc.invalidateQueries({ queryKey: ['emprestimos'] });
      toast.success(`Venda nº ${numero} finalizada (${r.situacao.nome}).${compra}`);
      ['vendas', 'compras', 'dashboard-geral', 'painel-vendedor', 'contas-receber', 'contas-pagar', 'caixa', 'contas-financeiras', 'movimentos-fin'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ['venda', String(vendaId)] });
      qc.invalidateQueries({ queryKey: ['venda-finalizacao', vendaId] });
      setObs('');
      onFechar();
    },
    onError: (e) => {
      toast.error(mensagemErro(e));
      qc.invalidateQueries({ queryKey: ['venda-finalizacao', vendaId] });
    },
  });

  const pode = !!c?.podeFinalizar && !c.jaFinalizada;
  const formaDe = (id: number | '' | undefined) => c?.formas.find((f) => f.id === id);
  const ehCredito = (id: number | '' | undefined) => formaDe(id)?.tipo === 'CREDITO_BANCARIO';
  const temFormaCredito = !!c?.formas.some((f) => f.tipo === 'CREDITO_BANCARIO');
  const faltaBanco = (c?.parcelas ?? []).some((p) => !receb[p.id]?.formaPagamentoId || (!ehCredito(receb[p.id]?.formaPagamentoId) && receb[p.id]?.recebido && !receb[p.id]?.contaFinanceiraId));
  /** bancos que recebem a forma (se a forma não tem lista, todos) */
  const bancosDa = (id: number | '' | undefined) => {
    const f = formaDe(id);
    const todas = contasFin ?? [];
    return f && f.contasPermitidas.length ? todas.filter((x) => f.contasPermitidas.includes(x.id)) : todas;
  };
  const trocarForma = (parcelaId: number, formaId: number | '') => {
    const f = formaDe(formaId);
    const bancos = bancosDa(formaId);
    const banco = f?.contaFinanceiraId && bancos.some((b) => b.id === f.contaFinanceiraId) ? f.contaFinanceiraId : bancos.length === 1 ? bancos[0].id : '';
    setReceb({ ...receb, [parcelaId]: { formaPagamentoId: formaId, recebido: !!f && PAGO_NA_HORA.includes(f.tipo), contaFinanceiraId: banco, creditoPagador: receb[parcelaId]?.creditoPagador ?? 'CLIENTE' } });
  };
  const faltaCompra = registrarCompra === null || (registrarCompra === 'sim' && (compraPaga === null || (compraPaga === 'sim' && !contaCompra)));
  const opcoesContas = opcoesDe(contasFin);
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`Finalizar venda nº ${numero}`}
      tamanho="lg"
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>
            {pode ? 'Não' : 'Fechar'}
          </Button>
          {pode && (
            <Button variante="sucesso" icone={<CheckCircle2 className="h-4 w-4" />} carregando={finalizar.isPending} disabled={faltaBanco || faltaCompra} onClick={() => finalizar.mutate()}>
              Sim, finalizar
            </Button>
          )}
        </>
      }
    >
      {isLoading && <p className="text-sm text-slate-500">Conferindo a venda…</p>}
      {error && <p className="text-sm text-red-600">{mensagemErro(error)}</p>}
      {c && c.jaFinalizada && <p className="text-sm text-emerald-700">Esta venda já está finalizada ({c.situacaoAtual.nome}).</p>}
      {c && !c.jaFinalizada && !c.podeFinalizar && <ListaPendencias pendencias={c.pendencias} vendaId={vendaId} contatoId={c.contatoId} onNavegar={onFechar} />}
      {c && pode && (
        <div className="space-y-5">
          <p className="text-sm text-slate-700">
            Deseja finalizar a venda nº <b>{numero}</b>? Ela sai de <b>{c.situacaoAtual.nome}</b> e vai para <b>{c.destino.nome}</b>: o estoque é baixado e o financeiro já fica resolvido.
          </p>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">1. Recebimento da venda</h3>
            <p className="mb-2 text-xs text-slate-500">Escolha a forma de pagamento e depois onde o dinheiro entrou.</p>
            <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {c.parcelas.map((p) => {
                const r = receb[p.id] ?? { formaPagamentoId: '', recebido: false, contaFinanceiraId: '' };
                const bancos = bancosDa(r.formaPagamentoId);
                const credito = ehCredito(r.formaPagamentoId);
                return (
                  <div key={p.id} className="space-y-2 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <b className="num">{moeda(p.valor)}</b>
                        {c.parcelas.length > 1 && <span className="text-slate-500"> · parcela {p.numero}</span>}
                      </span>
                      {!credito && (
                        <label className="flex items-center gap-2 text-slate-700">
                          <input type="checkbox" className="h-4 w-4" checked={r.recebido} onChange={(e) => setReceb({ ...receb, [p.id]: { ...r, recebido: e.target.checked } })} />
                          Já recebido
                        </label>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Select aria-label="Forma de pagamento" label="Forma de pagamento" value={r.formaPagamentoId} onChange={(e) => trocarForma(p.id, e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(c.formas)} placeholder="Escolha…" />
                      {credito ? (
                        <div>
                          <span className="mb-1 block text-xs font-medium text-slate-600">Quem paga o crédito bancário?</span>
                          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
                            {(['CLIENTE', 'LOJA'] as const).map((v) => (
                              <button key={v} type="button" onClick={() => setReceb({ ...receb, [p.id]: { ...r, creditoPagador: v } })} className={(r.creditoPagador ?? 'CLIENTE') === v ? 'bg-brand-600 px-3 py-1.5 font-medium text-white' : 'bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50'}>
                                {v === 'CLIENTE' ? 'O cliente' : 'A loja'}
                              </button>
                            ))}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {(r.creditoPagador ?? 'CLIENTE') === 'CLIENTE' ? 'O cliente paga o boleto direto ao credor.' : 'O cliente paga a loja e a loja repassa ao credor.'} O valor entra no banco da forma e a devolução + juros vai para o contas a pagar.
                          </p>
                        </div>
                      ) : r.recebido ? (
                        <div>
                          <span className="mb-1 block text-xs font-medium text-slate-600">Onde o dinheiro entrou</span>
                          <div className="flex flex-wrap gap-1.5">
                            {bancos.map((b) => (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => setReceb({ ...receb, [p.id]: { ...r, contaFinanceiraId: b.id } })}
                                className={r.contaFinanceiraId === b.id ? 'rounded-md border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white' : 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50'}
                              >
                                {b.nome}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="self-end pb-2 text-xs text-slate-500">Fica no contas a receber.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">2. Compra da mercadoria</h3>
            {c.compraRegistrada ? (
              <p className="text-sm text-emerald-700">Compra nº {c.compraRegistrada.numero} ({moeda(c.compraRegistrada.total)}) já registrada para esta venda.</p>
            ) : !(c.custoProdutos > 0) ? (
              <p className="text-sm text-slate-500">Sem custo informado nos produtos.</p>
            ) : (
              <div className="space-y-3 rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-slate-700">
                    Deseja finalizar a <b>compra</b> desta mercadoria (custo <b className="num">{moeda(c.custoProdutos)}</b>)?
                  </span>
                  <SimNao valor={registrarCompra} onChange={setRegistrarCompra} />
                </div>
                {registrarCompra === 'nao' && <p className="text-xs text-slate-500">Nenhuma compra será lançada (a mercadoria já estava no estoque ou a compra já foi lançada).</p>}
                {registrarCompra === 'sim' && (
                  <>
                    <SearchSelect
                      label="Fornecedor (opcional)"
                      valor={fornecedorId}
                      rotuloAtual={fornecedorNome}
                      buscar={(t) => buscarContatos(t, 'FORNECEDOR')}
                      onChange={(v, op) => {
                        setFornecedorId((v as number) ?? null);
                        setFornecedorNome(op?.rotulo ?? null);
                      }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-slate-700">A compra já está paga?</span>
                      <div className="inline-flex overflow-hidden rounded-md border border-slate-300 text-sm">
                        {([['sim', 'Sim'], ['nao', 'Não'], ...(temFormaCredito ? [['credito', 'Crédito bancário']] : [])] as [EscolhaCompra, string][]).map(([v, rot]) => (
                          <button key={v} type="button" onClick={() => setCompraPaga(v)} className={compraPaga === v ? 'bg-brand-600 px-3 py-1.5 font-medium text-white' : 'bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50'}>
                            {rot}
                          </button>
                        ))}
                      </div>
                    </div>
                    {compraPaga === 'credito' && <p className="text-xs text-slate-500">O credor paga o fornecedor e a devolução + juros vai para o contas a pagar (Financeiro › Empréstimos).</p>}
                    {compraPaga === 'sim' && <Select label="Banco de onde saiu o pagamento" value={contaCompra} onChange={(e) => setContaCompra(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesContas} placeholder="—" />}
                    {compraPaga === 'nao' && <DateInput label="Vencimento do pagamento" value={vencCompra} onChange={setVencCompra} />}
                  </>
                )}
              </div>
            )}
          </section>

          <Textarea label="Observação (opcional)" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Fica no histórico da venda" />
          {(faltaBanco || faltaCompra) && <p className="text-xs text-amber-700">{faltaBanco ? 'Escolha a forma e o banco de cada parcela recebida. ' : ''}{faltaCompra ? 'Responda as perguntas da compra.' : ''}</p>}
        </div>
      )}
    </Modal>
  );
}
