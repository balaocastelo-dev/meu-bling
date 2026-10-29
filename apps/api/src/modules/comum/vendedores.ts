/**
 * Vínculo usuário → cadastro de vendedor / técnico.
 * Todo usuário com perfil VENDEDOR precisa de um cadastro de vendedor (é ele que aparece na venda,
 * na comissão, no painel e no ranking). O TÉCNICO também vende (decisão do Thiago, 29/10/2026), então
 * precisa dos dois cadastros: técnico (para as OS) e vendedor (para as vendas dele).
 * Se faltar, este módulo cria/vincula sozinho:
 *   1) um cadastro ativo com o mesmo nome que ainda não esteja ligado a outro usuário, ou
 *   2) um cadastro novo com o nome do usuário.
 */
import { prisma } from '../../lib/prisma.js';

function normalizar(s: string) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Devolve o vendedorId do usuário (lido do banco), criando o vínculo se for VENDEDOR ou TÉCNICO sem cadastro. */
export async function vendedorDoUsuario(usuarioId: number): Promise<number | null> {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nome: true, perfil: true, vendedorId: true } });
  if (!u) return null;
  if (u.vendedorId || (u.perfil !== 'VENDEDOR' && u.perfil !== 'TECNICO')) return u.vendedorId;
  const livres = await prisma.vendedor.findMany({ where: { usuario: { is: null } }, select: { id: true, nome: true, ativo: true } });
  const alvo = normalizar(u.nome);
  const igual = livres.find((v) => v.ativo && normalizar(v.nome) === alvo) || livres.find((v) => normalizar(v.nome) === alvo);
  const vendedorId = igual ? igual.id : (await prisma.vendedor.create({ data: { nome: u.nome.trim(), ativo: true } })).id;
  if (igual && !igual.ativo) await prisma.vendedor.update({ where: { id: igual.id }, data: { ativo: true } });
  try {
    await prisma.usuario.update({ where: { id: u.id }, data: { vendedorId } });
  } catch {
    // corrida: outro processo já vinculou; relê
    return (await prisma.usuario.findUnique({ where: { id: u.id }, select: { vendedorId: true } }))?.vendedorId ?? null;
  }
  return vendedorId;
}

/** Devolve o tecnicoId do usuário (lido do banco), criando o vínculo se for TÉCNICO sem cadastro. */
export async function tecnicoDoUsuario(usuarioId: number): Promise<number | null> {
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nome: true, perfil: true, tecnicoId: true } });
  if (!u) return null;
  if (u.tecnicoId || u.perfil !== 'TECNICO') return u.tecnicoId;
  const livres = await prisma.tecnico.findMany({ where: { usuario: { is: null } }, select: { id: true, nome: true, ativo: true } });
  const alvo = normalizar(u.nome);
  const igual = livres.find((t) => t.ativo && normalizar(t.nome) === alvo) || livres.find((t) => normalizar(t.nome) === alvo);
  const tecnicoId = igual ? igual.id : (await prisma.tecnico.create({ data: { nome: u.nome.trim(), ativo: true } })).id;
  if (igual && !igual.ativo) await prisma.tecnico.update({ where: { id: igual.id }, data: { ativo: true } });
  try {
    await prisma.usuario.update({ where: { id: u.id }, data: { tecnicoId } });
  } catch {
    return (await prisma.usuario.findUnique({ where: { id: u.id }, select: { tecnicoId: true } }))?.tecnicoId ?? null;
  }
  return tecnicoId;
}
