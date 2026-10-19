import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CheckCheck, CircleDollarSign, Clock, Plus, TriangleAlert, Undo2, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useCategoriasFinanceiras, useContasFinanceiras, useFormasPagamento, useVendedores, opcoesDe } from '@/hooks/useListas';
import { buscarContatos } from '@/lib/buscas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, Checkbox, DateInput, EmptyState, Input, Modal, MoneyInput, PageHeader, Pagination, PeriodoFiltro, SearchSelect, Select, SelectFiltro, StatCard, Table, Textarea, tomPorStatus, type Coluna } from '@/components/ui';
import { data, diasAtraso, hoje, moeda, rotulo } from '@/lib/format';
import type { ContaPagar, ContaReceber, ContasResposta } from '@/types';

type Conta = ContaReceber | ContaPagar;

interface Props {
  tipo: 'receber' | 'pagar';
}

function valorPago(c: Conta): number {
  return 'valorRecebido' in c ? c.valorRecebido : c.valorPago;
}

function linkOrigem(c: Conta): string | null {
  const o = c.origem ?? (c.origemId ? { tipo: c.origemTipo, id: c.origemId } : null);
  if (!o) return null;
  switch (o.tipo) {
    case 'VENDA':
      return `/vendas/${o.id}`;
    case 'OS':
      return `/ordens-servico/${o.id}`;
    case 'COMPRA':
      return `/compras/${o.id}`;
    case 'NFE':
      return `/notas-fiscais/${o.id}`;
    case 'COMISSAO':
      return `/comissoes`;
    default:
      return null;
  }
}

/** Página genérica de contas a receber/pagar */
export function ContasPage({ tipo }: Props) {
  const ehReceber = tipo === 'receber';
  const base = ehReceber ? '/contas-receber' : '/contas-pagar';
  const qc = useQueryClient();
  const pg = usePaginacao();
  const { data: vendedores } = useVendedores();
  const { data: contasFin } = useContasFinanceiras();
  const { data: formas } = useFormasPagamento();
  const { data: categorias } = useCategoriasFinanceiras();

  const [sel, setSel] = useState<Set<number>>(new Set());
  const [baixa, setBaixa] = useState<Conta[] | null>(null);
  const [novo, setNovo] = useState(false);

  const params = { ...pg.filtros, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: [base, params], queryFn: () => api.get<ContasResposta<Conta>>(base, params), placeholderData: (p) => p });

  useEffect(() => setSel(new Set()), [resp]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: [base] });
    qc.invalidateQueries({ queryKey: ['financeiro-resumo'] });
    qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['dashboard-geral'] });
  };

  const estornar = useMutation({
    mutationFn: (id: number) => api.post(`${base}/${id}/estornar`),
    onSuccess: () => {
      toast.success('Baixa estornada.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const cancelar = useMutation({
    mutationFn: (id: number) => api.del(`${base}/${id}`),
    onSuccess: () => {
      toast.success('Conta cancelada.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const abertas = (resp?.data ?? []).filter((c) => c.situacao === 'ABERTO' || c.situacao === 'PARCIAL');
  const todasSel = abertas.length > 0 && abertas.every((c) => sel.has(c.id));
  const alternarTodas = () => setSel(todasSel ? new Set() : new Set(abertas.map((c) => c.id)));
  const totalSel = useMemo(() => (resp?.data ?? []).filter((c) => sel.has(c.id)).reduce((s, c) => s + (c.valor - valorPago(c)), 0), [sel, resp]);

  const colunas: Coluna<Conta>[] = [
    {
      chave: 'sel',
      titulo: <Checkbox checked={todasSel} onChange={alternarTodas} />,
      largura: '36px',
      render: (c) =>
        c.situacao === 'ABERTO' || c.situacao === 'PARCIAL' ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
          </span>
        ) : null,
    },
    {
      chave: 'vencimento',
      titulo: 'Vencimento',
      largura: '110px',
      render: (c) => {
        const atr = c.atrasada ?? ((c.situacao === 'ABERTO' || c.situacao === 'PARCIAL') && diasAtraso(c.vencimento) > 0);
        return (
          <div>
            <span className={clsx(atr && 'font-medium text-red-600')}>{data(c.vencimento)}</span>
            {atr && <p className="text-[10px] text-red-500">{diasAtraso(c.vencimento)} dias</p>}
          </div>
        );
      },
    },
    {
      chave: 'descricao',
      titulo: 'Descrição',
      render: (c) => {
        const l = linkOrigem(c);
        return (
          <div className="min-w-0">
            {l ? <Link to={l} className="block truncate font-medium text-slate-900 hover:text-brand-600" onClick={(e) => e.stopPropagation()}>{c.descricao}</Link> : <p className="truncate font-medium text-slate-900">{c.descricao}</p>}
            <p className="truncate text-xs text-slate-400">{[c.contato?.nome, c.categoria?.nome, c.parcela && `parc. ${c.parcela}`].filter(Boolean).join(' · ')}</p>
          </div>
        );
      },
    },
    { chave: 'forma', titulo: 'Forma', ocultarMobile: true, render: (c) => <span className="text-slate-500">{c.formaPagamento?.nome ?? '—'}</span> },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (c) => {
        const atr = c.atrasada ?? ((c.situacao === 'ABERTO' || c.situacao === 'PARCIAL') && diasAtraso(c.vencimento) > 0);
        const s = atr ? 'ATRASADO' : c.situacao;
        return <Badge tom={tomPorStatus(s)}>{rotulo(s)}</Badge>;
      },
    },
    { chave: 'valor', titulo: 'Valor', direita: true, largura: '110px', render: (c) => <span className="font-medium">{moeda(c.valor)}</span> },
    { chave: 'pago', titulo: ehReceber ? 'Recebido' : 'Pago', direita: true, largura: '110px', ocultarMobile: true, render: (c) => <span className="text-slate-500">{moeda(valorPago(c))}</span> },
    { chave: 'saldo', titulo: 'Saldo', direita: true, largura: '110px', render: (c) => (c.situacao === 'CANCELADO' ? <span className="text-slate-300">—</span> : <span className={clsx(c.valor - valorPago(c) > 0 ? 'text-slate-800' : 'text-emerald-700')}>{moeda(c.valor - valorPago(c))}</span>) },
    {
      chave: 'acoes',
      titulo: '',
      largura: '120px',
      render: (c) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {(c.situacao === 'ABERTO' || c.situacao === 'PARCIAL') && (
            <>
              <Button tamanho="xs" variante="sucesso" onClick={() => setBaixa([c])}>{ehReceber ? 'Receber' : 'Pagar'}</Button>
              <Button tamanho="xs" variante="fantasma" title="Cancelar conta" onClick={() => { if (confirm('Cancelar esta conta?')) cancelar.mutate(c.id); }}>✕</Button>
            </>
          )}
          {(c.situacao === 'RECEBIDO' || c.situacao === 'PAGO' || c.situacao === 'PARCIAL') && valorPago(c) > 0 && (
            <Button tamanho="xs" variante="fantasma" icone={<Undo2 className="h-3.5 w-3.5" />} title="Estornar baixa" onClick={() => { if (confirm('Estornar a baixa desta conta?')) estornar.mutate(c.id); }} />
          )}
        </div>
      ),
    },
  ];

  const t = resp?.totais;
  const situacaoAtiva = pg.getFiltro('situacao');

  return (
    <div>
      <PageHeader
        titulo={ehReceber ? 'Contas a receber' : 'Contas a pagar'}
        descricao={resp ? `${resp.meta.total} títulos` : undefined}
        acoes={
          <>
            {sel.size > 0 && (
              <Button variante="sucesso" icone={<CheckCheck className="h-4 w-4" />} onClick={() => setBaixa((resp?.data ?? []).filter((c) => sel.has(c.id)))}>
                {ehReceber ? 'Receber' : 'Pagar'} {sel.size} selecionada{sel.size > 1 ? 's' : ''} · {moeda(totalSel)}
              </Button>
            )}
            <Button variante="primario" icone={<Plus className="h-4 w-4" />} onClick={() => setNovo(true)}>Nova conta</Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard rotulo="Em aberto" valor={moeda(t?.aberto)} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={isLoading && !t} onClick={() => pg.setFiltro('situacao', 'ABERTO')} className={clsx(situacaoAtiva === 'ABERTO' && 'ring-2 ring-brand-500/30')} />
        <StatCard rotulo="Atrasadas" valor={moeda(t?.atrasado)} icone={<TriangleAlert className="h-4 w-4" />} tom={t && t.atrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading && !t} onClick={() => pg.setFiltro('situacao', 'ATRASADO')} className={clsx(situacaoAtiva === 'ATRASADO' && 'ring-2 ring-brand-500/30')} />
        <StatCard rotulo={ehReceber ? 'Recebidas (período)' : 'Pagas (período)'} valor={moeda(ehReceber ? t?.recebido : t?.pago)} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde" carregando={isLoading && !t} onClick={() => pg.setFiltro('situacao', ehReceber ? 'RECEBIDO' : 'PAGO')} className={clsx((situacaoAtiva === 'RECEBIDO' || situacaoAtiva === 'PAGO') && 'ring-2 ring-brand-500/30')} />
      </div>

      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Descrição, contato, nº…" />
          <SelectFiltro
            valor={situacaoAtiva}
            onChange={(v) => pg.setFiltro('situacao', v)}
            placeholder="Todas situações"
            opcoes={[{ valor: 'ABERTO', rotulo: 'Em aberto' }, { valor: 'ATRASADO', rotulo: 'Atrasadas' }, { valor: 'PARCIAL', rotulo: 'Parciais' }, { valor: ehReceber ? 'RECEBIDO' : 'PAGO', rotulo: ehReceber ? 'Recebidas' : 'Pagas' }, { valor: 'CANCELADO', rotulo: 'Canceladas' }]}
          />
          <SelectFiltro valor={pg.getFiltro('tipoData') || 'V'} onChange={(v) => pg.setFiltro('tipoData', v)} placeholder="" opcoes={[{ valor: 'V', rotulo: 'Por vencimento' }, { valor: 'E', rotulo: 'Por emissão' }, { valor: 'R', rotulo: ehReceber ? 'Por recebimento' : 'Por pagamento' }]} />
          <PeriodoFiltro inicial={pg.getFiltro('dataInicial')} final={pg.getFiltro('dataFinal')} onChange={(i, f) => { pg.setFiltro('dataInicial', i); pg.setFiltro('dataFinal', f); }} label="" />
          {ehReceber && <SelectFiltro valor={pg.getFiltro('vendedorId')} onChange={(v) => pg.setFiltro('vendedorId', v)} opcoes={opcoesDe(vendedores)} placeholder="Todos vendedores" />}
        </BarraFiltros>
        <Table colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(c) => c.id} vazio={<EmptyState icone={<Wallet className="h-5 w-5" />} titulo="Nenhuma conta encontrada" descricao="Ajuste os filtros ou lance uma nova conta." />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>

      <BaixaModal tipo={tipo} contas={baixa} onFechar={() => setBaixa(null)} onConcluido={invalidar} contasFin={contasFin ?? []} formas={formas ?? []} />
      <NovaContaModal tipo={tipo} aberto={novo} onFechar={() => setNovo(false)} onConcluido={invalidar} categorias={categorias ?? []} formas={formas ?? []} contasFin={contasFin ?? []} />
    </div>
  );
}

/** Modal de baixa (individual ou em lote) */
function BaixaModal({ tipo, contas, onFechar, onConcluido, contasFin, formas }: { tipo: 'receber' | 'pagar'; contas: Conta[] | null; onFechar: () => void; onConcluido: () => void; contasFin: { id: number; nome: string; padrao?: boolean }[]; formas: { id: number; nome: string }[] }) {
  const ehReceber = tipo === 'receber';
  const base = ehReceber ? '/contas-receber' : '/contas-pagar';
  const lote = (contas?.length ?? 0) > 1;
  const [dataBaixa, setDataBaixa] = useState(hoje());
  const [contaFin, setContaFin] = useState<number | ''>('');
  const [forma, setForma] = useState<number | ''>('');
  const [valor, setValor] = useState(0);
  const [juros, setJuros] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [obs, setObs] = useState('');
  const [progresso, setProgresso] = useState<number | null>(null);

  useEffect(() => {
    if (contas?.length) {
      setDataBaixa(hoje());
      setContaFin(contasFin.find((c) => c.padrao)?.id ?? contasFin[0]?.id ?? '');
      setForma(contas[0].formaPagamentoId ?? '');
      setValor(contas.reduce((s, c) => s + (c.valor - valorPago(c)), 0));
      setJuros(0);
      setDesconto(0);
      setObs('');
      setProgresso(null);
    }
  }, [contas, contasFin]);

  const m = useMutation({
    mutationFn: async () => {
      if (!contas) return;
      if (!lote) {
        await api.post(`${base}/${contas[0].id}/baixar`, { valor, data: dataBaixa, contaFinanceiraId: Number(contaFin), formaPagamentoId: forma === '' ? undefined : Number(forma), juros: juros || undefined, desconto: desconto || undefined, observacoes: obs || undefined });
        return;
      }
      // Baixa em lote: uma chamada por conta (valor integral do saldo)
      let i = 0;
      for (const c of contas) {
        await api.post(`${base}/${c.id}/baixar`, { valor: c.valor - valorPago(c), data: dataBaixa, contaFinanceiraId: Number(contaFin), formaPagamentoId: forma === '' ? undefined : Number(forma), observacoes: obs || undefined });
        setProgresso(++i);
      }
    },
    onSuccess: () => {
      toast.success(lote ? `${contas?.length} contas baixadas.` : ehReceber ? 'Recebimento registrado.' : 'Pagamento registrado.');
      onConcluido();
      onFechar();
    },
    onError: (e) => {
      toast.error(mensagemErro(e));
      onConcluido();
    },
  });

  if (!contas?.length) return null;
  const saldo = contas.reduce((s, c) => s + (c.valor - valorPago(c)), 0);

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo={lote ? `${ehReceber ? 'Receber' : 'Pagar'} ${contas.length} contas` : ehReceber ? 'Registrar recebimento' : 'Registrar pagamento'}
      descricao={lote ? `Total ${moeda(saldo)} — cada conta será baixada pelo saldo integral.` : contas[0].descricao}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="sucesso" carregando={m.isPending} disabled={!contaFin || (!lote && valor <= 0)} onClick={() => m.mutate()}>
            {m.isPending && progresso !== null ? `${progresso}/${contas.length}…` : 'Confirmar'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <DateInput label="Data" value={dataBaixa} onChange={setDataBaixa} />
        <Select label="Conta financeira" obrigatorio value={contaFin} onChange={(e) => setContaFin(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="—" />
        <Select label="Forma de pagamento" value={forma} onChange={(e) => setForma(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(formas)} placeholder="—" />
        {!lote && (
          <>
            <MoneyInput label={ehReceber ? 'Valor recebido' : 'Valor pago'} value={valor} onChange={setValor} />
            <MoneyInput label="Juros / multa" value={juros} onChange={setJuros} />
            <MoneyInput label="Desconto" value={desconto} onChange={setDesconto} />
          </>
        )}
        <Textarea className="col-span-2" label="Observações" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
      {!lote && valor < saldo && valor > 0 && <p className="mt-2 text-xs text-amber-700">Baixa parcial: restarão {moeda(saldo - valor)} em aberto.</p>}
    </Modal>
  );
}

/** Modal de lançamento manual de conta */
function NovaContaModal({ tipo, aberto, onFechar, onConcluido, categorias, formas, contasFin }: { tipo: 'receber' | 'pagar'; aberto: boolean; onFechar: () => void; onConcluido: () => void; categorias: { id: number; nome: string; tipo: string }[]; formas: { id: number; nome: string }[]; contasFin: { id: number; nome: string }[] }) {
  const ehReceber = tipo === 'receber';
  const base = ehReceber ? '/contas-receber' : '/contas-pagar';
  const [form, setForm] = useState({ descricao: '', contatoId: null as number | null, vencimento: hoje(), valor: 0, categoriaId: '' as number | '', formaPagamentoId: '' as number | '', contaFinanceiraId: '' as number | '', competencia: hoje().slice(0, 7), observacoes: '', recorrente: false });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const m = useMutation({
    mutationFn: () => api.post(base, { ...form, categoriaId: form.categoriaId || null, formaPagamentoId: form.formaPagamentoId || null, contaFinanceiraId: form.contaFinanceiraId || null, origemTipo: 'MANUAL', recorrente: ehReceber ? undefined : form.recorrente }),
    onSuccess: () => {
      toast.success('Conta lançada.');
      onConcluido();
      onFechar();
      setForm((f) => ({ ...f, descricao: '', valor: 0, observacoes: '' }));
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={ehReceber ? 'Nova conta a receber' : 'Nova conta a pagar'}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={m.isPending} disabled={!form.descricao.trim() || form.valor <= 0} onClick={() => m.mutate()}>Lançar</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Input className="col-span-2" label="Descrição" obrigatorio value={form.descricao} onChange={(e) => set('descricao', e.target.value)} autoFocus />
        <SearchSelect className="col-span-2" label={ehReceber ? 'Cliente' : 'Fornecedor'} valor={form.contatoId} onChange={(v) => set('contatoId', v)} buscar={(t) => buscarContatos(t, ehReceber ? 'CLIENTE' : 'FORNECEDOR')} />
        <MoneyInput label="Valor" obrigatorio value={form.valor} onChange={(v) => set('valor', v)} />
        <DateInput label="Vencimento" value={form.vencimento} onChange={(v) => set('vencimento', v)} />
        <Select label="Categoria" value={form.categoriaId} onChange={(e) => set('categoriaId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(categorias.filter((c) => c.tipo === (ehReceber ? 'RECEITA' : 'DESPESA')))} placeholder="—" />
        <Input label="Competência" type="month" value={form.competencia} onChange={(e) => set('competencia', e.target.value)} />
        <Select label="Forma" value={form.formaPagamentoId} onChange={(e) => set('formaPagamentoId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(formas)} placeholder="—" />
        <Select label="Conta financeira" value={form.contaFinanceiraId} onChange={(e) => set('contaFinanceiraId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="—" />
        {!ehReceber && <div className="col-span-2"><Checkbox label="Despesa recorrente (mensal)" checked={form.recorrente} onChange={(e) => set('recorrente', e.target.checked)} /></div>}
        <Textarea className="col-span-2" label="Observações" rows={2} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
      </div>
    </Modal>
  );
}
