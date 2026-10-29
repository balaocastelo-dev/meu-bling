/**
 * Regras de negócio das compras: totais, ações do motor (entrada de estoque,
 * contas a pagar) e importação de XML de NF-e.
 */
import { z } from 'zod';
import { XMLParser } from 'fast-xml-parser';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar, proximoNumero, competenciaDe, dataSchema, somenteDigitos, toDate } from '../../lib/util.js';
import { historico, situacoesPermitidas, type ContextoAcao } from '../../core/situacoes.js';
import { depositoPadraoId, movimentarEstoque, movimentaEstoque } from '../comum/estoque.js';
import { cancelarContasPagar, categoriaPadraoId } from '../comum/financeiro.js';
import { hojeMeioDia } from '../comum/datas.js';
import { estornarCreditoBancarioCompra, lancarCreditoBancarioCompra } from '../emprestimos/credito.js';
import { aoEstornarVendaConsignado, aoVenderConsignado, consignacaoDaCompra } from '../consignacoes/nucleo.js';

type Db = Tx | typeof prisma;

const texto = z.string().trim().nullable().optional();

export const itemCompraSchema = z.object({
  produtoId: z.coerce.number().int().positive().nullable().optional(),
  descricao: z.string().trim().optional(),
  codigoFornecedor: texto,
  unidade: z.string().trim().max(6).optional(),
  quantidade: z.coerce.number().positive().default(1),
  valorUnitario: z.coerce.number().min(0).default(0),
  ipiPct: z.coerce.number().min(0).max(100).default(0),
});

export const parcelaCompraSchema = z.object({
  dataVencimento: dataSchema,
  valor: z.coerce.number().min(0),
  formaPagamentoId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: texto,
});

export const compraSchema = z.object({
  fornecedorId: z.coerce.number().int().positive(),
  data: dataSchema,
  dataPrevista: dataSchema,
  depositoId: z.coerce.number().int().positive().nullable().optional(),
  situacaoId: z.coerce.number().int().positive().nullable().optional(),
  categoriaFinanceiraId: z.coerce.number().int().positive().nullable().optional(),
  ordemCompra: texto,
  nfeChave: texto,
  nfeNumero: texto,
  descontoValor: z.coerce.number().min(0).default(0),
  frete: z.coerce.number().min(0).default(0),
  outrasDespesas: z.coerce.number().min(0).default(0),
  observacoes: texto,
  observacoesInternas: texto,
  itens: z.array(itemCompraSchema).min(1, 'Informe ao menos um item'),
  parcelas: z.array(parcelaCompraSchema).default([]),
});
export type CompraInput = z.infer<typeof compraSchema>;

export const CAMPOS_LIVRES_COMPRA = ['observacoes', 'observacoesInternas', 'ordemCompra', 'nfeChave', 'nfeNumero', 'dataPrevista'] as const;

export const includeCompra = {
  fornecedor: true,
  situacao: { select: { id: true, nome: true, cor: true, final: true, cancelamento: true } },
  deposito: { select: { id: true, nome: true } },
  categoriaFinanceira: { select: { id: true, nome: true } },
  itens: { orderBy: { ordem: 'asc' as const }, include: { produto: { select: { id: true, nome: true, codigo: true, tipo: true, controlaEstoque: true, unidade: true, precoCusto: true } } } },
  parcelas: {
    orderBy: { numero: 'asc' as const },
    include: {
      formaPagamento: { select: { id: true, nome: true, tipo: true } },
      contaPagar: { select: { id: true, situacao: true, valorPago: true, valor: true, vencimento: true, dataPagamento: true } },
    },
  },
} as const;

export async function carregarCompra(db: Db, id: number) {
  const c = await db.compra.findUnique({ where: { id }, include: includeCompra });
  if (!c) throw new NotFound('Compra');
  return c;
}

export async function compraCompleta(id: number) {
  const c = await carregarCompra(prisma, id);
  const [hist, permitidas] = await Promise.all([historico('COMPRA', id), situacoesPermitidas('COMPRA', c.situacaoId)]);
  return { ...c, historico: hist, situacoesPermitidas: permitidas.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })) };
}

/** Monta itens (total inclui IPI) e totais. */
export async function prepararCompra(db: Db, body: CompraInput) {
  const fornecedor = await db.contato.findUnique({ where: { id: body.fornecedorId } });
  if (!fornecedor) throw new AppError('Fornecedor não encontrado.', 422, 'FORNECEDOR');
  const ids = [...new Set(body.itens.map((i) => i.produtoId).filter((x): x is number => !!x))];
  const produtos = ids.length ? await db.produto.findMany({ where: { id: { in: ids } } }) : [];
  const mapa = new Map(produtos.map((p) => [p.id, p]));
  const itens = body.itens.map((i, idx) => {
    const p = i.produtoId ? mapa.get(i.produtoId) : undefined;
    if (i.produtoId && !p) throw new AppError(`Produto ${i.produtoId} do item ${idx + 1} não encontrado.`, 422, 'PRODUTO');
    const descricao = (i.descricao || p?.nome || '').trim();
    if (!descricao) throw new AppError(`Item ${idx + 1}: informe a descrição ou o produto.`, 422, 'ITEM');
    const total = arredondar(i.quantidade * i.valorUnitario * (1 + (i.ipiPct || 0) / 100));
    return {
      produtoId: p?.id ?? null,
      codigoFornecedor: i.codigoFornecedor ?? null,
      descricao,
      unidade: i.unidade || p?.unidade || 'UN',
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario,
      ipiPct: i.ipiPct || 0,
      total,
      ordem: idx,
    };
  });
  const totalProdutos = arredondar(itens.reduce((s, i) => s + i.total, 0));
  if (body.descontoValor > totalProdutos) throw new AppError('Desconto maior que o total dos produtos.', 422, 'DESCONTO');
  const total = arredondar(totalProdutos - body.descontoValor + body.frete + body.outrasDespesas);
  const data = body.data || hojeMeioDia();

  let parcelas;
  if (!body.parcelas.length) {
    parcelas = [{ numero: 1, dataVencimento: body.dataPrevista || data, valor: total, formaPagamentoId: null as number | null, observacoes: null as string | null }];
  } else {
    parcelas = body.parcelas.map((p, i) => ({ numero: i + 1, dataVencimento: p.dataVencimento || data, valor: arredondar(p.valor), formaPagamentoId: p.formaPagamentoId ?? null, observacoes: p.observacoes ?? null }));
    const soma = arredondar(parcelas.reduce((s, p) => s + p.valor, 0));
    const diff = arredondar(total - soma);
    if (Math.abs(diff) > 0.05) throw new AppError(`A soma das parcelas (${soma.toFixed(2)}) difere do total da compra (${total.toFixed(2)}).`, 422, 'PARCELAS', { soma, total });
    if (diff !== 0) parcelas[parcelas.length - 1].valor = arredondar(parcelas[parcelas.length - 1].valor + diff);
  }
  return { fornecedor, itens, totalProdutos, total, data, parcelas };
}

// ---------------------------------------------------------------- AÇÕES

export async function acaoLancarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const compra = await tx.compra.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!compra) throw new NotFound('Compra');
  if (compra.estoqueLancado) return;
  const depositoId = compra.depositoId || (await depositoPadraoId(tx));
  for (const it of compra.itens) {
    if (!it.produtoId || !movimentaEstoque(it.produto)) continue;
    const custo = arredondar(it.valorUnitario * (1 + (it.ipiPct || 0) / 100), 4);
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId,
      tipo: 'ENTRADA',
      quantidade: it.quantidade,
      custoUnitario: custo,
      origemTipo: 'COMPRA',
      origemId: compra.id,
      observacao: `Compra nº ${compra.numero}`,
      usuarioId: ctx.usuarioId,
    });
    // última compra define o custo do produto
    if (custo > 0) await tx.produto.update({ where: { id: it.produtoId }, data: { precoCusto: custo } });
  }
  await tx.compra.update({ where: { id }, data: { estoqueLancado: true, depositoId } });
}

export async function acaoEstornarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const compra = await tx.compra.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!compra) throw new NotFound('Compra');
  if (!compra.estoqueLancado) return;
  const depositoId = compra.depositoId || (await depositoPadraoId(tx));
  for (const it of compra.itens) {
    if (!it.produtoId || !movimentaEstoque(it.produto)) continue;
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId,
      tipo: 'SAIDA',
      quantidade: it.quantidade,
      custoUnitario: arredondar(it.valorUnitario * (1 + (it.ipiPct || 0) / 100), 4),
      origemTipo: 'COMPRA',
      origemId: id,
      observacao: `Estorno compra nº ${compra.numero}`,
      usuarioId: ctx.usuarioId,
    });
  }
  await tx.compra.update({ where: { id }, data: { estoqueLancado: false } });
}

export async function acaoLancarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const compra = await tx.compra.findUnique({ where: { id }, include: { parcelas: { orderBy: { numero: 'asc' } } } });
  if (!compra) throw new NotFound('Compra');
  if (compra.contasLancadas) return;
  // consignação: quem lança o pagamento ao consignante é o módulo de consignação (venda ou diárias)
  if (await consignacaoDaCompra(tx, id)) return;
  const categoriaId = compra.categoriaFinanceiraId || (await categoriaPadraoId(tx, 'Compra de mercadorias (CMV)', 'DESPESA', 'CMV'));
  const competencia = competenciaDe(compra.data);
  const n = compra.parcelas.length;
  for (const p of compra.parcelas) {
    if (p.contaPagarId) {
      await tx.contaPagar.update({ where: { id: p.contaPagarId }, data: { situacao: 'ABERTO', valor: p.valor, vencimento: p.dataVencimento, formaPagamentoId: p.formaPagamentoId } });
      continue;
    }
    const cp = await tx.contaPagar.create({
      data: {
        contatoId: compra.fornecedorId,
        descricao: `Compra nº ${compra.numero} (${p.numero}/${n})${compra.nfeNumero ? ` — NF ${compra.nfeNumero}` : ''}`,
        dataEmissao: compra.data,
        vencimento: p.dataVencimento,
        competencia,
        valor: p.valor,
        situacao: 'ABERTO',
        formaPagamentoId: p.formaPagamentoId,
        categoriaId,
        origemTipo: 'COMPRA',
        origemId: compra.id,
        parcela: `${p.numero}/${n}`,
        observacoes: p.observacoes,
      },
    });
    await tx.compraParcela.update({ where: { id: p.id }, data: { contaPagarId: cp.id } });
  }
  await tx.compra.update({ where: { id }, data: { contasLancadas: true } });
  // parcelas pagas com "Crédito bancário": o credor paga o fornecedor; a devolução + taxa vai para o contas a pagar
  await lancarCreditoBancarioCompra(tx, id);
}

export async function acaoEstornarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const compra = await tx.compra.findUnique({ where: { id } });
  if (!compra) throw new NotFound('Compra');
  if (!compra.contasLancadas) return;
  if (await consignacaoDaCompra(tx, id)) return;
  // crédito bancário: desfaz o pagamento ao fornecedor feito com o crédito e cancela a operação
  await estornarCreditoBancarioCompra(tx, id);
  await cancelarContasPagar(tx, 'COMPRA', id);
  await tx.compra.update({ where: { id }, data: { contasLancadas: false } });
}

// ---------------------------------------------------------------- IMPORTAÇÃO DE XML (NF-e de entrada)

export interface ResultadoImportacao {
  compraId: number;
  numero: number;
  fornecedor: { id: number; nome: string; novo: boolean };
  itensNovos: { produtoId: number; nome: string; codigo: string | null }[];
  itensCasados: { produtoId: number; nome: string; por: 'GTIN' | 'CODIGO' | 'NOME' }[];
  nfeChave: string | null;
  nfeNumero: string | null;
  total: number;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/** Lê o XML (NFe ou nfeProc) e cria a compra em aberto. */
export async function importarXmlNfe(xml: string, usuarioId: number, opcoes: { depositoId?: number | null; situacaoId?: number | null }): Promise<ResultadoImportacao> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: true, removeNSPrefix: true });
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new AppError('Arquivo XML inválido.', 422, 'XML_INVALIDO');
  }
  const nfe = doc?.nfeProc?.NFe || doc?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new AppError('XML não é uma NF-e válida (infNFe não encontrado).', 422, 'XML_INVALIDO');

  const chave = str(inf['@_Id']).replace(/^NFe/, '') || str(doc?.nfeProc?.protNFe?.infProt?.chNFe) || null;
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const end = emit.enderEmit || {};
  const total = inf.total?.ICMSTot || {};
  const dets = arr<any>(inf.det);
  const dups = arr<any>(inf.cobr?.dup);
  const pags = arr<any>(inf.pag?.detPag);

  const cnpj = somenteDigitos(str(emit.CNPJ)) || somenteDigitos(str(emit.CPF));
  if (!cnpj) throw new AppError('XML sem CNPJ/CPF do emitente.', 422, 'XML_INVALIDO');

  const empresa = await prisma.empresa.findUnique({ where: { id: 1 } });
  if (empresa && somenteDigitos(empresa.cnpj) === cnpj) {
    throw new AppError('Este XML foi emitido pela própria empresa (nota de saída), não é uma compra.', 422, 'XML_PROPRIO');
  }

  if (chave) {
    const dup = await prisma.compra.findFirst({ where: { nfeChave: chave }, select: { id: true, numero: true } });
    if (dup) throw new AppError(`Esta NF-e já foi importada na compra nº ${dup.numero}.`, 409, 'XML_DUPLICADO', { compraId: dup.id });
  }

  return prisma.$transaction(
    async (tx) => {
      // ---- fornecedor
      let fornecedor = await tx.contato.findFirst({ where: { documento: cnpj } });
      let fornecedorNovo = false;
      if (!fornecedor) {
        fornecedor = await tx.contato.create({
          data: {
            tipo: 'FORNECEDOR',
            tipoPessoa: cnpj.length === 14 ? 'J' : 'F',
            nome: str(emit.xNome) || 'Fornecedor ' + cnpj,
            fantasia: str(emit.xFant) || null,
            documento: cnpj,
            ie: str(emit.IE) || null,
            indicadorIe: str(emit.IE) ? 1 : 9,
            telefone: somenteDigitos(str(end.fone)) || null,
            logradouro: str(end.xLgr) || null,
            numero: str(end.nro) || null,
            complemento: str(end.xCpl) || null,
            bairro: str(end.xBairro) || null,
            codigoMunicipio: str(end.cMun) || null,
            municipio: str(end.xMun) || null,
            uf: str(end.UF) || null,
            cep: somenteDigitos(str(end.CEP)) || null,
          },
        });
        fornecedorNovo = true;
      } else if (fornecedor.tipo === 'CLIENTE') {
        fornecedor = await tx.contato.update({ where: { id: fornecedor.id }, data: { tipo: 'AMBOS' } });
      }

      // ---- itens
      const itensNovos: ResultadoImportacao['itensNovos'] = [];
      const itensCasados: ResultadoImportacao['itensCasados'] = [];
      const itens: {
        produtoId: number | null; codigoFornecedor: string | null; descricao: string; unidade: string; quantidade: number; valorUnitario: number; ipiPct: number; total: number; ordem: number;
      }[] = [];
      const cfopEntrada = (cfopSaida: string) => {
        // 5xxx → 1xxx, 6xxx → 2xxx (CFOP de entrada correspondente)
        if (/^5/.test(cfopSaida)) return '1' + cfopSaida.slice(1);
        if (/^6/.test(cfopSaida)) return '2' + cfopSaida.slice(1);
        return cfopSaida;
      };
      let ordem = 0;
      for (const det of dets) {
        const prod = det.prod || {};
        const gtin = somenteDigitos(str(prod.cEAN));
        const gtinValido = gtin && !/^0+$/.test(gtin) && gtin.length >= 8;
        const cProd = str(prod.cProd);
        const nome = str(prod.xProd) || 'Produto sem descrição';
        const qCom = num(prod.qCom) || 1;
        const vProd = num(prod.vProd);
        const vUnCom = num(prod.vUnCom) || (qCom ? vProd / qCom : 0);
        const vIpi = num(det.imposto?.IPI?.IPITrib?.vIPI);
        const ipiPct = vProd > 0 && vIpi > 0 ? arredondar((vIpi / vProd) * 100, 4) : 0;
        const vDesc = num(prod.vDesc);
        const unidade = (str(prod.uCom) || 'UN').slice(0, 6).toUpperCase();
        const ncm = somenteDigitos(str(prod.NCM)) || null;
        const cest = somenteDigitos(str(prod.CEST)) || null;
        const cfop = str(prod.CFOP);

        let produto = gtinValido ? await tx.produto.findFirst({ where: { gtin } }) : null;
        let por: 'GTIN' | 'CODIGO' | 'NOME' | null = produto ? 'GTIN' : null;
        if (!produto && cProd) {
          produto = await tx.produto.findFirst({ where: { codigo: cProd } });
          if (produto) por = 'CODIGO';
        }
        if (!produto) {
          produto = await tx.produto.findFirst({ where: { nome } });
          if (produto) por = 'NOME';
        }
        // valor unitário líquido do desconto do item (custo real), IPI entra via ipiPct
        const valorUnitario = arredondar(qCom ? (vProd - vDesc) / qCom : vUnCom, 4);
        if (!produto) {
          // código: usa o cProd se livre, senão cria sem código
          const codigoLivre = cProd && !(await tx.produto.findUnique({ where: { codigo: cProd } })) ? cProd : null;
          produto = await tx.produto.create({
            data: {
              tipo: 'P',
              nome,
              codigo: codigoLivre,
              gtin: gtinValido ? gtin : null,
              unidade,
              preco: arredondar(valorUnitario * (1 + ipiPct / 100) * 1.3), // sugestão: custo + 30%
              precoCusto: arredondar(valorUnitario * (1 + ipiPct / 100), 4),
              ncm,
              cest,
              cfopPadrao: cfop ? cfopEntrada(cfop).replace(/^[12]/, (m) => (m === '1' ? '5' : '6')) : null,
              origem: Number(str(det.imposto?.ICMS ? Object.values(det.imposto.ICMS)[0] && (Object.values(det.imposto.ICMS)[0] as any).orig : 0)) || 0,
              csosn: empresa?.csosnPadrao || '102',
            },
          });
          itensNovos.push({ produtoId: produto.id, nome: produto.nome, codigo: produto.codigo });
        } else {
          itensCasados.push({ produtoId: produto.id, nome: produto.nome, por: por! });
          // completa dados fiscais ausentes
          const compl: Record<string, unknown> = {};
          if (!produto.gtin && gtinValido) compl.gtin = gtin;
          if (!produto.ncm && ncm) compl.ncm = ncm;
          if (!produto.cest && cest) compl.cest = cest;
          if (Object.keys(compl).length) await tx.produto.update({ where: { id: produto.id }, data: compl });
        }
        itens.push({
          produtoId: produto.id,
          codigoFornecedor: cProd || null,
          descricao: nome,
          unidade,
          quantidade: qCom,
          valorUnitario,
          ipiPct,
          total: arredondar(vProd - vDesc + vIpi),
          ordem: ordem++,
        });
      }

      const totalProdutos = arredondar(itens.reduce((s, i) => s + i.total, 0));
      const frete = num(total.vFrete);
      const outras = arredondar(num(total.vOutro) + num(total.vSeg) + num(total.vST) + num(total.vICMSSTRet || 0));
      const desconto = 0; // descontos já abatidos por item
      const vNF = num(total.vNF);
      const totalCalc = arredondar(totalProdutos - desconto + frete + outras);
      // usa o vNF da nota como total oficial; diferença vai para "outras despesas"
      const ajuste = vNF > 0 ? arredondar(vNF - totalCalc) : 0;
      const outrasDespesas = arredondar(outras + (ajuste > 0 ? ajuste : 0));
      const descontoValor = ajuste < 0 ? arredondar(-ajuste) : 0;
      const totalFinal = vNF > 0 ? vNF : totalCalc;

      const dEmi = toDate(str(ide.dhEmi || ide.dEmi).slice(0, 10)) || hojeMeioDia();
      const nfeNumero = str(ide.nNF) || null;

      // ---- parcelas (duplicatas) ou pagamento à vista
      let parcelas: { numero: number; dataVencimento: Date; valor: number; formaPagamentoId: number | null; observacoes: string | null }[] = [];
      const boleto = await tx.formaPagamento.findFirst({ where: { tipo: 'BOLETO' } });
      if (dups.length) {
        parcelas = dups.map((d, i) => ({
          numero: i + 1,
          dataVencimento: toDate(str(d.dVenc)) || dEmi,
          valor: num(d.vDup),
          formaPagamentoId: boleto?.id ?? null,
          observacoes: str(d.nDup) ? `Duplicata ${str(d.nDup)}` : null,
        }));
      } else {
        let formaId: number | null = null;
        const tPag = str(pags[0]?.tPag);
        if (tPag) {
          const fp = await tx.formaPagamento.findFirst({ where: { codigoFiscal: tPag } });
          formaId = fp?.id ?? null;
        }
        parcelas = [{ numero: 1, dataVencimento: dEmi, valor: totalFinal, formaPagamentoId: formaId, observacoes: null }];
      }
      const soma = arredondar(parcelas.reduce((s, p) => s + p.valor, 0));
      if (Math.abs(soma - totalFinal) > 0.05 && parcelas.length) parcelas[parcelas.length - 1].valor = arredondar(parcelas[parcelas.length - 1].valor + (totalFinal - soma));

      const situacao = opcoes.situacaoId
        ? await tx.situacao.findFirst({ where: { id: opcoes.situacaoId, modulo: 'COMPRA' } })
        : (await tx.situacao.findFirst({ where: { modulo: 'COMPRA', inicial: true, ativo: true } })) || (await tx.situacao.findFirst({ where: { modulo: 'COMPRA', ativo: true }, orderBy: { ordem: 'asc' } }));
      if (!situacao) throw new AppError('Nenhuma situação de compra cadastrada.', 500);
      const categoriaId = await categoriaPadraoId(tx, 'Compra de mercadorias (CMV)', 'DESPESA', 'CMV');
      const numeroCompra = await proximoNumero('COMPRA', tx);

      const compra = await tx.compra.create({
        data: {
          numero: numeroCompra,
          data: dEmi,
          dataPrevista: parcelas[0]?.dataVencimento ?? null,
          fornecedorId: fornecedor.id,
          situacaoId: situacao.id,
          depositoId: opcoes.depositoId || (await depositoPadraoId(tx)),
          categoriaFinanceiraId: categoriaId,
          nfeChave: chave,
          nfeNumero,
          totalProdutos,
          descontoValor,
          frete,
          outrasDespesas,
          total: totalFinal,
          observacoes: `Importada do XML da NF-e nº ${nfeNumero || '?'} série ${str(ide.serie) || '?'} de ${str(emit.xNome)}`,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
      await tx.historicoSituacao.create({
        data: { entidadeTipo: 'COMPRA', entidadeId: compra.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId, observacao: 'Importada de XML' },
      });

      return {
        compraId: compra.id,
        numero: compra.numero,
        fornecedor: { id: fornecedor.id, nome: fornecedor.nome, novo: fornecedorNovo },
        itensNovos,
        itensCasados,
        nfeChave: chave,
        nfeNumero,
        total: totalFinal,
      };
    },
    { timeout: 60000 },
  );
}

// ---------------------------------------------------------------- VENDIDO AUTOMÁTICO (venda → compra)

/**
 * Ao fechar uma venda (baixa de estoque), cada item é alocado FIFO nas compras que trouxeram aquele produto
 * (compras com estoque lançado, não canceladas). Quando toda a mercadoria de uma compra foi vendida, a compra
 * passa automaticamente para a situação "Vendido" (executando as ações dela, ex.: lançar contas a pagar de um
 * consignado). Sem situação "Vendido" cadastrada, só registra a alocação.
 */
export async function alocarComprasParaVenda(tx: Tx, vendaId: number, usuarioId: number | null): Promise<number[]> {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, include: { itens: { include: { produto: true, alocacoesCompra: true } } } });
  if (!venda) throw new NotFound('Venda');
  const comprasTocadas = new Set<number>();
  for (const it of venda.itens) {
    if (!it.produtoId || !movimentaEstoque(it.produto)) continue;
    const jaAlocado = it.alocacoesCompra.reduce((s, a) => s + a.quantidade, 0);
    let restante = arredondar(it.quantidade - jaAlocado, 4);
    if (restante <= 0) continue;
    const candidatos = await tx.compraItem.findMany({
      where: { produtoId: it.produtoId, compra: { estoqueLancado: true, situacao: { cancelamento: false } } },
      include: { compra: { select: { id: true, data: true } } },
      orderBy: [{ compra: { data: 'asc' } }, { id: 'asc' }],
    });
    for (const ci of candidatos) {
      if (restante <= 0) break;
      const disponivel = arredondar(ci.quantidade - ci.quantidadeVendida, 4);
      if (disponivel <= 0) continue;
      const q = Math.min(disponivel, restante);
      await tx.alocacaoCompra.create({ data: { vendaItemId: it.id, compraItemId: ci.id, quantidade: q } });
      await tx.compraItem.update({ where: { id: ci.id }, data: { quantidadeVendida: { increment: q } } });
      comprasTocadas.add(ci.compra.id);
      restante = arredondar(restante - q, 4);
    }
  }
  const vendidas: number[] = [];
  for (const compraId of comprasTocadas) {
    if (await marcarCompraVendida(tx, compraId, venda.numero, usuarioId)) vendidas.push(compraId);
  }
  return vendidas;
}

/** Compra com toda a mercadoria vendida → situação "Vendido" (se existir e ainda não estiver nela). */
export async function marcarCompraVendida(tx: Tx, compraId: number, vendaNumero: number, usuarioId: number | null) {
  const compra = await tx.compra.findUnique({ where: { id: compraId }, include: { itens: { include: { produto: true } }, situacao: true } });
  if (!compra || compra.situacao.cancelamento) return false;
  const itensEstoque = compra.itens.filter((i) => i.produtoId && movimentaEstoque(i.produto));
  if (!itensEstoque.length) return false;
  if (itensEstoque.some((i) => i.quantidadeVendida + 0.0001 < i.quantidade)) return false;
  const vendido = await tx.situacao.findFirst({ where: { modulo: 'COMPRA', nome: 'Vendido', ativo: true } });
  if (!vendido || compra.situacaoId === vendido.id) return false;
  const acoes = JSON.parse(vendido.acoes || '[]') as string[];
  const ctx: ContextoAcao = { modulo: 'COMPRA', entidadeId: compraId, tx, usuarioId, situacaoOrigemId: compra.situacaoId, situacaoDestinoId: vendido.id };
  if (acoes.includes('lancarEstoque')) await acaoLancarEstoque(ctx);
  if (acoes.includes('lancarContas')) await acaoLancarContas(ctx);
  await tx.compra.update({ where: { id: compraId }, data: { situacaoId: vendido.id } });
  await tx.historicoSituacao.create({
    data: { entidadeTipo: 'COMPRA', entidadeId: compraId, deSituacaoId: compra.situacaoId, deSituacao: compra.situacao.nome, paraSituacaoId: vendido.id, paraSituacao: vendido.nome, observacao: `Automático: mercadoria vendida na venda nº ${vendaNumero}`, usuarioId },
  });
  // consignado vendido: lança o pagamento ao consignante (na hora) e avisa pelo WhatsApp
  const venda = await tx.venda.findFirst({ where: { tipo: 'PEDIDO', numero: vendaNumero }, select: { id: true, numero: true } });
  if (venda) await aoVenderConsignado(tx, compraId, venda, usuarioId);
  return true;
}

/**
 * Estorno da venda: desfaz as alocações; compras que estavam em "Vendido" e voltam a ter mercadoria
 * retornam à situação anterior (a do histórico; senão "Fechado"). Contas a pagar já pagas não são tocadas.
 */
export async function desalocarComprasDaVenda(tx: Tx, vendaId: number, usuarioId: number | null) {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, select: { numero: true, itens: { select: { id: true } } } });
  if (!venda) throw new NotFound('Venda');
  const alocacoes = await tx.alocacaoCompra.findMany({ where: { vendaItemId: { in: venda.itens.map((i) => i.id) } }, include: { compraItem: { select: { compraId: true } } } });
  const compras = new Set<number>();
  for (const a of alocacoes) {
    await tx.compraItem.update({ where: { id: a.compraItemId }, data: { quantidadeVendida: { decrement: a.quantidade } } });
    await tx.alocacaoCompra.delete({ where: { id: a.id } });
    compras.add(a.compraItem.compraId);
  }
  for (const compraId of compras) {
    const compra = await tx.compra.findUnique({ where: { id: compraId }, include: { situacao: true } });
    if (!compra || compra.situacao.nome !== 'Vendido') continue;
    await aoEstornarVendaConsignado(tx, compraId, usuarioId);
    const ultimo = await tx.historicoSituacao.findFirst({ where: { entidadeTipo: 'COMPRA', entidadeId: compraId, paraSituacaoId: compra.situacaoId }, orderBy: { id: 'desc' } });
    const anterior = (ultimo?.deSituacaoId ? await tx.situacao.findUnique({ where: { id: ultimo.deSituacaoId } }) : null) || (await tx.situacao.findFirst({ where: { modulo: 'COMPRA', nome: 'Fechado' } }));
    if (!anterior || anterior.id === compra.situacaoId) continue;
    // consignado voltando: estorna a conta a pagar lançada automaticamente (se ainda não paga)
    if (anterior.nome === 'Consignado' && compra.contasLancadas) {
      try {
        await acaoEstornarContas({ modulo: 'COMPRA', entidadeId: compraId, tx, usuarioId, situacaoOrigemId: compra.situacaoId, situacaoDestinoId: anterior.id });
      } catch {
        /* conta já paga: mantém */
      }
    }
    await tx.compra.update({ where: { id: compraId }, data: { situacaoId: anterior.id } });
    await tx.historicoSituacao.create({
      data: { entidadeTipo: 'COMPRA', entidadeId: compraId, deSituacaoId: compra.situacaoId, deSituacao: compra.situacao.nome, paraSituacaoId: anterior.id, paraSituacao: anterior.nome, observacao: `Automático: estorno da venda nº ${venda.numero}`, usuarioId },
    });
  }
}
