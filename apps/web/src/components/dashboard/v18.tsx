/**
 * Peças visuais dos dashboards no estilo "Dashboard V18" com a organização de um painel Power BI:
 * cabeçalho + barra de filtros (segmentações) no topo, cartões de KPI do mesmo tamanho com faixa de cor,
 * visuais em grade que se alinham pela altura, título do visual no canto superior esquerdo.
 * Cards bem arredondados que sobem no hover, números que contam até o valor, barras que crescem e entrada em cascata.
 * Usa as MESMAS cores do sistema (vermelho da marca + slate + tons de status) — só muda forma e movimento.
 * Quem pede "reduzir movimento" no sistema operacional vê tudo sem animação (MotionConfig reducedMotion="user").
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, MotionConfig, useInView, type Variants } from 'framer-motion';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, Minus, SlidersHorizontal } from 'lucide-react';
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

/**
 * Cabeçalho do painel (estilo Power BI): título e descrição à esquerda, ações à direita
 * e, embaixo, a barra de filtros num painel branco — os "filtros de segmentação" do relatório.
 */
export function CabecalhoV18({ titulo, descricao, acoes, filtros, sobre }: { titulo: ReactNode; descricao?: ReactNode; acoes?: ReactNode; filtros?: ReactNode; /** linha pequena acima do título (data, saudação) */ sobre?: ReactNode }) {
  return (
    <Aparecer className="space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {sobre && <p className="text-xs font-medium text-slate-400">{sobre}</p>}
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{titulo}</h1>
          {descricao && <div className="mt-0.5 text-sm text-slate-500">{descricao}</div>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2 md:justify-end">{acoes}</div>}
      </div>
      {filtros && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/80 px-2.5 py-2 shadow-card backdrop-blur">
          <span className="hidden items-center gap-1.5 pl-1 pr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 lg:inline-flex">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
          </span>
          {filtros}
        </div>
      )}
    </Aparecer>
  );
}

/** Divisória de seção do painel ("Agora na loja", "Vendas no período"…) */
export function SecaoV18({ titulo, nota }: { titulo: ReactNode; nota?: ReactNode }) {
  return (
    <Aparecer className="flex items-center gap-3 pt-1">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</span>
      <span className="h-px min-w-6 flex-1 bg-slate-200" />
      {nota && <span className="shrink-0 text-[11px] text-slate-400">{nota}</span>}
    </Aparecer>
  );
}

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
      className={clsx('flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card', onClick && 'cursor-pointer', className)}
    >
      {(titulo || acoes) && (
        <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-2.5">
            {icone && <span className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', TONS[tom].chip)}>{icone}</span>}
            <div className="min-w-0 pt-px">
              {titulo && <h3 className="truncate text-sm font-semibold leading-5 text-slate-900">{titulo}</h3>}
              {descricao && <p className="line-clamp-2 text-xs leading-4 text-slate-500">{descricao}</p>}
            </div>
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2 pt-1">{acoes}</div>}
        </div>
      )}
      <div className={clsx('min-h-0 flex-1', !semPadding && 'px-4 pb-4 pt-3 sm:px-5')}>{children}</div>
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
    const reduz = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // sem animação (pedido do sistema operacional, impressão, print da tela): mostra o valor na hora, mesmo fora da tela
    if (!visto && !reduz) return;
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

/** KPI do V18: chip do ícone, número grande que conta, variação e faixa de cor suave no topo */
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
}) {
  return (
    <motion.div
      variants={item}
      whileHover={hoverSobe}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      onClick={onClick}
      className={clsx(
        '@container relative flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b to-white to-60% p-3 shadow-card sm:p-4',
        TONS[tom].faixa,
        onClick && 'cursor-pointer',
      )}
    >
      {/* faixa de cor no topo, como o realce dos cartões do Power BI */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: TONS[tom].barra, opacity: 0.85 }} />
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 min-h-8 min-w-0 text-xs font-medium leading-4 text-slate-500">{rotulo}</p>
        {icone && <span className={clsx('hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl @[10rem]:flex', TONS[tom].chip)}>{icone}</span>}
      </div>
      {carregando ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-base font-bold leading-tight tracking-tight text-slate-900 @[9rem]:text-lg @[12rem]:text-xl @[15rem]:text-2xl">
            <Contador valor={valor ?? 0} formato={formato} />
          </span>
          <Variacao atual={valor} anterior={anterior} inverter={inverter} />
        </div>
      )}
      {sub && <p className="mt-auto line-clamp-2 pt-1 text-xs leading-4 text-slate-400">{sub}</p>}
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
    // no celular fica numa linha só, rolando de lado (pílula torta em várias linhas, nunca)
    <div className="sem-barra inline-flex max-w-full shrink-0 flex-nowrap overflow-x-auto overscroll-x-contain rounded-full border border-slate-200 bg-white p-1 shadow-card">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onMudar(o.valor)}
          className={clsx('relative h-7 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors', o.valor === valor ? 'text-white' : 'text-slate-500 hover:text-slate-800')}
        >
          {o.valor === valor && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full bg-slate-900" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
          <span className="relative">{o.rotulo}</span>
        </button>
      ))}
    </div>
  );
}
