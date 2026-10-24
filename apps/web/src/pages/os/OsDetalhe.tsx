import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { BadgeCheck, ExternalLink, FileText, Image as ImageIcon, Link2, Paperclip, Pencil, Printer, Send, Trash2, Undo2, Upload, Zap } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro, urlUpload, BASE_PATH } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, PageHeader, StatusBadge, StatusChanger, Tabs, tomPorStatus } from '@/components/ui';
import { HistoricoSituacoes } from '@/components/compartilhados/HistoricoSituacoes';
import { NotificarModal } from '@/components/compartilhados/NotificarModal';
import { EmitirNfModal } from '@/components/compartilhados/EmitirNfModal';
import { NotificacoesLista } from '@/components/compartilhados/NotificacoesLista';
import { data, dataHora, diasAtraso, moeda, numero, rotulo, tamanhoArquivo } from '@/lib/format';
import type { Contato, OrdemServico, OsAnexo } from '@/types';

const PRIORIDADE_TOM: Record<string, 'neutro' | 'azul' | 'amarelo' | 'vermelho'> = { BAIXA: 'neutro', NORMAL: 'azul', ALTA: 'amarelo', URGENTE: 'vermelho' };

function urlAnexo(a: OsAnexo): string {
  if (a.url) return a.url;
  if (a.caminho) return urlUpload(a.caminho);
  return '#';
}

/** Detalhe da ordem de serviço */
export default function OsDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('equipamento');
  const [notificar, setNotificar] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: os, isLoading, error } = useQuery({ queryKey: ['os', id], queryFn: () => api.get<OrdemServico>(`/ordens-servico/${id}`) });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['os', id] });
    qc.invalidateQueries({ queryKey: ['ordens-servico'] });
    qc.invalidateQueries({ queryKey: ['os-kanban'] });
  };

  const acoes = useMutation({
    mutationFn: (lista: string[]) => api.post(`/ordens-servico/${id}/acoes`, { acoes: lista }),
    onSuccess: (_, lista) => {
      toast.success(`Ação executada: ${lista.join(', ')}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const aprovar = useMutation({
    mutationFn: () => api.post(`/ordens-servico/${id}/aprovar-orcamento`, { aprovadoPor: 'Loja (balcão)' }),
    onSuccess: () => {
      toast.success('Orçamento aprovado.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const [nfeAberto, setNfeAberto] = useState(false);
  const enviarAnexo = useMutation({
    mutationFn: (arquivos: FileList) => {
      const fd = new FormData();
      Array.from(arquivos).forEach((f) => fd.append('arquivo', f));
      return api.upload<OsAnexo>(`/ordens-servico/${id}/anexos`, fd);
    },
    onSuccess: () => {
      toast.success('Anexo enviado.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });
  const removerAnexo = useMutation({
    mutationFn: (anexoId: number) => api.del(`/ordens-servico/${id}/anexos/${anexoId}`),
    onSuccess: () => {
      toast.success('Anexo removido.');
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const imprimir = (via: 'cliente' | 'tecnico' | 'etiqueta') => abrirEmNovaAba(`/ordens-servico/${id}/imprimir`, { via }).catch((e) => toast.error(mensagemErro(e)));

  if (isLoading) return <FormSkeleton />;
  if (error || !os) return <EmptyState titulo="OS não encontrada" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/ordens-servico"><Button>Voltar</Button></Link>} />;

  const contato = os.contato as Contato;
  const atrasada = os.atrasada ?? (os.dataPrevista ? diasAtraso(os.dataPrevista) > 0 && !os.dataConclusao : false);
  const linkPublico = os.linkPublico ?? (os.token ? `${location.origin}${BASE_PATH}/p/os/${os.token}` : null);
  const pecas = os.itens.filter((i) => i.tipo === 'PECA');
  const servicos = os.itens.filter((i) => i.tipo === 'SERVICO');

  const tabelaItens = (lista: typeof os.itens, mostrarDeposito: boolean) => (
    <div className="overflow-x-auto">
    <table className="tbl tbl-pilha">
      <thead>
        <tr>
          <th>Descrição</th>
          {mostrarDeposito && <th>Depósito</th>}
          <th className="text-right">Qtd</th>
          <th className="text-right">Unitário</th>
          <th className="text-right">Desc.</th>
          <th className="text-right">Com. téc.</th>
          <th className="text-right">Total</th>
          {mostrarDeposito && <th>Estoque</th>}
        </tr>
      </thead>
      <tbody>
        {lista.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-xs text-slate-400">Nenhum item.</td></tr>}
        {lista.map((it, i) => (
          <tr key={it.id ?? i}>
            <td className="pilha-cheio">{it.produtoId ? <Link to={`/produtos/${it.produtoId}`} className="hover:text-brand-600">{it.descricao}</Link> : it.descricao}</td>
            {mostrarDeposito && <td className="text-xs text-slate-500" data-rotulo="Depósito">{it.depositoId ? `#${it.depositoId}` : os.deposito?.nome ?? '—'}</td>}
            <td className="num text-right" data-rotulo="Qtd">{numero(it.quantidade)}</td>
            <td className="num text-right" data-rotulo="Unitário">{moeda(it.valorUnitario)}</td>
            <td className="num text-right" data-rotulo="Desc.">{moeda(it.desconto)}</td>
            <td className="num text-right text-slate-500" data-rotulo="Com. téc.">{numero(it.comissaoTecnicoPct)}%</td>
            <td className="num text-right font-medium" data-rotulo="Total">{moeda(it.total ?? it.quantidade * it.valorUnitario - it.desconto)}</td>
            {mostrarDeposito && <td data-rotulo="Estoque"><Badge tom={it.estoqueBaixado ? 'verde' : 'cinza'}>{it.estoqueBaixado ? 'baixado' : 'pendente'}</Badge></td>}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Ordens de serviço', para: '/ordens-servico' }, { rotulo: `OS nº ${os.numero}` }]}
        titulo={`OS nº ${os.numero}`}
        extra={
          <>
            <StatusChanger modulo="OS" caminho={`/ordens-servico/${os.id}`} situacaoAtual={os.situacao} situacoesPermitidas={os.situacoesPermitidas} invalidar={[['os', id ?? ''], ['ordens-servico'], ['os-kanban'], ['dashboard-geral']]} />
            <Badge tom={PRIORIDADE_TOM[os.prioridade]}>{rotulo(os.prioridade)}</Badge>
            {atrasada && <Badge tom="vermelho" ponto>Atrasada</Badge>}
          </>
        }
        descricao={`${[os.equipamento, os.marca, os.modelo].filter(Boolean).join(' ')} · ${contato?.nome ?? ''} · entrada ${data(os.dataEntrada)}`}
        acoes={
          <>
            <div className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white shadow-xs">
              {(['cliente', 'tecnico', 'etiqueta'] as const).map((v, i) => (
                <button key={v} onClick={() => imprimir(v)} className={clsx('inline-flex h-9 items-center gap-1.5 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50', i > 0 && 'border-l border-slate-200')}>
                  {i === 0 && <Printer className="h-4 w-4" />}
                  {v === 'cliente' ? 'Via cliente' : v === 'tecnico' ? 'Via técnico' : 'Etiqueta'}
                </button>
              ))}
            </div>
            <Button variante="secundario" icone={<Send className="h-4 w-4" />} onClick={() => setNotificar(true)}>WhatsApp / E-mail</Button>
            <Link to={`/ordens-servico/${os.id}/editar`}><Button variante="primario" icone={<Pencil className="h-4 w-4" />}>Editar</Button></Link>
          </>
        }
      />

      {os.orcar && !os.orcamentoAprovado && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" /> Orçamento de <strong className="num">{moeda(os.total)}</strong> aguardando aprovação do cliente.</span>
          <div className="flex gap-2">
            {linkPublico && <Button tamanho="sm" variante="secundario" icone={<Link2 className="h-3.5 w-3.5" />} onClick={() => { navigator.clipboard.writeText(linkPublico); toast.success('Link copiado.'); }}>Copiar link público</Button>}
            <Button tamanho="sm" variante="sucesso" carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>Aprovar orçamento</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Definicoes
            colunas={4}
            itens={[
              { rotulo: 'Cliente', valor: <Link to={`/contatos/${os.contatoId}`} className="font-medium text-brand-600 hover:underline">{contato?.nome}</Link> },
              { rotulo: 'Contato', valor: contato?.celular || contato?.telefone || contato?.email || '—' },
              { rotulo: 'Técnico', valor: os.tecnico?.nome },
              { rotulo: 'Atendente', valor: os.vendedor?.nome },
              { rotulo: 'Entrada', valor: data(os.dataEntrada) },
              { rotulo: 'Previsão', valor: <span className={atrasada ? 'font-medium text-red-600' : ''}>{os.dataPrevista ? data(os.dataPrevista) : '—'}</span> },
              { rotulo: 'Conclusão', valor: os.dataConclusao ? data(os.dataConclusao) : '—' },
              { rotulo: 'Garantia', valor: `${os.garantiaDias} dias` },
            ]}
          />
        </Card>
        <Card titulo="Totais e lançamentos">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Serviços</span><span className="num">{moeda(os.totalServicos)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Peças</span><span className="num">{moeda(os.totalPecas)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Desconto</span><span className="num text-red-600">- {moeda(os.descontoValor)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-semibold">Total</span><span className="num font-bold">{moeda(os.total)}</span></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button tamanho="sm" variante={os.estoqueLancado ? 'perigo' : 'secundario'} icone={os.estoqueLancado ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([os.estoqueLancado ? 'estornarEstoque' : 'lancarEstoque'])}>
              {os.estoqueLancado ? 'Estornar peças' : 'Baixar peças'}
            </Button>
            <Button tamanho="sm" variante={os.contasLancadas ? 'perigo' : 'secundario'} icone={os.contasLancadas ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([os.contasLancadas ? 'estornarContas' : 'lancarContas'])}>
              {os.contasLancadas ? 'Estornar contas' : 'Lançar contas'}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tom={os.estoqueLancado ? 'verde' : 'cinza'}>Peças {os.estoqueLancado ? 'baixadas' : 'pendentes'}</Badge>
            <Badge tom={os.contasLancadas ? 'verde' : 'cinza'}>Contas {os.contasLancadas ? 'lançadas' : 'pendentes'}</Badge>
            {os.orcar && <Badge tom={os.orcamentoAprovado ? 'verde' : 'amarelo'}>{os.orcamentoAprovado ? 'Orçamento aprovado' : 'Aguardando orçamento'}</Badge>}
          </div>
        </Card>
      </div>

      <Card semPadding>
        <Tabs
          className="px-3"
          ativa={aba}
          onMudar={setAba}
          abas={[
            { id: 'equipamento', rotulo: 'Equipamento & diagnóstico' },
            { id: 'itens', rotulo: 'Peças e serviços', contador: os.itens.length },
            { id: 'orcamento', rotulo: 'Orçamento' },
            { id: 'financeiro', rotulo: 'Financeiro', contador: os.parcelas.length },
            { id: 'anexos', rotulo: 'Anexos', contador: os.anexos?.length ?? 0 },
            { id: 'historico', rotulo: 'Histórico', contador: os.historico?.length ?? 0 },
            { id: 'notificacoes', rotulo: 'Notificações' },
          ]}
        />
        <div className="p-4">
          {aba === 'equipamento' && (
            <div className="space-y-5">
              <Definicoes
                colunas={4}
                itens={[
                  { rotulo: 'Equipamento', valor: os.equipamento },
                  { rotulo: 'Marca / modelo', valor: [os.marca, os.modelo].filter(Boolean).join(' ') || '—' },
                  { rotulo: 'Nº de série', valor: os.numeroSerie ? <span className="font-mono text-xs">{os.numeroSerie}</span> : '—' },
                  { rotulo: 'Senha', valor: os.senhaEquipamento },
                  { rotulo: 'Acessórios', valor: os.acessorios, largo: true },
                  { rotulo: 'Estado físico', valor: os.estadoFisico, largo: true },
                ]}
              />
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { t: 'Defeito relatado', v: os.defeitoRelatado },
                  { t: 'Diagnóstico técnico', v: os.diagnostico },
                  { t: 'Serviço executado', v: os.servicoExecutado },
                ].map((b) => (
                  <div key={b.t} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{b.t}</p>
                    <p className="whitespace-pre-line text-sm text-slate-700">{b.v || <span className="text-slate-400">—</span>}</p>
                  </div>
                ))}
              </div>
              {(os.observacoes || os.observacoesInternas) && (
                <Definicoes
                  colunas={2}
                  itens={[
                    { rotulo: 'Observações', valor: <span className="whitespace-pre-line">{os.observacoes || '—'}</span> },
                    { rotulo: 'Observações internas', valor: <span className="whitespace-pre-line text-slate-500">{os.observacoesInternas || '—'}</span> },
                  ]}
                />
              )}
            </div>
          )}
          {aba === 'itens' && (
            <div className="space-y-5">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Serviços · {moeda(os.totalServicos)}</h4>
                {tabelaItens(servicos, false)}
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Peças · {moeda(os.totalPecas)}</h4>
                {tabelaItens(pecas, true)}
              </div>
              {pecas.some((p) => p.produtoId) && !os.nota && (
                <div className="flex justify-end">
                  <Button variante="secundario" icone={<FileText className="h-4 w-4" />} onClick={() => setNfeAberto(true)}>Gerar NF-e das peças</Button>
                </div>
              )}
              {os.nota && <p className="text-xs text-slate-500">NF-e nº <Link to={`/notas-fiscais/${os.nota.id}`} className="text-brand-600 hover:underline">{os.nota.numero}</Link> · {rotulo(os.nota.situacao)}</p>}
            </div>
          )}
          {aba === 'orcamento' && (
            <div className="space-y-4">
              {!os.orcar ? (
                <EmptyState compacto titulo="Esta OS não exige orçamento" descricao='Marque "Orçar" na edição da OS para exigir aprovação do cliente.' />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tom={os.orcamentoAprovado ? 'verde' : 'amarelo'} ponto>{os.orcamentoAprovado ? 'Aprovado' : 'Aguardando aprovação'}</Badge>
                    {os.orcamentoAprovado && <span className="text-sm text-slate-500">por {os.orcamentoAprovadoPor ?? '—'} em {dataHora(os.orcamentoAprovadoEm)}</span>}
                    {!os.orcamentoAprovado && <Button tamanho="sm" variante="sucesso" carregando={aprovar.isPending} onClick={() => aprovar.mutate()}>Aprovar orçamento</Button>}
                  </div>
                  <div className="overflow-x-auto">
                  <table className="tbl tbl-pilha">
                    <thead><tr><th>Tipo</th><th>Descrição</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
                    <tbody>
                      {os.itens.map((it, i) => (
                        <tr key={it.id ?? i}><td data-rotulo="Tipo"><Badge>{rotulo(it.tipo)}</Badge></td><td className="pilha-cheio">{it.descricao}</td><td className="num text-right" data-rotulo="Qtd">{numero(it.quantidade)}</td><td className="num text-right" data-rotulo="Unitário">{moeda(it.valorUnitario)}</td><td className="num text-right" data-rotulo="Total">{moeda(it.total ?? it.quantidade * it.valorUnitario - it.desconto)}</td></tr>
                      ))}
                      <tr className="font-semibold"><td colSpan={4} className="text-right">Total do orçamento</td><td className="num text-right">{moeda(os.total)}</td></tr>
                    </tbody>
                  </table>
                  </div>
                  {linkPublico ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 p-3 text-sm">
                      <Link2 className="h-4 w-4 text-slate-400" />
                      <span className="text-slate-600">Link de acompanhamento para o cliente:</span>
                      <a href={linkPublico} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-brand-600 hover:underline">{linkPublico} <ExternalLink className="h-3 w-3" /></a>
                      <Button tamanho="xs" variante="secundario" onClick={() => { navigator.clipboard.writeText(linkPublico); toast.success('Link copiado.'); }}>Copiar</Button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">O link público aparece quando a API devolver o campo <code>token</code> da OS (ou use a variável {'{{link}}'} nos templates).</p>
                  )}
                </>
              )}
            </div>
          )}
          {aba === 'financeiro' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead><tr><th>#</th><th>Vencimento</th><th>Forma</th><th className="text-right">Valor</th><th>Conta a receber</th><th className="text-right">Recebido</th></tr></thead>
              <tbody>
                {os.parcelas.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-xs text-slate-400">Sem parcelas.</td></tr>}
                {os.parcelas.map((p, i) => (
                  <tr key={p.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{p.numero ?? i + 1}</td>
                    <td data-rotulo="Vencimento">{data(p.dataVencimento)}</td>
                    <td data-rotulo="Forma">{p.formaPagamento?.nome ?? '—'}</td>
                    <td className="num text-right" data-rotulo="Valor">{moeda(p.valor)}</td>
                    <td data-rotulo="Conta a receber">{p.contaReceber ? <span className="inline-flex items-center gap-1.5">#{p.contaReceber.id} <Badge tom={tomPorStatus(p.contaReceber.situacao)}>{rotulo(p.contaReceber.situacao)}</Badge></span> : <span className="text-xs text-slate-400">não lançada</span>}</td>
                    <td className="num text-right" data-rotulo="Recebido">{p.contaReceber ? moeda(p.contaReceber.valorRecebido) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'anexos' && (
            <div className="space-y-3">
              <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(e) => { if (e.target.files?.length) enviarAnexo.mutate(e.target.files); e.target.value = ''; }} />
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">Fotos do equipamento, laudos e comprovantes.</p>
                <Button variante="secundario" icone={<Upload className="h-4 w-4" />} carregando={enviarAnexo.isPending} onClick={() => fileRef.current?.click()}>Enviar arquivo</Button>
              </div>
              {os.anexos?.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {os.anexos.map((a) => {
                    const ehImagem = (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.nome);
                    const u = urlAnexo(a);
                    return (
                      <div key={a.id} className="group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                        <a href={u} target="_blank" rel="noreferrer" className="block">
                          {ehImagem ? <img src={u} alt={a.nome} className="h-32 w-full object-cover" /> : <div className="flex h-32 items-center justify-center text-slate-400">{/\.pdf$/i.test(a.nome) ? <FileText className="h-8 w-8" /> : <Paperclip className="h-8 w-8" />}</div>}
                        </a>
                        <div className="flex items-center gap-1 px-2 py-1.5 text-xs">
                          {ehImagem ? <ImageIcon className="h-3 w-3 text-slate-400" /> : <Paperclip className="h-3 w-3 text-slate-400" />}
                          <span className="min-w-0 flex-1 truncate text-slate-700" title={a.nome}>{a.nome}</span>
                          <span className="text-slate-400">{tamanhoArquivo(a.tamanho)}</span>
                        </div>
                        <button onClick={() => removerAnexo.mutate(a.id)} className="absolute right-1 top-1 hidden rounded bg-white/90 p-1 text-red-600 shadow group-hover:block" aria-label="Remover anexo"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState compacto icone={<Paperclip className="h-5 w-5" />} titulo="Nenhum anexo" descricao="Envie fotos do equipamento na entrada para registrar o estado físico." />
              )}
            </div>
          )}
          {aba === 'historico' && <HistoricoSituacoes historico={os.historico} />}
          {aba === 'notificacoes' && <NotificacoesLista origemTipo="OS" origemId={os.id} />}
        </div>
      </Card>

      {!os.estoqueLancado && !os.contasLancadas && (
        <div className="flex justify-end">
          <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir OS</Button>
        </div>
      )}

      <NotificarModal aberto={notificar} onFechar={() => setNotificar(false)} caminho={`/ordens-servico/${os.id}`} eventoTemplate="OS_SITUACAO" eventosExtras={["OS_CRIADA", "ORCAMENTO_OS"]} destinatarios={{ email: contato?.email, celular: contato?.celular }} />
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir OS?" descricao={`A OS nº ${os.numero} será removida.`} textoConfirmar="Excluir" onConfirmar={async () => { try { await api.del(`/ordens-servico/${id}`); toast.success('OS excluída.'); invalidar(); nav('/ordens-servico'); } catch (e) { toast.error(mensagemErro(e)); } }} />
      <EmitirNfModal
        aberto={nfeAberto}
        onFechar={() => setNfeAberto(false)}
        origem="ordens-servico"
        id={Number(id)}
        numero={os?.numero}
        onGerada={(notaId) => {
          invalidar();
          setNfeAberto(false);
          nav(`/notas-fiscais/${notaId}`);
        }}
      />
    </div>
  );
}
