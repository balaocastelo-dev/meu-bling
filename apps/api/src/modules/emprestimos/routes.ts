/**
 * Rotas do módulo de empréstimos (Financeiro › Empréstimos). Perfis: ADMIN, GERENTE, FINANCEIRO
 * (a política central já fecha /financeiro para os demais).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditar } from '../../lib/auditoria.js';
import { dataSchema } from '../../lib/util.js';
import { hojeMeioDia } from '../comum/datas.js';
import { alterarEmprestimo, cancelarEmprestimo, clientePagouDireto, criarEmprestimo, emprestimoCompleto, listarEmprestimos, MODALIDADES, pagarCredor } from './service.js';

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const idOpc = z.coerce.number().int().positive().nullable().optional();
const texto = z.string().trim().max(500).nullable().optional();

const corpoBase = z.object({
  credorId: z.coerce.number().int().positive(),
  modalidade: z.enum(MODALIDADES).default('REPASSE'),
  codigo: z.string().trim().max(40).nullable().optional(),
  descricao: texto,
  clienteId: idOpc,
  vendaId: idOpc,
  contaReceberClienteId: idOpc,
  dataOperacao: dataSchema,
  valorRecebido: z.coerce.number().positive().max(100_000_000),
  taxaPct: z.coerce.number().min(0).max(100).default(6),
  prazoDias: z.coerce.number().int().min(0).max(3650).default(30),
  parcelas: z.coerce.number().int().min(1).max(120).default(1),
  vencimento: dataSchema,
  contaFinanceiraId: idOpc,
  observacoes: texto,
});

export default async function emprestimosRoutes(app: FastifyInstance) {
  const fin = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO') };

  app.get('/api/v1/financeiro/emprestimos', fin, async (req) => {
    const q = z
      .object({
        status: z.enum(['ABERTO', 'VENCIDO', 'QUITADO', 'CANCELADO']).optional(),
        credorId: z.coerce.number().int().positive().optional(),
        modalidade: z.enum(MODALIDADES).optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        pesquisa: z.string().trim().max(100).optional(),
      })
      .parse(req.query);
    const fim = q.dataFinal ? new Date(new Date(q.dataFinal).setHours(23, 59, 59, 999)) : null;
    return listarEmprestimos({ status: q.status, credorId: q.credorId, modalidade: q.modalidade, ini: q.dataInicial, fim, pesquisa: q.pesquisa || undefined });
  });

  app.get('/api/v1/financeiro/emprestimos/:id', fin, async (req) => emprestimoCompleto(idSchema.parse(req.params).id));

  app.post('/api/v1/financeiro/emprestimos', fin, async (req, reply) => {
    const b = corpoBase.parse(req.body);
    const e = await criarEmprestimo({ ...b, dataOperacao: b.dataOperacao ?? hojeMeioDia(), vencimento: b.vencimento ?? null });
    await auditar(req, 'Emprestimo', e.id, 'CRIAR', { numero: e.numero, credor: e.credor.nome, valorRecebido: e.valorRecebido, valorDevolver: e.valorDevolver, modalidade: e.modalidade });
    return reply.code(201).send(e);
  });

  app.put('/api/v1/financeiro/emprestimos/:id', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = corpoBase.omit({ credorId: true }).partial().parse(req.body);
    const corpo = req.body as Record<string, unknown>;
    // .partial() ainda aplica defaults: usa só o que veio no corpo
    const d: any = {};
    for (const k of Object.keys(b)) if (k in corpo) d[k] = (b as any)[k];
    const e = await alterarEmprestimo(id, d);
    await auditar(req, 'Emprestimo', id, 'ALTERAR', d);
    return e;
  });

  app.post('/api/v1/financeiro/emprestimos/:id/cliente-pagou-direto', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ valor: z.coerce.number().positive().nullable().optional(), data: dataSchema }).parse(req.body ?? {});
    const e = await clientePagouDireto(id, { valor: b.valor ?? null, data: b.data ?? hojeMeioDia() });
    await auditar(req, 'Emprestimo', id, 'ACAO', { acao: 'cliente pagou direto ao credor', valor: b.valor ?? 'saldo' });
    return e;
  });

  app.post('/api/v1/financeiro/emprestimos/:id/pagar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ valor: z.coerce.number().positive().nullable().optional(), data: dataSchema, contaFinanceiraId: z.coerce.number().int().positive() }).parse(req.body ?? {});
    const e = await pagarCredor(id, { valor: b.valor ?? null, data: b.data ?? hojeMeioDia(), contaFinanceiraId: b.contaFinanceiraId });
    await auditar(req, 'Emprestimo', id, 'ACAO', { acao: 'pagamento ao credor', valor: b.valor ?? 'saldo' });
    return e;
  });

  app.post('/api/v1/financeiro/emprestimos/:id/cancelar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const e = await cancelarEmprestimo(id);
    await auditar(req, 'Emprestimo', id, 'ACAO', { acao: 'cancelar' });
    return e;
  });
}
