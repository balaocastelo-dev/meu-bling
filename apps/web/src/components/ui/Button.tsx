import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo' | 'sucesso' | 'link';
export type Tamanho = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamanho?: Tamanho;
  carregando?: boolean;
  icone?: ReactNode;
  iconeDireita?: ReactNode;
}

const variantes: Record<Variante, string> = {
  primario: 'bg-brand-600 text-white hover:bg-brand-700 shadow-xs focus-visible:ring-brand-500/40',
  secundario: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs focus-visible:ring-slate-400/40',
  fantasma: 'bg-transparent text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400/40',
  perigo: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 focus-visible:ring-red-500/30',
  sucesso: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs focus-visible:ring-emerald-500/40',
  link: 'bg-transparent text-brand-600 hover:underline px-0',
};

const tamanhos: Record<Tamanho, string> = {
  xs: 'h-7 px-2 text-xs gap-1',
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
};

/** Botão padrão do sistema */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'secundario', tamanho = 'md', carregando, icone, iconeDireita, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || carregando}
      className={clsx(
        'inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none',
        'focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none',
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      {...rest}
    >
      {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : icone}
      {children}
      {iconeDireita}
    </button>
  );
});
