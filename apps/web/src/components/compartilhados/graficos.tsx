/**
 * Utilitários para gráficos (recharts): paleta, tooltip padrão e formatadores.
 */
import { moeda } from '@/lib/format';

export const PALETA = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#0ea5e9', '#f97316', '#64748b', '#ec4899', '#14b8a6'];

export const CORES = {
  receita: '#2563eb',
  entrada: '#16a34a',
  saida: '#dc2626',
  saldo: '#0f172a',
  lucro: '#16a34a',
  grade: '#e2e8f0',
  eixo: '#94a3b8',
};

/** Abrevia valores em R$ no eixo (1,2 mil / 3,4 mi) */
export function eixoMoeda(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1_000) return `${(v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** Tooltip padrão (recharts passa payload/label) */
export function TooltipPadrao({ active, payload, label, moedaFmt = true }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[]; label?: string | number; moedaFmt?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <p className="mb-1 font-medium text-slate-700">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span>{p.name}:</span>
          <span className="num font-medium text-slate-800">{moedaFmt && typeof p.value === 'number' ? moeda(p.value) : String(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/** Formata o rótulo do período das séries (2026-10-19 → 19/10; 2026-10 → out/26) */
export function rotuloPeriodo(p: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p.slice(8, 10) + '/' + p.slice(5, 7);
  if (/^\d{4}-\d{2}$/.test(p)) {
    const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${meses[Number(p.slice(5, 7)) - 1]}/${p.slice(2, 4)}`;
  }
  return p;
}
