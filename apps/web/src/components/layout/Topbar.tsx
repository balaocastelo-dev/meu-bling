import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronDown, LogOut, Menu, MessageCircle, Package, Plus, Search, ShoppingBag, ShoppingCart, UserPlus, Wrench, FileSignature } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { api } from '@/lib/api';
import { useWhatsappStatus } from '@/hooks/useEmpresa';
import { iniciais, rotulo } from '@/lib/format';

function MenuFlutuante({ aberto, onFechar, children, alinhar = 'right' }: { aberto: boolean; onFechar: () => void; children: React.ReactNode; alinhar?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onFechar();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div ref={ref} className={clsx('absolute top-full z-40 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-pop anim-in', alinhar === 'right' ? 'right-0' : 'left-0')}>
      {children}
    </div>
  );
}

/** Barra superior: menu mobile, busca global (Ctrl+K), + Novo, status WhatsApp, usuário */
export function Topbar({ onAbrirMenu, onAbrirBusca }: { onAbrirMenu: () => void; onAbrirBusca: () => void }) {
  const nav = useNavigate();
  const usuario = useAuth((s) => s.usuario);
  const logout = useAuth((s) => s.logout);
  const { data: wa } = useWhatsappStatus();
  const [novoAberto, setNovoAberto] = useState(false);
  const [userAberto, setUserAberto] = useState(false);

  const ehMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const novos = [
    { rotulo: 'Pedido de venda', para: '/vendas/nova', icone: ShoppingCart },
    { rotulo: 'Orçamento', para: '/orcamentos/novo', icone: FileSignature },
    { rotulo: 'Ordem de serviço', para: '/ordens-servico/nova', icone: Wrench },
    { rotulo: 'Pedido de compra', para: '/compras/nova', icone: ShoppingBag },
    { rotulo: 'Cliente', para: '/contatos/novo', icone: UserPlus },
    { rotulo: 'Produto', para: '/produtos/novo', icone: Package },
  ];

  const waStatus = wa?.status ?? 'DESCONECTADO';
  const waCor = waStatus === 'CONECTADO' ? 'bg-emerald-500' : waStatus === 'DESCONECTADO' ? 'bg-red-500' : 'bg-amber-400';

  return (
    <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center gap-2 border-b border-slate-200 bg-white px-3 md:px-4">
      <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onAbrirMenu} aria-label="Abrir menu">
        <Menu className="h-5 w-5" />
      </button>

      <button
        onClick={onAbrirBusca}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition hover:border-slate-300 hover:bg-white md:max-w-md"
        aria-label="Buscar"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          <span className="sm:hidden">Buscar…</span>
          <span className="hidden sm:inline">Buscar clientes, produtos, vendas, OS…</span>
        </span>
        <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 sm:inline">{ehMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <div className="relative">
          <button
            onClick={() => setNovoAberto((a) => !a)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white shadow-xs transition hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Novo</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-80" />
          </button>
          <MenuFlutuante aberto={novoAberto} onFechar={() => setNovoAberto(false)}>
            {novos.map((n) => (
              <Link key={n.para} to={n.para} onClick={() => setNovoAberto(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <n.icone className="h-4 w-4 text-slate-400" />
                {n.rotulo}
              </Link>
            ))}
          </MenuFlutuante>
        </div>

        <Link
          to="/comunicacao/whatsapp"
          title={`WhatsApp: ${rotulo(waStatus)}`}
          className="relative hidden h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 sm:inline-flex"
        >
          <MessageCircle className="h-5 w-5" />
          <span className={clsx('absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', waCor)} />
        </Link>

        <div className="relative">
          <button onClick={() => setUserAberto((a) => !a)} className="flex h-9 items-center gap-2 rounded-md px-1.5 transition hover:bg-slate-100">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-[11px] font-semibold uppercase text-white">{iniciais(usuario?.nome)}</span>
            <span className="hidden text-left leading-tight md:block">
              <span className="block max-w-[140px] truncate text-sm font-medium text-slate-800">{usuario?.nome}</span>
              <span className="block text-[11px] text-slate-400">{rotulo(usuario?.perfil)}</span>
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 md:block" />
          </button>
          <MenuFlutuante aberto={userAberto} onFechar={() => setUserAberto(false)}>
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-800">{usuario?.nome}</p>
              <p className="truncate text-xs text-slate-400">{usuario?.email}</p>
            </div>
            <Link to="/perfil" onClick={() => setUserAberto(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Minha conta / senha
            </Link>
            <button
              onClick={() => {
                void api.post('/auth/logout', {}).catch(() => undefined);
                logout();
                nav('/login');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </MenuFlutuante>
        </div>
      </div>
    </header>
  );
}
