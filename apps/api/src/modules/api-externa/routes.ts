/**
 * API EXTERNA — conectar outros sistemas e agentes de IA ao MEU BLING.
 *
 * Tela (só ADMIN): Configurações → API e integrações.
 *   GET    /api-externa/resumo                       números do topo da tela + endereços
 *   GET    /api-externa/recursos                     recursos, níveis, endpoints documentados e eventos
 *   GET    /api-externa/chaves                       chaves (sem a chave em si)
 *   POST   /api-externa/chaves                       cria → devolve a chave UMA vez
 *   PUT    /api-externa/chaves/:id                   altera permissões, IPs, limite, validade, ativa/desativa
 *   POST   /api-externa/chaves/:id/regenerar         troca a chave (a antiga para de funcionar na hora)
 *   DELETE /api-externa/chaves/:id                   exclui
 *   GET    /api-externa/logs                         registro de chamadas
 *   GET    /api-externa/webhooks                     endereços que recebem eventos
 *   POST   /api-externa/webhooks                     cadastra → devolve o segredo da assinatura
 *   PUT    /api-externa/webhooks/:id                 altera
 *   DELETE /api-externa/webhooks/:id                 exclui
 *   GET    /api-externa/webhooks/:id/segredo         mostra o segredo
 *   POST   /api-externa/webhooks/:id/segredo         gera outro segredo
 *   POST   /api-externa/webhooks/:id/testar          manda um evento "teste" agora
 *   GET    /api-externa/webhooks/:id/entregas        últimas entregas
 *   POST   /api-externa/entregas/:id/reenviar        reenvia uma entrega
 *
 * Para quem chama com chave:
 *   GET    /externo/eu                               quem sou eu e o que posso
 *   GET    /externo/openapi.json                     documentação OpenAPI só com o que a chave pode
 *   POST   /mcp  ·  POST /mcp/:chave                 servidor MCP para agentes de IA
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { idDe } from '../comum/zod.js';
import { gerarChave, limparCacheChaves, limparLogsAntigos, pareceChave } from './chaves.js';
import { ENDPOINTS, EVENTOS_WEBHOOK, NIVEIS, RECURSOS, lerPermissoes, limparPermissoes } from './recursos.js';
import { montarOpenApi, urlBaseApi, endpointsPermitidos } from './openapi.js';
import { tratarMcp, ferramentasMcp } from './mcp.js';
import { cifrarSegredo, gerarSegredo, lerEventos, lerSegredo, limparEventos, postar, processarFila } from './webhooks.js';
import { registrarServico } from '../../core/servicos.js';

const ipsSchema = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v ? v.split(/[,\s;]+/).map((s) => s.trim()).filter(Boolean).join(', ') : null))
  .refine((v) => !v || v.split(', ').every((ip) => /^[0-9a-fA-F:.]+$/.test(ip)), 'IP inválido (separe vários por vírgula)');

const chaveCampos = {
  nome: z.string().trim().min(2, 'Dê um nome à chave (ex.: "Agente de vendas", "n8n")').max(80),
  descricao: z.string().trim().max(500).nullable().optional(),
  permissoes: z.record(z.string(), z.string()),
  ipsPermitidos: ipsSchema,
  limitePorMinuto: z.coerce.number().int().min(1).max(5000),
  permitirNaUrl: z.boolean(),
  expiraEm: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Validade no formato AAAA-MM-DD'), z.null()]).optional(),
  ativo: z.boolean(),
};
/** criação: com valores padrão */
const chaveSchema = z.object({
  ...chaveCampos,
  permissoes: chaveCampos.permissoes.default({}),
  limitePorMinuto: chaveCampos.limitePorMinuto.default(120),
  permitirNaUrl: chaveCampos.permitirNaUrl.default(false),
  ativo: chaveCampos.ativo.default(true),
});
/** alteração: só o que veio (sem padrões, senão um PUT parcial apagaria o resto) */
const chaveAlteracaoSchema = z.object(chaveCampos).partial();

const webhookCampos = {
  nome: z.string().trim().min(2, 'Dê um nome (ex.: "CRM", "n8n")').max(80),
  url: z
    .string()
    .trim()
    .url('Endereço inválido')
    .refine((u) => /^https?:\/\//i.test(u), 'O endereço tem de começar com http:// ou https://'),
  eventos: z.array(z.string()),
  ativo: z.boolean(),
};
const webhookSchema = z.object({ ...webhookCampos, eventos: webhookCampos.eventos.default(['*']), ativo: webhookCampos.ativo.default(true) });
const webhookAlteracaoSchema = z.object(webhookCampos).partial();

const fimDoDia = (d: string) => new Date(`${d}T23:59:59-03:00`);

function chaveParaTela(c: any, chamadas24h = 0) {
  return {
    id: c.id,
    nome: c.nome,
    descricao: c.descricao,
    prefixo: c.prefixo,
    permissoes: lerPermissoes(c.permissoes),
    ipsPermitidos: c.ipsPermitidos,
    limitePorMinuto: c.limitePorMinuto,
    permitirNaUrl: c.permitirNaUrl,
    expiraEm: c.expiraEm,
    vencida: !!c.expiraEm && c.expiraEm.getTime() < Date.now(),
    ativo: c.ativo,
    ultimoUsoEm: c.ultimoUsoEm,
    ultimoIp: c.ultimoIp,
    totalChamadas: c.totalChamadas,
    chamadas24h,
    criadoEm: c.criadoEm,
  };
}

function webhookParaTela(w: any) {
  return {
    id: w.id,
    nome: w.nome,
    url: w.url,
    eventos: lerEventos(w.eventos),
    ativo: w.ativo,
    ultimoEnvioEm: w.ultimoEnvioEm,
    ultimoStatus: w.ultimoStatus,
    falhasSeguidas: w.falhasSeguidas,
    criadoEm: w.criadoEm,
  };
}

export default async function apiExternaRoutes(app: FastifyInstance) {
  // ======================================================================= tela do ADMIN
  app.get('/api/v1/api-externa/resumo', async () => {
    const desde = new Date(Date.now() - 86_400_000);
    const [chaves, ativas, webhooks, chamadas24h, erros24h, pendentes] = await Promise.all([
      prisma.chaveApi.count(),
      prisma.chaveApi.count({ where: { ativo: true } }),
      prisma.webhookSaida.count({ where: { ativo: true } }),
      prisma.logApi.count({ where: { data: { gte: desde } } }),
      prisma.logApi.count({ where: { data: { gte: desde }, status: { gte: 400 } } }),
      prisma.entregaWebhook.count({ where: { status: 'PENDENTE' } }),
    ]);
    const base = urlBaseApi();
    return { chaves, ativas, webhooks, chamadas24h, erros24h, entregasPendentes: pendentes, urlBase: base, urlMcp: `${base}/mcp`, urlOpenApi: `${base}/externo/openapi.json` };
  });

  app.get('/api/v1/api-externa/recursos', async () => ({
    niveis: NIVEIS,
    recursos: RECURSOS.map(({ chave, nome, descricao, maximo }) => ({ chave, nome, descricao, maximo: maximo ?? 'TOTAL' })),
    endpoints: ENDPOINTS,
    eventos: EVENTOS_WEBHOOK,
    ferramentasMcp: ferramentasMcp(null).map((f) => ({ nome: f.name, titulo: f.title, descricao: f.description, recurso: f.recurso, nivel: f.nivel })),
  }));

  // ---- chaves
  app.get('/api/v1/api-externa/chaves', async () => {
    const chaves = await prisma.chaveApi.findMany({ orderBy: [{ ativo: 'desc' }, { nome: 'asc' }] });
    const desde = new Date(Date.now() - 86_400_000);
    const contagem = await prisma.logApi.groupBy({ by: ['chaveId'], where: { data: { gte: desde } }, _count: { _all: true } });
    const mapa = new Map(contagem.map((c) => [c.chaveId, c._count._all]));
    return chaves.map((c) => chaveParaTela(c, mapa.get(c.id) ?? 0));
  });

  app.post('/api/v1/api-externa/chaves', async (req, reply) => {
    const b = chaveSchema.parse(req.body);
    const permissoes = limparPermissoes(b.permissoes);
    if (!Object.keys(permissoes).length) throw new AppError('Libere pelo menos uma área (leitura ou gravação) para a chave.', 422, 'SEM_PERMISSOES');
    const g = gerarChave();
    const c = await prisma.chaveApi.create({
      data: {
        nome: b.nome,
        descricao: b.descricao || null,
        prefixo: g.prefixo,
        hash: g.hash,
        permissoes: JSON.stringify(permissoes),
        ipsPermitidos: b.ipsPermitidos,
        limitePorMinuto: b.limitePorMinuto,
        permitirNaUrl: b.permitirNaUrl,
        expiraEm: b.expiraEm ? fimDoDia(b.expiraEm) : null,
        ativo: b.ativo,
        criadoPorId: req.user?.id ?? null,
      },
    });
    await auditar(req, 'ChaveApi', c.id, 'CRIAR', { nome: c.nome, permissoes });
    return reply.code(201).send({ ...chaveParaTela(c), chave: g.chave });
  });

  app.put('/api/v1/api-externa/chaves/:id', async (req) => {
    const id = idDe(req);
    const atual = await prisma.chaveApi.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Chave');
    const b = chaveAlteracaoSchema.parse(req.body);
    const data: any = {};
    if (b.nome !== undefined) data.nome = b.nome;
    if (b.descricao !== undefined) data.descricao = b.descricao || null;
    if (b.permissoes !== undefined) {
      const p = limparPermissoes(b.permissoes);
      if (!Object.keys(p).length) throw new AppError('Libere pelo menos uma área para a chave (ou desative a chave).', 422, 'SEM_PERMISSOES');
      data.permissoes = JSON.stringify(p);
    }
    if (b.ipsPermitidos !== undefined) data.ipsPermitidos = b.ipsPermitidos;
    if (b.limitePorMinuto !== undefined) data.limitePorMinuto = b.limitePorMinuto;
    if (b.permitirNaUrl !== undefined) data.permitirNaUrl = b.permitirNaUrl;
    if (b.expiraEm !== undefined) data.expiraEm = b.expiraEm ? fimDoDia(b.expiraEm) : null;
    if (b.ativo !== undefined) data.ativo = b.ativo;
    const c = await prisma.chaveApi.update({ where: { id }, data });
    limparCacheChaves();
    await auditar(req, 'ChaveApi', id, 'ALTERAR', { ...data, permissoes: data.permissoes ? JSON.parse(data.permissoes) : undefined });
    return chaveParaTela(c);
  });

  app.post('/api/v1/api-externa/chaves/:id/regenerar', async (req) => {
    const id = idDe(req);
    if (!(await prisma.chaveApi.findUnique({ where: { id } }))) throw new NotFound('Chave');
    const g = gerarChave();
    const c = await prisma.chaveApi.update({ where: { id }, data: { prefixo: g.prefixo, hash: g.hash } });
    limparCacheChaves();
    await auditar(req, 'ChaveApi', id, 'ACAO', { acao: 'regenerar', nome: c.nome });
    return { ...chaveParaTela(c), chave: g.chave };
  });

  app.delete('/api/v1/api-externa/chaves/:id', async (req) => {
    const id = idDe(req);
    const c = await prisma.chaveApi.findUnique({ where: { id } });
    if (!c) throw new NotFound('Chave');
    await prisma.chaveApi.delete({ where: { id } });
    limparCacheChaves();
    await auditar(req, 'ChaveApi', id, 'EXCLUIR', { nome: c.nome });
    return { ok: true };
  });

  // ---- registro de chamadas
  app.get('/api/v1/api-externa/logs', async (req) => {
    const q = z
      .object({
        chaveId: z.coerce.number().int().positive().optional(),
        erros: z.enum(['true', 'false']).optional(),
        origem: z.enum(['API', 'MCP']).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const where: any = { chaveId: q.chaveId, origem: q.origem };
    if (q.erros === 'true') where.status = { gte: 400 };
    const [total, data] = await Promise.all([
      prisma.logApi.count({ where }),
      prisma.logApi.findMany({ where, orderBy: { id: 'desc' }, skip: (q.pagina - 1) * q.limite, take: q.limite, include: { chave: { select: { id: true, nome: true } } } }),
    ]);
    return { data, meta: { total, pagina: q.pagina, limite: q.limite, totalPaginas: Math.max(1, Math.ceil(total / q.limite)) } };
  });

  // ---- webhooks
  app.get('/api/v1/api-externa/webhooks', async () => {
    const lista = await prisma.webhookSaida.findMany({ orderBy: { nome: 'asc' } });
    return lista.map(webhookParaTela);
  });

  app.post('/api/v1/api-externa/webhooks', async (req, reply) => {
    const b = webhookSchema.parse(req.body);
    const segredo = gerarSegredo();
    const w = await prisma.webhookSaida.create({ data: { nome: b.nome, url: b.url, eventos: JSON.stringify(limparEventos(b.eventos)), ativo: b.ativo, segredo: cifrarSegredo(segredo) } });
    await auditar(req, 'WebhookSaida', w.id, 'CRIAR', { nome: w.nome, url: w.url });
    return reply.code(201).send({ ...webhookParaTela(w), segredo });
  });

  app.put('/api/v1/api-externa/webhooks/:id', async (req) => {
    const id = idDe(req);
    if (!(await prisma.webhookSaida.findUnique({ where: { id } }))) throw new NotFound('Webhook');
    const b = webhookAlteracaoSchema.parse(req.body);
    const data: any = { ...b };
    if (b.eventos !== undefined) data.eventos = JSON.stringify(limparEventos(b.eventos));
    if (b.ativo === true) data.falhasSeguidas = 0;
    const w = await prisma.webhookSaida.update({ where: { id }, data });
    await auditar(req, 'WebhookSaida', id, 'ALTERAR', b);
    return webhookParaTela(w);
  });

  app.delete('/api/v1/api-externa/webhooks/:id', async (req) => {
    const id = idDe(req);
    const w = await prisma.webhookSaida.findUnique({ where: { id } });
    if (!w) throw new NotFound('Webhook');
    await prisma.webhookSaida.delete({ where: { id } });
    await auditar(req, 'WebhookSaida', id, 'EXCLUIR', { nome: w.nome });
    return { ok: true };
  });

  app.get('/api/v1/api-externa/webhooks/:id/segredo', async (req) => {
    const w = await prisma.webhookSaida.findUnique({ where: { id: idDe(req) } });
    if (!w) throw new NotFound('Webhook');
    return { segredo: lerSegredo(w.segredo) };
  });

  app.post('/api/v1/api-externa/webhooks/:id/segredo', async (req) => {
    const id = idDe(req);
    if (!(await prisma.webhookSaida.findUnique({ where: { id } }))) throw new NotFound('Webhook');
    const segredo = gerarSegredo();
    await prisma.webhookSaida.update({ where: { id }, data: { segredo: cifrarSegredo(segredo) } });
    await auditar(req, 'WebhookSaida', id, 'ACAO', { acao: 'novo segredo' });
    return { segredo };
  });

  app.post('/api/v1/api-externa/webhooks/:id/testar', async (req) => {
    const id = idDe(req);
    const w = await prisma.webhookSaida.findUnique({ where: { id } });
    if (!w) throw new NotFound('Webhook');
    const payload = JSON.stringify({ evento: 'teste', quando: new Date().toISOString(), sistema: 'MEU BLING', dados: { mensagem: 'Teste do MEU BLING: se você recebeu isto, o webhook está funcionando.', webhook: w.nome } });
    const e = await prisma.entregaWebhook.create({ data: { webhookId: id, evento: 'teste', payload, tentativas: 1 } });
    const r = await postar(w.url, lerSegredo(w.segredo), 'teste', e.id, payload);
    await prisma.entregaWebhook.update({ where: { id: e.id }, data: { status: r.ok ? 'ENTREGUE' : 'FALHOU', respostaStatus: r.status, resposta: r.resposta, entregueEm: r.ok ? new Date() : null } });
    await prisma.webhookSaida.update({ where: { id }, data: { ultimoEnvioEm: new Date(), ultimoStatus: r.status, falhasSeguidas: r.ok ? 0 : { increment: 1 } } });
    return { ok: r.ok, status: r.status, resposta: r.resposta, ms: r.ms };
  });

  app.get('/api/v1/api-externa/webhooks/:id/entregas', async (req) => {
    const id = idDe(req);
    const q = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return prisma.entregaWebhook.findMany({ where: { webhookId: id }, orderBy: { id: 'desc' }, take: q.limite });
  });

  app.post('/api/v1/api-externa/entregas/:id/reenviar', async (req) => {
    const id = idDe(req);
    const e = await prisma.entregaWebhook.findUnique({ where: { id } });
    if (!e) throw new NotFound('Entrega');
    await prisma.entregaWebhook.update({ where: { id }, data: { status: 'PENDENTE', tentativas: 0, proximaTentativa: new Date() } });
    await processarFila();
    return prisma.entregaWebhook.findUnique({ where: { id } });
  });

  // ======================================================================= quem chama com chave
  app.get('/api/v1/externo/eu', async (req) => {
    const base = urlBaseApi();
    const c = req.chaveApi;
    const enderecos = { api: base, openapi: `${base}/externo/openapi.json`, mcp: `${base}/mcp` };
    if (!c) return { tipo: 'USUARIO', usuario: { id: req.user.id, nome: req.user.nome, perfil: req.user.perfil }, enderecos };
    return {
      tipo: 'CHAVE_API',
      chave: { id: c.id, nome: c.nome },
      permissoes: RECURSOS.filter((r) => c.permissoes[r.chave]).map((r) => ({ recurso: r.chave, nome: r.nome, nivel: c.permissoes[r.chave] })),
      endpoints: endpointsPermitidos(c.permissoes).length,
      enderecos,
    };
  });

  app.get('/api/v1/externo/openapi.json', async (req) => montarOpenApi(req.chaveApi ? req.chaveApi.permissoes : null));

  const mcp = async (req: any, reply: any) => {
    const r = await tratarMcp(app, req);
    if (r === null) return reply.code(202).send();
    return reply.header('cache-control', 'no-store').send(r);
  };
  app.post('/api/v1/mcp', mcp);
  // sem fluxo SSE: o protocolo pede 405 no GET
  app.get('/api/v1/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send({ erro: 'Use POST (JSON-RPC) neste endereço.', code: 'METODO' }));
  app.post('/api/v1/mcp/:chave', async (req, reply) => {
    const { chave } = req.params as { chave: string };
    // só chega aqui com a chave da URL já conferida pelo plugin de autenticação
    if (!pareceChave(chave) || !req.chaveApi) return reply.code(404).send({ erro: 'Endereço do MCP inválido.', code: 'NAO_ENCONTRADO' });
    return mcp(req, reply);
  });
}

registrarServico('limpeza-registro-api', () => {
  setInterval(() => void limparLogsAntigos(30).catch(() => undefined), 6 * 3_600_000).unref();
});
