/**
 * METAS E DESAFIOS — de VENDAS (vendedores) e de ASSISTÊNCIA (técnicos)
 *
 * - Venda que conta: todo PEDIDO que não está numa situação de cancelamento (Em aberto, Em andamento,
 *   Fechada, NF emitida…). Conta no painel assim que é salva; se for cancelada, sai. Orçamentos ficam de fora.
 * - OS que conta (técnico): OS numa situação FINAL que não é cancelamento (Entregue, Sem reparo…),
 *   pela data de conclusão. Enquanto está aberta ainda não conta.
 * - Meta do mês do vendedor: MetaVendedor(vendedor, AAAA-MM) ou, se não houver, Vendedor.metaMensal (R$ vendido).
 * - Meta do mês do técnico: MetaTecnico(técnico, AAAA-MM) ou Tecnico.metaMensal/metaTipo — em R$ de serviços
 *   (VALOR_SERVICOS) ou em nº de OS concluídas (QTD_OS). O tipo é escolhido ao criar a meta (decisão do Thiago, 29/10/2026).
 * - Desafio: `publico` VENDEDORES (progresso pelas vendas) ou TECNICOS (progresso pelas OS concluídas).
 *   Quando o participante bate o alvo, grava DesafioConquista + Comissao (origem DESAFIO, já APROVADA = liberada
 *   automaticamente). Se depois uma venda/OS for cancelada e o alvo deixar de ser batido, o prêmio ainda não pago
 *   é estornado (comissão CANCELADA e conquista removida). Prêmio já pago fica.
 * - Semana começa na segunda-feira.
 */
import { addDays, endOfDay, endOfMonth, startOfDay, startOfMonth, startOfWeek, differenceInCalendarDays, subDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { arredondar, competenciaDe, parseJsonArray } from '../../lib/util.js';

export const TIPOS_DESAFIO_VENDEDOR = ['VALOR', 'QTD_VENDAS', 'QTD_ITENS'] as const;
export const TIPOS_DESAFIO_TECNICO = ['VALOR_SERVICOS', 'QTD_OS'] as const;
export const TIPOS_DESAFIO = [...TIPOS_DESAFIO_VENDEDOR, ...TIPOS_DESAFIO_TECNICO] as const;
export const PUBLICOS_DESAFIO = ['VENDEDORES', 'TECNICOS'] as const;
export const TIPOS_META_TECNICO = ['VALOR_SERVICOS', 'QTD_OS'] as const;
export type TipoDesafio = (typeof TIPOS_DESAFIO)[number];
export type PublicoDesafio = (typeof PUBLICOS_DESAFIO)[number];
export type TipoMetaTecnico = (typeof TIPOS_META_TECNICO)[number];

// ---------------------------------------------------------------------------------- situações
let cacheSituacoes: { ids: number[]; em: number } | null = null;
/** ids das situações de venda que contam (todas menos as de cancelamento; cache de 1 min) */
export async function situacoesQueContam(): Promise<number[]> {
  if (cacheSituacoes && Date.now() - cacheSituacoes.em < 60_000) return cacheSituacoes.ids;
  const s = await prisma.situacao.findMany({ where: { modulo: 'VENDA', cancelamento: false }, select: { id: true } });
  cacheSituacoes = { ids: s.map((x) => x.id), em: Date.now() };
  return cacheSituacoes.ids;
}

let cacheOs: { ids: number[]; em: number } | null = null;
/** ids das situações de OS que contam como concluídas (final e não cancelamento; cache de 1 min) */
export async function situacoesOsConcluidas(): Promise<number[]> {
  if (cacheOs && Date.now() - cacheOs.em < 60_000) return cacheOs.ids;
  const s = await prisma.situacao.findMany({ where: { modulo: 'OS', final: true, cancelamento: false }, select: { id: true } });
  cacheOs = { ids: s.map((x) => x.id), em: Date.now() };
  return cacheOs.ids;
}

async function whereVendas(vendedorId: number | undefined, ini: Date | null, fim: Date | null): Promise<Prisma.VendaWhereInput> {
  const w: Prisma.VendaWhereInput = { tipo: 'PEDIDO', situacaoId: { in: await situacoesQueContam() } };
  if (vendedorId !== undefined) w.vendedorId = vendedorId;
  if (ini || fim) w.data = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
  return w;
}

async function whereOsConcluidas(tecnicoId: number | undefined, ini: Date | null, fim: Date | null): Promise<Prisma.OrdemServicoWhereInput> {
  const w: Prisma.OrdemServicoWhereInput = { situacaoId: { in: await situacoesOsConcluidas() } };
  if (tecnicoId !== undefined) w.tecnicoId = tecnicoId;
  if (ini || fim) w.dataConclusao = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
  return w;
}

// ---------------------------------------------------------------------------------- períodos
export function periodosPainel(agora = new Date()) {
  return [
    { chave: 'hoje', rotulo: 'Hoje', ini: startOfDay(agora), fim: endOfDay(agora) },
    { chave: 'semana', rotulo: 'Esta semana', ini: startOfWeek(agora, { weekStartsOn: 1 }), fim: endOfDay(agora) },
    { chave: 'ultimos7', rotulo: 'Últimos 7 dias', ini: startOfDay(subDays(agora, 6)), fim: endOfDay(agora) },
    { chave: 'mes', rotulo: 'Este mês', ini: startOfMonth(agora), fim: endOfDay(agora) },
    { chave: 'ultimos30', rotulo: 'Últimos 30 dias', ini: startOfDay(subDays(agora, 29)), fim: endOfDay(agora) },
    { chave: 'sempre', rotulo: 'Sempre', ini: null as Date | null, fim: null as Date | null },
  ];
}

/** Faturamento, nº de vendas, ticket médio e comissão (dos itens) de um vendedor num período */
export async function resumoVendas(vendedorId: number, ini: Date | null, fim: Date | null) {
  const where = await whereVendas(vendedorId, ini, fim);
  const [agg, com] = await Promise.all([
    prisma.venda.aggregate({ where, _sum: { total: true }, _count: { _all: true } }),
    prisma.vendaItem.aggregate({ where: { venda: where }, _sum: { comissaoValor: true } }),
  ]);
  const faturamento = arredondar(agg._sum.total || 0);
  const qtd = agg._count._all;
  return { faturamento, qtd, ticketMedio: qtd ? arredondar(faturamento / qtd) : 0, comissao: arredondar(com._sum.comissaoValor || 0) };
}

/** OS concluídas de um técnico num período: quantidade e valor cobrado (mão de obra + peças), SEM custo nem lucro */
export async function resumoOsTecnico(tecnicoId: number, ini: Date | null, fim: Date | null) {
  const where = await whereOsConcluidas(tecnicoId, ini, fim);
  const agg = await prisma.ordemServico.aggregate({ where, _sum: { total: true, totalServicos: true, totalPecas: true }, _count: { _all: true } });
  const valor = arredondar(agg._sum.total || 0);
  const qtd = agg._count._all;
  return { qtd, valor, maoDeObra: arredondar(agg._sum.totalServicos || 0), pecas: arredondar(agg._sum.totalPecas || 0), ticketMedio: qtd ? arredondar(valor / qtd) : 0 };
}

// ---------------------------------------------------------------------------------- metas (vendedor)
export async function metaDoMes(vendedorId: number, competencia: string) {
  const [especifica, vendedor] = await Promise.all([
    prisma.metaVendedor.findUnique({ where: { vendedorId_competencia: { vendedorId, competencia } } }),
    prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { metaMensal: true } }),
  ]);
  if (especifica) return { valor: especifica.valor, origem: 'MES' as const };
  return { valor: vendedor?.metaMensal || 0, origem: 'PADRAO' as const };
}

/** Ritmo da meta no mês: quanto já foi, quanto falta, quanto precisa por dia e se está no ritmo */
function ritmoMeta(valorMeta: number, atingido: number, agora: Date) {
  const competencia = competenciaDe(agora);
  if (!valorMeta) return { competencia, valor: 0, vendido: atingido, pct: 0, falta: 0, diasRestantes: 0, porDia: 0, esperadoAteHoje: 0, ritmo: 'sem-meta' as const };
  const ini = startOfMonth(agora);
  const diasNoMes = differenceInCalendarDays(endOfMonth(agora), ini) + 1;
  const diaAtual = differenceInCalendarDays(agora, ini) + 1;
  const diasRestantes = diasNoMes - diaAtual + 1; // inclui hoje
  const falta = Math.max(0, arredondar(valorMeta - atingido));
  const esperadoAteHoje = arredondar((valorMeta * diaAtual) / diasNoMes);
  const pct = arredondar((atingido / valorMeta) * 100, 1);
  const ritmoPct = esperadoAteHoje ? atingido / esperadoAteHoje : 1;
  const ritmo = falta === 0 ? ('batida' as const) : ritmoPct >= 0.95 ? ('ok' as const) : ritmoPct >= 0.75 ? ('atencao' as const) : ('atrasado' as const);
  return { competencia, valor: valorMeta, vendido: atingido, pct, falta, diasRestantes, porDia: diasRestantes ? arredondar(falta / diasRestantes) : falta, esperadoAteHoje, ritmo };
}

/** Progresso da meta no mês corrente, com ritmo (verde/amarelo/vermelho) e quanto precisa por dia */
export async function progressoMeta(vendedorId: number, vendido: number, agora = new Date()) {
  const meta = await metaDoMes(vendedorId, competenciaDe(agora));
  return { ...ritmoMeta(meta.valor, vendido, agora), origem: meta.origem };
}

// ---------------------------------------------------------------------------------- metas (técnico)
export async function metaTecnicoDoMes(tecnicoId: number, competencia: string) {
  const [especifica, tecnico] = await Promise.all([
    prisma.metaTecnico.findUnique({ where: { tecnicoId_competencia: { tecnicoId, competencia } } }),
    prisma.tecnico.findUnique({ where: { id: tecnicoId }, select: { metaMensal: true, metaTipo: true } }),
  ]);
  if (especifica) return { valor: especifica.valor, tipo: especifica.tipo as TipoMetaTecnico, origem: 'MES' as const };
  return { valor: tecnico?.metaMensal || 0, tipo: (tecnico?.metaTipo as TipoMetaTecnico) || 'VALOR_SERVICOS', origem: 'PADRAO' as const };
}

/** Progresso da meta do técnico no mês (R$ de OS concluídas ou nº de OS concluídas) */
export async function progressoMetaTecnico(tecnicoId: number, agora = new Date()) {
  const competencia = competenciaDe(agora);
  const meta = await metaTecnicoDoMes(tecnicoId, competencia);
  const mes = await resumoOsTecnico(tecnicoId, startOfMonth(agora), endOfDay(agora));
  const atingido = meta.tipo === 'QTD_OS' ? mes.qtd : mes.valor;
  const r = ritmoMeta(meta.valor, atingido, agora);
  return { ...r, tipo: meta.tipo, origem: meta.origem, atingido: r.vendido, osConcluidas: mes.qtd, valorServicos: mes.valor };
}

// ---------------------------------------------------------------------------------- desafios
type DesafioBase = Prisma.DesafioGetPayload<{}>;

export function publicoDe(d: Pick<DesafioBase, 'publico'>): PublicoDesafio {
  return d.publico === 'TECNICOS' ? 'TECNICOS' : 'VENDEDORES';
}

/** ids dos participantes (vendedores ou técnicos, conforme o público do desafio) */
export function participantes(d: Pick<DesafioBase, 'todosVendedores' | 'vendedoresIds' | 'tecnicosIds' | 'publico'>, ativos: number[]): number[] {
  if (d.todosVendedores) return ativos;
  const campo = publicoDe(d) === 'TECNICOS' ? d.tecnicosIds : d.vendedoresIds;
  return parseJsonArray(campo).map(Number).filter(Boolean);
}

/** Progresso de cada participante num desafio (mapa participanteId → valor atingido) */
export async function progressoDesafio(d: DesafioBase, ids: number[]): Promise<Map<number, number>> {
  const r = new Map<number, number>(ids.map((v) => [v, 0]));
  if (!ids.length) return r;

  // ---- técnicos: OS concluídas no período
  if (publicoDe(d) === 'TECNICOS') {
    const where = await whereOsConcluidas(undefined, d.inicio, d.fim);
    where.tecnicoId = { in: ids };
    const g = await prisma.ordemServico.groupBy({ by: ['tecnicoId'], where, _count: { _all: true }, _sum: { total: true } });
    for (const x of g) if (x.tecnicoId) r.set(x.tecnicoId, d.tipo === 'QTD_OS' ? x._count._all : arredondar(x._sum.total || 0));
    return r;
  }

  // ---- vendedores: vendas no período
  const base = await whereVendas(undefined, d.inicio, d.fim);
  base.vendedorId = { in: ids };
  const filtroItem: Prisma.VendaItemWhereInput | null = d.produtoId ? { produtoId: d.produtoId } : d.categoriaId ? { produto: { categoriaId: d.categoriaId } } : null;

  if (d.tipo === 'QTD_VENDAS') {
    const where = filtroItem ? { ...base, itens: { some: filtroItem } } : base;
    const g = await prisma.venda.groupBy({ by: ['vendedorId'], where, _count: { _all: true } });
    for (const x of g) if (x.vendedorId) r.set(x.vendedorId, x._count._all);
    return r;
  }
  if (d.tipo === 'VALOR' && !filtroItem) {
    const g = await prisma.venda.groupBy({ by: ['vendedorId'], where: base, _sum: { total: true } });
    for (const x of g) if (x.vendedorId) r.set(x.vendedorId, arredondar(x._sum.total || 0));
    return r;
  }
  // VALOR com filtro de produto/categoria, ou QTD_ITENS: soma dos itens
  const itens = await prisma.vendaItem.findMany({ where: { venda: base, ...(filtroItem || {}) }, select: { total: true, quantidade: true, venda: { select: { vendedorId: true } } } });
  for (const i of itens) {
    const v = i.venda.vendedorId;
    if (!v) continue;
    r.set(v, arredondar((r.get(v) || 0) + (d.tipo === 'QTD_ITENS' ? i.quantidade : i.total), 3));
  }
  return r;
}

async function participantesAtivos(publico: PublicoDesafio) {
  if (publico === 'TECNICOS') return (await prisma.tecnico.findMany({ where: { ativo: true }, select: { id: true } })).map((t) => t.id);
  return (await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true } })).map((v) => v.id);
}

/** id do participante numa conquista (vendedorId ou tecnicoId, conforme o público) */
export function participanteDaConquista(d: Pick<DesafioBase, 'publico'>, c: { vendedorId: number | null; tecnicoId: number | null }): number {
  return (publicoDe(d) === 'TECNICOS' ? c.tecnicoId : c.vendedorId) || 0;
}

/**
 * Recalcula um desafio: grava conquistas novas (com a comissão extra) e estorna as que deixaram
 * de valer (se o prêmio ainda não foi pago). Idempotente.
 */
export async function avaliarDesafio(desafioId: number) {
  const d = await prisma.desafio.findUnique({ where: { id: desafioId } });
  if (!d) return { novas: 0, estornadas: 0 };
  const publico = publicoDe(d);
  const ativos = await participantesAtivos(publico);
  const ids = participantes(d, ativos);
  const conquistas = await prisma.desafioConquista.findMany({ where: { desafioId }, include: { comissao: true }, orderBy: { conquistadoEm: 'asc' } });
  const progresso = await progressoDesafio(d, [...new Set([...ids, ...conquistas.map((c) => participanteDaConquista(d, c))])]);
  let novas = 0;
  let estornadas = 0;

  // 1) estornos: quem tinha conquistado e não bate mais o alvo
  for (const c of conquistas) {
    if ((progresso.get(participanteDaConquista(d, c)) || 0) >= d.alvo) continue;
    if (c.comissao?.status === 'PAGA') continue; // já pago: fica
    await prisma.$transaction(async (tx) => {
      if (c.comissaoId) await tx.comissao.update({ where: { id: c.comissaoId }, data: { status: 'CANCELADA', descricao: `${c.comissao?.descricao || 'Desafio'} (estornado: alvo deixou de ser batido)` } });
      await tx.desafioConquista.delete({ where: { id: c.id } });
    });
    estornadas++;
  }

  // 2) novas conquistas (só enquanto o desafio está ativo; o período é o das vendas/OS, então
  //    uma venda fechada depois do fim mas com data dentro do período ainda conta)
  if (d.ativo) {
    const restantes = await prisma.desafioConquista.findMany({ where: { desafioId }, select: { vendedorId: true, tecnicoId: true } });
    const jaGanharam = new Set(restantes.map((c) => participanteDaConquista(d, c)));
    if (d.regra === 'PRIMEIRO' && jaGanharam.size > 0) return { novas, estornadas };
    const candidatos = ids
      .filter((v) => !jaGanharam.has(v) && (progresso.get(v) || 0) >= d.alvo)
      // regra PRIMEIRO: na dúvida, ganha quem tem mais
      .sort((a, b) => (progresso.get(b) || 0) - (progresso.get(a) || 0));
    for (const participanteId of d.regra === 'PRIMEIRO' ? candidatos.slice(0, 1) : candidatos) {
      try {
        await prisma.$transaction(async (tx) => {
          const agora = new Date();
          const comissao = await tx.comissao.create({
            data: {
              tipo: publico === 'TECNICOS' ? 'TECNICO' : 'VENDEDOR',
              vendedorId: publico === 'TECNICOS' ? null : participanteId,
              tecnicoId: publico === 'TECNICOS' ? participanteId : null,
              origemTipo: 'DESAFIO',
              desafioId: d.id,
              descricao: `Prêmio do desafio "${d.titulo}"`,
              base: 0,
              pct: 0,
              valor: arredondar(d.premio),
              status: 'APROVADA',
              competencia: competenciaDe(agora),
            },
          });
          await tx.desafioConquista.create({
            data: {
              desafioId: d.id,
              vendedorId: publico === 'TECNICOS' ? null : participanteId,
              tecnicoId: publico === 'TECNICOS' ? participanteId : null,
              conquistadoEm: agora,
              atingido: progresso.get(participanteId) || 0,
              comissaoId: comissao.id,
            },
          });
        });
        novas++;
      } catch (e: any) {
        // P2002 = outra avaliação simultânea já gravou esta conquista
        if (e?.code !== 'P2002') throw e;
      }
    }
  }
  return { novas, estornadas };
}

/** Avalia todos os desafios cujo período inclui a data (ou que terminaram há até 45 dias, se sem data) */
export async function avaliarDesafiosAbertos(dataVenda?: Date | null, publico?: PublicoDesafio) {
  const where: Prisma.DesafioWhereInput = dataVenda
    ? { inicio: { lte: dataVenda }, fim: { gte: dataVenda } }
    : { fim: { gte: addDays(new Date(), -45) } };
  if (publico) where.publico = publico;
  const lista = await prisma.desafio.findMany({ where, select: { id: true } });
  for (const d of lista) await avaliarDesafio(d.id);
  return lista.length;
}

/** Situação do desafio para um participante (para o card) */
export function statusDesafio(d: DesafioBase, atingido: number, conquistou: boolean, ganhoPorOutro: boolean, agora = new Date()) {
  if (conquistou) return 'CONQUISTADO';
  if (!d.ativo) return 'ENCERRADO';
  if (ganhoPorOutro) return 'GANHO_POR_OUTRO';
  if (agora < d.inicio) return 'AGENDADO';
  if (agora > d.fim) return 'ENCERRADO';
  return atingido >= d.alvo ? 'CONQUISTADO' : 'EM_ANDAMENTO';
}

export const includeDesafio = {
  produto: { select: { id: true, nome: true, codigo: true } },
  categoria: { select: { id: true, nome: true } },
  conquistas: {
    include: { vendedor: { select: { id: true, nome: true } }, tecnico: { select: { id: true, nome: true } }, comissao: { select: { id: true, status: true, valor: true } } },
    orderBy: { conquistadoEm: 'asc' as const },
  },
} as const;

/**
 * Cards de desafio de um participante (vendedor ou técnico): vigentes, futuros, os que terminaram nos
 * últimos 7 dias e os que ele conquistou no mês. Mesmo formato para o painel do vendedor e o Meu Dashboard.
 */
export async function desafiosDoParticipante(publico: PublicoDesafio, participanteId: number, agora = new Date()) {
  const iniMes = startOfMonth(agora);
  const campo = publico === 'TECNICOS' ? 'tecnicoId' : 'vendedorId';
  const desafiosDb = await prisma.desafio.findMany({
    where: { publico, OR: [{ fim: { gte: new Date(agora.getTime() - 7 * 86400000) } }, { conquistas: { some: { [campo]: participanteId, conquistadoEm: { gte: iniMes } } } }] },
    include: includeDesafio,
    orderBy: [{ fim: 'asc' }],
  });
  const idsAtivos = await participantesAtivos(publico);
  const desafios = [];
  for (const d of desafiosDb) {
    const part = participantes(d, idsAtivos);
    const minhaConquista = d.conquistas.find((c) => participanteDaConquista(d, c) === participanteId);
    if (!part.includes(participanteId) && !minhaConquista) continue;
    // conquistas já gravadas não dependem do recálculo; o progresso é ao vivo
    const prog = (await progressoDesafio(d, [participanteId])).get(participanteId) || 0;
    const outro = d.regra === 'PRIMEIRO' ? d.conquistas.find((c) => participanteDaConquista(d, c) !== participanteId) : undefined;
    const status = statusDesafio(d, prog, !!minhaConquista, !!outro, agora);
    if (status === 'ENCERRADO' && !d.ativo && agora < d.fim && !minhaConquista) continue; // cancelado pela gestão
    desafios.push({
      id: d.id,
      titulo: d.titulo,
      descricao: d.descricao,
      publico,
      tipo: d.tipo as TipoDesafio,
      alvo: d.alvo,
      premio: d.premio,
      regra: d.regra,
      inicio: d.inicio,
      fim: d.fim,
      produto: d.produto,
      categoria: d.categoria,
      atingido: prog,
      pct: Math.min(100, arredondar((prog / d.alvo) * 100, 1)),
      falta: Math.max(0, arredondar(d.alvo - prog, 2)),
      status,
      conquistadoEm: minhaConquista?.conquistadoEm ?? null,
      premioStatus: minhaConquista?.comissao?.status ?? null,
      ganhador: outro ? (outro.vendedor?.nome ?? outro.tecnico?.nome ?? null) : null,
      diasRestantes: Math.max(0, Math.ceil((d.fim.getTime() - agora.getTime()) / 86400000)),
    });
  }
  const ordemStatus: Record<string, number> = { EM_ANDAMENTO: 0, AGENDADO: 1, CONQUISTADO: 2, GANHO_POR_OUTRO: 3, ENCERRADO: 4 };
  desafios.sort((a, b) => (ordemStatus[a.status] ?? 9) - (ordemStatus[b.status] ?? 9) || +a.fim - +b.fim);
  return desafios;
}

/** Ranking do mês dos vendedores (quem vê os valores dos outros: só a gestão) */
export async function rankingVendedores(vendedorId: number, gestor: boolean, agora = new Date()) {
  const iniMes = startOfMonth(agora);
  const fimDia = endOfDay(agora);
  const sitOk = await situacoesQueContam();
  const [ativos, eu] = await Promise.all([
    prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { id: true, nome: true, ativo: true } }),
  ]);
  const grupos = await prisma.venda.groupBy({ by: ['vendedorId'], where: { tipo: 'PEDIDO', situacaoId: { in: sitOk }, data: { gte: iniMes, lte: fimDia }, vendedorId: { not: null } }, _sum: { total: true } });
  const totalDe = (id: number) => arredondar(grupos.find((g) => g.vendedorId === id)?._sum.total || 0);
  const ordenados = [...ativos, ...(eu && !eu.ativo ? [{ id: eu.id, nome: eu.nome }] : [])]
    .map((v) => ({ vendedorId: v.id, nome: v.nome, faturamento: totalDe(v.id) }))
    .sort((a, b) => b.faturamento - a.faturamento || a.nome.localeCompare(b.nome));
  const posicao = ordenados.findIndex((v) => v.vendedorId === vendedorId) + 1;
  const meu = totalDe(vendedorId);
  const acima = posicao > 1 ? ordenados[posicao - 2] : null;
  return {
    competencia: competenciaDe(agora),
    posicao,
    total: ordenados.length,
    // vendedor vê nomes e posição de todos, mas o valor só o dele (e quanto falta para passar o da frente)
    lista: ordenados.map((v, i) => ({ posicao: i + 1, vendedorId: v.vendedorId, nome: v.nome, eu: v.vendedorId === vendedorId, faturamento: gestor || v.vendedorId === vendedorId ? v.faturamento : null })),
    paraPassar: acima ? { nome: acima.nome, falta: arredondar(acima.faturamento - meu + 0.01) } : null,
  };
}

/** Ranking do mês dos técnicos (por valor de OS concluídas) */
export async function rankingTecnicos(tecnicoId: number, gestor: boolean, agora = new Date()) {
  const iniMes = startOfMonth(agora);
  const fimDia = endOfDay(agora);
  const sitOk = await situacoesOsConcluidas();
  const [ativos, eu] = await Promise.all([
    prisma.tecnico.findMany({ where: { ativo: true }, select: { id: true, nome: true } }),
    prisma.tecnico.findUnique({ where: { id: tecnicoId }, select: { id: true, nome: true, ativo: true } }),
  ]);
  const grupos = await prisma.ordemServico.groupBy({ by: ['tecnicoId'], where: { situacaoId: { in: sitOk }, dataConclusao: { gte: iniMes, lte: fimDia }, tecnicoId: { not: null } }, _sum: { total: true }, _count: { _all: true } });
  const de = (id: number) => grupos.find((g) => g.tecnicoId === id);
  const ordenados = [...ativos, ...(eu && !eu.ativo ? [{ id: eu.id, nome: eu.nome }] : [])]
    .map((t) => ({ tecnicoId: t.id, nome: t.nome, valor: arredondar(de(t.id)?._sum.total || 0), qtd: de(t.id)?._count._all || 0 }))
    .sort((a, b) => b.valor - a.valor || b.qtd - a.qtd || a.nome.localeCompare(b.nome));
  const posicao = ordenados.findIndex((v) => v.tecnicoId === tecnicoId) + 1;
  return {
    competencia: competenciaDe(agora),
    posicao,
    total: ordenados.length,
    lista: ordenados.map((t, i) => ({ posicao: i + 1, tecnicoId: t.tecnicoId, nome: t.nome, eu: t.tecnicoId === tecnicoId, valor: gestor || t.tecnicoId === tecnicoId ? t.valor : null, qtd: gestor || t.tecnicoId === tecnicoId ? t.qtd : null })),
  };
}

/**
 * Painel do vendedor (vendas por período, meta, desafios, ranking e últimas vendas).
 * Usado em GET /painel-vendedor e no Meu Dashboard do vendedor/técnico.
 */
export async function painelDoVendedor(vendedorId: number, gestor: boolean, agora = new Date()) {
  const vendedor = await prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { id: true, nome: true, ativo: true, metaMensal: true } });
  if (!vendedor) return null;
  const periodos = await Promise.all(periodosPainel(agora).map(async (p) => ({ chave: p.chave, rotulo: p.rotulo, inicio: p.ini, fim: p.fim, ...(await resumoVendas(vendedor.id, p.ini, p.fim)) })));
  const mes = periodos.find((p) => p.chave === 'mes')!;
  const competencia = competenciaDe(agora);
  const [meta, bonus, ranking, desafios, ultimasVendas] = await Promise.all([
    progressoMeta(vendedor.id, mes.faturamento, agora),
    prisma.comissao.aggregate({ where: { vendedorId: vendedor.id, origemTipo: 'DESAFIO', competencia, status: { not: 'CANCELADA' } }, _sum: { valor: true } }),
    rankingVendedores(vendedor.id, gestor, agora),
    desafiosDoParticipante('VENDEDORES', vendedor.id, agora),
    prisma.venda.findMany({
      where: { tipo: 'PEDIDO', vendedorId: vendedor.id },
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 10,
      select: { id: true, numero: true, data: true, total: true, contato: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true, cor: true } } },
    }),
  ]);
  return {
    vendedor: { id: vendedor.id, nome: vendedor.nome },
    periodos,
    meta: { ...meta, bonusDesafios: arredondar(bonus._sum.valor || 0) },
    ranking,
    desafios,
    ultimasVendas,
  };
}
