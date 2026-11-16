/**
 * Marca da compra que o sistema cria sozinho ao finalizar a venda.
 * Fica num módulo comum para vendas/saidas.ts e vendas/service.ts usarem
 * sem import circular (saidas não pode importar o service de vendas).
 */
export const PREFIXO_COMPRA_DA_VENDA = 'Compra registrada ao finalizar a venda nº ';
/** Observação do pagamento lançado quando o vendedor diz, ao finalizar, que a compra já está paga. */
export const PREFIXO_COMPRA_PAGA_AO_FINALIZAR = 'Pago — informado ao finalizar a venda nº ';

export const marcaCompraDaVenda = (numeroVenda: number) => `${PREFIXO_COMPRA_DA_VENDA}${numeroVenda}`;
export const obsCompraPagaAoFinalizar = (numeroVenda: number) => `${PREFIXO_COMPRA_PAGA_AO_FINALIZAR}${numeroVenda}`;

/** Número da venda gravado na observação interna da compra, ou null se o texto não for essa marca. */
export function numeroVendaDaMarcaCompra(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const m = new RegExp(`${PREFIXO_COMPRA_DA_VENDA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)`).exec(texto);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}
