/**
 * LEMBRETES do Meu Dashboard (29/10/2026)
 *
 * Cada usuário tem os seus lembretes ("ligar para o cliente", "orçamento vence sexta"). A gestão
 * (ADMIN/GERENTE) pode mandar lembrete para qualquer pessoa da equipe — ele aparece no Meu Dashboard dela.
 *
 *   GET    /api/v1/lembretes?usuarioId=&concluidos=   os meus (ou de alguém, para a gestão)
 *   POST   /api/v1/lembretes                           { titulo, descricao?, data, link?, paraUsuarioId? }
 *   PUT    /api/v1/lembretes/:id
 *   POST   /api/v1/lembretes/:id/concluir · /reabrir
 *   DELETE /api/v1/lembretes/:id
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { endOfDay, startOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { idDe } from '../comum/zod.js';

const selecao = {
  id: true,
  titulo: true,
  descricao: true,
  data: true,
  link: true,
  concluidoEm: true,
  criadoEm: true,
  paraUsuarioId: true,
  para: { select: { id: true, nome: true } },
  criadoPor: { select: { id: true, nome: true } },
} as const;

function lerData(v: string): Date {
  const s = v.trim();
  // só o dia → meio-dia (não escorrega de dia com fuso)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
  if (Number.isNaN(d.getTime())) throw new AppError('Data do lembrete inválida.', 422, 'DATA_INVALIDA');
  return d;
}

const corpo = z.object({
  titulo: z.string().trim().min(2, 'Escreva o lembrete.').max(200),
  descricao: z.string().trim().max(2000).nullable().optional(),
  data: z.string().min(8, 'Informe a data do lembrete.'),
  link: z.string().trim().max(300).nullable().optional(),
  paraUsuarioId: z.coerce.number().int().positive().optional(),
});

/** Situação do lembrete em relação a hoje (para o Meu Dashboard) */
export function situacaoLembrete(l: { data: Date; concluidoEm: Date | null }, agora = new Date()) {
  if (l.concluidoEm) return 'CONCLUIDO' as const;
  if (l.data < startOfDay(agora)) return 'ATRASADO' as const;
  if (l.data <= endOfDay(agora)) return 'HOJE' as const;
  return 'FUTURO' as const;
}

/** Lembretes pendentes de um usuário (atrasados e de hoje primeiro) — usado pelo Meu Dashboard */
export async function lembretesPendentes(usuarioId: number, limite = 20) {
  const lista = await prisma.lembrete.findMany({ where: { paraUsuarioId: usuarioId, concluidoEm: null }, orderBy: [{ data: 'asc' }, { id: 'asc' }], take: limite, select: selecao });
  const agora = new Date();
  return lista.map((l) => ({ ...l, situacao: situacaoLembrete(l, agora) }));
}

export default async function lembretesRoutes(app: FastifyInstance) {
  const gestor = (perfil: string) => perfil === 'ADMIN' || perfil === 'GERENTE';

  async function carregar(req: { user: { id: number; perfil: string } }, id: number) {
    const l = await prisma.lembrete.findUnique({ where: { id }, select: selecao });
    if (!l) throw new NotFound('Lembrete');
    // cada um mexe só nos seus; a gestão mexe em qualquer um
    if (l.paraUsuarioId !== req.user.id && !gestor(req.user.perfil)) throw new Forbidden();
    return l;
  }

  app.get('/api/v1/lembretes', async (req) => {
    const q = z.object({ usuarioId: z.coerce.number().int().positive().optional(), concluidos: z.coerce.string().optional() }).parse(req.query);
    const alvo = q.usuarioId && gestor(req.user.perfil) ? q.usuarioId : req.user.id;
    const comConcluidos = q.concluidos === '1' || q.concluidos === 'true';
    const lista = await prisma.lembrete.findMany({
      where: { paraUsuarioId: alvo, ...(comConcluidos ? {} : { concluidoEm: null }) },
      orderBy: [{ concluidoEm: 'asc' }, { data: 'asc' }, { id: 'asc' }],
      take: 200,
      select: selecao,
    });
    const agora = new Date();
    return lista.map((l) => ({ ...l, situacao: situacaoLembrete(l, agora) }));
  });

  app.post('/api/v1/lembretes', async (req, reply) => {
    const b = corpo.parse(req.body);
    let paraUsuarioId = req.user.id;
    if (b.paraUsuarioId && b.paraUsuarioId !== req.user.id) {
      if (!gestor(req.user.perfil)) throw new AppError('Só o gestor e a gerente mandam lembrete para outra pessoa.', 403, 'SEM_PERMISSAO');
      const u = await prisma.usuario.findUnique({ where: { id: b.paraUsuarioId }, select: { id: true, ativo: true } });
      if (!u || !u.ativo) throw new AppError('Usuário não encontrado ou inativo.', 422, 'USUARIO');
      paraUsuarioId = u.id;
    }
    const l = await prisma.lembrete.create({
      data: { titulo: b.titulo, descricao: b.descricao || null, data: lerData(b.data), link: b.link || null, paraUsuarioId, criadoPorId: req.user.id },
      select: selecao,
    });
    await auditar(req, 'Lembrete', l.id, 'CRIAR', { titulo: l.titulo, para: paraUsuarioId });
    return reply.code(201).send({ ...l, situacao: situacaoLembrete(l) });
  });

  app.put('/api/v1/lembretes/:id', async (req) => {
    const id = idDe(req);
    await carregar(req, id);
    const b = corpo.partial().parse(req.body);
    const data: Record<string, unknown> = {};
    if (b.titulo !== undefined) data.titulo = b.titulo;
    if (b.descricao !== undefined) data.descricao = b.descricao || null;
    if (b.link !== undefined) data.link = b.link || null;
    if (b.data !== undefined) data.data = lerData(b.data);
    if (b.paraUsuarioId !== undefined) {
      if (!gestor(req.user.perfil)) throw new AppError('Só o gestor e a gerente trocam para quem é o lembrete.', 403, 'SEM_PERMISSAO');
      data.paraUsuarioId = b.paraUsuarioId;
    }
    const l = await prisma.lembrete.update({ where: { id }, data, select: selecao });
    await auditar(req, 'Lembrete', id, 'ALTERAR', b);
    return { ...l, situacao: situacaoLembrete(l) };
  });

  app.post('/api/v1/lembretes/:id/concluir', async (req) => {
    const id = idDe(req);
    await carregar(req, id);
    const l = await prisma.lembrete.update({ where: { id }, data: { concluidoEm: new Date() }, select: selecao });
    await auditar(req, 'Lembrete', id, 'ACAO', { acao: 'concluir' });
    return { ...l, situacao: situacaoLembrete(l) };
  });

  app.post('/api/v1/lembretes/:id/reabrir', async (req) => {
    const id = idDe(req);
    await carregar(req, id);
    const l = await prisma.lembrete.update({ where: { id }, data: { concluidoEm: null }, select: selecao });
    await auditar(req, 'Lembrete', id, 'ACAO', { acao: 'reabrir' });
    return { ...l, situacao: situacaoLembrete(l) };
  });

  app.delete('/api/v1/lembretes/:id', async (req) => {
    const id = idDe(req);
    const l = await carregar(req, id);
    await prisma.lembrete.delete({ where: { id } });
    await auditar(req, 'Lembrete', id, 'EXCLUIR', { titulo: l.titulo });
    return { ok: true };
  });
}
