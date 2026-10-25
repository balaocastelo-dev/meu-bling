/**
 * Chaves de API: geração, conferência (com cache curto), limite por minuto e registro de cada chamada.
 *
 * Formato: "mb_" + 48 caracteres hexadecimais. No banco fica só o sha256 (ChaveApi.hash) e o começo
 * (prefixo) para o ADMIN reconhecer na lista — a chave inteira aparece uma única vez, ao criar.
 *
 * Como o sistema chamador manda a chave (qualquer um dos três):
 *   X-API-Key: mb_...
 *   Authorization: Bearer mb_...
 *   /api/v1/mcp/mb_...   (só se a chave tiver "permitir na URL", para conectores de IA sem cabeçalho)
 */
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { lerPermissoes, type Permissoes } from './recursos.js';

export const PREFIXO_CHAVE = 'mb_';
const FORMATO = /^mb_[0-9a-f]{48}$/;

export interface ChaveAtiva {
  id: number;
  nome: string;
  permissoes: Permissoes;
  ips: string[];
  limitePorMinuto: number;
  permitirNaUrl: boolean;
  expiraEm: Date | null;
  ativo: boolean;
  criadoPorId: number | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** preenchido quando a chamada veio com chave de API */
    chaveApi?: { id: number; nome: string; permissoes: Permissoes; bruta: string; origem: 'API' | 'MCP' };
  }
}

export function gerarChave(): { chave: string; prefixo: string; hash: string } {
  const chave = PREFIXO_CHAVE + crypto.randomBytes(24).toString('hex');
  return { chave, prefixo: chave.slice(0, 11), hash: hashDaChave(chave) };
}

export function hashDaChave(chave: string): string {
  return crypto.createHash('sha256').update(chave).digest('hex');
}

export function pareceChave(v: string | null | undefined): v is string {
  return !!v && FORMATO.test(v);
}

/** Chave mandada no cabeçalho (X-API-Key ou Bearer mb_...). */
export function chaveDoCabecalho(req: FastifyRequest): string | null {
  const x = req.headers['x-api-key'];
  const xv = Array.isArray(x) ? x[0] : x;
  if (xv && xv.trim()) return xv.trim();
  const m = /^Bearer\s+(mb_\S+)$/i.exec(String(req.headers.authorization || ''));
  return m ? m[1] : null;
}

/** Chave dentro da URL do MCP (/api/v1/mcp/mb_...). */
export function chaveDaUrl(url: string): string | null {
  const m = /^\/api\/v1\/mcp\/(mb_[^/?#]+)/.exec(url);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- cache (30 s)
const cache = new Map<string, { quando: number; chave: ChaveAtiva | null }>();
const VALIDADE_CACHE = 30_000;

export function limparCacheChaves() {
  cache.clear();
}

export async function buscarChave(hash: string): Promise<ChaveAtiva | null> {
  const c = cache.get(hash);
  if (c && Date.now() - c.quando < VALIDADE_CACHE) return c.chave;
  const r = await prisma.chaveApi.findUnique({ where: { hash } });
  // a chave age em nome de quem a criou; se esse usuário saiu ou deixou de ser ADMIN, usa um ADMIN ativo
  let agente = r?.criadoPorId ? await prisma.usuario.findFirst({ where: { id: r.criadoPorId, ativo: true, perfil: 'ADMIN' }, select: { id: true } }) : null;
  if (r && !agente) agente = await prisma.usuario.findFirst({ where: { ativo: true, perfil: 'ADMIN' }, orderBy: { id: 'asc' }, select: { id: true } });
  const chave: ChaveAtiva | null = r
    ? {
        id: r.id,
        nome: r.nome,
        permissoes: lerPermissoes(r.permissoes),
        ips: (r.ipsPermitidos || '').split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean),
        limitePorMinuto: r.limitePorMinuto,
        permitirNaUrl: r.permitirNaUrl,
        expiraEm: r.expiraEm,
        ativo: r.ativo,
        criadoPorId: agente?.id ?? null,
      }
    : null;
  if (cache.size > 500) cache.clear();
  cache.set(hash, { quando: Date.now(), chave });
  return chave;
}

/** Limite por minuto da chave (usado pelo @fastify/rate-limit). */
export function limiteDaChaveEmCache(hash: string): number | null {
  return cache.get(hash)?.chave?.limitePorMinuto ?? null;
}

export type ResultadoChave = { ok: true; chave: ChaveAtiva } | { ok: false; status: number; code: string; erro: string };

const ipNormal = (ip: string) => ip.replace(/^::ffff:/, '');

/** Confere a chave: existe, ativa, dentro da validade, IP liberado e (se veio na URL) se pode vir na URL. */
export async function conferirChave(bruta: string, ip: string, naUrl: boolean): Promise<ResultadoChave> {
  if (!pareceChave(bruta)) return { ok: false, status: 401, code: 'CHAVE_INVALIDA', erro: 'Chave de API inválida.' };
  const chave = await buscarChave(hashDaChave(bruta));
  if (!chave) return { ok: false, status: 401, code: 'CHAVE_INVALIDA', erro: 'Chave de API inválida ou excluída.' };
  if (!chave.ativo) return { ok: false, status: 401, code: 'CHAVE_INATIVA', erro: `A chave "${chave.nome}" está desativada.` };
  if (chave.expiraEm && chave.expiraEm.getTime() < Date.now()) return { ok: false, status: 401, code: 'CHAVE_VENCIDA', erro: `A chave "${chave.nome}" venceu. Gere outra em Configurações → API e integrações.` };
  if (naUrl && !chave.permitirNaUrl) {
    return { ok: false, status: 401, code: 'CHAVE_NA_URL', erro: `A chave "${chave.nome}" não pode ir dentro do endereço. Mande no cabeçalho (X-API-Key) ou ligue "permitir na URL" na chave.` };
  }
  if (chave.ips.length && !chave.ips.map(ipNormal).includes(ipNormal(ip))) {
    return { ok: false, status: 403, code: 'IP_NAO_PERMITIDO', erro: `O IP ${ipNormal(ip)} não está liberado para a chave "${chave.nome}".` };
  }
  return { ok: true, chave };
}

// ---------------------------------------------------------------- registro de uso
/** Grava a chamada no log e atualiza "último uso" (nunca derruba a requisição). */
export async function registrarChamada(dados: { chaveId: number; metodo: string; rota: string; status: number; ms: number; ip: string; origem: string; erro?: string | null }) {
  try {
    await prisma.logApi.create({
      data: {
        chaveId: dados.chaveId,
        metodo: dados.metodo,
        rota: dados.rota.slice(0, 500),
        status: dados.status,
        ms: Math.max(0, Math.round(dados.ms)),
        ip: dados.ip,
        origem: dados.origem,
        erro: dados.erro ? dados.erro.slice(0, 500) : null,
      },
    });
    await prisma.chaveApi.update({
      where: { id: dados.chaveId },
      data: { ultimoUsoEm: new Date(), ultimoIp: dados.ip, totalChamadas: { increment: 1 } },
    });
  } catch {
    /* chave excluída no meio da chamada, banco ocupado… o log é melhor-esforço */
  }
}

/** Apaga registros de chamadas com mais de `dias` dias. */
export async function limparLogsAntigos(dias = 30) {
  const limite = new Date(Date.now() - dias * 86_400_000);
  const r = await prisma.logApi.deleteMany({ where: { data: { lt: limite } } });
  return r.count;
}
