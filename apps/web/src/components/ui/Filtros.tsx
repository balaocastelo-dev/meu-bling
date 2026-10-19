import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Search, X } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import type { SituacaoRef } from '@/types';

/** Barra de filtros padrão das listagens */
export function BarraFiltros({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('flex flex-wrap items-end gap-2 border-b border-slate-100 bg-white px-3 py-2.5', className)}>{children}</div>;
}

/** Campo de busca com debounce que escreve no filtro da URL */
export function BuscaFiltro({ valor, onChange, placeholder = 'Buscar…', className, autoFocus }: { valor: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  const [texto, setTexto] = useState(valor);
  const deb = useDebounce(texto, 350);
  useEffect(() => {
    if (deb !== valor) onChange(deb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deb]);
  useEffect(() => {
    setTexto(valor);
  }, [valor]);
  return (
    <div className={clsx('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input autoFocus={autoFocus} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className="input-base h-8 w-56 pl-8 pr-7 text-sm md:w-72" />
      {texto && (
        <button onClick={() => setTexto('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="Limpar busca">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Chips de situação coloridos (multi-seleção) — valor é lista de ids separada por vírgula */
export function ChipsSituacao({ situacoes, valor, onChange, contagens }: { situacoes: SituacaoRef[]; valor: string; onChange: (v: string) => void; contagens?: Record<number, number> }) {
  const sel = new Set(valor ? valor.split(',').map(Number) : []);
  const alternar = (id: number) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange(Array.from(n).join(','));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange('')}
        className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium transition', sel.size === 0 ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}
      >
        Todas
      </button>
      {situacoes.map((s) => {
        const ativo = sel.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => alternar(s.id)}
            className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition', ativo ? 'border-transparent' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}
            style={ativo ? { backgroundColor: `${s.cor}26`, color: s.cor, borderColor: `${s.cor}66` } : undefined}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.cor }} />
            {s.nome}
            {contagens?.[s.id] !== undefined && <span className="opacity-70">{contagens[s.id]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Select pequeno para filtros */
export function SelectFiltro({ valor, onChange, opcoes, placeholder, className, label }: { valor: string; onChange: (v: string) => void; opcoes: { valor: string | number; rotulo: string }[]; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={clsx('flex flex-col gap-0.5', className)}>
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <select value={valor} onChange={(e) => onChange(e.target.value)} className="input-base h-8 w-auto min-w-[140px] py-0 pr-8 text-sm">
        <option value="">{placeholder ?? 'Todos'}</option>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Período (data inicial/final) para filtros */
export function PeriodoFiltro({ inicial, final, onChange, label = 'Período' }: { inicial: string; final: string; onChange: (i: string, f: string) => void; label?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        <input type="date" value={inicial} onChange={(e) => onChange(e.target.value, final)} className="input-base h-8 w-36 py-0 text-sm" />
        <span className="text-xs text-slate-400">até</span>
        <input type="date" value={final} onChange={(e) => onChange(inicial, e.target.value)} className="input-base h-8 w-36 py-0 text-sm" />
      </div>
    </div>
  );
}
