import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import autoload from '@fastify/autoload';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { env } from './lib/env.js';
import { AppError } from './lib/errors.js';
import authPlugin from './plugins/auth.js';
import { prisma } from './lib/prisma.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function construirApp() {
  const app = Fastify({
    logger: env.isProd
      ? { level: 'info' }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024 } });
  await app.register(authPlugin);

  // Arquivos públicos (logos, anexos de OS, DANFEs)
  await app.register(fastifyStatic, {
    root: env.STORAGE_DIR,
    prefix: '/uploads/',
    decorateReply: false,
  });

  // Frontend compilado (produção): apps/web/dist
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: true, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) {
        return reply.code(404).send({ erro: 'Rota não encontrada', code: 'NAO_ENCONTRADO' });
      }
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
    req.log.error(err);
    return reply.code(500).send({ erro: 'Erro interno: ' + (err?.message || 'desconhecido'), code: 'INTERNO' });
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
