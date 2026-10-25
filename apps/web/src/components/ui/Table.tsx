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
  /** some da tabela em telas menores que 1280 px (abaixo de 1024 px a lista vira cartões e mostra tudo) */
  ocultarMobile?: boolean;
  /** no cartão do celular: 'titulo' = destaque no topo; 'oculto' = não mostra; padrão = rótulo + valor */
  noCartao?: 'titulo' | 'oculto' | 'cheio';
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
  /** como mostrar no celular: 'cartoes' (padrão, uma linha vira um cartão) ou 'tabela' (rola para o lado) */
  celular?: 'cartoes' | 'tabela';
  /** cartão próprio no celular (no lugar do cartão automático com rótulo + valor de cada coluna) */
  cartao?: (linha: T, indice: number) => ReactNode;
}

/** Tabela densa com cabeçalho fixo, skeleton, estado vazio e ordenação opcional */
export function Table<T>({ colunas, dados, carregando, chave, onClickLinha, vazio, ordenacao, onOrdenar, linhasSkeleton = 6, className, rodape, destacar, compacta, celular = 'cartoes', cartao }: TableProps<T>) {
  const alternar = (c: Coluna<T>) => {
    if (!c.ordenavel || !onOrdenar) return;
    if (ordenacao?.campo === c.chave) {
      onOrdenar({ campo: c.chave, direcao: ordenacao.direcao === 'asc' ? 'desc' : 'asc' });
    } else {
      onOrdenar({ campo: c.chave, direcao: 'asc' });
    }
  };

  const cartoes = celular === 'cartoes';
  // no cartão: a coluna marcada como 'titulo' (ou a primeira) vai no topo; colunas sem título (ações) ficam à direita
  const semTitulo = (c: Coluna<T>) => c.titulo === '' || c.titulo === null || c.titulo === undefined || c.chave === 'acoes' || c.chave === 'menu';
  const colTitulo = colunas.find((c) => c.noCartao === 'titulo') ?? colunas.find((c) => !semTitulo(c) && c.noCartao !== 'oculto');
  const colAcoes = colunas.filter((c) => semTitulo(c) && c.noCartao !== 'oculto');
  const colCorpo = colunas.filter((c) => c !== colTitulo && !colAcoes.includes(c) && c.noCartao !== 'oculto');

  return (
    <>
      {cartoes && (
        <div className={clsx('lg:hidden', className)}>
          {carregando && !dados?.length && (
            <ul className="divide-y divide-slate-100">
              {Array.from({ length: Math.min(linhasSkeleton, 4) }).map((_, i) => (
                <li key={`skm-${i}`} className="space-y-2 p-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </li>
              ))}
            </ul>
          )}
          {!carregando && dados && dados.length === 0 && <div className="py-8">{vazio ?? <EmptyState titulo="Nenhum registro encontrado" />}</div>}
          {!!dados?.length && (
            <ul className="divide-y divide-slate-100 md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-slate-100">
              {dados.map((linha, i) => (
                <li
                  key={chave(linha)}
                  style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}
                  className={clsx('v18-linha px-3 py-2.5', onClickLinha && 'cursor-pointer active:bg-slate-100', destacar?.(linha) ? 'bg-brand-50/60' : 'bg-white')}
                  onClick={() => onClickLinha?.(linha)}
                >
                  {cartao ? (
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">{cartao(linha, i)}</div>
                      {colAcoes.length > 0 && (
                        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          {colAcoes.map((c) => (
                            <span key={c.chave}>{c.render(linha, i)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                  <>
                  <div className="flex items-start gap-2">
                    {colTitulo && <div className="min-w-0 flex-1 break-words text-sm font-medium text-slate-900">{colTitulo.render(linha, i)}</div>}
                    {colAcoes.length > 0 && (
                      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {colAcoes.map((c) => (
                          <span key={c.chave}>{c.render(linha, i)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {colCorpo.length > 0 && (
                    <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                      {colCorpo.map((c) => (
                        <div key={c.chave} className={clsx('min-w-0', c.noCartao === 'cheio' && 'col-span-2')}>
                          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{c.titulo}</dt>
                          <dd className={clsx('min-w-0 break-words text-slate-700 [&_.truncate]:whitespace-normal', c.direita && 'num font-medium')}>{c.render(linha, i)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {rodape && (
            <div className="overflow-x-auto border-t border-slate-200">
              <table className="tbl">
                <tfoot>{rodape}</tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    <div className={clsx('overflow-auto', cartoes && 'hidden lg:block', className)}>
      <table className={clsx('tbl', compacta && '[&_td]:py-1.5')}>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th
                key={c.chave}
                style={{ width: c.largura }}
                className={clsx(c.direita && 'text-right', c.ordenavel && 'cursor-pointer select-none hover:text-slate-700', c.ocultarMobile && 'hidden xl:table-cell', c.className)}
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
                    <td key={c.chave} className={clsx(c.ocultarMobile && 'hidden xl:table-cell')}>
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
              style={{ animationDelay: `${Math.min(i, 14) * 25}ms` }}
              className={clsx('v18-linha', onClickLinha && 'clicavel', destacar?.(linha) && 'bg-brand-50/60')}
              onClick={() => onClickLinha?.(linha)}
            >
              {colunas.map((c) => (
                <td key={c.chave} className={clsx(c.direita && 'text-right num', c.ocultarMobile && 'hidden xl:table-cell', c.className)}>
                  {c.render(linha, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {rodape && <tfoot>{rodape}</tfoot>}
      </table>
    </div>
    </>
  );
}
