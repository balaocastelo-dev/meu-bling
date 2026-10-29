import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { arquivosPlugin } from './plugins/arquivos.js';
import autoload from '@fastify/autoload';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { env } from './lib/env.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import { prisma } from './lib/prisma.js';
import { chaveDoCabecalho, hashDaChave, limiteDaChaveEmCache } from './modules/api-externa/chaves.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Todas as rotas registradas (método + caminho) — usado pelo teste de robustez, que chama uma por uma. */
export const ROTAS_REGISTRADAS: { metodo: string; url: string }[] = [];

export async function construirApp() {
  const app = Fastify({
    logger: env.isProd
      ? { level: 'info' }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') ROTAS_REGISTRADAS.push({ metodo: m, url: r.url });
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  // CORS: em produção só a própria origem (APP_URL) + origens extras de CORS_ORIGENS; em dev libera localhost
  const origemDe = (u: string) => { try { return new URL(u).origin; } catch { return u; } };
  const origensPermitidas = [env.APP_URL, ...(process.env.CORS_ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean)].map(origemDe);
  await app.register(cors, {
    credentials: true,
    origin: (origem, cb) => {
      if (!origem) return cb(null, true); // mesma origem / curl
      if (!env.isProd || origensPermitidas.includes(origem) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem)) return cb(null, true);
      cb(new Error('Origem não permitida pelo CORS'), false);
    },
  });
  await app.register(cookie, { secret: env.APP_SECRET });
  // Limite de requisições POR USUÁRIO logado (todos os PCs da loja saem pelo mesmo IP; contar por IP
  // travaria a loja inteira num momento de movimento). Sem login, conta por IP.
  await app.register(rateLimit, {
    // chave de API: o limite é o da chave (Configurações → API e integrações); usuário logado: 1200/min
    max: (_req, chave) => (chave.startsWith('k:') ? (limiteDaChaveEmCache(chave.slice(2)) ?? 120) : 1200),
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      message: `Muitas requisições: o limite é ${ctx.max} por minuto. Tente de novo em ${ctx.after}.`,
      erro: `Muitas requisições: o limite é ${ctx.max} por minuto. Tente de novo em ${ctx.after}.`,
      code: 'LIMITE_REQUISICOES',
    }),
    keyGenerator: (req) => {
      const daChave = chaveDoCabecalho(req) ?? (/^\/api\/v1\/mcp\/(mb_[^/?#]+)/.exec(req.url)?.[1] || null);
      if (daChave) return `k:${hashDaChave(daChave)}`;
      const auth = req.headers.authorization || '';
      if (auth.startsWith('Bearer ')) {
        try {
          const corpo = app.jwt.verify<{ id?: number }>(auth.slice(7));
          if (corpo?.id) return `u:${corpo.id}`;
        } catch {
          /* token malformado: cai no IP */
        }
      }
      return `ip:${req.ip}`;
    },
  });
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
  // Chat da equipe em tempo real (WebSocket): registrado antes das rotas, como o plugin pede
  await app.register(websocket, { options: { maxPayload: 256 * 1024 } });
  await app.register(authPlugin);

  // Arquivos do storage (/uploads/*): logos públicos; anexos/DANFE/XML exigem sessão (cookie ou Bearer).
  // Pastas sensíveis (sessão do WhatsApp, temporários, importação) nunca são servidas.
  await app.register(arquivosPlugin);

  // Frontend compilado (produção): apps/web/dist
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: true,
      wildcard: true,
      cacheControl: false,
      setHeaders: (res, caminho) => {
        // assets com hash no nome podem ficar em cache; o index.html nunca (senão o deploy novo demora a aparecer)
        res.setHeader('Cache-Control', /\/assets\//.test(caminho) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        return reply.code(404).send({ erro: 'Rota não encontrada', code: 'NAO_ENCONTRADO' });
      }
      reply.header('Cache-Control', 'no-cache');
      return reply.sendFile('index.html');
    });
  }

  // Tratamento de erros padronizado (mensagens em português)
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ erro: err.message, code: err.code, detalhes: err.detalhes });
    }
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
      return reply.code(400).send({ erro: 'Dados inválidos: ' + issues.map((i) => `${i.campo || 'campo'}: ${i.mensagem}`).join('; '), code: 'VALIDACAO', detalhes: issues });
    }
    if (err?.code === 'P2002') {
      return reply.code(409).send({ erro: 'Já existe um registro com este valor único (' + (err.meta?.target || '') + ').', code: 'DUPLICADO' });
    }
    if (err?.code === 'P2025') {
      return reply.code(404).send({ erro: 'Registro não encontrado.', code: 'NAO_ENCONTRADO' });
    }
    if (err?.code === 'P2003') {
      return reply.code(409).send({ erro: 'Não é possível excluir: o registro está em uso por outros cadastros.', code: 'EM_USO' });
    }
    if (err?.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ erro: err.message, code: err.code || 'ERRO' });
    }
    // dado mal formado que escapou da validação (ex.: texto onde o banco espera número)
    if (err?.name === 'PrismaClientValidationError') {
      req.log.warn({ url: req.url, err: String(err.message).slice(-300) }, 'dado inválido chegou ao banco');
      return reply.code(400).send({ erro: 'Dados inválidos: confira os campos e tente de novo.', code: 'VALIDACAO' });
    }
    req.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno: ' + (err?.message || 'desconhecido'), code: 'INTERNO' });
  });

  // Código na URL (/vendas/:id, /comissoes/recalcular/:origemTipo/:id…) tem que ser número inteiro positivo:
  // "abc", "-1", "1.5" viram 400 com mensagem clara, em vez de estourar no banco.
  app.addHook('preValidation', async (req, reply) => {
    const params = (req.params || {}) as Record<string, string>;
    for (const [nome, valor] of Object.entries(params)) {
      if ((nome === 'id' || /Id$/.test(nome)) && !/^[1-9]\d{0,15}$/.test(String(valor))) {
        return reply.code(400).send({ erro: `Código inválido na URL (${nome} = "${valor}").`, code: 'ID_INVALIDO' });
      }
    }
  });

  app.get('/api/v1/saude', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, versao: '0.1.0', hora: new Date().toISOString() };
  });

  // Carrega automaticamente todos os módulos: src/modules/**/routes.ts
  await app.register(autoload, {
    dir: path.join(__dirname, 'modules'),
    matchFilter: (p) => /routes\.(ts|js)$/.test(p),
    dirNameRoutePrefix: false,
    forceESM: true,
  });

  // Integrações com inicialização própria (fila de notificações, WhatsApp, etc.)
  await app.register(autoload, {
    dir: path.join(__dirname, 'integracoes'),
    matchFilter: (p) => /routes\.(ts|js)$/.test(p),
    dirNameRoutePrefix: false,
    forceESM: true,
  });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
