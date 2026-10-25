import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { AlertCircle, ArrowRight, BadgePercent, Boxes, CheckCircle2, ChevronRight, CircleDollarSign, Clock, FileText, FileWarning, ListChecks, MessageCircle, Package, ShoppingCart, TriangleAlert, Wallet, Wrench } from 'lucide-react';
import { api, rotaIndisponivel } from '@/lib/api';
import { Badge, EmptyState, Skeleton, tomPorStatus } from '@/components/ui';
import { inteiro, moeda, numero, rotulo } from '@/lib/format';
import { Aparecer, BarraAnimada, CardV18, Grupo, KpiV18, LinhaV18, PaginaV18, TONS, listaVariants, type Tom } from '@/components/dashboard/v18';
import { useAuth } from '@/stores/auth';
import type { DashboardGeral as Dados, StatusSefaz } from '@/types';
import { UltimosAcontecimentos } from './UltimasAtividades';

/** Distribuição por situação com barras que crescem */
function BarrasSituacao({ itens, total, onClick }: { itens: { id: number; nome: string; cor: string; qtd: number }[]; total: number; onClick?: (id: number) => void }) {
  if (!itens.length) return <EmptyState compacto titulo="Sem dados" />;
  return (
    <motion.ul className="space-y-1" variants={listaVariants} initial="oculto" animate="visivel">
      {itens.map((s) => {
        const pct = total > 0 ? (s.qtd / total) * 100 : 0;
        return (
          <LinhaV18 key={s.id} onClick={onClick ? () => onClick(s.id) : undefined} bloco>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.cor }} />
                <span className="truncate">{s.nome}</span>
              </span>
              <span className="num shrink-0 text-slate-500">
                {inteiro(s.qtd)} <span className="text-slate-300">· {numero(pct, 0)}%</span>
              </span>
            </div>
            <BarraAnimada pct={pct} cor={s.cor} />
          </LinhaV18>
        );
      })}
    </motion.ul>
  );
}

/** Pílula de status (WhatsApp / SEFAZ) com ponto pulsando quando online */
function StatusPilula({ icone, nome, ok, texto, tom }: { icone: React.ReactNode; nome: string; ok: boolean; texto: string; tom: Parameters<typeof Badge>[0]['tom'] }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-card">
      <span className="relative flex h-2 w-2">
        {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-slate-300')} />
      </span>
      {icone} {nome}
      <Badge tom={tom}>{texto}</Badge>
    </span>
  );
}

/** Dashboard geral (tela inicial) — estilo V18 com as cores do sistema */
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
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const hojeExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const pendencias: { nome: string; qtd?: number; link: string; icone: React.ReactNode; tom: Tom; mostrar: boolean }[] = [
    { nome: 'NF-e pendentes', qtd: data?.fiscal.pendentes, link: '/notas-fiscais?situacao=PENDENTE', icone: <FileText className="h-4 w-4" />, tom: 'azul', mostrar: true },
    { nome: 'NF-e rejeitadas', qtd: data?.fiscal.rejeitadas, link: '/notas-fiscais?situacao=REJEITADA', icone: <FileWarning className="h-4 w-4" />, tom: data && data.fiscal.rejeitadas > 0 ? 'vermelho' : 'neutro', mostrar: true },
    { nome: 'Comissões pendentes', qtd: data?.comissoes?.pendentes, link: '/comissoes', icone: <BadgePercent className="h-4 w-4" />, tom: 'amarelo', mostrar: isLoading || !!data?.comissoes },
    { nome: 'OS concluídas hoje', qtd: h?.osConcluidasHoje, link: '/ordens-servico', icone: <CheckCircle2 className="h-4 w-4" />, tom: 'verde', mostrar: true },
  ];

  return (
    <PaginaV18 className="space-y-5">
      <Aparecer className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-400">{hojeExtenso.charAt(0).toUpperCase() + hojeExtenso.slice(1)}</p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {saudacao}, {usuario?.nome?.split(' ')[0]} <motion.span className="inline-block origin-[70%_70%]" animate={{ rotate: [0, 14, -8, 14, 0] }} transition={{ duration: 1.4, delay: 0.4 }}>👋</motion.span>
          </h1>
          <p className="text-sm text-slate-500">Resumo da loja em tempo real.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StatusPilula icone={<MessageCircle className="h-3.5 w-3.5 text-slate-400" />} nome="WhatsApp" ok={data?.whatsapp.status === 'CONECTADO'} texto={rotulo(data?.whatsapp.status ?? 'DESCONECTADO')} tom={tomPorStatus(data?.whatsapp.status)} />
          <StatusPilula icone={<FileText className="h-3.5 w-3.5 text-slate-400" />} nome="SEFAZ" ok={!!sefaz?.online} texto={sefaz ? (sefaz.online ? 'Online' : 'Offline') : '—'} tom={sefaz?.online ? 'verde' : sefaz ? 'vermelho' : 'neutro'} />
        </div>
      </Aparecer>

      {indisponivel && (
        <Aparecer className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4" /> A rota do dashboard ainda não está disponível na API. Os indicadores aparecerão assim que o backend responder.
        </Aparecer>
      )}

      {/* KPIs */}
      <Grupo className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <KpiV18 rotulo="Vendas hoje" valor={h?.vendas} formato={(n) => inteiro(Math.round(n))} icone={<ShoppingCart className="h-4 w-4" />} tom="azul" carregando={isLoading} onClick={() => nav('/vendas')} />
        <KpiV18 rotulo="Faturamento hoje" valor={h?.valorVendas} formato={moeda} icone={<CircleDollarSign className="h-4 w-4" />} tom="verde" carregando={isLoading} onClick={() => nav('/dashboard/vendas')} />
        <KpiV18 rotulo="OS abertas" valor={h?.osAbertas} formato={(n) => inteiro(Math.round(n))} sub={data ? `${inteiro(data.os.atrasadas)} atrasadas` : undefined} icone={<Wrench className="h-4 w-4" />} tom={data && data.os.atrasadas > 0 ? 'amarelo' : 'neutro'} carregando={isLoading} onClick={() => nav('/ordens-servico')} />
        {(isLoading || f) && <KpiV18 rotulo="Saldo em contas" valor={f?.saldoTotal} formato={moeda} icone={<Wallet className="h-4 w-4" />} tom="neutro" carregando={isLoading} onClick={() => nav('/financeiro/bancos')} />}
        {(isLoading || f) && <KpiV18 rotulo="A receber hoje" valor={f?.receberHoje} formato={moeda} sub={f ? `a pagar ${moeda(f.pagarHoje)}` : undefined} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={isLoading} onClick={() => nav('/financeiro/receber')} />}
        {(isLoading || f) && <KpiV18 rotulo="Receber atrasado" valor={f?.receberAtrasado} formato={moeda} sub={f ? `a pagar ${moeda(f.pagarAtrasado)}` : undefined} icone={<TriangleAlert className="h-4 w-4" />} tom={f && f.receberAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/receber?situacao=ATRASADO')} />}
      </Grupo>

      {/* Alertas */}
      {data && data.alertas.length > 0 && (
        <CardV18 titulo="Alertas" descricao={`${data.alertas.length} ${data.alertas.length > 1 ? 'pontos pedem' : 'ponto pede'} atenção`} icone={<TriangleAlert className="h-4 w-4" />} tom="amarelo" semPadding>
          <motion.ul className="px-2 pb-2 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
            {data.alertas.map((a, i) => (
              <LinhaV18 key={i} onClick={a.link ? () => nav(a.link!) : undefined} className="text-sm">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 flex-1 text-slate-700">{a.mensagem}</span>
                {a.link && (
                  <Link to={a.link} onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Ver <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </LinhaV18>
            ))}
          </motion.ul>
        </CardV18>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <UltimosAcontecimentos className="lg:col-span-2" />

        {/* Pendências no estilo "Collections" */}
        <CardV18 titulo="Pendências" descricao="O que está esperando alguém" icone={<ListChecks className="h-4 w-4" />} className="self-start" semPadding>
          <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
            {pendencias
              .filter((p) => p.mostrar)
              .map((p) => (
                <LinhaV18 key={p.nome} onClick={() => nav(p.link)}>
                  <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONS[p.tom].chip)}>{p.icone}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{p.nome}</span>
                  <span className={clsx('num rounded-full px-2 py-0.5 text-xs font-semibold', p.qtd ? TONS[p.tom].chip : 'bg-slate-50 text-slate-400')}>{isLoading ? '…' : inteiro(p.qtd)}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </LinhaV18>
              ))}
          </motion.ul>
        </CardV18>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <CardV18 titulo="OS por situação" descricao={`${inteiro(totalOs)} ordens`} icone={<Wrench className="h-4 w-4" />} tom="azul" acoes={<Link to="/ordens-servico" className="text-xs font-medium text-brand-600 hover:underline">Ver kanban</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BarrasSituacao itens={data?.os.porSituacao ?? []} total={totalOs} onClick={(id) => nav(`/ordens-servico?situacoes=${id}&visao=lista`)} />}
        </CardV18>
        <CardV18 titulo="Vendas por situação" descricao={`${inteiro(totalVendas)} pedidos`} icone={<ShoppingCart className="h-4 w-4" />} tom="verde" acoes={<Link to="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver vendas</Link>}>
          {isLoading ? <Skeleton className="h-40" /> : <BarrasSituacao itens={data?.vendas.porSituacao ?? []} total={totalVendas} onClick={(id) => nav(`/vendas?situacoes=${id}`)} />}
        </CardV18>
        <CardV18
          titulo="Estoque abaixo do mínimo"
          descricao={data ? `${inteiro(data.estoque.qtdAbaixoMinimo)} produtos` : undefined}
          icone={<Package className="h-4 w-4" />}
          tom={data && data.estoque.qtdAbaixoMinimo > 0 ? 'vermelho' : 'neutro'}
          acoes={<Link to="/estoque?abaixoMinimo=true" className="text-xs font-medium text-brand-600 hover:underline">Ver todos</Link>}
          semPadding
        >
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-40" />
            </div>
          ) : data?.estoque.abaixoMinimo.length ? (
            <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {data.estoque.abaixoMinimo.slice(0, 8).map((p) => {
                const pct = p.estoqueMinimo > 0 ? (Math.max(0, p.saldo) / p.estoqueMinimo) * 100 : 0;
                return (
                  <LinhaV18 key={p.produtoId} onClick={() => nav(`/produtos/${p.produtoId}`)} bloco>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{p.nome}</span>
                      <span className="num shrink-0 text-xs">
                        <span className={p.saldo <= 0 ? 'font-semibold text-red-600' : 'text-amber-600'}>{numero(p.saldo)}</span>
                        <span className="text-slate-400"> / mín {numero(p.estoqueMinimo)}</span>
                      </span>
                    </div>
                    <BarraAnimada pct={pct} cor={p.saldo <= 0 ? '#dc2626' : '#f59e0b'} className="mt-1.5 h-1.5" />
                  </LinhaV18>
                );
              })}
            </motion.ul>
          ) : (
            <EmptyState compacto icone={<Boxes className="h-5 w-5" />} titulo="Estoque em dia" descricao="Nenhum produto abaixo do mínimo." />
          )}
        </CardV18>
      </div>
    </PaginaV18>
  );
}
