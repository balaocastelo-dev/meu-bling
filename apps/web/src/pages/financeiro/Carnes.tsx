/**
 * Financeiro › Carnês — carnê próprio pago por PIX (QR Code) na conta da loja (Cora).
 *   Carnês: lista com situação (em dia, atrasado, quitado), receber parcela (baixa no caixa/banco), imprimir.
 *   Auditoria de crédito: para quais clientes já dá para oferecer carnê — nota, classe A–E, juros (7% a 15%) e limite.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, BookOpen, CheckCircle2, Copy, Plus, Printer, RotateCcw, Settings2, ShieldCheck, Undo2, Wallet } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { buscarContatos } from '@/lib/buscas';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, DateInput, Drawer, EmptyState, Input, Modal, MoneyInput, PageHeader, SearchSelect, Segmentado, Select, StatCard, Table, Tabs, Textarea, type Coluna } from '@/components/ui';
import { data, hoje, moeda, numero } from '@/lib/format';
import { parcelaPrice } from '@/components/compartilhados/FinalizarVenda';

type Status = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';
type Classe = 'A' | 'B' | 'C' | 'D' | 'E';

interface ParcelaCarne {
  id: number;
  carneParcela: number;
  vencimento: string;
  valor: number;
  valorRecebido: number;
  juros: number;
  desconto: number;
  situacao: string;
  dataRecebimento: string | null;
  saldo: number;
  encargos: { dias: number; multa: number; mora: number; total: number };
  pix: string;
  lancamentos: { id: number; data: string; valor: number; contaFinanceira: { nome: string } }[];
}
interface CarneLinha {
  id: number;
  numero: number;
  cliente: { id: number; nome: string; celular?: string | null; telefone?: string | null };
  venda: { id: number; numero: number } | null;
  dataEmissao: string;
  valorFinanciado: number;
  taxaMensalPct: number;
  parcelas: number;
  valorParcela: number;
  total: number;
  juros: number;
  risco: Classe | null;
  score: number | null;
  situacao: string;
  status: Status;
  recebido: number;
  saldo: number;
  vencido: number;
  pagas: number;
  quantidade: number;
  maiorAtraso: number;
  proxima: { id: number; parcela: number; vencimento: string; valor: number } | null;
}
interface CarneCompleto extends CarneLinha {
  descricao: string | null;
  observacoes: string | null;
  primeiroVencimento: string;
  contaFinanceira: { id: number; nome: string } | null;
  cliente: CarneLinha['cliente'] & { documento?: string | null };
  parcelasLista: ParcelaCarne[];
  recebedor: { chave: string; nome: string; cidade: string };
  multaPct: number;
  moraMesPct: number;
}
interface Avaliacao {
  score: number;
  classe: Classe;
  taxaPct: number;
  apto: boolean;
  comRessalva: boolean;
  limite: number;
  disponivel: number;
  motivos: { texto: string; pontos: number }[];
  bloqueios: string[];
}
interface Historico { comprasTotal: number; compras24m: number; gasto24m: number; maiorCompra: number; ultimaCompra: string | null; atrasoAtualDias: number; valorEmAtraso: number; saldoCarnes: number; pagasEmDia: number; contasVencidas: number }
interface LinhaAuditoria extends Avaliacao { cliente: { id: number; nome: string; documento: string | null; telefone: string | null }; historico: Historico }
interface Auditoria { resumo: { clientes: number; aptos: number; comRessalva: number; naoAptos: number; porClasse: Record<Classe, number>; limiteTotalAptos: number; taxaMin: number; taxaMax: number }; data: LinhaAuditoria[]; total: number }
interface Config { pixChave: string; pixNome: string; pixCidade: string; taxaMinPct: number; taxaMaxPct: number; multaPct: number; moraMesPct: number }

const nomeStatus: Record<Status, string> = { EM_DIA: 'Em dia', ATRASADO: 'Atrasado', QUITADO: 'Quitado', CANCELADO: 'Cancelado' };
const tomStatus = (s: Status) => (s === 'QUITADO' ? 'verde' : s === 'ATRASADO' ? 'vermelho' : s === 'CANCELADO' ? 'cinza' : 'azul');
const COR_CLASSE: Record<Classe, string> = { A: 'bg-emerald-600', B: 'bg-lime-600', C: 'bg-amber-500', D: 'bg-orange-600', E: 'bg-red-600' };

export function SeloClasse({ classe, score, tamanho = 'md' }: { classe: Classe | null; score?: number | null; tamanho?: 'sm' | 'md' }) {
  if (!classe) return <span className="text-slate-400">—</span>;
  const t = tamanho === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';
  return (
    <span className={`inline-flex ${t} items-center justify-center rounded-full font-bold text-white ${COR_CLASSE[classe]}`} title={score != null ? `Nota ${score}/100` : undefined}>
      {classe}
    </span>
  );
}

export default function Carnes() {
  const [sp, setSp] = useSearchParams();
  const aba = sp.get('aba') ?? 'carnes';
  const [config, setConfig] = useState(false);
  const [novo, setNovo] = useState<{ clienteId: number; clienteNome: string } | true | null>(null);
  return (
    <div>
      <PageHeader
        titulo="Carnês"
        descricao="Carnê próprio: o cliente paga cada parcela por PIX (QR Code) direto no Cora. Juros pelo risco do cliente."
        acoes={
          <>
            <Button variante="secundario" icone={<Settings2 className="h-4 w-4" />} onClick={() => setConfig(true)}>PIX e juros</Button>
            <Button icone={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>Novo carnê</Button>
          </>
        }
      />
      <Tabs
        className="mb-4"
        abas={[{ id: 'carnes', rotulo: 'Carnês', icone: <BookOpen className="h-4 w-4" /> }, { id: 'auditoria', rotulo: 'Auditoria de crédito', icone: <ShieldCheck className="h-4 w-4" /> }]}
        ativa={aba}
        onMudar={(id) => setSp(id === 'carnes' ? {} : { aba: id }, { replace: true })}
      />
      {aba === 'auditoria' ? <AuditoriaCredito onEmitir={(id, nome) => setNovo({ clienteId: id, clienteNome: nome })} /> : <ListaCarnes />}
      <NovoCarne aberto={!!novo} inicial={novo && novo !== true ? novo : null} onFechar={() => setNovo(null)} />
      <ConfigCarne aberto={config} onFechar={() => setConfig(false)} />
    </div>
  );
}

// ------------------------------------------------------------------ lista
function ListaCarnes() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? 'ABERTOS';
  const pesquisa = sp.get('pesquisa') ?? '';
  const [abertoId, setAbertoId] = useState<number | null>(sp.get('id') ? Number(sp.get('id')) : null);
  const filtros = { status: ['EM_DIA', 'ATRASADO', 'QUITADO', 'CANCELADO'].includes(status) ? status : undefined, pesquisa: pesquisa || undefined };
  const { data: resp, isLoading } = useQuery({ queryKey: ['carnes', filtros], queryFn: () => api.get<{ data: CarneLinha[]; totais: { carnes: number; emAberto: number; vencido: number; recebido: number; jurosContratados: number; atrasados: number } }>('/financeiro/carnes', filtros), placeholderData: (p) => p });
  const lista = useMemo(() => (resp?.data ?? []).filter((c) => (status === 'ABERTOS' ? c.status === 'EM_DIA' || c.status === 'ATRASADO' : true)), [resp, status]);
  const t = resp?.totais;
  const setFiltro = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const colunas: Coluna<CarneLinha>[] = [
    { chave: 'num', titulo: 'Carnê', noCartao: 'titulo', render: (c) => <div><p className="font-medium text-slate-900">Nº {c.numero}</p><p className="text-xs text-slate-400">{data(c.dataEmissao)}{c.venda ? ` · venda ${c.venda.numero}` : ''}</p></div> },
    { chave: 'cli', titulo: 'Cliente', render: (c) => <div className="flex items-center gap-2"><SeloClasse classe={c.risco} score={c.score} tamanho="sm" /><span className="max-w-[220px] truncate">{c.cliente.nome}</span></div> },
    { chave: 'parc', titulo: 'Parcelas', render: (c) => <div><p>{c.pagas}/{c.quantidade} pagas</p><p className="text-[11px] text-slate-400">{c.quantidade}x {moeda(c.valorParcela)} · {numero(c.taxaMensalPct, 1)}% a.m.</p></div> },
    { chave: 'saldo', titulo: 'Em aberto', direita: true, render: (c) => <span className={c.saldo > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>{moeda(c.saldo)}</span> },
    { chave: 'prox', titulo: 'Próxima', render: (c) => (c.proxima ? <span className={c.status === 'ATRASADO' ? 'font-medium text-red-600' : ''}>{data(c.proxima.vencimento)} · {moeda(c.proxima.valor)}</span> : '—') },
    { chave: 'st', titulo: 'Situação', render: (c) => <div><Badge tom={tomStatus(c.status)}>{nomeStatus[c.status]}</Badge>{c.status === 'ATRASADO' && <p className="text-[11px] text-red-600">{c.maiorAtraso} dia(s) · {moeda(c.vencido)}</p>}</div> },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard rotulo="A receber" valor={moeda(t?.emAberto)} sub={t ? `${t.carnes} carnê(s)` : undefined} tom="azul" carregando={isLoading && !t} icone={<Wallet className="h-4 w-4" />} />
        <StatCard rotulo="Vencido" valor={moeda(t?.vencido)} sub={t ? `${t.atrasados} atrasado(s)` : undefined} tom={t?.vencido ? 'vermelho' : 'neutro'} carregando={isLoading && !t} icone={<AlertTriangle className="h-4 w-4" />} onClick={() => setFiltro('status', 'ATRASADO')} />
        <StatCard rotulo="Já recebido" valor={moeda(t?.recebido)} tom="verde" carregando={isLoading && !t} icone={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard rotulo="Juros contratados" valor={moeda(t?.jurosContratados)} carregando={isLoading && !t} />
      </div>
      <Card semPadding>
        <BarraFiltros>
          <Segmentado opcoes={[{ valor: 'ABERTOS', rotulo: 'Em aberto' }, { valor: 'ATRASADO', rotulo: 'Atrasados' }, { valor: 'QUITADO', rotulo: 'Quitados' }, { valor: 'CANCELADO', rotulo: 'Cancelados' }, { valor: 'TODOS', rotulo: 'Todos' }]} valor={status} onMudar={(v) => setFiltro('status', v === 'ABERTOS' ? '' : v)} />
          <BuscaFiltro valor={pesquisa} onChange={(v) => setFiltro('pesquisa', v)} placeholder="Cliente, nº do carnê ou da venda…" />
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={lista}
          carregando={isLoading}
          chave={(c) => c.id}
          onClickLinha={(c) => setAbertoId(c.id)}
          destacar={(c) => c.status === 'ATRASADO'}
          vazio={<EmptyState icone={<BookOpen className="h-5 w-5" />} titulo="Nenhum carnê" descricao="Venda na forma de pagamento “Carnê” ou emita um carnê avulso. Veja na Auditoria de crédito quem já pode receber oferta." />}
          compacta
        />
      </Card>
      <DetalheCarne id={abertoId} onFechar={() => setAbertoId(null)} />
    </>
  );
}

// ------------------------------------------------------------------ detalhe
function DetalheCarne({ id, onFechar }: { id: number | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const { data: contasFin } = useContasFinanceiras();
  const { data: c, isLoading } = useQuery({ queryKey: ['carne', id], enabled: !!id, queryFn: () => api.get<CarneCompleto>(`/financeiro/carnes/${id}`) });
  const [receber, setReceber] = useState<ParcelaCarne | null>(null);
  const [form, setForm] = useState({ data: hoje(), contaFinanceiraId: '' as number | '', juros: 0, desconto: 0 });
  const [alterar, setAlterar] = useState(false);
  const [cond, setCond] = useState({ taxaMensalPct: 0, parcelas: 1, primeiroVencimento: hoje() });

  const atualizar = (n: CarneCompleto, msg: string) => {
    toast.success(msg);
    qc.setQueryData(['carne', id], n);
    ['carnes', 'contas-receber', 'contas-financeiras', 'caixa', 'movimentos-fin', 'dashboard-geral'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const baixa = useMutation({
    mutationFn: () => api.post<CarneCompleto>(`/financeiro/carnes/${id}/parcelas/${receber!.id}/receber`, { data: form.data, contaFinanceiraId: form.contaFinanceiraId || null, juros: form.juros, desconto: form.desconto }),
    onSuccess: (n) => {
      atualizar(n, n.status === 'QUITADO' ? 'Parcela recebida: carnê quitado!' : 'Parcela recebida.');
      setReceber(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const estorno = useMutation({ mutationFn: (contaId: number) => api.post<CarneCompleto>(`/financeiro/carnes/${id}/parcelas/${contaId}/estornar`, {}), onSuccess: (n) => atualizar(n, 'Recebimento estornado.'), onError: (e) => toast.error(mensagemErro(e)) });
  const cancelar = useMutation({ mutationFn: () => api.post<CarneCompleto>(`/financeiro/carnes/${id}/cancelar`, {}), onSuccess: (n) => atualizar(n, 'Carnê cancelado.'), onError: (e) => toast.error(mensagemErro(e)) });
  const salvarCond = useMutation({
    mutationFn: () => api.put<CarneCompleto>(`/financeiro/carnes/${id}`, cond),
    onSuccess: (n) => {
      atualizar(n, `Carnê refeito: ${n.quantidade}x de ${moeda(n.valorParcela)}.`);
      setAlterar(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const abrirReceber = (p: ParcelaCarne) => {
    setForm({ data: hoje(), contaFinanceiraId: c?.contaFinanceira?.id ?? '', juros: p.encargos.total, desconto: 0 });
    setReceber(p);
  };
  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('PIX copia e cola copiado.'), () => toast.error('Não deu para copiar.'));
  const semPagamento = !!c && c.recebido === 0;
  const ativo = !!c && c.status !== 'CANCELADO';

  return (
    <Drawer aberto={!!id} onFechar={onFechar} titulo={c ? `Carnê nº ${c.numero}` : 'Carnê'} descricao={c ? `${c.cliente.nome}${c.venda ? ` · venda nº ${c.venda.numero}` : ''}` : undefined} largura="max-w-3xl">
      {isLoading || !c ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={tomStatus(c.status)}>{nomeStatus[c.status]}</Badge>
            {c.risco && <span className="inline-flex items-center gap-1.5 text-xs text-slate-600"><SeloClasse classe={c.risco} score={c.score} tamanho="sm" /> risco na emissão (nota {c.score})</span>}
            <span className="text-xs text-slate-500">PIX cai em {c.contaFinanceira?.nome ?? '—'}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info rotulo="Financiado" valor={moeda(c.valorFinanciado)} sub={`${numero(c.taxaMensalPct, 2)}% ao mês`} />
            <Info rotulo="Total" valor={moeda(c.total)} sub={`juros ${moeda(c.juros)}`} />
            <Info rotulo="Recebido" valor={moeda(c.recebido)} sub={`${c.pagas}/${c.quantidade} parcelas`} />
            <Info rotulo="Em aberto" valor={moeda(c.saldo)} destaque={c.saldo > 0} sub={c.vencido > 0 ? `vencido ${moeda(c.vencido)}` : undefined} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icone={<Printer className="h-4 w-4" />} onClick={() => abrirEmNovaAba(`/financeiro/carnes/${c.id}/imprimir`).catch((e) => toast.error(mensagemErro(e)))}>Imprimir carnê</Button>
            {c.pagas > 0 && c.status !== 'QUITADO' && <Button variante="secundario" icone={<Printer className="h-4 w-4" />} onClick={() => abrirEmNovaAba(`/financeiro/carnes/${c.id}/imprimir`, { abertas: 'true' }).catch((e) => toast.error(mensagemErro(e)))}>2ª via (só em aberto)</Button>}
            {ativo && semPagamento && <Button variante="secundario" icone={<RotateCcw className="h-4 w-4" />} onClick={() => { setCond({ taxaMensalPct: c.taxaMensalPct, parcelas: c.quantidade, primeiroVencimento: c.primeiroVencimento.slice(0, 10) }); setAlterar(true); }}>Alterar juros / parcelas</Button>}
            {ativo && semPagamento && <Button variante="perigo" carregando={cancelar.isPending} onClick={() => { if (confirm('Cancelar este carnê? As parcelas saem do contas a receber.')) cancelar.mutate(); }}>Cancelar carnê</Button>}
            {c.venda && <Link to={`/vendas/${c.venda.id}`} className="self-center text-sm text-brand-600 hover:underline">Abrir venda nº {c.venda.numero}</Link>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr><th className="px-3 py-2">Parcela</th><th className="px-3 py-2">Vencimento</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Ações</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.parcelasLista.map((p) => {
                  const paga = p.situacao === 'RECEBIDO';
                  return (
                    <tr key={p.id} className={!paga && p.encargos.dias > 0 ? 'bg-red-50/50' : ''}>
                      <td className="px-3 py-2 font-medium">{p.carneParcela}/{c.quantidade}</td>
                      <td className="px-3 py-2">{data(p.vencimento)}</td>
                      <td className="num px-3 py-2 text-right">{moeda(p.valor)}{p.encargos.total > 0 && !paga && <p className="text-[11px] text-red-600">+ {moeda(p.encargos.total)} atraso</p>}</td>
                      <td className="px-3 py-2">
                        {p.situacao === 'CANCELADO' ? <span className="text-slate-400">Cancelada</span> : paga ? <span className="text-emerald-700">Paga em {data(p.dataRecebimento)}{p.lancamentos[0] ? ` · ${p.lancamentos[0].contaFinanceira.nome}` : ''}</span> : p.encargos.dias > 0 ? <span className="text-red-600">{p.encargos.dias} dia(s) de atraso</span> : <span className="text-slate-500">Em aberto</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {!paga && ativo && <Button tamanho="sm" variante="sucesso" onClick={() => abrirReceber(p)}>Receber</Button>}
                          {!paga && ativo && <Button tamanho="sm" variante="secundario" icone={<Copy className="h-3.5 w-3.5" />} onClick={() => copiar(p.pix)} title="Copiar PIX copia e cola">PIX</Button>}
                          {(paga || p.valorRecebido > 0) && <Button tamanho="sm" variante="secundario" icone={<Undo2 className="h-3.5 w-3.5" />} carregando={estorno.isPending} onClick={() => { if (confirm('Estornar o recebimento desta parcela?')) estorno.mutate(p.id); }}>Estornar</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            PIX para {c.recebedor.nome} (chave {c.recebedor.chave}). Atraso: multa de {numero(c.multaPct, 1)}% + {numero(c.moraMesPct, 1)}% ao mês, sugeridos ao receber. Quando o PIX aparecer no extrato do Cora, a conciliação em Bancos também sugere a parcela.
          </p>
        </div>
      )}
      <Modal
        aberto={!!receber}
        onFechar={() => setReceber(null)}
        titulo={receber ? `Receber parcela ${receber.carneParcela}` : ''}
        descricao="Baixa no caixa ou banco onde o dinheiro entrou."
        rodape={<><Button variante="secundario" onClick={() => setReceber(null)}>Cancelar</Button><Button variante="sucesso" carregando={baixa.isPending} disabled={!form.contaFinanceiraId} onClick={() => baixa.mutate()}>Receber {receber ? moeda(receber.saldo + form.juros - form.desconto) : ''}</Button></>}
      >
        {receber && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <DateInput label="Data do pagamento" value={form.data} onChange={(v) => setForm({ ...form, data: v })} />
              <Select label="Onde entrou" obrigatorio value={form.contaFinanceiraId} onChange={(e) => setForm({ ...form, contaFinanceiraId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe(contasFin)} placeholder="Escolha…" ajuda="PIX → Cora · dinheiro no balcão → Caixa" />
              <MoneyInput label="Multa + juros de atraso" value={form.juros} onChange={(v) => setForm({ ...form, juros: v })} />
              <MoneyInput label="Desconto" value={form.desconto} onChange={(v) => setForm({ ...form, desconto: v })} />
            </div>
            {receber.encargos.dias > 0 && <p className="text-xs text-amber-800">Atrasada {receber.encargos.dias} dia(s): multa {moeda(receber.encargos.multa)} + mora {moeda(receber.encargos.mora)} (pode alterar ou zerar).</p>}
          </div>
        )}
      </Modal>
      <Modal
        aberto={alterar}
        onFechar={() => setAlterar(false)}
        titulo="Alterar juros / parcelas"
        descricao="Só sem parcela recebida. As parcelas são refeitas (reimprima o carnê)."
        rodape={<><Button variante="secundario" onClick={() => setAlterar(false)}>Cancelar</Button><Button carregando={salvarCond.isPending} onClick={() => salvarCond.mutate()}>Refazer parcelas</Button></>}
      >
        {c && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyInput label="Juros ao mês (%)" prefixo="" value={cond.taxaMensalPct} onChange={(v) => setCond({ ...cond, taxaMensalPct: v })} />
              <Input label="Parcelas" type="number" min={1} max={48} value={cond.parcelas} onChange={(e) => setCond({ ...cond, parcelas: Math.max(1, Number(e.target.value) || 1) })} />
              <DateInput label="1º vencimento" value={cond.primeiroVencimento} onChange={(v) => setCond({ ...cond, primeiroVencimento: v })} />
            </div>
            <p className="text-sm text-slate-700">{cond.parcelas}x de <b>{moeda(parcelaPrice(c.valorFinanciado, cond.taxaMensalPct, cond.parcelas))}</b></p>
          </div>
        )}
      </Modal>
    </Drawer>
  );
}

// ------------------------------------------------------------------ novo carnê
function NovoCarne({ aberto, inicial, onFechar }: { aberto: boolean; inicial: { clienteId: number; clienteNome: string } | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const somaMes = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  };
  const vazio = { clienteId: null as number | null, clienteNome: null as string | null, valor: 0, parcelas: 6, primeiroVencimento: somaMes(), taxa: null as number | null, descricao: '', observacoes: '' };
  const [f, setF] = useState(vazio);
  useEffect(() => {
    if (aberto) setF({ ...vazio, clienteId: inicial?.clienteId ?? null, clienteNome: inicial?.clienteNome ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  const { data: risco } = useQuery({ queryKey: ['carne-risco', f.clienteId], enabled: !!f.clienteId && aberto, queryFn: () => api.get<Avaliacao & { historico: Historico }>(`/financeiro/carnes/risco/${f.clienteId}`), retry: false });
  const taxa = f.taxa ?? risco?.taxaPct ?? 15;
  const parcela = parcelaPrice(f.valor, taxa, f.parcelas);
  const criar = useMutation({
    mutationFn: () => api.post<CarneCompleto>('/financeiro/carnes', { clienteId: f.clienteId, valorFinanciado: f.valor, parcelas: f.parcelas, primeiroVencimento: f.primeiroVencimento, taxaMensalPct: f.taxa, descricao: f.descricao || null, observacoes: f.observacoes || null }),
    onSuccess: (c) => {
      toast.success(`Carnê nº ${c.numero} emitido: ${c.quantidade}x de ${moeda(c.valorParcela)}.`, { action: { label: 'Imprimir', onClick: () => abrirEmNovaAba(`/financeiro/carnes/${c.id}/imprimir`).catch((e) => toast.error(mensagemErro(e))) }, duration: 20_000 });
      qc.invalidateQueries({ queryKey: ['carnes'] });
      qc.invalidateQueries({ queryKey: ['contas-receber'] });
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Novo carnê (avulso)"
      descricao="Para vender no carnê, use a forma de pagamento “Carnê” na venda. Aqui é para parcelar um valor fora de venda (ex.: saldo devedor)."
      tamanho="lg"
      rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button carregando={criar.isPending} disabled={!f.clienteId || !(f.valor > 0)} onClick={() => criar.mutate()}>Emitir carnê</Button></>}
    >
      <div className="space-y-4">
        <SearchSelect label="Cliente" obrigatorio valor={f.clienteId} rotuloAtual={f.clienteNome} buscar={(t) => buscarContatos(t, 'CLIENTE')} onChange={(id, op) => setF((x) => ({ ...x, clienteId: id as number | null, clienteNome: op?.rotulo ?? null, taxa: null }))} />
        {risco && (
          <div className={`flex items-start gap-3 rounded-lg p-3 text-sm ${risco.apto ? 'bg-emerald-50 text-emerald-900' : risco.comRessalva ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`}>
            <SeloClasse classe={risco.classe} score={risco.score} />
            <div className="flex-1">
              <p className="font-medium">Nota {risco.score}/100 · classe {risco.classe} · {numero(risco.taxaPct, 1)}% ao mês · limite disponível {moeda(risco.disponivel)}</p>
              <p className="text-xs">{risco.apto ? 'Apto ao carnê.' : risco.comRessalva ? 'Com ressalva: peça entrada ou valor menor.' : `Não recomendado${risco.bloqueios.length ? `: ${risco.bloqueios.join(' · ')}` : '.'}`}</p>
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <MoneyInput label="Valor financiado" obrigatorio value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
          <Input label="Parcelas" type="number" min={1} max={48} value={f.parcelas} onChange={(e) => setF({ ...f, parcelas: Math.max(1, Math.min(48, Number(e.target.value) || 1)) })} />
          <MoneyInput label="Juros ao mês (%)" prefixo="" value={taxa} onChange={(v) => setF({ ...f, taxa: v })} />
          <DateInput label="1º vencimento" value={f.primeiroVencimento} onChange={(v) => setF({ ...f, primeiroVencimento: v })} />
        </div>
        <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-sm text-slate-700">
          {f.parcelas}x de <b>{moeda(parcela)}</b> · total {moeda(parcela * f.parcelas)} · juros {moeda(parcela * f.parcelas - f.valor)}
          <p className="mt-1 text-xs text-slate-500">Cada parcela vira uma conta a receber com QR Code PIX. No DRE entram só os juros, como receita financeira.</p>
        </div>
        <Input label="Descrição" placeholder="ex.: acordo do saldo da venda 1234" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        <Textarea label="Observações" rows={2} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ auditoria
function AuditoriaCredito({ onEmitir }: { onEmitir: (id: number, nome: string) => void }) {
  const [filtro, setFiltro] = useState<'APTOS' | 'RESSALVA' | 'NAO' | 'TODOS'>('APTOS');
  const [pesquisa, setPesquisa] = useState('');
  const [aberto, setAberto] = useState<LinhaAuditoria | null>(null);
  const { data: a, isLoading } = useQuery({ queryKey: ['carnes-auditoria', filtro, pesquisa], queryFn: () => api.get<Auditoria>('/financeiro/carnes/auditoria', { filtro, pesquisa: pesquisa || undefined, limite: 1000 }), placeholderData: (p) => p });
  const r = a?.resumo;
  const colunas: Coluna<LinhaAuditoria>[] = [
    { chave: 'cl', titulo: 'Classe', render: (l) => <SeloClasse classe={l.classe} score={l.score} /> },
    { chave: 'cli', titulo: 'Cliente', noCartao: 'titulo', render: (l) => <div><p className="max-w-[240px] truncate font-medium text-slate-800">{l.cliente.nome}</p><p className="text-xs text-slate-400">nota {l.score}/100{l.cliente.telefone ? ` · ${l.cliente.telefone}` : ''}</p></div> },
    { chave: 'comp', titulo: 'Compras', ocultarMobile: true, render: (l) => <div><p>{l.historico.comprasTotal} ({l.historico.compras24m} em 24m)</p><p className="text-[11px] text-slate-400">{moeda(l.historico.gasto24m)} · maior {moeda(l.historico.maiorCompra)}</p></div> },
    { chave: 'tx', titulo: 'Juros', direita: true, render: (l) => `${numero(l.taxaPct, 1)}% a.m.` },
    { chave: 'lim', titulo: 'Limite disponível', direita: true, render: (l) => <span className={l.disponivel > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>{moeda(l.disponivel)}</span> },
    { chave: 'st', titulo: 'Oferecer?', render: (l) => (l.apto ? <Badge tom="verde">Sim</Badge> : l.comRessalva ? <Badge tom="amarelo">Com entrada</Badge> : <div><Badge tom="vermelho">Não</Badge>{l.bloqueios[0] && <p className="max-w-[200px] text-[11px] text-slate-500">{l.bloqueios[0]}</p>}</div>) },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard rotulo="Aptos ao carnê" valor={String(r?.aptos ?? '—')} sub={r ? `de ${r.clientes} clientes que já compraram` : undefined} tom="verde" carregando={isLoading && !r} onClick={() => setFiltro('APTOS')} />
        <StatCard rotulo="Com ressalva (entrada)" valor={String(r?.comRessalva ?? '—')} tom="amarelo" carregando={isLoading && !r} onClick={() => setFiltro('RESSALVA')} />
        <StatCard rotulo="Não oferecer" valor={String(r?.naoAptos ?? '—')} tom="vermelho" carregando={isLoading && !r} onClick={() => setFiltro('NAO')} />
        <StatCard rotulo="Crédito disponível (aptos)" valor={moeda(r?.limiteTotalAptos)} tom="azul" carregando={isLoading && !r} />
      </div>
      {r && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          {(['A', 'B', 'C', 'D', 'E'] as Classe[]).map((k, i) => (
            <span key={k} className="inline-flex items-center gap-1.5"><SeloClasse classe={k} tamanho="sm" /> {r.porClasse[k] ?? 0} · {numero(r.taxaMin + ((r.taxaMax - r.taxaMin) * i) / 4, 1)}% a.m.</span>
          ))}
          <span className="text-slate-400">A ≥ 80 · B ≥ 65 · C ≥ 50 · D ≥ 35 · E abaixo</span>
        </div>
      )}
      <Card semPadding>
        <BarraFiltros>
          <Segmentado opcoes={[{ valor: 'APTOS', rotulo: 'Aptos' }, { valor: 'RESSALVA', rotulo: 'Com ressalva' }, { valor: 'NAO', rotulo: 'Não aptos' }, { valor: 'TODOS', rotulo: 'Todos' }]} valor={filtro} onMudar={setFiltro} />
          <BuscaFiltro valor={pesquisa} onChange={setPesquisa} placeholder="Nome ou CPF/CNPJ…" />
        </BarraFiltros>
        <Table colunas={colunas} dados={a?.data ?? []} carregando={isLoading} chave={(l) => l.cliente.id} onClickLinha={setAberto} vazio={<EmptyState icone={<ShieldCheck className="h-5 w-5" />} titulo="Ninguém neste filtro" descricao="A nota vem das compras, do tempo de cliente, da pontualidade e de atrasos." />} compacta />
        {a && a.total > a.data.length && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Mostrando {a.data.length} de {a.total}. Use a busca para achar um cliente.</p>}
      </Card>
      <Drawer aberto={!!aberto} onFechar={() => setAberto(null)} titulo={aberto?.cliente.nome ?? ''} descricao={aberto ? `Nota ${aberto.score}/100 · classe ${aberto.classe}` : undefined}>
        {aberto && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <SeloClasse classe={aberto.classe} score={aberto.score} />
              <p>{aberto.apto ? 'Pode oferecer carnê' : aberto.comRessalva ? 'Oferecer só com entrada / valor menor' : 'Não oferecer carnê'} · juros sugeridos <b>{numero(aberto.taxaPct, 1)}% ao mês</b> · limite {moeda(aberto.limite)} (disponível {moeda(aberto.disponivel)})</p>
            </div>
            {aberto.bloqueios.length > 0 && <div className="rounded-lg bg-red-50 p-3 text-red-800">{aberto.bloqueios.map((b) => <p key={b}>• {b}</p>)}</div>}
            <div>
              <p className="mb-1 font-medium text-slate-700">Como a nota foi calculada</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {aberto.motivos.map((m) => (
                  <li key={m.texto} className="flex justify-between gap-3 px-3 py-1.5"><span>{m.texto}</span><span className={`num font-semibold ${m.pontos < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{m.pontos > 0 ? '+' : ''}{m.pontos}</span></li>
                ))}
                <li className="flex justify-between bg-slate-50 px-3 py-1.5 font-semibold"><span>Nota</span><span>{aberto.score}</span></li>
              </ul>
            </div>
            <div className="flex gap-2">
              <Link to={`/contatos/${aberto.cliente.id}`} className="self-center text-brand-600 hover:underline">Abrir cadastro</Link>
              {(aberto.apto || aberto.comRessalva) && <Button icone={<Plus className="h-4 w-4" />} onClick={() => { onEmitir(aberto.cliente.id, aberto.cliente.nome); setAberto(null); }}>Emitir carnê</Button>}
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

// ------------------------------------------------------------------ configuração
function ConfigCarne({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['carnes-config'], enabled: aberto, queryFn: () => api.get<Config>('/financeiro/carnes/config') });
  const [f, setF] = useState<Config | null>(null);
  useEffect(() => {
    if (data && aberto) setF(data);
  }, [data, aberto]);
  const salvar = useMutation({
    mutationFn: () => api.put<Config>('/financeiro/carnes/config', f),
    onSuccess: (n) => {
      qc.setQueryData(['carnes-config'], n);
      qc.invalidateQueries({ queryKey: ['carnes-auditoria'] });
      toast.success('Configuração do carnê salva.');
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="PIX e juros do carnê" rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button carregando={salvar.isPending} disabled={!f} onClick={() => salvar.mutate()}>Salvar</Button></>}>
      {f && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Chave PIX" value={f.pixChave} onChange={(e) => setF({ ...f, pixChave: e.target.value })} ajuda="CNPJ do Cora: 34397947000108" />
            <Input label="Nome do recebedor" value={f.pixNome} onChange={(e) => setF({ ...f, pixNome: e.target.value })} />
            <Input label="Cidade" value={f.pixCidade} onChange={(e) => setF({ ...f, pixCidade: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <MoneyInput label="Juros mínimos (% a.m.)" prefixo="" value={f.taxaMinPct} onChange={(v) => setF({ ...f, taxaMinPct: v })} />
            <MoneyInput label="Juros máximos (% a.m.)" prefixo="" value={f.taxaMaxPct} onChange={(v) => setF({ ...f, taxaMaxPct: v })} />
            <MoneyInput label="Multa atraso (%)" prefixo="" value={f.multaPct} onChange={(v) => setF({ ...f, multaPct: v })} />
            <MoneyInput label="Mora (% ao mês)" prefixo="" value={f.moraMesPct} onChange={(v) => setF({ ...f, moraMesPct: v })} />
          </div>
          <p className="text-xs text-slate-500">Classe A paga os juros mínimos e E os máximos, em degraus iguais. Carnês já emitidos não mudam.</p>
        </div>
      )}
    </Modal>
  );
}

function Info({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className={`num text-base font-semibold ${destaque ? 'text-slate-900' : 'text-slate-700'}`}>{valor}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
