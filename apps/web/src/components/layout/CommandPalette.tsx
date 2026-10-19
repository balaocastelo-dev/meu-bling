import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, Hash, Loader2, Package, Search, ShoppingCart, Users, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useDebounce } from '@/hooks/useDebounce';
import { MENU, podeVer } from './menu';
import { useAuth } from '@/stores/auth';
import { documento, moeda } from '@/lib/format';
import type { Contato, OsResumo, Paginado, Produto, VendaResumo } from '@/types';

interface Resultado {
  grupo: string;
  id: string;
  titulo: string;
  sub?: string;
  para: string;
  icone: React.ReactNode;
}

/** Busca global (Ctrl+K): clientes, produtos, vendas e OS por número, além de atalhos de navegação */
export function CommandPalette({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const nav = useNavigate();
  const perfil = useAuth((s) => s.usuario?.perfil);
  const [texto, setTexto] = useState('');
  const deb = useDebounce(texto, 250);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) {
      setTexto('');
      setResultados([]);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [aberto]);

  // Atalhos de navegação filtrados pelo texto
  const atalhos = useMemo<Resultado[]>(() => {
    const t = deb.trim().toLowerCase();
    const todos = MENU.flatMap((g) => g.itens.filter((i) => podeVer(perfil, i.perfis)).map((i) => ({ grupo: 'Ir para', id: 'nav-' + i.para, titulo: i.rotulo, sub: g.titulo, para: i.para, icone: <ArrowRight className="h-4 w-4" /> })));
    if (!t) return todos.slice(0, 6);
    return todos.filter((a) => a.titulo.toLowerCase().includes(t)).slice(0, 5);
  }, [deb, perfil]);

  useEffect(() => {
    const t = deb.trim();
    if (!aberto || !t) {
      setResultados([]);
      return;
    }
    let cancel = false;
    setCarregando(true);
    const ehNumero = /^\d+$/.test(t);
    const buscas: Promise<Resultado[]>[] = [
      api
        .get<Paginado<Contato>>('/contatos', { pesquisa: t, limite: 5 })
        .then((r) => r.data.map((c) => ({ grupo: 'Contatos', id: 'c' + c.id, titulo: c.nome, sub: [documento(c.documento), c.email].filter(Boolean).join(' · '), para: `/contatos/${c.id}`, icone: <Users className="h-4 w-4" /> })))
        .catch(() => []),
      api
        .get<Paginado<Produto>>('/produtos', { pesquisa: t, limite: 5 })
        .then((r) => r.data.map((p) => ({ grupo: 'Produtos', id: 'p' + p.id, titulo: p.nome, sub: [p.codigo, moeda(p.preco), p.estoqueTotal !== undefined ? `estoque ${p.estoqueTotal}` : ''].filter(Boolean).join(' · '), para: `/produtos/${p.id}`, icone: <Package className="h-4 w-4" /> })))
        .catch(() => []),
      api
        .get<Paginado<VendaResumo>>('/vendas', { pesquisa: t, limite: 6, tipo: 'TODOS' })
        .then((r) => r.data.map((v) => ({ grupo: 'Vendas', id: 'v' + v.id, titulo: `${v.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Venda'} nº ${v.numero}`, sub: `${v.contato?.nome ?? ''} · ${moeda(v.total)} · ${v.situacao?.nome ?? ''}`, para: `${v.tipo === 'ORCAMENTO' ? '/orcamentos' : '/vendas'}/${v.id}`, icone: <ShoppingCart className="h-4 w-4" /> })))
        .catch(() => []),
      api
        .get<Paginado<OsResumo>>('/ordens-servico', { pesquisa: t, limite: 5 })
        .then((r) => r.data.map((o) => ({ grupo: 'Ordens de serviço', id: 'o' + o.id, titulo: `OS nº ${o.numero}`, sub: `${o.contato?.nome ?? ''} · ${o.equipamento ?? ''} · ${o.situacao?.nome ?? ''}`, para: `/ordens-servico/${o.id}`, icone: <Wrench className="h-4 w-4" /> })))
        .catch(() => []),
    ];
    Promise.all(buscas).then((r) => {
      if (cancel) return;
      // Se for número, prioriza vendas/OS
      const lista = ehNumero ? [...r[2], ...r[3], ...r[0], ...r[1]] : r.flat();
      setResultados(lista);
      setAtivo(0);
      setCarregando(false);
    });
    return () => {
      cancel = true;
    };
  }, [deb, aberto]);

  const todos = [...resultados, ...atalhos];

  const ir = (r: Resultado) => {
    onFechar();
    nav(r.para);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAtivo((a) => Math.min(a + 1, todos.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && todos[ativo]) {
      ir(todos[ativo]);
    } else if (e.key === 'Escape') {
      onFechar();
    }
  };

  if (!aberto) return null;
  let grupoAnterior = '';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onFechar} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-pop anim-in">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          {carregando ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <Search className="h-5 w-5 text-slate-400" />}
          <input
            ref={inputRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={onKey}
            placeholder="Buscar por nome, documento, código ou nº de venda/OS…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">Esc</kbd>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {todos.length === 0 && !carregando && <p className="px-4 py-6 text-center text-sm text-slate-400">Nenhum resultado.</p>}
          {todos.map((r, i) => {
            const cab = r.grupo !== grupoAnterior;
            grupoAnterior = r.grupo;
            return (
              <div key={r.id}>
                {cab && <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{r.grupo}</p>}
                <button
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => ir(r)}
                  className={clsx('flex w-full items-center gap-3 px-4 py-2 text-left', i === ativo ? 'bg-brand-50' : 'hover:bg-slate-50')}
                >
                  <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', i === ativo ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500')}>{r.icone}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{r.titulo}</span>
                    {r.sub && <span className="block truncate text-xs text-slate-400">{r.sub}</span>}
                  </span>
                  {r.grupo !== 'Ir para' && <Hash className="h-3.5 w-3.5 text-slate-300" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
