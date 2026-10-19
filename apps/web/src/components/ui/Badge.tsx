import type { ReactNode } from 'react';
import clsx from 'clsx';

type Tom = 'neutro' | 'verde' | 'vermelho' | 'amarelo' | 'azul' | 'roxo' | 'laranja' | 'cinza';

const tons: Record<Tom, string> = {
  neutro: 'bg-slate-100 text-slate-700',
  cinza: 'bg-slate-100 text-slate-500',
  verde: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  vermelho: 'bg-red-50 text-red-700 ring-red-600/20',
  amarelo: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  azul: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  roxo: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  laranja: 'bg-orange-50 text-orange-700 ring-orange-600/20',
};

export function Badge({ tom = 'neutro', children, className, ponto }: { tom?: Tom; children: ReactNode; className?: string; ponto?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent whitespace-nowrap', tons[tom], className)}>
      {ponto && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Badge colorido por uma cor hex vinda da API (fundo 15% + texto na cor) */
export function BadgeCor({ cor, children, className, tamanho = 'sm' }: { cor?: string | null; children: ReactNode; className?: string; tamanho?: 'sm' | 'md' }) {
  const c = cor || '#64748b';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        tamanho === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        className,
      )}
      style={{ backgroundColor: `${c}26`, color: c }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {children}
    </span>
  );
}

/** Mapeia situações de contas/notas/notificações para tons padrão */
export function tomPorStatus(s: string | null | undefined): Tom {
  switch (s) {
    case 'RECEBIDO':
    case 'PAGO':
    case 'PAGA':
    case 'AUTORIZADA':
    case 'ENVIADA':
    case 'APROVADA':
    case 'CONECTADO':
    case 'AUTORIZADO':
      return 'verde';
    case 'ATRASADO':
    case 'CANCELADO':
    case 'CANCELADA':
    case 'REJEITADA':
    case 'REJEITADO':
    case 'ERRO':
    case 'DENEGADA':
    case 'DESCONECTADO':
      return 'vermelho';
    case 'PARCIAL':
    case 'PENDENTE':
    case 'AGUARDANDO_QR':
    case 'ENVIANDO':
    case 'PROCESSANDO':
    case 'CONECTANDO':
      return 'amarelo';
    case 'ABERTO':
      return 'azul';
    case 'INUTILIZADA':
      return 'cinza';
    default:
      return 'neutro';
  }
}
