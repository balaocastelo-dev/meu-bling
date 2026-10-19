import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { MoreHorizontal } from 'lucide-react';

export interface ItemMenu {
  rotulo: string;
  icone?: ReactNode;
  onClick: () => void;
  /** vermelho (cancelar, excluir) */
  perigo?: boolean;
  desabilitado?: boolean;
  /** dica quando desabilitado */
  dica?: string;
  /** linha divisória antes do item */
  separar?: boolean;
  oculto?: boolean;
}

interface Props {
  itens: ItemMenu[];
  /** rótulo acessível do botão */
  titulo?: string;
  /** botão visível (padrão: só o "⋯") */
  gatilho?: ReactNode;
  tamanho?: 'sm' | 'md';
}

/**
 * Menu de ações "⋯" — abre um painel flutuante (portal) com as opções do registro.
 * Fecha ao clicar fora, rolar a página ou apertar Esc. Não propaga o clique para a linha da tabela.
 */
export function MenuAcoes({ itens, titulo = 'Mais ações', gatilho, tamanho = 'sm' }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; acima: boolean } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const visiveis = itens.filter((i) => !i.oculto);

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const largura = 240;
    const alturaEstimada = Math.min(420, visiveis.length * 34 + 16);
    const acima = r.bottom + alturaEstimada > window.innerHeight - 8 && r.top > alturaEstimada;
    const left = Math.max(8, Math.min(window.innerWidth - largura - 8, r.right - largura));
    setPos({ top: acima ? r.top - 4 : r.bottom + 4, left, acima });
  }, [aberto, visiveis.length]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (painel.current?.contains(alvo) || botao.current?.contains(alvo)) return;
      setAberto(false);
    };
    const fechar = () => setAberto(false);
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);

  return (
    <>
      <button
        ref={botao}
        type="button"
        title={titulo}
        aria-label={titulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((a) => !a);
        }}
        className={clsx(
          'inline-flex items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          aberto && 'bg-slate-100 text-slate-800',
          gatilho ? 'h-9 gap-1.5 border border-slate-300 bg-white px-3 text-sm font-medium shadow-xs' : tamanho === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        )}
      >
        {gatilho ?? <MoreHorizontal className="h-4 w-4" />}
      </button>
      {aberto &&
        pos &&
        createPortal(
          <div
            ref={painel}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, transform: pos.acima ? 'translateY(-100%)' : undefined }}
            className="fixed z-[60] w-60 max-h-[420px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop anim-in"
          >
            {visiveis.map((it, i) => (
              <div key={it.rotulo + i}>
                {it.separar && i > 0 && <div className="my-1 border-t border-slate-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={it.desabilitado}
                  title={it.desabilitado ? it.dica : undefined}
                  onClick={() => {
                    setAberto(false);
                    it.onClick();
                  }}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    it.perigo ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className={clsx('flex h-4 w-4 shrink-0 items-center justify-center', it.perigo ? 'text-red-500' : 'text-slate-400')}>{it.icone}</span>
                  {it.rotulo}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
