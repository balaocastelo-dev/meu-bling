/**
 * Regras de negócio das vendas: cálculo de totais, montagem dos itens/parcelas,
 * handlers das ações do motor de situações (estoque, contas, comissões, reserva, NF-e).
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { mensagemPendencias, verificarNfe } from '../comum/nfe-checagem.js';
import { arredondar, competenciaDe, proximoNumero } from '../../lib/util.js';
import { executarAcoes, historico, mudarSituacao, situacaoInicial, situacoesPermitidas, type Acao, type ContextoAcao, type Modulo } from '../../core/situacoes.js';
import { eventos } from '../../core/eventos.js';
import { linkPublico, tokenPublico } from '../publico/token.js';
import { depositoPadraoId, liberarReservas, movimentarEstoque, movimentaEstoque, reservarItens, reservasAtivas } from '../comum/estoque.js';
import { alocarComprasParaVenda, desalocarComprasDaVenda } from '../compras/service.js';
import { cancelarComissoes, cancelarContasReceber, categoriaPadraoId, recriarComissoes } from '../comum/financeiro.js';
import { criarNotaPendente } from '../comum/nfe.js';
import { hojeMeioDia } from '../comum/datas.js';
import { carregarCfgCustos, custosVenda, type CfgCustos, type VendaParaCusto } from '../comum/custos-venda.js';
import { baixarContaReceber, saldoContaReceber } from '../financeiro/service.js';
import type { ItemInput, ParcelaInput, TipoVenda, VendaInput } from './schemas.js';

type Db = Tx | typeof prisma;

/** Módulo do motor de situações conforme o tipo do registro (orçamento tem situações próprias). */
export function moduloDe(tipo: string): Modulo {
  return tipo === 'ORCAMENTO' ? 'ORCAMENTO' : 'VENDA';
}
/** Nome da sequência de numeração por tipo. */
export function sequenciaDe(tipo: TipoVenda | string) {
  return tipo === 'ORCAMENTO' ? 'ORCAMENTO' : 'VENDA';
}

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
  itens: { orderBy: { ordem: 'asc' as const }, include: { produto: { select: { id: true, nome: true, codigo: true, tipo: true, controlaEstoque: true, unidade: true, ncm: true, imagemUrl: true, prontaEntrega: true } } } },
  parcelas: {
    orderBy: { numero: 'asc' as const },
    include: {
      formaPagamento: { select: { id: true, nome: true, tipo: true, codigoFiscal: true } },
      contaReceber: { select: { id: true, situacao: true, valorRecebido: true, valor: true, vencimento: true, dataRecebimento: true } },
    },
  },
  comissoes: { include: { vendedor: { select: { id: true, nome: true } } } },
  orcamento: { select: { id: true, numero: true } },
  vendaGerada: { select: { id: true, numero: true } },
} as const;

export async function carregarVenda(db: Db, id: number) {
  const v = await db.venda.findUnique({ where: { id }, include: includeCompleto });
  if (!v) throw new NotFound('Venda');
  return v;
}

/** Venda completa + histórico + situações permitidas (resposta de GET /vendas/:id). */
export async function vendaCompleta(id: number) {
  const v = await carregarVenda(prisma, id);
  const modulo = moduloDe(v.tipo);
  const [hist, permitidas] = await Promise.all([historico(modulo, id), situacoesPermitidas(modulo, v.situacaoId)]);
  return { ...v, fechamento: fechamentoVenda(v, await carregarCfgCustos()), historico: hist, situacoesPermitidas: permitidas.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })), tokenPublico: tokenPublico('venda', id), linkPublico: linkPublico('venda', id) };
}

/**
 * Fechamento interno da venda (ADMIN/GERENTE): custo dos produtos (informado pelo vendedor ou do cadastro)
 * + logística. Nunca vai para impressão, PDF, link público, e-mail ou WhatsApp.
 */
export function fechamentoVenda(
  v: Omit<VendaParaCusto, 'itens'> & { itens: { custoUnitario: number; quantidade: number; custoInformado?: boolean; produtoId?: number | null }[] },
  cfg: CfgCustos,
) {
  // custo completo: produto + imposto + taxa de cartão + frete (mesma regra do DRE e dos dashboards)
  const c = custosVenda(v, cfg);
  return {
    custoProdutos: c.produto,
    custoProdutoEstimado: c.produtoEstimado,
    custoProdutoPct: c.produtoPct,
    imposto: c.imposto,
    impostoPct: c.impostoPct,
    taxaCartao: c.taxaCartao,
    taxaCartaoPct: c.taxaCartaoPct,
    parcelasCartao: c.parcelasCartao,
    frete: c.frete,
    custoLogistica: c.frete,
    custoTotal: c.total,
    lucro: c.lucro,
    margemPct: c.margemPct,
    itensSemCusto: v.itens.filter((i) => !i.custoUnitario).length,
    itensCustoInformado: v.itens.filter((i) => i.custoInformado).length,
  };
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
  custoInformado: boolean;
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
  // linha digitada com o nome exato de um produto ativo: vincula ao cadastro (senão não baixa estoque nem sai na NF)
  const livres = [...new Set(itens.filter((i) => !i.produtoId && i.descricao?.trim()).map((i) => i.descricao!.trim()))];
  const porNome = new Map<string, (typeof produtos)[number]>();
  if (livres.length) {
    const variantes = [...new Set(livres.flatMap((d) => [d, d.toUpperCase()]))];
    const achados = await db.produto.findMany({ where: { ativo: true, nome: { in: variantes } } });
    for (const p of achados) if (!porNome.has(p.nome.trim().toUpperCase())) porNome.set(p.nome.trim().toUpperCase(), p);
  }
  return itens.map((i, idx) => {
    const p = i.produtoId ? mapa.get(i.produtoId) : i.descricao?.trim() ? porNome.get(i.descricao.trim().toUpperCase()) : undefined;
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
      custoUnitario: i.custoUnitario ?? p?.precoCusto ?? 0,
      custoInformado: i.custoUnitario !== null && i.custoUnitario !== undefined,
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

/** Orçamento não movimenta estoque/financeiro nem emite nota: lança 422 se tentarem. */
export function exigirPedido(v: { tipo: string }, acao: string) {
  if (v.tipo === 'ORCAMENTO') throw new AppError(`Orçamento não pode ${acao}. Converta em venda primeiro.`, 422, 'ORCAMENTO');
}

// ---------------------------------------------------------------- cópia (clonar / converter orçamento)
/**
 * Cria um novo registro copiando itens e parcelas de `orig` (custos atualizados pelo produto, vencimentos
 * deslocados a partir de hoje). Usado por "Clonar" e por "Converter orçamento em venda".
 */
export async function copiarVenda(
  tx: Tx,
  orig: Awaited<ReturnType<typeof carregarVenda>>,
  opts: { tipo: TipoVenda; situacaoId?: number | null; usuarioId: number | null; observacoesInternas: string; orcamentoId?: number | null; validade?: Date | null; historicoObs: string },
) {
  const modulo = moduloDe(opts.tipo);
  const situacao = opts.situacaoId
    ? await tx.situacao.findFirst({ where: { id: opts.situacaoId, modulo, ativo: true } })
    : await situacaoInicial(modulo, tx);
  if (!situacao) throw new AppError('Situação inválida.', 422, 'SITUACAO');
  const numero = await proximoNumero(sequenciaDe(opts.tipo), tx);
  const hoje = hojeMeioDia();
  const produtos = await tx.produto.findMany({ where: { id: { in: orig.itens.map((i) => i.produtoId).filter((x): x is number => !!x) } } });
  const custo = new Map(produtos.map((p) => [p.id, p.precoCusto]));
  const itens = orig.itens.map((i) => ({
    produtoId: i.produtoId,
    codigo: i.codigo,
    descricao: i.descricao,
    unidade: i.unidade,
    quantidade: i.quantidade,
    valorUnitario: i.valorUnitario,
    desconto: i.desconto,
    total: i.total,
    // custo digitado pelo vendedor acompanha a cópia; o do cadastro é atualizado
    custoUnitario: !i.custoInformado && i.produtoId ? custo.get(i.produtoId) ?? i.custoUnitario : i.custoUnitario,
    custoInformado: i.custoInformado,
    comissaoPct: i.comissaoPct,
    comissaoValor: i.comissaoValor,
    ordem: i.ordem,
  }));
  const custoTotal = arredondar(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));
  const primeira = orig.parcelas[0]?.dataVencimento ? new Date(orig.parcelas[0].dataVencimento) : new Date(orig.data);
  const parcelas = orig.parcelas.map((p) => {
    const venc = new Date(hoje);
    venc.setDate(venc.getDate() + Math.max(0, Math.round((new Date(p.dataVencimento).getTime() - primeira.getTime()) / 86400000)));
    return { numero: p.numero, dataVencimento: venc, valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes };
  });
  const v = await tx.venda.create({
    data: {
      tipo: opts.tipo,
      numero,
      data: hoje,
      validade: opts.validade ?? null,
      contatoId: orig.contatoId,
      vendedorId: orig.vendedorId,
      situacaoId: situacao.id,
      depositoId: orig.depositoId,
      categoriaFinanceiraId: orig.categoriaFinanceiraId,
      origem: orig.origem,
      totalProdutos: orig.totalProdutos,
      descontoTipo: orig.descontoTipo,
      descontoValor: orig.descontoValor,
      frete: orig.frete,
      outrasDespesas: orig.outrasDespesas,
      total: orig.total,
      custoTotal,
      custoLogistica: orig.custoLogistica,
      observacoes: orig.observacoes,
      observacoesInternas: opts.observacoesInternas,
      transportadoraId: orig.transportadoraId,
      fretePorConta: orig.fretePorConta,
      quantidadeVolumes: orig.quantidadeVolumes,
      pesoBruto: orig.pesoBruto,
      orcamentoId: opts.orcamentoId ?? null,
      itens: { create: itens },
      parcelas: { create: parcelas },
    },
  });
  await tx.historicoSituacao.create({
    data: { entidadeTipo: modulo, entidadeId: v.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId: opts.usuarioId, observacao: opts.historicoObs },
  });
  return { venda: v, situacao };
}

// ---------------------------------------------------------------- orçamento: aprovar / converter
async function situacaoPorNome(modulo: Modulo, nome: string, db: Db = prisma) {
  return db.situacao.findFirst({ where: { modulo, nome, ativo: true } });
}

/**
 * Marca o orçamento como aprovado pelo cliente (tela, link público ou resposta "APROVAR" no WhatsApp)
 * e move para a situação "Aprovado" (se existir). Idempotente.
 */
export async function aprovarOrcamento(id: number, p: { aprovadoPor?: string | null; observacao?: string | null; usuarioId: number | null }) {
  const v = await prisma.venda.findUnique({ where: { id }, include: { situacao: true, vendaGerada: { select: { id: true, numero: true } } } });
  if (!v) throw new NotFound('Orçamento');
  if (v.tipo !== 'ORCAMENTO') throw new AppError('Este registro não é um orçamento.', 422, 'NAO_ORCAMENTO');
  if (v.vendaGerada) return { jaAprovado: true, convertido: true, vendaGerada: v.vendaGerada, situacao: v.situacao };
  if (v.situacao.cancelamento) throw new AppError(`Orçamento ${v.situacao.nome.toLowerCase()}: reabra-o antes de aprovar.`, 422, 'ORCAMENTO_FECHADO');
  if (v.aprovadoEm) return { jaAprovado: true, convertido: false, vendaGerada: null, situacao: v.situacao };
  await prisma.venda.update({ where: { id }, data: { aprovadoEm: new Date(), aprovadoPor: p.aprovadoPor || null } });
  let situacao = v.situacao;
  const aprovado = await situacaoPorNome('ORCAMENTO', 'Aprovado');
  if (aprovado && aprovado.id !== v.situacaoId) {
    const r = await mudarSituacao({ modulo: 'ORCAMENTO', entidadeId: id, situacaoDestinoId: aprovado.id, usuarioId: p.usuarioId, forcar: true, observacao: `Aprovado${p.aprovadoPor ? ' por ' + p.aprovadoPor : ''}${p.observacao ? ': ' + p.observacao : ''}` });
    situacao = r.situacao;
  }
  return { jaAprovado: false, convertido: false, vendaGerada: null, situacao };
}

/**
 * Converte o orçamento em pedido de venda: cria a venda (tipo PEDIDO) com os mesmos itens/parcelas,
 * vincula (venda.orcamentoId) e move o orçamento para "Convertido em venda". Só uma vez por orçamento.
 */
export async function converterOrcamento(id: number, p: { usuarioId: number | null; situacaoId?: number | null }) {
  const orig = await carregarVenda(prisma, id);
  if (orig.tipo !== 'ORCAMENTO') throw new AppError('Este registro não é um orçamento.', 422, 'NAO_ORCAMENTO');
  if (orig.vendaGerada) throw new AppError(`Este orçamento já virou a venda nº ${orig.vendaGerada.numero}.`, 422, 'JA_CONVERTIDO', { vendaId: orig.vendaGerada.id });
  if (orig.situacao.cancelamento) throw new AppError(`Orçamento ${orig.situacao.nome.toLowerCase()}: reabra-o antes de converter.`, 422, 'ORCAMENTO_FECHADO');
  const { venda, situacao } = await prisma.$transaction(async (tx) => {
    const r = await copiarVenda(tx, orig, {
      tipo: 'PEDIDO',
      situacaoId: p.situacaoId,
      usuarioId: p.usuarioId,
      observacoesInternas: [orig.observacoesInternas, `Gerada do orçamento nº ${orig.numero}`].filter(Boolean).join('\n'),
      orcamentoId: orig.id,
      historicoObs: `Venda gerada do orçamento nº ${orig.numero}`,
    });
    if (!orig.aprovadoEm) await tx.venda.update({ where: { id }, data: { aprovadoEm: new Date(), aprovadoPor: 'Conversão em venda' } });
    return r;
  });
  const convertido = await situacaoPorNome('ORCAMENTO', 'Convertido em venda');
  if (convertido && convertido.id !== orig.situacaoId) {
    await mudarSituacao({ modulo: 'ORCAMENTO', entidadeId: id, situacaoDestinoId: convertido.id, usuarioId: p.usuarioId, forcar: true, observacao: `Convertido na venda nº ${venda.numero}` });
  }
  eventos.emitir('venda.alterada', { vendaId: venda.id, data: venda.data, tipo: venda.tipo });
  return { venda, situacao };
}

// ---------------------------------------------------------------- transferir vendedor
/**
 * Troca o vendedor do pedido. Se as contas já foram lançadas, refaz as comissões pendentes para o novo
 * vendedor (comissão já PAGA bloqueia) e atualiza o vendedor das contas a receber.
 */
export async function transferirVendedor(id: number, vendedorId: number | null, usuarioId: number | null) {
  const v = await prisma.venda.findUnique({ where: { id }, include: { itens: true, vendedor: true, situacao: true } });
  if (!v) throw new NotFound('Venda');
  const novo = vendedorId ? await prisma.vendedor.findUnique({ where: { id: vendedorId } }) : null;
  if (vendedorId && !novo) throw new AppError('Vendedor não encontrado.', 422, 'VENDEDOR');
  if (v.vendedorId === vendedorId) return { venda: v, alterado: false };
  await prisma.$transaction(async (tx) => {
    await tx.venda.update({ where: { id }, data: { vendedorId } });
    await tx.contaReceber.updateMany({ where: { origemTipo: 'VENDA', origemId: id }, data: { vendedorId } });
    if (v.contasLancadas && v.tipo === 'PEDIDO') {
      const competencia = competenciaDe(v.data);
      const base = arredondar(v.itens.reduce((s, i) => s + (i.comissaoPct > 0 ? i.total : 0), 0));
      const valor = arredondar(v.itens.reduce((s, i) => s + i.comissaoValor, 0));
      const pct = base > 0 ? arredondar((valor / base) * 100, 4) : 0;
      if (vendedorId) {
        await recriarComissoes(tx, { origemTipo: 'VENDA', vendaId: id }, competencia, [{ tipo: 'VENDEDOR', vendedorId, descricao: `Venda nº ${v.numero}`, base, pct, valor }]);
      } else {
        await cancelarComissoes(tx, { origemTipo: 'VENDA', vendaId: id });
      }
    }
    await tx.historicoSituacao.create({
      data: { entidadeTipo: moduloDe(v.tipo), entidadeId: id, deSituacaoId: v.situacaoId, deSituacao: v.situacao.nome, paraSituacaoId: v.situacaoId, paraSituacao: v.situacao.nome, usuarioId, observacao: `Vendedor alterado: ${v.vendedor?.nome || 'nenhum'} → ${novo?.nome || 'nenhum'}` },
    });
  });
  eventos.emitir('venda.alterada', { vendaId: id, data: v.data, tipo: v.tipo });
  return { venda: await prisma.venda.findUnique({ where: { id } }), alterado: true };
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
  // recebimentos automáticos ("pago na hora") são desfeitos junto; baixas manuais continuam bloqueando
  await desfazerRecebimentoPagoNaHora(tx, id);
  await cancelarContasReceber(tx, 'VENDA', id);
  await cancelarComissoes(tx, { origemTipo: 'VENDA', vendaId: id });
  await tx.venda.update({ where: { id }, data: { contasLancadas: false } });
}

// ---------------------------------------------------------------- venda paga na hora → caixa
/** Formas de pagamento em que o cliente paga no ato da venda (o dinheiro entra no caixa na hora). */
export const TIPOS_PAGO_NA_HORA = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'TRANSFERENCIA'];
/** Marca do movimento de caixa criado automaticamente pela venda (permite desfazer sozinho ao editar/cancelar). */
export const OBS_PAGO_NA_HORA = 'Recebido automaticamente: pago na hora da venda';

/**
 * Conta financeira que recebe as vendas pagas na hora: a da configuração `vendas.contaRecebimentoId`;
 * senão, o caixa (tipo CAIXA) mais usado; senão a conta padrão.
 */
export async function contaRecebimentoVendaId(db: Db): Promise<number | null> {
  const cfg = await db.configuracao.findUnique({ where: { chave: 'vendas.contaRecebimentoId' } });
  if (cfg && Number(cfg.valor)) {
    const c = await db.contaFinanceira.findFirst({ where: { id: Number(cfg.valor), ativo: true }, select: { id: true } });
    if (c) return c.id;
  }
  const caixas = await db.contaFinanceira.findMany({ where: { ativo: true, tipo: 'CAIXA' }, select: { id: true } });
  if (caixas.length) {
    const uso = await db.movimentoFinanceiro.groupBy({ by: ['contaFinanceiraId'], where: { contaFinanceiraId: { in: caixas.map((c) => c.id) } }, _count: { _all: true } });
    uso.sort((a, b) => b._count._all - a._count._all);
    return uso[0]?.contaFinanceiraId ?? caixas[0].id;
  }
  const padrao = await db.contaFinanceira.findFirst({ where: { ativo: true }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }], select: { id: true } });
  return padrao?.id ?? null;
}

/**
 * Venda paga na hora (dinheiro, PIX, cartão, transferência): lança as contas a receber e já dá baixa
 * dessas parcelas no caixa, na data da venda. Crediário/boleto ficam em aberto no contas a receber.
 * Idempotente: parcela já recebida não é baixada de novo. Orçamento e venda cancelada são ignorados.
 */
export async function receberVendaPagaNaHora(tx: Tx, vendaId: number, usuarioId: number | null = null) {
  const venda = await tx.venda.findUnique({
    where: { id: vendaId },
    include: { situacao: true, parcelas: { include: { formaPagamento: true }, orderBy: { numero: 'asc' } } },
  });
  if (!venda || venda.tipo !== 'PEDIDO' || venda.situacao.cancelamento) return 0;
  const pagas = venda.parcelas.filter((p) => p.valor > 0 && p.formaPagamento && TIPOS_PAGO_NA_HORA.includes(p.formaPagamento.tipo));
  if (!pagas.length) return 0;
  if (!venda.contasLancadas) {
    await acaoLancarContas({ modulo: 'VENDA', entidadeId: vendaId, tx, usuarioId, situacaoOrigemId: venda.situacaoId, situacaoDestinoId: venda.situacaoId });
  }
  const contaId = await contaRecebimentoVendaId(tx);
  if (!contaId) return 0;
  const parcelas = await tx.vendaParcela.findMany({ where: { id: { in: pagas.map((p) => p.id) } }, include: { contaReceber: true } });
  let baixadas = 0;
  for (const p of parcelas) {
    const cr = p.contaReceber;
    if (!cr || !['ABERTO', 'PARCIAL'].includes(cr.situacao)) continue;
    const saldo = saldoContaReceber(cr);
    if (saldo < 0.01) continue;
    await baixarContaReceber({ id: cr.id, valor: saldo, data: venda.data, contaFinanceiraId: contaId, formaPagamentoId: p.formaPagamentoId, observacoes: OBS_PAGO_NA_HORA }, tx);
    baixadas++;
  }
  return baixadas;
}

/** Desfaz só os recebimentos automáticos ("pago na hora") da venda: tira do caixa e volta a conta para aberto. */
export async function desfazerRecebimentoPagoNaHora(tx: Tx, vendaId: number) {
  const contas = await tx.contaReceber.findMany({ where: { origemTipo: 'VENDA', origemId: vendaId } });
  let desfeitos = 0;
  for (const c of contas) {
    const movs = await tx.movimentoFinanceiro.findMany({ where: { contaReceberId: c.id, observacoes: OBS_PAGO_NA_HORA } });
    if (!movs.length) continue;
    let valorRecebido = c.valorRecebido;
    for (const m of movs) {
      await tx.contaFinanceira.update({ where: { id: m.contaFinanceiraId }, data: { saldoAtual: { decrement: arredondar(m.valor) } } });
      await tx.movimentoFinanceiro.delete({ where: { id: m.id } });
      valorRecebido = arredondar(valorRecebido - m.valor);
      desfeitos++;
    }
    const zerada = valorRecebido < 0.01;
    const observacoes = (c.observacoes || '').split('\n').filter((l) => l !== OBS_PAGO_NA_HORA).join('\n') || null;
    await tx.contaReceber.update({
      where: { id: c.id },
      data: { valorRecebido: zerada ? 0 : valorRecebido, situacao: zerada ? 'ABERTO' : 'PARCIAL', dataRecebimento: zerada ? null : c.dataRecebimento, observacoes },
    });
  }
  return desfeitos;
}

/** true se a venda tem contas lançadas e TODOS os recebimentos dela são automáticos (pode destravar a edição sozinha). */
export async function soRecebimentoAutomatico(db: Db, vendaId: number) {
  const contas = await db.contaReceber.findMany({ where: { origemTipo: 'VENDA', origemId: vendaId }, select: { id: true, valorRecebido: true } });
  if (!contas.length) return false;
  const movs = await db.movimentoFinanceiro.findMany({ where: { contaReceberId: { in: contas.map((c) => c.id) } }, select: { valor: true, observacoes: true } });
  if (movs.some((m) => m.observacoes !== OBS_PAGO_NA_HORA)) return false;
  // valor recebido sem movimento (importado) também conta como baixa manual
  const automatico = movs.reduce((s, m) => s + m.valor, 0);
  const recebido = contas.reduce((s, c) => s + c.valorRecebido, 0);
  if (Math.abs(recebido - automatico) > 0.01) return false;
  const comissaoPaga = await db.comissao.count({ where: { origemTipo: 'VENDA', vendaId, status: 'PAGA' } });
  return comissaoPaga === 0;
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
  // checklist completo: se falta algo, devolve TODAS as pendências com o link de onde corrigir
  const checagem = await verificarNfeDaVenda(tx, vendaId, modelo);
  if (!checagem.podeEmitir) throw new AppError(mensagemPendencias(checagem), 422, 'NFE_PENDENCIAS', checagem);
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

/** Checklist da NF da venda (o que falta e onde corrigir). */
export async function verificarNfeDaVenda(db: Db, vendaId: number, modelo: 55 | 65) {
  const venda = await db.venda.findUnique({ where: { id: vendaId }, include: { nota: { select: { id: true, numero: true, situacao: true } }, itens: { orderBy: { ordem: 'asc' } } } });
  if (!venda) throw new NotFound('Venda');
  if (venda.tipo === 'ORCAMENTO') throw new AppError('Orçamento não emite nota fiscal. Converta em venda primeiro.', 422, 'ORCAMENTO');
  return verificarNfe(db, {
    modelo,
    contatoId: venda.contatoId,
    itens: venda.itens.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao })),
    origem: { tipo: 'VENDA', id: venda.id, numero: venda.numero, notaExistente: venda.nota },
  });
}

/** A venda tem reserva de estoque ativa? */
export async function temReserva(id: number, db: Db = prisma) {
  return (await reservasAtivas(db, 'VENDA', id)).length > 0;
}

// ---------------------------------------------------------------- criação (tela e integrações)
/**
 * Cria a venda/orçamento a partir de um body validado e roda as ações da situação inicial.
 * Usada pela tela (POST /vendas) e pela porta do PDV do site (modules/site).
 */
export async function criarVenda(body: VendaInput, usuarioId: number | null, observacaoHistorico?: string) {
  const modulo = moduloDe(body.tipo);
  const venda = await prisma.$transaction(async (tx) => {
    const { itens, totais, parcelas, data } = await prepararVenda(tx, body);
    const situacao = body.situacaoId
      ? await tx.situacao.findFirst({ where: { id: body.situacaoId, modulo, ativo: true } })
      : await situacaoInicial(modulo, tx);
    if (!situacao) throw new AppError(`Situação inválida para ${body.tipo === 'ORCAMENTO' ? 'orçamentos' : 'vendas'}.`, 422, 'SITUACAO');
    const numero = await proximoNumero(sequenciaDe(body.tipo), tx);
    // orçamento sem validade informada: 7 dias a partir da data
    let validade = body.validade ?? null;
    if (body.tipo === 'ORCAMENTO' && !validade) {
      validade = new Date(data);
      validade.setDate(validade.getDate() + 7);
    }
    const v = await tx.venda.create({
      data: {
        tipo: body.tipo,
        numero,
        data,
        validade: body.tipo === 'ORCAMENTO' ? validade : null,
        dataPrevista: body.dataPrevista,
        dataSaida: body.dataSaida,
        contatoId: body.contatoId,
        vendedorId: body.vendedorId ?? null,
        situacaoId: situacao.id,
        depositoId: body.depositoId ?? null,
        categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
        origem: body.origem,
        numeroPedidoLoja: body.numeroPedidoLoja ?? null,
        totalProdutos: totais.totalProdutos,
        descontoTipo: body.descontoTipo,
        descontoValor: body.descontoValor,
        frete: body.frete,
        outrasDespesas: body.outrasDespesas,
        total: totais.total,
        custoTotal: totais.custoTotal,
        custoLogistica: body.custoLogistica,
        observacoes: body.observacoes ?? null,
        observacoesInternas: body.observacoesInternas ?? null,
        transportadoraId: body.transportadoraId ?? null,
        fretePorConta: body.fretePorConta,
        quantidadeVolumes: body.quantidadeVolumes,
        pesoBruto: body.pesoBruto,
        itens: { create: itens },
        parcelas: { create: parcelas },
      },
    });
    await tx.historicoSituacao.create({
      data: { entidadeTipo: modulo, entidadeId: v.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId, observacao: observacaoHistorico ?? (body.tipo === 'ORCAMENTO' ? 'Orçamento criado' : 'Venda criada') },
    });
    return v;
  });

  // ações da situação inicial escolhida (ex.: criar já "Em aberto" reserva estoque) — orçamento não tem ações
  if (body.tipo === 'PEDIDO') {
    const sit = await prisma.situacao.findUnique({ where: { id: venda.situacaoId } });
    const acoesIniciais = sit ? (JSON.parse(sit.acoes || '[]') as Acao[]).filter((a) => a !== 'notificarCliente') : [];
    if (acoesIniciais.length) await executarAcoes('VENDA', venda.id, acoesIniciais, usuarioId);
    eventos.emitir('venda.criada', { vendaId: venda.id, usuarioId });
  }
  eventos.emitir('venda.alterada', { vendaId: venda.id, data: venda.data, tipo: venda.tipo });

  return venda;
}
