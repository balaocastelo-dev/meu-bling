import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, FileText, Pencil, Printer, Send, Trash2, Undo2, Zap } from 'lucide-react';
import { abrirEmNovaAba, api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, Modal, PageHeader, Select, StatusBadge, StatusChanger, Tabs, Textarea, tomPorStatus } from '@/components/ui';
import { HistoricoSituacoes } from '@/components/compartilhados/HistoricoSituacoes';
import { NotificarModal } from '@/components/compartilhados/NotificarModal';
import { NotificacoesLista } from '@/components/compartilhados/NotificacoesLista';
import { data, dataHora, moeda, numero, rotulo } from '@/lib/format';
import type { Contato, Venda } from '@/types';

/** Detalhe do pedido de venda com abas e ações */
export default function VendaDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('itens');
  const [notificar, setNotificar] = useState(false);
  const [excluir, setExcluir] = useState(false);
  const [nfe, setNfe] = useState<{ modelo: 55 | 65; info: string } | null>(null);

  const { data: venda, isLoading, error } = useQuery({ queryKey: ['venda', id], queryFn: () => api.get<Venda>(`/vendas/${id}`) });

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ['venda', id] });
    qc.invalidateQueries({ queryKey: ['vendas'] });
  };

  const acoes = useMutation({
    mutationFn: (lista: string[]) => api.post<{ acoesExecutadas?: string[] }>(`/vendas/${id}/acoes`, { acoes: lista }),
    onSuccess: (_, lista) => {
      toast.success(`Ação executada: ${lista.join(', ')}`);
      invalidar();
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const duplicar = useMutation({
    mutationFn: () => api.post<Venda>(`/vendas/${id}/duplicar`),
    onSuccess: (v) => {
      toast.success(`Venda duplicada: nº ${v.numero}`);
      qc.invalidateQueries({ queryKey: ['vendas'] });
      nav(`/vendas/${v.id}`);
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const gerarNfe = useMutation({
    mutationFn: (p: { modelo: 55 | 65; informacoesComplementares?: string }) => api.post<{ notaId: number }>(`/vendas/${id}/gerar-nfe`, p),
    onSuccess: (r) => {
      toast.success('Nota fiscal gerada (pendente de transmissão).');
      invalidar();
      setNfe(null);
      nav(`/notas-fiscais/${r.notaId}`);
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
  const podeEditar = !venda.estoqueLancado && !venda.contasLancadas;

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Vendas', para: '/vendas' }, { rotulo: `Venda nº ${venda.numero}` }]}
        titulo={`Venda nº ${venda.numero}`}
        extra={<StatusChanger modulo="VENDA" caminho={`/vendas/${venda.id}`} situacaoAtual={venda.situacao} situacoesPermitidas={venda.situacoesPermitidas} invalidar={[['venda', id ?? ''], ['vendas'], ['dashboard-geral']]} />}
        descricao={`${data(venda.data)} · ${contato?.nome ?? ''} · ${venda.vendedor?.nome ? 'vendedor ' + venda.vendedor.nome : 'sem vendedor'}`}
        acoes={
          <>
            <Button variante="secundario" icone={<Printer className="h-4 w-4" />} onClick={imprimir}>
              Imprimir
            </Button>
            <Button variante="secundario" icone={<Send className="h-4 w-4" />} onClick={() => setNotificar(true)}>
              WhatsApp / E-mail
            </Button>
            {!venda.nota && (
              <Button variante="secundario" icone={<FileText className="h-4 w-4" />} onClick={() => setNfe({ modelo: 55, info: '' })}>
                Gerar NF-e
              </Button>
            )}
            <Button variante="secundario" icone={<Copy className="h-4 w-4" />} onClick={() => duplicar.mutate()} carregando={duplicar.isPending}>
              Duplicar
            </Button>
            <Link to={`/vendas/${venda.id}/editar`}>
              <Button variante="primario" icone={<Pencil className="h-4 w-4" />}>
                Editar
              </Button>
            </Link>
          </>
        }
      />

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
              { rotulo: 'Previsão', valor: venda.dataPrevista ? data(venda.dataPrevista) : '—' },
              { rotulo: 'Categoria', valor: venda.categoriaFinanceira?.nome },
              { rotulo: 'NF-e', valor: venda.nota ? <Link to={`/notas-fiscais/${venda.nota.id}`} className="text-brand-600 hover:underline">nº {venda.nota.numero} · {rotulo(venda.nota.situacao)}</Link> : '—' },
              ...(venda.observacoes ? [{ rotulo: 'Observações', valor: <span className="whitespace-pre-line">{venda.observacoes}</span>, largo: true }] : []),
              ...(venda.observacoesInternas ? [{ rotulo: 'Observações internas', valor: <span className="whitespace-pre-line text-slate-500">{venda.observacoesInternas}</span>, largo: true }] : []),
            ]}
          />
        </Card>
        <Card titulo="Totais e lançamentos">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Produtos</span><span className="num">{moeda(venda.totalProdutos)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Desconto{venda.descontoTipo === 'PERCENTUAL' ? ` (${numero(venda.descontoValor)}%)` : ''}</span><span className="num text-red-600">- {moeda(venda.descontoTipo === 'PERCENTUAL' ? venda.totalProdutos * venda.descontoValor / 100 : venda.descontoValor)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Frete</span><span className="num">{moeda(venda.frete)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Outras</span><span className="num">{moeda(venda.outrasDespesas)}</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base"><span className="font-semibold">Total</span><span className="num font-bold">{moeda(venda.total)}</span></div>
            {venda.custoTotal !== undefined && venda.custoTotal > 0 && (
              <div className="flex justify-between text-xs text-slate-400"><span>Custo / margem</span><span className="num">{moeda(venda.custoTotal)} · {numero(((venda.total - venda.custoTotal) / (venda.total || 1)) * 100, 1)}%</span></div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button tamanho="sm" variante={venda.estoqueLancado ? 'perigo' : 'secundario'} icone={venda.estoqueLancado ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([venda.estoqueLancado ? 'estornarEstoque' : 'lancarEstoque'])}>
              {venda.estoqueLancado ? 'Estornar estoque' : 'Lançar estoque'}
            </Button>
            <Button tamanho="sm" variante={venda.contasLancadas ? 'perigo' : 'secundario'} icone={venda.contasLancadas ? <Undo2 className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />} carregando={acoes.isPending} onClick={() => acoes.mutate([venda.contasLancadas ? 'estornarContas' : 'lancarContas'])}>
              {venda.contasLancadas ? 'Estornar contas' : 'Lançar contas'}
            </Button>
          </div>
          <div className="mt-2 flex gap-2 text-[11px]">
            <Badge tom={venda.estoqueLancado ? 'verde' : 'cinza'}>Estoque {venda.estoqueLancado ? 'lançado' : 'pendente'}</Badge>
            <Badge tom={venda.contasLancadas ? 'verde' : 'cinza'}>Contas {venda.contasLancadas ? 'lançadas' : 'pendentes'}</Badge>
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
            { id: 'parcelas', rotulo: 'Parcelas / Financeiro', contador: venda.parcelas.length },
            { id: 'comissoes', rotulo: 'Comissões', contador: venda.comissoes?.length ?? 0 },
            { id: 'historico', rotulo: 'Histórico', contador: venda.historico?.length ?? 0 },
            { id: 'nfe', rotulo: 'NF-e' },
            { id: 'notificacoes', rotulo: 'Notificações' },
          ]}
        />
        <div className="p-4">
          {aba === 'itens' && (
            <table className="tbl">
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
                    <td className="text-slate-400">{i + 1}</td>
                    <td>
                      {it.produtoId ? <Link to={`/produtos/${it.produtoId}`} className="hover:text-brand-600">{it.descricao}</Link> : it.descricao}
                      {it.codigo && <span className="ml-2 text-xs text-slate-400">{it.codigo}</span>}
                    </td>
                    <td className="num text-right">{numero(it.quantidade)} {it.unidade}</td>
                    <td className="num text-right">{moeda(it.valorUnitario)}</td>
                    <td className="num text-right">{moeda(it.desconto)}</td>
                    <td className="num text-right text-slate-500">{numero(it.comissaoPct ?? 0)}%</td>
                    <td className="num text-right font-medium">{moeda(it.total ?? it.quantidade * it.valorUnitario - it.desconto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {aba === 'parcelas' && (
            <table className="tbl">
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
                    <td className="text-slate-400">{p.numero ?? i + 1}</td>
                    <td>{data(p.dataVencimento)}</td>
                    <td>{p.formaPagamento?.nome ?? '—'}</td>
                    <td className="num text-right">{moeda(p.valor)}</td>
                    <td>
                      {p.contaReceber ? (
                        <Link to={`/financeiro/receber?pesquisa=${venda.numero}`} className="inline-flex items-center gap-1.5 hover:underline">
                          #{p.contaReceber.id} <Badge tom={tomPorStatus(p.contaReceber.situacao)}>{rotulo(p.contaReceber.situacao)}</Badge>
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">não lançada</span>
                      )}
                    </td>
                    <td className="num text-right">{p.contaReceber ? moeda(p.contaReceber.valorRecebido) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {aba === 'comissoes' &&
            (venda.comissoes?.length ? (
              <table className="tbl">
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
                      <td>{rotulo(c.tipo)}</td>
                      <td>{c.vendedor?.nome ?? c.tecnico?.nome ?? '—'}</td>
                      <td className="num text-right">{moeda(c.base)}</td>
                      <td className="num text-right">{numero(c.pct)}%</td>
                      <td className="num text-right font-medium">{moeda(c.valor)}</td>
                      <td><Badge tom={tomPorStatus(c.status)}>{rotulo(c.status)}</Badge></td>
                      <td>{c.competencia}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
        {podeEditar && !venda.nota && (
          <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>
            Excluir venda
          </Button>
        )}
      </div>

      <NotificarModal aberto={notificar} onFechar={() => setNotificar(false)} caminho={`/vendas/${venda.id}`} eventoTemplate="VENDA_SITUACAO" destinatarios={{ email: contato?.email, celular: contato?.celular }} />

      <Modal
        aberto={!!nfe}
        onFechar={() => setNfe(null)}
        titulo="Gerar nota fiscal"
        descricao="A nota será criada como pendente; transmita na tela da nota."
        rodape={
          <>
            <Button variante="secundario" onClick={() => setNfe(null)}>Cancelar</Button>
            <Button variante="primario" carregando={gerarNfe.isPending} onClick={() => nfe && gerarNfe.mutate({ modelo: nfe.modelo, informacoesComplementares: nfe.info || undefined })}>Gerar</Button>
          </>
        }
      >
        {nfe && (
          <div className="space-y-3">
            <Select label="Modelo" value={nfe.modelo} onChange={(e) => setNfe({ ...nfe, modelo: Number(e.target.value) as 55 | 65 })} opcoes={[{ valor: 55, rotulo: 'NF-e (modelo 55)' }, { valor: 65, rotulo: 'NFC-e (modelo 65 — consumidor)' }]} />
            <Textarea label="Informações complementares" value={nfe.info} onChange={(e) => setNfe({ ...nfe, info: e.target.value })} rows={3} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        aberto={excluir}
        onFechar={() => setExcluir(false)}
        titulo="Excluir venda?"
        descricao={`A venda nº ${venda.numero} será removida permanentemente.`}
        textoConfirmar="Excluir"
        onConfirmar={async () => {
          try {
            await api.del(`/vendas/${id}`);
            toast.success('Venda excluída.');
            qc.invalidateQueries({ queryKey: ['vendas'] });
            nav('/vendas');
          } catch (e) {
            toast.error(mensagemErro(e));
          }
        }}
      />
    </div>
  );
}
