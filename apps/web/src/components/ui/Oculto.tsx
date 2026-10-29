/**
 * Custos escondidos da tela: o cliente fica olhando o monitor no balcão, então todo custo
 * (e o lucro, que entrega o custo) aparece como "****" com um olhinho para mostrar.
 * Ao mostrar, o valor volta a se esconder sozinho depois de alguns segundos.
 */
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Eye, EyeOff } from 'lucide-react';

export const MASCARA = '****';
/** quanto tempo o valor fica à mostra antes de se esconder de novo */
export const TEMPO_REVELADO_MS = 15_000;

/** Estado "revelado" que se esconde sozinho depois de TEMPO_REVELADO_MS. */
export function useRevelado(ms = TEMPO_REVELADO_MS) {
  const [revelado, setRevelado] = useState(false);
  useEffect(() => {
    if (!revelado) return;
    const t = setTimeout(() => setRevelado(false), ms);
    return () => clearTimeout(t);
  }, [revelado, ms]);
  return [revelado, setRevelado] as const;
}

export function BotaoOlho({ revelado, onClick, className }: { revelado: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700', className)}
      title={revelado ? 'Esconder' : 'Mostrar (some sozinho em alguns segundos)'}
      aria-label={revelado ? 'Esconder valor' : 'Mostrar valor'}
    >
      {revelado ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Valor só de leitura escondido: "**** 👁". */
export function ValorOculto({ children, className }: { children: ReactNode; className?: string }) {
  const [revelado, setRevelado] = useRevelado();
  return (
    <span className={clsx('inline-flex items-center gap-1', className)}>
      {/* o asterisco fica no alto da linha: desce um pouco para alinhar com o olhinho e com os outros valores */}
      <span className={clsx(!revelado && 'inline-block translate-y-[0.2em] select-none tracking-widest text-slate-400')}>{revelado ? children : MASCARA}</span>
      <BotaoOlho revelado={revelado} onClick={() => setRevelado((r) => !r)} />
    </span>
  );
}
