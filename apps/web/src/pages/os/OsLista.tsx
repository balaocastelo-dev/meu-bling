import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { Clock, Kanban, List, Plus, TriangleAlert, Wrench } from 'lucide-react';
import { api, ApiError, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSituacoes, useTecnicos, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, ChipsSituacao, EmptyState, PageHeader, Pagination, PeriodoFiltro, Segmentado, SelectFiltro, Skeleton, StatusBadge, Table, type Coluna } from '@/components/ui';
import { data, diasAtraso, moeda, rotulo, truncar } from '@/lib/format';
import type { KanbanColuna, OsResumo, Paginado, SituacaoRef } from '@/types';

const PRIORIDADE_TOM: Record<string, 'neutro' | 'azul' | 'amarelo' | 'vermelho'> = { BAIXA: 'neutro', NORMAL: 'azul', ALTA: 'amarelo', URGENTE: 'vermelho' };

/** Card de OS no kanban */
function CardOs({ os, onDragStart }: { os: OsResumo; onDragStart: (e: React.DragEvent) => void }) {
  const atrasada = os.atrasada ?? (os.dataPrevista ? diasAtraso(os.dataPrevista) > 0 : false);
  return (
    <Link
      to={`/ordens-servico/${os.id}`}
      draggable
      onDragStart={onDragStart}
      className={clsx('block cursor-grab rounded-md border bg-white p-2.5 text-sm shadow-xs transition hover:shadow active:cursor-grabbing', atrasada ? 'border-red-200' : 'border-slate-200')}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-slate-900">OS {os.numero}</span>
        <Badge tom={PRIORIDADE_TOM[os.prioridade] ?? 'neutro'}>{rotulo(os.prioridade)}</Badge>
      </div>
      <p className="mt-1 truncate text-slate-700">{os.contato?.nome}</p>
      <p className="truncate text-xs text-slate-500">{[os.equipamento, os.marca, os.modelo].filter(Boolean).join(' ') || 'Equipamento não informado'}</p>
      {os.defeitoRelatado && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{truncar(os.defeitoRelatado, 90)}</p>}
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span className={clsx('inline-flex items-center gap-1', atrasada && 'font-medium text-red-600')}>
          {atrasada ? <TriangleAlert className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {os.dataPrevista ? data(os.dataPrevista) : data(os.dataEntrada)}
        </span>
        <span className="num font-medium text-slate-600">{moeda(os.total)}</span>
      </div>
      {(os.tecnico || os.orcar) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
          {os.tecnico && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{os.tecnico.nome.split(' ')[0]}</span>}
          {os.orcar && <span className={clsx('rounded px-1.5 py-0.5', os.orcamentoAprovado ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>{os.orcamentoAprovado ? 'Orç. aprovado' : 'Orçar'}</span>}
        </div>
      )}
    </Link>
  );
}

/** Kanban de OS com drag & drop HTML5 */
function KanbanOs({ tecnicoId, dataInicial, dataFinal }: { tecnicoId: string; dataInicial: string; dataFinal: string }) {
  const qc = useQueryClient();
  const { data: colunas, isLoading, error } = useQuery({ queryKey: ['os-kanban', tecnicoId, dataInicial, dataFinal], queryFn: () => api.get<KanbanColuna[]>('/ordens-servico/kanban', { tecnicoId, dataInicial, dataFinal }), refetchInterval: 60_000 });
  const [sobre, setSobre] = useState<number | null>(null);

  const mover = useMutation({
    mutationFn: (p: { osId: number; situacaoId: number; forcar?: boolean }) => api.post<{ situacao: SituacaoRef }>(`/ordens-servico/${p.osId}/situacao`, { situacaoId: p.situacaoId, forcar: p.forcar }),
    onSuccess: (r) => {
      toast.success(`OS movida para "${r?.situacao?.nome ?? ''}"`);
      qc.invalidateQueries({ queryKey: ['os-kanban'] });
      qc.invalidateQueries({ queryKey: ['ordens-servico'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'TRANSICAO_INVALIDA') {
        const det = (e.detalhes ?? {}) as { permitidas?: SituacaoRef[] };
        toast.error('Transição não permitida', { description: det.permitidas?.length ? `Permitidas: ${det.permitidas.map((p) => p.nome).join(', ')}` : e.message });
      } else toast.error(mensagemErro(e));
    },
  });

  if (isLoading) return <div className="flex gap-3 overflow-x-auto">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-80 w-72 shrink-0" />)}</div>;
  if (error || !colunas) return <EmptyState titulo="Não foi possível carregar o kanban" descricao={error ? mensagemErro(error) : undefined} />;

  return (
    <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-3 sm:-mx-4 sm:px-4 md:-mx-6 md:px-6">
      {colunas.map((col) => (
        <div
          key={col.situacao.id}
          onDragOver={(e) => {
            e.preventDefault();
            setSobre(col.situacao.id);
          }}
          onDragLeave={() => setSobre(null)}
          onDrop={(e) => {
            e.preventDefault();
            setSobre(null);
            const osId = Number(e.dataTransfer.getData('text/os-id'));
            const origem = Number(e.dataTransfer.getData('text/situacao-id'));
            if (osId && origem !== col.situacao.id) mover.mutate({ osId, situacaoId: col.situacao.id });
          }}
          className={clsx('flex w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-lg border bg-slate-100/70 transition sm:w-72', sobre === col.situacao.id ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200')}
        >
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: col.situacao.cor }} />
            <span className="text-sm font-semibold text-slate-800">{col.situacao.nome}</span>
            <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">{col.ordens.length}</span>
          </div>
          <div className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2" style={{ maxHeight: 'calc(100vh - 260px)' }}>
            {col.ordens.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Arraste uma OS para cá</p>}
            {col.ordens.map((os) => (
              <CardOs
                key={os.id}
                os={os}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/os-id', String(os.id));
                  e.dataTransfer.setData('text/situacao-id', String(col.situacao.id));
                  e.dataTransfer.effectAllowed = 'move';
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lista de OS em tabela */
function ListaOs({ tecnicoId }: { tecnicoId: string }) {
  const nav = useNavigate();
  const pg = usePaginacao();
  const { data: situacoes } = useSituacoes('OS');
  const params = { ...pg.filtros, tecnicoId, pagina: pg.pagina, limite: pg.limite, visao: undefined };
  const { data: resp, isLoading } = useQuery({ queryKey: ['ordens-servico', params], queryFn: () => api.get<Paginado<OsResumo>>('/ordens-servico', params), placeholderData: (p) => p });

  const colunas: Coluna<OsResumo>[] = [
    { chave: 'numero', titulo: 'Nº', largura: '70px', render: (o) => <span className="font-medium text-slate-900">{o.numero}</span> },
    { chave: 'entrada', titulo: 'Entrada', largura: '100px', render: (o) => data(o.dataEntrada) },
    { chave: 'contato', titulo: 'Cliente', render: (o) => <span className="block max-w-[240px] truncate">{o.contato?.nome}</span> },
    { chave: 'equip', titulo: 'Equipamento', ocultarMobile: true, render: (o) => <span className="block max-w-[220px] truncate text-slate-600">{[o.equipamento, o.marca, o.modelo].filter(Boolean).join(' ') || '—'}</span> },
    { chave: 'tecnico', titulo: 'Técnico', ocultarMobile: true, render: (o) => <span className="text-slate-500">{o.tecnico?.nome ?? '—'}</span> },
    { chave: 'prioridade', titulo: 'Prioridade', ocultarMobile: true, render: (o) => <Badge tom={PRIORIDADE_TOM[o.prioridade] ?? 'neutro'}>{rotulo(o.prioridade)}</Badge> },
    { chave: 'situacao', titulo: 'Situação', render: (o) => <StatusBadge situacao={o.situacao} /> },
    {
      chave: 'prev',
      titulo: 'Previsão',
      ocultarMobile: true,
      render: (o) => {
        const atr = o.atrasada ?? (o.dataPrevista ? diasAtraso(o.dataPrevista) > 0 : false);
        return <span className={atr ? 'font-medium text-red-600' : 'text-slate-500'}>{o.dataPrevista ? data(o.dataPrevista) : '—'}</span>;
      },
    },
    { chave: 'total', titulo: 'Total', direita: true, largura: '110px', render: (o) => <span className="font-medium">{moeda(o.total)}</span> },
  ];

  return (
    <Card semPadding>
      <BarraFiltros>
        <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nº, cliente, equipamento, série…" />
        <SelectFiltro valor={pg.getFiltro('prioridade')} onChange={(v) => pg.setFiltro('prioridade', v)} placeholder="Todas prioridades" opcoes={['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'].map((p) => ({ valor: p, rotulo: rotulo(p) }))} />
      </BarraFiltros>
      <div className="border-b border-slate-100 px-3 py-2">
        <ChipsSituacao situacoes={situacoes ?? []} valor={pg.getFiltro('situacoes')} onChange={(v) => pg.setFiltro('situacoes', v)} />
      </div>
      <Table
        colunas={colunas}
        dados={resp?.data}
        carregando={isLoading}
        chave={(o) => o.id}
        onClickLinha={(o) => nav(`/ordens-servico/${o.id}`)}
        cartao={(o) => (
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">OS {o.numero}</span>
              <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(o.total)}</span>
            </div>
            <div className="truncate text-sm text-slate-700">{o.contato?.nome}</div>
            {(o.equipamento || o.marca || o.modelo) && <div className="truncate text-xs text-slate-500">{[o.equipamento, o.marca, o.modelo].filter(Boolean).join(' ')}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
              <StatusBadge situacao={o.situacao} />
              <span>entrada {data(o.dataEntrada)}</span>
              {o.tecnico?.nome && <span>· {o.tecnico.nome}</span>}
            </div>
          </div>
        )} vazio={<EmptyState icone={<Wrench className="h-5 w-5" />} titulo="Nenhuma OS encontrada" acao={<Link to="/ordens-servico/nova"><Button variante="primario">Nova OS</Button></Link>} />} />
      {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
    </Card>
  );
}

/** Página de ordens de serviço (toggle kanban/lista) */
export default function OsLista() {
  const pg = usePaginacao();
  const visao = (pg.getFiltro('visao') || 'kanban') as 'kanban' | 'lista';
  const tecnicoId = pg.getFiltro('tecnicoId');
  const dataInicial = pg.getFiltro('dataInicial');
  const dataFinal = pg.getFiltro('dataFinal');
  const { data: tecnicos } = useTecnicos();

  return (
    <div>
      <PageHeader
        titulo="Ordens de serviço"
        descricao="Assistência técnica — arraste os cards entre as colunas para mudar a situação."
        acoes={
          <>
            <SelectFiltro valor={tecnicoId} onChange={(v) => pg.setFiltro('tecnicoId', v)} opcoes={opcoesDe(tecnicos)} placeholder="Todos os técnicos" />
            <Segmentado
              valor={visao}
              onMudar={(v) => pg.setFiltro('visao', v)}
              opcoes={[
                { valor: 'kanban', rotulo: 'Kanban', icone: <Kanban className="h-3.5 w-3.5" /> },
                { valor: 'lista', rotulo: 'Lista', icone: <List className="h-3.5 w-3.5" /> },
              ]}
            />
            <Link to="/ordens-servico/nova">
              <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
                Nova OS
              </Button>
            </Link>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PeriodoFiltro inicial={dataInicial} final={dataFinal} onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })} label="" />
        <span className="text-[11px] text-slate-400">{dataInicial || dataFinal ? 'OS que entraram no período' : visao === 'kanban' ? 'Tudo: abertas + finalizadas nos últimos 7 dias' : 'Todas as OS'}</span>
      </div>
      {visao === 'kanban' ? <KanbanOs tecnicoId={tecnicoId} dataInicial={dataInicial} dataFinal={dataFinal} /> : <ListaOs tecnicoId={tecnicoId} />}
    </div>
  );
}
