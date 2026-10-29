/**
 * CHAT DA EQUIPE — caixa de entrada, salas de reunião, texto, áudio gravado, arquivos,
 * chamadas de voz/vídeo (WebRTC) e avisos no celular (Web Push). Tudo dentro do sistema, só com o navegador.
 *
 *   GET    /api/v1/chat/config                      onde ligar o tempo real, STUN/TURN, chave do push
 *   GET    /api/v1/chat/ws                           WebSocket (autentica pela 1ª mensagem {tipo:'auth', token})
 *   GET    /api/v1/chat/eventos?desde=N              long polling (quando o WebSocket não passa pelo proxy)
 *   GET    /api/v1/chat/usuarios                     colegas (todos os usuários ativos) com presença
 *   GET    /api/v1/chat/nao-lidas                    total de não lidas (sino do topo / Meu Dashboard)
 *   GET    /api/v1/chat/conversas?todas=1            caixa de entrada (todas=1: ADMIN lê qualquer conversa)
 *   POST   /api/v1/chat/conversas                    { tipo:'DIRETA', usuarioId } | { tipo:'SALA', nome, usuarioIds }
 *   GET    /api/v1/chat/conversas/:id
 *   PUT    /api/v1/chat/conversas/:id                { nome }  (renomear sala)
 *   POST   /api/v1/chat/conversas/:id/participantes  { usuarioIds }
 *   DELETE /api/v1/chat/conversas/:id/participantes/:usuarioId   (ou o próprio id = sair)
 *   POST   /api/v1/chat/conversas/:id/silenciar      { ate: data|null }
 *   GET    /api/v1/chat/conversas/:id/mensagens?antesDe=&limite=
 *   POST   /api/v1/chat/conversas/:id/mensagens      { texto, respondeAId? }
 *   POST   /api/v1/chat/conversas/:id/audio          multipart: arquivo (+ campo duracaoSeg)
 *   POST   /api/v1/chat/conversas/:id/arquivo        multipart: arquivo (imagem ou PDF)
 *   POST   /api/v1/chat/conversas/:id/lida           { ateId? }
 *   POST   /api/v1/chat/conversas/:id/digitando
 *   DELETE /api/v1/chat/mensagens/:id
 *   POST   /api/v1/chat/conversas/:id/chamadas       { tipo:'VOZ'|'VIDEO' }
 *   GET    /api/v1/chat/chamadas/ativas
 *   POST   /api/v1/chat/chamadas/:id/entrar · /recusar · /sair
 *   POST   /api/v1/chat/chamadas/:id/rtc             { para, dados }   (sinalização também vai pelo WebSocket)
 *   POST   /api/v1/chat/push/assinar                 { subscription }  ·  POST /push/cancelar { endpoint }
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { registrarServico } from '../../core/servicos.js';
import { idDe } from '../comum/zod.js';
import type { UsuarioJwt } from '../../plugins/auth.js';
import * as hub from './hub.js';
import * as svc from './service.js';
import { prepararPush } from './push.js';

const AUTH_TIMEOUT_MS = 8000;

export default async function chatRoutes(app: FastifyInstance) {
  registrarServico('chat da equipe', async () => {
    hub.iniciarPing();
    await prepararPush();
    const n = await svc.encerrarChamadasPenduradas();
    if (n) app.log.info(`[chat] ${n} chamada(s) pendurada(s) encerrada(s) ao subir`);
  });

  // ------------------------------------------------------------------ configuração
  app.get('/api/v1/chat/config', async (req) => svc.configChat(req.user));

  // ------------------------------------------------------------------ WebSocket
  app.route({
    method: 'GET',
    url: '/api/v1/chat/ws',
    // GET comum (sem upgrade): só informa (com login); o navegador liga por WebSocket
    handler: async (req, reply) => {
      try {
        await req.jwtVerify();
      } catch {
        return reply.code(401).send({ erro: 'Não autenticado. Faça login novamente.', code: 'NAO_AUTENTICADO' });
      }
      return { ok: true, protocolo: 'websocket', info: 'Ligue por WebSocket e mande {"tipo":"auth","token":"<jwt>"} como primeira mensagem.' };
    },
    wsHandler: (socket: WebSocket, req) => {
      let usuario: UsuarioJwt | null = null;
      let conexao: ReturnType<typeof hub.conectar> | null = null;
      // origem: só o próprio sistema (CORS não protege WebSocket)
      const origem = String(req.headers.origin || '');
      if (origem && !origemPermitida(origem)) {
        socket.close(4403, 'Origem não permitida');
        return;
      }
      const prazo = setTimeout(() => {
        if (!usuario) socket.close(4401, 'Não autenticado');
      }, AUTH_TIMEOUT_MS);

      socket.on('pong', () => {
        if (conexao) conexao.vivo = true;
      });
      socket.on('message', (raw) => {
        void (async () => {
          let msg: any;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (!msg || typeof msg !== 'object') return;
          if (!usuario) {
            if (msg.tipo !== 'auth' || typeof msg.token !== 'string') return;
            try {
              const u = app.jwt.verify<UsuarioJwt>(msg.token);
              const ativo = await prisma.usuario.findUnique({ where: { id: u.id }, select: { ativo: true, nome: true, perfil: true } });
              if (!ativo?.ativo) throw new Error('inativo');
              usuario = { ...u, nome: ativo.nome, perfil: ativo.perfil as any };
            } catch {
              socket.close(4401, 'Token inválido');
              return;
            }
            clearTimeout(prazo);
            conexao = hub.conectar(socket, usuario.id, usuario.nome);
            const [online, chamadas, naoLidas] = await Promise.all([hub.onlineAgora(), svc.chamadasAtivas(usuario.id), svc.contarNaoLidas(usuario.id)]);
            socket.send(JSON.stringify({ tipo: 'pronto', usuarioId: usuario.id, online, chamadas, naoLidas: naoLidas.total }));
            return;
          }
          switch (msg.tipo) {
            case 'ping':
              socket.send(JSON.stringify({ tipo: 'pong', em: Date.now() }));
              break;
            case 'estado':
              if (conexao && ['online', 'ausente', 'ocupado'].includes(msg.valor)) hub.mudarEstado(conexao, msg.valor);
              break;
            case 'digitando':
              if (Number.isInteger(msg.conversaId)) await svc.digitando(Number(msg.conversaId), usuario);
              break;
            case 'rtc':
              if (Number.isInteger(msg.chamadaId) && Number.isInteger(msg.para)) await svc.repassarRtc(usuario, Number(msg.chamadaId), Number(msg.para), msg.dados);
              break;
            case 'lida':
              if (Number.isInteger(msg.conversaId)) await svc.marcarLida(Number(msg.conversaId), usuario, Number.isInteger(msg.ateId) ? Number(msg.ateId) : undefined).catch(() => undefined);
              break;
            default:
              break;
          }
        })().catch((e) => req.log.warn({ e: String(e) }, '[chat] erro ao tratar mensagem do WebSocket'));
      });
      socket.on('close', () => {
        clearTimeout(prazo);
        if (conexao) hub.desconectar(conexao);
        conexao = null;
      });
      socket.on('error', () => {
        /* o close cuida */
      });
    },
  });

  function origemPermitida(origem: string) {
    const permitidas = [process.env.APP_URL || '', ...(process.env.CORS_ORIGENS || '').split(',')]
      .map((s) => s.trim())
      .filter(Boolean)
      .map((u) => {
        try {
          return new URL(u).origin;
        } catch {
          return u;
        }
      });
    if (process.env.NODE_ENV !== 'production') return true;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem)) return true;
    return permitidas.includes(origem);
  }

  // ------------------------------------------------------------------ long polling (reserva)
  app.get('/api/v1/chat/eventos', async (req, reply) => {
    const q = z.object({ desde: z.coerce.number().int().min(0).default(0), espera: z.coerce.number().int().min(0).max(30_000).default(25_000) }).parse(req.query);
    reply.header('Cache-Control', 'no-store');
    return svc.contarNaoLidas(req.user.id).then(async (nl) => {
      const r = await hub.esperarEventos(req.user.id, q.desde, q.espera);
      return { ...r, naoLidas: nl.total, online: hub.onlineAgora() };
    });
  });

  // ------------------------------------------------------------------ pessoas e caixa de entrada
  app.get('/api/v1/chat/usuarios', async (req) => svc.listarColegas(req.user.id));

  app.get('/api/v1/chat/nao-lidas', async (req) => svc.contarNaoLidas(req.user.id));

  app.get('/api/v1/chat/conversas', async (req) => {
    const q = z.object({ todas: z.coerce.string().optional() }).parse(req.query);
    return svc.listarConversas(req.user, q.todas === '1' || q.todas === 'true');
  });

  app.post('/api/v1/chat/conversas', async (req, reply) => {
    const b = z
      .discriminatedUnion('tipo', [
        z.object({ tipo: z.literal('DIRETA'), usuarioId: z.coerce.number().int().positive() }),
        z.object({ tipo: z.literal('SALA'), nome: z.string().trim().min(2, 'Dê um nome à sala.').max(80), usuarioIds: z.array(z.coerce.number().int().positive()).min(1, 'Escolha as pessoas da sala.').max(100) }),
      ])
      .parse(req.body);
    if (b.tipo === 'DIRETA') {
      const c = await svc.abrirDireta(req.user, b.usuarioId);
      return reply.code(c.nova ? 201 : 200).send(c);
    }
    const c = await svc.criarSala(req.user, b.nome, b.usuarioIds);
    await auditar(req, 'Conversa', c.id, 'CRIAR', { tipo: 'SALA', nome: b.nome, pessoas: b.usuarioIds.length });
    return reply.code(201).send(c);
  });

  app.get('/api/v1/chat/conversas/:id', async (req) => {
    const id = idDe(req);
    const { conversa } = await svc.carregarConversa(id, req.user);
    const nl = await svc.contarNaoLidas(req.user.id);
    return { ...svc.resumoConversa(conversa, req.user.id), naoLidas: nl.porConversa[id] ?? 0, criadoPor: conversa.criadoPor };
  });

  app.put('/api/v1/chat/conversas/:id', async (req) => {
    const id = idDe(req);
    const b = z.object({ nome: z.string().trim().min(2).max(80) }).parse(req.body);
    const r = await svc.renomearSala(id, req.user, b.nome);
    await auditar(req, 'Conversa', id, 'ALTERAR', { nome: b.nome });
    return r;
  });

  app.post('/api/v1/chat/conversas/:id/participantes', async (req) => {
    const id = idDe(req);
    const b = z.object({ usuarioIds: z.array(z.coerce.number().int().positive()).min(1).max(100) }).parse(req.body);
    const r = await svc.incluirNaSala(id, req.user, b.usuarioIds);
    await auditar(req, 'Conversa', id, 'ALTERAR', { incluidos: b.usuarioIds });
    return r;
  });

  app.delete('/api/v1/chat/conversas/:id/participantes/:usuarioId', async (req) => {
    const id = idDe(req);
    const usuarioId = idDe(req, 'usuarioId');
    const r = await svc.removerDaSala(id, req.user, usuarioId);
    await auditar(req, 'Conversa', id, 'ALTERAR', { removido: usuarioId });
    return r;
  });

  app.post('/api/v1/chat/conversas/:id/silenciar', async (req) => {
    const id = idDe(req);
    const b = z.object({ ate: z.string().nullable().optional() }).parse(req.body ?? {});
    const ate = b.ate ? new Date(b.ate) : null;
    if (ate && Number.isNaN(ate.getTime())) throw new AppError('Data inválida.', 422, 'DATA_INVALIDA');
    return svc.silenciar(id, req.user, ate);
  });

  // ------------------------------------------------------------------ mensagens
  app.get('/api/v1/chat/conversas/:id/mensagens', async (req) => {
    const id = idDe(req);
    const q = z.object({ antesDe: z.coerce.number().int().positive().optional(), limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return svc.listarMensagens(id, req.user, q.antesDe, q.limite);
  });

  app.post('/api/v1/chat/conversas/:id/mensagens', async (req, reply) => {
    const id = idDe(req);
    const b = z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(8000), respondeAId: z.coerce.number().int().positive().nullable().optional() }).parse(req.body);
    const m = await svc.enviarMensagem(id, req.user, { tipo: 'TEXTO', texto: b.texto, respondeAId: b.respondeAId ?? null });
    return reply.code(201).send(m);
  });

  async function receberAnexo(req: any, audio: boolean) {
    if (!req.isMultipart()) throw new AppError('Envie o arquivo (multipart).', 400, 'SEM_ARQUIVO');
    let buffer: Buffer | null = null;
    let mime = '';
    let nome: string | undefined;
    let duracaoSeg: number | null = null;
    let respondeAId: number | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (buffer) continue;
        buffer = await part.toBuffer();
        mime = part.mimetype || '';
        nome = part.filename;
      } else if (part.fieldname === 'duracaoSeg') {
        const n = Number(part.value);
        if (Number.isFinite(n) && n >= 0) duracaoSeg = Math.round(n);
      } else if (part.fieldname === 'respondeAId') {
        const n = Number(part.value);
        if (Number.isInteger(n) && n > 0) respondeAId = n;
      } else if (part.fieldname === 'mime' && typeof part.value === 'string' && !mime) {
        mime = part.value;
      }
    }
    if (!buffer || !buffer.length) throw new AppError(audio ? 'O áudio veio vazio. Grave de novo.' : 'O arquivo veio vazio.', 422, 'SEM_ARQUIVO');
    if (buffer.length > 25 * 1024 * 1024) throw new AppError('Arquivo acima de 25 MB.', 422, 'ARQUIVO_GRANDE');
    const salvo = svc.salvarAnexo(buffer, mime || 'application/octet-stream', nome, audio);
    return { salvo, duracaoSeg, respondeAId };
  }

  app.post('/api/v1/chat/conversas/:id/audio', async (req, reply) => {
    const id = idDe(req);
    const { salvo, duracaoSeg, respondeAId } = await receberAnexo(req, true);
    const m = await svc.enviarMensagem(id, req.user, { tipo: 'AUDIO', arquivo: salvo.arquivo, arquivoNome: salvo.nome, arquivoTamanho: salvo.tamanho, arquivoMime: salvo.mime, duracaoSeg, respondeAId });
    return reply.code(201).send(m);
  });

  app.post('/api/v1/chat/conversas/:id/arquivo', async (req, reply) => {
    const id = idDe(req);
    const { salvo, respondeAId } = await receberAnexo(req, false);
    const m = await svc.enviarMensagem(id, req.user, { tipo: 'ARQUIVO', arquivo: salvo.arquivo, arquivoNome: salvo.nome, arquivoTamanho: salvo.tamanho, arquivoMime: salvo.mime, respondeAId });
    return reply.code(201).send(m);
  });

  app.post('/api/v1/chat/conversas/:id/lida', async (req) => {
    const id = idDe(req);
    const b = z.object({ ateId: z.coerce.number().int().positive().optional() }).parse(req.body ?? {});
    return svc.marcarLida(id, req.user, b.ateId);
  });

  app.post('/api/v1/chat/conversas/:id/digitando', async (req) => {
    await svc.digitando(idDe(req), req.user);
    return { ok: true };
  });

  app.delete('/api/v1/chat/mensagens/:id', async (req) => {
    const id = idDe(req);
    const r = await svc.apagarMensagem(id, req.user);
    await auditar(req, 'Mensagem', id, 'EXCLUIR');
    return r;
  });

  // ------------------------------------------------------------------ chamadas
  app.get('/api/v1/chat/chamadas/ativas', async (req) => svc.chamadasAtivas(req.user.id));

  app.post('/api/v1/chat/conversas/:id/chamadas', async (req, reply) => {
    const id = idDe(req);
    const b = z.object({ tipo: z.enum(['VOZ', 'VIDEO']).default('VOZ') }).parse(req.body ?? {});
    const c = await svc.iniciarChamada(id, req.user, b.tipo);
    await auditar(req, 'Chamada', c.id, 'CRIAR', { conversaId: id, tipo: b.tipo });
    return reply.code(201).send(c);
  });

  app.post('/api/v1/chat/chamadas/:id/entrar', async (req) => svc.entrarChamada(idDe(req), req.user));
  app.post('/api/v1/chat/chamadas/:id/recusar', async (req) => svc.recusarChamada(idDe(req), req.user));
  app.post('/api/v1/chat/chamadas/:id/sair', async (req) => svc.sairChamada(idDe(req), req.user));

  app.post('/api/v1/chat/chamadas/:id/rtc', async (req) => {
    const id = idDe(req);
    const b = z.object({ para: z.coerce.number().int().positive(), dados: z.unknown() }).parse(req.body);
    await svc.repassarRtc(req.user, id, b.para, b.dados);
    return { ok: true };
  });

  // ------------------------------------------------------------------ aviso no celular (Web Push)
  app.post('/api/v1/chat/push/assinar', async (req) => {
    const b = z
      .object({
        subscription: z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }) }),
      })
      .parse(req.body);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
    await prisma.pushAssinatura.upsert({
      where: { endpoint: b.subscription.endpoint },
      create: { usuarioId: req.user.id, endpoint: b.subscription.endpoint, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, userAgent },
      update: { usuarioId: req.user.id, p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, userAgent, ultimoUsoEm: new Date() },
    });
    return { ok: true };
  });

  app.post('/api/v1/chat/push/cancelar', async (req) => {
    const b = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body ?? {});
    await prisma.pushAssinatura.deleteMany({ where: { endpoint: b.endpoint, usuarioId: req.user.id } });
    return { ok: true };
  });

  app.get('/api/v1/chat/push/assinaturas', async (req) => {
    const lista = await prisma.pushAssinatura.findMany({ where: { usuarioId: req.user.id }, select: { id: true, endpoint: true, userAgent: true, criadoEm: true, ultimoUsoEm: true } });
    return lista.map((a) => ({ ...a, endpoint: a.endpoint.slice(0, 40) + '…' }));
  });
}
