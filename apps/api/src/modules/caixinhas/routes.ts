/**
 * Rotas das caixinhas (ADMIN, GERENTE, FINANCEIRO) e dos avisos do painel do gestor/gerente.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { dataSchema } from '../../lib/util.js';
import { transferirEntreContas, resumoFinanceiro } from '../financeiro/service.js';
import { avisosCaixinhas, caixinha, contaCaixinhaPadraoId, listarCaixinhas } from './service.js';

const corpo = z.object({
  nome: z.string().trim().min(2, 'Diga para que é a caixinha.'),
  valorMeta: z.coerce.number().positive('Informe o valor.'),
  dataUso: dataSchema.refine((d) => !!d, 'Informe o dia de uso.'),
  contaFinanceiraId: z.coerce.number().int().positive().nullish(),
  observacoes: z.string().trim().nullish(),
});

export default async function caixinhasRoutes(app: FastifyInstance) {
  const fin = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');

  app.get('/api/v1/caixinhas', { preHandler: fin }, async (req) => {
    const q = z.object({ ativas: z.enum(['true', 'false']).optional() }).parse(req.query);
    return listarCaixinhas({ ativas: q.ativas === undefined ? undefined : q.ativas === 'true' });
  });

  app.get('/api/v1/caixinhas/:id', { preHandler: fin }, async (req) => {
    const c = await caixinha(Number((req.params as any).id));
    if (!c) throw new NotFound('Caixinha');
    return c;
  });

  app.post('/api/v1/caixinhas', { preHandler: fin }, async (req, reply) => {
    const b = corpo.parse(req.body);
    const contaFinanceiraId = b.contaFinanceiraId || (await contaCaixinhaPadraoId());
    if (!contaFinanceiraId) throw new AppError('Cadastre a conta do Nubank em Bancos antes de criar a caixinha.', 422, 'SEM_CONTA_FINANCEIRA', { link: '/configuracoes/contas-financeiras' });
    const c = await prisma.caixinha.create({ data: { nome: b.nome, valorMeta: b.valorMeta, dataUso: b.dataUso!, contaFinanceiraId, observacoes: b.observacoes ?? null } });
    await auditar(req, 'Caixinha', c.id, 'CRIAR', { nome: c.nome, valorMeta: c.valorMeta });
    return reply.code(201).send(await caixinha(c.id));
  });

  app.put('/api/v1/caixinhas/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = corpo.partial().extend({ ativo: z.boolean().optional() }).parse(req.body);
    const atual = await prisma.caixinha.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Caixinha');
    await prisma.caixinha.update({
      where: { id },
      data: {
        ...(b.nome !== undefined ? { nome: b.nome } : {}),
        ...(b.valorMeta !== undefined ? { valorMeta: b.valorMeta } : {}),
        ...(b.dataUso ? { dataUso: b.dataUso } : {}),
        ...(b.observacoes !== undefined ? { observacoes: b.observacoes ?? null } : {}),
        ...(b.ativo !== undefined ? { ativo: b.ativo, usadaEm: b.ativo ? null : new Date() } : {}),
      },
    });
    await auditar(req, 'Caixinha', id, 'ALTERAR', b);
    return caixinha(id);
  });

  app.delete('/api/v1/caixinhas/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const c = await caixinha(id);
    if (!c) throw new NotFound('Caixinha');
    if (c.movimentos.length) throw new AppError('A caixinha já tem dinheiro guardado/retirado. Marque como usada em vez de excluir.', 422, 'CAIXINHA_COM_MOVIMENTO');
    await prisma.caixinha.delete({ where: { id } });
    await auditar(req, 'Caixinha', id, 'EXCLUIR', { nome: c.nome });
    return { ok: true };
  });

  /** Guardar: transfere de um banco para a conta da caixinha (fora do DRE). */
  app.post('/api/v1/caixinhas/:id/guardar', { preHandler: fin }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = z.object({ valor: z.coerce.number().positive(), origemId: z.coerce.number().int().positive(), data: dataSchema }).parse(req.body);
    const c = await prisma.caixinha.findUnique({ where: { id } });
    if (!c) throw new NotFound('Caixinha');
    if (b.origemId === c.contaFinanceiraId) throw new AppError('Escolha o banco de onde o dinheiro sai (diferente da conta da caixinha).', 422, 'CONTAS_IGUAIS');
    await transferirEntreContas({ origemId: b.origemId, destinoId: c.contaFinanceiraId, valor: b.valor, data: b.data ?? new Date(), descricao: `Caixinha "${c.nome}": guardar`, caixinhaId: id });
    await auditar(req, 'Caixinha', id, 'ACAO', { acao: 'guardar', valor: b.valor, origemId: b.origemId });
    return reply.code(201).send(await caixinha(id));
  });

  /** Retirar: transfere da conta da caixinha para um banco (ex.: na hora de pagar o compromisso). */
  app.post('/api/v1/caixinhas/:id/retirar', { preHandler: fin }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = z.object({ valor: z.coerce.number().positive(), destinoId: z.coerce.number().int().positive(), data: dataSchema }).parse(req.body);
    const c = await caixinha(id);
    if (!c) throw new NotFound('Caixinha');
    if (b.valor > c.saldo + 0.009) throw new AppError(`A caixinha só tem R$ ${c.saldo.toFixed(2).replace('.', ',')}.`, 422, 'SALDO_CAIXINHA');
    if (b.destinoId === c.contaFinanceira.id) throw new AppError('Escolha o banco para onde o dinheiro vai.', 422, 'CONTAS_IGUAIS');
    await transferirEntreContas({ origemId: c.contaFinanceira.id, destinoId: b.destinoId, valor: b.valor, data: b.data ?? new Date(), descricao: `Caixinha "${c.nome}": retirar`, caixinhaId: id });
    await auditar(req, 'Caixinha', id, 'ACAO', { acao: 'retirar', valor: b.valor, destinoId: b.destinoId });
    return reply.code(201).send(await caixinha(id));
  });

  /** Avisos mais importantes para o gestor (ADMIN) e a gerente: caixinhas primeiro, depois contas e OS. */
  app.get('/api/v1/avisos', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async () => {
    const { caixinhas, avisos } = await avisosCaixinhas();
    const fin = await resumoFinanceiro();
    const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (fin.pagarAtrasado > 0) avisos.push({ tipo: 'erro', prioridade: 1, mensagem: `Contas a pagar vencidas: ${brl(fin.pagarAtrasado)}`, link: '/financeiro/pagar?situacao=ATRASADO' });
    if (fin.pagarHoje > 0) avisos.push({ tipo: 'aviso', prioridade: 2, mensagem: `Contas a pagar hoje: ${brl(fin.pagarHoje)}`, link: '/financeiro/pagar?situacao=ABERTO' });
    if (fin.receberAtrasado > 0) avisos.push({ tipo: 'aviso', prioridade: 3, mensagem: `Contas a receber vencidas: ${brl(fin.receberAtrasado)}`, link: '/financeiro/receber?situacao=ATRASADO' });
    const osAtrasadas = await prisma.ordemServico.count({ where: { dataPrevista: { lt: startOfDay(new Date()) }, situacao: { final: false, cancelamento: false } } }).catch(() => 0);
    if (osAtrasadas) avisos.push({ tipo: 'aviso', prioridade: 3, mensagem: `${osAtrasadas} OS atrasada${osAtrasadas > 1 ? 's' : ''} (previsão vencida)`, link: '/ordens-servico?atrasadas=true' });
    avisos.sort((a, b) => a.prioridade - b.prioridade);
    const sugestaoHojeTotal = caixinhas.reduce((s, c) => s + c.sugestaoHoje, 0);
    return { avisos, caixinhas, sugestaoHojeTotal: Math.round(sugestaoHojeTotal * 100) / 100, saldoTotal: fin.saldoTotal };
  });
}
