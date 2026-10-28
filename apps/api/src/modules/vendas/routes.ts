/**
 * Vendas (pedidos) e orçamentos — módulo completo conforme docs/API.md.
 * Orçamento = Venda com tipo ORCAMENTO: numeração e situações próprias (módulo ORCAMENTO do motor),
 * nunca movimenta estoque/financeiro nem emite nota; "converter" gera a venda vinculada.
 */
import type { FastifyInstance } from 'fastify';
import { criarLinkPagamento } from '../../integracoes/mercadopago/link.js';
import { z } from 'zod';
import { previaCarneVenda } from '../carnes/service.js';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar, dataSchema, paginar, proximoNumero, respostaPaginada } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { vendedorDoUsuario } from '../comum/vendedores.js';
import { executarAcoes, mudarSituacao, registrarAcao, registrarModulo, situacaoInicial, type Acao } from '../../core/situacoes.js';
import { idDe } from '../comum/zod.js';
import { intervalo, hojeMeioDia } from '../comum/datas.js';
import { enfileirarNotificacao, variaveisTemplate } from '../comum/notificar.js';
import {
  acaoEstornarContas,
  acaoEstornarEstoque,
  acaoGerarNfe,
  acaoLancarContas,
  acaoLancarEstoque,
  acaoLiberarReserva,
  acaoReservarEstoque,
  aprovarOrcamento,
  carregarVenda,
  converterOrcamento,
  copiarVenda,
  criarVenda,
  exigirPedido,
  gerarNfeDaVenda,
  verificarNfeDaVenda,
  gerarParcelas,
  includeLista,
  moduloDe,
  prepararVenda,
  sequenciaDe,
  temReserva,
  transferirVendedor,
  receberVendaPagaNaHora,
  soRecebimentoAutomatico,
  vendaCompleta,
  consumidorFinalId,
  exigirVendaCompleta,
  mensagemFinalizacao,
  pendenciasFinalizacao,
  situacaoFinalizar,
  compraDaVenda,
  parcelasParaFinalizar,
  formasParaFinalizar,
  aplicarRecebimentosFinalizacao,
  validarRecebimentosFinalizacao,
  registrarCompraDaVenda,
} from './service.js';
import { acoesBody, aprovarBody, CAMPOS_LIVRES, converterBody, gerarNfeBody, gerarParcelasBody, listaQuery, notificarBody, situacaoBody, transferirVendedorBody, vendaSchema } from './schemas.js';
import { htmlVenda } from './imprimir.js';
import { gravarPdfVenda, nomeArquivoPdf, pdfVenda } from './pdf.js';

// ---------------------------------------------------------------- motor de situações
const adaptadorVenda = {
  obterSituacaoId: async (id: number, tx: any) => {
    const v = await tx.venda.findUnique({ where: { id }, select: { situacaoId: true } });
    if (!v) throw new NotFound('Venda');
    return v.situacaoId as number;
  },
  gravarSituacao: async (id: number, situacaoId: number, tx: any) => {
    await tx.venda.update({ where: { id }, data: { situacaoId } });
  },
};
registrarModulo('VENDA', adaptadorVenda);
// orçamento: mesma tabela, situações próprias e nenhuma ação de estoque/financeiro registrada
registrarModulo('ORCAMENTO', adaptadorVenda);
registrarAcao('VENDA', 'lancarEstoque', acaoLancarEstoque);
registrarAcao('VENDA', 'estornarEstoque', acaoEstornarEstoque);
registrarAcao('VENDA', 'lancarContas', acaoLancarContas);
registrarAcao('VENDA', 'estornarContas', acaoEstornarContas);
registrarAcao('VENDA', 'reservarEstoque', acaoReservarEstoque);
registrarAcao('VENDA', 'liberarReserva', acaoLiberarReserva);
registrarAcao('VENDA', 'gerarNfe', acaoGerarNfe);

// NF-e autorizada → venda vai para "NF emitida"; NF-e cancelada → volta para "Fechada" (quando essas situações existem)
async function moverVendaPorNota(notaId: number, destinoNome: 'NF emitida' | 'Fechada', observacao: string) {
  const venda = await prisma.venda.findFirst({ where: { notaId }, include: { situacao: true } });
  if (!venda) return;
  const destino = await prisma.situacao.findFirst({ where: { modulo: 'VENDA', nome: destinoNome, ativo: true } });
  if (!destino || venda.situacaoId === destino.id) return;
  if (destinoNome === 'NF emitida' && venda.situacao.cancelamento) return;
  if (destinoNome === 'Fechada' && venda.situacao.nome !== 'NF emitida') return;
  await mudarSituacao({ modulo: 'VENDA', entidadeId: venda.id, situacaoDestinoId: destino.id, usuarioId: null, observacao, forcar: true });
}
eventos.ouvir('nfe.autorizada', (d) => moverVendaPorNota(d.notaId, 'NF emitida', 'Automático: NF-e autorizada'));
eventos.ouvir('nfe.cancelada', (d) => moverVendaPorNota(d.notaId, 'Fechada', 'Automático: NF-e cancelada'));
// venda paga na hora (dinheiro/PIX/cartão/transferência) entra no caixa ao salvar — vale para tela, PDV, API e clonagem
eventos.ouvir('venda.alterada', async (d) => {
  if (d.tipo !== 'PEDIDO') return;
  await prisma.$transaction((tx) => receberVendaPagaNaHora(tx, d.vendaId));
});

/**
 * Resumo do que a lista está mostrando (painel à direita do filtro): total vendido, nº de vendas,
 * ticket médio e vendedor destaque. Canceladas ficam de fora, a menos que a pessoa tenha escolhido
 * as situações no filtro (aí vale exatamente o que ela escolheu).
 * VENDEDOR vê o nome do destaque, mas o valor dele só se o destaque for ele mesmo (mesma regra do ranking).
 */
async function resumoLista(where: any, filtrouSituacao: boolean, usuario: { perfil?: string; vendedorId?: number | null }) {
  const w = { ...where };
  let canceladas = 0;
  if (!filtrouSituacao) {
    const sitCanc = (await prisma.situacao.findMany({ where: { modulo: { in: ['VENDA', 'ORCAMENTO'] }, cancelamento: true }, select: { id: true } })).map((x) => x.id);
    if (sitCanc.length) {
      w.situacaoId = { notIn: sitCanc };
      canceladas = await prisma.venda.count({ where: { ...where, situacaoId: { in: sitCanc } } });
    }
  }
  const grupos = await prisma.venda.groupBy({ by: ['vendedorId'], where: w, _sum: { total: true }, _count: { _all: true } });
  const valor = grupos.reduce((t, g) => t + (g._sum.total || 0), 0);
  const quantidade = grupos.reduce((t, g) => t + g._count._all, 0);
  const top = grupos.filter((g) => g.vendedorId).sort((a, b) => (b._sum.total || 0) - (a._sum.total || 0))[0];
  let destaque: { id: number; nome: string; valor: number | null; quantidade: number; participacaoPct: number | null } | null = null;
  if (top && (top._sum.total || 0) > 0) {
    const v = await prisma.vendedor.findUnique({ where: { id: top.vendedorId! }, select: { id: true, nome: true } });
    const podeVerValor = usuario.perfil !== 'VENDEDOR' || usuario.vendedorId === top.vendedorId;
    const vTop = top._sum.total || 0;
    destaque = v
      ? { id: v.id, nome: v.nome, valor: podeVerValor ? Math.round(vTop * 100) / 100 : null, quantidade: top._count._all, participacaoPct: podeVerValor && valor ? Math.round((vTop / valor) * 1000) / 10 : null }
      : null;
  }
  return {
    valor: Math.round(valor * 100) / 100,
    quantidade,
    ticketMedio: quantidade ? Math.round((valor / quantidade) * 100) / 100 : 0,
    canceladasForaDoTotal: canceladas,
    destaque,
  };
}

export default async function vendasRoutes(app: FastifyInstance) {
  // se a edição destravou uma venda "paga na hora", o recebimento volta para o caixa no fim (deu certo ou não)
  app.addHook('onResponse', async (req) => {
    const id = (req as any).religarPagoNaHora as number | undefined;
    if (id) await prisma.$transaction((tx) => receberVendaPagaNaHora(tx, id)).catch((e) => req.log.error(e, 'religar pago na hora'));
  });
  // ---------------------------------------------------------------- listagem
  app.get('/api/v1/vendas', async (req) => {
    const q = listaQuery.parse(req.query);
    const where: any = {
      tipo: q.tipo === 'TODOS' ? undefined : q.tipo,
      contatoId: q.contatoId,
      vendedorId: q.vendedorId,
      origem: q.origem,
      data: intervalo(q.dataInicial, q.dataFinal),
    };
    if (q.situacaoId) where.situacaoId = q.situacaoId;
    else if (q.situacoes?.length) where.situacaoId = { in: q.situacoes };
    if (q.comNota !== undefined) where.notaId = q.comNota ? { not: null } : null;
    if (q.pesquisa) {
      const p = q.pesquisa;
      const num = Number(p);
      const or: any[] = [{ contato: { nome: { contains: p } } }, { contato: { nome: { contains: p.toUpperCase() } } }, { contato: { nome: { contains: p.toLowerCase() } } }, { numeroPedidoLoja: { contains: p } }, { observacoes: { contains: p } }];
      if (Number.isInteger(num) && num > 0) or.push({ numero: num }, { id: num });
      where.OR = or;
    }
    const orderBy = q.ordem === 'numero' ? { numero: q.direcao } : q.ordem === 'total' ? { total: q.direcao } : [{ data: q.direcao }, { numero: q.direcao }];
    const [total, data, somaAgg] = await Promise.all([
      prisma.venda.count({ where }),
      prisma.venda.findMany({
        where,
        ...paginar(q),
        orderBy,
        select: {
          id: true, tipo: true, numero: true, data: true, dataPrevista: true, validade: true, aprovadoEm: true, origem: true, total: true, totalProdutos: true, notaId: true,
          estoqueLancado: true, contasLancadas: true, numeroPedidoLoja: true, criadoEm: true, vendedorId: true,
          vendaGerada: { select: { id: true, numero: true } },
          orcamento: { select: { id: true, numero: true } },
          // selo do robô de NF na lista ("Pronto pra NF")
          roboNf: { select: { status: true, erros: true } },
          ...includeLista,
        },
      }),
      prisma.venda.aggregate({ where, _sum: { total: true } }),
    ]);
    return { ...respostaPaginada(data, total, q), totais: { valor: somaAgg._sum.total || 0 }, resumo: await resumoLista(where, !!(q.situacaoId || q.situacoes?.length), req.user) };
  });

  // ---------------------------------------------------------------- detalhe
  // lucro/margem do fechamento só para o dono e a gerência (o vendedor lança os custos, mas não vê o lucro)
  const comFechamento = (req: { user: { perfil: string } }, v: Awaited<ReturnType<typeof vendaCompleta>>) => (req.user.perfil === 'ADMIN' || req.user.perfil === 'GERENTE' ? v : { ...v, fechamento: null });

  app.get('/api/v1/vendas/:id', async (req) => comFechamento(req, await vendaCompleta(idDe(req))));

  // ---------------------------------------------------------------- criar
  app.post('/api/v1/vendas', async (req, reply) => {
    const body = vendaSchema.parse(req.body);
    // vendedor padrão = vendedor vinculado ao usuário logado (define a comissão default dos itens)
    if (body.vendedorId === undefined) {
      // lido do banco (o vínculo pode ter mudado depois do login; vendedor sem cadastro ganha um)
      const proprio = await vendedorDoUsuario(req.user.id);
      if (proprio) body.vendedorId = proprio;
    }
    // criar já numa situação final (Fechada / NF emitida) exige a venda completa
    if (body.tipo !== 'ORCAMENTO' && body.situacaoId) {
      const sit = await prisma.situacao.findUnique({ where: { id: body.situacaoId } });
      if (sit?.final && !sit.cancelamento) {
        const prep = await prepararVenda(prisma, body);
        const pend = pendenciasFinalizacao({ tipo: body.tipo, vendedorId: body.vendedorId ?? null, contato: prep.contato, itens: prep.itens as any, parcelas: prep.parcelas as any });
        if (pend.length) throw new AppError(mensagemFinalizacao(pend), 422, 'VENDA_INCOMPLETA', { pendencias: pend, contatoId: body.contatoId });
      }
    }
    const venda = await criarVenda(body, req.user.id);
    await auditar(req, body.tipo === 'ORCAMENTO' ? 'Orcamento' : 'Venda', venda.id, 'CRIAR', { numero: venda.numero, total: venda.total });
    return reply.code(201).send(comFechamento(req, await vendaCompleta(venda.id)));
  });

  // ---------------------------------------------------------------- alterar
  app.put('/api/v1/vendas/:id', async (req) => {
    const id = idDe(req);
    let atual = await carregarVenda(prisma, id);
    let bloqueada = atual.estoqueLancado || atual.contasLancadas;
    // venda travada só porque foi recebida automaticamente (pago na hora, estoque ainda não baixado):
    // desfaz o recebimento, deixa editar e recebe de novo no fim (hook onResponse)
    if (bloqueada && !atual.estoqueLancado && atual.tipo === 'PEDIDO' && (await soRecebimentoAutomatico(prisma, id))) {
      await prisma.$transaction((tx) =>
        acaoEstornarContas({ modulo: 'VENDA', entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: atual.situacaoId, situacaoDestinoId: atual.situacaoId }),
      );
      (req as any).religarPagoNaHora = id;
      atual = await carregarVenda(prisma, id);
      bloqueada = atual.estoqueLancado || atual.contasLancadas;
    }

    if (bloqueada) {
      // só campos livres (observações / transporte)
      const parcial = vendaSchema.partial().parse(req.body);
      const enviados = Object.keys(req.body as object);
      const proibidos = enviados.filter((k) => !(CAMPOS_LIVRES as readonly string[]).includes(k));
      // tolera campos iguais aos atuais (frontend costuma enviar o objeto inteiro)
      const realmenteAlterados = proibidos.filter((k) => {
        if (k === 'itens') {
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
          return novas.some((n, i) => n.valor !== atual.parcelas[i].valor || (n.formaPagamentoId ?? null) !== atual.parcelas[i].formaPagamentoId || (n.dataVencimento && n.dataVencimento.getTime() !== atual.parcelas[i].dataVencimento.getTime()));
        }
        const novo = (parcial as any)[k];
        const velho = (atual as any)[k];
        if (novo instanceof Date && velho instanceof Date) return novo.getTime() !== velho.getTime();
        return novo !== undefined && novo !== velho && !(novo === null && velho === null) && !(novo === false && velho === false);
      });
      if (realmenteAlterados.length) {
        throw new AppError(
          `Venda com estoque/contas lançados: só é possível alterar observações e transporte (campos bloqueados: ${realmenteAlterados.join(', ')}). Estorne antes de editar.`,
          422,
          'VENDA_LANCADA',
          { bloqueados: realmenteAlterados },
        );
      }
      // só o que veio no corpo (o .partial() ainda aplica os defaults do schema e zeraria campos não enviados)
      const corpo = req.body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      for (const k of CAMPOS_LIVRES) if (k in corpo && (parcial as any)[k] !== undefined) data[k] = (parcial as any)[k];
      // custo interno dos itens pode ser lançado/corrigido mesmo com a venda fechada
      const custosItens = (parcial.itens || [])
        .map((n, i) => ({ n, a: atual.itens[i] }))
        .filter(({ n, a }) => a && n.custoUnitario !== undefined && (n.custoUnitario ?? null) !== (a.custoInformado ? a.custoUnitario : null));
      await prisma.$transaction(async (tx) => {
        if (custosItens.length) {
          const prods = await tx.produto.findMany({ where: { id: { in: custosItens.map(({ a }) => a.produtoId).filter((x): x is number => !!x) } }, select: { id: true, precoCusto: true } });
          const doCadastro = new Map(prods.map((p) => [p.id, p.precoCusto]));
          for (const { n, a } of custosItens) {
            const informado = n.custoUnitario !== null && n.custoUnitario !== undefined;
            await tx.vendaItem.update({ where: { id: a.id }, data: { custoUnitario: informado ? n.custoUnitario! : (a.produtoId ? doCadastro.get(a.produtoId) ?? 0 : 0), custoInformado: informado } });
          }
          const itens = await tx.vendaItem.findMany({ where: { vendaId: id }, select: { custoUnitario: true, quantidade: true } });
          data.custoTotal = arredondar(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0));
        }
        if (Object.keys(data).length) await tx.venda.update({ where: { id }, data });
      });
      await auditar(req, 'Venda', id, 'ALTERAR', { ...data, ...(custosItens.length ? { custosItens: custosItens.length } : {}) });
      return comFechamento(req, await vendaCompleta(id));
    }

    if (atual.nota && atual.nota.situacao === 'AUTORIZADA') {
      throw new AppError('Venda com NF-e autorizada não pode ser alterada.', 422, 'NOTA_AUTORIZADA');
    }

    // aceita body parcial: campos ausentes são mantidos da venda atual
    const body = vendaSchema.parse(mesclarComAtual(atual, req.body as Record<string, unknown>));
    await prisma.$transaction(async (tx) => {
      const { itens, totais, parcelas, data } = await prepararVenda(tx, body);
      // parcelas: preserva as já vinculadas a conta (não há, pois contas não lançadas) → recria
      await tx.vendaItem.deleteMany({ where: { vendaId: id } });
      await tx.vendaParcela.deleteMany({ where: { vendaId: id } });
      await tx.venda.update({
        where: { id },
        data: {
          data,
          validade: atual.tipo === 'ORCAMENTO' ? body.validade ?? atual.validade : null,
          dataPrevista: body.dataPrevista,
          dataSaida: body.dataSaida,
          contatoId: body.contatoId,
          vendedorId: body.vendedorId ?? null,
          depositoId: body.depositoId ?? null,
          categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
          origem: body.origem,
          numeroPedidoLoja: body.numeroPedidoLoja ?? null,
          totalProdutos: totais.totalProdutos,
          descontoTipo: body.descontoTipo,
          descontoValor: body.descontoValor,
          frete: body.frete,
          outrasDespesas: body.outrasDespesas,
          total: totais.total,
          custoTotal: totais.custoTotal,
          custoLogistica: body.custoLogistica,
          observacoes: body.observacoes ?? null,
          observacoesInternas: body.observacoesInternas ?? null,
          transportadoraId: body.transportadoraId ?? null,
          fretePorConta: body.fretePorConta,
          quantidadeVolumes: body.quantidadeVolumes,
          pesoBruto: body.pesoBruto,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
      // se havia reserva, refaz com os novos itens
      if (await temReserva(id, tx)) {
        const ctx = { modulo: 'VENDA' as const, entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: atual.situacaoId, situacaoDestinoId: atual.situacaoId };
        await acaoLiberarReserva(ctx);
        await acaoReservarEstoque(ctx);
      }
    });
    await auditar(req, 'Venda', id, 'ALTERAR', { total: body.itens.length + ' itens' });
    // a data pode ter mudado: reavalia o período antigo e o novo
    const depois = await vendaCompleta(id);
    eventos.emitir('venda.alterada', { vendaId: id, data: atual.data, tipo: atual.tipo });
    if (+new Date(depois.data) !== +atual.data) eventos.emitir('venda.alterada', { vendaId: id, data: new Date(depois.data), tipo: atual.tipo });
    return comFechamento(req, depois);
  });

  // ---------------------------------------------------------------- excluir
  app.delete('/api/v1/vendas/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    let v = await prisma.venda.findUnique({ where: { id }, include: { nota: true } });
    if (!v) throw new NotFound('Venda');
    // venda só recebida automaticamente (pago na hora) e sem estoque baixado: tira do caixa e deixa excluir
    if (v.contasLancadas && !v.estoqueLancado && v.tipo === 'PEDIDO' && (await soRecebimentoAutomatico(prisma, id))) {
      const sit = v.situacaoId;
      await prisma.$transaction((tx) => acaoEstornarContas({ modulo: 'VENDA', entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: sit, situacaoDestinoId: sit }));
      v = (await prisma.venda.findUnique({ where: { id }, include: { nota: true } }))!;
    }
    if (v.estoqueLancado || v.contasLancadas) throw new AppError('Venda com estoque/contas lançados não pode ser excluída. Estorne (ou cancele) antes.', 422, 'VENDA_LANCADA');
    if (v.nota && v.nota.situacao === 'AUTORIZADA') throw new AppError('Venda com NF-e autorizada não pode ser excluída.', 422, 'NOTA_AUTORIZADA');
    await prisma.$transaction(async (tx) => {
      await acaoLiberarReserva({ modulo: 'VENDA', entidadeId: id, tx, usuarioId: req.user.id, situacaoOrigemId: v.situacaoId, situacaoDestinoId: v.situacaoId });
      await tx.comissao.deleteMany({ where: { vendaId: id, status: { not: 'PAGA' } } });
      await tx.historicoSituacao.deleteMany({ where: { entidadeTipo: moduloDe(v.tipo), entidadeId: id } });
      // venda gerada de um orçamento: desvincula (o orçamento fica no histórico)
      await tx.venda.updateMany({ where: { orcamentoId: id }, data: { orcamentoId: null } });
      if (v.notaId) {
        await tx.venda.update({ where: { id }, data: { notaId: null } });
        if (v.nota && v.nota.situacao === 'PENDENTE') await tx.notaFiscal.delete({ where: { id: v.notaId } });
      }
      await tx.venda.delete({ where: { id } });
      // contas a receber canceladas (sem nenhum recebimento) da venda excluída não ficam órfãs
      await tx.contaReceber.deleteMany({ where: { origemTipo: 'VENDA', origemId: id, situacao: 'CANCELADO', valorRecebido: 0 } });
    });
    await auditar(req, v.tipo === 'ORCAMENTO' ? 'Orcamento' : 'Venda', id, 'EXCLUIR', { numero: v.numero });
    eventos.emitir('venda.alterada', { vendaId: id, data: v.data, tipo: v.tipo });
    return { ok: true };
  });

  // ---------------------------------------------------------------- situação / ações
  app.post('/api/v1/vendas/:id/situacao', async (req) => {
    const id = idDe(req);
    const body = situacaoBody.parse(req.body);
    if (body.forcar && req.user.perfil !== 'ADMIN' && req.user.perfil !== 'GERENTE') throw new AppError('Somente ADMIN/GERENTE pode forçar transições.', 403, 'SEM_PERMISSAO');
    const atual = await prisma.venda.findUnique({ where: { id }, select: { tipo: true } });
    if (!atual) throw new NotFound('Venda');
    let forcar = body.forcar;
    if (atual.tipo !== 'ORCAMENTO') {
      const destino = await prisma.situacao.findUnique({ where: { id: body.situacaoId } });
      // finalizar (Fechada / NF emitida): só com a venda completa, e vale a partir de qualquer situação, para qualquer perfil
      if (destino?.modulo === 'VENDA' && destino.final && !destino.cancelamento) {
        await exigirVendaCompleta(id);
        forcar = true;
      }
    }
    const r = await mudarSituacao({ modulo: moduloDe(atual.tipo), entidadeId: id, situacaoDestinoId: body.situacaoId, usuarioId: req.user.id, observacao: body.observacao, forcar });
    await auditar(req, 'Venda', id, 'SITUACAO', { para: r.situacao.nome, acoes: r.acoes });
    return { situacao: { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor }, acoesExecutadas: r.acoes, alterado: r.alterado };
  });

  // ---------------------------------------------------------------- finalizar venda
  /** O que falta para finalizar (a tela pergunta "Deseja finalizar?" ou mostra a lista com links). */
  app.get('/api/v1/vendas/:id/finalizacao', async (req) => {
    const id = idDe(req);
    const v = await carregarVenda(prisma, id);
    const pendencias = pendenciasFinalizacao(v as any);
    const destino = await situacaoFinalizar();
    // itens consignados: a compra já existe e o pagamento ao consignante sai pela consignação
    const produtoIds = v.itens.map((i: any) => i.produtoId).filter((x: any): x is number => !!x);
    const consignados = produtoIds.length ? await prisma.consignacao.findMany({ where: { produtoId: { in: produtoIds } }, select: { id: true, numero: true, descricao: true, valorConsignante: true, produtoId: true, status: true } }) : [];
    const idsConsignados = new Set(consignados.map((c) => c.produtoId));
    const custoProdutos = arredondar(v.itens.filter((i: any) => !idsConsignados.has(i.produtoId)).reduce((s: number, i: any) => s + (i.custoUnitario || 0) * i.quantidade, 0));
    const compraRegistrada = await compraDaVenda(v.numero);
    return { consignados: consignados.map(({ produtoId, ...c }) => c), podeFinalizar: !pendencias.length, pendencias, jaFinalizada: !!v.situacao.final && !v.situacao.cancelamento, situacaoAtual: { id: v.situacao.id, nome: v.situacao.nome }, destino: { id: destino.id, nome: destino.nome, cor: destino.cor }, contatoId: v.contatoId, custoProdutos, compraRegistrada, parcelas: await parcelasParaFinalizar(id), formas: await formasParaFinalizar(), carne: { ...(await previaCarneVenda(v.contatoId ?? null)), taxaEscolhida: (v as any).carneTaxaPct ?? null } };
  });

  /** Finaliza (vai para "Fechada") a partir de qualquer situação, desde que a venda esteja completa. */
  app.post('/api/v1/vendas/:id/finalizar', async (req) => {
    const id = idDe(req);
    const body = z
      .object({
        observacao: z.string().max(500).nullish(),
        /** registrar o pedido de compra da mercadoria (com o custo da venda) e se já está paga */
        compra: z
          .object({
            fornecedorId: z.coerce.number().int().positive().nullish(),
            paga: z.boolean(),
            contaFinanceiraId: z.coerce.number().int().positive().nullish(),
            vencimento: dataSchema.nullish(),
            /** compra paga com a forma "Crédito bancário" (Lumicred paga; devolução + taxa no contas a pagar) */
            creditoBancario: z.boolean().nullish(),
          })
          .nullish(),
        /** onde entrou o dinheiro de cada parcela (ou se fica em aberto) */
        recebimentos: z
          .array(z.object({ parcelaId: z.coerce.number().int().positive(), formaPagamentoId: z.coerce.number().int().positive().nullish(), recebido: z.boolean(), contaFinanceiraId: z.coerce.number().int().positive().nullish(), creditoPagador: z.enum(['CLIENTE', 'LOJA']).nullish() }))
          .nullish(),
        /** carnê próprio: juros ao mês escolhidos na hora (vazio = pelo risco do cliente) */
        carne: z.object({ taxaPct: z.coerce.number().min(0).max(30).nullish() }).nullish(),
      })
      .parse(req.body ?? {});
    const v = await exigirVendaCompleta(id);
    exigirPedido(v, 'ser finalizado');
    const destino = await situacaoFinalizar();
    if (v.situacao.final && !v.situacao.cancelamento) return { situacao: { id: v.situacao.id, nome: v.situacao.nome, cor: v.situacao.cor }, acoesExecutadas: [], alterado: false };
    // confere as escolhas de pagamento antes de lançar qualquer coisa
    if (body.recebimentos?.length) await validarRecebimentosFinalizacao(id, body.recebimentos);
    if (body.carne) await prisma.venda.update({ where: { id }, data: { carneTaxaPct: body.carne.taxaPct ?? null } });
    // primeiro a compra (entra no estoque e fica ligada à venda), depois a venda baixa o estoque
    let compra: Awaited<ReturnType<typeof registrarCompraDaVenda>> | null = null;
    if (body.compra) {
      compra = await registrarCompraDaVenda(id, body.compra, req.user.id);
      if (compra.compra) await auditar(req, 'Compra', compra.compra.id, 'CRIAR', { numero: compra.compra.numero, deVenda: v.numero, paga: compra.paga, jaExistia: compra.jaExistia });
    }
    const r = await mudarSituacao({ modulo: 'VENDA', entidadeId: id, situacaoDestinoId: destino.id, usuarioId: req.user.id, observacao: body.observacao || 'Venda finalizada', forcar: true });
    await auditar(req, 'Venda', id, 'SITUACAO', { para: r.situacao.nome, acoes: r.acoes, finalizar: true });
    // garante as contas lançadas (pago na hora) e põe cada recebimento no banco escolhido
    const recebimentos = body.recebimentos?.length
      ? await aplicarRecebimentosFinalizacao(id, body.recebimentos)
      : await prisma.$transaction((tx) => receberVendaPagaNaHora(tx, id, req.user.id, { mesmoComContasLancadas: true }));
    return { situacao: { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor }, acoesExecutadas: r.acoes, alterado: r.alterado, compra, recebimentos };
  });

  /** Contato "Consumidor Final" (cria se não existir) — botão da tela de venda. */
  app.get('/api/v1/vendas/consumidor-final', async () => {
    const id = await consumidorFinalId();
    return prisma.contato.findUnique({ where: { id } });
  });

  app.post('/api/v1/vendas/:id/acoes', async (req) => {
    const id = idDe(req);
    const body = acoesBody.parse(req.body);
    exigirPedido(await carregarVenda(prisma, id), 'lançar estoque/contas');
    await executarAcoes('VENDA', id, body.acoes as Acao[], req.user.id);
    await auditar(req, 'Venda', id, 'ACAO', { acoes: body.acoes });
    const v = await vendaCompleta(id);
    return { acoesExecutadas: body.acoes, venda: comFechamento(req, v) };
  });

  // ---------------------------------------------------------------- NF-e
  // checklist da NF: tudo o que falta, com o link de onde corrigir
  app.get('/api/v1/vendas/:id/nfe/verificar', async (req) => {
    const modelo = Number((req.query as any)?.modelo) === 65 ? 65 : 55;
    return verificarNfeDaVenda(prisma, idDe(req), modelo);
  });

  app.post('/api/v1/vendas/:id/gerar-nfe', async (req, reply) => {
    const id = idDe(req);
    const body = gerarNfeBody.parse(req.body || {});
    exigirPedido(await carregarVenda(prisma, id), 'emitir nota fiscal');
    const nota = await prisma.$transaction((tx) => gerarNfeDaVenda(tx, id, body.modelo as 55 | 65, body.informacoesComplementares));
    await auditar(req, 'Venda', id, 'ACAO', { acao: 'gerarNfe', notaId: nota.id, modelo: body.modelo });
    return reply.code(201).send({ notaId: nota.id, numero: nota.numero, serie: nota.serie, modelo: nota.modelo, situacao: nota.situacao });
  });

  // ---------------------------------------------------------------- notificar
  app.post('/api/v1/vendas/:id/notificar', async (req, reply) => {
    const id = idDe(req);
    const body = notificarBody.parse(req.body);
    const v = await carregarVenda(prisma, id);
    const vars = await variaveisTemplate({
      tipo: 'VENDA',
      id: v.id,
      numero: v.numero,
      situacao: v.situacao.nome,
      total: v.total,
      data: v.data,
      contato: v.contato,
      itens: v.itens.map((i) => ({ descricao: i.descricao, quantidade: i.quantidade, total: i.total })),
      vendedor: v.vendedor?.nome,
      validade: v.validade,
      tipoDocumento: v.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Pedido',
    });
    // anexo: pedido pelo usuário ou pelo template (anexarPdf) → gera/atualiza o PDF em storage/pedidos
    let anexoPath: string | null = null;
    const template = body.templateId ? await prisma.templateNotificacao.findUnique({ where: { id: body.templateId } }) : null;
    if (body.anexarPdf || template?.anexarPdf) anexoPath = await gravarPdfVenda(v);
    const n = await enfileirarNotificacao({
      canal: body.canal,
      templateId: body.templateId,
      mensagem: body.mensagem,
      assunto: body.assunto,
      origemTipo: 'VENDA',
      origemId: v.id,
      contatoId: v.contatoId,
      contato: v.contato,
      vars,
      anexoPath,
    });
    // orçamento "Em aberto" enviado ao cliente → situação "Enviado" (quando a transição existe)
    if (v.tipo === 'ORCAMENTO' && v.situacao.nome === 'Em aberto') {
      const enviado = await prisma.situacao.findFirst({ where: { modulo: 'ORCAMENTO', nome: 'Enviado', ativo: true } });
      if (enviado) await mudarSituacao({ modulo: 'ORCAMENTO', entidadeId: id, situacaoDestinoId: enviado.id, usuarioId: req.user.id, forcar: true, observacao: `Enviado por ${body.canal === 'EMAIL' ? 'e-mail' : 'WhatsApp'}` }).catch(() => undefined);
    }
    await auditar(req, v.tipo === 'ORCAMENTO' ? 'Orcamento' : 'Venda', id, 'ACAO', { acao: 'notificar', canal: body.canal, notificacaoId: n.id, anexo: !!anexoPath });
    return reply.code(201).send(n);
  });

  // ---------------------------------------------------------------- imprimir
  app.get('/api/v1/vendas/:id/imprimir', async (req, reply) => {
    const v = await carregarVenda(prisma, idDe(req));
    return reply.type('text/html; charset=utf-8').send(await htmlVenda(v));
  });

  // PDF do pedido/orçamento (mesmo conteúdo da impressão) — ?download=1 força o download
  app.get('/api/v1/vendas/:id/pdf', async (req, reply) => {
    const v = await carregarVenda(prisma, idDe(req));
    const download = String((req.query as any)?.download || '') === '1';
    const buf = await pdfVenda(v);
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${nomeArquivoPdf(v)}"`)
      .send(buf);
  });

  // ---------------------------------------------------------------- orçamento: aprovar / converter em venda
  app.post('/api/v1/vendas/:id/aprovar', async (req) => {
    const id = idDe(req);
    const body = aprovarBody.parse(req.body || {});
    const r = await aprovarOrcamento(id, { aprovadoPor: body.aprovadoPor || req.user.nome, observacao: body.observacao, usuarioId: req.user.id });
    await auditar(req, 'Orcamento', id, 'ACAO', { acao: 'aprovar', aprovadoPor: body.aprovadoPor || req.user.nome });
    return { ok: true, ...r, orcamento: comFechamento(req, await vendaCompleta(id)) };
  });

  app.post('/api/v1/vendas/:id/converter', async (req, reply) => {
    const id = idDe(req);
    const body = converterBody.parse(req.body || {});
    const { venda, situacao } = await converterOrcamento(id, { usuarioId: req.user.id, situacaoId: body.situacaoId });
    // ações da situação inicial da venda gerada (ex.: "Em aberto" reserva estoque)
    const acoesIniciais = (JSON.parse(situacao.acoes || '[]') as Acao[]).filter((a) => a !== 'notificarCliente');
    if (acoesIniciais.length) await executarAcoes('VENDA', venda.id, acoesIniciais, req.user.id);
    await auditar(req, 'Orcamento', id, 'ACAO', { acao: 'converter', vendaId: venda.id, numeroVenda: venda.numero });
    eventos.emitir('venda.criada', { vendaId: venda.id, usuarioId: req.user.id });
    return reply.code(201).send(comFechamento(req, await vendaCompleta(venda.id)));
  });

  // ---------------------------------------------------------------- transferir para outro vendedor
  // ---------------------------------------------------------------- link de pagamento (Mercado Pago)
  /** O vendedor gera o link do Mercado Pago dentro do pedido (padrão: total da venda). */
  app.post('/api/v1/vendas/:id/link-pagamento', async (req) => {
    const id = idDe(req);
    const body = z.object({ valor: z.coerce.number().positive().nullish() }).parse(req.body ?? {});
    const v = await prisma.venda.findUnique({ where: { id }, include: { contato: { select: { nome: true, email: true } } } });
    if (!v) throw new NotFound('Venda');
    const valor = body.valor ?? v.total;
    const link = await criarLinkPagamento({ referencia: `venda-${v.id}`, titulo: `${v.tipo === 'ORCAMENTO' ? 'Orçamento' : 'Pedido'} nº ${v.numero} — Balão da Informática`, valor, email: v.contato?.email, nome: v.contato?.nome });
    await prisma.venda.update({ where: { id }, data: { linkPagamentoUrl: link.url, linkPagamentoId: link.id, linkPagamentoValor: link.valor, linkPagamentoEm: new Date() } });
    await auditar(req, 'Venda', id, 'ACAO', { acao: 'link-pagamento', valor: link.valor });
    return { url: link.url, valor: link.valor };
  });

  app.post('/api/v1/vendas/:id/transferir-vendedor', async (req) => {
    const id = idDe(req);
    const body = transferirVendedorBody.parse(req.body);
    // vendedor só repassa as próprias vendas (ou as sem vendedor); gestão transfere qualquer uma
    if (req.user.perfil === 'VENDEDOR' || req.user.perfil === 'TECNICO') {
      const v = await prisma.venda.findUnique({ where: { id }, select: { vendedorId: true } });
      if (v && v.vendedorId && v.vendedorId !== req.user.vendedorId) throw new AppError('Você só pode transferir as suas próprias vendas.', 403, 'SEM_PERMISSAO');
    }
    const r = await transferirVendedor(id, body.vendedorId, req.user.id);
    await auditar(req, 'Venda', id, 'ACAO', { acao: 'transferirVendedor', vendedorId: body.vendedorId, observacao: body.observacao });
    return { ok: true, alterado: r.alterado, venda: comFechamento(req, await vendaCompleta(id)) };
  });

  // ---------------------------------------------------------------- duplicar (clonar)
  app.post('/api/v1/vendas/:id/duplicar', async (req, reply) => {
    const id = idDe(req);
    const orig = await carregarVenda(prisma, id);
    const tipo = orig.tipo === 'ORCAMENTO' ? 'ORCAMENTO' : 'PEDIDO';
    const rotulo = tipo === 'ORCAMENTO' ? 'orçamento' : 'venda';
    const validade = tipo === 'ORCAMENTO' ? new Date(hojeMeioDia().getTime() + 7 * 86400000) : null;
    const { venda: nova } = await prisma.$transaction((tx) =>
      copiarVenda(tx, orig, { tipo, usuarioId: req.user.id, observacoesInternas: `Clonada do ${rotulo} nº ${orig.numero}`, validade, historicoObs: `Clonada do ${rotulo} nº ${orig.numero}` }),
    );
    await auditar(req, tipo === 'ORCAMENTO' ? 'Orcamento' : 'Venda', nova.id, 'CRIAR', { duplicadaDe: orig.numero, numero: nova.numero });
    if (tipo === 'PEDIDO') eventos.emitir('venda.criada', { vendaId: nova.id, usuarioId: req.user.id });
    eventos.emitir('venda.alterada', { vendaId: nova.id, data: nova.data, tipo: nova.tipo });
    return reply.code(201).send(comFechamento(req, await vendaCompleta(nova.id)));
  });

  // ---------------------------------------------------------------- gerar parcelas (não salva)
  app.post('/api/v1/vendas/:id/gerar-parcelas', async (req) => {
    const id = idDe(req);
    const body = gerarParcelasBody.parse(req.body);
    let total = body.total;
    if (total === undefined) {
      const v = await prisma.venda.findUnique({ where: { id }, select: { total: true } });
      if (!v) throw new NotFound('Venda');
      total = v.total;
    }
    const parcelas = gerarParcelas(total, body.quantidade, body.primeiroVencimento || hojeMeioDia(), body.intervaloDias, body.formaPagamentoId ?? null);
    return { total, parcelas };
  });

  // utilitário: gerar parcelas sem venda (usado pelo formulário antes de salvar)
  app.post('/api/v1/vendas/gerar-parcelas', async (req) => {
    const body = gerarParcelasBody.extend({ total: z.coerce.number().min(0) }).parse(req.body);
    return { total: body.total, parcelas: gerarParcelas(body.total, body.quantidade, body.primeiroVencimento || hojeMeioDia(), body.intervaloDias, body.formaPagamentoId ?? null) };
  });
}

/** Monta o body completo do PUT a partir da venda atual + campos enviados (permite PUT parcial). */
function mesclarComAtual(atual: Awaited<ReturnType<typeof carregarVenda>>, body: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    contatoId: atual.contatoId,
    vendedorId: atual.vendedorId,
    data: atual.data,
    dataPrevista: atual.dataPrevista,
    dataSaida: atual.dataSaida,
    validade: atual.validade,
    depositoId: atual.depositoId,
    origem: atual.origem,
    numeroPedidoLoja: atual.numeroPedidoLoja,
    categoriaFinanceiraId: atual.categoriaFinanceiraId,
    observacoes: atual.observacoes,
    observacoesInternas: atual.observacoesInternas,
    descontoTipo: atual.descontoTipo,
    descontoValor: atual.descontoValor,
    frete: atual.frete,
    outrasDespesas: atual.outrasDespesas,
    custoLogistica: atual.custoLogistica,
    transportadoraId: atual.transportadoraId,
    fretePorConta: atual.fretePorConta,
    quantidadeVolumes: atual.quantidadeVolumes,
    pesoBruto: atual.pesoBruto,
    itens: atual.itens.map((i) => ({ produtoId: i.produtoId, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, comissaoPct: i.comissaoPct, custoUnitario: i.custoInformado ? i.custoUnitario : null })),
    parcelas: atual.parcelas.map((p) => ({ dataVencimento: p.dataVencimento, valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes, creditoPagador: p.creditoPagador })),
  };
  const { situacaoId: _s, tipo: _t, ...resto } = body;
  for (const [k, v] of Object.entries(resto)) if (v !== undefined) base[k] = v;
  // se o total muda e as parcelas não foram enviadas, descarta as parcelas antigas (serão regeradas à vista)
  const mudaTotal = ['itens', 'descontoValor', 'descontoTipo', 'frete', 'outrasDespesas'].some((k) => resto[k] !== undefined);
  if (mudaTotal && resto.parcelas === undefined) base.parcelas = [];
  return base;
}
