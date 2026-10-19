/**
 * FINANCEIRO — regras de negócio de baixa/estorno de contas, resumo e fluxo de caixa.
 *
 * Baixa = cria `MovimentoFinanceiro` (ENTRADA p/ receber, SAIDA p/ pagar) ligado à conta
 * e atualiza `ContaFinanceira.saldoAtual` na mesma transação.
 * Estorno = apaga os movimentos da conta, reverte o saldo e volta a conta para ABERTO.
 *
 * As funções `baixarContaReceber`/`baixarContaPagar` são reutilizadas pela conciliação
 * bancária (módulo bancos), que passa o `transacaoId` para ligar o movimento à transação.
 */
import { startOfDay, endOfDay, addDays } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';

export interface BaixaParams {
  id: number;
  valor: number;
  data: Date;
  contaFinanceiraId: number;
  formaPagamentoId?: number | null;
  juros?: number;
  desconto?: number;
  observacoes?: string | null;
  /** transação bancária que originou a baixa (conciliação) */
  transacaoId?: number | null;
}

const SITUACOES_ABERTAS = ['ABERTO', 'PARCIAL'];

// ---------------------------------------------------------------------
// Baixa de contas a receber
// ---------------------------------------------------------------------
async function baixarReceberTx(tx: Tx, p: BaixaParams) {
  const conta = await tx.contaReceber.findUnique({ where: { id: p.id } });
  if (!conta) throw new NotFound('Conta a receber');
  if (!SITUACOES_ABERTAS.includes(conta.situacao)) {
    throw new AppError(`Conta a receber está "${conta.situacao}" e não pode ser baixada.`, 422, 'SITUACAO_INVALIDA');
  }
  if (p.valor <= 0) throw new AppError('Valor da baixa deve ser maior que zero.', 422, 'VALOR_INVALIDO');
  const contaFin = await tx.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
  if (!contaFin) throw new NotFound('Conta financeira');

  const juros = arredondar(p.juros || 0);
  const desconto = arredondar(p.desconto || 0);
  const valorRecebido = arredondar(conta.valorRecebido + p.valor);
  const descontoTotal = arredondar(conta.desconto + desconto);
  const quitada = valorRecebido + descontoTotal >= conta.valor - 0.005;

  const movimento = await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: p.contaFinanceiraId,
      data: p.data,
      tipo: 'ENTRADA',
      valor: arredondar(p.valor),
      descricao: `Recebimento: ${conta.descricao}`,
      categoriaId: conta.categoriaId,
      contaReceberId: conta.id,
      transacaoId: p.transacaoId ?? null,
      conciliado: !!p.transacaoId,
      observacoes: p.observacoes ?? null,
    },
  });
  await tx.contaFinanceira.update({ where: { id: p.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(p.valor) } } });

  const atualizada = await tx.contaReceber.update({
    where: { id: conta.id },
    data: {
      valorRecebido,
      juros: arredondar(conta.juros + juros),
      desconto: descontoTotal,
      situacao: quitada ? 'RECEBIDO' : 'PARCIAL',
      dataRecebimento: quitada ? p.data : conta.dataRecebimento,
      contaFinanceiraId: p.contaFinanceiraId,
      formaPagamentoId: p.formaPagamentoId ?? conta.formaPagamentoId,
      observacoes: p.observacoes ? [conta.observacoes, p.observacoes].filter(Boolean).join('\n') : conta.observacoes,
    },
  });
  return { conta: atualizada, movimento, quitada };
}

export async function baixarContaReceber(p: BaixaParams, txExterno?: Tx) {
  if (txExterno) return baixarReceberTx(txExterno, p);
  const r = await prisma.$transaction((tx) => baixarReceberTx(tx, p));
  if (r.quitada) eventos.emitir('conta.recebida', { contaReceberId: r.conta.id });
  return r;
}

// ---------------------------------------------------------------------
// Baixa de contas a pagar
// ---------------------------------------------------------------------
async function baixarPagarTx(tx: Tx, p: BaixaParams) {
  const conta = await tx.contaPagar.findUnique({ where: { id: p.id } });
  if (!conta) throw new NotFound('Conta a pagar');
  if (!SITUACOES_ABERTAS.includes(conta.situacao)) {
    throw new AppError(`Conta a pagar está "${conta.situacao}" e não pode ser baixada.`, 422, 'SITUACAO_INVALIDA');
  }
  if (p.valor <= 0) throw new AppError('Valor da baixa deve ser maior que zero.', 422, 'VALOR_INVALIDO');
  const contaFin = await tx.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
  if (!contaFin) throw new NotFound('Conta financeira');

  const juros = arredondar(p.juros || 0);
  const desconto = arredondar(p.desconto || 0);
  const valorPago = arredondar(conta.valorPago + p.valor);
  const descontoTotal = arredondar(conta.desconto + desconto);
  const quitada = valorPago + descontoTotal >= conta.valor - 0.005;

  const movimento = await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: p.contaFinanceiraId,
      data: p.data,
      tipo: 'SAIDA',
      valor: arredondar(p.valor),
      descricao: `Pagamento: ${conta.descricao}`,
      categoriaId: conta.categoriaId,
      contaPagarId: conta.id,
      transacaoId: p.transacaoId ?? null,
      conciliado: !!p.transacaoId,
      observacoes: p.observacoes ?? null,
    },
  });
  await tx.contaFinanceira.update({ where: { id: p.contaFinanceiraId }, data: { saldoAtual: { decrement: arredondar(p.valor) } } });

  const atualizada = await tx.contaPagar.update({
    where: { id: conta.id },
    data: {
      valorPago,
      juros: arredondar(conta.juros + juros),
      desconto: descontoTotal,
      situacao: quitada ? 'PAGO' : 'PARCIAL',
      dataPagamento: quitada ? p.data : conta.dataPagamento,
      contaFinanceiraId: p.contaFinanceiraId,
      formaPagamentoId: p.formaPagamentoId ?? conta.formaPagamentoId,
      observacoes: p.observacoes ? [conta.observacoes, p.observacoes].filter(Boolean).join('\n') : conta.observacoes,
    },
  });
  return { conta: atualizada, movimento, quitada };
}

export async function baixarContaPagar(p: BaixaParams, txExterno?: Tx) {
  if (txExterno) return baixarPagarTx(txExterno, p);
  const r = await prisma.$transaction((tx) => baixarPagarTx(tx, p));
  if (r.quitada) eventos.emitir('conta.paga', { contaPagarId: r.conta.id });
  return r;
}

// ---------------------------------------------------------------------
// Estornos
// ---------------------------------------------------------------------
/** Apaga os movimentos ligados à conta, reverte saldos e libera transações conciliadas. */
async function removerMovimentos(tx: Tx, where: { contaReceberId?: number; contaPagarId?: number }) {
  const movs = await tx.movimentoFinanceiro.findMany({ where });
  for (const m of movs) {
    const delta = m.tipo === 'ENTRADA' ? -m.valor : m.valor;
    await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(delta) } } });
    if (m.transacaoId) {
      await tx.transacaoBancaria.update({ where: { id: m.transacaoId }, data: { conciliado: false } });
    }
    await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
  }
  return movs.length;
}

export async function estornarContaReceber(id: number) {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.contaReceber.findUnique({ where: { id } });
    if (!conta) throw new NotFound('Conta a receber');
    if (!['RECEBIDO', 'PARCIAL'].includes(conta.situacao)) {
      throw new AppError('A conta não possui baixa para estornar.', 422, 'SEM_BAIXA');
    }
    const qtd = await removerMovimentos(tx, { contaReceberId: id });
    const atualizada = await tx.contaReceber.update({
      where: { id },
      data: { valorRecebido: 0, juros: 0, desconto: 0, situacao: 'ABERTO', dataRecebimento: null },
    });
    return { conta: atualizada, movimentosEstornados: qtd };
  });
}

export async function estornarContaPagar(id: number) {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.contaPagar.findUnique({ where: { id } });
    if (!conta) throw new NotFound('Conta a pagar');
    if (!['PAGO', 'PARCIAL'].includes(conta.situacao)) {
      throw new AppError('A conta não possui baixa para estornar.', 422, 'SEM_BAIXA');
    }
    const qtd = await removerMovimentos(tx, { contaPagarId: id });
    const atualizada = await tx.contaPagar.update({
      where: { id },
      data: { valorPago: 0, juros: 0, desconto: 0, situacao: 'ABERTO', dataPagamento: null },
    });
    return { conta: atualizada, movimentosEstornados: qtd };
  });
}

// ---------------------------------------------------------------------
// Movimentos avulsos / transferência
// ---------------------------------------------------------------------
export async function criarMovimentoAvulso(
  p: { contaFinanceiraId: number; data: Date; tipo: 'ENTRADA' | 'SAIDA'; valor: number; descricao: string; categoriaId?: number | null; transacaoId?: number | null; observacoes?: string | null },
  txExterno?: Tx,
) {
  const exec = async (tx: Tx) => {
    if (p.valor <= 0) throw new AppError('Valor deve ser maior que zero.', 422, 'VALOR_INVALIDO');
    const conta = await tx.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
    if (!conta) throw new NotFound('Conta financeira');
    const mov = await tx.movimentoFinanceiro.create({
      data: {
        contaFinanceiraId: p.contaFinanceiraId,
        data: p.data,
        tipo: p.tipo,
        valor: arredondar(p.valor),
        descricao: p.descricao,
        categoriaId: p.categoriaId ?? null,
        transacaoId: p.transacaoId ?? null,
        conciliado: !!p.transacaoId,
        observacoes: p.observacoes ?? null,
      },
    });
    const delta = p.tipo === 'ENTRADA' ? p.valor : -p.valor;
    await tx.contaFinanceira.update({ where: { id: p.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(delta) } } });
    return mov;
  };
  return txExterno ? exec(txExterno) : prisma.$transaction(exec);
}

export async function transferirEntreContas(p: { origemId: number; destinoId: number; valor: number; data: Date; descricao?: string | null }) {
  if (p.origemId === p.destinoId) throw new AppError('Conta de origem e destino devem ser diferentes.', 422, 'CONTAS_IGUAIS');
  return prisma.$transaction(async (tx) => {
    const origem = await tx.contaFinanceira.findUnique({ where: { id: p.origemId } });
    const destino = await tx.contaFinanceira.findUnique({ where: { id: p.destinoId } });
    if (!origem || !destino) throw new NotFound('Conta financeira');
    const desc = p.descricao || 'Transferência entre contas';
    const saida = await criarMovimentoAvulso(
      { contaFinanceiraId: origem.id, data: p.data, tipo: 'SAIDA', valor: p.valor, descricao: `${desc} → ${destino.nome}`, observacoes: 'TRANSFERENCIA' },
      tx,
    );
    const entrada = await criarMovimentoAvulso(
      { contaFinanceiraId: destino.id, data: p.data, tipo: 'ENTRADA', valor: p.valor, descricao: `${desc} ← ${origem.nome}`, observacoes: 'TRANSFERENCIA' },
      tx,
    );
    return { saida, entrada };
  });
}

export async function excluirMovimento(id: number) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.movimentoFinanceiro.findUnique({ where: { id } });
    if (!m) throw new NotFound('Movimento');
    if (m.contaReceberId || m.contaPagarId) {
      throw new AppError('Este movimento é uma baixa de conta. Use o estorno da conta para desfazê-lo.', 422, 'MOVIMENTO_DE_BAIXA');
    }
    const delta = m.tipo === 'ENTRADA' ? -m.valor : m.valor;
    await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(delta) } } });
    if (m.transacaoId) await tx.transacaoBancaria.update({ where: { id: m.transacaoId }, data: { conciliado: false } });
    await tx.movimentoFinanceiro.delete({ where: { id } });
    return m;
  });
}

// ---------------------------------------------------------------------
// Resumo financeiro (usado também pelo dashboard)
// ---------------------------------------------------------------------
export async function resumoFinanceiro() {
  const hoje = new Date();
  const ini = startOfDay(hoje);
  const fim = endOfDay(hoje);
  const fimSemana = endOfDay(addDays(hoje, 6));

  const contas = await prisma.contaFinanceira.findMany({
    where: { ativo: true },
    orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, tipo: true, saldoAtual: true, saldoBanco: true, saldoBancoEm: true, cor: true, openFinanceStatus: true },
  });
  const saldoTotal = arredondar(contas.reduce((s, c) => s + c.saldoAtual, 0));

  const abertasCR = await prisma.contaReceber.findMany({
    where: { situacao: { in: SITUACOES_ABERTAS }, vencimento: { lte: fimSemana } },
    select: { valor: true, valorRecebido: true, desconto: true, vencimento: true },
  });
  const abertasCP = await prisma.contaPagar.findMany({
    where: { situacao: { in: SITUACOES_ABERTAS }, vencimento: { lte: fimSemana } },
    select: { valor: true, valorPago: true, desconto: true, vencimento: true },
  });
  const restCR = (c: { valor: number; valorRecebido: number; desconto: number }) => Math.max(0, c.valor - c.valorRecebido - c.desconto);
  const restCP = (c: { valor: number; valorPago: number; desconto: number }) => Math.max(0, c.valor - c.valorPago - c.desconto);
  const soma = (xs: number[]) => arredondar(xs.reduce((a, b) => a + b, 0));

  return {
    saldoContas: contas,
    saldoTotal,
    receberHoje: soma(abertasCR.filter((c) => c.vencimento >= ini && c.vencimento <= fim).map(restCR)),
    receberSemana: soma(abertasCR.filter((c) => c.vencimento >= ini).map(restCR)),
    receberAtrasado: soma(abertasCR.filter((c) => c.vencimento < ini).map(restCR)),
    pagarHoje: soma(abertasCP.filter((c) => c.vencimento >= ini && c.vencimento <= fim).map(restCP)),
    pagarSemana: soma(abertasCP.filter((c) => c.vencimento >= ini).map(restCP)),
    pagarAtrasado: soma(abertasCP.filter((c) => c.vencimento < ini).map(restCP)),
  };
}

/** Busca número da origem (venda/OS/compra) para exibir nas listagens. */
export async function mapaOrigens(contas: { origemTipo: string; origemId: number | null }[]) {
  const ids = (tipo: string) => [...new Set(contas.filter((c) => c.origemTipo === tipo && c.origemId).map((c) => c.origemId as number))];
  const [vendas, ordens, compras, notas] = await Promise.all([
    ids('VENDA').length ? prisma.venda.findMany({ where: { id: { in: ids('VENDA') } }, select: { id: true, numero: true } }) : [],
    ids('OS').length ? prisma.ordemServico.findMany({ where: { id: { in: ids('OS') } }, select: { id: true, numero: true } }) : [],
    ids('COMPRA').length ? prisma.compra.findMany({ where: { id: { in: ids('COMPRA') } }, select: { id: true, numero: true } }) : [],
    ids('NFE').length ? prisma.notaFiscal.findMany({ where: { id: { in: ids('NFE') } }, select: { id: true, numero: true } }) : [],
  ]);
  const mapa = new Map<string, number>();
  vendas.forEach((v) => mapa.set(`VENDA:${v.id}`, v.numero));
  ordens.forEach((o) => mapa.set(`OS:${o.id}`, o.numero));
  compras.forEach((c) => mapa.set(`COMPRA:${c.id}`, c.numero));
  notas.forEach((n) => mapa.set(`NFE:${n.id}`, n.numero));
  return (c: { origemTipo: string; origemId: number | null }) =>
    c.origemId ? { tipo: c.origemTipo, id: c.origemId, numero: mapa.get(`${c.origemTipo}:${c.origemId}`) ?? null } : { tipo: c.origemTipo, id: null, numero: null };
}
