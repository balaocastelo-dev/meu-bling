/**
 * EMPRÉSTIMOS E ANTECIPAÇÕES (ex.: Lumicred) — 28/10/2026.
 *
 * Regra geral: o credor deposita o valor na nossa conta e devolvemos valor + taxa (padrão 6% em 30 dias).
 *   R$ 1.000 recebidos → R$ 1.060 a devolver.
 *
 * Cenários (modalidade):
 *   REPASSE      → o cliente paga o boleto para a loja (conta a receber normal) e a loja paga o credor.
 *   DIRETO       → o cliente paga o boleto direto ao credor. "Cliente pagou direto" baixa o boleto do cliente
 *                  e abate o mesmo valor da dívida num encontro de contas (sem passar pelo banco);
 *                  a loja paga só o que sobrar (os juros).
 *   CAPITAL_GIRO → sem cliente: a loja devolve tudo (pode ser em parcelas mensais).
 *
 * Contabilidade:
 *   - a entrada do dinheiro é uma conta a receber RECEBIDA ligada ao empréstimo → fora do DRE (não é venda).
 *   - a devolução são contas a pagar ligadas ao empréstimo, categoria "Empréstimos e financiamentos".
 *     No DRE só entra a parte de juros de cada conta (valor × juros / valor a devolver); o principal fica
 *     no quadro informativo.
 */
import { addDays, addMonths, startOfDay } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar, competenciaDe, proximoNumero } from '../../lib/util.js';
import { categoriaPadraoId } from '../comum/financeiro.js';
import { baixarContaPagar, baixarContaReceber, saldoContaPagar, saldoContaReceber } from '../financeiro/service.js';

export const MODALIDADES = ['REPASSE', 'DIRETO', 'CAPITAL_GIRO'] as const;
export type Modalidade = (typeof MODALIDADES)[number];
export const CATEGORIA_EMPRESTIMOS = 'Empréstimos e financiamentos';
export const TIPO_CONTA_COMPENSACAO = 'COMPENSACAO';

/** Conta financeira técnica do encontro de contas (cliente pagou direto ao credor). Saldo sempre volta a zero. */
export async function contaCompensacaoId(db: Tx | typeof prisma = prisma) {
  const c = await db.contaFinanceira.findFirst({ where: { tipo: TIPO_CONTA_COMPENSACAO } });
  if (c) return c.id;
  const nova = await db.contaFinanceira.create({ data: { nome: 'Encontro de contas (empréstimos)', tipo: TIPO_CONTA_COMPENSACAO, cor: '#94a3b8' } });
  return nova.id;
}

export function calcularDevolucao(valorRecebido: number, taxaPct: number) {
  const juros = arredondar(valorRecebido * (taxaPct / 100));
  return { juros, valorDevolver: arredondar(valorRecebido + juros) };
}

/** Parte de juros de um valor pago/devido numa operação (proporcional). */
export function fatorJuros(e: { juros: number; valorDevolver: number }) {
  return e.valorDevolver > 0 ? Math.min(1, Math.max(0, e.juros / e.valorDevolver)) : 0;
}

export interface NovoEmprestimo {
  credorId: number;
  modalidade: Modalidade;
  codigo?: string | null;
  descricao?: string | null;
  clienteId?: number | null;
  vendaId?: number | null;
  contaReceberClienteId?: number | null;
  dataOperacao: Date;
  valorRecebido: number;
  taxaPct: number;
  prazoDias: number;
  parcelas: number;
  vencimento?: Date | null;
  /** conta onde o dinheiro entrou; vazio = ainda não entrou (lança só a dívida) */
  contaFinanceiraId?: number | null;
  observacoes?: string | null;
  /** gerado pela forma de pagamento "Crédito bancário" de uma venda/compra */
  compraId?: number | null;
  vendaParcelaId?: number | null;
  compraParcelaId?: number | null;
}

/** Descobre o boleto do cliente pela venda (primeira conta a receber em aberto). */
async function resolverCliente(tx: Tx, d: NovoEmprestimo) {
  let clienteId = d.clienteId ?? null;
  let contaReceberClienteId = d.contaReceberClienteId ?? null;
  if (d.vendaId) {
    const v = await tx.venda.findUnique({ where: { id: d.vendaId }, select: { id: true, contatoId: true, tipo: true } });
    if (!v || v.tipo !== 'PEDIDO') throw new AppError('Venda não encontrada.', 422, 'VENDA');
    clienteId = clienteId ?? v.contatoId;
    if (!contaReceberClienteId) {
      const cr = await tx.contaReceber.findFirst({ where: { origemTipo: 'VENDA', origemId: v.id, situacao: { not: 'CANCELADO' } }, orderBy: [{ situacao: 'asc' }, { vencimento: 'asc' }] });
      contaReceberClienteId = cr?.id ?? null;
    }
  }
  if (contaReceberClienteId) {
    const cr = await tx.contaReceber.findUnique({ where: { id: contaReceberClienteId } });
    if (!cr || cr.situacao === 'CANCELADO') throw new AppError('Conta a receber do cliente não encontrada.', 422, 'CONTA_CLIENTE');
    if (cr.emprestimoId) throw new AppError('Essa conta a receber é a entrada de um empréstimo, não o boleto de um cliente.', 422, 'CONTA_CLIENTE');
    clienteId = clienteId ?? cr.contatoId ?? null;
  }
  if (d.modalidade === 'DIRETO' && !contaReceberClienteId) {
    throw new AppError('No cenário "cliente paga direto ao credor" informe a venda ou a conta a receber (boleto) do cliente.', 422, 'CONTA_CLIENTE', { campo: 'contaReceberClienteId' });
  }
  return { clienteId, contaReceberClienteId };
}

function rotuloOperacao(e: { numero: number; codigo?: string | null }, credorNome: string) {
  return `Empréstimo nº ${e.numero}${e.codigo ? ` (${e.codigo})` : ''} — ${credorNome}`;
}

/** Cria as contas a pagar da devolução (1 ou N parcelas mensais). */
async function criarDevolucao(tx: Tx, e: { id: number; numero: number; codigo: string | null; credorId: number; dataOperacao: Date; vencimento: Date; valorDevolver: number; parcelas: number }, credorNome: string) {
  const categoriaId = await categoriaPadraoId(tx, CATEGORIA_EMPRESTIMOS, 'DESPESA', 'DESPESA_FINANCEIRA');
  const n = Math.max(1, e.parcelas);
  const base = Math.floor((e.valorDevolver / n) * 100) / 100;
  let acumulado = 0;
  for (let i = 0; i < n; i++) {
    const valor = i === n - 1 ? arredondar(e.valorDevolver - acumulado) : base;
    acumulado = arredondar(acumulado + valor);
    const venc = i === 0 ? e.vencimento : addMonths(e.vencimento, i);
    await tx.contaPagar.create({
      data: {
        contatoId: e.credorId,
        descricao: `${rotuloOperacao(e, credorNome)} — devolução`,
        dataEmissao: e.dataOperacao,
        vencimento: venc,
        // juros da operação ficam no mês em que ela foi feita (competência)
        competencia: competenciaDe(n === 1 ? e.dataOperacao : venc),
        valor,
        categoriaId,
        origemTipo: 'EMPRESTIMO',
        origemId: e.id,
        emprestimoId: e.id,
        parcela: n > 1 ? `${i + 1}/${n}` : null,
      },
    });
  }
}

export async function criarEmprestimo(d: NovoEmprestimo) {
  if (!(d.valorRecebido > 0)) throw new AppError('Informe o valor recebido do credor.', 422, 'VALOR_INVALIDO', { campo: 'valorRecebido' });
  const credor = await prisma.contato.findUnique({ where: { id: d.credorId }, select: { id: true, nome: true } });
  if (!credor) throw new AppError('Credor não encontrado.', 422, 'CREDOR', { campo: 'credorId' });
  if (d.contaFinanceiraId) {
    const cf = await prisma.contaFinanceira.findUnique({ where: { id: d.contaFinanceiraId } });
    if (!cf || cf.tipo === TIPO_CONTA_COMPENSACAO) throw new AppError('Conta financeira inválida.', 422, 'CONTA_FINANCEIRA', { campo: 'contaFinanceiraId' });
  }
  const id = await prisma.$transaction((tx) => criarEmprestimoTx(tx, d, credor.nome));
  return emprestimoCompleto(id);
}

/** Cria a operação dentro de uma transação (usado também pela forma de pagamento "Crédito bancário"). */
export async function criarEmprestimoTx(tx: Tx, d: NovoEmprestimo, credorNome: string) {
  const { juros, valorDevolver } = calcularDevolucao(d.valorRecebido, d.taxaPct);
  const vencimento = d.vencimento ?? addDays(d.dataOperacao, d.prazoDias);
  {
    const cli = await resolverCliente(tx, d);
    const numero = await proximoNumero('EMPRESTIMO', tx);
    const e = await tx.emprestimo.create({
      data: {
        numero,
        codigo: d.codigo || null,
        descricao: d.descricao || null,
        credorId: d.credorId,
        modalidade: d.modalidade,
        clienteId: cli.clienteId,
        vendaId: d.vendaId ?? null,
        contaReceberClienteId: cli.contaReceberClienteId,
        dataOperacao: d.dataOperacao,
        valorRecebido: arredondar(d.valorRecebido),
        taxaPct: d.taxaPct,
        juros,
        valorDevolver,
        prazoDias: d.prazoDias,
        vencimento,
        parcelas: Math.max(1, d.parcelas),
        contaFinanceiraId: d.contaFinanceiraId ?? null,
        observacoes: d.observacoes || null,
        compraId: d.compraId ?? null,
        vendaParcelaId: d.vendaParcelaId ?? null,
        compraParcelaId: d.compraParcelaId ?? null,
      },
    });
    await criarDevolucao(tx, e, credorNome);
    // entrada do dinheiro: conta a receber já recebida (fora do DRE por estar ligada ao empréstimo)
    if (d.contaFinanceiraId) {
      const cr = await tx.contaReceber.create({
        data: {
          contatoId: d.credorId,
          descricao: `${rotuloOperacao(e, credorNome)} — dinheiro recebido`,
          dataEmissao: d.dataOperacao,
          vencimento: d.dataOperacao,
          competencia: competenciaDe(d.dataOperacao),
          valor: e.valorRecebido,
          origemTipo: 'EMPRESTIMO',
          origemId: e.id,
          emprestimoId: e.id,
        },
      });
      await baixarContaReceber({ id: cr.id, valor: e.valorRecebido, data: d.dataOperacao, contaFinanceiraId: d.contaFinanceiraId }, tx);
    }
    return e.id;
  }
}

/** Cliente pagou o boleto direto ao credor: baixa o boleto e abate a dívida no encontro de contas. */
export async function clientePagouDireto(id: number, p: { valor?: number | null; data: Date }) {
  const e = await prisma.emprestimo.findUnique({ where: { id }, include: { contasPagar: { orderBy: { vencimento: 'asc' } } } });
  if (!e) throw new NotFound('Empréstimo');
  if (e.situacao === 'CANCELADO') throw new AppError('Empréstimo cancelado.', 422, 'SITUACAO_INVALIDA');
  if (!e.contaReceberClienteId) throw new AppError('Este empréstimo não tem boleto de cliente ligado. Ligue a venda ou a conta a receber do cliente antes.', 422, 'CONTA_CLIENTE');
  const cr = await prisma.contaReceber.findUnique({ where: { id: e.contaReceberClienteId } });
  if (!cr) throw new NotFound('Conta a receber do cliente');
  const saldoCliente = ['ABERTO', 'PARCIAL'].includes(cr.situacao) ? saldoContaReceber(cr) : 0;
  const abertas = e.contasPagar.filter((c) => ['ABERTO', 'PARCIAL'].includes(c.situacao));
  const saldoDivida = arredondar(abertas.reduce((s, c) => s + saldoContaPagar(c), 0));
  if (saldoCliente <= 0) throw new AppError('O boleto do cliente já está baixado no sistema.', 422, 'JA_RECEBIDO');
  if (saldoDivida <= 0) throw new AppError('A dívida com o credor já está quitada.', 422, 'JA_QUITADO');
  const valor = arredondar(p.valor && p.valor > 0 ? p.valor : saldoCliente);
  if (valor > saldoCliente + 0.009) throw new AppError(`Valor maior que o saldo do boleto do cliente (R$ ${saldoCliente.toFixed(2).replace('.', ',')}).`, 422, 'VALOR_ACIMA_DO_SALDO');
  if (valor > saldoDivida + 0.009) throw new AppError(`Valor maior que a dívida com o credor (R$ ${saldoDivida.toFixed(2).replace('.', ',')}).`, 422, 'VALOR_ACIMA_DO_SALDO');
  await prisma.$transaction(async (tx) => {
    const comp = await contaCompensacaoId(tx);
    const obs = `Cliente pagou direto ao credor — empréstimo nº ${e.numero}`;
    await baixarContaReceber({ id: cr.id, valor, data: p.data, contaFinanceiraId: comp, observacoes: obs }, tx);
    let resta = valor;
    for (const c of abertas) {
      if (resta <= 0.009) break;
      const parte = arredondar(Math.min(resta, saldoContaPagar(c)));
      if (parte <= 0) continue;
      await baixarContaPagar({ id: c.id, valor: parte, data: p.data, contaFinanceiraId: comp, observacoes: obs }, tx);
      resta = arredondar(resta - parte);
    }
  });
  return emprestimoCompleto(id);
}

/** Paga ao credor (as parcelas em aberto, da mais antiga para a mais nova). */
export async function pagarCredor(id: number, p: { valor?: number | null; data: Date; contaFinanceiraId: number; juros?: number }) {
  const e = await prisma.emprestimo.findUnique({ where: { id }, include: { contasPagar: { orderBy: { vencimento: 'asc' } } } });
  if (!e) throw new NotFound('Empréstimo');
  if (e.situacao === 'CANCELADO') throw new AppError('Empréstimo cancelado.', 422, 'SITUACAO_INVALIDA');
  const cf = await prisma.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
  if (!cf || cf.tipo === TIPO_CONTA_COMPENSACAO) throw new AppError('Escolha a conta de onde sai o dinheiro.', 422, 'CONTA_FINANCEIRA', { campo: 'contaFinanceiraId' });
  const abertas = e.contasPagar.filter((c) => ['ABERTO', 'PARCIAL'].includes(c.situacao));
  const saldo = arredondar(abertas.reduce((s, c) => s + saldoContaPagar(c), 0));
  if (saldo <= 0) throw new AppError('Nada em aberto para pagar.', 422, 'JA_QUITADO');
  const valor = arredondar(p.valor && p.valor > 0 ? p.valor : saldo);
  if (valor > saldo + 0.009) throw new AppError(`Valor maior que o saldo devedor (R$ ${saldo.toFixed(2).replace('.', ',')}).`, 422, 'VALOR_ACIMA_DO_SALDO');
  await prisma.$transaction(async (tx) => {
    let resta = valor;
    for (const c of abertas) {
      if (resta <= 0.009) break;
      const parte = arredondar(Math.min(resta, saldoContaPagar(c)));
      if (parte <= 0) continue;
      await baixarContaPagar({ id: c.id, valor: parte, data: p.data, contaFinanceiraId: p.contaFinanceiraId }, tx);
      resta = arredondar(resta - parte);
    }
  });
  return emprestimoCompleto(id);
}

/** Cancela uma operação lançada por engano (só sem pagamentos ao credor). */
export async function cancelarEmprestimo(id: number) {
  const e = await prisma.emprestimo.findUnique({ where: { id }, include: { contasPagar: true, contasReceber: true } });
  if (!e) throw new NotFound('Empréstimo');
  if (e.situacao === 'CANCELADO') return emprestimoCompleto(id);
  if (e.contasPagar.some((c) => c.valorPago > 0)) {
    throw new AppError('Já há pagamento ao credor nesta operação. Estorne os pagamentos no contas a pagar antes de cancelar.', 422, 'TEM_PAGAMENTO');
  }
  await prisma.$transaction((tx) => cancelarEmprestimoTx(tx, id));
  return emprestimoCompleto(id);
}

/** Cancela dentro de uma transação: tira a entrada do caixa e cancela a devolução (sem pagamentos ao credor). */
export async function cancelarEmprestimoTx(tx: Tx, id: number) {
  const e = await tx.emprestimo.findUnique({ where: { id }, include: { contasPagar: true, contasReceber: true } });
  if (!e || e.situacao === 'CANCELADO') return;
  if (e.contasPagar.some((c) => c.valorPago > 0)) {
    throw new AppError(`O empréstimo nº ${e.numero} já tem pagamento ao credor. Estorne os pagamentos no contas a pagar antes.`, 422, 'TEM_PAGAMENTO', { emprestimoId: id });
  }
  for (const cr of e.contasReceber) {
    const movs = await tx.movimentoFinanceiro.findMany({ where: { contaReceberId: cr.id } });
    for (const m of movs) {
      await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { decrement: arredondar(m.valor) } } });
      await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
    }
  }
  await tx.contaPagar.updateMany({ where: { emprestimoId: id }, data: { situacao: 'CANCELADO' } });
  await tx.contaReceber.updateMany({ where: { emprestimoId: id }, data: { situacao: 'CANCELADO', valorRecebido: 0, dataRecebimento: null } });
  await tx.emprestimo.update({ where: { id }, data: { situacao: 'CANCELADO' } });
}

/**
 * Altera a operação. Sem pagamentos: recalcula a devolução (valor, taxa, prazo, parcelas).
 * Com pagamentos (ou importada): só ajusta o valor recebido → juros = valor a devolver − valor recebido.
 */
export async function alterarEmprestimo(id: number, d: Partial<NovoEmprestimo> & { valorDevolver?: number | null }) {
  const e = await prisma.emprestimo.findUnique({ where: { id }, include: { contasPagar: true, credor: { select: { nome: true } } } });
  if (!e) throw new NotFound('Empréstimo');
  if (e.situacao === 'CANCELADO') throw new AppError('Empréstimo cancelado.', 422, 'SITUACAO_INVALIDA');
  const temPagamento = e.contasPagar.some((c) => c.valorPago > 0) || e.importado;
  const daParcela = !!(e.vendaParcelaId || e.compraParcelaId);
  if (daParcela && d.valorRecebido !== undefined && d.valorRecebido !== null && Math.abs(d.valorRecebido - e.valorRecebido) > 0.009) {
    throw new AppError('O valor desta operação vem da parcela da venda/compra. Para mudar, altere a parcela.', 422, 'VALOR_DA_PARCELA', { campo: 'valorRecebido' });
  }
  await prisma.$transaction(async (tx) => {
    const cli = d.vendaId !== undefined || d.contaReceberClienteId !== undefined || d.clienteId !== undefined
      ? await resolverCliente(tx, { ...(e as any), modalidade: d.modalidade ?? (e.modalidade as Modalidade), vendaId: d.vendaId ?? e.vendaId, clienteId: d.clienteId ?? e.clienteId, contaReceberClienteId: d.contaReceberClienteId ?? e.contaReceberClienteId })
      : null;
    const base: any = {
      codigo: d.codigo !== undefined ? d.codigo || null : undefined,
      descricao: d.descricao !== undefined ? d.descricao || null : undefined,
      observacoes: d.observacoes !== undefined ? d.observacoes || null : undefined,
      modalidade: d.modalidade,
      ...(cli ? { clienteId: cli.clienteId, contaReceberClienteId: cli.contaReceberClienteId, vendaId: d.vendaId ?? e.vendaId } : {}),
    };
    if (temPagamento) {
      if (d.valorRecebido !== undefined && d.valorRecebido !== null) {
        if (!(d.valorRecebido > 0) || d.valorRecebido > e.valorDevolver) throw new AppError('O valor recebido deve ser maior que zero e não pode passar do valor devolvido ao credor.', 422, 'VALOR_INVALIDO', { campo: 'valorRecebido' });
        const juros = arredondar(e.valorDevolver - d.valorRecebido);
        Object.assign(base, { valorRecebido: arredondar(d.valorRecebido), juros, taxaPct: arredondar((juros / d.valorRecebido) * 100, 2), jurosEstimado: false });
      }
      await tx.emprestimo.update({ where: { id }, data: base });
      return;
    }
    const valorRecebido = d.valorRecebido ?? e.valorRecebido;
    const taxaPct = d.taxaPct ?? e.taxaPct;
    const prazoDias = d.prazoDias ?? e.prazoDias;
    const parcelas = d.parcelas ?? e.parcelas;
    const dataOperacao = d.dataOperacao ?? e.dataOperacao;
    const vencimento = d.vencimento ?? (d.prazoDias !== undefined || d.dataOperacao !== undefined ? addDays(dataOperacao, prazoDias) : e.vencimento);
    const { juros, valorDevolver } = calcularDevolucao(valorRecebido, taxaPct);
    const atual = await tx.emprestimo.update({ where: { id }, data: { ...base, valorRecebido, taxaPct, prazoDias, parcelas, dataOperacao, vencimento, juros, valorDevolver, jurosEstimado: false } });
    await tx.contaPagar.deleteMany({ where: { emprestimoId: id, valorPago: 0 } });
    await criarDevolucao(tx, atual, e.credor.nome);
    // entrada: acompanha o novo valor recebido
    const entrada = await tx.contaReceber.findFirst({ where: { emprestimoId: id, situacao: { not: 'CANCELADO' } } });
    if (entrada && (entrada.valor !== valorRecebido || +entrada.vencimento !== +dataOperacao)) {
      const movs = await tx.movimentoFinanceiro.findMany({ where: { contaReceberId: entrada.id } });
      for (const m of movs) {
        await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { decrement: m.valor } } });
        await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
      }
      await tx.contaReceber.update({ where: { id: entrada.id }, data: { valor: valorRecebido, valorRecebido: 0, situacao: 'ABERTO', vencimento: dataOperacao, dataEmissao: dataOperacao, competencia: competenciaDe(dataOperacao) } });
      const conta = movs[0]?.contaFinanceiraId ?? e.contaFinanceiraId;
      if (conta) await baixarContaReceber({ id: entrada.id, valor: valorRecebido, data: dataOperacao, contaFinanceiraId: conta }, tx);
    }
  });
  return emprestimoCompleto(id);
}

// ---------------------------------------------------------------------------- leitura
const includeLista = {
  credor: { select: { id: true, nome: true, documento: true } },
  cliente: { select: { id: true, nome: true } },
  venda: { select: { id: true, numero: true, total: true, data: true } },
  compra: { select: { id: true, numero: true, total: true, data: true, fornecedor: { select: { id: true, nome: true } } } },
  contasPagar: { orderBy: { vencimento: 'asc' as const }, select: { id: true, descricao: true, valor: true, valorPago: true, juros: true, desconto: true, situacao: true, vencimento: true, dataPagamento: true, parcela: true } },
  contasReceber: { select: { id: true, valor: true, valorRecebido: true, situacao: true, contaFinanceiraId: true, dataRecebimento: true } },
} as const;

type EmprestimoLido = NonNullable<Awaited<ReturnType<typeof carregar>>>;
const carregar = (id: number) => prisma.emprestimo.findUnique({ where: { id }, include: includeLista });

/** Status, saldos e o alerta do que fazer (ex.: "cliente já pagou: repasse ao credor"). */
export function calcularSituacao(e: Omit<EmprestimoLido, 'contasReceber'> & { contasReceber?: unknown[] }, boleto: { id: number; valor: number; valorRecebido: number; juros: number; desconto: number; situacao: string; vencimento: Date; dataRecebimento: Date | null } | null, hoje = startOfDay(new Date())) {
  const validas = e.contasPagar.filter((c) => c.situacao !== 'CANCELADO');
  const pago = arredondar(validas.reduce((s, c) => s + c.valorPago, 0));
  const saldoDevedor = arredondar(validas.reduce((s, c) => s + (['ABERTO', 'PARCIAL'].includes(c.situacao) ? saldoContaPagar(c) : 0), 0));
  const abertas = validas.filter((c) => ['ABERTO', 'PARCIAL'].includes(c.situacao));
  const proximoVencimento = abertas[0]?.vencimento ?? null;
  const diasParaVencer = proximoVencimento ? Math.round((startOfDay(proximoVencimento).getTime() - hoje.getTime()) / 86400000) : null;
  let status: 'ABERTO' | 'VENCIDO' | 'QUITADO' | 'CANCELADO';
  if (e.situacao === 'CANCELADO') status = 'CANCELADO';
  else if (saldoDevedor <= 0.009 && validas.length) status = 'QUITADO';
  else if (diasParaVencer !== null && diasParaVencer < 0) status = 'VENCIDO';
  else status = 'ABERTO';
  const boletoInfo = boleto
    ? { id: boleto.id, valor: boleto.valor, saldo: ['ABERTO', 'PARCIAL'].includes(boleto.situacao) ? saldoContaReceber(boleto) : 0, situacao: boleto.situacao, vencimento: boleto.vencimento, dataRecebimento: boleto.dataRecebimento, atrasado: ['ABERTO', 'PARCIAL'].includes(boleto.situacao) && startOfDay(boleto.vencimento) < hoje }
    : null;
  let alerta: { tom: 'vermelho' | 'amarelo' | 'verde' | 'azul'; texto: string } | null = null;
  const fmt = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
  if (status === 'ABERTO' || status === 'VENCIDO') {
    if (e.modalidade === 'REPASSE' && boletoInfo?.situacao === 'RECEBIDO') alerta = { tom: 'amarelo', texto: `Cliente já pagou: repasse ${fmt(saldoDevedor)} ao credor${proximoVencimento ? ` até ${proximoVencimento.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}.` };
    else if (status === 'VENCIDO') alerta = { tom: 'vermelho', texto: `Vencido há ${Math.abs(diasParaVencer!)} dia(s): ${fmt(saldoDevedor)} em aberto com o credor.` };
    else if (boletoInfo?.atrasado) alerta = { tom: 'vermelho', texto: `Cliente atrasado: boleto venceu em ${boletoInfo.vencimento.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} e o credor vence em ${diasParaVencer} dia(s).` };
    else if (e.modalidade === 'DIRETO' && boletoInfo?.situacao === 'RECEBIDO') alerta = { tom: 'azul', texto: `Cliente pagou o credor. Falta pagar a diferença: ${fmt(saldoDevedor)}.` };
    else if (diasParaVencer !== null && diasParaVencer <= 5) alerta = { tom: 'amarelo', texto: diasParaVencer === 0 ? `Vence hoje: ${fmt(saldoDevedor)}.` : `Vence em ${diasParaVencer} dia(s): ${fmt(saldoDevedor)}.` };
  }
  return { status, pago, saldoDevedor, proximoVencimento, diasParaVencer, boleto: boletoInfo, alerta };
}

/**
 * Venda a prazo só gera o boleto (conta a receber) quando é finalizada: operação ligada pela venda
 * sem boleto ainda procura de novo e grava o vínculo assim que ele existir.
 */
async function ligarBoletosPendentes(lista: { id: number; vendaId: number | null; contaReceberClienteId: number | null; clienteId: number | null }[]) {
  for (const e of lista) {
    if (!e.vendaId || e.contaReceberClienteId) continue;
    const cr = await prisma.contaReceber.findFirst({ where: { origemTipo: 'VENDA', origemId: e.vendaId, situacao: { not: 'CANCELADO' } }, orderBy: { vencimento: 'asc' } });
    if (!cr) continue;
    await prisma.emprestimo.update({ where: { id: e.id }, data: { contaReceberClienteId: cr.id, clienteId: e.clienteId ?? cr.contatoId } });
    e.contaReceberClienteId = cr.id;
  }
}

async function boletos(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const l = await prisma.contaReceber.findMany({ where: { id: { in: ids } }, select: { id: true, valor: true, valorRecebido: true, juros: true, desconto: true, situacao: true, vencimento: true, dataRecebimento: true } });
  return new Map(l.map((b) => [b.id, b]));
}

export async function emprestimoCompleto(id: number) {
  const e = await carregar(id);
  if (!e) throw new NotFound('Empréstimo');
  await ligarBoletosPendentes([e]);
  const mapa = await boletos(e.contaReceberClienteId ? [e.contaReceberClienteId] : []);
  const conta = e.contaFinanceiraId ? await prisma.contaFinanceira.findUnique({ where: { id: e.contaFinanceiraId }, select: { id: true, nome: true } }) : null;
  return { ...e, contaFinanceira: conta, ...calcularSituacao(e, e.contaReceberClienteId ? mapa.get(e.contaReceberClienteId) ?? null : null) };
}

export async function listarEmprestimos(f: { status?: string; credorId?: number; modalidade?: string; ini?: Date | null; fim?: Date | null; pesquisa?: string }) {
  const where: any = {
    credorId: f.credorId,
    modalidade: f.modalidade,
    ...(f.ini || f.fim ? { dataOperacao: { ...(f.ini ? { gte: f.ini } : {}), ...(f.fim ? { lte: f.fim } : {}) } } : {}),
  };
  if (f.pesquisa) {
    const t = f.pesquisa.trim();
    const n = Number(t.replace(/\D/g, ''));
    where.OR = [{ codigo: { contains: t } }, { descricao: { contains: t } }, { observacoes: { contains: t } }, { cliente: { nome: { contains: t } } }, { credor: { nome: { contains: t } } }, ...(n ? [{ numero: n }] : [])];
  }
  const lista = await prisma.emprestimo.findMany({ where, include: includeLista, orderBy: [{ dataOperacao: 'desc' }, { id: 'desc' }] });
  await ligarBoletosPendentes(lista.filter((e) => e.situacao !== 'CANCELADO'));
  const mapa = await boletos(lista.map((e) => e.contaReceberClienteId).filter((x): x is number => !!x));
  const hoje = startOfDay(new Date());
  const todos = lista.map((e) => ({ ...e, ...calcularSituacao(e, e.contaReceberClienteId ? mapa.get(e.contaReceberClienteId) ?? null : null, hoje) }));
  const ativos = todos.filter((e) => e.status !== 'CANCELADO');
  const emAberto = ativos.filter((e) => e.status === 'ABERTO' || e.status === 'VENCIDO');
  const totais = {
    emAberto: arredondar(emAberto.reduce((s, e) => s + e.saldoDevedor, 0)),
    qtdEmAberto: emAberto.length,
    vencido: arredondar(ativos.filter((e) => e.status === 'VENCIDO').reduce((s, e) => s + e.saldoDevedor, 0)),
    vence7dias: arredondar(emAberto.filter((e) => e.diasParaVencer !== null && e.diasParaVencer >= 0 && e.diasParaVencer <= 7).reduce((s, e) => s + e.saldoDevedor, 0)),
    repassar: arredondar(emAberto.filter((e) => e.modalidade === 'REPASSE' && e.boleto?.situacao === 'RECEBIDO').reduce((s, e) => s + e.saldoDevedor, 0)),
    recebido: arredondar(ativos.reduce((s, e) => s + e.valorRecebido, 0)),
    juros: arredondar(ativos.reduce((s, e) => s + e.juros, 0)),
    pago: arredondar(ativos.reduce((s, e) => s + e.pago, 0)),
  };
  return { data: f.status ? todos.filter((e) => e.status === f.status) : todos, totais };
}
