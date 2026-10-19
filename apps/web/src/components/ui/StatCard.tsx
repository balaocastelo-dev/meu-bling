import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Skeleton } from './Skeleton';
import { numero } from '@/lib/format';

interface StatCardProps {
  rotulo: ReactNode;
  valor: ReactNode;
  sub?: ReactNode;
  icone?: ReactNode;
  tom?: 'neutro' | 'verde' | 'vermelho' | 'amarelo' | 'azul';
  carregando?: boolean;
  onClick?: () => void;
  className?: string;
}

const tons = {
  neutro: 'text-slate-500 bg-slate-100',
  verde: 'text-emerald-600 bg-emerald-50',
  vermelho: 'text-red-600 bg-red-50',
  amarelo: 'text-amber-600 bg-amber-50',
  azul: 'text-blue-600 bg-blue-50',
};

/** Cartão de estatística simples (KPI sem comparativo) */
export function StatCard({ rotulo, valor, sub, icone, tom = 'neutro', carregando, onClick, className }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-card',
        onClick && 'cursor-pointer transition hover:border-slate-300 hover:shadow',
        className,
      )}
    >
      {icone && <div className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', tons[tom])}>{icone}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-500" title={typeof rotulo === 'string' ? rotulo : undefined}>{rotulo}</p>
        {carregando ? <Skeleton className="mt-1.5 h-6 w-24" /> : <p className="mt-0.5 text-lg font-semibold leading-tight tracking-tight text-slate-900 num xl:text-xl" title={typeof valor === 'string' ? valor : undefined}>{valor}</p>}
        {sub && <p className="mt-0.5 truncate text-xs text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

interface KpiCardProps {
  rotulo: ReactNode;
  valor: ReactNode;
  /** valor do período anterior para calcular a variação */
  anterior?: number | null;
  atual?: number | null;
  /** quando a queda é boa (ex.: despesas) */
  inverter?: boolean;
  sub?: ReactNode;
  carregando?: boolean;
  className?: string;
}

/** KPI com comparativo (seta ↑↓ e % de variação) */
export function KpiCard({ rotulo, valor, anterior, atual, inverter, sub, carregando, className }: KpiCardProps) {
  let variacao: number | null = null;
  if (typeof anterior === 'number' && typeof atual === 'number' && anterior !== 0) {
    variacao = ((atual - anterior) / Math.abs(anterior)) * 100;
  } else if (typeof anterior === 'number' && anterior === 0 && typeof atual === 'number' && atual > 0) {
    variacao = 100;
  }
  const positiva = variacao !== null && (inverter ? variacao < 0 : variacao > 0);
  const neutra = variacao === null || Math.abs(variacao) < 0.05;

  return (
    <div className={clsx('rounded-lg border border-slate-200 bg-white p-4 shadow-card', className)}>
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      {carregando ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-slate-900 num">{valor}</span>
          {variacao !== null && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium num',
                neutra ? 'bg-slate-100 text-slate-500' : positiva ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
              )}
            >
              {neutra ? <Minus className="h-3 w-3" /> : variacao > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {numero(Math.abs(variacao), 1)}%
            </span>
          )}
        </div>
      )}
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
