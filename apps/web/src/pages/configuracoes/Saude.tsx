import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, Bot, CheckCircle2, Info, RefreshCw, Sparkles, Stethoscope } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { dataHora, inteiro } from '@/lib/format';
import { AnelSaude, CHAVE_ROBO, ListaAvisosRobo, ListaCorrecoes, useResolverTudo, useRodarRobo, useRoboSaude, type PainelRobo } from '@/components/compartilhados/RoboSaude';

type Nivel = 'erro' | 'aviso' | 'info';
interface Achado {
  id: string;
  nivel: Nivel;
  area: string;
  titulo: string;
  qtd: number;
  explicacao: string;
  comoResolver: string;
  link?: string;
  exemplos: { rotulo: string; link?: string }[];
}
interface Diagnostico {
  geradoEm: string;
  achados: Achado[];
  verificacoes: number;
  resumo: Record<Nivel, number>;
}

const ESTILO: Record<Nivel, { icone: typeof Info; cor: string; fundo: string; rotulo: string }> = {
  erro: { icone: AlertOctagon, cor: 'text-red-600', fundo: 'border-red-200 bg-red-50/40', rotulo: 'Corrigir' },
  aviso: { icone: AlertTriangle, cor: 'text-amber-600', fundo: 'border-amber-200 bg-amber-50/40', rotulo: 'Atenção' },
  info: { icone: Info, cor: 'text-blue-600', fundo: 'border-slate-200', rotulo: 'Para saber' },
};

/** Saúde do sistema: confere os dados reais e mostra o que está incoerente, com link para resolver (ADMIN) */
export default function Saude() {
  const { data: d, isFetching, refetch, isLoading } = useQuery({ queryKey: ['diagnostico'], queryFn: () => api.get<Diagnostico>('/diagnostico'), staleTime: 0 });
  const rodar = useRodarRobo();

  return (
    <div>
      <PageHeader
        titulo="Saúde do sistema"
        descricao={d ? `${d.verificacoes} verificações · ${dataHora(d.geradoEm)}` : 'Conferência automática dos dados'}
        acoes={<Button variante="secundario" icone={<RefreshCw className={clsx('h-4 w-4', (isFetching || rodar.isPending) && 'animate-spin')} />} onClick={() => rodar.mutate(undefined, { onSettled: () => void refetch() })} carregando={isFetching || rodar.isPending}>Verificar agora</Button>}
      />

      <PainelDoRobo />

      <h2 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Stethoscope className="h-4 w-4 text-slate-400" /> Conferência detalhada</h2>

      {isLoading || !d ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-3">
            {(['erro', 'aviso', 'info'] as Nivel[]).map((n) => {
              const E = ESTILO[n];
              return (
                <div key={n} className="flex items-center gap-3 v18-card rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
                  <E.icone className={clsx('h-6 w-6', E.cor)} />
                  <div>
                    <p className="text-2xl font-bold text-slate-900 num">{d.resumo[n]}</p>
                    <p className="text-xs text-slate-500">{E.rotulo}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {!d.achados.length ? (
            <Card>
              <EmptyState icone={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} titulo="Tudo certo" descricao="Nenhuma inconsistência encontrada nos dados." />
            </Card>
          ) : (
            <div className="space-y-3">
              {d.achados.map((a) => {
                const E = ESTILO[a.nivel];
                return (
                  <div key={a.id} className={clsx('v18-card rounded-2xl border bg-white p-4 shadow-card', E.fundo)}>
                    <div className="flex items-start gap-3">
                      <E.icone className={clsx('mt-0.5 h-5 w-5 shrink-0', E.cor)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {a.titulo} <span className="ml-1 rounded-full bg-slate-900/5 px-2 py-0.5 text-xs font-semibold text-slate-700 num">{inteiro(a.qtd)}</span>
                          </h3>
                          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{a.area}</span>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{a.explicacao}</p>
                        <p className="mt-1 text-sm text-slate-800"><span className="font-medium">Como resolver:</span> {a.comoResolver}</p>
                        {a.exemplos.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-sm">
                            {a.exemplos.map((ex, i) => (
                              <li key={i} className="break-words">
                                {ex.link ? <Link to={ex.link} className="text-brand-600 hover:underline">{ex.rotulo}</Link> : ex.rotulo}
                              </li>
                            ))}
                            {a.qtd > a.exemplos.length && <li className="text-xs text-slate-400">… e mais {inteiro(a.qtd - a.exemplos.length)}</li>}
                          </ul>
                        )}
                        {a.link && (
                          <Link to={a.link} className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline">Abrir →</Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Bot className="h-3.5 w-3.5" /> O Robô da Saúde confere sozinho a cada 5 minutos e logo depois de cada venda, pagamento ou NF, e avisa no sino e no dashboard.</p>
        </>
      )}
    </div>
  );
}

/** Robô da Saúde: liga/desliga, o que precisa de um clique e o que ele já corrigiu */
function PainelDoRobo() {
  const { data: p, isLoading } = useRoboSaude();
  const tudo = useResolverTudo();
  const qc = useQueryClient();
  const salvar = async (cfg: Partial<PainelRobo['config']>) => {
    try {
      await api.put('/robo-saude/config', cfg);
      void qc.invalidateQueries({ queryKey: CHAVE_ROBO });
      toast.success('Robô atualizado');
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };
  if (isLoading || !p) return <Skeleton className="h-40" />;
  const pct = p.estado?.saudePct ?? 100;
  const sugestoes = p.abertas.filter((a) => a.tipo === 'SUGESTAO');
  const alertas = p.abertas.filter((a) => a.tipo !== 'SUGESTAO');
  return (
    <div className="space-y-3">
      <div className="v18-card flex flex-wrap items-center gap-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
        <AnelSaude pct={pct} tamanho={76} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-base font-semibold text-slate-900"><Bot className="h-5 w-5 text-brand-600" /> Robô da Saúde</p>
          <p className="text-sm text-slate-500">
            {p.abertas.length ? `${p.abertas.length} pendência${p.abertas.length > 1 ? 's' : ''} (${sugestoes.length} com botão de 1 clique)` : 'Sistema 100%: nada pendente'}
            {p.corrigidasHoje > 0 && ` · corrigi ${p.corrigidasHoje} sozinho hoje`}
          </p>
          <p className="text-xs text-slate-400">{p.estado?.ultimaVez ? `Última conferência ${dataHora(p.estado.ultimaVez)}` : 'Ainda não rodou'}{p.estado?.erro ? ` · erro: ${p.estado.erro}` : ''}</p>
        </div>
        <div className="flex flex-col gap-1.5 text-sm">
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={p.config.ligado} onChange={(e) => salvar({ ligado: e.target.checked })} /> Robô ligado (24h)</label>
          <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={p.config.autoCorrigir} onChange={(e) => salvar({ autoCorrigir: e.target.checked })} /> Corrigir sozinho o que é seguro</label>
        </div>
        {p.sugestoesEmLote > 0 && (
          <Button variante="sucesso" icone={<Sparkles className="h-4 w-4" />} carregando={tudo.isPending} onClick={() => tudo.mutate()}>
            Resolver {p.sugestoesEmLote} de uma vez
          </Button>
        )}
      </div>

      {p.abertas.length > 0 && (
        <Card titulo="Precisa de você" descricao="Clique no botão e o robô faz. O que some daqui foi resolvido." semPadding>
          <ListaAvisosRobo avisos={[...sugestoes, ...alertas]} />
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card titulo="O que eu corrigi sozinho" descricao="Últimas correções automáticas" semPadding>
          <ListaCorrecoes itens={p.correcoes} limite={12} />
        </Card>
        <Card titulo="Resolvido com um clique" descricao="Botões apertados por você" semPadding>
          {p.resolvidasPorClique.length ? (
            <ul className="divide-y divide-slate-100">
              {p.resolvidasPorClique.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-slate-700">{r.mensagem}</p>
                    <p className="text-[11px] text-slate-400">{r.resolvidoEm ? dataHora(r.resolvidoEm) : ''} · {r.resolvidoPor}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate-500">Nenhum ainda.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
