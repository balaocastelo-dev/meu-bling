/**
 * CARNÊ PRÓPRIO — 28/10/2026.
 *
 * O cliente leva um carnê impresso (3 parcelas por folha, capa e folha de agradecimento) e paga cada parcela
 * por PIX lendo o QR Code: o dinheiro cai na conta da loja (Cora, CNPJ 34.397.947/0001-08).
 *
 * - Juros ao mês pelo risco do cliente (7% a 15%, calculado pelo sistema — ver risco.ts), tabela Price:
 *   parcelas iguais; a última acerta os centavos.
 * - Cada parcela é uma conta a receber (origem CARNE, ligada ao carnê) no banco do PIX. "Receber" faz a baixa
 *   no caixa/banco escolhido (PIX → Cora, dinheiro no balcão → Caixa), com multa e mora sugeridas se atrasou.
 * - Venda paga com a forma "Carnê": ao lançar as contas, as parcelas da venda nessa forma viram um carnê
 *   (mesmos vencimentos). A conta a receber da venda dessas parcelas é substituída pelas parcelas do carnê.
 * - DRE: a venda já é a receita; das parcelas do carnê só os juros entram (resultado financeiro,
 *   "Juros de carnê"); no regime de caixa o principal recebido entra como receita de vendas.
 */
import { addMonths, differenceInCalendarDays } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar, competenciaDe, proximoNumero } from '../../lib/util.js';
import { categoriaPadraoId } from '../comum/financeiro.js';
import { hojeMeioDia } from '../comum/datas.js';
import { baixarContaReceber, estornarContaReceber, saldoContaReceber } from '../financeiro/service.js';
import { pixCopiaECola } from './pix.js';
import { avaliar, carregarCfgRisco, carregarHistoricos } from './risco.js';

export const TIPO_CARNE = 'CARNE';
export const ORIGEM_CARNE = 'CARNE';
export const OBS_SUBSTITUIDA = 'Substituída pelo carnê nº';
/** CNPJ da loja (chave PIX padrão) */
export const CHAVE_PIX_PADRAO = '34397947000108';
const DIA = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Cálculo (tabela Price)
// ---------------------------------------------------------------------------------------------
export function calcularParcelas(valor: number, taxaPct: number, n: number) {
  const i = taxaPct / 100;
  const pmt = i > 0 ? (valor * i) / (1 - Math.pow(1 + i, -n)) : valor / n;
  const parcela = arredondar(pmt);
  const total = arredondar(pmt * n);
  const ultima = arredondar(total - parcela * (n - 1));
  const valores = Array.from({ length: n }, (_, k) => (k === n - 1 ? ultima : parcela));
  return { valorParcela: parcela, valores, total: arredondar(valores.reduce((s, v) => s + v, 0)), juros: arredondar(valores.reduce((s, v) => s + v, 0) - valor) };
}

export function vencimentosMensais(primeiro: Date, n: number) {
  return Array.from({ length: n }, (_, k) => addMonths(primeiro, k));
}

// ---------------------------------------------------------------------------------------------
// Configuração do PIX / carnê
// ---------------------------------------------------------------------------------------------
export async function configCarne(db: Tx | typeof prisma = prisma) {
  const e = await db.empresa.findUnique({ where: { id: 1 } });
  return {
    pixChave: e?.pixChave || (e?.cnpj || '').replace(/\D/g, '') || CHAVE_PIX_PADRAO,
    pixNome: e?.pixNome || e?.razaoSocial || e?.nomeFantasia || 'BALAO DA INFORMATICA',
    pixCidade: e?.pixCidade || e?.municipio || 'CAMPINAS',
    taxaMinPct: e?.carneTaxaMinPct ?? 7,
    taxaMaxPct: e?.carneTaxaMaxPct ?? 15,
    multaPct: e?.carneMultaPct ?? 2,
    moraMesPct: e?.carneMoraMesPct ?? 1,
  };
}
export type ConfigCarne = Awaited<ReturnType<typeof configCarne>>;

export function pixDaParcela(cfg: ConfigCarne, carne: { numero: number }, parcela: number, valor: number) {
  return pixCopiaECola({ chave: cfg.pixChave, nome: cfg.pixNome, cidade: cfg.pixCidade, valor, txid: `CARNE${carne.numero}P${parcela}`, descricao: `Carne ${carne.numero} parcela ${parcela}` });
}

/** multa + mora sugeridas para uma parcela atrasada */
export function encargosAtraso(cfg: ConfigCarne, saldo: number, vencimento: Date, data: Date) {
  const dias = differenceInCalendarDays(data, vencimento);
  if (dias <= 0 || saldo <= 0) return { dias: Math.max(0, dias), multa: 0, mora: 0, total: 0 };
  const multa = arredondar(saldo * (cfg.multaPct / 100));
  const mora = arredondar(saldo * (cfg.moraMesPct / 100 / 30) * dias);
  return { dias, multa, mora, total: arredondar(multa + mora) };
}

async function formaCarne(db: Tx | typeof prisma) {
  return db.formaPagamento.findFirst({ where: { tipo: TIPO_CARNE, ativo: true }, orderBy: { id: 'asc' } });
}

async function contaDoPix(db: Tx | typeof prisma, preferida?: number | null) {
  if (preferida) {
    const c = await db.contaFinanceira.findFirst({ where: { id: preferida, ativo: true }, select: { id: true } });
    if (c) return c.id;
  }
  const forma = await formaCarne(db);
  if (forma?.contaFinanceiraId) return forma.contaFinanceiraId;
  const cora = await db.contaFinanceira.findFirst({ where: { ativo: true, nome: { contains: 'CORA' } }, select: { id: true } });
  if (cora) return cora.id;
  const banco = await db.contaFinanceira.findFirst({ where: { ativo: true, tipo: 'BANCO' }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }], select: { id: true } });
  return banco?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// Criar / alterar / cancelar
// ---------------------------------------------------------------------------------------------
export interface NovoCarne {
  clienteId: number;
  vendaId?: number | null;
  valorFinanciado: number;
  /** vazio = juros pelo risco do cliente */
  taxaMensalPct?: number | null;
  parcelas: number;
  primeiroVencimento?: Date | null;
  /** vencimentos já definidos (parcelas da venda) — prevalece sobre primeiroVencimento */
  vencimentos?: Date[];
  dataEmissao?: Date | null;
  contaFinanceiraId?: number | null;
  descricao?: string | null;
  observacoes?: string | null;
}

export async function criarCarneTx(tx: Tx, d: NovoCarne) {
  if (!(d.valorFinanciado > 0)) throw new AppError('Informe o valor do carnê.', 422, 'VALOR_INVALIDO', { campo: 'valorFinanciado' });
  const n = d.vencimentos?.length || d.parcelas;
  if (!(n >= 1 && n <= 48)) throw new AppError('O carnê pode ter de 1 a 48 parcelas.', 422, 'PARCELAS_INVALIDAS', { campo: 'parcelas' });
  const cliente = await tx.contato.findUnique({ where: { id: d.clienteId }, select: { id: true, nome: true, documento: true } });
  if (!cliente) throw new NotFound('Cliente');
  const nomeN = cliente.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  if (nomeN === 'consumidor final' && !(cliente.documento || '').replace(/\D/g, '')) {
    throw new AppError('Carnê precisa de um cliente cadastrado (com CPF/CNPJ), não "Consumidor final".', 422, 'CLIENTE_OBRIGATORIO', { campo: 'clienteId' });
  }
  const cfgRisco = await carregarCfgRisco(tx);
  const hist = await carregarHistoricos([cliente.id], new Date(), tx);
  const aval = hist.get(cliente.id) ? avaliar(hist.get(cliente.id)!, cfgRisco) : null;
  const taxa = d.taxaMensalPct ?? aval?.taxaPct ?? cfgRisco.taxaMax;
  if (taxa < 0 || taxa > 30) throw new AppError('Juros ao mês fora do permitido (0% a 30%).', 422, 'TAXA_INVALIDA', { campo: 'taxaMensalPct' });
  const emissao = d.dataEmissao ?? hojeMeioDia();
  const vencs = d.vencimentos?.length ? [...d.vencimentos].sort((a, b) => +a - +b) : vencimentosMensais(d.primeiroVencimento ?? addMonths(emissao, 1), n);
  const calc = calcularParcelas(d.valorFinanciado, taxa, n);
  const numero = await proximoNumero('CARNE', tx);
  const conta = await contaDoPix(tx, d.contaFinanceiraId);
  const carne = await tx.carne.create({
    data: {
      numero,
      clienteId: cliente.id,
      vendaId: d.vendaId ?? null,
      descricao: d.descricao || null,
      dataEmissao: emissao,
      valorFinanciado: arredondar(d.valorFinanciado),
      taxaMensalPct: taxa,
      parcelas: n,
      primeiroVencimento: vencs[0],
      valorParcela: calc.valorParcela,
      total: calc.total,
      juros: calc.juros,
      risco: aval?.classe ?? null,
      score: aval?.score ?? null,
      contaFinanceiraId: conta,
      observacoes: d.observacoes || null,
    },
  });
  await criarContasDoCarne(tx, carne, vencs, calc.valores);
  return carne.id;
}

async function criarContasDoCarne(tx: Tx, carne: { id: number; numero: number; clienteId: number; vendaId: number | null; contaFinanceiraId: number | null; dataEmissao: Date }, vencs: Date[], valores: number[]) {
  const categoriaId = await categoriaPadraoId(tx, 'Venda de produtos', 'RECEITA', 'RECEITA_BRUTA');
  const forma = await formaCarne(tx);
  const venda = carne.vendaId ? await tx.venda.findUnique({ where: { id: carne.vendaId }, select: { vendedorId: true, numero: true } }) : null;
  const n = valores.length;
  for (let k = 0; k < n; k++) {
    await tx.contaReceber.create({
      data: {
        contatoId: carne.clienteId,
        vendedorId: venda?.vendedorId ?? null,
        descricao: `Carnê nº ${carne.numero} (${k + 1}/${n})${venda ? ` — venda nº ${venda.numero}` : ''}`,
        dataEmissao: carne.dataEmissao,
        vencimento: vencs[k],
        competencia: competenciaDe(vencs[k]),
        valor: valores[k],
        situacao: 'ABERTO',
        formaPagamentoId: forma?.id ?? null,
        contaFinanceiraId: carne.contaFinanceiraId,
        categoriaId,
        origemTipo: ORIGEM_CARNE,
        origemId: carne.id,
        parcela: `${k + 1}/${n}`,
        carneId: carne.id,
        carneParcela: k + 1,
      },
    });
  }
}

export async function criarCarne(d: NovoCarne) {
  const id = await prisma.$transaction((tx) => criarCarneTx(tx, d));
  return carneCompleto(id);
}

async function temRecebimento(tx: Tx | typeof prisma, carneId: number) {
  const n = await tx.contaReceber.count({ where: { carneId, situacao: { not: 'CANCELADO' }, valorRecebido: { gt: 0 } } });
  return n > 0;
}

/** Cancela (sem nenhuma parcela recebida). */
export async function cancelarCarneTx(tx: Tx, id: number) {
  const c = await tx.carne.findUnique({ where: { id } });
  if (!c) throw new NotFound('Carnê');
  if (c.situacao === 'CANCELADO') return;
  if (await temRecebimento(tx, id)) throw new AppError(`O carnê nº ${c.numero} já tem parcela recebida. Estorne os recebimentos antes de cancelar.`, 422, 'TEM_PAGAMENTO', { carneId: id });
  await tx.contaReceber.updateMany({ where: { carneId: id }, data: { situacao: 'CANCELADO' } });
  await tx.carne.update({ where: { id }, data: { situacao: 'CANCELADO' } });
  // venda: devolve as contas da venda que o carnê tinha substituído
  if (c.vendaId) await restaurarContasDaVenda(tx, c.vendaId, c.numero);
}

export async function cancelarCarne(id: number) {
  await prisma.$transaction((tx) => cancelarCarneTx(tx, id));
  return carneCompleto(id);
}

/** Muda juros, quantidade de parcelas ou o 1º vencimento (só sem parcela recebida): refaz as parcelas. */
export async function alterarCarne(id: number, d: { taxaMensalPct?: number | null; parcelas?: number | null; primeiroVencimento?: Date | null; observacoes?: string | null; descricao?: string | null }) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.carne.findUnique({ where: { id } });
    if (!c) throw new NotFound('Carnê');
    if (c.situacao === 'CANCELADO') throw new AppError('Carnê cancelado.', 422, 'SITUACAO_INVALIDA');
    const mudaValores = (d.taxaMensalPct != null && d.taxaMensalPct !== c.taxaMensalPct) || (d.parcelas != null && d.parcelas !== c.parcelas) || (d.primeiroVencimento != null && +d.primeiroVencimento !== +c.primeiroVencimento);
    if (mudaValores) {
      if (await temRecebimento(tx, id)) throw new AppError('Já há parcela recebida: não dá para mudar juros, parcelas ou vencimentos.', 422, 'TEM_PAGAMENTO');
      const taxa = d.taxaMensalPct ?? c.taxaMensalPct;
      if (taxa < 0 || taxa > 30) throw new AppError('Juros ao mês fora do permitido (0% a 30%).', 422, 'TAXA_INVALIDA', { campo: 'taxaMensalPct' });
      const n = d.parcelas ?? c.parcelas;
      if (!(n >= 1 && n <= 48)) throw new AppError('O carnê pode ter de 1 a 48 parcelas.', 422, 'PARCELAS_INVALIDAS', { campo: 'parcelas' });
      // vencimentos: mantém os atuais quando só a taxa muda; senão mensais a partir do 1º
      const atuais = await tx.contaReceber.findMany({ where: { carneId: id, situacao: { not: 'CANCELADO' } }, orderBy: { carneParcela: 'asc' }, select: { vencimento: true } });
      const vencs = n === atuais.length && d.primeiroVencimento == null ? atuais.map((a) => a.vencimento) : vencimentosMensais(d.primeiroVencimento ?? c.primeiroVencimento, n);
      const calc = calcularParcelas(c.valorFinanciado, taxa, n);
      await tx.contaReceber.deleteMany({ where: { carneId: id, valorRecebido: 0, lancamentos: { none: {} } } });
      await tx.contaReceber.updateMany({ where: { carneId: id }, data: { situacao: 'CANCELADO' } });
      const novo = await tx.carne.update({ where: { id }, data: { taxaMensalPct: taxa, parcelas: n, primeiroVencimento: vencs[0], valorParcela: calc.valorParcela, total: calc.total, juros: calc.juros } });
      await criarContasDoCarne(tx, novo, vencs, calc.valores);
    }
    const extra: any = {};
    if (d.observacoes !== undefined) extra.observacoes = d.observacoes || null;
    if (d.descricao !== undefined) extra.descricao = d.descricao || null;
    if (Object.keys(extra).length) await tx.carne.update({ where: { id }, data: extra });
  });
  return carneCompleto(id);
}

// ---------------------------------------------------------------------------------------------
// Recebimento (baixa no caixa / banco)
// ---------------------------------------------------------------------------------------------
export async function receberParcela(carneId: number, contaId: number, d: { valor?: number | null; data?: Date | null; contaFinanceiraId?: number | null; formaPagamentoId?: number | null; juros?: number | null; desconto?: number | null; observacoes?: string | null }) {
  const cr = await prisma.contaReceber.findUnique({ where: { id: contaId }, include: { carne: true } });
  if (!cr || cr.carneId !== carneId) throw new NotFound('Parcela do carnê');
  if (cr.carne?.situacao === 'CANCELADO') throw new AppError('Carnê cancelado.', 422, 'SITUACAO_INVALIDA');
  const data = d.data ?? hojeMeioDia();
  const cfg = await configCarne();
  const saldo = saldoContaReceber(cr);
  const sug = encargosAtraso(cfg, saldo, cr.vencimento, data);
  const juros = arredondar(d.juros ?? sug.total);
  const desconto = arredondar(d.desconto ?? 0);
  const valor = arredondar(d.valor ?? saldo + juros - desconto);
  const conta = d.contaFinanceiraId ?? cr.contaFinanceiraId ?? (await contaDoPix(prisma));
  if (!conta) throw new AppError('Escolha onde o dinheiro entrou.', 422, 'SEM_CONTA_FINANCEIRA', { campo: 'contaFinanceiraId' });
  await baixarContaReceber({ id: cr.id, valor, data, contaFinanceiraId: conta, formaPagamentoId: d.formaPagamentoId ?? null, juros, desconto, observacoes: d.observacoes || `Carnê nº ${cr.carne!.numero} — parcela ${cr.carneParcela}` });
  return carneCompleto(carneId);
}

export async function estornarParcela(carneId: number, contaId: number) {
  const cr = await prisma.contaReceber.findUnique({ where: { id: contaId } });
  if (!cr || cr.carneId !== carneId) throw new NotFound('Parcela do carnê');
  await estornarContaReceber(contaId);
  return carneCompleto(carneId);
}

// ---------------------------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------------------------
export type StatusCarne = 'EM_DIA' | 'ATRASADO' | 'QUITADO' | 'CANCELADO';

type ParcelaRaw = { id: number; carneParcela: number | null; vencimento: Date; valor: number; valorRecebido: number; juros: number; desconto: number; situacao: string; dataRecebimento: Date | null; contaFinanceiraId: number | null };

/** parcelas que valem: as ativas; num carnê cancelado, a última versão de cada parcela (para mostrar o que era) */
function parcelasVigentes<T extends { id: number; carneParcela: number | null; situacao: string }>(parcelas: T[], situacaoCarne: string): T[] {
  if (situacaoCarne !== 'CANCELADO') return parcelas.filter((p) => p.situacao !== 'CANCELADO');
  const ult = new Map<number, T>();
  for (const p of parcelas) {
    const k = p.carneParcela ?? 0;
    if (!ult.has(k) || ult.get(k)!.id < p.id) ult.set(k, p);
  }
  return [...ult.values()].sort((a, b) => (a.carneParcela ?? 0) - (b.carneParcela ?? 0));
}

function resumoParcelas(parcelas: ParcelaRaw[], situacaoCarne: string, agora = new Date()) {
  const ativas = parcelasVigentes(parcelas, situacaoCarne);
  if (situacaoCarne === 'CANCELADO') return { status: 'CANCELADO' as StatusCarne, recebido: 0, saldo: 0, vencido: 0, pagas: 0, quantidade: ativas.length, maiorAtraso: 0, proxima: null };
  const hoje0 = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  let recebido = 0;
  let saldo = 0;
  let vencido = 0;
  let pagas = 0;
  let maiorAtraso = 0;
  let proxima: ParcelaRaw | null = null;
  for (const p of ativas) {
    recebido += p.valorRecebido;
    const s = saldoContaReceber(p);
    if (p.situacao === 'RECEBIDO' || s <= 0.009) {
      pagas++;
      continue;
    }
    saldo += s;
    if (p.vencimento.getTime() < hoje0) {
      vencido += s;
      maiorAtraso = Math.max(maiorAtraso, Math.floor((hoje0 - p.vencimento.getTime()) / DIA));
    }
    if (!proxima || p.vencimento < proxima.vencimento) proxima = p;
  }
  const status: StatusCarne = situacaoCarne === 'CANCELADO' ? 'CANCELADO' : ativas.length && pagas === ativas.length ? 'QUITADO' : vencido > 0 ? 'ATRASADO' : 'EM_DIA';
  return { status, recebido: arredondar(recebido), saldo: arredondar(saldo), vencido: arredondar(vencido), pagas, quantidade: ativas.length, maiorAtraso, proxima: proxima ? { id: proxima.id, parcela: proxima.carneParcela, vencimento: proxima.vencimento, valor: arredondar(saldoContaReceber(proxima)) } : null };
}

const selectParcela = { id: true, carneParcela: true, vencimento: true, valor: true, valorRecebido: true, juros: true, desconto: true, situacao: true, dataRecebimento: true, contaFinanceiraId: true } as const;

export async function listarCarnes(f: { status?: StatusCarne; clienteId?: number; pesquisa?: string; ini?: Date | null; fim?: Date | null }) {
  const where: any = {};
  if (f.clienteId) where.clienteId = f.clienteId;
  if (f.ini || f.fim) where.dataEmissao = { ...(f.ini ? { gte: f.ini } : {}), ...(f.fim ? { lte: f.fim } : {}) };
  if (f.pesquisa) {
    const n = Number(f.pesquisa.replace(/\D/g, ''));
    where.OR = [{ cliente: { nome: { contains: f.pesquisa } } }, ...(n ? [{ numero: n }, { venda: { numero: n } }] : [])];
  }
  const carnes = await prisma.carne.findMany({
    where,
    orderBy: { id: 'desc' },
    include: { cliente: { select: { id: true, nome: true, celular: true, telefone: true } }, venda: { select: { id: true, numero: true } }, contas: { select: selectParcela, orderBy: { carneParcela: 'asc' } } },
  });
  const linhas = carnes.map(({ contas, ...c }) => ({ ...c, ...resumoParcelas(contas, c.situacao) }));
  const filtradas = f.status ? linhas.filter((l) => l.status === f.status) : linhas;
  const ativos = linhas.filter((l) => l.status !== 'CANCELADO');
  const totais = {
    carnes: ativos.length,
    emAberto: arredondar(ativos.reduce((s, l) => s + l.saldo, 0)),
    vencido: arredondar(ativos.reduce((s, l) => s + l.vencido, 0)),
    recebido: arredondar(ativos.reduce((s, l) => s + l.recebido, 0)),
    jurosContratados: arredondar(ativos.reduce((s, l) => s + l.juros, 0)),
    atrasados: ativos.filter((l) => l.status === 'ATRASADO').length,
  };
  return { data: filtradas, totais };
}

export async function carneCompleto(id: number) {
  const c = await prisma.carne.findUnique({
    where: { id },
    include: {
      cliente: { select: { id: true, nome: true, documento: true, celular: true, telefone: true, email: true, logradouro: true, numero: true, bairro: true, municipio: true, uf: true } },
      venda: { select: { id: true, numero: true, data: true, total: true } },
      contaFinanceira: { select: { id: true, nome: true } },
      contas: { orderBy: [{ carneParcela: 'asc' }, { id: 'asc' }], select: { ...selectParcela, lancamentos: { select: { id: true, data: true, valor: true, contaFinanceira: { select: { nome: true } } } } } },
    },
  });
  if (!c) throw new NotFound('Carnê');
  const cfg = await configCarne();
  const agora = hojeMeioDia();
  const ativas = parcelasVigentes(c.contas, c.situacao);
  const parcelas = ativas.map((p) => {
    const saldo = saldoContaReceber(p);
    const enc = p.situacao === 'RECEBIDO' ? { dias: 0, multa: 0, mora: 0, total: 0 } : encargosAtraso(cfg, saldo, p.vencimento, agora);
    return { ...p, saldo, encargos: enc, pix: pixDaParcela(cfg, c, p.carneParcela ?? 0, p.valor) };
  });
  const { contas, ...resto } = c;
  void contas;
  return { ...resto, parcelasLista: parcelas, ...resumoParcelas(ativas, c.situacao), recebedor: { chave: cfg.pixChave, nome: cfg.pixNome, cidade: cfg.pixCidade }, multaPct: cfg.multaPct, moraMesPct: cfg.moraMesPct };
}

// ---------------------------------------------------------------------------------------------
// Venda paga com a forma "Carnê"
// ---------------------------------------------------------------------------------------------
async function restaurarContasDaVenda(tx: Tx, vendaId: number, numeroCarne: number) {
  const marca = `${OBS_SUBSTITUIDA} ${numeroCarne}`;
  const crs = await tx.contaReceber.findMany({ where: { origemTipo: 'VENDA', origemId: vendaId, situacao: 'CANCELADO', observacoes: { contains: marca } } });
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, select: { contasLancadas: true } });
  for (const cr of crs) {
    const obs = (cr.observacoes || '').split('\n').filter((l) => !l.startsWith(OBS_SUBSTITUIDA)).join('\n') || null;
    await tx.contaReceber.update({ where: { id: cr.id }, data: { situacao: venda?.contasLancadas ? 'ABERTO' : 'CANCELADO', observacoes: obs } });
  }
}

/** Cria (ou ajusta) o carnê das parcelas da venda na forma "Carnê". Idempotente. */
export async function lancarCarneVenda(tx: Tx, vendaId: number) {
  const venda = await tx.venda.findUnique({ where: { id: vendaId }, include: { parcelas: { include: { formaPagamento: true, contaReceber: true }, orderBy: { numero: 'asc' } } } });
  if (!venda || venda.tipo !== 'PEDIDO' || !venda.contasLancadas) return null;
  const doCarne = venda.parcelas.filter((p) => p.formaPagamento?.tipo === TIPO_CARNE && p.valor > 0);
  const atual = await tx.carne.findFirst({ where: { vendaId, situacao: { not: 'CANCELADO' } }, include: { contas: { where: { situacao: { not: 'CANCELADO' } }, orderBy: { carneParcela: 'asc' } } } });
  if (!doCarne.length) {
    if (atual) await cancelarCarneTx(tx, atual.id);
    return null;
  }
  const valor = arredondar(doCarne.reduce((s, p) => s + p.valor, 0));
  const vencs = doCarne.map((p) => p.dataVencimento);
  let carneId = atual?.id ?? null;
  if (atual) {
    const taxaVenda = venda.carneTaxaPct;
    const igual =
      Math.abs(atual.valorFinanciado - valor) < 0.01 &&
      atual.contas.length === vencs.length &&
      atual.contas.every((c, k) => +c.vencimento === +vencs[k]) &&
      (taxaVenda == null || Math.abs(taxaVenda - atual.taxaMensalPct) < 0.001) &&
      atual.clienteId === venda.contatoId;
    if (!igual) {
      if (await temRecebimento(tx, atual.id)) throw new AppError(`O carnê nº ${atual.numero} desta venda já tem parcela recebida: não dá para mudar as parcelas do carnê.`, 422, 'TEM_PAGAMENTO', { carneId: atual.id });
      await cancelarCarneTx(tx, atual.id);
      carneId = null;
    }
  }
  if (!carneId) {
    if (!venda.contatoId) throw new AppError('Carnê precisa de cliente na venda.', 422, 'CLIENTE_OBRIGATORIO', { campo: 'contatoId' });
    carneId = await criarCarneTx(tx, {
      clienteId: venda.contatoId,
      vendaId: venda.id,
      valorFinanciado: valor,
      taxaMensalPct: venda.carneTaxaPct,
      parcelas: vencs.length,
      vencimentos: vencs,
      dataEmissao: venda.data,
      descricao: `Venda nº ${venda.numero}`,
    });
  }
  const carne = (await tx.carne.findUnique({ where: { id: carneId }, select: { numero: true } }))!;
  // a conta a receber da venda dessas parcelas é substituída pelas parcelas do carnê
  for (const p of doCarne) {
    const cr = p.contaReceber;
    if (!cr || cr.situacao === 'CANCELADO') continue;
    if (cr.valorRecebido > 0) throw new AppError(`Parcela ${p.numero} da venda já tem recebimento: estorne antes de passar para carnê.`, 422, 'JA_BAIXADA');
    const marca = `${OBS_SUBSTITUIDA} ${carne.numero}`;
    await tx.contaReceber.update({ where: { id: cr.id }, data: { situacao: 'CANCELADO', observacoes: [cr.observacoes, marca].filter(Boolean).join('\n') } });
  }
  return carneId;
}

/** Estorno das contas da venda: cancela o carnê (bloqueia se já recebeu parcela). */
export async function estornarCarneVenda(tx: Tx, vendaId: number) {
  const ativos = await tx.carne.findMany({ where: { vendaId, situacao: { not: 'CANCELADO' } } });
  for (const c of ativos) {
    if (await temRecebimento(tx, c.id)) throw new AppError(`O carnê nº ${c.numero} desta venda já tem parcela recebida. Estorne os recebimentos antes.`, 422, 'TEM_PAGAMENTO', { carneId: c.id });
    await tx.contaReceber.updateMany({ where: { carneId: c.id }, data: { situacao: 'CANCELADO' } });
    await tx.carne.update({ where: { id: c.id }, data: { situacao: 'CANCELADO' } });
  }
}

/** Avaliação para a tela de finalizar a venda (vendedor vê sem acesso ao financeiro). */
export async function previaCarneVenda(contatoId: number | null) {
  const cfg = await carregarCfgRisco();
  if (!contatoId) return { taxaMin: cfg.taxaMin, taxaMax: cfg.taxaMax, avaliacao: null };
  const hist = await carregarHistoricos([contatoId]);
  const h = hist.get(contatoId);
  const a = h ? avaliar(h, cfg) : null;
  return {
    taxaMin: cfg.taxaMin,
    taxaMax: cfg.taxaMax,
    avaliacao: a ? { classe: a.classe, score: a.score, taxaPct: a.taxaPct, apto: a.apto, comRessalva: a.comRessalva, limite: a.limite, disponivel: a.disponivel, bloqueios: a.bloqueios, motivos: a.motivos } : null,
  };
}

export { DIA };
