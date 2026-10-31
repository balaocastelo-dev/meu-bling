/**
 * EXTRATO DA CONTA (banco/caixa): cada lançamento com de onde veio / para onde foi e o saldo depois dele.
 * Saldo anterior = saldo inicial + lançamentos antes do período; saldo final = saldo da conta no fim do período.
 */
import { startOfDay, endOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { OBS_AJUSTE_SALDO, OBS_TRANSFERENCIA } from '../comum/financeiro.js';
import { resolvedorDeOrigem, selectTituloReceber, selectTituloPagar, type NaturezaLancamento } from './origem-lancamento.js';

export type { NaturezaLancamento };

const LIMITE = 3000;

/** Para cada movimento de transferência, a conta do outro lado (a perna oposta criada junto). */
async function contrapartes(movs: { id: number; tipo: string; valor: number; criadoEm: Date; contaFinanceiraId: number; observacoes: string | null }[]) {
  const transf = movs.filter((m) => m.observacoes === OBS_TRANSFERENCIA);
  const mapa = new Map<number, { id: number; nome: string }>();
  if (!transf.length) return mapa;
  const min = new Date(Math.min(...transf.map((m) => +m.criadoEm)) - 5000);
  const max = new Date(Math.max(...transf.map((m) => +m.criadoEm)) + 5000);
  const outros = await prisma.movimentoFinanceiro.findMany({
    where: { observacoes: OBS_TRANSFERENCIA, criadoEm: { gte: min, lte: max }, contaFinanceiraId: { not: transf[0].contaFinanceiraId } },
    select: { id: true, tipo: true, valor: true, criadoEm: true, contaFinanceira: { select: { id: true, nome: true } } },
  });
  const usados = new Set<number>();
  for (const m of transf) {
    const par = outros.find((o) => !usados.has(o.id) && o.tipo !== m.tipo && Math.abs(o.valor - m.valor) < 0.005 && Math.abs(+o.criadoEm - +m.criadoEm) <= 5000);
    if (par) {
      usados.add(par.id);
      mapa.set(m.id, par.contaFinanceira);
    }
  }
  return mapa;
}

export async function extratoConta(contaId: number, p: { dataInicial?: Date | null; dataFinal?: Date | null }) {
  const conta = await prisma.contaFinanceira.findUnique({ where: { id: contaId }, select: { id: true, nome: true, tipo: true, saldoInicial: true, saldoAtual: true, cor: true } });
  if (!conta) throw new NotFound('Conta financeira');
  const ini = p.dataInicial ? startOfDay(p.dataInicial) : null;
  const fim = p.dataFinal ? endOfDay(p.dataFinal) : null;

  const antes = ini
    ? await prisma.movimentoFinanceiro.groupBy({ by: ['tipo'], where: { contaFinanceiraId: contaId, data: { lt: ini } }, _sum: { valor: true } })
    : [];
  const somaAntes = antes.reduce((s, g) => s + (g.tipo === 'ENTRADA' ? 1 : -1) * (g._sum.valor || 0), 0);
  const saldoAnterior = arredondar(conta.saldoInicial + somaAntes);

  const movs = await prisma.movimentoFinanceiro.findMany({
    where: { contaFinanceiraId: contaId, data: { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) } },
    orderBy: [{ data: 'asc' }, { id: 'asc' }],
    include: {
      categoria: { select: { nome: true } },
      caixinha: { select: { id: true, nome: true } },
      contaReceber: { select: selectTituloReceber },
      contaPagar: { select: selectTituloPagar },
    },
  });
  const outroLado = await contrapartes(movs);
  const deOnde = await resolvedorDeOrigem(
    [...movs.map((m) => m.contaReceber), ...movs.map((m) => m.contaPagar)].filter(Boolean) as Parameters<Awaited<ReturnType<typeof resolvedorDeOrigem>>>[0][],
  );

  let saldo = saldoAnterior;
  let entradas = 0;
  let saidas = 0;
  const linhas = movs.map((m) => {
    const sinal = m.tipo === 'ENTRADA' ? 1 : -1;
    saldo = arredondar(saldo + sinal * m.valor);
    if (m.tipo === 'ENTRADA') entradas += m.valor;
    else saidas += m.valor;
    let natureza: NaturezaLancamento = 'AVULSO';
    let contraparte = '';
    let link: string | null = null;
    let pessoa: string | null = null;
    const titulo = m.contaReceber || m.contaPagar;
    if (m.observacoes === OBS_AJUSTE_SALDO) {
      natureza = 'AJUSTE';
      contraparte = 'Acerto de saldo (fora do DRE)';
    } else if (m.observacoes === OBS_TRANSFERENCIA) {
      const outra = outroLado.get(m.id);
      natureza = m.caixinha ? 'CAIXINHA' : 'TRANSFERENCIA';
      contraparte = `${m.tipo === 'ENTRADA' ? 'Veio de' : 'Foi para'} ${outra?.nome ?? 'outra conta'}${m.caixinha ? ` · caixinha "${m.caixinha.nome}"` : ''}`;
      link = `/financeiro/bancos/${outra?.id ?? ''}`.replace(/\/$/, '') || null;
      if (!outra) link = null;
    } else if (titulo) {
      pessoa = titulo.contato?.nome ?? null;
      const o = deOnde(titulo, !!m.contaReceber);
      natureza = o.natureza;
      contraparte = o.rotulo;
      link = o.link;
    } else {
      contraparte = m.categoria ? `Lançamento avulso · ${m.categoria.nome}` : 'Lançamento avulso (sem categoria)';
    }
    return {
      id: m.id,
      data: m.data,
      criadoEm: m.criadoEm,
      tipo: m.tipo,
      valor: m.valor,
      descricao: m.descricao,
      natureza,
      contraparte,
      link,
      categoria: m.categoria?.nome ?? null,
      observacoes: m.observacoes && ![OBS_AJUSTE_SALDO, OBS_TRANSFERENCIA].includes(m.observacoes) ? m.observacoes : null,
      foraDoResultado: m.observacoes === OBS_AJUSTE_SALDO || m.observacoes === OBS_TRANSFERENCIA,
      podeExcluir: !m.contaReceberId && !m.contaPagarId,
      saldo,
    };
  });
  // mais novo primeiro (como no app do banco); se for muito, manda só os mais recentes
  const total = linhas.length;
  const enviados = linhas.slice(-LIMITE).reverse();
  return {
    conta: { id: conta.id, nome: conta.nome, tipo: conta.tipo, cor: conta.cor, saldoAtual: arredondar(conta.saldoAtual), saldoInicial: conta.saldoInicial },
    periodo: { dataInicial: ini, dataFinal: fim },
    saldoAnterior,
    entradas: arredondar(entradas),
    saidas: arredondar(saidas),
    saldoFinal: arredondar(saldo),
    total,
    cortado: total > LIMITE,
    lancamentos: enviados,
  };
}
