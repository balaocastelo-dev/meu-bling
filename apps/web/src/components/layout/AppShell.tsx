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
  }, [loc.pathname]);

  if (!token) return <Navigate to="/login" replace state={{ de: loc.pathname + loc.search }} />;

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-full">
      <Sidebar aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      <div className="flex min-h-screen min-w-0 flex-col lg:pl-64">
        <Topbar onAbrirMenu={() => setMenuAberto(true)} onAbrirBusca={() => setBuscaAberta(true)} />
        <main className="min-w-0 flex-1 p-3 sm:p-4 md:p-6">
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
