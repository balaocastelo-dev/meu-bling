import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Package, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useCategoriasProduto } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, PageHeader, Pagination, SelectFiltro, Table, type Coluna } from '@/components/ui';
import { moeda, numero } from '@/lib/format';
import type { Paginado, Produto } from '@/types';

/** Lista de produtos e serviços */
export default function ProdutosLista() {
  const nav = useNavigate();
  const pg = usePaginacao();
  const { data: categorias } = useCategoriasProduto();
  const params = { ...pg.filtros, ativo: pg.getFiltro('ativo') || 'true', pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['produtos', params], queryFn: () => api.get<Paginado<Produto>>('/produtos', params), placeholderData: (p) => p });

  const colunas: Coluna<Produto>[] = [
    { chave: 'codigo', titulo: 'Código', largura: '110px', render: (p) => <span className="font-mono text-xs text-slate-500">{p.codigo || '—'}</span> },
    {
      chave: 'nome',
      titulo: 'Produto',
      render: (p) => (
        <div className="flex items-center gap-3">
          {p.imagemUrl ? <img src={p.imagemUrl} alt="" className="h-8 w-8 rounded object-cover" /> : <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-slate-400"><Package className="h-4 w-4" /></span>}
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{p.nome}</p>
            <p className="truncate text-xs text-slate-400">{[p.marca, p.categoria?.nome, p.gtin && `GTIN ${p.gtin}`].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
      ),
    },
    { chave: 'tipo', titulo: 'Tipo', largura: '80px', ocultarMobile: true, render: (p) => <Badge tom={p.tipo === 'S' ? 'roxo' : 'neutro'}>{p.tipo === 'S' ? 'Serviço' : 'Produto'}</Badge> },
    { chave: 'preco', titulo: 'Preço', direita: true, largura: '110px', render: (p) => <span className="font-medium">{moeda(p.preco)}</span> },
    { chave: 'custo', titulo: 'Custo', direita: true, largura: '110px', ocultarMobile: true, render: (p) => <span className="text-slate-500">{moeda(p.precoCusto)}</span> },
    {
      chave: 'estoque',
      titulo: 'Estoque',
      direita: true,
      largura: '100px',
      render: (p) => {
        if (p.tipo === 'S' || !p.controlaEstoque) return <span className="text-slate-300">—</span>;
        const e = p.estoqueTotal ?? 0;
        const abaixo = e <= p.estoqueMinimo;
        return (
          <span className={clsx('font-medium', e <= 0 ? 'text-red-600' : abaixo ? 'text-amber-600' : 'text-slate-800')}>
            {numero(e)}
            {(p.estoqueReservado ?? 0) > 0 && <span className="ml-1 text-xs font-normal text-slate-400">(-{numero(p.estoqueReservado)})</span>}
          </span>
        );
      },
    },
    { chave: 'ativo', titulo: '', largura: '70px', render: (p) => (!p.ativo ? <Badge tom="cinza">Inativo</Badge> : null) },
  ];

  return (
    <div>
      <PageHeader
        titulo="Produtos e serviços"
        descricao={resp ? `${resp.meta.total} itens` : undefined}
        acoes={
          <Link to="/produtos/novo">
            <Button variante="primario" icone={<Plus className="h-4 w-4" />}>Novo produto</Button>
          </Link>
        }
      />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nome, código, GTIN, marca…" autoFocus />
          <SelectFiltro valor={pg.getFiltro('tipo')} onChange={(v) => pg.setFiltro('tipo', v)} placeholder="Produtos e serviços" opcoes={[{ valor: 'P', rotulo: 'Produtos' }, { valor: 'S', rotulo: 'Serviços' }]} />
          <SelectFiltro valor={pg.getFiltro('categoriaId')} onChange={(v) => pg.setFiltro('categoriaId', v)} placeholder="Todas categorias" opcoes={(categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))} />
          <SelectFiltro valor={pg.getFiltro('estoque')} onChange={(v) => pg.setFiltro('estoque', v)} placeholder="Qualquer estoque" opcoes={[{ valor: 'positivo', rotulo: 'Com estoque' }, { valor: 'zerado', rotulo: 'Zerado' }, { valor: 'negativo', rotulo: 'Negativo' }, { valor: 'abaixoMinimo', rotulo: 'Abaixo do mínimo' }]} />
          <SelectFiltro valor={pg.getFiltro('ativo') || 'true'} onChange={(v) => pg.setFiltro('ativo', v)} placeholder="Todos" opcoes={[{ valor: 'true', rotulo: 'Ativos' }, { valor: 'false', rotulo: 'Inativos' }]} />
        </BarraFiltros>
        <Table colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(p) => p.id} onClickLinha={(p) => nav(`/produtos/${p.id}`)} vazio={<EmptyState icone={<Package className="h-5 w-5" />} titulo="Nenhum produto encontrado" acao={<Link to="/produtos/novo"><Button variante="primario">Cadastrar produto</Button></Link>} />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
