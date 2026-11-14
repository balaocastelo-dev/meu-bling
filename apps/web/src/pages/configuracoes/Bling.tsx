import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { CircleCheck, Download, ExternalLink, Eye, FileUp, Loader2, Play, RefreshCw, Save } from 'lucide-react';
import { api, mensagemErro, BASE_PATH } from '@/lib/api';
import { useEmpresa } from '@/hooks/useEmpresa';
import { Badge, Button, Card, Checkbox, ConfirmDialog, DateInput, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { dataHora, moeda } from '@/lib/format';
import type { BlingImportStatus, BlingStatus, BlingSyncContasStatus, RelatorioContasPagarBling } from '@/types';

const ENTIDADES = [
  { id: 'contatos', rotulo: 'Contatos (clientes/fornecedores)' },
  { id: 'produtos', rotulo: 'Produtos' },
  { id: 'estoque', rotulo: 'Saldos de estoque' },
  { id: 'vendas', rotulo: 'Pedidos de venda' },
  { id: 'compras', rotulo: 'Pedidos de compra' },
  { id: 'contasReceber', rotulo: 'Contas a receber' },
  { id: 'contasPagar', rotulo: 'Contas a pagar' },
  { id: 'notas', rotulo: 'Notas fiscais' },
];

/** Migração do Bling: OAuth + importação por entidade + CSV */
export default function Bling() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<Set<string>>(new Set(['contatos', 'produtos', 'estoque']));
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [fecharEmAberto, setFecharEmAberto] = useState(false);
  const [baixarNoCaixa, setBaixarNoCaixa] = useState(false);
  const [entCsv, setEntCsv] = useState('contatos');
  const [syncDe, setSyncDe] = useState('');
  const [syncAte, setSyncAte] = useState('');
  const [confirmarSync, setConfirmarSync] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const { data: emp } = useEmpresa();
  const [cred, setCred] = useState({ blingClientId: '', blingClientSecret: '' });
  useEffect(() => {
    if (emp) setCred((c) => ({ ...c, blingClientId: emp.bling?.clientId ?? emp.blingClientId ?? '' }));
  }, [emp]);
  const salvarCred = useMutation({
    mutationFn: () => api.put('/empresa', { blingClientId: cred.blingClientId, blingClientSecret: cred.blingClientSecret || undefined }),
    onSuccess: () => {
      toast.success('Credenciais do Bling salvas.');
      qc.invalidateQueries({ queryKey: ['empresa'] });
      qc.invalidateQueries({ queryKey: ['bling-status'] });
      setCred((c) => ({ ...c, blingClientSecret: '' }));
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const { data: status, isLoading } = useQuery({ queryKey: ['bling-status'], queryFn: () => api.get<BlingStatus>('/bling/status') });
  const { data: imp } = useQuery({
    queryKey: ['bling-importar-status'],
    queryFn: () => api.get<BlingImportStatus>('/bling/importar/status').catch(() => null),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 2000 : 15000),
  });
  const { data: sync } = useQuery({
    queryKey: ['bling-contas-pagar'],
    queryFn: () => api.get<BlingSyncContasStatus>('/bling/contas-pagar/sincronizar/status').catch(() => null),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 1500 : false),
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [imp?.log?.length]);

  const conectar = useMutation({
    mutationFn: () => api.get<{ url: string } | string>('/bling/auth-url'),
    onSuccess: (r) => {
      const url = typeof r === 'string' ? r : r.url;
      window.open(url, '_blank', 'noopener');
      toast.info('Autorize o MEU BLING na aba do Bling. Você será redirecionado de volta.');
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const importar = useMutation({
    mutationFn: () => api.post('/bling/importar', { entidades: Array.from(sel), dataInicial: dataInicial || undefined, dataFinal: dataFinal || undefined, fecharEmAberto: sel.has('vendas') ? fecharEmAberto : undefined, baixarNoCaixa: sel.has('vendas') ? baixarNoCaixa : undefined }),
    onSuccess: () => {
      toast.success('Importação iniciada em segundo plano.');
      qc.invalidateQueries({ queryKey: ['bling-importar-status'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const csv = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('arquivo', f);
      fd.append('entidade', entCsv);
      return api.upload<{ importados?: number; erros?: number }>('/bling/importar-csv', fd);
    },
    onSuccess: (r) => {
      toast.success('CSV importado.', { description: r?.importados !== undefined ? `${r.importados} registros${r.erros ? `, ${r.erros} com erro` : ''}` : undefined });
      qc.invalidateQueries({ queryKey: ['contatos'] });
      qc.invalidateQueries({ queryKey: ['produtos'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const sincronizar = useMutation({
    mutationFn: (modo: 'previa' | 'aplicar') => {
      if ((syncDe && !syncAte) || (!syncDe && syncAte)) throw new Error('Informe as duas datas do período, ou deixe as duas em branco.');
      return api.post('/bling/contas-pagar/sincronizar', { modo, dataInicial: syncDe || undefined, dataFinal: syncAte || undefined });
    },
    onSuccess: (_r, modo) => {
      toast.success(modo === 'previa' ? 'Prévia iniciada. Nada será gravado.' : 'Sincronização iniciada.');
      qc.invalidateQueries({ queryKey: ['bling-contas-pagar'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const pct = imp?.progresso && imp.progresso.total > 0 ? Math.round((imp.progresso.feitos / imp.progresso.total) * 100) : 0;
  const syncOcupado = !!sync?.emAndamento || !!imp?.emAndamento;

  return (
    <div className="pb-6">
      <PageHeader migalhas={[{ rotulo: 'Configurações', para: '/configuracoes' }, { rotulo: 'Migração do Bling' }]} titulo="Migração do Bling" descricao="Conecte sua conta Bling e traga clientes, produtos, estoque, vendas e financeiro. Reimportar não duplica (usa o ID do Bling)." />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card titulo="1. Aplicativo Bling (credenciais)" descricao="Crie um aplicativo em developer.bling.com.br e informe o Client ID / Client Secret. Cadastre lá a URL de redirecionamento abaixo.">
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Client ID" value={cred.blingClientId} onChange={(e) => setCred({ ...cred, blingClientId: e.target.value })} autoComplete="off" />
              <Input label="Client Secret" type="password" value={cred.blingClientSecret} onChange={(e) => setCred({ ...cred, blingClientSecret: e.target.value })} placeholder={emp?.bling?.temSecret ? '•••••••• (cadastrado — preencha para trocar)' : ''} autoComplete="new-password" />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-all text-xs text-slate-500">
                URL de redirecionamento: <code className="inline-block max-w-full overflow-x-auto whitespace-nowrap rounded bg-slate-100 px-1 align-middle">{status?.callbackUrl ?? `${location.origin}${BASE_PATH}/configuracoes/bling/callback`}</code>
              </p>
              <Button variante="secundario" tamanho="sm" icone={<Save className="h-3.5 w-3.5" />} carregando={salvarCred.isPending} disabled={!cred.blingClientId.trim()} onClick={() => salvarCred.mutate()}>Salvar credenciais</Button>
            </div>
          </Card>

          <Card titulo="2. Conexão" acoes={isLoading ? <Skeleton className="h-5 w-24" /> : <Badge tom={status?.conectado ? 'verde' : 'cinza'} ponto>{status?.conectado ? 'Conectado' : 'Não conectado'}</Badge>}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                {status?.conectado ? (
                  <>
                    <p>Token válido{status.expira ? ` até ${dataHora(status.expira)}` : ''}.</p>
                    {status.ultimaImportacao && <p className="text-xs text-slate-400">Última importação: {dataHora(status.ultimaImportacao)}</p>}
                  </>
                ) : (
                  <p>Autorize o acesso à API v3 do Bling (OAuth). Abre em nova aba e volta para esta tela.</p>
                )}
              </div>
              <Button variante={status?.conectado ? 'secundario' : 'primario'} icone={<ExternalLink className="h-4 w-4" />} carregando={conectar.isPending} disabled={status ? status.configurado === false : false} onClick={() => conectar.mutate()}>{status?.conectado ? 'Reconectar' : 'Conectar ao Bling'}</Button>
            </div>
          </Card>

          <Card titulo="3. Importar pela API" descricao="Escolha o que importar. A ordem recomendada é: contatos → produtos → estoque → vendas/compras → financeiro → notas.">
            <div className="grid gap-2 sm:grid-cols-2">
              {ENTIDADES.map((e) => (
                <Checkbox key={e.id} label={e.rotulo} checked={sel.has(e.id)} disabled={imp?.emAndamento} onChange={(ev) => setSel((s) => { const n = new Set(s); if (ev.target.checked) n.add(e.id); else n.delete(e.id); return n; })} />
              ))}
            </div>
            {sel.has('vendas') && (
              <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Opções dos pedidos de venda</p>
                <Checkbox label='Considerar fechadas as vendas que estão "Em aberto", "Em andamento" ou "Verificado" no Bling (entram como Fechada)' checked={fecharEmAberto} disabled={imp?.emAndamento} onChange={(ev) => setFecharEmAberto(ev.target.checked)} />
                <Checkbox label="Lançar o valor das vendas fechadas como recebido no Caixa, na data de cada venda (gera contas a receber baixadas e o fluxo de caixa)" checked={baixarNoCaixa} disabled={imp?.emAndamento} onChange={(ev) => setBaixarNoCaixa(ev.target.checked)} />
                <p className="text-[11px] text-slate-400">O resumo (quantidade de pedidos, total por mês/situação e valor lançado no caixa) aparece no log ao final.</p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <DateInput label="A partir de (vendas/compras/financeiro)" value={dataInicial} onChange={setDataInicial} className="w-64" />
              <DateInput label="Até (padrão: hoje)" value={dataFinal} onChange={setDataFinal} className="w-48" />
              <Button variante="primario" icone={imp?.emAndamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} disabled={!status?.conectado || sel.size === 0 || imp?.emAndamento} carregando={importar.isPending} onClick={() => importar.mutate()}>{imp?.emAndamento ? 'Importando…' : 'Iniciar importação'}</Button>
            </div>

            {(imp?.emAndamento || imp?.progresso || imp?.log?.length) && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span>{imp?.emAndamento ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> {imp.progresso?.entidade ?? 'preparando'}</span> : <span className="inline-flex items-center gap-1 text-emerald-700"><CircleCheck className="h-3 w-3" /> Concluído</span>}</span>
                  {imp?.progresso && <span className="num">{imp.progresso.feitos}/{imp.progresso.total} ({pct}%)</span>}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className={clsx('h-full rounded-full transition-all', imp?.emAndamento ? 'bg-brand-600' : 'bg-emerald-500')} style={{ width: `${imp?.emAndamento ? pct : 100}%` }} />
                </div>
                {imp?.log?.length ? (
                  <div ref={logRef} className="max-h-48 overflow-auto rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                    {imp.log.map((l, i) => <div key={i} className={clsx(/erro|falha/i.test(l) && 'text-red-400')}>{l}</div>)}
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card titulo="4. Sincronizar contas a pagar" descricao="Separado da importação geral. Sem período, varre as situações 1 a 7. Com período, junta emissão, vencimento e pagamento. Lê o detalhe de cada título (é lá que está o saldo) e grava pelo id do Bling. A prévia não altera nada e não lança pagamento antigo no caixa.">
            <div className="flex flex-wrap items-end gap-2">
              <DateInput label="De (opcional)" value={syncDe} onChange={setSyncDe} className="w-44" />
              <DateInput label="Até" value={syncAte} onChange={setSyncAte} className="w-44" />
              <Button variante="secundario" icone={sync?.emAndamento && sync.modo === 'previa' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} disabled={!status?.conectado || syncOcupado} carregando={sincronizar.isPending && sincronizar.variables === 'previa'} onClick={() => sincronizar.mutate('previa')}>Prévia</Button>
              <Button variante="primario" icone={sync?.emAndamento && sync.modo === 'aplicar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} disabled={!status?.conectado || syncOcupado} onClick={() => setConfirmarSync(true)}>Sincronizar contas a pagar</Button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Em branco, lê todas as situações. Título de compra com o mesmo fornecedor, valor e vencimento recebe o id do Bling em vez de duplicar. Se o pagamento foi feito aqui, valor pago e situação ficam como estão.</p>
            {sync?.emAndamento && (
              <p className="mt-3 inline-flex items-center gap-1 text-xs text-slate-600"><Loader2 className="h-3 w-3 animate-spin" /> {sync.progresso?.fase ?? 'Sincronizando…'}{sync.progresso?.total ? ` (${sync.progresso.feitos}/${sync.progresso.total})` : sync.progresso?.feitos ? ` (${sync.progresso.feitos})` : ''}</p>
            )}
            {sync?.erro && <p className="mt-3 text-sm text-red-600">{sync.erro}</p>}
            {sync?.relatorio && <RelatorioSync relatorio={sync.relatorio} />}
            <ConfirmDialog
              aberto={confirmarSync}
              onFechar={() => setConfirmarSync(false)}
              onConfirmar={() => sincronizar.mutate('aplicar')}
              titulo="Sincronizar contas a pagar?"
              descricao="Grava e atualiza os títulos pelo id do Bling. Não cria movimento de caixa para pagamento antigo. A prévia, ao lado, mostra o mesmo relatório sem gravar."
              textoConfirmar="Sincronizar contas a pagar"
              perigo={false}
            />
          </Card>
        </div>

        <Card titulo="Importar planilha (CSV)" descricao="Sem API: exporte Contatos ou Produtos do Bling em CSV e envie aqui.">
          <div className="space-y-3">
            <Select label="Entidade" value={entCsv} onChange={(e) => setEntCsv(e.target.value)} opcoes={[{ valor: 'contatos', rotulo: 'Contatos' }, { valor: 'produtos', rotulo: 'Produtos' }]} />
            <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) csv.mutate(f); e.target.value = ''; }} />
            <Button variante="secundario" className="w-full" icone={<FileUp className="h-4 w-4" />} carregando={csv.isPending} onClick={() => csvRef.current?.click()}>Escolher arquivo CSV</Button>
            <p className="text-xs text-slate-400 inline-flex items-start gap-1"><Download className="mt-0.5 h-3 w-3 shrink-0" /> No Bling: Cadastros → Contatos/Produtos → Exportar → CSV (separador ponto e vírgula).</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TabelaSituacao({ titulo, linhas }: { titulo: string; linhas: RelatorioContasPagarBling['porSituacaoBling'] }) {
  const totalQtd = linhas.reduce((s, l) => s + l.quantidade, 0);
  const totalSoma = linhas.reduce((s, l) => s + l.soma, 0);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-600">{titulo}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="py-1 font-medium">Situação</th>
            <th className="py-1 text-right font-medium">Qtd</th>
            <th className="py-1 text-right font-medium">Soma</th>
            <th className="py-1 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.situacao} className="border-t border-slate-100">
              <td className="py-1">{l.rotulo}</td>
              <td className="num py-1 text-right">{l.quantidade}</td>
              <td className="num py-1 text-right">{moeda(l.soma)}</td>
              <td className="num py-1 text-right">{moeda(l.saldo)}</td>
            </tr>
          ))}
          <tr className="border-t border-slate-200 font-medium text-slate-700">
            <td className="py-1">Total</td>
            <td className="num py-1 text-right">{totalQtd}</td>
            <td className="num py-1 text-right">{moeda(totalSoma)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ListaCurta({ titulo, vazio, children }: { titulo: string; vazio: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-600">{titulo}</p>
      <div className="mt-1 text-xs text-slate-600">{children || <span className="text-slate-400">{vazio}</span>}</div>
    </div>
  );
}

/** Relatório da prévia ou da sincronização aplicada. */
function RelatorioSync({ relatorio: r }: { relatorio: RelatorioContasPagarBling }) {
  const corte = <T,>(lista: T[]) => lista.slice(0, 12);
  return (
    <div className="mt-4 space-y-4 border-t border-slate-100 pt-4" data-relatorio="contas-pagar">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tom={r.gravado ? 'verde' : 'amarelo'}>{r.gravado ? 'Aplicado' : 'Prévia — nada gravado'}</Badge>
        <span className="text-xs text-slate-500">{r.lidos} na listagem · {r.detalhes} detalhes · {r.criados} {r.gravado ? 'criados' : 'a criar'} · {r.atualizados} {r.gravado ? 'atualizados' : 'a atualizar'} · {r.vinculados} compras {r.gravado ? 'vinculadas' : 'a vincular'} · {r.preservados} com pagamento local</span>
      </div>
      {r.interrompido && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Parei na página {r.interrompido.pagina} ({r.interrompido.consulta}), com {r.interrompido.titulosLidos} títulos lidos. {r.interrompido.motivo}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <TabelaSituacao titulo="No Bling" linhas={r.porSituacaoBling} />
        <TabelaSituacao titulo={r.gravado ? 'No meu-bling, depois' : 'No meu-bling, se aplicar'} linhas={r.porSituacaoMeuBling} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ListaCurta titulo={`Faltantes (${r.faltantes.length})`} vazio="Nenhum título do Bling ficou de fora.">
          {r.faltantes.length ? corte(r.faltantes).map((f) => (
            <p key={f.blingId}>Bling {f.blingId} · {moeda(f.valor)} · {f.vencimento ?? '—'} · {f.fornecedor ?? 'sem fornecedor'} · {f.acao === 'ambiguo' ? 'duplicata, não criei' : r.gravado ? 'criado' : 'seria criado'}</p>
          )) : null}
        </ListaCurta>
        <ListaCurta titulo={`Sobrando no meu-bling (${r.sobrando.length})`} vazio="Nada no meu-bling ficou sem par no Bling.">
          {r.sobrando.length ? corte(r.sobrando).map((c) => (
            <p key={c.id}>#{c.id} {c.descricao} · {moeda(c.valor)} · {c.situacao}{c.blingId ? ` · Bling ${c.blingId}` : ''}</p>
          )) : null}
        </ListaCurta>
        <ListaCurta titulo={`Divergências (${r.divergencias.length})`} vazio="Valor, saldo, vencimento, fornecedor e situação batem.">
          {r.divergencias.length ? corte(r.divergencias).map((d, i) => (
            <p key={`${d.blingId}-${d.campo}-${i}`}>Bling {d.blingId} · {d.campo}: Bling {d.bling} / aqui {d.local}{d.preservado ? ' (mantido: há pagamento feito aqui)' : ''}</p>
          )) : null}
        </ListaCurta>
        <ListaCurta titulo={`Duplicatas prováveis (${r.duplicatasProvaveis.length})`} vazio="Nenhuma duplicata provável.">
          {r.duplicatasProvaveis.length ? corte(r.duplicatasProvaveis).map((d) => (
            <p key={d.blingId}>Bling {d.blingId}: {d.motivo} ({d.contasLocais.map((c) => `#${c.id}`).join(', ')})</p>
          )) : null}
        </ListaCurta>
        <ListaCurta titulo={`Erros (${r.erros.length})`} vazio="Nenhum erro por título.">
          {r.erros.length ? corte(r.erros).map((e, i) => (
            <p key={i} className="text-red-600">{e.blingId ? `Bling ${e.blingId}: ` : ''}{e.motivo}</p>
          )) : null}
        </ListaCurta>
        <ListaCurta titulo={`Situações 4, 6 e 7 (${r.situacoesRegistradas.length})`} vazio="Nenhuma situação devolvida ou sem mapa.">
          {r.situacoesRegistradas.length ? corte(r.situacoesRegistradas).map((s) => (
            <p key={s.blingId}>Bling {s.blingId} · situação {s.situacaoBling}: {s.motivo}</p>
          )) : null}
        </ListaCurta>
      </div>
      {r.cadastrosMinimos.length > 0 && (
        <p className="text-xs text-slate-500">Cadastros mínimos: {r.cadastrosMinimos.map((c) => `${c.tipo} ${c.nome} (${c.criado ? 'criado' : 'seria criado'})`).join(' · ')}</p>
      )}
      {r.portadoresSemConta.length > 0 && (
        <p className="text-xs text-slate-500">Portador sem conta financeira aqui: {r.portadoresSemConta.map((p) => `título ${p.blingId} → portador ${p.portadorBlingId}`).join(' · ')}</p>
      )}
    </div>
  );
}
