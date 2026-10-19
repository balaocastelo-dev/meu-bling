import { useEffect, useState } from 'react';

/** Devolve o valor apenas depois de `ms` sem alterações (buscas) */
export function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}
