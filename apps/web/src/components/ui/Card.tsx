import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  titulo?: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  semPadding?: boolean;
  rodape?: ReactNode;
}

/** Cartão branco padrão com borda e sombra sutil */
export function Card({ titulo, descricao, acoes, semPadding, rodape, className, children, ...rest }: CardProps) {
  return (
    <div className={clsx('rounded-lg border border-slate-200 bg-white shadow-card', className)} {...rest}>
      {(titulo || acoes) && (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            {titulo && <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>}
            {descricao && <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>}
          </div>
          {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
        </div>
      )}
      <div className={clsx(!semPadding && 'p-4')}>{children}</div>
      {rodape && <div className="border-t border-slate-100 px-4 py-3">{rodape}</div>}
    </div>
  );
}

/** Seção de formulário com título (dentro de um Card ou página) */
export function Secao({ titulo, descricao, children, className, acoes }: { titulo: ReactNode; descricao?: ReactNode; children: ReactNode; className?: string; acoes?: ReactNode }) {
  return (
    <section className={clsx('rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
          {descricao && <p className="text-xs text-slate-500">{descricao}</p>}
        </div>
        {acoes}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Lista de pares rótulo/valor (ficha) */
export function Definicoes({ itens, colunas = 2, className }: { itens: { rotulo: ReactNode; valor: ReactNode; largo?: boolean }[]; colunas?: 1 | 2 | 3 | 4; className?: string }) {
  const grid = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[colunas];
  return (
    <dl className={clsx('grid grid-cols-1 gap-x-6 gap-y-3', grid, className)}>
      {itens.map((it, i) => (
        <div key={i} className={clsx('min-w-0', it.largo && 'sm:col-span-full')}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{it.rotulo}</dt>
          <dd className="mt-0.5 text-sm text-slate-800 break-words">{it.valor ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
