import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, PageHeader, Pagination, SelectFiltro, Table, Tabs, type Coluna } from '@/components/ui';
import { documento, telefone } from '@/lib/format';
import type { Contato, Paginado } from '@/types';

/** Lista de contatos com abas Clientes / Fornecedores / Transportadoras */
export default function ContatosLista() {
  const nav = useNavigate();
  const pg = usePaginacao();
  const tipo = pg.getFiltro('tipo') || 'CLIENTE';
  const params = { pesquisa: pg.getFiltro('pesquisa'), tipo, ativo: pg.getFiltro('ativo') || 'true', pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['contatos', params], queryFn: () => api.get<Paginado<Contato>>('/contatos', params), placeholderData: (p) => p });

  const colunas: Coluna<Contato>[] = [
    {
      chave: 'nome',
      titulo: 'Nome',
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{c.nome}</p>
          {c.fantasia && <p className="truncate text-xs text-slate-400">{c.fantasia}</p>}
        </div>
      ),
    },
    { chave: 'documento', titulo: 'CPF/CNPJ', ocultarMobile: true, render: (c) => <span className="num text-slate-600">{documento(c.documento) || '—'}</span> },
    { chave: 'celular', titulo: 'Celular / telefone', render: (c) => <span className="text-slate-600">{telefone(c.celular) || telefone(c.telefone) || '—'}</span> },
    { chave: 'email', titulo: 'E-mail', ocultarMobile: true, render: (c) => <span className="text-slate-500">{c.email || '—'}</span> },
    { chave: 'cidade', titulo: 'Cidade', ocultarMobile: true, render: (c) => <span className="text-slate-500">{c.municipio ? `${c.municipio}/${c.uf}` : '—'}</span> },
    { chave: 'ativo', titulo: 'Situação', largura: '90px', render: (c) => <Badge tom={c.ativo ? 'verde' : 'cinza'}>{c.ativo ? 'Ativo' : 'Inativo'}</Badge> },
  ];

  const rotuloTipo = tipo === 'FORNECEDOR' ? 'fornecedor' : tipo === 'TRANSPORTADORA' ? 'transportadora' : 'cliente';

  return (
    <div>
      <PageHeader
        titulo="Contatos"
        descricao={resp ? `${resp.meta.total} ${rotuloTipo}${resp.meta.total === 1 ? '' : 's'}` : undefined}
        acoes={
          <Link to={`/contatos/novo?tipo=${tipo}`}>
            <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
              Novo {rotuloTipo}
            </Button>
          </Link>
        }
      />
      <Card semPadding>
        <Tabs
          className="px-3"
          ativa={tipo}
          onMudar={(t) => pg.setFiltro('tipo', t)}
          abas={[
            { id: 'CLIENTE', rotulo: 'Clientes' },
            { id: 'FORNECEDOR', rotulo: 'Fornecedores' },
            { id: 'TRANSPORTADORA', rotulo: 'Transportadoras' },
          ]}
        />
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nome, documento, e-mail, telefone…" autoFocus />
          <SelectFiltro valor={pg.getFiltro('ativo') || 'true'} onChange={(v) => pg.setFiltro('ativo', v)} placeholder="Todos" opcoes={[{ valor: 'true', rotulo: 'Ativos' }, { valor: 'false', rotulo: 'Inativos' }]} />
        </BarraFiltros>
        <Table
          colunas={colunas}
          dados={resp?.data}
          carregando={isLoading}
          chave={(c) => c.id}
          onClickLinha={(c) => nav(`/contatos/${c.id}`)}
          vazio={<EmptyState icone={<Users className="h-5 w-5" />} titulo={`Nenhum ${rotuloTipo} encontrado`} acao={<Link to={`/contatos/novo?tipo=${tipo}`}><Button variante="primario">Cadastrar</Button></Link>} />}
        />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
