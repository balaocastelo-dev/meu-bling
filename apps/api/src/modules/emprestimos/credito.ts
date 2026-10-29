/**
 * FORMA DE PAGAMENTO "CRÉDITO BANCÁRIO" (Lumicred) — 28/10/2026.
 *
 * Venda: ao lançar as contas da venda, cada parcela paga com crédito bancário vira um empréstimo:
 *   o credor deposita o valor da parcela no banco da forma (Cora) e a loja deve valor + taxa (6% em 30 dias).
 *   O boleto do cliente é a própria conta a receber da parcela.
 *     creditoPagador = CLIENTE (padrão) → o cliente paga direto ao credor ("Cliente pagou direto" abate a dívida)
 *     creditoPagador = LOJA             → o cliente paga a loja e a loja repassa ao credor
 * Compra: sempre a loja paga. O credor deposita no banco da forma, o fornecedor é pago com esse dinheiro
 *   (sai do mesmo banco, no mesmo dia) e o contas a pagar mostra a devolução ao credor com a taxa.
 * Estornar as contas da venda/compra cancela o empréstimo (só sem pagamento ao credor).
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { baixarContaPagar, saldoContaPagar } from '../financeiro/service.js';
import { cancelarEmprestimoTx, criarEmprestimoTx, TIPO_CONTA_COMPENSACAO, type Modalidade } from './service.js';

export const TIPO_CREDITO_BANCARIO = 'CREDITO_BANCARIO';
/** marca do pagamento ao fornecedor feito com o dinheiro do crédito bancário (permite desfazer no estorno) */
export const OBS_PAGO_COM_CREDITO = 'Pago com crédito bancário';
export const TAXA_PADRAO = 6;
export const PRAZO_PADRAO = 30;

type Forma = { id: number; nome: string; tipo: string; taxaPct: number; diasRecebimento: number; contaFinanceiraId: number | null; credorId: number | null };

async function credorDa(tx: Tx, forma: Forma) {
  if (forma.credorId) {
    const c = await tx.contato.findUnique({ where: { id: forma.credorId }, select: { id: true, nome: true } });
    if (c) return c;
  }
  const lumicred = await tx.contato.findFirst({ where: { nome: { contains: 'Lumicred' } }, select: { id: true, nome: true } });
  if (lumicred) return lumicred;
  throw new AppError(`Informe quem empresta o dinheiro (credor) na forma de pagamento "${forma.nome}".`, 422, 'CREDOR_NAO_CONFIGURADO', { link: '/configuracoes/formas-pagamento' });
}

async function contaDa(tx: Tx, forma: Forma) {
  if (forma.contaFinanceiraId) {
    const c = await tx.contaFinanceira.findFirst({ where: { id: forma.contaFinanceiraId, ativo: true, tipo: { not: TIPO_CONTA_COMPENSACAO } }, select: { id: true } });
    if (c) return c.id;
  }
  const padrao = await tx.contaFinanceira.findFirst({ where: { ativo: true, tipo: { notIn: [TIPO_CONTA_COMPENSACAO, 'CAIXA'] } }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }], select: { id: true } });
  if (padrao) return padrao.id;
  throw new AppError(`Informe o banco onde o dinheiro cai na forma de pagamento "${forma.nome}".`, 422, 'SEM_CONTA_FINANCEIRA', { link: '/configuracoes/formas-pagamento' });
}

const taxaDa = (f: Forma) => (f.taxaPct > 0 ? f.taxaPct : TAXA_PADRAO);
const prazoDa = (f: Forma) => (f.diasRecebimento > 0 ? f.diasRecebimento : PRAZO_PADRAO);

/** Cria (ou ajusta) os empréstimos das parcelas da venda pagas com crédito bancário. Idempotente. */
export async function lancarCreditoBancarioVenda(tx: Tx, vendaId: number) {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, include: { parcelas: { include: { formaPagamento: true, contaReceber: true }, orderBy: { numero: 'asc' } } } });
  if (!venda || venda.tipo !== 'PEDIDO') return 0;
  const doCredito = venda.parcelas.filter((p) => p.formaPagamento?.tipo === TIPO_CREDITO_BANCARIO && p.contaReceber && p.contaReceber.situacao !== 'CANCELADO' && p.valor > 0);
  // parcela que deixou de ser crédito bancário: cancela a operação (se ainda não houve pagamento)
  const antigas = await tx.emprestimo.findMany({ where: { vendaId, vendaParcelaId: { not: null }, situacao: { not: 'CANCELADO' } } });
  for (const e of antigas) if (!doCredito.some((p) => p.id === e.vendaParcelaId)) await cancelarEmprestimoTx(tx, e.id);
  let criados = 0;
  for (const p of doCredito) {
    const modalidade: Modalidade = p.creditoPagador === 'LOJA' ? 'REPASSE' : 'DIRETO';
    const existente = antigas.find((e) => e.vendaParcelaId === p.id);
    if (existente) {
      if (existente.modalidade !== modalidade) await tx.emprestimo.update({ where: { id: existente.id }, data: { modalidade } });
      continue;
    }
    const forma = p.formaPagamento as Forma;
    const credor = await credorDa(tx, forma);
    await criarEmprestimoTx(
      tx,
      {
        credorId: credor.id,
        modalidade,
        clienteId: venda.contatoId,
        vendaId: venda.id,
        contaReceberClienteId: p.contaReceber!.id,
        dataOperacao: venda.data,
        valorRecebido: p.valor,
        taxaPct: taxaDa(forma),
        prazoDias: prazoDa(forma),
        parcelas: 1,
        contaFinanceiraId: await contaDa(tx, forma),
        descricao: `Venda nº ${venda.numero}${venda.parcelas.length > 1 ? ` (parcela ${p.numero})` : ''} — crédito bancário`,
        vendaParcelaId: p.id,
      },
      credor.nome,
    );
    criados++;
  }
  return criados;
}

/** Estorno das contas da venda: cancela as operações de crédito bancário (bloqueia se já pagou o credor). */
export async function estornarCreditoBancarioVenda(tx: Tx, vendaId: number) {
  const ops = await tx.emprestimo.findMany({ where: { vendaId, vendaParcelaId: { not: null }, situacao: { not: 'CANCELADO' } } });
  for (const e of ops) await cancelarEmprestimoTx(tx, e.id);
}

/** Compra paga com crédito bancário: cria a operação e paga o fornecedor com o dinheiro do credor. Idempotente. */
export async function lancarCreditoBancarioCompra(tx: Tx, compraId: number) {
  const compra = await tx.compra.findUnique({ where: { id: compraId }, include: { parcelas: { include: { formaPagamento: true, contaPagar: true }, orderBy: { numero: 'asc' } }, fornecedor: { select: { nome: true } } } });
  if (!compra) return 0;
  const doCredito = compra.parcelas.filter((p) => p.formaPagamento?.tipo === TIPO_CREDITO_BANCARIO && p.contaPagar && p.contaPagar.situacao !== 'CANCELADO' && p.valor > 0);
  const antigas = await tx.emprestimo.findMany({ where: { compraId, compraParcelaId: { not: null }, situacao: { not: 'CANCELADO' } } });
  let criados = 0;
  for (const p of doCredito) {
    if (antigas.some((e) => e.compraParcelaId === p.id)) continue;
    const forma = p.formaPagamento as Forma;
    const credor = await credorDa(tx, forma);
    const conta = await contaDa(tx, forma);
    const id = await criarEmprestimoTx(
      tx,
      {
        credorId: credor.id,
        modalidade: 'CAPITAL_GIRO',
        compraId: compra.id,
        dataOperacao: compra.data,
        valorRecebido: p.valor,
        taxaPct: taxaDa(forma),
        prazoDias: prazoDa(forma),
        parcelas: 1,
        contaFinanceiraId: conta,
        descricao: `Compra nº ${compra.numero}${compra.parcelas.length > 1 ? ` (parcela ${p.numero})` : ''} — ${compra.fornecedor?.nome ?? 'fornecedor'}`,
        compraParcelaId: p.id,
      },
      credor.nome,
    );
    const numero = (await tx.emprestimo.findUnique({ where: { id }, select: { numero: true } }))!.numero;
    // o dinheiro do credor paga o fornecedor (sai do mesmo banco, no mesmo dia)
    const cp = await tx.contaPagar.findUnique({ where: { id: p.contaPagar!.id } });
    const saldo = cp && ['ABERTO', 'PARCIAL'].includes(cp.situacao) ? saldoContaPagar(cp) : 0;
    const valor = arredondar(Math.min(saldo, p.valor));
    if (valor >= 0.01) await baixarContaPagar({ id: cp!.id, valor, data: compra.data, contaFinanceiraId: conta, formaPagamentoId: forma.id, observacoes: `${OBS_PAGO_COM_CREDITO} — empréstimo nº ${numero}` }, tx);
    criados++;
  }
  return criados;
}

/** Estorno das contas da compra: desfaz o pagamento ao fornecedor feito com o crédito e cancela a operação. */
export async function estornarCreditoBancarioCompra(tx: Tx, compraId: number) {
  const ops = await tx.emprestimo.findMany({ where: { compraId, compraParcelaId: { not: null }, situacao: { not: 'CANCELADO' } } });
  if (!ops.length) return;
  for (const e of ops) await cancelarEmprestimoTx(tx, e.id); // bloqueia se já pagou o credor
  const cps = await tx.contaPagar.findMany({ where: { origemTipo: 'COMPRA', origemId: compraId } });
  for (const cp of cps) {
    const movs = await tx.movimentoFinanceiro.findMany({ where: { contaPagarId: cp.id, observacoes: { startsWith: OBS_PAGO_COM_CREDITO } } });
    if (!movs.length) continue;
    let pago = cp.valorPago;
    for (const m of movs) {
      await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(m.valor) } } });
      await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
      pago = arredondar(pago - m.valor);
    }
    const zerada = pago < 0.01;
    await tx.contaPagar.update({
      where: { id: cp.id },
      data: {
        valorPago: zerada ? 0 : pago,
        situacao: zerada ? 'ABERTO' : 'PARCIAL',
        dataPagamento: zerada ? null : cp.dataPagamento,
        observacoes: (cp.observacoes || '').split('\n').filter((l) => !l.startsWith(OBS_PAGO_COM_CREDITO)).join('\n') || null,
      },
    });
  }
}

/** Forma "Crédito bancário" ativa (para a compra da finalização da venda). */
export async function formaCreditoBancario(db: Tx | typeof prisma = prisma) {
  return db.formaPagamento.findFirst({ where: { tipo: TIPO_CREDITO_BANCARIO, ativo: true }, orderBy: { id: 'asc' } });
}
