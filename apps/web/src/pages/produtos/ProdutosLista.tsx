import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { FileText, Globe, Package, Pencil, Plus, Tag } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSelecao } from '@/hooks/useSelecao';
import { useAuth } from '@/stores/auth';
import { useCategoriasProduto } from '@/hooks/useListas';
import { BarraSelecao, type AcaoLote } from '@/components/compartilhados/BarraSelecao';
import { relatorioDaSelecao } from '@/components/compartilhados/relatorioSelecao';
import { EtiquetaModal } from '@/components/compartilhados/EtiquetaModal';
import { EditarEmLote } from '@/components/compartilhados/EditarEmLote';
import { ReajustePrecoModal } from '@/components/compartilhados/ReajustePreco';
import type { Etiqueta } from '@/components/compartilhados/etiquetas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, PageHeader, Pagination, SelectFiltro, Table, type Coluna, ValorOculto } from '@/components/ui';
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

  const qc = useQueryClient();
  const selecao = useSelecao();
  const ehGestao = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);
  const [editar, setEditar] = useState(false);
  const [reajuste, setReajuste] = useState(false);
  const marcados = () => (resp?.data ?? []).filter((x) => selecao.ids.includes(x.id));

  const acoes: AcaoLote[] = [
    {
      rotulo: 'Etiquetas',
      icone: <Tag className="h-3.5 w-3.5" />,
      executar: async () => {
        setEtiquetas(
          marcados().map((x) => ({
            titulo: x.nome,
            linhas: [[x.marca, x.categoria?.nome].filter(Boolean).join(' · ')].filter(Boolean) as string[],
            destaque: moeda(x.preco),
            // o leitor da loja lê o código de barras do fabricante quando houver; senão, o SKU
            codigo: x.gtin || x.codigo || String(x.id),
          })),
        );
        return selecao.ids; // o diálogo ainda vai perguntar formato e cópias
      },
    },
    {
      rotulo: 'Relatório',
      icone: <FileText className="h-3.5 w-3.5" />,
      executar: async () => {
        const m = marcados();
        relatorioDaSelecao({
          titulo: 'Produtos selecionados',
          colunas: ['Código', 'Produto', 'Marca', 'Categoria', 'Estoque', 'Preço'],
          linhas: m.map((x) => [x.codigo ?? '', x.nome, x.marca ?? '', x.categoria?.nome ?? '', numero(x.estoqueTotal ?? 0), moeda(x.preco)]),
          totais: { 'Preço somado': moeda(m.reduce((t, x) => t + x.preco, 0)) },
        });
      },
    },
    ...(ehGestao
      ? [
          {
            rotulo: 'Reajustar preço',
            icone: <Tag className="h-3.5 w-3.5" />,
            executar: async () => {
              setReajuste(true);
              return selecao.ids;
            },
          },
          {
            rotulo: 'Editar em lote',
            icone: <Pencil className="h-3.5 w-3.5" />,
            executar: async () => {
              setEditar(true);
              return selecao.ids;
            },
          },
        ]
      : []),
  ];

  const colunas: Coluna<Produto>[] = [
    { chave: 'codigo', titulo: 'Código', largura: '110px', render: (p) => <span className="font-mono text-xs text-slate-500">{p.codigo || '—'}</span> },
    {
      chave: 'nome',
      titulo: 'Produto',
      noCartao: 'titulo',
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
    { chave: 'custo', titulo: 'Custo', direita: true, largura: '110px', ocultarMobile: true, render: (p) => <ValorOculto className="text-slate-500">{moeda(p.precoCusto)}</ValorOculto> },
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
        <BarraSelecao selecao={selecao} acoes={acoes} nome="produto marcado" nomePlural="produtos marcados" />
        <Table selecao={selecao} colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(p) => p.id} onClickLinha={(p) => nav(`/produtos/${p.id}`)} vazio={<EmptyState icone={<Package className="h-5 w-5" />} titulo="Nenhum produto encontrado" acao={<Link to="/produtos/novo"><Button variante="primario">Cadastrar produto</Button></Link>} />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}

        <EtiquetaModal
          aberto={!!etiquetas}
          onFechar={() => {
            setEtiquetas(null);
            selecao.limpar();
          }}
          etiquetas={etiquetas ?? []}
          titulo="Etiquetas de produto"
        />
        <EditarEmLote
          aberto={editar}
          onFechar={() => setEditar(false)}
          ids={selecao.ids}
          nome="produto"
          nomePlural="produtos"
          campos={[
            { chave: 'categoriaId', rotulo: 'Categoria', opcoes: (categorias ?? []).map((c) => ({ valor: c.id, rotulo: c.nome })), aplicar: (id, v) => api.put(`/produtos/${id}`, { categoriaId: Number(v) }) },
            { chave: 'ativo', rotulo: 'Situação', opcoes: [{ valor: 'true', rotulo: 'Ativo' }, { valor: 'false', rotulo: 'Inativo' }], aplicar: (id, v) => api.put(`/produtos/${id}`, { ativo: v === 'true' }), aviso: 'Produto inativo some da venda e do site, mas continua no histórico.' },
            { chave: 'prontaEntrega', rotulo: 'Pronta entrega', opcoes: [{ valor: 'true', rotulo: 'Sim' }, { valor: 'false', rotulo: 'Não' }], aplicar: (id, v) => api.put(`/produtos/${id}`, { prontaEntrega: v === 'true' }) },
          ]}
          aoTerminar={(falhas) => {
            selecao.definir(falhas);
            qc.invalidateQueries({ queryKey: ['produtos'] });
          }}
        />
        <ReajustePrecoModal
          aberto={reajuste}
          onFechar={() => setReajuste(false)}
          produtos={marcados()}
          aoTerminar={(falhas) => {
            selecao.definir(falhas);
            qc.invalidateQueries({ queryKey: ['produtos'] });
          }}
        />
      </Card>
    </div>
  );
}
