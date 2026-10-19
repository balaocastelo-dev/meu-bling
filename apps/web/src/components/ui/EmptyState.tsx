import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Inbox } from 'lucide-react';

export function EmptyState({ titulo, descricao, acao, icone, className, compacto }: { titulo: ReactNode; descricao?: ReactNode; acao?: ReactNode; icone?: ReactNode; className?: string; compacto?: boolean }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center', compacto ? 'py-6' : 'py-12', className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">{icone ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium text-slate-700">{titulo}</p>
      {descricao && <p className="mt-1 max-w-sm text-xs text-slate-500">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}
