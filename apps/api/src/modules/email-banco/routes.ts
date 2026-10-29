/**
 * ROBÔ DE E-MAIL DOS BANCOS — lê as caixas da loja e vira lançamento no financeiro.
 *
 *   GET    /api/v1/email-banco/painel          situação do robô, últimas mensagens, pendências
 *   POST   /api/v1/email-banco/rodar           roda agora
 *   GET    /api/v1/email-banco/mensagens       histórico, com filtro de situação
 *   GET    /api/v1/email-banco/caixas          caixas cadastradas (sem devolver senha)
 *   POST   /api/v1/email-banco/caixas          cadastra caixa
 *   PUT    /api/v1/email-banco/caixas/:id      altera caixa (senha só troca se vier preenchida)
 *   DELETE /api/v1/email-banco/caixas/:id      remove caixa
 *   POST   /api/v1/email-banco/caixas/:id/testar  testa a conexão
 *   GET    /api/v1/email-banco/regras          de qual remetente aceita aviso, e para qual banco
 *   POST   /api/v1/email-banco/regras          cria regra
 *   PUT    /api/v1/email-banco/regras/:id      altera regra
 *   DELETE /api/v1/email-banco/regras/:id      remove regra
 *   GET    /api/v1/email-banco/config          configuração
 *   PUT    /api/v1/email-banco/config          liga/desliga, baixa automática, dias iniciais
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { subDays } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { encrypt, decrypt, mask } from '../../lib/crypto.js';
import { registrarServico } from '../../core/servicos.js';
import { paginacaoSchema, paginar, respostaPaginada } from '../../lib/util.js';
import { lerCaixa } from '../../integracoes/email/index.js';
import { obterConfig, rodarRobo } from './service.js';

export const INTERVALO_MS = 30 * 60 * 1000; // 30 minutos, igual ao JARVIS

let rodando = false;

/** Worker: uma rodada 2 min depois de subir e depois de 30 em 30 minutos. */
export async function iniciarWorker(app: FastifyInstance) {
  if (process.env.EMAIL_BANCO === 'off') {
    app.log.info('[email-banco] desligado por EMAIL_BANCO=off');
    return;
  }
  const rodada = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const cfg = await obterConfig();
      if (!cfg.ligado) return;
      const r = await rodarRobo();
      if (r.mensagensVistas > 0 || r.erros.length > 0) {
        app.log.info(
          { ...r },
          `[email-banco] ${r.caixasLidas} caixa(s), ${r.importadas} importada(s), ${r.baixasAutomaticas} baixa(s)`,
        );
      }
    } catch (e) {
      app.log.error({ e }, '[email-banco] falha na rodada');
    } finally {
      rodando = false;
    }
  };
  setTimeout(rodada, 2 * 60 * 1000).unref();
  setInterval(rodada, INTERVALO_MS).unref();
}

registrarServico('email-banco', (app) => iniciarWorker(app));

const idDe = (req: any) => {
  const id = Number(req.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
};

const PARSERS = ['SUMUP_PIX', 'SUMUP_PAYOUT', 'CORA', 'ASAAS', 'MERCADOPAGO', 'BOLETO_FORNECEDOR'] as const;

const caixaSchema = z.object({
  nome: z.string().min(1, 'Informe um nome para a caixa.'),
  endereco: z.string().email('Endereço de e-mail inválido.'),
  tipo: z.enum(['IMAP', 'GMAIL']).default('IMAP'),
  host: z.string().nullish(),
  porta: z.number().int().min(1).max(65535).default(993),
  usuario: z.string().nullish(),
  segredo: z.string().nullish(),
  pasta: z.string().default('INBOX'),
  ativo: z.boolean().default(true),
});

const regraSchema = z.object({
  nome: z.string().min(1, 'Informe um nome para a regra.'),
  remetente: z.string().min(3, 'Informe o e-mail ou o domínio do remetente.'),
  parser: z.enum(PARSERS),
  contaFinanceiraId: z.number().int().positive().nullish(),
  ativo: z.boolean().default(true),
  ordem: z.number().int().default(0),
});

const caixaParaTela = (c: any) => ({
  id: c.id,
  nome: c.nome,
  endereco: c.endereco,
  tipo: c.tipo,
  host: c.host,
  porta: c.porta,
  usuario: c.usuario,
  pasta: c.pasta,
  ativo: c.ativo,
  segredo: mask(c.segredo),
  temSegredo: !!c.segredo,
  ultimaLeituraEm: c.ultimaLeituraEm,
  ultimoErro: c.ultimoErro,
});

export default async function rotas(app: FastifyInstance) {
  const admin = { preHandler: app.exigirPerfil('ADMIN') };

  app.get('/api/v1/email-banco/painel', admin, async () => {
    const cfg = await obterConfig();
    const caixas = await prisma.emailBancoCaixa.findMany({ orderBy: { id: 'asc' } });
    const desde = subDays(new Date(), 7);
    const [ultimas, porSituacao, pendentes] = await Promise.all([
      prisma.emailBancoMensagem.findMany({ orderBy: { recebidoEm: 'desc' }, take: 20 }),
      prisma.emailBancoMensagem.groupBy({ by: ['situacao'], _count: { _all: true }, where: { recebidoEm: { gte: desde } } }),
      prisma.transacaoBancaria.count({ where: { fonte: 'EMAIL', conciliado: false } }),
    ]);
    return {
      ligado: cfg.ligado,
      baixaAutomatica: cfg.baixaAutomatica,
      ultimaRodadaEm: cfg.ultimaRodadaEm,
      ultimoErro: cfg.ultimoErro,
      caixas: caixas.map(caixaParaTela),
      ultimos7Dias: Object.fromEntries(porSituacao.map((s) => [s.situacao, s._count._all])),
      pendentesDeConciliacao: pendentes,
      ultimas,
    };
  });

  app.post('/api/v1/email-banco/rodar', admin, async (req) => {
    const r = await rodarRobo();
    await auditar(req, 'EmailBancoConfig', 1, 'ACAO', { acao: 'rodar', ...r });
    return r;
  });

  app.get('/api/v1/email-banco/mensagens', admin, async (req) => {
    const q = paginacaoSchema.extend({ situacao: z.string().optional() }).parse(req.query);
    const where = q.situacao ? { situacao: q.situacao } : {};
    const [total, itens] = await Promise.all([
      prisma.emailBancoMensagem.count({ where }),
      prisma.emailBancoMensagem.findMany({ where, orderBy: { recebidoEm: 'desc' }, ...paginar(q) }),
    ]);
    return respostaPaginada(itens, total, q);
  });

  // --- caixas ---

  app.get('/api/v1/email-banco/caixas', admin, async () => {
    const caixas = await prisma.emailBancoCaixa.findMany({ orderBy: { id: 'asc' } });
    return caixas.map(caixaParaTela);
  });

  app.post('/api/v1/email-banco/caixas', admin, async (req, reply) => {
    const d = caixaSchema.parse(req.body);
    if (d.tipo === 'IMAP' && !d.host) throw new AppError('Caixa IMAP precisa do servidor (host).', 422, 'SEM_HOST');
    if (!d.segredo) throw new AppError('Informe a senha (IMAP) ou o refresh token (Gmail).', 422, 'SEM_SEGREDO');
    const criada = await prisma.emailBancoCaixa.create({
      data: { ...d, host: d.host ?? null, usuario: d.usuario ?? null, segredo: encrypt(d.segredo) },
    });
    await auditar(req, 'EmailBancoCaixa', criada.id, 'CRIAR', { endereco: criada.endereco });
    return reply.code(201).send(caixaParaTela(criada));
  });

  app.put('/api/v1/email-banco/caixas/:id', admin, async (req) => {
    const id = idDe(req);
    const existe = await prisma.emailBancoCaixa.findUnique({ where: { id } });
    if (!existe) throw new NotFound('Caixa de e-mail');
    const d = caixaSchema.partial().parse(req.body);
    const data: any = { ...d };
    // a senha só é trocada se o campo vier preenchido (a tela manda vazio para "não mexer")
    if (d.segredo) data.segredo = encrypt(d.segredo);
    else delete data.segredo;
    const atualizada = await prisma.emailBancoCaixa.update({ where: { id }, data });
    await auditar(req, 'EmailBancoCaixa', id, 'ALTERAR', { endereco: atualizada.endereco });
    return caixaParaTela(atualizada);
  });

  app.delete('/api/v1/email-banco/caixas/:id', admin, async (req) => {
    const id = idDe(req);
    const existe = await prisma.emailBancoCaixa.findUnique({ where: { id } });
    if (!existe) throw new NotFound('Caixa de e-mail');
    await prisma.emailBancoMensagem.deleteMany({ where: { caixaId: id } });
    await prisma.emailBancoCaixa.delete({ where: { id } });
    await auditar(req, 'EmailBancoCaixa', id, 'EXCLUIR', { endereco: existe.endereco });
    return { ok: true };
  });

  app.post('/api/v1/email-banco/caixas/:id/testar', admin, async (req) => {
    const id = idDe(req);
    const caixa = await prisma.emailBancoCaixa.findUnique({ where: { id } });
    if (!caixa) throw new NotFound('Caixa de e-mail');
    const segredo = decrypt(caixa.segredo);
    if (!segredo) throw new AppError('Caixa sem senha configurada.', 422, 'SEM_SEGREDO');
    try {
      const msgs = await lerCaixa(
        { tipo: caixa.tipo, endereco: caixa.endereco, host: caixa.host, porta: caixa.porta, usuario: caixa.usuario, segredo, pasta: caixa.pasta },
        subDays(new Date(), 2),
        5,
      );
      return { ok: true, mensagens: msgs.length, exemplo: msgs[0] ? { de: msgs[0].de, assunto: msgs[0].assunto, em: msgs[0].data } : null };
    } catch (e: any) {
      throw new AppError('Não consegui entrar nessa caixa: ' + String(e?.message || e).slice(0, 200), 502, 'FALHA_CAIXA');
    }
  });

  // --- regras de remetente ---

  app.get('/api/v1/email-banco/regras', admin, async () => {
    return prisma.emailBancoRegra.findMany({
      orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
      include: { contaFinanceira: { select: { id: true, nome: true } } },
    });
  });

  app.post('/api/v1/email-banco/regras', admin, async (req, reply) => {
    const d = regraSchema.parse(req.body);
    const criada = await prisma.emailBancoRegra.create({ data: { ...d, contaFinanceiraId: d.contaFinanceiraId ?? null } });
    await auditar(req, 'EmailBancoRegra', criada.id, 'CRIAR', { remetente: criada.remetente, parser: criada.parser });
    return reply.code(201).send(criada);
  });

  app.put('/api/v1/email-banco/regras/:id', admin, async (req) => {
    const id = idDe(req);
    const existe = await prisma.emailBancoRegra.findUnique({ where: { id } });
    if (!existe) throw new NotFound('Regra');
    const d = regraSchema.partial().parse(req.body);
    const atualizada = await prisma.emailBancoRegra.update({ where: { id }, data: d as any });
    await auditar(req, 'EmailBancoRegra', id, 'ALTERAR', { remetente: atualizada.remetente });
    return atualizada;
  });

  app.delete('/api/v1/email-banco/regras/:id', admin, async (req) => {
    const id = idDe(req);
    const existe = await prisma.emailBancoRegra.findUnique({ where: { id } });
    if (!existe) throw new NotFound('Regra');
    await prisma.emailBancoRegra.delete({ where: { id } });
    await auditar(req, 'EmailBancoRegra', id, 'EXCLUIR', { remetente: existe.remetente });
    return { ok: true };
  });

  // --- configuração ---

  app.get('/api/v1/email-banco/config', admin, async () => obterConfig());

  app.put('/api/v1/email-banco/config', admin, async (req) => {
    await obterConfig();
    const d = z
      .object({
        ligado: z.boolean().optional(),
        diasIniciais: z.number().int().min(1).max(365).optional(),
        baixaAutomatica: z.boolean().optional(),
        janelaMinutos: z.number().int().min(1).max(20160).optional(),
      })
      .parse(req.body);
    const cfg = await prisma.emailBancoConfig.update({ where: { id: 1 }, data: d });
    await auditar(req, 'EmailBancoConfig', 1, 'ALTERAR', d);
    return cfg;
  });
}
