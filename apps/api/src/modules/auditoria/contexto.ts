/**
 * CONTEXTO DA OPERAÇÃO — quem está fazendo o quê, disponível em qualquer ponto do código
 * (sem passar `req` de mão em mão), por AsyncLocalStorage.
 *
 * - Cada requisição HTTP ganha um contexto no app.ts (depois da autenticação).
 * - Cada serviço de fundo (robôs, filas) ganha o seu em core/servicos.ts; os timers
 *   criados dentro dele herdam o contexto. Como um serviço roda para sempre, cada
 *   "rajada" de gravações vira uma operação nova (ver trilha.ts).
 * - A reversão pelo painel abre um contexto REVERSAO para a trilha saber que aquelas
 *   gravações desfazem outra operação.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export type OrigemOperacao = 'TELA' | 'API' | 'MCP' | 'SITE' | 'SERVICO' | 'REVERSAO' | 'SISTEMA';

export interface ContextoOperacao {
  /** id da operação (AuditoriaOperacao.id) */
  operacaoId: string;
  origem: OrigemOperacao;
  /** requisição (o usuário pode ser preenchido depois do onRequest) */
  req?: FastifyRequest;
  /** nome do serviço de fundo */
  servico?: string;
  /** usuário fixado à mão (reversão, scripts) */
  usuario?: { id: number | null; nome: string };
  /** "POST /api/v1/vendas/12" ou o nome do serviço */
  rota?: string;
  ip?: string | null;
  /** esta operação é a reversão da operação X */
  reverteOpId?: string;
  /** já gravei o cabeçalho AuditoriaOperacao desta operação */
  cabecalhoGravado?: boolean;
  /** quantos eventos esta operação já gravou (sequência) */
  eventos: number;
  /** serviços: hora da última gravação — passou de RAJADA_MS, começa outra operação */
  ultimaGravacao?: number;
  /** descrição vinda da auditoria legível (auditar) para compor o resumo */
  descricoes: string[];
}

const als = new AsyncLocalStorage<ContextoOperacao>();

export const novoId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);

export function contextoAtual(): ContextoOperacao | undefined {
  return als.getStore();
}

/** Executa `fn` dentro de um contexto novo (usado pelo app.ts, serviços e reversão). */
export function comContexto<T>(base: Omit<ContextoOperacao, 'operacaoId' | 'eventos' | 'descricoes'> & { operacaoId?: string }, fn: () => T): T {
  const ctx: ContextoOperacao = { eventos: 0, descricoes: [], ...base, operacaoId: base.operacaoId ?? novoId() };
  return als.run(ctx, fn);
}

/** Versão com callback (hooks do Fastify no estilo `done`). */
export function entrarNoContexto(base: Omit<ContextoOperacao, 'operacaoId' | 'eventos' | 'descricoes'>, done: () => void) {
  const ctx: ContextoOperacao = { eventos: 0, descricoes: [], ...base, operacaoId: novoId() };
  als.run(ctx, done);
}

/** serviço de fundo: gravações com mais de RAJADA_MS de intervalo são outra operação */
export const RAJADA_MS = 3000;
export function rotacionarSeRajada(ctx: ContextoOperacao) {
  const agora = Date.now();
  if ((ctx.origem === 'SERVICO' || ctx.origem === 'SISTEMA') && ctx.ultimaGravacao && agora - ctx.ultimaGravacao > RAJADA_MS) {
    ctx.operacaoId = novoId();
    ctx.cabecalhoGravado = false;
    ctx.eventos = 0;
    ctx.descricoes = [];
  }
  ctx.ultimaGravacao = agora;
}

/** Quem é o autor da operação neste instante (o usuário só existe depois do jwtVerify). */
export function autorDoContexto(ctx: ContextoOperacao | undefined): { id: number | null; nome: string; origem: OrigemOperacao; rota: string | null; ip: string | null } {
  if (!ctx) return { id: null, nome: 'Sistema', origem: 'SISTEMA', rota: null, ip: null };
  const req = ctx.req;
  if (ctx.usuario) {
    const rota = ctx.rota ?? (req ? `${req.method} ${req.url.split('?')[0]}` : null);
    return { id: ctx.usuario.id, nome: ctx.usuario.nome, origem: ctx.origem, rota, ip: ctx.ip ?? req?.ip ?? null };
  }
  if (req) {
    const chave = req.chaveApi;
    const rota = `${req.method} ${req.url.split('?')[0].replace(/\/mcp\/mb_[^/]+/, '/mcp/(chave)')}`;
    if (chave) return { id: req.user?.id ?? null, nome: `${chave.origem === 'MCP' ? 'Agente de IA (MCP)' : 'API'}: ${chave.nome}`, origem: chave.origem === 'MCP' ? 'MCP' : 'API', rota, ip: req.ip ?? null };
    if (/^\/api\/v1\/integracoes\/site\//.test(req.url)) return { id: null, nome: 'PDV do site', origem: 'SITE', rota, ip: req.ip ?? null };
    if (/^\/api\/v1\/publico\//.test(req.url)) return { id: null, nome: 'Cliente (link público)', origem: 'SITE', rota, ip: req.ip ?? null };
    const u = req.user;
    return { id: u?.id ?? null, nome: u?.nome?.trim() || 'Sem login', origem: 'TELA', rota, ip: req.ip ?? null };
  }
  return { id: null, nome: ctx.servico ? `Serviço: ${nomeAmigavelServico(ctx.servico)}` : 'Sistema', origem: ctx.origem, rota: ctx.rota ?? ctx.servico ?? null, ip: null };
}

const NOMES_SERVICO: Record<string, string> = {
  'robo-saude': 'Robô da Saúde',
  'robo-nf': 'Robô de NF',
  'consignacao-robo': 'Robô da consignação',
  'fila-notificacoes': 'Fila de mensagens',
  'lembrete-contas': 'Lembrete de contas',
  'open-finance-sync': 'Open Finance',
  'desafios-de-vendas': 'Desafios de vendas',
  'catalogo-do-site': 'Catálogo do site',
  'fiscal-processando': 'Retorno da SEFAZ',
  whatsapp: 'WhatsApp',
  'webhooks-de-saida': 'Webhooks',
  'diagnostico-diario': 'Diagnóstico diário',
  'limpeza-registro-api': 'Limpeza do registro da API',
  'agentes-auditoria': 'Agentes de auditoria',
};
export function nomeAmigavelServico(s: string) {
  return NOMES_SERVICO[s] ?? s;
}
