/**
 * Regras de negócio das vendas: cálculo de totais, montagem dos itens/parcelas,
 * handlers das ações do motor de situações (estoque, contas, comissões, reserva, NF-e).
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar, competenciaDe } from '../../lib/util.js';
import { historico, situacoesPermitidas, type ContextoAcao } from '../../core/situacoes.js';
import { linkPublico, tokenPublico } from '../publico/token.js';
import { depositoPadraoId, liberarReservas, movimentarEstoque, movimentaEstoque, reservarItens, reservasAtivas } from '../comum/estoque.js';
import { alocarComprasParaVenda, desalocarComprasDaVenda } from '../compras/service.js';
import { cancelarComissoes, cancelarContasReceber, categoriaPadraoId, recriarComissoes } from '../comum/financeiro.js';
import { criarNotaPendente } from '../comum/nfe.js';
import { hojeMeioDia } from '../comum/datas.js';
import type { ItemInput, ParcelaInput, VendaInput } from './schemas.js';

type Db = Tx | typeof prisma;

// ---------------------------------------------------------------- includes
export const includeLista = {
  contato: { select: { id: true, nome: true, fantasia: true, documento: true, celular: true, email: true } },
  vendedor: { select: { id: true, nome: true } },
  situacao: { select: { id: true, nome: true, cor: true, final: true, cancelamento: true } },
  nota: { select: { id: true, numero: true, serie: true, modelo: true, situacao: true, chave: true } },
} as const;

export const includeCompleto = {
  ...includeLista,
  contato: true,
  transportadora: { select: { id: true, nome: true, documento: true } },
  deposito: { select: { id: true, nome: true } },
  categoriaFinanceira: { select: { id: true, nome: true } },
  itens: { orderBy: { ordem: 'asc' as const }, include: { produto: { select: { id: true, nome: true, codigo: true, tipo: true, controlaEstoque: true, unidade: true, ncm: true } } } },
  parcelas: {
    orderBy: { numero: 'asc' as const },
    include: {
      formaPagamento: { select: { id: true, nome: true, tipo: true, codigoFiscal: true } },
      contaReceber: { select: { id: true, situacao: true, valorRecebido: true, valor: true, vencimento: true, dataRecebimento: true } },
    },
  },
  comissoes: { include: { vendedor: { select: { id: true, nome: true } } } },
} as const;

export async function carregarVenda(db: Db, id: number) {
  const v = await db.venda.findUnique({ where: { id }, include: includeCompleto });
  if (!v) throw new NotFound('Venda');
  return v;
}

/** Venda completa + histórico + situações permitidas (resposta de GET /vendas/:id). */
export async function vendaCompleta(id: number) {
  const v = await carregarVenda(prisma, id);
  const [hist, permitidas] = await Promise.all([historico('VENDA', id), situacoesPermitidas('VENDA', v.situacaoId)]);
  return { ...v, historico: hist, situacoesPermitidas: permitidas.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })), tokenPublico: tokenPublico('venda', id), linkPublico: linkPublico('venda', id) };
}

// ---------------------------------------------------------------- cálculo
export interface ItemCalculado {
  produtoId: number | null;
  codigo: string | null;
  descricao: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total: number;
  custoUnitario: number;
  comissaoPct: number;
  comissaoValor: number;
  ordem: number;
}

export interface TotaisVenda {
  totalProdutos: number;
  descontoCalculado: number;
  total: number;
  custoTotal: number;
}

/**
 * Monta os itens com dados do produto (custo, descrição, unidade) e calcula os totais.
 * `comissaoPct` default = comissão padrão do vendedor.
 */
export async function montarItens(db: Db, itens: ItemInput[], comissaoPadraoPct: number): Promise<ItemCalculado[]> {
  const ids = [...new Set(itens.map((i) => i.produtoId).filter((x): x is number => !!x))];
  const produtos = ids.length ? await db.produto.findMany({ where: { id: { in: ids } } }) : [];
  const mapa = new Map(produtos.map((p) => [p.id, p]));
  return itens.map((i, idx) => {
    const p = i.produtoId ? mapa.get(i.produtoId) : undefined;
    if (i.produtoId && !p) throw new AppError(`Produto ${i.produtoId} do item ${idx + 1} não encontrado.`, 422, 'PRODUTO');
    const descricao = (i.descricao || p?.nome || '').trim();
    if (!descricao) throw new AppError(`Item ${idx + 1}: informe a descrição ou o produto.`, 422, 'ITEM');
    const quantidade = i.quantidade;
    const valorUnitario = i.valorUnitario ?? p?.preco ?? 0;
    const desconto = arredondar(i.desconto || 0);
    const total = arredondar(quantidade * valorUnitario - desconto);
    if (total < 0) throw new AppError(`Item ${idx + 1}: desconto maior que o valor do item.`, 422, 'ITEM');
    const comissaoPct = i.comissaoPct ?? comissaoPadraoPct ?? 0;
    return {
      produtoId: p?.id ?? null,
      codigo: i.codigo ?? p?.codigo ?? null,
      descricao,
      unidade: i.unidade || p?.unidade || 'UN',
      quantidade,
      valorUnitario,
      desconto,
      total,
      custoUnitario: p?.precoCusto ?? 0,
      comissaoPct,
      comissaoValor: arredondar(total * (comissaoPct / 100)),
      ordem: idx,
    };
  });
}

export function calcularTotais(itens: ItemCalculado[], v: { descontoTipo: string; descontoValor: number; frete: number; outrasDespesas: number }): TotaisVenda {
  const totalProdutos = arredondar(itens.reduce((s, i) => s + i.total, 0));
  const descontoCalculado = v.descontoTipo === 'PERCENTUAL' ? arredondar(totalProdutos * (v.descontoValor / 100)) : arredondar(v.descontoValor);
  if (descontoCalculado > totalProdutos) throw new AppError('Desconto maior que o total dos produtos.', 422, 'DESCONTO');
  const total = arredondar(totalProdutos - descontoCalculado + (v.frete || 0) + (v.outrasDespesas || 0));
  const custoTotal = arredondar(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));
  return { totalProdutos, descontoCalculado, total, custoTotal };
}

/** Monta as parcelas; se vazio cria 1 à vista com o total. Valida a soma (tolerância 1 centavo e ajusta a última). */
export async function montarParcelas(db: Db, parcelas: ParcelaInput[], total: number, dataBase: Date) {
  if (!parcelas.length) {
    const fp = await db.formaPagamento.findFirst({ where: { ativo: true }, orderBy: { id: 'asc' } });
    return [{ numero: 1, dataVencimento: dataBase, valor: total, formaPagamentoId: fp?.id ?? null, observacoes: null as string | null }];
  }
  const lista = parcelas.map((p, i) => ({
    numero: i + 1,
    dataVencimento: p.dataVencimento || dataBase,
    valor: arredondar(p.valor),
    formaPagamentoId: p.formaPagamentoId ?? null,
    observacoes: p.observacoes ?? null,
  }));
  const soma = arredondar(lista.reduce((s, p) => s + p.valor, 0));
  const diff = arredondar(total - soma);
  if (Math.abs(diff) > 0.05) {
    throw new AppError(`A soma das parcelas (${soma.toFixed(2)}) difere do total da venda (${total.toFixed(2)}).`, 422, 'PARCELAS', { soma, total });
  }
  if (diff !== 0) lista[lista.length - 1].valor = arredondar(lista[lista.length - 1].valor + diff);
  return lista;
}

/** Gera parcelas iguais (não salva). */
export function gerarParcelas(total: number, quantidade: number, primeiroVencimento: Date, intervaloDias: number, formaPagamentoId: number | null) {
  const base = Math.floor((total / quantidade) * 100) / 100;
  const parcelas = [];
  let acumulado = 0;
  for (let i = 0; i < quantidade; i++) {
    const venc = new Date(primeiroVencimento);
    venc.setDate(venc.getDate() + intervaloDias * i);
    const valor = i === quantidade - 1 ? arredondar(total - acumulado) : base;
    acumulado = arredondar(acumulado + valor);
    parcelas.push({ numero: i + 1, dataVencimento: venc, valor, formaPagamentoId, observacoes: null });
  }
  return parcelas;
}

/** Vendedor + comissão padrão (vendedorId pode ser nulo). */
export async function comissaoPadraoVendedor(db: Db, vendedorId: number | null | undefined) {
  if (!vendedorId) return 0;
  const v = await db.vendedor.findUnique({ where: { id: vendedorId } });
  if (!v) throw new AppError('Vendedor não encontrado.', 422, 'VENDEDOR');
  return v.comissaoPadraoPct;
}

/** Prepara os dados (itens, parcelas, totais) de um body validado. */
export async function prepararVenda(db: Db, body: VendaInput) {
  const contato = await db.contato.findUnique({ where: { id: body.contatoId } });
  if (!contato) throw new AppError('Cliente não encontrado.', 422, 'CONTATO');
  const comissaoPadrao = await comissaoPadraoVendedor(db, body.vendedorId);
  const itens = await montarItens(db, body.itens, comissaoPadrao);
  const totais = calcularTotais(itens, body);
  const data = body.data || hojeMeioDia();
  const parcelas = await montarParcelas(db, body.parcelas, totais.total, data);
  return { contato, itens, totais, parcelas, data };
}

// ---------------------------------------------------------------- AÇÕES (motor de situações)

export async function acaoLancarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const venda = await tx.venda.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!venda) throw new NotFound('Venda');
  if (venda.estoqueLancado) return; // idempotente
  const depositoId = venda.depositoId || (await depositoPadraoId(tx));
  for (const it of venda.itens) {
    if (!it.produtoId || !movimentaEstoque(it.produto)) continue;
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId,
      tipo: 'SAIDA',
      quantidade: it.quantidade,
      custoUnitario: it.custoUnitario,
      origemTipo: 'VENDA',
      origemId: venda.id,
      observacao: `Venda nº ${venda.numero}`,
      usuarioId: ctx.usuarioId,
    });
  }
  await liberarReservas(tx, 'VENDA', venda.id, `Baixa da venda nº ${venda.numero}`, ctx.usuarioId);
  await tx.venda.update({ where: { id }, data: { estoqueLancado: true, depositoId, dataSaida: venda.dataSaida || new Date() } });
  // compra de origem da mercadoria vira "Vendido" automaticamente
  await alocarComprasParaVenda(tx, id, ctx.usuarioId);
}

export async function acaoEstornarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const venda = await tx.venda.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!venda) throw new NotFound('Venda');
  if (!venda.estoqueLancado) return;
  // itens não mudam enquanto o estoque está lançado (PUT bloqueado), então o estorno
  // é a entrada exata dos itens no depósito usado na baixa
  const depositoId = venda.depositoId || (await depositoPadraoId(tx));
  for (const it of venda.itens) {
    if (!it.produtoId || !movimentaEstoque(it.produto)) continue;
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId,
      tipo: 'ENTRADA',
      quantidade: it.quantidade,
      custoUnitario: it.custoUnitario,
      origemTipo: 'VENDA',
      origemId: id,
      observacao: `Estorno venda nº ${venda.numero}`,
      usuarioId: ctx.usuarioId,
    });
  }
  await tx.venda.update({ where: { id }, data: { estoqueLancado: false } });
  await desalocarComprasDaVenda(tx, id, ctx.usuarioId);
}

export async function acaoLancarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const venda = await tx.venda.findUnique({ where: { id }, include: { parcelas: { orderBy: { numero: 'asc' } }, itens: true, vendedor: true } });
  if (!venda) throw new NotFound('Venda');
  if (venda.contasLancadas) return;
  const categoriaId = venda.categoriaFinanceiraId || (await categoriaPadraoId(tx, 'Venda de produtos', 'RECEITA', 'RECEITA_BRUTA'));
  const competencia = competenciaDe(venda.data);
  const n = venda.parcelas.length;
  for (const p of venda.parcelas) {
    if (p.contaReceberId) {
      // reativa conta cancelada anteriormente (re-lançamento)
      await tx.contaReceber.update({ where: { id: p.contaReceberId }, data: { situacao: 'ABERTO', valor: p.valor, vencimento: p.dataVencimento, formaPagamentoId: p.formaPagamentoId } });
      continue;
    }
    const cr = await tx.contaReceber.create({
      data: {
        contatoId: venda.contatoId,
        vendedorId: venda.vendedorId,
        descricao: `Venda nº ${venda.numero} (${p.numero}/${n})`,
        dataEmissao: venda.data,
        vencimento: p.dataVencimento,
        competencia,
        valor: p.valor,
        situacao: 'ABERTO',
        formaPagamentoId: p.formaPagamentoId,
        categoriaId,
        origemTipo: 'VENDA',
        origemId: venda.id,
        parcela: `${p.numero}/${n}`,
        observacoes: p.observacoes,
      },
    });
    await tx.vendaParcela.update({ where: { id: p.id }, data: { contaReceberId: cr.id } });
  }
  // comissões do vendedor
  if (venda.vendedorId) {
    const base = arredondar(venda.itens.reduce((s, i) => s + (i.comissaoPct > 0 ? i.total : 0), 0));
    const valor = arredondar(venda.itens.reduce((s, i) => s + i.comissaoValor, 0));
    const pct = base > 0 ? arredondar((valor / base) * 100, 4) : 0;
    await recriarComissoes(tx, { origemTipo: 'VENDA', vendaId: venda.id }, competencia, [
      { tipo: 'VENDEDOR', vendedorId: venda.vendedorId, descricao: `Venda nº ${venda.numero}`, base, pct, valor },
    ]);
  }
  await tx.venda.update({ where: { id }, data: { contasLancadas: true } });
}

export async function acaoEstornarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const venda = await tx.venda.findUnique({ where: { id } });
  if (!venda) throw new NotFound('Venda');
  if (!venda.contasLancadas) return;
  await cancelarContasReceber(tx, 'VENDA', id);
  await cancelarComissoes(tx, { origemTipo: 'VENDA', vendaId: id });
  await tx.venda.update({ where: { id }, data: { contasLancadas: false } });
}

export async function acaoReservarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const venda = await tx.venda.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!venda) throw new NotFound('Venda');
  if (venda.estoqueLancado) return; // já baixado: nada a reservar
  const depositoId = venda.depositoId || (await depositoPadraoId(tx));
  const itens = venda.itens
    .filter((it) => it.produtoId && movimentaEstoque(it.produto))
    .map((it) => ({ produtoId: it.produtoId!, depositoId, quantidade: it.quantidade }));
  await reservarItens(tx, 'VENDA', id, itens, `Reserva venda nº ${venda.numero}`, ctx.usuarioId);
}

export async function acaoLiberarReserva(ctx: ContextoAcao) {
  const venda = await ctx.tx.venda.findUnique({ where: { id: ctx.entidadeId }, select: { numero: true } });
  if (!venda) throw new NotFound('Venda');
  await liberarReservas(ctx.tx, 'VENDA', ctx.entidadeId, `Liberação reserva venda nº ${venda.numero}`, ctx.usuarioId);
}

/** gerarNfe como ação automática: ignora se já existe nota não cancelada. */
export async function acaoGerarNfe(ctx: ContextoAcao) {
  const venda = await ctx.tx.venda.findUnique({ where: { id: ctx.entidadeId }, include: { nota: true } });
  if (!venda) throw new NotFound('Venda');
  if (venda.nota && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(venda.nota.situacao)) return;
  await gerarNfeDaVenda(ctx.tx, ctx.entidadeId, 55, null);
}

/** Cria a NotaFiscal PENDENTE da venda e vincula venda.notaId. Lança 422 se já houver nota não cancelada. */
export async function gerarNfeDaVenda(tx: Db, vendaId: number, modelo: 55 | 65, informacoesComplementares: string | null | undefined) {
  const venda = await tx.venda.findUnique({
    where: { id: vendaId },
    include: { nota: true, itens: { include: { produto: { select: { tipo: true } } } }, parcelas: { orderBy: { numero: 'asc' }, include: { formaPagamento: true } } },
  });
  if (!venda) throw new NotFound('Venda');
  if (venda.nota && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(venda.nota.situacao)) {
    throw new AppError(`A venda já possui a nota fiscal nº ${venda.nota.numero} (${venda.nota.situacao}).`, 422, 'NOTA_EXISTENTE', { notaId: venda.nota.id });
  }
  const itensProduto = venda.itens.filter((i) => i.produtoId && i.produto?.tipo === 'P');
  if (!itensProduto.length) throw new AppError('A venda não possui itens de produto para emitir NF-e.', 422, 'SEM_ITENS');
  const descontoGeral = venda.descontoTipo === 'PERCENTUAL' ? arredondar(venda.totalProdutos * (venda.descontoValor / 100)) : venda.descontoValor;
  const nota = await criarNotaPendente(tx, {
    modelo,
    contatoId: venda.contatoId,
    itens: itensProduto.map((i) => ({
      produtoId: i.produtoId,
      codigo: i.codigo,
      descricao: i.descricao,
      unidade: i.unidade,
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario,
      desconto: i.desconto,
      total: i.total,
    })),
    valorFrete: venda.frete,
    valorOutras: venda.outrasDespesas,
    descontoGeral,
    formaPagamentoFiscal: venda.parcelas[0]?.formaPagamento?.codigoFiscal || '99',
    fretePorConta: venda.fretePorConta,
    informacoesComplementares: [informacoesComplementares, `Pedido de venda nº ${venda.numero}`].filter(Boolean).join(' | '),
  });
  await tx.venda.update({ where: { id: vendaId }, data: { notaId: nota.id } });
  return nota;
}

/** A venda tem reserva de estoque ativa? */
export async function temReserva(id: number, db: Db = prisma) {
  return (await reservasAtivas(db, 'VENDA', id)).length > 0;
}
