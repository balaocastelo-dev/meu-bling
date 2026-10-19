/**
 * Cliente HTTP da API (fetch wrapper).
 * - baseURL '/api/v1' (proxy do Vite em dev; mesmo host em produção)
 * - injeta Authorization: Bearer <token> a partir do store de auth
 * - converte erros `{erro, code, detalhes}` em ApiError
 * - redireciona para /login em 401
 */
import { useAuth } from '@/stores/auth';
import type { ErroApi } from '@/types';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  code?: string;
  detalhes?: unknown;
  constructor(status: number, erro: string, code?: string, detalhes?: unknown) {
    super(erro);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detalhes = detalhes;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Monta a query string ignorando valores vazios/nulos */
export function qs(params?: Query): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function headersAuth(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const token = useAuth.getState().token;
  if (token) h.set('Authorization', `Bearer ${token}`);
  return h;
}

async function tratarResposta<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    // Sessão expirada: limpa e manda para o login (exceto se já estiver lá)
    useAuth.getState().logout();
    if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/p/')) {
      location.href = '/login';
    }
    throw new ApiError(401, 'Sessão expirada. Faça login novamente.', 'NAO_AUTENTICADO');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let corpo: Partial<ErroApi> = {};
    if (contentType.includes('application/json')) {
      corpo = (await res.json().catch(() => ({}))) as Partial<ErroApi>;
    } else {
      const txt = await res.text().catch(() => '');
      corpo = { erro: txt || res.statusText };
    }
    const msg =
      corpo.erro ||
      (res.status === 404 ? 'Recurso não encontrado (rota ainda não disponível).' : `Erro ${res.status}`);
    throw new ApiError(res.status, msg, corpo.code, corpo.detalhes);
  }
  if (res.status === 204) return undefined as T;
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

async function requisicao<T>(method: string, caminho: string, body?: unknown, params?: Query): Promise<T> {
  const url = `${API_BASE}${caminho}${qs(params)}`;
  const headers = headersAuth({ Accept: 'application/json' });
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API. Verifique se o servidor está no ar.', 'REDE');
  }
  return tratarResposta<T>(res);
}

export const api = {
  get: <T>(caminho: string, params?: Query) => requisicao<T>('GET', caminho, undefined, params),
  post: <T>(caminho: string, body?: unknown, params?: Query) => requisicao<T>('POST', caminho, body, params),
  put: <T>(caminho: string, body?: unknown) => requisicao<T>('PUT', caminho, body),
  patch: <T>(caminho: string, body?: unknown) => requisicao<T>('PATCH', caminho, body),
  del: <T>(caminho: string) => requisicao<T>('DELETE', caminho),
  /** Upload multipart (FormData) */
  upload: <T>(caminho: string, form: FormData, method: 'POST' | 'PUT' = 'POST') => requisicao<T>(method, caminho, form),

  /**
   * Baixa um arquivo autenticado (HTML de impressão, XML, PDF) como Blob.
   * Como o GET exige o header Authorization, não dá para abrir a URL direto.
   */
  blob: async (caminho: string, params?: Query): Promise<{ blob: Blob; nome: string | null }> => {
    const url = `${API_BASE}${caminho}${qs(params)}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: headersAuth() });
    } catch {
      throw new ApiError(0, 'Não foi possível conectar à API.', 'REDE');
    }
    if (!res.ok) {
      await tratarResposta(res);
    }
    const disp = res.headers.get('content-disposition') || '';
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
    return { blob: await res.blob(), nome: m ? decodeURIComponent(m[1]) : null };
  },
};

/** Abre um conteúdo (HTML/PDF) autenticado em nova aba */
export async function abrirEmNovaAba(caminho: string, params?: Query) {
  const { blob } = await api.blob(caminho, params);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) throw new ApiError(0, 'O navegador bloqueou a abertura da nova aba.', 'POPUP');
  // libera o objeto depois de um tempo (a aba já carregou)
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Força o download de um arquivo autenticado */
export async function baixarArquivo(caminho: string, nomePadrao: string, params?: Query) {
  const { blob, nome } = await api.blob(caminho, params);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome || nomePadrao;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Extrai uma mensagem legível de qualquer erro (para toasts) */
export function mensagemErro(e: unknown, padrao = 'Ocorreu um erro inesperado.'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message || padrao;
  return padrao;
}

/** Erro 404 ou rede: rota ainda não implementada / API fora do ar */
export function rotaIndisponivel(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 0);
}
