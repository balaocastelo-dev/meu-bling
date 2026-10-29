/**
 * JARVIS — CAIXA LIVRE
 *
 * Duas leituras do mesmo dinheiro, porque elas respondem perguntas diferentes:
 *
 *   CAIXA LIVRE (curto prazo — é o número que decide o dia)
 *     bancos + caixa
 *     − contas a pagar vencidas e a vencer nos próximos 30 dias
 *     − o que já deveria estar guardado nas caixinhas até hoje (ritmo devido, não a meta inteira)
 *     − parcelas de empréstimo que vencem nos próximos 30 dias
 *
 *   COMPROMISSOS TOTAIS (a conta completa, para não esquecer o que vem depois)
 *     caixa livre − o resto das caixinhas − o resto dos empréstimos
 *
 * Antes isto era um número só, com a meta inteira das caixinhas e todos os empréstimos
 * descontados de uma vez: o resultado ficava muito negativo e não servia para decidir
 * o que fazer hoje. A meta de R$ 1 milhão é medida pelo caixa livre.
 */
import { prisma } from '../../lib/prisma.js';

export type CaixaLivre = {
  caixaLivre: number;
  compromissosTotais: number;
  saldoBancos: number;
  saldoCaixa: number;
  aPagar30d: number;
  /// o que já deveria estar guardado nas caixinhas e ainda não está
  caixinhasDevidas: number;
  /// o que falta guardar nas caixinhas depois de hoje
  caixinhasFuturas: number;
  /// parcelas de empréstimo que vencem em até 30 dias
  emprestimos30d: number;
  /// o resto do saldo devedor dos empréstimos
  emprestimosDepois: number;
  detalhes: {
    contas: { id: number; nome: string; tipo: string; saldo: number }[];
    contasAPagar: number;
    caixinhasAtivas: number;
    emprestimosAbertos: number;
    /// operações sem conta a pagar lançada (ficam "abertas" para sempre no cadastro)
    emprestimosSemContas: number;
  };
};

const arred = (n: number) => Math.round(n * 100) / 100;

/** Calcula as duas leituras agora, lendo bancos, contas a pagar, caixinhas e empréstimos. */
export async function calcularCaixaLivre(): Promise<CaixaLivre> {
  const agora = new Date();
  const em30Dias = new Date(agora.getTime() + 30 * 86_400_000);

  const [contas, aPagar, caixinhas, emprestimos] = await Promise.all([
    // COMPENSACAO é a conta técnica dos empréstimos — não é dinheiro da loja
    prisma.contaFinanceira.findMany({
      where: { ativo: true, tipo: { not: 'COMPENSACAO' } },
      select: { id: true, nome: true, tipo: true, saldoAtual: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.contaPagar.findMany({
      where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lte: em30Dias } },
      select: { valor: true, valorPago: true, juros: true, desconto: true, emprestimoId: true },
    }),
    prisma.caixinha.findMany({
      where: { ativo: true, usadaEm: null },
      select: {
        id: true,
        valorMeta: true,
        dataUso: true,
        dataInicio: true,
        movimentos: { select: { tipo: true, valor: true } },
      },
    }),
    prisma.emprestimo.findMany({
      where: { situacao: 'ABERTO' },
      select: {
        id: true,
        valorDevolver: true,
        vencimento: true,
        importado: true,
        contasPagar: { select: { valor: true, valorPago: true, situacao: true, vencimento: true } },
      },
    }),
  ]);

  const saldoCaixa = contas.filter((c) => c.tipo === 'CAIXA').reduce((s, c) => s + c.saldoAtual, 0);
  const saldoBancos = contas.filter((c) => c.tipo !== 'CAIXA').reduce((s, c) => s + c.saldoAtual, 0);

  // contas a pagar dos próximos 30 dias (sem as parcelas de empréstimo, que são contadas à parte)
  const aPagar30d = aPagar
    .filter((c) => !c.emprestimoId)
    .reduce((s, c) => s + Math.max(0, c.valor + c.juros - c.desconto - c.valorPago), 0);

  // caixinhas: o que já deveria estar guardado até hoje × o que fica para depois
  let caixinhasDevidas = 0;
  let caixinhasFuturas = 0;
  for (const cx of caixinhas) {
    const guardado = cx.movimentos.reduce((t, m) => t + (m.tipo === 'SAIDA' ? -m.valor : m.valor), 0);
    const falta = Math.max(0, cx.valorMeta - guardado);
    if (falta <= 0) continue;

    const totalDias = Math.max(1, Math.ceil((cx.dataUso.getTime() - cx.dataInicio.getTime()) / 86_400_000));
    // dias INTEIROS já passados: no primeiro dia ainda não se deve nada
    const decorridos = Math.max(0, Math.min(totalDias, Math.floor((agora.getTime() - cx.dataInicio.getTime()) / 86_400_000)));
    const deveriaTer = (cx.valorMeta * decorridos) / totalDias;
    const atrasado = Math.max(0, Math.min(falta, deveriaTer - guardado));

    caixinhasDevidas += atrasado;
    caixinhasFuturas += falta - atrasado;
  }

  // empréstimos: o que vence em 30 dias × o resto
  let emprestimos30d = 0;
  let emprestimosDepois = 0;
  let emprestimosSemContas = 0;
  for (const e of emprestimos) {
    const contas = e.contasPagar.filter((c) => c.situacao !== 'CANCELADO');
    if (contas.length === 0) {
      // Sem conta a pagar lançada não há dívida registrada. Operação trazida do histórico do
      // Bling (importado) quase sempre já foi paga lá fora: contá-la inventaria uma dívida que
      // não existe. Fica só no contador, para o JARVIS pedir o acerto do cadastro.
      emprestimosSemContas++;
      if (e.importado) continue;
      if (e.vencimento <= em30Dias) emprestimos30d += e.valorDevolver;
      else emprestimosDepois += e.valorDevolver;
      continue;
    }
    for (const c of contas) {
      const falta = Math.max(0, c.valor - c.valorPago);
      if (falta <= 0) continue;
      if (c.vencimento <= em30Dias) emprestimos30d += falta;
      else emprestimosDepois += falta;
    }
  }

  const caixaLivre = saldoBancos + saldoCaixa - aPagar30d - caixinhasDevidas - emprestimos30d;
  const compromissosTotais = caixaLivre - caixinhasFuturas - emprestimosDepois;

  return {
    caixaLivre: arred(caixaLivre),
    compromissosTotais: arred(compromissosTotais),
    saldoBancos: arred(saldoBancos),
    saldoCaixa: arred(saldoCaixa),
    aPagar30d: arred(aPagar30d),
    caixinhasDevidas: arred(caixinhasDevidas),
    caixinhasFuturas: arred(caixinhasFuturas),
    emprestimos30d: arred(emprestimos30d),
    emprestimosDepois: arred(emprestimosDepois),
    detalhes: {
      contas: contas.map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo, saldo: arred(c.saldoAtual) })),
      contasAPagar: aPagar.length,
      caixinhasAtivas: caixinhas.length,
      emprestimosAbertos: emprestimos.length,
      emprestimosSemContas,
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
      caixinhas: c.caixinhasDevidas,
      emprestimos: c.emprestimos30d,
      detalhes: JSON.stringify({
        ...c.detalhes,
        compromissosTotais: c.compromissosTotais,
        caixinhasFuturas: c.caixinhasFuturas,
        emprestimosDepois: c.emprestimosDepois,
      }),
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
