import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { Campo } from './Input';
import { useDebounce } from '@/hooks/useDebounce';

export interface OpcaoBusca {
  id: number;
  rotulo: string;
  /** linha secundária (documento, código, preço...) */
  sub?: string;
  /** informação à direita (preço, estoque) */
  direita?: ReactNode;
  /** objeto original para quem precisar */
  dados?: unknown;
}

interface SearchSelectProps {
  label?: ReactNode;
  erro?: string;
  obrigatorio?: boolean;
  placeholder?: string;
  valor: number | null;
  /** rótulo atual quando já temos o id (ex.: edição) */
  rotuloAtual?: string | null;
  onChange: (id: number | null, opcao?: OpcaoBusca) => void;
  /** busca assíncrona na API — recebe o texto com debounce */
  buscar: (texto: string) => Promise<OpcaoBusca[]>;
  /** ação extra no rodapé da lista (ex.: "+ novo cliente") */
  rodape?: ReactNode;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  tamanho?: 'sm' | 'md';
  /** ao pressionar Enter sem seleção (para atalhos de grid) */
  onEnterVazio?: () => void;
  /** limpar campo após selecionar (modo "adicionar item") */
  limparAoSelecionar?: boolean;
}

/**
 * Combobox assíncrono (clientes, produtos, fornecedores...).
 * Abre ao digitar, navega com setas, seleciona com Enter.
 */
export function SearchSelect({
  label,
  erro,
  obrigatorio,
  placeholder = 'Digite para buscar…',
  valor,
  rotuloAtual,
  onChange,
  buscar,
  rodape,
  disabled,
  className,
  autoFocus,
  tamanho = 'md',
  onEnterVazio,
  limparAoSelecionar,
}: SearchSelectProps) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcaoBusca[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [selecionado, setSelecionado] = useState<string | null>(rotuloAtual ?? null);
  const debounced = useDebounce(texto, 250);
  const raiz = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincroniza rótulo exibido quando o valor muda externamente
  useEffect(() => {
    if (valor === null) setSelecionado(null);
    else if (rotuloAtual) setSelecionado(rotuloAtual);
  }, [valor, rotuloAtual]);

  // Busca ao digitar (ou ao abrir com o campo vazio — mostra os primeiros)
  useEffect(() => {
    if (!aberto) return;
    let cancelado = false;
    setCarregando(true);
    buscar(debounced)
      .then((r) => {
        if (!cancelado) {
          setOpcoes(r);
          setAtivo(0);
        }
      })
      .catch(() => {
        if (!cancelado) setOpcoes([]);
      })
      .finally(() => !cancelado && setCarregando(false));
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, aberto]);

  // Fecha ao clicar fora
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const escolher = (o: OpcaoBusca) => {
    onChange(o.id, o);
    if (limparAoSelecionar) {
      setSelecionado(null);
      setTexto('');
    } else {
      setSelecionado(o.rotulo);
      setTexto('');
    }
    setAberto(false);
  };

  const limpar = () => {
    onChange(null);
    setSelecionado(null);
    setTexto('');
    inputRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setAtivo((a) => Math.min(a + 1, opcoes.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (aberto && opcoes[ativo]) {
        e.preventDefault();
        escolher(opcoes[ativo]);
      } else if (!aberto && onEnterVazio) {
        e.preventDefault();
        onEnterVazio();
      }
    } else if (e.key === 'Escape') {
      setAberto(false);
    } else if (e.key === 'Backspace' && !texto && selecionado) {
      limpar();
    }
  };

  const mostrarSelecionado = selecionado && !texto;

  return (
    <Campo label={label} erro={erro} obrigatorio={obrigatorio} className={className} htmlFor={id}>
      <div ref={raiz} className="relative">
        <div className={clsx('input-base flex items-center gap-2 !py-0', erro && 'input-erro', tamanho === 'sm' ? 'h-8' : 'h-9', disabled && 'bg-slate-50')}>
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          {mostrarSelecionado ? (
            <button
              type="button"
              disabled={disabled}
              className="flex min-w-0 flex-1 items-center text-left text-sm text-slate-900"
              onClick={() => {
                setAberto(true);
                inputRef.current?.focus();
              }}
            >
              <span className="truncate">{selecionado}</span>
            </button>
          ) : null}
          <input
            id={id}
            ref={inputRef}
            autoFocus={autoFocus}
            disabled={disabled}
            autoComplete="off"
            className={clsx('min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400', mostrarSelecionado && 'w-0 flex-none')}
            placeholder={mostrarSelecionado ? '' : placeholder}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setAberto(true);
            }}
            onFocus={() => setAberto(true)}
            onKeyDown={onKey}
          />
          {carregando ? (
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          ) : selecionado && !disabled ? (
            <button type="button" onClick={limpar} className="rounded p-0.5 text-slate-400 hover:text-slate-600" aria-label="Limpar">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>

        {aberto && !disabled && (
          <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-pop anim-in">
            {opcoes.length === 0 && !carregando && <div className="px-3 py-3 text-sm text-slate-400">Nenhum resultado{texto ? ` para "${texto}"` : ''}.</div>}
            {opcoes.map((o, i) => (
              <button
                type="button"
                key={o.id}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => escolher(o)}
                className={clsx('flex w-full items-center gap-3 px-3 py-2 text-left text-sm', i === ativo ? 'bg-brand-50 text-slate-900' : 'text-slate-700')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.rotulo}</span>
                  {o.sub && <span className="block truncate text-xs text-slate-400">{o.sub}</span>}
                </span>
                {o.direita && <span className="shrink-0 text-xs text-slate-500 num">{o.direita}</span>}
              </button>
            ))}
            {rodape && <div className="mt-1 border-t border-slate-100 px-2 py-1.5">{rodape}</div>}
          </div>
        )}
      </div>
    </Campo>
  );
}
