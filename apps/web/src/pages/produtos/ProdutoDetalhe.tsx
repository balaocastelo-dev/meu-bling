import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { ArrowRightLeft, ExternalLink, Globe, Package, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { usePaginacao } from '@/hooks/usePaginacao';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, PageHeader, Pagination, StatCard, Table, Tabs, type Coluna } from '@/components/ui';
import { AjusteEstoqueModal, TransferenciaEstoqueModal } from '@/components/compartilhados/EstoqueModais';
import { dataHora, moeda, numero, rotulo } from '@/lib/format';
import type { MovimentoEstoque, Paginado, Produto } from '@/types';
import { FotoProduto, SeloProntaEntrega } from '@/components/compartilhados/ProdutoSite';

/** Detalhe do produto: saldos por depósito, movimentos, fiscal */
export default function ProdutoDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const pg = usePaginacao(30);
  const [aba, setAba] = useState('saldos');
  const [ajuste, setAjuste] = useState<{ depositoId?: number } | null>(null);
  const [transf, setTransf] = useState(false);
  const [excluir, setExcluir] = useState(false);

  const { data: p, isLoading, error } = useQuery({ queryKey: ['produto', id], queryFn: () => api.get<Produto>(`/produtos/${id}`) });
  const { data: movs, isLoading: carregandoMovs } = useQuery({
    queryKey: ['movimentos', 'produto', id, pg.pagina],
    queryFn: () => api.get<Paginado<MovimentoEstoque>>(`/produtos/${id}/movimentos`, { pagina: pg.pagina, limite: pg.limite }),
    enabled: aba === 'movimentos',
  });

  if (isLoading) return <FormSkeleton />;
  if (error || !p) return <EmptyState titulo="Produto não encontrado" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/produtos"><Button>Voltar</Button></Link>} />;

  const total = p.estoqueTotal ?? p.saldos?.reduce((s, x) => s + x.saldo, 0) ?? 0;
  const reservado = p.estoqueReservado ?? p.saldos?.reduce((s, x) => s + x.reservado, 0) ?? 0;

  const colMov: Coluna<MovimentoEstoque>[] = [
    { chave: 'data', titulo: 'Data', render: (m) => <span className="text-xs text-slate-500">{dataHora(m.data)}</span> },
    { chave: 'tipo', titulo: 'Tipo', render: (m) => <Badge tom={m.tipo === 'ENTRADA' ? 'verde' : m.tipo === 'SAIDA' ? 'vermelho' : 'neutro'}>{rotulo(m.tipo)}</Badge> },
    { chave: 'dep', titulo: 'Depósito', render: (m) => m.deposito?.nome ?? `#${m.depositoId}` },
    { chave: 'origem', titulo: 'Origem', render: (m) => <span className="text-xs text-slate-500">{rotulo(m.origemTipo)}{m.origemId ? ` #${m.origemId}` : ''}</span> },
    { chave: 'qtd', titulo: 'Qtd', direita: true, render: (m) => <span className={m.tipo === 'SAIDA' ? 'text-red-600' : 'text-emerald-700'}>{m.tipo === 'SAIDA' ? '-' : '+'}{numero(Math.abs(m.quantidade))}</span> },
    { chave: 'saldo', titulo: 'Saldo', direita: true, render: (m) => <span className="text-slate-500">{numero(m.saldoAnterior)} → <strong className="text-slate-800">{numero(m.saldoPosterior)}</strong></span> },
    { chave: 'custo', titulo: 'Custo', direita: true, ocultarMobile: true, render: (m) => moeda(m.custoUnitario) },
    { chave: 'usuario', titulo: 'Usuário', ocultarMobile: true, render: (m) => <span className="text-xs text-slate-500">{m.usuario?.nome ?? '—'}</span> },
    { chave: 'obs', titulo: 'Observação', ocultarMobile: true, render: (m) => <span className="text-xs text-slate-500">{m.observacao ?? ''}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Produtos', para: '/produtos' }, { rotulo: p.nome }]}
        titulo={p.nome}
        extra={
          <>
            <Badge tom={p.tipo === 'S' ? 'roxo' : 'neutro'}>{p.tipo === 'S' ? 'Serviço' : 'Produto'}</Badge>
            {p.prontaEntrega && <SeloProntaEntrega />}
            {p.siteId && <Badge tom="azul">Do site</Badge>}
            {!p.ativo && <Badge tom="cinza">Inativo</Badge>}
          </>
        }
        descricao={[p.codigo && `cód. ${p.codigo}`, p.gtin && `GTIN ${p.gtin}`, p.marca, p.categoria?.nome].filter(Boolean).join(' · ')}
        acoes={
          <>
            {p.tipo === 'P' && (
              <>
                <Button variante="secundario" icone={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setAjuste({})}>Ajustar estoque</Button>
                <Button variante="secundario" icone={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setTransf(true)}>Transferir</Button>
              </>
            )}
            <Link to={`/produtos/${p.id}/editar`}><Button variante="primario" icone={<Pencil className="h-4 w-4" />}>Editar</Button></Link>
          </>
        }
      />

      {(p.imagemUrl || p.siteId) && (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <FotoProduto url={p.imagemUrl} alt={p.nome} tamanho="lg" />
            <div className="space-y-1.5 text-sm">
              {p.siteId ? (
                <>
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    <Globe className="h-4 w-4 text-sky-500" /> Produto do site www.balao.info
                  </p>
                  <p className="text-slate-600">
                    {p.prontaEntrega ? 'Pronta entrega: está na loja.' : `${p.disponibilidade || 'Disponível'}: sai do distribuidor${p.fornecedor ? ` (${p.fornecedor})` : ''}.`}
                  </p>
                  <p className="text-xs text-slate-400">
                    Nome, foto, preços e disponibilidade são atualizados pelo site{p.siteSincronizadoEm ? ` (última vez ${dataHora(p.siteSincronizadoEm)})` : ''}. Para mudar, mude no site. Fiscal e estoque são daqui.
                  </p>
                  <a href={`https://www.balao.info/product/${p.siteSlug || p.siteId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Ver no site <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : (
                <p className="text-slate-500">Produto cadastrado no sistema (não está no site).</p>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard rotulo="Preço à vista" valor={moeda(p.preco)} sub={p.precoCartao && p.precoCartao !== p.preco ? `cartão ${moeda(p.precoCartao)}` : undefined} tom="verde" />
        <StatCard rotulo="Custo" valor={moeda(p.precoCusto)} sub={p.precoCusto > 0 ? `margem ${numero(((p.preco - p.precoCusto) / p.precoCusto) * 100, 1)}%` : undefined} />
        <StatCard rotulo="Estoque disponível" valor={p.tipo === 'S' ? '—' : numero(total - reservado)} sub={p.tipo === 'S' ? 'serviço' : `${numero(total)} total · ${numero(reservado)} reservado`} tom={p.tipo === 'P' && total <= p.estoqueMinimo ? 'vermelho' : 'azul'} icone={<Package className="h-4 w-4" />} />
        <StatCard rotulo="Estoque mínimo" valor={p.tipo === 'S' ? '—' : numero(p.estoqueMinimo)} sub={p.controlaEstoque ? undefined : 'não controla estoque'} />
      </div>

      <Card semPadding>
        <Tabs className="px-3" ativa={aba} onMudar={setAba} abas={[{ id: 'saldos', rotulo: 'Saldos por depósito' }, { id: 'movimentos', rotulo: 'Movimentos' }, { id: 'fiscal', rotulo: 'Fiscal' }, { id: 'descricao', rotulo: 'Descrição' }]} />
        <div className="p-4">
          {aba === 'saldos' &&
            (p.tipo === 'S' ? (
              <EmptyState compacto titulo="Serviços não têm estoque" />
            ) : (
              <table className="tbl">
                <thead><tr><th>Depósito</th><th className="text-right">Saldo</th><th className="text-right">Reservado</th><th className="text-right">Disponível</th><th className="w-32" /></tr></thead>
                <tbody>
                  {(p.saldos ?? []).length === 0 && <tr><td colSpan={5} className="py-4 text-center text-xs text-slate-400">Sem saldo em nenhum depósito.</td></tr>}
                  {(p.saldos ?? []).map((s) => (
                    <tr key={s.depositoId}>
                      <td className="font-medium">{s.deposito}</td>
                      <td className={clsx('num text-right', s.saldo < 0 && 'text-red-600')}>{numero(s.saldo)}</td>
                      <td className="num text-right text-slate-500">{numero(s.reservado)}</td>
                      <td className="num text-right font-medium">{numero(s.saldo - s.reservado)}</td>
                      <td className="text-right"><Button tamanho="xs" variante="fantasma" onClick={() => setAjuste({ depositoId: s.depositoId })}>Ajustar</Button></td>
                    </tr>
                  ))}
                  {(p.saldos ?? []).length > 0 && (
                    <tr className="font-semibold"><td>Total</td><td className="num text-right">{numero(total)}</td><td className="num text-right">{numero(reservado)}</td><td className="num text-right">{numero(total - reservado)}</td><td /></tr>
                  )}
                </tbody>
              </table>
            ))}
          {aba === 'movimentos' && (
            <>
              <Table colunas={colMov} dados={movs?.data} carregando={carregandoMovs} chave={(m) => m.id} vazio={<EmptyState compacto titulo="Sem movimentos" />} compacta />
              {movs && <Pagination pagina={movs.meta.pagina} totalPaginas={movs.meta.totalPaginas} total={movs.meta.total} limite={movs.meta.limite} onPagina={pg.setPagina} />}
            </>
          )}
          {aba === 'fiscal' && (
            <Definicoes
              colunas={4}
              itens={
                p.tipo === 'S'
                  ? [{ rotulo: 'Código do serviço', valor: p.codigoServico }, { rotulo: 'ISS', valor: `${numero(p.issAliquota)}%` }]
                  : [
                      { rotulo: 'NCM', valor: p.ncm },
                      { rotulo: 'CEST', valor: p.cest },
                      { rotulo: 'CFOP padrão', valor: p.cfopPadrao },
                      { rotulo: 'Origem', valor: String(p.origem) },
                      { rotulo: 'CSOSN', valor: p.csosn },
                      { rotulo: 'CST ICMS', valor: p.cst },
                      { rotulo: 'ICMS', valor: `${numero(p.icmsAliquota)}%` },
                      { rotulo: 'PIS / COFINS / IPI', valor: `${p.pisCst} / ${p.cofinsCst} / ${p.ipiCst || '—'}` },
                      { rotulo: 'Unidade', valor: p.unidade },
                      { rotulo: 'Garantia', valor: `${p.garantiaDias} dias` },
                      { rotulo: 'Peso', valor: p.peso ? `${numero(p.peso, 3)} kg` : '—' },
                    ]
              }
            />
          )}
          {aba === 'descricao' && (
            <div className="space-y-3 text-sm">
              {p.imagemUrl && <img src={p.imagemUrl} alt={p.nome} className="max-h-64 rounded border border-slate-200" />}
              <p className="text-slate-700">{p.descricaoCurta || <span className="text-slate-400">Sem descrição curta.</span>}</p>
              <p className="whitespace-pre-line text-slate-600">{p.descricaoDetalhada || <span className="text-slate-400">Sem descrição detalhada.</span>}</p>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir produto</Button>
      </div>

      <AjusteEstoqueModal aberto={!!ajuste} onFechar={() => setAjuste(null)} produtoId={p.id} produtoNome={p.nome} depositoId={ajuste?.depositoId} />
      <TransferenciaEstoqueModal aberto={transf} onFechar={() => setTransf(false)} produtoId={p.id} produtoNome={p.nome} />
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir produto?" descricao="Se houver movimentações, o produto será inativado." textoConfirmar="Excluir" onConfirmar={async () => { try { await api.del(`/produtos/${id}`); toast.success('Produto removido.'); qc.invalidateQueries({ queryKey: ['produtos'] }); nav('/produtos'); } catch (e) { toast.error(mensagemErro(e)); } }} />
    </div>
  );
}
