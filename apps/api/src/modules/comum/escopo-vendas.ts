/**
 * ESCOPO DAS VENDAS POR PERFIL (decisão do Thiago, 29/10/2026)
 *
 *   VENDEDOR e TÉCNICO → só as PRÓPRIAS vendas e orçamentos (as que estão no nome do seu cadastro de vendedor).
 *                        Não veem a lista nem o total vendido da loja toda, nem vendas dos colegas.
 *   ADMIN, GERENTE e FINANCEIRO → todas as vendas.
 *
 * Usado em dois lugares (defesa em profundidade):
 *   1. plugins/auth.ts — toda rota /vendas/:id... (em qualquer módulo: venda, documentos, carnê, robô de NF)
 *      e /notas-fiscais/:id responde 403 quando a venda é de outro vendedor;
 *   2. nas listagens — GET /vendas, /notas-fiscais, histórico/resumo do cliente, robô de NF — o filtro
 *      `vendedorId` é imposto pelo servidor (o que o vendedor manda na query é ignorado).
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { vendedorDoUsuario } from './vendedores.js';

export type UsuarioEscopo = { id: number; perfil?: string | null; vendedorId?: number | null } | null | undefined;

/** Perfis que enxergam todas as vendas da loja. */
export function veTodasAsVendas(perfil: string | null | undefined): boolean {
  return perfil === 'ADMIN' || perfil === 'GERENTE' || perfil === 'FINANCEIRO';
}

/**
 * Vendedor ao qual o usuário está restrito: `null` = sem restrição (gestão/financeiro).
 * Para VENDEDOR/TÉCNICO lê o vínculo do banco (pode ter mudado depois do login; quem não tem cadastro ganha um).
 * Se mesmo assim não houver cadastro, devolve -1: a pessoa não vê venda nenhuma (nunca cai para "todas").
 */
export async function vendedorRestrito(usuario: UsuarioEscopo): Promise<number | null> {
  if (!usuario || veTodasAsVendas(usuario.perfil)) return null;
  const id = usuario.vendedorId ?? (await vendedorDoUsuario(usuario.id));
  return id ?? -1;
}

/** Trecho de `where` do Prisma para listagens de Venda (vazio = todas). */
export async function whereVendasDoUsuario(usuario: UsuarioEscopo): Promise<{ vendedorId?: number }> {
  const v = await vendedorRestrito(usuario);
  return v === null ? {} : { vendedorId: v };
}

export const CODIGO_VENDA_DE_OUTRO = 'VENDA_DE_OUTRO_VENDEDOR';

/** Confere se o usuário pode acessar a venda; devolve o motivo quando não pode (venda inexistente passa: a rota responde 404). */
export async function acessoVenda(usuario: UsuarioEscopo, vendaId: number): Promise<{ ok: true } | { ok: false; erro: string }> {
  const v = await vendedorRestrito(usuario);
  if (v === null) return { ok: true };
  const venda = await prisma.venda.findUnique({ where: { id: vendaId }, select: { vendedorId: true, tipo: true, numero: true, vendedor: { select: { nome: true } } } });
  if (!venda || venda.vendedorId === v) return { ok: true };
  const rotulo = venda.tipo === 'ORCAMENTO' ? 'Este orçamento' : 'Esta venda';
  const dono = venda.vendedor?.nome ? ` (${venda.vendedor.nome})` : ' (sem vendedor)';
  return { ok: false, erro: `${rotulo} nº ${venda.numero} é de outro vendedor${dono}. Você só tem acesso às suas próprias vendas — peça ao gerente se precisar dela.` };
}

/** Lança 403 quando a venda é de outro vendedor. */
export async function exigirVendaPropria(usuario: UsuarioEscopo, vendaId: number): Promise<void> {
  const r = await acessoVenda(usuario, vendaId);
  if (!r.ok) throw new AppError(r.erro, 403, CODIGO_VENDA_DE_OUTRO);
}

/** Nota fiscal ligada a uma venda de outro vendedor → 403 (nota de OS ou avulsa passa). */
export async function acessoNota(usuario: UsuarioEscopo, notaId: number): Promise<{ ok: true } | { ok: false; erro: string }> {
  const v = await vendedorRestrito(usuario);
  if (v === null) return { ok: true };
  const nota = await prisma.notaFiscal.findUnique({ where: { id: notaId }, select: { venda: { select: { id: true } } } });
  if (!nota?.venda) return { ok: true };
  return acessoVenda(usuario, nota.venda.id);
}
