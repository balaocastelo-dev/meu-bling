/**
 * MOTOR DE SITUAÇÕES — réplica dos "módulos de situação" do Bling.
 *
 * Cada módulo (VENDA, COMPRA, OS) tem situações, transições permitidas e
 * ações executadas ao entrar em uma situação (lançar/estornar estoque,
 * lançar/estornar contas, gerar NF-e, notificar cliente...).
 *
 * Os módulos de negócio registram os handlers das ações com `registrarAcao`.
 * A troca de situação é feita por `mudarSituacao`, que:
 *   1. valida a transição (ou exige `forcar` para ADMIN);
 *   2. executa as ações dentro de uma transação;
 *   3. atualiza a entidade e grava o histórico;
 *   4. emite o evento `situacao.alterada` (notificações, etc.).
 */
import { prisma, type Tx } from '../lib/prisma.js';
import { AppError, NotFound } from '../lib/errors.js';
import { parseJsonArray } from '../lib/util.js';
import { eventos } from './eventos.js';

/** ORCAMENTO usa a mesma tabela de vendas (Venda.tipo = ORCAMENTO), com situações próprias e sem ações de estoque/financeiro. */
export type Modulo = 'VENDA' | 'COMPRA' | 'OS' | 'ORCAMENTO';
export type Acao =
  | 'lancarEstoque'
  | 'estornarEstoque'
  | 'lancarContas'
  | 'estornarContas'
  | 'reservarEstoque'
  | 'liberarReserva'
  | 'gerarNfe'
  | 'notificarCliente';

export const ACOES_DISPONIVEIS: { nome: Acao; descricao: string; modulos: Modulo[] }[] = [
  { nome: 'lancarEstoque', descricao: 'Lançar estoque (baixa na venda/OS, entrada na compra)', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'estornarEstoque', descricao: 'Estornar estoque lançado', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'lancarContas', descricao: 'Lançar contas a receber/pagar', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'estornarContas', descricao: 'Cancelar contas lançadas', modulos: ['VENDA', 'COMPRA', 'OS'] },
  { nome: 'reservarEstoque', descricao: 'Reservar estoque dos itens', modulos: ['VENDA', 'OS'] },
  { nome: 'liberarReserva', descricao: 'Liberar reserva de estoque', modulos: ['VENDA', 'OS'] },
  { nome: 'gerarNfe', descricao: 'Gerar NF-e automaticamente', modulos: ['VENDA', 'OS'] },
  { nome: 'notificarCliente', descricao: 'Notificar cliente (e-mail/WhatsApp) com os templates sem situação fixa', modulos: ['VENDA', 'COMPRA', 'OS', 'ORCAMENTO'] },
];

/** Ordem de execução para garantir consistência (estornos antes de lançamentos). */
const ORDEM_ACOES: Acao[] = [
  'estornarContas',
  'estornarEstoque',
  'liberarReserva',
  'reservarEstoque',
  'lancarEstoque',
  'lancarContas',
  'gerarNfe',
  'notificarCliente',
];

export interface ContextoAcao {
  modulo: Modulo;
  entidadeId: number;
  tx: Tx;
  usuarioId: number | null;
  situacaoOrigemId: number | null;
  situacaoDestinoId: number;
}

type Handler = (ctx: ContextoAcao) => Promise<void>;

interface AdaptadorModulo {
  /** retorna situacaoId atual da entidade (ou lança NotFound) */
  obterSituacaoId: (entidadeId: number, tx: Tx) => Promise<number>;
  /** grava a nova situação na entidade */
  gravarSituacao: (entidadeId: number, situacaoId: number, tx: Tx) => Promise<void>;
}

const handlers = new Map<string, Handler>();
const adaptadores = new Map<Modulo, AdaptadorModulo>();

export function registrarAcao(modulo: Modulo, acao: Acao, fn: Handler) {
  handlers.set(`${modulo}:${acao}`, fn);
}

export function registrarModulo(modulo: Modulo, adaptador: AdaptadorModulo) {
  adaptadores.set(modulo, adaptador);
}

export async function situacaoInicial(modulo: Modulo, tx: Tx | typeof prisma = prisma) {
  const s =
    (await tx.situacao.findFirst({ where: { modulo, inicial: true, ativo: true }, orderBy: { ordem: 'asc' } })) ||
    (await tx.situacao.findFirst({ where: { modulo, ativo: true }, orderBy: { ordem: 'asc' } }));
  if (!s) throw new AppError(`Nenhuma situação cadastrada para o módulo ${modulo}. Rode o seed.`, 500);
  return s;
}

export async function situacoesPermitidas(modulo: Modulo, origemId: number) {
  const trans = await prisma.situacaoTransicao.findMany({
    where: { modulo, origemId, ativo: true },
    include: { destino: true },
  });
  return trans.filter((t) => t.destino.ativo).map((t) => t.destino).sort((a, b) => a.ordem - b.ordem);
}

export interface MudarSituacaoParams {
  modulo: Modulo;
  entidadeId: number;
  situacaoDestinoId: number;
  usuarioId: number | null;
  observacao?: string | null;
  /** ADMIN pode forçar transição não cadastrada */
  forcar?: boolean;
  /** ações extras solicitadas manualmente (ex.: botão "lançar estoque") */
  acoesExtras?: Acao[];
}

/**
 * Executa somente ações avulsas (ex.: botão "Lançar estoque" sem trocar situação).
 */
export async function executarAcoes(modulo: Modulo, entidadeId: number, acoes: Acao[], usuarioId: number | null) {
  const adaptador = adaptadores.get(modulo);
  if (!adaptador) throw new AppError(`Módulo ${modulo} não registrado.`, 500);
  await prisma.$transaction(async (tx) => {
    const atual = await adaptador.obterSituacaoId(entidadeId, tx);
    for (const acao of ordenar(acoes)) {
      const h = handlers.get(`${modulo}:${acao}`);
      if (!h) throw new AppError(`Ação "${acao}" não disponível para ${modulo}.`);
      await h({ modulo, entidadeId, tx, usuarioId, situacaoOrigemId: atual, situacaoDestinoId: atual });
    }
  });
}

export async function mudarSituacao(p: MudarSituacaoParams) {
  const adaptador = adaptadores.get(p.modulo);
  if (!adaptador) throw new AppError(`Módulo ${p.modulo} não registrado.`, 500);

  const destino = await prisma.situacao.findUnique({ where: { id: p.situacaoDestinoId } });
  if (!destino || destino.modulo !== p.modulo) throw new NotFound('Situação');

  const resultado = await prisma.$transaction(
    async (tx) => {
      const atualId = await adaptador.obterSituacaoId(p.entidadeId, tx);
      if (atualId === destino.id) {
        return { alterado: false, atualId, acoes: [] as Acao[] };
      }
      const atual = await tx.situacao.findUnique({ where: { id: atualId } });

      const transicao = await tx.situacaoTransicao.findUnique({
        where: { origemId_destinoId: { origemId: atualId, destinoId: destino.id } },
      });
      if ((!transicao || !transicao.ativo) && !p.forcar) {
        const permitidas = await tx.situacaoTransicao.findMany({
          where: { modulo: p.modulo, origemId: atualId, ativo: true },
          include: { destino: true },
        });
        throw new AppError(
          `Transição de "${atual?.nome}" para "${destino.nome}" não é permitida.`,
          422,
          'TRANSICAO_INVALIDA',
          { permitidas: permitidas.map((t) => ({ id: t.destino.id, nome: t.destino.nome })) },
        );
      }

      const acoes = new Set<Acao>([
        ...(parseJsonArray(destino.acoes) as Acao[]),
        ...(transicao ? (parseJsonArray(transicao.acoes) as Acao[]) : []),
        ...(p.acoesExtras || []),
      ]);

      const ctx: ContextoAcao = {
        modulo: p.modulo,
        entidadeId: p.entidadeId,
        tx,
        usuarioId: p.usuarioId,
        situacaoOrigemId: atualId,
        situacaoDestinoId: destino.id,
      };

      for (const acao of ordenar([...acoes])) {
        if (acao === 'notificarCliente') continue; // tratado via evento
        const h = handlers.get(`${p.modulo}:${acao}`);
        if (!h) continue; // ação não suportada pelo módulo: ignora
        await h(ctx);
      }

      await adaptador.gravarSituacao(p.entidadeId, destino.id, tx);
      await tx.historicoSituacao.create({
        data: {
          entidadeTipo: p.modulo,
          entidadeId: p.entidadeId,
          deSituacaoId: atualId,
          deSituacao: atual?.nome ?? null,
          paraSituacaoId: destino.id,
          paraSituacao: destino.nome,
          observacao: p.observacao ?? null,
          usuarioId: p.usuarioId,
        },
      });

      return { alterado: true, atualId, acoes: [...acoes] };
    },
    { timeout: 30000 },
  );

  if (resultado.alterado) {
    eventos.emitir('situacao.alterada', {
      modulo: p.modulo,
      entidadeId: p.entidadeId,
      deSituacaoId: resultado.atualId,
      paraSituacaoId: destino.id,
      notificarCliente: resultado.acoes.includes('notificarCliente'),
      usuarioId: p.usuarioId,
    });
  }
  return { ...resultado, situacao: destino };
}

function ordenar(acoes: Acao[]): Acao[] {
  return [...new Set(acoes)].sort((a, b) => ORDEM_ACOES.indexOf(a) - ORDEM_ACOES.indexOf(b));
}

export async function historico(modulo: Modulo, entidadeId: number) {
  return prisma.historicoSituacao.findMany({
    where: { entidadeTipo: modulo, entidadeId },
    include: { usuario: { select: { id: true, nome: true } } },
    orderBy: { data: 'desc' },
  });
}
