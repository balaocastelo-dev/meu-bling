/**
 * JARVIS — CAIXA LIVRE
 *
 * Definição aprovada pelo Thiago (docs/JARVIS.md):
 *
 *   caixa livre = saldo de todos os bancos + caixa físico
 *               − contas a pagar vencidas e a vencer nos próximos 30 dias
 *               − o que ainda falta guardar nas caixinhas ativas
 *               − saldo devedor dos empréstimos abertos (Lumicred: principal + 6%)
 *
 * O número é gravado a cada rodada do worker (JarvisMetrica) para o gráfico de evolução.
 */
import { prisma } from '../../lib/prisma.js';

export type CaixaLivre = {
  caixaLivre: number;
  saldoBancos: number;
  saldoCaixa: number;
  aPagar30d: number;
  caixinhas: number;
  emprestimos: number;
  detalhes: {
    contas: { id: number; nome: string; tipo: string; saldo: number }[];
    contasAPagar: number;
    caixinhasAtivas: number;
    emprestimosAbertos: number;
  };
};

const arred = (n: number) => Math.round(n * 100) / 100;

/** Calcula o caixa livre de agora, lendo bancos, contas a pagar, caixinhas e empréstimos. */
export async function calcularCaixaLivre(): Promise<CaixaLivre> {
  const em30Dias = new Date();
  em30Dias.setDate(em30Dias.getDate() + 30);

  const [contas, aPagar, caixinhas, emprestimos] = await Promise.all([
    // COMPENSACAO é a conta técnica dos empréstimos — não é dinheiro da loja
    prisma.contaFinanceira.findMany({
      where: { ativo: true, tipo: { not: 'COMPENSACAO' } },
      select: { id: true, nome: true, tipo: true, saldoAtual: true },
      orderBy: { nome: 'asc' },
    }),
    // vencidas + a vencer nos próximos 30 dias, só o que falta pagar
    prisma.contaPagar.findMany({
      where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lte: em30Dias } },
      select: { valor: true, valorPago: true, juros: true, desconto: true },
    }),
    prisma.caixinha.findMany({
      where: { ativo: true, usadaEm: null },
      select: { id: true, valorMeta: true, movimentos: { select: { tipo: true, valor: true } } },
    }),
    prisma.emprestimo.findMany({
      where: { situacao: 'ABERTO' },
      select: { id: true, valorDevolver: true, contasPagar: { select: { valor: true, valorPago: true, situacao: true } } },
    }),
  ]);

  const saldoCaixa = contas.filter((c) => c.tipo === 'CAIXA').reduce((s, c) => s + c.saldoAtual, 0);
  const saldoBancos = contas.filter((c) => c.tipo !== 'CAIXA').reduce((s, c) => s + c.saldoAtual, 0);

  const aPagar30d = aPagar.reduce((s, c) => s + Math.max(0, c.valor + c.juros - c.desconto - c.valorPago), 0);

  // o que ainda falta guardar em cada caixinha (nunca negativo)
  const faltaCaixinhas = caixinhas.reduce((s, cx) => {
    const guardado = cx.movimentos.reduce((t, m) => t + (m.tipo === 'SAIDA' ? -m.valor : m.valor), 0);
    return s + Math.max(0, cx.valorMeta - guardado);
  }, 0);

  // saldo devedor dos empréstimos: o que falta pagar nas contas a pagar da operação
  // (sem contas lançadas, considera o valor a devolver inteiro)
  const devedorEmprestimos = emprestimos.reduce((s, e) => {
    const contas = e.contasPagar.filter((c) => c.situacao !== 'CANCELADO');
    if (contas.length === 0) return s + e.valorDevolver;
    return s + contas.reduce((t, c) => t + Math.max(0, c.valor - c.valorPago), 0);
  }, 0);

  const caixaLivre = saldoBancos + saldoCaixa - aPagar30d - faltaCaixinhas - devedorEmprestimos;

  return {
    caixaLivre: arred(caixaLivre),
    saldoBancos: arred(saldoBancos),
    saldoCaixa: arred(saldoCaixa),
    aPagar30d: arred(aPagar30d),
    caixinhas: arred(faltaCaixinhas),
    emprestimos: arred(devedorEmprestimos),
    detalhes: {
      contas: contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldo: arred(c.saldoAtual) })),
      contasAPagar: aPagar.length,
      caixinhasAtivas: caixinhas.length,
      emprestimosAbertos: emprestimos.length,
    },
  };
}

/** Grava a foto do momento (uma por rodada do worker). */
export async function gravarMetrica(c: CaixaLivre) {
  return prisma.jarvisMetrica.create({
    data: {
      caixaLivre: c.caixaLivre,
      saldoBancos: c.saldoBancos,
      saldoCaixa: c.saldoCaixa,
      aPagar30d: c.aPagar30d,
      caixinhas: c.caixinhas,
      emprestimos: c.emprestimos,
      detalhes: JSON.stringify(c.detalhes),
    },
  });
}

/** Dias úteis entre duas datas (segunda a sexta), mínimo 1 — para o "ritmo por dia". */
export function diasUteis(de: Date, ate: Date): number {
  let dias = 0;
  const d = new Date(de.getFullYear(), de.getMonth(), de.getDate());
  const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
  while (d < fim) {
    d.setDate(d.getDate() + 1);
    const s = d.getDay();
    if (s !== 0 && s !== 6) dias++;
  }
  return Math.max(1, dias);
}

/**
 * O mapa do milhão: onde está o caixa livre hoje, quanto falta e em que ritmo precisa andar.
 * `dataAlvo` nulo = 365 dias a partir de hoje.
 */
export async function mapaDoMilhao(meta: number, dataAlvo: Date | null) {
  const atual = await calcularCaixaLivre();
  const alvo = dataAlvo ?? new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const falta = Math.max(0, meta - atual.caixaLivre);
  const uteis = diasUteis(new Date(), alvo);

  // de onde viemos: primeira métrica de 7 e de 30 dias atrás
  const [ha7, ha30] = await Promise.all([
    prisma.jarvisMetrica.findFirst({
      where: { em: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } },
      orderBy: { em: 'asc' },
      select: { caixaLivre: true, em: true },
    }),
    prisma.jarvisMetrica.findFirst({
      where: { em: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } },
      orderBy: { em: 'asc' },
      select: { caixaLivre: true, em: true },
    }),
  ]);

  return {
    ...atual,
    meta,
    dataAlvo: alvo,
    falta: arred(falta),
    percentual: meta > 0 ? Math.min(100, arred((atual.caixaLivre / meta) * 100)) : 0,
    diasUteis: uteis,
    porDiaUtil: arred(falta / uteis),
    variacao7d: ha7 ? arred(atual.caixaLivre - ha7.caixaLivre) : null,
    variacao30d: ha30 ? arred(atual.caixaLivre - ha30.caixaLivre) : null,
  };
}
