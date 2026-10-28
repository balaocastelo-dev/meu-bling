import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, FileSignature, FileText, Plus, ShoppingCart, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSituacoes, useVendedores, opcoesDe } from '@/hooks/useListas';
import { OPCOES_PERIODO, periodoDe } from '@/lib/periodo';
import { BarraFiltros, BuscaFiltro, Button, Card, ChipsSituacao, EmptyState, PageHeader, Pagination, PeriodoFiltro, SelectFiltro, StatusBadge, Table, type Coluna } from '@/components/ui';
import { VendaAcoes, rotaDe } from '@/components/compartilhados/VendaAcoes';
import { data, inteiro, moeda, rotulo } from '@/lib/format';
import type { Paginado, TipoVenda, VendaResumo } from '@/types';

interface ResumoLista {
  valor: number;
  quantidade: number;
  ticketMedio: number;
  canceladasForaDoTotal: number;
  destaque: { id: number; nome: string; valor: number | null; quantidade: number; participacaoPct: number | null } | null;
}

/** "Hoje", "Semana passada", "01/10 a 15/10", "Todo o período" */
function nomePeriodo(i: string, f: string) {
  const p = periodoDe(i, f);
  const at = OPCOES_PERIODO.find((o) => o.valor === p && p !== 'custom');
  if (at) return at.rotulo;
  const br = (x: string) => x.split('-').reverse().slice(0, 2).join('/');
  if (i && f) return i === f ? br(i) : `${br(i)} a ${br(f)}`;
  if (i) return `Desde ${br(i)}`;
  if (f) return `Até ${br(f)}`;
  return 'Todo o período';
}

/** Painel à direita do filtro: total, nº de vendas e vendedor destaque do que está filtrado */
function PainelResumo({ r, periodo, orcamento, carregando }: { r?: ResumoLista; periodo: string; orcamento: boolean; carregando: boolean }) {
  return (
    <div className={`grid w-full grid-cols-2 gap-2 transition-opacity sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-stretch ${carregando ? 'opacity-50' : ''}`} aria-live="polite">
      <div className="col-span-2 min-w-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 sm:min-w-[150px]">
        <div className="text-[11px] font-medium text-emerald-700">{orcamento ? 'Total orçado' : 'Total vendido'} · {periodo}</div>
        <div className="num text-lg font-semibold leading-tight text-emerald-800">{r ? moeda(r.valor) : '—'}</div>
      </div>
      <div className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 sm:min-w-[110px]">
        <div className="text-[11px] font-medium text-slate-500">{orcamento ? 'Orçamentos' : 'Vendas'}</div>
        <div className="num text-lg font-semibold leading-tight text-slate-900">{r ? inteiro(r.quantidade) : '—'}</div>
        {r && r.quantidade > 0 && <div className="num text-[11px] text-slate-500">ticket {moeda(r.ticketMedio)}</div>}
      </div>
      <div className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 sm:min-w-[170px] sm:max-w-[260px]">
        <div className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
          <Trophy className="h-3 w-3" /> Vendedor destaque
        </div>
        {r?.destaque ? (
          <>
            <div className="truncate text-sm font-semibold leading-tight text-slate-900" title={r.destaque.nome}>
              {r.destaque.nome}
            </div>
            <div className="num text-[11px] text-amber-800">
              {r.destaque.valor !== null ? `${moeda(r.destaque.valor)} · ` : ''}
              {inteiro(r.destaque.quantidade)} {r.destaque.quantidade === 1 ? 'venda' : 'vendas'}
              {r.destaque.participacaoPct !== null ? ` · ${r.destaque.participacaoPct.toLocaleString('pt-BR')}%` : ''}
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-400">—</div>
        )}
      </div>
    </div>
  );
}

/** Lista de pedidos de venda (tipo PEDIDO) ou de orçamentos (tipo ORCAMENTO) */
export default function VendasLista({ tipo = 'PEDIDO' }: { tipo?: TipoVenda }) {
  const nav = useNavigate();
  const pg = usePaginacao();
  const orcamento = tipo === 'ORCAMENTO';
  const base = rotaDe(tipo);
  const { data: situacoes } = useSituacoes(orcamento ? 'ORCAMENTO' : 'VENDA');
  const { data: vendedores } = useVendedores();

  const params = { ...pg.filtros, tipo, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading, isFetching } = useQuery({
    queryKey: ['vendas', params],
    queryFn: () => api.get<Paginado<VendaResumo> & { resumo?: ResumoLista }>('/vendas', params),
    placeholderData: (prev) => prev,
  });

  const colunas: Coluna<VendaResumo>[] = [
    { chave: 'numero', titulo: 'Nº', largura: '80px', render: (v) => <span className="font-medium text-slate-900">{v.numero}</span> },
    { chave: 'data', titulo: 'Data', largura: '100px', render: (v) => <span className="text-slate-600">{data(v.data)}</span> },
    ...(orcamento
      ? [
          {
            chave: 'validade',
            titulo: 'Validade',
            largura: '100px',
            ocultarMobile: true,
            render: (v: VendaResumo) => {
              const vencido = !v.vendaGerada && !!v.validade && new Date(v.validade).getTime() < Date.now() - 86400000;
              return <span className={vencido ? 'font-medium text-red-600' : 'text-slate-600'} title={vencido ? 'Orçamento vencido' : undefined}>{v.validade ? data(v.validade) : '—'}</span>;
            },
          } as Coluna<VendaResumo>,
        ]
      : []),
    { chave: 'contato', titulo: 'Cliente', render: (v) => <span className="block max-w-[320px] truncate">{v.contato?.nome}</span> },
    { chave: 'vendedor', titulo: 'Vendedor', ocultarMobile: true, render: (v) => <span className="text-slate-500">{v.vendedor?.nome ?? '—'}</span> },
    { chave: 'origem', titulo: 'Origem', ocultarMobile: true, render: (v) => <span className="text-xs text-slate-500">{v.origem ? rotulo(v.origem) : '—'}</span> },
    {
      chave: 'situacao',
      titulo: 'Situação',
      render: (v) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge situacao={v.situacao} />
          {orcamento && v.aprovadoEm && !v.vendaGerada && <span title="Aprovado pelo cliente"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></span>}
        </span>
      ),
    },
    ...(orcamento
      ? [
          {
            chave: 'vendaGerada',
            titulo: 'Venda',
            ocultarMobile: true,
            largura: '90px',
            render: (v: VendaResumo) =>
              v.vendaGerada ? (
                <Link to={`/vendas/${v.vendaGerada.id}`} onClick={(e) => e.stopPropagation()} className="text-xs font-medium text-brand-600 hover:underline">
                  nº {v.vendaGerada.numero}
                </Link>
              ) : (
                <span className="text-xs text-slate-300">—</span>
              ),
          } as Coluna<VendaResumo>,
        ]
      : []),
    {
      chave: 'flags',
      titulo: 'Lanç.',
      ocultarMobile: true,
      render: (v) => (
        <span className="flex gap-1 text-[10px] font-semibold">
          <span className={`rounded px-1 ${v.estoqueLancado ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`} title="Estoque lançado">
            EST
          </span>
          <span className={`rounded px-1 ${v.contasLancadas ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`} title="Contas lançadas">
            FIN
          </span>
          {v.nota && (
            <span className={`inline-flex items-center gap-0.5 rounded px-1 ${v.nota.situacao === 'AUTORIZADA' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`} title={`NF-e ${v.nota.numero} ${v.nota.situacao}`}>
              <FileText className="h-3 w-3" /> NF
            </span>
          )}
          {!v.nota && v.roboNf?.status === 'PRONTA' && (
            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-600 px-1 text-white" title="Robô de NF: tudo preenchido — pronto pra emitir a NF">
              <CheckCircle2 className="h-3 w-3" /> NF
            </span>
          )}
        </span>
      ),
    },
    { chave: 'total', titulo: 'Total', direita: true, largura: '120px', render: (v) => <span className="font-medium">{moeda(v.total)}</span> },
    {
      chave: 'acoes',
      titulo: <span className="sr-only">Ações</span>,
      largura: '44px',
      direita: true,
      render: (v) => (
        // portais (menu e modais) propagam o clique pela árvore do React: segura aqui para não abrir a linha
        <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
          <VendaAcoes venda={v} />
        </div>
      ),
    },
  ];
  // orçamento não lança estoque/contas: sem a coluna "Lanç."
  const colunasVisiveis = orcamento ? colunas.filter((c) => c.chave !== 'flags') : colunas;
  const titulo = orcamento ? 'Orçamentos' : 'Pedidos de venda';
  const novo = orcamento ? 'Novo orçamento' : 'Nova venda';

  return (
    <div>
      <PageHeader
        titulo={titulo}
        descricao={resp ? `${resp.meta.total} ${orcamento ? 'orçamentos' : 'pedidos'}${orcamento ? ' · envie por e-mail/WhatsApp e converta em venda quando o cliente aprovar' : ''}` : undefined}
        acoes={
          <>
            {!orcamento && (
              <Link to="/orcamentos/novo">
                <Button variante="secundario" icone={<FileSignature className="h-4 w-4" />}>
                  Novo orçamento
                </Button>
              </Link>
            )}
            <Link to={`${base}/${orcamento ? 'novo' : 'nova'}`}>
              <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
                {novo}
              </Button>
            </Link>
          </>
        }
      />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nº, cliente, documento…" />
          <SelectFiltro valor={pg.getFiltro('vendedorId')} onChange={(v) => pg.setFiltro('vendedorId', v)} opcoes={opcoesDe(vendedores)} placeholder="Todos os vendedores" />
          <PeriodoFiltro
            inicial={pg.getFiltro('dataInicial')}
            final={pg.getFiltro('dataFinal')}
            onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })}
            label=""
          />
          <SelectFiltro
            valor={pg.getFiltro('origem')}
            onChange={(v) => pg.setFiltro('origem', v)}
            placeholder="Todas as origens"
            opcoes={['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'].map((o) => ({ valor: o, rotulo: rotulo(o) }))}
          />
          <PainelResumo r={resp?.resumo} periodo={nomePeriodo(pg.getFiltro('dataInicial'), pg.getFiltro('dataFinal'))} orcamento={orcamento} carregando={isFetching} />
        </BarraFiltros>
        <div className="border-b border-slate-100 px-3 py-2">
          <ChipsSituacao situacoes={situacoes ?? []} valor={pg.getFiltro('situacoes')} onChange={(v) => pg.setFiltro('situacoes', v)} />
        </div>
        <Table
          colunas={colunasVisiveis}
          dados={resp?.data}
          carregando={isLoading}
          chave={(v) => v.id}
          onClickLinha={(v) => nav(`${base}/${v.id}`)}
          cartao={(v) => (
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">
                  {orcamento ? 'Orçamento' : 'Venda'} {v.numero}
                </span>
                <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(v.total)}</span>
              </div>
              <div className="truncate text-sm text-slate-700">{v.contato?.nome}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <StatusBadge situacao={v.situacao} />
                <span>{data(v.data)}</span>
                {v.vendedor?.nome && <span>· {v.vendedor.nome}</span>}
              </div>
            </div>
          )}
          vazio={
            <EmptyState
              icone={orcamento ? <FileSignature className="h-5 w-5" /> : <ShoppingCart className="h-5 w-5" />}
              titulo={orcamento ? 'Nenhum orçamento encontrado' : 'Nenhuma venda encontrada'}
              descricao={orcamento ? 'Monte um orçamento, envie ao cliente e converta em venda quando ele aprovar.' : 'Ajuste os filtros ou registre a primeira venda.'}
              acao={
                <Link to={`${base}/${orcamento ? 'novo' : 'nova'}`}>
                  <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
                    {novo}
                  </Button>
                </Link>
              }
            />
          }
        />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
