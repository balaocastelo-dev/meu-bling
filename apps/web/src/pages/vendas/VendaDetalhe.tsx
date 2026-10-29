import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, Clock, FileText, Link2, Pencil, Printer, Send, ShoppingCart, Undo2, Zap } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, Modal, PageHeader, Select, StatusChanger, Tabs, Textarea, tomPorStatus, ValorOculto } from '@/components/ui';
import { VendaAcoes } from '@/components/compartilhados/VendaAcoes';
import { HistoricoSituacoes } from '@/components/compartilhados/HistoricoSituacoes';
import { NotificarModal } from '@/components/compartilhados/NotificarModal';
import { EmitirNfModal } from '@/components/compartilhados/EmitirNfModal';
import { BotaoRoboNf } from '@/components/compartilhados/RoboNf';
import { ImprimirVenda } from '@/components/compartilhados/ImprimirVenda';
import { NotificacoesLista } from '@/components/compartilhados/NotificacoesLista';
import { data, dataHora, moeda, numero, rotulo } from '@/lib/format';
import type { Contato, Venda } from '@/types';
import { FotoProduto, SeloProntaEntrega } from '@/components/compartilhados/ProdutoSite';
import { FinalizarVendaModal } from '@/components/compartilhados/FinalizarVenda';
import { PosVendaImpressao } from '@/components/compartilhados/PosVendaImpressao';
import { LinkPagamento } from '@/components/compartilhados/LinkPagamento';

/** Detalhe do pedido de venda com abas e ações */
export default function VendaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('itens');
  const [notificar, setNotificar] = useState(false);
  const [converter, setConverter] = useState(false);
  const [finalizar, setFinalizar] = useState(false);
  const [nfe, setNfe] = useState<{ modelo: 55 | 65; info: string } | null>(null);

  const { data: venda, isLoading, error } = useQuery({ queryKey: ['venda', id], queryFn: () => api.get<Venda>(`/vendas/${id}`) });

  // impressão logo depois de finalizar: quando a venda vira "Fechada"/"NF emitida" nesta tela,
  // ou quando chega aqui recém-salva já finalizada (VendaForm manda state.imprimir)
  const local = useLocation();
  const [posVenda, setPosVenda] = useState(false);
  const finalAnterior = useRef<{ id: string | undefined; final: boolean } | null>(null);
  useEffect(() => {
    if (!venda || venda.tipo === 'ORCAMENTO') return;
    const s = venda.situacao as { final?: boolean; cancelamento?: boolean };
    const final = !!s.final && !s.cancelamento;
    const antes = finalAnterior.current;
    if (antes && antes.id === id && !antes.final && final) setPosVenda(true);
    if (!antes && final && (local.state as { imprimir?: boolean } | null)?.imprimir) {
      setPosVenda(true);
      nav(local.pathname, { replace: true, state: null }); // não abre de novo ao recarregar
    }
    finalAnterior.current = { id, final };
  }, [venda, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['venda', id] });
    qc.invalidateQueries({ queryKey: ['vendas'] });
  };

  const converterM = useMutation({
    mutationFn: () => api.post<Venda>(`/vendas/${id}/converter`, {}),
    onSuccess: (v) => {
      toast.success(`Orçamento convertido: venda nº ${v.numero} criada.`);
      invalidar();
      setConverter(false);
      nav(`/vendas/${v.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const copiarLink = async () => {
    if (!venda?.linkPublico) return;
    try {
      await navigator.clipboard.writeText(venda.linkPublico);
      toast.success('Link de aprovação copiado.');
    } catch {
      toast.error('Não foi possível copiar. Link: ' + venda.linkPublico);
    }
  };

  const acoes = useMutation({
    mutationFn: (lista: string[]) => api.post<{ acoesExecutadas?: string[] }>(`/vendas/${id}/acoes`, { acoes: lista }),
    onSuccess: (_, lista) => {
      toast.success(`Ação executada: ${lista.join(', ')}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });


  const imprimir = async () => {
    try {
      await abrirEmNovaAba(`/vendas/${id}/imprimir`);
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  if (isLoading) return <FormSkeleton />;
  if (error || !venda) return <EmptyState titulo="Venda não encontrada" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/vendas"><Button>Voltar</Button></Link>} />;

  const contato = venda.contato as Contato;
  const orcamento = venda.tipo === 'ORCAMENTO';
  const base = orcamento ? '/orcamentos' : '/vendas';
  const Nome = orcamento ? 'Orçamento' : 'Venda';
  const convertido = !!venda.vendaGerada;
  const fechado = !!(venda.situacao as { cancelamento?: boolean }).cancelamento;
  const jaFinalizada = !!(venda.situacao as { final?: boolean }).final && !fechado;
  const vencido = orcamento && !convertido && !!venda.validade && new Date(venda.validade).getTime() < Date.now() - 86400000;

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: orcamento ? 'Orçamentos' : 'Vendas', para: base }, { rotulo: `${Nome} nº ${venda.numero}` }]}
        titulo={`${Nome} nº ${venda.numero}`}
        extra={<StatusChanger modulo={orcamento ? 'ORCAMENTO' : 'VENDA'} caminho={`/vendas/${venda.id}`} situacaoAtual={venda.situacao} situacoesPermitidas={venda.situacoesPermitidas} invalidar={[['venda', id ?? ''], ['vendas'], ['dashboard-geral']]} />}
        descricao={`${data(venda.data)} · ${contato?.nome ?? ''} · ${venda.vendedor?.nome ? 'vendedor ' + venda.vendedor.nome : 'sem vendedor'}`}
        acoes={
          <>
            {/* robô de NF: "Pronto pra NF" (verde) ou "Falta N pra NF" (amarelo) */}
            {!orcamento && !fechado && !venda.nota && <BotaoRoboNf vendaId={venda.id} numero={venda.numero} onEmitida={invalidar} />}
            <VendaAcoes venda={venda} contexto="detalhe" />
            <ImprimirVenda vendaId={venda.id} orcamento={orcamento} aoImprimirPedido={imprimir} />
            <Button variante="secundario" icone={<Send className="h-4 w-4" />} onClick={() => setNotificar(true)}>
              Enviar ao cliente
            </Button>
            {!convertido && (
              <Link to={`${base}/${venda.id}/editar`}>
                <Button variante={orcamento ? 'secundario' : 'primario'} icone={<Pencil className="h-4 w-4" />}>
                  Editar
                </Button>
              </Link>
            )}
            {!orcamento && !jaFinalizada && (
              <Button variante="sucesso" icone={<CheckCircle2 className="h-4 w-4" />} onClick={() => setFinalizar(true)}>
                Finalizar venda
              </Button>
            )}
            {orcamento && !convertido && (
              <Button variante="primario" icone={<ShoppingCart className="h-4 w-4" />} onClick={() => setConverter(true)} disabled={fechado}>
                Converter em venda
              </Button>
            )}
          </>
        }
      />

      {/* Faixa do orçamento: validade, aprovação, link do cliente e venda gerada */}
      {orcamento && (
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-3 text-sm ${convertido ? 'border-emerald-200 bg-emerald-50' : vencido ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          {convertido ? (
            <span className="flex items-center gap-2 font-medium text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Convertido na venda
              <Link to={`/vendas/${venda.vendaGerada!.id}`} className="inline-flex items-center gap-1 text-emerald-700 underline">
                nº {venda.vendaGerada!.numero} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : (
            <>
              <span className={`flex items-center gap-1.5 ${vencido ? 'font-medium text-red-700' : 'text-amber-900'}`}>
                <Clock className="h-4 w-4" /> {venda.validade ? `${vencido ? 'Venceu em' : 'Válido até'} ${data(venda.validade)}` : 'Sem validade'}
              </span>
              <span className={`flex items-center gap-1.5 ${venda.aprovadoEm ? 'font-medium text-emerald-700' : 'text-amber-900'}`}>
                <CheckCircle2 className="h-4 w-4" />
                {venda.aprovadoEm ? `Aprovado em ${dataHora(venda.aprovadoEm)}${venda.aprovadoPor ? ' · ' + venda.aprovadoPor : ''}` : 'Aguardando aprovação do cliente'}
              </span>
              <button type="button" onClick={copiarLink} className="flex items-center gap-1.5 text-amber-900 underline-offset-2 hover:underline">
                <Link2 className="h-4 w-4" /> Copiar link de aprovação
              </button>
            </>
          )}
        </div>
      )}
      {!orcamento && venda.orcamento && (
        <p className="text-xs text-slate-500">
          Gerada do <Link to={`/orcamentos/${venda.orcamento.id}`} className="font-medium text-brand-600 hover:underline">orçamento nº {venda.orcamento.numero}</Link>
        </p>
      )}

      {/* Resumo + ações de lançamento */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Definicoes
            colunas={4}
            itens={[
              { rotulo: 'Cliente', valor: <Link to={`/contatos/${venda.contatoId}`} className="font-medium text-brand-600 hover:underline">{contato?.nome}</Link> },
              { rotulo: 'Vendedor', valor: venda.vendedor?.nome },
              { rotulo: 'Origem', valor: rotulo(venda.origem) },
              { rotulo: 'Depósito', valor: venda.deposito?.nome },
              { rotulo: 'Data', valor: data(venda.data) },
              orcamento ? { rotulo: 'Validade', valor: venda.validade ? data(venda.validade) : '—' } : { rotulo: 'Previsão', valor: venda.dataPrevista ? data(venda.dataPrevista) : '—' },
              { rotulo: 'Categoria', valor: venda.categoriaFinanceira?.nome },
              ...(orcamento ? [] : [{ rotulo: 'NF-e', valor: venda.nota ? <Link to={`/notas-fiscais/${venda.nota.id}`} className="text-brand-600 hover:underline">nº {venda.nota.numero} · {rotulo(venda.nota.situacao)}</Link> : '—' }]),
              ...(venda.observacoes ? [{ rotulo: 'Observações', valor: <span className="whitespace-pre-line">{venda.observacoes}</span>, largo: true }] : []),
              ...(venda.observacoesInternas ? [{ rotulo: 'Observações internas', valor: <span className="whitespace-pre-line text-slate-500">{venda.observacoesInternas}</span>, largo: true }] : []),
            ]}
          />
        </Card>
        <Card titulo={orcamento ? 'Totais' : 'Totais e lançamentos'}>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Produtos</span><span className="num">{moeda(venda.totalProdutos)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Desconto{venda.descontoTipo === 'PERCENTUAL' ? ` (${numero(venda.descontoValor)}%)` : ''}</span><span className="num text-red-600">- {moeda(venda.descontoTipo === 'PERCENTUAL' ? venda.totalProdutos * venda.descontoValor / 100 : venda.descontoValor)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Frete</span><span className="num">{moeda(venda.frete)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Outras</span><span className="num">{moeda(venda.outrasDespesas)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-semibold">Total</span><span className="num font-bold">{moeda(venda.total)}</span></div>
          </div>
          {/* custos internos — não saem no pedido, PDF, link, e-mail, WhatsApp nem NF */}
          <div className="mt-3 space-y-1 rounded-md border border-dashed border-slate-200 bg-slate-50/70 p-2.5 text-xs">
            <p className="mb-1 flex items-center justify-between font-semibold uppercase tracking-wide text-slate-400">
              <span>Custos internos 🔒</span>
              <Link to={`${orcamento ? '/orcamentos' : '/vendas'}/${venda.id}/editar`} className="normal-case tracking-normal text-brand-600 hover:underline">Lançar</Link>
            </p>
            {(() => {
              const custoProdutos = venda.fechamento?.custoProdutos ?? venda.custoTotal ?? 0;
              const semCusto = venda.itens.filter((i) => !i.custoUnitario).length;
              return (
                <>
                  <div className="flex justify-between"><span className="text-slate-500">Custo dos produtos</span><ValorOculto className="num">{moeda(custoProdutos)}{venda.fechamento?.custoProdutoPct ? ` (${numero(venda.fechamento.custoProdutoPct, 1)}%)` : ''}</ValorOculto></div>
                  {venda.fechamento?.custoProdutoEstimado ? (
                    <p className="text-[11px] text-amber-700">Custo estimado — informe o custo real em “Lançar”</p>
                  ) : semCusto > 0 && <p className="text-[11px] text-amber-700">{semCusto} {semCusto === 1 ? 'item' : 'itens'} sem custo</p>}
                  {venda.fechamento && (
                    <>
                      <div className="flex justify-between"><span className="text-slate-500">Imposto ({numero(venda.fechamento.impostoPct ?? 0, 1)}%)</span><ValorOculto className="num">{moeda(venda.fechamento.imposto ?? 0)}</ValorOculto></div>
                      <div className="flex justify-between"><span className="text-slate-500">Taxa do cartão{venda.fechamento.taxaCartao ? ` (${venda.fechamento.parcelasCartao ?? 1}x · ${numero(venda.fechamento.taxaCartaoPct ?? 0, 2)}%)` : ''}</span><ValorOculto className="num">{moeda(venda.fechamento.taxaCartao ?? 0)}</ValorOculto></div>
                    </>
                  )}
                  <div className="flex justify-between"><span className="text-slate-500">Frete / logística</span><ValorOculto className="num">{moeda(venda.fechamento?.frete ?? venda.custoLogistica ?? 0)}</ValorOculto></div>
                  {venda.fechamento && <div className="flex justify-between font-medium"><span className="text-slate-600">Custo total</span><ValorOculto className="num">{moeda(venda.fechamento.custoTotal)}</ValorOculto></div>}
                </>
              );
            })()}
            {venda.fechamento && (
              <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5 text-sm">
                <span className="font-semibold text-slate-700">Lucro</span>
                <span className={`num font-bold ${venda.fechamento.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}`}><ValorOculto>{moeda(venda.fechamento.lucro)} <span className="text-[11px] font-normal text-slate-400">({numero(venda.fechamento.margemPct, 1)}%)</span></ValorOculto></span>
              </div>
            )}
          </div>
          {!orcamento && (<>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button tamanho="sm" variante={venda.estoqueLancado ? 'perigo' : 'secundario'} icone={venda.estoqueLancado ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([venda.estoqueLancado ? 'estornarEstoque' : 'lancarEstoque'])}>
              {venda.estoqueLancado ? 'Estornar estoque' : 'Lançar estoque'}
            </Button>
            <Button tamanho="sm" variante={venda.contasLancadas ? 'perigo' : 'secundario'} icone={venda.contasLancadas ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([venda.contasLancadas ? 'estornarContas' : 'lancarContas'])}>
              {venda.contasLancadas ? 'Estornar contas' : 'Lançar contas'}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            <Badge tom={venda.estoqueLancado ? 'verde' : 'cinza'}>Estoque {venda.estoqueLancado ? 'lançado' : 'pendente'}</Badge>
            <Badge tom={venda.contasLancadas ? 'verde' : 'cinza'}>Contas {venda.contasLancadas ? 'lançadas' : 'pendentes'}</Badge>
          </div>
          </>)}
          {orcamento && <p className="mt-3 text-xs text-slate-400">Orçamento não movimenta estoque nem financeiro. Ao converter, a venda criada segue o fluxo normal.</p>}
          <div className="mt-3">
            <LinkPagamento venda={venda as any} />
          </div>
        </Card>
      </div>

      <Card semPadding>
        <Tabs
          className="px-3"
          ativa={aba}
          onMudar={setAba}
          abas={[
            { id: 'itens', rotulo: 'Itens', contador: venda.itens.length },
            { id: 'parcelas', rotulo: orcamento ? 'Condições de pagamento' : 'Parcelas / Financeiro', contador: venda.parcelas.length },
            ...(orcamento ? [] : [{ id: 'comissoes', rotulo: 'Comissões', contador: venda.comissoes?.length ?? 0 }]),
            { id: 'historico', rotulo: 'Histórico', contador: venda.historico?.length ?? 0 },
            ...(orcamento ? [] : [{ id: 'nfe', rotulo: 'NF-e' }]),
            { id: 'notificacoes', rotulo: 'Envios' },
          ]}
        />
        <div className="p-4">
          {aba === 'itens' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produto</th>
                  <th className="text-right">Qtd</th>
                  <th className="text-right">Unitário</th>
                  <th className="text-right">Desconto</th>
                  <th className="text-right">Com. %</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {venda.itens.map((it, i) => (
                  <tr key={it.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{i + 1}</td>
                    <td className="pilha-cheio">
                      <div className="flex items-center gap-2">
                        {it.produtoId && <FotoProduto url={it.produto?.imagemUrl} tamanho="sm" />}
                        <div className="min-w-0">
                          {it.produtoId ? <Link to={`/produtos/${it.produtoId}`} className="hover:text-brand-600">{it.descricao}</Link> : it.descricao}
                          <span className="flex items-center gap-2">
                            {it.codigo && <span className="text-xs text-slate-400">{it.codigo}</span>}
                            {it.produto?.prontaEntrega && <SeloProntaEntrega compacto />}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="num text-right" data-rotulo="Qtd">{numero(it.quantidade)} {it.unidade}</td>
                    <td className="num text-right" data-rotulo="Unitário">{moeda(it.valorUnitario)}</td>
                    <td className="num text-right" data-rotulo="Desconto">{moeda(it.desconto)}</td>
                    <td className="num text-right text-slate-500" data-rotulo="Com. %">{numero(it.comissaoPct ?? 0)}%</td>
                    <td className="num text-right font-medium" data-rotulo="Total">{moeda(it.total ?? it.quantidade * it.valorUnitario - it.desconto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'parcelas' && (
            <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Vencimento</th>
                  <th>Forma</th>
                  <th className="text-right">Valor</th>
                  <th>Conta a receber</th>
                  <th className="text-right">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {venda.parcelas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-xs text-slate-400">Sem parcelas.</td>
                  </tr>
                )}
                {venda.parcelas.map((p, i) => (
                  <tr key={p.id ?? i}>
                    <td className="pilha-oculto text-slate-400">{p.numero ?? i + 1}</td>
                    <td data-rotulo="Vencimento">{data(p.dataVencimento)}</td>
                    <td data-rotulo="Forma">{p.formaPagamento?.nome ?? '—'}</td>
                    <td className="num text-right" data-rotulo="Valor">{moeda(p.valor)}</td>
                    <td data-rotulo="Conta a receber">
                      {p.contaReceber ? (
                        <Link to={`/financeiro/receber?pesquisa=${venda.numero}`} className="inline-flex items-center gap-1.5 hover:underline">
                          #{p.contaReceber.id} <Badge tom={tomPorStatus(p.contaReceber.situacao)}>{rotulo(p.contaReceber.situacao)}</Badge>
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">não lançada</span>
                      )}
                    </td>
                    <td className="num text-right" data-rotulo="Recebido">{p.contaReceber ? moeda(p.contaReceber.valorRecebido) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          {aba === 'comissoes' &&
            (venda.comissoes?.length ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Pessoa</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">%</th>
                    <th className="text-right">Valor</th>
                    <th>Status</th>
                    <th>Competência</th>
                  </tr>
                </thead>
                <tbody>
                  {venda.comissoes.map((c) => (
                    <tr key={c.id}>
                      <td data-rotulo="Tipo">{rotulo(c.tipo)}</td>
                      <td data-rotulo="Pessoa">{c.vendedor?.nome ?? c.tecnico?.nome ?? '—'}</td>
                      <td className="num text-right" data-rotulo="Base">{moeda(c.base)}</td>
                      <td className="num text-right" data-rotulo="%">{numero(c.pct)}%</td>
                      <td className="num text-right font-medium" data-rotulo="Valor">{moeda(c.valor)}</td>
                      <td data-rotulo="Status"><Badge tom={tomPorStatus(c.status)}>{rotulo(c.status)}</Badge></td>
                      <td data-rotulo="Competência">{c.competencia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <EmptyState compacto titulo="Sem comissões" descricao="Comissões são geradas ao lançar a venda com vendedor e % informados." />
            ))}
          {aba === 'historico' && <HistoricoSituacoes historico={venda.historico} />}
          {aba === 'nfe' &&
            (venda.nota ? (
              <Definicoes
                colunas={4}
                itens={[
                  { rotulo: 'Número', valor: <Link to={`/notas-fiscais/${venda.nota.id}`} className="text-brand-600 hover:underline">{venda.nota.numero}</Link> },
                  { rotulo: 'Situação', valor: <Badge tom={tomPorStatus(venda.nota.situacao)}>{rotulo(venda.nota.situacao)}</Badge> },
                  { rotulo: 'Chave', valor: <span className="font-mono text-xs">{venda.nota.chave ?? '—'}</span>, largo: true },
                ]}
              />
            ) : (
              <EmptyState compacto icone={<FileText className="h-5 w-5" />} titulo="Nenhuma nota fiscal" descricao="Gere uma NF-e (modelo 55) ou NFC-e (modelo 65) para esta venda." acao={<Button variante="primario" onClick={() => setNfe({ modelo: 55, info: '' })}>Gerar NF-e</Button>} />
            ))}
          {aba === 'notificacoes' && <NotificacoesLista origemTipo="VENDA" origemId={venda.id} />}
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>Criada em {dataHora(venda.criadoEm)}{venda.atualizadoEm ? ` · atualizada em ${dataHora(venda.atualizadoEm)}` : ''}</span>
      </div>

      <NotificarModal
        aberto={notificar}
        onFechar={() => setNotificar(false)}
        titulo={`Enviar ${orcamento ? 'orçamento' : 'venda'} nº ${venda.numero}`}
        caminho={`/vendas/${venda.id}`}
        eventoTemplate={orcamento ? 'ORCAMENTO_VENDA' : 'VENDA_SITUACAO'}
        eventosExtras={orcamento ? [] : ['VENDA_CRIADA']}
        permiteAnexo
        destinatarios={{ email: contato?.email, celular: contato?.celular }}
        onEnviado={invalidar}
      />

      <ConfirmDialog
        aberto={converter}
        onFechar={() => setConverter(false)}
        titulo={`Converter o orçamento nº ${venda.numero} em venda?`}
        descricao="Cria um pedido de venda com os mesmos itens, valores e condições de pagamento. O orçamento fica como “Convertido em venda” e ligado ao pedido."
        textoConfirmar="Converter em venda"
        perigo={false}
        onConfirmar={() => converterM.mutateAsync().then(() => undefined).catch(() => undefined)}
      />

      <EmitirNfModal
        aberto={!!nfe}
        onFechar={() => setNfe(null)}
        origem="vendas"
        id={Number(id)}
        numero={venda?.numero}
        onGerada={(notaId) => {
          invalidar();
          setNfe(null);
          nav(`/notas-fiscais/${notaId}`);
        }}
      />

      {!orcamento && <FinalizarVendaModal vendaId={venda.id} numero={venda.numero} aberto={finalizar} onFechar={() => setFinalizar(false)} />}
      {!orcamento && <PosVendaImpressao vendaId={venda.id} numero={venda.numero} aberto={posVenda} onFechar={() => setPosVenda(false)} />}
    </div>
  );
}
