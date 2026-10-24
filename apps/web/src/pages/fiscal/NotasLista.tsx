import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Plus, Wifi, WifiOff } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, EmptyState, PageHeader, Pagination, PeriodoFiltro, SelectFiltro, Table, tomPorStatus, type Coluna } from '@/components/ui';
import { data, moeda, rotulo } from '@/lib/format';
import type { NotaFiscalResumo, Paginado, StatusSefaz } from '@/types';

/** Lista de notas fiscais (NF-e / NFC-e) */
export default function NotasLista() {
  const nav = useNavigate();
  const pg = usePaginacao();
  const params = { ...pg.filtros, pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['notas-fiscais', params], queryFn: () => api.get<Paginado<NotaFiscalResumo>>('/notas-fiscais', params), placeholderData: (p) => p });
  const { data: sefaz } = useQuery({ queryKey: ['sefaz-status'], queryFn: () => api.get<StatusSefaz>('/fiscal/status-sefaz').catch(() => null), staleTime: 5 * 60 * 1000 });

  const colunas: Coluna<NotaFiscalResumo>[] = [
    { chave: 'numero', titulo: 'Número', largura: '110px', render: (n) => <div><span className="font-medium text-slate-900">{n.numero}</span><span className="ml-1 text-xs text-slate-400">s{n.serie}</span><p className="text-[10px] text-slate-400">{n.modelo === 65 ? 'NFC-e' : 'NF-e'} · {n.tipo === 0 ? 'entrada' : 'saída'}</p></div> },
    { chave: 'emissao', titulo: 'Emissão', largura: '100px', render: (n) => data(n.dataEmissao) },
    { chave: 'contato', titulo: 'Destinatário', render: (n) => <span className="block max-w-[280px] truncate">{n.contato?.nome ?? 'Consumidor'}</span> },
    { chave: 'origem', titulo: 'Origem', ocultarMobile: true, render: (n) => (n.venda ? <Link to={`/vendas/${n.venda.id}`} className="text-xs text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>Venda {n.venda.numero}</Link> : n.os ? <Link to={`/ordens-servico/${n.os.id}`} className="text-xs text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>OS {n.os.numero}</Link> : <span className="text-xs text-slate-400">manual</span>) },
    { chave: 'situacao', titulo: 'Situação', render: (n) => <div><Badge tom={tomPorStatus(n.situacao)}>{rotulo(n.situacao)}</Badge>{n.motivo && n.situacao !== 'AUTORIZADA' && <p className="mt-0.5 max-w-[240px] truncate text-[10px] text-red-500" title={n.motivo}>{n.motivo}</p>}</div> },
    { chave: 'chave', titulo: 'Chave', ocultarMobile: true, render: (n) => <span className="font-mono text-[10px] text-slate-400">{n.chave ? `…${n.chave.slice(-12)}` : '—'}</span> },
    { chave: 'valor', titulo: 'Valor', direita: true, largura: '110px', render: (n) => <span className="font-medium">{moeda(n.valorTotal)}</span> },
  ];

  return (
    <div>
      <PageHeader
        titulo="Notas fiscais"
        descricao={resp ? `${resp.meta.total} notas` : undefined}
        extra={sefaz ? <Badge tom={sefaz.online ? 'verde' : 'vermelho'}>{sefaz.online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />} SEFAZ {sefaz.online ? 'online' : 'offline'}{sefaz.ambiente === 2 ? ' · homologação' : ''}</Badge> : null}
        acoes={<Link to="/notas-fiscais/nova"><Button variante="primario" icone={<Plus className="h-4 w-4" />}>Nota manual</Button></Link>}
      />
      <Card semPadding>
        <BarraFiltros>
          <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Número, chave, destinatário…" />
          <SelectFiltro valor={pg.getFiltro('situacao')} onChange={(v) => pg.setFiltro('situacao', v)} placeholder="Todas situações" opcoes={['PENDENTE', 'PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'DENEGADA', 'INUTILIZADA', 'ERRO'].map((s) => ({ valor: s, rotulo: rotulo(s) }))} />
          <SelectFiltro valor={pg.getFiltro('modelo')} onChange={(v) => pg.setFiltro('modelo', v)} placeholder="NF-e e NFC-e" opcoes={[{ valor: 55, rotulo: 'NF-e (55)' }, { valor: 65, rotulo: 'NFC-e (65)' }]} />
          <SelectFiltro valor={pg.getFiltro('tipo')} onChange={(v) => pg.setFiltro('tipo', v)} placeholder="Entrada e saída" opcoes={[{ valor: 1, rotulo: 'Saída' }, { valor: 0, rotulo: 'Entrada' }]} />
          <PeriodoFiltro inicial={pg.getFiltro('dataInicial')} final={pg.getFiltro('dataFinal')} onChange={(i, f) => pg.setFiltros({ dataInicial: i, dataFinal: f })} label="" />
        </BarraFiltros>
        <Table colunas={colunas} dados={resp?.data} carregando={isLoading} chave={(n) => n.id} onClickLinha={(n) => nav(`/notas-fiscais/${n.id}`)} vazio={<EmptyState icone={<FileText className="h-5 w-5" />} titulo="Nenhuma nota fiscal" descricao="Gere notas a partir de vendas ou crie uma nota manual." />} />
        {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
      </Card>
    </div>
  );
}
