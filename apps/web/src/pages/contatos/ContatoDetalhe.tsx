import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, CircleDollarSign, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, ShoppingCart, Trash2, Wallet, Wrench } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, Definicoes, EmptyState, FormSkeleton, PageHeader, Skeleton, StatCard, StatusBadge, Tabs, tomPorStatus } from '@/components/ui';
import { data, dataHora, documento, inteiro, moeda, rotulo, telefone } from '@/lib/format';
import type { Contato, HistoricoContato } from '@/types';

const ICONE_TIPO: Record<string, React.ReactNode> = {
  VENDA: <ShoppingCart className="h-3.5 w-3.5" />,
  OS: <Wrench className="h-3.5 w-3.5" />,
  CONTA: <Wallet className="h-3.5 w-3.5" />,
  CONTA_RECEBER: <Wallet className="h-3.5 w-3.5" />,
  NOTIFICACAO: <Bell className="h-3.5 w-3.5" />,
  MENSAGEM: <MessageCircle className="h-3.5 w-3.5" />,
};

function linkReferencia(ref?: { tipo: string; id: number } | null): string | null {
  if (!ref) return null;
  switch (ref.tipo.toUpperCase()) {
    case 'VENDA':
      return `/vendas/${ref.id}`;
    case 'OS':
      return `/ordens-servico/${ref.id}`;
    case 'CONTA':
    case 'CONTA_RECEBER':
      return `/financeiro/receber`;
    case 'NFE':
      return `/notas-fiscais/${ref.id}`;
    default:
      return null;
  }
}

/** Ficha do contato + histórico do cliente (timeline) */
export default function ContatoDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [aba, setAba] = useState('timeline');
  const [excluir, setExcluir] = useState(false);
  const { data: c, isLoading, error } = useQuery({ queryKey: ['contato', id], queryFn: () => api.get<Contato>(`/contatos/${id}`) });
  const { data: hist, isLoading: carregandoHist } = useQuery({ queryKey: ['contato-historico', id], queryFn: () => api.get<HistoricoContato>(`/contatos/${id}/historico`), retry: 0 });

  if (isLoading) return <FormSkeleton />;
  if (error || !c) return <EmptyState titulo="Contato não encontrado" descricao={error ? mensagemErro(error) : undefined} acao={<Link to="/contatos"><Button>Voltar</Button></Link>} />;

  const endereco = [c.logradouro, c.numero, c.complemento, c.bairro, c.municipio && `${c.municipio}/${c.uf}`, c.cep].filter(Boolean).join(', ');
  const totalReceber = hist?.contasReceber?.filter((x) => x.situacao === 'ABERTO' || x.situacao === 'PARCIAL').reduce((s, x) => s + (x.valor - x.valorRecebido), 0) ?? c.resumo?.emAberto ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        migalhas={[{ rotulo: 'Contatos', para: '/contatos' }, { rotulo: c.nome }]}
        titulo={c.nome}
        extra={
          <>
            <Badge tom="neutro">{rotulo(c.tipo)}</Badge>
            {!c.ativo && <Badge tom="cinza">Inativo</Badge>}
          </>
        }
        descricao={[c.fantasia, documento(c.documento)].filter(Boolean).join(' · ')}
        acoes={
          <>
            <Link to={`/vendas/nova?contatoId=${c.id}`}><Button variante="secundario" icone={<Plus className="h-4 w-4" />}>Venda</Button></Link>
            <Link to={`/ordens-servico/nova?contatoId=${c.id}`}><Button variante="secundario" icone={<Plus className="h-4 w-4" />}>OS</Button></Link>
            <Link to={`/contatos/${c.id}/editar`}><Button variante="primario" icone={<Pencil className="h-4 w-4" />}>Editar</Button></Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard rotulo="Total comprado" valor={moeda(c.resumo?.totalVendas)} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde" />
        <StatCard rotulo="Vendas" valor={inteiro(c.resumo?.qtdVendas)} sub={c.resumo?.ultimaCompra ? `última em ${data(c.resumo.ultimaCompra)}` : undefined} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" />
        <StatCard rotulo="Ordens de serviço" valor={inteiro(c.resumo?.qtdOs)} icone={<Wrench className="h-4 w-4" />} />
        <StatCard rotulo="Em aberto (a receber)" valor={moeda(totalReceber)} icone={<Wallet className="h-4 w-4" />} tom={totalReceber > 0 ? 'amarelo' : 'neutro'} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card titulo="Dados">
          <div className="space-y-3 text-sm">
            {(c.celular || c.telefone) && (
              <p className="flex items-center gap-2 text-slate-700"><Phone className="h-4 w-4 text-slate-400" />{[telefone(c.celular), telefone(c.telefone)].filter(Boolean).join(' · ')}</p>
            )}
            {c.celular && (
              <a href={`https://wa.me/55${c.celular.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-emerald-700 hover:underline"><MessageCircle className="h-4 w-4" /> Abrir conversa no WhatsApp</a>
            )}
            {c.email && <p className="flex items-center gap-2 text-slate-700"><Mail className="h-4 w-4 text-slate-400" /><a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a></p>}
            {endereco && <p className="flex items-start gap-2 text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />{endereco}</p>}
            <Definicoes
              colunas={2}
              itens={[
                { rotulo: 'Pessoa', valor: c.tipoPessoa === 'J' ? 'Jurídica' : c.tipoPessoa === 'E' ? 'Estrangeiro' : 'Física' },
                { rotulo: c.tipoPessoa === 'J' ? 'IE' : 'RG', valor: c.tipoPessoa === 'J' ? (c.ieIsento ? 'Isento' : c.ie) : c.rg },
                { rotulo: 'Vendedor', valor: c.vendedor?.nome },
                { rotulo: 'Limite de crédito', valor: moeda(c.limiteCredito) },
                { rotulo: 'Cadastrado em', valor: dataHora(c.criadoEm) },
              ]}
            />
            {c.observacoes && <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">{c.observacoes}</p>}
          </div>
        </Card>

        <Card className="lg:col-span-2" semPadding>
          <Tabs
            className="px-3"
            ativa={aba}
            onMudar={setAba}
            abas={[
              { id: 'timeline', rotulo: 'Histórico', contador: hist?.timeline?.length },
              { id: 'vendas', rotulo: 'Vendas', contador: hist?.vendas?.length },
              { id: 'os', rotulo: 'OS', contador: hist?.ordens?.length },
              { id: 'contas', rotulo: 'Contas', contador: hist?.contasReceber?.length },
              { id: 'msgs', rotulo: 'Mensagens', contador: hist?.notificacoes?.length },
            ]}
          />
          <div className="p-4">
            {carregandoHist ? (
              <Skeleton className="h-48" />
            ) : !hist ? (
              <EmptyState compacto titulo="Histórico indisponível" descricao="A rota de histórico ainda não respondeu." />
            ) : aba === 'timeline' ? (
              hist.timeline.length ? (
                <ol className="relative ml-2 border-l border-slate-200">
                  {hist.timeline.map((t, i) => {
                    const l = linkReferencia(t.referencia);
                    return (
                      <li key={i} className="mb-4 ml-5">
                        <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-slate-500">{ICONE_TIPO[t.tipo.toUpperCase()] ?? null}</span>
                        <div className="flex flex-wrap items-baseline gap-2">
                          {l ? <Link to={l} className="text-sm font-medium text-slate-800 hover:text-brand-600">{t.titulo}</Link> : <span className="text-sm font-medium text-slate-800">{t.titulo}</span>}
                          <span className="text-xs text-slate-400">{dataHora(t.data)}</span>
                        </div>
                        {t.descricao && <p className="text-xs text-slate-500">{t.descricao}</p>}
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <EmptyState compacto titulo="Sem movimentações" descricao="Vendas, OS, contas e mensagens aparecerão aqui." />
              )
            ) : aba === 'vendas' ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Nº</th><th>Data</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {hist.vendas.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-xs text-slate-400">Sem vendas.</td></tr>}
                  {hist.vendas.map((v) => (
                    <tr key={v.id} className="clicavel" onClick={() => nav(`${v.tipo === 'ORCAMENTO' ? '/orcamentos' : '/vendas'}/${v.id}`)}><td className="font-medium" data-rotulo="Nº">{v.numero}{v.tipo === 'ORCAMENTO' && <span className="ml-1.5 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">ORÇ.</span>}</td><td data-rotulo="Data">{data(v.data)}</td><td data-rotulo="Situação"><StatusBadge situacao={v.situacao} /></td><td className="num text-right" data-rotulo="Total">{moeda(v.total)}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : aba === 'os' ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Nº</th><th>Entrada</th><th>Equipamento</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
                <tbody>
                  {hist.ordens.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-xs text-slate-400">Sem ordens de serviço.</td></tr>}
                  {hist.ordens.map((o) => (
                    <tr key={o.id} className="clicavel" onClick={() => nav(`/ordens-servico/${o.id}`)}><td className="font-medium" data-rotulo="Nº">{o.numero}</td><td data-rotulo="Entrada">{data(o.dataEntrada)}</td><td data-rotulo="Equipamento">{o.equipamento ?? '—'}</td><td data-rotulo="Situação"><StatusBadge situacao={o.situacao} /></td><td className="num text-right" data-rotulo="Total">{moeda(o.total)}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : aba === 'contas' ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead><tr><th>Descrição</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th><th className="text-right">Recebido</th></tr></thead>
                <tbody>
                  {hist.contasReceber.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-xs text-slate-400">Sem contas.</td></tr>}
                  {hist.contasReceber.map((x) => (
                    <tr key={x.id}><td className="pilha-cheio">{x.descricao}</td><td className={x.atrasada ? 'text-red-600' : ''} data-rotulo="Vencimento">{data(x.vencimento)}</td><td data-rotulo="Situação"><Badge tom={tomPorStatus(x.atrasada ? 'ATRASADO' : x.situacao)}>{rotulo(x.atrasada ? 'ATRASADO' : x.situacao)}</Badge></td><td className="num text-right" data-rotulo="Valor">{moeda(x.valor)}</td><td className="num text-right" data-rotulo="Recebido">{moeda(x.valorRecebido)}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {hist.notificacoes.length === 0 && <li className="py-4 text-center text-xs text-slate-400">Nenhuma mensagem enviada.</li>}
                {hist.notificacoes.map((n) => (
                  <li key={n.id} className="py-2 text-sm">
                    <div className="flex items-center gap-2"><Badge>{rotulo(n.canal)}</Badge><Badge tom={tomPorStatus(n.status)}>{rotulo(n.status)}</Badge><span className="text-xs text-slate-400">{dataHora(n.enviadaEm || n.criadoEm)}</span></div>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-600">{n.corpo}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button tamanho="xs" variante="perigo" icone={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setExcluir(true)}>Excluir contato</Button>
      </div>
      <ConfirmDialog aberto={excluir} onFechar={() => setExcluir(false)} titulo="Excluir contato?" descricao="Se houver movimentações, o contato será apenas inativado." textoConfirmar="Excluir" onConfirmar={async () => { try { await api.del(`/contatos/${id}`); toast.success('Contato removido.'); qc.invalidateQueries({ queryKey: ['contatos'] }); nav('/contatos'); } catch (e) { toast.error(mensagemErro(e)); } }} />
    </div>
  );
}
