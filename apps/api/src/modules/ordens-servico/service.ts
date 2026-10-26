/**
 * Regras de negócio das ordens de serviço: totais, ações do motor de situações
 * (baixa de peças, contas a receber, comissões de técnico/vendedor, reserva, NF-e das peças).
 */
import { z } from 'zod';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar, competenciaDe, dataSchema } from '../../lib/util.js';
import { historico, situacoesPermitidas, type ContextoAcao } from '../../core/situacoes.js';
import { linkPublico, tokenPublico } from '../publico/token.js';
import { depositoPadraoId, liberarReservas, movimentarEstoque, movimentaEstoque, reservarItens } from '../comum/estoque.js';
import { cancelarComissoes, cancelarContasReceber, categoriaPadraoId, recriarComissoes, type ComissaoNova } from '../comum/financeiro.js';
import { criarNotaPendente } from '../comum/nfe.js';
import { mensagemPendencias, verificarNfe } from '../comum/nfe-checagem.js';
import { hojeMeioDia, inicioDia } from '../comum/datas.js';

type Db = Tx | typeof prisma;
const texto = z.string().trim().nullable().optional();

export const PRIORIDADES = ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'] as const;

export const itemOsSchema = z.object({
  tipo: z.enum(['PECA', 'SERVICO']).default('SERVICO'),
  produtoId: z.coerce.number().int().positive().nullable().optional(),
  descricao: z.string().trim().optional(),
  quantidade: z.coerce.number().positive().default(1),
  valorUnitario: z.coerce.number().min(0).default(0),
  desconto: z.coerce.number().min(0).default(0),
  comissaoVendedorPct: z.coerce.number().min(0).max(100).nullable().optional(),
  comissaoTecnicoPct: z.coerce.number().min(0).max(100).nullable().optional(),
  depositoId: z.coerce.number().int().positive().nullable().optional(),
});

export const parcelaOsSchema = z.object({
  dataVencimento: dataSchema,
  valor: z.coerce.number().min(0),
  formaPagamentoId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: texto,
});

export const osSchema = z.object({
  contatoId: z.coerce.number().int().positive(),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
  tecnicoId: z.coerce.number().int().positive().nullable().optional(),
  situacaoId: z.coerce.number().int().positive().nullable().optional(),
  depositoId: z.coerce.number().int().positive().nullable().optional(),
  categoriaFinanceiraId: z.coerce.number().int().positive().nullable().optional(),
  dataEntrada: dataSchema,
  dataPrevista: dataSchema,
  dataConclusao: dataSchema,
  dataSaida: dataSchema,
  equipamento: texto,
  marca: texto,
  modelo: texto,
  numeroSerie: texto,
  acessorios: texto,
  senhaEquipamento: texto,
  estadoFisico: texto,
  defeitoRelatado: texto,
  diagnostico: texto,
  servicoExecutado: texto,
  observacoes: texto,
  observacoesInternas: texto,
  prioridade: z.enum(PRIORIDADES).default('NORMAL'),
  orcar: z.boolean().default(false),
  orcamentoAprovado: z.boolean().optional(),
  descontoValor: z.coerce.number().min(0).default(0),
  // custos internos do fechamento (não aparecem para o cliente nem na impressão)
  custoPeca: z.coerce.number().min(0).default(0),
  custoLogistica: z.coerce.number().min(0).default(0),
  custoMaoObraTerceiro: z.coerce.number().min(0).default(0),
  garantiaDias: z.coerce.number().int().min(0).default(90),
  itens: z.array(itemOsSchema).default([]),
  parcelas: z.array(parcelaOsSchema).default([]),
});
export type OsInput = z.infer<typeof osSchema>;

/** Campos editáveis mesmo com estoque/contas lançados. */
export const CAMPOS_LIVRES_OS = [
  'observacoes', 'observacoesInternas', 'diagnostico', 'servicoExecutado', 'dataPrevista', 'dataConclusao', 'dataSaida', 'prioridade',
  'acessorios', 'senhaEquipamento', 'estadoFisico', 'tecnicoId', 'garantiaDias', 'numeroSerie', 'marca', 'modelo', 'equipamento', 'defeitoRelatado',
  // custos internos: lançados no fechamento, depois que a OS já baixou estoque/contas
  'custoPeca', 'custoLogistica', 'custoMaoObraTerceiro',
] as const;

/**
 * Fechamento da OS (uso interno/ADMIN): custo efetivo e lucro.
 * Custo das peças = valor informado na OS (custoPeca) ou, se não informado, o custo das peças cadastradas (custoTotal).
 */
export function fechamentoOs(os: { total: number; totalServicos: number; totalPecas: number; descontoValor: number; custoTotal: number; custoPeca: number; custoLogistica: number; custoMaoObraTerceiro: number }) {
  const custoPecas = arredondar(os.custoPeca > 0 ? os.custoPeca : os.custoTotal);
  const custoTotalOs = arredondar(custoPecas + os.custoLogistica + os.custoMaoObraTerceiro);
  const lucro = arredondar(os.total - custoTotalOs);
  return {
    custoPecas,
    custoPecasOrigem: (os.custoPeca > 0 ? 'INFORMADO' : 'CADASTRO') as 'INFORMADO' | 'CADASTRO',
    custoLogistica: arredondar(os.custoLogistica),
    custoMaoObraTerceiro: arredondar(os.custoMaoObraTerceiro),
    custoTotal: custoTotalOs,
    lucro,
    margemPct: os.total > 0 ? arredondar((lucro / os.total) * 100, 1) : 0,
  };
}

export const resumoSelect = {
  id: true, numero: true, dataEntrada: true, dataPrevista: true, dataConclusao: true, dataSaida: true,
  equipamento: true, marca: true, modelo: true, numeroSerie: true, defeitoRelatado: true, total: true, totalServicos: true, totalPecas: true,
  prioridade: true, orcar: true, orcamentoAprovado: true, estoqueLancado: true, contasLancadas: true, notaId: true, criadoEm: true,
  contato: { select: { id: true, nome: true, celular: true, telefone: true, email: true } },
  tecnico: { select: { id: true, nome: true } },
  vendedor: { select: { id: true, nome: true } },
  situacao: { select: { id: true, nome: true, cor: true, ordem: true, final: true, cancelamento: true } },
} as const;

export const includeOs = {
  contato: true,
  tecnico: { select: { id: true, nome: true, telefone: true, especialidade: true } },
  vendedor: { select: { id: true, nome: true } },
  situacao: { select: { id: true, nome: true, cor: true, ordem: true, final: true, cancelamento: true } },
  deposito: { select: { id: true, nome: true } },
  categoriaFinanceira: { select: { id: true, nome: true } },
  nota: { select: { id: true, numero: true, serie: true, modelo: true, situacao: true, chave: true } },
  itens: { orderBy: { ordem: 'asc' as const }, include: { produto: { select: { id: true, nome: true, codigo: true, tipo: true, controlaEstoque: true, unidade: true, garantiaDias: true } }, deposito: { select: { id: true, nome: true } } } },
  parcelas: {
    orderBy: { numero: 'asc' as const },
    include: {
      formaPagamento: { select: { id: true, nome: true, tipo: true, codigoFiscal: true } },
      contaReceber: { select: { id: true, situacao: true, valorRecebido: true, valor: true, vencimento: true, dataRecebimento: true } },
    },
  },
  anexos: { orderBy: { id: 'asc' as const } },
  comissoes: { include: { vendedor: { select: { id: true, nome: true } }, tecnico: { select: { id: true, nome: true } } } },
} as const;

/** OS atrasada = dataPrevista < hoje e situação não final/cancelamento. */
export function calcularAtrasada(os: { dataPrevista: Date | null; situacao: { final: boolean; cancelamento: boolean } }): boolean {
  if (!os.dataPrevista) return false;
  if (os.situacao.final || os.situacao.cancelamento) return false;
  return new Date(os.dataPrevista).getTime() < inicioDia(new Date()).getTime();
}

export async function carregarOs(db: Db, id: number) {
  const os = await db.ordemServico.findUnique({ where: { id }, include: includeOs });
  if (!os) throw new NotFound('Ordem de serviço');
  return os;
}

export async function osCompleta(id: number) {
  const os = await carregarOs(prisma, id);
  const [hist, permitidas] = await Promise.all([historico('OS', id), situacoesPermitidas('OS', os.situacaoId)]);
  return {
    ...os,
    fechamento: fechamentoOs(os),
    anexos: os.anexos.map((a) => ({ ...a, url: `/uploads/anexos/os-${os.id}/${a.caminho}` })),
    atrasada: calcularAtrasada(os),
    historico: hist,
    situacoesPermitidas: permitidas.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })),
    tokenPublico: tokenPublico('os', id),
    linkPublico: linkPublico('os', id),
  };
}

/** Monta itens e totais. */
export async function prepararOs(db: Db, body: OsInput) {
  const contato = await db.contato.findUnique({ where: { id: body.contatoId } });
  if (!contato) throw new AppError('Cliente não encontrado.', 422, 'CONTATO');
  let comissaoVendedorPadrao = 0;
  let comissaoTecnicoPadrao = 0;
  if (body.vendedorId) {
    const v = await db.vendedor.findUnique({ where: { id: body.vendedorId } });
    if (!v) throw new AppError('Vendedor não encontrado.', 422, 'VENDEDOR');
    comissaoVendedorPadrao = v.comissaoPadraoPct;
  }
  if (body.tecnicoId) {
    const t = await db.tecnico.findUnique({ where: { id: body.tecnicoId } });
    if (!t) throw new AppError('Técnico não encontrado.', 422, 'TECNICO');
    comissaoTecnicoPadrao = t.comissaoPadraoPct;
  }
  const ids = [...new Set(body.itens.map((i) => i.produtoId).filter((x): x is number => !!x))];
  const produtos = ids.length ? await db.produto.findMany({ where: { id: { in: ids } } }) : [];
  const mapa = new Map(produtos.map((p) => [p.id, p]));

  const itens = body.itens.map((i, idx) => {
    const p = i.produtoId ? mapa.get(i.produtoId) : undefined;
    if (i.produtoId && !p) throw new AppError(`Produto ${i.produtoId} do item ${idx + 1} não encontrado.`, 422, 'PRODUTO');
    // tipo: produto S força SERVICO, produto P força PECA
    const tipo = p ? (p.tipo === 'S' ? 'SERVICO' : 'PECA') : i.tipo;
    const descricao = (i.descricao || p?.nome || '').trim();
    if (!descricao) throw new AppError(`Item ${idx + 1}: informe a descrição ou o produto.`, 422, 'ITEM');
    const total = arredondar(i.quantidade * i.valorUnitario - (i.desconto || 0));
    if (total < 0) throw new AppError(`Item ${idx + 1}: desconto maior que o valor.`, 422, 'ITEM');
    return {
      tipo,
      produtoId: p?.id ?? null,
      descricao,
      quantidade: i.quantidade,
      valorUnitario: i.valorUnitario,
      desconto: arredondar(i.desconto || 0),
      total,
      custoUnitario: p?.precoCusto ?? 0,
      // comissão do técnico por padrão só sobre serviços; do vendedor sobre tudo
      comissaoVendedorPct: i.comissaoVendedorPct ?? comissaoVendedorPadrao,
      comissaoTecnicoPct: i.comissaoTecnicoPct ?? (tipo === 'SERVICO' ? comissaoTecnicoPadrao : 0),
      depositoId: tipo === 'PECA' ? i.depositoId ?? body.depositoId ?? null : null,
      estoqueBaixado: false,
      ordem: idx,
    };
  });
  const totalServicos = arredondar(itens.filter((i) => i.tipo === 'SERVICO').reduce((s, i) => s + i.total, 0));
  const totalPecas = arredondar(itens.filter((i) => i.tipo === 'PECA').reduce((s, i) => s + i.total, 0));
  if (body.descontoValor > totalServicos + totalPecas) throw new AppError('Desconto maior que o total da OS.', 422, 'DESCONTO');
  const total = arredondar(totalServicos + totalPecas - body.descontoValor);
  const custoTotal = arredondar(itens.filter((i) => i.tipo === 'PECA').reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));
  const dataEntrada = body.dataEntrada || hojeMeioDia();

  let parcelas: { numero: number; dataVencimento: Date; valor: number; formaPagamentoId: number | null; observacoes: string | null }[] = [];
  if (body.parcelas.length) {
    parcelas = body.parcelas.map((p, i) => ({ numero: i + 1, dataVencimento: p.dataVencimento || body.dataPrevista || dataEntrada, valor: arredondar(p.valor), formaPagamentoId: p.formaPagamentoId ?? null, observacoes: p.observacoes ?? null }));
    const soma = arredondar(parcelas.reduce((s, p) => s + p.valor, 0));
    const diff = arredondar(total - soma);
    if (Math.abs(diff) > 0.05) throw new AppError(`A soma das parcelas (${soma.toFixed(2)}) difere do total da OS (${total.toFixed(2)}).`, 422, 'PARCELAS', { soma, total });
    if (diff !== 0) parcelas[parcelas.length - 1].valor = arredondar(parcelas[parcelas.length - 1].valor + diff);
  } else if (total > 0) {
    parcelas = [{ numero: 1, dataVencimento: body.dataPrevista || dataEntrada, valor: total, formaPagamentoId: null, observacoes: null }];
  }
  return { contato, itens, totalServicos, totalPecas, total, custoTotal, dataEntrada, parcelas };
}

// ---------------------------------------------------------------- AÇÕES

/** Baixa as peças com produtoId (idempotente por item: estoqueBaixado). */
export async function acaoLancarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const os = await tx.ordemServico.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!os) throw new NotFound('Ordem de serviço');
  const padrao = os.depositoId || (await depositoPadraoId(tx));
  await liberarReservas(tx, 'OS', id, `Baixa de peças OS nº ${os.numero}`, ctx.usuarioId);
  for (const it of os.itens) {
    if (it.tipo !== 'PECA' || !it.produtoId || it.estoqueBaixado || !movimentaEstoque(it.produto)) continue;
    const depositoId = it.depositoId || padrao;
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId,
      tipo: 'SAIDA',
      quantidade: it.quantidade,
      custoUnitario: it.custoUnitario,
      origemTipo: 'OS',
      origemId: id,
      observacao: `OS nº ${os.numero}`,
      usuarioId: ctx.usuarioId,
    });
    await tx.ordemServicoItem.update({ where: { id: it.id }, data: { estoqueBaixado: true, depositoId } });
  }
  await tx.ordemServico.update({ where: { id }, data: { estoqueLancado: true, depositoId: padrao } });
}

export async function acaoEstornarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const os = await tx.ordemServico.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!os) throw new NotFound('Ordem de serviço');
  const padrao = os.depositoId || (await depositoPadraoId(tx));
  for (const it of os.itens) {
    if (it.tipo !== 'PECA' || !it.produtoId || !it.estoqueBaixado) continue;
    await movimentarEstoque(tx, {
      produtoId: it.produtoId,
      depositoId: it.depositoId || padrao,
      tipo: 'ENTRADA',
      quantidade: it.quantidade,
      custoUnitario: it.custoUnitario,
      origemTipo: 'OS',
      origemId: id,
      observacao: `Estorno OS nº ${os.numero}`,
      usuarioId: ctx.usuarioId,
    });
    await tx.ordemServicoItem.update({ where: { id: it.id }, data: { estoqueBaixado: false } });
  }
  await tx.ordemServico.update({ where: { id }, data: { estoqueLancado: false } });
}

export async function acaoLancarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const os = await tx.ordemServico.findUnique({ where: { id }, include: { parcelas: { orderBy: { numero: 'asc' } }, itens: true } });
  if (!os) throw new NotFound('Ordem de serviço');
  if (os.contasLancadas) return;
  const categoriaId = os.categoriaFinanceiraId || (await categoriaPadraoId(tx, 'Prestação de serviços (OS)', 'RECEITA', 'RECEITA_BRUTA'));
  const dataBase = os.dataConclusao || new Date();
  const competencia = competenciaDe(dataBase);
  const n = os.parcelas.length;
  for (const p of os.parcelas) {
    if (p.contaReceberId) {
      await tx.contaReceber.update({ where: { id: p.contaReceberId }, data: { situacao: 'ABERTO', valor: p.valor, vencimento: p.dataVencimento, formaPagamentoId: p.formaPagamentoId } });
      continue;
    }
    const cr = await tx.contaReceber.create({
      data: {
        contatoId: os.contatoId,
        vendedorId: os.vendedorId,
        descricao: `OS nº ${os.numero} (${p.numero}/${n})`,
        dataEmissao: dataBase,
        vencimento: p.dataVencimento,
        competencia,
        valor: p.valor,
        situacao: 'ABERTO',
        formaPagamentoId: p.formaPagamentoId,
        categoriaId,
        origemTipo: 'OS',
        origemId: os.id,
        parcela: `${p.numero}/${n}`,
        observacoes: p.observacoes,
      },
    });
    await tx.ordemServicoParcela.update({ where: { id: p.id }, data: { contaReceberId: cr.id } });
  }
  // comissões
  const novas: ComissaoNova[] = [];
  if (os.tecnicoId) {
    const itensT = os.itens.filter((i) => i.comissaoTecnicoPct > 0);
    const base = arredondar(itensT.reduce((s, i) => s + i.total, 0));
    const valor = arredondar(itensT.reduce((s, i) => s + i.total * (i.comissaoTecnicoPct / 100), 0));
    novas.push({ tipo: 'TECNICO', tecnicoId: os.tecnicoId, descricao: `OS nº ${os.numero}`, base, pct: base > 0 ? arredondar((valor / base) * 100, 4) : 0, valor });
  }
  if (os.vendedorId) {
    const itensV = os.itens.filter((i) => i.comissaoVendedorPct > 0);
    const base = arredondar(itensV.reduce((s, i) => s + i.total, 0));
    const valor = arredondar(itensV.reduce((s, i) => s + i.total * (i.comissaoVendedorPct / 100), 0));
    novas.push({ tipo: 'VENDEDOR', vendedorId: os.vendedorId, descricao: `OS nº ${os.numero}`, base, pct: base > 0 ? arredondar((valor / base) * 100, 4) : 0, valor });
  }
  await recriarComissoes(tx, { origemTipo: 'OS', osId: os.id }, competencia, novas);
  await tx.ordemServico.update({ where: { id }, data: { contasLancadas: true, dataConclusao: os.dataConclusao || new Date() } });
}

export async function acaoEstornarContas(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const os = await tx.ordemServico.findUnique({ where: { id } });
  if (!os) throw new NotFound('Ordem de serviço');
  if (!os.contasLancadas) return;
  await cancelarContasReceber(tx, 'OS', id);
  await cancelarComissoes(tx, { origemTipo: 'OS', osId: id });
  await tx.ordemServico.update({ where: { id }, data: { contasLancadas: false } });
}

export async function acaoReservarEstoque(ctx: ContextoAcao) {
  const { tx, entidadeId: id } = ctx;
  const os = await tx.ordemServico.findUnique({ where: { id }, include: { itens: { include: { produto: true } } } });
  if (!os) throw new NotFound('Ordem de serviço');
  const padrao = os.depositoId || (await depositoPadraoId(tx));
  const itens = os.itens
    .filter((it) => it.tipo === 'PECA' && it.produtoId && !it.estoqueBaixado && movimentaEstoque(it.produto))
    .map((it) => ({ produtoId: it.produtoId!, depositoId: it.depositoId || padrao, quantidade: it.quantidade }));
  await reservarItens(tx, 'OS', id, itens, `Reserva peças OS nº ${os.numero}`, ctx.usuarioId);
}

export async function acaoLiberarReserva(ctx: ContextoAcao) {
  const os = await ctx.tx.ordemServico.findUnique({ where: { id: ctx.entidadeId }, select: { numero: true } });
  if (!os) throw new NotFound('Ordem de serviço');
  await liberarReservas(ctx.tx, 'OS', ctx.entidadeId, `Liberação reserva OS nº ${os.numero}`, ctx.usuarioId);
}

export async function acaoGerarNfe(ctx: ContextoAcao) {
  const os = await ctx.tx.ordemServico.findUnique({ where: { id: ctx.entidadeId }, include: { nota: true, itens: { include: { produto: { select: { tipo: true } } } } } });
  if (!os) throw new NotFound('Ordem de serviço');
  if (os.nota && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(os.nota.situacao)) return;
  // ação automática: só gera se houver peça; sem peça, ignora silenciosamente
  if (!os.itens.some((i) => i.tipo === 'PECA' && i.produtoId && i.produto?.tipo === 'P')) return;
  await gerarNfeDaOs(ctx.tx, ctx.entidadeId, 55, null);
}

/** NF-e só das peças (serviços ficam fora). */
/** Checklist da NF das peças da OS (serviços não entram na NF-e de produto). */
export async function verificarNfeDaOs(db: Db, osId: number, modelo: 55 | 65) {
  const os = await db.ordemServico.findUnique({ where: { id: osId }, include: { nota: { select: { id: true, numero: true, situacao: true } }, itens: true } });
  if (!os) throw new NotFound('Ordem de serviço');
  const pecas = os.itens.filter((i) => i.tipo === 'PECA');
  const r = await verificarNfe(db, {
    modelo,
    contatoId: os.contatoId,
    itens: pecas.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao })),
    origem: { tipo: 'OS', id: os.id, numero: os.numero, notaExistente: os.nota },
  });
  if (!pecas.length) {
    r.pendencias = r.pendencias.filter((x) => x.codigo !== 'SEM_ITENS');
    r.pendencias.unshift({ nivel: 'erro', codigo: 'SEM_PECAS', grupo: 'ITENS', titulo: 'A OS não tem peças: NF-e de produto só leva peças; serviço é por nota de serviço (prefeitura).', acoes: [{ rotulo: 'Editar a OS', rota: `/ordens-servico/${os.id}/editar` }] });
    r.erros = r.pendencias.filter((x) => x.nivel === 'erro').length;
    r.avisos = r.pendencias.length - r.erros;
    r.podeEmitir = r.erros === 0;
  }
  return r;
}

export async function gerarNfeDaOs(tx: Db, osId: number, modelo: 55 | 65, informacoesComplementares: string | null | undefined) {
  const os = await tx.ordemServico.findUnique({
    where: { id: osId },
    include: { nota: true, itens: { include: { produto: { select: { tipo: true } } } }, parcelas: { orderBy: { numero: 'asc' }, include: { formaPagamento: true } } },
  });
  if (!os) throw new NotFound('Ordem de serviço');
  const checagem = await verificarNfeDaOs(tx, osId, modelo);
  if (!checagem.podeEmitir) throw new AppError(mensagemPendencias(checagem), 422, 'NFE_PENDENCIAS', checagem);
  const pecas = os.itens.filter((i) => i.tipo === 'PECA' && i.produtoId && i.produto?.tipo === 'P');
  if (!pecas.length) throw new AppError('A OS não possui peças (produtos) para emitir NF-e. Serviços não entram na NF-e de produto.', 422, 'SEM_ITENS');
  const nota = await criarNotaPendente(tx, {
    modelo,
    contatoId: os.contatoId,
    itens: pecas.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, total: i.total })),
    formaPagamentoFiscal: os.parcelas[0]?.formaPagamento?.codigoFiscal || '99',
    fretePorConta: 9,
    informacoesComplementares: [informacoesComplementares, `Peças referentes à Ordem de Serviço nº ${os.numero}`].filter(Boolean).join(' | '),
  });
  await tx.ordemServico.update({ where: { id: osId }, data: { notaId: nota.id } });
  return nota;
}
