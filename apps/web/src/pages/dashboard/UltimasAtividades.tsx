import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Ban, CircleDollarSign, FileText, History, LogIn, Package, Pencil, Plus, RefreshCw, Send, ShoppingCart, Wrench } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { Card, EmptyState, Skeleton } from '@/components/ui';
import { dataHora } from '@/lib/format';

type Tom = 'verde' | 'vermelho' | 'azul' | 'amarelo' | 'neutro';
type Categoria = 'vendas' | 'os' | 'compras' | 'fiscal' | 'financeiro' | 'cadastros' | 'sistema' | 'acessos';

interface Lancamento {
  id: string;
  tipo: 'RECEBER' | 'PAGAR' | 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA';
  descricao: string;
  valor: number;
  quando: string;
  dataRef: string;
  situacao: string | null;
  contato: string | null;
  conta: string | null;
  link: string;
}

export interface Acontecimento {
  id: string;
  quando: string;
  usuario: string;
  categoria: Categoria;
  texto: string;
  tom: Tom;
  link: string | null;
}

interface Resposta {
  lancamentos: Lancamento[];
  acontecimentos: Acontecimento[];
}

/** "agora", "há 5 min", "há 2 h", "ontem 14:02", "22/10 09:15" */
export function quandoRelativo(iso: string): string {
  const d = new Date(iso);
  const seg = (Date.now() - d.getTime()) / 1000;
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return seg < 4 * 3600 ? `há ${Math.floor(seg / 3600)} h` : `hoje ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

const FILTROS: { id: Categoria | ''; nome: string }[] = [
  { id: '', nome: 'Tudo' },
  { id: 'vendas', nome: 'Vendas' },
  { id: 'os', nome: 'OS' },
  { id: 'compras', nome: 'Compras' },
  { id: 'fiscal', nome: 'Notas' },
  { id: 'financeiro', nome: 'Financeiro' },
  { id: 'cadastros', nome: 'Cadastros' },
  { id: 'sistema', nome: 'Sistema' },
  { id: 'acessos', nome: 'Acessos' },
];

const ICONE: Record<Categoria, typeof ShoppingCart> = {
  vendas: ShoppingCart,
  os: Wrench,
  compras: Package,
  fiscal: FileText,
  financeiro: CircleDollarSign,
  cadastros: Plus,
  sistema: Pencil,
  acessos: LogIn,
};

const COR_TOM: Record<Tom, string> = {
  verde: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  vermelho: 'bg-red-50 text-red-600 ring-red-100',
  azul: 'bg-sky-50 text-sky-600 ring-sky-100',
  amarelo: 'bg-amber-50 text-amber-600 ring-amber-100',
  neutro: 'bg-slate-50 text-slate-500 ring-slate-100',
};

function BotaoMais({ onClick, carregando }: { onClick: () => void; carregando: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={carregando} className="w-full border-t border-slate-100 px-4 py-2 text-xs font-medium text-brand-600 hover:bg-slate-50 disabled:opacity-60">
      {carregando ? 'Carregando…' : 'Ver mais'}
    </button>
  );
}

/** Linha do tempo: quem fez o quê no sistema (só ADMIN) */
export function UltimosAcontecimentos({ className }: { className?: string }) {
  const [categoria, setCategoria] = useState<Categoria | ''>('');
  const [limite, setLimite] = useState(15);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['dashboard-acontecimentos', categoria, limite],
    queryFn: () => api.get<Resposta>('/dashboard/atividades', { so: 'acontecimentos', limite, categoria: categoria || undefined }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
  const itens = data?.acontecimentos ?? [];

  return (
    <Card
      titulo="Últimas movimentações"
      descricao="Tudo o que acontece no sistema: vendas, OS, situações, pagamentos, compras, notas e cadastros"
      className={className}
      semPadding
      acoes={
        <button type="button" onClick={() => refetch()} title="Atualizar" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <RefreshCw className={clsx('h-3.5 w-3.5', isFetching && 'animate-spin')} />
        </button>
      }
    >
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 py-2">
        {FILTROS.map((f) => (
          <button
            key={f.id || 'tudo'}
            type="button"
            onClick={() => {
              setCategoria(f.id);
              setLimite(15);
            }}
            className={clsx(
              'whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              categoria === f.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            {f.nome}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="p-4">
          <Skeleton className="h-64" />
        </div>
      ) : itens.length ? (
        <>
          <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
            {itens.map((a) => {
              const dinheiro = a.id.startsWith('m');
              const Icone = dinheiro ? (a.tom === 'vermelho' ? ArrowUpRight : ArrowDownLeft) : a.tom === 'vermelho' ? Ban : a.texto.startsWith('enviou') ? Send : ICONE[a.categoria] ?? History;
              const conteudo = (
                <>
                  <span className={clsx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1', COR_TOM[a.tom])}>
                    <Icone className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-700">
                      {a.usuario ? (
                        <>
                          <span className="font-medium text-slate-900">{a.usuario}</span> {a.texto}
                        </>
                      ) : (
                        <span className="font-medium text-slate-900">{a.texto.charAt(0).toUpperCase() + a.texto.slice(1)}</span>
                      )}
                    </span>
                    <span className="text-xs text-slate-400" title={dataHora(a.quando)}>
                      {quandoRelativo(a.quando)}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={a.id}>
                  {a.link ? (
                    <Link to={a.link} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50">
                      {conteudo}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-2.5">{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {itens.length >= limite && limite < 200 && <BotaoMais onClick={() => setLimite((l) => Math.min(l + 30, 200))} carregando={isFetching} />}
        </>
      ) : (
        <EmptyState compacto icone={<History className="h-5 w-5" />} titulo="Nada por aqui ainda" descricao="Os acontecimentos aparecem conforme a equipe usa o sistema." />
      )}
    </Card>
  );
}
