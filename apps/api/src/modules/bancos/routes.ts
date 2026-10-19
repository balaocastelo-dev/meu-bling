/**
 * BANCOS / OPEN FINANCE — vínculo de contas (Pluggy ou mock), sincronização,
 * importação OFX, transações bancárias com sugestões e conciliação.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startOfDay, endOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { paginacaoSchema, paginar, respostaPaginada, dataSchema, arredondar } from '../../lib/util.js';
import { registrarServico } from '../../core/servicos.js';
import { obterProvedor, statusOpenFinance, limparCacheProvedor } from '../../integracoes/openfinance/index.js';
import { parseOfx } from './ofx.js';
import { gravarTransacoes, sincronizarConta, sincronizarTodas, sugerirConciliacao, conciliar } from './service.js';

export default async function bancosRoutes(app: FastifyInstance) {
  const fin = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');
  const cfg = app.exigirPerfil('ADMIN', 'GERENTE');

  // =====================================================================
  // OPEN FINANCE
  // =====================================================================
  app.get('/api/v1/open-finance/status', { preHandler: fin }, async () => {
    const st = await statusOpenFinance();
    const contas = await prisma.contaFinanceira.findMany({
      where: { openFinanceAccountId: { not: null } },
      select: { id: true, nome: true, openFinanceItemId: true, openFinanceStatus: true, ultimaSincronizacao: true, saldoBanco: true, saldoBancoEm: true },
    });
    let conectores: { id: number; nome: string; tipo: string }[] | undefined;
    try {
      const provedor = await obterProvedor();
      if (provedor.conectores && !st.ativo) conectores = await provedor.conectores();
    } catch {
      /* conectores são informativos */
    }
    return { ativo: st.ativo, provedor: st.provedor, configurado: st.configurado, clientId: st.clientId, contasVinculadas: contas, conectores };
  });

  app.post('/api/v1/open-finance/connect-token', { preHandler: fin }, async () => {
    limparCacheProvedor();
    const provedor = await obterProvedor();
    try {
      const r = await provedor.connectToken();
      return { accessToken: r.accessToken, provedor: provedor.nome };
    } catch (e: any) {
      throw new AppError('Não foi possível gerar o token do Pluggy: ' + (e?.message || e), 502, 'OPEN_FINANCE');
    }
  });

  /** Lista as contas do item (conexão do widget) e cria/vincula ContaFinanceira(s). */
  app.post('/api/v1/open-finance/vincular', { preHandler: fin }, async (req) => {
    const b = z.object({ itemId: z.string().min(1), contaFinanceiraId: z.number().int().optional(), accountId: z.string().optional() }).parse(req.body);
    const provedor = await obterProvedor();
    let contas;
    try {
      contas = await provedor.contasDoItem(b.itemId);
    } catch (e: any) {
      throw new AppError('Falha ao consultar contas do banco: ' + (e?.message || e), 502, 'OPEN_FINANCE');
    }
    if (!contas.length) throw new AppError('Nenhuma conta encontrada nesta conexão.', 422, 'SEM_CONTAS');
    const resultado: { contaFinanceiraId: number; nome: string; saldo: number; nova: boolean }[] = [];

    if (b.contaFinanceiraId) {
      // vincula uma conta financeira existente à primeira conta (ou à accountId informada)
      const alvo = (b.accountId && contas.find((c) => c.id === b.accountId)) || contas[0];
      const cf = await prisma.contaFinanceira.findUnique({ where: { id: b.contaFinanceiraId } });
      if (!cf) throw new NotFound('Conta financeira');
      await prisma.contaFinanceira.update({
        where: { id: cf.id },
        data: { openFinanceItemId: b.itemId, openFinanceAccountId: alvo.id, openFinanceStatus: 'VINCULADA', saldoBanco: arredondar(alvo.saldo), saldoBancoEm: new Date(), banco: cf.banco || alvo.banco || null, agencia: cf.agencia || alvo.agencia || null, conta: cf.conta || alvo.numero || null },
      });
      resultado.push({ contaFinanceiraId: cf.id, nome: cf.nome, saldo: arredondar(alvo.saldo), nova: false });
    } else {
      for (const c of contas) {
        const existente = await prisma.contaFinanceira.findFirst({ where: { openFinanceAccountId: c.id } });
        if (existente) {
          await prisma.contaFinanceira.update({ where: { id: existente.id }, data: { openFinanceItemId: b.itemId, saldoBanco: arredondar(c.saldo), saldoBancoEm: new Date(), openFinanceStatus: 'VINCULADA' } });
          resultado.push({ contaFinanceiraId: existente.id, nome: existente.nome, saldo: arredondar(c.saldo), nova: false });
          continue;
        }
        const nova = await prisma.contaFinanceira.create({
          data: {
            nome: c.nome + (c.numero ? ` ${c.numero}` : ''),
            tipo: c.tipo === 'CREDIT' ? 'CARTAO' : c.subtipo === 'SAVINGS_ACCOUNT' ? 'INVESTIMENTO' : 'BANCO',
            banco: c.banco || null,
            agencia: c.agencia || null,
            conta: c.numero || null,
            saldoInicial: 0,
            saldoAtual: 0,
            saldoBanco: arredondar(c.saldo),
            saldoBancoEm: new Date(),
            openFinanceItemId: b.itemId,
            openFinanceAccountId: c.id,
            openFinanceStatus: 'VINCULADA',
          },
        });
        resultado.push({ contaFinanceiraId: nova.id, nome: nova.nome, saldo: arredondar(c.saldo), nova: true });
      }
    }
    await auditar(req, 'ContaFinanceira', null, 'ACAO', { acao: 'open-finance.vincular', itemId: b.itemId, contas: resultado.map((r) => r.contaFinanceiraId) });
    return resultado;
  });

  app.post('/api/v1/open-finance/sincronizar/:contaFinanceiraId', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).contaFinanceiraId);
    const q = z.object({ dias: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query);
    const r = await sincronizarConta(id, q.dias);
    await auditar(req, 'ContaFinanceira', id, 'ACAO', { acao: 'open-finance.sincronizar', ...r });
    return r;
  });

  app.post('/api/v1/open-finance/sincronizar-todas', { preHandler: fin }, async (req) => {
    const r = await sincronizarTodas();
    await auditar(req, 'ContaFinanceira', null, 'ACAO', { acao: 'open-finance.sincronizar-todas', contas: r.length });
    return r;
  });

  app.delete('/api/v1/open-finance/desvincular/:contaFinanceiraId', { preHandler: cfg }, async (req) => {
    const id = Number((req.params as any).contaFinanceiraId);
    const cf = await prisma.contaFinanceira.findUnique({ where: { id } });
    if (!cf) throw new NotFound('Conta financeira');
    await prisma.contaFinanceira.update({ where: { id }, data: { openFinanceItemId: null, openFinanceAccountId: null, openFinanceStatus: null } });
    await auditar(req, 'ContaFinanceira', id, 'ACAO', { acao: 'open-finance.desvincular' });
    return { ok: true };
  });

  /** Webhook do Pluggy (público). Dispara sincronização do item informado. */
  app.post('/api/v1/webhooks/pluggy', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body: any = req.body || {};
    const itemId: string | undefined = body.itemId || body.item?.id || body.data?.itemId;
    const evento: string = body.event || body.type || '';
    req.log.info({ evento, itemId }, '[pluggy] webhook recebido');
    if (itemId && /item\/(updated|created|login_succeeded)|transactions/i.test(evento)) {
      const contas = await prisma.contaFinanceira.findMany({ where: { openFinanceItemId: itemId, ativo: true } });
      // não bloqueia a resposta do webhook
      setImmediate(async () => {
        for (const c of contas) {
          try {
            await sincronizarConta(c.id);
          } catch (e) {
            req.log.warn({ e }, `[pluggy] falha ao sincronizar conta ${c.id}`);
          }
        }
      });
    } else if (itemId && /item\/error|login_failed/i.test(evento)) {
      await prisma.contaFinanceira.updateMany({ where: { openFinanceItemId: itemId }, data: { openFinanceStatus: 'ERRO: ' + (body.error?.message || evento) } });
    }
    return reply.code(200).send({ ok: true });
  });

  // =====================================================================
  // IMPORTAÇÃO OFX
  // =====================================================================
  app.post('/api/v1/bancos/importar-ofx', { preHandler: fin }, async (req) => {
    let contaFinanceiraId: number | undefined;
    let conteudo: string | null = null;
    let nomeArquivo = '';
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          nomeArquivo = part.filename;
          conteudo = (await part.toBuffer()).toString('latin1');
          // OFX de bancos brasileiros costuma vir em latin1; se tiver marcação UTF-8 reconverte
          if (/CHARSET:UTF-8|encoding="UTF-8"/i.test(conteudo)) conteudo = Buffer.from(conteudo, 'latin1').toString('utf8');
        } else if (part.fieldname === 'contaFinanceiraId') {
          contaFinanceiraId = Number((part as any).value);
        }
      }
    } else {
      const b = z.object({ contaFinanceiraId: z.number().int(), conteudo: z.string().min(10) }).parse(req.body);
      contaFinanceiraId = b.contaFinanceiraId;
      conteudo = b.conteudo;
    }
    if (!contaFinanceiraId) throw new AppError('Informe a conta financeira (contaFinanceiraId).', 400, 'VALIDACAO');
    if (!conteudo) throw new AppError('Envie o arquivo OFX.', 400, 'VALIDACAO');
    const conta = await prisma.contaFinanceira.findUnique({ where: { id: contaFinanceiraId } });
    if (!conta) throw new NotFound('Conta financeira');

    const ofx = parseOfx(conteudo);
    if (!ofx.transacoes.length) throw new AppError('Nenhuma transação encontrada no arquivo OFX.', 422, 'OFX_VAZIO');
    const novas = await gravarTransacoes(contaFinanceiraId, ofx.transacoes.map((t) => ({ ...t, bruto: { trntype: t.trntype, arquivo: nomeArquivo } })), 'OFX');
    if (ofx.saldo !== undefined) {
      await prisma.contaFinanceira.update({ where: { id: contaFinanceiraId }, data: { saldoBanco: arredondar(ofx.saldo), saldoBancoEm: ofx.saldoEm || new Date() } });
    }
    await auditar(req, 'ContaFinanceira', contaFinanceiraId, 'ACAO', { acao: 'importar-ofx', arquivo: nomeArquivo, lidas: ofx.transacoes.length, novas });
    return { lidas: ofx.transacoes.length, novasTransacoes: novas, saldo: ofx.saldo ?? null, contaBanco: ofx.contaBanco ?? null };
  });

  // =====================================================================
  // TRANSAÇÕES / CONCILIAÇÃO
  // =====================================================================
  app.get('/api/v1/bancos/transacoes', { preHandler: fin }, async (req) => {
    const q = paginacaoSchema
      .extend({
        contaFinanceiraId: z.coerce.number().int().optional(),
        conciliado: z.enum(['true', 'false']).optional(),
        tipo: z.enum(['CREDITO', 'DEBITO']).optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        pesquisa: z.string().trim().optional(),
        sugestoes: z.enum(['true', 'false']).default('true'),
      })
      .parse(req.query);
    const where: any = {};
    if (q.contaFinanceiraId) where.contaFinanceiraId = q.contaFinanceiraId;
    if (q.conciliado) where.conciliado = q.conciliado === 'true';
    if (q.tipo) where.tipo = q.tipo;
    if (q.dataInicial || q.dataFinal) {
      where.data = {};
      if (q.dataInicial) where.data.gte = startOfDay(q.dataInicial);
      if (q.dataFinal) where.data.lte = endOfDay(q.dataFinal);
    }
    if (q.pesquisa) where.descricao = { contains: q.pesquisa };
    const [total, itens] = await Promise.all([
      prisma.transacaoBancaria.count({ where }),
      prisma.transacaoBancaria.findMany({
        where,
        include: { contaFinanceira: { select: { id: true, nome: true } }, categoria: { select: { id: true, nome: true } }, movimento: { select: { id: true, contaReceberId: true, contaPagarId: true } } },
        orderBy: [{ data: 'desc' }, { id: 'desc' }],
        ...paginar(q),
      }),
    ]);
    const data = [];
    for (const t of itens) {
      const { dadosBrutos: _b, ...resto } = t;
      const sugestoes = !t.conciliado && q.sugestoes === 'true' ? await sugerirConciliacao(t) : [];
      data.push({ ...resto, sugestoes });
    }
    return respostaPaginada(data, total, q);
  });

  app.post('/api/v1/bancos/transacoes/:id/conciliar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const b = z
      .object({
        tipo: z.enum(['RECEBER', 'PAGAR', 'LANCAMENTO']),
        id: z.number().int().nullable().optional(),
        categoriaId: z.number().int().nullable().optional(),
        descricao: z.string().nullable().optional(),
      })
      .parse(req.body);
    const r = await conciliar(id, b);
    await auditar(req, 'TransacaoBancaria', id, 'ACAO', { acao: 'conciliar', ...b, movimentoId: r.movimentoId });
    return r;
  });

  /** Ignorar = marca como conciliada sem gerar movimento (ex.: transferência interna já lançada). */
  app.post('/api/v1/bancos/transacoes/:id/ignorar', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const t = await prisma.transacaoBancaria.findUnique({ where: { id } });
    if (!t) throw new NotFound('Transação bancária');
    if (t.conciliado) throw new AppError('Transação já conciliada.', 422, 'JA_CONCILIADA');
    const atualizada = await prisma.transacaoBancaria.update({ where: { id }, data: { conciliado: true, categoriaSugerida: 'IGNORADA' } });
    await auditar(req, 'TransacaoBancaria', id, 'ACAO', { acao: 'ignorar' });
    return atualizada;
  });

  /** Desfaz "ignorar" (transações sem movimento). */
  app.post('/api/v1/bancos/transacoes/:id/reabrir', { preHandler: fin }, async (req) => {
    const id = Number((req.params as any).id);
    const t = await prisma.transacaoBancaria.findUnique({ where: { id }, include: { movimento: true } });
    if (!t) throw new NotFound('Transação bancária');
    if (t.movimento) throw new AppError('Transação ligada a um movimento: estorne a conta ou exclua o movimento.', 422, 'TEM_MOVIMENTO');
    return prisma.transacaoBancaria.update({ where: { id }, data: { conciliado: false, categoriaSugerida: null } });
  });
}

// ---------------------------------------------------------------------
// Serviço: sincroniza contas vinculadas a cada 30 min quando openFinanceAtivo
// ---------------------------------------------------------------------
registrarServico('open-finance-sync', (app) => {
  const INTERVALO = 30 * 60 * 1000;
  const rodar = async () => {
    try {
      const st = await statusOpenFinance();
      if (!st.ativo) return;
      const r = await sincronizarTodas();
      if (r.length) app.log.info({ r }, '[open-finance] sincronização automática');
    } catch (e) {
      app.log.warn({ e }, '[open-finance] falha na sincronização automática');
    }
  };
  const timer = setInterval(rodar, INTERVALO);
  timer.unref();
  setTimeout(rodar, 15000).unref();
});
