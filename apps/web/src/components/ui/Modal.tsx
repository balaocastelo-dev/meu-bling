import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';

interface ModalProps {
  aberto: boolean;
  onFechar: () => void;
  titulo?: ReactNode;
  descricao?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
  tamanho?: 'sm' | 'md' | 'lg' | 'xl';
}

const larguras = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** Modal centralizado — só para ações rápidas (mudar situação, baixar conta, ajuste de estoque...) */
export function Modal({ aberto, onFechar, titulo, descricao, children, rodape, tamanho = 'md' }: ModalProps) {
  useEffect(() => {
    if (!aberto) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onFechar} />
      <div className={clsx('relative m-0 flex max-h-[92vh] w-full flex-col rounded-t-xl bg-white shadow-pop anim-in sm:m-4 sm:rounded-xl', larguras[tamanho])}>
        {(titulo || descricao) && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              {titulo && <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>}
              {descricao && <p className="mt-0.5 text-sm text-slate-500">{descricao}</p>}
            </div>
            <button onClick={onFechar} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{rodape}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Painel lateral (drawer) — para cadastros rápidos e filtros */
export function Drawer({ aberto, onFechar, titulo, descricao, children, rodape, largura = 'max-w-xl' }: Omit<ModalProps, 'tamanho'> & { largura?: string }) {
  useEffect(() => {
    if (!aberto) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [aberto, onFechar]);

  if (!aberto) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onFechar} />
      <div className={clsx('relative flex h-full w-full flex-col bg-white shadow-pop anim-in', largura)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            {titulo && <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>}
            {descricao && <p className="mt-0.5 text-sm text-slate-500">{descricao}</p>}
          </div>
          <button onClick={onFechar} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{rodape}</div>}
      </div>
    </div>,
    document.body,
  );
}
