import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, RefreshCw, Stethoscope } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui';
import { dataHora, inteiro } from '@/lib/format';

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

  return (
    <div>
      <PageHeader
        titulo="Saúde do sistema"
        descricao={d ? `${d.verificacoes} verificações · ${dataHora(d.geradoEm)}` : 'Conferência automática dos dados'}
        acoes={<Button variante="secundario" icone={<RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} />} onClick={() => refetch()} carregando={isFetching}>Verificar agora</Button>}
      />

      {isLoading || !d ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            {(['erro', 'aviso', 'info'] as Nivel[]).map((n) => {
              const E = ESTILO[n];
              return (
                <div key={n} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-card">
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
                  <div key={a.id} className={clsx('rounded-lg border bg-white p-4 shadow-card', E.fundo)}>
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
                              <li key={i} className="truncate">
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
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Stethoscope className="h-3.5 w-3.5" /> A verificação também roda sozinha a cada 6 horas e avisa no dashboard.</p>
        </>
      )}
    </div>
  );
}
