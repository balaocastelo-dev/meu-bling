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
import { OBS_AJUSTE_SALDO, OBS_TRANSFERENCIA } from '../comum/financeiro.js';

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

/**
 * Saldo em aberto de uma conta. `valorPago`/`valorRecebido` é o dinheiro que efetivamente saiu/entrou
 * (inclui juros), então o principal já abatido é `pago - juros`:
 *   saldo = valor - (pago - juros) - desconto
 */
export function saldoContaPagar(c: { valor: number; valorPago: number; juros: number; desconto: number }) {
  return Math.max(0, arredondar(c.valor + c.juros - c.valorPago - c.desconto));
}
/** Principal já abatido: o dinheiro que saiu, sem os juros, mais o desconto concedido. */
export function principalJaPago(c: { valorPago: number; juros: number; desconto: number }) {
  return arredondar(c.valorPago - c.juros + c.desconto);
}
export function saldoContaReceber(c: { valor: number; valorRecebido: number; juros: number; desconto: number }) {
  return Math.max(0, arredondar(c.valor + c.juros - c.valorRecebido - c.desconto));
}
const TOLERANCIA = 0.009;

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
  const saldoAntes = saldoContaReceber(conta);
  const abatido = arredondar(p.valor - juros + desconto);
  if (abatido > saldoAntes + TOLERANCIA) {
    throw new AppError(
      `Valor maior que o saldo em aberto (R$ ${saldoAntes.toFixed(2).replace('.', ',')}). Se recebeu a mais por juros/multa, informe a diferença no campo "Juros / multa".`,
      422,
      'VALOR_ACIMA_DO_SALDO',
    );
  }
  const valorRecebido = arredondar(conta.valorRecebido + p.valor);
  const jurosTotal = arredondar(conta.juros + juros);
  const descontoTotal = arredondar(conta.desconto + desconto);
  const quitada = saldoContaReceber({ valor: conta.valor, valorRecebido, juros: jurosTotal, desconto: descontoTotal }) <= TOLERANCIA;

  const movimento = await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: p.contaFinanceiraId,
      data: p.data,
      tipo: 'ENTRADA',
      valor: arredondar(p.valor),
      juros,
      desconto,
      descricao: `${quitada ? 'Recebimento' : 'Recebimento parcial'}: ${conta.descricao}`,
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
      juros: jurosTotal,
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
  const saldoAntes = saldoContaPagar(conta);
  // principal abatido por esta baixa = dinheiro que saiu - juros + desconto
  const abatido = arredondar(p.valor - juros + desconto);
  if (abatido > saldoAntes + TOLERANCIA) {
    throw new AppError(
      `Valor maior que o saldo em aberto (R$ ${saldoAntes.toFixed(2).replace('.', ',')}). Se pagou a mais por juros/multa, informe a diferença no campo "Juros / multa".`,
      422,
      'VALOR_ACIMA_DO_SALDO',
    );
  }
  const valorPago = arredondar(conta.valorPago + p.valor);
  const jurosTotal = arredondar(conta.juros + juros);
  const descontoTotal = arredondar(conta.desconto + desconto);
  const quitada = saldoContaPagar({ valor: conta.valor, valorPago, juros: jurosTotal, desconto: descontoTotal }) <= TOLERANCIA;

  const movimento = await tx.movimentoFinanceiro.create({
    data: {
      contaFinanceiraId: p.contaFinanceiraId,
      data: p.data,
      tipo: 'SAIDA',
      valor: arredondar(p.valor),
      juros,
      desconto,
      descricao: `${quitada ? 'Pagamento' : 'Pagamento parcial'}: ${conta.descricao}`,
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
      juros: jurosTotal,
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

/**
 * Estorna UM pagamento (baixa parcial ou total) de uma conta a pagar, mantendo os demais.
 * Reverte o saldo da conta financeira, libera a transação conciliada e recalcula
 * valor pago / juros / desconto / situação a partir dos pagamentos que sobraram.
 */
export async function estornarPagamentoContaPagar(contaId: number, movimentoId: number) {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.contaPagar.findUnique({ where: { id: contaId } });
    if (!conta) throw new NotFound('Conta a pagar');
    const mov = await tx.movimentoFinanceiro.findUnique({ where: { id: movimentoId } });
    if (!mov || mov.contaPagarId !== contaId) throw new NotFound('Pagamento desta conta');

    await tx.contaFinanceira.update({ where: { id: mov.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(mov.valor) } } });
    if (mov.transacaoId) await tx.transacaoBancaria.update({ where: { id: mov.transacaoId }, data: { conciliado: false } });
    await tx.movimentoFinanceiro.delete({ where: { id: mov.id } });

    // Tira só o que este pagamento somou (contas vindas do Bling podem ter valor pago sem movimento)
    const valorPago = Math.max(0, arredondar(conta.valorPago - mov.valor));
    const juros = Math.max(0, arredondar(conta.juros - mov.juros));
    const desconto = Math.max(0, arredondar(conta.desconto - mov.desconto));
    const semBaixa = valorPago <= TOLERANCIA && desconto <= TOLERANCIA;
    const quitada = !semBaixa && saldoContaPagar({ valor: conta.valor, valorPago, juros, desconto }) <= TOLERANCIA;
    const ultimo = await tx.movimentoFinanceiro.findFirst({ where: { contaPagarId: contaId }, orderBy: { data: 'desc' } });

    const atualizada = await tx.contaPagar.update({
      where: { id: contaId },
      data: {
        valorPago: semBaixa ? 0 : valorPago,
        juros: semBaixa ? 0 : juros,
        desconto: semBaixa ? 0 : desconto,
        situacao: semBaixa ? 'ABERTO' : quitada ? 'PAGO' : 'PARCIAL',
        dataPagamento: quitada ? ultimo?.data ?? conta.dataPagamento : null,
      },
    });
    return { conta: atualizada, movimentoEstornado: mov };
  });
}

// ---------------------------------------------------------------------
// Edição de conta a pagar
// ---------------------------------------------------------------------
/** Título cujo valor e vencimento só mudam no documento que o gerou. */
const ORIGEM_NO_DOCUMENTO = new Set(['COMPRA', 'COMISSAO', 'EMPRESTIMO']);

export interface AlteracaoContaPagar {
  contatoId?: number | null;
  descricao?: string;
  dataEmissao?: Date | null;
  vencimento?: Date | null;
  competencia?: string | null;
  valor?: number;
  formaPagamentoId?: number | null;
  contaFinanceiraId?: number | null;
  categoriaId?: number | null;
  observacoes?: string | null;
  recorrente?: boolean;
}

function diaLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function reais(v: number): string {
  return `R$ ${arredondar(v).toFixed(2).replace('.', ',')}`;
}

function nomeOrigem(tipo: string): string {
  if (tipo === 'COMPRA') return 'compra';
  if (tipo === 'COMISSAO') return 'comissão';
  if (tipo === 'EMPRESTIMO') return 'empréstimo';
  return 'documento de origem';
}

/**
 * Altera uma conta a pagar conforme a situação.
 * Pagamentos já lançados não mudam de conta financeira nem de categoria:
 * `contaFinanceiraId` e `categoriaId` valem para o título (e para baixas futuras).
 *
 * - ABERTO: edita tudo; o saldo acompanha o novo valor.
 * - PARCIAL: descrição, fornecedor, categoria, competência, observação, forma,
 *   recorrência, vencimento e conta financeira padrão. O valor pode subir
 *   (continua PARCIAL) ou descer até o principal já pago; se o saldo zera, fica PAGO.
 * - PAGO: só descrição, observação, fornecedor e categoria do título.
 * - CANCELADO: nada.
 * - Origem COMPRA, COMISSAO ou EMPRESTIMO: valor e vencimento ficam no documento de origem.
 */
export async function alterarContaPagar(id: number, entrada: AlteracaoContaPagar) {
  return prisma.$transaction(async (tx) => {
    const atual = await tx.contaPagar.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Conta a pagar');
    if (atual.situacao === 'CANCELADO') throw new AppError('Conta cancelada não pode ser alterada.', 422, 'SITUACAO_INVALIDA');

    const descricao = entrada.descricao !== undefined && entrada.descricao !== atual.descricao ? entrada.descricao : undefined;
    const observacoes = entrada.observacoes !== undefined && (entrada.observacoes ?? null) !== (atual.observacoes ?? null) ? entrada.observacoes : undefined;
    const contatoId = entrada.contatoId !== undefined && (entrada.contatoId ?? null) !== (atual.contatoId ?? null) ? entrada.contatoId : undefined;
    const categoriaId = entrada.categoriaId !== undefined && (entrada.categoriaId ?? null) !== (atual.categoriaId ?? null) ? entrada.categoriaId : undefined;
    const competencia = entrada.competencia !== undefined && (entrada.competencia ?? null) !== (atual.competencia ?? null) ? entrada.competencia : undefined;
    const formaPagamentoId = entrada.formaPagamentoId !== undefined && (entrada.formaPagamentoId ?? null) !== (atual.formaPagamentoId ?? null) ? entrada.formaPagamentoId : undefined;
    const contaFinanceiraId = entrada.contaFinanceiraId !== undefined && (entrada.contaFinanceiraId ?? null) !== (atual.contaFinanceiraId ?? null) ? entrada.contaFinanceiraId : undefined;
    const recorrente = entrada.recorrente !== undefined && entrada.recorrente !== atual.recorrente ? entrada.recorrente : undefined;
    const dataEmissao = entrada.dataEmissao !== undefined && (entrada.dataEmissao === null || diaLocal(entrada.dataEmissao) !== diaLocal(atual.dataEmissao)) ? entrada.dataEmissao : undefined;
    const vencimento = entrada.vencimento !== undefined && (entrada.vencimento === null || diaLocal(entrada.vencimento) !== diaLocal(atual.vencimento)) ? entrada.vencimento : undefined;
    const valor = entrada.valor !== undefined && arredondar(entrada.valor) !== arredondar(atual.valor) ? arredondar(entrada.valor) : undefined;

    const mudou = {
      descricao: descricao !== undefined,
      observacoes: observacoes !== undefined,
      contatoId: contatoId !== undefined,
      categoriaId: categoriaId !== undefined,
      competencia: competencia !== undefined,
      formaPagamentoId: formaPagamentoId !== undefined,
      contaFinanceiraId: contaFinanceiraId !== undefined,
      recorrente: recorrente !== undefined,
      dataEmissao: dataEmissao !== undefined,
      vencimento: vencimento !== undefined,
      valor: valor !== undefined,
    };
    const alterados = (Object.keys(mudou) as (keyof typeof mudou)[]).filter((k) => mudou[k]);
    if (!alterados.length) return atual;

    if ((mudou.valor || mudou.vencimento) && ORIGEM_NO_DOCUMENTO.has(atual.origemTipo)) {
      throw new AppError(`Valor e vencimento deste título se editam na ${nomeOrigem(atual.origemTipo)} de origem.`, 422, 'ORIGEM_DOCUMENTO');
    }

    const foraDoTexto = mudou.competencia || mudou.formaPagamentoId || mudou.contaFinanceiraId || mudou.recorrente || mudou.dataEmissao;
    if (atual.situacao === 'PAGO' && (mudou.valor || mudou.vencimento)) {
      throw new AppError('Valor e vencimento ficam bloqueados até estornar a baixa.', 422, 'JA_BAIXADA');
    }
    if (atual.situacao === 'PAGO' && foraDoTexto) {
      throw new AppError('Conta paga só permite alterar descrição, observação, fornecedor e categoria.', 422, 'SITUACAO_INVALIDA');
    }
    if (atual.situacao === 'PARCIAL' && mudou.dataEmissao) {
      throw new AppError('Conta parcial não permite alterar a data de emissão.', 422, 'SITUACAO_INVALIDA');
    }

    if (mudou.vencimento && !vencimento) throw new AppError('Informe o vencimento.', 422, 'VALIDACAO');
    if (mudou.dataEmissao && !dataEmissao) throw new AppError('Informe a data de emissão.', 422, 'VALIDACAO');
    if (mudou.valor && !(valor! > 0)) throw new AppError('Valor deve ser maior que zero.', 422, 'VALOR_INVALIDO');

    let situacao = atual.situacao;
    let dataPagamento: Date | undefined;
    if (atual.situacao === 'PARCIAL' && mudou.valor) {
      const piso = principalJaPago(atual);
      if (valor! < piso) {
        throw new AppError(
          `O novo valor (${reais(valor!)}) fica abaixo do principal já pago (${reais(piso)}). Estorne a baixa excedente antes de reduzir o título.`,
          422,
          'VALOR_ABAIXO_DO_PAGO',
        );
      }
      // saldo = valor − principal já pago; zerou, a conta está quitada
      if (saldoContaPagar({ valor: valor!, valorPago: atual.valorPago, juros: atual.juros, desconto: atual.desconto }) <= TOLERANCIA) {
        situacao = 'PAGO';
        if (!atual.dataPagamento) {
          const ultimo = await tx.movimentoFinanceiro.findFirst({ where: { contaPagarId: id }, orderBy: { data: 'desc' }, select: { data: true } });
          dataPagamento = ultimo?.data ?? new Date();
        }
      }
    }

    return tx.contaPagar.update({
      where: { id },
      data: {
        ...(descricao !== undefined ? { descricao } : {}),
        ...(observacoes !== undefined ? { observacoes } : {}),
        ...(contatoId !== undefined ? { contatoId } : {}),
        ...(categoriaId !== undefined ? { categoriaId } : {}),
        ...(competencia !== undefined ? { competencia } : {}),
        ...(formaPagamentoId !== undefined ? { formaPagamentoId } : {}),
        ...(contaFinanceiraId !== undefined ? { contaFinanceiraId } : {}),
        ...(recorrente !== undefined ? { recorrente } : {}),
        ...(dataEmissao ? { dataEmissao } : {}),
        ...(vencimento ? { vencimento } : {}),
        ...(valor !== undefined ? { valor } : {}),
        ...(situacao !== atual.situacao ? { situacao, ...(dataPagamento ? { dataPagamento } : {}) } : {}),
      },
    });
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

/**
 * Acerta o saldo de uma conta com o valor real (contado na gaveta / extrato do banco).
 * Lança só a diferença, marcada como AJUSTE_SALDO: mexe no saldo, mas não é receita nem despesa
 * (fica fora do DRE e do caixa dos dashboards).
 */
export async function ajustarSaldoConta(p: { contaFinanceiraId: number; saldoReal: number; data: Date; descricao?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const conta = await tx.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
    if (!conta) throw new NotFound('Conta financeira');
    const diferenca = arredondar(p.saldoReal - conta.saldoAtual);
    if (Math.abs(diferenca) < 0.01) return { movimento: null, diferenca: 0, saldoAnterior: arredondar(conta.saldoAtual) };
    const movimento = await criarMovimentoAvulso(
      {
        contaFinanceiraId: conta.id,
        data: p.data,
        tipo: diferenca > 0 ? 'ENTRADA' : 'SAIDA',
        valor: Math.abs(diferenca),
        descricao: p.descricao?.trim() || `Ajuste de saldo: ${conta.nome} acertado para R$ ${p.saldoReal.toFixed(2).replace('.', ',')}`,
        categoriaId: null,
        observacoes: OBS_AJUSTE_SALDO,
      },
      tx,
    );
    return { movimento, diferenca, saldoAnterior: arredondar(conta.saldoAtual) };
  });
}

export async function transferirEntreContas(
  p: { origemId: number; destinoId: number; valor: number; data: Date; descricao?: string | null; caixinhaId?: number | null },
  txExterno?: Tx,
) {
  if (p.origemId === p.destinoId) throw new AppError('Conta de origem e destino devem ser diferentes.', 422, 'CONTAS_IGUAIS');
  const exec = async (tx: Tx) => {
    const origem = await tx.contaFinanceira.findUnique({ where: { id: p.origemId } });
    const destino = await tx.contaFinanceira.findUnique({ where: { id: p.destinoId } });
    if (!origem || !destino) throw new NotFound('Conta financeira');
    const desc = p.descricao || 'Transferência entre contas';
    const saida = await criarMovimentoAvulso(
      { contaFinanceiraId: origem.id, data: p.data, tipo: 'SAIDA', valor: p.valor, descricao: `${desc} → ${destino.nome}`, observacoes: OBS_TRANSFERENCIA },
      tx,
    );
    const entrada = await criarMovimentoAvulso(
      { contaFinanceiraId: destino.id, data: p.data, tipo: 'ENTRADA', valor: p.valor, descricao: `${desc} ← ${origem.nome}`, observacoes: OBS_TRANSFERENCIA },
      tx,
    );
    // caixinha: a entrada (guardar) ou a saída (retirar) da conta da caixinha fica marcada
    if (p.caixinhaId) {
      const cx = await tx.caixinha.findUnique({ where: { id: p.caixinhaId }, select: { contaFinanceiraId: true } });
      if (cx?.contaFinanceiraId === destino.id) await tx.movimentoFinanceiro.update({ where: { id: entrada.id }, data: { caixinhaId: p.caixinhaId } });
      if (cx?.contaFinanceiraId === origem.id) await tx.movimentoFinanceiro.update({ where: { id: saida.id }, data: { caixinhaId: p.caixinhaId } });
    }
    return { saida, entrada };
  };
  return txExterno ? exec(txExterno) : prisma.$transaction(exec);
}

export async function excluirMovimento(id: number) {
  return prisma.$transaction(async (tx) => {
    const m = await tx.movimentoFinanceiro.findUnique({ where: { id } });
    if (!m) throw new NotFound('Movimento');
    if (m.contaReceberId || m.contaPagarId) {
      throw new AppError('Este movimento é uma baixa de conta. Use o estorno da conta para desfazê-lo.', 422, 'MOVIMENTO_DE_BAIXA');
    }
    // transferência: apaga as duas pernas juntas (senão o dinheiro some de um lado e fica no outro)
    const pernas = [m];
    if (m.observacoes === OBS_TRANSFERENCIA) {
      const par = await tx.movimentoFinanceiro.findFirst({
        where: {
          id: { not: m.id },
          observacoes: OBS_TRANSFERENCIA,
          tipo: m.tipo === 'ENTRADA' ? 'SAIDA' : 'ENTRADA',
          valor: { gte: m.valor - 0.005, lte: m.valor + 0.005 },
          contaFinanceiraId: { not: m.contaFinanceiraId },
          criadoEm: { gte: new Date(+m.criadoEm - 5000), lte: new Date(+m.criadoEm + 5000) },
        },
        orderBy: { id: 'asc' },
      });
      if (par) pernas.push(par);
    }
    for (const x of pernas) {
      const delta = x.tipo === 'ENTRADA' ? -x.valor : x.valor;
      await tx.contaFinanceira.update({ where: { id: x.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(delta) } } });
      if (x.transacaoId) await tx.transacaoBancaria.update({ where: { id: x.transacaoId }, data: { conciliado: false } });
      await tx.movimentoFinanceiro.delete({ where: { id: x.id } });
    }
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
    select: { valor: true, valorRecebido: true, juros: true, desconto: true, vencimento: true },
  });
  const abertasCP = await prisma.contaPagar.findMany({
    where: { situacao: { in: SITUACOES_ABERTAS }, vencimento: { lte: fimSemana } },
    select: { valor: true, valorPago: true, juros: true, desconto: true, vencimento: true },
  });
  const restCR = saldoContaReceber;
  const restCP = saldoContaPagar;
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
