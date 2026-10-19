/**
 * Cliente HTTP da API Bling v3 (https://api.bling.com.br/Api/v3) com OAuth2,
 * refresh automático de token, rate limit (3 req/s) e retry em 429.
 * Tokens ficam criptografados na Empresa (blingAccessToken/blingRefreshToken/blingTokenExpira).
 */
import { prisma } from '../../lib/prisma.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { env } from '../../lib/env.js';
import { AppError } from '../../lib/errors.js';

export const BLING_API = 'https://api.bling.com.br/Api/v3';
export const BLING_AUTH = 'https://www.bling.com.br/Api/v3/oauth/authorize';
export const BLING_TOKEN = 'https://www.bling.com.br/Api/v3/oauth/token';

export function urlCallback() {
  return `${env.APP_URL.replace(/\/$/, '')}/configuracoes/bling/callback`;
}

async function credenciais() {
  const e = await prisma.empresa.findUnique({
    where: { id: 1 },
    select: { blingClientId: true, blingClientSecret: true, blingAccessToken: true, blingRefreshToken: true, blingTokenExpira: true },
  });
  if (!e) throw new AppError('Empresa não configurada.', 500);
  return {
    clientId: e.blingClientId || '',
    clientSecret: decrypt(e.blingClientSecret) || '',
    accessToken: decrypt(e.blingAccessToken),
    refreshToken: decrypt(e.blingRefreshToken),
    expira: e.blingTokenExpira,
  };
}

export async function blingStatus() {
  const c = await credenciais();
  return { configurado: !!(c.clientId && c.clientSecret), conectado: !!c.accessToken, expira: c.expira };
}

export function urlAutorizacao(clientId: string, state: string) {
  const p = new URLSearchParams({ response_type: 'code', client_id: clientId, state });
  return `${BLING_AUTH}?${p.toString()}`;
}

async function salvarTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
  await prisma.empresa.update({
    where: { id: 1 },
    data: {
      blingAccessToken: encrypt(t.access_token),
      blingRefreshToken: encrypt(t.refresh_token),
      blingTokenExpira: new Date(Date.now() + (t.expires_in || 21600) * 1000),
    },
  });
}

async function chamarToken(body: Record<string, string>) {
  const c = await credenciais();
  if (!c.clientId || !c.clientSecret) throw new AppError('Configure o Client ID e o Client Secret do Bling em Configurações.', 422, 'BLING_NAO_CONFIGURADO');
  const basic = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
  const r = await fetch(BLING_TOKEN, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0' },
    body: new URLSearchParams(body).toString(),
  });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) {
    throw new AppError(`Bling recusou a autenticação: ${json.error_description || json.error?.description || json.error || r.status}`, 422, 'BLING_OAUTH');
  }
  await salvarTokens(json);
  return json;
}

export async function trocarCodigo(code: string) {
  return chamarToken({ grant_type: 'authorization_code', code });
}

export async function renovarToken() {
  const c = await credenciais();
  if (!c.refreshToken) throw new AppError('Conecte o Bling em Configurações', 422, 'BLING_DESCONECTADO');
  return chamarToken({ grant_type: 'refresh_token', refresh_token: c.refreshToken });
}

export async function desconectarBling() {
  await prisma.empresa.update({ where: { id: 1 }, data: { blingAccessToken: null, blingRefreshToken: null, blingTokenExpira: null } });
}

// ---------------------------------------------------------------------
// Requisições com rate limit (3 req/s) e retry em 429
// ---------------------------------------------------------------------
let ultimasChamadas: number[] = [];
async function esperarSlot() {
  for (;;) {
    const agora = Date.now();
    ultimasChamadas = ultimasChamadas.filter((t) => agora - t < 1000);
    if (ultimasChamadas.length < 3) {
      ultimasChamadas.push(agora);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000 - (agora - ultimasChamadas[0]) + 20));
  }
}

async function tokenValido(): Promise<string> {
  const c = await credenciais();
  if (!c.accessToken) throw new AppError('Conecte o Bling em Configurações', 422, 'BLING_DESCONECTADO');
  if (c.expira && c.expira.getTime() - Date.now() < 5 * 60 * 1000 && c.refreshToken) {
    const t = await renovarToken();
    return t.access_token;
  }
  return c.accessToken;
}

export async function blingGet<T = any>(caminho: string, params: Record<string, string | number | undefined> = {}, tentativa = 0): Promise<T> {
  const token = await tokenValido();
  const url = new URL(BLING_API + caminho);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  await esperarSlot();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (r.status === 429 && tentativa < 6) {
    await new Promise((res) => setTimeout(res, 1200 * (tentativa + 1)));
    return blingGet(caminho, params, tentativa + 1);
  }
  if (r.status === 401 && tentativa < 1) {
    await renovarToken();
    return blingGet(caminho, params, tentativa + 1);
  }
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error?.description || json?.error?.message || json?.error?.type || `HTTP ${r.status}`;
    throw new AppError(`Bling ${caminho}: ${msg}`, r.status >= 500 ? 502 : 422, 'BLING_API', json?.error);
  }
  return json as T;
}

/** Percorre todas as páginas (pagina=1..n, limite=100) até vir vazio. */
export async function* blingPaginar<T = any>(caminho: string, params: Record<string, string | number | undefined> = {}, limite = 100): AsyncGenerator<T[]> {
  let pagina = 1;
  for (;;) {
    const r = await blingGet<{ data: T[] }>(caminho, { ...params, pagina, limite });
    const dados = r?.data || [];
    if (!dados.length) return;
    yield dados;
    if (dados.length < limite) return;
    pagina += 1;
    if (pagina > 5000) return;
  }
}
