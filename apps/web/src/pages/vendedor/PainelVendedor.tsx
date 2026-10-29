import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import { Award, CalendarDays, Gift, Medal, Plus, Receipt, Settings2, Target, Trophy, UserX } from 'lucide-react';
import { api, ApiError, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useVendedores, opcoesDe } from '@/hooks/useListas';
import { BadgeCor, Button, EmptyState, Select, Skeleton } from '@/components/ui';
import { CabecalhoV18, CardV18, Grupo, KpiV18, PaginaV18, SecaoV18 } from '@/components/dashboard/v18';
import { DesafioCard } from '@/components/compartilhados/DesafioCard';
import { competenciaLabel, data, inteiro, moeda } from '@/lib/format';
import type { MetaPainel, PainelVendedor as Painel } from '@/types';

const RITMO: Record<MetaPainel['ritmo'], { barra: string; texto: string; rotulo: string }> = {
  batida: { barra: 'bg-emerald-500', texto: 'text-emerald-700', rotulo: 'Meta batida! 🎉' },
  ok: { barra: 'bg-emerald-500', texto: 'text-emerald-700', rotulo: 'No ritmo' },
  atencao: { barra: 'bg-amber-500', texto: 'text-amber-700', rotulo: 'Um pouco atrás' },
  atrasado: { barra: 'bg-red-500', texto: 'text-red-700', rotulo: 'Bem atrás do ritmo' },
  'sem-meta': { barra: 'bg-slate-300', texto: 'text-slate-500', rotulo: 'Sem meta' },
};

/** Painel do vendedor: vendas por período, meta do mês, desafios (cards), ranking e últimas vendas */
export default function PainelVendedor() {
  const [params, setParams] = useSearchParams();
  const gestor = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const { data: vendedores } = useVendedores();
  const vendedorId = gestor ? params.get('vendedorId') || '' : '';

  const { data: p, isLoading, error } = useQuery({
    queryKey: ['painel-vendedor', vendedorId],
    queryFn: () => api.get<Painel>('/painel-vendedor', { vendedorId }),
    // números ao vivo: atualiza a cada 20 s, ao voltar para a aba e após qualquer gravação
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const semVinculo = error instanceof ApiError && error.code === 'SEM_VENDEDOR';

  return (
    <PaginaV18 className="space-y-4">
      <CabecalhoV18
        titulo={gestor ? 'Painel do vendedor' : 'Meu painel'}
        descricao={p ? `${p.vendedor.nome} · ${competenciaLabel(p.meta.competencia)}` : 'Suas vendas, meta e desafios'}
        filtros={
          gestor ? (
            <Select
              className="w-full sm:w-56"
              value={vendedorId || String(p?.vendedor.id ?? '')}
              onChange={(e) => setParams(e.target.value ? { vendedorId: e.target.value } : {})}
              opcoes={opcoesDe(vendedores).map((o) => ({ valor: String(o.valor), rotulo: o.rotulo }))}
            />
          ) : undefined
        }
        acoes={
          gestor ? (
            <Link to="/metas-desafios">
              <Button variante="secundario" icone={<Settings2 className="h-4 w-4" />}>Metas e desafios</Button>
            </Link>
          ) : (
            <Link to="/vendas/nova">
              <Button icone={<Plus className="h-4 w-4" />}>Nova venda</Button>
            </Link>
          )
        }
      />

      {error && (
        <EmptyState
          icone={<UserX className="h-5 w-5" />}
          titulo={semVinculo ? 'Usuário sem cadastro de vendedor' : 'Não foi possível abrir o painel'}
          descricao={mensagemErro(error)}
          acao={gestor && semVinculo ? <Link to="/configuracoes/vendedores"><Button variante="secundario">Cadastrar vendedor</Button></Link> : undefined}
        />
      )}

      {!error && (
        <div className="space-y-4">
          {/* ---- vendas por período (cartões de KPI do painel) */}
          <SecaoV18 titulo="Minhas vendas" nota="comissão em cada período" />
          <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {(p?.periodos ?? Array.from({ length: 6 }, () => null)).map((per, i) => (
              <KpiV18
                key={per?.chave ?? i}
                rotulo={per?.rotulo ?? '…'}
                valor={per?.faturamento}
                formato={moeda}
                carregando={!per}
                tom={per?.chave === 'hoje' ? 'vermelho' : 'neutro'}
                icone={per?.chave === 'hoje' ? <Receipt className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                sub={
                  per ? (
                    <>
                      {inteiro(per.qtd)} {per.qtd === 1 ? 'venda' : 'vendas'}
                      {per.qtd > 0 && <> · ticket {moeda(per.ticketMedio)}</>} · comissão <span className="font-semibold text-slate-600 num">{moeda(per.comissao)}</span>
                    </>
                  ) : undefined
                }
              />
            ))}
          </Grupo>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ---- meta do mês */}
            <CardV18 className="lg:col-span-2" titulo="Meta do mês" descricao={p ? competenciaLabel(p.meta.competencia) : undefined} icone={<Target className="h-4 w-4" />} tom="vermelho">
              {isLoading || !p ? <Skeleton className="h-24 w-full" /> : <BlocoMeta meta={p.meta} />}
            </CardV18>

            {/* ---- ranking */}
            <CardV18 titulo="Ranking do mês" icone={<Medal className="h-4 w-4" />} tom="amarelo" semPadding>
              {!p ? (
                <div className="p-4"><Skeleton className="h-24 w-full" /></div>
              ) : (
                <>
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                    <span className="text-3xl font-extrabold text-slate-900 num">{p.ranking.posicao}º</span>
                    <div className="text-xs text-slate-500">
                      de {p.ranking.total} vendedores
                      {p.ranking.paraPassar && p.ranking.paraPassar.falta > 0 && (
                        <p className="mt-0.5 font-medium text-slate-700">Faltam {moeda(p.ranking.paraPassar.falta)} para passar {p.ranking.paraPassar.nome}</p>
                      )}
                      {p.ranking.posicao === 1 && p.meta.vendido > 0 && <p className="mt-0.5 font-medium text-emerald-700">Você está na frente! 🥇</p>}
                    </div>
                  </div>
                  <ol className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                    {p.ranking.lista.map((r) => (
                      <li key={r.vendedorId} className={clsx('flex items-center gap-3 px-4 py-2 text-sm', r.eu && 'bg-brand-50/60 font-semibold')}>
                        <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', r.posicao === 1 ? 'bg-amber-400 text-white' : r.posicao === 2 ? 'bg-slate-300 text-white' : r.posicao === 3 ? 'bg-orange-300 text-white' : 'bg-slate-100 text-slate-500')}>{r.posicao}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-800">{r.nome}{r.eu && ' (você)'}</span>
                        {r.faturamento !== null && <span className="text-xs text-slate-500 num">{moeda(r.faturamento)}</span>}
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </CardV18>
          </div>

          {/* ---- desafios */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Trophy className="h-4 w-4 text-amber-500" /> Desafios</h2>
              {p && p.meta.bonusDesafios > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"><Gift className="h-3.5 w-3.5" /> {moeda(p.meta.bonusDesafios)} em prêmios este mês</span>
              )}
            </div>
            {!p ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /></div>
            ) : p.desafios.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {p.desafios.map((d) => <DesafioCard key={d.id} d={d} />)}
              </div>
            ) : (
              <CardV18>
                <EmptyState compacto icone={<Award className="h-5 w-5" />} titulo="Nenhum desafio no momento" descricao={gestor ? 'Lance um desafio em Metas e desafios — ele aparece aqui como card para o vendedor.' : 'Quando a gestão lançar um desafio, ele aparece aqui valendo prêmio em comissão.'} />
              </CardV18>
            )}
          </div>

          {/* ---- últimas vendas */}
          <CardV18 titulo="Últimas vendas" icone={<Receipt className="h-4 w-4" />} tom="azul" semPadding acoes={<Link to="/vendas" className="text-xs font-medium text-brand-600 hover:underline">Ver todas</Link>}>
            {!p ? (
              <div className="p-4"><Skeleton className="h-24 w-full" /></div>
            ) : p.ultimasVendas.length ? (
              <div className="overflow-x-auto">
              <table className="tbl tbl-pilha">
                <thead>
                  <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Situação</th><th className="text-right">Total</th></tr>
                </thead>
                <tbody>
                  {p.ultimasVendas.map((v) => (
                    <tr key={v.id}>
                      <td data-rotulo="Nº"><Link to={`/vendas/${v.id}`} className="font-medium text-brand-600 hover:underline">{v.numero}</Link></td>
                      <td className="whitespace-nowrap text-slate-500" data-rotulo="Data">{data(v.data)}</td>
                      <td className="max-w-[16rem] truncate" data-rotulo="Cliente">{v.contato?.nome}</td>
                      <td data-rotulo="Situação"><BadgeCor cor={v.situacao.cor}>{v.situacao.nome}</BadgeCor></td>
                      <td className="whitespace-nowrap text-right num" data-rotulo="Total">{moeda(v.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <EmptyState compacto titulo="Nenhuma venda ainda" />
            )}
          </CardV18>
          <p className="text-center text-[11px] text-slate-400">Contam todas as vendas assim que são salvas (em aberto, fechadas, com NF). Cancelada sai da conta; orçamento não conta.</p>
        </div>
      )}
    </PaginaV18>
  );
}

function BlocoMeta({ meta }: { meta: MetaPainel }) {
  const r = RITMO[meta.ritmo];
  if (!meta.valor) {
    return <EmptyState compacto icone={<Target className="h-5 w-5" />} titulo="Meta ainda não definida" descricao="A gestão define a meta em Metas e desafios." />;
  }
  const esperadoPct = Math.min(100, (meta.esperadoAteHoje / meta.valor) * 100);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold tracking-tight text-slate-900 num sm:text-3xl">{moeda(meta.vendido)}</p>
          <p className="text-sm text-slate-500">de <span className="font-medium text-slate-700 num">{moeda(meta.valor)}</span></p>
        </div>
        <div className="text-right">
          <p className={clsx('text-2xl font-bold num sm:text-3xl', r.texto)}>{meta.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</p>
          <p className={clsx('text-xs font-semibold', r.texto)}>{r.rotulo}</p>
        </div>
      </div>
      <div className="relative mt-3 h-4 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={clsx('h-full rounded-full transition-all', r.barra)} style={{ width: `${Math.min(100, Math.max(1.5, meta.pct))}%` }} />
        {meta.ritmo !== 'batida' && <div className="absolute inset-y-0 w-0.5 bg-slate-500/70" style={{ left: `${esperadoPct}%` }} title={`Esperado até hoje: ${moeda(meta.esperadoAteHoje)}`} />}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
        <Info rotulo="Falta" valor={moeda(meta.falta)} />
        <Info rotulo="Precisa por dia" valor={meta.falta > 0 ? moeda(meta.porDia) : '—'} />
        <Info rotulo="Dias restantes" valor={inteiro(meta.diasRestantes)} />
        <Info rotulo="Esperado até hoje" valor={moeda(meta.esperadoAteHoje)} />
      </div>
    </div>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className="font-semibold text-slate-800 num">{valor}</p>
    </div>
  );
}
