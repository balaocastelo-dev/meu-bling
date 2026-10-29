/**
 * Meu Dashboard do TÉCNICO — estilo Power BI: as OS dele no topo (abertas, em andamento, aguardando peça,
 * prontas), o que concluiu e o valor cobrado no período, meta (R$ de serviços ou nº de OS), ranking,
 * desafios de OS, alertas com "Corrija" e lembretes; embaixo a fila de OS, OS por dia e as vendas dele
 * (o técnico também vende). Nunca mostra custo, lucro ou margem (a API nem manda).
 */
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Award, Clock, HardHat, ListChecks, PackageSearch, Plus, ShoppingCart, Timer, Trophy, Wrench } from 'lucide-react';
import { Badge, BadgeCor, Button, EmptyState, Skeleton } from '@/components/ui';
import { Aparecer, BarraAnimada, CardV18, FaixaKpis, KpiV18, LinhaV18, PaginaV18, SecaoDetalhes, listaVariants } from '@/components/dashboard/v18';
import { CORES, TooltipPadrao, rotuloPeriodo } from '@/components/compartilhados/graficos';
import { DesafioCard } from '@/components/compartilhados/DesafioCard';
import { data as fmtData, inteiro, moeda, rotulo } from '@/lib/format';
import { AlertasCorrija, Cabecalho, Lembretes, MetaDoMes, RankingDoMes } from './partes';
import { MensagensCard } from '@/components/chat/MensagensCard';
import { PeriodosRapidos, type PropsRole } from './DashboardVendedor';

const PRIORIDADE_TOM: Record<string, 'vermelho' | 'amarelo' | 'neutro' | 'cinza'> = { URGENTE: 'vermelho', ALTA: 'amarelo', NORMAL: 'neutro', BAIXA: 'cinza' };

export default function DashboardTecnico({ dados, carregando, faixa, filtros, verComo }: PropsRole) {
  const nav = useNavigate();
  const a = dados?.assistencia ?? null;
  const v = dados?.vendas ?? null;
  const ag = a?.agora;
  const p = a?.periodo;
  const qtdOs = a?.meta.tipo === 'QTD_OS';
  const serie = (a?.serie ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const temSerie = serie.some((s) => s.entradas > 0 || s.concluidas > 0);
  const totalAbertas = a?.porSituacao.reduce((s, x) => s + x.qtd, 0) ?? 0;
  return (
    <PaginaV18 className="space-y-4 pb-6 sm:space-y-5">
      <Cabecalho
        nome={dados?.usuario.nome}
        descricao="Suas ordens de serviço, sua meta e seus desafios — e o que falta corrigir."
        acoes={
          <>
            {verComo}
            <Link to="/ordens-servico/nova">
              <Button variante="primario" icone={<Plus className="h-4 w-4" />}>Nova OS</Button>
            </Link>
          </>
        }
      />
      <Aparecer className="flex flex-wrap items-end gap-2">{filtros}</Aparecer>

      {/* ===== topo: minhas OS agora ===== */}
      <FaixaKpis colunas={6}>
        <KpiV18 destaque className="col-span-2" rotulo="OS abertas comigo" valor={ag?.comigo} formato={(n) => inteiro(Math.round(n))} icone={<Wrench className="h-4 w-4" />} tom="vermelho" carregando={carregando} sub={ag ? `${inteiro(ag.atrasadas)} com prazo vencido · ${inteiro(ag.semTecnico)} sem técnico na loja` : 'agora'} onClick={() => nav('/ordens-servico?abertas=true')} />
        <KpiV18 rotulo="Em andamento" valor={ag?.emAndamento} formato={(n) => inteiro(Math.round(n))} icone={<HardHat className="h-4 w-4" />} tom="azul" carregando={carregando} sub="na bancada" />
        <KpiV18 rotulo="Esperando peça" valor={ag?.aguardandoPeca} formato={(n) => inteiro(Math.round(n))} icone={<PackageSearch className="h-4 w-4" />} tom="amarelo" carregando={carregando} sub="aguardando a peça chegar" />
        <KpiV18 rotulo="Aprovação" valor={ag?.aguardandoAprovacao} formato={(n) => inteiro(Math.round(n))} icone={<Clock className="h-4 w-4" />} tom="amarelo" carregando={carregando} sub="orçamento com o cliente" />
        <KpiV18 rotulo="Prontas" valor={ag?.prontas} formato={(n) => inteiro(Math.round(n))} icone={<ListChecks className="h-4 w-4" />} tom="verde" carregando={carregando} sub="aguardando retirada" />
      </FaixaKpis>

      {/* ===== o que foi feito no período ===== */}
      <FaixaKpis colunas={4}>
        <KpiV18 rotulo={`Receita de serviços · ${faixa}`} valor={p?.valorServicos} anterior={p?.anterior?.valorServicos} formato={moeda} icone={<Wrench className="h-4 w-4" />} tom="verde" carregando={carregando} sub={p ? `mão de obra ${moeda(p.maoDeObra)} · peças ${moeda(p.pecas)}` : 'valor cobrado nas OS concluídas'} />
        <KpiV18 rotulo="OS concluídas" valor={p?.concluidas} anterior={p?.anterior?.concluidas} formato={(n) => inteiro(Math.round(n))} icone={<ListChecks className="h-4 w-4" />} tom="verde" carregando={carregando} sub="no período" />
        <KpiV18 rotulo="OS que entraram" valor={p?.entradas} formato={(n) => inteiro(Math.round(n))} icone={<Plus className="h-4 w-4" />} tom="azul" carregando={carregando} sub="comigo, no período" />
        <KpiV18 rotulo="Tempo médio" valor={p?.tempoMedioDias} formato={(n) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`} icone={<Timer className="h-4 w-4" />} tom="neutro" carregando={carregando} sub="da entrada à conclusão" />
      </FaixaKpis>

      {/* ===== meta e ranking ===== */}
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <MetaDoMes
          className="lg:col-span-2"
          meta={a?.meta}
          formato={qtdOs ? (n) => `${inteiro(Math.round(n))} OS` : moeda}
          rotuloMeta={qtdOs ? 'Meta do mês · OS concluídas' : 'Meta do mês · serviços concluídos'}
          rotuloAtingido={qtdOs ? 'concluídas' : 'concluído'}
          descricao={a ? `${inteiro(a.meta.osConcluidas)} OS concluídas · ${moeda(a.meta.valorServicos)} no mês` : undefined}
          carregando={carregando}
        />
        <RankingDoMes titulo="Ranking da assistência" carregando={carregando} posicao={a?.ranking.posicao} total={a?.ranking.total} lista={a?.ranking.lista.map((r) => ({ posicao: r.posicao, nome: r.nome, eu: r.eu, valor: r.valor }))} />
      </div>

      {/* ===== desafios ===== */}
      <Aparecer>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Trophy className="h-4 w-4 text-amber-500" /> Desafios</h2>
          {a && a.meta.bonusDesafios > 0 && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{moeda(a.meta.bonusDesafios)} em prêmios este mês</span>}
        </div>
        {carregando ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
        ) : a?.desafios.length || v?.desafios.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {a?.desafios.map((d) => <DesafioCard key={`os-${d.id}`} d={d} />)}
            {v?.desafios.map((d) => <DesafioCard key={`v-${d.id}`} d={d} />)}
          </div>
        ) : (
          <CardV18><EmptyState compacto icone={<Award className="h-5 w-5" />} titulo="Nenhum desafio no momento" descricao="Quando a gestão lançar um desafio (de OS ou de vendas), ele aparece aqui valendo prêmio." /></CardV18>
        )}
      </Aparecer>

      {/* ===== alertas e lembretes ===== */}
      <MensagensCard />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
        <AlertasCorrija alertas={dados?.alertas} carregando={carregando} />
        <Lembretes lembretes={dados?.lembretes} carregando={carregando} usuarioId={dados?.usuario.id} verComo={dados?.verComo} />
      </div>

      <SecaoDetalhes titulo="Minha fila" dica="por prioridade e tempo na loja" />
      <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
        <CardV18 className="lg:col-span-2" titulo="OS abertas comigo" icone={<Wrench className="h-4 w-4" />} tom="vermelho" semPadding acoes={<Link to="/ordens-servico?abertas=true" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>}>
          {carregando ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : !a?.fila.length ? (
            <EmptyState compacto titulo="Nenhuma OS aberta com você" descricao={ag && ag.semTecnico > 0 ? `${ag.semTecnico} OS sem técnico na loja — veja os alertas para assumir.` : 'Bancada livre!'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead>
                  <tr><th>Nº</th><th>Cliente</th><th>Equipamento</th><th>Situação</th><th>Prioridade</th><th>Na loja</th><th>Previsão</th></tr>
                </thead>
                <tbody>
                  {a.fila.map((o) => (
                    <tr key={o.id} className={clsx(o.atrasada && 'bg-red-50/40')}>
                      <td data-rotulo="Nº"><Link to={`/ordens-servico/${o.id}`} className="font-medium text-brand-600 hover:underline">{o.numero}</Link></td>
                      <td className="max-w-[14rem] truncate" data-rotulo="Cliente">{o.contato?.nome}</td>
                      <td className="max-w-[14rem] truncate text-slate-600" data-rotulo="Equipamento">{[o.equipamento, o.marca, o.modelo].filter(Boolean).join(' ') || '—'}</td>
                      <td data-rotulo="Situação"><BadgeCor cor={o.situacao.cor}>{o.situacao.nome}</BadgeCor></td>
                      <td data-rotulo="Prioridade"><Badge tom={PRIORIDADE_TOM[o.prioridade] ?? 'neutro'}>{rotulo(o.prioridade)}</Badge></td>
                      <td className="whitespace-nowrap num" data-rotulo="Na loja">{o.diasNaLoja} d</td>
                      <td className={clsx('whitespace-nowrap', o.atrasada ? 'font-semibold text-red-600' : 'text-slate-500')} data-rotulo="Previsão">{o.dataPrevista ? fmtData(o.dataPrevista) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardV18>
        <CardV18 titulo="Por situação" descricao="OS abertas comigo" icone={<ListChecks className="h-4 w-4" />} tom="azul">
          {carregando ? (
            <Skeleton className="h-40" />
          ) : !a?.porSituacao.length ? (
            <EmptyState compacto titulo="Sem dados" />
          ) : (
            <motion.ul className="space-y-1" variants={listaVariants} initial="oculto" animate="visivel">
              {a.porSituacao.map((s) => (
                <LinhaV18 key={s.id} bloco onClick={() => nav(`/ordens-servico?situacaoId=${s.id}&tecnicoId=${a.tecnico.id}`)}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5 text-slate-700"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.cor }} /><span className="truncate">{s.nome}</span></span>
                    <span className="num shrink-0 text-slate-500">{inteiro(s.qtd)}</span>
                  </div>
                  <BarraAnimada pct={totalAbertas ? (s.qtd / totalAbertas) * 100 : 0} cor={s.cor} />
                </LinhaV18>
              ))}
            </motion.ul>
          )}
        </CardV18>
      </div>

      <CardV18 titulo="OS por dia" descricao={faixa} icone={<Wrench className="h-4 w-4" />} tom="neutro">
        {carregando ? (
          <Skeleton className="h-52 sm:h-64" />
        ) : !temSerie ? (
          <EmptyState compacto titulo="Nenhuma OS no período" />
        ) : (
          <div className="h-52 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={CORES.grade} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<TooltipPadrao moedaFmt={false} />} cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="entradas" name="Entraram" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={40} />
                <Bar dataKey="concluidas" name="Concluídas" fill="#16a34a" radius={[6, 6, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardV18>

      {/* ===== o técnico também vende ===== */}
      {v && (
        <>
          <SecaoDetalhes titulo="Minhas vendas" dica="o técnico também vende" />
          <Aparecer><PeriodosRapidos periodos={v.periodos} /></Aparecer>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            <MetaDoMes className="lg:col-span-2" meta={v.meta} formato={moeda} rotuloMeta="Meta de vendas do mês" rotuloAtingido="vendido" />
            <CardV18 titulo="Últimas vendas" icone={<ShoppingCart className="h-4 w-4" />} semPadding acoes={<Link to="/vendas/nova" className="text-xs font-medium text-brand-600 hover:underline">Nova venda</Link>}>
              {!v.ultimasVendas.length ? (
                <EmptyState compacto titulo="Nenhuma venda ainda" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {v.ultimasVendas.slice(0, 6).map((x) => (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <Link to={`/vendas/${x.id}`} className="font-medium text-brand-600 hover:underline">{x.numero}</Link>
                      <span className="min-w-0 flex-1 truncate text-slate-700">{x.contato?.nome}</span>
                      <span className="num shrink-0 text-slate-800">{moeda(x.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardV18>
          </div>
        </>
      )}
    </PaginaV18>
  );
}
