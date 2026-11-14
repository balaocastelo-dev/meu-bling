import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CheckCheck, CircleDollarSign, Clock, ExternalLink, History, Pencil, Plus, TriangleAlert, Undo2, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useCategoriasFinanceiras, useContasFinanceiras, useFormasPagamento, useVendedores, opcoesDe } from '@/hooks/useListas';
import { buscarContatos } from '@/lib/buscas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, Checkbox, DateInput, EmptyState, Input, Modal, MoneyInput, PageHeader, Pagination, PeriodoFiltro, SearchSelect, Select, SelectFiltro, StatCard, Table, Textarea, tomPorStatus, type Coluna } from '@/components/ui';
import { TextoValores } from '@/components/compartilhados/TextoValores';
import { arred, data, dataIso, diasAtraso, hoje, moeda, rotulo } from '@/lib/format';
import type { ContaPagar, ContaReceber, ContasResposta } from '@/types';

type Conta = ContaReceber | ContaPagar;

interface Props {
  tipo: 'receber' | 'pagar';
}

function valorPago(c: Conta): number {
  return 'valorRecebido' in c ? c.valorRecebido : c.valorPago;
}

/** Saldo em aberto: o valor pago inclui juros, então principal abatido = pago - juros. */
function saldoDe(c: Conta): number {
  if (typeof c.saldo === 'number') return c.saldo;
  return Math.max(0, Math.round((c.valor + (c.juros || 0) - valorPago(c) - (c.desconto || 0)) * 100) / 100);
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
    case 'EMPRESTIMO':
      return o.id ? `/financeiro/emprestimos?id=${o.id}` : '/financeiro/emprestimos';
    case 'PAGAMENTO_TECNICO':
      return `/dashboard/assistencia`;
    case 'CARNE':
      return `/financeiro/carnes?id=${o.id}`;
    default:
      return null;
  }
}

/** Compra, comissão e empréstimo: valor e vencimento se editam no documento de origem. */
function avisoOrigem(c: Conta): { texto: string; para: string; rotuloLink: string } | null {
  const tipo = c.origem?.tipo || c.origemTipo;
  const para = linkOrigem(c);
  if (tipo === 'COMPRA') return { texto: 'O valor e o vencimento desta conta se editam na compra.', para: para ?? '/compras', rotuloLink: 'Abrir a compra' };
  if (tipo === 'COMISSAO') return { texto: 'O valor e o vencimento desta conta se editam na comissão.', para: para ?? '/comissoes', rotuloLink: 'Abrir comissões' };
  if (tipo === 'EMPRESTIMO') return { texto: 'O valor e o vencimento desta conta se editam no empréstimo.', para: para ?? '/financeiro/emprestimos', rotuloLink: 'Abrir o empréstimo' };
  return null;
}

function ehContaPagar(c: Conta): c is ContaPagar {
  return 'valorPago' in c;
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
  const [detalhe, setDetalhe] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<ContaPagar | null>(null);
  const abrirEdicao = (c: Conta) => {
    if (!ehReceber && c.situacao !== 'CANCELADO' && ehContaPagar(c)) setEditar(c);
  };
  const [informar, setInformar] = useState<Conta | null>(null);

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
  const totalSel = useMemo(() => (resp?.data ?? []).filter((c) => sel.has(c.id)).reduce((s, c) => s + saldoDe(c), 0), [sel, resp]);

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
    {
      chave: 'saldo',
      titulo: 'Saldo',
      direita: true,
      largura: '110px',
      render: (c) =>
        c.situacao === 'CANCELADO' ? (
          <span className="text-slate-300">—</span>
        ) : c.saldoNaoInformado ? (
          <span className="text-amber-700" title="O Bling não informou quanto ainda falta. Não mostramos um saldo inventado.">a informar</span>
        ) : (
          <span className={clsx(saldoDe(c) > 0 ? 'text-slate-800' : 'text-emerald-700')}>{moeda(saldoDe(c))}</span>
        ),
    },
    {
      chave: 'acoes',
      titulo: '',
      largura: '260px',
      render: (c) => (
        <div className="flex flex-wrap justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {!ehReceber && c.situacao !== 'CANCELADO' && (
            <Button tamanho="xs" variante="secundario" icone={<Pencil className="h-3.5 w-3.5" />} title="Editar conta" onClick={() => abrirEdicao(c)}>Editar</Button>
          )}
          {c.saldoNaoInformado ? (
            <Button tamanho="xs" variante="primario" title="Dizer quanto ainda falta pagar. O Bling não enviou o saldo." onClick={() => setInformar(c)}>Informar falta</Button>
          ) : (c.situacao === 'ABERTO' || c.situacao === 'PARCIAL') && (
            <>
              <Button tamanho="xs" variante="sucesso" title={c.situacao === 'PARCIAL' ? 'Pagar o restante ou mais uma parte' : 'Pagar total ou parcial'} onClick={() => setBaixa([c])}>{ehReceber ? 'Receber' : 'Pagar'}</Button>
              <Button tamanho="xs" variante="fantasma" title="Cancelar conta" onClick={() => { if (confirm('Cancelar esta conta?')) cancelar.mutate(c.id); }}>✕</Button>
            </>
          )}
          {(c.situacao === 'RECEBIDO' || c.situacao === 'PAGO' || c.situacao === 'PARCIAL') && valorPago(c) > 0 && (
            <>
              <Button tamanho="xs" variante="fantasma" icone={<History className="h-3.5 w-3.5" />} title={ehReceber ? 'Histórico de recebimentos' : 'Histórico de pagamentos'} onClick={() => setDetalhe(c.id)} />
              {!c.saldoNaoInformado && (
                <Button tamanho="xs" variante="fantasma" icone={<Undo2 className="h-3.5 w-3.5" />} title="Estornar todas as baixas" onClick={() => { if (confirm(c.situacao === 'PARCIAL' ? 'Estornar TODOS os pagamentos desta conta? (para estornar só um, abra o histórico)' : 'Estornar a baixa desta conta?')) estornar.mutate(c.id); }} />
              )}
            </>
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

      <div className="mb-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
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
            opcoes={[
              { valor: 'ABERTO', rotulo: 'Em aberto' },
              { valor: 'ATRASADO', rotulo: 'Atrasadas' },
              { valor: 'PARCIAL', rotulo: 'Parciais' },
              { valor: ehReceber ? 'RECEBIDO' : 'PAGO', rotulo: ehReceber ? 'Recebidas' : 'Pagas' },
              { valor: 'CANCELADO', rotulo: 'Canceladas' },
              ...(!ehReceber ? [{ valor: 'DEVOLVIDO', rotulo: 'Devolvidas' }, { valor: 'NAO_MAPEADA', rotulo: 'Bling 6/7' }] : []),
            ]}
          />
          <SelectFiltro valor={pg.getFiltro('tipoData') || 'V'} onChange={(v) => pg.setFiltro('tipoData', v)} placeholder="" opcoes={[{ valor: 'V', rotulo: 'Por vencimento' }, { valor: 'E', rotulo: 'Por emissão' }, { valor: 'R', rotulo: ehReceber ? 'Por recebimento' : 'Por pagamento' }]} />
          <PeriodoFiltro inicial={pg.getFiltro('dataInicial')} final={pg.getFiltro('dataFinal')} onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })} label="" />
          {ehReceber && <SelectFiltro valor={pg.getFiltro('vendedorId')} onChange={(v) => pg.setFiltro('vendedorId', v)} opcoes={opcoesDe(vendedores)} placeholder="Todos vendedores" />}
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={resp?.data}
          carregando={isLoading}
          chave={(c) => c.id}
          onClickLinha={(c) => setDetalhe(c.id)}
          cartao={(c) => {
            const atr = c.atrasada ?? ((c.situacao === 'ABERTO' || c.situacao === 'PARCIAL') && diasAtraso(c.vencimento) > 0);
            const st = atr ? 'ATRASADO' : c.situacao;
            const aberta = c.situacao === 'ABERTO' || c.situacao === 'PARCIAL';
            const l = linkOrigem(c);
            return (
              <div className="flex min-w-0 items-start gap-2">
                {aberta && (
                  <span className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {l ? (
                      <Link to={l} className="min-w-0 break-words text-sm font-medium text-slate-900 hover:text-brand-600"><TextoValores texto={c.descricao} /></Link>
                    ) : (
                      <p className="min-w-0 break-words text-sm font-medium text-slate-900"><TextoValores texto={c.descricao} /></p>
                    )}
                    <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(c.valor)}</span>
                  </div>
                  {(c.contato?.nome || c.categoria?.nome) && <p className="truncate text-xs text-slate-500">{[c.contato?.nome, c.categoria?.nome, c.parcela && `parc. ${c.parcela}`].filter(Boolean).join(' · ')}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <Badge tom={tomPorStatus(st)}>{rotulo(st)}</Badge>
                    <span className={clsx('whitespace-nowrap', atr && 'font-medium text-red-600')}>vence {data(c.vencimento)}{atr ? ` · ${diasAtraso(c.vencimento)} dias` : ''}</span>
                    {c.formaPagamento?.nome && <span className="whitespace-nowrap">{c.formaPagamento.nome}</span>}
                    {c.saldoNaoInformado && <span className="whitespace-nowrap text-amber-700">saldo a informar</span>}
                    {!c.saldoNaoInformado && c.situacao !== 'CANCELADO' && valorPago(c) > 0 && saldoDe(c) > 0 && <span className="whitespace-nowrap">pago {moeda(valorPago(c))} · falta {moeda(saldoDe(c))}</span>}
                  </div>
                </div>
              </div>
            );
          }}
          vazio={<EmptyState icone={<Wallet className="h-5 w-5" />} titulo="Nenhuma conta encontrada" descricao="Ajuste os filtros ou lance uma nova conta." />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>

      <BaixaModal tipo={tipo} contas={baixa} onFechar={() => setBaixa(null)} onConcluido={() => { invalidar(); qc.invalidateQueries({ queryKey: [base, 'detalhe'] }); }} contasFin={contasFin ?? []} formas={formas ?? []} />
      <DetalheContaModal tipo={tipo} id={detalhe} onFechar={() => setDetalhe(null)} onPagar={(c) => { setDetalhe(null); setBaixa([c]); }} onEditar={!ehReceber ? (c) => { setDetalhe(null); abrirEdicao(c); } : undefined} onInformar={(c) => setInformar(c)} onAlterado={invalidar} />
      {!ehReceber && <InformarRestanteModal conta={informar} onFechar={() => setInformar(null)} onConcluido={() => { invalidar(); qc.invalidateQueries({ queryKey: [base, 'detalhe'] }); }} />}
      <NovaContaModal tipo={tipo} aberto={novo} onFechar={() => setNovo(false)} onConcluido={invalidar} categorias={categorias ?? []} formas={formas ?? []} contasFin={contasFin ?? []} />
      {editar && <EditarContaModal conta={editar} onFechar={() => setEditar(null)} onConcluido={invalidar} categorias={categorias ?? []} formas={formas ?? []} contasFin={contasFin ?? []} />}
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
  /** true quando o usuário digitou o valor (aí juros/desconto não o recalculam mais) */
  const [valorEditado, setValorEditado] = useState(false);

  useEffect(() => {
    if (contas?.length) {
      setDataBaixa(hoje());
      setContaFin(contasFin.find((c) => c.padrao)?.id ?? contasFin[0]?.id ?? '');
      setForma(contas[0].formaPagamentoId ?? '');
      setValor(Math.round(contas.reduce((s, c) => s + saldoDe(c), 0) * 100) / 100);
      setValorEditado(false);
      setJuros(0);
      setDesconto(0);
      setObs('');
      setProgresso(null);
    }
  }, [contas, contasFin]);

  const saldoAtual = contas?.length ? Math.round(contas.reduce((s, c) => s + saldoDe(c), 0) * 100) / 100 : 0;
  // se o valor não foi digitado, acompanha juros/desconto (pagamento integral)
  useEffect(() => {
    if (!valorEditado && contas?.length === 1) setValor(Math.max(0, Math.round((saldoAtual + juros - desconto) * 100) / 100));
  }, [juros, desconto]); // eslint-disable-line react-hooks/exhaustive-deps
  const abatido = Math.round((valor - juros + desconto) * 100) / 100;
  const restara = Math.round((saldoAtual - abatido) * 100) / 100;
  const acimaDoSaldo = restara < -0.009;

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
        await api.post(`${base}/${c.id}/baixar`, { valor: saldoDe(c), data: dataBaixa, contaFinanceiraId: Number(contaFin), formaPagamentoId: forma === '' ? undefined : Number(forma), observacoes: obs || undefined });
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
  const saldo = saldoAtual;
  const jaPago = contas.length === 1 ? valorPago(contas[0]) : 0;

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo={lote ? `${ehReceber ? 'Receber' : 'Pagar'} ${contas.length} contas` : ehReceber ? 'Registrar recebimento' : 'Registrar pagamento'}
      descricao={lote ? `Total ${moeda(saldo)} — cada conta será baixada pelo saldo integral.` : `${contas[0].descricao} · em aberto ${moeda(saldo)}${jaPago > 0 ? ` (já ${ehReceber ? 'recebido' : 'pago'} ${moeda(jaPago)} de ${moeda(contas[0].valor)})` : ''}`}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="sucesso" carregando={m.isPending} disabled={!contaFin || (!lote && (valor <= 0 || acimaDoSaldo))} onClick={() => m.mutate()}>
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
            <MoneyInput label={ehReceber ? 'Valor recebido agora' : 'Valor pago agora'} value={valor} onChange={(v) => { setValor(v); setValorEditado(true); }} />
            <MoneyInput label="Juros / multa" value={juros} onChange={setJuros} />
            <MoneyInput label="Desconto" value={desconto} onChange={setDesconto} />
          </>
        )}
        <Textarea className="col-span-2" label="Observações" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
      </div>
      {!lote && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {acimaDoSaldo ? (
            <p className="font-medium text-red-600">Valor acima do saldo em aberto ({moeda(saldo)}). Se {ehReceber ? 'recebeu' : 'pagou'} a mais por juros/multa, lance a diferença em "Juros / multa".</p>
          ) : restara > 0.009 && valor > 0 ? (
            <p className="text-amber-700"><b>{ehReceber ? 'Recebimento' : 'Pagamento'} parcial:</b> restarão <b>{moeda(restara)}</b> em aberto nesta conta para {ehReceber ? 'receber' : 'pagar'} depois.</p>
          ) : valor > 0 ? (
            <p className="text-emerald-700">A conta será quitada.</p>
          ) : null}
          <p className="mt-1 text-slate-400">Pode {ehReceber ? 'receber' : 'pagar'} só uma parte: digite o valor desta vez. Cada {ehReceber ? 'recebimento' : 'pagamento'} fica registrado no histórico da conta.</p>
        </div>
      )}
    </Modal>
  );
}

/** Conta importada do Bling sem saldo: a loja diz quanto ainda falta. Não inventamos o número. */
function InformarRestanteModal({ conta, onFechar, onConcluido }: { conta: Conta | null; onFechar: () => void; onConcluido: () => void }) {
  const [restante, setRestante] = useState(0);
  useEffect(() => {
    if (conta) setRestante(0);
  }, [conta]);

  const m = useMutation({
    mutationFn: () => api.post(`/contas-pagar/${conta!.id}/informar-restante`, { restante }),
    onSuccess: () => {
      toast.success(restante > 0.009 ? 'Saldo gravado. Os próximos pagamentos usam o que falta.' : 'Conta conferida: nada em aberto.');
      onConcluido();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (!conta) return null;
  const acima = restante > conta.valor + 0.009;
  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo="Quanto ainda falta pagar?"
      descricao={`${conta.descricao} · valor ${moeda(conta.valor)}. O Bling marcou como ${rotulo(conta.situacao)} e não mandou o saldo. Não há pagamento no caixa.`}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={m.isPending} disabled={acima} onClick={() => m.mutate()}>Gravar</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        Informe quanto ainda falta. Gravamos o que já foi pago como o valor da conta menos esse número e liberamos as baixas seguintes. Se não falta nada, deixe zero.
      </p>
      <MoneyInput label="Ainda falta pagar" value={restante} onChange={setRestante} autoFocus ajuda={acima ? `Não pode passar de ${moeda(conta.valor)}.` : `O que já foi pago fica ${moeda(Math.max(0, Math.round((conta.valor - restante) * 100) / 100))}.`} />
    </Modal>
  );
}

/** Detalhe da conta com histórico de pagamentos/recebimentos (baixas parciais) */
function DetalheContaModal({ tipo, id, onFechar, onPagar, onEditar, onInformar, onAlterado }: { tipo: 'receber' | 'pagar'; id: number | null; onFechar: () => void; onPagar: (c: Conta) => void; onEditar?: (c: Conta) => void; onInformar: (c: Conta) => void; onAlterado: () => void }) {
  const ehReceber = tipo === 'receber';
  const base = ehReceber ? '/contas-receber' : '/contas-pagar';
  const qc = useQueryClient();
  const { data: c, isLoading } = useQuery({ queryKey: [base, 'detalhe', id], queryFn: () => api.get<Conta>(`${base}/${id}`), enabled: id !== null });

  const estornarUm = useMutation({
    mutationFn: (movId: number) => api.post(`${base}/${id}/pagamentos/${movId}/estornar`),
    onSuccess: () => {
      toast.success(ehReceber ? 'Recebimento estornado. O valor voltou para o saldo em aberto.' : 'Pagamento estornado. O valor voltou para o saldo em aberto.');
      qc.invalidateQueries({ queryKey: [base, 'detalhe', id] });
      onAlterado();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  if (id === null) return null;
  const pagos = c?.lancamentos ?? [];
  const aberta = c && (c.situacao === 'ABERTO' || c.situacao === 'PARCIAL');
  const pago = c ? valorPago(c) : 0;
  const semMovimento = c ? Math.round((pago - pagos.reduce((s, m) => s + m.valor, 0)) * 100) / 100 : 0;

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo={c?.descricao ?? 'Conta'}
      descricao={c ? [c.contato?.nome, c.categoria?.nome, c.parcela && `parc. ${c.parcela}`, `vence ${data(c.vencimento)}`].filter(Boolean).join(' · ') : undefined}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Fechar</Button>
          {onEditar && c && c.situacao !== 'CANCELADO' && <Button variante="secundario" icone={<Pencil className="h-4 w-4" />} onClick={() => onEditar(c)}>Editar</Button>}
          {c && c.saldoNaoInformado && <Button variante="primario" onClick={() => onInformar(c)}>Informar quanto falta</Button>}
          {!c?.saldoNaoInformado && aberta && c && <Button variante="sucesso" onClick={() => onPagar(c)}>{c.situacao === 'PARCIAL' ? (ehReceber ? 'Receber restante / parte' : 'Pagar restante / parte') : ehReceber ? 'Receber' : 'Pagar'}</Button>}
        </>
      }
    >
      {isLoading || !c ? (
        <p className="py-6 text-center text-sm text-slate-400">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm min-[480px]:grid-cols-4">
            <Resumo rotulo="Valor da conta" valor={moeda(c.valor)} />
            <Resumo rotulo={ehReceber ? 'Recebido' : 'Pago'} valor={moeda(pago)} tom="verde" />
            <Resumo rotulo="Juros / desconto" valor={`${moeda(c.juros)} / ${moeda(c.desconto)}`} />
            <Resumo rotulo="Falta" valor={c.saldoNaoInformado ? 'a informar' : moeda(saldoDe(c))} tom={c.saldoNaoInformado || saldoDe(c) > 0 ? 'ambar' : 'verde'} />
          </div>
          <div className="flex items-center gap-2"><Badge tom={tomPorStatus(c.atrasada ? 'ATRASADO' : c.situacao)}>{rotulo(c.atrasada ? 'ATRASADO' : c.situacao)}</Badge>{c.saldoNaoInformado && <span className="text-xs text-amber-700">Veio do Bling sem saldo. Informe quanto ainda falta — não inventamos esse valor.</span>}{!c.saldoNaoInformado && c.situacao === 'PARCIAL' && <span className="text-xs text-slate-500">{ehReceber ? 'Recebida' : 'Paga'} em parte — o restante continua em aberto.</span>}</div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{ehReceber ? 'Recebimentos' : 'Pagamentos'} ({pagos.length})</p>
            {pagos.length === 0 && semMovimento <= 0 ? (
              <p className="rounded-md border border-dashed border-slate-200 py-4 text-center text-sm text-slate-400">Nenhum {ehReceber ? 'recebimento' : 'pagamento'} ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {pagos.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{moeda(m.valor)} <span className="font-normal text-slate-500">em {data(m.data)}</span></p>
                      <p className="truncate text-xs text-slate-500">{[m.contaFinanceira?.nome, m.juros ? `juros ${moeda(m.juros)}` : null, m.desconto ? `desconto ${moeda(m.desconto)}` : null, m.conciliado ? 'conciliado' : null, m.observacoes].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Button tamanho="xs" variante="fantasma" icone={<Undo2 className="h-3.5 w-3.5" />} carregando={estornarUm.isPending && estornarUm.variables === m.id} title={ehReceber ? 'Estornar só este recebimento' : 'Estornar só este pagamento'}
                      onClick={() => { if (confirm(`Estornar este ${ehReceber ? 'recebimento' : 'pagamento'} de ${moeda(m.valor)} (${data(m.data)})? O valor volta para o saldo em aberto.`)) estornarUm.mutate(m.id); }}>
                      Estornar
                    </Button>
                  </li>
                ))}
                {semMovimento > 0.009 && (
                  <li className="px-3 py-2 text-xs text-slate-500">{moeda(semMovimento)} {ehReceber ? 'recebidos' : 'pagos'} antes (importado do Bling, sem lançamento de caixa).</li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Resumo({ rotulo: r, valor, tom }: { rotulo: string; valor: string; tom?: 'verde' | 'ambar' }) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <p className="text-[11px] text-slate-500">{r}</p>
      <p className={clsx('num font-semibold', tom === 'verde' ? 'text-emerald-700' : tom === 'ambar' ? 'text-amber-700' : 'text-slate-900')}>{valor}</p>
    </div>
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

/** Edição de conta a pagar. O que pode mudar depende da situação e da origem. */
function EditarContaModal({ conta, onFechar, onConcluido, categorias, formas, contasFin }: { conta: ContaPagar; onFechar: () => void; onConcluido: () => void; categorias: { id: number; nome: string; tipo: string }[]; formas: { id: number; nome: string }[]; contasFin: { id: number; nome: string }[] }) {
  const pago = conta.situacao === 'PAGO';
  const parcial = conta.situacao === 'PARCIAL';
  const origem = avisoOrigem(conta);
  const travaValor = pago || !!origem;
  const travaDemais = pago;
  const piso = arred(conta.valorPago - (conta.juros || 0) + (conta.desconto || 0));
  const [form, setForm] = useState({
    descricao: conta.descricao,
    contatoId: conta.contatoId ?? null,
    vencimento: dataIso(conta.vencimento),
    valor: conta.valor,
    categoriaId: (conta.categoriaId ?? '') as number | '',
    formaPagamentoId: (conta.formaPagamentoId ?? '') as number | '',
    contaFinanceiraId: (conta.contaFinanceiraId ?? '') as number | '',
    competencia: conta.competencia || dataIso(conta.vencimento).slice(0, 7),
    observacoes: conta.observacoes ?? '',
    recorrente: conta.recorrente,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const saldoPrevisto = arred(form.valor + (conta.juros || 0) - conta.valorPago - (conta.desconto || 0));
  const abaixo = parcial && !travaValor && arred(form.valor) < piso;

  const m = useMutation({
    mutationFn: () => {
      const corpo: Record<string, unknown> = {
        descricao: form.descricao.trim(),
        contatoId: form.contatoId,
        categoriaId: form.categoriaId || null,
        observacoes: form.observacoes.trim() || null,
      };
      if (!travaDemais) {
        corpo.competencia = form.competencia || null;
        corpo.formaPagamentoId = form.formaPagamentoId || null;
        corpo.contaFinanceiraId = form.contaFinanceiraId || null;
        corpo.recorrente = form.recorrente;
      }
      if (!travaValor) {
        corpo.valor = form.valor;
        corpo.vencimento = form.vencimento;
      }
      return api.put(`/contas-pagar/${conta.id}`, corpo);
    },
    onSuccess: () => {
      toast.success('Conta atualizada.');
      onConcluido();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const motivoValor = origem ? 'Este valor se edita no documento de origem.' : pago ? 'Bloqueado até estornar a baixa.' : undefined;

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo="Editar conta a pagar"
      descricao={conta.descricao}
      rodape={
        <>
          <Button variante="secundario" onClick={onFechar}>Cancelar</Button>
          <Button variante="primario" carregando={m.isPending} disabled={!form.descricao.trim() || (!travaValor && (form.valor <= 0 || !form.vencimento || abaixo))} onClick={() => m.mutate()}>Salvar</Button>
        </>
      }
    >
      <div className="mb-3 space-y-2">
        {origem && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p>{origem.texto}</p>
            <Link to={origem.para} className="mt-1 inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" onClick={onFechar}>
              {origem.rotuloLink} <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
        {pago && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">Conta paga: dá para corrigir descrição, observação, fornecedor e categoria. Valor e vencimento ficam bloqueados até estornar a baixa.</p>
        )}
        {parcial && !origem && (
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Principal já pago: <b>{moeda(piso)}</b> (pago {moeda(conta.valorPago)}{conta.juros ? `, juros ${moeda(conta.juros)}` : ''}{conta.desconto ? `, desconto ${moeda(conta.desconto)}` : ''}). O valor pode subir, ou descer até {moeda(piso)}. Se o saldo zerar, a conta fica paga. Abaixo disso, estorne a baixa excedente. A conta financeira daqui é a padrão dos próximos pagamentos — os que já saíram ficam onde saíram.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input className="col-span-2" label="Descrição" obrigatorio value={form.descricao} onChange={(e) => set('descricao', e.target.value)} autoFocus />
        <SearchSelect className="col-span-2" label="Fornecedor" valor={form.contatoId} rotuloAtual={conta.contato?.nome} onChange={(v) => set('contatoId', v)} buscar={(t) => buscarContatos(t, 'FORNECEDOR')} />
        <MoneyInput label="Valor" obrigatorio value={form.valor} onChange={(v) => set('valor', v)} disabled={travaValor} title={motivoValor} erro={abaixo ? `Fica abaixo do principal já pago (${moeda(piso)}). Estorne a baixa excedente.` : undefined} ajuda={!travaValor && !abaixo ? (parcial && saldoPrevisto <= 0.009 ? 'O saldo zera e a conta fica paga.' : `Saldo em aberto: ${moeda(Math.max(0, saldoPrevisto))}`) : motivoValor} />
        <DateInput label="Vencimento" value={form.vencimento} onChange={(v) => set('vencimento', v)} disabled={travaValor} title={motivoValor} ajuda={motivoValor} />
        <Select label="Categoria" value={form.categoriaId} onChange={(e) => set('categoriaId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(categorias.filter((c) => c.tipo === 'DESPESA'))} placeholder="—" ajuda={parcial ? 'Não altera a categoria dos pagamentos já lançados.' : undefined} />
        <Input label="Competência" type="month" value={form.competencia} onChange={(e) => set('competencia', e.target.value)} disabled={travaDemais} title={pago ? 'Bloqueado em conta paga.' : undefined} />
        <Select label="Forma" value={form.formaPagamentoId} onChange={(e) => set('formaPagamentoId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(formas)} placeholder="—" disabled={travaDemais} />
        <Select label="Conta financeira padrão" value={form.contaFinanceiraId} onChange={(e) => set('contaFinanceiraId', e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="—" disabled={travaDemais} ajuda={parcial ? 'Os pagamentos antigos continuam na conta de onde saíram.' : undefined} />
        <div className="col-span-2"><Checkbox label="Despesa recorrente (mensal)" checked={form.recorrente} onChange={(e) => set('recorrente', e.target.checked)} disabled={travaDemais} /></div>
        <Textarea className="col-span-2" label="Observações" rows={2} value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
      </div>
    </Modal>
  );
}
