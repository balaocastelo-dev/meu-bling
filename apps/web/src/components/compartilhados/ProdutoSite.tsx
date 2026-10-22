/**
 * Foto do produto e selo "Pronta entrega" — os produtos do sistema vêm do site
 * (www.balao.info), com a foto e a disponibilidade de lá.
 */
import { useState } from 'react';
import clsx from 'clsx';
import { Package, Zap } from 'lucide-react';

const TAMANHOS = { xs: 'h-7 w-7', sm: 'h-9 w-9', md: 'h-12 w-12', lg: 'h-40 w-40' } as const;

export function FotoProduto({ url, alt = '', tamanho = 'sm', className }: { url?: string | null; alt?: string; tamanho?: keyof typeof TAMANHOS; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  const caixa = clsx('shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white', TAMANHOS[tamanho], className);
  if (!url || falhou) {
    return (
      <span className={clsx(caixa, 'flex items-center justify-center bg-slate-50 text-slate-300')}>
        <Package className={tamanho === 'lg' ? 'h-10 w-10' : 'h-4 w-4'} />
      </span>
    );
  }
  return (
    <span className={caixa}>
      <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFalhou(true)} className="h-full w-full object-contain" />
    </span>
  );
}

/** Selo verde "Pronta entrega" (na loja agora). Sem selo = sai do distribuidor. */
export function SeloProntaEntrega({ className, compacto }: { className?: string; compacto?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-50 font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20',
        compacto ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-xs',
        className,
      )}
      title="Pronta entrega: o produto está na loja"
    >
      <Zap className={compacto ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      Pronta entrega
    </span>
  );
}
