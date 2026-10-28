/**
 * ROBÔ DE NF — roda 24h dentro da API.
 *
 * Para cada venda (pedido) ainda sem NF autorizada:
 *  1. completa o cadastro do cliente (CEP, CNPJ, código IBGE, indicador de IE);
 *  2. completa o NCM dos produtos (histórico de notas → mesmo nome → regras por tipo de produto);
 *  3. roda o MESMO checklist da emissão (verificarNfe, modelo 55) e grava o resultado:
 *       PRONTA   → acende o botão "Pronto pra NF" no pedido;
 *       PENDENTE → mostra só o que o robô não conseguiu resolver, com o link de onde corrigir.
 *
 * A emissão continua sendo decisão de gente: o robô prepara, alguém aperta "Emitir".
 * Quando: logo depois de criar/editar a venda (com uma folga de alguns segundos), quando muda
 * a situação, quando a nota é autorizada/cancelada, e numa varredura a cada 5 minutos.
 */
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/auditoria.js';
import { verificarNfe, type PendenciaNfe } from '../comum/nfe-checagem.js';
import { completarCliente } from './cliente.js';
import { formatarNcm, ncmValido, sugerirNcm } from './ncm.js';

export type StatusRobo = 'PRONTA' | 'PENDENTE' | 'EMITIDA' | 'IGNORADA';

export interface EstadoRobo {
  vendaId: number;
  status: StatusRobo;
  erros: number;
  avisos: number;
  pendencias: PendenciaNfe[];
  preenchido: string[];
  verificadoEm: Date;
  /** texto curto para a tela */
  resumo: string;
}

/** só a varredura olha vendas destes últimos dias (as antigas são conferidas quando alguém abre) */
export const DIAS_VARREDURA = 60;
/** PENDENTE é conferida de novo depois deste tempo mesmo sem mudança (alguém pode ter corrigido o cadastro) */
const RECONFERIR_PENDENTE_MS = 20 * 60_000;
const RECONFERIR_PRONTA_MS = 6 * 60 * 60_000;
const MAX_PREENCHIDO = 40;

const parse = <T>(s: string | null | undefined, padrao: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : padrao;
  } catch {
    return padrao;
  }
};

function resumoDe(status: StatusRobo, erros: number): string {
  if (status === 'PRONTA') return 'Pronto pra NF';
  if (status === 'EMITIDA') return 'NF emitida';
  if (status === 'IGNORADA') return 'Sem NF (orçamento, cancelada ou só serviço)';
  return `Falta${erros > 1 ? 'm' : ''} ${erros} ite${erros > 1 ? 'ns' : 'm'} pra NF`;
}

export function estadoDoRegistro(r: { vendaId: number; status: string; erros: number; avisos: number; pendencias: string | null; preenchido: string | null; verificadoEm: Date }): EstadoRobo {
  const status = r.status as StatusRobo;
  return {
    vendaId: r.vendaId,
    status,
    erros: r.erros,
    avisos: r.avisos,
    pendencias: parse<PendenciaNfe[]>(r.pendencias, []),
    preenchido: parse<string[]>(r.preenchido, []),
    verificadoEm: r.verificadoEm,
    resumo: resumoDe(status, r.erros),
  };
}

/** NCM dos produtos da venda: preenche o que falta. Devolve o que foi feito. */
async function completarProdutos(produtoIds: number[]): Promise<string[]> {
  if (!produtoIds.length) return [];
  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtoIds }, tipo: 'P' },
    select: { id: true, nome: true, ncm: true, ncmOrigem: true, categoria: { select: { nome: true } } },
  });
  const feito: string[] = [];
  for (const p of produtos) {
    if (ncmValido(p.ncm)) continue; // já tem NCM: o robô nunca troca
    const s = await sugerirNcm(prisma, p);
    if (!s) continue;
    await prisma.produto.update({ where: { id: p.id }, data: { ncm: s.ncm, ncmOrigem: s.origem } });
    feito.push(
      s.origem === 'HISTORICO'
        ? `Produto ${p.nome} — NCM ${formatarNcm(s.ncm)} (${s.motivo})`
        : `Produto ${p.nome} — NCM ${formatarNcm(s.ncm)} SUGERIDO ${s.motivo}: falta confirmar`,
    );
  }
  return feito;
}

/** Confere uma venda agora (preenche o que dá e grava o estado). Nunca lança erro de negócio. */
export async function conferirVenda(vendaId: number, opts: { preencher?: boolean } = {}): Promise<EstadoRobo | null> {
  const venda = await prisma.venda.findUnique({
    where: { id: vendaId },
    include: {
      situacao: { select: { cancelamento: true } },
      nota: { select: { id: true, numero: true, situacao: true } },
      itens: { orderBy: { ordem: 'asc' }, select: { produtoId: true, descricao: true, produto: { select: { tipo: true } } } },
      roboNf: true,
    },
  });
  if (!venda) return null;

  let status: StatusRobo | null = null;
  let pendencias: PendenciaNfe[] = [];
  let erros = 0;
  let avisos = 0;
  const feitoAgora: string[] = [];

  if (venda.tipo !== 'PEDIDO' || venda.situacao.cancelamento) status = 'IGNORADA';
  else if (venda.nota?.situacao === 'AUTORIZADA') status = 'EMITIDA';
  else if (venda.itens.length && venda.itens.every((i) => i.produtoId && i.produto?.tipo === 'S')) status = 'IGNORADA';

  if (!status) {
    if (opts.preencher !== false) {
      try {
        feitoAgora.push(...(await completarCliente(prisma, venda.contatoId)));
      } catch (e) {
        console.error('[robo-nf] falha ao completar cliente', vendaId, e);
      }
      try {
        feitoAgora.push(...(await completarProdutos([...new Set(venda.itens.map((i) => i.produtoId).filter((x): x is number => !!x))])));
      } catch (e) {
        console.error('[robo-nf] falha ao completar produtos', vendaId, e);
      }
    }
    const checagem = await verificarNfe(prisma, {
      modelo: 55,
      contatoId: venda.contatoId,
      itens: venda.itens.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao })),
      origem: { tipo: 'VENDA', id: venda.id, numero: venda.numero, notaExistente: venda.nota },
    });
    // nota já gerada mas não autorizada (rejeitada/pendente): pode ser reenviada pelo botão Emitir
    pendencias = checagem.pendencias.filter((p) => p.codigo !== 'NOTA_EXISTENTE' || !['PENDENTE', 'REJEITADA', 'ERRO'].includes(venda.nota?.situacao || ''));
    erros = pendencias.filter((p) => p.nivel === 'erro').length;
    avisos = pendencias.length - erros;
    status = erros === 0 ? 'PRONTA' : 'PENDENTE';
  }

  const preenchido = [...feitoAgora, ...parse<string[]>(venda.roboNf?.preenchido, [])].slice(0, MAX_PREENCHIDO);
  const dados = {
    status,
    erros,
    avisos,
    pendencias: JSON.stringify(pendencias),
    preenchido: JSON.stringify(preenchido),
    vendaAtualizadaEm: venda.atualizadoEm,
    verificadoEm: new Date(),
  };
  const reg = await prisma.vendaRoboNf.upsert({ where: { vendaId }, create: { vendaId, ...dados }, update: dados });

  if (feitoAgora.length) await auditar(null, 'Venda', vendaId, 'ACAO', { acao: 'roboNf', preenchido: feitoAgora });
  if (venda.roboNf?.status !== status && status === 'PRONTA') console.log(`[robo-nf] venda nº ${venda.numero} pronta pra NF`);
  return estadoDoRegistro(reg);
}

/** Estado gravado; se estiver velho (venda mudou ou passou o tempo), confere de novo na hora. */
export async function estadoAtual(vendaId: number): Promise<EstadoRobo | null> {
  const v = await prisma.venda.findUnique({ where: { id: vendaId }, select: { atualizadoEm: true, roboNf: true } });
  if (!v) return null;
  const r = v.roboNf;
  const velho = !r || r.vendaAtualizadaEm.getTime() !== v.atualizadoEm.getTime() || Date.now() - r.verificadoEm.getTime() > 60_000;
  return velho ? conferirVenda(vendaId) : estadoDoRegistro(r);
}

// ---------------------------------------------------------------- fila (evita conferir a mesma venda 5x seguidas)
const fila = new Map<number, NodeJS.Timeout>();
const FOLGA_MS = 8_000;

export function agendarConferencia(vendaId: number, folgaMs = FOLGA_MS) {
  const t = fila.get(vendaId);
  if (t) clearTimeout(t);
  fila.set(
    vendaId,
    setTimeout(() => {
      fila.delete(vendaId);
      conferirVenda(vendaId).catch((e) => console.error('[robo-nf] erro ao conferir venda', vendaId, e));
    }, folgaMs),
  );
}

let varrendo = false;
export let ultimaVarredura: { em: Date; conferidas: number; prontas: number; pendentes: number } | null = null;

/** Varredura: confere as vendas dos últimos dias que mudaram ou estão com o estado velho. */
export async function varrer(limite = 300) {
  if (varrendo) return ultimaVarredura;
  varrendo = true;
  try {
    const desde = new Date(Date.now() - DIAS_VARREDURA * 86400_000);
    const vendas = await prisma.venda.findMany({
      where: { tipo: 'PEDIDO', data: { gte: desde }, OR: [{ notaId: null }, { nota: { situacao: { not: 'AUTORIZADA' } } }] },
      select: { id: true, atualizadoEm: true, roboNf: { select: { status: true, vendaAtualizadaEm: true, verificadoEm: true } } },
      orderBy: { id: 'desc' },
    });
    const agora = Date.now();
    const alvo = vendas
      .filter((v) => {
        const r = v.roboNf;
        if (!r) return true;
        if (r.vendaAtualizadaEm.getTime() !== v.atualizadoEm.getTime()) return true;
        const idade = agora - r.verificadoEm.getTime();
        if (r.status === 'PENDENTE') return idade > RECONFERIR_PENDENTE_MS;
        if (r.status === 'PRONTA') return idade > RECONFERIR_PRONTA_MS;
        return false;
      })
      .slice(0, limite);
    let prontas = 0;
    let pendentes = 0;
    for (const v of alvo) {
      try {
        const e = await conferirVenda(v.id);
        if (e?.status === 'PRONTA') prontas++;
        if (e?.status === 'PENDENTE') pendentes++;
      } catch (e) {
        console.error('[robo-nf] erro na varredura, venda', v.id, e);
      }
    }
    ultimaVarredura = { em: new Date(), conferidas: alvo.length, prontas, pendentes };
    return ultimaVarredura;
  } finally {
    varrendo = false;
  }
}

/** Números para o painel do robô. */
export async function painel() {
  const desde = new Date(Date.now() - DIAS_VARREDURA * 86400_000);
  const grupos = await prisma.vendaRoboNf.groupBy({ by: ['status'], where: { venda: { data: { gte: desde } } }, _count: { _all: true } });
  const contagem = Object.fromEntries(grupos.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const ncmSugeridos = await prisma.produto.count({ where: { ncmOrigem: 'SUGERIDO' } });
  return {
    prontas: contagem.PRONTA || 0,
    pendentes: contagem.PENDENTE || 0,
    emitidas: contagem.EMITIDA || 0,
    ncmParaConfirmar: ncmSugeridos,
    ultimaVarredura,
    diasVarredura: DIAS_VARREDURA,
  };
}
