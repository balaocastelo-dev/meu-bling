/**
 * METAS E DESAFIOS DE VENDAS
 *
 * - Venda que conta: todo PEDIDO que não está numa situação de cancelamento (Em aberto, Em andamento,
 *   Fechada, NF emitida…). Conta no painel assim que é salva; se for cancelada, sai. Orçamentos ficam de fora.
 * - Meta do mês: MetaVendedor(vendedor, AAAA-MM) ou, se não houver, Vendedor.metaMensal.
 * - Desafio: o progresso é calculado das vendas no período. Quando o vendedor bate o alvo,
 *   grava DesafioConquista + Comissao (origem DESAFIO, já APROVADA = liberada automaticamente).
 *   Se depois uma venda for cancelada e o alvo deixar de ser batido, o prêmio ainda não pago é
 *   estornado (comissão CANCELADA e conquista removida). Prêmio já pago fica.
 * - Semana começa na segunda-feira.
 */
import { addDays, endOfDay, endOfMonth, startOfDay, startOfMonth, startOfWeek, differenceInCalendarDays, subDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { arredondar, competenciaDe, parseJsonArray } from '../../lib/util.js';

export const TIPOS_DESAFIO = ['VALOR', 'QTD_VENDAS', 'QTD_ITENS'] as const;
export type TipoDesafio = (typeof TIPOS_DESAFIO)[number];

// ---------------------------------------------------------------------------------- situações
let cacheSituacoes: { ids: number[]; em: number } | null = null;
/** ids das situações de venda que contam (todas menos as de cancelamento; cache de 1 min) */
export async function situacoesQueContam(): Promise<number[]> {
  if (cacheSituacoes && Date.now() - cacheSituacoes.em < 60_000) return cacheSituacoes.ids;
  const s = await prisma.situacao.findMany({ where: { modulo: 'VENDA', cancelamento: false }, select: { id: true } });
  cacheSituacoes = { ids: s.map((x) => x.id), em: Date.now() };
  return cacheSituacoes.ids;
}

async function whereVendas(vendedorId: number | undefined, ini: Date | null, fim: Date | null): Promise<Prisma.VendaWhereInput> {
  const w: Prisma.VendaWhereInput = { tipo: 'PEDIDO', situacaoId: { in: await situacoesQueContam() } };
  if (vendedorId !== undefined) w.vendedorId = vendedorId;
  if (ini || fim) w.data = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
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

// ---------------------------------------------------------------------------------- metas
export async function metaDoMes(vendedorId: number, competencia: string) {
  const [especifica, vendedor] = await Promise.all([
    prisma.metaVendedor.findUnique({ where: { vendedorId_competencia: { vendedorId, competencia } } }),
    prisma.vendedor.findUnique({ where: { id: vendedorId }, select: { metaMensal: true } }),
  ]);
  if (especifica) return { valor: especifica.valor, origem: 'MES' as const };
  return { valor: vendedor?.metaMensal || 0, origem: 'PADRAO' as const };
}

/** Progresso da meta no mês corrente, com ritmo (verde/amarelo/vermelho) e quanto precisa por dia */
export async function progressoMeta(vendedorId: number, vendido: number, agora = new Date()) {
  const competencia = competenciaDe(agora);
  const meta = await metaDoMes(vendedorId, competencia);
  if (!meta.valor) return { competencia, valor: 0, origem: meta.origem, vendido, pct: 0, falta: 0, diasRestantes: 0, porDia: 0, esperadoAteHoje: 0, ritmo: 'sem-meta' as const };
  const ini = startOfMonth(agora);
  const diasNoMes = differenceInCalendarDays(endOfMonth(agora), ini) + 1;
  const diaAtual = differenceInCalendarDays(agora, ini) + 1;
  const diasRestantes = diasNoMes - diaAtual + 1; // inclui hoje
  const falta = Math.max(0, arredondar(meta.valor - vendido));
  const esperadoAteHoje = arredondar((meta.valor * diaAtual) / diasNoMes);
  const pct = arredondar((vendido / meta.valor) * 100, 1);
  const ritmoPct = esperadoAteHoje ? vendido / esperadoAteHoje : 1;
  const ritmo = falta === 0 ? ('batida' as const) : ritmoPct >= 0.95 ? ('ok' as const) : ritmoPct >= 0.75 ? ('atencao' as const) : ('atrasado' as const);
  return { competencia, valor: meta.valor, origem: meta.origem, vendido, pct, falta, diasRestantes, porDia: diasRestantes ? arredondar(falta / diasRestantes) : falta, esperadoAteHoje, ritmo };
}

// ---------------------------------------------------------------------------------- desafios
type DesafioBase = Prisma.DesafioGetPayload<{}>;

export function participantes(d: Pick<DesafioBase, 'todosVendedores' | 'vendedoresIds'>, ativos: number[]): number[] {
  if (d.todosVendedores) return ativos;
  const ids = parseJsonArray(d.vendedoresIds).map(Number).filter(Boolean);
  return ids;
}

/** Progresso de cada vendedor num desafio (mapa vendedorId → valor atingido) */
export async function progressoDesafio(d: DesafioBase, vendedores: number[]): Promise<Map<number, number>> {
  const r = new Map<number, number>(vendedores.map((v) => [v, 0]));
  if (!vendedores.length) return r;
  const base = await whereVendas(undefined, d.inicio, d.fim);
  base.vendedorId = { in: vendedores };
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

async function vendedoresAtivos() {
  return (await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true } })).map((v) => v.id);
}

/**
 * Recalcula um desafio: grava conquistas novas (com a comissão extra) e estorna as que deixaram
 * de valer (se o prêmio ainda não foi pago). Idempotente.
 */
export async function avaliarDesafio(desafioId: number) {
  const d = await prisma.desafio.findUnique({ where: { id: desafioId } });
  if (!d) return { novas: 0, estornadas: 0 };
  const ativos = await vendedoresAtivos();
  const ids = participantes(d, ativos);
  const conquistas = await prisma.desafioConquista.findMany({ where: { desafioId }, include: { comissao: true }, orderBy: { conquistadoEm: 'asc' } });
  const progresso = await progressoDesafio(d, [...new Set([...ids, ...conquistas.map((c) => c.vendedorId)])]);
  let novas = 0;
  let estornadas = 0;

  // 1) estornos: quem tinha conquistado e não bate mais o alvo
  for (const c of conquistas) {
    if ((progresso.get(c.vendedorId) || 0) >= d.alvo) continue;
    if (c.comissao?.status === 'PAGA') continue; // já pago: fica
    await prisma.$transaction(async (tx) => {
      if (c.comissaoId) await tx.comissao.update({ where: { id: c.comissaoId }, data: { status: 'CANCELADA', descricao: `${c.comissao?.descricao || 'Desafio'} (estornado: alvo deixou de ser batido)` } });
      await tx.desafioConquista.delete({ where: { id: c.id } });
    });
    estornadas++;
  }

  // 2) novas conquistas (só enquanto o desafio está ativo; o período é o das vendas, então
  //    uma venda fechada depois do fim mas com data dentro do período ainda conta)
  if (d.ativo) {
    const restantes = await prisma.desafioConquista.findMany({ where: { desafioId }, select: { vendedorId: true } });
    const jaGanharam = new Set(restantes.map((c) => c.vendedorId));
    if (d.regra === 'PRIMEIRO' && jaGanharam.size > 0) return { novas, estornadas };
    const candidatos = ids
      .filter((v) => !jaGanharam.has(v) && (progresso.get(v) || 0) >= d.alvo)
      // regra PRIMEIRO: na dúvida, ganha quem tem mais
      .sort((a, b) => (progresso.get(b) || 0) - (progresso.get(a) || 0));
    for (const vendedorId of d.regra === 'PRIMEIRO' ? candidatos.slice(0, 1) : candidatos) {
      try {
        await prisma.$transaction(async (tx) => {
          const agora = new Date();
          const comissao = await tx.comissao.create({
            data: {
              tipo: 'VENDEDOR',
              vendedorId,
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
          await tx.desafioConquista.create({ data: { desafioId: d.id, vendedorId, conquistadoEm: agora, atingido: progresso.get(vendedorId) || 0, comissaoId: comissao.id } });
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
export async function avaliarDesafiosAbertos(dataVenda?: Date | null) {
  const where: Prisma.DesafioWhereInput = dataVenda
    ? { inicio: { lte: dataVenda }, fim: { gte: dataVenda } }
    : { fim: { gte: addDays(new Date(), -45) } };
  const lista = await prisma.desafio.findMany({ where, select: { id: true } });
  for (const d of lista) await avaliarDesafio(d.id);
  return lista.length;
}

/** Situação do desafio para um vendedor (para o card) */
export function statusDesafio(d: DesafioBase, atingido: number, conquistou: boolean, ganhoPorOutro: boolean, agora = new Date()) {
  if (conquistou) return 'CONQUISTADO';
  if (!d.ativo) return 'ENCERRADO';
  if (ganhoPorOutro) return 'GANHO_POR_OUTRO';
  if (agora < d.inicio) return 'AGENDADO';
  if (agora > d.fim) return 'ENCERRADO';
  return atingido >= d.alvo ? 'CONQUISTADO' : 'EM_ANDAMENTO';
}
