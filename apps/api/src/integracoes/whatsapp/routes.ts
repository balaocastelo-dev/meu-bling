/**
 * Rotas do WhatsApp (QR Code): status, conectar, desconectar, enviar teste, eventos (SSE).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { registrarServico } from '../../core/servicos.js';
import { auditar } from '../../lib/auditoria.js';
import { conectar, desconectar, reconectarDoZero, enviarTexto, status, whatsappEventos, iniciarSeNecessario } from './servico.js';

export default async function whatsappRoutes(app: FastifyInstance) {
  const cfg = app.exigirPerfil('ADMIN', 'GERENTE');

  app.get('/api/v1/whatsapp/status', async () => status());

  app.post('/api/v1/whatsapp/conectar', { preHandler: cfg }, async (req) => {
    const r = await conectar();
    // aguarda até 8s pelo QR (ou conexão) para a UI já receber algo útil
    const inicio = Date.now();
    while (Date.now() - inicio < 8000) {
      const s = status();
      if (s.status === 'AGUARDANDO_QR' || s.status === 'CONECTADO') return s;
      if (s.status === 'DESCONECTADO' && s.ultimoErro) return s;
      await new Promise((res) => setTimeout(res, 300));
    }
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.conectar' });
    return r.status === 'CONECTANDO' ? status() : r;
  });

  app.post('/api/v1/whatsapp/desconectar', { preHandler: cfg }, async (req) => {
    const r = await desconectar();
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.desconectar' });
    return r;
  });

  /** Apaga a sessão e gera um QR Code novo — resolve "Aguardando mensagem" no celular do cliente (sessão corrompida). */
  app.post('/api/v1/whatsapp/reconectar', { preHandler: cfg }, async (req) => {
    await reconectarDoZero();
    const inicio = Date.now();
    while (Date.now() - inicio < 8000) {
      const s = status();
      if (s.status === 'AGUARDANDO_QR' || s.status === 'CONECTADO') break;
      if (s.status === 'DESCONECTADO' && s.ultimoErro) break;
      await new Promise((res) => setTimeout(res, 300));
    }
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.reconectar' });
    return status();
  });

  app.post('/api/v1/whatsapp/enviar-teste', { preHandler: cfg }, async (req) => {
    const b = z.object({ numero: z.string().min(8), mensagem: z.string().min(1).default('Mensagem de teste do MEU BLING ✅') }).parse(req.body);
    const r = await enviarTexto(b.numero, b.mensagem);
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.enviar-teste', numero: b.numero });
    return { ok: true, ...r };
  });

  /** SSE: envia o estado a cada mudança e a cada 15s (keep-alive). */
  app.get('/api/v1/whatsapp/eventos', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': (req.headers.origin as string) || '*',
      'Access-Control-Allow-Credentials': 'true',
    });
    const enviar = (tipo: string, dados: unknown) => {
      try {
        reply.raw.write(`event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`);
      } catch {
        /* cliente fechou */
      }
    };
    enviar('estado', status());
    const onEstado = () => enviar('estado', status());
    const onMensagem = (m: unknown) => enviar('mensagem', m);
    whatsappEventos.on('estado', onEstado);
    whatsappEventos.on('mensagem', onMensagem);
    const ping = setInterval(() => enviar('ping', { t: Date.now() }), 15000);
    req.raw.on('close', () => {
      clearInterval(ping);
      whatsappEventos.off('estado', onEstado);
      whatsappEventos.off('mensagem', onMensagem);
    });
    await new Promise(() => undefined); // mantém a conexão aberta até o cliente fechar
  });
}

registrarServico('whatsapp', async (app) => {
  const iniciou = await iniciarSeNecessario();
  if (iniciou) app.log.info('[whatsapp] sessão salva encontrada — reconectando');
  whatsappEventos.on('estado', (e: any) => {
    if (e?.ultimoErro) app.log.warn(`[whatsapp] ${e.status}: ${e.ultimoErro}`);
  });
});
