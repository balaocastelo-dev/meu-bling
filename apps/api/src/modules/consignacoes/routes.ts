/**
 * CONSIGNAÇÃO — rotas.
 *   Loja (login): /api/v1/consignacoes/*  → todos os funcionários criam e acompanham contratos (decisão do Thiago);
 *                 pagar/quitar só ADMIN, GERENTE e FINANCEIRO; cancelar e regras só a gestão.
 *   Consignante (sem login, pelo token do link): /api/v1/publico/consignacao/:token/*
 *   Site (vitrine "Consignados"): /api/v1/publico/consignados
 */
import type { FastifyInstance } from 'fastify';
import { dashboardConsignacao } from './dashboard.js';
import { z } from 'zod';
import path from 'node:path';
import { auditar } from '../../lib/auditoria.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { dataSchema } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import { hojeMeioDia } from '../comum/datas.js';
import { htmlContrato } from './contrato.js';
import { carregarConsignacao, lerRegras, REGRAS_PADRAO, salvarRegras, STATUS, TIPOS_EQUIPAMENTO, atualizarQuitacao } from './nucleo.js';
import {
  alterarConsignacao,
  assinar,
  cancelarConsignacao,
  consignacaoCompleta,
  criarConsignacao,
  escolher,
  iniciarDiariasAgora,
  informarPagamento,
  listarConsignacoes,
  ordenarFotos,
  pagarConsignante,
  painelConsignacao,
  pedirDesconto,
  quitarSaldo,
  reenviarLink,
  removerFoto,
  responderDesconto,
  retirar,
  rodarRobo,
  salvarFotos,
  simular,
  visaoConsignante,
  vitrine,
} from './service.js';

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const texto = (max = 500) => z.string().trim().max(max).nullable().optional();
const tokenSchema = z.object({ token: z.string().regex(/^[0-9a-f]{24}$/, 'Link inválido') });

const consignanteSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do consignante').max(120),
  documento: texto(20),
  rg: texto(20),
  celular: texto(20),
  email: z.string().trim().email('E-mail inválido').max(120).nullable().optional().or(z.literal('')),
  cep: texto(10),
  logradouro: texto(120),
  numero: texto(20),
  complemento: texto(60),
  bairro: texto(60),
  municipio: texto(60),
  uf: texto(2),
});

const novaSchema = z.object({
  consignanteId: z.coerce.number().int().positive().nullable().optional(),
  consignante: consignanteSchema.nullable().optional(),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
  tipoEquipamento: z.enum(TIPOS_EQUIPAMENTO).default('OUTRO'),
  descricao: z.string().trim().min(3, 'Descreva o equipamento').max(150),
  marca: texto(60),
  modelo: texto(80),
  numeroSerie: texto(60),
  imei: texto(40),
  estado: texto(200),
  acessorios: texto(300),
  detalhes: texto(4000),
  precoVenda: z.coerce.number().positive('Informe o preço de venda').max(10_000_000),
  percentualConsignante: z.coerce.number().min(1).max(99).nullable().optional(),
  dataEntrada: dataSchema,
  prazoDias: z.coerce.number().int().min(1).max(365).nullable().optional(),
  declaracaoOrigem: z.boolean().optional(),
  assinadoNaLoja: z.boolean().optional(),
  mostrarNoSite: z.boolean().optional(),
  destaque: z.boolean().optional(),
  observacoes: texto(2000),
});

const regrasSchema = z.object({
  percentualConsignante: z.coerce.number().min(1).max(99),
  prazoDias: z.coerce.number().int().min(1).max(365),
  diariaPct: z.coerce.number().min(0.1).max(100),
  diariaMinima: z.coerce.number().min(0).max(1_000_000),
  diariaMaxima: z.coerce.number().min(0).max(1_000_000),
  taxaRetirada: z.coerce.number().min(0).max(1_000_000),
  descontoPct: z.coerce.number().min(0).max(50),
  diasPedirDesconto: z.array(z.coerce.number().int().min(1).max(365)).max(10),
  tetoDiarioLoja: z.coerce.number().min(0).max(100_000_000),
  feriadosExtras: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')).max(60),
  whatsapp: z.boolean(),
}).partial();

/** IP real do cliente (atrás do Caddy/Vercel). */
const ipDe = (req: any) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60);

// ---------------------------------------------------------------- pagamento feito pelo contas a pagar → avisa o consignante
eventos.ouvir('conta.paga', async (d) => {
  const cp = await prisma.contaPagar.findUnique({ where: { id: d.contaPagarId }, select: { consignacaoId: true } });
  if (!cp?.consignacaoId) return;
  const id = cp.consignacaoId;
  await prisma.$transaction((tx) => atualizarQuitacao(tx, id));
  await informarPagamento(id, 4000);
});

// ---------------------------------------------------------------- robô (a cada 30 min)
registrarServico('consignacao-robo', (app) => {
  if (process.env.CONSIGNACAO_ROBO === 'off') return;
  const rodada = () =>
    rodarRobo()
      .then((r) => (r.descontosPedidos || r.diariasIniciadas) && app.log.info(`[consignacao] robô: ${r.descontosPedidos} pedido(s) de desconto, ${r.diariasIniciadas} consignação(ões) em diárias`))
      .catch((e) => app.log.error({ e }, '[consignacao] falha no robô'));
  setTimeout(rodada, 90_000).unref();
  setInterval(rodada, 30 * 60_000).unref();
});

export default async function consignacoesRoutes(app: FastifyInstance) {
  const fin = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO') };
  const gestao = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') };
  const admin = { preHandler: app.exigirPerfil('ADMIN') };
  const limite = { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } };

  // ------------------------------------------------------------ loja
  app.get('/api/v1/consignacoes', async (req) => {
    const q = z.object({ status: z.enum(STATUS).optional(), pesquisa: z.string().trim().max(100).optional(), ativas: z.coerce.boolean().optional(), consignanteId: z.coerce.number().int().positive().optional() }).parse(req.query);
    return listarConsignacoes({ status: q.status, pesquisa: q.pesquisa || undefined, ativas: q.ativas, consignanteId: q.consignanteId });
  });

  app.get('/api/v1/consignacoes/painel', async () => painelConsignacao());

  // dashboard de consignação (gestor e gerente): estoque, quanto dá para lucrar, vendas, lucro, pagamentos
  app.get('/api/v1/consignacoes/dashboard', gestao, async (req) => {
    const q = z.object({ dataInicial: dataSchema, dataFinal: dataSchema }).parse(req.query);
    return dashboardConsignacao({ dataInicial: q.dataInicial, dataFinal: q.dataFinal });
  });

  app.get('/api/v1/consignacoes/regras', async () => ({ regras: await lerRegras(), padrao: REGRAS_PADRAO }));

  app.put('/api/v1/consignacoes/regras', admin, async (req) => {
    const b = regrasSchema.parse(req.body ?? {});
    if (b.diariaMaxima && b.diariaMinima && b.diariaMaxima < b.diariaMinima) throw new AppError('A diária máxima não pode ser menor que a mínima.', 422, 'DIARIA', { campo: 'diariaMaxima' });
    const r = await salvarRegras(b);
    await auditar(req, 'Consignacao', 0, 'ALTERAR', { regras: b });
    return { regras: r, padrao: REGRAS_PADRAO, aviso: 'As novas regras valem para os próximos contratos; os já assinados seguem as regras deles.' };
  });

  app.get('/api/v1/consignacoes/simular', async (req) => {
    const q = z.object({ precoVenda: z.coerce.number().positive().max(10_000_000), percentual: z.coerce.number().min(1).max(99).optional() }).parse(req.query);
    return simular(q.precoVenda, q.percentual ?? null);
  });

  app.post('/api/v1/consignacoes/robo', admin, async () => rodarRobo());

  app.post('/api/v1/consignacoes', async (req, reply) => {
    const b = novaSchema.parse(req.body ?? {});
    const ehGestao = ['ADMIN', 'GERENTE'].includes(req.user.perfil);
    // vendedor usa o percentual e o prazo padrão; só a gestão muda por contrato
    if (!ehGestao && ((b.prazoDias != null && b.prazoDias !== (await lerRegras()).prazoDias) || b.dataEntrada)) throw new AppError('Prazo diferente do padrão e data de entrada retroativa só com a gerente ou o administrador.', 403, 'SEM_PERMISSAO');
    const c = await criarConsignacao({ ...b, consignante: b.consignante ? { ...b.consignante, email: b.consignante.email || null } : null }, { id: req.user.id, vendedorId: req.user.vendedorId });
    await auditar(req, 'Consignacao', c.id, 'CRIAR', { numero: c.numero, descricao: c.descricao, precoVenda: c.precoVenda, valorConsignante: c.valorConsignante });
    return reply.code(201).send(c);
  });

  app.get('/api/v1/consignacoes/:id', async (req) => consignacaoCompleta(idSchema.parse(req.params).id));

  app.put('/api/v1/consignacoes/:id', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = novaSchema
      .pick({ descricao: true, tipoEquipamento: true, marca: true, modelo: true, numeroSerie: true, imei: true, estado: true, acessorios: true, detalhes: true, precoVenda: true, mostrarNoSite: true, destaque: true, observacoes: true, declaracaoOrigem: true, vendedorId: true })
      .partial()
      .parse(req.body ?? {});
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const d: any = {};
    for (const k of Object.keys(b)) if (k in corpo) d[k] = (b as any)[k];
    const c = await alterarConsignacao(id, d, req.user.id);
    await auditar(req, 'Consignacao', id, 'ALTERAR', d);
    return c;
  });

  app.get('/api/v1/consignacoes/:id/contrato', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    const c = await carregarConsignacao(id);
    if (!c) throw new NotFound('Consignação');
    return reply.type('text/html; charset=utf-8').send(await htmlContrato(c));
  });

  app.post('/api/v1/consignacoes/:id/fotos', async (req, reply) => {
    const { id } = idSchema.parse(req.params);
    if (!req.isMultipart()) throw new AppError('Envie as fotos como arquivo (multipart).', 400, 'SEM_ARQUIVO');
    const arquivos: { nome: string; buffer: Buffer }[] = [];
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const buffer = await part.toBuffer();
      if (buffer.length) arquivos.push({ nome: path.basename(part.filename || 'foto'), buffer });
    }
    if (!arquivos.length) throw new AppError('Envie ao menos uma foto.', 400, 'SEM_ARQUIVO');
    const fotos = await salvarFotos(id, arquivos);
    await auditar(req, 'Consignacao', id, 'ALTERAR', { fotos: arquivos.length });
    return reply.code(201).send({ fotos });
  });

  app.delete('/api/v1/consignacoes/:id/fotos/:nome', async (req) => {
    const { id } = idSchema.parse(req.params);
    const nome = z.object({ nome: z.string().regex(/^[\w.-]{3,80}$/) }).parse(req.params).nome;
    const fotos = await removerFoto(id, nome);
    await auditar(req, 'Consignacao', id, 'ALTERAR', { fotoRemovida: nome });
    return { fotos };
  });

  app.put('/api/v1/consignacoes/:id/fotos/ordem', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ ordem: z.array(z.string().max(80)).max(20) }).parse(req.body ?? {});
    return { fotos: await ordenarFotos(id, b.ordem) };
  });

  app.post('/api/v1/consignacoes/:id/assinar-na-loja', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ nome: z.string().trim().min(2).max(120).optional(), assinatura: z.string().max(2_000_000).optional() }).parse(req.body ?? {});
    const c = await prisma.consignacao.findUnique({ where: { id }, include: { consignante: { select: { nome: true, documento: true } } } });
    if (!c) throw new NotFound('Consignação');
    const png = b.assinatura ? pngDeDataUri(b.assinatura) : null;
    const r = await assinar(id, { meio: 'LOJA', nome: b.nome || c.consignante.nome, documento: c.consignante.documento, imagemPng: png, ip: ipDe(req), agente: String(req.headers['user-agent'] || ''), usuarioId: req.user.id });
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'assinado na loja' });
    return { ...r, consignacao: await consignacaoCompleta(id) };
  });

  app.post('/api/v1/consignacoes/:id/desconto', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ pct: z.coerce.number().min(1).max(50).optional() }).parse(req.body ?? {});
    const d = await pedirDesconto(id, b.pct ?? (await lerRegras()).descontoPct, 'LOJA', req.user.id);
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'pedir desconto', pct: d.pct });
    return consignacaoCompleta(id);
  });

  app.post('/api/v1/consignacoes/:id/reenviar-link', async (req) => {
    const { id } = idSchema.parse(req.params);
    const r = await reenviarLink(id);
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'reenviar link' });
    return r;
  });

  app.post('/api/v1/consignacoes/:id/pagar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ contaFinanceiraId: z.coerce.number().int().positive(), valor: z.coerce.number().positive().max(10_000_000).nullable().optional(), data: dataSchema, tudo: z.boolean().optional() }).parse(req.body ?? {});
    const c = await pagarConsignante(id, { contaFinanceiraId: b.contaFinanceiraId, valor: b.valor ?? null, data: b.data ?? hojeMeioDia(), tudo: b.tudo });
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'pagar consignante', valor: b.valor ?? 'devido hoje' });
    return c;
  });

  app.post('/api/v1/consignacoes/:id/quitar', fin, async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ contaFinanceiraId: z.coerce.number().int().positive().nullable().optional(), data: dataSchema }).parse(req.body ?? {});
    const c = await quitarSaldo(id, { contaFinanceiraId: b.contaFinanceiraId ?? null, data: b.data ?? hojeMeioDia(), usuarioId: req.user.id });
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'quitar saldo', pagoAgora: !!b.contaFinanceiraId });
    return c;
  });

  app.post('/api/v1/consignacoes/:id/retirada', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ isentarTaxa: z.boolean().optional(), recebido: z.boolean().optional(), contaFinanceiraId: z.coerce.number().int().positive().nullable().optional(), data: dataSchema }).parse(req.body ?? {});
    if (b.isentarTaxa && !['ADMIN', 'GERENTE'].includes(req.user.perfil)) throw new AppError('Dispensar a taxa de retirada só com a gerente ou o administrador.', 403, 'SEM_PERMISSAO');
    const c = await retirar(id, { isentarTaxa: b.isentarTaxa, recebido: b.recebido, contaFinanceiraId: b.contaFinanceiraId ?? null, data: b.data ?? hojeMeioDia(), usuarioId: req.user.id });
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'retirada', isentarTaxa: !!b.isentarTaxa });
    return c;
  });

  app.post('/api/v1/consignacoes/:id/escolha', async (req) => {
    const { id } = idSchema.parse(req.params);
    const b = z.object({ escolha: z.enum(['RECEBER', 'RETIRAR']) }).parse(req.body ?? {});
    const c = await escolher(id, b.escolha);
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'escolha registrada pela loja', escolha: b.escolha });
    return c;
  });

  app.post('/api/v1/consignacoes/:id/iniciar-diarias', gestao, async (req) => {
    const { id } = idSchema.parse(req.params);
    const c = await iniciarDiariasAgora(id, req.user.id);
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'iniciar diárias agora' });
    return c;
  });

  app.post('/api/v1/consignacoes/:id/cancelar', gestao, async (req) => {
    const { id } = idSchema.parse(req.params);
    const c = await cancelarConsignacao(id, req.user.id);
    await auditar(req, 'Consignacao', id, 'ACAO', { acao: 'cancelar' });
    return c;
  });

  // ------------------------------------------------------------ consignante (link sem login)
  app.get('/api/v1/publico/consignacao/:token', limite, async (req) => visaoConsignante(tokenSchema.parse(req.params).token));

  app.get('/api/v1/publico/consignacao/:token/contrato', limite, async (req, reply) => {
    const { token } = tokenSchema.parse(req.params);
    const c0 = await prisma.consignacao.findUnique({ where: { token }, select: { id: true } });
    if (!c0) throw new NotFound('Consignação');
    const c = await carregarConsignacao(c0.id);
    return reply.type('text/html; charset=utf-8').send(await htmlContrato(c!));
  });

  app.post('/api/v1/publico/consignacao/:token/assinar', limite, async (req) => {
    const { token } = tokenSchema.parse(req.params);
    const b = z
      .object({
        nome: z.string().trim().min(3, 'Digite seu nome completo').max(120),
        documento: z.string().trim().min(11, 'Digite seu CPF').max(20),
        aceite: z.literal(true, { message: 'Marque que leu e concorda com o contrato' }),
        assinatura: z.string().min(50, 'Faça sua assinatura no quadro').max(2_000_000),
      })
      .parse(req.body ?? {});
    const c = await prisma.consignacao.findUnique({ where: { token }, select: { id: true } });
    if (!c) throw new NotFound('Consignação');
    const r = await assinar(c.id, { meio: 'CELULAR', nome: b.nome, documento: b.documento, imagemPng: pngDeDataUri(b.assinatura), ip: ipDe(req), agente: String(req.headers['user-agent'] || '') });
    await auditar(req, 'Consignacao', c.id, 'ACAO', { acao: 'assinado pelo celular', nome: b.nome });
    return { ...r, ...(await visaoConsignante(token)) };
  });

  app.post('/api/v1/publico/consignacao/:token/desconto/:descontoId', limite, async (req) => {
    const { token } = tokenSchema.parse(req.params);
    const { descontoId } = z.object({ descontoId: z.coerce.number().int().positive() }).parse(req.params);
    const b = z.object({ autorizar: z.boolean() }).parse(req.body ?? {});
    const c = await prisma.consignacao.findUnique({ where: { token }, select: { id: true } });
    if (!c) throw new NotFound('Consignação');
    const r = await responderDesconto(c.id, descontoId, b.autorizar, ipDe(req));
    await auditar(req, 'Consignacao', c.id, 'ACAO', { acao: b.autorizar ? 'desconto autorizado pelo consignante' : 'desconto recusado pelo consignante', descontoId });
    return { ...r, ...(await visaoConsignante(token)) };
  });

  app.post('/api/v1/publico/consignacao/:token/escolha', limite, async (req) => {
    const { token } = tokenSchema.parse(req.params);
    const b = z.object({ escolha: z.enum(['RECEBER', 'RETIRAR']) }).parse(req.body ?? {});
    const c = await prisma.consignacao.findUnique({ where: { token }, select: { id: true } });
    if (!c) throw new NotFound('Consignação');
    await escolher(c.id, b.escolha);
    await auditar(req, 'Consignacao', c.id, 'ACAO', { acao: 'escolha do consignante', escolha: b.escolha });
    return visaoConsignante(token);
  });

  // ------------------------------------------------------------ vitrine do site
  app.get('/api/v1/publico/consignados', limite, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return { data: await vitrine() };
  });

  app.get('/api/v1/publico/consignados/:numero', limite, async (req, reply) => {
    const { numero } = z.object({ numero: z.coerce.number().int().positive() }).parse(req.params);
    const item = (await vitrine()).find((x) => x.numero === numero);
    if (!item) throw new NotFound('Equipamento');
    reply.header('Cache-Control', 'public, max-age=60');
    return item;
  });
}

/** "data:image/png;base64,..." → Buffer (só PNG/JPEG). */
function pngDeDataUri(v: string): Buffer {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/.exec(v.trim());
  if (!m) throw new AppError('Assinatura inválida: refaça no quadro.', 422, 'ASSINATURA_INVALIDA', { campo: 'assinatura' });
  const b = Buffer.from(m[2], 'base64');
  if (b.length < 100) throw new AppError('Assinatura vazia: faça sua assinatura no quadro.', 422, 'SEM_ASSINATURA', { campo: 'assinatura' });
  return b;
}
