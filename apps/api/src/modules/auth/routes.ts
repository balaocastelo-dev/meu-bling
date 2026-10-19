import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';

const PERFIS = ['ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'] as const;

export default async function authRoutes(app: FastifyInstance) {
  // ---- Login
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z.object({ email: z.string().email(), senha: z.string().min(1) }).parse(req.body);
    const u = await prisma.usuario.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    if (!u || !u.ativo || !(await bcrypt.compare(body.senha, u.senhaHash))) {
      throw new AppError('E-mail ou senha inválidos.', 401, 'CREDENCIAIS');
    }
    await prisma.usuario.update({ where: { id: u.id }, data: { ultimoLogin: new Date() } });
    const payload = { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil as any, vendedorId: u.vendedorId, tecnicoId: u.tecnicoId };
    const token = app.jwt.sign(payload);
    await auditar(req, 'Usuario', u.id, 'LOGIN');
    return reply.send({ token, usuario: payload });
  });

  // ---- Usuário atual
  app.get('/api/v1/auth/eu', async (req) => {
    const u = await prisma.usuario.findUnique({
      where: { id: req.user.id },
      select: { id: true, nome: true, email: true, perfil: true, vendedorId: true, tecnicoId: true, ativo: true },
    });
    if (!u) throw new NotFound('Usuário');
    return u;
  });

  app.put('/api/v1/auth/senha', async (req) => {
    const body = z.object({ senhaAtual: z.string(), novaSenha: z.string().min(6) }).parse(req.body);
    const u = await prisma.usuario.findUnique({ where: { id: req.user.id } });
    if (!u || !(await bcrypt.compare(body.senhaAtual, u.senhaHash))) throw new AppError('Senha atual incorreta.');
    await prisma.usuario.update({ where: { id: u.id }, data: { senhaHash: await bcrypt.hash(body.novaSenha, 10) } });
    return { ok: true };
  });

  // ---- Gestão de usuários (ADMIN)
  app.get('/api/v1/usuarios', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async () => {
    return prisma.usuario.findMany({
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, vendedorId: true, tecnicoId: true, ultimoLogin: true, criadoEm: true },
      orderBy: { nome: 'asc' },
    });
  });

  const usuarioSchema = z.object({
    nome: z.string().min(2),
    email: z.string().email(),
    senha: z.string().min(6).optional(),
    perfil: z.enum(PERFIS).default('VENDEDOR'),
    ativo: z.boolean().default(true),
    vendedorId: z.number().int().nullable().optional(),
    tecnicoId: z.number().int().nullable().optional(),
  });

  app.post('/api/v1/usuarios', { preHandler: app.exigirPerfil('ADMIN') }, async (req, reply) => {
    const body = usuarioSchema.parse(req.body);
    if (!body.senha) throw new AppError('Informe a senha inicial.');
    const u = await prisma.usuario.create({
      data: { ...body, email: body.email.toLowerCase().trim(), senhaHash: await bcrypt.hash(body.senha, 10), senha: undefined } as any,
      select: { id: true, nome: true, email: true, perfil: true, ativo: true },
    });
    await auditar(req, 'Usuario', u.id, 'CRIAR', { email: u.email });
    return reply.code(201).send(u);
  });

  app.put('/api/v1/usuarios/:id', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const id = Number((req.params as any).id);
    const body = usuarioSchema.partial().parse(req.body);
    const data: any = { ...body };
    delete data.senha;
    if (body.email) data.email = body.email.toLowerCase().trim();
    if (body.senha) data.senhaHash = await bcrypt.hash(body.senha, 10);
    if (id === req.user.id && body.ativo === false) throw new AppError('Você não pode desativar o próprio usuário.');
    const u = await prisma.usuario.update({ where: { id }, data, select: { id: true, nome: true, email: true, perfil: true, ativo: true } });
    await auditar(req, 'Usuario', id, 'ALTERAR', body);
    return u;
  });

  app.delete('/api/v1/usuarios/:id', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const id = Number((req.params as any).id);
    if (id === req.user.id) throw new Forbidden('Você não pode excluir o próprio usuário.');
    await prisma.usuario.update({ where: { id }, data: { ativo: false } });
    await auditar(req, 'Usuario', id, 'EXCLUIR');
    return { ok: true };
  });

  // ---- Auditoria
  app.get('/api/v1/auditoria', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const q = z.object({ entidade: z.string().optional(), entidadeId: z.coerce.number().optional(), limite: z.coerce.number().default(100) }).parse(req.query);
    return prisma.auditoria.findMany({
      where: { entidade: q.entidade, entidadeId: q.entidadeId },
      include: { usuario: { select: { id: true, nome: true } } },
      orderBy: { data: 'desc' },
      take: q.limite,
    });
  });
}
