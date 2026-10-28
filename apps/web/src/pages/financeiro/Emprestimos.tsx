import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Ban, BadgeDollarSign, CalendarClock, HandCoins, Landmark, Pencil, Plus, Repeat2, Send, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { buscarContatos } from '@/lib/buscas';
import { useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, DateInput, Drawer, EmptyState, Input, Modal, MoneyInput, PageHeader, PeriodoFiltro, SearchSelect, Segmentado, Select, SelectFiltro, StatCard, Table, Textarea, type Coluna } from '@/components/ui';
import { data, hoje, moeda, numero } from '@/lib/format';

type Modalidade = 'REPASSE' | 'DIRETO' | 'CAPITAL_GIRO';
type Status = 'ABERTO' | 'VENCIDO' | 'QUITADO' | 'CANCELADO';

interface Parcela { id: number; descricao: string; valor: number; valorPago: number; juros: number; desconto: number; situacao: string; vencimento: string; dataPagamento: string | null; parcela: string | null }
interface Emprestimo {
  id: number;
  numero: number;
  codigo: string | null;
  descricao: string | null;
  modalidade: Modalidade;
  credor: { id: number; nome: string };
  cliente: { id: number; nome: string } | null;
  venda: { id: number; numero: number } | null;
  compra?: { id: number; numero: number; fornecedor?: { id: number; nome: string } | null } | null;
  vendaParcelaId?: number | null;
  compraParcelaId?: number | null;
  contaReceberClienteId: number | null;
  dataOperacao: string;
  valorRecebido: number;
  taxaPct: number;
  juros: number;
  valorDevolver: number;
  prazoDias: number;
  vencimento: string;
  parcelas: number;
  importado: boolean;
  jurosEstimado: boolean;
  observacoes: string | null;
  contaFinanceira?: { id: number; nome: string } | null;
  contasPagar: Parcela[];
  status: Status;
  pago: number;
  saldoDevedor: number;
  proximoVencimento: string | null;
  diasParaVencer: number | null;
  boleto: { id: number; valor: number; saldo: number; situacao: string; vencimento: string; dataRecebimento: string | null; atrasado: boolean } | null;
  alerta: { tom: 'vermelho' | 'amarelo' | 'verde' | 'azul'; texto: string } | null;
}
interface Resposta { data: Emprestimo[]; totais: { emAberto: number; qtdEmAberto: number; vencido: number; vence7dias: number; repassar: number; recebido: number; juros: number; pago: number } }

const MODALIDADES: { valor: Modalidade; rotulo: string; explica: string }[] = [
  { valor: 'REPASSE', rotulo: 'Cliente paga a loja', explica: 'O cliente paga o boleto para a loja e a loja repassa o valor + taxa ao credor.' },
  { valor: 'DIRETO', rotulo: 'Cliente paga o credor', explica: 'O cliente paga o boleto direto ao credor. A loja paga só a diferença (a taxa).' },
  { valor: 'CAPITAL_GIRO', rotulo: 'Capital de giro', explica: 'Dinheiro para a loja, sem boleto de cliente. A loja devolve tudo, em 1 ou mais parcelas.' },
];
const nomeModalidade = (m: Modalidade) => MODALIDADES.find((x) => x.valor === m)?.rotulo ?? m;
const tomStatus = (s: Status) => (s === 'QUITADO' ? 'verde' : s === 'VENCIDO' ? 'vermelho' : s === 'CANCELADO' ? 'cinza' : 'azul');
const nomeStatus = (s: Status) => ({ ABERTO: 'Em aberto', VENCIDO: 'Vencido', QUITADO: 'Quitado', CANCELADO: 'Cancelado' })[s];
const somaDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Financeiro › Empréstimos: antecipação de boletos (Lumicred) e capital de giro */
export default function Emprestimos() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? 'EM_ABERTO';
  const filtros = { status: status === 'EM_ABERTO' || status === 'TODOS' ? undefined : status, modalidade: sp.get('modalidade') || undefined, pesquisa: sp.get('pesquisa') || undefined, dataInicial: sp.get('dataInicial') || undefined, dataFinal: sp.get('dataFinal') || undefined };
  const setFiltro = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const { data: resp, isLoading } = useQuery({ queryKey: ['emprestimos', filtros], queryFn: () => api.get<Resposta>('/financeiro/emprestimos', filtros), placeholderData: (p) => p });
  const lista = useMemo(() => (resp?.data ?? []).filter((e) => (status === 'EM_ABERTO' ? e.status === 'ABERTO' || e.status === 'VENCIDO' : true)), [resp, status]);
  const [novo, setNovo] = useState(false);
  const [abertoId, setAbertoId] = useState<number | null>(null);
  const t = resp?.totais;

  const colunas: Coluna<Emprestimo>[] = [
    { chave: 'num', titulo: 'Operação', noCartao: 'titulo', render: (e) => <div><p className="font-medium text-slate-900">Nº {e.numero}{e.codigo ? ` · ${e.codigo}` : ''}</p><p className="text-xs text-slate-400">{data(e.dataOperacao)} · {e.credor.nome.split(' ')[0]}</p></div> },
    { chave: 'cli', titulo: 'Cliente / descrição', render: (e) => <div className="max-w-[260px]"><p className="truncate text-slate-700">{e.cliente?.nome ?? (e.compra ? `Compra: ${e.compra.fornecedor?.nome ?? 'fornecedor'}` : e.modalidade === 'CAPITAL_GIRO' ? 'Capital de giro' : '—')}</p><p className="truncate text-xs text-slate-400">{e.venda ? `Venda nº ${e.venda.numero}` : e.compra ? `Compra nº ${e.compra.numero}` : e.descricao ?? ''}</p></div> },
    { chave: 'mod', titulo: 'Cenário', ocultarMobile: true, render: (e) => <Badge tom={e.modalidade === 'DIRETO' ? 'roxo' : e.modalidade === 'REPASSE' ? 'azul' : 'cinza'}>{nomeModalidade(e.modalidade)}</Badge> },
    { chave: 'rec', titulo: 'Recebido', direita: true, ocultarMobile: true, render: (e) => moeda(e.valorRecebido) },
    { chave: 'dev', titulo: 'A devolver', direita: true, render: (e) => <div><p>{moeda(e.valorDevolver)}</p><p className="text-[11px] text-slate-400">juros {moeda(e.juros)}{e.jurosEstimado ? ' (est.)' : ''}</p></div> },
    { chave: 'saldo', titulo: 'Saldo', direita: true, render: (e) => <span className={e.saldoDevedor > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}>{moeda(e.saldoDevedor)}</span> },
    { chave: 'venc', titulo: 'Vence', render: (e) => (e.proximoVencimento ? <span className={e.status === 'VENCIDO' ? 'font-medium text-red-600' : ''}>{data(e.proximoVencimento)}</span> : '—') },
    { chave: 'st', titulo: 'Situação', render: (e) => <div className="space-y-1"><Badge tom={tomStatus(e.status)}>{nomeStatus(e.status)}</Badge>{e.alerta && <p className={`max-w-[240px] text-[11px] leading-snug ${e.alerta.tom === 'vermelho' ? 'text-red-600' : e.alerta.tom === 'amarelo' ? 'text-amber-700' : 'text-sky-700'}`}>{e.alerta.texto}</p>}</div> },
  ];

  return (
    <div>
      <PageHeader titulo="Empréstimos" descricao="Antecipação de boletos (Lumicred) e capital de giro: o que entrou, o que falta devolver e quando." acoes={<Button icone={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>Nova operação</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard rotulo="Em aberto" valor={moeda(t?.emAberto)} sub={t ? `${t.qtdEmAberto} operaç${t.qtdEmAberto === 1 ? 'ão' : 'ões'}` : undefined} tom="azul" carregando={isLoading && !t} icone={<Landmark className="h-4 w-4" />} />
        <StatCard rotulo="Vencido" valor={moeda(t?.vencido)} tom={t?.vencido ? 'vermelho' : 'neutro'} carregando={isLoading && !t} icone={<AlertTriangle className="h-4 w-4" />} onClick={() => setFiltro('status', 'VENCIDO')} />
        <StatCard rotulo="Vence em 7 dias" valor={moeda(t?.vence7dias)} tom="amarelo" carregando={isLoading && !t} icone={<CalendarClock className="h-4 w-4" />} />
        <StatCard rotulo="Cliente pagou: repassar" valor={moeda(t?.repassar)} tom={t?.repassar ? 'amarelo' : 'neutro'} carregando={isLoading && !t} icone={<Send className="h-4 w-4" />} />
      </div>

      <Card semPadding>
        <BarraFiltros>
          <Segmentado opcoes={[{ valor: 'EM_ABERTO', rotulo: 'Em aberto' }, { valor: 'VENCIDO', rotulo: 'Vencidos' }, { valor: 'QUITADO', rotulo: 'Quitados' }, { valor: 'TODOS', rotulo: 'Todos' }]} valor={status} onMudar={(v) => setFiltro('status', v === 'EM_ABERTO' ? '' : v)} />
          <SelectFiltro valor={sp.get('modalidade') ?? ''} onChange={(v) => setFiltro('modalidade', v)} placeholder="Todos os cenários" opcoes={MODALIDADES.map((m) => ({ valor: m.valor, rotulo: m.rotulo }))} />
          <PeriodoFiltro inicial={sp.get('dataInicial') ?? ''} final={sp.get('dataFinal') ?? ''} onChange={(i, f) => { const n = new URLSearchParams(sp); if (i) n.set('dataInicial', i); else n.delete('dataInicial'); if (f) n.set('dataFinal', f); else n.delete('dataFinal'); setSp(n, { replace: true }); }} />
          <BuscaFiltro valor={sp.get('pesquisa') ?? ''} onChange={(v) => setFiltro('pesquisa', v)} placeholder="Nº, código (E-161), cliente…" />
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={lista}
          carregando={isLoading}
          chave={(e) => e.id}
          onClickLinha={(e) => setAbertoId(e.id)}
          destacar={(e) => !!e.alerta && e.alerta.tom !== 'azul'}
          vazio={<EmptyState icone={<HandCoins className="h-5 w-5" />} titulo="Nenhuma operação" descricao="Lance aqui cada antecipação: o valor que entrou, a taxa e quem paga o boleto." acao={<Button tamanho="sm" icone={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>Nova operação</Button>} />}
          compacta
        />
        {resp && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <span>Recebido no período: <b className="text-slate-700">{moeda(t?.recebido)}</b></span>
            <span>Juros: <b className="text-slate-700">{moeda(t?.juros)}</b></span>
            <span>Já devolvido: <b className="text-slate-700">{moeda(t?.pago)}</b></span>
          </div>
        )}
      </Card>

      <NovaOperacao aberto={novo} onFechar={() => setNovo(false)} onCriada={(id) => { setNovo(false); qc.invalidateQueries({ queryKey: ['emprestimos'] }); setAbertoId(id); }} />
      <Detalhe id={abertoId} onFechar={() => setAbertoId(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ nova operação
function NovaOperacao({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (id: number) => void }) {
  const { data: contasFin } = useContasFinanceiras();
  const vazio = { credorId: null as number | null, credorNome: null as string | null, modalidade: 'REPASSE' as Modalidade, clienteId: null as number | null, clienteNome: null as string | null, contaReceberClienteId: '' as number | '', valorRecebido: 0, taxaPct: 6, prazoDias: 30, parcelas: 1, dataOperacao: hoje(), contaFinanceiraId: '' as number | '', codigo: '', descricao: '', observacoes: '' };
  const [f, setF] = useState(vazio);
  const set = <K extends keyof typeof vazio>(k: K, v: (typeof vazio)[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!aberto) return;
    setF(vazio);
    // credor padrão: Lumicred
    buscarContatos('lumicred').then((l) => l[0] && setF((x) => (x.credorId ? x : { ...x, credorId: l[0].id, credorNome: l[0].rotulo }))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  useEffect(() => {
    if (contasFin?.length && f.contaFinanceiraId === '' && aberto) set('contaFinanceiraId', contasFin.find((c) => c.tipo === 'BANCO' && c.saldoAtual > 0)?.id ?? contasFin.find((c) => c.padrao)?.id ?? contasFin[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contasFin, aberto]);

  const { data: boletos } = useQuery({
    queryKey: ['boletos-cliente', f.clienteId],
    enabled: !!f.clienteId && f.modalidade !== 'CAPITAL_GIRO',
    queryFn: async () => {
      const r: any = await api.get('/contas-receber', { contatoId: f.clienteId!, limite: 50 });
      return ((Array.isArray(r) ? r : r.data) as any[]).filter((c) => ['ABERTO', 'PARCIAL'].includes(c.situacao) && c.origemTipo !== 'EMPRESTIMO');
    },
  });
  // escolheu o boleto: o valor recebido costuma ser o valor do boleto
  useEffect(() => {
    const b = boletos?.find((x) => x.id === f.contaReceberClienteId);
    if (b && !f.valorRecebido) set('valorRecebido', b.valor - (b.valorRecebido || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.contaReceberClienteId]);

  const juros = Math.round(f.valorRecebido * f.taxaPct) / 100;
  const devolver = f.valorRecebido + juros;
  const venc = somaDias(f.dataOperacao || hoje(), f.prazoDias || 0);
  const mod = MODALIDADES.find((m) => m.valor === f.modalidade)!;

  const criar = useMutation({
    mutationFn: () =>
      api.post<Emprestimo>('/financeiro/emprestimos', {
        credorId: f.credorId,
        modalidade: f.modalidade,
        clienteId: f.modalidade === 'CAPITAL_GIRO' ? null : f.clienteId,
        contaReceberClienteId: f.modalidade === 'CAPITAL_GIRO' || f.contaReceberClienteId === '' ? null : f.contaReceberClienteId,
        valorRecebido: f.valorRecebido,
        taxaPct: f.taxaPct,
        prazoDias: f.prazoDias,
        parcelas: f.modalidade === 'CAPITAL_GIRO' ? f.parcelas : 1,
        dataOperacao: f.dataOperacao,
        contaFinanceiraId: f.contaFinanceiraId === '' ? null : f.contaFinanceiraId,
        codigo: f.codigo || null,
        descricao: f.descricao || null,
        observacoes: f.observacoes || null,
      }),
    onSuccess: (e) => {
      toast.success(`Operação nº ${e.numero} lançada: ${moeda(e.valorDevolver)} no contas a pagar.`);
      onCriada(e.id);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Nova operação de empréstimo"
      tamanho="lg"
      rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button carregando={criar.isPending} disabled={!f.credorId || !(f.valorRecebido > 0)} onClick={() => criar.mutate()}>Lançar operação</Button></>}
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Quem paga o boleto?</p>
          <Segmentado opcoes={MODALIDADES.map((m) => ({ valor: m.valor, rotulo: m.rotulo }))} valor={f.modalidade} onMudar={(v) => set('modalidade', v)} />
          <p className="mt-1.5 text-xs text-slate-500">{mod.explica}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SearchSelect label="Credor" obrigatorio valor={f.credorId} rotuloAtual={f.credorNome} buscar={(t) => buscarContatos(t)} onChange={(id, op) => setF((x) => ({ ...x, credorId: id, credorNome: op?.rotulo ?? null }))} />
          <Input label="Código da operação" placeholder="ex.: E-230" value={f.codigo} onChange={(e) => set('codigo', e.target.value)} />
        </div>
        {f.modalidade !== 'CAPITAL_GIRO' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <SearchSelect label="Cliente que comprou no boleto" valor={f.clienteId} rotuloAtual={f.clienteNome} buscar={(t) => buscarContatos(t, 'CLIENTE')} onChange={(id, op) => setF((x) => ({ ...x, clienteId: id, clienteNome: op?.rotulo ?? null, contaReceberClienteId: '' }))} />
            <Select
              label="Boleto do cliente (conta a receber)"
              obrigatorio={f.modalidade === 'DIRETO'}
              value={f.contaReceberClienteId}
              onChange={(e) => set('contaReceberClienteId', e.target.value ? Number(e.target.value) : '')}
              placeholder={!f.clienteId ? 'Escolha o cliente primeiro' : boletos?.length ? 'Escolha o boleto' : 'Nenhum boleto em aberto'}
              opcoes={(boletos ?? []).map((b) => ({ valor: b.id, rotulo: `${moeda(b.valor)} · vence ${data(b.vencimento)} · ${b.descricao}`.slice(0, 90) }))}
              ajuda={f.modalidade === 'DIRETO' ? 'Quando o cliente pagar o credor, você baixa este boleto aqui mesmo.' : 'Serve para o sistema avisar quando o cliente pagar e você precisar repassar.'}
            />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <MoneyInput label="Valor recebido" obrigatorio value={f.valorRecebido} onChange={(v) => set('valorRecebido', v)} />
          <MoneyInput label="Taxa (%)" prefixo="" value={f.taxaPct} onChange={(v) => set('taxaPct', v)} />
          <Input label="Prazo (dias)" type="number" min={0} value={f.prazoDias} onChange={(e) => set('prazoDias', Number(e.target.value) || 0)} />
          {f.modalidade === 'CAPITAL_GIRO' ? <Input label="Parcelas mensais" type="number" min={1} max={120} value={f.parcelas} onChange={(e) => set('parcelas', Math.max(1, Number(e.target.value) || 1))} /> : <DateInput label="Data da operação" value={f.dataOperacao} onChange={(v) => set('dataOperacao', v)} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {f.modalidade === 'CAPITAL_GIRO' && <DateInput label="Data da operação" value={f.dataOperacao} onChange={(v) => set('dataOperacao', v)} />}
          <Select label="Conta onde o dinheiro entrou" value={f.contaFinanceiraId} onChange={(e) => set('contaFinanceiraId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="Ainda não entrou (lançar só a dívida)" />
          <Input label="Descrição" placeholder="ex.: Notebook Gran Vic" value={f.descricao} onChange={(e) => set('descricao', e.target.value)} />
        </div>
        <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-sm text-slate-700">
          Você recebe <b>{moeda(f.valorRecebido)}</b> e devolve <b>{moeda(devolver)}</b>
          {f.modalidade === 'CAPITAL_GIRO' && f.parcelas > 1 ? <> em <b>{f.parcelas}x de {moeda(devolver / f.parcelas)}</b>, a primeira em <b>{data(venc)}</b></> : <> até <b>{data(venc)}</b></>}
          {' '}(juros de {moeda(juros)}).{' '}
          {f.modalidade === 'DIRETO' && <>Se o cliente pagar o credor, você paga só <b>{moeda(juros)}</b>.</>}
          <p className="mt-1 text-xs text-slate-500">No DRE entram só os juros, como despesa financeira. O valor recebido não é receita de venda.</p>
        </div>
        <Textarea label="Observações" rows={2} value={f.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ detalhe
function Detalhe({ id, onFechar }: { id: number | null; onFechar: () => void }) {
  const qc = useQueryClient();
  const { data: contasFin } = useContasFinanceiras();
  const { data: e, isLoading } = useQuery({ queryKey: ['emprestimo', id], enabled: !!id, queryFn: () => api.get<Emprestimo>(`/financeiro/emprestimos/${id}`) });
  const [acao, setAcao] = useState<null | 'pagar' | 'direto' | 'corrigir' | 'condicoes'>(null);
  const [cond, setCond] = useState({ taxaPct: 6, prazoDias: 30, parcelas: 1 });
  const [valor, setValor] = useState(0);
  const [dataAcao, setDataAcao] = useState(hoje());
  const [conta, setConta] = useState<number | ''>('');
  useEffect(() => {
    if (contasFin?.length && conta === '') setConta(contasFin.find((c) => c.padrao)?.id ?? contasFin[0].id);
  }, [contasFin, conta]);

  const atualizar = (novo: Emprestimo, msg: string) => {
    toast.success(msg);
    qc.setQueryData(['emprestimo', id], novo);
    qc.invalidateQueries({ queryKey: ['emprestimos'] });
    qc.invalidateQueries({ queryKey: ['/contas-pagar'] });
    setAcao(null);
  };
  const pagar = useMutation({ mutationFn: () => api.post<Emprestimo>(`/financeiro/emprestimos/${id}/pagar`, { valor, data: dataAcao, contaFinanceiraId: conta }), onSuccess: (n) => atualizar(n, n.status === 'QUITADO' ? 'Operação quitada.' : 'Pagamento lançado.'), onError: (er) => toast.error(mensagemErro(er)) });
  const direto = useMutation({ mutationFn: () => api.post<Emprestimo>(`/financeiro/emprestimos/${id}/cliente-pagou-direto`, { valor, data: dataAcao }), onSuccess: (n) => atualizar(n, `Boleto do cliente baixado. Falta devolver ${moeda(n.saldoDevedor)}.`), onError: (er) => toast.error(mensagemErro(er)) });
  const corrigir = useMutation({ mutationFn: () => api.put<Emprestimo>(`/financeiro/emprestimos/${id}`, { valorRecebido: valor }), onSuccess: (n) => atualizar(n, `Valor corrigido: juros de ${moeda(n.juros)}.`), onError: (er) => toast.error(mensagemErro(er)) });
  const condicoes = useMutation({ mutationFn: () => api.put<Emprestimo>(`/financeiro/emprestimos/${id}`, cond), onSuccess: (n) => atualizar(n, `Condições alteradas: devolver ${moeda(n.valorDevolver)}.`), onError: (er) => toast.error(mensagemErro(er)) });
  const cancelar = useMutation({ mutationFn: () => api.post<Emprestimo>(`/financeiro/emprestimos/${id}/cancelar`, {}), onSuccess: (n) => atualizar(n, 'Operação cancelada.'), onError: (er) => toast.error(mensagemErro(er)) });

  const ativo = e && (e.status === 'ABERTO' || e.status === 'VENCIDO');
  const podeDireto = ativo && e.boleto && e.boleto.saldo > 0;
  const abrir = (a: 'pagar' | 'direto' | 'corrigir' | 'condicoes') => {
    if (!e) return;
    if (a === 'condicoes') setCond({ taxaPct: e.taxaPct, prazoDias: e.prazoDias, parcelas: e.parcelas });
    setDataAcao(hoje());
    setValor(a === 'pagar' ? e.saldoDevedor : a === 'direto' ? Math.min(e.boleto?.saldo ?? 0, e.saldoDevedor) : e.valorRecebido);
    setAcao(a);
  };

  return (
    <Drawer aberto={!!id} onFechar={onFechar} titulo={e ? `Empréstimo nº ${e.numero}${e.codigo ? ` · ${e.codigo}` : ''}` : 'Empréstimo'} descricao={e ? `${e.credor.nome} · ${nomeModalidade(e.modalidade)}` : undefined} largura="max-w-2xl">
      {isLoading || !e ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tom={tomStatus(e.status)}>{nomeStatus(e.status)}</Badge>
            {e.importado && <Badge tom="cinza">Importado do histórico</Badge>}
            {e.jurosEstimado && <Badge tom="amarelo">Juros estimados em {numero(e.taxaPct, 1)}%</Badge>}
          </div>
          {e.alerta && <div className={`rounded-lg p-3 text-sm ${e.alerta.tom === 'vermelho' ? 'bg-red-50 text-red-700' : e.alerta.tom === 'amarelo' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{e.alerta.texto}</div>}
          {e.jurosEstimado && (
            <p className="text-xs text-slate-500">Esta operação veio do histórico (Bling) sem o valor que a Lumicred depositou. Os juros foram calculados em {numero(e.taxaPct, 1)}%. Se souber o valor certo, use “Corrigir valor recebido”.</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Info rotulo="Recebido" valor={moeda(e.valorRecebido)} sub={data(e.dataOperacao)} />
            <Info rotulo="Juros" valor={moeda(e.juros)} sub={`${numero(e.taxaPct, 2)}%`} />
            <Info rotulo="Já devolvido" valor={moeda(e.pago)} />
            <Info rotulo="Saldo devedor" valor={moeda(e.saldoDevedor)} destaque={e.saldoDevedor > 0} sub={e.proximoVencimento ? `vence ${data(e.proximoVencimento)}` : undefined} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Card titulo="Cliente e boleto" className="!shadow-none">
              {e.modalidade === 'CAPITAL_GIRO' && !e.boleto ? (
                <div className="space-y-1 text-sm text-slate-500">
                  <p>{e.compra ? 'Compra paga com crédito bancário: a loja devolve tudo.' : 'Capital de giro: sem boleto de cliente.'}</p>
                  {e.compra && <p><Link to={`/compras/${e.compra.id}`} className="text-brand-600 hover:underline">Compra nº {e.compra.numero}</Link>{e.compra.fornecedor ? ` · ${e.compra.fornecedor.nome}` : ''}</p>}
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  <p>{e.cliente ? <Link to={`/contatos/${e.cliente.id}`} className="text-brand-600 hover:underline">{e.cliente.nome}</Link> : '—'}</p>
                  {e.venda && <p><Link to={`/vendas/${e.venda.id}`} className="text-brand-600 hover:underline">Venda nº {e.venda.numero}</Link></p>}
                  {e.compra && <p><Link to={`/compras/${e.compra.id}`} className="text-brand-600 hover:underline">Compra nº {e.compra.numero}</Link>{e.compra.fornecedor ? ` · ${e.compra.fornecedor.nome}` : ''} (fornecedor pago com o crédito)</p>}
                  {e.boleto ? (
                    <p className="text-slate-600">Boleto de {moeda(e.boleto.valor)} · vence {data(e.boleto.vencimento)} · <span className={e.boleto.situacao === 'RECEBIDO' ? 'text-emerald-700' : e.boleto.atrasado ? 'text-red-600' : ''}>{e.boleto.situacao === 'RECEBIDO' ? `pago em ${data(e.boleto.dataRecebimento)}` : e.boleto.atrasado ? 'atrasado' : 'em aberto'}</span></p>
                  ) : (
                    <p className="text-amber-700">Sem boleto ligado{e.venda ? ' (a venda ainda não gerou a conta a receber)' : ''}.</p>
                  )}
                </div>
              )}
            </Card>
            <Card titulo="Onde entrou" className="!shadow-none">
              <p className="text-sm text-slate-600">{e.contaFinanceira?.nome ?? (e.importado ? 'Não registrado (histórico)' : 'Ainda não entrou')}</p>
              {e.descricao && <p className="mt-1 text-xs text-slate-400">{e.descricao}</p>}
              {e.observacoes && <p className="mt-1 whitespace-pre-line text-xs text-slate-400">{e.observacoes}</p>}
            </Card>
          </div>

          <Card titulo="Devolução ao credor" semPadding className="!shadow-none">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Parcela</th><th>Vence</th><th className="text-right">Valor</th><th className="text-right">Pago</th><th>Situação</th></tr></thead>
                <tbody>
                  {e.contasPagar.map((c) => (
                    <tr key={c.id}>
                      <td><Link to={`/financeiro/pagar?pesquisa=${encodeURIComponent(`nº ${e.numero}`)}`} className="text-brand-600 hover:underline">{c.parcela ?? '1/1'}</Link></td>
                      <td>{data(c.vencimento)}</td>
                      <td className="num text-right">{moeda(c.valor)}</td>
                      <td className="num text-right">{moeda(c.valorPago)}</td>
                      <td><Badge tom={c.situacao === 'PAGO' ? 'verde' : c.situacao === 'CANCELADO' ? 'cinza' : c.situacao === 'PARCIAL' ? 'amarelo' : 'azul'}>{c.situacao === 'PAGO' ? 'Pago' : c.situacao === 'PARCIAL' ? 'Parcial' : c.situacao === 'CANCELADO' ? 'Cancelado' : 'Em aberto'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {e.status !== 'CANCELADO' && (
            <div className="flex flex-wrap gap-2">
              {ativo && <Button variante="sucesso" icone={<BadgeDollarSign className="h-4 w-4" />} onClick={() => abrir('pagar')}>Pagar o credor</Button>}
              {podeDireto && <Button variante="secundario" icone={<Repeat2 className="h-4 w-4" />} onClick={() => abrir('direto')}>Cliente pagou direto ao credor</Button>}
              {e.pago === 0 && !e.importado && <Button variante="secundario" icone={<CalendarClock className="h-4 w-4" />} onClick={() => abrir('condicoes')}>Alterar taxa, prazo e parcelas</Button>}
              {!(e.vendaParcelaId || e.compraParcelaId) && <Button variante="secundario" icone={<Pencil className="h-4 w-4" />} onClick={() => abrir('corrigir')}>Corrigir valor recebido</Button>}
              {e.pago === 0 && <Button variante="perigo" icone={<Ban className="h-4 w-4" />} carregando={cancelar.isPending} onClick={() => { if (confirm('Cancelar esta operação? A entrada sai do caixa e a devolução é cancelada.')) cancelar.mutate(); }}>Cancelar</Button>}
            </div>
          )}
        </div>
      )}

      <Modal
        aberto={acao !== null}
        onFechar={() => setAcao(null)}
        titulo={acao === 'pagar' ? 'Pagar o credor' : acao === 'direto' ? 'Cliente pagou direto ao credor' : acao === 'condicoes' ? 'Alterar taxa, prazo e parcelas' : 'Corrigir valor recebido'}
        descricao={acao === 'direto' ? 'Baixa o boleto do cliente e abate o mesmo valor da dívida, sem mexer no banco.' : acao === 'corrigir' ? 'Os juros passam a ser o que foi devolvido menos o que entrou.' : undefined}
        rodape={
          <>
            <Button variante="secundario" onClick={() => setAcao(null)}>Voltar</Button>
            <Button
              variante="sucesso"
              carregando={pagar.isPending || direto.isPending || corrigir.isPending || condicoes.isPending}
              disabled={acao === 'condicoes' ? !(cond.parcelas >= 1) : !(valor > 0) || (acao === 'pagar' && !conta)}
              onClick={() => (acao === 'pagar' ? pagar.mutate() : acao === 'direto' ? direto.mutate() : acao === 'condicoes' ? condicoes.mutate() : corrigir.mutate())}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {acao === 'condicoes' && e ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <MoneyInput label="Taxa (%)" prefixo="" value={cond.taxaPct} onChange={(v) => setCond({ ...cond, taxaPct: v })} />
              <Input label="Prazo (dias)" type="number" min={0} value={cond.prazoDias} onChange={(ev) => setCond({ ...cond, prazoDias: Number(ev.target.value) || 0 })} />
              <Input label="Parcelas mensais" type="number" min={1} max={120} value={cond.parcelas} onChange={(ev) => setCond({ ...cond, parcelas: Math.max(1, Number(ev.target.value) || 1) })} />
            </div>
            <p className="text-sm text-slate-600">Recebido {moeda(e.valorRecebido)} → devolver <b>{moeda(e.valorRecebido * (1 + cond.taxaPct / 100))}</b>{cond.parcelas > 1 ? ` em ${cond.parcelas}x de ${moeda((e.valorRecebido * (1 + cond.taxaPct / 100)) / cond.parcelas)}` : ''}.</p>
          </div>
        ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput label={acao === 'corrigir' ? 'Valor que entrou de verdade' : 'Valor'} value={valor} onChange={setValor} />
          {acao !== 'corrigir' && <DateInput label="Data" value={dataAcao} onChange={setDataAcao} />}
          {acao === 'pagar' && <Select label="Sai de qual conta" value={conta} onChange={(ev) => setConta(ev.target.value ? Number(ev.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="—" />}
          {acao === 'corrigir' && e && <p className="self-end pb-2 text-sm text-slate-500"><Wallet className="mr-1 inline h-4 w-4" />Devolvido: {moeda(e.valorDevolver)} → juros {moeda(Math.max(0, e.valorDevolver - valor))}</p>}
        </div>
        )}
      </Modal>
    </Drawer>
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
