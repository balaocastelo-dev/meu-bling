import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { animate, useInView } from 'framer-motion';
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

/** faixa de cor bem suave no topo do card (efeito V18) */
const faixas = {
  neutro: 'from-slate-100/70',
  verde: 'from-emerald-50',
  vermelho: 'from-red-50',
  amarelo: 'from-amber-50',
  azul: 'from-blue-50',
};

/**
 * Faz o número de um texto já formatado "contar" até o valor (R$ 1.234,56 · 15 · 43% · 1,5 mil…).
 * Mantém prefixo/sufixo e o mesmo número de casas decimais; se não reconhecer, mostra o texto como veio.
 */
export function ValorAnimado({ valor }: { valor: ReactNode }) {
  const texto = typeof valor === 'string' || typeof valor === 'number' ? String(valor) : null;
  const bruto = texto?.match(/^([^\d-]*)(-?[\d.]+(?:,\d+)?)(.*)$/);
  // sufixo com outro número (data, faixa "1/3", hora) → não anima
  const m = bruto && !/\d/.test(bruto[3]) ? bruto : null;
  const ref = useRef<HTMLSpanElement>(null);
  const visto = useInView(ref, { once: true });
  const alvo = m ? Number(m[2].replace(/\./g, '').replace(',', '.')) : NaN;
  const casas = m && m[2].includes(',') ? m[2].split(',')[1].length : 0;
  const [atual, setAtual] = useState<number | null>(null);
  const ultimo = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(alvo)) return;
    // sem animação (pedido do sistema, impressão, print): valor final na hora, mesmo fora da tela
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setAtual(alvo);
    if (!visto) return;
    const c = animate(ultimo.current, alvo, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: setAtual });
    ultimo.current = alvo;
    return () => c.stop();
  }, [alvo, visto]);
  if (!m || !Number.isFinite(alvo)) return <>{valor}</>;
  const n = atual ?? 0;
  const fmt = n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return (
    <span ref={ref} title={texto ?? undefined}>
      {m[1]}
      {fmt}
      {m[3]}
    </span>
  );
}

const tons = {
  neutro: 'text-slate-500 bg-slate-100',
  verde: 'text-emerald-600 bg-emerald-50',
  vermelho: 'text-red-600 bg-red-50',
  amarelo: 'text-amber-600 bg-amber-50',
  azul: 'text-blue-600 bg-blue-50',
};

const barras = { neutro: '#64748b', verde: '#16a34a', vermelho: '#dc2626', amarelo: '#f59e0b', azul: '#2563eb' };

/** Cartão de estatística simples (KPI sem comparativo) — mesmo desenho do cartão dos dashboards (faixa de cor no topo, altura igual na linha) */
export function StatCard({ rotulo, valor, sub, icone, tom = 'neutro', carregando, onClick, className }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        'v18-card @container relative flex h-full min-w-0 items-start gap-2 overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b to-white to-60% p-3 shadow-card sm:gap-3 sm:p-4',
        faixas[tom],
        onClick && 'v18-hover cursor-pointer active:scale-[0.98]',
        className,
      )}
    >
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: barras[tom], opacity: 0.85 }} />
      {icone && <div className={clsx('hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl @[13rem]:flex', tons[tom])}>{icone}</div>}
      <div className="flex min-w-0 flex-1 flex-col self-stretch">
        <p className="line-clamp-2 text-xs font-medium leading-4 text-slate-500" title={typeof rotulo === 'string' ? rotulo : undefined}>{rotulo}</p>
        {carregando ? (
          <Skeleton className="mt-1.5 h-6 w-24" />
        ) : (
          <p className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold leading-tight tracking-tight text-slate-900 num @[10rem]:text-lg @[15rem]:text-xl" title={typeof valor === 'string' ? valor : undefined}>
            <ValorAnimado valor={valor} />
          </p>
        )}
        {sub && <p className="mt-auto line-clamp-2 pt-0.5 text-xs leading-4 text-slate-400">{sub}</p>}
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
    <div className={clsx('v18-card v18-hover @container relative h-full min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card sm:p-4', className)}>
      <p className="line-clamp-2 text-xs font-medium leading-4 text-slate-500">{rotulo}</p>
      {carregando ? (
        <Skeleton className="mt-2 h-7 w-28" />
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold tracking-tight text-slate-900 num @[12rem]:text-xl @[16rem]:text-2xl"><ValorAnimado valor={valor} /></span>
          {variacao !== null && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold num',
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
