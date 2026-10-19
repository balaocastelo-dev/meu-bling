import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Boxes, CircleDollarSign, Clock, FileText, MessageCircle, Package, ShoppingCart, TriangleAlert, Wallet, Wrench } from 'lucide-react';
import { api, rotaIndisponivel } from '@/lib/api';
import { Badge, Card, EmptyState, Skeleton, StatCard, tomPorStatus } from '@/components/ui';
import { dataHora, inteiro, moeda, numero, rotulo } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { DashboardGeral as Dados, StatusSefaz } from '@/types';

/** Barra horizontal simples (distribuição por situação) */
function BarrasSituacao({ itens, total, onClick }: { itens: { id: number; nome: string; cor: string; qtd: number }[]; total: number; onClick?: (id: number) => void }) {
  if (!itens.length) return <EmptyState compacto titulo="Sem dados" />;
  return (
    <ul className="space-y-2">
      {itens.map((s) => {
        const pct = total > 0 ? (s.qtd / total) * 100 : 0;
        return (
          <li key={s.id} className={onClick ? 'cursor-pointer' : ''} onClick={() => onClick?.(s.id)}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-700">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.cor }} />
                {s.nome}
              </span>
              <span className="num text-slate-500">{inteiro(s.qtd)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.cor }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Dashboard geral (tela inicial) */
export default function DashboardGeral() {
  const nav = useNavigate();
  const usuario = useAuth((s) => s.usuario);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard-geral'], queryFn: () => api.get<Dados>('/dashboard/geral'), refetchInterval: 60_000 });
  const { data: sefaz } = useQuery({ queryKey: ['sefaz-status'], queryFn: () => api.get<StatusSefaz>('/fiscal/status-sefaz').catch(() => null), staleTime: 5 * 60 * 1000 });

  const indisponivel = !!error && rotaIndisponivel(error);
  const h = data?.hoje;
  const f = data?.financeiro;
  const totalOs = data?.os.porSituacao.reduce((s, x) => s + x.qtd, 0) ?? 0;
  const totalVendas = data?.vendas.porSituacao.reduce((s, x) => s + x.qtd, 0) ?? 0;
  const saudacao = new Date().getHours() < 12 ? 'Bom dia' : new Date().getHours() < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {saudacao}, {usuario?.nome?.split(' ')[0]}
          </h1>
          <p className="text-sm text-slate-500">Resumo da loja em tempo real.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
            <MessageCircle className="h-3.5 w-3.5 text-slate-400" /> WhatsApp
            <Badge tom={tomPorStatus(data?.whatsapp.status)}>{rotulo(data?.whatsapp.status ?? 'DESCONECTADO')}</Badge>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
            <FileText className="h-3.5 w-3.5 text-slate-400" /> SEFAZ
            <Badge tom={sefaz?.online ? 'verde' : sefaz ? 'vermelho' : 'neutro'}>{sefaz ? (sefaz.online ? 'Online' : 'Offline') : '—'}</Badge>
          </span>
        </div>
      </div>

      {indisponivel && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" /> A rota do dashboard ainda não está disponível na API. Os indicadores aparecerão assim que o backend responder.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard rotulo="Vendas hoje" valor={inteiro(h?.vendas)} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={isLoading} onClick={() => nav('/vendas')} />
        <StatCard rotulo="Faturamento hoje" valor={moeda(h?.valorVendas)} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde" carregando={isLoading} onClick={() => nav('/dashboard/vendas')} />
        <StatCard rotulo="OS abertas" valor={inteiro(h?.osAbertas)} sub={data ? `${inteiro(data.os.atrasadas)} atrasadas` : undefined} icone={<Wrench className="h-4 w-4" />} tom={data && data.os.atrasadas > 0 ? 'amarelo' : 'neutro'} carregando={isLoading} onClick={() => nav('/ordens-servico')} />
        <StatCard rotulo="Saldo em contas" valor={moeda(f?.saldoTotal)} icone={<Wallet className="h-4 w-4" />} tom="neutro" carregando={isLoading} onClick={() => nav('/financeiro/bancos')} />
        <StatCard rotulo="A receber hoje" valor={moeda(f?.receberHoje)} sub={f ? `a pagar ${moeda(f.pagarHoje)}` : undefined} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={isLoading} onClick={() => nav('/financeiro/receber')} />
        <StatCard rotulo="Atrasados" valor={moeda(f?.receberAtrasado)} sub={f ? `a pagar ${moeda(f.pagarAtrasado)}` : undefined} icone={<TriangleAlert className="h-4 w-4" />} tom={f && f.receberAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/receber?situacao=ATRASADO')} />
      </div>

      {/* Alertas */}
      {data && data.alertas.length > 0 && (
        <Card titulo="Alertas" semPadding>
          <ul className="divide-y divide-slate-100">
            {data.alertas.map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <TriangleAlert className="h-4 w-4 shrink-0 text-amber-500" />
                <span className="flex-1 text-slate-700">{a.mensagem}</span>
                {a.link && (
                  <Link to={a.link} className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Ver <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card titulo="OS por situação" descricao={`${inteiro(totalOs)} ordens`} acoes={<Link to="/ordens-servico" className="text-xs text-brand-600 hover:underline">Ver kanban</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BarrasSituacao itens={data?.os.porSituacao ?? []} total={totalOs} onClick={(id) => nav(`/ordens-servico?situacoes=${id}&visao=lista`)} />}
        </Card>
        <Card titulo="Vendas por situação" descricao={`${inteiro(totalVendas)} pedidos`} acoes={<Link to="/vendas" className="text-xs text-brand-600 hover:underline">Ver vendas</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BarrasSituacao itens={data?.vendas.porSituacao ?? []} total={totalVendas} onClick={(id) => nav(`/vendas?situacoes=${id}`)} />}
        </Card>
        <Card
          titulo="Estoque abaixo do mínimo"
          descricao={data ? `${inteiro(data.estoque.qtdAbaixoMinimo)} produtos` : undefined}
          acoes={<Link to="/estoque?abaixoMinimo=true" className="text-xs text-brand-600 hover:underline">Ver todos</Link>}
          semPadding
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data?.estoque.abaixoMinimo.length ? (
            <ul className="divide-y divide-slate-100">
              {data.estoque.abaixoMinimo.slice(0, 8).map((p) => (
                <li key={p.produtoId} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <Package className="h-4 w-4 shrink-0 text-slate-300" />
                  <Link to={`/produtos/${p.produtoId}`} className="min-w-0 flex-1 truncate text-slate-700 hover:text-brand-600">
                    {p.nome}
                  </Link>
                  <span className="num text-xs">
                    <span className={p.saldo <= 0 ? 'font-semibold text-red-600' : 'text-amber-600'}>{numero(p.saldo)}</span>
                    <span className="text-slate-400"> / mín {numero(p.estoqueMinimo)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compacto icone={<Boxes className="h-5 w-5" />} titulo="Estoque em dia" descricao="Nenhum produto abaixo do mínimo." />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card titulo="Últimos movimentos de estoque" className="lg:col-span-2" semPadding acoes={<Link to="/estoque?aba=movimentos" className="text-xs text-brand-600 hover:underline">Ver todos</Link>}>
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data?.ultimosMovimentos.length ? (
            <div className="overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Produto</th>
                    <th>Tipo</th>
                    <th>Origem</th>
                    <th className="text-right">Qtd</th>
                    <th className="text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimosMovimentos.slice(0, 10).map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs text-slate-500">{dataHora(m.data)}</td>
                      <td className="max-w-[260px] truncate">{m.produto?.nome ?? `#${m.produtoId}`}</td>
                      <td>
                        <Badge tom={m.tipo === 'ENTRADA' ? 'verde' : m.tipo === 'SAIDA' ? 'vermelho' : 'neutro'}>{rotulo(m.tipo)}</Badge>
                      </td>
                      <td className="text-xs text-slate-500">
                        {rotulo(m.origemTipo)}
                        {m.origemId ? ` #${m.origemId}` : ''}
                      </td>
                      <td className="num text-right">{numero(m.quantidade)}</td>
                      <td className="num text-right text-slate-500">{numero(m.saldoPosterior)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compacto titulo="Nenhum movimento recente" />
          )}
        </Card>

        <Card titulo="Pendências">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <Link to="/notas-fiscais?situacao=PENDENTE" className="text-slate-700 hover:text-brand-600">
                NF-e pendentes
              </Link>
              <span className="num font-medium">{isLoading ? '…' : inteiro(data?.fiscal.pendentes)}</span>
            </li>
            <li className="flex items-center justify-between">
              <Link to="/notas-fiscais?situacao=REJEITADA" className="text-slate-700 hover:text-brand-600">
                NF-e rejeitadas
              </Link>
              <span className={`num font-medium ${data && data.fiscal.rejeitadas > 0 ? 'text-red-600' : ''}`}>{isLoading ? '…' : inteiro(data?.fiscal.rejeitadas)}</span>
            </li>
            <li className="flex items-center justify-between">
              <Link to="/comissoes" className="text-slate-700 hover:text-brand-600">
                Comissões pendentes
              </Link>
              <span className="num font-medium">{isLoading ? '…' : inteiro(data?.comissoes.pendentes)}</span>
            </li>
            <li className="flex items-center justify-between">
              <Link to="/ordens-servico" className="text-slate-700 hover:text-brand-600">
                OS concluídas hoje
              </Link>
              <span className="num font-medium">{isLoading ? '…' : inteiro(h?.osConcluidasHoje)}</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
