/**
 * BANCOS — sincronização Open Finance, importação de transações e sugestões de conciliação.
 */
import { addDays, subDays } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { obterProvedor, type TransacaoOpenFinance } from '../../integracoes/openfinance/index.js';
import { baixarContaReceber, baixarContaPagar, criarMovimentoAvulso, saldoContaPagar } from '../financeiro/service.js';

export interface Sugestao {
  tipo: 'RECEBER' | 'PAGAR';
  id: number;
  descricao: string;
  valor: number;
  vencimento: Date;
  contato?: string | null;
  score: number;
}

/** Grava (upsert) as transações na conta; devolve quantas são novas. */
export async function gravarTransacoes(
  contaFinanceiraId: number,
  transacoes: { externalId: string; data: Date; descricao: string; valor: number; tipo: string; categoria?: string | null; bruto?: unknown }[],
  fonte: 'OPEN_FINANCE' | 'OFX' | 'MANUAL' | 'EMAIL',
) {
  let novas = 0;
  for (const t of transacoes) {
    const existente = await prisma.transacaoBancaria.findUnique({ where: { contaFinanceiraId_externalId: { contaFinanceiraId, externalId: t.externalId } } });
    if (existente) {
      // atualiza descrição/valor caso o banco tenha corrigido (não mexe em conciliado)
      if (existente.descricao !== t.descricao || Math.abs(existente.valor - t.valor) > 0.005) {
        await prisma.transacaoBancaria.update({ where: { id: existente.id }, data: { descricao: t.descricao, valor: arredondar(t.valor), tipo: t.tipo, data: t.data } });
      }
      continue;
    }
    await prisma.transacaoBancaria.create({
      data: {
        contaFinanceiraId,
        externalId: t.externalId,
        data: t.data,
        descricao: t.descricao,
        valor: arredondar(t.valor),
        tipo: t.tipo,
        categoriaSugerida: t.categoria ?? null,
        fonte,
        dadosBrutos: t.bruto ? JSON.stringify(t.bruto).slice(0, 8000) : null,
      },
    });
    novas += 1;
  }
  return novas;
}

/** Sincroniza saldo + transações de uma conta vinculada ao Open Finance. */
export async function sincronizarConta(contaFinanceiraId: number, dias = 90) {
  const conta = await prisma.contaFinanceira.findUnique({ where: { id: contaFinanceiraId } });
  if (!conta) throw new NotFound('Conta financeira');
  if (!conta.openFinanceAccountId) throw new AppError('Conta não está vinculada ao Open Finance.', 422, 'NAO_VINCULADA');
  const provedor = await obterProvedor();
  try {
    const saldo = await provedor.saldo(conta.openFinanceAccountId);
    const ate = new Date();
    const de = conta.ultimaSincronizacao ? subDays(conta.ultimaSincronizacao, 3) : subDays(ate, dias);
    const transacoes: TransacaoOpenFinance[] = await provedor.transacoes(conta.openFinanceAccountId, de, addDays(ate, 1));
    const novas = await gravarTransacoes(contaFinanceiraId, transacoes, 'OPEN_FINANCE');
    await prisma.contaFinanceira.update({
      where: { id: contaFinanceiraId },
      data: { saldoBanco: arredondar(saldo.saldo), saldoBancoEm: saldo.em, ultimaSincronizacao: new Date(), openFinanceStatus: saldo.status || 'UPDATED' },
    });
    return { saldo: arredondar(saldo.saldo), novasTransacoes: novas, provedor: provedor.nome };
  } catch (e: any) {
    await prisma.contaFinanceira.update({ where: { id: contaFinanceiraId }, data: { openFinanceStatus: 'ERRO: ' + String(e?.message || e).slice(0, 180) } });
    throw new AppError('Falha ao sincronizar com o banco: ' + (e?.message || e), 502, 'OPEN_FINANCE');
  }
}

export async function sincronizarTodas() {
  const contas = await prisma.contaFinanceira.findMany({ where: { ativo: true, openFinanceAccountId: { not: null } } });
  const resultados: { contaFinanceiraId: number; nome: string; ok: boolean; saldo?: number; novasTransacoes?: number; erro?: string }[] = [];
  for (const c of contas) {
    try {
      const r = await sincronizarConta(c.id);
      resultados.push({ contaFinanceiraId: c.id, nome: c.nome, ok: true, saldo: r.saldo, novasTransacoes: r.novasTransacoes });
    } catch (e: any) {
      resultados.push({ contaFinanceiraId: c.id, nome: c.nome, ok: false, erro: e?.message || String(e) });
    }
  }
  return resultados;
}

/**
 * Sugestões de conciliação: contas em aberto com valor igual (1.0) ou ±1% (0.8),
 * +0.1 se vencimento dentro de ±7 dias da transação. Máximo 5.
 */
export async function sugerirConciliacao(t: { valor: number; data: Date; tipo: string }): Promise<Sugestao[]> {
  const alvo = Math.abs(t.valor);
  const min = alvo * 0.99 - 0.01;
  const max = alvo * 1.01 + 0.01;
  const out: Sugestao[] = [];
  const dentroVenc = (v: Date) => Math.abs(v.getTime() - t.data.getTime()) <= 7 * 86400000;
  if (t.valor >= 0) {
    const contas = await prisma.contaReceber.findMany({
      where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, valor: { gte: min * 0.5, lte: max * 2 } },
      include: { contato: { select: { nome: true } } },
      take: 200,
    });
    for (const c of contas) {
      const resto = arredondar(c.valor - c.valorRecebido - c.desconto);
      if (resto < min || resto > max) continue;
      let score = Math.abs(resto - alvo) < 0.005 ? 1.0 : 0.8;
      if (dentroVenc(c.vencimento)) score += 0.1;
      out.push({ tipo: 'RECEBER', id: c.id, descricao: c.descricao, valor: resto, vencimento: c.vencimento, contato: c.contato?.nome, score: arredondar(score, 2) });
    }
  } else {
    const contas = await prisma.contaPagar.findMany({
      where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, valor: { gte: min * 0.5, lte: max * 2 } },
      include: { contato: { select: { nome: true } } },
      take: 200,
    });
    for (const c of contas) {
      const resto = saldoContaPagar(c);
      if (resto < min || resto > max) continue;
      let score = Math.abs(resto - alvo) < 0.005 ? 1.0 : 0.8;
      if (dentroVenc(c.vencimento)) score += 0.1;
      out.push({ tipo: 'PAGAR', id: c.id, descricao: c.descricao, valor: resto, vencimento: c.vencimento, contato: c.contato?.nome, score: arredondar(score, 2) });
    }
  }
  return out.sort((a, b) => b.score - a.score || Math.abs(a.vencimento.getTime() - t.data.getTime()) - Math.abs(b.vencimento.getTime() - t.data.getTime())).slice(0, 5);
}

export async function conciliar(
  transacaoId: number,
  p: { tipo: 'RECEBER' | 'PAGAR' | 'LANCAMENTO'; id?: number | null; categoriaId?: number | null; descricao?: string | null },
) {
  const t = await prisma.transacaoBancaria.findUnique({ where: { id: transacaoId } });
  if (!t) throw new NotFound('Transação bancária');
  if (t.conciliado) throw new AppError('Transação já conciliada.', 422, 'JA_CONCILIADA');
  const valor = Math.abs(t.valor);
  const r = await prisma.$transaction(async (tx: Tx) => {
    let movimentoId: number;
    if (p.tipo === 'RECEBER') {
      if (!p.id) throw new AppError('Informe a conta a receber.', 400, 'VALIDACAO');
      if (t.valor < 0) throw new AppError('Transação de débito não pode baixar conta a receber.', 422, 'TIPO_INCOMPATIVEL');
      const conta = await tx.contaReceber.findUnique({ where: { id: p.id } });
      if (!conta) throw new NotFound('Conta a receber');
      const resto = arredondar(conta.valor - conta.valorRecebido - conta.desconto);
      // diferença pequena (até 1%) vira juros (a mais) ou desconto (a menos)
      const dif = arredondar(valor - resto);
      const r = await baixarContaReceber(
        { id: p.id, valor, data: t.data, contaFinanceiraId: t.contaFinanceiraId, juros: dif > 0 ? dif : 0, desconto: dif < 0 && Math.abs(dif) <= resto * 0.01 ? Math.abs(dif) : 0, transacaoId: t.id, observacoes: `Conciliação bancária: ${t.descricao}` },
        tx,
      );
      movimentoId = r.movimento.id;
    } else if (p.tipo === 'PAGAR') {
      if (!p.id) throw new AppError('Informe a conta a pagar.', 400, 'VALIDACAO');
      if (t.valor > 0) throw new AppError('Transação de crédito não pode baixar conta a pagar.', 422, 'TIPO_INCOMPATIVEL');
      const conta = await tx.contaPagar.findUnique({ where: { id: p.id } });
      if (!conta) throw new NotFound('Conta a pagar');
      const resto = saldoContaPagar(conta);
      const dif = arredondar(valor - resto);
      const r = await baixarContaPagar(
        { id: p.id, valor, data: t.data, contaFinanceiraId: t.contaFinanceiraId, juros: dif > 0 ? dif : 0, desconto: dif < 0 && Math.abs(dif) <= resto * 0.01 ? Math.abs(dif) : 0, transacaoId: t.id, observacoes: `Conciliação bancária: ${t.descricao}` },
        tx,
      );
      movimentoId = r.movimento.id;
    } else {
      const m = await criarMovimentoAvulso(
        {
          contaFinanceiraId: t.contaFinanceiraId,
          data: t.data,
          tipo: t.valor >= 0 ? 'ENTRADA' : 'SAIDA',
          valor,
          descricao: p.descricao || t.descricao,
          categoriaId: p.categoriaId ?? t.categoriaId ?? null,
          transacaoId: t.id,
          observacoes: 'Lançamento via conciliação bancária',
        },
        tx,
      );
      movimentoId = m.id;
    }
    const atualizada = await tx.transacaoBancaria.update({
      where: { id: t.id },
      data: { conciliado: true, categoriaId: p.categoriaId ?? t.categoriaId ?? null },
    });
    return { transacao: atualizada, movimentoId };
  });
  return r;
}
