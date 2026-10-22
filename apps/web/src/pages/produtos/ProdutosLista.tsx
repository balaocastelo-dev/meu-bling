import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Globe, Package, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useCategoriasProduto } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, PageHeader, Pagination, SelectFiltro, Table, type Coluna } from '@/components/ui';
import { moeda, numero } from '@/lib/format';
import type { Paginado, Produto } from '@/types';
import { CatalogoDoSite } from '@/components/compartilhados/CatalogoDoSite';
import { FotoProduto, SeloProntaEntrega } from '@/components/compartilhados/ProdutoSite';

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
          <FotoProduto url={p.imagemUrl} tamanho="md" />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">{p.nome}</p>
            <p className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
              {p.prontaEntrega && <SeloProntaEntrega compacto />}
              {p.siteId && !p.prontaEntrega && <span className="whitespace-nowrap text-slate-500">{p.disponibilidade || 'Do site'}</span>}
              <span className="truncate">{[p.marca, p.categoria?.nome, p.fornecedor, p.gtin && `GTIN ${p.gtin}`].filter(Boolean).join(' · ')}</span>
            </p>
          </div>
        </div>
      ),
    },
    { chave: 'tipo', titulo: 'Tipo', largura: '80px', ocultarMobile: true, render: (p) => <Badge tom={p.tipo === 'S' ? 'roxo' : 'neutro'}>{p.tipo === 'S' ? 'Serviço' : 'Produto'}</Badge> },
    {
      chave: 'preco',
      titulo: 'Preço',
      direita: true,
      largura: '120px',
      render: (p) => (
        <div>
          <span className="font-medium">{moeda(p.preco)}</span>
          {p.precoCartao && p.precoCartao !== p.preco ? <p className="text-xs text-slate-400">cartão {moeda(p.precoCartao)}</p> : null}
        </div>
      ),
    },
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
    {
      chave: 'ativo',
      titulo: '',
      largura: '70px',
      render: (p) => (!p.ativo ? <Badge tom="cinza">Inativo</Badge> : p.siteId ? <span title="Produto do site www.balao.info"><Globe className="h-3.5 w-3.5 text-sky-500" /></span> : null),
    },
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
      <CatalogoDoSite />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nome, código, GTIN, marca…" autoFocus />
          <SelectFiltro valor={pg.getFiltro('tipo')} onChange={(v) => pg.setFiltro('tipo', v)} placeholder="Produtos e serviços" opcoes={[{ valor: 'P', rotulo: 'Produtos' }, { valor: 'S', rotulo: 'Serviços' }]} />
          <SelectFiltro valor={pg.getFiltro('categoriaId')} onChange={(v) => pg.setFiltro('categoriaId', v)} placeholder="Todas categorias" opcoes={(categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome }))} />
          <SelectFiltro valor={pg.getFiltro('estoque')} onChange={(v) => pg.setFiltro('estoque', v)} placeholder="Qualquer estoque" opcoes={[{ valor: 'positivo', rotulo: 'Com estoque' }, { valor: 'zerado', rotulo: 'Zerado' }, { valor: 'negativo', rotulo: 'Negativo' }, { valor: 'abaixoMinimo', rotulo: 'Abaixo do mínimo' }]} />
          <SelectFiltro valor={pg.getFiltro('prontaEntrega')} onChange={(v) => pg.setFiltro('prontaEntrega', v)} placeholder="Pronta entrega ou não" opcoes={[{ valor: 'true', rotulo: 'Pronta entrega' }, { valor: 'false', rotulo: 'Do distribuidor' }]} />
          <SelectFiltro valor={pg.getFiltro('origem')} onChange={(v) => pg.setFiltro('origem', v)} placeholder="Site e outros" opcoes={[{ valor: 'site', rotulo: 'Do site' }, { valor: 'fora', rotulo: 'Fora do site' }]} />
          <SelectFiltro valor={pg.getFiltro('ativo') || 'true'} onChange={(v) => pg.setFiltro('ativo', v)} placeholder="Todos" opcoes={[{ valor: 'true', rotulo: 'Ativos' }, { valor: 'false', rotulo: 'Inativos' }]} />
        </BarraFiltros>
        <Table colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(p) => p.id} onClickLinha={(p) => nav(`/produtos/${p.id}`)} vazio={<EmptyState icone={<Package className="h-5 w-5" />} titulo="Nenhum produto encontrado" acao={<Link to="/produtos/novo"><Button variante="primario">Cadastrar produto</Button></Link>} />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
