import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';

export interface Aba {
  id: string;
  rotulo: ReactNode;
  contador?: number | string;
  icone?: ReactNode;
}

/** Abas horizontais (estilo sublinhado) */
export function Tabs({ abas, ativa, onMudar, className }: { abas: Aba[]; ativa: string; onMudar: (id: string) => void; className?: string }) {
  const grupo = useId();
  const ref = useRef<HTMLDivElement>(null);
  // quando há mais abas do que cabem (celular), a borda do lado que continua some num degradê — sinal de que dá para rolar
  const [sobra, setSobra] = useState({ esq: false, dir: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setSobra({ esq: el.scrollLeft > 2, dir: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    // a aba escolhida fica sempre à vista
    // (rola só a faixa de abas, nunca a página)
    const sel = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (sel && (sel.offsetLeft < el.scrollLeft || sel.offsetLeft + sel.offsetWidth > el.scrollLeft + el.clientWidth)) el.scrollLeft = sel.offsetLeft - 16;
    return () => {
      el.removeEventListener('scroll', medir);
      ro?.disconnect();
    };
  }, [abas.length, ativa]);
  const mascara = sobra.esq && sobra.dir ? 'linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent)' : sobra.dir ? 'linear-gradient(to right, #000 calc(100% - 28px), transparent)' : sobra.esq ? 'linear-gradient(to right, transparent, #000 24px)' : undefined;
  return (
    <div
      ref={ref}
      style={mascara ? { maskImage: mascara, WebkitMaskImage: mascara } : undefined}
      className={clsx('relative flex gap-1 overflow-x-auto overscroll-x-contain border-b border-slate-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
      role="tablist"
    >
      {abas.map((a) => {
        const sel = a.id === ativa;
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={sel}
            onClick={() => onMudar(a.id)}
            className={clsx(
              'relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm font-medium transition-colors',
              sel ? 'text-brand-700' : 'text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
            {/* sublinhado que desliza até a aba escolhida (efeito V18) */}
            {sel && <motion.span layoutId={`aba-${grupo}`} className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-brand-600" transition={{ type: 'spring', stiffness: 450, damping: 36 }} />}
            {a.icone}
            {a.rotulo}
            {a.contador !== undefined && (
              <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', sel ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{a.contador}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Grupo de botões segmentados (toggle) */
export function Segmentado<T extends string>({ opcoes, valor, onMudar, className, tamanho = 'sm' }: { opcoes: { valor: T; rotulo: ReactNode; icone?: ReactNode }[]; valor: T; onMudar: (v: T) => void; className?: string; tamanho?: 'xs' | 'sm' }) {
  const grupo = useId();
  return (
    <div className={clsx('inline-flex max-w-full flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5', className)}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onMudar(o.valor)}
          className={clsx(
            'relative inline-flex items-center gap-1.5 rounded px-2.5 font-medium transition-colors whitespace-nowrap',
            tamanho === 'xs' ? 'h-6 text-xs pointer-coarse:h-9' : 'h-7 text-xs pointer-coarse:h-9',
            o.valor === valor ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {/* "pílula" branca que desliza até a opção escolhida (efeito V18) */}
          {o.valor === valor && <motion.span layoutId={`seg-${grupo}`} className="absolute inset-0 rounded bg-white shadow-xs" transition={{ type: 'spring', stiffness: 450, damping: 36 }} />}
          <span className="relative inline-flex items-center gap-1.5">
            {o.icone}
            {o.rotulo}
          </span>
        </button>
      ))}
    </div>
  );
}
