/**
 * LANÇAMENTOS AUTOMÁTICOS — fila de revisão do que um bot leu em e-mail de banco.
 *
 * Decisão de saldo e baixa (pedido do Thiago):
 *   PENDENTE   não cria MovimentoFinanceiro, não altera ContaFinanceira.saldoAtual
 *              e não dá baixa em conta a pagar nem a receber. Não entra no extrato,
 *              no fluxo de caixa nem no DRE.
 *   CONFIADO   (botão Confio) aceita o dinheiro. Entrada/saída nova vira movimento
 *              avulso. TRANSFERENCIA nova usa transferirEntreContas (duas pernas,
 *              categoria nula, fora do DRE). Continua sem dar baixa automática.
 *              Se jaLancado, Confio só grava quem confirmou: o saldo não muda de novo.
 *   CONTESTADO grava quem contestou, quando e a observação. Não mexe em saldo.
 *              Se jaLancado, marca requerEstornoManual — o estorno é na mão.
 *
 * O mesmo emailOrigemId nunca gera dois registros: o segundo envio devolve o primeiro.
 */
import { endOfDay, startOfDay } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { criarMovimentoAvulso, transferirEntreContas } from '../financeiro/service.js';

export const CHAVE_LIMITE = 'lancamentosAutomaticos.limiteValorAlto';
/** Acima disto (inclusive) a tela destaca o valor, até o ADMIN mudar o limite. */
export const LIMITE_PADRAO = 1000;

const include = {
  contaFinanceira: { select: { id: true, nome: true } },
  contaDestino: { select: { id: true, nome: true } },
  categoria: { select: { id: true, nome: true } },
  confiadoPor: { select: { id: true, nome: true } },
  contestadoPor: { select: { id: true, nome: true } },
} as const;

type Linha = Prisma.LancamentoAutomaticoGetPayload<{ include: typeof include }>;

export interface LancamentoPublico extends Omit<Linha, 'contraparteChave'> {
  valorAlto: boolean;
  contraparteNova: boolean;
}

/** Nome comparável: sem acento, minúsculo, espaços simples. */
export function chaveContraparte(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function limiteValorAlto(): Promise<number> {
  const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE_LIMITE } });
  // sem configuração, vale o padrão. Zero gravado de propósito destaca qualquer valor.
  if (!c?.valor?.trim()) return LIMITE_PADRAO;
  const n = Number(c.valor.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return LIMITE_PADRAO;
  return arredondar(n);
}

export async function salvarLimite(valor: number): Promise<number> {
  const n = arredondar(valor);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new AppError('Informe um limite a partir de zero.', 422, 'LIMITE_INVALIDO');
  await prisma.configuracao.upsert({
    where: { chave: CHAVE_LIMITE },
    create: { chave: CHAVE_LIMITE, valor: String(n) },
    update: { valor: String(n) },
  });
  return n;
}

export async function contarPendentes(): Promise<number> {
  return prisma.lancamentoAutomatico.count({ where: { status: 'PENDENTE' } });
}

export async function resumo() {
  const [pendentes, limite] = await Promise.all([contarPendentes(), limiteValorAlto()]);
  return { pendentes, limiteValorAlto: limite };
}

/**
 * Novo = este nome ainda não foi aceito (Confio) em nenhum lançamento automático
 * e não bate com o nome nem a fantasia de um contato já cadastrado.
 * Vários pendentes do mesmo desconhecido continuam destacados até o primeiro Confio
 * ou até existir o contato.
 */
async function marcar(linhas: Linha[], limite: number): Promise<LancamentoPublico[]> {
  const chaves = [...new Set(linhas.map((l) => l.contraparteChave).filter(Boolean))];
  const [confiados, contatos] = await Promise.all([
    chaves.length
      ? prisma.lancamentoAutomatico.findMany({
          where: { status: 'CONFIADO', contraparteChave: { in: chaves } },
          select: { contraparteChave: true },
          distinct: ['contraparteChave'],
        })
      : [],
    prisma.contato.findMany({ select: { nome: true, fantasia: true } }),
  ]);
  const conhecidas = new Set(confiados.map((c) => c.contraparteChave));
  for (const c of contatos) {
    const nome = chaveContraparte(c.nome || '');
    const fantasia = chaveContraparte(c.fantasia || '');
    if (nome) conhecidas.add(nome);
    if (fantasia) conhecidas.add(fantasia);
  }
  return linhas.map((l) => {
    const { contraparteChave, ...resto } = l;
    return {
      ...resto,
      valorAlto: l.valor + 1e-9 >= limite,
      contraparteNova: !!contraparteChave && !conhecidas.has(contraparteChave),
    };
  });
}

export async function listar(p: {
  status?: 'PENDENTE' | 'CONFIADO' | 'CONTESTADO';
  contaFinanceiraId?: number;
  dataInicial?: Date | null;
  dataFinal?: Date | null;
  skip: number;
  take: number;
  pagina: number;
  limite: number;
}) {
  const where: Prisma.LancamentoAutomaticoWhereInput = {};
  if (p.status) where.status = p.status;
  if (p.contaFinanceiraId) where.OR = [{ contaFinanceiraId: p.contaFinanceiraId }, { contaDestinoId: p.contaFinanceiraId }];
  if (p.dataInicial || p.dataFinal) {
    const data: Prisma.DateTimeFilter = {};
    if (p.dataInicial) data.gte = startOfDay(p.dataInicial);
    if (p.dataFinal) data.lte = endOfDay(p.dataFinal);
    where.data = data;
  }
  const [total, linhas, pendentes, limiteValor] = await Promise.all([
    prisma.lancamentoAutomatico.count({ where }),
    prisma.lancamentoAutomatico.findMany({ where, include, orderBy: [{ data: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take }),
    contarPendentes(),
    limiteValorAlto(),
  ]);
  const data = await marcar(linhas, limiteValor);
  return {
    data,
    meta: {
      total,
      pagina: p.pagina,
      limite: p.limite,
      totalPaginas: Math.max(1, Math.ceil(total / p.limite)),
      pendentes,
      limiteValorAlto: limiteValor,
    },
  };
}

export interface NovoLancamento {
  tipo: 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA';
  data: Date;
  valor: number;
  contaFinanceiraId: number;
  contaDestinoId?: number | null;
  contraparte: string;
  categoriaId?: number | null;
  emailOrigemId: string;
  emailOrigemUrl?: string | null;
  descricao?: string | null;
  botNome: string;
  chaveApiId: number;
}

async function publicar(linha: Linha) {
  const limite = await limiteValorAlto();
  const [pub] = await marcar([linha], limite);
  return pub;
}

export async function criar(p: NovoLancamento): Promise<{ lancamento: LancamentoPublico; idempotente: boolean }> {
  const emailOrigemId = p.emailOrigemId.trim();
  const contraparte = p.contraparte.trim();
  const contraparteChave = chaveContraparte(contraparte);
  if (!emailOrigemId) throw new AppError('Informe o ID do e-mail de origem.', 422, 'EMAIL_OBRIGATORIO');
  if (contraparteChave.length < 2) throw new AppError('Informe quem pagou ou recebeu.', 422, 'CONTRAPARTE_OBRIGATORIA');
  const valor = arredondar(p.valor);
  if (valor <= 0) throw new AppError('Valor deve ser maior que zero.', 422, 'VALOR_INVALIDO');

  const ja = await prisma.lancamentoAutomatico.findUnique({ where: { emailOrigemId }, include });
  if (ja) return { lancamento: await publicar(ja), idempotente: true };

  const conta = await prisma.contaFinanceira.findUnique({ where: { id: p.contaFinanceiraId } });
  if (!conta) throw new NotFound('Conta financeira');
  if (!conta.ativo) throw new AppError('A conta financeira está inativa.', 422, 'CONTA_INATIVA');

  let contaDestinoId: number | null = null;
  if (p.tipo === 'TRANSFERENCIA') {
    if (!p.contaDestinoId) throw new AppError('Informe a conta de destino da transferência.', 422, 'DESTINO_OBRIGATORIO');
    if (p.contaDestinoId === p.contaFinanceiraId) throw new AppError('Conta de origem e destino devem ser diferentes.', 422, 'CONTAS_IGUAIS');
    if (p.categoriaId) throw new AppError('Transferência entre contas próprias não usa categoria.', 422, 'CATEGORIA_TRANSFERENCIA');
    const destino = await prisma.contaFinanceira.findUnique({ where: { id: p.contaDestinoId } });
    if (!destino) throw new NotFound('Conta de destino');
    if (!destino.ativo) throw new AppError('A conta de destino está inativa.', 422, 'CONTA_INATIVA');
    contaDestinoId = destino.id;
  } else if (p.contaDestinoId) {
    throw new AppError('contaDestinoId só vale em transferência.', 422, 'DESTINO_INESPERADO');
  }

  if (p.categoriaId && p.tipo !== 'TRANSFERENCIA') {
    const cat = await prisma.categoriaFinanceira.findUnique({ where: { id: p.categoriaId } });
    if (!cat || !cat.ativo) throw new NotFound('Categoria financeira');
    const esperado = p.tipo === 'ENTRADA' ? 'RECEITA' : 'DESPESA';
    if (cat.tipo !== esperado) {
      throw new AppError(`Esta categoria é ${cat.tipo === 'RECEITA' ? 'de receita' : 'de despesa'} e o lançamento é ${p.tipo === 'ENTRADA' ? 'uma entrada' : 'uma saída'}.`, 422, 'CATEGORIA_TIPO');
    }
  }

  try {
    const criado = await prisma.lancamentoAutomatico.create({
      data: {
        tipo: p.tipo,
        data: p.data,
        valor,
        contaFinanceiraId: p.contaFinanceiraId,
        contaDestinoId,
        contraparte,
        contraparteChave,
        categoriaId: p.tipo === 'TRANSFERENCIA' ? null : (p.categoriaId ?? null),
        emailOrigemId,
        emailOrigemUrl: p.emailOrigemUrl?.trim() || null,
        descricao: p.descricao?.trim() || null,
        botNome: p.botNome,
        chaveApiId: p.chaveApiId,
        status: 'PENDENTE',
        jaLancado: false,
      },
      include,
    });
    return { lancamento: await publicar(criado), idempotente: false };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const deNovo = await prisma.lancamentoAutomatico.findUnique({ where: { emailOrigemId }, include });
      if (deNovo) return { lancamento: await publicar(deNovo), idempotente: true };
    }
    throw e;
  }
}

async function pendente(id: number) {
  const l = await prisma.lancamentoAutomatico.findUnique({ where: { id } });
  if (!l) throw new NotFound('Lançamento automático');
  if (l.status !== 'PENDENTE') throw new AppError('Este lançamento já foi revisado.', 409, 'JA_REVISADO');
  return l;
}

/** Confio: passa a existir no caixa/banco. Não quita conta a pagar nem a receber. */
export async function confiar(id: number, usuarioId: number) {
  await pendente(id);
  const atualizado = await prisma.$transaction(async (tx) => {
    const ainda = await tx.lancamentoAutomatico.findUnique({ where: { id } });
    if (!ainda || ainda.status !== 'PENDENTE') throw new AppError('Este lançamento já foi revisado.', 409, 'JA_REVISADO');
    const confirmado = { status: 'CONFIADO', confiadoPorId: usuarioId, confiadoEm: new Date() };
    // já está no caixa ou num título: só a pessoa confirma, sem lançar de novo
    if (ainda.jaLancado) {
      return tx.lancamentoAutomatico.update({ where: { id: ainda.id }, data: confirmado, include });
    }
    if (ainda.tipo === 'TRANSFERENCIA') {
      if (!ainda.contaFinanceiraId || !ainda.contaDestinoId) throw new AppError('Informe a conta de origem e a de destino.', 422, 'CONTAS_OBRIGATORIAS');
      const par = await transferirEntreContas(
        {
          origemId: ainda.contaFinanceiraId,
          destinoId: ainda.contaDestinoId,
          valor: ainda.valor,
          data: ainda.data,
          descricao: ainda.descricao?.trim() || `Transferência · ${ainda.contraparte}`,
        },
        tx,
      );
      return tx.lancamentoAutomatico.update({
        where: { id: ainda.id },
        data: { ...confirmado, categoriaId: null, movimentoId: par.saida.id, movimentoEntradaId: par.entrada.id },
        include,
      });
    }
    if (!ainda.contaFinanceiraId) throw new AppError('Informe a conta financeira.', 422, 'CONTA_OBRIGATORIA');
    const mov = await criarMovimentoAvulso(
      {
        contaFinanceiraId: ainda.contaFinanceiraId,
        data: ainda.data,
        tipo: ainda.tipo === 'ENTRADA' ? 'ENTRADA' : 'SAIDA',
        valor: ainda.valor,
        descricao: ainda.descricao?.trim() || (ainda.tipo === 'ENTRADA' ? `Recebido de ${ainda.contraparte}` : `Pago a ${ainda.contraparte}`),
        categoriaId: ainda.categoriaId,
        observacoes: `Lançamento automático #${ainda.id} aceito na revisão. E-mail ${ainda.emailOrigemId}. Bot: ${ainda.botNome}. Não quita contas a pagar nem a receber.`,
      },
      tx,
    );
    return tx.lancamentoAutomatico.update({
      where: { id: ainda.id },
      data: { ...confirmado, movimentoId: mov.id },
      include,
    });
  });
  return publicar(atualizado);
}

/** Contestar: fica registrado quem discordou e por quê. O saldo não muda. */
export async function contestar(id: number, usuarioId: number, observacao: string) {
  const texto = observacao.trim();
  if (texto.length < 3) throw new AppError('A contestação precisa de uma observação.', 422, 'OBSERVACAO_OBRIGATORIA');
  await pendente(id);
  const atualizado = await prisma.$transaction(async (tx) => {
    const ainda = await tx.lancamentoAutomatico.findUnique({ where: { id } });
    if (!ainda || ainda.status !== 'PENDENTE') throw new AppError('Este lançamento já foi revisado.', 409, 'JA_REVISADO');
    return tx.lancamentoAutomatico.update({
      where: { id },
      data: {
        status: 'CONTESTADO',
        contestadoPorId: usuarioId,
        contestadoEm: new Date(),
        observacaoContestacao: texto,
        requerEstornoManual: ainda.jaLancado,
      },
      include,
    });
  });
  return publicar(atualizado);
}

/** Contas ativas para o bot escolher contaFinanceiraId / contaDestinoId. Sem saldo. */
export async function listarContasParaBot() {
  return prisma.contaFinanceira.findMany({
    where: { ativo: true, tipo: { not: 'COMPENSACAO' } },
    orderBy: [{ padrao: 'desc' }, { nome: 'asc' }],
    select: { id: true, nome: true, tipo: true, banco: true },
  });
}

/** Categorias ativas para o bot escolher categoriaId (RECEITA na entrada, DESPESA na saída). */
export async function listarCategoriasParaBot() {
  return prisma.categoriaFinanceira.findMany({
    where: { ativo: true },
    orderBy: [{ tipo: 'asc' }, { nome: 'asc' }],
    select: { id: true, nome: true, tipo: true },
  });
}
