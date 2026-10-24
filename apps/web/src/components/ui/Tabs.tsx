import type { ReactNode } from 'react';
import clsx from 'clsx';

export interface Aba {
  id: string;
  rotulo: ReactNode;
  contador?: number | string;
  icone?: ReactNode;
}

/** Abas horizontais (estilo sublinhado) */
export function Tabs({ abas, ativa, onMudar, className }: { abas: Aba[]; ativa: string; onMudar: (id: string) => void; className?: string }) {
  return (
    <div className={clsx('flex gap-1 overflow-x-auto border-b border-slate-200', className)} role="tablist">
      {abas.map((a) => {
        const sel = a.id === ativa;
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={sel}
            onClick={() => onMudar(a.id)}
            className={clsx(
              '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              sel ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
            )}
          >
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
  return (
    <div className={clsx('inline-flex max-w-full flex-wrap rounded-md border border-slate-200 bg-slate-50 p-0.5', className)}>
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onMudar(o.valor)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded px-2.5 font-medium transition-colors whitespace-nowrap',
            tamanho === 'xs' ? 'h-6 text-xs' : 'h-7 text-xs',
            o.valor === valor ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {o.icone}
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
