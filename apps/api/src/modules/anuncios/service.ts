/**
 * VITRINE DA EQUIPE — regras de quem é dono do quê.
 *
 * O técnico é PJ e o vendedor trabalha por comissão: os dois precisam publicar e mexer no que é
 * deles sem pedir aprovação (decisão do Thiago, 30/10/2026). A liberdade tem um limite só —
 * **cada um mexe apenas no que é dele** — e é aqui que isso é garantido, para a trava não
 * depender de cada rota lembrar de conferir.
 */
import { randomBytes } from 'node:crypto';
import { AppError, Forbidden, NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { tecnicoDoUsuario, vendedorDoUsuario } from '../comum/vendedores.js';
import { pctPadraoDe } from './comissao.js';
import type { UsuarioJwt } from '../../plugins/auth.js';

/** Quem o usuário logado é na vitrine: dono (vendedor/técnico) ou gestão (vê tudo). */
export interface Dono {
  donoTipo: 'VENDEDOR' | 'TECNICO' | null;
  vendedorId: number | null;
  tecnicoId: number | null;
  gestao: boolean;
}

export async function donoDoUsuario(u: UsuarioJwt): Promise<Dono> {
  const gestao = u.perfil === 'ADMIN' || u.perfil === 'GERENTE';
  // O técnico também vende (decisão do Thiago, 29/10/2026): se o usuário tem cadastro de técnico,
  // o anúncio dele é de técnico — é o papel que paga mais (33%) e o que ele de fato publica.
  const tecnicoId = await tecnicoDoUsuario(u.id);
  if (tecnicoId) return { donoTipo: 'TECNICO', vendedorId: await vendedorDoUsuario(u.id), tecnicoId, gestao };
  const vendedorId = await vendedorDoUsuario(u.id);
  if (vendedorId) return { donoTipo: 'VENDEDOR', vendedorId, tecnicoId: null, gestao };
  return { donoTipo: null, vendedorId: null, tecnicoId: null, gestao };
}

/** Filtro de listagem: a gestão vê todos, o dono vê os dele. */
export function filtroDoDono(d: Dono): Record<string, unknown> {
  if (d.gestao) return {};
  if (d.donoTipo === 'TECNICO') return { donoTipo: 'TECNICO', tecnicoId: d.tecnicoId };
  if (d.donoTipo === 'VENDEDOR') return { donoTipo: 'VENDEDOR', vendedorId: d.vendedorId };
  // sem cadastro de vendedor nem de técnico: não enxerga anúncio nenhum
  return { id: -1 };
}

/** Carrega o anúncio conferindo que o usuário pode mexer nele. */
export async function anuncioQuePodeMexer(id: number, d: Dono) {
  const a = await prisma.anuncio.findUnique({ where: { id } });
  if (!a) throw new NotFound('Anúncio');
  if (d.gestao) return a;
  const meu =
    (a.donoTipo === 'TECNICO' && a.tecnicoId && a.tecnicoId === d.tecnicoId) ||
    (a.donoTipo === 'VENDEDOR' && a.vendedorId && a.vendedorId === d.vendedorId);
  if (!meu) throw new Forbidden('Este anúncio é de outra pessoa da equipe. Você só mexe nos seus.');
  return a;
}

/** Código do link público: curto para caber num WhatsApp, aleatório para ninguém adivinhar o do colega. */
export async function gerarCodigo(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const c = randomBytes(4).toString('hex').slice(0, 6);
    if (!(await prisma.anuncio.findUnique({ where: { codigo: c }, select: { id: true } }))) return c;
  }
  throw new AppError('Não consegui gerar o código do anúncio. Tente de novo.', 500, 'CODIGO_ANUNCIO');
}

/** Percentual que o anúncio vai congelar, conforme o dono. */
export function pctDoAnuncio(donoTipo: string): number {
  return pctPadraoDe(donoTipo);
}

export const anuncioInclude = {
  produto: { select: { id: true, nome: true, codigo: true, preco: true, precoCusto: true, tipo: true, imagemUrl: true, garantiaDias: true, ativo: true, controlaEstoque: true } },
  vendedor: { select: { id: true, nome: true } },
  tecnico: { select: { id: true, nome: true } },
} as const;

/** Quanto o anúncio já rendeu: vendas atribuídas e comissão gerada. */
export async function retornoDoAnuncio(anuncioId: number) {
  const [comissoes, vendas, ordens] = await Promise.all([
    prisma.comissao.findMany({ where: { anuncioId, status: { not: 'CANCELADA' } }, select: { valor: true, base: true, status: true } }),
    // a venda conta tanto quando o anúncio trouxe o cliente (anuncioId na venda) quanto quando só
    // um item veio dele (caso do serviço do técnico dentro de uma venda maior)
    prisma.venda.count({ where: { OR: [{ anuncioId }, { itens: { some: { anuncioId } } }] } }),
    prisma.ordemServico.count({ where: { OR: [{ anuncioId }, { itens: { some: { anuncioId } } }] } }),
  ]);
  const soma = (f: (c: { valor: number; base: number; status: string }) => number) => Math.round(comissoes.reduce((s, c) => s + f(c), 0) * 100) / 100;
  return {
    vendas: vendas + ordens,
    lucroGerado: soma((c) => c.base),
    comissaoTotal: soma((c) => c.valor),
    comissaoPaga: soma((c) => (c.status === 'PAGA' ? c.valor : 0)),
    comissaoAReceber: soma((c) => (c.status !== 'PAGA' ? c.valor : 0)),
  };
}

/** O que a vitrine pública mostra — nunca custo, nunca dado interno. */
export function paraVitrine(a: {
  codigo: string;
  titulo: string;
  descricao: string | null;
  fotos: string | null;
  precoAPartirDe: number | null;
  prazoDias: number | null;
  produto: { nome: string; preco: number; tipo: string; imagemUrl: string | null; garantiaDias: number };
  vendedor: { nome: string } | null;
  tecnico: { nome: string } | null;
}) {
  const fotos = (a.fotos || '').split(',').map((f) => f.trim()).filter(Boolean);
  return {
    codigo: a.codigo,
    titulo: a.titulo,
    descricao: a.descricao,
    fotos: fotos.length ? fotos : a.produto.imagemUrl ? [a.produto.imagemUrl] : [],
    tipo: a.produto.tipo === 'S' ? 'SERVICO' : 'PRODUTO',
    preco: a.produto.preco,
    precoAPartirDe: a.precoAPartirDe,
    prazoDias: a.prazoDias,
    garantiaDias: a.produto.garantiaDias,
    atendeCom: a.tecnico?.nome ?? a.vendedor?.nome ?? null,
    link: `/a/${a.codigo}`,
  };
}
