/**
 * O medidor do milhão — o elemento central do painel do JARVIS.
 *
 * Não é enfeite: o arco é quanto do R$ 1.000.000 já está livre em caixa, o número
 * no meio é esse valor, e embaixo o que falta e o ritmo necessário por dia útil.
 * Tudo vem de /jarvis/painel; nada aqui é inventado.
 */
import { motion, useReducedMotion } from 'framer-motion';
import clsx from 'clsx';
import { Contador } from '@/components/dashboard/v18';

export function MedidorMeta({
  valor,
  meta,
  percentual,
  falta,
  porDiaUtil,
  diasUteis,
  moeda,
  carregando,
}: {
  valor?: number;
  meta?: number;
  percentual?: number;
  falta?: number;
  porDiaUtil?: number;
  diasUteis?: number;
  moeda: (n: number) => string;
  carregando?: boolean;
}) {
  const semMovimento = useReducedMotion();
  const pct = Math.max(0, Math.min(100, percentual ?? 0));
  const R = 92;
  const C = 2 * Math.PI * R;
  const arco = C * 0.75; // 270°: a abertura de baixo é onde fica o texto de apoio
  const preenchido = (arco * pct) / 100;
  const positivo = (valor ?? 0) >= 0;

  return (
    <div className="relative grid place-items-center py-2">
      <svg viewBox="0 0 220 220" className="h-[190px] w-[190px] sm:h-[220px] sm:w-[220px]" role="img" aria-label={`Caixa livre ${moeda(valor ?? 0)} de ${moeda(meta ?? 0)}`}>
        <g transform="rotate(135 110 110)">
          <circle cx="110" cy="110" r={R} fill="none" stroke="#e2e8f0" strokeWidth="14" strokeDasharray={`${arco} ${C}`} strokeLinecap="round" />
          <motion.circle
            cx="110"
            cy="110"
            r={R}
            fill="none"
            stroke={positivo ? '#10b981' : '#f43f5e'}
            strokeWidth="14"
            strokeLinecap="round"
            initial={semMovimento ? false : { strokeDasharray: `0 ${C}` }}
            animate={{ strokeDasharray: `${preenchido} ${C}` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0 grid place-items-center px-8 text-center">
        <div>
          <p className="text-xs font-medium text-slate-500">Caixa livre</p>
          {carregando ? (
            <div className="mx-auto mt-1.5 h-8 w-36 animate-pulse rounded bg-slate-100" />
          ) : (
            <p className={clsx('text-2xl font-bold tabular-nums sm:text-3xl', positivo ? 'text-emerald-600' : 'text-rose-600')}>
              {typeof valor === 'number' ? <Contador valor={valor} formato={moeda} /> : '—'}
            </p>
          )}
          <p className="mt-0.5 text-xs text-slate-500">
            {typeof percentual === 'number' ? `${percentual.toFixed(1)}%` : '—'} de {moeda(meta ?? 0)}
          </p>
        </div>
      </div>

      {typeof falta === 'number' && falta > 0 && (
        <p className="-mt-3 text-center text-xs text-slate-500">
          faltam <strong className="tabular-nums text-slate-800">{moeda(falta)}</strong>
          {typeof porDiaUtil === 'number' && diasUteis ? (
            <>
              {' · '}
              <strong className="tabular-nums text-amber-700">{moeda(porDiaUtil)}</strong> por dia útil em {diasUteis}
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** Barra de ranking (vendedor, técnico): nome, barra proporcional e valor. */
export function BarraRanking({
  nome,
  valor,
  maximo,
  sub,
  moeda,
  cor = '#2563eb',
}: {
  nome: string;
  valor: number;
  maximo: number;
  sub?: string;
  moeda: (n: number) => string;
  cor?: string;
}) {
  const pct = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-slate-700">{nome}</span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{moeda(valor)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <motion.div
          className="h-full rounded-full"
          style={{ background: cor }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </div>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
