import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BarChart3, HandCoins, CircleDollarSign, ClipboardList, Cpu, HardHat, Layers, Package, Percent, Receipt, TrendingUp, Truck, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useTecnicos, opcoesDe } from '@/hooks/useListas';
import { Button, EmptyState, SelectFiltro, Skeleton } from '@/components/ui';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import { PagarTecnicoModal } from './PagarTecnico';
import { Aparecer, Avatar, BarraAnimada, CabecalhoV18, CardV18, Grupo, KpiV18, LinhaV18, PaginaV18, SegmentadoV18, listaVariants } from '@/components/dashboard/v18';
import { data as fmtData, inteiro, moeda, numero, percentual } from '@/lib/format';
import { CORES, TooltipPadrao, eixoMoeda, rotuloPeriodo } from '@/components/compartilhados/graficos';
import type { DashboardAssistencia as Dados, TotaisAssistencia } from '@/types';

/** Linha "receita − custo = lucro" de um bloco (mão de obra ou peças) */
function BlocoLucro({ titulo, icone, receita, custo, rotuloCusto, cor }: { titulo: string; icone: React.ReactNode; receita: number; custo: number; rotuloCusto: string; cor: string }) {
  const lucro = receita - custo;
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{icone}{titulo}</p>
      <div className="space-y-1 text-sm">
        <div className="flex justify-between gap-2"><span className="text-slate-500">Cobrado</span><span className="num font-medium">{moeda(receita)}</span></div>
        <div className="flex justify-between gap-2"><span className="text-slate-500">{rotuloCusto}</span><span className="num text-red-600">- {moeda(custo)}</span></div>
        <div className="flex justify-between gap-2 border-t border-slate-100 pt-1"><span className="font-semibold text-slate-700">Lucro</span><span className={`num font-bold ${lucro < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{moeda(lucro)}</span></div>
      </div>
      <BarraAnimada pct={receita > 0 ? Math.max(0, Math.min(100, (lucro / receita) * 100)) : 0} cor={cor} className="mt-2 h-1.5" />
      <p className="mt-1 text-[11px] text-slate-400 num">margem {receita > 0 ? numero((lucro / receita) * 100, 1) : 0}%</p>
    </div>
  );
}

/** Mini resumo realizado x em andamento */
function MiniTotais({ titulo, t, qtd, tom }: { titulo: string; t?: TotaisAssistencia; qtd: number; tom: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3">
      <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
        <span>{titulo}</span>
        <span className={`num rounded-full px-2 py-0.5 text-[11px] normal-case ${tom}`}>{inteiro(qtd)} OS</span>
      </p>
      <p className="num mt-1.5 text-lg font-bold text-slate-900">{moeda(t?.valorEntrada ?? 0)}</p>
      <p className="num text-xs text-slate-500">
        custos {moeda(t?.custoTotal ?? 0)} · lucro <span className={(t?.lucro ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}>{moeda(t?.lucro ?? 0)}</span>
      </p>
    </div>
  );
}

/** Dashboard de assistência técnica (só ADMIN) — entradas, mão de obra x peças, custos e lucro das OS */
export default function DashboardAssistencia() {
  const nav = useNavigate();
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard();
  const [base, setBase] = useState<'entrada' | 'conclusao'>('entrada');
  const [tecnicoId, setTecnicoId] = useState('');
  const [verCanceladas, setVerCanceladas] = useState(false);
  const [pagarAberto, setPagarAberto] = useState(false);
  const { data: tecnicos } = useTecnicos();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-assistencia', dataInicial, dataFinal, tecnicoId, base],
    queryFn: () => api.get<Dados>('/dashboard/assistencia', { dataInicial, dataFinal, tecnicoId, base }),
    retry: 0,
  });

  const r = data?.resumo;
  const comp = r?.comparativo;
  const series = (data?.series ?? []).map((s) => ({ ...s, rotulo: rotuloPeriodo(s.periodo) }));
  const qtd = (n: number) => inteiro(Math.round(n));
  const maiorTec = Math.max(0, ...(data?.porTecnico ?? []).map((t) => t.valorEntrada));
  const totSit = (data?.porSituacao ?? []).reduce((s, x) => s + x.qtd, 0);
  const ordens = (data?.ordens ?? []).filter((o) => verCanceladas || !o.cancelada);

  // composição do fechamento (barras proporcionais ao valor de entrada)
  const composicao = r
    ? [
        { nome: 'Custo das peças', valor: r.custoPecas, cor: '#f59e0b', icone: <Package className="h-3.5 w-3.5" /> },
        { nome: 'Logística', valor: r.custoLogistica, cor: '#0ea5e9', icone: <Truck className="h-3.5 w-3.5" /> },
        { nome: 'Mão de obra de terceiro', valor: r.custoTerceiros, cor: '#8b5cf6', icone: <HardHat className="h-3.5 w-3.5" /> },
        { nome: 'Lucro', valor: r.lucro, cor: '#16a34a', icone: <TrendingUp className="h-3.5 w-3.5" /> },
      ]
    : [];

  return (
    <PaginaV18 className="space-y-5">
      <CabecalhoV18
        titulo="Dashboard de assistência técnica"
        descricao="Entradas das OS, mão de obra x peças, custos e lucro dos serviços."
        acoes={<Button variante="primario" icone={<HandCoins className="h-4 w-4" />} onClick={() => setPagarAberto(true)}>Pagar técnico</Button>}
        filtros={
          <>
          <FiltroPeriodo id="periodo-assistencia" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />
          <SegmentadoV18
            id="base-assistencia"
            valor={base}
            onMudar={setBase}
            opcoes={[
              { valor: 'entrada', rotulo: 'Por entrada' },
              { valor: 'conclusao', rotulo: 'Por conclusão' },
            ]}
          />
          <SelectFiltro valor={tecnicoId} onChange={setTecnicoId} opcoes={opcoesDe(tecnicos)} placeholder="Todos os técnicos" />
          </>
        }
      />

      <PagarTecnicoModal aberto={pagarAberto} onFechar={() => setPagarAberto(false)} dataInicial={dataInicial} dataFinal={dataFinal} base={base} filtroTecnicoId={tecnicoId} />

      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiV18 rotulo="Valor de entrada" valor={r?.valorEntrada} anterior={comp?.valorEntrada} formato={moeda} icone={<CircleDollarSign className="h-4 w-4" />} tom="azul" carregando={isLoading} sub="vs. período anterior" />
        <KpiV18 rotulo={base === 'entrada' ? 'OS que entraram' : 'OS concluídas'} valor={r?.qtd} anterior={comp?.qtd} formato={qtd} icone={<ClipboardList className="h-4 w-4" />} tom="neutro" carregando={isLoading} onClick={() => nav('/ordens-servico')} sub={r ? `ticket médio ${moeda(r.ticketMedio)}` : undefined} />
        <KpiV18 rotulo="Mão de obra" valor={r?.maoDeObra} anterior={comp?.maoDeObra} formato={moeda} icone={<Wrench className="h-4 w-4" />} tom="vermelho" carregando={isLoading} />
        <KpiV18 rotulo="Peças" valor={r?.pecas} anterior={comp?.pecas} formato={moeda} icone={<Package className="h-4 w-4" />} tom="amarelo" carregando={isLoading} />
        <KpiV18 rotulo="Custos" valor={r?.custoTotal} anterior={comp?.custoTotal} inverter formato={moeda} icone={<Receipt className="h-4 w-4" />} tom="neutro" carregando={isLoading} sub="peças + logística + terceiros" />
        <KpiV18 rotulo="Lucro dos serviços" valor={r?.lucro} anterior={comp?.lucro} formato={moeda} icone={<TrendingUp className="h-4 w-4" />} tom="verde" carregando={isLoading} sub={r ? `margem ${percentual(r.margemPct)}` : undefined} />
      </Grupo>

      {!!r?.semCusto && (
        <Aparecer className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {r.semCusto} OS concluída{r.semCusto > 1 ? 's' : ''} com peça e <strong>sem custo da peça</strong> lançado — o lucro delas está contando a peça como 100% lucro. Abra a OS, clique em Editar e preencha “Custos internos”.
          </span>
        </Aparecer>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <CardV18 className="xl:col-span-2" titulo="Fechamento do período" descricao={faixa} icone={<Percent className="h-4 w-4" />} tom="verde">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : r && r.qtd ? (
            <div className="space-y-4">
              <div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-500">Valor de entrada das OS</span>
                  <span className="num text-lg font-bold text-slate-900">{moeda(r.valorEntrada)}</span>
                </div>
                {r.descontos > 0 && <p className="num text-right text-[11px] text-slate-400">já com {moeda(r.descontos)} de desconto</p>}
                <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  {composicao.map((c) => (
                    <motion.div key={c.nome} initial={{ width: 0 }} animate={{ width: `${r.valorEntrada > 0 ? Math.max(0, (c.valor / r.valorEntrada) * 100) : 0}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} style={{ backgroundColor: c.cor }} title={`${c.nome}: ${moeda(c.valor)}`} />
                  ))}
                </div>
                <motion.ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2" variants={listaVariants} initial="oculto" animate="visivel">
                  {composicao.map((c) => (
                    <LinhaV18 key={c.nome} className="px-0 py-0.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: c.cor }}>{c.icone}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{c.nome}</span>
                      <span className="num text-xs text-slate-400">{r.valorEntrada > 0 ? numero((c.valor / r.valorEntrada) * 100, 0) : 0}%</span>
                      <span className={`num w-28 text-right text-sm font-semibold ${c.nome === 'Lucro' && c.valor < 0 ? 'text-red-600' : 'text-slate-900'}`}>{c.nome === 'Lucro' ? '' : '- '}{moeda(c.valor)}</span>
                    </LinhaV18>
                  ))}
                </motion.ul>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <BlocoLucro titulo="Mão de obra" icone={<Wrench className="h-3.5 w-3.5" />} receita={r.maoDeObra} custo={r.custoTerceiros} rotuloCusto="Terceiros" cor="#dc2626" />
                <BlocoLucro titulo="Peças" icone={<Package className="h-3.5 w-3.5" />} receita={r.pecas} custo={r.custoPecas} rotuloCusto="Custo das peças" cor="#f59e0b" />
              </div>
              {r.custoLogistica > 0 && <p className="text-[11px] text-slate-400">Logística ({moeda(r.custoLogistica)}) e descontos ({moeda(r.descontos)}) entram no lucro total, não em um bloco só.</p>}
            </div>
          ) : (
            <EmptyState compacto icone={<Wrench className="h-5 w-5" />} titulo="Nenhuma OS no período" descricao={base === 'entrada' ? 'Conta as OS pela data de entrada (canceladas ficam de fora dos valores).' : 'Conta só as OS concluídas, pela data de conclusão.'} />
          )}
        </CardV18>

        <CardV18 titulo="Realizado x em andamento" descricao="concluídas já são dinheiro certo" icone={<Layers className="h-4 w-4" />} tom="azul">
          {isLoading ? (
            <Skeleton className="h-56" />
          ) : (
            <div className="space-y-3">
              <MiniTotais titulo="Concluídas" t={r?.realizado} qtd={r?.concluidas ?? 0} tom="bg-emerald-50 text-emerald-700" />
              <MiniTotais titulo="Em andamento" t={r?.previsto} qtd={r?.emAndamento ?? 0} tom="bg-amber-50 text-amber-700" />
              {!!r?.canceladas && <p className="text-xs text-slate-400">{inteiro(r.canceladas)} cancelada{r.canceladas > 1 ? 's' : ''} no período (fora dos valores).</p>}
            </div>
          )}
        </CardV18>
      </div>

      <CardV18 titulo="Entrada x lucro" descricao={faixa} icone={<BarChart3 className="h-4 w-4" />} tom="azul">
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : series.some((s) => s.qtd > 0) ? (
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradEntradaOs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.receita} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={CORES.receita} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradLucroOs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CORES.lucro} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={CORES.lucro} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CORES.grade} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={eixoMoeda} tick={{ fontSize: 11, fill: CORES.eixo }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<TooltipPadrao />} cursor={{ stroke: CORES.eixo, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="valorEntrada" name="Entrada" stroke={CORES.receita} fill="url(#gradEntradaOs)" strokeWidth={2.5} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} animationDuration={1100} />
                <Area type="monotone" dataKey="custo" name="Custos" stroke={CORES.saida} fill="none" strokeWidth={1.5} strokeDasharray="4 3" animationDuration={1200} />
                <Area type="monotone" dataKey="lucro" name="Lucro" stroke={CORES.lucro} fill="url(#gradLucroOs)" strokeWidth={2} animationDuration={1300} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState compacto titulo="Sem OS no período" />
        )}
      </CardV18>

      <div className="grid gap-4 xl:grid-cols-2">
        <CardV18 titulo="Por técnico" descricao={faixa} icone={<HardHat className="h-4 w-4" />} tom="amarelo" semPadding>
          {isLoading ? (
            <div className="p-4"><Skeleton className="h-48" /></div>
          ) : data?.porTecnico.length ? (
            <motion.ul className="px-2 pb-3 sm:px-3" variants={listaVariants} initial="oculto" animate="visivel">
              {data.porTecnico.map((t, i) => (
                <LinhaV18 key={t.id ?? `sem-${i}`}>
                  <Avatar nome={t.nome} indice={i} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{t.nome}</span>
                      <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(t.valorEntrada)}</span>
                    </div>
                    <BarraAnimada pct={maiorTec > 0 ? (t.valorEntrada / maiorTec) * 100 : 0} cor={i === 0 ? '#dc2626' : '#94a3b8'} className="mt-1.5 h-1.5" />
                    <p className="mt-1 text-[11px] text-slate-400 num">
                      {inteiro(t.qtd)} OS · M.O. {moeda(t.maoDeObra)} · peças {moeda(t.pecas)} · lucro <span className={t.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}>{moeda(t.lucro)}</span>
                    </p>
                  </div>
                </LinhaV18>
              ))}
            </motion.ul>
          ) : (
            <EmptyState compacto titulo="Sem dados" />
          )}
        </CardV18>

        <CardV18 titulo="Por situação e equipamento" descricao={faixa} icone={<Cpu className="h-4 w-4" />} tom="neutro">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="space-y-5">
              <motion.ul className="space-y-1" variants={listaVariants} initial="oculto" animate="visivel">
                {(data?.porSituacao ?? []).map((s) => (
                  <LinhaV18 key={s.id} onClick={() => nav(`/ordens-servico?situacoes=${s.id}`)} bloco>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.cor }} />
                      <span className="min-w-0 flex-1 truncate text-slate-700">{s.nome}</span>
                      <span className="num text-slate-500">{inteiro(s.qtd)}</span>
                      <span className="num w-24 text-right font-medium">{moeda(s.valor)}</span>
                    </div>
                    <BarraAnimada pct={totSit ? (s.qtd / totSit) * 100 : 0} cor={s.cor} className="ml-4 mt-1 h-1" />
                  </LinhaV18>
                ))}
                {!data?.porSituacao?.length && <li className="text-xs text-slate-400">Sem dados</li>}
              </motion.ul>
              {data?.porEquipamento?.length ? (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Equipamentos</p>
                  <div className="flex flex-wrap gap-2">
                    {data.porEquipamento.map((e) => (
                      <motion.span key={e.nome} whileHover={{ y: -2 }} className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs shadow-card">
                        <span className="truncate text-slate-600">{e.nome}</span>
                        <span className="num text-slate-400">{inteiro(e.qtd)}</span>
                        <span className="num font-semibold text-slate-900">{moeda(e.valorEntrada)}</span>
                      </motion.span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardV18>
      </div>

      <CardV18
        titulo="Todas as ordens de serviço"
        descricao={`${inteiro(ordens.length)} OS · ${faixa}`}
        icone={<ClipboardList className="h-4 w-4" />}
        tom="vermelho"
        semPadding
        acoes={
          r?.canceladas ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={verCanceladas} onChange={(e) => setVerCanceladas(e.target.checked)} /> mostrar canceladas
            </label>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="p-4"><Skeleton className="h-64" /></div>
        ) : ordens.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-pilha">
              <thead>
                <tr>
                  <th>OS</th>
                  <th>Cliente / equipamento</th>
                  <th>Situação</th>
                  <th className="text-right">Entrada</th>
                  <th className="text-right">Mão de obra</th>
                  <th className="text-right">Peças</th>
                  <th className="text-right">Custo peça</th>
                  <th className="text-right">Logística</th>
                  <th className="text-right">Terceiro</th>
                  <th className="text-right">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((o) => (
                  <tr key={o.id} className={`cursor-pointer hover:bg-slate-50 ${o.cancelada ? 'opacity-50' : ''}`} onClick={() => nav(`/ordens-servico/${o.id}`)}>
                    <td data-rotulo="OS">
                      <Link to={`/ordens-servico/${o.id}`} className="num font-semibold text-brand-600 hover:underline" onClick={(e) => e.stopPropagation()}>nº {o.numero}</Link>
                      <div className="num text-[11px] text-slate-400">{fmtData(base === 'conclusao' && o.dataConclusao ? o.dataConclusao : o.dataEntrada)}</div>
                    </td>
                    <td className="pilha-cheio max-w-[260px]">
                      <div className="truncate text-sm text-slate-800">{o.cliente}</div>
                      <div className="truncate text-[11px] text-slate-400">{o.equipamento || '—'}{o.tecnico ? ` · ${o.tecnico}` : ''}</div>
                    </td>
                    <td data-rotulo="Situação">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-600"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.situacao.cor }} />{o.situacao.nome}</span>
                    </td>
                    <td className="num text-right font-medium" data-rotulo="Entrada">{moeda(o.valorEntrada)}</td>
                    <td className="num text-right" data-rotulo="Mão de obra">{moeda(o.maoDeObra)}</td>
                    <td className="num text-right" data-rotulo="Peças">{moeda(o.pecas)}</td>
                    <td className="num text-right text-slate-500" data-rotulo="Custo peça">
                      {o.pecas > 0 && o.custoPecas === 0 ? <span className="text-amber-600" title="Sem custo da peça lançado">—</span> : moeda(o.custoPecas)}
                    </td>
                    <td className="num text-right text-slate-500" data-rotulo="Logística">{moeda(o.custoLogistica)}</td>
                    <td className="num text-right text-slate-500" data-rotulo="Terceiro">{moeda(o.custoMaoObraTerceiro)}</td>
                    <td className={`num text-right font-semibold ${o.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}`} data-rotulo="Lucro">
                      {moeda(o.lucro)}
                      <div className="text-[11px] font-normal text-slate-400">{numero(o.margemPct, 1)}%</div>
                    </td>
                  </tr>
                ))}
                {r && (
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={3} className="pilha-cheio">Total (sem canceladas)</td>
                    <td className="num text-right" data-rotulo="Entrada">{moeda(r.valorEntrada)}</td>
                    <td className="num text-right" data-rotulo="Mão de obra">{moeda(r.maoDeObra)}</td>
                    <td className="num text-right" data-rotulo="Peças">{moeda(r.pecas)}</td>
                    <td className="num text-right" data-rotulo="Custo peça">{moeda(r.custoPecas)}</td>
                    <td className="num text-right" data-rotulo="Logística">{moeda(r.custoLogistica)}</td>
                    <td className="num text-right" data-rotulo="Terceiro">{moeda(r.custoTerceiros)}</td>
                    <td className={`num text-right ${r.lucro < 0 ? 'text-red-600' : 'text-emerald-600'}`} data-rotulo="Lucro">{moeda(r.lucro)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState compacto titulo="Nenhuma OS no período" />
        )}
      </CardV18>
    </PaginaV18>
  );
}
