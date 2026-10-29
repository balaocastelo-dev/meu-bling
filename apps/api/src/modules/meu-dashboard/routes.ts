/**
 * MEU DASHBOARD (29/10/2026) — a tela inicial de cada perfil, no estilo Power BI.
 *
 *   GET /api/v1/meu-dashboard?dataInicial=&dataFinal=&usuarioId=
 *       Devolve só o que o perfil pode ver:
 *         VENDEDOR   → vendas (faturamento, meta, ranking, desafios), alertas das vendas dele, lembretes
 *         TECNICO    → assistência (OS, meta, ranking, desafios de OS) + vendas dele (também vende), alertas, lembretes
 *         GERENTE / FINANCEIRO → saldo, receita, entradas/saídas, caixinhas, avisos, equipe, desafios, alertas da loja
 *         ADMIN      → o mesmo da gerente (o dashboard completo com lucro/DRE é a tela "Dashboard" já existente)
 *       Vendedor e técnico NUNCA recebem custo, lucro, margem ou DRE.
 *       `usuarioId` = "ver como": ADMIN/GERENTE abrem o dashboard de alguém da equipe exatamente como ele vê.
 *   GET /api/v1/meu-dashboard/equipe   usuários ativos (para o "ver como"; ADMIN/GERENTE)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { dataSchema } from '../../lib/util.js';
import type { Perfil } from '../../plugins/auth.js';
import { tecnicoDoUsuario, vendedorDoUsuario } from '../comum/vendedores.js';
import { lembretesPendentes } from '../lembretes/routes.js';
import { alertasLoja, alertasOs, alertasVendas, ordenar } from './alertas.js';
import { blocoAssistencia, blocoGerente, blocoVendas, periodoDe } from './service.js';

/** Chaves que nunca podem sair para vendedor/técnico (conferido também nos testes) */
export const CHAVES_PROIBIDAS_OPERACAO = ['lucro', 'margem', 'custo', 'dre', 'saldo'];

/** Remove de um objeto, em qualquer profundidade, as chaves cujo nome contenha custo/lucro/margem/dre/saldo (defesa extra) */
export function semFinanceiroInterno<T>(obj: T): T {
  const proibida = (k: string) => CHAVES_PROIBIDAS_OPERACAO.some((p) => k.toLowerCase().includes(p));
  const andar = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(andar);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!proibida(k)) o[k] = andar(x);
      return o;
    }
    return v;
  };
  return andar(obj) as T;
}

export default async function meuDashboardRoutes(app: FastifyInstance) {
  app.get('/api/v1/meu-dashboard', async (req) => {
    const q = z.object({ dataInicial: dataSchema, dataFinal: dataSchema, usuarioId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const p = periodoDe(q);
    const gestor = req.user.perfil === 'ADMIN' || req.user.perfil === 'GERENTE';

    // ---- de quem é o dashboard (o meu, ou "ver como" alguém da equipe)
    let alvo = await prisma.usuario.findUnique({ where: { id: req.user.id }, select: { id: true, nome: true, perfil: true, vendedorId: true, tecnicoId: true, ativo: true } });
    if (!alvo) throw new NotFound('Usuário');
    let verComo = false;
    if (q.usuarioId && q.usuarioId !== req.user.id) {
      if (!gestor) throw new AppError('Só o gestor e a gerente podem ver o dashboard de outra pessoa.', 403, 'SEM_PERMISSAO');
      const outro = await prisma.usuario.findUnique({ where: { id: q.usuarioId }, select: { id: true, nome: true, perfil: true, vendedorId: true, tecnicoId: true, ativo: true } });
      if (!outro) throw new NotFound('Usuário');
      if (outro.perfil === 'ADMIN' && req.user.perfil !== 'ADMIN') throw new AppError('A gerente não abre o dashboard do gestor.', 403, 'SEM_PERMISSAO');
      alvo = outro;
      verComo = true;
    }
    const perfil = alvo.perfil as Perfil;
    const base = {
      usuario: { id: alvo.id, nome: alvo.nome, perfil },
      verComo,
      periodo: { dataInicial: p.ini, dataFinal: p.fim, agrupar: p.agrupar },
      lembretes: await lembretesPendentes(alvo.id),
    };

    // ---- VENDEDOR: só as vendas dele
    if (perfil === 'VENDEDOR') {
      const vendedorId = alvo.vendedorId ?? (await vendedorDoUsuario(alvo.id));
      if (!vendedorId) throw new AppError('Este usuário ainda não está vinculado a um cadastro de vendedor. Vincule em Configurações → Usuários.', 422, 'SEM_VENDEDOR');
      const [vendas, alertas] = await Promise.all([blocoVendas(vendedorId, p, false), alertasVendas({ vendedorId })]);
      return semFinanceiroInterno({ ...base, vendas, alertas: ordenar(alertas) });
    }

    // ---- TÉCNICO: as OS dele + as vendas dele (o técnico também vende; não emite NF)
    if (perfil === 'TECNICO') {
      const tecnicoId = alvo.tecnicoId ?? (await tecnicoDoUsuario(alvo.id));
      if (!tecnicoId) throw new AppError('Este usuário ainda não está vinculado a um cadastro de técnico. Vincule em Configurações → Usuários.', 422, 'SEM_TECNICO');
      const vendedorId = alvo.vendedorId ?? (await vendedorDoUsuario(alvo.id));
      const [assistencia, vendas, alertasO, alertasV] = await Promise.all([
        blocoAssistencia(tecnicoId, p, false),
        vendedorId ? blocoVendas(vendedorId, p, false) : null,
        alertasOs({ tecnicoId }),
        vendedorId ? alertasVendas({ vendedorId, nf: false }) : [],
      ]);
      return semFinanceiroInterno({ ...base, assistencia, vendas, alertas: ordenar([...alertasO, ...alertasV]) });
    }

    // ---- GERENTE / FINANCEIRO / ADMIN: a loja inteira, sem lucro (o ADMIN tem o dashboard completo na tela "Dashboard")
    const [gerente, alertas] = await Promise.all([blocoGerente(p), alertasLoja()]);
    return { ...base, gerente, alertas };
  });

  /** Equipe para o "ver como" (gestor/gerente): vendedores, técnicos e demais usuários ativos */
  app.get('/api/v1/meu-dashboard/equipe', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const lista = await prisma.usuario.findMany({ where: { ativo: true, perfil: { in: req.user.perfil === 'ADMIN' ? ['ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'] : ['GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'] } }, orderBy: [{ perfil: 'asc' }, { nome: 'asc' }], select: { id: true, nome: true, perfil: true } });
    return lista.filter((u) => u.id !== req.user.id);
  });
}
