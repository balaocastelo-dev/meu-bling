/**
 * PAINEL DE AUDITORIA — rotas (só ADMIN + senha do dia; nunca abre para chave de API).
 *
 *   POST /api/v1/auditoria/painel/entrar                 { senha } → token do painel (4 h)
 *   GET  /api/v1/auditoria/painel/resumo                 números do topo (hoje, por categoria, achados, agentes)
 *   GET  /api/v1/auditoria/painel/operacoes              histórico de operações (filtros: período, usuário, categoria, origem, tabela, registro, texto; paginação)
 *   GET  /api/v1/auditoria/painel/ao-vivo?desde=ISO      o que aconteceu desde X (a tela pergunta a cada 3 s)
 *   GET  /api/v1/auditoria/painel/operacoes/:op          a operação aberta: cada registro com antes/depois, ações legíveis e a prévia da reversão
 *   POST /api/v1/auditoria/painel/reverter/:op           { forcar?, motivo? } desfaz a operação inteira
 *   GET  /api/v1/auditoria/painel/registro/:tabela/:id   a vida de um registro (todas as operações que o tocaram)
 *   GET  /api/v1/auditoria/painel/funcionarios           por pessoa: operações por categoria, última atividade, fora do horário, achados
 *   GET  /api/v1/auditoria/painel/historico-antigo       a auditoria legível desde o primeiro dia do sistema (antes da trilha)
 *   GET  /api/v1/auditoria/painel/achados                o que os agentes encontraram · POST …/achados/:id/status
 *   GET  /api/v1/auditoria/painel/agentes                agentes, estado e configuração · POST …/agentes/rodar · PUT …/agentes/config
 *   POST /api/v1/auditoria/painel/analista/analisar      pede a análise ao Claude · PUT …/analista/chave
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { auditar, mascarar } from '../../lib/auditoria.js';
import { registrarServico } from '../../core/servicos.js';
import { conferirSenha, emitirTokenPainel, exigirPainel } from './acesso.js';
import { clienteSemTrilha, CATEGORIA_TABELA } from './trilha.js';
import { descreverOperacao, lerJson, linkRegistro, nomeTabela, rotuloRegistro, rotuloRota } from './operacoes.js';
import { previaReversao, reverterOperacao } from './reversao.js';
import { AGENTES, INTERVALO_MS, gravarConfig, lerConfig, lerEstado, rodarAgentes } from './agentes.js';
import { analisar, chaveConfigurada, gravarChave, ultimoRelatorio } from './analista.js';
import { descreverAuditorias } from '../dashboard/atividades.js';

export const CATEGORIAS: { chave: string; rotulo: string }[] = [
  { chave: 'vendas', rotulo: 'Vendas e orçamentos' },
  { chave: 'os', rotulo: 'Assistência (OS)' },
  { chave: 'compras', rotulo: 'Compras' },
  { chave: 'financeiro', rotulo: 'Financeiro' },
  { chave: 'estoque', rotulo: 'Produtos e estoque' },
  { chave: 'fiscal', rotulo: 'Notas fiscais' },
  { chave: 'consignacao', rotulo: 'Consignação' },
  { chave: 'comissoes', rotulo: 'Comissões e metas' },
  { chave: 'cadastros', rotulo: 'Cadastros' },
  { chave: 'comunicacao', rotulo: 'Mensagens' },
  { chave: 'acessos', rotulo: 'Acessos e usuários' },
  { chave: 'configuracoes', rotulo: 'Configurações' },
  { chave: 'sistema', rotulo: 'Sistema e robôs' },
];

const db = () => clienteSemTrilha();
const paginacao = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50), pagina: z.coerce.number().int().min(1).default(1) });
const periodo = z.object({ dataInicial: z.string().optional(), dataFinal: z.string().optional() });
function intervalo(q: { dataInicial?: string; dataFinal?: string }) {
  const ini = q.dataInicial ? new Date(`${q.dataInicial}T00:00:00-03:00`) : undefined;
  const fim = q.dataFinal ? new Date(`${q.dataFinal}T23:59:59.999-03:00`) : undefined;
  return { ini: ini && !Number.isNaN(ini.getTime()) ? ini : undefined, fim: fim && !Number.isNaN(fim.getTime()) ? fim : undefined };
}
const quem = (req: any) => ({ id: req.user?.id ?? null, nome: req.user?.nome || 'ADMIN' });

function eventoParaTela(e: { id: number; sequencia: number; quando: Date; tabela: string; registroId: number | null; registroChave: string | null; tipo: string; antes: string | null; depois: string | null; campos: string | null; modo: string; reversivel: boolean; revertidoEm: Date | null }) {
  const antes = lerJson(e.antes);
  const depois = lerJson(e.depois);
  const snap = depois ?? antes;
  return {
    id: e.id,
    sequencia: e.sequencia,
    quando: e.quando,
    tabela: e.tabela,
    tabelaNome: nomeTabela(e.tabela),
    categoria: CATEGORIA_TABELA[e.tabela] ?? 'sistema',
    registroId: e.registroId,
    registroChave: e.registroChave,
    tipo: e.tipo,
    modo: e.modo,
    reversivel: e.reversivel,
    revertidoEm: e.revertidoEm,
    rotulo: rotuloRegistro(e.tabela, e.registroId, e.registroChave, snap),
    link: linkRegistro(e.tabela, e.registroId, snap),
    campos: (() => {
      try {
        return e.campos ? (JSON.parse(e.campos) as string[]) : [];
      } catch {
        return [];
      }
    })(),
    antes: mascarar(antes),
    depois: mascarar(depois),
  };
}

// ---------------------------------------------------------------- serviço: agentes 24h + analista 1x/dia
registrarServico('agentes-auditoria', (app) => {
  if (process.env.AGENTES_AUDITORIA === 'off') {
    app.log.info('[auditoria] agentes desligados (AGENTES_AUDITORIA=off)');
    return;
  }
  const rodada = () =>
    rodarAgentes('agendado')
      .then((e) => e?.novos && app.log.info(`[auditoria] agentes: ${e.novos} achado(s) novo(s)`))
      .catch((e) => app.log.error({ e }, '[auditoria] falha nos agentes'));
  setTimeout(rodada, 90_000).unref();
  setInterval(rodada, INTERVALO_MS).unref();
  // analista: uma vez por dia, de manhã (06:30 em São Paulo), se houver chave
  setInterval(async () => {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', hour12: false }).format(new Date());
    if (!/^0?6:3\d$/.test(h.replace(/^24/, '0'))) return;
    const ultimo = await ultimoRelatorio();
    if (ultimo && Date.now() - new Date(ultimo.geradoEm).getTime() < 20 * 3600_000) return;
    if (await chaveConfigurada()) await analisar('análise diária').catch((e) => app.log.error({ e }, '[auditoria] analista falhou'));
  }, 10 * 60_000).unref();
});

export default async function auditoriaPainelRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.exigirPerfil('ADMIN') };
  const painel = { preHandler: [app.exigirPerfil('ADMIN'), exigirPainel] };

  // ---------------------------------------------------------------- senha do dia
  app.post('/api/v1/auditoria/painel/entrar', { ...admin, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (req.chaveApi) throw new AppError('O Painel de auditoria não abre por chave de API.', 403, 'SEM_PERMISSAO');
    const { senha } = z.object({ senha: z.string().min(1).max(60) }).parse(req.body ?? {});
    const ok = await conferirSenha(senha);
    await auditar(req, 'PainelAuditoria', null, 'ACAO', { acao: 'painel-entrar', ok });
    if (!ok) {
      await new Promise((r) => setTimeout(r, 600));
      return reply.code(403).send({ erro: 'Senha do dia incorreta.', code: 'PAINEL_SENHA_ERRADA' });
    }
    return emitirTokenPainel(req.user.id);
  });

  // ---------------------------------------------------------------- resumo (topo)
  app.get('/api/v1/auditoria/painel/resumo', painel, async () => {
    const d = db();
    const hojeIni = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T00:00:00-03:00');
    const [hoje, porCategoria, usuarios, achados, primeira, total, estado, cfg, ultimaOp] = await Promise.all([
      d.auditoriaOperacao.count({ where: { inicio: { gte: hojeIni } } }),
      d.auditoriaOperacao.groupBy({ by: ['categoria'], where: { inicio: { gte: hojeIni } }, _count: { _all: true } }),
      d.auditoriaOperacao.groupBy({ by: ['usuario'], where: { inicio: { gte: hojeIni } }, _count: { _all: true }, _max: { inicio: true } }),
      d.auditoriaAchado.groupBy({ by: ['nivel'], where: { status: { in: ['ABERTO', 'VISTO'] } }, _count: { _all: true } }),
      d.auditoria.findFirst({ orderBy: { id: 'asc' }, select: { data: true } }),
      d.auditoriaOperacao.count(),
      lerEstado(),
      lerConfig(),
      d.auditoriaOperacao.findFirst({ orderBy: { inicio: 'desc' }, select: { inicio: true } }),
    ]);
    const niveis = { alto: 0, medio: 0, baixo: 0 } as Record<string, number>;
    for (const a of achados) niveis[a.nivel] = a._count._all;
    return {
      agora: new Date().toISOString(),
      hoje: { operacoes: hoje, porCategoria: porCategoria.map((c) => ({ categoria: c.categoria, n: c._count._all })), usuarios: usuarios.map((u) => ({ usuario: u.usuario, n: u._count._all, ultima: u._max.inicio })) },
      achados: niveis,
      totalOperacoes: total,
      historicoDesde: primeira?.data ?? null,
      ultimaOperacao: ultimaOp?.inicio ?? null,
      agentes: { ligado: cfg.ligado, ultimaVez: estado?.ultimaVez ?? null, erro: estado?.erro ?? null },
      categorias: CATEGORIAS,
    };
  });

  // ---------------------------------------------------------------- histórico de operações
  const filtrosOperacoes = periodo.extend({
    usuarioId: z.coerce.number().int().optional(),
    usuario: z.string().optional(),
    categoria: z.string().optional(),
    origem: z.string().optional(),
    tabela: z.string().optional(),
    registroId: z.coerce.number().int().optional(),
    q: z.string().optional(),
    /** 1 = só operações que gravaram algo; 0 = inclui logins/ações sem gravação */
    somenteGravacoes: z.coerce.number().optional(),
    /** 1 = esconde serviços de fundo (robôs) */
    semRobos: z.coerce.number().optional(),
    revertidas: z.coerce.number().optional(),
  });
  async function listarOperacoes(q: z.infer<typeof filtrosOperacoes> & z.infer<typeof paginacao>) {
    const { ini, fim } = intervalo(q);
    const where: any = {};
    if (ini || fim) where.inicio = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
    if (q.usuarioId) where.usuarioId = q.usuarioId;
    if (q.usuario) where.usuario = { contains: q.usuario };
    if (q.categoria) where.categoria = q.categoria;
    if (q.origem) where.origem = q.origem;
    if (q.semRobos) where.origem = { notIn: ['SERVICO', 'SISTEMA'] };
    if (q.revertidas) where.revertidaEm = { not: null };
    if (q.tabela || q.registroId) where.eventos = { some: { ...(q.tabela ? { tabela: q.tabela } : {}), ...(q.registroId ? { registroId: q.registroId } : {}) } };
    if (q.somenteGravacoes) where.eventos = { ...(where.eventos ?? {}), some: { ...(where.eventos?.some ?? {}) } };
    if (q.q) where.OR = [{ descricao: { contains: q.q } }, { usuario: { contains: q.q } }, { rota: { contains: q.q } }];
    const [total, ops] = await Promise.all([
      db().auditoriaOperacao.count({ where }),
      db().auditoriaOperacao.findMany({
        where,
        orderBy: { inicio: 'desc' },
        skip: (q.pagina - 1) * q.limite,
        take: q.limite,
        include: { _count: { select: { eventos: true } } },
      }),
    ]);
    return { total, pagina: q.pagina, limite: q.limite, itens: ops.map(operacaoParaTela) };
  }
  function operacaoParaTela(o: any) {
    return {
      id: o.id,
      inicio: o.inicio,
      fim: o.fim,
      usuarioId: o.usuarioId,
      usuario: o.usuario,
      origem: o.origem,
      rota: o.rota,
      rotulo: rotuloRota(o.rota),
      ip: o.ip,
      status: o.status,
      categoria: o.categoria,
      descricao: o.descricao,
      eventos: o._count?.eventos ?? 0,
      revertidaEm: o.revertidaEm,
      revertidaPor: o.revertidaPor,
      revertidaOpId: o.revertidaOpId,
      reverteOpId: o.reverteOpId,
    };
  }
  app.get('/api/v1/auditoria/painel/operacoes', painel, async (req) => listarOperacoes(filtrosOperacoes.merge(paginacao).parse(req.query ?? {})));

  // ---------------------------------------------------------------- ao vivo
  app.get('/api/v1/auditoria/painel/ao-vivo', painel, async (req) => {
    const q = z.object({ desde: z.string().optional(), semRobos: z.coerce.number().optional(), limite: z.coerce.number().int().min(1).max(200).default(60) }).parse(req.query ?? {});
    const desde = q.desde ? new Date(q.desde) : new Date(Date.now() - 2 * 3600_000);
    const d = Number.isNaN(desde.getTime()) ? new Date(Date.now() - 2 * 3600_000) : desde;
    const where: any = { OR: [{ inicio: { gte: d } }, { fim: { gte: d } }] };
    if (q.semRobos) where.origem = { notIn: ['SERVICO', 'SISTEMA'] };
    const ops = await db().auditoriaOperacao.findMany({ where, orderBy: { inicio: 'desc' }, take: q.limite, include: { _count: { select: { eventos: true } } } });
    const abertos = await db().auditoriaAchado.count({ where: { status: 'ABERTO' } });
    return { agora: new Date().toISOString(), itens: ops.map(operacaoParaTela), achadosAbertos: abertos };
  });

  // ---------------------------------------------------------------- uma operação
  app.get('/api/v1/auditoria/painel/operacoes/:op', painel, async (req) => {
    const id = String((req.params as any).op);
    const op = await db().auditoriaOperacao.findUnique({ where: { id }, include: { eventos: { orderBy: { sequencia: 'asc' } }, _count: { select: { eventos: true } } } });
    if (!op) throw new AppError('Operação não encontrada.', 404, 'NAO_ENCONTRADO');
    const auditorias = await db().auditoria.findMany({ where: { operacaoId: id }, orderBy: { id: 'asc' }, select: { id: true, entidade: true, entidadeId: true, acao: true, detalhes: true, data: true, usuario: { select: { nome: true } } } });
    const frases = await descreverAuditorias(auditorias);
    const previa = op.eventos.length ? await previaReversao(id).catch((e) => ({ bloqueios: [(e as Error).message], avisos: [], passos: [], podeReverter: false, precisaConfirmar: false })) : null;
    const [reversao, original] = await Promise.all([
      op.revertidaOpId ? db().auditoriaOperacao.findUnique({ where: { id: op.revertidaOpId }, select: { id: true, inicio: true, usuario: true, descricao: true } }) : null,
      op.reverteOpId ? db().auditoriaOperacao.findUnique({ where: { id: op.reverteOpId }, select: { id: true, inicio: true, usuario: true, descricao: true } }) : null,
    ]);
    return {
      ...operacaoParaTela(op),
      descricao: op.descricao ?? (await descreverOperacao(id)),
      acoes: frases.map((f) => ({ ...f, quando: auditorias.find((a) => a.id === f.id)?.data ?? null })),
      eventos: op.eventos.map(eventoParaTela),
      previa: previa && { bloqueios: previa.bloqueios, avisos: previa.avisos, podeReverter: previa.podeReverter, precisaConfirmar: previa.precisaConfirmar, passos: previa.passos.map((p) => ({ acao: p.acao, rotulo: p.rotulo, campos: p.campos, motivo: p.motivo ?? null, link: p.link })) },
      reversao,
      original,
    };
  });

  app.post('/api/v1/auditoria/painel/reverter/:op', painel, async (req) => {
    const id = String((req.params as any).op);
    const body = z.object({ forcar: z.boolean().optional(), motivo: z.string().max(300).optional() }).parse(req.body ?? {});
    // a própria reversão vira uma operação REVERSAO na trilha (com quem fez e o IP) — não precisa de auditoria à parte
    const r = await reverterOperacao(id, { forcar: !!body.forcar, quem: quem(req), ip: req.ip, motivo: body.motivo });
    return { ok: true, feitos: r.feitos, pulados: r.pulados, reversaoId: r.reversaoId };
  });

  // ---------------------------------------------------------------- a vida de um registro
  app.get('/api/v1/auditoria/painel/registro/:tabela/:id', painel, async (req) => {
    const { tabela } = z.object({ tabela: z.string().regex(/^[A-Za-z]+$/) }).parse(req.params);
    const registroId = Number((req.params as any).id);
    const eventos = await db().auditoriaEvento.findMany({ where: { tabela, registroId }, orderBy: { id: 'asc' }, include: { operacao: true }, take: 500 });
    return {
      tabela,
      tabelaNome: nomeTabela(tabela),
      registroId,
      rotulo: eventos.length ? rotuloRegistro(tabela, registroId, null, lerJson(eventos[eventos.length - 1].depois) ?? lerJson(eventos[eventos.length - 1].antes)) : `${nomeTabela(tabela)} #${registroId}`,
      eventos: eventos.map((e) => ({ ...eventoParaTela(e), operacao: operacaoParaTela({ ...e.operacao, _count: undefined }) })),
    };
  });

  // ---------------------------------------------------------------- por funcionário
  app.get('/api/v1/auditoria/painel/funcionarios', painel, async (req) => {
    const q = periodo.parse(req.query ?? {});
    const { ini, fim } = intervalo(q);
    const cfg = await lerConfig();
    const whereOp: any = { usuarioId: { not: null } };
    if (ini || fim) whereOp.inicio = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
    const [ops, usuarios, achados, logins] = await Promise.all([
      db().auditoriaOperacao.findMany({ where: whereOp, select: { usuarioId: true, usuario: true, categoria: true, inicio: true, origem: true, revertidaEm: true, status: true, eventos: { select: { tipo: true } } }, take: 50000 }),
      db().usuario.findMany({ select: { id: true, nome: true, perfil: true, ativo: true, ultimoLogin: true } }),
      db().auditoriaAchado.groupBy({ by: ['usuarioId', 'nivel'], where: { status: { in: ['ABERTO', 'VISTO'] }, usuarioId: { not: null } }, _count: { _all: true } }),
      db().auditoria.groupBy({ by: ['usuarioId'], where: { acao: 'LOGIN', ...(ini || fim ? { data: { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) } } : {}) }, _count: { _all: true } }),
    ]);
    const porUsuario = new Map<number, { usuarioId: number; nome: string; perfil: string; ativo: boolean; ultimoLogin: Date | null; operacoes: number; porCategoria: Record<string, number>; criados: number; alterados: number; excluidos: number; foraHorario: number; revertidas: number; comErro: number; ultima: Date | null; logins: number; achados: Record<string, number>; apis: number }>();
    for (const u of usuarios) porUsuario.set(u.id, { usuarioId: u.id, nome: u.nome, perfil: u.perfil, ativo: u.ativo, ultimoLogin: u.ultimoLogin, operacoes: 0, porCategoria: {}, criados: 0, alterados: 0, excluidos: 0, foraHorario: 0, revertidas: 0, comErro: 0, ultima: null, logins: 0, achados: { alto: 0, medio: 0, baixo: 0 }, apis: 0 });
    for (const o of ops) {
      const r = porUsuario.get(o.usuarioId!);
      if (!r) continue;
      if (o.origem === 'API' || o.origem === 'MCP') {
        r.apis++;
        continue;
      }
      r.operacoes++;
      r.porCategoria[o.categoria] = (r.porCategoria[o.categoria] ?? 0) + 1;
      for (const e of o.eventos) {
        if (e.tipo === 'CRIAR') r.criados++;
        else if (e.tipo === 'ALTERAR') r.alterados++;
        else r.excluidos++;
      }
      const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(o.inicio);
      const hora = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24;
      if (p.find((x) => x.type === 'weekday')?.value === 'Sun' || hora < cfg.horaInicio || hora >= cfg.horaFim) r.foraHorario++;
      if (o.revertidaEm) r.revertidas++;
      if ((o.status ?? 200) >= 500 && o.eventos.length) r.comErro++;
      if (!r.ultima || o.inicio > r.ultima) r.ultima = o.inicio;
    }
    for (const a of achados) if (a.usuarioId && porUsuario.has(a.usuarioId)) porUsuario.get(a.usuarioId)!.achados[a.nivel] = a._count._all;
    for (const l of logins) if (l.usuarioId && porUsuario.has(l.usuarioId)) porUsuario.get(l.usuarioId)!.logins = l._count._all;
    const semUsuario = ops.filter((o) => !porUsuario.has(o.usuarioId!)).length;
    return { itens: [...porUsuario.values()].sort((a, b) => b.operacoes - a.operacoes), semUsuario, horario: { inicio: cfg.horaInicio, fim: cfg.horaFim } };
  });

  // ---------------------------------------------------------------- histórico antigo (auditoria legível desde o início)
  app.get('/api/v1/auditoria/painel/historico-antigo', painel, async (req) => {
    const q = periodo.merge(paginacao).extend({ usuarioId: z.coerce.number().int().optional(), entidade: z.string().optional(), acao: z.string().optional(), q: z.string().optional() }).parse(req.query ?? {});
    const { ini, fim } = intervalo(q);
    const where: any = {};
    if (ini || fim) where.data = { ...(ini ? { gte: ini } : {}), ...(fim ? { lte: fim } : {}) };
    if (q.usuarioId) where.usuarioId = q.usuarioId;
    if (q.entidade) where.entidade = q.entidade;
    if (q.acao) where.acao = q.acao;
    if (q.q) where.detalhes = { contains: q.q };
    const [total, regs] = await Promise.all([
      db().auditoria.count({ where }),
      db().auditoria.findMany({ where, orderBy: { id: 'desc' }, skip: (q.pagina - 1) * q.limite, take: q.limite, select: { id: true, data: true, entidade: true, entidadeId: true, acao: true, detalhes: true, ip: true, operacaoId: true, usuario: { select: { id: true, nome: true } } } }),
    ]);
    const frases = await descreverAuditorias(regs);
    return {
      total,
      pagina: q.pagina,
      limite: q.limite,
      itens: regs.map((r) => {
        const f = frases.find((x) => x.id === r.id);
        return { id: r.id, quando: r.data, usuario: r.usuario?.nome ?? (lerJson(r.detalhes)?.viaApi as string | undefined) ?? 'Sistema', usuarioId: r.usuario?.id ?? null, entidade: r.entidade, entidadeId: r.entidadeId, acao: r.acao, texto: f?.texto ?? `${r.acao.toLowerCase()} ${r.entidade}`, tom: f?.tom ?? 'neutro', link: f?.link ?? null, categoria: f?.categoria ?? 'sistema', detalhes: mascarar(lerJson(r.detalhes)), ip: r.ip, operacaoId: r.operacaoId };
      }),
    };
  });

  // ---------------------------------------------------------------- achados dos agentes
  app.get('/api/v1/auditoria/painel/achados', painel, async (req) => {
    const q = paginacao.extend({ status: z.string().optional(), nivel: z.string().optional(), agente: z.string().optional(), usuarioId: z.coerce.number().int().optional(), categoria: z.string().optional() }).parse(req.query ?? {});
    const where: any = {};
    where.status = q.status ? { in: q.status.split(',') } : { in: ['ABERTO', 'VISTO'] };
    if (q.nivel) where.nivel = q.nivel;
    if (q.agente) where.agente = q.agente;
    if (q.usuarioId) where.usuarioId = q.usuarioId;
    if (q.categoria) where.categoria = q.categoria;
    const [total, itens] = await Promise.all([
      db().auditoriaAchado.count({ where }),
      db().auditoriaAchado.findMany({ where, orderBy: [{ status: 'asc' }, { nivel: 'asc' }, { atualizadoEm: 'desc' }], skip: (q.pagina - 1) * q.limite, take: q.limite }),
    ]);
    const nomes = new Map(AGENTES.map((a) => [a.codigo, a.nome]));
    nomes.set('analista', 'Analista (Claude)');
    return {
      total,
      pagina: q.pagina,
      limite: q.limite,
      itens: itens.map((a) => ({ ...a, agenteNome: nomes.get(a.agente) ?? a.agente, evidencias: lerJsonLista(a.evidencias), link: a.tabela && a.registroId ? linkRegistro(a.tabela, a.registroId, null) : null })),
    };
  });
  app.post('/api/v1/auditoria/painel/achados/:id/status', painel, async (req) => {
    const id = Number((req.params as any).id);
    const { status } = z.object({ status: z.enum(['ABERTO', 'VISTO', 'IGNORADO', 'RESOLVIDO']) }).parse(req.body ?? {});
    const a = await db().auditoriaAchado.update({ where: { id }, data: { status, vistoPor: quem(req).nome, vistoEm: new Date() } });
    return { ok: true, achado: a };
  });

  // ---------------------------------------------------------------- agentes
  app.get('/api/v1/auditoria/painel/agentes', painel, async () => {
    const [cfg, estado, temChave, relatorio] = await Promise.all([lerConfig(), lerEstado(), chaveConfigurada(), ultimoRelatorio()]);
    const abertos = await db().auditoriaAchado.groupBy({ by: ['agente'], where: { status: { in: ['ABERTO', 'VISTO'] } }, _count: { _all: true } });
    const porAgente = new Map(abertos.map((a) => [a.agente, a._count._all]));
    return {
      config: cfg,
      estado,
      intervaloMin: INTERVALO_MS / 60000,
      agentes: AGENTES.map((a) => ({ codigo: a.codigo, nome: a.nome, descricao: a.descricao, janelaDias: a.janelaDias, ligado: !cfg.desligados.includes(a.codigo), abertos: porAgente.get(a.codigo) ?? 0, ultima: estado?.porAgente?.[a.codigo] ?? null })),
      analista: { chaveConfigurada: temChave, modelo: cfg.modeloIa, ultimo: relatorio, abertos: porAgente.get('analista') ?? 0 },
    };
  });
  app.post('/api/v1/auditoria/painel/agentes/rodar', painel, async (req) => {
    const body = z.object({ apenas: z.array(z.string()).optional() }).parse(req.body ?? {});
    const estado = await rodarAgentes(`na mão (${quem(req).nome})`, { apenas: body.apenas, forcar: true });
    await auditar(req, 'PainelAuditoria', null, 'ACAO', { acao: 'rodar-agentes', apenas: body.apenas ?? null });
    return estado;
  });
  app.put('/api/v1/auditoria/painel/agentes/config', painel, async (req) => {
    const body = z
      .object({ ligado: z.boolean().optional(), horaInicio: z.number().int().min(0).max(23).optional(), horaFim: z.number().int().min(1).max(24).optional(), descontoMaxPct: z.number().min(0).max(100).optional(), saidaManualAlerta: z.number().min(0).optional(), modeloIa: z.string().min(3).max(60).optional(), desligados: z.array(z.string()).optional() })
      .strict()
      .parse(req.body ?? {});
    const cfg = await gravarConfig(body);
    await auditar(req, 'PainelAuditoria', null, 'ALTERAR', { config: cfg });
    return cfg;
  });
  app.post('/api/v1/auditoria/painel/analista/analisar', { ...painel, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const r = await analisar(`pedido por ${quem(req).nome}`);
    await auditar(req, 'PainelAuditoria', null, 'ACAO', { acao: 'analista', erro: r.erro ?? null, pontos: r.pontos.length });
    return r;
  });
  app.put('/api/v1/auditoria/painel/analista/chave', painel, async (req) => {
    const { chave } = z.object({ chave: z.string().max(400).nullable() }).parse(req.body ?? {});
    await gravarChave(chave);
    await auditar(req, 'PainelAuditoria', null, 'ALTERAR', { acao: 'analista-chave', configurada: !!chave });
    return { ok: true, chaveConfigurada: !!chave };
  });

  // ---------------------------------------------------------------- categorias (para filtros)
  app.get('/api/v1/auditoria/painel/categorias', painel, async () => ({ categorias: CATEGORIAS, tabelas: Object.entries(CATEGORIA_TABELA).map(([t, c]) => ({ tabela: t, nome: nomeTabela(t), categoria: c })) }));

  // ---------------------------------------------------------------- usuários para filtros
  app.get('/api/v1/auditoria/painel/usuarios', painel, async () => prisma.usuario.findMany({ select: { id: true, nome: true, perfil: true, ativo: true }, orderBy: { nome: 'asc' } }));
}

function lerJsonLista(s: string | null): unknown[] {
  try {
    const v = s ? JSON.parse(s) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
