/**
 * PAINEL DO VENDEDOR, METAS e DESAFIOS
 *
 *   GET  /api/v1/painel-vendedor?vendedorId=   vendas por período, meta, desafios, ranking e últimas vendas
 *        (VENDEDOR vê só o próprio; ADMIN/GERENTE escolhem o vendedor)
 *   GET  /api/v1/metas?competencia=             metas de todos os vendedores no mês (gestão)
 *   PUT  /api/v1/metas                          grava meta do mês e/ou meta padrão (gestão)
 *   GET  /api/v1/desafios                       lista com o progresso de cada participante (gestão)
 *   POST /api/v1/desafios · PUT /:id · POST /:id/encerrar · POST /:id/reabrir · DELETE /:id (gestão)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { endOfDay, startOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar, competenciaDe, parseJsonArray, toDate } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import {
  TIPOS_DESAFIO,
  avaliarDesafio,
  avaliarDesafiosAbertos,
  participantes,
  periodosPainel,
  progressoDesafio,
  progressoMeta,
  resumoVendas,
  situacoesQueContam,
  statusDesafio,
} from './service.js';

const competenciaSchema = z.string().regex(/^\d{4}-\d{2}$/, 'competência no formato AAAA-MM');

const desafioBody = z
  .object({
    titulo: z.string().trim().min(3, 'Informe o título do desafio.'),
    descricao: z.string().trim().nullable().optional(),
    tipo: z.enum(TIPOS_DESAFIO),
    alvo: z.coerce.number().positive('O alvo precisa ser maior que zero.'),
    produtoId: z.coerce.number().int().positive().nullable().optional(),
    categoriaId: z.coerce.number().int().positive().nullable().optional(),
    inicio: z.string().min(8, 'Informe a data de início.'),
    fim: z.string().min(8, 'Informe a data de fim.'),
    premio: z.coerce.number().positive('Informe o valor do prêmio (R$).'),
    regra: z.enum(['TODOS', 'PRIMEIRO']).default('TODOS'),
    todosVendedores: z.boolean().default(true),
    vendedoresIds: z.array(z.coerce.number().int().positive()).default([]),
  })
  .transform((b) => {
    const inicio = toDate(b.inicio);
    const fim = toDate(b.fim);
    if (!inicio || !fim) throw new AppError('Datas do desafio inválidas.', 422, 'DATA_INVALIDA');
    return { ...b, inicio: startOfDay(inicio), fim: endOfDay(fim) };
  });

type DesafioEntrada = z.infer<typeof desafioBody>;

function validarDesafio(b: DesafioEntrada) {
  if (b.fim < b.inicio) throw new AppError('A data de fim é anterior à de início.', 422, 'PERIODO_INVALIDO');
  if (!b.todosVendedores && !b.vendedoresIds.length) throw new AppError('Escolha ao menos um vendedor ou marque "todos os vendedores".', 422, 'SEM_PARTICIPANTES');
  if (b.tipo === 'QTD_VENDAS' && !Number.isInteger(b.alvo)) throw new AppError('O alvo de quantidade de vendas precisa ser um número inteiro.', 422, 'ALVO_INVALIDO');
}

function dadosDesafio(b: DesafioEntrada) {
  return {
    titulo: b.titulo,
    descricao: b.descricao || null,
    tipo: b.tipo,
    alvo: b.alvo,
    produtoId: b.produtoId ?? null,
    categoriaId: b.produtoId ? null : (b.categoriaId ?? null),
    inicio: b.inicio,
    fim: b.fim,
    premio: arredondar(b.premio),
    regra: b.regra,
    todosVendedores: b.todosVendedores,
    vendedoresIds: JSON.stringify(b.todosVendedores ? [] : b.vendedoresIds),
  };
}

const includeDesafio = {
  produto: { select: { id: true, nome: true, codigo: true } },
  categoria: { select: { id: true, nome: true } },
  conquistas: { include: { vendedor: { select: { id: true, nome: true } }, comissao: { select: { id: true, status: true, valor: true } } }, orderBy: { conquistadoEm: 'asc' as const } },
} as const;

export default async function metasRoutes(app: FastifyInstance) {
  const gestao = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') };

  // =====================================================================
  // PAINEL DO VENDEDOR
  // =====================================================================
  app.get('/api/v1/painel-vendedor', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'VENDEDOR') }, async (req) => {
    const q = z.object({ vendedorId: z.coerce.number().int().positive().optional() }).parse(req.query);
    let vendedorId = q.vendedorId;
    if (req.user.perfil === 'VENDEDOR') {
      // relê do banco: o vínculo usuário→vendedor pode ter mudado depois do login
      const u = await prisma.usuario.findUnique({ where: { id: req.user.id }, select: { vendedorId: true } });
      vendedorId = u?.vendedorId ?? undefined;
      if (!vendedorId) throw new AppError('Seu usuário ainda não está vinculado a um cadastro de vendedor. Peça ao administrador para vincular em Configurações → Usuários.', 422, 'SEM_VENDEDOR');
    }
    if (!vendedorId) {
      const primeiro = await prisma.vendedor.findFirst({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true } });
      if (!primeiro) throw new AppError('Nenhum vendedor cadastrado. Cadastre em Configurações → Vendedores.', 422, 'SEM_VENDEDOR');
      vendedorId = primeiro.id;
    }
    const vendedor = await prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { id: true, nome: true, ativo: true, metaMensal: true } });
    if (!vendedor) throw new NotFound('Vendedor');

    const agora = new Date();
    const periodos = await Promise.all(periodosPainel(agora).map(async (p) => ({ chave: p.chave, rotulo: p.rotulo, inicio: p.ini, fim: p.fim, ...(await resumoVendas(vendedor.id, p.ini, p.fim)) })));
    const mes = periodos.find((p) => p.chave === 'mes')!;
    const competencia = competenciaDe(agora);

    // ---- meta
    const meta = await progressoMeta(vendedor.id, mes.faturamento, agora);

    // ---- bônus de desafios no mês
    const bonus = await prisma.comissao.aggregate({ where: { vendedorId: vendedor.id, origemTipo: 'DESAFIO', competencia, status: { not: 'CANCELADA' } }, _sum: { valor: true } });

    // ---- ranking do mês (todos os vendedores ativos)
    const sitOk = await situacoesQueContam();
    const ativos = await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
    const grupos = await prisma.venda.groupBy({ by: ['vendedorId'], where: { tipo: 'PEDIDO', situacaoId: { in: sitOk }, data: { gte: mes.inicio!, lte: mes.fim! }, vendedorId: { not: null } }, _sum: { total: true } });
    const totalDe = (id: number) => arredondar(grupos.find((g) => g.vendedorId === id)?._sum.total || 0);
    const ordenados = [...ativos, ...(vendedor.ativo ? [] : [{ id: vendedor.id, nome: vendedor.nome }])]
      .map((v) => ({ vendedorId: v.id, nome: v.nome, faturamento: totalDe(v.id) }))
      .sort((a, b) => b.faturamento - a.faturamento || a.nome.localeCompare(b.nome));
    const gestor = req.user.perfil !== 'VENDEDOR';
    const posicao = ordenados.findIndex((v) => v.vendedorId === vendedor.id) + 1;
    const acima = posicao > 1 ? ordenados[posicao - 2] : null;
    const ranking = {
      competencia,
      posicao,
      total: ordenados.length,
      // vendedor vê nomes e posição de todos, mas o valor só o dele (e quanto falta para passar o da frente)
      lista: ordenados.map((v, i) => ({ posicao: i + 1, vendedorId: v.vendedorId, nome: v.nome, eu: v.vendedorId === vendedor.id, faturamento: gestor || v.vendedorId === vendedor.id ? v.faturamento : null })),
      paraPassar: acima ? { nome: acima.nome, falta: arredondar(acima.faturamento - mes.faturamento + 0.01) } : null,
    };

    // ---- desafios (vigentes, futuros e os que terminaram nos últimos 7 dias)
    const desafiosDb = await prisma.desafio.findMany({
      where: { OR: [{ fim: { gte: new Date(agora.getTime() - 7 * 86400000) } }, { conquistas: { some: { vendedorId: vendedor.id, conquistadoEm: { gte: mes.inicio! } } } }] },
      include: includeDesafio,
      orderBy: [{ fim: 'asc' }],
    });
    const idsAtivos = ativos.map((a) => a.id);
    const desafios = [];
    for (const d of desafiosDb) {
      const part = participantes(d, idsAtivos);
      const minhaConquista = d.conquistas.find((c) => c.vendedorId === vendedor.id);
      if (!part.includes(vendedor.id) && !minhaConquista) continue;
      // conquistas já gravadas não dependem do recálculo; o progresso é ao vivo
      const prog = (await progressoDesafio(d, [vendedor.id])).get(vendedor.id) || 0;
      const outro = d.regra === 'PRIMEIRO' ? d.conquistas.find((c) => c.vendedorId !== vendedor.id) : undefined;
      const status = statusDesafio(d, prog, !!minhaConquista, !!outro, agora);
      if (status === 'ENCERRADO' && !d.ativo && agora < d.fim && !minhaConquista) continue; // cancelado pela gestão
      desafios.push({
        id: d.id,
        titulo: d.titulo,
        descricao: d.descricao,
        tipo: d.tipo,
        alvo: d.alvo,
        premio: d.premio,
        regra: d.regra,
        inicio: d.inicio,
        fim: d.fim,
        produto: d.produto,
        categoria: d.categoria,
        atingido: prog,
        pct: Math.min(100, arredondar((prog / d.alvo) * 100, 1)),
        falta: Math.max(0, arredondar(d.alvo - prog, 2)),
        status,
        conquistadoEm: minhaConquista?.conquistadoEm ?? null,
        premioStatus: minhaConquista?.comissao?.status ?? null,
        ganhador: outro ? outro.vendedor.nome : null,
        diasRestantes: Math.max(0, Math.ceil((d.fim.getTime() - agora.getTime()) / 86400000)),
      });
    }
    const ordemStatus: Record<string, number> = { EM_ANDAMENTO: 0, AGENDADO: 1, CONQUISTADO: 2, GANHO_POR_OUTRO: 3, ENCERRADO: 4 };
    desafios.sort((a, b) => (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9) || +a.fim - +b.fim);

    // ---- últimas vendas
    const ultimasVendas = await prisma.venda.findMany({
      where: { tipo: 'PEDIDO', vendedorId: vendedor.id },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true, numero: true, data: true, total: true, contato: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true, cor: true } } },
    });

    return {
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      periodos,
      meta: { ...meta, bonusDesafios: arredondar(bonus._sum.valor || 0) },
      ranking,
      desafios,
      ultimasVendas,
    };
  });

  // =====================================================================
  // METAS
  // =====================================================================
  app.get('/api/v1/metas', gestao, async (req) => {
    const q = z.object({ competencia: competenciaSchema.optional() }).parse(req.query);
    const competencia = q.competencia || competenciaDe(new Date());
    const [ano, mes] = competencia.split('-').map(Number);
    const ini = new Date(ano, mes - 1, 1);
    const fim = endOfDay(new Date(ano, mes, 0));
    const vendedores = await prisma.vendedor.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, metaMensal: true, metas: { where: { competencia } } } });
    const sitOk = await situacoesQueContam();
    const grupos = await prisma.venda.groupBy({ by: ['vendedorId'], where: { tipo: 'PEDIDO', situacaoId: { in: sitOk }, data: { gte: ini, lte: fim } }, _sum: { total: true }, _count: { _all: true } });
    return {
      competencia,
      vendedores: vendedores.map((v) => {
        const g = grupos.find((x) => x.vendedorId === v.id);
        const metaMes = v.metas[0]?.valor ?? null;
        const meta = metaMes ?? v.metaMensal;
        const vendido = arredondar(g?._sum.total || 0);
        return { vendedorId: v.id, nome: v.nome, metaPadrao: v.metaMensal, metaMes, meta, vendido, qtdVendas: g?._count._all || 0, pct: meta ? arredondar((vendido / meta) * 100, 1) : 0 };
      }),
    };
  });

  app.put('/api/v1/metas', gestao, async (req) => {
    const body = z
      .object({
        competencia: competenciaSchema,
        itens: z.array(z.object({ vendedorId: z.coerce.number().int().positive(), metaPadrao: z.coerce.number().min(0), metaMes: z.coerce.number().min(0).nullable() })).min(1),
      })
      .parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const i of body.itens) {
        await tx.vendedor.update({ where: { id: i.vendedorId }, data: { metaMensal: arredondar(i.metaPadrao) } });
        if (i.metaMes === null) await tx.metaVendedor.deleteMany({ where: { vendedorId: i.vendedorId, competencia: body.competencia } });
        else
          await tx.metaVendedor.upsert({
            where: { vendedorId_competencia: { vendedorId: i.vendedorId, competencia: body.competencia } },
            create: { vendedorId: i.vendedorId, competencia: body.competencia, valor: arredondar(i.metaMes) },
            update: { valor: arredondar(i.metaMes) },
          });
      }
    });
    await auditar(req, 'MetaVendedor', null, 'ALTERAR', body);
    return { ok: true };
  });

  // =====================================================================
  // DESAFIOS
  // =====================================================================
  async function desafioComProgresso(id: number) {
    const d = await prisma.desafio.findUnique({ where: { id }, include: includeDesafio });
    if (!d) throw new NotFound('Desafio');
    const ativos = await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
    const ids = participantes(d, ativos.map((a) => a.id));
    const nomes = new Map(ativos.map((a) => [a.id, a.nome]));
    if (!d.todosVendedores) {
      const faltando = ids.filter((i) => !nomes.has(i));
      if (faltando.length) for (const v of await prisma.vendedor.findMany({ where: { id: { in: faltando } }, select: { id: true, nome: true } })) nomes.set(v.id, v.nome);
    }
    const prog = await progressoDesafio(d, ids);
    const agora = new Date();
    return {
      ...d,
      vendedoresIds: parseJsonArray(d.vendedoresIds).map(Number),
      situacao: !d.ativo ? 'ENCERRADO' : agora < d.inicio ? 'AGENDADO' : agora > d.fim ? 'FINALIZADO' : 'EM_ANDAMENTO',
      participantes: ids
        .map((vid) => {
          const atingido = prog.get(vid) || 0;
          const c = d.conquistas.find((x) => x.vendedorId === vid);
          return { vendedorId: vid, nome: nomes.get(vid) || `Vendedor ${vid}`, atingido, pct: Math.min(100, arredondar((atingido / d.alvo) * 100, 1)), conquistou: !!c, conquistadoEm: c?.conquistadoEm ?? null, premioStatus: c?.comissao?.status ?? null };
        })
        .sort((a, b) => b.atingido - a.atingido),
      totalPremios: arredondar(d.conquistas.reduce((s, c) => s + (c.comissao && c.comissao.status !== 'CANCELADA' ? c.comissao.valor : 0), 0)),
    };
  }

  app.get('/api/v1/desafios', gestao, async (req) => {
    const q = z.object({ situacao: z.enum(['vigentes', 'todos']).default('vigentes') }).parse(req.query);
    const where = q.situacao === 'vigentes' ? { fim: { gte: new Date(Date.now() - 30 * 86400000) } } : {};
    const lista = await prisma.desafio.findMany({ where, orderBy: [{ ativo: 'desc' }, { fim: 'desc' }], select: { id: true } });
    return Promise.all(lista.map((d) => desafioComProgresso(d.id)));
  });

  app.get('/api/v1/desafios/:id', gestao, async (req) => desafioComProgresso(Number((req.params as any).id)));

  app.post('/api/v1/desafios', gestao, async (req, reply) => {
    const b = desafioBody.parse(req.body);
    validarDesafio(b);
    const d = await prisma.desafio.create({ data: { ...dadosDesafio(b), criadoPorId: req.user.id } });
    await avaliarDesafio(d.id);
    await auditar(req, 'Desafio', d.id, 'CRIAR', { titulo: d.titulo, premio: d.premio });
    return reply.code(201).send(await desafioComProgresso(d.id));
  });

  app.put('/api/v1/desafios/:id', gestao, async (req) => {
    const id = Number((req.params as any).id);
    const b = desafioBody.parse(req.body);
    validarDesafio(b);
    const atual = await prisma.desafio.findUnique({ where: { id }, include: { _count: { select: { conquistas: true } } } });
    if (!atual) throw new NotFound('Desafio');
    await prisma.desafio.update({ where: { id }, data: dadosDesafio(b) });
    // prêmio alterado: ajusta as comissões ainda não pagas
    if (atual.premio !== arredondar(b.premio)) {
      await prisma.comissao.updateMany({ where: { desafioId: id, status: { in: ['PENDENTE', 'APROVADA'] } }, data: { valor: arredondar(b.premio) } });
    }
    await avaliarDesafio(id);
    await auditar(req, 'Desafio', id, 'ALTERAR', b);
    return desafioComProgresso(id);
  });

  app.post('/api/v1/desafios/:id/encerrar', gestao, async (req) => {
    const id = Number((req.params as any).id);
    const d = await prisma.desafio.findUnique({ where: { id } });
    if (!d) throw new NotFound('Desafio');
    await prisma.desafio.update({ where: { id }, data: { ativo: false } });
    await auditar(req, 'Desafio', id, 'ACAO', { acao: 'encerrar' });
    return desafioComProgresso(id);
  });

  app.post('/api/v1/desafios/:id/reabrir', gestao, async (req) => {
    const id = Number((req.params as any).id);
    const d = await prisma.desafio.findUnique({ where: { id } });
    if (!d) throw new NotFound('Desafio');
    await prisma.desafio.update({ where: { id }, data: { ativo: true } });
    await avaliarDesafio(id);
    await auditar(req, 'Desafio', id, 'ACAO', { acao: 'reabrir' });
    return desafioComProgresso(id);
  });

  app.delete('/api/v1/desafios/:id', gestao, async (req) => {
    const id = Number((req.params as any).id);
    const d = await prisma.desafio.findUnique({ where: { id }, include: { comissoes: { where: { status: { not: 'CANCELADA' } }, select: { id: true } } } });
    if (!d) throw new NotFound('Desafio');
    if (d.comissoes.length) throw new AppError('Este desafio já pagou prêmio a vendedor(es). Use "Encerrar" em vez de excluir.', 422, 'DESAFIO_COM_PREMIO');
    await prisma.$transaction([prisma.comissao.updateMany({ where: { desafioId: id }, data: { desafioId: null } }), prisma.desafio.delete({ where: { id } })]);
    await auditar(req, 'Desafio', id, 'EXCLUIR', { titulo: d.titulo });
    return { ok: true };
  });
}

// ---- reavalia os desafios quando uma venda muda de situação (fechou, cancelou, voltou)
eventos.ouvir('situacao.alterada', async (d) => {
  if (d.modulo !== 'VENDA') return;
  const v = await prisma.venda.findUnique({ where: { id: d.entidadeId }, select: { data: true, tipo: true } });
  if (!v || v.tipo !== 'PEDIDO') return;
  await avaliarDesafiosAbertos(v.data);
});

// ---- e a cada 10 min (pega transferências de vendedor, edições de data/valor, vendas do PDV)
registrarServico('desafios-de-vendas', (app) => {
  const rodar = async () => {
    try {
      await avaliarDesafiosAbertos();
    } catch (e) {
      app.log.warn({ e: String((e as Error)?.message || e) }, '[desafios] falha ao avaliar');
    }
  };
  setTimeout(rodar, 30_000).unref();
  setInterval(rodar, 10 * 60_000).unref();
});
