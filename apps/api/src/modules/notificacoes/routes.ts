/**
 * NOTIFICAÇÕES — fila (listar, criar manual, reenviar, cancelar) e templates (CRUD, preview, variáveis).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { paginacaoSchema, paginar, respostaPaginada, dataSchema } from '../../lib/util.js';
import { EVENTOS_TEMPLATE, VARIAVEIS_POR_EVENTO, enfileirar, enviarAgora, renderizarTemplate, renderizarTexto, registrarListeners, gerarLembretesContas, processarFila, type OrigemTipo } from './service.js';

const ORIGENS = ['VENDA', 'COMPRA', 'OS', 'NFE', 'CONTA', 'MANUAL'] as const;

export default async function notificacoesRoutes(app: FastifyInstance) {
  registrarListeners();
  const operador = app.exigirPerfil('ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO');
  const cfg = app.exigirPerfil('ADMIN', 'GERENTE');

  // =====================================================================
  // FILA
  // =====================================================================
  app.get('/api/v1/notificacoes', { preHandler: operador }, async (req) => {
    const q = paginacaoSchema
      .extend({
        status: z.enum(['PENDENTE', 'ENVIANDO', 'ENVIADA', 'ERRO', 'CANCELADA']).optional(),
        canal: z.enum(['EMAIL', 'WHATSAPP']).optional(),
        origemTipo: z.string().optional(),
        origemId: z.coerce.number().int().optional(),
        contatoId: z.coerce.number().int().optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        pesquisa: z.string().trim().optional(),
      })
      .parse(req.query);
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.canal) where.canal = q.canal;
    if (q.origemTipo) where.origemTipo = q.origemTipo;
    if (q.origemId) where.origemId = q.origemId;
    if (q.contatoId) where.contatoId = q.contatoId;
    if (q.dataInicial || q.dataFinal) {
      where.criadoEm = {};
      if (q.dataInicial) where.criadoEm.gte = q.dataInicial;
      if (q.dataFinal) where.criadoEm.lte = new Date(q.dataFinal.getFullYear(), q.dataFinal.getMonth(), q.dataFinal.getDate(), 23, 59, 59);
    }
    if (q.pesquisa) where.OR = [{ destinatario: { contains: q.pesquisa } }, { assunto: { contains: q.pesquisa } }, { corpo: { contains: q.pesquisa } }, { contato: { nome: { contains: q.pesquisa } } }];
    const [total, data, pendentes, erros] = await Promise.all([
      prisma.notificacao.count({ where }),
      prisma.notificacao.findMany({ where, include: { contato: { select: { id: true, nome: true } } }, orderBy: [{ criadoEm: 'desc' }], ...paginar(q) }),
      prisma.notificacao.count({ where: { status: 'PENDENTE' } }),
      prisma.notificacao.count({ where: { status: 'ERRO' } }),
    ]);
    return { ...respostaPaginada(data, total, q), totais: { pendentes, erros } };
  });

  app.get('/api/v1/notificacoes/:id', { preHandler: operador }, async (req) => {
    const id = Number((req.params as any).id);
    const n = await prisma.notificacao.findUnique({ where: { id }, include: { contato: { select: { id: true, nome: true } } } });
    if (!n) throw new NotFound('Notificação');
    return n;
  });

  app.post('/api/v1/notificacoes', { preHandler: operador }, async (req, reply) => {
    const b = z
      .object({
        canal: z.enum(['EMAIL', 'WHATSAPP']),
        destinatario: z.string().trim().optional(),
        assunto: z.string().nullable().optional(),
        corpo: z.string().min(1, 'Informe a mensagem'),
        contatoId: z.number().int().nullable().optional(),
        origemTipo: z.enum(ORIGENS).nullable().optional(),
        origemId: z.number().int().nullable().optional(),
        /** renderiza {{variáveis}} com base na origem */
        renderizar: z.boolean().default(true),
        agendadaPara: dataSchema,
      })
      .parse(req.body);
    let destinatario = b.destinatario || '';
    let corpo = b.corpo;
    let assunto = b.assunto ?? null;
    let contatoId = b.contatoId ?? null;
    if (b.origemTipo && b.origemTipo !== 'MANUAL' && b.origemId && b.renderizar) {
      const r = await renderizarTexto(b.corpo, b.canal, b.origemTipo as OrigemTipo, b.origemId);
      corpo = r.texto;
      if (assunto) assunto = (await renderizarTexto(assunto, b.canal, b.origemTipo as OrigemTipo, b.origemId)).texto;
      if (!destinatario) destinatario = (b.canal === 'EMAIL' ? r.contato?.email : r.contato?.celular) || '';
      contatoId = contatoId ?? r.contato?.id ?? null;
    }
    if (!destinatario && contatoId) {
      const c = await prisma.contato.findUnique({ where: { id: contatoId }, select: { email: true, celular: true } });
      destinatario = (b.canal === 'EMAIL' ? c?.email : c?.celular) || '';
    }
    if (!destinatario) throw new AppError('Informe o destinatário (e-mail ou celular).', 422, 'SEM_DESTINATARIO');
    const n = await enfileirar({ canal: b.canal, destinatario, assunto, corpo, contatoId, origemTipo: b.origemTipo ?? 'MANUAL', origemId: b.origemId ?? null, agendadaPara: b.agendadaPara ?? null });
    await auditar(req, 'Notificacao', n.id, 'CRIAR', { canal: b.canal, destinatario });
    return reply.code(201).send(n);
  });

  app.post('/api/v1/notificacoes/:id/reenviar', { preHandler: operador }, async (req) => {
    const id = Number((req.params as any).id);
    const n = await prisma.notificacao.findUnique({ where: { id } });
    if (!n) throw new NotFound('Notificação');
    const r = await enviarAgora(id);
    await auditar(req, 'Notificacao', id, 'ACAO', { acao: 'reenviar', status: r?.status });
    return r;
  });

  app.post('/api/v1/notificacoes/:id/cancelar', { preHandler: operador }, async (req) => {
    const id = Number((req.params as any).id);
    const n = await prisma.notificacao.findUnique({ where: { id } });
    if (!n) throw new NotFound('Notificação');
    if (n.status === 'ENVIADA') throw new AppError('Notificação já enviada não pode ser cancelada.', 422, 'JA_ENVIADA');
    const r = await prisma.notificacao.update({ where: { id }, data: { status: 'CANCELADA' } });
    await auditar(req, 'Notificacao', id, 'ACAO', { acao: 'cancelar' });
    return r;
  });

  /** Força o processamento da fila (útil para testes/UI). */
  app.post('/api/v1/notificacoes/processar', { preHandler: cfg }, async () => processarFila(50));

  /** Gera lembretes de contas vencendo (hoje/amanhã) manualmente. */
  app.post('/api/v1/notificacoes/lembretes-contas', { preHandler: cfg }, async (req) => {
    const r = await gerarLembretesContas(true);
    await auditar(req, 'Notificacao', null, 'ACAO', { acao: 'lembretes-contas', ...r });
    return r;
  });

  // =====================================================================
  // TEMPLATES
  // =====================================================================
  const templateSchema = z.object({
    nome: z.string().trim().min(2),
    evento: z.enum(EVENTOS_TEMPLATE),
    canal: z.enum(['EMAIL', 'WHATSAPP']),
    situacaoId: z.number().int().nullable().optional(),
    assunto: z.string().nullable().optional(),
    corpo: z.string().min(1, 'Informe o corpo do template'),
    anexarPdf: z.boolean().default(false),
    ativo: z.boolean().default(true),
  });

  app.get('/api/v1/templates-notificacao', { preHandler: operador }, async (req) => {
    const q = z.object({ evento: z.string().optional(), canal: z.enum(['EMAIL', 'WHATSAPP']).optional(), ativo: z.enum(['true', 'false']).optional() }).parse(req.query);
    const where: any = {};
    if (q.evento) where.evento = q.evento;
    if (q.canal) where.canal = q.canal;
    if (q.ativo) where.ativo = q.ativo === 'true';
    return prisma.templateNotificacao.findMany({ where, include: { situacao: { select: { id: true, nome: true, cor: true, modulo: true } } }, orderBy: [{ evento: 'asc' }, { canal: 'asc' }, { nome: 'asc' }] });
  });

  app.get('/api/v1/templates-notificacao/variaveis', { preHandler: operador }, async () => ({
    eventos: EVENTOS_TEMPLATE.map((e) => ({ evento: e, variaveis: VARIAVEIS_POR_EVENTO[e] || [] })),
    sintaxe: 'Use {{variavel}} no assunto ou corpo. Ex.: Olá {{cliente.primeiroNome}}, seu pedido {{numero}} está {{situacao}}.',
  }));

  app.get('/api/v1/templates-notificacao/:id', { preHandler: operador }, async (req) => {
    const id = Number((req.params as any).id);
    const t = await prisma.templateNotificacao.findUnique({ where: { id }, include: { situacao: { select: { id: true, nome: true, cor: true, modulo: true } } } });
    if (!t) throw new NotFound('Template');
    return t;
  });

  app.post('/api/v1/templates-notificacao', { preHandler: cfg }, async (req, reply) => {
    const b = templateSchema.parse(req.body);
    const t = await prisma.templateNotificacao.create({ data: { ...b, situacaoId: b.situacaoId ?? null, assunto: b.assunto ?? null } });
    await auditar(req, 'TemplateNotificacao', t.id, 'CRIAR', { nome: t.nome, evento: t.evento, canal: t.canal });
    return reply.code(201).send(t);
  });

  app.put('/api/v1/templates-notificacao/:id', { preHandler: cfg }, async (req) => {
    const id = Number((req.params as any).id);
    const b = templateSchema.partial().parse(req.body);
    const t = await prisma.templateNotificacao.update({ where: { id }, data: b });
    await auditar(req, 'TemplateNotificacao', id, 'ALTERAR', b);
    return t;
  });

  app.delete('/api/v1/templates-notificacao/:id', { preHandler: cfg }, async (req) => {
    const id = Number((req.params as any).id);
    await prisma.templateNotificacao.delete({ where: { id } });
    await auditar(req, 'TemplateNotificacao', id, 'EXCLUIR');
    return { ok: true };
  });

  app.post('/api/v1/templates-notificacao/:id/preview', { preHandler: operador }, async (req) => {
    const id = Number((req.params as any).id);
    const b = z.object({ origemTipo: z.enum(ORIGENS), origemId: z.number().int() }).parse(req.body);
    return renderizarTemplate(id, b.origemTipo as OrigemTipo, b.origemId);
  });
}
