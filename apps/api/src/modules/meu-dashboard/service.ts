/**
 * MEU DASHBOARD — os blocos de cada perfil (29/10/2026)
 *
 *   blocoVendas(vendedorId)      vendedor (e técnico, que também vende): faturamento, meta, ranking, desafios,
 *                                vendas por dia, últimas vendas, produtos mais vendidos. SEM custo nem lucro.
 *   blocoAssistencia(tecnicoId)  técnico: OS comigo por situação, concluídas e valor cobrado no período, meta,
 *                                ranking, desafios de OS, fila. SEM custo nem lucro.
 *   blocoGerente()               gerente/financeiro: saldo, entradas/saídas, receita (vendas + assistência),
 *                                caixinhas e avisos, equipe (metas de vendedores e técnicos), desafios,
 *                                últimos acontecimentos. SEM lucro, margem ou DRE (decisão do Thiago, 29/10/2026).
 */
import { differenceInCalendarDays, endOfDay, startOfDay, startOfMonth } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { arredondar, competenciaDe } from '../../lib/util.js';
import { OBS_FORA_DO_RESULTADO } from '../comum/financeiro.js';
import { avisosGestao } from '../comum/avisos-gestao.js';
import { agruparPadrao, chavePeriodo, listarPeriodos, periodoAnterior, type Agrupar } from '../financeiro/periodos.js';
import { ultimosAcontecimentos } from '../dashboard/atividades.js';
import {
  desafiosDoParticipante,
  painelDoVendedor,
  progressoMetaTecnico,
  rankingTecnicos,
  resumoOsTecnico,
  resumoVendas,
  situacoesOsConcluidas,
  situacoesQueContam,
} from '../metas/service.js';

export type Periodo = { ini: Date; fim: Date; agrupar: Agrupar };

function serieVazia<T extends object>(p: Periodo, molde: () => T) {
  return new Map(listarPeriodos(p.ini, p.fim, p.agrupar).map((k) => [k, { periodo: k, ...molde() }]));
}
const ordenada = <T extends { periodo: string }>(m: Map<string, T>) => [...m.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));

// ======================================================================= VENDAS (vendedor / técnico)
export async function blocoVendas(vendedorId: number, p: Periodo, gestor: boolean) {
  const painel = await painelDoVendedor(vendedorId, gestor);
  if (!painel) return null;
  const sitOk = await situacoesQueContam();
  const ant = periodoAnterior(p.ini, p.fim);
  const [atual, anterior, vendas, itens] = await Promise.all([
    resumoVendas(vendedorId, p.ini, p.fim),
    resumoVendas(vendedorId, ant.ini, ant.fim),
    prisma.venda.findMany({ where: { tipo: 'PEDIDO', vendedorId, situacaoId: { in: sitOk }, data: { gte: p.ini, lte: p.fim } }, select: { data: true, total: true } }),
    prisma.vendaItem.findMany({
      where: { venda: { tipo: 'PEDIDO', vendedorId, situacaoId: { in: sitOk }, data: { gte: p.ini, lte: p.fim } } },
      select: { descricao: true, quantidade: true, total: true, produtoId: true, produto: { select: { id: true, nome: true } } },
    }),
  ]);
  const serie = serieVazia(p, () => ({ valor: 0, qtd: 0 }));
  for (const v of vendas) {
    const k = chavePeriodo(v.data, p.agrupar);
    const s = serie.get(k) || serie.set(k, { periodo: k, valor: 0, qtd: 0 }).get(k)!;
    s.valor = arredondar(s.valor + v.total);
    s.qtd += 1;
  }
  const porProduto = new Map<string, { produtoId: number | null; nome: string; qtd: number; valor: number }>();
  for (const i of itens) {
    const k = i.produtoId ? `p${i.produtoId}` : `d${i.descricao}`;
    const x = porProduto.get(k) || porProduto.set(k, { produtoId: i.produtoId, nome: i.produto?.nome || i.descricao, qtd: 0, valor: 0 }).get(k)!;
    x.qtd = arredondar(x.qtd + i.quantidade, 3);
    x.valor = arredondar(x.valor + i.total);
  }
  return {
    ...painel,
    periodo: { ...atual, anterior: { faturamento: anterior.faturamento, qtd: anterior.qtd } },
    serie: ordenada(serie),
    topProdutos: [...porProduto.values()].sort((a, b) => b.valor - a.valor).slice(0, 6),
  };
}

// ======================================================================= ASSISTÊNCIA (técnico)
export async function blocoAssistencia(tecnicoId: number, p: Periodo, gestor: boolean) {
  const tecnico = await prisma.tecnico.findUnique({ where: { id: tecnicoId }, select: { id: true, nome: true } });
  if (!tecnico) return null;
  const agora = new Date();
  const sitOk = await situacoesOsConcluidas();
  const situacoes = await prisma.situacao.findMany({ where: { modulo: 'OS', ativo: true }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true, cor: true, final: true, cancelamento: true } });
  const fechadas = situacoes.filter((s) => s.final || s.cancelamento).map((s) => s.id);
  const ant = periodoAnterior(p.ini, p.fim);

  const [abertas, semTecnico, atual, anterior, concluidas, entradas, meta, ranking, desafios] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { tecnicoId, situacaoId: { notIn: fechadas } },
      orderBy: [{ prioridade: 'desc' }, { dataEntrada: 'asc' }],
      select: {
        id: true, numero: true, dataEntrada: true, dataPrevista: true, equipamento: true, marca: true, modelo: true, prioridade: true, total: true, orcar: true, orcamentoAprovado: true,
        contato: { select: { id: true, nome: true } },
        situacao: { select: { id: true, nome: true, cor: true } },
      },
    }),
    prisma.ordemServico.count({ where: { tecnicoId: null, situacaoId: { notIn: fechadas } } }),
    resumoOsTecnico(tecnicoId, p.ini, p.fim),
    resumoOsTecnico(tecnicoId, ant.ini, ant.fim),
    prisma.ordemServico.findMany({ where: { tecnicoId, situacaoId: { in: sitOk }, dataConclusao: { gte: p.ini, lte: p.fim } }, select: { dataEntrada: true, dataConclusao: true, total: true } }),
    prisma.ordemServico.findMany({ where: { tecnicoId, dataEntrada: { gte: p.ini, lte: p.fim } }, select: { dataEntrada: true } }),
    progressoMetaTecnico(tecnicoId, agora),
    rankingTecnicos(tecnicoId, gestor, agora),
    desafiosDoParticipante('TECNICOS', tecnicoId, agora),
  ]);

  const nome = (s: { nome: string }) => s.nome.toLowerCase();
  const conta = (f: (s: { nome: string; id: number }) => boolean) => abertas.filter((o) => f(o.situacao)).length;
  const hoje = startOfDay(agora);
  const agoraResumo = {
    comigo: abertas.length,
    emAndamento: conta((s) => /andamento|aprovad/.test(nome(s))),
    aguardandoPeca: conta((s) => /pe[çc]a/.test(nome(s))),
    aguardandoAprovacao: abertas.filter((o) => o.orcar && !o.orcamentoAprovado).length,
    prontas: conta((s) => /conclu|retirada|pronta/.test(nome(s))),
    atrasadas: abertas.filter((o) => o.dataPrevista && o.dataPrevista < hoje).length,
    semTecnico,
  };

  const tempos = concluidas.map((o) => differenceInCalendarDays(o.dataConclusao!, o.dataEntrada)).filter((d) => d >= 0);
  const serie = serieVazia(p, () => ({ entradas: 0, concluidas: 0, valor: 0 }));
  for (const o of entradas) {
    const k = chavePeriodo(o.dataEntrada, p.agrupar);
    (serie.get(k) || serie.set(k, { periodo: k, entradas: 0, concluidas: 0, valor: 0 }).get(k)!).entradas += 1;
  }
  for (const o of concluidas) {
    const k = chavePeriodo(o.dataConclusao!, p.agrupar);
    const s = serie.get(k) || serie.set(k, { periodo: k, entradas: 0, concluidas: 0, valor: 0 }).get(k)!;
    s.concluidas += 1;
    s.valor = arredondar(s.valor + o.total);
  }
  const bonus = await prisma.comissao.aggregate({ where: { tecnicoId, origemTipo: 'DESAFIO', competencia: competenciaDe(agora), status: { not: 'CANCELADA' } }, _sum: { valor: true } });

  return {
    tecnico,
    agora: agoraResumo,
    periodo: { entradas: entradas.length, concluidas: atual.qtd, valorServicos: atual.valor, maoDeObra: atual.maoDeObra, pecas: atual.pecas, ticketMedio: atual.ticketMedio, tempoMedioDias: tempos.length ? arredondar(tempos.reduce((a, b) => a + b, 0) / tempos.length, 1) : 0, anterior: { concluidas: anterior.qtd, valorServicos: anterior.valor } },
    meta: { ...meta, bonusDesafios: arredondar(bonus._sum.valor || 0) },
    ranking,
    desafios,
    porSituacao: situacoes.filter((s) => !s.final && !s.cancelamento).map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, qtd: abertas.filter((o) => o.situacao.id === s.id).length })),
    fila: abertas.slice(0, 15).map((o) => ({ ...o, atrasada: !!o.dataPrevista && o.dataPrevista < hoje, diasNaLoja: differenceInCalendarDays(agora, o.dataEntrada) })),
    serie: ordenada(serie),
  };
}

// ======================================================================= GERENTE / FINANCEIRO
export async function blocoGerente(p: Periodo) {
  const agora = new Date();
  const iniMes = startOfMonth(agora);
  const fimDia = endOfDay(agora);
  const competencia = competenciaDe(agora);
  const [sitVenda, sitOs] = await Promise.all([situacoesQueContam(), situacoesOsConcluidas()]);
  const ant = periodoAnterior(p.ini, p.fim);

  const [avisos, vendas, vendasAnt, ordens, ordensAnt, movimentos, vendedores, tecnicos, metasV, metasT, vendasMes, osMes, desafios, acontecimentos] = await Promise.all([
    avisosGestao(),
    prisma.venda.findMany({ where: { tipo: 'PEDIDO', situacaoId: { in: sitVenda }, data: { gte: p.ini, lte: p.fim } }, select: { data: true, total: true, vendedorId: true, vendedor: { select: { nome: true } } } }),
    prisma.venda.aggregate({ where: { tipo: 'PEDIDO', situacaoId: { in: sitVenda }, data: { gte: ant.ini, lte: ant.fim } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.ordemServico.findMany({ where: { situacaoId: { in: sitOs }, dataConclusao: { gte: p.ini, lte: p.fim } }, select: { dataConclusao: true, total: true } }),
    prisma.ordemServico.aggregate({ where: { situacaoId: { in: sitOs }, dataConclusao: { gte: ant.ini, lte: ant.fim } }, _sum: { total: true }, _count: { _all: true } }),
    // dinheiro de verdade que entrou/saiu: fora transferências, ajustes de saldo, caixinhas e a conta de compensação dos empréstimos
    prisma.movimentoFinanceiro
      .findMany({ where: { data: { gte: p.ini, lte: p.fim }, tipo: { in: ['ENTRADA', 'SAIDA'] }, caixinhaId: null, contaFinanceira: { tipo: { not: 'COMPENSACAO' } } }, select: { data: true, tipo: true, valor: true, observacoes: true } })
      .then((ms) => ms.filter((m) => !OBS_FORA_DO_RESULTADO.includes(m.observacoes || ''))),
    prisma.vendedor.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, metaMensal: true } }),
    prisma.tecnico.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, metaMensal: true, metaTipo: true } }),
    prisma.metaVendedor.findMany({ where: { competencia }, select: { vendedorId: true, valor: true } }),
    prisma.metaTecnico.findMany({ where: { competencia }, select: { tecnicoId: true, valor: true, tipo: true } }),
    prisma.venda.groupBy({ by: ['vendedorId'], where: { tipo: 'PEDIDO', situacaoId: { in: sitVenda }, data: { gte: iniMes, lte: fimDia } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.ordemServico.groupBy({ by: ['tecnicoId'], where: { situacaoId: { in: sitOs }, dataConclusao: { gte: iniMes, lte: fimDia } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.desafio.findMany({
      where: { ativo: true, fim: { gte: agora } },
      orderBy: { fim: 'asc' },
      take: 8,
      select: { id: true, titulo: true, publico: true, tipo: true, alvo: true, premio: true, fim: true, regra: true, conquistas: { select: { vendedor: { select: { nome: true } }, tecnico: { select: { nome: true } } } } },
    }),
    ultimosAcontecimentos(15).catch(() => []),
  ]);

  // ---- série: vendas, assistência, entradas e saídas
  const serie = serieVazia(p, () => ({ vendas: 0, assistencia: 0, entradas: 0, saidas: 0 }));
  const em = (d: Date) => {
    const k = chavePeriodo(d, p.agrupar);
    return serie.get(k) || serie.set(k, { periodo: k, vendas: 0, assistencia: 0, entradas: 0, saidas: 0 }).get(k)!;
  };
  for (const v of vendas) em(v.data).vendas = arredondar(em(v.data).vendas + v.total);
  for (const o of ordens) em(o.dataConclusao!).assistencia = arredondar(em(o.dataConclusao!).assistencia + o.total);
  for (const m of movimentos) {
    const s = em(m.data);
    if (m.tipo === 'ENTRADA') s.entradas = arredondar(s.entradas + m.valor);
    else s.saidas = arredondar(s.saidas + m.valor);
  }

  // ---- por vendedor no período
  const porVendedor = new Map<number, { id: number | null; nome: string; valor: number; qtd: number }>();
  for (const v of vendas) {
    const k = v.vendedorId ?? 0;
    const x = porVendedor.get(k) || porVendedor.set(k, { id: v.vendedorId ?? null, nome: v.vendedor?.nome || 'Sem vendedor', valor: 0, qtd: 0 }).get(k)!;
    x.valor = arredondar(x.valor + v.total);
    x.qtd += 1;
  }

  const totalVendas = arredondar(vendas.reduce((s, v) => s + v.total, 0));
  const totalOs = arredondar(ordens.reduce((s, o) => s + o.total, 0));
  const entradas = arredondar(movimentos.filter((m) => m.tipo === 'ENTRADA').reduce((s, m) => s + m.valor, 0));
  const saidas = arredondar(movimentos.filter((m) => m.tipo === 'SAIDA').reduce((s, m) => s + m.valor, 0));

  // ---- equipe do mês (meta × realizado) — sem comissão, custo ou lucro
  const equipeVendedores = vendedores.map((v) => {
    const g = vendasMes.find((x) => x.vendedorId === v.id);
    const meta = metasV.find((m) => m.vendedorId === v.id)?.valor ?? v.metaMensal;
    const vendido = arredondar(g?._sum.total || 0);
    return { id: v.id, nome: v.nome, vendido, qtd: g?._count._all || 0, meta, pct: meta ? Math.min(999, arredondar((vendido / meta) * 100, 1)) : 0 };
  });
  const equipeTecnicos = tecnicos.map((t) => {
    const g = osMes.find((x) => x.tecnicoId === t.id);
    const esp = metasT.find((m) => m.tecnicoId === t.id);
    const tipo = esp?.tipo ?? t.metaTipo;
    const meta = esp?.valor ?? t.metaMensal;
    const valor = arredondar(g?._sum.total || 0);
    const qtd = g?._count._all || 0;
    const atingido = tipo === 'QTD_OS' ? qtd : valor;
    return { id: t.id, nome: t.nome, valorServicos: valor, osConcluidas: qtd, tipo, meta, atingido, pct: meta ? Math.min(999, arredondar((atingido / meta) * 100, 1)) : 0 };
  });

  const { financeiro, caixinhas, sugestaoHojeTotal } = avisos;
  return {
    financeiro: {
      saldoTotal: financeiro.saldoTotal,
      saldoContas: financeiro.saldoContas,
      receberHoje: financeiro.receberHoje,
      receberSemana: financeiro.receberSemana,
      receberAtrasado: financeiro.receberAtrasado,
      pagarHoje: financeiro.pagarHoje,
      pagarSemana: financeiro.pagarSemana,
      pagarAtrasado: financeiro.pagarAtrasado,
    },
    periodo: {
      receita: arredondar(totalVendas + totalOs),
      vendas: { valor: totalVendas, qtd: vendas.length },
      assistencia: { valor: totalOs, qtd: ordens.length },
      entradas,
      saidas,
      anterior: { receita: arredondar((vendasAnt._sum.total || 0) + (ordensAnt._sum.total || 0)), vendas: arredondar(vendasAnt._sum.total || 0), assistencia: arredondar(ordensAnt._sum.total || 0) },
    },
    avisos: avisos.avisos,
    caixinhas: { lista: caixinhas, sugestaoHojeTotal },
    equipe: { vendedores: equipeVendedores, tecnicos: equipeTecnicos, competencia },
    desafios: desafios.map((d) => ({
      id: d.id,
      titulo: d.titulo,
      publico: d.publico,
      tipo: d.tipo,
      alvo: d.alvo,
      premio: d.premio,
      fim: d.fim,
      regra: d.regra,
      conquistados: d.conquistas.map((c) => c.vendedor?.nome ?? c.tecnico?.nome ?? '').filter(Boolean),
    })),
    serie: ordenada(serie),
    porVendedor: [...porVendedor.values()].sort((a, b) => b.valor - a.valor),
    acontecimentos,
  };
}

/** Resolve dataInicial/dataFinal do filtro (padrão: hoje) e o agrupamento da série */
export function periodoDe(q: { dataInicial?: Date | null; dataFinal?: Date | null }): Periodo {
  const hoje = new Date();
  let ini: Date = q.dataInicial ? startOfDay(q.dataInicial) : q.dataFinal ? startOfDay(q.dataFinal) : startOfDay(hoje);
  let fim: Date = q.dataFinal ? endOfDay(q.dataFinal) : q.dataInicial ? endOfDay(q.dataInicial) : endOfDay(hoje);
  if (fim < ini) [ini, fim] = [startOfDay(fim), endOfDay(ini)];
  return { ini, fim, agrupar: agruparPadrao(ini, fim) };
}
