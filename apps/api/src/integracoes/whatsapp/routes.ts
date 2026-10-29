/**
 * Rotas do WhatsApp: status, conectar (QR Code), desconectar, enviar teste, eventos (SSE)
 * e a configuração do servidor Evolution — o caminho do "um QR Code só" para toda a loja.
 *
 * O status/conexão passam pelo provedor (Evolution quando configurada, senão a sessão
 * própria do sistema). O SSE e o robô de reconexão continuam ligados ao Baileys, que é
 * quem tem eventos locais; com a Evolution a tela recarrega o estado sozinha.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { registrarServico } from '../../core/servicos.js';
import { auditar } from '../../lib/auditoria.js';
import { reconectarDoZero, status as statusBaileys, whatsappEventos, iniciarSeNecessario } from './servico.js';
import { conectar, desconectar, enviarTexto, status, provedorAtual } from './provedor.js';
import { gravarConfig, lerConfig, listarInstancias, testar } from './evolution.js';
import { mask } from '../../lib/crypto.js';

export default async function whatsappRoutes(app: FastifyInstance) {
  const cfg = app.exigirPerfil('ADMIN', 'GERENTE');

  app.get('/api/v1/whatsapp/status', async () => status());

  // ---------------------------------------------------------------- um QR Code só (Evolution)
  app.get('/api/v1/whatsapp/evolution', { preHandler: app.exigirPerfil('ADMIN') }, async () => {
    const c = await lerConfig();
    return {
      ligado: c.ligado,
      url: c.url,
      instancia: c.instancia,
      temChave: !!c.apiKey,
      chaveMascarada: mask(c.apiKey),
      provedor: await provedorAtual(),
    };
  });

  app.put('/api/v1/whatsapp/evolution', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const b = z
      .object({
        ligado: z.boolean().optional(),
        url: z.string().max(300).optional(),
        instancia: z.string().max(100).optional(),
        apiKey: z.string().max(300).optional().nullable(),
      })
      .strict()
      .parse(req.body ?? {});

    const c = await gravarConfig({ ...b, apiKey: b.apiKey ?? undefined });
    await auditar(req, 'Empresa', 1, 'ALTERAR', {
      acao: 'whatsapp.evolution',
      ligado: c.ligado,
      instancia: c.instancia,
      trocouChave: !!b.apiKey,
    });
    return { ligado: c.ligado, url: c.url, instancia: c.instancia, temChave: !!c.apiKey, chaveMascarada: mask(c.apiKey), provedor: await provedorAtual() };
  });

  app.post('/api/v1/whatsapp/evolution/testar', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const b = z
      .object({ url: z.string().min(5).max(300), apiKey: z.string().max(300).optional(), instancia: z.string().min(1).max(100) })
      .parse(req.body ?? {});
    const guardada = await lerConfig();
    const chave = b.apiKey && !/^[*•]+/.test(b.apiKey) ? b.apiKey : guardada.apiKey;
    if (!chave) return { ok: false, mensagem: 'Informe a chave da API (apikey) do servidor Evolution.' };
    return testar({ url: b.url, apiKey: chave, instancia: b.instancia });
  });

  app.get('/api/v1/whatsapp/evolution/instancias', { preHandler: app.exigirPerfil('ADMIN') }, async () => {
    return { data: await listarInstancias() };
  });

  app.post('/api/v1/whatsapp/conectar', { preHandler: cfg }, async (req) => {
    const r = await conectar();
    // aguarda até 8s pelo QR (ou conexão) para a UI já receber algo útil
    const inicio = Date.now();
    while (Date.now() - inicio < 8000) {
      const s = await status();
      if (s.status === 'AGUARDANDO_QR' || s.status === 'CONECTADO') return s;
      if (s.status === 'DESCONECTADO' && s.ultimoErro) return s;
      await new Promise((res) => setTimeout(res, 300));
    }
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.conectar' });
    return r.status === 'CONECTANDO' ? await status() : r;
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
      const s = statusBaileys();
      if (s.status === 'AGUARDANDO_QR' || s.status === 'CONECTADO') break;
      if (s.status === 'DESCONECTADO' && s.ultimoErro) break;
      await new Promise((res) => setTimeout(res, 300));
    }
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'whatsapp.reconectar' });
    return statusBaileys();
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
    enviar('estado', statusBaileys());
    const onEstado = () => enviar('estado', statusBaileys());
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
  if ((await provedorAtual()) === 'EVOLUTION') {
    app.log.info('[whatsapp] quem manda é a Evolution API (um QR Code só) — sessão local não será aberta');
    return;
  }
  const iniciou = await iniciarSeNecessario();
  if (iniciou) app.log.info('[whatsapp] sessão salva encontrada — reconectando');
  whatsappEventos.on('estado', (e: any) => {
    if (e?.ultimoErro) app.log.warn(`[whatsapp] ${e.status}: ${e.ultimoErro}`);
  });
});
