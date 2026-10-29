/**
 * FINANCEIRO — contas a receber/pagar, baixas, estornos, resumo, fluxo de caixa,
 * movimentos (extrato interno) e transferências.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { addMonths, startOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { paginacaoSchema, paginar, respostaPaginada, dataSchema, competenciaDe, arredondar } from '../../lib/util.js';
import {
  baixarContaReceber,
  baixarContaPagar,
  estornarContaReceber,
  estornarContaPagar,
  estornarPagamentoContaPagar,
  saldoContaPagar,
  saldoContaReceber,
  criarMovimentoAvulso,
  transferirEntreContas,
  ajustarSaldoConta,
  excluirMovimento,
  resumoFinanceiro,
  mapaOrigens,
} from './service.js';
import { chavePeriodo, listarPeriodos, resolverPeriodo, type Agrupar } from './periodos.js';
import { OBS_FORA_DO_RESULTADO } from '../comum/financeiro.js';
import { extratoConta } from './extrato.js';

const SIT_FILTRO = ['ABERTO', 'RECEBIDO', 'PAGO', 'PARCIAL', 'CANCELADO', 'ATRASADO'] as const;

const listaSchema = paginacaoSchema.extend({
  situacao: z.enum(SIT_FILTRO).optional(),
  contatoId: z.coerce.number().int().optional(),
  vendedorId: z.coerce.number().int().optional(),
  categoriaId: z.coerce.number().int().optional(),
  contaFinanceiraId: z.coerce.number().int().optional(),
  origemTipo: z.string().optional(),
  origemId: z.coerce.number().int().optional(),
  dataInicial: dataSchema,
  dataFinal: dataSchema,
  /** V = vencimento, E = emissão, R = recebimento/pagamento */
  tipoData: z.enum(['V', 'E', 'R']).default('V'),
  pesquisa: z.string().trim().optional(),
  recorrente: z.coerce.boolean().optional(),
});

const contaSchema = z.object({
  contatoId: z.number().int().nullable().optional(),
  vendedorId: z.number().int().nullable().optional(),
  descricao: z.string().trim().min(1, 'Informe a descrição'),
  dataEmissao: dataSchema,
  vencimento: dataSchema,
  competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM').nullable().optional(),
  valor: z.number().positive('Valor deve ser maior que zero'),
  formaPagamentoId: z.number().int().nullable().optional(),
  contaFinanceiraId: z.number().int().nullable().optional(),
  categoriaId: z.number().int().nullable().optional(),
  origemTipo: z.string().optional(),
  origemId: z.number().int().nullable().optional(),
  parcela: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  recorrente: z.boolean().optional(),
});

const baixaSchema = z.object({
  valor: z.number().positive('Valor deve ser maior que zero').optional(),
  data: dataSchema,
  contaFinanceiraId: z.number().int(),
  formaPagamentoId: z.number().int().nullable().optional(),
  juros: z.number().min(0).default(0),
  desconto: z.number().min(0).default(0),
  observacoes: z.string().nullable().optional(),
});

const campoData = (tipo: 'V' | 'E' | 'R', modulo: 'receber' | 'pagar') =>
  tipo === 'E' ? 'dataEmissao' : tipo === 'R' ? (modulo === 'receber' ? 'dataRecebimento' : 'dataPagamento') : 'vencimento';

function filtroBase(q: z.infer<typeof listaSchema>, modulo: 'receber' | 'pagar') {
  const hoje = startOfDay(new Date());
  const where: any = {};
  if (q.contatoId) where.contatoId = q.contatoId;
  if (q.vendedorId && modulo === 'receber') where.vendedorId = q.vendedorId;
  if (q.categoriaId) where.categoriaId = q.categoriaId;
  if (q.contaFinanceiraId) where.contaFinanceiraId = q.contaFinanceiraId;
  if (q.origemTipo) where.origemTipo = q.origemTipo;
  if (q.origemId) where.origemId = q.origemId;
  if (q.recorrente !== undefined && modulo === 'pagar') where.recorrente = q.recorrente;
  if (q.dataInicial || q.dataFinal) {
    const campo = campoData(q.tipoData, modulo);
    where[campo] = {};
    if (q.dataInicial) where[campo].gte = startOfDay(q.dataInicial);
    if (q.dataFinal) where[campo].lte = new Date(q.dataFinal.getFullYear(), q.dataFinal.getMonth(), q.dataFinal.getDate(), 23, 59, 59, 999);
  }
  if (q.pesquisa) {
    where.OR = [{ descricao: { contains: q.pesquisa } }, { contato: { nome: { contains: q.pesquisa } } }, { observacoes: { contains: q.pesquisa } }];
  }
  const whereSit = { ...where };
  if (q.situacao === 'ATRASADO') {
    whereSit.situacao = { in: ['ABERTO', 'PARCIAL'] };
    whereSit.vencimento = { ...(whereSit.vencimento || {}), lt: hoje };
  } else if (q.situacao) {
    whereSit.situacao = q.situacao;
  }
  return { where, whereSit, hoje };
}

export default async function financeiroRoutes(app: FastifyInstance) {
  const fin = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');
  const finLeitura = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR');

  const include = {
    contato: { select: { id: true, nome: true, celular: true, email: true } },
    formaPagamento: { select: { id: true, nome: true, tipo: true } },
    categoria: { select: { id: true, nome: true, tipo: true } },
    contaFinanceira: { select: { id: true, nome: true } },
  };

  // =====================================================================
  // CONTAS A RECEBER
  // =====================================================================
  app.get('/api/v1/contas-receber', { preHandler: finLeitura }, async (req) => {
    const q = listaSchema.parse(req.query);
    const { where, whereSit, hoje } = filtroBase(q, 'receber');
    // VENDEDOR só vê as próprias contas
    if (req.user.perfil === 'VENDEDOR' && req.user.vendedorId) {
      where.vendedorId = req.user.vendedorId;
      whereSit.vendedorId = req.user.vendedorId;
    }
    const [total, itens, abertas, recebidas] = await Promise.all([
      prisma.contaReceber.count({ where: whereSit }),
      prisma.contaReceber.findMany({
        where: whereSit,
        include: { ...include, vendedor: { select: { id: true, nome: true } } },
        orderBy: [{ vencimento: 'asc' }, { id: 'asc' }],
        ...paginar(q),
      }),
      prisma.contaReceber.findMany({ where: { ...where, situacao: { in: ['ABERTO', 'PARCIAL'] } }, select: { valor: true, valorRecebido: true, desconto: true, vencimento: true } }),
      prisma.contaReceber.aggregate({ where: { ...where, situacao: { in: ['RECEBIDO', 'PARCIAL'] } }, _sum: { valorRecebido: true } }),
    ]);
    const origem = await mapaOrigens(itens);
    const rest = (c: { valor: number; valorRecebido: number; desconto: number }) => Math.max(0, c.valor - c.valorRecebido - c.desconto);
    return {
      ...respostaPaginada(
        itens.map((c) => ({ ...c, atrasada: ['ABERTO', 'PARCIAL'].includes(c.situacao) && c.vencimento < hoje, saldo: arredondar(rest(c)), origem: origem(c) })),
        total,
        q,
      ),
      totais: {
        aberto: arredondar(abertas.reduce((s, c) => s + rest(c), 0)),
        recebido: arredondar(recebidas._sum.valorRecebido || 0),
        atrasado: arredondar(abertas.filter((c) => c.vencimento < hoje).reduce((s, c) => s + rest(c), 0)),
      },
    };
  });

  app.get('/api/v1/contas-receber/:id', { preHandler: finLeitura }, async (req) => {
    const id = Number((req.params as any).id);
    const c = await prisma.contaReceber.findUnique({
      where: { id },
      include: { ...include, vendedor: { select: { id: true, nome: true } }, lancamentos: { include: { contaFinanceira: { select: { id: true, nome: true } } }, orderBy: { data: 'asc' } } },
    });
    if (!c) throw new NotFound('Conta a receber');
    const origem = await mapaOrigens([c]);
    return { ...c, atrasada: ['ABERTO', 'PARCIAL'].includes(c.situacao) && c.vencimento < startOfDay(new Date()), origem: origem(c) };
  });

  app.post('/api/v1/contas-receber', { preHandler: fin }, async (req, reply) => {
    const b = contaSchema.parse(req.body);
    if (!b.vencimento) throw new AppError('Informe o vencimento.', 400, 'VALIDACAO');
    const c = await prisma.contaReceber.create({
      data: {
        contatoId: b.contatoId ?? null,
        vendedorId: b.vendedorId ?? null,
        descricao: b.descricao,
        dataEmissao: b.dataEmissao ?? new Date(),
        vencimento: b.vencimento,
        competencia: b.competencia ?? competenciaDe(b.vencimento),
        valor: arredondar(b.valor),
        formaPagamentoId: b.formaPagamentoId ?? null,
        contaFinanceiraId: b.contaFinanceiraId ?? null,
        categoriaId: b.categoriaId ?? null,
        origemTipo: b.origemTipo ?? 'MANUAL',
        origemId: b.origemId ?? null,
        parcela: b.parcela ?? null,
        observacoes: b.observacoes ?? null,
      },
      include,
    });
    await auditar(req, 'ContaReceber', c.id, 'CRIAR', { descricao: c.descricao, valor: c.valor });
    return reply.code(201).send(c);
  });

  app.put('/api/v1/contas-receber/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = contaSchema.partial().parse(req.body);
    const atual = await prisma.contaReceber.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a receber');
    if (atual.situacao === 'CANCELADO') throw new AppError('Conta cancelada não pode ser alterada.', 422, 'SITUACAO_INVALIDA');
    if (b.valor !== undefined && atual.situacao !== 'ABERTO') throw new AppError('Estorne a baixa antes de alterar o valor.', 422, 'JA_BAIXADA');
    const data: any = { ...b };
    delete data.recorrente;
    if (b.dataEmissao === undefined) delete data.dataEmissao;
    if (b.vencimento === undefined) delete data.vencimento;
    if (b.valor !== undefined) data.valor = arredondar(b.valor);
    const c = await prisma.contaReceber.update({ where: { id }, data, include });
    await auditar(req, 'ContaReceber', id, 'ALTERAR', b);
    return c;
  });

  app.delete('/api/v1/contas-receber/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const atual = await prisma.contaReceber.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a receber');
    if (['RECEBIDO', 'PARCIAL'].includes(atual.situacao)) throw new AppError('Conta com baixa: estorne antes de cancelar.', 422, 'JA_BAIXADA');
    await prisma.contaReceber.update({ where: { id }, data: { situacao: 'CANCELADO' } });
    await auditar(req, 'ContaReceber', id, 'EXCLUIR');
    return { ok: true, situacao: 'CANCELADO' };
  });

  app.post('/api/v1/contas-receber/:id/baixar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = baixaSchema.parse(req.body);
    const atual = await prisma.contaReceber.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a receber');
    const valor = b.valor ?? arredondar(atual.valor - atual.valorRecebido - atual.desconto - b.desconto + b.juros);
    const r = await baixarContaReceber({
      id,
      valor,
      data: b.data ?? new Date(),
      contaFinanceiraId: b.contaFinanceiraId,
      formaPagamentoId: b.formaPagamentoId,
      juros: b.juros,
      desconto: b.desconto,
      observacoes: b.observacoes,
    });
    await auditar(req, 'ContaReceber', id, 'ACAO', { acao: 'baixar', valor, contaFinanceiraId: b.contaFinanceiraId });
    return { conta: r.conta, movimento: r.movimento };
  });

  app.post('/api/v1/contas-receber/:id/estornar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const r = await estornarContaReceber(id);
    await auditar(req, 'ContaReceber', id, 'ACAO', { acao: 'estornar', movimentos: r.movimentosEstornados });
    return r;
  });

  // =====================================================================
  // CONTAS A PAGAR
  // =====================================================================
  app.get('/api/v1/contas-pagar', { preHandler: fin }, async (req) => {
    const q = listaSchema.parse(req.query);
    const { where, whereSit, hoje } = filtroBase(q, 'pagar');
    if (q.situacao === 'RECEBIDO') whereSit.situacao = 'PAGO';
    // ordem pedida pelo Thiago (26/10/2026): vencidas primeiro, depois a vencer, pagas por último
    // (canceladas no fim de tudo); dentro de cada grupo, por vencimento
    const grupo = (c: { situacao: string; vencimento: Date }) => (c.situacao === 'CANCELADO' ? 3 : c.situacao === 'PAGO' ? 2 : c.vencimento < hoje ? 0 : 1);
    const pagina = paginar(q) as { skip?: number; take?: number };
    const idsPagina = async () => {
      const todos = await prisma.contaPagar.findMany({ where: whereSit, select: { id: true, situacao: true, vencimento: true } });
      todos.sort((a, b) => grupo(a) - grupo(b) || +a.vencimento - +b.vencimento || a.id - b.id);
      const ini = pagina.skip ?? 0;
      return todos.slice(ini, pagina.take !== undefined ? ini + pagina.take : undefined).map((c) => c.id);
    };
    const [total, itens, abertas, pagas] = await Promise.all([
      prisma.contaPagar.count({ where: whereSit }),
      idsPagina().then(async (ids) => {
        const linhas = await prisma.contaPagar.findMany({ where: { id: { in: ids } }, include });
        const pos = new Map(ids.map((id, i) => [id, i]));
        return linhas.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
      }),
      prisma.contaPagar.findMany({ where: { ...where, situacao: { in: ['ABERTO', 'PARCIAL'] } }, select: { valor: true, valorPago: true, juros: true, desconto: true, vencimento: true } }),
      prisma.contaPagar.aggregate({ where: { ...where, situacao: { in: ['PAGO', 'PARCIAL'] } }, _sum: { valorPago: true } }),
    ]);
    const origem = await mapaOrigens(itens);
    const rest = saldoContaPagar;
    return {
      ...respostaPaginada(
        itens.map((c) => ({ ...c, atrasada: ['ABERTO', 'PARCIAL'].includes(c.situacao) && c.vencimento < hoje, saldo: arredondar(rest(c)), origem: origem(c) })),
        total,
        q,
      ),
      totais: {
        aberto: arredondar(abertas.reduce((s, c) => s + rest(c), 0)),
        pago: arredondar(pagas._sum.valorPago || 0),
        atrasado: arredondar(abertas.filter((c) => c.vencimento < hoje).reduce((s, c) => s + rest(c), 0)),
      },
    };
  });

  app.get('/api/v1/contas-pagar/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const c = await prisma.contaPagar.findUnique({
      where: { id },
      include: { ...include, lancamentos: { include: { contaFinanceira: { select: { id: true, nome: true } } }, orderBy: { data: 'asc' } } },
    });
    if (!c) throw new NotFound('Conta a pagar');
    const origem = await mapaOrigens([c]);
    return { ...c, saldo: saldoContaPagar(c), atrasada: ['ABERTO', 'PARCIAL'].includes(c.situacao) && c.vencimento < startOfDay(new Date()), origem: origem(c) };
  });

  app.post('/api/v1/contas-pagar', { preHandler: fin }, async (req, reply) => {
    const b = contaSchema.parse(req.body);
    if (!b.vencimento) throw new AppError('Informe o vencimento.', 400, 'VALIDACAO');
    const c = await prisma.contaPagar.create({
      data: {
        contatoId: b.contatoId ?? null,
        descricao: b.descricao,
        dataEmissao: b.dataEmissao ?? new Date(),
        vencimento: b.vencimento,
        competencia: b.competencia ?? competenciaDe(b.vencimento),
        valor: arredondar(b.valor),
        formaPagamentoId: b.formaPagamentoId ?? null,
        contaFinanceiraId: b.contaFinanceiraId ?? null,
        categoriaId: b.categoriaId ?? null,
        origemTipo: b.origemTipo ?? 'MANUAL',
        origemId: b.origemId ?? null,
        parcela: b.parcela ?? null,
        observacoes: b.observacoes ?? null,
        recorrente: !!b.recorrente,
      },
      include,
    });
    await auditar(req, 'ContaPagar', c.id, 'CRIAR', { descricao: c.descricao, valor: c.valor });
    return reply.code(201).send(c);
  });

  app.put('/api/v1/contas-pagar/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = contaSchema.partial().parse(req.body);
    const atual = await prisma.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a pagar');
    if (atual.situacao === 'CANCELADO') throw new AppError('Conta cancelada não pode ser alterada.', 422, 'SITUACAO_INVALIDA');
    if (b.valor !== undefined && atual.situacao !== 'ABERTO') throw new AppError('Estorne a baixa antes de alterar o valor.', 422, 'JA_BAIXADA');
    const data: any = { ...b };
    delete data.vendedorId;
    if (b.dataEmissao === undefined) delete data.dataEmissao;
    if (b.vencimento === undefined) delete data.vencimento;
    if (b.valor !== undefined) data.valor = arredondar(b.valor);
    const c = await prisma.contaPagar.update({ where: { id }, data, include });
    await auditar(req, 'ContaPagar', id, 'ALTERAR', b);
    return c;
  });

  app.delete('/api/v1/contas-pagar/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const atual = await prisma.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a pagar');
    if (['PAGO', 'PARCIAL'].includes(atual.situacao)) throw new AppError('Conta com baixa: estorne antes de cancelar.', 422, 'JA_BAIXADA');
    await prisma.contaPagar.update({ where: { id }, data: { situacao: 'CANCELADO' } });
    await auditar(req, 'ContaPagar', id, 'EXCLUIR');
    return { ok: true, situacao: 'CANCELADO' };
  });

  app.post('/api/v1/contas-pagar/:id/baixar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = baixaSchema.parse(req.body);
    const atual = await prisma.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a pagar');
    const valor = b.valor ?? arredondar(saldoContaPagar(atual) - b.desconto + b.juros);
    const r = await baixarContaPagar({
      id,
      valor,
      data: b.data ?? new Date(),
      contaFinanceiraId: b.contaFinanceiraId,
      formaPagamentoId: b.formaPagamentoId,
      juros: b.juros,
      desconto: b.desconto,
      observacoes: b.observacoes,
    });
    await auditar(req, 'ContaPagar', id, 'ACAO', { acao: 'baixar', valor, contaFinanceiraId: b.contaFinanceiraId });
    return { conta: r.conta, movimento: r.movimento };
  });

  app.post('/api/v1/contas-pagar/:id/estornar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const r = await estornarContaPagar(id);
    await auditar(req, 'ContaPagar', id, 'ACAO', { acao: 'estornar', movimentos: r.movimentosEstornados });
    return r;
  });

  /** Estorna só um pagamento (ex.: uma das baixas parciais), mantendo os demais. */
  app.post('/api/v1/contas-pagar/:id/pagamentos/:movimentoId/estornar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const movimentoId = Number((req.params as any).movimentoId);
    const r = await estornarPagamentoContaPagar(id, movimentoId);
    await auditar(req, 'ContaPagar', id, 'ACAO', { acao: 'estornar_pagamento', movimentoId, valor: r.movimentoEstornado.valor, descricao: r.conta.descricao });
    return r;
  });

  /** Conta recorrente: gera uma cópia para o mês seguinte (mesmo dia de vencimento). */
  app.post('/api/v1/contas-pagar/:id/gerar-proxima', { preHandler: fin }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const atual = await prisma.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a pagar');
    const vencimento = addMonths(atual.vencimento, 1);
    const competencia = competenciaDe(vencimento);
    const jaExiste = await prisma.contaPagar.findFirst({
      where: { descricao: atual.descricao, competencia, categoriaId: atual.categoriaId, situacao: { not: 'CANCELADO' } },
    });
    if (jaExiste) throw new AppError(`Já existe a conta "${atual.descricao}" na competência ${competencia}.`, 409, 'DUPLICADO');
    const nova = await prisma.contaPagar.create({
      data: {
        contatoId: atual.contatoId,
        descricao: atual.descricao,
        dataEmissao: new Date(),
        vencimento,
        competencia,
        valor: atual.valor,
        formaPagamentoId: atual.formaPagamentoId,
        categoriaId: atual.categoriaId,
        origemTipo: 'MANUAL',
        observacoes: atual.observacoes,
        recorrente: true,
      },
      include,
    });
    await auditar(req, 'ContaPagar', nova.id, 'CRIAR', { origem: id, recorrente: true });
    return reply.code(201).send(nova);
  });

  // =====================================================================
  // RESUMO / FLUXO DE CAIXA / MOVIMENTOS
  // =====================================================================
  app.get('/api/v1/financeiro/resumo', { preHandler: fin }, async () => resumoFinanceiro());

  app.get('/api/v1/financeiro/fluxo-caixa', { preHandler: fin }, async (req) => {
    const q = z
      .object({
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        contaFinanceiraId: z.coerce.number().int().optional(),
        agrupar: z.enum(['dia', 'semana', 'mes']).default('dia'),
      })
      .parse(req.query);
    const { ini, fim, tudo } = await resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar;
    const filtroConta = q.contaFinanceiraId ? { contaFinanceiraId: q.contaFinanceiraId } : {};

    // saldo inicial = saldo inicial das contas + movimentos antes do período
    const contas = await prisma.contaFinanceira.findMany({ where: { ativo: true, ...(q.contaFinanceiraId ? { id: q.contaFinanceiraId } : {}) } });
    const antes = await prisma.movimentoFinanceiro.groupBy({
      by: ['tipo'],
      where: { ...filtroConta, data: { lt: ini }, contaFinanceira: { ativo: true, tipo: { not: 'COMPENSACAO' } } },
      _sum: { valor: true },
    });
    const somaTipo = (tipo: string) => antes.find((a) => a.tipo === tipo)?._sum.valor || 0;
    const saldoInicial = arredondar(contas.reduce((s, c) => s + c.saldoInicial, 0) + somaTipo('ENTRADA') - somaTipo('SAIDA'));

    const movs = await prisma.movimentoFinanceiro.findMany({
      where: { ...filtroConta, data: { gte: ini, lte: fim }, contaFinanceira: { ativo: true, tipo: { not: 'COMPENSACAO' } } },
      select: {
        id: true, data: true, tipo: true, valor: true, descricao: true, observacoes: true, criadoEm: true,
        categoria: { select: { nome: true } },
        contaFinanceira: { select: { id: true, nome: true, cor: true } },
        contaReceber: { select: { origemTipo: true } },
        contaPagar: { select: { origemTipo: true } },
      },
    });
    // transferências e acertos de saldo mexem no saldo, mas não são entrada/saída de dinheiro da loja
    const fora = (m: { observacoes: string | null }) => OBS_FORA_DO_RESULTADO.includes(m.observacoes || '');
    const periodos = listarPeriodos(ini, fim, agrupar);
    const mapa = new Map(periodos.map((p) => [p, { periodo: p, entradas: 0, saidas: 0, ajustes: 0, saldo: 0 }]));
    for (const m of movs) {
      const k = chavePeriodo(m.data, agrupar);
      const s = mapa.get(k) || mapa.set(k, { periodo: k, entradas: 0, saidas: 0, ajustes: 0, saldo: 0 }).get(k)!;
      if (fora(m)) s.ajustes += m.tipo === 'ENTRADA' ? m.valor : -m.valor;
      else if (m.tipo === 'ENTRADA') s.entradas += m.valor;
      else if (m.tipo === 'SAIDA') s.saidas += m.valor;
    }
    let acumulado = saldoInicial;
    const series = [...mapa.values()]
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((s) => {
        acumulado = arredondar(acumulado + s.entradas - s.saidas + s.ajustes);
        return { periodo: s.periodo, entradas: arredondar(s.entradas), saidas: arredondar(s.saidas), ajustes: arredondar(s.ajustes), saldo: acumulado };
      });
    const operacionais = movs.filter((m) => !fora(m));
    const realizado = {
      entradas: arredondar(operacionais.filter((m) => m.tipo === 'ENTRADA').reduce((s, m) => s + m.valor, 0)),
      saidas: arredondar(operacionais.filter((m) => m.tipo === 'SAIDA').reduce((s, m) => s + m.valor, 0)),
      ajustes: arredondar(movs.filter(fora).reduce((s, m) => s + (m.tipo === 'ENTRADA' ? m.valor : -m.valor), 0)),
      saldoFinal: acumulado,
    };
    // quebras para o painel
    const agrupa = (lista: typeof movs, chave: (m: (typeof movs)[number]) => string) => {
      const g = new Map<string, number>();
      for (const m of lista) g.set(chave(m), (g.get(chave(m)) || 0) + m.valor);
      return [...g.entries()].map(([nome, valor]) => ({ nome, valor: arredondar(valor) })).sort((a, b) => b.valor - a.valor);
    };
    const entradasOp = operacionais.filter((m) => m.tipo === 'ENTRADA');
    const saidasOp = operacionais.filter((m) => m.tipo === 'SAIDA');
    const origemEntrada = (m: (typeof movs)[number]) => (m.contaReceber?.origemTipo === 'VENDA' ? 'Vendas' : m.contaReceber?.origemTipo === 'OS' ? 'Assistência técnica' : m.contaReceber ? 'Outros recebimentos' : 'Lançamentos avulsos');
    const origemSaida = (m: (typeof movs)[number]) => (m.contaPagar?.origemTipo === 'COMPRA' ? 'Compras de mercadoria' : m.contaPagar?.origemTipo === 'COMISSAO' ? 'Comissões' : m.contaPagar ? 'Contas a pagar' : 'Lançamentos avulsos');
    const quebras = {
      entradasPorCategoria: agrupa(entradasOp, (m) => m.categoria?.nome || 'Sem categoria').slice(0, 8),
      saidasPorCategoria: agrupa(saidasOp, (m) => m.categoria?.nome || 'Sem categoria').slice(0, 8),
      entradasPorOrigem: agrupa(entradasOp, origemEntrada),
      saidasPorOrigem: agrupa(saidasOp, origemSaida),
    };
    const contasSaldo = await prisma.contaFinanceira.findMany({ where: { ativo: true }, select: { id: true, nome: true, cor: true, saldoAtual: true }, orderBy: { saldoAtual: 'desc' } });
    const saldoAgora = arredondar(contasSaldo.filter((c) => !q.contaFinanceiraId || c.id === q.contaFinanceiraId).reduce((s, c) => s + c.saldoAtual, 0));
    const ultimos = [...movs]
      .sort((a, b) => +b.criadoEm - +a.criadoEm)
      .slice(0, 12)
      .map((m) => ({ id: m.id, data: m.data, criadoEm: m.criadoEm, tipo: m.tipo, valor: m.valor, descricao: m.descricao, conta: m.contaFinanceira, foraDoResultado: fora(m) }));

    // previsto: contas em aberto por vencimento dentro do período
    const [cr, cp] = await Promise.all([
      prisma.contaReceber.findMany({ where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { gte: ini, lte: fim } }, select: { vencimento: true, valor: true, valorRecebido: true, desconto: true } }),
      prisma.contaPagar.findMany({ where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { gte: ini, lte: fim } }, select: { vencimento: true, valor: true, valorPago: true, juros: true, desconto: true } }),
    ]);
    const prev = new Map(periodos.map((p) => [p, { periodo: p, receber: 0, pagar: 0 }]));
    for (const c of cr) {
      const k = chavePeriodo(c.vencimento, agrupar);
      const s = prev.get(k) || prev.set(k, { periodo: k, receber: 0, pagar: 0 }).get(k)!;
      s.receber += Math.max(0, c.valor - c.valorRecebido - c.desconto);
    }
    for (const c of cp) {
      const k = chavePeriodo(c.vencimento, agrupar);
      const s = prev.get(k) || prev.set(k, { periodo: k, receber: 0, pagar: 0 }).get(k)!;
      s.pagar += saldoContaPagar(c);
    }
    let projetado = acumulado;
    const previsto = [...prev.values()]
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((p) => {
        projetado = arredondar(projetado + p.receber - p.pagar);
        return { periodo: p.periodo, receber: arredondar(p.receber), pagar: arredondar(p.pagar), saldoProjetado: projetado };
      });

    // próximos 7 dias (a partir de hoje), independente do período
    const hojeIni = startOfDay(new Date());
    const em7 = new Date(hojeIni.getTime() + 8 * 86400000 - 1);
    const [cr7, cp7] = await Promise.all([
      prisma.contaReceber.findMany({ where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lte: em7 } }, orderBy: { vencimento: 'asc' }, take: 40, select: { id: true, descricao: true, vencimento: true, valor: true, valorRecebido: true, juros: true, desconto: true, contato: { select: { nome: true } } } }),
      prisma.contaPagar.findMany({ where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lte: em7 } }, orderBy: { vencimento: 'asc' }, take: 40, select: { id: true, descricao: true, vencimento: true, valor: true, valorPago: true, juros: true, desconto: true, contato: { select: { nome: true } } } }),
    ]);
    const proximos = {
      receber: cr7.map((c) => ({ id: c.id, descricao: c.descricao, contato: c.contato?.nome ?? null, vencimento: c.vencimento, valor: saldoContaReceber(c), atrasada: c.vencimento < hojeIni })).filter((c) => c.valor > 0.009),
      pagar: cp7.map((c) => ({ id: c.id, descricao: c.descricao, contato: c.contato?.nome ?? null, vencimento: c.vencimento, valor: saldoContaPagar(c), atrasada: c.vencimento < hojeIni })).filter((c) => c.valor > 0.009),
    };

    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar },
      saldoInicial,
      series,
      realizado,
      previsto,
      quebras,
      saldoAgora,
      contas: contasSaldo.map((c) => ({ ...c, saldoAtual: arredondar(c.saldoAtual) })),
      ultimos,
      proximos,
      atualizadoEm: new Date(),
    };
  });

  app.get('/api/v1/financeiro/movimentos', { preHandler: fin }, async (req) => {
    const q = paginacaoSchema
      .extend({
        contaFinanceiraId: z.coerce.number().int().optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        tipo: z.enum(['ENTRADA', 'SAIDA']).optional(),
        conciliado: z.enum(['true', 'false']).optional(),
        pesquisa: z.string().trim().optional(),
      })
      .parse(req.query);
    const where: any = {};
    if (q.contaFinanceiraId) where.contaFinanceiraId = q.contaFinanceiraId;
    if (q.tipo) where.tipo = q.tipo;
    if (q.conciliado) where.conciliado = q.conciliado === 'true';
    if (q.dataInicial || q.dataFinal) {
      where.data = {};
      if (q.dataInicial) where.data.gte = startOfDay(q.dataInicial);
      if (q.dataFinal) where.data.lte = new Date(q.dataFinal.getFullYear(), q.dataFinal.getMonth(), q.dataFinal.getDate(), 23, 59, 59, 999);
    }
    if (q.pesquisa) where.descricao = { contains: q.pesquisa };
    const [total, data] = await Promise.all([
      prisma.movimentoFinanceiro.count({ where }),
      prisma.movimentoFinanceiro.findMany({
        where,
        include: {
          contaFinanceira: { select: { id: true, nome: true, cor: true } },
          categoria: { select: { id: true, nome: true } },
          contaReceber: { select: { id: true, descricao: true, contato: { select: { id: true, nome: true } } } },
          contaPagar: { select: { id: true, descricao: true, contato: { select: { id: true, nome: true } } } },
        },
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        ...paginar(q),
      }),
    ]);
    return respostaPaginada(data, total, q);
  });

  app.post('/api/v1/financeiro/movimentos', { preHandler: fin }, async (req, reply) => {
    const b = z
      .object({
        contaFinanceiraId: z.number().int(),
        data: dataSchema,
        tipo: z.enum(['ENTRADA', 'SAIDA']),
        valor: z.number().positive(),
        descricao: z.string().trim().min(1),
        categoriaId: z.number().int().nullable().optional(),
        observacoes: z.string().nullable().optional(),
      })
      .parse(req.body);
    const m = await criarMovimentoAvulso({ ...b, data: b.data ?? new Date() });
    await auditar(req, 'MovimentoFinanceiro', m.id, 'CRIAR', { tipo: b.tipo, valor: b.valor });
    return reply.code(201).send(m);
  });

  // extrato da conta: de onde veio / para onde foi cada lançamento e o saldo depois dele
  app.get('/api/v1/contas-financeiras/:id/extrato', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const q = z.object({ dataInicial: dataSchema, dataFinal: dataSchema }).parse(req.query);
    return extratoConta(id, { dataInicial: q.dataInicial, dataFinal: q.dataFinal });
  });

  // acerta o saldo da conta com o valor real; a diferença não entra no DRE
  app.post('/api/v1/contas-financeiras/:id/ajustar-saldo', { preHandler: fin }, async (req, reply) => {
    const id = Number((req.params as any).id);
    const b = z.object({ saldoReal: z.number(), data: dataSchema, descricao: z.string().nullable().optional() }).parse(req.body);
    const r = await ajustarSaldoConta({ contaFinanceiraId: id, saldoReal: b.saldoReal, data: b.data ?? new Date(), descricao: b.descricao });
    await auditar(req, 'ContaFinanceira', id, 'ACAO', { acao: 'ajustar-saldo', saldoAnterior: r.saldoAnterior, saldoReal: b.saldoReal, diferenca: r.diferenca });
    return reply.code(201).send(r);
  });

  app.post('/api/v1/financeiro/transferencia', { preHandler: fin }, async (req, reply) => {
    const b = z
      .object({
        origemId: z.number().int(),
        destinoId: z.number().int(),
        valor: z.number().positive(),
        data: dataSchema,
        descricao: z.string().nullable().optional(),
      })
      .parse(req.body);
    const r = await transferirEntreContas({ ...b, data: b.data ?? new Date() });
    await auditar(req, 'MovimentoFinanceiro', r.saida.id, 'CRIAR', { transferencia: true, ...b });
    return reply.code(201).send(r);
  });

  app.delete('/api/v1/financeiro/movimentos/:id', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const m = await excluirMovimento(id);
    await auditar(req, 'MovimentoFinanceiro', id, 'EXCLUIR', { valor: m.valor, tipo: m.tipo });
    return { ok: true };
  });
}
