/** Tipos e pedacinhos compartilhados da tela "API e integrações". */
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Nivel = 'LEITURA' | 'GRAVACAO' | 'TOTAL';
export type Permissoes = Record<string, Nivel>;

export interface Recurso {
  chave: string;
  nome: string;
  descricao: string;
  maximo: Nivel;
}
export interface Endpoint {
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE';
  caminho: string;
  recurso: string;
  resumo: string;
  filtros?: string[];
  corpo?: unknown;
}
export interface Catalogo {
  niveis: Nivel[];
  recursos: Recurso[];
  endpoints: Endpoint[];
  eventos: { chave: string; nome: string }[];
  ferramentasMcp: { nome: string; titulo: string; descricao: string; recurso: string; nivel: Nivel }[];
}
export interface ResumoApi {
  chaves: number;
  ativas: number;
  webhooks: number;
  chamadas24h: number;
  erros24h: number;
  entregasPendentes: number;
  urlBase: string;
  urlMcp: string;
  urlOpenApi: string;
}
export interface ChaveApi {
  id: number;
  nome: string;
  descricao: string | null;
  prefixo: string;
  permissoes: Permissoes;
  ipsPermitidos: string | null;
  limitePorMinuto: number;
  permitirNaUrl: boolean;
  expiraEm: string | null;
  vencida: boolean;
  ativo: boolean;
  ultimoUsoEm: string | null;
  ultimoIp: string | null;
  totalChamadas: number;
  chamadas24h: number;
  criadoEm: string;
  /** só na criação/regeneração */
  chave?: string;
}
export interface Webhook {
  id: number;
  nome: string;
  url: string;
  eventos: string[];
  ativo: boolean;
  ultimoEnvioEm: string | null;
  ultimoStatus: number | null;
  falhasSeguidas: number;
  criadoEm: string;
  segredo?: string;
}

export const NIVEL_ROTULO: Record<Nivel | 'NENHUM', string> = { NENHUM: 'Sem acesso', LEITURA: 'Leitura', GRAVACAO: 'Leitura e gravação', TOTAL: 'Total (com exclusão)' };
export const NIVEL_CURTO: Record<Nivel | 'NENHUM', string> = { NENHUM: 'Nada', LEITURA: 'Ler', GRAVACAO: 'Gravar', TOTAL: 'Total' };

export const useCatalogo = () => useQuery({ queryKey: ['api-externa', 'recursos'], queryFn: () => api.get<Catalogo>('/api-externa/recursos'), staleTime: 5 * 60_000 });
export const useResumoApi = () => useQuery({ queryKey: ['api-externa', 'resumo'], queryFn: () => api.get<ResumoApi>('/api-externa/resumo') });

export async function copiar(texto: string, aviso = 'Copiado.') {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(aviso);
  } catch {
    toast.error('Não consegui copiar: selecione o texto e copie manualmente.');
  }
}

/** Botão pequeno de copiar com confirmação visual. */
export function BotaoCopiar({ texto, rotulo = 'Copiar', className }: { texto: string; rotulo?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={clsx('inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50', className)}
      onClick={async () => {
        await copiar(texto);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {rotulo}
    </button>
  );
}

/** Bloco de código com botão de copiar (rola por dentro no celular). */
export function Codigo({ children, titulo, copiavel = true }: { children: string; titulo?: ReactNode; copiavel?: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
      {(titulo || copiavel) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-700 px-3 py-1.5">
          <span className="min-w-0 truncate text-xs font-medium text-slate-300">{titulo}</span>
          {copiavel && <BotaoCopiar texto={children} className="border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700" />}
        </div>
      )}
      <pre className="max-h-80 overflow-auto p-3 text-xs leading-relaxed text-slate-100"><code>{children}</code></pre>
    </div>
  );
}

/** Linha "rótulo: valor copiável" (endereços). */
export function LinhaCopiavel({ rotulo, valor, ajuda }: { rotulo: string; valor: string; ajuda?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-slate-500">{rotulo}</p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700 ring-1 ring-slate-200">{valor}</code>
        <BotaoCopiar texto={valor} />
      </div>
      {ajuda && <p className="mt-1 text-xs text-slate-400">{ajuda}</p>}
    </div>
  );
}

export function CorMetodo({ metodo }: { metodo: string }) {
  const cor = metodo === 'GET' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : metodo === 'DELETE' ? 'bg-red-50 text-red-700 ring-red-600/20' : metodo === 'PUT' ? 'bg-amber-50 text-amber-700 ring-amber-600/20' : 'bg-blue-50 text-blue-700 ring-blue-600/20';
  return <span className={clsx('inline-flex w-14 shrink-0 justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ring-1 ring-inset', cor)}>{metodo}</span>;
}
