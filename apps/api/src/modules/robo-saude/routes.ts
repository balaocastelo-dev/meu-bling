/**
 * ROBÔ DA SAÚDE — rotas (só ADMIN) e o serviço que roda 24h.
 *
 *   GET  /api/v1/robo-saude                         painel: % de saúde, o que precisa de um clique, o que ele corrigiu
 *   GET  /api/v1/robo-saude/contagem                número do sino (leve, para o topo)
 *   POST /api/v1/robo-saude/rodar                   roda agora
 *   POST /api/v1/robo-saude/avisos/:id/executar     { acao } — o botão da sugestão
 *   POST /api/v1/robo-saude/avisos/:id/ignorar      não incomoda mais por 7 dias
 *   POST /api/v1/robo-saude/resolver-tudo           aperta o botão principal de todas as sugestões seguras
 *   POST /api/v1/robo-saude/marcar-lidas            zera o "novas correções"
 *   PUT  /api/v1/robo-saude/config                  { ligado, autoCorrigir }
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { eventos } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import { agendarRodada, executarSugestao, gravarConfig, ignorarSugestao, INTERVALO_MS, marcarLidas, painelRobo, resolverTudo, rodarRobo } from './motor.js';

const idDe = (req: any) => {
  const id = Number(req.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('ID inválido.', 400, 'ID_INVALIDO');
  return id;
};

// ---------------------------------------------------------------- "conciliando na hora"
const depoisDeMovimento = () => agendarRodada();
eventos.ouvir('venda.criada', depoisDeMovimento);
eventos.ouvir('venda.alterada', depoisDeMovimento);
eventos.ouvir('situacao.alterada', depoisDeMovimento);
eventos.ouvir('compra.criada', depoisDeMovimento);
eventos.ouvir('os.criada', depoisDeMovimento);
eventos.ouvir('nfe.autorizada', depoisDeMovimento);
eventos.ouvir('nfe.cancelada', depoisDeMovimento);
eventos.ouvir('conta.recebida', depoisDeMovimento);
eventos.ouvir('conta.paga', depoisDeMovimento);

registrarServico('robo-saude', (app) => {
  if (process.env.ROBO_SAUDE === 'off') {
    app.log.info('[robo-saude] desligado (ROBO_SAUDE=off)');
    return;
  }
  const rodada = () =>
    rodarRobo('agendado')
      .then((e) => e?.corrigidasNaRodada && app.log.info(`[robo-saude] ${e.corrigidasNaRodada} correção(ões) · saúde ${e.saudePct}%`))
      .catch((e) => app.log.error({ e }, '[robo-saude] falha'));
  setTimeout(rodada, 40_000).unref();
  setInterval(rodada, INTERVALO_MS).unref();
});

export default async function roboSaudeRoutes(app: FastifyInstance) {
  const admin = { preHandler: app.exigirPerfil('ADMIN') };
  const quem = (req: any) => ({ id: req.user?.id ?? null, nome: req.user?.nome || 'ADMIN' });

  app.get('/api/v1/robo-saude', admin, async () => painelRobo());

  app.get('/api/v1/robo-saude/contagem', admin, async () => {
    const [pendentes, erros, naoLidas] = await Promise.all([
      prisma.roboSaudeAviso.count({ where: { status: 'ABERTA' } }),
      prisma.roboSaudeAviso.count({ where: { status: 'ABERTA', nivel: 'erro' } }),
      prisma.roboSaudeAviso.count({ where: { tipo: 'CORRECAO', lida: false } }),
    ]);
    return { pendentes, erros, naoLidas };
  });

  app.post('/api/v1/robo-saude/rodar', admin, async (req) => {
    await rodarRobo(`na mão (${quem(req).nome})`, { forcar: true });
    return painelRobo();
  });

  app.post('/api/v1/robo-saude/avisos/:id/executar', admin, async (req) => {
    const id = idDe(req);
    const { acao } = z.object({ acao: z.string().min(1).max(40) }).parse(req.body ?? {});
    const texto = await executarSugestao(id, acao, quem(req));
    return { ok: true, texto };
  });

  app.post('/api/v1/robo-saude/avisos/:id/ignorar', admin, async (req) => {
    await ignorarSugestao(idDe(req), quem(req));
    return { ok: true };
  });

  app.post('/api/v1/robo-saude/resolver-tudo', admin, async (req) => {
    const r = await resolverTudo(quem(req));
    await rodarRobo('depois do "Resolver tudo"', { forcar: true });
    return r;
  });

  app.post('/api/v1/robo-saude/marcar-lidas', admin, async () => {
    await marcarLidas();
    return { ok: true };
  });

  app.put('/api/v1/robo-saude/config', admin, async (req) => {
    const body = z.object({ ligado: z.boolean().optional(), autoCorrigir: z.boolean().optional() }).strict().parse(req.body ?? {});
    const cfg = await gravarConfig(body);
    await auditar(req, 'RoboSaude', null, 'ALTERAR', { config: cfg });
    return cfg;
  });
}
