import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

const mola = { type: 'spring', stiffness: 420, damping: 34 } as const;

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

  return createPortal(
    <AnimatePresence>
    {aberto && (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <motion.div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onFechar} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.15 } }}
        transition={mola}
        className={clsx('relative m-0 flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:m-4 sm:rounded-2xl', larguras[tamanho])}
      >
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
      </motion.div>
    </div>
    )}
    </AnimatePresence>,
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

  return createPortal(
    <AnimatePresence>
    {aberto && (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden" role="dialog" aria-modal="true">
      <motion.div className="absolute inset-0 bg-slate-900/40" onClick={onFechar} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%', transition: { duration: 0.2 } }}
        transition={mola}
        className={clsx('relative flex h-full w-full flex-col bg-white shadow-pop', largura)}
      >
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
      </motion.div>
    </div>
    )}
    </AnimatePresence>,
    document.body,
  );
}
