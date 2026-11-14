/**
 * BANCOS — sincronização Open Finance, importação de transações e sugestões de conciliação.
 */
import { addDays, subDays } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { obterProvedor, type TransacaoOpenFinance } from '../../integracoes/openfinance/index.js';
import { baixarContaReceber, baixarContaPagar, criarMovimentoAvulso, saldoContaPagar, saldoContaReceber } from '../financeiro/service.js';

export interface Sugestao {
  tipo: 'RECEBER' | 'PAGAR';
  id: number;
  descricao: string;
  /** Valor que a conciliação vai baixar. Na quitação é o saldo do título; no parcial, o valor do extrato. */
  valor: number;
  /** Saldo do título no momento da sugestão. */
  saldo: number;
  /** true quando o extrato é menor que o saldo (fora da tolerância de 1%) e a baixa será parcial. */
  parcial: boolean;
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

const PALAVRAS_GENERICAS = new Set(['conta', 'contas', 'pagar', 'receber', 'venda', 'compra', 'parcela', 'boleto', 'pagamento', 'recebimento', 'pix', 'ted', 'doc', 'transferencia']);

function semAcento(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** O extrato cita o contato ou a descrição do título (palavra com 4+ letras, fora do vocabulário genérico). */
function textoCasa(memo: string | null | undefined, descricao: string, contato?: string | null) {
  if (!memo?.trim()) return false;
  const m = semAcento(memo);
  const tokens = [...semAcento(descricao).split(/[^a-z0-9]+/), ...semAcento(contato || '').split(/[^a-z0-9]+/)];
  return tokens.some((p) => p.length >= 4 && !PALAVRAS_GENERICAS.has(p) && m.includes(p));
}

/**
 * Sugestões de conciliação.
 * Quitação: saldo igual (1.0) ou dentro de 1% (0.8), +0.1 se o vencimento está a ±7 dias.
 * Parcial: o débito/crédito é menor que o saldo (fora dessa tolerância) e o título casa
 * pelo texto ou vence em até 15 dias — score abaixo de 1, para não baixar sozinho.
 * Máximo 5.
 */
export async function sugerirConciliacao(t: { valor: number; data: Date; tipo: string; descricao?: string | null }): Promise<Sugestao[]> {
  const alvo = Math.abs(t.valor);
  if (alvo < 0.01) return [];
  const min = alvo * 0.99 - 0.01;
  const max = alvo * 1.01 + 0.01;
  const dentroVenc = (v: Date) => Math.abs(v.getTime() - t.data.getTime()) <= 7 * 86400000;
  const perto = (v: Date) => Math.abs(v.getTime() - t.data.getTime()) <= 15 * 86400000;
  const situacao = { in: ['ABERTO', 'PARCIAL'] as string[] };
  const include = { contato: { select: { nome: true } } } as const;
  const janela = { gte: subDays(t.data, 120), lte: addDays(t.data, 60) };
  const out: Sugestao[] = [];

  const avaliar = (resto: number, id: number, descricao: string, vencimento: Date, contato: string | null | undefined, tipo: 'RECEBER' | 'PAGAR') => {
    if (resto < 0.01) return;
    const quitacao = resto >= min && resto <= max;
    const parcial = resto > max;
    if (!quitacao && !parcial) return;
    if (parcial && !textoCasa(t.descricao, descricao, contato) && !perto(vencimento)) return;
    let score = quitacao ? (Math.abs(resto - alvo) < 0.005 ? 1.0 : 0.8) : 0.45;
    if (!quitacao && textoCasa(t.descricao, descricao, contato)) score += 0.25;
    if (dentroVenc(vencimento)) score += 0.1;
    out.push({
      tipo,
      id,
      descricao,
      valor: quitacao ? resto : arredondar(alvo),
      saldo: resto,
      parcial: !quitacao,
      vencimento,
      contato,
      score: arredondar(score, 2),
    });
  };

  if (t.valor >= 0) {
    const [porValor, porData] = await Promise.all([
      prisma.contaReceber.findMany({ where: { situacao, valor: { gte: min * 0.5, lte: max * 2 } }, include, take: 200 }),
      prisma.contaReceber.findMany({ where: { situacao, vencimento: janela, valor: { gte: alvo * 0.5 } }, include, take: 200 }),
    ]);
    const vistos = new Set<number>();
    for (const c of [...porValor, ...porData]) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      avaliar(saldoContaReceber(c), c.id, c.descricao, c.vencimento, c.contato?.nome, 'RECEBER');
    }
  } else {
    const [porValor, porData] = await Promise.all([
      prisma.contaPagar.findMany({ where: { situacao, valor: { gte: min * 0.5, lte: max * 2 } }, include, take: 200 }),
      prisma.contaPagar.findMany({ where: { situacao, vencimento: janela, valor: { gte: alvo * 0.5 } }, include, take: 200 }),
    ]);
    const vistos = new Set<number>();
    for (const c of [...porValor, ...porData]) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      avaliar(saldoContaPagar(c), c.id, c.descricao, c.vencimento, c.contato?.nome, 'PAGAR');
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
      const resto = saldoContaReceber(conta);
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
