import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/Sidebar';

/** Layout simples das páginas públicas (cliente sem login) */
export function LayoutPublico({ empresa, children }: { empresa?: { nome: string; telefone?: string | null; endereco?: string | null; logoPath?: string | null } | null; children: ReactNode }) {
  const logo = empresa?.logoPath ? (empresa.logoPath.startsWith('http') || empresa.logoPath.startsWith('/') ? empresa.logoPath : `/uploads/${empresa.logoPath}`) : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-4">
          {logo ? <img src={logo} alt="" className="h-10 max-w-[140px] object-contain" /> : <Logo className="h-9 w-9" />}
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{empresa?.nome ?? 'Balão da Informática'}</p>
            {empresa?.telefone && <p className="text-xs text-slate-400">{empresa.telefone}</p>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-center text-xs text-slate-400">
        {empresa?.endereco && <p>{empresa.endereco}</p>}
        <p className="mt-1">Acompanhamento gerado pelo sistema MEU BLING.</p>
      </footer>
    </div>
  );
}
