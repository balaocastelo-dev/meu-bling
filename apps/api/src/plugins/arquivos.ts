/**
 * Servidor de arquivos do storage em /uploads/<pasta>/<arquivo>.
 *
 *  - logos/, consignados/         → público (páginas públicas, login, vitrine de consignados do site)
 *  - anexos/, danfe/, nfe/, pedidos/, chat/ → exige sessão válida: cookie `mb_token` (definido no login)
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

// consignados/: fotos dos equipamentos consignados (vitrine do site e link do consignante)
const PUBLICAS = new Set(['logos', 'consignados']);
// chat/: áudios e arquivos do chat da equipe (só quem está logado)
const PROTEGIDAS = new Set(['anexos', 'danfe', 'nfe', 'pedidos', 'chat']);

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.json': 'application/json',
  '.mp4': 'video/mp4', '.zip': 'application/zip', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.wav': 'audio/wav', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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

    if (!fs.existsSync(alvo)) return reply.code(404).send({ erro: 'Arquivo não encontrado', code: 'NAO_ENCONTRADO' });
    const st = fs.statSync(alvo);
    if (!st.isFile()) return reply.code(404).send({ erro: 'Arquivo não encontrado', code: 'NAO_ENCONTRADO' });
    const ext = path.extname(alvo).toLowerCase();
    // áudios do chat ficam em cache no navegador (o arquivo nunca muda); o resto, não
    reply.header('Cache-Control', PUBLICAS.has(pasta) ? 'public, max-age=3600' : pasta === 'chat' ? 'private, max-age=86400' : 'private, no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Accept-Ranges', 'bytes');
    reply.type(MIME[ext] || 'application/octet-stream');
    // Range: o player de áudio/vídeo (Safari exige) pede pedaços do arquivo para tocar e avançar
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && st.size > 0) {
      let inicio = range[1] ? Number(range[1]) : 0;
      let fim = range[2] ? Number(range[2]) : st.size - 1;
      if (!range[1] && range[2]) {
        inicio = Math.max(0, st.size - Number(range[2]));
        fim = st.size - 1;
      }
      if (inicio >= st.size || fim < inicio) {
        reply.header('Content-Range', `bytes */${st.size}`);
        return reply.code(416).send();
      }
      fim = Math.min(fim, st.size - 1);
      reply.code(206);
      reply.header('Content-Range', `bytes ${inicio}-${fim}/${st.size}`);
      reply.header('Content-Length', fim - inicio + 1);
      return reply.send(fs.createReadStream(alvo, { start: inicio, end: fim }));
    }
    reply.header('Content-Length', st.size);
    return reply.send(fs.createReadStream(alvo));
  });
});
