/**
 * Junta o que o motor de comissão precisa saber sobre os anúncios de uma venda ou de uma OS:
 * qual anúncio trouxe o cliente e de quais anúncios vieram os itens.
 *
 * Fica separado do cálculo (comissao.ts) para o motor continuar sendo função pura, fácil de
 * testar com números na mão.
 */
import type { AnuncioDaComissao } from './comissao.js';

type Db = {
  anuncio: { findMany: (a: unknown) => Promise<AnuncioDaComissao[]> };
};

const SELECT = { id: true, codigo: true, titulo: true, donoTipo: true, vendedorId: true, tecnicoId: true, comissaoPct: true } as const;

/** Carrega, por id, todos os anúncios citados numa venda/OS (o da origem e os dos itens). */
export async function anunciosDaOrigem(
  tx: Db,
  origem: { anuncioId?: number | null; itens: { anuncioId?: number | null }[] },
): Promise<{ porId: Map<number, AnuncioDaComissao>; daOrigem: AnuncioDaComissao | null }> {
  const ids = [...new Set([origem.anuncioId, ...origem.itens.map((i) => i.anuncioId)].filter((x): x is number => !!x))];
  if (!ids.length) return { porId: new Map(), daOrigem: null };
  const lista = await tx.anuncio.findMany({ where: { id: { in: ids } }, select: SELECT });
  const porId = new Map(lista.map((a) => [a.id, a]));
  return { porId, daOrigem: origem.anuncioId ? porId.get(origem.anuncioId) ?? null : null };
}
