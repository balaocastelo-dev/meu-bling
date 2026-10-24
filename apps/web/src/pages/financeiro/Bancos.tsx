import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ArrowRightLeft, Ban, CircleCheck, FileUp, Landmark, Link2, Plus, PlugZap, RefreshCw, Unlink, Wallet } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { abrirPluggyConnect } from '@/lib/pluggy';
import { useEmpresa } from '@/hooks/useEmpresa';
import { usePaginacao } from '@/hooks/usePaginacao';
import { useCategoriasFinanceiras, useContasFinanceiras, opcoesDe } from '@/hooks/useListas';
import { Badge, BarraFiltros, Button, Card, DateInput, EmptyState, Input, Modal, MoneyInput, PageHeader, Pagination, Select, SelectFiltro, Skeleton, Tabs, Textarea } from '@/components/ui';
import { data, dataHora, hoje, moeda, rotulo } from '@/lib/format';
import type { ContaFinanceira, OpenFinanceStatus, Paginado, TransacaoBancaria } from '@/types';

/** Contas bancárias, Open Finance e conciliação */
export default function Bancos() {
  const qc = useQueryClient();
  const pg = usePaginacao(50);
  const aba = pg.getFiltro('aba') || 'contas';
  const { data: contas, isLoading } = useContasFinanceiras();
  const { data: of } = useQuery({ queryKey: ['open-finance-status'], queryFn: () => api.get<OpenFinanceStatus>('/open-finance/status').catch(() => null) });
  const { data: emp } = useEmpresa();
  const ofxRef = useRef<HTMLInputElement>(null);
  const [ofxConta, setOfxConta] = useState<number | ''>('');
  const [itemId, setItemId] = useState('');
  const [itemConta, setItemConta] = useState<number | ''>('');
  const [transfAberta, setTransfAberta] = useState(false);
  const [lancAberto, setLancAberto] = useState(false);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    qc.invalidateQueries({ queryKey: ['financeiro-resumo'] });
  };

  type Vinculada = { contaFinanceiraId: number; nome: string; saldo: number; nova: boolean };
  const aoVincular = (r: Vinculada[] | null) => {
    if (!r) return;
    toast.success(`${r.length} conta(s) vinculada(s): ${r.map((c) => c.nome).join(', ')}`);
    invalidar();
  };

  /** Fluxo padrão: widget Pluggy Connect → item → vincula as contas do item */
  const conectar = useMutation({
    mutationFn: async () => {
      const { accessToken } = await api.post<{ accessToken: string }>('/open-finance/connect-token');
      const item = await abrirPluggyConnect(accessToken, { cnpj: emp?.cnpj });
      if (!item) return null;
      return api.post<Vinculada[]>('/open-finance/vincular', { itemId: item.id });
    },
    onSuccess: aoVincular,
    onError: (e) => toast.error(mensagemErro(e)),
  });

  /** Fluxo alternativo (Meu Pluggy): o item já foi criado no app Demo da Pluggy; basta colar o Item ID */
  const vincularItem = useMutation({
    mutationFn: () => api.post<Vinculada[]>('/open-finance/vincular', { itemId: itemId.trim(), contaFinanceiraId: itemConta || undefined }),
    onSuccess: (r) => {
      aoVincular(r);
      setItemId('');
      setItemConta('');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const sincronizar = useMutation({
    mutationFn: (id?: number) => (id ? api.post<{ saldo: number; novasTransacoes: number }>(`/open-finance/sincronizar/${id}`) : api.post<{ novasTransacoes?: number }>('/open-finance/sincronizar-todas')),
    onSuccess: (r) => {
      toast.success('Sincronização concluída.', { description: r && 'novasTransacoes' in r ? `${r.novasTransacoes ?? 0} novas transações` : undefined });
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const desvincular = useMutation({
    mutationFn: (id: number) => api.del(`/open-finance/desvincular/${id}`),
    onSuccess: () => {
      toast.success('Conta desvinculada do Open Finance.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const importarOfx = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('arquivo', f);
      fd.append('contaFinanceiraId', String(ofxConta));
      return api.upload<{ novasTransacoes?: number } | TransacaoBancaria[]>('/bancos/importar-ofx', fd);
    },
    onSuccess: (r) => {
      const n = Array.isArray(r) ? r.length : r?.novasTransacoes;
      toast.success('OFX importado.', { description: n !== undefined ? `${n} transações` : undefined });
      invalidar();
      pg.setFiltro('aba', 'conciliacao');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const saldoSistema = (contas ?? []).reduce((s, c) => s + c.saldoAtual, 0);

  return (
    <div>
      <PageHeader
        titulo="Contas bancárias & conciliação"
        descricao={contas ? `Saldo total no sistema: ${moeda(saldoSistema)}` : undefined}
        acoes={
          <>
            <Button variante="secundario" icone={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransfAberta(true)}>Transferência</Button>
            <Button variante="secundario" icone={<Plus className="h-4 w-4" />} onClick={() => setLancAberto(true)}>Lançamento avulso</Button>
            <Button variante="secundario" icone={<RefreshCw className={clsx('h-4 w-4', sincronizar.isPending && 'animate-spin')} />} onClick={() => sincronizar.mutate(undefined)} disabled={sincronizar.isPending || !of?.ativo}>Sincronizar todas</Button>
            <Button variante="primario" icone={<PlugZap className="h-4 w-4" />} carregando={conectar.isPending} onClick={() => conectar.mutate()} disabled={of ? !of.configurado : false} title={of && !of.configurado ? 'Configure o Open Finance em Configurações' : undefined}>
              Conectar banco (Open Finance)
            </Button>
          </>
        }
      />

      {of && !of.configurado && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Open Finance não configurado. <Link to="/configuracoes/open-finance" className="font-medium underline">Informe as credenciais Pluggy</Link> para conectar bancos ao vivo, ou importe extratos OFX.
        </div>
      )}

      <Tabs className="mb-4" ativa={aba} onMudar={(a) => pg.setFiltro('aba', a)} abas={[{ id: 'contas', rotulo: 'Contas' }, { id: 'conciliacao', rotulo: 'Conciliação' }, { id: 'extrato', rotulo: 'Extrato interno' }]} />

      {aba === 'contas' && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {isLoading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
            {!isLoading && !contas?.length && (
              <Card className="md:col-span-2 xl:col-span-3">
                <EmptyState icone={<Landmark className="h-5 w-5" />} titulo="Nenhuma conta financeira" descricao="Cadastre o caixa e as contas bancárias em Configurações, ou conecte um banco via Open Finance." acao={<Link to="/configuracoes/contas-financeiras"><Button variante="primario">Cadastrar conta</Button></Link>} />
              </Card>
            )}
            {contas?.map((c) => <CardConta key={c.id} conta={c} onSincronizar={() => sincronizar.mutate(c.id)} sincronizando={sincronizar.isPending} onDesvincular={() => { if (confirm('Desvincular esta conta do Open Finance?')) desvincular.mutate(c.id); }} />)}
          </div>

          {of?.configurado && (
            <Card titulo="Vincular pelo Item ID (Meu Pluggy)" descricao="Caminho gratuito: conecte o banco em meu.pluggy.ai, autorize no app Demo da Pluggy e cole aqui o Item ID (menu ⋮ → “Copiar Item ID”). As contas do item são vinculadas na hora.">
              <div className="flex flex-wrap items-end gap-2">
                <Input label="Item ID" value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="ex.: 8a1b2c3d-…" className="w-80 font-mono" autoComplete="off" />
                <Select label="Vincular a uma conta já cadastrada (opcional)" value={itemConta} onChange={(e) => setItemConta(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe((contas ?? []).filter((c) => !c.openFinanceItemId))} placeholder="Criar automaticamente" className="w-72" />
                <Button variante="secundario" icone={<Link2 className="h-4 w-4" />} disabled={itemId.trim().length < 8} carregando={vincularItem.isPending} onClick={() => vincularItem.mutate()}>Vincular</Button>
              </div>
            </Card>
          )}

          <Card titulo="Importar extrato OFX" descricao="Alternativa sem Open Finance: exporte o OFX no internet banking e importe aqui para conciliar.">
            <div className="flex flex-wrap items-end gap-2">
              <Select label="Conta" value={ofxConta} onChange={(e) => setOfxConta(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe(contas)} placeholder="Selecione" className="w-64" />
              <input ref={ofxRef} type="file" accept=".ofx,.qfx,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importarOfx.mutate(f); e.target.value = ''; }} />
              <Button variante="secundario" icone={<FileUp className="h-4 w-4" />} disabled={!ofxConta} carregando={importarOfx.isPending} onClick={() => ofxRef.current?.click()}>Escolher arquivo OFX</Button>
            </div>
          </Card>
        </div>
      )}

      {aba === 'conciliacao' && <Conciliacao contas={contas ?? []} />}
      {aba === 'extrato' && <Extrato contas={contas ?? []} />}

      <TransferenciaModal aberto={transfAberta} onFechar={() => setTransfAberta(false)} contas={contas ?? []} onConcluido={invalidar} />
      <LancamentoModal aberto={lancAberto} onFechar={() => setLancAberto(false)} contas={contas ?? []} onConcluido={invalidar} />
    </div>
  );
}

function CardConta({ conta: c, onSincronizar, sincronizando, onDesvincular }: { conta: ContaFinanceira; onSincronizar: () => void; sincronizando: boolean; onDesvincular: () => void }) {
  const vinculada = !!c.openFinanceItemId;
  const diferenca = typeof c.saldoBanco === 'number' ? c.saldoBanco - c.saldoAtual : null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: c.cor || '#2563eb' }}>
          {c.tipo === 'CAIXA' ? <Wallet className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{c.nome}</p>
          <p className="truncate text-xs text-slate-400">{[rotulo(c.tipo), c.banco, c.agencia && `ag. ${c.agencia}`, c.conta && `cc. ${c.conta}`].filter(Boolean).join(' · ')}</p>
        </div>
        {vinculada ? <Badge tom={c.openFinanceStatus === 'UPDATED' || !c.openFinanceStatus ? 'verde' : 'amarelo'} ponto>Open Finance</Badge> : c.padrao ? <Badge>Padrão</Badge> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Saldo no sistema</p>
          <p className={clsx('num text-lg font-semibold', c.saldoAtual < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(c.saldoAtual)}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Saldo no banco</p>
          {typeof c.saldoBanco === 'number' ? (
            <>
              <p className={clsx('num text-lg font-semibold', c.saldoBanco < 0 ? 'text-red-600' : 'text-slate-900')}>{moeda(c.saldoBanco)}</p>
              <p className="text-[10px] text-slate-400">{c.saldoBancoEm ? dataHora(c.saldoBancoEm) : ''}</p>
            </>
          ) : (
            <p className="text-sm text-slate-300">—</p>
          )}
        </div>
      </div>
      {diferenca !== null && Math.abs(diferenca) > 0.009 && (
        <p className={clsx('mt-2 rounded px-2 py-1 text-xs', Math.abs(diferenca) > 0.009 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>Diferença de {moeda(diferenca)} — concilie as transações pendentes.</p>
      )}
      {diferenca !== null && Math.abs(diferenca) <= 0.009 && <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700"><CircleCheck className="h-3.5 w-3.5" /> Saldos conferem</p>}
      {vinculada && (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
          <Button tamanho="xs" variante="secundario" icone={<RefreshCw className={clsx('h-3.5 w-3.5', sincronizando && 'animate-spin')} />} onClick={onSincronizar} disabled={sincronizando}>Sincronizar</Button>
          <Button tamanho="xs" variante="fantasma" icone={<Unlink className="h-3.5 w-3.5" />} onClick={onDesvincular}>Desvincular</Button>
          <span className="ml-auto text-[10px] text-slate-400">{c.ultimaSincronizacao ? `sync ${dataHora(c.ultimaSincronizacao)}` : ''}</span>
        </div>
      )}
    </div>
  );
}

/** Aba de conciliação: transações do banco não conciliadas com sugestões */
function Conciliacao({ contas }: { contas: ContaFinanceira[] }) {
  const qc = useQueryClient();
  const pg = usePaginacao(50);
  const { data: categorias } = useCategoriasFinanceiras();
  const [lancar, setLancar] = useState<TransacaoBancaria | null>(null);
  const [catId, setCatId] = useState<number | ''>('');
  const [desc, setDesc] = useState('');

  const params = { contaFinanceiraId: pg.getFiltro('contaFinanceiraId'), conciliado: pg.getFiltro('conciliado') || 'false', pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['transacoes', params], queryFn: () => api.get<Paginado<TransacaoBancaria>>('/bancos/transacoes', params), placeholderData: (p) => p });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['transacoes'] });
    qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    qc.invalidateQueries({ queryKey: ['/contas-receber'] });
    qc.invalidateQueries({ queryKey: ['/contas-pagar'] });
  };
  const conciliar = useMutation({
    mutationFn: (p: { id: number; body: { tipo: 'RECEBER' | 'PAGAR' | 'LANCAMENTO'; id?: number; categoriaId?: number; descricao?: string } }) => api.post(`/bancos/transacoes/${p.id}/conciliar`, p.body),
    onSuccess: () => {
      toast.success('Transação conciliada.');
      invalidar();
      setLancar(null);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const ignorar = useMutation({
    mutationFn: (id: number) => api.post(`/bancos/transacoes/${id}/ignorar`),
    onSuccess: () => {
      toast.success('Transação ignorada.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  return (
    <Card semPadding>
      <BarraFiltros>
        <SelectFiltro valor={pg.getFiltro('contaFinanceiraId')} onChange={(v) => pg.setFiltro('contaFinanceiraId', v)} opcoes={opcoesDe(contas)} placeholder="Todas as contas" />
        <SelectFiltro valor={pg.getFiltro('conciliado') || 'false'} onChange={(v) => pg.setFiltro('conciliado', v)} placeholder="" opcoes={[{ valor: 'false', rotulo: 'Pendentes' }, { valor: 'true', rotulo: 'Conciliadas' }]} />
      </BarraFiltros>
      {isLoading ? (
        <div className="p-4"><Skeleton className="h-48" /></div>
      ) : !resp?.data.length ? (
        <EmptyState icone={<CircleCheck className="h-5 w-5" />} titulo="Nada para conciliar" descricao="Sincronize uma conta ou importe um OFX para trazer transações do banco." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {resp.data.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
              <div className="w-24 shrink-0 text-xs text-slate-500">
                {data(t.data)}
                <p className="text-[10px] text-slate-400">{rotulo(t.fonte)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{t.descricao}</p>
                <p className="text-xs text-slate-400">{t.contaFinanceira?.nome ?? contas.find((c) => c.id === t.contaFinanceiraId)?.nome}{t.categoriaSugerida ? ` · sugestão: ${t.categoriaSugerida}` : ''}</p>
                {!t.conciliado && t.sugestoes && t.sugestoes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.sugestoes.slice(0, 3).map((s) => (
                      <button key={`${s.tipo}-${s.id}`} onClick={() => conciliar.mutate({ id: t.id, body: { tipo: s.tipo, id: s.id } })} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100" title={`Conciliar com ${s.tipo === 'RECEBER' ? 'conta a receber' : 'conta a pagar'} #${s.id}`}>
                        <Link2 className="h-3 w-3" />
                        <span className="max-w-[220px] truncate">{s.descricao}</span>
                        <span className="num">{moeda(s.valor)}</span>
                        <span className="text-[10px] opacity-70">{data(s.vencimento)} · {Math.round(s.score * (s.score <= 1 ? 100 : 1))}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={clsx('num w-28 shrink-0 text-right text-sm font-semibold', t.valor < 0 ? 'text-red-600' : 'text-emerald-700')}>{moeda(t.valor)}</div>
              <div className="flex shrink-0 gap-1">
                {t.conciliado ? (
                  <Badge tom="verde">Conciliada</Badge>
                ) : (
                  <>
                    <Button tamanho="xs" variante="secundario" onClick={() => { setLancar(t); setDesc(t.descricao); setCatId(''); }}>Lançar avulso</Button>
                    <Button tamanho="xs" variante="fantasma" icone={<Ban className="h-3.5 w-3.5" />} onClick={() => ignorar.mutate(t.id)} title="Ignorar" />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} />}

      <Modal
        aberto={!!lancar}
        onFechar={() => setLancar(null)}
        titulo="Conciliar como lançamento avulso"
        descricao={lancar ? `${data(lancar.data)} · ${moeda(lancar.valor)}` : undefined}
        rodape={
          <>
            <Button variante="secundario" onClick={() => setLancar(null)}>Cancelar</Button>
            <Button variante="primario" carregando={conciliar.isPending} onClick={() => lancar && conciliar.mutate({ id: lancar.id, body: { tipo: 'LANCAMENTO', categoriaId: catId || undefined, descricao: desc } })}>Conciliar</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="Descrição" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Select label="Categoria financeira" value={catId} onChange={(e) => setCatId(e.target.value ? Number(e.target.value) : '')} opcoes={opcoesDe((categorias ?? []).filter((c) => c.tipo === ((lancar?.valor ?? 0) < 0 ? 'DESPESA' : 'RECEITA')))} placeholder="—" />
        </div>
      </Modal>
    </Card>
  );
}

/** Extrato interno (MovimentoFinanceiro) */
function Extrato({ contas }: { contas: ContaFinanceira[] }) {
  const pg = usePaginacao(50);
  const qc = useQueryClient();
  const params = { contaFinanceiraId: pg.getFiltro('contaFinanceiraId'), dataInicial: pg.getFiltro('dataInicial'), dataFinal: pg.getFiltro('dataFinal'), pagina: pg.pagina, limite: pg.limite };
  const { data: resp, isLoading } = useQuery({ queryKey: ['movimentos-fin', params], queryFn: () => api.get<Paginado<{ id: number; data: string; tipo: string; valor: number; descricao: string; categoria?: { nome: string } | null; contaFinanceira?: { nome: string } | null; conciliado: boolean }>>('/financeiro/movimentos', params), placeholderData: (p) => p });
  const excluir = useMutation({
    mutationFn: (id: number) => api.del(`/financeiro/movimentos/${id}`),
    onSuccess: () => {
      toast.success('Lançamento excluído.');
      qc.invalidateQueries({ queryKey: ['movimentos-fin'] });
      qc.invalidateQueries({ queryKey: ['contas-financeiras'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Card semPadding>
      <BarraFiltros>
        <SelectFiltro valor={pg.getFiltro('contaFinanceiraId')} onChange={(v) => pg.setFiltro('contaFinanceiraId', v)} opcoes={opcoesDe(contas)} placeholder="Todas as contas" />
        <div className="flex items-center gap-1">
          <input type="date" value={pg.getFiltro('dataInicial')} onChange={(e) => pg.setFiltro('dataInicial', e.target.value)} className="input-base h-8 w-36 py-0 text-sm" />
          <span className="text-xs text-slate-400">até</span>
          <input type="date" value={pg.getFiltro('dataFinal')} onChange={(e) => pg.setFiltro('dataFinal', e.target.value)} className="input-base h-8 w-36 py-0 text-sm" />
        </div>
      </BarraFiltros>
      {isLoading ? (
        <div className="p-4"><Skeleton className="h-48" /></div>
      ) : !resp?.data.length ? (
        <EmptyState titulo="Sem lançamentos no período" />
      ) : (
        <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Data</th><th>Descrição</th><th>Conta</th><th>Categoria</th><th>Tipo</th><th className="text-right">Valor</th><th /></tr></thead>
          <tbody>
            {resp.data.map((m) => (
              <tr key={m.id}>
                <td className="text-xs text-slate-500">{data(m.data)}</td>
                <td>{m.descricao}</td>
                <td className="text-slate-500">{m.contaFinanceira?.nome ?? '—'}</td>
                <td className="text-xs text-slate-500">{m.categoria?.nome ?? '—'}</td>
                <td><Badge tom={m.tipo === 'ENTRADA' ? 'verde' : m.tipo === 'SAIDA' ? 'vermelho' : 'neutro'}>{rotulo(m.tipo)}</Badge></td>
                <td className={clsx('num text-right font-medium', m.tipo === 'SAIDA' ? 'text-red-600' : 'text-emerald-700')}>{m.tipo === 'SAIDA' ? '-' : '+'}{moeda(m.valor)}</td>
                <td className="text-right"><Button tamanho="xs" variante="fantasma" onClick={() => { if (confirm('Excluir este lançamento?')) excluir.mutate(m.id); }}>✕</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {resp && <Pagination pagina={resp.meta.pagina} totalPaginas={resp.meta.totalPaginas} total={resp.meta.total} limite={resp.meta.limite} onPagina={pg.setPagina} />}
    </Card>
  );
}

function TransferenciaModal({ aberto, onFechar, contas, onConcluido }: { aberto: boolean; onFechar: () => void; contas: ContaFinanceira[]; onConcluido: () => void }) {
  const [f, setF] = useState({ origemId: '' as number | '', destinoId: '' as number | '', valor: 0, data: hoje(), descricao: 'Transferência entre contas' });
  const m = useMutation({
    mutationFn: () => api.post('/financeiro/transferencia', { ...f, origemId: Number(f.origemId), destinoId: Number(f.destinoId) }),
    onSuccess: () => {
      toast.success('Transferência registrada.');
      onConcluido();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Transferência entre contas" rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button variante="primario" carregando={m.isPending} disabled={!f.origemId || !f.destinoId || f.origemId === f.destinoId || f.valor <= 0} onClick={() => m.mutate()}>Transferir</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Select label="De" value={f.origemId} onChange={(e) => setF({ ...f, origemId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe(contas)} placeholder="—" />
        <Select label="Para" value={f.destinoId} onChange={(e) => setF({ ...f, destinoId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe(contas)} placeholder="—" />
        <MoneyInput label="Valor" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
        <DateInput label="Data" value={f.data} onChange={(v) => setF({ ...f, data: v })} />
        <Input className="col-span-2" label="Descrição" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      </div>
    </Modal>
  );
}

function LancamentoModal({ aberto, onFechar, contas, onConcluido }: { aberto: boolean; onFechar: () => void; contas: ContaFinanceira[]; onConcluido: () => void }) {
  const { data: categorias } = useCategoriasFinanceiras();
  const [f, setF] = useState({ contaFinanceiraId: '' as number | '', data: hoje(), tipo: 'SAIDA' as 'ENTRADA' | 'SAIDA', valor: 0, descricao: '', categoriaId: '' as number | '' });
  const m = useMutation({
    mutationFn: () => api.post('/financeiro/movimentos', { ...f, contaFinanceiraId: Number(f.contaFinanceiraId), categoriaId: f.categoriaId || null }),
    onSuccess: () => {
      toast.success('Lançamento registrado.');
      onConcluido();
      onFechar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo="Lançamento avulso" descricao="Entrada ou saída direta na conta, sem título a receber/pagar." rodape={<><Button variante="secundario" onClick={onFechar}>Cancelar</Button><Button variante="primario" carregando={m.isPending} disabled={!f.contaFinanceiraId || f.valor <= 0 || !f.descricao.trim()} onClick={() => m.mutate()}>Lançar</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Conta" value={f.contaFinanceiraId} onChange={(e) => setF({ ...f, contaFinanceiraId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe(contas)} placeholder="—" />
        <Select label="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as 'ENTRADA' | 'SAIDA' })} opcoes={[{ valor: 'ENTRADA', rotulo: 'Entrada' }, { valor: 'SAIDA', rotulo: 'Saída' }]} />
        <MoneyInput label="Valor" value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
        <DateInput label="Data" value={f.data} onChange={(v) => setF({ ...f, data: v })} />
        <Select className="col-span-2" label="Categoria" value={f.categoriaId} onChange={(e) => setF({ ...f, categoriaId: e.target.value ? Number(e.target.value) : '' })} opcoes={opcoesDe((categorias ?? []).filter((c) => c.tipo === (f.tipo === 'ENTRADA' ? 'RECEITA' : 'DESPESA')))} placeholder="—" />
        <Textarea className="col-span-2" label="Descrição" rows={2} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
      </div>
    </Modal>
  );
}
