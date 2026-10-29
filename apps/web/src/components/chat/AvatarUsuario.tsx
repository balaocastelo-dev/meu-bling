import clsx from 'clsx';
import { Users } from 'lucide-react';
import { iniciais } from '@/lib/format';
import type { EstadoPresenca } from '@/lib/chat/tipos';

const CORES = ['bg-rose-600', 'bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-teal-600', 'bg-indigo-600', 'bg-pink-600', 'bg-cyan-700', 'bg-orange-600'];

export function corDoUsuario(id: number | null | undefined) {
  return CORES[Math.abs(Number(id) || 0) % CORES.length];
}

export const COR_PRESENCA: Record<EstadoPresenca, string> = { online: 'bg-emerald-500', ausente: 'bg-amber-400', ocupado: 'bg-red-500' };
export const ROTULO_PRESENCA: Record<EstadoPresenca, string> = { online: 'Online', ausente: 'Ausente', ocupado: 'Em chamada' };

/** Avatar com as iniciais (cor fixa por usuário) e a bolinha de presença. Salas usam o ícone de grupo. */
export function AvatarUsuario({ id, nome, tamanho = 'md', presenca, sala, className }: { id?: number | null; nome?: string | null; tamanho?: 'sm' | 'md' | 'lg' | 'xl'; presenca?: EstadoPresenca | null; sala?: boolean; className?: string }) {
  const dim = { sm: 'h-7 w-7 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-12 w-12 text-sm', xl: 'h-20 w-20 text-2xl' }[tamanho];
  const ponto = { sm: 'h-2 w-2 ring-1', md: 'h-3 w-3 ring-2', lg: 'h-3.5 w-3.5 ring-2', xl: 'h-5 w-5 ring-4' }[tamanho];
  return (
    <span className={clsx('relative inline-flex shrink-0', className)}>
      <span className={clsx('flex items-center justify-center rounded-full font-semibold uppercase text-white', dim, sala ? 'bg-slate-700' : corDoUsuario(id))}>
        {sala ? <Users className={tamanho === 'xl' ? 'h-9 w-9' : tamanho === 'sm' ? 'h-3.5 w-3.5' : 'h-5 w-5'} /> : iniciais(nome)}
      </span>
      {presenca && <span className={clsx('absolute -bottom-0.5 -right-0.5 rounded-full ring-white', ponto, COR_PRESENCA[presenca])} aria-label={ROTULO_PRESENCA[presenca]} />}
    </span>
  );
}
