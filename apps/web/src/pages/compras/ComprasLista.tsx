import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileUp, Plus, ShoppingBag } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useSituacoes } from '@/hooks/useListas';
import { BarraFiltros, BuscaFiltro, Button, Card, ChipsSituacao, EmptyState, PageHeader, Pagination, PeriodoFiltro, StatusBadge, Table, type Coluna } from '@/components/ui';
import { data, moeda } from '@/lib/format';
import type { CompraResumo, Paginado } from '@/types';

/** Lista de pedidos de compra + importação de XML */
export default function ComprasLista() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const pg = usePaginacao();
  const { data: situacoes } = useSituacoes('COMPRA');
  const fileRef = useRef<HTMLInputElement>(null);
  const [importando, setImportando] = useState(false);

  const params = { ...pg.filtros, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['compras', params], queryFn: () => api.get<Paginado<CompraResumo>>('/compras', params), placeholderData: (p) => p });

  const importar = useMutation({
    mutationFn: (arquivo: File) => {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      return api.upload<{ compraId: number; itensNovos: string[] }>('/compras/importar-xml', fd);
    },
    onSuccess: (r) => {
      toast.success('XML importado.', { description: r.itensNovos?.length ? `${r.itensNovos.length} produto(s) novo(s) criado(s).` : undefined });
      qc.invalidateQueries({ queryKey: ['compras'] });
      nav(`/compras/${r.compraId}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
    onSettled: () => setImportando(false),
  });

  const colunas: Coluna<CompraResumo>[] = [
    { chave: 'numero', titulo: 'Nº', largura: '80px', render: (c) => <span className="font-medium text-slate-900">{c.numero}</span> },
    { chave: 'data', titulo: 'Data', largura: '100px', render: (c) => data(c.data) },
    { chave: 'fornecedor', titulo: 'Fornecedor', render: (c) => <span className="block max-w-[320px] truncate">{c.fornecedor?.nome}</span> },
    { chave: 'nf', titulo: 'NF', ocultarMobile: true, render: (c) => <span className="text-slate-500">{c.nfeNumero ?? '—'}</span> },
    { chave: 'prev', titulo: 'Previsão', ocultarMobile: true, render: (c) => (c.dataPrevista ? data(c.dataPrevista) : '—') },
    { chave: 'situacao', titulo: 'Situação', render: (c) => <StatusBadge situacao={c.situacao} /> },
    {
      chave: 'flags',
      titulo: 'Lanç.',
      ocultarMobile: true,
      render: (c) => (
        <span className="flex gap-1 text-[10px] font-semibold">
          <span className={`rounded px-1 ${c.estoqueLancado ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>EST</span>
          <span className={`rounded px-1 ${c.contasLancadas ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>FIN</span>
        </span>
      ),
    },
    { chave: 'total', titulo: 'Total', direita: true, largura: '120px', render: (c) => <span className="font-medium">{moeda(c.total)}</span> },
  ];

  return (
    <div>
      <PageHeader
        titulo="Pedidos de compra"
        descricao={resp ? `${resp.meta.total} pedidos` : undefined}
        acoes={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,text/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setImportando(true);
                  importar.mutate(f);
                }
                e.target.value = '';
              }}
            />
            <Button variante="secundario" icone={<FileUp className="h-4 w-4" />} carregando={importando} onClick={() => fileRef.current?.click()}>
              Importar XML de NF-e
            </Button>
            <Link to="/compras/nova">
              <Button variante="primario" icone={<Plus className="h-4 w-4" />}>
                Nova compra
              </Button>
            </Link>
          </>
        }
      />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Nº, fornecedor, NF…" />
          <PeriodoFiltro
            inicial={pg.getFiltro('dataInicial')}
            final={pg.getFiltro('dataFinal')}
            onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })}
            label=""
          />
        </BarraFiltros>
        <div className="border-b border-slate-100 px-3 py-2">
          <ChipsSituacao situacoes={situacoes ?? []} valor={pg.getFiltro('situacaoId')} onChange={(v) => pg.setFiltro('situacaoId', v.split(',')[0] || '')} />
        </div>
        <Table
          colunas={colunas}
          dados={resp?.data}
          carregando={isLoading}
          chave={(c) => c.id}
          onClickLinha={(c) => nav(`/compras/${c.id}`)}
          vazio={<EmptyState icone={<ShoppingBag className="h-5 w-5" />} titulo="Nenhuma compra encontrada" descricao="Importe o XML da NF-e do fornecedor ou cadastre manualmente." acao={<Link to="/compras/nova"><Button variante="primario">Nova compra</Button></Link>} />}
        />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
