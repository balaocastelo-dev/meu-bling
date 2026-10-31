/**
 * NATUREZA DO LANÇAMENTO — ícone e rótulo de "de onde veio" cada movimentação.
 * Usado no extrato da conta e na lista de lançamentos, para as duas telas falarem igual.
 */
import type { ReactNode } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Handshake, Landmark, PiggyBank, Receipt, Scale, ShoppingBag, ShoppingCart, Wrench } from 'lucide-react';

export type NaturezaLancamento =
  | 'VENDA' | 'OS' | 'COMPRA' | 'CONSIGNACAO' | 'EMPRESTIMO' | 'CARNE'
  | 'RECEBIMENTO' | 'PAGAMENTO' | 'TRANSFERENCIA' | 'CAIXINHA' | 'AJUSTE' | 'AVULSO';

export const ICONE_NATUREZA: Record<NaturezaLancamento, ReactNode> = {
  VENDA: <ShoppingCart className="h-4 w-4" />,
  OS: <Wrench className="h-4 w-4" />,
  COMPRA: <ShoppingBag className="h-4 w-4" />,
  CONSIGNACAO: <Handshake className="h-4 w-4" />,
  EMPRESTIMO: <Landmark className="h-4 w-4" />,
  CARNE: <Receipt className="h-4 w-4" />,
  RECEBIMENTO: <ArrowDownLeft className="h-4 w-4" />,
  PAGAMENTO: <ArrowUpRight className="h-4 w-4" />,
  TRANSFERENCIA: <ArrowLeftRight className="h-4 w-4" />,
  CAIXINHA: <PiggyBank className="h-4 w-4" />,
  AJUSTE: <Scale className="h-4 w-4" />,
  AVULSO: <ArrowLeftRight className="h-4 w-4" />,
};

export const ROTULO_NATUREZA: Record<NaturezaLancamento, string> = {
  VENDA: 'Venda',
  OS: 'Assistência',
  COMPRA: 'Compra',
  CONSIGNACAO: 'Consignação',
  EMPRESTIMO: 'Empréstimo',
  CARNE: 'Carnê',
  RECEBIMENTO: 'Recebimento',
  PAGAMENTO: 'Pagamento',
  TRANSFERENCIA: 'Transferência',
  CAIXINHA: 'Caixinha',
  AJUSTE: 'Acerto de saldo',
  AVULSO: 'Avulso',
};
