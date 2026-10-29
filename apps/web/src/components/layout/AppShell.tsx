import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { useAuth } from '@/stores/auth';

/** Casca da aplicação autenticada: sidebar + topbar + conteúdo */
export function AppShell() {
  const token = useAuth((s) => s.token);
  const loc = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  // Atalho global Ctrl/Cmd+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setBuscaAberta((a) => !a);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  // Fecha o drawer ao navegar
  useEffect(() => {
    setMenuAberto(false);
  }, [loc.pathname, loc.search]);

  // Gaveta aberta (celular/tablet): Esc fecha, a página de trás não rola e,
  // se a tela crescer até o layout de computador (menu fixo), a gaveta fecha sozinha
  useEffect(() => {
    if (!menuAberto) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setMenuAberto(false);
    const telaGrande = window.matchMedia('(min-width: 1280px)');
    const aoMudar = () => telaGrande.matches && setMenuAberto(false);
    document.addEventListener('keydown', tecla);
    telaGrande.addEventListener('change', aoMudar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      telaGrande.removeEventListener('change', aoMudar);
      document.body.style.overflow = antes;
    };
  }, [menuAberto]);

  if (!token) return <Navigate to="/login" replace state={{ de: loc.pathname + loc.search }} />;

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-full">
      <Sidebar aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      <div className="flex min-h-dvh min-w-0 flex-col xl:pl-64">
        <Topbar menuAberto={menuAberto} onAbrirMenu={() => setMenuAberto(true)} onAbrirBusca={() => setBuscaAberta(true)} />
        {/* conteudo-seguro: margens laterais/inferior com env(safe-area-inset-*) (ver index.css) */}
        <main className="conteudo-seguro min-w-0 flex-1 pt-3 sm:pt-4 md:pt-6">
          {/* v18-pagina: blocos da tela entram em cascata (efeito V18, ver index.css) */}
          <div className="v18-pagina mx-auto min-w-0 max-w-[1400px]" key={loc.pathname}>
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette aberto={buscaAberta} onFechar={() => setBuscaAberta(false)} />
    </div>
    </MotionConfig>
  );
}
