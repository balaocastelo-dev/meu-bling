/**
 * Um CPF/CNPJ é um contato. Cliente e fornecedor são papéis do mesmo cadastro:
 * quem já é um dos dois e passa a ser usado no outro vira AMBOS.
 * Transportadora fica de fora — o enum não junta os três papéis.
 */
import { prisma, type Tx } from '../../lib/prisma.js';

type Db = Tx | typeof prisma;

export type PapelComercial = 'CLIENTE' | 'FORNECEDOR';

/** Papel resultante ao usar o contato como cliente ou como fornecedor. */
export function papelComercial(tipoAtual: string | null | undefined, papel: PapelComercial): 'CLIENTE' | 'FORNECEDOR' | 'AMBOS' {
  if (tipoAtual === 'AMBOS') return 'AMBOS';
  if (tipoAtual === papel) return papel;
  if (tipoAtual === 'CLIENTE' || tipoAtual === 'FORNECEDOR') return 'AMBOS';
  return papel;
}

/**
 * Grava AMBOS quando o contato ainda não tem o papel pedido.
 * Quem já é AMBOS, ou já tem o papel, não é alterado.
 * TRANSPORTADORA não vira AMBOS.
 */
export async function promoverPapel<T extends { id: number; tipo: string }>(db: Db, contato: T, papel: PapelComercial): Promise<T> {
  if (contato.tipo !== 'CLIENTE' && contato.tipo !== 'FORNECEDOR' && contato.tipo !== 'AMBOS') return contato;
  const tipo = papelComercial(contato.tipo, papel);
  if (tipo === contato.tipo) return contato;
  const atualizado = await db.contato.update({ where: { id: contato.id }, data: { tipo } });
  return atualizado as unknown as T;
}
