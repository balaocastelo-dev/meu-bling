import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from './Button';
import { inteiro } from '@/lib/format';

interface PaginationProps {
  pagina: number;
  totalPaginas: number;
  total: number;
  limite: number;
  onPagina: (p: number) => void;
  onLimite?: (l: number) => void;
}

/** Paginação padrão das listagens */
export function Pagination({ pagina, totalPaginas, total, limite, onPagina, onLimite }: PaginationProps) {
  const inicio = total === 0 ? 0 : (pagina - 1) * limite + 1;
  const fim = Math.min(pagina * limite, total);
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 sm:flex-row">
      <div className="flex items-center gap-3">
        <span>
          {inteiro(inicio)}–{inteiro(fim)} de {inteiro(total)}
        </span>
        {onLimite && (
          <select className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs pointer-coarse:min-h-10" value={limite} onChange={(e) => onLimite(Number(e.target.value))}>
            {[20, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button tamanho="xs" variante="fantasma" disabled={pagina <= 1} onClick={() => onPagina(1)} aria-label="Primeira">
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button tamanho="xs" variante="fantasma" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)} aria-label="Anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2">
          Página <strong className="text-slate-700">{pagina}</strong> de {Math.max(1, totalPaginas)}
        </span>
        <Button tamanho="xs" variante="fantasma" disabled={pagina >= totalPaginas} onClick={() => onPagina(pagina + 1)} aria-label="Próxima">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button tamanho="xs" variante="fantasma" disabled={pagina >= totalPaginas} onClick={() => onPagina(totalPaginas)} aria-label="Última">
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
