import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

interface PageHeaderProps {
  titulo: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  migalhas?: { rotulo: string; para?: string }[];
  className?: string;
  /** conteúdo extra abaixo do título (badges, etc.) */
  extra?: ReactNode;
}

/** Cabeçalho de página com migalhas, título e ações */
export function PageHeader({ titulo, descricao, acoes, migalhas, className, extra }: PageHeaderProps) {
  return (
    <div className={clsx('mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between', className)}>
      <div className="min-w-0">
        {migalhas && migalhas.length > 0 && (
          <nav className="mb-1 flex items-center gap-1 text-xs text-slate-400">
            {migalhas.map((m, i) => (
              <span key={i} className="flex items-center gap-1">
                {m.para ? (
                  <Link to={m.para} className="hover:text-slate-600">
                    {m.rotulo}
                  </Link>
                ) : (
                  <span>{m.rotulo}</span>
                )}
                {i < migalhas.length - 1 && <ChevronRight className="h-3 w-3" />}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
          {extra}
        </div>
        {descricao && <p className="mt-0.5 text-sm text-slate-500">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}
