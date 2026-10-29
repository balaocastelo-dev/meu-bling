/**
 * RISCO DO CLIENTE PARA O CARNÊ — calculado pelo próprio sistema a partir do histórico:
 * compras já feitas, tempo de cliente, valor gasto, pontualidade nas contas a receber, atraso atual,
 * carnês anteriores e operações de crédito (Lumicred) já pagas.
 *
 *   nota 0–100 → classe A (≥80) B (≥65) C (≥50) D (≥35) E (<35)
 *   juros ao mês: A = mínimo (7%) … E = máximo (15%), em degraus iguais
 *   apto ao carnê: A, B ou C, com CPF/CNPJ, pelo menos 1 compra e sem atraso acima de 30 dias
 *   D = só com entrada / valor menor; E = não oferecer
 */
import { prisma, type Tx } from '../../lib/prisma.js';
type Db = Tx | typeof prisma;
import { arredondar } from '../../lib/util.js';

export type Classe = 'A' | 'B' | 'C' | 'D' | 'E';
export const CLASSES: Classe[] = ['A', 'B', 'C', 'D', 'E'];
const DIA = 86_400_000;
/** tolerância para considerar pagamento em dia */
const TOLERANCIA_DIAS = 3;

export interface Historico {
  contatoId: number;
  nome: string;
  documento: string | null;
  telefone: string | null;
  consumidorFinal: boolean;
  compras24m: number;
  comprasTotal: number;
  gasto24m: number;
  gastoTotal: number;
  maiorCompra: number;
  primeiraCompra: Date | null;
  ultimaCompra: Date | null;
  /** contas já vencidas (pagas ou não) — base da pontualidade */
  contasVencidas: number;
  pagasEmDia: number;
  pagasAtrasadas: number;
  mediaDiasAtraso: number;
  /** maior atraso entre as contas abertas vencidas (dias) e o valor em atraso */
  atrasoAtualDias: number;
  valorEmAtraso: number;
  carneParcelasEmDia: number;
  carneParcelasAtrasadas: number;
  /** saldo em aberto em carnês ativos */
  saldoCarnes: number;
  creditosPagos: number;
}

export interface Avaliacao {
  score: number;
  classe: Classe;
  taxaPct: number;
  apto: boolean;
  /** pode oferecer, mas só com entrada / valor menor */
  comRessalva: boolean;
  limite: number;
  disponivel: number;
  motivos: { texto: string; pontos: number }[];
  bloqueios: string[];
}

export interface CfgRisco {
  taxaMin: number;
  taxaMax: number;
}

export async function carregarCfgRisco(db: Db = prisma): Promise<CfgRisco> {
  const e = await db.empresa.findUnique({ where: { id: 1 }, select: { carneTaxaMinPct: true, carneTaxaMaxPct: true } });
  const min = e?.carneTaxaMinPct ?? 7;
  const max = Math.max(min, e?.carneTaxaMaxPct ?? 15);
  return { taxaMin: min, taxaMax: max };
}

export function classeDe(score: number): Classe {
  return score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'E';
}

export function taxaDaClasse(c: Classe, cfg: CfgRisco) {
  const k = CLASSES.indexOf(c);
  return arredondar(cfg.taxaMin + ((cfg.taxaMax - cfg.taxaMin) * k) / 4, 2);
}

const FATOR_LIMITE: Record<Classe, number> = { A: 2, B: 1.5, C: 1, D: 0.5, E: 0 };

/** Nota do cliente — regra transparente: cada linha vira um motivo na tela de auditoria. */
export function avaliar(h: Historico, cfg: CfgRisco, agora = new Date()): Avaliacao {
  const motivos: Avaliacao['motivos'] = [];
  const somar = (texto: string, pontos: number) => {
    if (pontos) motivos.push({ texto, pontos: Math.round(pontos) });
  };
  somar('Base', 20);
  somar(`${h.compras24m} compra(s) nos últimos 24 meses`, Math.min(24, h.compras24m * 6));
  if (h.primeiraCompra) {
    const meses = Math.floor((agora.getTime() - h.primeiraCompra.getTime()) / (30 * DIA));
    somar(`Cliente há ${meses} ${meses === 1 ? 'mês' : 'meses'}`, Math.min(12, Math.floor(meses / 2)));
  }
  somar(`R$ ${Math.round(h.gasto24m).toLocaleString('pt-BR')} em compras (24 meses)`, Math.min(10, Math.floor(h.gasto24m / 1000)));
  if (h.ultimaCompra && agora.getTime() - h.ultimaCompra.getTime() <= 180 * DIA) somar('Comprou nos últimos 6 meses', 4);
  const pagas = h.pagasEmDia + h.pagasAtrasadas;
  if (h.contasVencidas >= 2) {
    const emDia = h.contasVencidas ? h.pagasEmDia / h.contasVencidas : 0;
    somar(`Pagou em dia ${h.pagasEmDia} de ${h.contasVencidas} conta(s) vencida(s)`, 20 * emDia);
    if (h.pagasAtrasadas && h.mediaDiasAtraso > 0) somar(`Atrasos pagos: média de ${Math.round(h.mediaDiasAtraso)} dia(s)`, -Math.min(15, h.mediaDiasAtraso / 2));
  } else if (pagas || h.comprasTotal) somar('Pouco histórico de pagamento a prazo', 6);
  if (h.atrasoAtualDias > 30) somar(`Em atraso há ${h.atrasoAtualDias} dias (R$ ${h.valorEmAtraso.toFixed(2).replace('.', ',')})`, -30);
  else if (h.atrasoAtualDias > 5) somar(`Em atraso há ${h.atrasoAtualDias} dias (R$ ${h.valorEmAtraso.toFixed(2).replace('.', ',')})`, -12);
  if (h.carneParcelasEmDia) somar(`${h.carneParcelasEmDia} parcela(s) de carnê paga(s) em dia`, Math.min(10, h.carneParcelasEmDia * 2));
  if (h.carneParcelasAtrasadas) somar(`${h.carneParcelasAtrasadas} parcela(s) de carnê paga(s) com atraso`, -Math.min(24, h.carneParcelasAtrasadas * 8));
  if (h.creditosPagos) somar(`${h.creditosPagos} crédito(s) bancário(s) (Lumicred) já pago(s)`, Math.min(8, h.creditosPagos * 4));

  const score = Math.max(0, Math.min(100, motivos.reduce((s, m) => s + m.pontos, 0)));
  const classe = classeDe(score);
  const bloqueios: string[] = [];
  if (h.consumidorFinal) bloqueios.push('Consumidor final (sem cadastro)');
  if (!(h.documento || '').replace(/\D/g, '')) bloqueios.push('Sem CPF/CNPJ no cadastro');
  if (!h.comprasTotal) bloqueios.push('Nenhuma compra concluída');
  if (h.atrasoAtualDias > 30) bloqueios.push(`Conta em atraso há ${h.atrasoAtualDias} dias`);

  const base = h.gasto24m > 0 ? Math.min(h.maiorCompra * FATOR_LIMITE[classe], Math.max(h.gasto24m, h.maiorCompra)) : 0;
  const limite = bloqueios.length ? 0 : Math.floor(base / 50) * 50;
  const disponivel = Math.max(0, arredondar(limite - h.saldoCarnes));
  const apto = !bloqueios.length && ['A', 'B', 'C'].includes(classe) && limite > 0;
  const comRessalva = !bloqueios.length && classe === 'D' && limite > 0;
  return { score, classe, taxaPct: taxaDaClasse(classe, cfg), apto, comRessalva, limite, disponivel, motivos, bloqueios };
}

/** Histórico de um ou de todos os clientes que já compraram (consultas agregadas: rápido para milhares). */
export async function carregarHistoricos(ids?: number[], agora = new Date(), db: Db = prisma): Promise<Map<number, Historico>> {
  const filtroIds = ids ? { in: ids } : undefined;
  const corte24 = new Date(agora.getTime() - 730 * DIA);
  const sitFinais = await db.situacao.findMany({ where: { modulo: 'VENDA', final: true, cancelamento: false }, select: { id: true } });
  const vendas = await db.venda.findMany({
    where: { tipo: 'PEDIDO', situacaoId: { in: sitFinais.map((s) => s.id) }, ...(filtroIds ? { contatoId: filtroIds } : {}) },
    select: { contatoId: true, data: true, total: true },
  });
  const contatosIds = ids ?? [...new Set(vendas.map((v) => v.contatoId!))];
  if (!contatosIds.length) return new Map();
  // SQLite limita o tamanho do IN (com filtros de negação a consulta não se divide): lista grande → sem filtro, filtra na memória
  const poucos = !!ids && ids.length <= 400;
  const contatos = await db.contato.findMany({ where: { id: { in: contatosIds } }, select: { id: true, nome: true, documento: true, telefone: true, celular: true } });
  const mapa = new Map<number, Historico>();
  for (const c of contatos) {
    const nome = (c.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    mapa.set(c.id, {
      contatoId: c.id,
      nome: c.nome,
      documento: c.documento,
      telefone: c.celular || c.telefone || null,
      consumidorFinal: (nome === 'consumidor final' || nome === 'cliente final') && !(c.documento || '').replace(/\D/g, ''),
      compras24m: 0,
      comprasTotal: 0,
      gasto24m: 0,
      gastoTotal: 0,
      maiorCompra: 0,
      primeiraCompra: null,
      ultimaCompra: null,
      contasVencidas: 0,
      pagasEmDia: 0,
      pagasAtrasadas: 0,
      mediaDiasAtraso: 0,
      atrasoAtualDias: 0,
      valorEmAtraso: 0,
      carneParcelasEmDia: 0,
      carneParcelasAtrasadas: 0,
      saldoCarnes: 0,
      creditosPagos: 0,
    });
  }
  for (const v of vendas) {
    const h = mapa.get(v.contatoId!);
    if (!h) continue;
    h.comprasTotal++;
    h.gastoTotal += v.total;
    if (v.data >= corte24) {
      h.compras24m++;
      h.gasto24m += v.total;
    }
    h.maiorCompra = Math.max(h.maiorCompra, v.total);
    if (!h.primeiraCompra || v.data < h.primeiraCompra) h.primeiraCompra = v.data;
    if (!h.ultimaCompra || v.data > h.ultimaCompra) h.ultimaCompra = v.data;
  }
  // contas a receber do cliente (vendas, OS, carnês) — pontualidade e atraso atual
  const contas = await db.contaReceber.findMany({
    where: { ...(poucos ? { contatoId: { in: contatosIds } } : { contatoId: { not: null } }), situacao: { not: 'CANCELADO' }, emprestimoId: null, vencimento: { lt: agora } },
    select: { contatoId: true, vencimento: true, dataRecebimento: true, situacao: true, valor: true, valorRecebido: true, juros: true, desconto: true, carneId: true },
  });
  const somaAtraso = new Map<number, number>();
  for (const c of contas) {
    const h = mapa.get(c.contatoId!);
    if (!h) continue;
    h.contasVencidas++;
    const limite = c.vencimento.getTime() + TOLERANCIA_DIAS * DIA;
    if (c.situacao === 'RECEBIDO') {
      const atraso = c.dataRecebimento ? Math.max(0, Math.floor((c.dataRecebimento.getTime() - c.vencimento.getTime()) / DIA)) : 0;
      if (!c.dataRecebimento || c.dataRecebimento.getTime() <= limite) {
        h.pagasEmDia++;
        if (c.carneId) h.carneParcelasEmDia++;
      } else {
        h.pagasAtrasadas++;
        somaAtraso.set(h.contatoId, (somaAtraso.get(h.contatoId) ?? 0) + atraso);
        if (c.carneId && atraso > 15) h.carneParcelasAtrasadas++;
        else if (c.carneId) h.carneParcelasEmDia++;
      }
    } else {
      const dias = Math.floor((agora.getTime() - c.vencimento.getTime()) / DIA);
      const saldo = Math.max(0, c.valor + c.juros - c.valorRecebido - c.desconto);
      if (dias > TOLERANCIA_DIAS && saldo > 0.009) {
        h.atrasoAtualDias = Math.max(h.atrasoAtualDias, dias);
        h.valorEmAtraso = arredondar(h.valorEmAtraso + saldo);
      }
    }
  }
  for (const [id, soma] of somaAtraso) {
    const h = mapa.get(id)!;
    h.mediaDiasAtraso = h.pagasAtrasadas ? soma / h.pagasAtrasadas : 0;
  }
  // saldo em aberto dos carnês ativos (consome o limite)
  const abertos = await db.contaReceber.findMany({
    where: { ...(poucos ? { contatoId: { in: contatosIds } } : {}), carneId: { not: null }, situacao: { in: ['ABERTO', 'PARCIAL'] } },
    select: { contatoId: true, valor: true, valorRecebido: true, juros: true, desconto: true },
  });
  for (const c of abertos) {
    const h = mapa.get(c.contatoId!);
    if (h) h.saldoCarnes = arredondar(h.saldoCarnes + Math.max(0, c.valor + c.juros - c.valorRecebido - c.desconto));
  }
  // crédito bancário (Lumicred) com o boleto do cliente pago
  const ops = await db.emprestimo.findMany({
    where: { ...(poucos ? { clienteId: { in: contatosIds } } : { clienteId: { not: null } }), situacao: { not: 'CANCELADO' }, contaReceberClienteId: { not: null } },
    select: { clienteId: true, contaReceberClienteId: true },
  });
  if (ops.length) {
    const crs = await db.contaReceber.findMany({ where: { id: { in: ops.map((o) => o.contaReceberClienteId!) }, situacao: 'RECEBIDO' }, select: { id: true } });
    const pagos = new Set(crs.map((c) => c.id));
    for (const o of ops) {
      const h = mapa.get(o.clienteId!);
      if (h && pagos.has(o.contaReceberClienteId!)) h.creditosPagos++;
    }
  }
  for (const h of mapa.values()) {
    h.gasto24m = arredondar(h.gasto24m);
    h.gastoTotal = arredondar(h.gastoTotal);
  }
  return mapa;
}

export async function avaliarCliente(contatoId: number) {
  const [hist, cfg] = await Promise.all([carregarHistoricos([contatoId]), carregarCfgRisco()]);
  const h = hist.get(contatoId);
  if (!h) return null;
  return { historico: h, ...avaliar(h, cfg) };
}
