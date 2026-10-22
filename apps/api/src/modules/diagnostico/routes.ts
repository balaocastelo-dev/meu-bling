/**
 * GET /api/v1/diagnostico — "Saúde do sistema" (só ADMIN; só leitura).
 * Também roda toda madrugada e guarda o resumo em Configuracao "diagnostico.ultimo" para o alerta do dashboard.
 */
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { registrarServico } from '../../core/servicos.js';
import { diagnosticar } from './service.js';

export default async function diagnosticoRoutes(app: FastifyInstance) {
  app.get('/api/v1/diagnostico', { preHandler: app.exigirPerfil('ADMIN') }, async () => {
    const r = await diagnosticar();
    await guardarResumo(r.resumo);
    return r;
  });
}

async function guardarResumo(resumo: Record<string, number>) {
  const valor = JSON.stringify({ ...resumo, em: new Date().toISOString() });
  await prisma.configuracao.upsert({ where: { chave: 'diagnostico.ultimo' }, create: { chave: 'diagnostico.ultimo', valor }, update: { valor } }).catch(() => undefined);
}

registrarServico('diagnostico-diario', (app) => {
  const rodar = async () => {
    try {
      const r = await diagnosticar();
      await guardarResumo(r.resumo);
      app.log.info({ resumo: r.resumo }, '[diagnóstico] verificação diária');
    } catch (e) {
      app.log.warn({ e: String((e as Error)?.message || e) }, '[diagnóstico] falhou');
    }
  };
  setTimeout(rodar, 2 * 60_000).unref();
  setInterval(rodar, 6 * 3600_000).unref();
});
