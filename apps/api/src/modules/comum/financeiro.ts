/**
 * Helpers financeiros compartilhados (categorias padrão, estorno de contas,
 * comissões) usados por vendas, compras, OS e comissões.
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';

export type Db = Tx | typeof prisma;

/**
 * Marcadores em `MovimentoFinanceiro.observacoes` para lançamentos que mexem no saldo
 * mas NÃO são receita nem despesa (não entram no DRE nem no caixa dos dashboards):
 * transferência entre contas e ajuste de saldo (acerto com o saldo real).
 */
export const OBS_TRANSFERENCIA = 'TRANSFERENCIA';
export const OBS_AJUSTE_SALDO = 'AJUSTE_SALDO';
export const OBS_FORA_DO_RESULTADO = [OBS_TRANSFERENCIA, OBS_AJUSTE_SALDO];

/** Lê FormaPagamento.contasPermitidas (JSON com ids de contas financeiras). */
export function lerContasPermitidas(v: string | null | undefined): number[] {
  if (!v) return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
}

/** Busca (ou cria) uma categoria financeira padrão pelo nome. */
export async function categoriaPadraoId(
  db: Db,
  nome: string,
  tipo: 'RECEITA' | 'DESPESA',
  grupoDre = tipo === 'RECEITA' ? 'RECEITA_BRUTA' : 'DESPESA_OPERACIONAL',
): Promise<number> {
  const c = await db.categoriaFinanceira.findFirst({ where: { nome } });
  if (c) return c.id;
  const nova = await db.categoriaFinanceira.create({ data: { nome, tipo, grupoDre } });
  return nova.id;
}

/**
 * Cancela as contas a receber de uma origem (VENDA/OS). Se alguma já tiver
 * recebimento (RECEBIDO/PARCIAL) lança 422 pedindo estorno da baixa antes.
 */
export async function cancelarContasReceber(tx: Db, origemTipo: 'VENDA' | 'OS', origemId: number) {
  const contas = await tx.contaReceber.findMany({ where: { origemTipo, origemId } });
  const recebidas = contas.filter((c) => c.situacao === 'RECEBIDO' || c.situacao === 'PARCIAL' || c.valorRecebido > 0);
  if (recebidas.length) {
    throw new AppError(
      `Existem ${recebidas.length} conta(s) a receber já baixada(s) (${recebidas.map((c) => c.descricao).join(', ')}). Estorne o recebimento antes de estornar as contas.`,
      422,
      'CONTA_RECEBIDA',
    );
  }
  await tx.contaReceber.updateMany({
    where: { origemTipo, origemId, situacao: { not: 'CANCELADO' } },
    data: { situacao: 'CANCELADO' },
  });
  return contas.length;
}

/** Idem para contas a pagar (COMPRA). */
export async function cancelarContasPagar(tx: Db, origemTipo: 'COMPRA' | 'COMISSAO', origemId: number) {
  const contas = await tx.contaPagar.findMany({ where: { origemTipo, origemId } });
  const pagas = contas.filter((c) => c.situacao === 'PAGO' || c.situacao === 'PARCIAL' || c.valorPago > 0);
  if (pagas.length) {
    throw new AppError(
      `Existem ${pagas.length} conta(s) a pagar já baixada(s) (${pagas.map((c) => c.descricao).join(', ')}). Estorne o pagamento antes de estornar as contas.`,
      422,
      'CONTA_PAGA',
    );
  }
  await tx.contaPagar.updateMany({
    where: { origemTipo, origemId, situacao: { not: 'CANCELADO' } },
    data: { situacao: 'CANCELADO' },
  });
  return contas.length;
}

export interface ComissaoNova {
  tipo: 'VENDEDOR' | 'TECNICO';
  vendedorId?: number | null;
  tecnicoId?: number | null;
  descricao: string;
  base: number;
  pct: number;
  valor: number;
  /** pagamento extra de um anúncio da vitrine da equipe (docs/VITRINE-EQUIPE.md) */
  anuncioId?: number | null;
}

/**
 * (Re)cria as comissões de uma origem. Comissões PAGAS nunca são tocadas:
 * se existir alguma → erro 422. As demais são excluídas e recriadas.
 */
export async function recriarComissoes(
  tx: Db,
  origem: { origemTipo: 'VENDA' | 'OS'; vendaId?: number; osId?: number },
  competencia: string,
  novas: ComissaoNova[],
) {
  const where = origem.origemTipo === 'VENDA' ? { origemTipo: 'VENDA', vendaId: origem.vendaId } : { origemTipo: 'OS', osId: origem.osId };
  const existentes = await tx.comissao.findMany({ where });
  if (existentes.some((c) => c.status === 'PAGA')) {
    throw new AppError('Já existem comissões PAGAS para este registro; não é possível recalculá-las.', 422, 'COMISSAO_PAGA');
  }
  await tx.comissao.deleteMany({ where });
  const criadas = [];
  for (const n of novas) {
    if (n.valor <= 0) continue;
    criadas.push(
      await tx.comissao.create({
        data: {
          tipo: n.tipo,
          vendedorId: n.vendedorId ?? null,
          tecnicoId: n.tecnicoId ?? null,
          origemTipo: origem.origemTipo,
          vendaId: origem.vendaId ?? null,
          osId: origem.osId ?? null,
          descricao: n.descricao,
          base: arredondar(n.base),
          pct: n.pct,
          valor: arredondar(n.valor),
          anuncioId: n.anuncioId ?? null,
          status: 'PENDENTE',
          competencia,
        },
      }),
    );
  }
  return criadas;
}

/** Cancela comissões não pagas de uma origem (PAGA → erro 422). */
export async function cancelarComissoes(tx: Db, origem: { origemTipo: 'VENDA' | 'OS'; vendaId?: number; osId?: number }) {
  const where = origem.origemTipo === 'VENDA' ? { origemTipo: 'VENDA', vendaId: origem.vendaId } : { origemTipo: 'OS', osId: origem.osId };
  const existentes = await tx.comissao.findMany({ where });
  if (existentes.some((c) => c.status === 'PAGA')) {
    throw new AppError('Existem comissões já PAGAS para este registro; estorne o pagamento da comissão antes de cancelar.', 422, 'COMISSAO_PAGA');
  }
  await tx.comissao.updateMany({ where: { ...where, status: { not: 'CANCELADA' } }, data: { status: 'CANCELADA' } });
}
