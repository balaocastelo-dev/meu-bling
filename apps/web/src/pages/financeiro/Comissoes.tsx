import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, CheckCheck, CircleDollarSign, Percent } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useContasFinanceiras, useTecnicos, useVendedores, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, Button, Card, Checkbox, DateInput, EmptyState, Input, Modal, PageHeader, Pagination, Select, SelectFiltro, StatCard, Table, tomPorStatus, type Coluna } from '@/components/ui';
import { competenciaAtual, competenciaLabel, data, hoje, moeda, numero, rotulo } from '@/lib/format';
import type { Comissao, ComissaoResumo, ComissoesResposta } from '@/types';

/** Comissões de vendedores e técnicos por competência */
export default function Comissoes() {
  const qc = useQueryClient();
  const pg = usePaginacao(100);
  const competencia = pg.getFiltro('competencia') || competenciaAtual();
  const { data: vendedores } = useVendedores();
  const { data: tecnicos } = useTecnicos();
  const { data: contasFin } = useContasFinanceiras();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [pagar, setPagar] = useState(false);
  const [contaFin, setContaFin] = useState<number | ''>('');
  const [dataPg, setDataPg] = useState(hoje());

  const params = { competencia, tipo: pg.getFiltro('tipo'), vendedorId: pg.getFiltro('vendedorId'), tecnicoId: pg.getFiltro('tecnicoId'), status: pg.getFiltro('status'), pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['comissoes', params], queryFn: () => api.get<ComissoesResposta>('/comissoes', params), placeholderData: (p) => p });
  const { data: resumo } = useQuery({ queryKey: ['comissoes-resumo', competencia], queryFn: () => api.get<ComissaoResumo[]>('/comissoes/resumo', { competencia }).catch(() => [] as ComissaoResumo[]) });

  useEffect(() => setSel(new Set()), [resp]);
  useEffect(() => {
    if (contasFin?.length && contaFin === '') setContaFin(contasFin.find((c) => c.padrao)?.id ?? contasFin[0].id);
  }, [contasFin, contaFin]);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['comissoes'] });
    qc.invalidateQueries({ queryKey: ['comissoes-resumo'] });
    qc.invalidateQueries({ queryKey: ['/contas-pagar'] });
  };
  const aprovar = useMutation({ mutationFn: (ids: number[]) => api.post('/comissoes/aprovar', { ids }), onSuccess: () => { toast.success('Comissões aprovadas.'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const cancelar = useMutation({ mutationFn: (ids: number[]) => api.post('/comissoes/cancelar', { ids }), onSuccess: () => { toast.success('Comissões canceladas.'); invalidar(); }, onError: (e) => toast.error(mensagemErro(e)) });
  const pagarM = useMutation({
    mutationFn: (ids: number[]) => api.post('/comissoes/pagar', { ids, contaFinanceiraId: Number(contaFin), data: dataPg }),
    onSuccess: () => {
      toast.success('Comissões pagas — contas a pagar geradas por pessoa.');
      invalidar();
      setPagar(false);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const lista = resp?.data ?? [];
  const selecionaveis = lista.filter((c) => c.status === 'PENDENTE' || c.status === 'APROVADA');
  const todas = selecionaveis.length > 0 && selecionaveis.every((c) => sel.has(c.id));
  const selecionadas = lista.filter((c) => sel.has(c.id));
  const totalSel = selecionadas.reduce((s, c) => s + c.valor, 0);

  const colunas: Coluna<Comissao>[] = [
    { chave: 'sel', titulo: <Checkbox checked={todas} onChange={() => setSel(todas ? new Set() : new Set(selecionaveis.map((c) => c.id)))} />, largura: '36px', render: (c) => (c.status === 'PENDENTE' || c.status === 'APROVADA' ? <Checkbox checked={sel.has(c.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} /> : null) },
    { chave: 'pessoa', titulo: 'Pessoa', render: (c) => <div><p className="font-medium text-slate-900">{c.vendedor?.nome ?? c.tecnico?.nome ?? '—'}</p><p className="text-xs text-slate-400">{rotulo(c.tipo)}</p></div> },
    {
      chave: 'origem',
      titulo: 'Origem',
      render: (c) => {
        if (c.origemTipo === 'DESAFIO') return <span className="text-amber-700">🏆 Desafio{c.desafio ? `: ${c.desafio.titulo}` : ''}</span>;
        const l = c.origemTipo === 'VENDA' && (c.vendaId || c.venda?.id) ? `/vendas/${c.vendaId ?? c.venda?.id}` : c.osId || c.os?.id ? `/ordens-servico/${c.osId ?? c.os?.id}` : null;
        const t = `${rotulo(c.origemTipo)} nº ${c.venda?.numero ?? c.os?.numero ?? c.vendaId ?? c.osId ?? ''}`;
        return l ? <Link to={l} className="text-brand-600 hover:underline">{t}</Link> : t;
      },
    },
    { chave: 'desc', titulo: 'Descrição', ocultarMobile: true, render: (c) => <span className="text-xs text-slate-500">{c.descricao ?? ''}</span> },
    { chave: 'base', titulo: 'Base', direita: true, ocultarMobile: true, render: (c) => moeda(c.base) },
    { chave: 'pct', titulo: '%', direita: true, render: (c) => `${numero(c.pct)}%` },
    { chave: 'valor', titulo: 'Comissão', direita: true, render: (c) => <span className="font-medium">{moeda(c.valor)}</span> },
    { chave: 'status', titulo: 'Status', render: (c) => <Badge tom={tomPorStatus(c.status)}>{rotulo(c.status)}</Badge> },
    { chave: 'pago', titulo: 'Pago em', ocultarMobile: true, render: (c) => (c.pagoEm ? data(c.pagoEm) : '—') },
  ];

  const t = resp?.totais;

  return (
    <div>
      <PageHeader
        titulo="Comissões"
        descricao={`Competência ${competenciaLabel(competencia)}`}
        acoes={
          <>
            {sel.size > 0 && (
              <>
                <Button variante="secundario" icone={<CheckCheck className="h-4 w-4" />} onClick={() => aprovar.mutate(Array.from(sel))} carregando={aprovar.isPending}>Aprovar ({sel.size})</Button>
                <Button variante="sucesso" icone={<CircleDollarSign className="h-4 w-4" />} onClick={() => setPagar(true)}>Pagar {moeda(totalSel)}</Button>
                <Button variante="perigo" icone={<Ban className="h-4 w-4" />} onClick={() => { if (confirm('Cancelar as comissões selecionadas?')) cancelar.mutate(Array.from(sel)); }}>Cancelar</Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
        <StatCard rotulo="Pendentes" valor={moeda(t?.pendente)} tom="amarelo" carregando={isLoading && !t} icone={<Percent className="h-4 w-4" />} />
        <StatCard rotulo="Aprovadas" valor={moeda(t?.aprovada)} tom="azul" carregando={isLoading && !t} />
        <StatCard rotulo="Pagas" valor={moeda(t?.paga)} tom="verde" carregando={isLoading && !t} />
      </div>

      <div className="grid gap-4 2xl:grid-cols-3">
        <Card className="2xl:col-span-2" semPadding>
          <BarraFiltros>
            <Input type="month" value={competencia} onChange={(e) => pg.setFiltro('competencia', e.target.value)} className="w-40" />
            <SelectFiltro valor={pg.getFiltro('tipo')} onChange={(v) => pg.setFiltro('tipo', v)} placeholder="Vendedores e técnicos" opcoes={[{ valor: 'VENDEDOR', rotulo: 'Vendedores' }, { valor: 'TECNICO', rotulo: 'Técnicos' }]} />
            <SelectFiltro valor={pg.getFiltro('vendedorId')} onChange={(v) => pg.setFiltro('vendedorId', v)} opcoes={opcoesDe(vendedores)} placeholder="Todos vendedores" />
            <SelectFiltro valor={pg.getFiltro('tecnicoId')} onChange={(v) => pg.setFiltro('tecnicoId', v)} opcoes={opcoesDe(tecnicos)} placeholder="Todos técnicos" />
            <SelectFiltro valor={pg.getFiltro('status')} onChange={(v) => pg.setFiltro('status', v)} placeholder="Todos status" opcoes={['PENDENTE', 'APROVADA', 'PAGA', 'CANCELADA'].map((s) => ({ valor: s, rotulo: rotulo(s) }))} />
          </BarraFiltros>
          <Table colunas={colunas} dados={lista} carregando={isLoading} chave={(c) => c.id} vazio={<EmptyState icone={<Percent className="h-5 w-5" />} titulo="Nenhuma comissão nesta competência" descricao="Comissões são geradas ao lançar vendas/OS com percentual informado." />} compacta />
          {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} />}
        </Card>
        <Card titulo="Resumo por pessoa" semPadding>
          {resumo?.length ? (
            <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Pessoa</th><th className="text-right">Qtd</th><th className="text-right">Pendente</th><th className="text-right">Paga</th></tr></thead>
              <tbody>
                {resumo.map((r) => (
                  <tr key={`${r.tipo}-${r.pessoaId}`}>
                    <td><p className="font-medium">{r.nome}</p><p className="text-[10px] text-slate-400">{rotulo(r.tipo)} · base {moeda(r.base)}</p></td>
                    <td className="num text-right">{r.qtd}</td>
                    <td className="num text-right text-amber-700">{moeda(r.pendente)}</td>
                    <td className="num text-right text-emerald-700">{moeda(r.paga)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <EmptyState compacto titulo="Sem resumo" />
          )}
        </Card>
      </div>

      <Modal aberto={pagar} onFechar={() => setPagar(false)} titulo={`Pagar ${sel.size} comissões`} descricao={`Total ${moeda(totalSel)}. Será gerada uma conta a pagar (paga) por pessoa.`} rodape={<><Button variante="secundario" onClick={() => setPagar(false)}>Cancelar</Button><Button variante="sucesso" carregando={pagarM.isPending} disabled={!contaFin} onClick={() => pagarM.mutate(Array.from(sel))}>Confirmar pagamento</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Conta financeira" value={contaFin} onChange={(e) => setContaFin(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contasFin)} placeholder="—" />
          <DateInput label="Data do pagamento" value={dataPg} onChange={setDataPg} />
        </div>
      </Modal>
    </div>
  );
}
