/** Texto corrido com valores (R$ 1.234,56 · 12,5%) que nunca se partem em duas linhas. */
import { Fragment } from 'react';

const VALOR = /(R\$\s?-?[\d.]+(?:,\d+)?|-?\d+(?:,\d+)?\s?%)/g;

export function TextoValores({ texto }: { texto: string }) {
  const partes = texto.split(VALOR);
  return (
    <>
      {partes.map((p, i) => (i % 2 === 1 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
