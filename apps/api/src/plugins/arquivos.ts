/**
 * Servidor de arquivos do storage em /uploads/<pasta>/<arquivo>.
 *
 *  - logos/                       → público (aparece nas páginas públicas e no login)
 *  - anexos/, danfe/, nfe/        → exige sessão válida: cookie `mb_token` (definido no login)
 *                                   ou cabeçalho Authorization: Bearer
 *  - whatsapp/, temp/, importacao/ e qualquer outra pasta → nunca servidos (404)
 *
 * Protege contra path traversal resolvendo o caminho dentro de STORAGE_DIR.
 */
import fp from 'fastify-plugin';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { env } from '../lib/env.js';

const PUBLICAS = new Set(['logos']);
const PROTEGIDAS = new Set(['anexos', 'danfe', 'nfe']);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.json': 'application/json',
  '.mp4': 'video/mp4', '.zip': 'application/zip', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const COOKIE_SESSAO = 'mb_token';
/** Caminho do cookie de sessão de arquivos (acompanha o BASE_PATH). */
export const COOKIE_PATH = `${env.BASE_PATH}/uploads`;

export const arquivosPlugin = fp(async function (app: FastifyInstance) {
  app.get('/uploads/*', async (req, reply) => {
    const rel = decodeURIComponent((req.params as any)['*'] || '');
    const raiz = path.resolve(env.STORAGE_DIR);
    const alvo = path.resolve(raiz, rel);
    if (!alvo.startsWith(raiz + path.sep)) return reply.code(404).send({ erro: 'Arquivo não encontrado', code: 'NAO_ENCONTRADO' });
    const pasta = path.relative(raiz, alvo).split(path.sep)[0];

    if (!PUBLICAS.has(pasta)) {
      if (!PROTEGIDAS.has(pasta)) return reply.code(404).send({ erro: 'Arquivo não encontrado', code: 'NAO_ENCONTRADO' });
      // exige sessão: Bearer ou cookie
      let autenticado = false;
      try {
        await req.jwtVerify();
        autenticado = true;
      } catch {
        const t = (req.cookies as any)?.[COOKIE_SESSAO];
        if (t) {
          try {
            app.jwt.verify(t);
            autenticado = true;
          } catch { /* inválido */ }
        }
      }
      if (!autenticado) return reply.code(401).send({ erro: 'Faça login para acessar este arquivo.', code: 'NAO_AUTENTICADO' });
    }

    if (!fs.existsSync(alvo) || !fs.statSync(alvo).isFile()) return reply.code(404).send({ erro: 'Arquivo não encontrado', code: 'NAO_ENCONTRADO' });
    const ext = path.extname(alvo).toLowerCase();
    reply.header('Cache-Control', PUBLICAS.has(pasta) ? 'public, max-age=3600' : 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.type(MIME[ext] || 'application/octet-stream').send(fs.createReadStream(alvo));
  });
});
