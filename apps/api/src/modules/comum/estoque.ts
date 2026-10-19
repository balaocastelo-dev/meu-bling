/**
 * Helpers de estoque compartilhados por produtos, vendas, compras e OS.
 * Toda alteração de saldo cria um MovimentoEstoque (com saldoAnterior/saldoPosterior)
 * e atualiza EstoqueSaldo (upsert por produtoId_depositoId).
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';

export type Db = Tx | typeof prisma;

export type TipoMovimento = 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'TRANSFERENCIA';

export interface MovimentoParams {
  produtoId: number;
  depositoId: number;
  tipo: TipoMovimento;
  /** quantidade movimentada (positiva). Para AJUSTE pode ser negativa (delta). */
  quantidade: number;
  custoUnitario?: number;
  origemTipo: string;
  origemId?: number | null;
  observacao?: string | null;
  usuarioId?: number | null;
  /** para tipo AJUSTE: define o saldo final (balanço) */
  saldoNovo?: number;
}

/** Produto movimenta estoque? (apenas tipo P com controle ligado) */
export function movimentaEstoque(p: { tipo: string; controlaEstoque: boolean } | null | undefined): boolean {
  return !!p && p.tipo === 'P' && p.controlaEstoque;
}

/** Depósito padrão (ou o primeiro ativo). */
export async function depositoPadraoId(db: Db = prisma): Promise<number> {
  const d =
    (await db.deposito.findFirst({ where: { padrao: true, ativo: true } })) ||
    (await db.deposito.findFirst({ where: { ativo: true }, orderBy: { id: 'asc' } }));
  if (!d) throw new AppError('Nenhum depósito cadastrado. Cadastre um depósito antes de movimentar estoque.', 422, 'SEM_DEPOSITO');
  return d.id;
}

/**
 * Aplica um movimento de estoque: grava MovimentoEstoque e atualiza o saldo.
 * ENTRADA soma, SAIDA subtrai, AJUSTE com `saldoNovo` define o saldo final
 * (ou aplica `quantidade` como delta), TRANSFERENCIA é tratada pelo chamador
 * como SAIDA na origem + ENTRADA no destino (tipo gravado = TRANSFERENCIA).
 */
export async function movimentarEstoque(tx: Db, p: MovimentoParams) {
  const atual = await tx.estoqueSaldo.findUnique({
    where: { produtoId_depositoId: { produtoId: p.produtoId, depositoId: p.depositoId } },
  });
  const saldoAnterior = atual?.saldo ?? 0;
  let saldoPosterior: number;
  let quantidade = p.quantidade;

  if (p.tipo === 'AJUSTE') {
    if (p.saldoNovo !== undefined && p.saldoNovo !== null) {
      saldoPosterior = p.saldoNovo;
      quantidade = arredondar(saldoPosterior - saldoAnterior, 4);
    } else {
      saldoPosterior = saldoAnterior + quantidade;
    }
  } else if (p.tipo === 'ENTRADA') {
    saldoPosterior = saldoAnterior + Math.abs(quantidade);
  } else {
    // SAIDA / TRANSFERENCIA (saída)
    saldoPosterior = saldoAnterior - Math.abs(quantidade);
  }
  saldoPosterior = arredondar(saldoPosterior, 4);

  await tx.estoqueSaldo.upsert({
    where: { produtoId_depositoId: { produtoId: p.produtoId, depositoId: p.depositoId } },
    create: { produtoId: p.produtoId, depositoId: p.depositoId, saldo: saldoPosterior },
    update: { saldo: saldoPosterior },
  });

  return tx.movimentoEstoque.create({
    data: {
      produtoId: p.produtoId,
      depositoId: p.depositoId,
      tipo: p.tipo,
      quantidade,
      custoUnitario: p.custoUnitario ?? 0,
      saldoAnterior,
      saldoPosterior,
      origemTipo: p.origemTipo,
      origemId: p.origemId ?? null,
      observacao: p.observacao ?? null,
      usuarioId: p.usuarioId ?? null,
    },
  });
}

/** Entrada em um depósito (usada pelas transferências: grava tipo TRANSFERENCIA somando). */
export async function entradaTransferencia(tx: Db, p: Omit<MovimentoParams, 'tipo'>) {
  const atual = await tx.estoqueSaldo.findUnique({
    where: { produtoId_depositoId: { produtoId: p.produtoId, depositoId: p.depositoId } },
  });
  const saldoAnterior = atual?.saldo ?? 0;
  const saldoPosterior = arredondar(saldoAnterior + Math.abs(p.quantidade), 4);
  await tx.estoqueSaldo.upsert({
    where: { produtoId_depositoId: { produtoId: p.produtoId, depositoId: p.depositoId } },
    create: { produtoId: p.produtoId, depositoId: p.depositoId, saldo: saldoPosterior },
    update: { saldo: saldoPosterior },
  });
  return tx.movimentoEstoque.create({
    data: {
      produtoId: p.produtoId,
      depositoId: p.depositoId,
      tipo: 'TRANSFERENCIA',
      quantidade: Math.abs(p.quantidade),
      custoUnitario: p.custoUnitario ?? 0,
      saldoAnterior,
      saldoPosterior,
      origemTipo: p.origemTipo,
      origemId: p.origemId ?? null,
      observacao: p.observacao ?? null,
      usuarioId: p.usuarioId ?? null,
    },
  });
}

/** Ajusta a quantidade reservada (positivo reserva, negativo libera). Nunca fica negativa. */
export async function ajustarReserva(tx: Db, produtoId: number, depositoId: number, delta: number) {
  const atual = await tx.estoqueSaldo.findUnique({ where: { produtoId_depositoId: { produtoId, depositoId } } });
  const reservado = Math.max(0, arredondar((atual?.reservado ?? 0) + delta, 4));
  await tx.estoqueSaldo.upsert({
    where: { produtoId_depositoId: { produtoId, depositoId } },
    create: { produtoId, depositoId, saldo: 0, reservado },
    update: { reservado },
  });
}

/** Soma dos saldos nos depósitos que contam (desconsiderarSaldo=false). */
export async function saldosDoProduto(db: Db, produtoId: number) {
  const saldos = await db.estoqueSaldo.findMany({
    where: { produtoId },
    include: { deposito: { select: { id: true, nome: true, desconsiderarSaldo: true, ativo: true } } },
  });
  const estoqueTotal = arredondar(saldos.filter((s) => !s.deposito.desconsiderarSaldo).reduce((a, s) => a + s.saldo, 0), 4);
  const estoqueReservado = arredondar(saldos.filter((s) => !s.deposito.desconsiderarSaldo).reduce((a, s) => a + s.reservado, 0), 4);
  return { saldos, estoqueTotal, estoqueReservado };
}

/** Calcula estoqueTotal/estoqueReservado para vários produtos de uma vez. */
export async function mapaEstoque(db: Db, produtoIds: number[]) {
  const mapa = new Map<number, { estoqueTotal: number; estoqueReservado: number }>();
  if (!produtoIds.length) return mapa;
  const saldos = await db.estoqueSaldo.findMany({
    where: { produtoId: { in: produtoIds }, deposito: { desconsiderarSaldo: false } },
  });
  for (const s of saldos) {
    const cur = mapa.get(s.produtoId) || { estoqueTotal: 0, estoqueReservado: 0 };
    cur.estoqueTotal = arredondar(cur.estoqueTotal + s.saldo, 4);
    cur.estoqueReservado = arredondar(cur.estoqueReservado + s.reservado, 4);
    mapa.set(s.produtoId, cur);
  }
  return mapa;
}
