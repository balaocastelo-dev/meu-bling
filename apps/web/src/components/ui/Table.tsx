import type { ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

export interface Coluna<T> {
  chave: string;
  titulo: ReactNode;
  /** Renderiza a célula */
  render: (linha: T, indice: number) => ReactNode;
  className?: string;
  /** alinhamento à direita (números) */
  direita?: boolean;
  largura?: string;
  /** chave de ordenação (se ordenável) */
  ordenavel?: boolean;
  ocultarMobile?: boolean;
}

export interface Ordenacao {
  campo: string;
  direcao: 'asc' | 'desc';
}

interface TableProps<T> {
  colunas: Coluna<T>[];
  dados: T[] | undefined;
  carregando?: boolean;
  chave: (linha: T) => string | number;
  onClickLinha?: (linha: T) => void;
  vazio?: ReactNode;
  ordenacao?: Ordenacao;
  onOrdenar?: (o: Ordenacao) => void;
  linhasSkeleton?: number;
  className?: string;
  rodape?: ReactNode;
  /** linha em destaque (ex.: selecionada) */
  destacar?: (linha: T) => boolean;
  compacta?: boolean;
}

/** Tabela densa com cabeçalho fixo, skeleton, estado vazio e ordenação opcional */
export function Table<T>({ colunas, dados, carregando, chave, onClickLinha, vazio, ordenacao, onOrdenar, linhasSkeleton = 6, className, rodape, destacar, compacta }: TableProps<T>) {
  const alternar = (c: Coluna<T>) => {
    if (!c.ordenavel || !onOrdenar) return;
    if (ordenacao?.campo === c.chave) {
      onOrdenar({ campo: c.chave, direcao: ordenacao.direcao === 'asc' ? 'desc' : 'asc' });
    } else {
      onOrdenar({ campo: c.chave, direcao: 'asc' });
    }
  };

  return (
    <div className={clsx('overflow-auto', className)}>
      <table className={clsx('tbl', compacta && '[&_td]:py-1.5')}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                style={{ width: c.largura }}
                className={clsx(c.direita && 'text-right', c.ordenavel && 'cursor-pointer select-none hover:text-slate-700', c.ocultarMobile && 'hidden md:table-cell', c.className)}
                onClick={() => alternar(c)}
              >
                <span className={clsx('inline-flex items-center gap-1', c.direita && 'flex-row-reverse')}>
                  {c.titulo}
                  {c.ordenavel &&
                    (ordenacao?.campo === c.chave ? (
                      ordenacao.direcao === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {carregando && !dados?.length
            ? Array.from({ length: linhasSkeleton }).map((_, i) => (
                <tr key={`sk-${i}`}>
                  {colunas.map((c) => (
                    <td key={c.chave} className={clsx(c.ocultarMobile && 'hidden md:table-cell')}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            : null}
          {!carregando && dados && dados.length === 0 && (
            <tr>
              <td colSpan={colunas.length} className="py-10">
                {vazio ?? <EmptyState titulo="Nenhum registro encontrado" />}
              </td>
            </tr>
          )}
          {dados?.map((linha, i) => (
            <tr
              key={chave(linha)}
              className={clsx(onClickLinha && 'clicavel', destacar?.(linha) && 'bg-brand-50/60')}
              onClick={() => onClickLinha?.(linha)}
            >
              {colunas.map((c) => (
                <td key={c.chave} className={clsx(c.direita && 'text-right num', c.ocultarMobile && 'hidden md:table-cell', c.className)}>
                  {c.render(linha, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {rodape && <tfoot>{rodape}</tfoot>}
      </table>
    </div>
  );
}
