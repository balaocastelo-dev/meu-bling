import { NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { MENU, podeVer } from './menu';
import { useAuth } from '@/stores/auth';
import { useEmpresa } from '@/hooks/useEmpresa';

/** Logo "balão" da marca */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <circle cx="50" cy="42" r="34" fill="#ef4444" />
      <ellipse cx="38" cy="30" rx="9" ry="13" fill="#fca5a5" opacity="0.7" transform="rotate(-20 38 30)" />
      <rect x="45" y="72" width="10" height="24" rx="4" fill="#ef4444" />
    </svg>
  );
}

/** Sidebar escura fixa (drawer em telas < lg) */
export function Sidebar({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const perfil = useAuth((s) => s.usuario?.perfil);
  const { data: empresa } = useEmpresa();
  const loc = useLocation();

  const ativo = (para: string, alias?: string[]) => {
    const base = para.split('?')[0];
    const caminhos = [base, ...(alias ?? [])];
    if (base === '/') return loc.pathname === '/';
    // Fornecedores: mesmo path de /contatos mas com ?tipo — compara a query
    if (para.includes('?')) {
      const q = para.split('?')[1];
      return loc.pathname === base && loc.search.includes(q);
    }
    if (base === '/contatos') return loc.pathname.startsWith('/contatos') && !loc.search.includes('tipo=FORNECEDOR');
    if (base === '/configuracoes') return loc.pathname === '/configuracoes';
    return caminhos.some((c) => loc.pathname === c || loc.pathname.startsWith(c + '/'));
  };

  return (
    <>
      {/* fundo escuro no mobile */}
      <div className={clsx('fixed inset-0 z-40 bg-slate-900/50 transition-opacity xl:hidden', aberta ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={onFechar} aria-hidden />
      <aside
        id="menu-lateral"
        aria-label="Menu principal"
        className={clsx(
          // gaveta no celular/tablet: no máximo 85% da tela, para sobrar uma faixa de fundo para tocar e fechar
          'fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col bg-slate-950 text-slate-300 transition-transform duration-200 xl:max-w-none xl:translate-x-0',
          aberta ? 'translate-x-0 shadow-2xl xl:shadow-none' : '-translate-x-full',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)' }}
      >
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/5 px-4">
          <Logo className="h-8 w-8" />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold tracking-wide text-white">MEU BLING</p>
            <p className="truncate text-[11px] text-slate-400">{empresa?.nomeFantasia || empresa?.razaoSocial || 'Balão da Informática'}</p>
          </div>
          <button className="-mr-2 ml-auto inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 xl:hidden" onClick={onFechar} aria-label="Fechar menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {MENU.map((grupo) => {
            const itens = grupo.itens.filter((i) => podeVer(perfil, i.perfis));
            if (!itens.length) return null;
            return (
              <div key={grupo.titulo} className="mb-3">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{grupo.titulo}</p>
                {itens.map((it) => {
                  const Icone = it.icone;
                  const sel = ativo(it.para, it.alias);
                  return (
                    <NavLink
                      key={it.para}
                      to={it.para}
                      onClick={onFechar}
                      className={clsx(
                        // em tela de toque o item fica com >= 40px de altura
                        'group relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors pointer-coarse:min-h-10 pointer-coarse:text-sm',
                        sel ? 'text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                      )}
                    >
                      {/* fundo do item ativo desliza de um item para o outro (efeito V18) */}
                      {sel && <motion.span layoutId="menu-ativo" className="absolute inset-0 rounded-lg bg-white/10" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                      <Icone className={clsx('relative h-4 w-4 shrink-0 transition-transform group-hover:scale-110', sel ? 'text-brand-500' : 'text-slate-500 group-hover:text-slate-300')} />
                      <span className="relative truncate">{it.rotulo}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/5 px-4 py-2.5 text-[10px] text-slate-500">MEU BLING v0.1 · ERP Balão da Informática</div>
      </aside>
    </>
  );
}
