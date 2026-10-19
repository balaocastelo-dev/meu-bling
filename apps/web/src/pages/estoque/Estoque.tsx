import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRightLeft, Boxes, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useDepositos, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, BuscaFiltro, Button, Card, Checkbox, EmptyState, PageHeader, Pagination, PeriodoFiltro, SelectFiltro, Table, Tabs, type Coluna } from '@/components/ui';
import { AjusteEstoqueModal, TransferenciaEstoqueModal } from '@/components/compartilhados/EstoqueModais';
import { dataHora, moeda, numero, rotulo } from '@/lib/format';
import type { MovimentoEstoque, Paginado, SaldoEstoque } from '@/types';

/** Saldos e movimentos de estoque */
export default function Estoque() {
  const pg = usePaginacao(50);
  const aba = pg.getFiltro('aba') || 'saldos';
  const { data: depositos } = useDepositos();
  const [ajuste, setAjuste] = useState<{ produtoId?: number; nome?: string; depositoId?: number } | null>(null);
  const [transf, setTransf] = useState<{ produtoId?: number; nome?: string } | null>(null);

  const abaixo = pg.getFiltro('abaixoMinimo') === 'true';
  const { data: saldos, isLoading: carregandoSaldos } = useQuery({
    queryKey: ['estoque', 'saldos', pg.getFiltro('depositoId'), pg.getFiltro('pesquisa'), abaixo],
    queryFn: () => api.get<SaldoEstoque[] | Paginado<SaldoEstoque>>('/estoque/saldos', { depositoId: pg.getFiltro('depositoId'), pesquisa: pg.getFiltro('pesquisa'), abaixoMinimo: abaixo ? 'true' : undefined }),
    enabled: aba === 'saldos',
  });
  const listaSaldos: SaldoEstoque[] = Array.isArray(saldos) ? saldos : saldos?.data ?? [];

  const paramsMov = { depositoId: pg.getFiltro('depositoId'), dataInicial: pg.getFiltro('dataInicial'), dataFinal: pg.getFiltro('dataFinal'), origemTipo: pg.getFiltro('origemTipo'), pagina: pg.pagina, limite: pg.limite };
  const { data: movs, isLoading: carregandoMovs } = useQuery({ queryKey: ['movimentos', paramsMov], queryFn: () => api.get<Paginado<MovimentoEstoque>>('/estoque/movimentos', paramsMov), enabled: aba === 'movimentos', placeholderData: (p) => p });

  const valorTotal = listaSaldos.reduce((s, x) => s + x.saldo * (x.precoCusto || 0), 0);

  const colSaldos: Coluna<SaldoEstoque>[] = [
    { chave: 'codigo', titulo: 'Código', largura: '110px', render: (s) => <span className="font-mono text-xs text-slate-500">{s.codigo || '—'}</span> },
    { chave: 'nome', titulo: 'Produto', render: (s) => <Link to={`/produtos/${s.produtoId}`} className="font-medium text-slate-900 hover:text-brand-600">{s.nome}</Link> },
    { chave: 'deposito', titulo: 'Depósito', render: (s) => <span className="text-slate-600">{s.deposito}</span> },
    { chave: 'saldo', titulo: 'Saldo', direita: true, render: (s) => <span className={clsx('font-medium', s.saldo <= 0 ? 'text-red-600' : s.saldo <= s.estoqueMinimo ? 'text-amber-600' : 'text-slate-800')}>{numero(s.saldo)}</span> },
    { chave: 'reservado', titulo: 'Reservado', direita: true, ocultarMobile: true, render: (s) => <span className="text-slate-500">{numero(s.reservado)}</span> },
    { chave: 'minimo', titulo: 'Mínimo', direita: true, ocultarMobile: true, render: (s) => <span className="text-slate-500">{numero(s.estoqueMinimo)}</span> },
    { chave: 'custo', titulo: 'Custo', direita: true, ocultarMobile: true, render: (s) => <span className="text-slate-500">{moeda(s.precoCusto)}</span> },
    { chave: 'valor', titulo: 'Valor em estoque', direita: true, ocultarMobile: true, render: (s) => moeda(s.saldo * (s.precoCusto || 0)) },
    {
      chave: 'acoes',
      titulo: '',
      largura: '150px',
      render: (s) => (
        <div className="flex justify-end gap-1">
          <Button tamanho="xs" variante="fantasma" onClick={() => setAjuste({ produtoId: s.produtoId, nome: s.nome, depositoId: s.depositoId })}>Ajustar</Button>
          <Button tamanho="xs" variante="fantasma" onClick={() => setTransf({ produtoId: s.produtoId, nome: s.nome })}>Transferir</Button>
        </div>
      ),
    },
  ];

  const colMov: Coluna<MovimentoEstoque>[] = [
    { chave: 'data', titulo: 'Data', render: (m) => <span className="text-xs text-slate-500">{dataHora(m.data)}</span> },
    { chave: 'produto', titulo: 'Produto', render: (m) => <Link to={`/produtos/${m.produtoId}`} className="hover:text-brand-600">{m.produto?.nome ?? `#${m.produtoId}`}</Link> },
    { chave: 'tipo', titulo: 'Tipo', render: (m) => <Badge tom={m.tipo === 'ENTRADA' ? 'verde' : m.tipo === 'SAIDA' ? 'vermelho' : 'neutro'}>{rotulo(m.tipo)}</Badge> },
    { chave: 'dep', titulo: 'Depósito', ocultarMobile: true, render: (m) => m.deposito?.nome ?? `#${m.depositoId}` },
    { chave: 'origem', titulo: 'Origem', ocultarMobile: true, render: (m) => <span className="text-xs text-slate-500">{rotulo(m.origemTipo)}{m.origemId ? ` #${m.origemId}` : ''}</span> },
    { chave: 'qtd', titulo: 'Qtd', direita: true, render: (m) => <span className={m.tipo === 'SAIDA' ? 'text-red-600' : 'text-emerald-700'}>{m.tipo === 'SAIDA' ? '-' : '+'}{numero(Math.abs(m.quantidade))}</span> },
    { chave: 'saldo', titulo: 'Saldo', direita: true, ocultarMobile: true, render: (m) => <span className="text-slate-500">{numero(m.saldoAnterior)} → <strong className="text-slate-800">{numero(m.saldoPosterior)}</strong></span> },
    { chave: 'usuario', titulo: 'Usuário', ocultarMobile: true, render: (m) => <span className="text-xs text-slate-500">{m.usuario?.nome ?? '—'}</span> },
  ];

  return (
    <div>
      <PageHeader
        titulo="Estoque"
        descricao={aba === 'saldos' && listaSaldos.length ? `${listaSaldos.length} registros · valor em estoque ${moeda(valorTotal)}` : 'Saldos por depósito e histórico de movimentos.'}
        acoes={
          <>
            <Button variante="secundario" icone={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAjuste({})}>Ajuste</Button>
            <Button variante="secundario" icone={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransf({})}>Transferência</Button>
          </>
        }
      />
      <Card semPadding>
        <Tabs className="px-3" ativa={aba} onMudar={(a) => pg.setFiltro('aba', a)} abas={[{ id: 'saldos', rotulo: 'Saldos' }, { id: 'movimentos', rotulo: 'Movimentos' }]} />
        <BarraFiltros>
          {aba === 'saldos' && <BuscaFiltro valor={pg.getFiltro('pesquisa')} onChange={(v) => pg.setFiltro('pesquisa', v)} placeholder="Produto, código…" />}
          <SelectFiltro valor={pg.getFiltro('depositoId')} onChange={(v) => pg.setFiltro('depositoId', v)} opcoes={opcoesDe(depositos)} placeholder="Todos os depósitos" />
          {aba === 'saldos' ? (
            <label className="flex h-8 items-center">
              <Checkbox label={<span className="inline-flex items-center gap-1"><TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> Só abaixo do mínimo</span>} checked={abaixo} onChange={(e) => pg.setFiltro('abaixoMinimo', e.target.checked ? 'true' : '')} />
            </label>
          ) : (
            <>
              <PeriodoFiltro inicial={pg.getFiltro('dataInicial')} final={pg.getFiltro('dataFinal')} onChange={(i, f) => { pg.setFiltro('dataInicial', i); pg.setFiltro('dataFinal', f); }} label="" />
              <SelectFiltro valor={pg.getFiltro('origemTipo')} onChange={(v) => pg.setFiltro('origemTipo', v)} placeholder="Todas origens" opcoes={['VENDA', 'COMPRA', 'OS', 'AJUSTE', 'NFE', 'IMPORTACAO', 'TRANSFERENCIA'].map((o) => ({ valor: o, rotulo: rotulo(o) }))} />
            </>
          )}
        </BarraFiltros>
        {aba === 'saldos' ? (
          <Table colunas={colSaldos} dados={listaSaldos} carregando={carregandoSaldos} chave={(s) => `${s.produtoId}-${s.depositoId ?? s.deposito}`} vazio={<EmptyState icone={<Boxes className="h-5 w-5" />} titulo="Nenhum saldo encontrado" descricao={abaixo ? 'Nenhum produto abaixo do mínimo.' : undefined} />} compacta />
        ) : (
          <>
            <Table colunas={colMov} dados={movs?.data} carregando={carregandoMovs} chave={(m) => m.id} vazio={<EmptyState titulo="Sem movimentos no período" />} compacta />
            {movs && <Pagination pagina={movs.meta.pagina} totalPaginas={movs.meta.totalPaginas} total={movs.meta.total} limite={movs.meta.limite} onPagina={pg.setPagina} onLimite={pg.setLimite} />}
          </>
        )}
      </Card>

      <AjusteEstoqueModal aberto={!!ajuste} onFechar={() => setAjuste(null)} produtoId={ajuste?.produtoId} produtoNome={ajuste?.nome} depositoId={ajuste?.depositoId} />
      <TransferenciaEstoqueModal aberto={!!transf} onFechar={() => setTransf(null)} produtoId={transf?.produtoId} produtoNome={transf?.nome} />
    </div>
  );
}
