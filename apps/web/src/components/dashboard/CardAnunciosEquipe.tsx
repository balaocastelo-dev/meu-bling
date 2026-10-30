/**
 * "Pagamento extra por anúncio da equipe" — card do dashboard principal do gestor.
 *
 * O número que importa não é a comissão isolada (que parece só despesa), e sim o LUCRO que os
 * anúncios da equipe trouxeram: do lucro saem os 33% do técnico ou os 20% do vendedor, e o resto
 * fica na loja. Por isso o card mostra os três juntos. Usa o mesmo filtro de data do dashboard.
 * Ver docs/VITRINE-EQUIPE.md.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { BadgePercent, Crown, Eye, HardHat, Megaphone, Store, TrendingUp, Users } from 'lucide-react';
import { api, rotaIndisponivel } from '@/lib/api';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { inteiro, moeda, numero } from '@/lib/format';
import { Avatar, BarraAnimada, CardV18, LinhaV18, listaVariants } from './v18';

interface PainelAnuncios {
  periodo: { dataInicial: string; dataFinal: string };
  lucroGerado: number;
  comissaoTotal: number;
  comissaoPaga: number;
  comissaoAReceber: number;
  lucroLiquido: number;
  qtdVendas: number;
  qtdAnunciosAtivos: number;
  porDono: { tipo: 'TECNICO' | 'VENDEDOR'; nome: string; lucroGerado: number; comissao: number; vendas: number }[];
  topAnuncios: { codigo: string; titulo: string; dono: string | null; lucroGerado: number; comissao: number; vendas: number; visitas: number }[];
}

const COR_TECNICO = '#dc2626';
const COR_VENDEDOR = '#2563eb';

export function CardAnunciosEquipe({ dataInicial, dataFinal, faixa }: { dataInicial: string; dataFinal: string; faixa: string }) {
  const nav = useNavigate();
  const { data: p, isLoading, error } = useQuery({
    queryKey: ['dashboard-anuncios', dataInicial, dataFinal],
    queryFn: () => api.get<PainelAnuncios>('/dashboard/anuncios', { dataInicial, dataFinal }),
    refetchInterval: 60_000,
    retry: 0,
  });

  // rota ainda não publicada na API: não poluir o dashboard com erro
  if (error && rotaIndisponivel(error)) return null;

  const pctComissao = p && p.lucroGerado > 0 ? (p.comissaoTotal / p.lucroGerado) * 100 : 0;
  const semMovimento = !!p && p.qtdVendas === 0;
  const maiorDono = Math.max(1, ...(p?.porDono ?? []).map((d) => d.lucroGerado));
  const maiorAnuncio = Math.max(1, ...(p?.topAnuncios ?? []).map((a) => a.lucroGerado));

  return (
    <CardV18
      titulo="Pagamento extra por anúncio da equipe"
      descricao={`${faixa} · vitrine do site: técnico 33% e vendedor 20% do lucro`}
      icone={<Megaphone className="h-4 w-4" />}
      tom="verde"
      acoes={
        <Link to="/anuncios" className="text-xs font-medium text-brand-600 hover:underline">
          Ver anúncios
        </Link>
      }
    >
      {isLoading && !p ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="space-y-4">
          {/* a conta inteira: o que os anúncios trouxeram, o que a equipe recebe e o que sobra */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Bloco
              rotulo="Lucro que os anúncios trouxeram"
              valor={moeda(p?.lucroGerado)}
              sub={`${inteiro(p?.qtdVendas)} venda(s)/OS pelos anúncios`}
              tom="azul"
              icone={<TrendingUp className="h-3.5 w-3.5" />}
            />
            <Bloco
              rotulo="Pagamento extra à equipe"
              valor={moeda(p?.comissaoTotal)}
              sub={`${moeda(p?.comissaoAReceber)} a pagar · ${moeda(p?.comissaoPaga)} já pago`}
              tom="amarelo"
              icone={<BadgePercent className="h-3.5 w-3.5" />}
              onClick={() => nav('/comissoes')}
            />
            <Bloco
              rotulo="Sobra para a loja"
              valor={moeda(p?.lucroLiquido)}
              sub={p && p.lucroGerado > 0 ? `${numero(100 - pctComissao, 0)}% do lucro dos anúncios` : 'lucro dos anúncios menos o pagamento extra'}
              tom="verde"
              icone={<Store className="h-3.5 w-3.5" />}
            />
            <Bloco
              rotulo="Anúncios na vitrine"
              valor={inteiro(p?.qtdAnunciosAtivos)}
              sub="publicados e ligados agora"
              tom="neutro"
              icone={<Megaphone className="h-3.5 w-3.5" />}
              onClick={() => nav('/anuncios')}
            />
          </div>

          {/* divisão do lucro: quanto vira pagamento da equipe e quanto fica */}
          {!!p && p.lucroGerado > 0 && (
            <div>
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(100, pctComissao)}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} className="bg-amber-400" title={`Pagamento extra ${numero(pctComissao, 0)}%`} />
                <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(0, 100 - pctComissao)}%` }} transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }} className="bg-emerald-500" title="Sobra para a loja" />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" />Equipe <span className="num font-semibold">{moeda(p.comissaoTotal)}</span><span className="num text-slate-400">{numero(pctComissao, 0)}%</span></span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Loja <span className="num font-semibold">{moeda(p.lucroLiquido)}</span><span className="num text-slate-400">{numero(100 - pctComissao, 0)}%</span></span>
              </div>
            </div>
          )}

          {semMovimento ? (
            <EmptyState
              compacto
              icone={<Megaphone className="h-5 w-5" />}
              titulo="Nenhuma venda por anúncio no período"
              descricao={
                p && p.qtdAnunciosAtivos > 0
                  ? `A equipe tem ${inteiro(p.qtdAnunciosAtivos)} anúncio(s) na vitrine. O pagamento extra aparece aqui quando uma venda ou OS vem por um deles.`
                  : 'Ninguém publicou na vitrine ainda. Incentive a equipe: o anúncio só paga quando dá lucro de verdade.'
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* quem recebeu */}
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Users className="h-3.5 w-3.5" /> Por pessoa
                </p>
                {p?.porDono.length ? (
                  <motion.ul variants={listaVariants} initial="oculto" animate="visivel">
                    {p.porDono.map((d, i) => (
                      <LinhaV18 key={`${d.tipo}-${d.nome}`} bloco>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar nome={d.nome} indice={i} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-sm font-medium text-slate-800">{d.nome}</span>
                                <Badge tom={d.tipo === 'TECNICO' ? 'vermelho' : 'azul'}>{d.tipo === 'TECNICO' ? 'Técnico 33%' : 'Vendedor 20%'}</Badge>
                              </span>
                              <span className="num shrink-0 text-sm font-semibold text-slate-900">{moeda(d.comissao)}</span>
                            </div>
                            <BarraAnimada pct={(d.lucroGerado / maiorDono) * 100} cor={d.tipo === 'TECNICO' ? COR_TECNICO : COR_VENDEDOR} className="mt-1.5 h-1.5" />
                            <p className="num mt-1 text-[11px] text-slate-400">
                              {inteiro(d.vendas)} venda(s) · lucro trazido <span className="text-emerald-600">{moeda(d.lucroGerado)}</span>
                            </p>
                          </div>
                        </div>
                      </LinhaV18>
                    ))}
                  </motion.ul>
                ) : (
                  <EmptyState compacto icone={<HardHat className="h-5 w-5" />} titulo="Sem pagamento no período" />
                )}
              </div>

              {/* o que mais rendeu */}
              <div className="min-w-0">
                <p className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Crown className="h-3.5 w-3.5" /> Anúncios que mais renderam
                </p>
                {p?.topAnuncios.length ? (
                  <motion.ul variants={listaVariants} initial="oculto" animate="visivel">
                    {p.topAnuncios.map((a, i) => (
                      <LinhaV18 key={a.codigo} bloco>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-sm font-medium text-slate-800" title={a.titulo}>
                            <span className="num mr-1.5 text-xs text-slate-400">{i + 1}º</span>
                            {a.titulo}
                          </span>
                          <span className={clsx('num shrink-0 text-sm font-semibold', a.lucroGerado < 0 ? 'text-red-600' : 'text-emerald-600')}>{moeda(a.lucroGerado)}</span>
                        </div>
                        <BarraAnimada pct={(a.lucroGerado / maiorAnuncio) * 100} cor="#16a34a" className="mt-1.5 h-1.5" />
                        <p className="num mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
                          <span>{a.dono ?? 'sem dono'}</span>
                          <span>· {inteiro(a.vendas)} venda(s)</span>
                          <span className="inline-flex items-center gap-1">· <Eye className="h-3 w-3" />{inteiro(a.visitas)}</span>
                          <span>· pagou {moeda(a.comissao)}</span>
                        </p>
                      </LinhaV18>
                    ))}
                  </motion.ul>
                ) : (
                  <EmptyState compacto icone={<Megaphone className="h-5 w-5" />} titulo="Nenhum anúncio rendeu no período" />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </CardV18>
  );
}

const TONS_BLOCO = {
  neutro: { fundo: 'from-slate-100/70', barra: '#64748b', chip: 'bg-slate-100 text-slate-600' },
  azul: { fundo: 'from-blue-50', barra: '#2563eb', chip: 'bg-blue-50 text-blue-600' },
  verde: { fundo: 'from-emerald-50', barra: '#16a34a', chip: 'bg-emerald-50 text-emerald-600' },
  amarelo: { fundo: 'from-amber-50', barra: '#f59e0b', chip: 'bg-amber-50 text-amber-600' },
} as const;

/** Bloco de número no estilo Power BI (faixa de cor na lateral), do tamanho que cabe dentro do card. */
function Bloco({
  rotulo,
  valor,
  sub,
  tom,
  icone,
  onClick,
}: {
  rotulo: string;
  valor: string;
  sub?: string;
  tom: keyof typeof TONS_BLOCO;
  icone?: React.ReactNode;
  onClick?: () => void;
}) {
  const t = TONS_BLOCO[tom];
  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={onClick}
      className={clsx('relative min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-gradient-to-br to-white to-60% p-2.5 pl-3.5', t.fundo, onClick && 'cursor-pointer')}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: t.barra }} />
      <div className="flex items-start justify-between gap-1.5">
        <p className="min-w-0 text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500" title={rotulo}>{rotulo}</p>
        {icone && <span className={clsx('hidden h-6 w-6 shrink-0 items-center justify-center rounded-lg min-[420px]:flex', t.chip)}>{icone}</span>}
      </div>
      <p className="num mt-1 break-words text-base font-bold leading-tight text-slate-900 sm:text-lg">{valor}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-slate-400" title={sub}>{sub}</p>}
    </motion.div>
  );
}
