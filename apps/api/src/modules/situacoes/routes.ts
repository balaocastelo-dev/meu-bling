/**
 * Situações (motor de status) e transições — configuração por módulo (VENDA/COMPRA/OS/ORCAMENTO).
 * `acoes` é JSON string no banco; aqui entra/sai como array.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { parseJsonArray } from '../../lib/util.js';
import { ACOES_DISPONIVEIS, situacoesPermitidas, type Acao, type Modulo } from '../../core/situacoes.js';
import { idDe } from '../comum/zod.js';

const MODULOS = ['VENDA', 'COMPRA', 'OS', 'ORCAMENTO'] as const;
const NOMES_ACOES = ACOES_DISPONIVEIS.map((a) => a.nome) as [Acao, ...Acao[]];

const acoesSchema = z.array(z.enum(NOMES_ACOES)).default([]);

function serializar<T extends { acoes: string }>(s: T) {
  return { ...s, acoes: parseJsonArray(s.acoes) };
}

/** Valida que as ações informadas existem para o módulo. */
function validarAcoes(modulo: Modulo, acoes: string[]) {
  for (const a of acoes) {
    const def = ACOES_DISPONIVEIS.find((d) => d.nome === a);
    if (!def) throw new AppError(`Ação "${a}" não existe.`, 422, 'ACAO_INVALIDA');
    if (!def.modulos.includes(modulo)) throw new AppError(`Ação "${a}" não está disponível para o módulo ${modulo}.`, 422, 'ACAO_INVALIDA');
  }
}

export default async function situacoesRoutes(app: FastifyInstance) {
  const config = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') };

  // Rotas fixas antes de /:id
  app.get('/api/v1/situacoes/acoes', async () => ACOES_DISPONIVEIS);

  app.get('/api/v1/situacoes/transicoes', async (req) => {
    const q = z.object({ modulo: z.enum(MODULOS).optional() }).parse(req.query);
    const lista = await prisma.situacaoTransicao.findMany({
      where: { modulo: q.modulo },
      include: { origem: { select: { id: true, nome: true, cor: true } }, destino: { select: { id: true, nome: true, cor: true } } },
      orderBy: [{ origemId: 'asc' }, { destinoId: 'asc' }],
    });
    return lista.map(serializar);
  });

  app.put('/api/v1/situacoes/transicoes', config, async (req) => {
    const body = z
      .object({
        modulo: z.enum(MODULOS),
        transicoes: z.array(
          z.object({
            origemId: z.coerce.number().int().positive(),
            destinoId: z.coerce.number().int().positive(),
            ativo: z.boolean().default(true),
            acoes: acoesSchema,
          }),
        ),
      })
      .parse(req.body);

    const situacoes = await prisma.situacao.findMany({ where: { modulo: body.modulo }, select: { id: true } });
    const ids = new Set(situacoes.map((s) => s.id));
    for (const t of body.transicoes) {
      if (!ids.has(t.origemId) || !ids.has(t.destinoId)) {
        throw new AppError(`Transição ${t.origemId}→${t.destinoId} usa situação que não pertence ao módulo ${body.modulo}.`, 422, 'TRANSICAO_INVALIDA');
      }
      if (t.origemId === t.destinoId) throw new AppError('Origem e destino não podem ser a mesma situação.', 422, 'TRANSICAO_INVALIDA');
      validarAcoes(body.modulo, t.acoes);
    }

    // substitui o conjunto do módulo
    await prisma.$transaction(async (tx) => {
      await tx.situacaoTransicao.deleteMany({ where: { modulo: body.modulo } });
      const vistos = new Set<string>();
      for (const t of body.transicoes) {
        const k = `${t.origemId}:${t.destinoId}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        await tx.situacaoTransicao.create({
          data: { modulo: body.modulo, origemId: t.origemId, destinoId: t.destinoId, ativo: t.ativo, acoes: JSON.stringify(t.acoes) },
        });
      }
    });
    await auditar(req, 'SituacaoTransicao', null, 'ALTERAR', { modulo: body.modulo, qtd: body.transicoes.length });
    const lista = await prisma.situacaoTransicao.findMany({ where: { modulo: body.modulo }, orderBy: [{ origemId: 'asc' }, { destinoId: 'asc' }] });
    return lista.map(serializar);
  });

  app.get('/api/v1/situacoes', async (req) => {
    const q = z.object({ modulo: z.enum(MODULOS).optional(), ativo: z.string().optional() }).parse(req.query);
    const lista = await prisma.situacao.findMany({
      where: { modulo: q.modulo, ativo: q.ativo === undefined || q.ativo === '' ? undefined : q.ativo === 'true' },
      orderBy: [{ modulo: 'asc' }, { ordem: 'asc' }, { id: 'asc' }],
    });
    return lista.map(serializar);
  });

  app.get('/api/v1/situacoes/:id/permitidas', async (req) => {
    const id = idDe(req);
    const s = await prisma.situacao.findUnique({ where: { id } });
    if (!s) throw new NotFound('Situação');
    const perm = await situacoesPermitidas(s.modulo as Modulo, id);
    return perm.map(serializar);
  });

  app.get('/api/v1/situacoes/:id', async (req) => {
    const s = await prisma.situacao.findUnique({ where: { id: idDe(req) } });
    if (!s) throw new NotFound('Situação');
    return serializar(s);
  });

  const situacaoSchema = z.object({
    modulo: z.enum(MODULOS),
    nome: z.string().trim().min(1).max(60),
    cor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'cor deve ser hex (#rrggbb)').default('#64748b'),
    ordem: z.coerce.number().int().min(0).optional(),
    acoes: acoesSchema,
    inicial: z.boolean().default(false),
    final: z.boolean().default(false),
    cancelamento: z.boolean().default(false),
    ativo: z.boolean().default(true),
  });

  app.post('/api/v1/situacoes', config, async (req, reply) => {
    const body = situacaoSchema.parse(req.body);
    validarAcoes(body.modulo, body.acoes);
    const s = await prisma.$transaction(async (tx) => {
      let ordem = body.ordem;
      if (ordem === undefined) {
        const max = await tx.situacao.aggregate({ where: { modulo: body.modulo }, _max: { ordem: true } });
        ordem = (max._max.ordem ?? -1) + 1;
      }
      if (body.inicial) await tx.situacao.updateMany({ where: { modulo: body.modulo, inicial: true }, data: { inicial: false } });
      return tx.situacao.create({ data: { ...body, ordem, acoes: JSON.stringify(body.acoes) } });
    });
    await auditar(req, 'Situacao', s.id, 'CRIAR', body);
    return reply.code(201).send(serializar(s));
  });

  app.put('/api/v1/situacoes/:id', config, async (req) => {
    const id = idDe(req);
    const atual = await prisma.situacao.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Situação');
    const body = situacaoSchema.partial().parse(req.body);
    if (body.modulo && body.modulo !== atual.modulo) throw new AppError('Não é possível mudar o módulo de uma situação.', 422, 'MODULO');
    if (body.acoes) validarAcoes(atual.modulo as Modulo, body.acoes);
    if (atual.sistema && body.nome && body.nome !== atual.nome) {
      // situações de sistema podem mudar cor/ações/ordem, mas o nome é fixo (é referência dos relatórios/seed)
      throw new AppError('O nome de uma situação de sistema não pode ser alterado.', 422, 'SITUACAO_SISTEMA');
    }
    const s = await prisma.$transaction(async (tx) => {
      if (body.inicial) await tx.situacao.updateMany({ where: { modulo: atual.modulo, inicial: true, id: { not: id } }, data: { inicial: false } });
      const { modulo: _m, acoes, ...resto } = body;
      return tx.situacao.update({ where: { id }, data: { ...resto, ...(acoes ? { acoes: JSON.stringify(acoes) } : {}) } });
    });
    await auditar(req, 'Situacao', id, 'ALTERAR', body);
    return serializar(s);
  });

  app.delete('/api/v1/situacoes/:id', config, async (req) => {
    const id = idDe(req);
    const s = await prisma.situacao.findUnique({ where: { id } });
    if (!s) throw new NotFound('Situação');
    if (s.sistema) throw new AppError('Situações de sistema não podem ser excluídas (desative-a se não quiser usá-la).', 422, 'SITUACAO_SISTEMA');
    const emUso =
      (await prisma.venda.count({ where: { situacaoId: id } })) +
      (await prisma.compra.count({ where: { situacaoId: id } })) +
      (await prisma.ordemServico.count({ where: { situacaoId: id } }));
    if (emUso > 0) {
      await prisma.situacao.update({ where: { id }, data: { ativo: false } });
      await auditar(req, 'Situacao', id, 'EXCLUIR', { desativado: true });
      return { ok: true, desativado: true, mensagem: `Situação em uso por ${emUso} registro(s): foi desativada em vez de excluída.` };
    }
    await prisma.situacao.delete({ where: { id } }); // transições caem em cascata
    await auditar(req, 'Situacao', id, 'EXCLUIR');
    return { ok: true, desativado: false };
  });
}
