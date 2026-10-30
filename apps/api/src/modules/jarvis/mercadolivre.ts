/**
 * MERCADO LIVRE — OAuth e publicação (docs/JARVIS.md §8)
 *
 * O Thiago cria a aplicação em developers.mercadolivre.com.br e cola Client ID e
 * Client Secret em Configurações → JARVIS. O Secret fica criptografado no banco,
 * nunca em arquivo, nunca no log.
 *
 * Detalhe do ML que já derrubou muita integração: o refresh token é de USO ÚNICO.
 * A cada renovação vem um novo, e se o novo não for gravado a conexão morre na
 * renovação seguinte — por isso o refresh grava os dois tokens na mesma operação.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { env } from '../../lib/env.js';

const API = 'https://api.mercadolibre.com';
const AUTORIZAR = 'https://auth.mercadolivre.com.br/authorization';
const SITE = 'MLB'; // Brasil

export interface ContaMl {
  conectado: boolean;
  configurado: boolean;
  userId?: string | null;
  apelido?: string | null;
  expiraEm?: Date | null;
  precisaReconectar?: boolean;
}

export function urlCallback(): string {
  const base = env.APP_URL.replace(/\/$/, '');
  const prefixo = env.BASE_PATH ? env.BASE_PATH.replace(/\/$/, '') : '';
  return `${base}${prefixo}/api/v1/jarvis/ml/callback`;
}

async function config() {
  const c = await prisma.jarvisConfig.findUnique({ where: { id: 1 } });
  if (!c) throw new AppError('Configuração do JARVIS não encontrada.', 422, 'SEM_CONFIG');
  return c;
}

export async function situacao(): Promise<ContaMl> {
  const c = await prisma.jarvisConfig.findUnique({ where: { id: 1 } });
  const configurado = !!(c?.mlClientId && c?.mlClientSecret);
  if (!c || !configurado) return { conectado: false, configurado: false };
  return {
    conectado: !!c.mlRefreshToken,
    configurado: true,
    userId: c.mlUserId,
    apelido: c.mlApelido,
    expiraEm: c.mlExpiraEm,
    // o refresh do ML dura 6 meses; sem access token válido e sem refresh, precisa reconectar
    precisaReconectar: !!c.mlRefreshToken && !c.mlAccessToken,
  };
}

/** URL para o Thiago autorizar a aplicação na conta dele. */
export async function urlAutorizacao(): Promise<string> {
  const c = await config();
  if (!c.mlClientId) throw new AppError('Cadastre o Client ID do Mercado Livre antes de conectar.', 422, 'SEM_CLIENT_ID');
  const p = new URLSearchParams({ response_type: 'code', client_id: c.mlClientId, redirect_uri: urlCallback() });
  return `${AUTORIZAR}?${p.toString()}`;
}

async function trocarToken(corpo: Record<string, string>) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(corpo),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    // a mensagem do ML costuma dizer exatamente o que está errado; repassamos
    throw new AppError(`O Mercado Livre recusou: ${j.message || j.error || r.status}`, 502, 'ML_OAUTH');
  }
  return j as { access_token: string; refresh_token: string; expires_in: number; user_id: number };
}

/** Callback do OAuth: troca o code pelos tokens e guarda criptografado. */
export async function conectar(code: string) {
  const c = await config();
  const clientId = c.mlClientId;
  const secret = decrypt(c.mlClientSecret);
  if (!clientId || !secret) throw new AppError('Cadastre Client ID e Client Secret antes de conectar.', 422, 'SEM_CREDENCIAL');

  const t = await trocarToken({
    grant_type: 'authorization_code', client_id: clientId, client_secret: secret,
    code, redirect_uri: urlCallback(),
  });

  let apelido: string | null = null;
  try {
    const r = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` } });
    if (r.ok) apelido = ((await r.json()) as any)?.nickname ?? null;
  } catch { /* o apelido é só enfeite na tela */ }

  await prisma.jarvisConfig.update({
    where: { id: 1 },
    data: {
      mlAccessToken: encrypt(t.access_token),
      mlRefreshToken: encrypt(t.refresh_token),
      mlExpiraEm: new Date(Date.now() + (t.expires_in ?? 21600) * 1000),
      mlUserId: String(t.user_id ?? ''),
      mlApelido: apelido,
    },
  });
  return { userId: String(t.user_id ?? ''), apelido };
}

/**
 * Devolve um access token válido, renovando quando faltar menos de 10 minutos.
 * Grava o NOVO refresh token: o antigo deixa de valer assim que é usado.
 */
export async function tokenValido(): Promise<string> {
  const c = await config();
  const access = decrypt(c.mlAccessToken);
  const refresh = decrypt(c.mlRefreshToken);
  if (!refresh) throw new AppError('Conecte a conta do Mercado Livre em Configurações → JARVIS.', 422, 'ML_NAO_CONECTADO');

  const folga = 10 * 60 * 1000;
  if (access && c.mlExpiraEm && c.mlExpiraEm.getTime() - Date.now() > folga) return access;

  const clientId = c.mlClientId;
  const secret = decrypt(c.mlClientSecret);
  if (!clientId || !secret) throw new AppError('Client ID/Secret do Mercado Livre não estão configurados.', 422, 'SEM_CREDENCIAL');

  const t = await trocarToken({ grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: refresh });
  await prisma.jarvisConfig.update({
    where: { id: 1 },
    data: {
      mlAccessToken: encrypt(t.access_token),
      mlRefreshToken: encrypt(t.refresh_token), // uso único: o novo precisa ser gravado
      mlExpiraEm: new Date(Date.now() + (t.expires_in ?? 21600) * 1000),
    },
  });
  return t.access_token;
}

export async function desconectar() {
  // upsert: desconectar pode ser a primeira coisa que toca a configuração (banco novo)
  const limpo = { mlAccessToken: null, mlRefreshToken: null, mlExpiraEm: null, mlUserId: null, mlApelido: null };
  await prisma.jarvisConfig.upsert({ where: { id: 1 }, update: limpo, create: { id: 1, ...limpo } });
}

async function chamar<T>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  const token = await tokenValido();
  const r = await fetch(`${API}${caminho}`, {
    method: opcoes.metodo ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    // o ML devolve "cause" com o que falta (atributo obrigatório, foto, categoria):
    // repassamos isso para a tela em vez de um "erro 400" seco
    const causas = Array.isArray(j?.cause) ? j.cause.map((x: any) => x?.message || x?.code).filter(Boolean).join('; ') : '';
    throw new AppError(`Mercado Livre: ${causas || j?.message || `erro ${r.status}`}`, 502, 'ML_API');
  }
  return j as T;
}

/** Descobre a categoria pelo título (o ML exige category_id para publicar). */
export async function descobrirCategoria(titulo: string): Promise<{ id: string; nome: string } | null> {
  const r = await chamar<any[]>(`/sites/${SITE}/domain_discovery/search?limit=1&q=${encodeURIComponent(titulo)}`);
  const p = Array.isArray(r) ? r[0] : null;
  return p?.category_id ? { id: p.category_id, nome: p.category_name ?? p.domain_name ?? '' } : null;
}

export interface ResultadoPublicacao { id: string; permalink: string; categoria: string }

/** Publica o anúncio como item no Mercado Livre. */
export async function publicarItem(p: {
  titulo: string; descricao: string; preco: number; condicao: 'novo' | 'usado';
  quantidade?: number; fotos: string[]; categoriaId?: string | null; listingType?: string;
}): Promise<ResultadoPublicacao> {
  // A conta vem PRIMEIRO: sem ela ligada, não adianta mandar cadastrar foto — o que falta é conectar.
  // (Antes o "sem foto" vinha antes e escondia o motivo real, virando ERRO em vez de PRECISA_CONFIGURAR.)
  await tokenValido();
  if (!p.fotos.length) {
    throw new AppError('O Mercado Livre não aceita anúncio sem foto. Cadastre uma imagem no produto.', 422, 'SEM_FOTO');
  }
  const titulo = p.titulo.slice(0, 60); // limite do ML
  const categoria = p.categoriaId ?? (await descobrirCategoria(titulo))?.id;
  if (!categoria) {
    throw new AppError('Não consegui descobrir a categoria no Mercado Livre por esse título. Tente um título mais específico.', 422, 'SEM_CATEGORIA');
  }

  const item = await chamar<any>('/items', {
    metodo: 'POST',
    corpo: {
      title: titulo,
      category_id: categoria,
      price: p.preco,
      currency_id: 'BRL',
      available_quantity: p.quantidade ?? 1,
      buying_mode: 'buy_it_now',
      condition: p.condicao === 'usado' ? 'used' : 'new',
      listing_type_id: p.listingType ?? 'gold_special',
      pictures: p.fotos.map((u) => ({ source: u })),
      sale_terms: [
        { id: 'WARRANTY_TYPE', value_name: 'Garantia do vendedor' },
        { id: 'WARRANTY_TIME', value_name: p.condicao === 'usado' ? '3 meses' : '12 meses' },
      ],
    },
  });

  // descrição vai numa chamada separada, em texto puro (o ML recusa HTML aqui)
  try {
    await chamar(`/items/${item.id}/description`, { metodo: 'POST', corpo: { plain_text: p.descricao.slice(0, 50000) } });
  } catch { /* o item já existe; descrição falha não desfaz a publicação */ }

  return { id: String(item.id), permalink: String(item.permalink ?? ''), categoria };
}
