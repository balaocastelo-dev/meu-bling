/**
 * DASHBOARD DE CONSIGNAÇÃO (gestor e gerente): o que está em estoque consignado, quanto dá para lucrar,
 * o que já vendeu e lucrou, quanto já foi pago aos consignantes e os números desde o início.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Boxes, CircleDollarSign, Clock, Handshake, PiggyBank, Repeat, ShoppingCart, TrendingUp, Users, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { PeriodoFiltro, Skeleton } from '@/components/ui';
import { Aparecer, BarraAnimada, CardV18, Grupo, KpiV18, PaginaV18 } from '@/components/dashboard/v18';
import { data as fmtData, dataHora, moeda } from '@/lib/format';
import { intervaloPeriodo } from '@/lib/periodo';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import { nomeTipo } from '@/pages/consignacoes/comum';

interface Dados {
  estoque: {
    qtd: number; valorVenda: number; custo: number; lucroPotencial: number; margemPct: number; diasMedioEmLoja: number; emDiarias: number; semAssinatura: number;
    porTipo: { tipo: string; qtd: number; valorVenda: number; lucroPotencial: number }[];
    itens: { id: number; numero: number; descricao: string; tipo: string; status: string; statusRotulo: string; consignante: string; precoVenda: number; valorConsignante: number; lucro: number; margemPct: number; diasEmLoja: number; dataLimite: string; assinado: boolean; pagoAoConsignante: number }[];
  };
  vendas: {
    qtd: number; faturamento: number; custo: number; lucro: number; margemPct: number; ticketMedio: number; diasMedioParaVender: number; taxasRetirada: number;
    itens: { id: number; numero: number; descricao: string; tipo: string; consignante: string; vendaId: number | null; vendaNumero: number | null; vendidoEm: string; vendido: number; valorConsignante: number; lucro: number; margemPct: number; diasParaVender: number }[];
  };
  pagamentos: { pagoNoPeriodo: number; aPagar: number };
  total: { contratos: number; vendidos: number; retirados: number; cancelados: number; faturamento: number; lucro: number; margemPct: number; taxasRetirada: number; conversaoPct: number };
  serie: { mes: string; qtd: number; faturamento: number; lucro: number }[];
  consignantes: { nome: string; vendidos: number; lucro: number; emLoja: number }[];
  atualizadoEm: string;
}

const moedaKpi = (n: number) => moeda(n).replace('-', '−⁠').replace(/\s/g, ' ');
const qtd = (n: number) => String(Math.round(n));
const pctTxt = (n: number) => `${String(n).replace('.', ',')}%`;

export default function DashboardConsignacao() {
  const mes = intervaloPeriodo('mes');
  const [periodo, setPeriodo] = useState({ i: mes.dataInicial, f: mes.dataFinal });
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard-consignacao', periodo],
    queryFn: () => api.get<Dados>('/consignacoes/dashboard', { dataInicial: periodo.i || undefined, dataFinal: periodo.f || undefined }),
    refetchInterval: 60_000,
  });
  const e = data?.estoque;
  const v = data?.vendas;
  const t = data?.total;
  const serie = (data?.serie ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.mes) }));
  const maxTipo = Math.max(1, ...(e?.porTipo ?? []).map((x) => x.lucroPotencial));

  return (
    <PaginaV18 className="space-y-4">
      <Aparecer className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Dashboard de consignação</h1>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
            <span className="relative flex h-2.5 w-2.5">
              <span className={clsx('absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75', isFetching && 'animate-ping')} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Estoque e lucro dos consignados{data ? ` · ${dataHora(data.atualizadoEm)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <PeriodoFiltro inicial={periodo.i} final={periodo.f} onChange={(i, f) => setPeriodo({ i, f })} label="Vendas no período" />
          <Link to="/consignacoes" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Ver contratos</Link>
        </div>
      </Aparecer>

      <Aparecer>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Em estoque agora</p>
      </Aparecer>
      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiV18 rotulo="Itens consignados na loja" valor={e?.qtd} formato={qtd} icone={<Boxes className="h-4 w-4" />} tom="azul" carregando={isLoading} sub={e ? `média de ${e.diasMedioEmLoja} dia(s) na loja · ${e.emDiarias} em diárias` : undefined} />
        <KpiV18 rotulo="Valor em estoque" sub="pelo preço de venda" valor={e?.valorVenda} formato={moedaKpi} icone={<ShoppingCart className="h-4 w-4" />} tom="neutro" carregando={isLoading} />
        <KpiV18 rotulo="Custo dos consignantes" sub="o que a loja paga a eles" valor={e?.custo} formato={moedaKpi} icone={<Wallet className="h-4 w-4" />} tom="amarelo" carregando={isLoading} />
        <KpiV18 rotulo="Lucro possível vendendo tudo" valor={e?.lucroPotencial} formato={moedaKpi} icone={<TrendingUp className="h-4 w-4" />} tom="verde" carregando={isLoading} sub={e ? `margem de ${pctTxt(e.margemPct)}` : undefined} />
      </Grupo>

      <Aparecer>
        <p className="mb-2 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Vendas no período</p>
      </Aparecer>
      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiV18 rotulo="Consignados vendidos" valor={v?.qtd} formato={qtd} icone={<Handshake className="h-4 w-4" />} tom="azul" carregando={isLoading} sub={v ? `vendem em ${v.diasMedioParaVender} dia(s) em média` : undefined} />
        <KpiV18 rotulo="Faturamento" valor={v?.faturamento} formato={moedaKpi} icone={<CircleDollarSign className="h-4 w-4" />} tom="neutro" carregando={isLoading} sub={v ? `ticket médio ${moeda(v.ticketMedio)}` : undefined} />
        <KpiV18 rotulo="Lucro realizado" valor={v ? v.lucro + v.taxasRetirada : undefined} formato={moedaKpi} icone={<PiggyBank className="h-4 w-4" />} tom="verde" carregando={isLoading} sub={v ? `margem ${pctTxt(v.margemPct)}${v.taxasRetirada ? ` · ${moeda(v.taxasRetirada)} de taxas de retirada` : ''}` : undefined} />
        <KpiV18 rotulo="Pago aos consignantes" valor={data?.pagamentos.pagoNoPeriodo} formato={moedaKpi} icone={<Wallet className="h-4 w-4" />} tom="vermelho" carregando={isLoading} sub={data ? `falta pagar ${moeda(data.pagamentos.aPagar)}` : undefined} />
      </Grupo>

      <Grupo className="grid gap-4 xl:grid-cols-3">
        <CardV18 className="xl:col-span-2" titulo="Últimos 12 meses" descricao="faturamento e lucro das vendas de consignados" icone={<TrendingUp className="h-4 w-4" />} tom="azul">
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer>
                  <BarChart data={serie} margin={{ left: 0, right: 8, top: 8 }} barGap={2}>
                    <CartesianGrid stroke={CORES.grade} vertical={false} />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={60} />
                    <Tooltip content={<TooltipPadrao />} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="faturamento" name="Faturamento" fill={CORES.receita} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={900} />
                    <Bar dataKey="lucro" name="Lucro" fill={CORES.lucro} radius={[4, 4, 0, 0]} maxBarSize={22} animationDuration={1100} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES.receita }} /> Faturamento</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CORES.lucro }} /> Lucro</span>
              </div>
            </>
          )}
        </CardV18>

        <CardV18 titulo="Desde o início" descricao="todos os contratos" icone={<Repeat className="h-4 w-4" />}>
          {t ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['Contratos', qtd(t.contratos)],
                ['Vendidos', qtd(t.vendidos)],
                ['Retirados', qtd(t.retirados)],
                ['Viram venda', pctTxt(t.conversaoPct)],
                ['Faturamento', moeda(t.faturamento)],
                ['Lucro', moeda(t.lucro + t.taxasRetirada)],
                ['Margem', pctTxt(t.margemPct)],
                ['Taxas de retirada', moeda(t.taxasRetirada)],
              ].map(([r, val]) => (
                <div key={r} className="rounded-lg bg-slate-50 p-2">
                  <dt className="text-[11px] text-slate-500">{r}</dt>
                  <dd className="num font-semibold text-slate-900">{val}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Skeleton className="h-48" />
          )}
        </CardV18>
      </Grupo>

      <Grupo className="grid gap-4 xl:grid-cols-3">
        <CardV18 titulo="Lucro possível por tipo" descricao="o que está na loja hoje" icone={<Boxes className="h-4 w-4" />} tom="verde">
          {e?.porTipo.length ? (
            <ul className="space-y-2.5">
              {e.porTipo.map((x) => (
                <li key={x.tipo}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate text-slate-700">{nomeTipo(x.tipo)} <span className="text-slate-400">· {x.qtd} item(ns)</span></span>
                    <span className="num shrink-0 font-semibold text-slate-900">{moeda(x.lucroPotencial)} <span className="font-normal text-slate-400">de {moeda(x.valorVenda)}</span></span>
                  </div>
                  <BarraAnimada pct={(x.lucroPotencial / maxTipo) * 100} cor={CORES.lucro} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-xs text-slate-400">Nenhum consignado na loja.</p>
          )}
        </CardV18>

        <CardV18 className="xl:col-span-2" titulo="Consignantes" descricao="quem mais gerou lucro (desde o início)" icone={<Users className="h-4 w-4" />} semPadding>
          {data?.consignantes.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Consignante</th><th className="px-3 py-2 text-right">Vendidos</th><th className="px-3 py-2 text-right">Na loja</th><th className="px-4 py-2 text-right">Lucro gerado</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.consignantes.map((c) => (
                    <tr key={c.nome}><td className="px-4 py-2 text-slate-800">{c.nome}</td><td className="num px-3 py-2 text-right">{c.vendidos}</td><td className="num px-3 py-2 text-right">{c.emLoja}</td><td className="num px-4 py-2 text-right font-semibold text-emerald-700">{moeda(c.lucro)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Ainda sem consignantes.</p>
          )}
        </CardV18>
      </Grupo>

      <Aparecer>
        <CardV18 titulo="Em estoque" descricao="mais antigos primeiro — preço, quanto vai para o consignante e quanto a loja lucra" icone={<Clock className="h-4 w-4" />} semPadding>
          {e?.itens.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-4 py-2">Equipamento</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2 text-right">Na loja</th><th className="px-3 py-2 text-right">Preço</th><th className="px-3 py-2 text-right">Consignante</th><th className="px-3 py-2 text-right">Lucro</th><th className="px-4 py-2 text-right">Margem</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {e.itens.map((i) => (
                    <tr key={i.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        <Link to={`/consignacoes/${i.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">nº {i.numero} · {i.descricao}</Link>
                        <p className="text-[11px] text-slate-400">{nomeTipo(i.tipo)} · {i.consignante}{!i.assinado && <span className="ml-1 text-amber-600">· sem assinatura</span>}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{i.statusRotulo}<p className="text-[11px] text-slate-400">prazo {fmtData(i.dataLimite)}</p></td>
                      <td className={clsx('num px-3 py-2 text-right', i.diasEmLoja > 10 ? 'font-semibold text-amber-700' : 'text-slate-700')}>{i.diasEmLoja} d</td>
                      <td className="num px-3 py-2 text-right">{moeda(i.precoVenda)}</td>
                      <td className="num px-3 py-2 text-right text-slate-600">{moeda(i.valorConsignante)}</td>
                      <td className="num px-3 py-2 text-right font-semibold text-emerald-700">{moeda(i.lucro)}</td>
                      <td className="num px-4 py-2 text-right text-slate-600">{pctTxt(i.margemPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Nenhum consignado na loja agora.</p>
          )}
        </CardV18>
      </Aparecer>

      <Aparecer>
        <CardV18 titulo="Vendidos no período" descricao="preço vendido, quanto foi do consignante e o lucro da loja" icone={<Handshake className="h-4 w-4" />} tom="verde" semPadding>
          {v?.itens.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr><th className="px-4 py-2">Equipamento</th><th className="px-3 py-2">Venda</th><th className="px-3 py-2 text-right">Vendeu em</th><th className="px-3 py-2 text-right">Vendido</th><th className="px-3 py-2 text-right">Consignante</th><th className="px-4 py-2 text-right">Lucro</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {v.itens.map((i) => (
                    <tr key={i.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        <Link to={`/consignacoes/${i.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">nº {i.numero} · {i.descricao}</Link>
                        <p className="text-[11px] text-slate-400">{nomeTipo(i.tipo)} · {i.consignante}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{i.vendaId ? <Link to={`/vendas/${i.vendaId}`} className="text-brand-700 hover:underline">nº {i.vendaNumero}</Link> : '—'}<p className="text-[11px] text-slate-400">{fmtData(i.vendidoEm)}</p></td>
                      <td className="num px-3 py-2 text-right text-slate-600">{i.diasParaVender} d</td>
                      <td className="num px-3 py-2 text-right">{moeda(i.vendido)}</td>
                      <td className="num px-3 py-2 text-right text-slate-600">{moeda(i.valorConsignante)}</td>
                      <td className="num px-4 py-2 text-right font-semibold text-emerald-700">{moeda(i.lucro)} <span className="font-normal text-slate-400">{pctTxt(i.margemPct)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-xs text-slate-400">Nenhum consignado vendido no período.</p>
          )}
        </CardV18>
      </Aparecer>
    </PaginaV18>
  );
}
