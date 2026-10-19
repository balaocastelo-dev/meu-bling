/**
 * Produtos/serviços e estoque (saldos, ajustes, transferências, movimentos).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar, dataSchema, paginacaoSchema, paginar, respostaPaginada } from '../../lib/util.js';
import { boolQuery, idDe } from '../comum/zod.js';
import { depositoPadraoId, entradaTransferencia, mapaEstoque, movimentarEstoque, movimentaEstoque, saldosDoProduto } from '../comum/estoque.js';
import { intervalo } from '../comum/datas.js';

const texto = z.string().trim().nullable().optional();

const produtoSchema = z.object({
  tipo: z.enum(['P', 'S']).default('P'),
  nome: z.string().trim().min(2, 'Informe o nome do produto'),
  codigo: texto,
  gtin: texto,
  unidade: z.string().trim().min(1).max(6).default('UN'),
  preco: z.coerce.number().min(0).default(0),
  precoCusto: z.coerce.number().min(0).default(0),
  descricaoCurta: texto,
  descricaoDetalhada: texto,
  imagemUrl: texto,
  marca: texto,
  peso: z.coerce.number().min(0).nullable().optional(),
  estoqueMinimo: z.coerce.number().min(0).default(0),
  controlaEstoque: z.boolean().default(true),
  garantiaDias: z.coerce.number().int().min(0).default(90),
  ativo: z.boolean().default(true),
  ncm: texto,
  cest: texto,
  cfopPadrao: texto,
  origem: z.coerce.number().int().min(0).max(8).default(0),
  csosn: texto,
  cst: texto,
  icmsAliquota: z.coerce.number().min(0).max(100).default(0),
  pisCst: z.string().trim().default('49'),
  cofinsCst: z.string().trim().default('49'),
  ipiCst: texto,
  codigoServico: texto,
  issAliquota: z.coerce.number().min(0).max(100).default(0),
  categoriaId: z.coerce.number().int().positive().nullable().optional(),
  /** opcional na criação: saldo inicial no depósito padrão */
  estoqueInicial: z.coerce.number().optional(),
  depositoId: z.coerce.number().int().positive().optional(),
});

const PERFIS_EDICAO = ['ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO'] as const;

export default async function produtosRoutes(app: FastifyInstance) {
  const edicao = { preHandler: app.exigirPerfil(...PERFIS_EDICAO) };

  // ------------------------------------------------------------ PRODUTOS
  app.get('/api/v1/produtos', async (req) => {
    const q = paginacaoSchema
      .extend({
        pesquisa: z.string().trim().optional(),
        tipo: z.enum(['P', 'S']).optional(),
        categoriaId: z.coerce.number().int().optional(),
        ativo: boolQuery,
        estoque: z.enum(['zerado', 'positivo', 'negativo', 'abaixoMinimo']).optional(),
        marca: z.string().trim().optional(),
      })
      .parse(req.query);

    const where: any = { tipo: q.tipo, categoriaId: q.categoriaId, ativo: q.ativo, marca: q.marca || undefined };
    if (q.pesquisa) {
      const p = q.pesquisa;
      const variantes = [...new Set([p, p.toLowerCase(), p.toUpperCase()])];
      where.OR = variantes.flatMap((v) => [{ nome: { contains: v } }, { codigo: { contains: v } }, { gtin: { contains: v } }, { marca: { contains: v } }]);
    }

    // filtro de estoque exige calcular o estoqueTotal (soma por depósito que conta);
    // para isso lista todos os candidatos e pagina em memória.
    if (q.estoque) {
      const todos = await prisma.produto.findMany({ where: { ...where, tipo: 'P', controlaEstoque: true }, orderBy: { nome: 'asc' }, include: { categoria: { select: { id: true, nome: true } } } });
      const mapa = await mapaEstoque(prisma, todos.map((p) => p.id));
      const comEstoque = todos.map((p) => ({ ...p, estoqueTotal: mapa.get(p.id)?.estoqueTotal ?? 0, estoqueReservado: mapa.get(p.id)?.estoqueReservado ?? 0 }));
      const filtrados = comEstoque.filter((p) => {
        switch (q.estoque) {
          case 'zerado':
            return p.estoqueTotal === 0;
          case 'positivo':
            return p.estoqueTotal > 0;
          case 'negativo':
            return p.estoqueTotal < 0;
          case 'abaixoMinimo':
            return p.estoqueTotal <= p.estoqueMinimo;
        }
        return true;
      });
      const { skip, take } = paginar(q);
      return respostaPaginada(filtrados.slice(skip, skip + take), filtrados.length, q);
    }

    const [total, data] = await Promise.all([
      prisma.produto.count({ where }),
      prisma.produto.findMany({ where, ...paginar(q), orderBy: { nome: 'asc' }, include: { categoria: { select: { id: true, nome: true } } } }),
    ]);
    const mapa = await mapaEstoque(prisma, data.map((p) => p.id));
    return respostaPaginada(
      data.map((p) => ({ ...p, estoqueTotal: mapa.get(p.id)?.estoqueTotal ?? 0, estoqueReservado: mapa.get(p.id)?.estoqueReservado ?? 0 })),
      total,
      q,
    );
  });

  app.get('/api/v1/produtos/:id', async (req) => {
    const id = idDe(req);
    const p = await prisma.produto.findUnique({ where: { id }, include: { categoria: { select: { id: true, nome: true } } } });
    if (!p) throw new NotFound('Produto');
    const { saldos, estoqueTotal, estoqueReservado } = await saldosDoProduto(prisma, id);
    return {
      ...p,
      estoqueTotal,
      estoqueReservado,
      saldos: saldos.map((s) => ({ depositoId: s.depositoId, deposito: s.deposito.nome, desconsiderarSaldo: s.deposito.desconsiderarSaldo, saldo: s.saldo, reservado: s.reservado })),
    };
  });

  app.get('/api/v1/produtos/:id/movimentos', async (req) => {
    const id = idDe(req);
    const q = paginacaoSchema.parse(req.query);
    const where = { produtoId: id };
    const [total, data] = await Promise.all([
      prisma.movimentoEstoque.count({ where }),
      prisma.movimentoEstoque.findMany({
        where,
        ...paginar(q),
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        include: { deposito: { select: { id: true, nome: true } }, usuario: { select: { id: true, nome: true } } },
      }),
    ]);
    return respostaPaginada(await anexarOrigem(data), total, q);
  });

  app.post('/api/v1/produtos', edicao, async (req, reply) => {
    const body = produtoSchema.parse(req.body);
    const { estoqueInicial, depositoId, ...dados } = body;
    if (dados.codigo) {
      const dup = await prisma.produto.findUnique({ where: { codigo: dados.codigo } });
      if (dup) throw new AppError(`Já existe um produto com o código ${dados.codigo}: ${dup.nome}.`, 409, 'CODIGO_DUPLICADO');
    }
    if (dados.tipo === 'S') dados.controlaEstoque = false;
    const p = await prisma.$transaction(async (tx) => {
      const novo = await tx.produto.create({ data: { ...dados, codigo: dados.codigo || null } });
      if (estoqueInicial && movimentaEstoque(novo)) {
        const dep = depositoId || (await depositoPadraoId(tx));
        await movimentarEstoque(tx, {
          produtoId: novo.id,
          depositoId: dep,
          tipo: 'AJUSTE',
          quantidade: 0,
          saldoNovo: estoqueInicial,
          custoUnitario: novo.precoCusto,
          origemTipo: 'AJUSTE',
          observacao: 'Saldo inicial no cadastro',
          usuarioId: req.user.id,
        });
      }
      return novo;
    });
    await auditar(req, 'Produto', p.id, 'CRIAR', { nome: p.nome, codigo: p.codigo });
    return reply.code(201).send(p);
  });

  app.put('/api/v1/produtos/:id', edicao, async (req) => {
    const id = idDe(req);
    const atual = await prisma.produto.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Produto');
    const body = produtoSchema.partial().parse(req.body);
    const { estoqueInicial: _e, depositoId: _d, ...dados } = body;
    if (dados.codigo && dados.codigo !== atual.codigo) {
      const dup = await prisma.produto.findUnique({ where: { codigo: dados.codigo } });
      if (dup && dup.id !== id) throw new AppError(`Já existe um produto com o código ${dados.codigo}: ${dup.nome}.`, 409, 'CODIGO_DUPLICADO');
    }
    if (dados.codigo === '') (dados as any).codigo = null;
    if ((dados.tipo ?? atual.tipo) === 'S') dados.controlaEstoque = false;
    const p = await prisma.produto.update({ where: { id }, data: dados });
    await auditar(req, 'Produto', id, 'ALTERAR', dados);
    return p;
  });

  app.delete('/api/v1/produtos/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    const p = await prisma.produto.findUnique({ where: { id } });
    if (!p) throw new NotFound('Produto');
    const emUso =
      (await prisma.vendaItem.count({ where: { produtoId: id } })) +
      (await prisma.compraItem.count({ where: { produtoId: id } })) +
      (await prisma.ordemServicoItem.count({ where: { produtoId: id } })) +
      (await prisma.notaFiscalItem.count({ where: { produtoId: id } })) +
      (await prisma.movimentoEstoque.count({ where: { produtoId: id } }));
    if (emUso > 0) {
      await prisma.produto.update({ where: { id }, data: { ativo: false } });
      await auditar(req, 'Produto', id, 'EXCLUIR', { desativado: true });
      return { ok: true, desativado: true, mensagem: 'Produto possui movimentações: foi desativado em vez de excluído.' };
    }
    await prisma.produto.delete({ where: { id } });
    await auditar(req, 'Produto', id, 'EXCLUIR');
    return { ok: true, desativado: false };
  });

  // ------------------------------------------------------------ ESTOQUE
  app.get('/api/v1/estoque/saldos', async (req) => {
    const q = z
      .object({
        depositoId: z.coerce.number().int().optional(),
        pesquisa: z.string().trim().optional(),
        abaixoMinimo: boolQuery,
        somenteComSaldo: boolQuery,
      })
      .parse(req.query);

    const whereProduto: any = { tipo: 'P', controlaEstoque: true, ativo: true };
    if (q.pesquisa) {
      const p = q.pesquisa;
      const variantes = [...new Set([p, p.toLowerCase(), p.toUpperCase()])];
      whereProduto.OR = variantes.flatMap((v) => [{ nome: { contains: v } }, { codigo: { contains: v } }, { gtin: { contains: v } }]);
    }
    const saldos = await prisma.estoqueSaldo.findMany({
      where: { depositoId: q.depositoId, produto: whereProduto },
      include: {
        produto: { select: { id: true, nome: true, codigo: true, estoqueMinimo: true, precoCusto: true, preco: true, unidade: true } },
        deposito: { select: { id: true, nome: true, desconsiderarSaldo: true } },
      },
      orderBy: [{ produto: { nome: 'asc' } }, { depositoId: 'asc' }],
    });
    let lista = saldos.map((s) => ({
      produtoId: s.produtoId,
      nome: s.produto.nome,
      codigo: s.produto.codigo,
      unidade: s.produto.unidade,
      depositoId: s.depositoId,
      deposito: s.deposito.nome,
      desconsiderarSaldo: s.deposito.desconsiderarSaldo,
      saldo: s.saldo,
      reservado: s.reservado,
      disponivel: arredondar(s.saldo - s.reservado, 4),
      estoqueMinimo: s.produto.estoqueMinimo,
      precoCusto: s.produto.precoCusto,
      preco: s.produto.preco,
      valorEstoque: arredondar(s.saldo * s.produto.precoCusto),
    }));
    if (q.abaixoMinimo) {
      // compara o total do produto (depósitos que contam) com o mínimo
      const mapa = await mapaEstoque(prisma, [...new Set(lista.map((l) => l.produtoId))]);
      lista = lista.filter((l) => (mapa.get(l.produtoId)?.estoqueTotal ?? 0) <= l.estoqueMinimo);
    }
    if (q.somenteComSaldo) lista = lista.filter((l) => l.saldo !== 0);
    return lista;
  });

  app.post('/api/v1/estoque/ajuste', edicao, async (req, reply) => {
    const body = z
      .object({
        produtoId: z.coerce.number().int().positive(),
        depositoId: z.coerce.number().int().positive().optional(),
        quantidade: z.coerce.number(),
        tipo: z.enum(['ENTRADA', 'SAIDA', 'BALANCO']).default('BALANCO'),
        custoUnitario: z.coerce.number().min(0).optional(),
        observacao: z.string().trim().nullable().optional(),
      })
      .parse(req.body);
    const produto = await prisma.produto.findUnique({ where: { id: body.produtoId } });
    if (!produto) throw new NotFound('Produto');
    if (!movimentaEstoque(produto)) throw new AppError('Este produto não controla estoque (serviço ou controle desligado).', 422, 'SEM_CONTROLE_ESTOQUE');
    if (body.tipo !== 'BALANCO' && body.quantidade <= 0) throw new AppError('Quantidade deve ser maior que zero.', 422, 'QUANTIDADE');

    const mov = await prisma.$transaction(async (tx) => {
      const depositoId = body.depositoId || (await depositoPadraoId(tx));
      const m = await movimentarEstoque(tx, {
        produtoId: body.produtoId,
        depositoId,
        tipo: body.tipo === 'BALANCO' ? 'AJUSTE' : body.tipo,
        quantidade: body.tipo === 'BALANCO' ? 0 : body.quantidade,
        saldoNovo: body.tipo === 'BALANCO' ? body.quantidade : undefined,
        custoUnitario: body.custoUnitario ?? produto.precoCusto,
        origemTipo: 'AJUSTE',
        observacao: body.observacao || (body.tipo === 'BALANCO' ? 'Balanço de estoque' : 'Ajuste manual'),
        usuarioId: req.user.id,
      });
      // entrada com custo informado atualiza o custo do produto
      if (body.tipo === 'ENTRADA' && body.custoUnitario !== undefined && body.custoUnitario > 0) {
        await tx.produto.update({ where: { id: produto.id }, data: { precoCusto: body.custoUnitario } });
      }
      return m;
    });
    await auditar(req, 'Produto', body.produtoId, 'ACAO', { acao: 'ajusteEstoque', ...body, movimentoId: mov.id });
    return reply.code(201).send(mov);
  });

  app.post('/api/v1/estoque/transferencia', edicao, async (req, reply) => {
    const body = z
      .object({
        produtoId: z.coerce.number().int().positive(),
        origemId: z.coerce.number().int().positive(),
        destinoId: z.coerce.number().int().positive(),
        quantidade: z.coerce.number().positive('Quantidade deve ser maior que zero'),
        observacao: z.string().trim().nullable().optional(),
      })
      .parse(req.body);
    if (body.origemId === body.destinoId) throw new AppError('Depósito de origem e destino devem ser diferentes.', 422, 'DEPOSITO');
    const produto = await prisma.produto.findUnique({ where: { id: body.produtoId } });
    if (!produto) throw new NotFound('Produto');
    if (!movimentaEstoque(produto)) throw new AppError('Este produto não controla estoque.', 422, 'SEM_CONTROLE_ESTOQUE');
    const [origem, destino] = await Promise.all([prisma.deposito.findUnique({ where: { id: body.origemId } }), prisma.deposito.findUnique({ where: { id: body.destinoId } })]);
    if (!origem || !destino) throw new NotFound('Depósito');

    const r = await prisma.$transaction(async (tx) => {
      const obs = body.observacao || `Transferência ${origem.nome} → ${destino.nome}`;
      const saida = await movimentarEstoque(tx, {
        produtoId: body.produtoId,
        depositoId: body.origemId,
        tipo: 'TRANSFERENCIA',
        quantidade: body.quantidade,
        custoUnitario: produto.precoCusto,
        origemTipo: 'TRANSFERENCIA',
        observacao: obs,
        usuarioId: req.user.id,
      });
      const entrada = await entradaTransferencia(tx, {
        produtoId: body.produtoId,
        depositoId: body.destinoId,
        quantidade: body.quantidade,
        custoUnitario: produto.precoCusto,
        origemTipo: 'TRANSFERENCIA',
        origemId: saida.id,
        observacao: obs,
        usuarioId: req.user.id,
      });
      return { saida, entrada };
    });
    await auditar(req, 'Produto', body.produtoId, 'ACAO', { acao: 'transferenciaEstoque', ...body });
    return reply.code(201).send(r);
  });

  app.get('/api/v1/estoque/movimentos', async (req) => {
    const q = paginacaoSchema
      .extend({
        produtoId: z.coerce.number().int().optional(),
        depositoId: z.coerce.number().int().optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        origemTipo: z.string().trim().optional(),
        tipo: z.string().trim().optional(),
      })
      .parse(req.query);
    const where: any = { produtoId: q.produtoId, depositoId: q.depositoId, origemTipo: q.origemTipo || undefined, tipo: q.tipo || undefined };
    where.data = intervalo(q.dataInicial, q.dataFinal);
    const [total, data] = await Promise.all([
      prisma.movimentoEstoque.count({ where }),
      prisma.movimentoEstoque.findMany({
        where,
        ...paginar(q),
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        include: {
          produto: { select: { id: true, nome: true, codigo: true, unidade: true } },
          deposito: { select: { id: true, nome: true } },
          usuario: { select: { id: true, nome: true } },
        },
      }),
    ]);
    return respostaPaginada(await anexarOrigem(data), total, q);
  });
}

/** Anexa `origem: {tipo, id, numero}` aos movimentos (nº da venda/compra/OS). */
async function anexarOrigem<T extends { origemTipo: string; origemId: number | null }>(movs: T[]) {
  const ids = (tipo: string) => [...new Set(movs.filter((m) => m.origemTipo === tipo && m.origemId).map((m) => m.origemId!))];
  const [vendas, compras, ordens] = await Promise.all([
    ids('VENDA').length ? prisma.venda.findMany({ where: { id: { in: ids('VENDA') } }, select: { id: true, numero: true } }) : [],
    ids('COMPRA').length ? prisma.compra.findMany({ where: { id: { in: ids('COMPRA') } }, select: { id: true, numero: true } }) : [],
    ids('OS').length ? prisma.ordemServico.findMany({ where: { id: { in: ids('OS') } }, select: { id: true, numero: true } }) : [],
  ]);
  const mapa = new Map<string, number>();
  vendas.forEach((v) => mapa.set(`VENDA:${v.id}`, v.numero));
  compras.forEach((c) => mapa.set(`COMPRA:${c.id}`, c.numero));
  ordens.forEach((o) => mapa.set(`OS:${o.id}`, o.numero));
  return movs.map((m) => ({
    ...m,
    origem: { tipo: m.origemTipo, id: m.origemId, numero: m.origemId ? mapa.get(`${m.origemTipo}:${m.origemId}`) ?? null : null },
  }));
}
