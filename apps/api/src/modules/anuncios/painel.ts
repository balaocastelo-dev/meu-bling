/**
 * PAINEL DO ADMIN — "Pagamento extra por anúncio da equipe".
 *
 * O que o Thiago quer ver no dashboard principal: quanto a vitrine da equipe rendeu de lucro e
 * quanto disso vira pagamento extra, dividido entre técnicos e vendedores, com quem mais vendeu.
 *
 * O número que importa é o LUCRO QUE OS ANÚNCIOS TROUXERAM, não a comissão isolada: comissão
 * sozinha parece só despesa, quando na verdade é fatia de um lucro que talvez não existisse.
 */
import { prisma } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';

export interface PainelAnuncios {
  lucroGerado: number;
  comissaoTotal: number;
  comissaoPaga: number;
  comissaoAReceber: number;
  lucroLiquido: number;
  qtdVendas: number;
  qtdAnunciosAtivos: number;
  porDono: { tipo: 'TECNICO' | 'VENDEDOR'; nome: string; lucroGerado: number; comissao: number; vendas: number }[];
  topAnuncios: { codigo: string; titulo: string; dono: string | null; lucroGerado: number; comissao: number; vendas: number; visitas: number }[];
}

export async function painelAnuncios(ini: Date, fim: Date): Promise<PainelAnuncios> {
  const comissoes = await prisma.comissao.findMany({
    where: { anuncioId: { not: null }, status: { not: 'CANCELADA' }, criadoEm: { gte: ini, lte: fim } },
    select: {
      base: true, valor: true, status: true, tipo: true, anuncioId: true,
      vendedor: { select: { nome: true } },
      tecnico: { select: { nome: true } },
      anuncio: { select: { codigo: true, titulo: true, visitas: true } },
    },
  });

  const t = { lucroGerado: 0, comissaoTotal: 0, comissaoPaga: 0, comissaoAReceber: 0 };
  const donos = new Map<string, { tipo: 'TECNICO' | 'VENDEDOR'; nome: string; lucroGerado: number; comissao: number; vendas: number }>();
  const anuncios = new Map<number, { codigo: string; titulo: string; dono: string | null; lucroGerado: number; comissao: number; vendas: number; visitas: number }>();

  for (const c of comissoes) {
    t.lucroGerado += c.base;
    t.comissaoTotal += c.valor;
    if (c.status === 'PAGA') t.comissaoPaga += c.valor;
    else t.comissaoAReceber += c.valor;

    const tipo = c.tipo === 'TECNICO' ? 'TECNICO' : 'VENDEDOR';
    const nome = c.tecnico?.nome ?? c.vendedor?.nome ?? 'sem nome';
    const chave = `${tipo}:${nome}`;
    const d = donos.get(chave) ?? { tipo: tipo as 'TECNICO' | 'VENDEDOR', nome, lucroGerado: 0, comissao: 0, vendas: 0 };
    d.lucroGerado += c.base;
    d.comissao += c.valor;
    d.vendas += 1;
    donos.set(chave, d);

    if (c.anuncioId && c.anuncio) {
      const a = anuncios.get(c.anuncioId) ?? { codigo: c.anuncio.codigo, titulo: c.anuncio.titulo, dono: nome, lucroGerado: 0, comissao: 0, vendas: 0, visitas: c.anuncio.visitas };
      a.lucroGerado += c.base;
      a.comissao += c.valor;
      a.vendas += 1;
      anuncios.set(c.anuncioId, a);
    }
  }

  const red = (n: number) => arredondar(n);
  return {
    lucroGerado: red(t.lucroGerado),
    comissaoTotal: red(t.comissaoTotal),
    comissaoPaga: red(t.comissaoPaga),
    comissaoAReceber: red(t.comissaoAReceber),
    // o que sobra para a loja depois de pagar a equipe pelos anúncios
    lucroLiquido: red(t.lucroGerado - t.comissaoTotal),
    qtdVendas: comissoes.length,
    qtdAnunciosAtivos: await prisma.anuncio.count({ where: { ativo: true, naVitrine: true } }),
    porDono: [...donos.values()]
      .map((d) => ({ ...d, lucroGerado: red(d.lucroGerado), comissao: red(d.comissao) }))
      .sort((a, b) => b.comissao - a.comissao),
    topAnuncios: [...anuncios.values()]
      .map((a) => ({ ...a, lucroGerado: red(a.lucroGerado), comissao: red(a.comissao) }))
      .sort((a, b) => b.lucroGerado - a.lucroGerado)
      .slice(0, 10),
  };
}

/**
 * Quanto já foi pago a um técnico por anúncio num período.
 *
 * O "Pagar técnico" (% do lucro da assistência) desconta isto antes de lançar: sem isso, o lucro
 * de um serviço do portal seria pago duas vezes — uma pelos 33% do anúncio e outra no acerto do
 * fim do mês.
 */
export async function comissaoDeAnuncioDoTecnico(tecnicoId: number, ini: Date, fim: Date): Promise<{ lucro: number; comissao: number; qtd: number }> {
  const lista = await prisma.comissao.findMany({
    where: { anuncioId: { not: null }, tecnicoId, status: { not: 'CANCELADA' }, criadoEm: { gte: ini, lte: fim } },
    select: { base: true, valor: true },
  });
  return {
    lucro: arredondar(lista.reduce((s, c) => s + c.base, 0)),
    comissao: arredondar(lista.reduce((s, c) => s + c.valor, 0)),
    qtd: lista.length,
  };
}
