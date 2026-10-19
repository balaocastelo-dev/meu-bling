import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Paginação e filtros sincronizados com a URL (?pagina=&limite=&...).
 * Mantém filtros ao navegar para o detalhe e voltar.
 */
export function usePaginacao(limitePadrao = 50) {
  const [sp, setSp] = useSearchParams();

  const pagina = Math.max(1, Number(sp.get('pagina')) || 1);
  const limite = Number(sp.get('limite')) || limitePadrao;

  const setPagina = useCallback(
    (p: number) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        n.set('pagina', String(p));
        return n;
      });
    },
    [setSp],
  );

  const setLimite = useCallback(
    (l: number) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        n.set('limite', String(l));
        n.set('pagina', '1');
        return n;
      });
    },
    [setSp],
  );

  /** Define um filtro e volta para a página 1 */
  const setFiltro = useCallback(
    (chave: string, valor: string | number | null | undefined) => {
      setSp((prev) => {
        const n = new URLSearchParams(prev);
        if (valor === null || valor === undefined || valor === '') n.delete(chave);
        else n.set(chave, String(valor));
        n.set('pagina', '1');
        return n;
      });
    },
    [setSp],
  );

  const getFiltro = useCallback((chave: string) => sp.get(chave) || '', [sp]);

  const limparFiltros = useCallback(() => setSp(new URLSearchParams()), [setSp]);

  /** Objeto com todos os filtros atuais (para passar como params à API) */
  const filtros = useMemo(() => {
    const o: Record<string, string> = {};
    sp.forEach((v, k) => {
      o[k] = v;
    });
    return o;
  }, [sp]);

  return { pagina, limite, setPagina, setLimite, setFiltro, getFiltro, limparFiltros, filtros };
}
