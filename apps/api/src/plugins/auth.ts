import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';
import { Forbidden } from '../lib/errors.js';
import { permitido, CAMPOS_EMPRESA_ADMIN } from './politicas.js';
import { chaveDaUrl, chaveDoCabecalho, conferirChave, registrarChamada } from '../modules/api-externa/chaves.js';
import { chavePode } from '../modules/api-externa/recursos.js';
import { acessoNota, acessoVenda, CODIGO_VENDA_DE_OUTRO } from '../modules/comum/escopo-vendas.js';

export type Perfil = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'TECNICO' | 'FINANCEIRO';

export interface UsuarioJwt {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  vendedorId?: number | null;
  tecnicoId?: number | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UsuarioJwt;
    user: UsuarioJwt;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: exige token válido */
    autenticar: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: exige um dos perfis */
    exigirPerfil: (...perfis: Perfil[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Rotas públicas (sem token) */
const ROTAS_PUBLICAS = [
  /^\/api\/v1\/auth\/login$/,
  /^\/api\/v1\/saude$/,
  /^\/api\/v1\/publico\//,
  /^\/api\/v1\/webhooks\//,
  // porta do site (PDV): não usa login, exige a chave do site (modules/site/routes.ts)
  /^\/api\/v1\/integracoes\/site\//,
  // WebSocket do chat da equipe: o navegador não manda cabeçalho; autentica pela 1ª mensagem (modules/chat/routes.ts)
  /^\/api\/v1\/chat\/ws$/,
  /^\/uploads\//,
  /^\/$/,
];

export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(jwt, { secret: env.JWT_SECRET, sign: { expiresIn: '12h' } });

  app.decorate('autenticar', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ erro: 'Não autenticado. Faça login novamente.', code: 'NAO_AUTENTICADO' });
    }
  });

  app.decorate('exigirPerfil', (...perfis: Perfil[]) => {
    return async (req: FastifyRequest) => {
      const u = req.user;
      if (!u) throw new Forbidden();
      if (u.perfil === 'ADMIN') return;
      if (!perfis.includes(u.perfil)) throw new Forbidden();
    };
  });

  // Autenticação global: tudo em /api/* exige token, exceto rotas públicas.
  // Em seguida, a política central por perfil (plugins/politicas.ts).
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/')) return;
    if (ROTAS_PUBLICAS.some((r) => r.test(url))) return;

    // ---- chamada de outro sistema / agente de IA com chave de API (Configurações → API e integrações)
    const doCabecalho = chaveDoCabecalho(req);
    const daUrl = doCabecalho ? null : chaveDaUrl(url);
    const bruta = doCabecalho ?? daUrl;
    if (bruta) {
      const r = await conferirChave(bruta, req.ip, !!daUrl);
      if (!r.ok) return reply.code(r.status).send({ erro: r.erro, code: r.code });
      const origem = String(req.headers['x-meubling-origem'] || '').toLowerCase() === 'mcp' || /^\/api\/v1\/mcp(\/|$)/.test(url) ? 'MCP' : 'API';
      req.chaveApi = { id: r.chave.id, nome: r.chave.nome, permissoes: r.chave.permissoes, bruta, origem };
      // a chave age em nome do ADMIN que a criou (auditoria e histórico mostram "API: <nome>")
      req.user = { id: r.chave.criadoPorId as number, nome: `API: ${r.chave.nome}`, email: 'api@meubling', perfil: 'ADMIN', vendedorId: null, tecnicoId: null };
      const decisao = chavePode(r.chave.permissoes, req.method, url.replace(/^\/api\/v1/, ''));
      if (!decisao.ok) {
        (req as any).motivoNegado = decisao.motivo;
        return reply.code(403).send({ erro: decisao.motivo, code: 'CHAVE_SEM_PERMISSAO', detalhes: { recurso: decisao.recurso, exigido: decisao.exigido } });
      }
      return;
    }

    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ erro: 'Não autenticado. Faça login novamente.', code: 'NAO_AUTENTICADO' });
    }
    const rota = url.replace(/^\/api\/v1/, '');
    if (!permitido(req.user?.perfil, req.method, rota)) {
      return reply.code(403).send({
        erro: `Seu perfil (${req.user?.perfil}) não tem permissão para esta função. Peça ao administrador.`,
        code: 'SEM_PERMISSAO',
      });
    }
    // vendedor/técnico só acessam as próprias vendas (29/10/2026): vale para qualquer rota /vendas/:id...
    // de qualquer módulo (venda, documentos, carnê, robô de NF) e para a nota fiscal ligada a uma venda
    const venda = rota.match(/^\/vendas\/(\d+)(\/|$)/);
    const nota = venda ? null : rota.match(/^\/notas-fiscais\/(\d+)(\/|$)/);
    if (venda || nota) {
      const r = venda ? await acessoVenda(req.user, Number(venda[1])) : await acessoNota(req.user, Number(nota![1]));
      if (!r.ok) return reply.code(403).send({ erro: r.erro, code: CODIGO_VENDA_DE_OUTRO });
    }
  });

  // registro de cada chamada feita com chave de API (tela API e integrações → Registro de chamadas)
  app.addHook('onResponse', async (req, reply) => {
    const c = req.chaveApi;
    if (!c) return;
    const url = req.url.split('?')[0].replace(/\/mcp\/mb_[^/]+/, '/mcp/(chave)');
    void registrarChamada({
      chaveId: c.id,
      metodo: req.method,
      rota: url.replace(/^\/api\/v1/, '') + (req.url.includes('?') ? '?' + req.url.split('?')[1].slice(0, 200) : ''),
      status: reply.statusCode,
      ms: reply.elapsedTime,
      ip: req.ip,
      origem: c.origem,
      erro: (req as any).motivoNegado ?? null,
    });
  });

  // GERENTE pode editar dados básicos da empresa, mas não campos fiscais/segredos (somente ADMIN)
  app.addHook('preHandler', async (req) => {
    const url = req.url.split('?')[0];
    if (req.method === 'PUT' && url === '/api/v1/empresa' && req.user && req.user.perfil !== 'ADMIN' && req.body && typeof req.body === 'object') {
      for (const campo of CAMPOS_EMPRESA_ADMIN) delete (req.body as any)[campo];
    }
  });
});
