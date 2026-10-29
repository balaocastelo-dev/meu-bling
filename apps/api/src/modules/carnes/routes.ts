/**
 * CARNÊ PRÓPRIO (Financeiro › Carnês) — perfis ADMIN, GERENTE, FINANCEIRO (a política central fecha /financeiro).
 * A impressão do carnê de uma venda fica em /vendas/:id/carne (o vendedor imprime na hora da venda).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditar } from '../../lib/auditoria.js';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { dataSchema } from '../../lib/util.js';
import { dadosEmpresa } from '../comum/html.js';
import { htmlCarne } from './render.js';
import { avaliar, carregarCfgRisco, carregarHistoricos, CLASSES } from './risco.js';
import { alterarCarne, calcularParcelas, cancelarCarne, carneCompleto, configCarne, criarCarne, estornarParcela, listarCarnes, previaCarneVenda, receberParcela, vencimentosMensais } from './service.js';
import { addMonths } from 'date-fns';
import { hojeMeioDia } from '../comum/datas.js';

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const idOpc = z.coerce.number().int().positive().nullable().optional();
const texto = z.string().trim().max(500).nullable().optional();

export default async function carnesRoutes(app: FastifyInstance) {
  const fin = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO') };

  app.get('/api/v1/financeiro/carnes', fin, async (req) => {
    const q = z
      .object({
        status: z.enum(['EM_DIA', 'ATRASADO', 'QUITADO', 'CANCELADO']).optional(),
        clienteId: z.coerce.number().int().positive().optional(),
        pesquisa: z.string().trim().max(100).optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
      })
      .parse(req.query);
    const fim = q.dataFinal ? new Date(new Date(q.dataFinal).setHours(23, 59, 59, 999)) : null;
    return listarCarnes({ status: q.status, clienteId: q.clienteId, pesquisa: q.pesquisa || undefined, ini: q.dataInicial, fim });
  });

  /** Auditoria de crédito: para quais clientes já dá para oferecer carnê, com nota, classe, juros e limite. */
  app.get('/api/v1/financeiro/carnes/auditoria', fin, async (req) => {
    const q = z
      .object({
        filtro: z.enum(['TODOS', 'APTOS', 'RESSALVA', 'NAO']).default('TODOS'),
        classe: z.enum(CLASSES as [string, ...string[]]).optional(),
        pesquisa: z.string().trim().max(100).optional(),
        limite: z.coerce.number().int().min(1).max(5000).default(500),
      })
      .parse(req.query);
    const [hist, cfg] = await Promise.all([carregarHistoricos(), carregarCfgRisco()]);
    const todas = [...hist.values()].map((h) => ({ cliente: { id: h.contatoId, nome: h.nome, documento: h.documento, telefone: h.telefone }, historico: h, ...avaliar(h, cfg) }));
    const resumo = {
      clientes: todas.length,
      aptos: todas.filter((t) => t.apto).length,
      comRessalva: todas.filter((t) => t.comRessalva).length,
      naoAptos: todas.filter((t) => !t.apto && !t.comRessalva).length,
      porClasse: Object.fromEntries(CLASSES.map((c) => [c, todas.filter((t) => t.classe === c).length])),
      limiteTotalAptos: todas.filter((t) => t.apto).reduce((s, t) => s + t.disponivel, 0),
      taxaMin: cfg.taxaMin,
      taxaMax: cfg.taxaMax,
    };
    const termo = (q.pesquisa || '').toLowerCase();
    const dig = termo.replace(/\D/g, '');
    let lista = todas.filter((t) => (q.filtro === 'APTOS' ? t.apto : q.filtro === 'RESSALVA' ? t.comRessalva : q.filtro === 'NAO' ? !t.apto && !t.comRessalva : true));
    if (q.classe) lista = lista.filter((t) => t.classe === q.classe);
    if (termo) lista = lista.filter((t) => t.cliente.nome.toLowerCase().includes(termo) || (dig.length >= 3 && (t.cliente.documento || '').includes(dig)));
    lista.sort((a, b) => b.score - a.score || b.historico.gasto24m - a.historico.gasto24m);
    return { resumo, data: lista.slice(0, q.limite), total: lista.length };
  });

  app.get('/api/v1/financeiro/carnes/risco/:id', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const [hist, cfg] = await Promise.all([carregarHistoricos([id]), carregarCfgRisco()]);
    const h = hist.get(id);
    if (!h) throw new NotFound('Cliente');
    return { historico: h, ...avaliar(h, cfg) };
  });

  /** Simulação: parcelas, juros e total (sem gravar). Sem taxa = juros pelo risco do cliente. */
  app.get('/api/v1/financeiro/carnes/simular', fin, async (req) => {
    const q = z
      .object({
        valor: z.coerce.number().positive().max(10_000_000),
        parcelas: z.coerce.number().int().min(1).max(48),
        taxaPct: z.coerce.number().min(0).max(30).optional(),
        clienteId: z.coerce.number().int().positive().optional(),
        primeiroVencimento: dataSchema,
      })
      .parse(req.query);
    const previa = await previaCarneVenda(q.clienteId ?? null);
    const taxa = q.taxaPct ?? previa.avaliacao?.taxaPct ?? previa.taxaMax;
    const calc = calcularParcelas(q.valor, taxa, q.parcelas);
    const vencs = vencimentosMensais(q.primeiroVencimento ?? addMonths(hojeMeioDia(), 1), q.parcelas);
    return { taxaPct: taxa, ...calc, parcelasLista: calc.valores.map((v, k) => ({ parcela: k + 1, vencimento: vencs[k], valor: v })), ...previa };
  });

  app.get('/api/v1/financeiro/carnes/config', fin, async () => configCarne());

  app.put('/api/v1/financeiro/carnes/config', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const b = z
      .object({
        pixChave: z.string().trim().min(5).max(77).optional(),
        pixNome: z.string().trim().min(2).max(60).optional(),
        pixCidade: z.string().trim().min(2).max(40).optional(),
        taxaMinPct: z.coerce.number().min(0).max(30).optional(),
        taxaMaxPct: z.coerce.number().min(0).max(30).optional(),
        multaPct: z.coerce.number().min(0).max(10).optional(),
        moraMesPct: z.coerce.number().min(0).max(10).optional(),
      })
      .parse(req.body ?? {});
    const atual = await configCarne();
    const min = b.taxaMinPct ?? atual.taxaMinPct;
    const max = b.taxaMaxPct ?? atual.taxaMaxPct;
    if (min > max) throw new AppError('Os juros mínimos não podem passar dos máximos.', 422, 'TAXA_INVALIDA', { campo: 'taxaMinPct' });
    await prisma.empresa.update({
      where: { id: 1 },
      data: { pixChave: b.pixChave, pixNome: b.pixNome, pixCidade: b.pixCidade, carneTaxaMinPct: b.taxaMinPct, carneTaxaMaxPct: b.taxaMaxPct, carneMultaPct: b.multaPct, carneMoraMesPct: b.moraMesPct },
    });
    await auditar(req, 'Empresa', 1, 'ALTERAR', { carne: b });
    return configCarne();
  });

  app.get('/api/v1/financeiro/carnes/:id', fin, async (req) => carneCompleto(idSchema.parse(req.params).id));

  app.post('/api/v1/financeiro/carnes', fin, async (req, reply) => {
    const b = z
      .object({
        clienteId: z.coerce.number().int().positive(),
        vendaId: idOpc,
        valorFinanciado: z.coerce.number().positive().max(10_000_000),
        taxaMensalPct: z.coerce.number().min(0).max(30).nullable().optional(),
        parcelas: z.coerce.number().int().min(1).max(48),
        primeiroVencimento: dataSchema,
        contaFinanceiraId: idOpc,
        descricao: texto,
        observacoes: texto,
      })
      .parse(req.body);
    const c = await criarCarne({ ...b, primeiroVencimento: b.primeiroVencimento ?? null });
    await auditar(req, 'Carne', c.id, 'CRIAR', { numero: c.numero, cliente: c.cliente.nome, valor: c.valorFinanciado, parcelas: c.parcelas, taxa: c.taxaMensalPct });
    return reply.code(201).send(c);
  });

  app.put('/api/v1/financeiro/carnes/:id', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z
      .object({ taxaMensalPct: z.coerce.number().min(0).max(30).nullable().optional(), parcelas: z.coerce.number().int().min(1).max(48).nullable().optional(), primeiroVencimento: dataSchema, observacoes: texto, descricao: texto })
      .parse(req.body ?? {});
    const c = await alterarCarne(id, b);
    await auditar(req, 'Carne', id, 'ALTERAR', b);
    return c;
  });

  app.post('/api/v1/financeiro/carnes/:id/cancelar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const c = await cancelarCarne(id);
    await auditar(req, 'Carne', id, 'ACAO', { acao: 'cancelar' });
    return c;
  });

  /** Baixa de uma parcela no caixa/banco (PIX → Cora; dinheiro no balcão → Caixa). Multa/mora sugeridas se atrasou. */
  app.post('/api/v1/financeiro/carnes/:id/parcelas/:contaId/receber', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const contaId = z.coerce.number().int().positive().parse((req.params as any).contaId);
    const b = z
      .object({
        valor: z.coerce.number().positive().nullable().optional(),
        data: dataSchema,
        contaFinanceiraId: idOpc,
        formaPagamentoId: idOpc,
        juros: z.coerce.number().min(0).nullable().optional(),
        desconto: z.coerce.number().min(0).nullable().optional(),
        observacoes: texto,
      })
      .parse(req.body ?? {});
    const c = await receberParcela(id, contaId, b);
    await auditar(req, 'Carne', id, 'ACAO', { acao: 'receber parcela', contaId, valor: b.valor ?? 'saldo', contaFinanceiraId: b.contaFinanceiraId });
    return c;
  });

  app.post('/api/v1/financeiro/carnes/:id/parcelas/:contaId/estornar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const contaId = z.coerce.number().int().positive().parse((req.params as any).contaId);
    const c = await estornarParcela(id, contaId);
    await auditar(req, 'Carne', id, 'ACAO', { acao: 'estornar parcela', contaId });
    return c;
  });

  app.get('/api/v1/financeiro/carnes/:id/imprimir', fin, async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const q = z.object({ abertas: z.coerce.boolean().optional() }).parse(req.query);
    const [c, e] = await Promise.all([carneCompleto(id), dadosEmpresa()]);
    return reply.type('text/html; charset=utf-8').send(await htmlCarne(c, e, { soAbertas: q.abertas }));
  });

  // ---- pela venda (vendedor imprime na hora)
  app.get('/api/v1/vendas/:id/carne', async (req) => {
    const { id } = idSchema.parse(req.params);
    const c = await prisma.carne.findFirst({ where: { vendaId: id, situacao: { not: 'CANCELADO' } }, orderBy: { id: 'desc' }, select: { id: true } });
    return c ? carneCompleto(c.id) : null;
  });

  app.get('/api/v1/vendas/:id/carne/imprimir', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const c = await prisma.carne.findFirst({ where: { vendaId: id, situacao: { not: 'CANCELADO' } }, orderBy: { id: 'desc' }, select: { id: true } });
    if (!c) throw new AppError('Esta venda não tem carnê.', 404, 'SEM_CARNE');
    const [carne, e] = await Promise.all([carneCompleto(c.id), dadosEmpresa()]);
    return reply.type('text/html; charset=utf-8').send(await htmlCarne(carne, e));
  });
}
