/**
 * Ordens de serviço (assistência técnica) — conforme docs/API.md.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { dataSchema, paginacaoSchema, paginar, proximoNumero, respostaPaginada } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { executarAcoes, mudarSituacao, registrarAcao, registrarModulo, situacaoInicial, type Acao } from '../../core/situacoes.js';
import { idDe, idsQuery, boolQuery } from '../comum/zod.js';
import { intervalo } from '../comum/datas.js';
import { enfileirarNotificacao, variaveisTemplate } from '../comum/notificar.js';
import { enviarNotificacao } from '../notificacoes/service.js';
import {
  acaoEstornarContas,
  acaoEstornarEstoque,
  acaoGerarNfe,
  acaoLancarContas,
  acaoLancarEstoque,
  acaoLiberarReserva,
  acaoReservarEstoque,
  calcularAtrasada,
  CAMPOS_LIVRES_OS,
  carregarOs,
  gerarNfeDaOs,
  verificarNfeDaOs,
  osCompleta,
  osSchema,
  pendenciasCustoOs,
  prepararOs,
  PRIORIDADES,
  resumoSelect,
} from './service.js';
import { pecasSemCustoOs } from '../comum/custos-os.js';
import { arredondar } from '../../lib/util.js';
import { htmlOsCliente, htmlOsEtiqueta, htmlOsTecnico } from './imprimir.js';

registrarModulo('OS', {
  obterSituacaoId: async (id, tx) => {
    const o = await tx.ordemServico.findUnique({ where: { id }, select: { situacaoId: true } });
    if (!o) throw new NotFound('Ordem de serviço');
    return o.situacaoId;
  },
  gravarSituacao: async (id, situacaoId, tx) => {
    const sit = await tx.situacao.findUnique({ where: { id: situacaoId } });
    const data: Record<string, unknown> = { situacaoId };
    if (sit?.final) {
      const os = await tx.ordemServico.findUnique({ where: { id }, select: { dataConclusao: true } });
      if (!os?.dataConclusao) data.dataConclusao = new Date();
      if (/entreg/i.test(sit.nome)) data.dataSaida = new Date();
    }
    await tx.ordemServico.update({ where: { id }, data });
  },
});
registrarAcao('OS', 'lancarEstoque', acaoLancarEstoque);
registrarAcao('OS', 'estornarEstoque', acaoEstornarEstoque);
registrarAcao('OS', 'lancarContas', acaoLancarContas);
registrarAcao('OS', 'estornarContas', acaoEstornarContas);
registrarAcao('OS', 'reservarEstoque', acaoReservarEstoque);
registrarAcao('OS', 'liberarReserva', acaoLiberarReserva);
registrarAcao('OS', 'gerarNfe', acaoGerarNfe);

const NOME_AGUARDANDO_APROVACAO = 'Aguardando aprovação';

/** Linha da lista/kanban: sem os custos (ficam só na OS), com "atrasada" e quantas peças estão sem custo. */
function resumoOs<T extends { dataPrevista: Date | null; situacao: { final: boolean; cancelamento: boolean }; custoPeca: number; itens: { tipo: string; custoUnitario: number }[] }>(o: T) {
  const { custoPeca: _c, itens, ...resto } = o;
  return { ...resto, atrasada: calcularAtrasada(o), pecasSemCusto: pecasSemCustoOs({ custoPeca: o.custoPeca, itens: itens.map((i) => ({ ...i, quantidade: 1 })) }).length };
}

export default async function ordensServicoRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- kanban (antes de /:id)
  app.get('/api/v1/ordens-servico/kanban', async (req) => {
    const q = z
      .object({ tecnicoId: z.coerce.number().int().optional(), diasFinalizadas: z.coerce.number().int().min(0).default(7), dataInicial: dataSchema, dataFinal: dataSchema })
      .parse(req.query);
    // com período: todas as OS que ENTRARAM no período (abertas e finalizadas); sem período: abertas + finalizadas recentes
    const situacoes = await prisma.situacao.findMany({ where: { modulo: 'OS', ativo: true }, orderBy: { ordem: 'asc' } });
    const limite = new Date();
    limite.setDate(limite.getDate() - q.diasFinalizadas);
    const ordens = await prisma.ordemServico.findMany({
      where: {
        tecnicoId: q.tecnicoId,
        situacaoId: { in: situacoes.map((s) => s.id) },
        ...(q.dataInicial || q.dataFinal
          ? { dataEntrada: intervalo(q.dataInicial, q.dataFinal) }
          : { OR: [{ situacao: { final: false, cancelamento: false } }, { atualizadoEm: { gte: limite } }, { dataConclusao: { gte: limite } }] }),
      },
      select: resumoSelect,
      orderBy: [{ prioridade: 'desc' }, { dataPrevista: 'asc' }, { dataEntrada: 'asc' }],
    });
    const pesoPrioridade: Record<string, number> = { URGENTE: 0, ALTA: 1, NORMAL: 2, BAIXA: 3 };
    return situacoes.map((s) => ({
      situacao: { id: s.id, nome: s.nome, cor: s.cor, ordem: s.ordem, final: s.final, cancelamento: s.cancelamento, inicial: s.inicial, sistema: s.sistema },
      ordens: ordens
        .filter((o) => o.situacao.id === s.id)
        .sort((a, b) => (pesoPrioridade[a.prioridade] ?? 9) - (pesoPrioridade[b.prioridade] ?? 9) || (a.dataPrevista?.getTime() ?? Infinity) - (b.dataPrevista?.getTime() ?? Infinity))
        .map(resumoOs),
    }));
  });

  // ---------------------------------------------------------------- etapas do kanban (colunas)
  const corEtapa = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'A cor deve ser no formato #rrggbb');
  const CORES_ETAPA = ['#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4', '#0ea5e9', '#f97316', '#22c55e', '#84cc16', '#ec4899', '#14b8a6'];

  function resumoEtapa(s: { id: number; nome: string; cor: string; ordem: number; final: boolean; cancelamento: boolean; inicial: boolean; sistema: boolean; ativo: boolean }) {
    return { id: s.id, nome: s.nome, cor: s.cor, ordem: s.ordem, final: s.final, cancelamento: s.cancelamento, inicial: s.inicial, sistema: s.sistema, ativo: s.ativo };
  }

  app.post('/api/v1/ordens-servico/colunas', async (req, reply) => {
    const body = z.object({ nome: z.string().trim().min(1, 'Informe o nome da etapa.').max(60), cor: corEtapa.optional() }).parse(req.body);
    const existe = await prisma.situacao.findUnique({ where: { modulo_nome: { modulo: 'OS', nome: body.nome } } });
    if (existe?.ativo) throw new AppError(`Já existe a etapa "${body.nome}".`, 422, 'ETAPA_DUPLICADA');
    if (existe && !existe.ativo) {
      const s = await prisma.situacao.update({ where: { id: existe.id }, data: { ativo: true, ...(body.cor ? { cor: body.cor } : {}) } });
      await auditar(req, 'Situacao', s.id, 'ALTERAR', { reativada: true, nome: s.nome, modulo: 'OS' });
      return reply.code(201).send(resumoEtapa(s));
    }
    const max = await prisma.situacao.aggregate({ where: { modulo: 'OS' }, _max: { ordem: true } });
    const ordem = (max._max.ordem ?? -1) + 1;
    const s = await prisma.situacao.create({
      data: { modulo: 'OS', nome: body.nome, cor: body.cor ?? CORES_ETAPA[ordem % CORES_ETAPA.length]!, ordem, acoes: '[]', ativo: true, sistema: false },
    });
    await auditar(req, 'Situacao', s.id, 'CRIAR', { nome: s.nome, modulo: 'OS' });
    return reply.code(201).send(resumoEtapa(s));
  });

  app.put('/api/v1/ordens-servico/colunas/:id', async (req) => {
    const id = idDe(req);
    const body = z.object({ nome: z.string().trim().min(1, 'Informe o nome da etapa.').max(60).optional(), cor: corEtapa.optional() }).parse(req.body);
    const s = await prisma.situacao.findUnique({ where: { id } });
    if (!s || s.modulo !== 'OS') throw new NotFound('Etapa');
    if (!body.nome && !body.cor) throw new AppError('Informe o nome ou a cor.', 422, 'ETAPA');
    if (body.nome && body.nome !== s.nome) {
      const outra = await prisma.situacao.findUnique({ where: { modulo_nome: { modulo: 'OS', nome: body.nome } } });
      if (outra && outra.id !== id) throw new AppError(`Já existe a etapa "${body.nome}".`, 422, 'ETAPA_DUPLICADA');
    }
    const atualizada = await prisma.situacao.update({ where: { id }, data: { ...(body.nome ? { nome: body.nome } : {}), ...(body.cor ? { cor: body.cor } : {}) } });
    await auditar(req, 'Situacao', id, 'ALTERAR', { de: s.nome, para: atualizada.nome, modulo: 'OS' });
    return resumoEtapa(atualizada);
  });

  app.delete('/api/v1/ordens-servico/colunas/:id', async (req) => {
    const id = idDe(req);
    const s = await prisma.situacao.findUnique({ where: { id } });
    if (!s || s.modulo !== 'OS') throw new NotFound('Etapa');
    if (s.inicial) throw new AppError(`"${s.nome}" é a etapa em que a OS nova entra. Escolha outra etapa inicial antes de remover.`, 422, 'ETAPA_INICIAL');
    const ativas = await prisma.situacao.count({ where: { modulo: 'OS', ativo: true } });
    if (ativas <= 1) throw new AppError('O quadro precisa de pelo menos uma etapa.', 422, 'ETAPA_UNICA');
    const emUso = await prisma.ordemServico.count({ where: { situacaoId: id } });
    if (emUso > 0) throw new AppError(`A etapa "${s.nome}" tem ${emUso} OS. Mova as ordens antes de remover.`, 422, 'ETAPA_EM_USO');
    await prisma.situacao.delete({ where: { id } });
    await auditar(req, 'Situacao', id, 'EXCLUIR', { nome: s.nome, modulo: 'OS' });
    return { ok: true };
  });

  // ---------------------------------------------------------------- listagem
  app.get('/api/v1/ordens-servico', async (req) => {
    const q = paginacaoSchema
      .extend({
        pesquisa: z.string().trim().optional(),
        situacaoId: z.coerce.number().int().optional(),
        situacoes: idsQuery,
        contatoId: z.coerce.number().int().optional(),
        tecnicoId: z.coerce.number().int().optional(),
        vendedorId: z.coerce.number().int().optional(),
        prioridade: z.enum(PRIORIDADES).optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        abertas: boolQuery,
        atrasadas: boolQuery,
        /** só as OS com peça sem custo lançado — a fila de "preencher o custo das OS antigas" */
        semCusto: boolQuery,
      })
      .parse(req.query);
    const where: any = { contatoId: q.contatoId, tecnicoId: q.tecnicoId, vendedorId: q.vendedorId, prioridade: q.prioridade, dataEntrada: intervalo(q.dataInicial, q.dataFinal) };
    if (q.situacaoId) where.situacaoId = q.situacaoId;
    else if (q.situacoes?.length) where.situacaoId = { in: q.situacoes };
    if (q.abertas) where.situacao = { final: false, cancelamento: false };
    if (q.atrasadas) {
      where.situacao = { final: false, cancelamento: false };
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      where.dataPrevista = { lt: hoje };
    }
    if (q.pesquisa) {
      const p = q.pesquisa;
      const n = Number(p);
      const vs = [...new Set([p, p.toUpperCase(), p.toLowerCase()])];
      const or: any[] = vs.flatMap((v) => [{ contato: { nome: { contains: v } } }, { equipamento: { contains: v } }, { marca: { contains: v } }, { modelo: { contains: v } }, { numeroSerie: { contains: v } }, { defeitoRelatado: { contains: v } }]);
      if (Number.isInteger(n) && n > 0) or.push({ numero: n });
      where.OR = or;
    }
    // "Sem custo" precisa olhar item a item (peça sem custo), o que o banco não filtra
    // direto: busca as candidatas (OS sem custo total informado) e filtra na memória.
    if (q.semCusto) {
      const candidatas = await prisma.ordemServico.findMany({
        where: { ...where, custoPeca: { lte: 0 }, itens: { some: { tipo: 'PECA', custoUnitario: { lte: 0 } } } },
        orderBy: [{ dataEntrada: 'desc' }, { numero: 'desc' }],
        select: resumoSelect,
      });
      const comPendencia = candidatas.filter((o) => pecasSemCustoOs({ custoPeca: o.custoPeca, itens: o.itens.map((i) => ({ ...i, quantidade: 1 })) }).length > 0);
      const inicio = (q.pagina - 1) * q.limite;
      return respostaPaginada(comPendencia.slice(inicio, inicio + q.limite).map(resumoOs), comPendencia.length, q);
    }
    const [total, data] = await Promise.all([
      prisma.ordemServico.count({ where }),
      prisma.ordemServico.findMany({ where, ...paginar(q), orderBy: [{ dataEntrada: 'desc' }, { numero: 'desc' }], select: resumoSelect }),
    ]);
    return respostaPaginada(data.map(resumoOs), total, q);
  });

  // lucro/margem do fechamento só para o dono e a gerência; os custos em si ficam visíveis para quem lança
  const comFechamento = (req: { user: { perfil: string } }, os: Awaited<ReturnType<typeof osCompleta>>) => (req.user.perfil === 'ADMIN' || req.user.perfil === 'GERENTE' ? os : { ...os, fechamento: null });
  app.get('/api/v1/ordens-servico/:id', async (req) => comFechamento(req, await osCompleta(idDe(req))));

  // ---------------------------------------------------------------- criar
  app.post('/api/v1/ordens-servico', async (req, reply) => {
    const body = osSchema.parse(req.body);
    if (body.vendedorId === undefined && req.user.vendedorId) body.vendedorId = req.user.vendedorId;
    if (body.tecnicoId === undefined && req.user.tecnicoId) body.tecnicoId = req.user.tecnicoId;
    const os = await prisma.$transaction(async (tx) => {
      const { itens, totalServicos, totalPecas, total, custoTotal, dataEntrada, parcelas } = await prepararOs(tx, body);
      const situacao = body.situacaoId ? await tx.situacao.findFirst({ where: { id: body.situacaoId, modulo: 'OS', ativo: true } }) : await situacaoInicial('OS', tx);
      if (!situacao) throw new AppError('Situação inválida para OS.', 422, 'SITUACAO');
      const numero = await proximoNumero('OS', tx);
      const o = await tx.ordemServico.create({
        data: {
          numero,
          dataEntrada,
          dataPrevista: body.dataPrevista,
          dataConclusao: body.dataConclusao,
          dataSaida: body.dataSaida,
          contatoId: body.contatoId,
          vendedorId: body.vendedorId ?? null,
          tecnicoId: body.tecnicoId ?? null,
          situacaoId: situacao.id,
          depositoId: body.depositoId ?? null,
          categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
          equipamento: body.equipamento ?? null,
          marca: body.marca ?? null,
          modelo: body.modelo ?? null,
          numeroSerie: body.numeroSerie ?? null,
          acessorios: body.acessorios ?? null,
          senhaEquipamento: body.senhaEquipamento ?? null,
          estadoFisico: body.estadoFisico ?? null,
          defeitoRelatado: body.defeitoRelatado ?? null,
          diagnostico: body.diagnostico ?? null,
          servicoExecutado: body.servicoExecutado ?? null,
          observacoes: body.observacoes ?? null,
          observacoesInternas: body.observacoesInternas ?? null,
          prioridade: body.prioridade,
          orcar: body.orcar,
          orcamentoAprovado: body.orcamentoAprovado ?? false,
          totalServicos,
          totalPecas,
          descontoValor: body.descontoValor,
          total,
          custoTotal,
          custoPeca: body.custoPeca,
          custoLogistica: body.custoLogistica,
          custoMaoObraTerceiro: body.custoMaoObraTerceiro,
          garantiaDias: body.garantiaDias,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
      await tx.historicoSituacao.create({ data: { entidadeTipo: 'OS', entidadeId: o.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId: req.user.id, observacao: 'OS criada' } });
      return { ...o, situacaoNome: situacao.nome };
    });
    const sit = await prisma.situacao.findUnique({ where: { id: os.situacaoId } });
    const acoesIniciais = sit ? (JSON.parse(sit.acoes || '[]') as Acao[]).filter((a) => a !== 'notificarCliente') : [];
    if (acoesIniciais.length) await executarAcoes('OS', os.id, acoesIniciais, req.user.id);
    await auditar(req, 'OrdemServico', os.id, 'CRIAR', { numero: os.numero, total: os.total });
    eventos.emitir('os.criada', { osId: os.id, usuarioId: req.user.id });
    if (os.orcar && os.situacaoNome === NOME_AGUARDANDO_APROVACAO) eventos.emitir('os.orcamento', { osId: os.id, usuarioId: req.user.id });
    return reply.code(201).send(comFechamento(req, await osCompleta(os.id)));
  });

  // ---------------------------------------------------------------- alterar
  app.put('/api/v1/ordens-servico/:id', async (req) => {
    const id = idDe(req);
    const atual = await carregarOs(prisma, id);
    const bloqueada = atual.estoqueLancado || atual.contasLancadas;
    if (bloqueada) {
      const parcial = osSchema.partial().parse(req.body);
      const proibidos = Object.keys(req.body as object).filter((k) => !(CAMPOS_LIVRES_OS as readonly string[]).includes(k));
      const alterados = proibidos.filter((k) => {
        if (k === 'itens') {
          // tolera itens idênticos aos atuais
          const novos = parcial.itens || [];
          if (novos.length !== atual.itens.length) return true;
          return novos.some((n, i) => {
            const a = atual.itens[i];
            return (n.produtoId ?? null) !== a.produtoId || n.quantidade !== a.quantidade || n.valorUnitario !== a.valorUnitario || (n.desconto || 0) !== a.desconto || (n.descricao ?? a.descricao) !== a.descricao;
          });
        }
        if (k === 'parcelas') {
          const novas = parcial.parcelas || [];
          if (novas.length !== atual.parcelas.length) return true;
          return novas.some((n, i) => n.valor !== atual.parcelas[i].valor || (n.formaPagamentoId ?? null) !== atual.parcelas[i].formaPagamentoId);
        }
        const novo = (parcial as any)[k];
        const velho = (atual as any)[k];
        if (novo instanceof Date && velho instanceof Date) return novo.getTime() !== velho.getTime();
        return novo !== undefined && novo !== velho && !(novo === null && velho === null) && !(novo === false && velho === false);
      });
      if (alterados.length) {
        throw new AppError(`OS com estoque/contas lançados: itens e valores não podem ser alterados (campos bloqueados: ${alterados.join(', ')}). Estorne antes de editar.`, 422, 'OS_LANCADA', { bloqueados: alterados });
      }
      const data: Record<string, unknown> = {};
      // só o que veio no corpo (o .partial() ainda aplica os defaults do schema e zeraria campos não enviados)
      const enviados = req.body as Record<string, unknown>;
      for (const k of CAMPOS_LIVRES_OS) if (k in enviados && (parcial as any)[k] !== undefined) data[k] = (parcial as any)[k];
      // custo interno de cada peça pode ser lançado/corrigido mesmo com a OS já baixada/lançada (igual à venda)
      const custosItens = (parcial.itens || [])
        .map((n, i) => ({ n, a: atual.itens[i] }))
        .filter(({ n, a }) => a && a.tipo === 'PECA' && n.custoUnitario !== undefined && (n.custoUnitario ?? null) !== (a.custoInformado ? a.custoUnitario : null));
      await prisma.$transaction(async (tx) => {
        if (custosItens.length) {
          const prods = await tx.produto.findMany({ where: { id: { in: custosItens.map(({ a }) => a.produtoId).filter((x): x is number => !!x) } }, select: { id: true, precoCusto: true } });
          const doCadastro = new Map(prods.map((p) => [p.id, p.precoCusto]));
          for (const { n, a } of custosItens) {
            const informado = n.custoUnitario !== null && n.custoUnitario !== undefined;
            await tx.ordemServicoItem.update({ where: { id: a.id }, data: { custoUnitario: informado ? n.custoUnitario! : a.produtoId ? doCadastro.get(a.produtoId) ?? 0 : 0, custoInformado: informado } });
          }
          const itens = await tx.ordemServicoItem.findMany({ where: { osId: id, tipo: 'PECA' }, select: { custoUnitario: true, quantidade: true } });
          data.custoTotal = arredondar(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));
        }
        if (Object.keys(data).length) await tx.ordemServico.update({ where: { id }, data });
      });
      await auditar(req, 'OrdemServico', id, 'ALTERAR', { ...data, ...(custosItens.length ? { custosItens: custosItens.length } : {}) });
      eventos.emitir('os.alterada', { osId: id, usuarioId: req.user.id });
      return comFechamento(req, await osCompleta(id));
    }

    const body = osSchema.parse(mesclarComAtual(atual, req.body as Record<string, unknown>));
    await prisma.$transaction(async (tx) => {
      const { itens, totalServicos, totalPecas, total, custoTotal, dataEntrada, parcelas } = await prepararOs(tx, body);
      // preserva flag estoqueBaixado dos itens iguais (peças parcialmente baixadas sem estoqueLancado geral não existem: ok)
      await tx.ordemServicoItem.deleteMany({ where: { osId: id } });
      await tx.ordemServicoParcela.deleteMany({ where: { osId: id } });
      await tx.ordemServico.update({
        where: { id },
        data: {
          dataEntrada,
          dataPrevista: body.dataPrevista,
          dataConclusao: body.dataConclusao,
          dataSaida: body.dataSaida,
          contatoId: body.contatoId,
          vendedorId: body.vendedorId ?? null,
          tecnicoId: body.tecnicoId ?? null,
          depositoId: body.depositoId ?? null,
          categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
          equipamento: body.equipamento ?? null,
          marca: body.marca ?? null,
          modelo: body.modelo ?? null,
          numeroSerie: body.numeroSerie ?? null,
          acessorios: body.acessorios ?? null,
          senhaEquipamento: body.senhaEquipamento ?? null,
          estadoFisico: body.estadoFisico ?? null,
          defeitoRelatado: body.defeitoRelatado ?? null,
          diagnostico: body.diagnostico ?? null,
          servicoExecutado: body.servicoExecutado ?? null,
          observacoes: body.observacoes ?? null,
          observacoesInternas: body.observacoesInternas ?? null,
          prioridade: body.prioridade,
          orcar: body.orcar,
          orcamentoAprovado: body.orcamentoAprovado ?? atual.orcamentoAprovado,
          totalServicos,
          totalPecas,
          descontoValor: body.descontoValor,
          total,
          custoTotal,
          custoPeca: body.custoPeca,
          custoLogistica: body.custoLogistica,
          custoMaoObraTerceiro: body.custoMaoObraTerceiro,
          garantiaDias: body.garantiaDias,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
      // refaz reserva se houver
      const ctx = { modulo: 'OS' as const, entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: atual.situacaoId, situacaoDestinoId: atual.situacaoId };
      const tinhaReserva = (await tx.movimentoEstoque.count({ where: { origemTipo: 'OS', origemId: id, tipo: 'RESERVA' } })) > 0;
      if (tinhaReserva) {
        await acaoLiberarReserva(ctx);
        await acaoReservarEstoque(ctx);
      }
    });
    await auditar(req, 'OrdemServico', id, 'ALTERAR', { itens: body.itens.length });
    const osAtualizada = await osCompleta(id);
    if (body.orcar && !atual.orcar && osAtualizada.situacao.nome === NOME_AGUARDANDO_APROVACAO) eventos.emitir('os.orcamento', { osId: id, usuarioId: req.user.id });
    eventos.emitir('os.alterada', { osId: id, usuarioId: req.user.id });
    return comFechamento(req, osAtualizada);
  });

  // ---------------------------------------------------------------- excluir
  app.delete('/api/v1/ordens-servico/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    const os = await prisma.ordemServico.findUnique({ where: { id }, include: { nota: true, anexos: true } });
    if (!os) throw new NotFound('Ordem de serviço');
    if (os.estoqueLancado || os.contasLancadas) throw new AppError('OS com estoque/contas lançados não pode ser excluída. Estorne (ou cancele) antes.', 422, 'OS_LANCADA');
    if (os.nota && os.nota.situacao === 'AUTORIZADA') throw new AppError('OS com NF-e autorizada não pode ser excluída.', 422, 'NOTA_AUTORIZADA');
    await prisma.$transaction(async (tx) => {
      await acaoLiberarReserva({ modulo: 'OS', entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: os.situacaoId, situacaoDestinoId: os.situacaoId });
      await tx.comissao.deleteMany({ where: { osId: id, status: { not: 'PAGA' } } });
      await tx.historicoSituacao.deleteMany({ where: { entidadeTipo: 'OS', entidadeId: id } });
      if (os.notaId) {
        await tx.ordemServico.update({ where: { id }, data: { notaId: null } });
        if (os.nota && os.nota.situacao === 'PENDENTE') await tx.notaFiscal.delete({ where: { id: os.notaId } });
      }
      await tx.ordemServico.delete({ where: { id } });
    });
    await fs.rm(path.join(env.STORAGE_DIR, 'anexos', `os-${id}`), { recursive: true, force: true }).catch(() => {});
    await auditar(req, 'OrdemServico', id, 'EXCLUIR', { numero: os.numero });
    return { ok: true };
  });

  // ---------------------------------------------------------------- situação / ações
  app.post('/api/v1/ordens-servico/:id/situacao', async (req) => {
    const id = idDe(req);
    const body = z
      .object({ situacaoId: z.coerce.number().int().positive(), observacao: z.string().trim().nullable().optional(), forcar: z.boolean().optional(), confirmarCusto: z.boolean().optional() })
      .parse(req.body);
    // No quadro da assistência a OS vai de qualquer etapa para qualquer outra. O histórico continua sendo gravado.
    // `forcar` do cliente deixa de ser uma permissão especial: o pulo de etapa é o comportamento normal.
    // LEMBRETE NO FECHAMENTO: ao concluir/entregar a OS com peça sem custo, a tela pergunta antes
    // ("Preencher agora" ou "Fechar assim mesmo"). Não trava: com confirmarCusto a OS fecha e o Robô da Saúde
    // continua lembrando o técnico até o custo entrar (DRE e dashboards precisam do custo real).
    if (!body.confirmarCusto) {
      const destino = await prisma.situacao.findUnique({ where: { id: body.situacaoId }, select: { modulo: true, final: true, cancelamento: true, nome: true } });
      if (destino?.modulo === 'OS' && destino.final && !destino.cancelamento) {
        const os = await prisma.ordemServico.findUnique({ where: { id }, select: { numero: true, situacaoId: true, custoPeca: true, itens: { select: { tipo: true, descricao: true, custoUnitario: true, quantidade: true } } } });
        if (!os) throw new NotFound('Ordem de serviço');
        const pend = os.situacaoId === body.situacaoId ? [] : pendenciasCustoOs(os);
        if (pend.length) {
          throw new AppError(`Antes de marcar a OS nº ${os.numero} como "${destino.nome}": ${pend.map((p) => p.mensagem.replace(/\.$/, '')).join('; ')}. Preencha o custo (ou feche assim mesmo e preencha depois).`, 422, 'OS_CUSTO_PENDENTE', { pendencias: pend, osId: id, numero: os.numero });
        }
      }
    }
    const destinoLivre = await prisma.situacao.findFirst({ where: { id: body.situacaoId, modulo: 'OS', ativo: true }, select: { id: true } });
    if (!destinoLivre) throw new AppError('Etapa inválida para ordens de serviço.', 422, 'SITUACAO');
    const r = await mudarSituacao({ modulo: 'OS', entidadeId: id, situacaoDestinoId: body.situacaoId, usuarioId: req.user.id, observacao: body.observacao, forcar: true });
    await auditar(req, 'OrdemServico', id, 'SITUACAO', { para: r.situacao.nome, acoes: r.acoes });
    if (r.alterado && r.situacao.nome === NOME_AGUARDANDO_APROVACAO) {
      const os = await prisma.ordemServico.findUnique({ where: { id }, select: { orcar: true } });
      if (os?.orcar) eventos.emitir('os.orcamento', { osId: id, usuarioId: req.user.id });
    }
    return { situacao: { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor }, acoesExecutadas: r.acoes, alterado: r.alterado };
  });

  app.post('/api/v1/ordens-servico/:id/acoes', async (req) => {
    const id = idDe(req);
    const body = z.object({ acoes: z.array(z.enum(['lancarEstoque', 'estornarEstoque', 'lancarContas', 'estornarContas', 'reservarEstoque', 'liberarReserva', 'gerarNfe'])).min(1) }).parse(req.body);
    await executarAcoes('OS', id, body.acoes as Acao[], req.user.id);
    await auditar(req, 'OrdemServico', id, 'ACAO', { acoes: body.acoes });
    return { acoesExecutadas: body.acoes, os: comFechamento(req, await osCompleta(id)) };
  });

  // ---------------------------------------------------------------- aprovar orçamento
  app.post('/api/v1/ordens-servico/:id/aprovar-orcamento', async (req) => {
    const id = idDe(req);
    const body = z.object({ aprovadoPor: z.string().trim().nullable().optional(), observacao: z.string().trim().nullable().optional() }).parse(req.body || {});
    const os = await prisma.ordemServico.findUnique({ where: { id }, include: { situacao: true } });
    if (!os) throw new NotFound('Ordem de serviço');
    await prisma.ordemServico.update({
      where: { id },
      data: { orcar: true, orcamentoAprovado: true, orcamentoAprovadoEm: new Date(), orcamentoAprovadoPor: body.aprovadoPor || req.user.nome },
    });
    let mudou: { id: number; nome: string; cor: string } | null = null;
    const aprovada = await prisma.situacao.findFirst({ where: { modulo: 'OS', nome: 'Aprovada', ativo: true } });
    if (aprovada && aprovada.id !== os.situacaoId) {
      const transicao = await prisma.situacaoTransicao.findUnique({ where: { origemId_destinoId: { origemId: os.situacaoId, destinoId: aprovada.id } } });
      if (transicao?.ativo) {
        const r = await mudarSituacao({ modulo: 'OS', entidadeId: id, situacaoDestinoId: aprovada.id, usuarioId: req.user.id, observacao: body.observacao || `Orçamento aprovado por ${body.aprovadoPor || req.user.nome}` });
        mudou = { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor };
      }
    }
    await auditar(req, 'OrdemServico', id, 'ACAO', { acao: 'aprovarOrcamento', aprovadoPor: body.aprovadoPor });
    return { ok: true, orcamentoAprovado: true, situacao: mudou, os: comFechamento(req, await osCompleta(id)) };
  });

  // ---------------------------------------------------------------- anexos
  app.post('/api/v1/ordens-servico/:id/anexos', async (req, reply) => {
    const id = idDe(req);
    const os = await prisma.ordemServico.findUnique({ where: { id }, select: { id: true } });
    if (!os) throw new NotFound('Ordem de serviço');
    const dir = path.join(env.STORAGE_DIR, 'anexos', `os-${id}`);
    await fs.mkdir(dir, { recursive: true });
    const criados = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (!buf.length) continue;
      const original = path.basename(part.filename || 'anexo');
      const ext = path.extname(original).toLowerCase();
      const base = original.replace(ext, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'anexo';
      const nomeArquivo = `${Date.now()}-${base}${ext}`;
      await fs.writeFile(path.join(dir, nomeArquivo), buf);
      const a = await prisma.ordemServicoAnexo.create({ data: { osId: id, nome: original, caminho: nomeArquivo, mime: part.mimetype, tamanho: buf.length } });
      criados.push({ id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho, url: `/uploads/anexos/os-${id}/${nomeArquivo}` });
    }
    if (!criados.length) throw new AppError('Envie ao menos um arquivo.', 400, 'SEM_ARQUIVO');
    await auditar(req, 'OrdemServico', id, 'ALTERAR', { anexos: criados.map((c) => c.nome) });
    return reply.code(201).send(criados.length === 1 ? criados[0] : criados);
  });

  app.delete('/api/v1/ordens-servico/:id/anexos/:anexoId', async (req) => {
    const id = idDe(req);
    const anexoId = idDe(req, 'anexoId');
    const a = await prisma.ordemServicoAnexo.findFirst({ where: { id: anexoId, osId: id } });
    if (!a) throw new NotFound('Anexo');
    await prisma.ordemServicoAnexo.delete({ where: { id: anexoId } });
    await fs.unlink(path.join(env.STORAGE_DIR, 'anexos', `os-${id}`, a.caminho)).catch(() => {});
    await auditar(req, 'OrdemServico', id, 'ALTERAR', { anexoRemovido: a.nome });
    return { ok: true };
  });

  // ---------------------------------------------------------------- imprimir
  app.get('/api/v1/ordens-servico/:id/imprimir', async (req, reply) => {
    const q = z.object({ via: z.enum(['cliente', 'tecnico', 'etiqueta']).default('cliente') }).parse(req.query);
    const os = await carregarOs(prisma, idDe(req));
    const html = q.via === 'tecnico' ? await htmlOsTecnico(os) : q.via === 'etiqueta' ? await htmlOsEtiqueta(os) : await htmlOsCliente(os);
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---------------------------------------------------------------- notificar
  app.post('/api/v1/ordens-servico/:id/notificar', async (req, reply) => {
    const id = idDe(req);
    const body = z
      .object({ canal: z.enum(['EMAIL', 'WHATSAPP']), templateId: z.coerce.number().int().positive().nullable().optional(), mensagem: z.string().nullable().optional(), assunto: z.string().nullable().optional() })
      .parse(req.body);
    const os = await carregarOs(prisma, id);
    const vars = await variaveisTemplate({
      tipo: 'OS',
      id: os.id,
      numero: os.numero,
      situacao: os.situacao.nome,
      total: os.total,
      data: os.dataEntrada,
      contato: os.contato,
      itens: os.itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, total: i.total })),
      vendedor: os.vendedor?.nome,
      tecnico: os.tecnico?.nome,
      equipamento: [os.equipamento, os.marca, os.modelo].filter(Boolean).join(' '),
      defeito: os.defeitoRelatado,
      diagnostico: os.diagnostico,
      garantiaDias: os.garantiaDias,
    });
    const n = await enfileirarNotificacao({ canal: body.canal, templateId: body.templateId, mensagem: body.mensagem, assunto: body.assunto, origemTipo: 'OS', origemId: os.id, contatoId: os.contatoId, contato: os.contato, vars });
    // envia agora (ver vendas/routes.ts): a tela diz na hora se saiu ou por que não saiu
    const envio = await enviarNotificacao({ ...n, tentativas: 0 }).catch(() => ({ status: 'PENDENTE' as const, erro: 'Falha inesperada no envio' }));
    await auditar(req, 'OrdemServico', id, 'ACAO', { acao: 'notificar', canal: body.canal, notificacaoId: n.id, envio: envio.status });
    return reply.code(201).send({ ...n, status: envio.status, erro: envio.erro });
  });

  // ---------------------------------------------------------------- NF-e das peças
  app.get('/api/v1/ordens-servico/:id/nfe/verificar', async (req) => {
    const modelo = Number((req.query as any)?.modelo) === 65 ? 65 : 55;
    return verificarNfeDaOs(prisma, idDe(req), modelo);
  });

  app.post('/api/v1/ordens-servico/:id/gerar-nfe', async (req, reply) => {
    const id = idDe(req);
    const body = z
      .object({ modelo: z.coerce.number().int().refine((v) => v === 55 || v === 65, 'modelo deve ser 55 ou 65').default(55), informacoesComplementares: z.string().trim().nullable().optional() })
      .parse(req.body || {});
    const nota = await prisma.$transaction((tx) => gerarNfeDaOs(tx, id, body.modelo as 55 | 65, body.informacoesComplementares));
    await auditar(req, 'OrdemServico', id, 'ACAO', { acao: 'gerarNfe', notaId: nota.id });
    return reply.code(201).send({ notaId: nota.id, numero: nota.numero, serie: nota.serie, modelo: nota.modelo, situacao: nota.situacao });
  });
}

/** Body completo do PUT a partir da OS atual + campos enviados (permite PUT parcial). */
function mesclarComAtual(atual: Awaited<ReturnType<typeof carregarOs>>, body: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    contatoId: atual.contatoId,
    vendedorId: atual.vendedorId,
    tecnicoId: atual.tecnicoId,
    depositoId: atual.depositoId,
    categoriaFinanceiraId: atual.categoriaFinanceiraId,
    dataEntrada: atual.dataEntrada,
    dataPrevista: atual.dataPrevista,
    dataConclusao: atual.dataConclusao,
    dataSaida: atual.dataSaida,
    equipamento: atual.equipamento,
    marca: atual.marca,
    modelo: atual.modelo,
    numeroSerie: atual.numeroSerie,
    acessorios: atual.acessorios,
    senhaEquipamento: atual.senhaEquipamento,
    estadoFisico: atual.estadoFisico,
    defeitoRelatado: atual.defeitoRelatado,
    diagnostico: atual.diagnostico,
    servicoExecutado: atual.servicoExecutado,
    observacoes: atual.observacoes,
    observacoesInternas: atual.observacoesInternas,
    prioridade: atual.prioridade,
    orcar: atual.orcar,
    orcamentoAprovado: atual.orcamentoAprovado,
    descontoValor: atual.descontoValor,
    custoPeca: atual.custoPeca,
    custoLogistica: atual.custoLogistica,
    custoMaoObraTerceiro: atual.custoMaoObraTerceiro,
    garantiaDias: atual.garantiaDias,
    itens: atual.itens.map((i) => ({ tipo: i.tipo, produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, custoUnitario: i.custoInformado ? i.custoUnitario : null, comissaoVendedorPct: i.comissaoVendedorPct, comissaoTecnicoPct: i.comissaoTecnicoPct, depositoId: i.depositoId })),
    parcelas: atual.parcelas.map((p) => ({ dataVencimento: p.dataVencimento, valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes })),
  };
  const { situacaoId: _s, ...resto } = body;
  for (const [k, v] of Object.entries(resto)) if (v !== undefined) base[k] = v;
  const mudaTotal = ['itens', 'descontoValor'].some((k) => resto[k] !== undefined);
  if (mudaTotal && resto.parcelas === undefined) base.parcelas = [];
  return base;
}
