/**
 * COMISSÃO DO ANÚNCIO — o pagamento extra de quem publica na vitrine da equipe.
 *
 * Pedido do Thiago (30/10/2026): o técnico ganha 33% do lucro dos serviços/produtos dele e o
 * vendedor ganha 20% do lucro da venda que veio pelo anúncio dele. Ver docs/VITRINE-EQUIPE.md.
 *
 * A regra que não pode ser quebrada: o LUCRO aqui é o MESMO lucro do DRE e dos dashboards
 * (`fechamentoVenda` / `fechamentoOs`) — receita menos custo do produto/peça, imposto, taxa de
 * cartão e frete/logística. Se este arquivo inventasse uma conta própria, o valor pago ao técnico
 * nunca bateria com o lucro que o ADMIN vê na tela, e todo acerto de fim de mês viraria perícia.
 *
 * Quando só parte da venda veio do anúncio, os custos da venda inteira (imposto, cartão, frete)
 * são rateados pela fatia de receita de cada item — assim a soma dos lucros dos itens dá
 * exatamente o lucro da venda, sem sobra nem duplicação.
 */
import { arredondar } from '../../lib/util.js';
import type { ComissaoNova } from '../comum/financeiro.js';

/** Percentuais padrão da loja (congelados em cada anúncio na criação). */
export const PCT_TECNICO = 33;
export const PCT_VENDEDOR = 20;

export function pctPadraoDe(donoTipo: string): number {
  return donoTipo === 'TECNICO' ? PCT_TECNICO : PCT_VENDEDOR;
}

export interface ItemParaRateio {
  /** receita do item (já com desconto do item) */
  total: number;
  /** custo do produto/peça do item */
  custo: number;
  anuncioId?: number | null;
}

export interface AnuncioDaComissao {
  id: number;
  codigo: string;
  titulo: string;
  donoTipo: string;
  vendedorId: number | null;
  tecnicoId: number | null;
  comissaoPct: number;
}

/**
 * Lucro de cada item, rateando os custos que são da venda/OS inteira (imposto, cartão, frete)
 * pela fatia de receita do item.
 *
 * `custoRateavel` = custo total da venda MENOS o custo de produto/peça (que já é por item).
 * Receita zero (brinde, serviço cortesia) não puxa custo rateado: dividir por zero não existe,
 * e item sem receita não gera comissão de qualquer forma.
 */
export function lucroPorItem(itens: ItemParaRateio[], receitaTotal: number, custoRateavel: number): number[] {
  const receita = arredondar(receitaTotal);
  return itens.map((i) => {
    const fatia = receita > 0 ? (i.total || 0) / receita : 0;
    return arredondar((i.total || 0) - (i.custo || 0) - custoRateavel * fatia);
  });
}

export interface EntradaComissaoAnuncio {
  /** itens na mesma ordem em que vieram da venda/OS */
  itens: ItemParaRateio[];
  receitaTotal: number;
  /** custo total (DRE) da venda/OS */
  custoTotal: number;
  /** parte do custo total que é produto/peça (já contada item a item) */
  custoProdutos: number;
  /** anúncio atribuído à venda/OS inteira (o cliente veio pelo link) */
  anuncioDaOrigem?: AnuncioDaComissao | null;
  /** anúncios dos itens, por id */
  anunciosPorId: Map<number, AnuncioDaComissao>;
  /** texto que identifica a origem na comissão, ex. "Venda nº 1234" */
  descricaoOrigem: string;
}

export interface ComissaoAnuncioCalculada extends ComissaoNova {
  anuncioId: number;
}

/**
 * Monta as comissões extras de anúncio de uma venda/OS.
 *
 * Duas formas de ganhar, conforme o pedido do Thiago:
 *
 *  - TÉCNICO: 33% do lucro dos ITENS dele. Ele é pago pelo serviço que prestou, não pelo resto
 *    do carrinho do cliente.
 *  - VENDEDOR: 20% do lucro da VENDA inteira atribuída ao anúncio dele ("20% do lucro daquela
 *    venda"), porque foi o anúncio dele que trouxe o cliente.
 *
 * Um anúncio de vendedor atribuído à venda inteira e itens de técnico na mesma venda convivem:
 * são pessoas diferentes recebendo por papéis diferentes.
 *
 * Lucro zero ou negativo não gera comissão (o `recriarComissoes` já descarta valor <= 0).
 */
export function comissoesDeAnuncio(e: EntradaComissaoAnuncio): ComissaoAnuncioCalculada[] {
  const custoRateavel = arredondar((e.custoTotal || 0) - (e.custoProdutos || 0));
  const lucros = lucroPorItem(e.itens, e.receitaTotal, custoRateavel);
  const saida: ComissaoAnuncioCalculada[] = [];

  // ---- técnico: por item dele
  const porAnuncio = new Map<number, number>();
  e.itens.forEach((item, i) => {
    const id = item.anuncioId;
    if (!id) return;
    const a = e.anunciosPorId.get(id);
    if (!a || a.donoTipo !== 'TECNICO' || !a.tecnicoId) return;
    porAnuncio.set(id, arredondar((porAnuncio.get(id) ?? 0) + lucros[i]));
  });
  for (const [anuncioId, lucro] of porAnuncio) {
    const a = e.anunciosPorId.get(anuncioId)!;
    if (!(lucro > 0)) continue;
    saida.push({
      tipo: 'TECNICO',
      tecnicoId: a.tecnicoId,
      anuncioId,
      descricao: `${e.descricaoOrigem} — anúncio "${a.titulo}" (${a.comissaoPct}% do lucro)`,
      base: lucro,
      pct: a.comissaoPct,
      valor: arredondar(lucro * (a.comissaoPct / 100)),
    });
  }

  // ---- vendedor: sobre o lucro da venda inteira atribuída ao anúncio
  const dono = e.anuncioDaOrigem;
  if (dono && dono.donoTipo === 'VENDEDOR' && dono.vendedorId) {
    const lucroTotal = arredondar((e.receitaTotal || 0) - (e.custoTotal || 0));
    if (lucroTotal > 0) {
      saida.push({
        tipo: 'VENDEDOR',
        vendedorId: dono.vendedorId,
        anuncioId: dono.id,
        descricao: `${e.descricaoOrigem} — cliente veio do anúncio "${dono.titulo}" (${dono.comissaoPct}% do lucro)`,
        base: lucroTotal,
        pct: dono.comissaoPct,
        valor: arredondar(lucroTotal * (dono.comissaoPct / 100)),
      });
    }
  }

  return saida;
}

/**
 * Itens pagos por anúncio de técnico não entram também na comissão normal da OS: aquele item já
 * é pago pelos 33% do lucro. Sem esta trava o técnico receberia duas vezes pelo mesmo serviço.
 */
export function itemPagoPorAnuncioDeTecnico(item: { anuncioId?: number | null }, anunciosPorId: Map<number, AnuncioDaComissao>): boolean {
  const a = item.anuncioId ? anunciosPorId.get(item.anuncioId) : null;
  return !!a && a.donoTipo === 'TECNICO' && !!a.tecnicoId;
}
