/**
 * ROBÔ DE NF — rotas e o serviço que roda 24h.
 *
 *   GET  /api/v1/vendas/:id/robo-nf            estado do robô na venda (confere na hora se estiver velho)
 *   POST /api/v1/vendas/:id/robo-nf/conferir   confere agora
 *   POST /api/v1/vendas/:id/emitir-nf          o botão: gera a NF-e (modelo 55, A4) e transmite à SEFAZ
 *   POST /api/v1/produtos/:id/confirmar-ncm    confirma o NCM sugerido pelo robô (um clique)
 *   GET  /api/v1/robo-nf/painel                prontas / pendentes / NCM para confirmar
 *   GET  /api/v1/robo-nf/vendas                lista das vendas por status do robô
 *   POST /api/v1/robo-nf/varrer                força uma varredura (gestão)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { somenteDigitos } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import { carregarVenda, exigirPedido, gerarNfeDaVenda } from '../vendas/service.js';
import { transmitir } from '../../integracoes/fiscal/service.js';
import { agendarConferencia, conferirVenda, DIAS_VARREDURA, estadoAtual, estadoDoRegistro, painel, preencherCatalogo, varrer } from './motor.js';
import { formatarNcm } from './ncm.js';

const idDe = (req: any) => {
  const id = Number(req.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
};

// ---------------------------------------------------------------- gatilhos (eventos do sistema)
eventos.ouvir('venda.criada', (d) => agendarConferencia(d.vendaId));
eventos.ouvir('venda.alterada', (d) => agendarConferencia(d.vendaId));
eventos.ouvir('situacao.alterada', (d) => {
  if (d.modulo === 'VENDA') agendarConferencia(d.entidadeId);
});
const porNota = async (notaId: number) => {
  const v = await prisma.venda.findFirst({ where: { notaId }, select: { id: true } });
  if (v) agendarConferencia(v.id, 1000);
};
eventos.ouvir('nfe.autorizada', (d) => porNota(d.notaId));
eventos.ouvir('nfe.cancelada', (d) => porNota(d.notaId));

// ---------------------------------------------------------------- o robô 24h
const INTERVALO_MS = 5 * 60_000;
registrarServico('robo-nf', (app) => {
  if (process.env.ROBO_NF === 'off') {
    app.log.info('[robo-nf] desligado (ROBO_NF=off)');
    return;
  }
  const rodada = () =>
    preencherCatalogo()
      .then((r) => r.preenchidos && app.log.info(`[robo-nf] catálogo: NCM preenchido em ${r.preenchidos} produto(s)`))
      .catch((e) => app.log.error({ e }, '[robo-nf] falha ao preencher o catálogo'))
      .then(() => varrer())
      .then((r) => r && r.conferidas && app.log.info(`[robo-nf] varredura: ${r.conferidas} venda(s) conferida(s), ${r.prontas} pronta(s) pra NF, ${r.pendentes} com pendência`))
      .catch((e) => app.log.error({ e }, '[robo-nf] falha na varredura'));
  // primeira rodada logo depois de subir (sem atrasar a subida da API)
  setTimeout(rodada, 20_000).unref();
  setInterval(rodada, INTERVALO_MS).unref();
});

export default async function roboNfRoutes(app: FastifyInstance) {
  app.get('/api/v1/vendas/:id/robo-nf', async (req) => {
    const e = await estadoAtual(idDe(req));
    if (!e) throw new NotFound('Venda');
    return e;
  });

  app.post('/api/v1/vendas/:id/robo-nf/conferir', async (req) => {
    const e = await conferirVenda(idDe(req));
    if (!e) throw new NotFound('Venda');
    return e;
  });

  // O BOTÃO: gera a NF-e A4 (modelo 55) e já transmite à SEFAZ.
  app.post('/api/v1/vendas/:id/emitir-nf', async (req) => {
    const id = idDe(req);
    const body = z.object({ informacoesComplementares: z.string().trim().max(2000).optional().nullable() }).parse(req.body || {});
    const venda = await carregarVenda(prisma, id);
    exigirPedido(venda, 'emitir nota fiscal');

    // confere de novo NA HORA (o cadastro pode ter mudado desde a última conferência)
    const estado = await conferirVenda(id, { preencher: true });
    if (!estado) throw new NotFound('Venda');
    if (estado.status === 'EMITIDA') throw new AppError('Esta venda já tem NF autorizada.', 422, 'NF_JA_EMITIDA');
    if (estado.status === 'IGNORADA') throw new AppError('Esta venda não emite NF (orçamento, cancelada ou só serviço).', 422, 'SEM_NF');
    if (estado.status !== 'PRONTA') {
      const erros = estado.pendencias.filter((p) => p.nivel === 'erro');
      throw new AppError(
        erros.length === 1 ? `Ainda falta: ${erros[0].titulo}` : `Ainda faltam ${erros.length} itens: ${erros.map((e) => e.titulo).join(' · ')}`,
        422,
        'NFE_PENDENCIAS',
        estado,
      );
    }

    // nota já gerada antes e não autorizada (rejeitada / erro / pendente): reenvia a mesma
    const atual = await prisma.venda.findUnique({ where: { id }, select: { nota: { select: { id: true, numero: true, situacao: true } } } });
    let nota = atual?.nota && ['PENDENTE', 'REJEITADA', 'ERRO'].includes(atual.nota.situacao) ? atual.nota : null;
    if (!nota) {
      const nova = await prisma.$transaction((tx) => gerarNfeDaVenda(tx, id, 55, body.informacoesComplementares));
      nota = { id: nova.id, numero: nova.numero, situacao: nova.situacao };
    }
    await auditar(req, 'Venda', id, 'ACAO', { acao: 'emitirNf', notaId: nota.id, numero: nota.numero });
    try {
      const r = await transmitir(nota.id);
      await auditar(req, 'NotaFiscal', nota.id, 'ACAO', { acao: 'transmitir', origem: 'botão Emitir NF da venda', ...r });
      return { notaId: nota.id, numero: nota.numero, ...r };
    } finally {
      agendarConferencia(id, 1000);
    }
  });

  // confirma o NCM sugerido pelo robô (vale para todas as vendas do produto)
  app.post('/api/v1/produtos/:id/confirmar-ncm', async (req) => {
    const id = idDe(req);
    const body = z.object({ ncm: z.string().optional() }).parse(req.body || {});
    const p = await prisma.produto.findUnique({ where: { id }, select: { id: true, nome: true, ncm: true } });
    if (!p) throw new NotFound('Produto');
    const ncm = somenteDigitos(body.ncm ?? p.ncm);
    if (ncm.length !== 8 || /^0+$/.test(ncm)) throw new AppError('NCM precisa ter 8 dígitos.', 422, 'NCM_INVALIDO');
    await prisma.produto.update({ where: { id }, data: { ncm, ncmOrigem: 'CONFIRMADO' } });
    await auditar(req, 'Produto', id, 'ALTERAR', { ncm, ncmOrigem: 'CONFIRMADO', acao: 'confirmarNcm' });
    // reconfere as vendas pendentes que têm esse produto
    const vendas = await prisma.venda.findMany({ where: { itens: { some: { produtoId: id } }, roboNf: { status: 'PENDENTE' } }, select: { id: true }, take: 200 });
    vendas.forEach((v, i) => agendarConferencia(v.id, 500 + i * 50));
    return { ok: true, produtoId: id, ncm, ncmFormatado: formatarNcm(ncm), vendasReconferidas: vendas.length };
  });

  app.get('/api/v1/robo-nf/painel', async () => painel());

  app.get('/api/v1/robo-nf/vendas', async (req) => {
    const q = z.object({ status: z.enum(['PRONTA', 'PENDENTE', 'EMITIDA']).default('PRONTA'), limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const desde = new Date(Date.now() - DIAS_VARREDURA * 86400_000);
    const regs = await prisma.vendaRoboNf.findMany({
      where: { status: q.status, venda: { data: { gte: desde } } },
      include: { venda: { select: { id: true, numero: true, data: true, total: true, contato: { select: { nome: true } } } } },
      orderBy: { venda: { data: 'desc' } },
      take: q.limite,
    });
    return regs.map((r) => ({ ...estadoDoRegistro(r), venda: r.venda }));
  });

  app.post('/api/v1/robo-nf/varrer', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async () => varrer());
}
