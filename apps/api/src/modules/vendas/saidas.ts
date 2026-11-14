/**
 * Saídas de caixa ao fechar a venda.
 *
 * Na loja o produto, o frete e a taxa da máquina são pagos na hora. Além da entrada do valor
 * recebido, o fechamento lança contas a pagar já baixadas (MovimentoFinanceiro SAIDA) que
 * diminuem o saldo:
 *   - CMV_VENDA  — custo real dos itens (não usa a estimativa de 40–70%)
 *   - FRETE_VENDA — Venda.custoLogistica, só quando for maior que zero (o frete padrão de R$ 10 não sai)
 *   - TAXA_VENDA — uma taxa só: a da conta, senão a da forma, senão a faixa 1x–12x do cartão
 *
 * O Simples não sai do caixa na venda: vira uma conta a pagar ABERTA por competência (PREVISAO_DAS).
 * Venda antiga não é relançada — estas funções só rodam quando a venda é fechada de novo daqui pra frente.
 */
import type { Tx } from '../../lib/prisma.js';
import { prisma } from '../../lib/prisma.js';
import { arredondar, competenciaDe } from '../../lib/util.js';
import { categoriaPadraoId, type Db } from '../comum/financeiro.js';
import { carregarCfgCustos, taxaCartaoPct, type CfgCustos } from '../comum/custos-venda.js';
import { baixarContaPagar } from '../financeiro/service.js';

type TxDb = Tx;

export const MARCA_CMV = 'CMV_VENDA';
export const MARCA_FRETE = 'FRETE_VENDA';
export const MARCA_TAXA = 'TAXA_VENDA';
export const MARCA_DAS = 'PREVISAO_DAS';

export const CHAVE_CONTA_SAIDAS = 'vendas.contaSaidasId';
export const CHAVE_CONTA_CUSTO = 'vendas.contaCustoProdutoId';

/** Igual a OBS_PAGO_NA_HORA em vendas/service.ts — duplicado para não criar import circular. */
const OBS_RECEBIDO = 'Recebido automaticamente: pago na hora da venda';
const TIPOS_PAGO_NA_HORA = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'TRANSFERENCIA'];

const CAT_CMV = 'Custo de mercadoria';
const CAT_FRETE = 'Frete';
const CAT_TAXA = 'Taxa de cartão';
const CAT_DAS = 'DAS';

export interface ResumoCaixaVenda {
  recebido: number;
  /** true quando o número de "recebido" ainda é a prévia (o dinheiro não entrou) */
  previsto: boolean;
  custoProduto: number;
  custoPendente: boolean;
  itensSemCusto: string[];
  frete: number;
  taxa: number;
  impostoPrevisto: number;
  impostoPct: number;
  /** recebido − custo − frete − taxa − imposto previsto */
  liquido: number;
  lancado: { cmv: boolean; frete: boolean; taxa: boolean };
}

interface Plano {
  ignorar: boolean;
  numero: number;
  data: Date;
  competencia: string;
  custoProduto: number;
  custoPendente: boolean;
  itensSemCusto: string[];
  frete: number;
  /** taxa que já pode sair do caixa (só do que foi recebido) */
  taxaLancada: number;
  /** taxa da tela: a lançada ou, se ainda não entrou dinheiro, a prévia */
  taxa: number;
  imposto: number;
  impostoPct: number;
  recebido: number;
  previsto: boolean;
  contaCmv: number | null;
  contaFrete: number | null;
  contaTaxa: number | null;
  lancado: { cmv: boolean; frete: boolean; taxa: boolean };
}

async function contaConfigurada(db: Db, chave: string): Promise<number | null> {
  const cfg = await db.configuracao.findUnique({ where: { chave } });
  const id = cfg ? Number(cfg.valor) : 0;
  if (!id) return null;
  const c = await db.contaFinanceira.findFirst({ where: { id, ativo: true }, select: { id: true } });
  return c?.id ?? null;
}

/** Mesma ordem de contaRecebimentoVendaId: configuração, conta padrão, caixa mais usado. */
async function contaRecebimentoPadrao(db: Db): Promise<number | null> {
  const cfg = await db.configuracao.findUnique({ where: { chave: 'vendas.contaRecebimentoId' } });
  if (cfg && Number(cfg.valor)) {
    const c = await db.contaFinanceira.findFirst({ where: { id: Number(cfg.valor), ativo: true }, select: { id: true } });
    if (c) return c.id;
  }
  const padrao = await db.contaFinanceira.findFirst({ where: { ativo: true, padrao: true }, orderBy: [{ tipo: 'asc' }, { id: 'asc' }], select: { id: true } });
  if (padrao) return padrao.id;
  const caixas = await db.contaFinanceira.findMany({ where: { ativo: true, tipo: 'CAIXA' }, select: { id: true } });
  if (caixas.length) {
    const uso = await db.movimentoFinanceiro.groupBy({ by: ['contaFinanceiraId'], where: { contaFinanceiraId: { in: caixas.map((c) => c.id) } }, _count: { _all: true } });
    uso.sort((a, b) => b._count._all - a._count._all);
    return uso[0]?.contaFinanceiraId ?? caixas[0].id;
  }
  const qualquer = await db.contaFinanceira.findFirst({ where: { ativo: true }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }], select: { id: true } });
  return qualquer?.id ?? null;
}

/**
 * Uma taxa só, nesta ordem: taxa da conta que recebeu, senão a da forma de pagamento,
 * senão a faixa 1x–12x da empresa — esta última só no cartão (dinheiro, PIX, boleto e crediário não têm maquininha).
 */
export function taxaUnica(p: {
  valor: number;
  taxaContaPct?: number | null;
  taxaFormaPct?: number | null;
  tipoForma?: string | null;
  parcelas: number;
  cfg: CfgCustos;
}): number {
  if (!(p.valor > 0)) return 0;
  if ((p.taxaContaPct || 0) > 0) return arredondar(p.valor * ((p.taxaContaPct || 0) / 100));
  if ((p.taxaFormaPct || 0) > 0) return arredondar(p.valor * ((p.taxaFormaPct || 0) / 100));
  const tipo = p.tipoForma || '';
  if (tipo === 'CARTAO_CREDITO' || tipo === '') {
    const vezes = tipo === '' ? 1 : Math.max(1, p.parcelas || 1);
    return arredondar(p.valor * (taxaCartaoPct(vezes, p.cfg) / 100));
  }
  if (tipo === 'CARTAO_DEBITO') return arredondar(p.valor * (taxaCartaoPct(1, p.cfg) / 100));
  return 0;
}

function vencimentoDas(competencia: string): Date {
  const [ano, mes] = competencia.split('-').map(Number);
  const d = new Date(ano, mes, 20, 12, 0, 0, 0);
  return d;
}

function parseVendasDas(obs: string | null | undefined): Map<number, number> {
  const map = new Map<number, number>();
  const linha = (obs || '').split('\n').find((l) => l.startsWith('vendas='));
  if (!linha) return map;
  for (const parte of linha.slice('vendas='.length).split(',').filter(Boolean)) {
    const [id, val] = parte.split(':');
    const n = Number(id);
    const v = Number(val);
    if (Number.isInteger(n) && n > 0 && Number.isFinite(v)) map.set(n, arredondar(v));
  }
  return map;
}

function serializarDas(map: Map<number, number>, base: number) {
  const vendas = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([id, v]) => `${id}:${v.toFixed(2)}`).join(',');
  return `${MARCA_DAS}\nbase=${base.toFixed(2)}\nvendas=${vendas}`;
}

async function idsCategoriaDas(db: Db): Promise<number[]> {
  const cats = await db.categoriaFinanceira.findMany({ where: { tipo: 'DESPESA', grupoDre: 'DEDUCAO' }, select: { id: true, nome: true } });
  return cats.filter((c) => /imposto|simples|das\b/i.test(c.nome)).map((c) => c.id);
}

async function somarDasReal(db: Db, competencia: string): Promise<number> {
  const ids = await idsCategoriaDas(db);
  if (!ids.length) return 0;
  const contas = await db.contaPagar.findMany({
    where: {
      competencia,
      situacao: { not: 'CANCELADO' },
      categoriaId: { in: ids },
      // observação nula também entra: em SQL, NOT LIKE não pega NULL
      OR: [{ observacoes: null }, { NOT: { observacoes: { contains: MARCA_DAS } } }],
    },
    select: { valor: true },
  });
  return arredondar(contas.reduce((s, c) => s + c.valor, 0));
}

async function gravarPrevisaoDas(tx: TxDb, competencia: string, map: Map<number, number>) {
  const base = arredondar([...map.values()].reduce((s, v) => s + v, 0));
  const catId = await categoriaPadraoId(tx, CAT_DAS, 'DESPESA', 'DEDUCAO');
  const abatido = await somarDasReal(tx, competencia);
  const previsto = arredondar(Math.max(0, base - abatido));
  const obs = serializarDas(map, base);
  const atual = await tx.contaPagar.findFirst({
    where: { origemTipo: 'IMPOSTO', competencia, observacoes: { contains: MARCA_DAS } },
    orderBy: { id: 'desc' },
  });
  const descricao = `Previsão de DAS ${competencia} (Simples Nacional)`;
  const vencimento = vencimentoDas(competencia);
  if (!atual) {
    if (base < 0.01) return;
    await tx.contaPagar.create({
      data: {
        descricao,
        dataEmissao: vencimento,
        vencimento,
        competencia,
        valor: previsto,
        situacao: previsto < 0.01 ? 'CANCELADO' : 'ABERTO',
        categoriaId: catId,
        origemTipo: 'IMPOSTO',
        observacoes: obs,
      },
    });
    return;
  }
  // Já foi paga: o dinheiro saiu. Não reabre nem reduz por baixo do que foi pago.
  if (atual.situacao === 'PAGO' || atual.valorPago > 0.009) {
    await tx.contaPagar.update({ where: { id: atual.id }, data: { observacoes: obs } });
    return;
  }
  await tx.contaPagar.update({
    where: { id: atual.id },
    data: {
      descricao,
      vencimento,
      competencia,
      categoriaId: catId,
      observacoes: obs,
      valor: previsto,
      situacao: previsto < 0.01 ? 'CANCELADO' : 'ABERTO',
    },
  });
}

async function ajustarPrevisaoDasDaVenda(tx: TxDb, vendaId: number, imposto: number | null) {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, select: { data: true } });
  if (!venda) return;
  const competencia = competenciaDe(venda.data);
  const atual = await tx.contaPagar.findFirst({
    where: { origemTipo: 'IMPOSTO', competencia, observacoes: { contains: MARCA_DAS } },
    orderBy: { id: 'desc' },
  });
  const map = parseVendasDas(atual?.observacoes);
  if (imposto == null || imposto < 0.01) map.delete(vendaId);
  else map.set(vendaId, arredondar(imposto));
  await gravarPrevisaoDas(tx, competencia, map);
}

/** O DAS real (guia lançada na competência, categoria de imposto/DAS) abate a previsão para não pagar duas vezes. */
export async function recalcularPrevisaoDas(db: Db, competencia: string | null | undefined) {
  if (!competencia) return;
  const rodar = async (tx: TxDb) => {
    const atual = await tx.contaPagar.findFirst({
      where: { origemTipo: 'IMPOSTO', competencia, observacoes: { contains: MARCA_DAS } },
      orderBy: { id: 'desc' },
    });
    await gravarPrevisaoDas(tx, competencia, parseVendasDas(atual?.observacoes));
  };
  if (db === prisma) await prisma.$transaction(rodar);
  else await rodar(db as TxDb);
}

export async function aoMudarContaQuePodeSerDas(conta: { competencia?: string | null; categoriaId?: number | null; observacoes?: string | null; origemTipo?: string | null; descricao?: string | null }) {
  if (!conta.competencia) return;
  const marca = (conta.observacoes || '').includes(MARCA_DAS) || conta.origemTipo === 'IMPOSTO';
  let categoriaDas = false;
  if (conta.categoriaId) {
    const cat = await prisma.categoriaFinanceira.findUnique({ where: { id: conta.categoriaId }, select: { nome: true, grupoDre: true } });
    categoriaDas = !!cat && cat.grupoDre === 'DEDUCAO' && /imposto|simples|das\b/i.test(cat.nome);
  }
  const texto = /das\b|simples nacional/i.test(conta.descricao || '');
  if (!marca && !categoriaDas && !texto) return;
  await recalcularPrevisaoDas(prisma, conta.competencia);
}

async function reverterPagamentos(tx: TxDb, contaId: number) {
  const movs = await tx.movimentoFinanceiro.findMany({ where: { contaPagarId: contaId } });
  for (const m of movs) {
    const delta = m.tipo === 'SAIDA' ? m.valor : m.tipo === 'ENTRADA' ? -m.valor : 0;
    if (delta) await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { increment: arredondar(delta) } } });
    await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
  }
}

async function cancelarSaida(tx: TxDb, id: number) {
  await reverterPagamentos(tx, id);
  await tx.contaPagar.update({
    where: { id },
    data: { situacao: 'CANCELADO', valorPago: 0, juros: 0, desconto: 0, dataPagamento: null },
  });
}

async function garantirSaidaPaga(tx: TxDb, p: { vendaId: number; marca: string; valor: number; contaId: number | null; categoriaId: number; descricao: string; data: Date; competencia: string }) {
  const existentes = await tx.contaPagar.findMany({
    where: { origemTipo: 'VENDA', origemId: p.vendaId, observacoes: { contains: p.marca }, situacao: { not: 'CANCELADO' } },
    orderBy: { id: 'asc' },
  });
  const alvo = existentes[0];
  for (const extra of existentes.slice(1)) await cancelarSaida(tx, extra.id);
  if (p.valor < 0.01 || !p.contaId) {
    if (alvo) await cancelarSaida(tx, alvo.id);
    return;
  }
  const movs = alvo ? await tx.movimentoFinanceiro.findMany({ where: { contaPagarId: alvo.id } }) : [];
  const igual =
    !!alvo &&
    alvo.situacao === 'PAGO' &&
    Math.abs(alvo.valor - p.valor) < 0.01 &&
    alvo.categoriaId === p.categoriaId &&
    movs.length === 1 &&
    movs[0].contaFinanceiraId === p.contaId &&
    Math.abs(movs[0].valor - p.valor) < 0.01;
  if (igual) return;
  let id = alvo?.id;
  if (alvo) await reverterPagamentos(tx, alvo.id);
  if (!id) {
    const criada = await tx.contaPagar.create({
      data: {
        descricao: p.descricao,
        dataEmissao: p.data,
        vencimento: p.data,
        competencia: p.competencia,
        valor: p.valor,
        situacao: 'ABERTO',
        categoriaId: p.categoriaId,
        origemTipo: 'VENDA',
        origemId: p.vendaId,
        parcela: p.marca,
        observacoes: p.marca,
      },
    });
    id = criada.id;
  } else {
    await tx.contaPagar.update({
      where: { id },
      data: {
        descricao: p.descricao,
        vencimento: p.data,
        competencia: p.competencia,
        valor: p.valor,
        valorPago: 0,
        juros: 0,
        desconto: 0,
        situacao: 'ABERTO',
        dataPagamento: null,
        categoriaId: p.categoriaId,
        contaFinanceiraId: null,
        parcela: p.marca,
        observacoes: p.marca,
      },
    });
  }
  await baixarContaPagar({ id, valor: p.valor, data: p.data, contaFinanceiraId: p.contaId, observacoes: p.marca }, tx);
  await tx.contaPagar.update({ where: { id }, data: { observacoes: p.marca, parcela: p.marca } });
}

async function montarPlano(db: Db, vendaId: number): Promise<Plano | null> {
  const venda = await db.venda.findUnique({
    where: { id: vendaId },
    include: {
      situacao: { select: { cancelamento: true } },
      itens: { include: { produto: { select: { id: true, precoCusto: true } } } },
      parcelas: { include: { formaPagamento: { select: { id: true, tipo: true, taxaPct: true, contaFinanceiraId: true } }, contaReceber: true } },
    },
  });
  if (!venda || venda.tipo !== 'PEDIDO') return null;
  const produtoIds = venda.itens.map((i) => i.produtoId).filter((x): x is number => !!x);
  const consignados = new Set(
    produtoIds.length
      ? (await db.consignacao.findMany({ where: { produtoId: { in: produtoIds } }, select: { produtoId: true } })).map((c) => c.produtoId)
      : [],
  );
  const itensSemCusto: string[] = [];
  let custoProduto = 0;
  for (const item of venda.itens) {
    if (item.produtoId && consignados.has(item.produtoId)) continue;
    const doItem = item.custoUnitario > 0 ? item.custoUnitario : item.produto?.precoCusto && item.produto.precoCusto > 0 ? item.produto.precoCusto : 0;
    if (!(doItem > 0)) {
      itensSemCusto.push(item.descricao);
      continue;
    }
    custoProduto += doItem * item.quantidade;
  }
  custoProduto = arredondar(custoProduto);
  const frete = arredondar((venda.custoLogistica || 0) > 0 ? venda.custoLogistica : 0);
  const cfg = await carregarCfgCustos();
  const crIds = venda.parcelas.map((p) => p.contaReceberId).filter((x): x is number => !!x);
  const movs = crIds.length
    ? await db.movimentoFinanceiro.findMany({
        where: { contaReceberId: { in: crIds }, tipo: 'ENTRADA', observacoes: OBS_RECEBIDO },
        select: { contaFinanceiraId: true, valor: true, contaReceberId: true },
      })
    : [];
  const contaDoRecebimento = new Map<number, number>();
  const entradasPorConta = new Map<number, number>();
  for (const m of movs) {
    if (m.contaReceberId) contaDoRecebimento.set(m.contaReceberId, m.contaFinanceiraId);
    entradasPorConta.set(m.contaFinanceiraId, (entradasPorConta.get(m.contaFinanceiraId) || 0) + m.valor);
  }
  const contasTaxa = await db.contaFinanceira.findMany({
    where: { id: { in: [...new Set([...contaDoRecebimento.values(), ...venda.parcelas.map((p) => p.formaPagamento?.contaFinanceiraId).filter((x): x is number => !!x)])] } },
    select: { id: true, taxaRecebimentoPct: true, ativo: true },
  });
  const taxaConta = new Map(contasTaxa.map((c) => [c.id, c.taxaRecebimentoPct]));
  const credito = venda.parcelas.filter((p) => p.formaPagamento?.tipo === 'CARTAO_CREDITO');
  const vezesCredito = Math.max(1, ...credito.map((p) => p.parcelasCartao || 0), credito.length);
  const taxaDeParcela = (valor: number, contaId: number | null, forma: { taxaPct?: number | null; tipo?: string | null } | null) =>
    taxaUnica({
      valor,
      taxaContaPct: contaId ? taxaConta.get(contaId) : 0,
      taxaFormaPct: forma?.taxaPct,
      tipoForma: forma?.tipo,
      parcelas: forma?.tipo === 'CARTAO_CREDITO' ? vezesCredito : 1,
      cfg,
    });
  let taxa = 0;
  let recebido = 0;
  const taxaPorConta = new Map<number, number>();
  for (const p of venda.parcelas) {
    const entrou = arredondar(p.contaReceber?.valorRecebido || 0);
    if (entrou < 0.01) continue;
    recebido += entrou;
    const contaId = (p.contaReceberId && contaDoRecebimento.get(p.contaReceberId)) || p.contaReceber?.contaFinanceiraId || null;
    const pedaco = taxaDeParcela(entrou, contaId, p.formaPagamento);
    taxa += pedaco;
    if (contaId && pedaco > 0) taxaPorConta.set(contaId, (taxaPorConta.get(contaId) || 0) + pedaco);
  }
  recebido = arredondar(recebido);
  const taxaLancada = arredondar(taxa);
  taxa = taxaLancada;
  const previsto = recebido < 0.01;
  if (previsto) {
    for (const p of venda.parcelas) {
      if (!p.formaPagamento || !TIPOS_PAGO_NA_HORA.includes(p.formaPagamento.tipo) || !(p.valor > 0)) continue;
      recebido += p.valor;
      const pedaco = taxaDeParcela(p.valor, p.formaPagamento.contaFinanceiraId, p.formaPagamento);
      taxa += pedaco;
    }
    recebido = arredondar(recebido);
    taxa = arredondar(taxa);
  }
  const maiorEntrada = [...entradasPorConta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const maiorTaxa = [...taxaPorConta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? maiorEntrada;
  const [contaSaidasCfg, contaCustoCfg, contaPadrao] = await Promise.all([contaConfigurada(db, CHAVE_CONTA_SAIDAS), contaConfigurada(db, CHAVE_CONTA_CUSTO), contaRecebimentoPadrao(db)]);
  const contaQueRecebeu = maiorEntrada || contaPadrao;
  const contaSaidas = contaSaidasCfg || contaQueRecebeu;
  const lancadas = await db.contaPagar.findMany({
    where: { origemTipo: 'VENDA', origemId: vendaId, situacao: { not: 'CANCELADO' } },
    select: { observacoes: true },
  });
  const marcas = lancadas.map((c) => c.observacoes || '').join('\n');
  const impostoPct = cfg.impostoPct;
  const imposto = venda.situacao.cancelamento ? 0 : arredondar(venda.total * (impostoPct / 100));
  return {
    ignorar: venda.situacao.cancelamento,
    numero: venda.numero,
    data: venda.data,
    competencia: competenciaDe(venda.data),
    custoProduto,
    custoPendente: itensSemCusto.length > 0,
    itensSemCusto,
    frete,
    taxaLancada: venda.situacao.cancelamento ? 0 : taxaLancada,
    taxa: venda.situacao.cancelamento ? 0 : taxa,
    imposto,
    impostoPct,
    recebido,
    previsto,
    contaCmv: contaCustoCfg || contaSaidas,
    contaFrete: contaSaidas,
    contaTaxa: maiorTaxa || contaSaidas,
    lancado: { cmv: marcas.includes(MARCA_CMV), frete: marcas.includes(MARCA_FRETE), taxa: marcas.includes(MARCA_TAXA) },
  };
}

export function resumoDe(plano: Plano): ResumoCaixaVenda {
  const liquido = arredondar(plano.recebido - plano.custoProduto - plano.frete - plano.taxa - plano.imposto);
  return {
    recebido: plano.recebido,
    previsto: plano.previsto,
    custoProduto: plano.custoProduto,
    custoPendente: plano.custoPendente,
    itensSemCusto: plano.itensSemCusto,
    frete: plano.frete,
    taxa: plano.taxa,
    impostoPrevisto: plano.imposto,
    impostoPct: plano.impostoPct,
    liquido,
    lancado: plano.lancado,
  };
}

export async function resumoCaixaDaVenda(db: Db, vendaId: number): Promise<ResumoCaixaVenda | null> {
  const plano = await montarPlano(db, vendaId);
  if (!plano) return null;
  return resumoDe(plano);
}

/** Lança ou atualiza CMV, frete, taxa e a previsão de DAS. Chamar de novo não duplica. */
export async function sincronizarSaidasDaVenda(tx: TxDb, vendaId: number) {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, select: { contasLancadas: true, tipo: true } });
  if (!venda || venda.tipo !== 'PEDIDO' || !venda.contasLancadas) return;
  const plano = await montarPlano(tx, vendaId);
  if (!plano || plano.ignorar) return;
  const [catCmv, catFrete, catTaxa] = await Promise.all([
    categoriaPadraoId(tx, CAT_CMV, 'DESPESA', 'CMV'),
    categoriaPadraoId(tx, CAT_FRETE, 'DESPESA', 'DESPESA_OPERACIONAL'),
    categoriaPadraoId(tx, CAT_TAXA, 'DESPESA', 'DESPESA_OPERACIONAL'),
  ]);
  const base = { vendaId, data: plano.data, competencia: plano.competencia };
  await garantirSaidaPaga(tx, { ...base, marca: MARCA_CMV, valor: plano.custoProduto, contaId: plano.contaCmv, categoriaId: catCmv, descricao: `Custo de mercadoria — venda nº ${plano.numero}` });
  await garantirSaidaPaga(tx, { ...base, marca: MARCA_FRETE, valor: plano.frete, contaId: plano.contaFrete, categoriaId: catFrete, descricao: `Frete — venda nº ${plano.numero}` });
  await garantirSaidaPaga(tx, { ...base, marca: MARCA_TAXA, valor: plano.taxaLancada, contaId: plano.contaTaxa, categoriaId: catTaxa, descricao: `Taxa de cartão — venda nº ${plano.numero}` });
  await ajustarPrevisaoDasDaVenda(tx, vendaId, plano.imposto);
}

/** Estorna CMV, frete e taxa e tira o imposto desta venda da previsão do mês. */
export async function estornarSaidasDaVenda(tx: TxDb, vendaId: number) {
  const contas = await tx.contaPagar.findMany({ where: { origemTipo: 'VENDA', origemId: vendaId, situacao: { not: 'CANCELADO' } } });
  for (const c of contas) await cancelarSaida(tx, c.id);
  await ajustarPrevisaoDasDaVenda(tx, vendaId, null);
}

/**
 * Vendas do período que já estavam fechadas antes desta regra (ou ficaram sem o lançamento):
 * mostra o custo real que não saiu do caixa. Não gera movimento.
 */
export async function relatorioCustoNaoLancado(ini: Date, fim: Date) {
  const vendas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', data: { gte: ini, lte: fim }, situacao: { cancelamento: false }, OR: [{ contasLancadas: true }, { situacao: { final: true } }] },
    select: {
      id: true,
      numero: true,
      data: true,
      total: true,
      custoLogistica: true,
      itens: { select: { descricao: true, quantidade: true, custoUnitario: true, produtoId: true, produto: { select: { precoCusto: true } } } },
    },
    orderBy: [{ data: 'asc' }, { numero: 'asc' }],
  });
  const ids = vendas.map((v) => v.id);
  const produtoIds = [...new Set(vendas.flatMap((v) => v.itens.map((i) => i.produtoId).filter((x): x is number => !!x)))];
  const [lancadas, consignados] = await Promise.all([
    ids.length
      ? prisma.contaPagar.findMany({
          where: { origemTipo: 'VENDA', origemId: { in: ids }, situacao: { not: 'CANCELADO' }, OR: [{ observacoes: { contains: MARCA_CMV } }, { observacoes: { contains: MARCA_FRETE } }] },
          select: { origemId: true, valor: true, observacoes: true },
        })
      : [],
    produtoIds.length ? prisma.consignacao.findMany({ where: { produtoId: { in: produtoIds } }, select: { produtoId: true } }) : [],
  ]);
  const cons = new Set(consignados.map((c) => c.produtoId));
  const porVenda = new Map<number, { cmv: number; frete: number }>();
  for (const l of lancadas) {
    if (!l.origemId) continue;
    const a = porVenda.get(l.origemId) || { cmv: 0, frete: 0 };
    if ((l.observacoes || '').includes(MARCA_CMV)) a.cmv += l.valor;
    if ((l.observacoes || '').includes(MARCA_FRETE)) a.frete += l.valor;
    porVenda.set(l.origemId, a);
  }
  const linhas: {
    id: number;
    numero: number;
    data: Date;
    total: number;
    custoReal: number;
    custoLancado: number;
    custoNaoLancado: number;
    frete: number;
    freteLancado: number;
    freteNaoLancado: number;
    itensSemCusto: number;
  }[] = [];
  for (const v of vendas) {
    let custoReal = 0;
    let semCusto = 0;
    for (const item of v.itens) {
      if (item.produtoId && cons.has(item.produtoId)) continue;
      const doItem = item.custoUnitario > 0 ? item.custoUnitario : item.produto?.precoCusto && item.produto.precoCusto > 0 ? item.produto.precoCusto : 0;
      if (!(doItem > 0)) {
        semCusto++;
        continue;
      }
      custoReal += doItem * item.quantidade;
    }
    custoReal = arredondar(custoReal);
    const frete = arredondar((v.custoLogistica || 0) > 0 ? v.custoLogistica : 0);
    const posto = porVenda.get(v.id) || { cmv: 0, frete: 0 };
    const custoNaoLancado = arredondar(Math.max(0, custoReal - posto.cmv));
    const freteNaoLancado = arredondar(Math.max(0, frete - posto.frete));
    if (custoNaoLancado < 0.01 && freteNaoLancado < 0.01 && semCusto === 0) continue;
    linhas.push({
      id: v.id,
      numero: v.numero,
      data: v.data,
      total: v.total,
      custoReal,
      custoLancado: arredondar(posto.cmv),
      custoNaoLancado,
      frete,
      freteLancado: arredondar(posto.frete),
      freteNaoLancado,
      itensSemCusto: semCusto,
    });
  }
  const tot = (k: 'custoNaoLancado' | 'freteNaoLancado') => arredondar(linhas.reduce((s, l) => s + l[k], 0));
  return {
    periodo: { dataInicial: ini, dataFinal: fim },
    aviso:
      'Não gera lançamento. Mostra o custo real e o frete informado que não saíram do caixa (venda antiga ou item ainda sem custo). A estimativa de 40–70% e o frete padrão de R$ 10 não entram — eles não são dinheiro que saiu.',
    vendas: linhas,
    totais: { vendas: linhas.length, custoNaoLancado: tot('custoNaoLancado'), freteNaoLancado: tot('freteNaoLancado') },
  };
}
