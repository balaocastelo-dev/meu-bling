/**
 * Cadastros auxiliares: vendedores, técnicos, depósitos, formas de pagamento,
 * categorias financeiras, categorias de produto e contas financeiras.
 * Listagens devolvem array simples (para selects). DELETE: se estiver em uso → ativo=false, senão exclui.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { boolQuery, idDe } from '../comum/zod.js';

const CONFIG = ['ADMIN', 'GERENTE'] as const;

const listaQuery = z.object({ ativo: boolQuery, pesquisa: z.string().trim().optional() });

/** Fábrica de CRUD simples. */
interface CrudDef<TCreate, TUpdate> {
  rota: string;
  entidade: string;
  schema: z.ZodType<TCreate>;
  schemaUpdate: z.ZodType<TUpdate>;
  listar: (q: { ativo?: boolean; pesquisa?: string }) => Promise<unknown[]>;
  obter: (id: number) => Promise<unknown | null>;
  criar: (data: TCreate, req: FastifyRequest) => Promise<{ id: number }>;
  atualizar: (id: number, data: TUpdate, req: FastifyRequest) => Promise<unknown>;
  /** true se o registro está em uso (então desativa em vez de excluir) */
  emUso: (id: number) => Promise<boolean>;
  excluir: (id: number) => Promise<void>;
  desativar?: (id: number) => Promise<void>;
  /** perfil exigido nas mutações */
  perfisMutacao?: readonly string[];
}

function registrarCrud<TC, TU>(app: FastifyInstance, def: CrudDef<TC, TU>) {
  const base = `/api/v1/${def.rota}`;
  const pre = def.perfisMutacao ? { preHandler: app.exigirPerfil(...(def.perfisMutacao as any)) } : {};

  app.get(base, async (req) => {
    const q = listaQuery.parse(req.query);
    return def.listar(q);
  });

  app.get(`${base}/:id`, async (req) => {
    const r = await def.obter(idDe(req));
    if (!r) throw new NotFound(def.entidade);
    return r;
  });

  app.post(base, pre, async (req, reply) => {
    const body = def.schema.parse(req.body);
    const r = await def.criar(body, req);
    await auditar(req, def.entidade, r.id, 'CRIAR', body);
    return reply.code(201).send(await def.obter(r.id));
  });

  app.put(`${base}/:id`, pre, async (req) => {
    const id = idDe(req);
    if (!(await def.obter(id))) throw new NotFound(def.entidade);
    const body = def.schemaUpdate.parse(req.body);
    await def.atualizar(id, body, req);
    await auditar(req, def.entidade, id, 'ALTERAR', body);
    return def.obter(id);
  });

  app.delete(`${base}/:id`, { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    if (!(await def.obter(id))) throw new NotFound(def.entidade);
    if (await def.emUso(id)) {
      if (!def.desativar) throw new AppError(`${def.entidade} está em uso e não pode ser excluído(a).`, 409, 'EM_USO');
      await def.desativar(id);
      await auditar(req, def.entidade, id, 'EXCLUIR', { desativado: true });
      return { ok: true, desativado: true, mensagem: `${def.entidade} está em uso: foi desativado(a) em vez de excluído(a).` };
    }
    await def.excluir(id);
    await auditar(req, def.entidade, id, 'EXCLUIR');
    return { ok: true, desativado: false };
  });
}

const nomeContains = (pesquisa?: string) => (pesquisa ? { nome: { contains: pesquisa } } : {});

export default async function cadastrosRoutes(app: FastifyInstance) {
  // ---------------- Vendedores
  const vendedorSchema = z.object({
    nome: z.string().trim().min(2),
    email: z.string().trim().email().nullable().optional().or(z.literal('')),
    telefone: z.string().trim().nullable().optional(),
    comissaoPadraoPct: z.coerce.number().min(0).max(100).default(0),
    ativo: z.boolean().default(true),
  });
  registrarCrud(app, {
    rota: 'vendedores',
    entidade: 'Vendedor',
    schema: vendedorSchema,
    schemaUpdate: vendedorSchema.partial(),
    perfisMutacao: CONFIG,
    listar: (q) => prisma.vendedor.findMany({ where: { ativo: q.ativo, ...nomeContains(q.pesquisa) }, orderBy: { nome: 'asc' } }),
    obter: (id) => prisma.vendedor.findUnique({ where: { id }, include: { usuario: { select: { id: true, nome: true, email: true } } } }),
    criar: (d) => prisma.vendedor.create({ data: { ...d, email: d.email || null } }),
    atualizar: (id, d) => prisma.vendedor.update({ where: { id }, data: { ...d, email: d.email === '' ? null : d.email } }),
    emUso: async (id) =>
      (await prisma.venda.count({ where: { vendedorId: id } })) > 0 ||
      (await prisma.ordemServico.count({ where: { vendedorId: id } })) > 0 ||
      (await prisma.comissao.count({ where: { vendedorId: id } })) > 0 ||
      (await prisma.contato.count({ where: { vendedorId: id } })) > 0 ||
      (await prisma.usuario.count({ where: { vendedorId: id } })) > 0,
    excluir: async (id) => {
      await prisma.vendedor.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.vendedor.update({ where: { id }, data: { ativo: false } });
    },
  });

  // ---------------- Técnicos
  const tecnicoSchema = z.object({
    nome: z.string().trim().min(2),
    email: z.string().trim().email().nullable().optional().or(z.literal('')),
    telefone: z.string().trim().nullable().optional(),
    especialidade: z.string().trim().nullable().optional(),
    comissaoPadraoPct: z.coerce.number().min(0).max(100).default(0),
    ativo: z.boolean().default(true),
  });
  registrarCrud(app, {
    rota: 'tecnicos',
    entidade: 'Técnico',
    schema: tecnicoSchema,
    schemaUpdate: tecnicoSchema.partial(),
    perfisMutacao: CONFIG,
    listar: (q) => prisma.tecnico.findMany({ where: { ativo: q.ativo, ...nomeContains(q.pesquisa) }, orderBy: { nome: 'asc' } }),
    obter: (id) => prisma.tecnico.findUnique({ where: { id }, include: { usuario: { select: { id: true, nome: true, email: true } } } }),
    criar: (d) => prisma.tecnico.create({ data: { ...d, email: d.email || null } }),
    atualizar: (id, d) => prisma.tecnico.update({ where: { id }, data: { ...d, email: d.email === '' ? null : d.email } }),
    emUso: async (id) =>
      (await prisma.ordemServico.count({ where: { tecnicoId: id } })) > 0 ||
      (await prisma.comissao.count({ where: { tecnicoId: id } })) > 0 ||
      (await prisma.usuario.count({ where: { tecnicoId: id } })) > 0,
    excluir: async (id) => {
      await prisma.tecnico.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.tecnico.update({ where: { id }, data: { ativo: false } });
    },
  });

  // ---------------- Depósitos
  const depositoSchema = z.object({
    nome: z.string().trim().min(2),
    padrao: z.boolean().default(false),
    ativo: z.boolean().default(true),
    desconsiderarSaldo: z.boolean().default(false),
  });
  const garantirUnicoPadrao = async (id: number, padrao?: boolean) => {
    if (padrao) await prisma.deposito.updateMany({ where: { id: { not: id }, padrao: true }, data: { padrao: false } });
  };
  registrarCrud(app, {
    rota: 'depositos',
    entidade: 'Depósito',
    schema: depositoSchema,
    schemaUpdate: depositoSchema.partial(),
    perfisMutacao: CONFIG,
    listar: (q) => prisma.deposito.findMany({ where: { ativo: q.ativo, ...nomeContains(q.pesquisa) }, orderBy: [{ padrao: 'desc' }, { nome: 'asc' }] }),
    obter: (id) => prisma.deposito.findUnique({ where: { id } }),
    criar: async (d) => {
      const r = await prisma.deposito.create({ data: d });
      await garantirUnicoPadrao(r.id, d.padrao);
      return r;
    },
    atualizar: async (id, d) => {
      const r = await prisma.deposito.update({ where: { id }, data: d });
      await garantirUnicoPadrao(id, d.padrao);
      return r;
    },
    emUso: async (id) =>
      (await prisma.estoqueSaldo.count({ where: { depositoId: id } })) > 0 ||
      (await prisma.movimentoEstoque.count({ where: { depositoId: id } })) > 0 ||
      (await prisma.venda.count({ where: { depositoId: id } })) > 0 ||
      (await prisma.compra.count({ where: { depositoId: id } })) > 0 ||
      (await prisma.ordemServico.count({ where: { depositoId: id } })) > 0,
    excluir: async (id) => {
      await prisma.deposito.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.deposito.update({ where: { id }, data: { ativo: false, padrao: false } });
    },
  });

  // ---------------- Formas de pagamento
  const TIPOS_FP = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'CREDIARIO', 'OUTRO'] as const;
  const formaSchema = z.object({
    nome: z.string().trim().min(2),
    tipo: z.enum(TIPOS_FP).default('OUTRO'),
    codigoFiscal: z.string().trim().length(2).default('99'),
    taxaPct: z.coerce.number().min(0).max(100).default(0),
    diasRecebimento: z.coerce.number().int().min(0).default(0),
    maxParcelas: z.coerce.number().int().min(1).default(1),
    /** banco/conta onde o dinheiro desta forma cai */
    contaFinanceiraId: z.coerce.number().int().positive().nullable().optional(),
    ativo: z.boolean().default(true),
  });
  registrarCrud(app, {
    rota: 'formas-pagamento',
    entidade: 'Forma de pagamento',
    schema: formaSchema,
    schemaUpdate: formaSchema.partial(),
    perfisMutacao: CONFIG,
    listar: (q) => prisma.formaPagamento.findMany({ where: { ativo: q.ativo, ...nomeContains(q.pesquisa) }, orderBy: { nome: 'asc' } }),
    obter: (id) => prisma.formaPagamento.findUnique({ where: { id } }),
    criar: (d) => prisma.formaPagamento.create({ data: d }),
    atualizar: (id, d) => prisma.formaPagamento.update({ where: { id }, data: d }),
    emUso: async (id) =>
      (await prisma.vendaParcela.count({ where: { formaPagamentoId: id } })) > 0 ||
      (await prisma.compraParcela.count({ where: { formaPagamentoId: id } })) > 0 ||
      (await prisma.ordemServicoParcela.count({ where: { formaPagamentoId: id } })) > 0 ||
      (await prisma.contaReceber.count({ where: { formaPagamentoId: id } })) > 0 ||
      (await prisma.contaPagar.count({ where: { formaPagamentoId: id } })) > 0,
    excluir: async (id) => {
      await prisma.formaPagamento.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.formaPagamento.update({ where: { id }, data: { ativo: false } });
    },
  });

  // ---------------- Categorias financeiras
  const GRUPOS_DRE = ['RECEITA_BRUTA', 'DEDUCAO', 'CMV', 'DESPESA_OPERACIONAL', 'DESPESA_PESSOAL', 'DESPESA_FINANCEIRA', 'RECEITA_FINANCEIRA', 'OUTRAS'] as const;
  const catFinSchema = z.object({
    nome: z.string().trim().min(2),
    tipo: z.enum(['RECEITA', 'DESPESA']),
    grupoDre: z.enum(GRUPOS_DRE).optional(),
    paiId: z.coerce.number().int().positive().nullable().optional(),
    ativo: z.boolean().default(true),
  });
  registrarCrud(app, {
    rota: 'categorias-financeiras',
    entidade: 'Categoria financeira',
    schema: catFinSchema,
    schemaUpdate: catFinSchema.partial(),
    perfisMutacao: ['ADMIN', 'GERENTE', 'FINANCEIRO'],
    listar: (q) =>
      prisma.categoriaFinanceira.findMany({
        where: { ativo: q.ativo, ...nomeContains(q.pesquisa) },
        include: { pai: { select: { id: true, nome: true } } },
        orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
      }),
    obter: (id) => prisma.categoriaFinanceira.findUnique({ where: { id }, include: { pai: { select: { id: true, nome: true } }, filhas: { select: { id: true, nome: true } } } }),
    criar: (d) => prisma.categoriaFinanceira.create({ data: { ...d, grupoDre: d.grupoDre || (d.tipo === 'RECEITA' ? 'RECEITA_BRUTA' : 'DESPESA_OPERACIONAL') } }),
    atualizar: async (id, d) => {
      if (d.paiId === id) throw new AppError('A categoria não pode ser pai de si mesma.');
      return prisma.categoriaFinanceira.update({ where: { id }, data: d });
    },
    emUso: async (id) =>
      (await prisma.contaReceber.count({ where: { categoriaId: id } })) > 0 ||
      (await prisma.contaPagar.count({ where: { categoriaId: id } })) > 0 ||
      (await prisma.movimentoFinanceiro.count({ where: { categoriaId: id } })) > 0 ||
      (await prisma.venda.count({ where: { categoriaFinanceiraId: id } })) > 0 ||
      (await prisma.compra.count({ where: { categoriaFinanceiraId: id } })) > 0 ||
      (await prisma.ordemServico.count({ where: { categoriaFinanceiraId: id } })) > 0 ||
      (await prisma.transacaoBancaria.count({ where: { categoriaId: id } })) > 0 ||
      (await prisma.categoriaFinanceira.count({ where: { paiId: id } })) > 0,
    excluir: async (id) => {
      await prisma.categoriaFinanceira.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.categoriaFinanceira.update({ where: { id }, data: { ativo: false } });
    },
  });

  // ---------------- Categorias de produto
  const catProdSchema = z.object({
    nome: z.string().trim().min(1),
    paiId: z.coerce.number().int().positive().nullable().optional(),
  });
  registrarCrud(app, {
    rota: 'categorias-produto',
    entidade: 'Categoria de produto',
    schema: catProdSchema,
    schemaUpdate: catProdSchema.partial(),
    perfisMutacao: ['ADMIN', 'GERENTE', 'VENDEDOR'],
    listar: (q) =>
      prisma.categoriaProduto.findMany({
        where: nomeContains(q.pesquisa),
        include: { pai: { select: { id: true, nome: true } }, _count: { select: { produtos: true } } },
        orderBy: { nome: 'asc' },
      }),
    obter: (id) => prisma.categoriaProduto.findUnique({ where: { id }, include: { pai: { select: { id: true, nome: true } }, filhas: { select: { id: true, nome: true } } } }),
    criar: (d) => prisma.categoriaProduto.create({ data: d }),
    atualizar: async (id, d) => {
      if (d.paiId === id) throw new AppError('A categoria não pode ser pai de si mesma.');
      return prisma.categoriaProduto.update({ where: { id }, data: d });
    },
    emUso: async (id) => (await prisma.produto.count({ where: { categoriaId: id } })) > 0 || (await prisma.categoriaProduto.count({ where: { paiId: id } })) > 0,
    excluir: async (id) => {
      await prisma.categoriaProduto.delete({ where: { id } });
    },
    // categoria de produto não tem "ativo": em uso → erro 409
  });

  // ---------------- Contas financeiras
  const contaSchema = z.object({
    nome: z.string().trim().min(2),
    tipo: z.enum(['CAIXA', 'BANCO', 'CARTAO', 'INVESTIMENTO', 'OUTRO']).default('BANCO'),
    banco: z.string().trim().nullable().optional(),
    agencia: z.string().trim().nullable().optional(),
    conta: z.string().trim().nullable().optional(),
    saldoInicial: z.coerce.number().default(0),
    padrao: z.boolean().default(false),
    ativo: z.boolean().default(true),
    cor: z.string().trim().nullable().optional(),
  });
  const selectConta = {
    id: true, nome: true, tipo: true, banco: true, agencia: true, conta: true, saldoInicial: true, saldoAtual: true,
    saldoBanco: true, saldoBancoEm: true, padrao: true, ativo: true, cor: true, openFinanceStatus: true, openFinanceItemId: true, ultimaSincronizacao: true,
  } as const;
  const unicaPadrao = async (id: number, padrao?: boolean) => {
    if (padrao) await prisma.contaFinanceira.updateMany({ where: { id: { not: id }, padrao: true }, data: { padrao: false } });
  };
  registrarCrud(app, {
    rota: 'contas-financeiras',
    entidade: 'Conta financeira',
    schema: contaSchema,
    schemaUpdate: contaSchema.partial(),
    perfisMutacao: ['ADMIN', 'GERENTE', 'FINANCEIRO'],
    listar: (q) => prisma.contaFinanceira.findMany({ where: { ativo: q.ativo, ...nomeContains(q.pesquisa) }, select: selectConta, orderBy: [{ padrao: 'desc' }, { nome: 'asc' }] }),
    obter: (id) => prisma.contaFinanceira.findUnique({ where: { id }, select: selectConta }),
    criar: async (d) => {
      const r = await prisma.contaFinanceira.create({ data: { ...d, saldoAtual: d.saldoInicial } });
      await unicaPadrao(r.id, d.padrao);
      return r;
    },
    atualizar: async (id, d) => {
      const atual = await prisma.contaFinanceira.findUnique({ where: { id } });
      const data: Record<string, unknown> = { ...d };
      // mudar saldo inicial ajusta o saldo atual pela diferença
      if (d.saldoInicial !== undefined && atual && d.saldoInicial !== atual.saldoInicial) {
        data.saldoAtual = atual.saldoAtual + (d.saldoInicial - atual.saldoInicial);
      }
      const r = await prisma.contaFinanceira.update({ where: { id }, data });
      await unicaPadrao(id, d.padrao);
      return r;
    },
    emUso: async (id) =>
      (await prisma.movimentoFinanceiro.count({ where: { contaFinanceiraId: id } })) > 0 ||
      (await prisma.contaReceber.count({ where: { contaFinanceiraId: id } })) > 0 ||
      (await prisma.contaPagar.count({ where: { contaFinanceiraId: id } })) > 0 ||
      (await prisma.transacaoBancaria.count({ where: { contaFinanceiraId: id } })) > 0,
    excluir: async (id) => {
      await prisma.contaFinanceira.delete({ where: { id } });
    },
    desativar: async (id) => {
      await prisma.contaFinanceira.update({ where: { id }, data: { ativo: false, padrao: false } });
    },
  });
}
