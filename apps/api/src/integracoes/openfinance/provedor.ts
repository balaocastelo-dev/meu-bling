/**
 * Interface comum dos provedores de Open Finance (Pluggy real ou mock).
 * O módulo `bancos` só conversa com esta interface.
 */
export interface ContaOpenFinance {
  id: string;
  itemId: string;
  nome: string;
  /** BANK | CREDIT */
  tipo: string;
  /** CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD */
  subtipo: string;
  numero: string | null;
  saldo: number;
  banco?: string | null;
  agencia?: string | null;
}

export interface TransacaoOpenFinance {
  externalId: string;
  data: Date;
  descricao: string;
  /** positivo = crédito, negativo = débito */
  valor: number;
  tipo: 'CREDITO' | 'DEBITO';
  categoria?: string | null;
  bruto?: unknown;
}

export interface ProvedorOpenFinance {
  nome: string;
  /**
   * Token de curta duração para abrir o widget Pluggy Connect no frontend.
   * Com `itemId`, a Pluggy abre a mesma conexão para reconectar (não cria outra).
   * O client secret nunca sai deste método.
   */
  connectToken(opcoes?: { itemId?: string }): Promise<{ accessToken: string }>;
  contasDoItem(itemId: string): Promise<ContaOpenFinance[]>;
  saldo(accountId: string): Promise<{ saldo: number; em: Date; status?: string }>;
  transacoes(accountId: string, de: Date, ate: Date): Promise<TransacaoOpenFinance[]>;
  /** conectores disponíveis (opcional; só o Pluggy real) */
  conectores?(): Promise<{ id: number; nome: string; tipo: string }[]>;
}
