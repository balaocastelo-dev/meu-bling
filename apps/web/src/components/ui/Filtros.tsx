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
    <div className={clsx('relative w-full sm:w-auto', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input autoFocus={autoFocus} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className="input-base h-9 w-full pl-8 pr-7 text-sm sm:h-8 sm:w-56 md:w-72" />
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
    <div className={clsx('flex min-w-0 flex-1 basis-[calc(50%-0.25rem)] flex-col gap-0.5 sm:flex-none sm:basis-auto', className)}>
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <select value={valor} onChange={(e) => onChange(e.target.value)} className="input-base h-9 w-full min-w-0 py-0 pr-8 text-sm sm:h-8 sm:w-auto sm:min-w-[140px]">
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

/** AAAA-MM-DD no horário local (toISOString daria o dia seguinte depois das 21h) */
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Atalhos de período. A semana começa na segunda-feira. */
export function atalhosPeriodo(hoje = new Date()): { id: string; nome: string; i: string; f: string }[] {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diaSemana = (d.getDay() + 6) % 7; // 0 = segunda
  const segunda = new Date(d);
  segunda.setDate(d.getDate() - diaSemana);
  const domingo = new Date(segunda);
  domingo.setDate(segunda.getDate() + 6);
  const segundaPassada = new Date(segunda);
  segundaPassada.setDate(segunda.getDate() - 7);
  const domingoPassado = new Date(segunda);
  domingoPassado.setDate(segunda.getDate() - 1);
  const ontem = new Date(d);
  ontem.setDate(d.getDate() - 1);
  return [
    { id: 'hoje', nome: 'Hoje', i: iso(d), f: iso(d) },
    { id: 'ontem', nome: 'Ontem', i: iso(ontem), f: iso(ontem) },
    { id: 'semana', nome: 'Esta semana', i: iso(segunda), f: iso(domingo) },
    { id: 'semana-passada', nome: 'Semana passada', i: iso(segundaPassada), f: iso(domingoPassado) },
    { id: 'mes', nome: 'Este mês', i: iso(new Date(d.getFullYear(), d.getMonth(), 1)), f: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) },
    { id: 'mes-passado', nome: 'Mês passado', i: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), f: iso(new Date(d.getFullYear(), d.getMonth(), 0)) },
  ];
}

/** Período (data inicial/final) para filtros, com atalhos (hoje, semana, mês…) */
export function PeriodoFiltro({ inicial, final, onChange, label = 'Período', atalhos = true, limpavel = true }: { inicial: string; final: string; onChange: (i: string, f: string) => void; label?: string; atalhos?: boolean; /** false onde o período é obrigatório (DRE, relatórios) */ limpavel?: boolean }) {
  const opcoes = atalhos ? atalhosPeriodo() : [];
  const ativo = opcoes.find((o) => o.i === inicial && o.f === final)?.id;
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      {label && <span className="text-[11px] font-medium text-slate-500">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        {opcoes.length > 0 && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Atalhos de período">
            {opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => (ativo === o.id && limpavel ? onChange('', '') : onChange(o.i, o.f))}
                className={
                  'h-8 whitespace-nowrap rounded-md border px-2.5 text-xs font-medium transition-colors ' +
                  (ativo === o.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50')
                }
                aria-pressed={ativo === o.id}
              >
                {o.nome}
              </button>
            ))}
          </div>
        )}
        <div className="flex w-full min-w-0 items-center gap-1 sm:w-auto">
          <input type="date" aria-label="Data inicial" value={inicial} max={final || undefined} onChange={(e) => onChange(e.target.value, final)} className="input-base h-9 min-w-0 flex-1 py-0 text-sm sm:h-8 sm:w-36 sm:flex-none" />
          <span className="text-xs text-slate-400">até</span>
          <input type="date" aria-label="Data final" value={final} min={inicial || undefined} onChange={(e) => onChange(inicial, e.target.value)} className="input-base h-9 min-w-0 flex-1 py-0 text-sm sm:h-8 sm:w-36 sm:flex-none" />
          {limpavel && (inicial || final) && (
            <button type="button" onClick={() => onChange('', '')} title="Limpar período" className="h-8 rounded-md px-2 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
