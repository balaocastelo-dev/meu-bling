/**
 * LANÇAMENTOS AUTOMÁTICOS — revisão do que o bot leu em e-mail de banco.
 *
 * Bot (chave de API, escopo `lancamentos-automaticos`):
 *   POST /api/v1/lancamentos-automaticos     cria já como PENDENTE (GRAVACAO)
 *   GET  /api/v1/lancamentos-automaticos     lista por status (LEITURA)
 *   GET  /api/v1/lancamentos-automaticos/contas-financeiras       contas ativas (LEITURA)
 *   GET  /api/v1/lancamentos-automaticos/categorias-financeiras   categorias ativas (LEITURA)
 *   POST /api/v1/lancamentos-automaticos/importar                 vincula os já lançados (GRAVACAO)
 *
 * Painel (só ADMIN, sessão de pessoa — a chave de API não revisa):
 *   GET  /api/v1/lancamentos-automaticos/resumo
 *   PUT  /api/v1/lancamentos-automaticos/config          limite de valor alto
 *   POST /api/v1/lancamentos-automaticos/:id/confiar     grava quem e quando; aí entra no saldo
 *   POST /api/v1/lancamentos-automaticos/:id/contestar   observação obrigatória; não mexe no saldo
 *
 * Pendente não cria movimento, não altera saldo e não dá baixa. Ver service.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditar } from '../../lib/auditoria.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import { dataSchema, paginacaoSchema, paginar, toDate } from '../../lib/util.js';
import { importarJaLancados, type ItemArquivo } from './importar.js';
import { confiar, contestar, criar, listar, listarCategoriasParaBot, listarContasParaBot, resumo, salvarLimite } from './service.js';

const filtroSchema = paginacaoSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.enum(['PENDENTE', 'CONFIADO', 'CONTESTADO']).optional(),
  ),
  contaFinanceiraId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional(),
  ),
  dataInicial: dataSchema,
  dataFinal: dataSchema,
});

const corpoSchema = z.object({
  tipo: z.enum(['ENTRADA', 'SAIDA', 'TRANSFERENCIA']),
  data: z.union([z.string(), z.date()]).transform((v, ctx) => {
    const d = toDate(v);
    if (!d) {
      ctx.addIssue({ code: 'custom', message: 'Informe a data (AAAA-MM-DD).' });
      return z.NEVER;
    }
    return d;
  }),
  valor: z.number().positive('Valor deve ser maior que zero'),
  contaFinanceiraId: z.number().int().positive(),
  contaDestinoId: z.number().int().positive().nullable().optional(),
  contraparte: z.string().trim().min(2, 'Informe quem pagou ou recebeu.').max(200),
  categoriaId: z.number().int().positive().nullable().optional(),
  emailOrigemId: z.string().trim().min(1, 'Informe o ID do e-mail de origem.').max(500),
  emailOrigemUrl: z
    .string()
    .trim()
    .max(500)
    .refine((s) => s === '' || /^https?:\/\//i.test(s), 'O link do e-mail precisa começar com http:// ou https://')
    .nullable()
    .optional(),
  descricao: z.string().trim().max(500).nullable().optional(),
});

function idDe(req: { params: unknown }) {
  const id = Number((req.params as { id?: string } | undefined)?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
}

function soPessoa(req: { chaveApi?: unknown }) {
  if (req.chaveApi) throw new Forbidden('Confiar, contestar e o limite de valor são decisão de uma pessoa no painel, não da chave de API.');
}

export default async function lancamentosAutomaticosRoutes(app: FastifyInstance) {
  const admin = app.exigirPerfil('ADMIN');

  app.get('/api/v1/lancamentos-automaticos/resumo', { preHandler: admin }, async (req) => {
    soPessoa(req);
    return resumo();
  });

  app.put('/api/v1/lancamentos-automaticos/config', { preHandler: admin }, async (req) => {
    soPessoa(req);
    const b = z.object({ limiteValorAlto: z.number().min(0).max(1_000_000_000) }).parse(req.body);
    const limiteValorAlto = await salvarLimite(b.limiteValorAlto);
    await auditar(req, 'LancamentoAutomatico', null, 'ALTERAR', { limiteValorAlto });
    return { limiteValorAlto };
  });

  app.get('/api/v1/lancamentos-automaticos/contas-financeiras', async () => listarContasParaBot());

  app.get('/api/v1/lancamentos-automaticos/categorias-financeiras', async () => listarCategoriasParaBot());

  app.post('/api/v1/lancamentos-automaticos/importar', async (req) => {
    const b = z
      .object({
        lancamentos: z.array(z.object({
          emailOrigemId: z.string(),
          sistemaId: z.number().int().positive().nullable().optional(),
          movimentoSaidaId: z.number().int().positive().nullable().optional(),
          movimentoEntradaId: z.number().int().positive().nullable().optional(),
          contaPagarCanceladaId: z.number().int().positive().nullable().optional(),
          tipo: z.string(),
          valor: z.number(),
          data: z.string(),
          contraparte: z.string(),
          origemContaId: z.number().int().positive().nullable().optional(),
          destinoContaId: z.number().int().positive().nullable().optional(),
          contaFinanceiraId: z.number().int().positive().nullable().optional(),
          categoriaId: z.number().int().positive().nullable().optional(),
          emailOrigemUrl: z.string().nullable().optional(),
          descricao: z.string().nullable().optional(),
          situacao: z.string().optional(),
          status: z.string().optional(),
        }).passthrough()).max(500),
      })
      .passthrough()
      .parse(req.body);
    const r = await importarJaLancados(b.lancamentos as ItemArquivo[], {
      botNome: req.chaveApi?.nome ?? `Painel: ${req.user?.nome ?? 'importação'}`,
      chaveApiId: req.chaveApi?.id ?? null,
    });
    await auditar(req, 'LancamentoAutomatico', null, 'ACAO', { acao: 'importar', criados: r.criados, idempotentes: r.idempotentes, erros: r.erros.length });
    return r;
  });

  app.get('/api/v1/lancamentos-automaticos', async (req) => {
    const q = filtroSchema.parse(req.query);
    const p = paginar(q);
    return listar({ ...q, ...p });
  });

  app.post('/api/v1/lancamentos-automaticos', async (req, reply) => {
    if (!req.chaveApi) {
      throw new Forbidden('Lançamentos automáticos só são criados por uma chave de API com o escopo "lancamentos-automaticos" (nível gravação).');
    }
    const b = corpoSchema.parse(req.body);
    const r = await criar({
      ...b,
      emailOrigemUrl: b.emailOrigemUrl || null,
      descricao: b.descricao || null,
      categoriaId: b.categoriaId ?? null,
      contaDestinoId: b.contaDestinoId ?? null,
      botNome: req.chaveApi.nome,
      chaveApiId: req.chaveApi.id,
    });
    if (!r.idempotente) {
      await auditar(req, 'LancamentoAutomatico', r.lancamento.id, 'CRIAR', {
        tipo: r.lancamento.tipo,
        valor: r.lancamento.valor,
        emailOrigemId: r.lancamento.emailOrigemId,
        contaFinanceiraId: r.lancamento.contaFinanceiraId,
        status: 'PENDENTE',
      });
    }
    reply.code(r.idempotente ? 200 : 201);
    return r;
  });

  app.post('/api/v1/lancamentos-automaticos/:id/confiar', { preHandler: admin }, async (req) => {
    soPessoa(req);
    const id = idDe(req);
    const lancamento = await confiar(id, req.user.id);
    await auditar(req, 'LancamentoAutomatico', id, 'ACAO', { acao: 'confiar', movimentoId: lancamento.movimentoId, valor: lancamento.valor });
    return lancamento;
  });

  app.post('/api/v1/lancamentos-automaticos/:id/contestar', { preHandler: admin }, async (req) => {
    soPessoa(req);
    const id = idDe(req);
    const b = z.object({ observacao: z.string().trim().min(3, 'A contestação precisa de uma observação.').max(2000) }).parse(req.body);
    const lancamento = await contestar(id, req.user.id, b.observacao);
    await auditar(req, 'LancamentoAutomatico', id, 'ACAO', { acao: 'contestar', observacao: b.observacao });
    return lancamento;
  });
}
