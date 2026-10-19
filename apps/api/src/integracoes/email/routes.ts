/**
 * Rotas de e-mail: teste de SMTP.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/auditoria.js';
import { enviarEmail, limparCacheSmtp } from './servico.js';

export default async function emailRoutes(app: FastifyInstance) {
  app.post('/api/v1/empresa/smtp/testar', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const b = z.object({ para: z.string().email('Informe um e-mail válido') }).parse(req.body);
    limparCacheSmtp(); // garante que usa a configuração mais recente
    const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { nomeFantasia: true, razaoSocial: true } });
    const nome = e?.nomeFantasia || e?.razaoSocial || 'MEU BLING';
    const r = await enviarEmail({
      para: b.para,
      assunto: `Teste de e-mail — ${nome}`,
      html: `<p>Olá!</p><p>Este é um e-mail de teste enviado pelo <b>MEU BLING</b> (${nome}).</p><p>Se você recebeu esta mensagem, a configuração SMTP está correta. ✅</p><p style="color:#64748b;font-size:12px">${new Date().toLocaleString('pt-BR')}</p>`,
    });
    await auditar(req, 'Empresa', 1, 'ACAO', { acao: 'smtp.testar', para: b.para });
    return { ok: true, messageId: r.messageId };
  });
}
