import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Plus, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSituacoes, useVendedores, opcoesDe } from '@/hooks/useListas';
import { BarraFiltros, BuscaFiltro, Button, Card, ChipsSituacao, EmptyState, PageHeader, Pagination, PeriodoFiltro, SelectFiltro, StatusBadge, Table, type Coluna } from '@/components/ui';
import { data, moeda, rotulo } from '@/lib/format';
import type { Paginado, VendaResumo } from '@/types';

/** Lista de pedidos de venda */
export default function VendasLista() {
  const nav = useNavigate();
  const pg = usePaginacao();
  const { data: situacoes } = useSituacoes('VENDA');
  const { data: vendedores } = useVendedores();

  const params = { ...pg.filtros, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({
    queryKey: ['vendas', params],
    queryFn: () => api.get<Paginado<VendaResumo>>('/vendas', params),
    placeholderData: (prev) => prev,
  });

  const colunas: Coluna<VendaResumo>[] = [
    { chave: 'numero', titulo: 'Nº', largura: '80px', render: (v) => <span className="font-medium text-slate-900">{v.numero}</span> },
    { chave: 'data', titulo: 'Data', largura: '100px', render: (v) => <span className="text-slate-600">{data(v.data)}</span> },
    { chave: 'contato', titulo: 'Cliente', render: (v) => <span className="block max-w-[320px] truncate">{v.contato?.nome}</span> },
    { chave: 'vendedor', titulo: 'Vendedor', ocultarMobile: true, render: (v) => <span className="text-slate-500">{v.vendedor?.nome ?? '—'}</span> },
    { chave: 'origem', titulo: 'Origem', ocultarMobile: true, render: (v) => <span className="text-xs text-slate-500">{v.origem ? rotulo(v.origem) : '—'}</span> },
    { chave: 'situacao', titulo: 'Situação', render: (v) => <StatusBadge situacao={v.situacao} /> },
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
        </span>
      ),
    },
    { chave: 'total', titulo: 'Total', direita: true, largura: '120px', render: (v) => <span className="font-medium">{moeda(v.total)}</span> },
  ];

  return (
    <div>
      <PageHeader
        titulo="Pedidos de venda"
        descricao={resp ? `${resp.meta.total} pedidos` : undefined}
        acoes={
          <Link to="/vendas/nova">
            <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
              Nova venda
            </Button>
          </Link>
        }
      />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nº, cliente, documento…" />
          <SelectFiltro valor={pg.getFiltro('vendedorId')} onChange={(v) => pg.setFiltro('vendedorId', v)} opcoes={opcoesDe(vendedores)} placeholder="Todos os vendedores" />
          <PeriodoFiltro
            inicial={pg.getFiltro('dataInicial')}
            final={pg.getFiltro('dataFinal')}
            onChange={(i, f) => {
              pg.setFiltro('dataInicial', i);
              pg.setFiltro('dataFinal', f);
            }}
            label=""
          />
          <SelectFiltro
            valor={pg.getFiltro('origem')}
            onChange={(v) => pg.setFiltro('origem', v)}
            placeholder="Todas as origens"
            opcoes={['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'].map((o) => ({ valor: o, rotulo: rotulo(o) }))}
          />
        </BarraFiltros>
        <div className="border-b border-slate-100 px-3 py-2">
          <ChipsSituacao situacoes={situacoes ?? []} valor={pg.getFiltro('situacoes')} onChange={(v) => pg.setFiltro('situacoes', v)} />
        </div>
        <Table
          colunas={colunas}
          dados={resp?.data}
          carregando={isLoading}
          chave={(v) => v.id}
          onClickLinha={(v) => nav(`/vendas/${v.id}`)}
          vazio={
            <EmptyState
              icone={<ShoppingCart className="h-5 w-5" />}
              titulo="Nenhuma venda encontrada"
              descricao="Ajuste os filtros ou registre a primeira venda."
              acao={
                <Link to="/vendas/nova">
                  <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
                    Nova venda
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
