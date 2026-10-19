import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';
import { Forbidden } from '../lib/errors.js';
import { permitido, CAMPOS_EMPRESA_ADMIN } from './politicas.js';

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
  });

  // GERENTE pode editar dados básicos da empresa, mas não campos fiscais/segredos (somente ADMIN)
  app.addHook('preHandler', async (req) => {
    const url = req.url.split('?')[0];
    if (req.method === 'PUT' && url === '/api/v1/empresa' && req.user && req.user.perfil !== 'ADMIN' && req.body && typeof req.body === 'object') {
      for (const campo of CAMPOS_EMPRESA_ADMIN) delete (req.body as any)[campo];
    }
  });
});
