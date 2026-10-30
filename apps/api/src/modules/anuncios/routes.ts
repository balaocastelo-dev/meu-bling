/**
 * VITRINE DA EQUIPE — rotas.
 *
 *   Loja (login):  /api/v1/anuncios/*         → cada um cria e gerencia os SEUS (sem aprovação);
 *                                                a gestão vê e mexe em todos.
 *   Site (sem login): /api/v1/publico/anuncios → a vitrine, no mesmo formato dos Consignados.
 *
 * Ver docs/VITRINE-EQUIPE.md. O cálculo da comissão fica em comissao.ts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditar } from '../../lib/auditoria.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { idDe } from '../comum/zod.js';
import { anuncioInclude, anuncioQuePodeMexer, donoDoUsuario, filtroDoDono, gerarCodigo, paraVitrine, pctDoAnuncio, retornoDoAnuncio } from './service.js';

const corpoBase = {
  titulo: z.string().trim().min(3).max(120),
  descricao: z.string().trim().max(4000).optional().nullable(),
  fotos: z.string().trim().max(2000).optional().nullable(),
  precoAPartirDe: z.coerce.number().min(0).optional().nullable(),
  prazoDias: z.coerce.number().int().min(0).max(365).optional().nullable(),
  naVitrine: z.coerce.boolean().optional(),
  ativo: z.coerce.boolean().optional(),
};

/** Criar: ou aponta para um produto que já existe, ou cria o produto junto (o caso comum). */
const criarSchema = z
  .object({
    ...corpoBase,
    produtoId: z.coerce.number().int().positive().optional(),
    /** quando não há produtoId: os dados do produto/serviço novo */
    tipo: z.enum(['PRODUTO', 'SERVICO']).optional(),
    preco: z.coerce.number().min(0).optional(),
    precoCusto: z.coerce.number().min(0).optional(),
    garantiaDias: z.coerce.number().int().min(0).max(3650).optional(),
  })
  .refine((v) => v.produtoId || v.preco !== undefined, {
    message: 'Informe o preço do que você está anunciando (ou escolha um produto já cadastrado).',
    path: ['preco'],
  });

const alterarSchema = z.object({ ...corpoBase, preco: z.coerce.number().min(0).optional(), precoCusto: z.coerce.number().min(0).optional() }).partial();

export default async function rotasAnuncios(app: FastifyInstance) {
  const limite = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  // ----------------------------------------------------------------- meus anúncios (loja)
  app.get('/api/v1/anuncios', async (req) => {
    const d = await donoDoUsuario(req.user);
    const q = z.object({ ativo: z.coerce.boolean().optional(), pesquisa: z.string().trim().max(100).optional() }).parse(req.query);
    const lista = await prisma.anuncio.findMany({
      where: {
        ...filtroDoDono(d),
        ...(q.ativo === undefined ? {} : { ativo: q.ativo }),
        ...(q.pesquisa ? { titulo: { contains: q.pesquisa } } : {}),
      },
      include: anuncioInclude,
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
    const retornos = await Promise.all(lista.map((a) => retornoDoAnuncio(a.id)));
    return {
      data: lista.map((a, i) => ({ ...a, retorno: retornos[i] })),
      // o dono precisa saber quanto ganha antes de publicar — é o que estimula a criar anúncio
      meuPercentual: d.donoTipo ? pctDoAnuncio(d.donoTipo) : null,
      souDono: d.donoTipo,
    };
  });

  app.get('/api/v1/anuncios/:id', async (req) => {
    const d = await donoDoUsuario(req.user);
    const a = await anuncioQuePodeMexer(idDe(req), d);
    const completo = await prisma.anuncio.findUnique({ where: { id: a.id }, include: anuncioInclude });
    return { ...completo, retorno: await retornoDoAnuncio(a.id) };
  });

  /** O que o anúncio já rendeu, com as comissões que o geraram. */
  app.get('/api/v1/anuncios/:id/comissoes', async (req) => {
    const d = await donoDoUsuario(req.user);
    const a = await anuncioQuePodeMexer(idDe(req), d);
    const comissoes = await prisma.comissao.findMany({
      where: { anuncioId: a.id },
      select: { id: true, descricao: true, base: true, pct: true, valor: true, status: true, competencia: true, criadoEm: true, vendaId: true, osId: true },
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
    return { data: comissoes, retorno: await retornoDoAnuncio(a.id) };
  });

  app.post('/api/v1/anuncios', async (req, reply) => {
    const b = criarSchema.parse(req.body);
    const d = await donoDoUsuario(req.user);
    if (!d.donoTipo) {
      throw new AppError(
        'Para publicar na vitrine você precisa de um cadastro de vendedor ou de técnico ligado ao seu usuário. Peça ao administrador em Cadastros → Vendedores/Técnicos.',
        422,
        'SEM_CADASTRO_DONO',
        { link: '/configuracoes/usuarios' },
      );
    }

    // produto por trás do anúncio: o existente ou um novo criado junto
    let produtoId = b.produtoId;
    if (produtoId) {
      const p = await prisma.produto.findUnique({ where: { id: produtoId }, select: { id: true } });
      if (!p) throw new NotFound('Produto');
    } else {
      const servico = b.tipo !== 'PRODUTO';
      const novo = await prisma.produto.create({
        data: {
          nome: b.titulo,
          tipo: servico ? 'S' : 'P',
          unidade: servico ? 'UN' : 'UN',
          preco: b.preco ?? 0,
          precoCusto: b.precoCusto ?? 0,
          garantiaDias: b.garantiaDias ?? 90,
          // serviço não tem estoque para controlar
          controlaEstoque: !servico,
          imagemUrl: (b.fotos || '').split(',')[0]?.trim() || null,
        },
        select: { id: true },
      });
      produtoId = novo.id;
    }

    const anuncio = await prisma.anuncio.create({
      data: {
        codigo: await gerarCodigo(),
        titulo: b.titulo,
        descricao: b.descricao ?? null,
        fotos: b.fotos ?? null,
        produtoId,
        donoTipo: d.donoTipo,
        vendedorId: d.donoTipo === 'VENDEDOR' ? d.vendedorId : null,
        tecnicoId: d.donoTipo === 'TECNICO' ? d.tecnicoId : null,
        comissaoPct: pctDoAnuncio(d.donoTipo),
        precoAPartirDe: b.precoAPartirDe ?? null,
        prazoDias: b.prazoDias ?? null,
        naVitrine: b.naVitrine ?? true,
        ativo: b.ativo ?? true,
      },
      include: anuncioInclude,
    });
    await auditar(req, 'Anuncio', anuncio.id, 'CRIAR', { titulo: anuncio.titulo, comissaoPct: anuncio.comissaoPct });
    return reply.code(201).send({ ...anuncio, retorno: await retornoDoAnuncio(anuncio.id) });
  });

  app.put('/api/v1/anuncios/:id', async (req) => {
    const d = await donoDoUsuario(req.user);
    const atual = await anuncioQuePodeMexer(idDe(req), d);
    const b = alterarSchema.parse(req.body);
    const corpo = req.body as Record<string, unknown>;

    // preço e custo moram no produto, não no anúncio
    if ('preco' in corpo || 'precoCusto' in corpo) {
      await prisma.produto.update({
        where: { id: atual.produtoId },
        data: { ...(b.preco !== undefined ? { preco: b.preco } : {}), ...(b.precoCusto !== undefined ? { precoCusto: b.precoCusto } : {}) },
      });
    }
    const dados: Record<string, unknown> = {};
    for (const k of ['titulo', 'descricao', 'fotos', 'precoAPartirDe', 'prazoDias', 'naVitrine', 'ativo'] as const) {
      if (k in corpo && b[k] !== undefined) dados[k] = b[k];
    }
    const anuncio = await prisma.anuncio.update({ where: { id: atual.id }, data: dados, include: anuncioInclude });
    await auditar(req, 'Anuncio', anuncio.id, 'ALTERAR', dados);
    return { ...anuncio, retorno: await retornoDoAnuncio(anuncio.id) };
  });

  app.delete('/api/v1/anuncios/:id', async (req, reply) => {
    const d = await donoDoUsuario(req.user);
    const a = await anuncioQuePodeMexer(idDe(req), d);
    const usado = await prisma.comissao.count({ where: { anuncioId: a.id } });
    if (usado) {
      // anúncio que já pagou comissão vira histórico: sai da vitrine, mas não some do sistema
      await prisma.anuncio.update({ where: { id: a.id }, data: { ativo: false, naVitrine: false } });
      await auditar(req, 'Anuncio', a.id, 'ALTERAR', { desativado: true, motivo: 'já gerou comissão' });
      return { desativado: true, mensagem: 'Este anúncio já gerou comissão, então foi desligado em vez de excluído — o histórico de pagamento continua.' };
    }
    await prisma.anuncio.delete({ where: { id: a.id } });
    await auditar(req, 'Anuncio', a.id, 'EXCLUIR', { titulo: a.titulo });
    return reply.code(204).send();
  });

  // ----------------------------------------------------------------- vitrine do site (sem login)
  app.get('/api/v1/publico/anuncios', limite, async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const lista = await prisma.anuncio.findMany({
      where: { naVitrine: true, ativo: true, produto: { ativo: true } },
      include: anuncioInclude,
      orderBy: { criadoEm: 'desc' },
      take: 200,
    });
    return { data: lista.map(paraVitrine) };
  });

  app.get('/api/v1/publico/anuncios/:codigo', limite, async (req, reply) => {
    const { codigo } = z.object({ codigo: z.string().trim().min(3).max(20) }).parse(req.params);
    const a = await prisma.anuncio.findUnique({ where: { codigo }, include: anuncioInclude });
    if (!a || !a.ativo || !a.naVitrine) throw new NotFound('Anúncio');
    // conta a visita sem travar a resposta: é o retorno que o dono vê no painel dele
    void prisma.anuncio.update({ where: { id: a.id }, data: { visitas: { increment: 1 } } }).catch(() => {});
    reply.header('Cache-Control', 'public, max-age=30');
    return paraVitrine(a);
  });
}
