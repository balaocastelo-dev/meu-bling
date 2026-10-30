/**
 * JARVIS — o agente do gestor (docs/JARVIS.md). Objetivo: R$ 1.000.000 livres no caixa.
 *
 *   GET  /api/v1/jarvis/painel                 painel do ADMIN: caixa livre, mapa do milhão, sugestões, placar
 *   GET  /api/v1/jarvis/evolucao               série do gráfico (filtro de data do sistema)
 *   GET  /api/v1/jarvis/sugestoes              lista com filtro de situação
 *   POST /api/v1/jarvis/sugestoes/:id/aceitar  { }            → marca como aceita (e mede depois)
 *   POST /api/v1/jarvis/sugestoes/:id/adiar    { dias }       → some até a data
 *   POST /api/v1/jarvis/sugestoes/:id/recusar  { motivo? }    → não volta por 7 dias
 *   POST /api/v1/jarvis/rodar                  roda a rodada agora
 *   POST /api/v1/jarvis/perguntar              { pergunta }   → modo pergunta (IA com os números do dia)
 *   GET  /api/v1/jarvis/placar                 acertos do JARVIS: estimado × medido
 *   GET  /api/v1/jarvis/config                 (ADMIN) configuração, sem devolver a chave
 *   PUT  /api/v1/jarvis/config                 (ADMIN) meta, data-alvo, modelo, chave, percentuais
 *   POST /api/v1/jarvis/config/testar-ia       (ADMIN) testa a chave da Anthropic
 *   GET  /api/v1/jarvis/feed                   (TODOS) sugestões do perfil de quem está logado
 *   GET  /api/v1/jarvis/voz/estado             (ADMIN) a voz clonada está no ar?
 *   POST /api/v1/jarvis/voz                    (ADMIN) { texto } → WAV na voz do Thiago
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { encrypt, mask } from '../../lib/crypto.js';
import { registrarServico } from '../../core/servicos.js';
import { mapaDoMilhao } from './caixa-livre.js';
import { iaDisponivel, testarChave } from './ia.js';
import { iniciarWorker, medirResultados, obterConfig, rodarJarvis } from './worker.js';
import { executarAcao } from './acoes.js';
import { conversar, lerConversa, listarConversas } from './chat.js';
import { executarFerramenta } from './ferramentas.js';
import { falaDe, vozDisponivel } from './voz.js';

// o worker de 30 min (ver worker.ts). Desliga com JARVIS=off
registrarServico('jarvis', (app) => iniciarWorker(app));

const idDe = (req: any) => {
  const id = Number(req.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
};

const paraTela = (s: any) => ({
  id: s.id,
  regra: s.regra,
  chave: s.chave,
  titulo: s.titulo,
  texto: s.texto,
  impactoEstimado: s.impactoEstimado,
  prioridade: s.prioridade,
  acao: s.acao,
  link: s.link,
  situacao: s.situacao,
  criadaEm: s.criadaEm,
  adiadaAte: s.adiadaAte,
  resultadoReal: s.resultadoReal,
  dados: s.dados ? seguro(s.dados) : null,
});

function seguro(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default async function jarvisRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.exigirPerfil('ADMIN') };
  const todos = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO') };

  // ------------------------------------------------------------------ painel
  app.get('/api/v1/jarvis/painel', admin, async () => {
    const cfg = await obterConfig();
    const [mapa, abertas, ia] = await Promise.all([
      mapaDoMilhao(cfg.metaCaixa, cfg.dataAlvo),
      prisma.jarvisSugestao.findMany({
        where: { situacao: 'ABERTA' },
        orderBy: [{ prioridade: 'asc' }, { impactoEstimado: 'desc' }],
        take: 30,
      }),
      iaDisponivel(),
    ]);

    const emJogo = abertas.reduce((s, a) => s + (a.impactoEstimado ?? 0), 0);

    return {
      ...mapa,
      sugestoes: abertas.map(paraTela),
      emJogo: Math.round(emJogo * 100) / 100,
      ia: { ligada: ia, modelo: cfg.modeloIa, ultimoErro: cfg.ultimoErro },
      ultimaRodadaEm: cfg.ultimaRodadaEm,
      ligado: cfg.ligado,
    };
  });

  // ------------------------------------------------------------------ evolução (gráfico)
  app.get('/api/v1/jarvis/evolucao', admin, async (req) => {
    const q = z
      .object({ dataInicial: z.string().optional(), dataFinal: z.string().optional() })
      .parse((req.query ?? {}) as any);

    const de = q.dataInicial ? new Date(`${q.dataInicial}T00:00:00`) : new Date(Date.now() - 30 * 86_400_000);
    const ate = q.dataFinal ? new Date(`${q.dataFinal}T23:59:59`) : new Date();

    const metricas = await prisma.jarvisMetrica.findMany({
      where: { em: { gte: de, lte: ate } },
      orderBy: { em: 'asc' },
      select: { em: true, caixaLivre: true, saldoBancos: true, saldoCaixa: true, aPagar30d: true, caixinhas: true, emprestimos: true },
    });

    // uma linha por dia (a última medição do dia)
    const porDia = new Map<string, (typeof metricas)[number]>();
    for (const m of metricas) porDia.set(m.em.toISOString().slice(0, 10), m);

    return {
      serie: [...porDia.entries()].map(([dia, m]) => ({
        dia,
        rotulo: dia.slice(8, 10) + '/' + dia.slice(5, 7),
        caixaLivre: m.caixaLivre,
        saldoBancos: m.saldoBancos,
        saldoCaixa: m.saldoCaixa,
        aPagar30d: m.aPagar30d,
        caixinhas: m.caixinhas,
        emprestimos: m.emprestimos,
      })),
    };
  });

  // ------------------------------------------------------------------ sugestões
  app.get('/api/v1/jarvis/sugestoes', admin, async (req) => {
    const q = z
      .object({
        situacao: z.enum(['ABERTA', 'ACEITA', 'ADIADA', 'RECUSADA', 'CONCLUIDA', 'EXPIRADA']).optional(),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse((req.query ?? {}) as any);

    const lista = await prisma.jarvisSugestao.findMany({
      where: q.situacao ? { situacao: q.situacao } : {},
      orderBy: [{ prioridade: 'asc' }, { criadaEm: 'desc' }],
      take: q.limite,
    });
    return { data: lista.map(paraTela) };
  });

  async function decidir(
    req: any,
    situacao: 'ACEITA' | 'ADIADA' | 'RECUSADA',
    extra: Record<string, unknown> = {},
    opcoesAcao: { percentual?: number } = {},
  ) {
    const id = idDe(req);
    const s = await prisma.jarvisSugestao.findUnique({ where: { id } });
    if (!s) throw new NotFound('Sugestão');
    if (s.situacao !== 'ABERTA' && s.situacao !== 'ADIADA')
      throw new AppError('Essa sugestão já foi decidida.', 422, 'SUGESTAO_DECIDIDA');

    // aceitar é o JARVIS fazer o trabalho, não só marcar a sugestão
    let resultado: { ok: boolean; mensagem: string; detalhes?: Record<string, unknown> } | null = null;
    if (situacao === 'ACEITA' && s.acao && s.acao !== 'NENHUMA' && s.acao !== 'ABRIR_TELA') {
      resultado = await executarAcao(s.acao, s.dados ? seguro(s.dados) : null, opcoesAcao);
      if (!resultado.ok) throw new AppError(resultado.mensagem, 422, 'ACAO_SEM_EFEITO');
    }

    const atualizada = await prisma.jarvisSugestao.update({
      where: { id },
      data: {
        situacao,
        decididaEm: new Date(),
        decididaPor: req.user?.nome || 'ADMIN',
        motivo: resultado ? resultado.mensagem.slice(0, 400) : ((extra.motivo as string | null) ?? null),
        ...extra,
      },
    });
    await auditar(req, 'JarvisSugestao', id, 'ACAO', {
      situacao,
      regra: s.regra,
      chave: s.chave,
      acao: s.acao,
      resultado: resultado?.detalhes ?? null,
    });
    return { ...paraTela(atualizada), feito: resultado?.mensagem ?? null };
  }

  app.post('/api/v1/jarvis/sugestoes/:id/aceitar', admin, async (req) => {
    const { percentual } = z
      .object({ percentual: z.coerce.number().int().min(1).max(60).optional() })
      .parse((req.body ?? {}) as any);
    return decidir(req, 'ACEITA', {}, { percentual });
  });

  app.post('/api/v1/jarvis/sugestoes/:id/adiar', admin, async (req) => {
    const { dias } = z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) }).parse((req.body ?? {}) as any);
    return decidir(req, 'ADIADA', { adiadaAte: new Date(Date.now() + dias * 86_400_000) });
  });

  app.post('/api/v1/jarvis/sugestoes/:id/recusar', admin, async (req) => {
    const { motivo } = z.object({ motivo: z.string().max(400).optional() }).parse((req.body ?? {}) as any);
    return decidir(req, 'RECUSADA', { motivo: motivo ?? null });
  });

  // ------------------------------------------------------------------ rodar agora
  app.post('/api/v1/jarvis/rodar', admin, async (req) => {
    const r = await rodarJarvis('manual');
    await medirResultados().catch(() => {});
    await auditar(req, 'Jarvis', null, 'ACAO', { rodada: r });
    return r ?? { ok: false, mensagem: 'Já há uma rodada em andamento.' };
  });

  // ------------------------------------------------------------------ chat do JARVIS
  app.post('/api/v1/jarvis/perguntar', admin, async (req) => {
    const { pergunta, conversaId } = z
      .object({ pergunta: z.string().min(3).max(2000), conversaId: z.coerce.number().int().positive().nullish() })
      .parse((req.body ?? {}) as any);


    const u = req.user as any;
    return conversar({
      conversaId: conversaId ?? null,
      pergunta,
      usuarioId: u?.id ?? null,
      usuarioNome: u?.nome ?? null,
      app,
      req,
    });
  });

  /** O gestor apertou "pode fazer": executa a ação que estava pendente. */
  app.post('/api/v1/jarvis/confirmar', admin, async (req) => {
    const { conversaId, nome, argumentos } = z
      .object({
        conversaId: z.coerce.number().int().positive(),
        nome: z.string().min(1).max(80),
        argumentos: z.record(z.string(), z.any()).default({}),
      })
      .parse((req.body ?? {}) as any);

    const r = await executarFerramenta(app, req, nome, argumentos, { permitirTudo: true });
    await auditar(req, 'JarvisFerramenta', conversaId, 'ACAO', { ferramenta: nome, confirmadaPeloGestor: true, ok: r.ok });

    const texto = r.ok ? `Feito: ${r.texto.slice(0, 1000)}` : `Não consegui: ${r.texto.slice(0, 1000)}`;
    await prisma.jarvisMensagem.create({ data: { conversaId, papel: 'jarvis', texto } });
    if (!r.ok) throw new AppError(r.texto.slice(0, 300), 422, 'ACAO_FALHOU');
    return { ok: true, texto };
  });

  app.get('/api/v1/jarvis/conversas', admin, async (req) => {
    const u = req.user as any;
    return { data: await listarConversas(u?.id ?? null) };
  });

  app.get('/api/v1/jarvis/conversas/:id', admin, async (req) => {
    const c = await lerConversa(idDe(req));
    if (!c) throw new NotFound('Conversa');
    return c;
  });

  app.delete('/api/v1/jarvis/conversas/:id', admin, async (req) => {
    const id = idDe(req);
    const c = await prisma.jarvisConversa.findUnique({ where: { id } });
    if (!c) throw new NotFound('Conversa');
    await prisma.jarvisConversa.update({ where: { id }, data: { arquivada: true } });
    await auditar(req, 'JarvisConversa', id, 'EXCLUIR', { titulo: c.titulo });
    return { ok: true };
  });

  // ------------------------------------------------------------------ placar
  app.get('/api/v1/jarvis/placar', admin, async () => {
    const [aceitas, recusadas, abertas, medidas] = await Promise.all([
      prisma.jarvisSugestao.count({ where: { situacao: 'ACEITA' } }),
      prisma.jarvisSugestao.count({ where: { situacao: 'RECUSADA' } }),
      prisma.jarvisSugestao.count({ where: { situacao: 'ABERTA' } }),
      prisma.jarvisSugestao.findMany({
        where: { medidaEm: { not: null } },
        select: { regra: true, titulo: true, impactoEstimado: true, resultadoReal: true, decididaEm: true },
        orderBy: { medidaEm: 'desc' },
        take: 20,
      }),
    ]);

    const estimado = medidas.reduce((s, m) => s + (m.impactoEstimado ?? 0), 0);
    const real = medidas.reduce((s, m) => s + (m.resultadoReal ?? 0), 0);

    return {
      aceitas,
      recusadas,
      abertas,
      medidas,
      estimado: Math.round(estimado * 100) / 100,
      real: Math.round(real * 100) / 100,
      acerto: estimado > 0 ? Math.round((real / estimado) * 100) : null,
    };
  });

  // ------------------------------------------------------------------ configuração
  app.get('/api/v1/jarvis/config', admin, async () => {
    const c = await obterConfig();
    return {
      ligado: c.ligado,
      metaCaixa: c.metaCaixa,
      dataAlvo: c.dataAlvo,
      modeloIa: c.modeloIa,
      // o segredo nunca sai daqui: só a máscara e a flag
      temChave: !!c.chaveAnthropic,
      chaveMascarada: mask(c.chaveAnthropic),
      percVendaUsado: c.percVendaUsado,
      percCompraRegular: c.percCompraRegular,
      percCompraBom: c.percCompraBom,
      percCompraLacrado: c.percCompraLacrado,
      percLojaConsignado: c.percLojaConsignado,
      diasEstoqueParado: c.diasEstoqueParado,
      ultimaRodadaEm: c.ultimaRodadaEm,
      ultimoErro: c.ultimoErro,
    };
  });

  app.put('/api/v1/jarvis/config', admin, async (req) => {
    const body = z
      .object({
        ligado: z.boolean().optional(),
        metaCaixa: z.coerce.number().min(0).max(1_000_000_000).optional(),
        dataAlvo: z.string().optional().nullable(),
        modeloIa: z.string().min(3).max(80).optional(),
        chaveAnthropic: z.string().max(300).optional().nullable(),
        percVendaUsado: z.coerce.number().int().min(10).max(100).optional(),
        percCompraRegular: z.coerce.number().int().min(5).max(100).optional(),
        percCompraBom: z.coerce.number().int().min(5).max(100).optional(),
        percCompraLacrado: z.coerce.number().int().min(5).max(100).optional(),
        percLojaConsignado: z.coerce.number().int().min(0).max(100).optional(),
        diasEstoqueParado: z.coerce.number().int().min(7).max(365).optional(),
      })
      .strict()
      .parse((req.body ?? {}) as any);

    await obterConfig();
    const data: Record<string, unknown> = { ...body };

    // chave: vazia ou mascarada = não mexe; texto novo = criptografa
    if (body.chaveAnthropic === undefined) delete data.chaveAnthropic;
    else if (!body.chaveAnthropic || /^[*•]+/.test(body.chaveAnthropic)) delete data.chaveAnthropic;
    else data.chaveAnthropic = encrypt(body.chaveAnthropic);

    if (body.dataAlvo !== undefined) data.dataAlvo = body.dataAlvo ? new Date(`${body.dataAlvo}T12:00:00`) : null;

    const c = await prisma.jarvisConfig.update({ where: { id: 1 }, data });
    await auditar(req, 'JarvisConfig', 1, 'ALTERAR', {
      campos: Object.keys(data).filter((k) => k !== 'chaveAnthropic'),
      trocouChave: 'chaveAnthropic' in data,
    });

    return {
      ligado: c.ligado,
      metaCaixa: c.metaCaixa,
      dataAlvo: c.dataAlvo,
      modeloIa: c.modeloIa,
      temChave: !!c.chaveAnthropic,
      chaveMascarada: mask(c.chaveAnthropic),
      percVendaUsado: c.percVendaUsado,
      percCompraRegular: c.percCompraRegular,
      percCompraBom: c.percCompraBom,
      percCompraLacrado: c.percCompraLacrado,
      percLojaConsignado: c.percLojaConsignado,
      diasEstoqueParado: c.diasEstoqueParado,
    };
  });

  app.post('/api/v1/jarvis/config/testar-ia', admin, async (req) => {
    const body = z
      .object({ chave: z.string().max(300).optional(), modelo: z.string().max(80).optional() })
      .parse((req.body ?? {}) as any);

    const cfg = await obterConfig();
    const modelo = body.modelo || cfg.modeloIa;

    if (body.chave && !/^[*•]+/.test(body.chave)) return testarChave(body.chave, modelo);

    const { decrypt } = await import('../../lib/crypto.js');
    const guardada = decrypt(cfg.chaveAnthropic);
    if (!guardada) return { ok: false, mensagem: 'Nenhuma chave cadastrada ainda. Cole a chave da Anthropic e salve.' };
    return testarChave(guardada, modelo);
  });

  // ------------------------------------------------------------------ feed por perfil (todos os perfis)
  app.get('/api/v1/jarvis/feed', todos, async (req) => {
    const perfil = ((req.user as any)?.perfil || 'VENDEDOR') as string;
    const abertas = await prisma.jarvisSugestao.findMany({
      where: { situacao: 'ABERTA' },
      orderBy: [{ prioridade: 'asc' }, { impactoEstimado: 'desc' }],
      take: 20,
    });

    // vendedor e técnico nunca veem lucro nem caixa (decisão do Thiago)
    const minhas = abertas
      .filter((s) => s.perfis.split(',').includes(perfil))
      .map((s) => ({
        id: s.id,
        titulo: s.titulo,
        texto: s.texto,
        prioridade: s.prioridade,
        link: s.link,
        regra: s.regra,
        impactoEstimado: perfil === 'ADMIN' || perfil === 'FINANCEIRO' ? s.impactoEstimado : null,
      }));

    return { data: minhas };
  });

  // ------------------------------------------------------------------ voz
  // O navegador não fala com o PC da loja: pede o áudio aqui, já logado e em HTTPS.
  app.get('/api/v1/jarvis/voz/estado', admin, async () => ({ disponivel: await vozDisponivel() }));

  app.post('/api/v1/jarvis/voz', admin, async (req, reply) => {
    const { texto } = z.object({ texto: z.string().min(1).max(2000) }).parse(req.body);
    const fala = await falaDe(texto);
    if (!fala) {
      // o PC-servidor não respondeu: o navegador usa a própria voz
      return reply.code(503).send({ erro: 'VOZ_INDISPONIVEL', mensagem: 'A voz clonada não respondeu agora.' });
    }
    return reply
      .header('Content-Type', fala.tipo)
      .header('Content-Length', String(fala.audio.length))
      .header('Cache-Control', 'private, max-age=86400')
      .send(fala.audio);
  });
}
