/**
 * Peças visuais dos dashboards no estilo "Dashboard V18": cards bem arredondados que sobem no hover,
 * números que contam até o valor, barras que crescem e entrada em cascata.
 * Usa as MESMAS cores do sistema (vermelho da marca + slate + tons de status) — só muda forma e movimento.
 * Quem pede "reduzir movimento" no sistema operacional vê tudo sem animação (MotionConfig reducedMotion="user").
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, MotionConfig, useInView, type Variants } from 'framer-motion';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { numero } from '@/lib/format';
import { PALETA } from '@/components/compartilhados/graficos';

export type Tom = 'neutro' | 'verde' | 'vermelho' | 'amarelo' | 'azul';

/** chip do ícone + faixa clarinha do card (mesmos tons do StatCard) */
export const TONS: Record<Tom, { chip: string; faixa: string; barra: string }> = {
  neutro: { chip: 'text-slate-600 bg-slate-100', faixa: 'from-slate-100/80', barra: '#64748b' },
  verde: { chip: 'text-emerald-600 bg-emerald-50', faixa: 'from-emerald-50', barra: '#16a34a' },
  vermelho: { chip: 'text-brand-600 bg-brand-50', faixa: 'from-brand-50', barra: '#dc2626' },
  amarelo: { chip: 'text-amber-600 bg-amber-50', faixa: 'from-amber-50', barra: '#f59e0b' },
  azul: { chip: 'text-blue-600 bg-blue-50', faixa: 'from-blue-50', barra: '#2563eb' },
};

const lista: Variants = { oculto: {}, visivel: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } } };
const item: Variants = {
  oculto: { opacity: 0, y: 14 },
  visivel: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 26 } },
};

/** Página: os filhos <Aparecer> entram em cascata */
export function PaginaV18({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div data-motion className={className} variants={lista} initial="oculto" animate="visivel">
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/** Grupo que também anima os filhos em cascata (ex.: grade de KPIs) */
export function Grupo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={lista}>
      {children}
    </motion.div>
  );
}

export function Aparecer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={clsx('min-w-0', className)} variants={item}>
      {children}
    </motion.div>
  );
}

const hoverSobe = { y: -4, boxShadow: '0 14px 30px -12px rgba(15, 23, 42, 0.18)' };

/** Card arredondado do V18. `hover` faz subir ao passar o mouse (padrão: só se for clicável). */
export function CardV18({
  titulo,
  descricao,
  acoes,
  icone,
  tom = 'neutro',
  semPadding,
  hover,
  onClick,
  className,
  children,
}: {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  icone?: ReactNode;
  tom?: Tom;
  semPadding?: boolean;
  hover?: boolean;
  onClick?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const sobe = hover ?? !!onClick;
  return (
    <motion.div
      variants={item}
      whileHover={sobe ? hoverSobe : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={onClick}
      className={clsx('min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card', onClick && 'cursor-pointer', className)}
    >
      {(titulo || acoes) && (
        <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            {icone && <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', TONS[tom].chip)}>{icone}</span>}
            <div className="min-w-0">
              {titulo && <h3 className="truncate text-sm font-semibold text-slate-900">{titulo}</h3>}
              {descricao && <p className="truncate text-xs text-slate-500">{descricao}</p>}
            </div>
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
        </div>
      )}
      <div className={clsx(!semPadding && 'px-4 pb-4 pt-3 sm:px-5')}>{children}</div>
    </motion.div>
  );
}

/** Número que conta do valor anterior até o novo quando aparece na tela */
export function Contador({ valor, formato }: { valor: number; formato: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visto = useInView(ref, { once: true });
  const [atual, setAtual] = useState(0);
  const ultimo = useRef(0);
  useEffect(() => {
    if (!visto) return;
    const reduz = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduz) {
      setAtual(valor);
      ultimo.current = valor;
      return;
    }
    const ctrl = animate(ultimo.current, valor, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => setAtual(v) });
    ultimo.current = valor;
    return () => ctrl.stop();
  }, [valor, visto]);
  return (
    <span ref={ref} className="num" title={formato(valor)}>
      {formato(atual)}
    </span>
  );
}

/** Variação em relação ao período anterior (pílula verde/vermelha com seta) */
export function Variacao({ atual, anterior, inverter }: { atual?: number | null; anterior?: number | null; inverter?: boolean }) {
  let v: number | null = null;
  if (typeof anterior === 'number' && typeof atual === 'number') {
    if (anterior !== 0) v = ((atual - anterior) / Math.abs(anterior)) * 100;
    else if (atual > 0) v = 100;
  }
  if (v === null) return null;
  const neutra = Math.abs(v) < 0.05;
  const boa = inverter ? v < 0 : v > 0;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold num',
        neutra ? 'bg-slate-100 text-slate-500' : boa ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
      )}
    >
      {neutra ? <Minus className="h-3 w-3" /> : v > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {numero(Math.abs(v), 1)}%
    </span>
  );
}

/**
 * KPI no estilo Power BI: faixa de cor na lateral, rótulo em caixa alta, número grande que conta,
 * variação e linha de apoio. Serve no celular (2 por linha), no tablet (3) e no computador (até 6).
 * `destaque` deixa o cartão maior (saldo do banco, faturamento) — use com className="col-span-2" para ocupar a linha toda no celular.
 */
export function KpiV18({
  rotulo,
  valor,
  formato,
  anterior,
  inverter,
  sub,
  icone,
  tom = 'neutro',
  carregando,
  onClick,
  destaque,
  className,
}: {
  rotulo: ReactNode;
  valor?: number | null;
  formato: (n: number) => string;
  anterior?: number | null;
  inverter?: boolean;
  sub?: ReactNode;
  icone?: ReactNode;
  tom?: Tom;
  carregando?: boolean;
  onClick?: () => void;
  /** cartão grande (número principal da tela) */
  destaque?: boolean;
  className?: string;
}) {
  const negativo = typeof valor === 'number' && valor < 0;
  return (
    <motion.div
      variants={item}
      whileHover={hoverSobe}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={onClick}
      data-kpi
      className={clsx(
        'relative min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br to-white to-60% shadow-card',
        destaque ? 'p-4 sm:p-5' : 'p-3 sm:p-4',
        TONS[tom].faixa,
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {/* faixa lateral de cor (padrão Power BI) */}
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ backgroundColor: TONS[tom].barra }} />
      <div className="flex items-start justify-between gap-2 pl-1">
        <p className={clsx('min-w-0 truncate font-semibold uppercase tracking-wide text-slate-500', destaque ? 'text-[11px] sm:text-xs' : 'text-[10px] sm:text-[11px]')}>{rotulo}</p>
        {icone && <span className={clsx('flex shrink-0 items-center justify-center rounded-xl', destaque ? 'h-9 w-9' : 'hidden h-8 w-8 min-[420px]:flex', TONS[tom].chip)}>{icone}</span>}
      </div>
      {carregando ? (
        <Skeleton className={clsx('ml-1 mt-2', destaque ? 'h-9 w-40' : 'h-7 w-24')} />
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-1">
          <span
            className={clsx(
              'break-words font-bold leading-tight tracking-tight',
              negativo ? 'text-red-600' : 'text-slate-900',
              destaque ? 'text-[26px] sm:text-3xl xl:text-4xl' : 'text-lg sm:text-xl xl:text-2xl',
            )}
          >
            <Contador valor={valor ?? 0} formato={formato} />
          </span>
          <Variacao atual={valor} anterior={anterior} inverter={inverter} />
        </div>
      )}
      {sub && <p className={clsx('mt-1 truncate pl-1 text-slate-400', destaque ? 'text-xs sm:text-sm' : 'text-[11px] sm:text-xs')}>{sub}</p>}
    </motion.div>
  );
}

/**
 * Faixa de KPIs no topo de todo dashboard (padrão Power BI).
 * Celular: 2 por linha · tablet: 3 · computador: `colunas` (padrão 6).
 */
export function FaixaKpis({ children, colunas = 6, className }: { children: ReactNode; colunas?: 3 | 4 | 5 | 6; className?: string }) {
  const lg = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' }[colunas];
  const md = colunas === 4 ? 'md:grid-cols-4' : 'md:grid-cols-3';
  return (
    <motion.div className={clsx('grid grid-cols-2 gap-2.5 sm:gap-3', md, lg, className)} variants={lista}>
      {children}
    </motion.div>
  );
}

/** Separador "Detalhes" — o que é menos importante fica daqui para baixo */
export function SecaoDetalhes({ titulo = 'Detalhes', dica }: { titulo?: ReactNode; dica?: ReactNode }) {
  return (
    <motion.div variants={item} className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</span>
      <span className="h-px flex-1 bg-slate-200" />
      {dica && <span className="text-[11px] text-slate-400">{dica}</span>}
    </motion.div>
  );
}

/** Saldo de cada conta (bancos + caixa) — no celular rola de lado, no computador vira grade */
export function SaldosContas({
  contas,
  carregando,
  formato,
  onClick,
}: {
  contas?: { id: number; nome: string; saldoAtual: number; cor?: string | null }[];
  carregando?: boolean;
  formato: (n: number) => string;
  onClick?: (id: number) => void;
}) {
  if (carregando) return <Skeleton className="h-16 w-full rounded-2xl" />;
  if (!contas?.length) return null;
  return (
    <motion.div variants={item} className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex snap-x gap-2 sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {contas.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={onClick ? () => onClick(c.id) : undefined}
            className="relative min-w-[150px] shrink-0 snap-start overflow-hidden rounded-xl border border-slate-200/80 bg-white py-2 pl-3 pr-2 text-left shadow-card transition hover:-translate-y-0.5 sm:min-w-0"
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: c.cor || PALETA[i % PALETA.length] }} />
            <p className="truncate pl-1 text-[11px] font-medium text-slate-500">{c.nome}</p>
            <p className={clsx('num truncate pl-1 text-sm font-bold sm:text-base', c.saldoAtual < 0 ? 'text-red-600' : 'text-slate-900')}>{formato(c.saldoAtual)}</p>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

/** Barra de progresso que cresce até o valor */
export function BarraAnimada({ pct, cor, className }: { pct: number; cor: string; className?: string }) {
  return (
    <div className={clsx('h-2 overflow-hidden rounded-full bg-slate-100', className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: cor }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
      />
    </div>
  );
}

/** Bolinha com as iniciais (vendedores/clientes) */
export function Avatar({ nome, indice = 0, className }: { nome: string; indice?: number; className?: string }) {
  const ini = nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  const cor = PALETA[indice % PALETA.length];
  return (
    <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', className)} style={{ backgroundColor: `${cor}1a`, color: cor }}>
      {ini || '?'}
    </span>
  );
}

/** Linha clicável com leve deslize no hover (listas tipo "Collections") */
export function LinhaV18({ children, className, onClick, bloco }: { children: ReactNode; className?: string; onClick?: () => void; /** conteúdo empilhado (texto + barra) em vez de lado a lado */ bloco?: boolean }) {
  return (
    <motion.li
      variants={item}
      whileHover={onClick ? { x: 3 } : undefined}
      onClick={onClick}
      className={clsx('min-w-0 rounded-xl px-2 py-2', bloco ? 'block' : 'flex items-center gap-3', onClick && 'cursor-pointer hover:bg-slate-50', className)}
    >
      {children}
    </motion.li>
  );
}

export const listaVariants = lista;

/** Seletor segmentado com a "pílula" deslizando até a opção escolhida */
export function SegmentadoV18<T extends string>({ opcoes, valor, onMudar, id }: { opcoes: { valor: T; rotulo: ReactNode }[]; valor: T; onMudar: (v: T) => void; id: string }) {
  return (
    <div className="inline-flex max-w-full flex-nowrap overflow-x-auto rounded-full border border-slate-200 bg-white p-1 shadow-card [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onMudar(o.valor)}
          className={clsx('relative h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors sm:h-7', o.valor === valor ? 'text-white' : 'text-slate-500 hover:text-slate-800')}
        >
          {o.valor === valor && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-slate-900" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
          <span className="relative">{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}
