import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * SELEÇÃO DE VÁRIAS LINHAS (pedido do Thiago, 10/11/2026).
 *
 * Mesma mecânica em todas as listas do sistema — vendas, orçamentos, OS, notas,
 * produtos: marca várias e aplica uma ação de uma vez (apagar, imprimir, clonar,
 * etiqueta, relatório…).
 *
 * Guarda só os ids. A barra de ações recebe os ids e os registros da página,
 * então nada aqui sabe o que está sendo selecionado.
 *
 * Troca de página/filtro NÃO limpa a seleção de propósito: dá para marcar na
 * página 1, ir à 2 e continuar marcando. Quem limpa é a barra ("Desmarcar") ou a
 * própria ação, quando termina.
 */
export interface Selecao {
  ids: number[];
  qtd: number;
  tem: (id: number) => boolean;
  alternar: (id: number, marcado: boolean) => void;
  /** marca/desmarca de uma vez os ids da página (checkbox do cabeçalho) */
  alternarPagina: (idsDaPagina: number[], marcado: boolean) => void;
  /** Shift+clique: marca do último clicado até este, na ordem da página */
  intervalo: (idsDaPagina: number[], id: number) => void;
  limpar: () => void;
  /** tira da seleção os que já foram processados (o resto continua marcado) */
  remover: (ids: number[]) => void;
  /** troca a seleção inteira (ex.: deixar marcadas só as que falharam) */
  definir: (ids: number[]) => void;
}

export function useSelecao(): Selecao {
  const [ids, setIds] = useState<number[]>([]);
  const ultimo = useRef<number | null>(null);

  const conjunto = useMemo(() => new Set(ids), [ids]);

  const alternar = useCallback((id: number, marcado: boolean) => {
    ultimo.current = id;
    setIds((atual) => (marcado ? (atual.includes(id) ? atual : [...atual, id]) : atual.filter((x) => x !== id)));
  }, []);

  const alternarPagina = useCallback((idsDaPagina: number[], marcado: boolean) => {
    setIds((atual) => (marcado ? [...new Set([...atual, ...idsDaPagina])] : atual.filter((x) => !idsDaPagina.includes(x))));
  }, []);

  const intervalo = useCallback((idsDaPagina: number[], id: number) => {
    const fim = idsDaPagina.indexOf(id);
    const inicio = ultimo.current === null ? -1 : idsDaPagina.indexOf(ultimo.current);
    ultimo.current = id;
    if (fim < 0 || inicio < 0) {
      setIds((atual) => (atual.includes(id) ? atual : [...atual, id]));
      return;
    }
    const faixa = idsDaPagina.slice(Math.min(inicio, fim), Math.max(inicio, fim) + 1);
    setIds((atual) => [...new Set([...atual, ...faixa])]);
  }, []);

  const limpar = useCallback(() => {
    ultimo.current = null;
    setIds([]);
  }, []);

  const remover = useCallback((fora: number[]) => setIds((atual) => atual.filter((x) => !fora.includes(x))), []);

  return {
    ids,
    qtd: ids.length,
    tem: useCallback((id: number) => conjunto.has(id), [conjunto]),
    alternar,
    alternarPagina,
    intervalo,
    limpar,
    remover,
    definir: setIds,
  };
}
