/**
 * PAINEL DO VENDEDOR, METAS e DESAFIOS
 *
 *   GET  /api/v1/painel-vendedor?vendedorId=   vendas por período, meta, desafios, ranking e últimas vendas
 *        (VENDEDOR vê só o próprio; ADMIN/GERENTE escolhem o vendedor)
 *   GET  /api/v1/metas?competencia=             metas de todos os vendedores no mês (gestão)
 *   PUT  /api/v1/metas                          grava meta do mês e/ou meta padrão (gestão)
 *   GET  /api/v1/metas-tecnicos?competencia=    metas dos técnicos no mês — em R$ de serviços ou nº de OS (gestão)
 *   PUT  /api/v1/metas-tecnicos                 grava meta do mês e/ou meta padrão dos técnicos (gestão)
 *   GET  /api/v1/desafios                       lista com o progresso de cada participante (gestão)
 *   POST /api/v1/desafios · PUT /:id · POST /:id/encerrar · POST /:id/reabrir · DELETE /:id (gestão)
 *        `publico` VENDEDORES (vendas) ou TECNICOS (OS concluídas)
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
import { vendedorDoUsuario } from '../comum/vendedores.js';
import {
  PUBLICOS_DESAFIO,
  TIPOS_DESAFIO,
  TIPOS_DESAFIO_TECNICO,
  TIPOS_DESAFIO_VENDEDOR,
  TIPOS_META_TECNICO,
  avaliarDesafio,
  avaliarDesafiosAbertos,
  includeDesafio,
  painelDoVendedor,
  participanteDaConquista,
  participantes,
  progressoDesafio,
  publicoDe,
  situacoesOsConcluidas,
  situacoesQueContam,
} from './service.js';

const competenciaSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM');

const desafioBody = z
  .object({
    titulo: z.string().trim().min(3, 'Informe o título do desafio.'),
    descricao: z.string().trim().nullable().optional(),
    publico: z.enum(PUBLICOS_DESAFIO).default('VENDEDORES'),
    tipo: z.enum(TIPOS_DESAFIO),
    alvo: z.coerce.number().positive('O alvo precisa ser maior que zero.'),
    produtoId: z.coerce.number().int().positive().nullable().optional(),
    categoriaId: z.coerce.number().int().positive().nullable().optional(),
    inicio: z.string().min(8, 'Informe a data de início.'),
    fim: z.string().min(8, 'Informe a data de fim.'),
    premio: z.coerce.number().positive('Informe o valor do prêmio (R$).'),
    regra: z.enum(['TODOS', 'PRIMEIRO']).default('TODOS'),
    /** todos os participantes do público (vendedores ou técnicos) */
    todosVendedores: z.boolean().default(true),
    vendedoresIds: z.array(z.coerce.number().int().positive()).default([]),
    tecnicosIds: z.array(z.coerce.number().int().positive()).default([]),
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
  if (b.publico === 'TECNICOS') {
    if (!(TIPOS_DESAFIO_TECNICO as readonly string[]).includes(b.tipo)) throw new AppError('Desafio de técnicos conta OS concluídas: escolha "R$ de serviços" ou "nº de OS".', 422, 'TIPO_INVALIDO');
    if (!b.todosVendedores && !b.tecnicosIds.length) throw new AppError('Escolha ao menos um técnico ou marque "todos os técnicos".', 422, 'SEM_PARTICIPANTES');
    if (b.tipo === 'QTD_OS' && !Number.isInteger(b.alvo)) throw new AppError('O alvo de quantidade de OS precisa ser um número inteiro.', 422, 'ALVO_INVALIDO');
  } else {
    if (!(TIPOS_DESAFIO_VENDEDOR as readonly string[]).includes(b.tipo)) throw new AppError('Desafio de vendedores conta vendas: escolha R$ vendido, nº de vendas ou unidades.', 422, 'TIPO_INVALIDO');
    if (!b.todosVendedores && !b.vendedoresIds.length) throw new AppError('Escolha ao menos um vendedor ou marque "todos os vendedores".', 422, 'SEM_PARTICIPANTES');
    if (b.tipo === 'QTD_VENDAS' && !Number.isInteger(b.alvo)) throw new AppError('O alvo de quantidade de vendas precisa ser um número inteiro.', 422, 'ALVO_INVALIDO');
  }
}

function dadosDesafio(b: DesafioEntrada) {
  const tecnicos = b.publico === 'TECNICOS';
  return {
    titulo: b.titulo,
    descricao: b.descricao || null,
    publico: b.publico,
    tipo: b.tipo,
    alvo: b.alvo,
    produtoId: tecnicos ? null : (b.produtoId ?? null),
    categoriaId: tecnicos || b.produtoId ? null : (b.categoriaId ?? null),
    inicio: b.inicio,
    fim: b.fim,
    premio: arredondar(b.premio),
    regra: b.regra,
    todosVendedores: b.todosVendedores,
    vendedoresIds: JSON.stringify(b.todosVendedores || tecnicos ? [] : b.vendedoresIds),
    tecnicosIds: JSON.stringify(b.todosVendedores || !tecnicos ? [] : b.tecnicosIds),
  };
}

export default async function metasRoutes(app: FastifyInstance) {
  const gestao = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') };

  // =====================================================================
  // PAINEL DO VENDEDOR
  // =====================================================================
  app.get('/api/v1/painel-vendedor', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO') }, async (req) => {
    const q = z.object({ vendedorId: z.coerce.number().int().positive().optional() }).parse(req.query);
    let vendedorId = q.vendedorId;
    const proprio = req.user.perfil === 'VENDEDOR' || req.user.perfil === 'TECNICO';
    if (proprio) {
      // relê do banco: o vínculo usuário→vendedor pode ter mudado depois do login
      vendedorId = (await vendedorDoUsuario(req.user.id)) ?? undefined;
      if (!vendedorId) throw new AppError('Seu usuário ainda não está vinculado a um cadastro de vendedor. Peça ao administrador para vincular em Configurações → Usuários.', 422, 'SEM_VENDEDOR');
    }
    if (!vendedorId) {
      const primeiro = await prisma.vendedor.findFirst({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true } });
      if (!primeiro) throw new AppError('Nenhum vendedor cadastrado. Cadastre em Configurações → Vendedores.', 422, 'SEM_VENDEDOR');
      vendedorId = primeiro.id;
    }
    const painel = await painelDoVendedor(vendedorId, !proprio);
    if (!painel) throw new NotFound('Vendedor');
    return painel;
  });

  // =====================================================================
  // METAS DOS VENDEDORES
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
  // METAS DOS TÉCNICOS (R$ de serviços concluídos ou nº de OS concluídas no mês)
  // =====================================================================
  app.get('/api/v1/metas-tecnicos', gestao, async (req) => {
    const q = z.object({ competencia: competenciaSchema.optional() }).parse(req.query);
    const competencia = q.competencia || competenciaDe(new Date());
    const [ano, mes] = competencia.split('-').map(Number);
    const ini = new Date(ano, mes - 1, 1);
    const fim = endOfDay(new Date(ano, mes, 0));
    const tecnicos = await prisma.tecnico.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, metaMensal: true, metaTipo: true, metas: { where: { competencia } } } });
    const sitOk = await situacoesOsConcluidas();
    const grupos = await prisma.ordemServico.groupBy({ by: ['tecnicoId'], where: { situacaoId: { in: sitOk }, dataConclusao: { gte: ini, lte: fim } }, _sum: { total: true }, _count: { _all: true } });
    return {
      competencia,
      tecnicos: tecnicos.map((t) => {
        const g = grupos.find((x) => x.tecnicoId === t.id);
        const especifica = t.metas[0] ?? null;
        const tipo = (especifica?.tipo ?? t.metaTipo) as (typeof TIPOS_META_TECNICO)[number];
        const metaMes = especifica?.valor ?? null;
        const meta = metaMes ?? t.metaMensal;
        const valorServicos = arredondar(g?._sum.total || 0);
        const osConcluidas = g?._count._all || 0;
        const atingido = tipo === 'QTD_OS' ? osConcluidas : valorServicos;
        return {
          tecnicoId: t.id,
          nome: t.nome,
          tipoPadrao: t.metaTipo,
          metaPadrao: t.metaMensal,
          tipoMes: especifica?.tipo ?? null,
          metaMes,
          tipo,
          meta,
          valorServicos,
          osConcluidas,
          atingido,
          pct: meta ? arredondar((atingido / meta) * 100, 1) : 0,
        };
      }),
    };
  });

  app.put('/api/v1/metas-tecnicos', gestao, async (req) => {
    const body = z
      .object({
        competencia: competenciaSchema,
        itens: z
          .array(
            z.object({
              tecnicoId: z.coerce.number().int().positive(),
              tipoPadrao: z.enum(TIPOS_META_TECNICO).default('VALOR_SERVICOS'),
              metaPadrao: z.coerce.number().min(0),
              tipoMes: z.enum(TIPOS_META_TECNICO).nullable().optional(),
              metaMes: z.coerce.number().min(0).nullable(),
            }),
          )
          .min(1),
      })
      .parse(req.body);
    await prisma.$transaction(async (tx) => {
      for (const i of body.itens) {
        await tx.tecnico.update({ where: { id: i.tecnicoId }, data: { metaMensal: arredondar(i.metaPadrao), metaTipo: i.tipoPadrao } });
        if (i.metaMes === null) await tx.metaTecnico.deleteMany({ where: { tecnicoId: i.tecnicoId, competencia: body.competencia } });
        else {
          const tipo = i.tipoMes ?? i.tipoPadrao;
          await tx.metaTecnico.upsert({
            where: { tecnicoId_competencia: { tecnicoId: i.tecnicoId, competencia: body.competencia } },
            create: { tecnicoId: i.tecnicoId, competencia: body.competencia, tipo, valor: arredondar(i.metaMes) },
            update: { tipo, valor: arredondar(i.metaMes) },
          });
        }
      }
    });
    await auditar(req, 'MetaTecnico', null, 'ALTERAR', body);
    return { ok: true };
  });

  // =====================================================================
  // DESAFIOS
  // =====================================================================
  async function desafioComProgresso(id: number) {
    const d = await prisma.desafio.findUnique({ where: { id }, include: includeDesafio });
    if (!d) throw new NotFound('Desafio');
    const publico = publicoDe(d);
    const ativos =
      publico === 'TECNICOS'
        ? await prisma.tecnico.findMany({ where: { ativo: true }, select: { id: true, nome: true } })
        : await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true, nome: true } });
    const ids = participantes(d, ativos.map((a) => a.id));
    const nomes = new Map(ativos.map((a) => [a.id, a.nome]));
    if (!d.todosVendedores) {
      const faltando = ids.filter((i) => !nomes.has(i));
      if (faltando.length) {
        const extras = publico === 'TECNICOS' ? await prisma.tecnico.findMany({ where: { id: { in: faltando } }, select: { id: true, nome: true } }) : await prisma.vendedor.findMany({ where: { id: { in: faltando } }, select: { id: true, nome: true } });
        for (const v of extras) nomes.set(v.id, v.nome);
      }
    }
    const prog = await progressoDesafio(d, ids);
    const agora = new Date();
    const rotuloPart = publico === 'TECNICOS' ? 'Técnico' : 'Vendedor';
    return {
      ...d,
      publico,
      vendedoresIds: parseJsonArray(d.vendedoresIds).map(Number),
      tecnicosIds: parseJsonArray(d.tecnicosIds).map(Number),
      situacao: !d.ativo ? 'ENCERRADO' : agora < d.inicio ? 'AGENDADO' : agora > d.fim ? 'FINALIZADO' : 'EM_ANDAMENTO',
      participantes: ids
        .map((pid) => {
          const atingido = prog.get(pid) || 0;
          const c = d.conquistas.find((x) => participanteDaConquista(d, x) === pid);
          return {
            participanteId: pid,
            // compatibilidade com a tela antiga (vendedorId) — para técnicos leva o id do técnico
            vendedorId: pid,
            nome: nomes.get(pid) || `${rotuloPart} ${pid}`,
            atingido,
            pct: Math.min(100, arredondar((atingido / d.alvo) * 100, 1)),
            conquistou: !!c,
            conquistadoEm: c?.conquistadoEm ?? null,
            premioStatus: c?.comissao?.status ?? null,
          };
        })
        .sort((a, b) => b.atingido - a.atingido),
      totalPremios: arredondar(d.conquistas.reduce((s, c) => s + (c.comissao && c.comissao.status !== 'CANCELADA' ? c.comissao.valor : 0), 0)),
    };
  }

  app.get('/api/v1/desafios', gestao, async (req) => {
    const q = z.object({ situacao: z.enum(['vigentes', 'todos']).default('vigentes'), publico: z.enum(PUBLICOS_DESAFIO).optional() }).parse(req.query);
    const where = { ...(q.situacao === 'vigentes' ? { fim: { gte: new Date(Date.now() - 30 * 86400000) } } : {}), ...(q.publico ? { publico: q.publico } : {}) };
    const lista = await prisma.desafio.findMany({ where, orderBy: [{ ativo: 'desc' }, { fim: 'desc' }], select: { id: true } });
    return Promise.all(lista.map((d) => desafioComProgresso(d.id)));
  });

  app.get('/api/v1/desafios/:id', gestao, async (req) => desafioComProgresso(Number((req.params as any).id)));

  app.post('/api/v1/desafios', gestao, async (req, reply) => {
    const b = desafioBody.parse(req.body);
    validarDesafio(b);
    const d = await prisma.desafio.create({ data: { ...dadosDesafio(b), criadoPorId: req.user.id } });
    await avaliarDesafio(d.id);
    await auditar(req, 'Desafio', d.id, 'CRIAR', { titulo: d.titulo, premio: d.premio, publico: d.publico });
    return reply.code(201).send(await desafioComProgresso(d.id));
  });

  app.put('/api/v1/desafios/:id', gestao, async (req) => {
    const id = Number((req.params as any).id);
    const b = desafioBody.parse(req.body);
    validarDesafio(b);
    const atual = await prisma.desafio.findUnique({ where: { id }, include: { _count: { select: { conquistas: true } } } });
    if (!atual) throw new NotFound('Desafio');
    if (atual._count.conquistas > 0 && publicoDe(atual) !== b.publico) throw new AppError('Este desafio já tem conquista: não dá para trocar o público (vendedores ↔ técnicos). Encerre e crie outro.', 422, 'PUBLICO_FIXO');
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
    if (d.comissoes.length) throw new AppError('Este desafio já pagou prêmio a vendedor(es)/técnico(s). Use "Encerrar" em vez de excluir.', 422, 'DESAFIO_COM_PREMIO');
    await prisma.$transaction([prisma.comissao.updateMany({ where: { desafioId: id }, data: { desafioId: null } }), prisma.desafio.delete({ where: { id } })]);
    await auditar(req, 'Desafio', id, 'EXCLUIR', { titulo: d.titulo });
    return { ok: true };
  });
}

// ---- reavalia os desafios quando uma venda é criada, editada, transferida ou excluída
eventos.ouvir('venda.alterada', async (d) => {
  if (d.tipo !== 'PEDIDO') return;
  await avaliarDesafiosAbertos(d.data, 'VENDEDORES');
});

// ---- e quando muda de situação (fechou, cancelou, voltou) — venda ou OS
eventos.ouvir('situacao.alterada', async (d) => {
  if (d.modulo === 'VENDA') {
    const v = await prisma.venda.findUnique({ where: { id: d.entidadeId }, select: { data: true, tipo: true } });
    if (!v || v.tipo !== 'PEDIDO') return;
    await avaliarDesafiosAbertos(v.data, 'VENDEDORES');
  } else if (d.modulo === 'OS') {
    const o = await prisma.ordemServico.findUnique({ where: { id: d.entidadeId }, select: { dataConclusao: true } });
    await avaliarDesafiosAbertos(o?.dataConclusao ?? new Date(), 'TECNICOS');
  }
});

// ---- e a cada 10 min (pega transferências de vendedor/técnico, edições de data/valor, vendas do PDV)
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
