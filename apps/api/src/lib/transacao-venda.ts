/**
 * Transações de venda (salvar, fechar, estornar, receber na hora).
 *
 * O padrão do Prisma é 5 s. Na loja, com milhares de movimentos e a trilha de
 * auditoria, o fechamento passava disso e a consulta seguinte caía com
 * "Transaction already closed". 20 s é rede de segurança: o trabalho pesado
 * não fica mais dentro da transação.
 */
export const TRANSACAO_VENDA = { maxWait: 10_000, timeout: 20_000 } as const;
