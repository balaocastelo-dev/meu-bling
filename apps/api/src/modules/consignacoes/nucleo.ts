/**
 * CONSIGNAÇÃO — núcleo das regras (sem depender do módulo de compras, para os ganchos
 * da venda e da compra poderem chamar daqui sem import circular).
 *
 * Regras do Thiago (28/10/2026):
 *  - consignante fica com 80% do preço (configurável por contrato) — valor TRAVADO no contrato;
 *    só muda com desconto autorizado por ele (o robô pede 5% nos primeiros dias pelo WhatsApp);
 *  - vendeu → a loja paga o consignante na hora;
 *  - 10 dias corridos sem vender → a loja paga 5% do valor por dia útil (mínimo R$ 100, máximo R$ 1.000)
 *    até quitar (20 pagamentos ≈ um mês); quitado, o equipamento vira estoque próprio;
 *  - vendeu no meio das diárias → o painel do ADM sugere quitar o saldo (ou seguir nas diárias);
 *  - retirada antes do prazo paga taxa de R$ 100; depois do prazo não paga;
 *  - o consignante recebe WhatsApp e tem um link para assinar, acompanhar e escolher retirar ou receber.
 */
import crypto from 'node:crypto';
import { prisma, type Tx } from '../../lib/prisma.js';
import { arredondar, competenciaDe } from '../../lib/util.js';
import { env } from '../../lib/env.js';
import { categoriaPadraoId } from '../comum/financeiro.js';
import { chaveDia, diasEntre, diasUteisDepois, inicioDoDia, meioDia } from './calendario.js';

type Db = Tx | typeof prisma;

export const STATUS = ['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA', 'VENDIDO', 'QUITADO', 'RETIRADO', 'CANCELADO'] as const;
export type Status = (typeof STATUS)[number];
export const STATUS_ATIVOS: Status[] = ['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'];
export const TIPOS_EQUIPAMENTO = ['NOTEBOOK', 'PC', 'PC_GAMER', 'CELULAR', 'TABLET', 'GAMES', 'MONITOR', 'OUTRO'] as const;

export const ROTULO_STATUS: Record<Status, string> = {
  NO_PRAZO: 'No prazo',
  EM_DIARIAS: 'Em diárias',
  AGUARDANDO_RETIRADA: 'Aguardando retirada',
  VENDIDO: 'Vendido',
  QUITADO: 'Quitado (estoque próprio)',
  RETIRADO: 'Retirado',
  CANCELADO: 'Cancelado',
};

export const CATEGORIA_PAGAMENTO = 'Compra de mercadorias (CMV)';
export const CATEGORIA_TAXA = 'Taxa de retirada (consignação)';
export const CATEGORIA_DEVOLUCAO = 'Devolução de diárias (consignação)';

// ---------------------------------------------------------------------------- configuração
export interface RegrasConsignacao {
  percentualConsignante: number;
  prazoDias: number;
  diariaPct: number;
  diariaMinima: number;
  diariaMaxima: number;
  taxaRetirada: number;
  /** desconto que o robô pede ao consignante nos primeiros dias */
  descontoPct: number;
  /** dias (contados da entrada) em que o robô pede o desconto, enquanto não vende */
  diasPedirDesconto: number[];
  /** limite de saída de caixa por dia somando todas as diárias (0 = sem limite): passou, o painel avisa */
  tetoDiarioLoja: number;
  /** dias sem expediente além dos feriados (AAAA-MM-DD) */
  feriadosExtras: string[];
  /** mandar WhatsApp automático ao consignante */
  whatsapp: boolean;
}

export const REGRAS_PADRAO: RegrasConsignacao = {
  percentualConsignante: 80,
  prazoDias: 10,
  diariaPct: 5,
  diariaMinima: 100,
  diariaMaxima: 1000,
  taxaRetirada: 100,
  descontoPct: 5,
  diasPedirDesconto: [3, 7],
  tetoDiarioLoja: 0,
  feriadosExtras: [],
  whatsapp: true,
};

const CHAVE_CONFIG = 'consignacao.regras';

export async function lerRegras(db: Db = prisma): Promise<RegrasConsignacao> {
  const c = await db.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } });
  if (!c) return { ...REGRAS_PADRAO };
  try {
    return { ...REGRAS_PADRAO, ...JSON.parse(c.valor) };
  } catch {
    return { ...REGRAS_PADRAO };
  }
}

export async function salvarRegras(r: Partial<RegrasConsignacao>) {
  const atual = await lerRegras();
  const novo = { ...atual, ...r };
  const valor = JSON.stringify(novo);
  await prisma.configuracao.upsert({ where: { chave: CHAVE_CONFIG }, create: { chave: CHAVE_CONFIG, valor }, update: { valor } });
  return novo;
}

// ---------------------------------------------------------------------------- contas
export function valorDoConsignante(precoVenda: number, pct: number) {
  return arredondar(precoVenda * (pct / 100));
}

/** Diária = % do valor do consignante, entre o mínimo e o máximo; a última parcela fecha a conta. */
export function planoDiarias(valor: number, r: { diariaPct: number; diariaMinima: number; diariaMaxima: number }) {
  if (!(valor > 0.009)) return { diaria: 0, quantidade: 0, parcelas: [] as number[] };
  let diaria = arredondar(valor * (r.diariaPct / 100));
  if (r.diariaMinima > 0) diaria = Math.max(diaria, r.diariaMinima);
  if (r.diariaMaxima > 0) diaria = Math.min(diaria, r.diariaMaxima);
  diaria = arredondar(Math.min(diaria, valor));
  const quantidade = Math.ceil((valor - 0.005) / diaria);
  const parcelas = Array.from({ length: quantidade }, (_, i) => (i === quantidade - 1 ? arredondar(valor - diaria * (quantidade - 1)) : diaria));
  return { diaria, quantidade, parcelas };
}

export function novoToken() {
  return crypto.randomBytes(12).toString('hex');
}

export function linkConsignante(token: string) {
  return `${env.APP_URL.replace(/\/$/, '')}/p/consignacao/${token}`;
}

export const moedaBr = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const dataBr = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function lerJson<T>(v: string | null | undefined, padrao: T): T {
  if (!v) return padrao;
  try {
    return JSON.parse(v) as T;
  } catch {
    return padrao;
  }
}

export const abertas = (c: { situacao: string }) => c.situacao === 'ABERTO' || c.situacao === 'PARCIAL';
const saldoConta = (c: { valor: number; valorPago: number; juros: number; desconto: number }) => arredondar(c.valor - (c.valorPago - c.juros) - c.desconto);

export async function registrarEvento(db: Db, consignacaoId: number, tipo: string, texto: string, opts: { publico?: boolean; usuarioId?: number | null } = {}) {
  await db.consignacaoEvento.create({ data: { consignacaoId, tipo, texto, publico: opts.publico ?? true, usuarioId: opts.usuarioId ?? null } });
}

// ---------------------------------------------------------------------------- WhatsApp ao consignante
/** Mensagem só no horário comercial (8h–20h); fora disso fica agendada para as 8h. */
function horarioComercial(agora = new Date()) {
  const h = agora.getHours();
  if (h >= 8 && h < 20) return agora;
  const r = new Date(agora);
  if (h >= 20) r.setDate(r.getDate() + 1);
  r.setHours(8, 0, 0, 0);
  return r;
}

/**
 * Enfileira um WhatsApp para o consignante (o worker de notificações envia).
 * `chave` evita mandar a mesma mensagem duas vezes (fica gravada em `avisos`).
 */
export async function avisarConsignante(db: Db, c: { id: number; avisos: string | null; consignanteId: number }, chave: string | null, texto: string) {
  const regras = await lerRegras(db);
  const avisos = lerJson<Record<string, string>>(c.avisos, {});
  if (chave && avisos[chave]) return false;
  if (regras.whatsapp) {
    const contato = await db.contato.findUnique({ where: { id: c.consignanteId }, select: { celular: true, telefone: true } });
    const destino = (contato?.celular || contato?.telefone || '').replace(/\D/g, '');
    const valido = destino.length >= 10;
    await db.notificacao.create({
      data: {
        canal: 'WHATSAPP',
        destinatario: destino,
        corpo: texto,
        contatoId: c.consignanteId,
        origemTipo: 'CONSIGNACAO',
        origemId: c.id,
        agendadaPara: horarioComercial(),
        status: valido ? 'PENDENTE' : 'CANCELADA',
        erro: valido ? null : 'Consignante sem celular',
      },
    });
  }
  if (chave) {
    avisos[chave] = new Date().toISOString();
    await db.consignacao.update({ where: { id: c.id }, data: { avisos: JSON.stringify(avisos) } });
    c.avisos = JSON.stringify(avisos);
  }
  return true;
}

export async function primeiroNome(db: Db, contatoId: number) {
  const c = await db.contato.findUnique({ where: { id: contatoId }, select: { nome: true } });
  return (c?.nome || '').trim().split(/\s+/)[0] || 'tudo bem';
}

// ---------------------------------------------------------------------------- diárias
type ConsBase = {
  id: number;
  numero: number;
  descricao: string;
  consignanteId: number;
  valorConsignante: number;
  dataLimite: Date;
  diariaPct: number;
  diariaMinima: number;
  diariaMaxima: number;
  avisos: string | null;
  token: string;
};

async function pagoAte(db: Db, consignacaoId: number) {
  const contas = await db.contaPagar.findMany({ where: { consignacaoId, situacao: { not: 'CANCELADO' } }, select: { valorPago: true, juros: true } });
  return arredondar(contas.reduce((s, c) => s + (c.valorPago - c.juros), 0));
}

/** Cancela as contas ainda sem nenhum pagamento (diárias futuras, valor da venda). */
async function cancelarContasSemPagamento(db: Db, consignacaoId: number, filtro: { parcela?: string } = {}) {
  const r = await db.contaPagar.updateMany({ where: { consignacaoId, situacao: 'ABERTO', valorPago: 0, ...(filtro.parcela ? { parcela: filtro.parcela } : {}) }, data: { situacao: 'CANCELADO' } });
  return r.count;
}

/**
 * Gera as diárias no contas a pagar: uma por dia útil a partir do primeiro dia útil depois do prazo
 * (ou depois de `aPartirDe`, quando o consignante volta a querer receber), até fechar o que falta.
 */
export async function gerarDiarias(db: Db, c: ConsBase, opts: { usuarioId?: number | null; aPartirDe?: Date } = {}) {
  const regras = await lerRegras(db);
  const ja = await pagoAte(db, c.id);
  const emAberto = await db.contaPagar.findMany({ where: { consignacaoId: c.id, situacao: { in: ['ABERTO', 'PARCIAL'] } } });
  const comprometido = arredondar(emAberto.reduce((s, x) => s + saldoConta(x), 0));
  const falta = arredondar(c.valorConsignante - ja - comprometido);
  if (falta <= 0.009) return { quantidade: 0, diaria: 0, primeira: null as Date | null };
  const plano = planoDiarias(falta, c);
  const base = opts.aPartirDe && opts.aPartirDe > c.dataLimite ? opts.aPartirDe : c.dataLimite;
  const datas = diasUteisDepois(base, plano.quantidade, regras.feriadosExtras);
  const categoriaId = await categoriaPadraoId(db, CATEGORIA_PAGAMENTO, 'DESPESA', 'CMV');
  for (let i = 0; i < plano.quantidade; i++) {
    await db.contaPagar.create({
      data: {
        contatoId: c.consignanteId,
        descricao: `Consignação nº ${c.numero} — diária ${i + 1}/${plano.quantidade} — ${c.descricao}`,
        dataEmissao: new Date(),
        vencimento: datas[i],
        competencia: competenciaDe(datas[i]),
        valor: plano.parcelas[i],
        categoriaId,
        origemTipo: 'CONSIGNACAO',
        origemId: c.id,
        consignacaoId: c.id,
        parcela: `${i + 1}/${plano.quantidade}`,
      },
    });
  }
  await db.consignacao.update({ where: { id: c.id }, data: { status: 'EM_DIARIAS', diariasIniciadasEm: new Date(), diariaValor: plano.diaria } });
  await registrarEvento(db, c.id, 'DIARIAS', `Prazo terminado sem venda: ${plano.quantidade} pagamento(s) de ${moedaBr(plano.diaria)} por dia útil, a partir de ${dataBr(datas[0])} (total ${moedaBr(falta)}).`, { usuarioId: opts.usuarioId });
  return { quantidade: plano.quantidade, diaria: plano.diaria, primeira: datas[0], total: falta };
}

// ---------------------------------------------------------------------------- quitação
/** Tudo pago? Em diárias → vira estoque próprio (compra "Fechado"); vendido → registra a quitação. */
export async function atualizarQuitacao(db: Db, consignacaoId: number) {
  const c = await db.consignacao.findUnique({ where: { id: consignacaoId } });
  if (!c || c.quitadoEm || !['EM_DIARIAS', 'VENDIDO', 'AGUARDANDO_RETIRADA'].includes(c.status)) return false;
  const pago = await pagoAte(db, c.id);
  if (pago + 0.009 < c.valorConsignante) return false;
  const abertasRestantes = await db.contaPagar.count({ where: { consignacaoId: c.id, situacao: { in: ['ABERTO', 'PARCIAL'] } } });
  if (abertasRestantes) {
    // pagou tudo antes do fim: o que sobrou (diárias futuras sem pagamento) não é mais devido
    await db.contaPagar.updateMany({ where: { consignacaoId: c.id, situacao: 'ABERTO', valorPago: 0 }, data: { situacao: 'CANCELADO' } });
  }
  const viraEstoque = c.status !== 'VENDIDO';
  await db.consignacao.update({ where: { id: c.id }, data: { quitadoEm: new Date(), ...(viraEstoque ? { status: 'QUITADO' } : {}) } });
  if (viraEstoque && c.compraId) {
    const compra = await db.compra.findUnique({ where: { id: c.compraId }, include: { situacao: true } });
    const fechado = await db.situacao.findFirst({ where: { modulo: 'COMPRA', nome: 'Fechado', ativo: true } });
    if (compra && fechado && compra.situacao.nome === 'Consignado') {
      await db.compra.update({ where: { id: compra.id }, data: { situacaoId: fechado.id } });
      await db.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: compra.id, deSituacaoId: compra.situacaoId, deSituacao: compra.situacao.nome, paraSituacaoId: fechado.id, paraSituacao: fechado.nome, observacao: `Consignação nº ${c.numero} quitada: mercadoria agora é estoque próprio` } });
    }
  }
  await registrarEvento(db, c.id, 'QUITADO', viraEstoque ? `Consignação quitada: ${moedaBr(c.valorConsignante)} pagos. O equipamento agora é estoque próprio da loja.` : `Consignante recebeu tudo: ${moedaBr(c.valorConsignante)}.`);
  const nome = await primeiroNome(db, c.consignanteId);
  await avisarConsignante(db, c, 'quitado', `Olá, ${nome}! Pagamento concluído: você recebeu os ${moedaBr(c.valorConsignante)} da consignação nº ${c.numero} (${c.descricao}). Muito obrigado pela confiança no Balão da Informática! 🙏\n${linkConsignante(c.token)}`);
  return true;
}

// ---------------------------------------------------------------------------- ganchos da venda / compra
/** A compra é de uma consignação? (o contas a pagar dela é controlado aqui, nunca pelas ações da compra) */
export async function consignacaoDaCompra(db: Db, compraId: number) {
  return db.consignacao.findUnique({ where: { compraId } });
}

/**
 * A mercadoria da consignação foi vendida (compra virou "Vendido").
 *  - nada pago ainda → cancela as diárias futuras e lança o valor do consignante para pagar HOJE;
 *  - já recebendo diárias → segue nas diárias e o painel sugere quitar o saldo (decisão do ADM).
 */
export async function aoVenderConsignado(tx: Tx, compraId: number, venda: { id: number; numero: number }, usuarioId: number | null) {
  const c = await tx.consignacao.findUnique({ where: { compraId } });
  if (!c || !['NO_PRAZO', 'EM_DIARIAS', 'AGUARDANDO_RETIRADA'].includes(c.status)) return;
  const pago = await pagoAte(tx, c.id);
  const emDiarias = c.status === 'EM_DIARIAS' && pago > 0.009;
  await tx.consignacao.update({ where: { id: c.id }, data: { status: 'VENDIDO', vendaId: venda.id, vendaNumero: venda.numero, vendidoEm: new Date(), vendidoEmDiarias: emDiarias } });
  await tx.consignacaoDesconto.updateMany({ where: { consignacaoId: c.id, status: 'PENDENTE' }, data: { status: 'EXPIRADO' } });
  const nome = await primeiroNome(tx, c.consignanteId);
  if (emDiarias) {
    const falta = arredondar(c.valorConsignante - pago);
    await registrarEvento(tx, c.id, 'VENDIDO', `Vendido na venda nº ${venda.numero} durante as diárias. Já pago: ${moedaBr(pago)}; falta ${moedaBr(falta)}.`, { usuarioId });
    await avisarConsignante(tx, c, 'vendido', `Boa notícia, ${nome}! Seu ${c.descricao} foi vendido. Você já recebeu ${moedaBr(pago)} e os ${moedaBr(falta)} que faltam seguem sendo pagos. Acompanhe: ${linkConsignante(c.token)}`);
    return;
  }
  await cancelarContasSemPagamento(tx, c.id);
  const falta = arredondar(c.valorConsignante - pago);
  if (falta > 0.009) {
    const categoriaId = await categoriaPadraoId(tx, CATEGORIA_PAGAMENTO, 'DESPESA', 'CMV');
    const hoje = meioDia(new Date());
    await tx.contaPagar.create({
      data: {
        contatoId: c.consignanteId,
        descricao: `Consignação nº ${c.numero} — vendido na venda nº ${venda.numero} — ${c.descricao}`,
        dataEmissao: hoje,
        vencimento: hoje,
        competencia: competenciaDe(hoje),
        valor: falta,
        categoriaId,
        origemTipo: 'CONSIGNACAO',
        origemId: c.id,
        consignacaoId: c.id,
        parcela: 'VENDA',
      },
    });
  }
  await registrarEvento(tx, c.id, 'VENDIDO', `Vendido na venda nº ${venda.numero}. Pagar ${moedaBr(falta)} ao consignante agora.`, { usuarioId });
  await avisarConsignante(tx, c, 'vendido', `Boa notícia, ${nome}! Seu ${c.descricao} foi vendido no Balão da Informática. Vamos te pagar ${moedaBr(falta)} agora. Acompanhe: ${linkConsignante(c.token)}`);
}

/** A venda do consignado foi estornada: o equipamento volta para a loja e a consignação volta a correr. */
export async function aoEstornarVendaConsignado(tx: Tx, compraId: number, usuarioId: number | null) {
  const c = await tx.consignacao.findUnique({ where: { compraId } });
  if (!c || c.status !== 'VENDIDO') return;
  const lancada = await tx.contaPagar.findFirst({ where: { consignacaoId: c.id, parcela: 'VENDA', situacao: { not: 'CANCELADO' } } });
  if (lancada && lancada.valorPago > 0) {
    // o consignante já recebeu pela venda: o equipamento fica como estoque próprio
    await tx.consignacao.update({ where: { id: c.id }, data: { status: c.quitadoEm ? 'QUITADO' : 'EM_DIARIAS', vendaId: null, vendaNumero: null, vendidoEm: null, vendidoEmDiarias: false } });
    await registrarEvento(tx, c.id, 'VENDA_ESTORNADA', `Venda nº ${c.vendaNumero} estornada depois do pagamento ao consignante: o equipamento voltou ao estoque.`, { publico: false, usuarioId });
    return;
  }
  if (lancada) await tx.contaPagar.update({ where: { id: lancada.id }, data: { situacao: 'CANCELADO' } });
  const temDiarias = await tx.contaPagar.count({ where: { consignacaoId: c.id, parcela: { contains: '/' }, situacao: { not: 'CANCELADO' } } });
  const pago = await pagoAte(tx, c.id);
  const status: Status = temDiarias && pago > 0.009 ? 'EM_DIARIAS' : 'NO_PRAZO';
  await tx.consignacao.update({ where: { id: c.id }, data: { status, vendaId: null, vendaNumero: null, vendidoEm: null, vendidoEmDiarias: false } });
  await registrarEvento(tx, c.id, 'VENDA_ESTORNADA', `Venda nº ${c.vendaNumero} estornada: o equipamento voltou para a loja (${ROTULO_STATUS[status]}).`, { usuarioId });
  // diárias canceladas na venda: se já passou do prazo, o robô gera de novo na próxima volta
}

// ---------------------------------------------------------------------------- leitura e cálculo
export const includeConsignacao = {
  consignante: { select: { id: true, nome: true, documento: true, rg: true, celular: true, telefone: true, email: true, logradouro: true, numero: true, complemento: true, bairro: true, municipio: true, uf: true, cep: true } },
  vendedor: { select: { id: true, nome: true } },
  produto: { select: { id: true, codigo: true, nome: true, preco: true, ativo: true, saldos: { select: { saldo: true } } } },
  compra: { select: { id: true, numero: true, situacao: { select: { nome: true, cor: true } } } },
  contasPagar: { orderBy: { vencimento: 'asc' as const }, select: { id: true, descricao: true, valor: true, valorPago: true, juros: true, desconto: true, situacao: true, vencimento: true, dataPagamento: true, parcela: true } },
  contasReceber: { orderBy: { id: 'asc' as const }, select: { id: true, descricao: true, valor: true, valorRecebido: true, situacao: true, vencimento: true } },
  descontos: { orderBy: { id: 'desc' as const } },
  eventos: { orderBy: { id: 'desc' as const } },
} as const;

export type ConsignacaoLida = NonNullable<Awaited<ReturnType<typeof carregarConsignacao>>>;
export const carregarConsignacao = (id: number, db: Db = prisma) => db.consignacao.findUnique({ where: { id }, include: includeConsignacao });

export function fotosDe(c: { id: number; fotos: string | null }) {
  return lerJson<string[]>(c.fotos, []).map((nome) => ({ nome, url: `${env.BASE_PATH}/uploads/consignados/${c.id}/${nome}` }));
}

/** Números e o alerta do que fazer agora (painel da loja e link do consignante). */
export function calcular(c: ConsignacaoLida, hoje = new Date()) {
  const hojeIni = inicioDoDia(hoje);
  const fimHoje = new Date(hojeIni.getTime() + 86400000 - 1);
  const validas = c.contasPagar.filter((x) => x.situacao !== 'CANCELADO');
  const pago = arredondar(validas.reduce((s, x) => s + (x.valorPago - x.juros), 0));
  const encerrada = c.status === 'RETIRADO' || c.status === 'CANCELADO';
  const saldo = encerrada || c.status === 'QUITADO' ? 0 : Math.max(0, arredondar(c.valorConsignante - pago));
  const abertasL = validas.filter(abertas);
  const devidoHoje = arredondar(abertasL.filter((x) => x.vencimento <= fimHoje).reduce((s, x) => s + saldoConta(x), 0));
  const atrasado = arredondar(abertasL.filter((x) => x.vencimento < hojeIni).reduce((s, x) => s + saldoConta(x), 0));
  const diarias = validas.filter((x) => (x.parcela || '').includes('/'));
  const diariasPagas = diarias.filter((x) => x.situacao === 'PAGO').length;
  const proxima = abertasL.find((x) => x.vencimento > fimHoje) || null;
  const diasConsignado = Math.max(0, diasEntre(c.dataEntrada, hoje));
  const diasParaPrazo = diasEntre(hoje, c.dataLimite);
  const estoque = c.produto ? c.produto.saldos.reduce((s, x) => s + x.saldo, 0) : 0;
  const descontoPendente = c.descontos.find((d) => d.status === 'PENDENTE') || null;
  let alerta: { tom: 'vermelho' | 'amarelo' | 'verde' | 'azul'; texto: string } | null = null;
  if (c.status === 'VENDIDO' && saldo > 0.009) {
    alerta = c.vendidoEmDiarias
      ? { tom: 'amarelo', texto: `Vendido durante as diárias: falta ${moedaBr(saldo)} ao consignante. Sugestão: quitar o saldo agora (ou seguir pagando as diárias).` }
      : { tom: 'vermelho', texto: `Vendido! Pague ${moedaBr(saldo)} ao consignante agora.` };
  } else if (c.status === 'EM_DIARIAS' && atrasado > 0.009) alerta = { tom: 'vermelho', texto: `Diárias atrasadas: ${moedaBr(atrasado)} em aberto com o consignante.` };
  else if (c.status === 'EM_DIARIAS' && devidoHoje > 0.009) alerta = { tom: 'amarelo', texto: `Pagar hoje ${moedaBr(devidoHoje)} (diária ${Math.min(diariasPagas + 1, diarias.length)}/${diarias.length}).` };
  else if (c.status === 'AGUARDANDO_RETIRADA') alerta = { tom: 'azul', texto: 'O consignante escolheu retirar o equipamento: combine a retirada e registre no botão "Retirada".' };
  else if (c.status === 'NO_PRAZO' && !c.assinadoEm) alerta = { tom: 'azul', texto: 'Falta a assinatura do contrato (pelo link do celular ou na loja).' };
  else if (c.status === 'NO_PRAZO' && diasParaPrazo <= 3) alerta = { tom: 'amarelo', texto: diasParaPrazo <= 0 ? 'O prazo termina hoje: amanhã começam as diárias.' : `Faltam ${diasParaPrazo} dia(s) para começar a pagar diárias: dê destaque ou peça desconto ao consignante.` };
  return {
    pago,
    saldo,
    devidoHoje,
    atrasado,
    diariasTotal: diarias.length,
    diariasPagas,
    proximaDiaria: proxima ? { vencimento: proxima.vencimento, valor: saldoConta(proxima) } : null,
    diasConsignado,
    diasParaPrazo,
    estoque,
    descontoPendente,
    alerta,
    rotuloStatus: ROTULO_STATUS[c.status as Status] || c.status,
    link: linkConsignante(c.token),
    fotosUrls: fotosDe(c),
    lucroLoja: arredondar(c.precoVenda - c.valorConsignante),
  };
}

export function chaveHoje(d = new Date()) {
  return chaveDia(d);
}
