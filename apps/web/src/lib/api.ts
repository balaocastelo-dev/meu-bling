/**
 * Cliente HTTP da API (fetch wrapper).
 * - baseURL '/api/v1' (proxy do Vite em dev; mesmo host em produção)
 * - injeta Authorization: Bearer <token> a partir do store de auth
 * - converte erros `{erro, code, detalhes}` em ApiError
 * - redireciona para /login em 401
 */
import { useAuth } from '@/stores/auth';
import type { ErroApi } from '@/types';

/** Caminho base do app (ex.: '/sistema' quando publicado em www.balao.info/sistema). Vem do `base` do Vite. */
export const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const API_BASE = `${BASE_PATH}/api/v1`;
/** Prefixa um caminho de arquivo do storage ('/uploads/...') com o caminho base do app. */
export function urlUpload(caminho: string): string {
  if (!caminho) return caminho;
  if (caminho.startsWith('http')) return caminho;
  const rel = caminho.startsWith('/uploads/') ? caminho : caminho.startsWith('/') ? caminho : `/uploads/${caminho}`;
  return `${BASE_PATH}${rel}`;
}

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
    if (!location.pathname.startsWith(`${BASE_PATH}/login`) && !location.pathname.startsWith(`${BASE_PATH}/p/`)) {
      location.href = `${BASE_PATH}/login`;
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

function escaparHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Abre um conteúdo autenticado em nova aba.
 * PDF: uma página HTML com o título do documento (senão o "Salvar" sugere o UUID do blob).
 * HTML: o próprio <title> já é o nome que o navegador oferece em "Salvar como PDF".
 */
export async function abrirEmNovaAba(caminho: string, params?: Query) {
  const { blob, nome } = await api.blob(caminho, params);
  const tipo = (blob.type || '').toLowerCase();
  const ehPdf = tipo.includes('pdf') || (nome ?? '').toLowerCase().endsWith('.pdf');
  if (!ehPdf) {
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) throw new ApiError(0, 'O navegador bloqueou a abertura da nova aba.', 'POPUP');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const arquivo = nome && nome.toLowerCase().endsWith('.pdf') ? nome : 'documento.pdf';
  const titulo = arquivo.replace(/\.pdf$/i, '');
  const file = new File([blob], arquivo, { type: 'application/pdf' });
  const pdfUrl = URL.createObjectURL(file);
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>
<style>html,body{margin:0;height:100%;background:#525659}iframe{border:0;width:100%;height:100%}
.bar{position:fixed;top:8px;right:8px;z-index:2}a{background:#111;color:#fff;padding:6px 12px;border-radius:6px;font:13px/1.2 sans-serif;text-decoration:none}</style>
</head><body>
<div class="bar"><a href="${pdfUrl}" download="${escaparHtml(arquivo)}">Baixar</a></div>
<iframe src="${pdfUrl}" title="${escaparHtml(titulo)}"></iframe>
<script>window.addEventListener('beforeprint',function(){document.title=${JSON.stringify(titulo)};});</script>
</body></html>`;
  const pagina = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const win = window.open(pagina, '_blank');
  if (!win) {
    URL.revokeObjectURL(pagina);
    URL.revokeObjectURL(pdfUrl);
    throw new ApiError(0, 'O navegador bloqueou a abertura da nova aba.', 'POPUP');
  }
  setTimeout(() => {
    URL.revokeObjectURL(pagina);
    URL.revokeObjectURL(pdfUrl);
  }, 120_000);
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
