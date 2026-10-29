/**
 * Contatos (clientes / fornecedores / transportadoras) + histórico unificado + ViaCEP.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { whereVendasDoUsuario } from '../comum/escopo-vendas.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { paginacaoSchema, paginar, respostaPaginada, somenteDigitos } from '../../lib/util.js';
import { boolQuery, idDe } from '../comum/zod.js';

const TIPOS = ['CLIENTE', 'FORNECEDOR', 'TRANSPORTADORA', 'AMBOS'] as const;

const texto = z.string().trim().nullable().optional();

const contatoSchema = z.object({
  tipo: z.enum(TIPOS).default('CLIENTE'),
  tipoPessoa: z.enum(['F', 'J', 'E']).default('F'),
  nome: z.string().trim().min(2, 'Informe o nome'),
  fantasia: texto,
  documento: texto,
  ie: texto,
  ieIsento: z.boolean().default(false),
  rg: texto,
  email: z.string().trim().email('E-mail inválido').nullable().optional().or(z.literal('')),
  telefone: texto,
  celular: texto,
  logradouro: texto,
  numero: texto,
  complemento: texto,
  bairro: texto,
  codigoMunicipio: texto,
  municipio: texto,
  uf: z.string().trim().length(2).toUpperCase().nullable().optional().or(z.literal('')),
  cep: texto,
  observacoes: texto,
  limiteCredito: z.coerce.number().min(0).default(0),
  indicadorIe: z.coerce.number().int().optional(),
  ativo: z.boolean().default(true),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
});

/** Normaliza campos numéricos (documento, cep, celular) e e-mail vazio. */
function normalizar<T extends Partial<z.infer<typeof contatoSchema>>>(b: T): T {
  const r: Record<string, unknown> = { ...b };
  if (b.documento !== undefined) r.documento = b.documento ? somenteDigitos(b.documento) || null : null;
  if (b.cep !== undefined) r.cep = b.cep ? somenteDigitos(b.cep) || null : null;
  if (b.celular !== undefined) r.celular = b.celular ? somenteDigitos(b.celular) || null : null;
  if (b.email === '') r.email = null;
  if (b.uf === '') r.uf = null;
  if (b.indicadorIe === undefined && b.tipoPessoa) {
    // 1 contribuinte, 2 isento, 9 não contribuinte
    r.indicadorIe = b.tipoPessoa === 'J' ? (b.ieIsento ? 2 : b.ie ? 1 : 9) : 9;
  }
  return r as T;
}

function validarDocumento(doc: string | null | undefined, tipoPessoa: string | undefined) {
  if (!doc) return;
  if (tipoPessoa === 'F' && doc.length !== 11) throw new AppError('CPF deve ter 11 dígitos.', 422, 'DOCUMENTO');
  if (tipoPessoa === 'J' && doc.length !== 14) throw new AppError('CNPJ deve ter 14 dígitos.', 422, 'DOCUMENTO');
}

export default async function contatosRoutes(app: FastifyInstance) {
  // ---- ViaCEP (antes de /:id)
  app.get('/api/v1/contatos/cep/:cep', async (req) => {
    const cep = somenteDigitos((req.params as any).cep);
    if (cep.length !== 8) throw new AppError('CEP deve ter 8 dígitos.', 400, 'CEP_INVALIDO');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: ctrl.signal });
      if (!r.ok) throw new AppError('CEP não encontrado.', 404, 'CEP_NAO_ENCONTRADO');
      const j = (await r.json()) as Record<string, string | boolean>;
      if (j.erro) throw new AppError('CEP não encontrado.', 404, 'CEP_NAO_ENCONTRADO');
      return {
        cep,
        logradouro: (j.logradouro as string) || '',
        complemento: (j.complemento as string) || '',
        bairro: (j.bairro as string) || '',
        municipio: (j.localidade as string) || '',
        uf: (j.uf as string) || '',
        codigoMunicipio: (j.ibge as string) || '',
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('Não foi possível consultar o CEP (sem conexão com o ViaCEP).', 404, 'CEP_INDISPONIVEL');
    } finally {
      clearTimeout(timer);
    }
  });

  // ---- Listagem
  app.get('/api/v1/contatos', async (req) => {
    const q = paginacaoSchema
      .extend({
        pesquisa: z.string().trim().optional(),
        tipo: z.enum(TIPOS).optional(),
        ativo: boolQuery,
        vendedorId: z.coerce.number().int().optional(),
        uf: z.string().trim().optional(),
      })
      .parse(req.query);

    const where: any = { ativo: q.ativo, vendedorId: q.vendedorId, uf: q.uf || undefined };
    if (q.tipo) {
      // AMBOS atende como cliente e fornecedor
      where.tipo = q.tipo === 'CLIENTE' || q.tipo === 'FORNECEDOR' ? { in: [q.tipo, 'AMBOS'] } : q.tipo;
    }
    if (q.pesquisa) {
      const p = q.pesquisa;
      const dig = somenteDigitos(p);
      const or: any[] = [{ nome: { contains: p } }, { fantasia: { contains: p } }, { email: { contains: p } }];
      if (dig.length >= 3) {
        or.push({ documento: { contains: dig } }, { telefone: { contains: dig } }, { celular: { contains: dig } });
      } else {
        or.push({ telefone: { contains: p } }, { celular: { contains: p } }, { documento: { contains: p } });
      }
      // SQLite: `contains` é case-insensitive para ASCII; também testa variações de caixa
      const lower = p.toLowerCase();
      const upper = p.toUpperCase();
      if (lower !== p) or.push({ nome: { contains: lower } }, { fantasia: { contains: lower } }, { email: { contains: lower } });
      if (upper !== p) or.push({ nome: { contains: upper } }, { fantasia: { contains: upper } });
      where.OR = or;
    }

    const [total, data] = await Promise.all([
      prisma.contato.count({ where }),
      prisma.contato.findMany({
        where,
        ...paginar(q),
        orderBy: { nome: 'asc' },
        include: { vendedor: { select: { id: true, nome: true } } },
      }),
    ]);
    return respostaPaginada(data, total, q);
  });

  // ---- Detalhe + resumo
  app.get('/api/v1/contatos/:id', async (req) => {
    const id = idDe(req);
    const c = await prisma.contato.findUnique({ where: { id }, include: { vendedor: { select: { id: true, nome: true } } } });
    if (!c) throw new NotFound('Contato');
    // vendedor/técnico: o resumo e o histórico do cliente só contam as vendas do próprio vendedor (29/10/2026)
    const escopo = await whereVendasDoUsuario(req.user);

    const [vendasAgg, qtdOs, emAberto, ultima] = await Promise.all([
      prisma.venda.aggregate({
        where: { ...escopo, contatoId: id, tipo: 'PEDIDO', situacao: { cancelamento: false } },
        _sum: { total: true },
        _count: { id: true },
      }),
      prisma.ordemServico.count({ where: { contatoId: id } }),
      prisma.contaReceber.aggregate({ where: { contatoId: id, situacao: { in: ['ABERTO', 'PARCIAL'] } }, _sum: { valor: true, valorRecebido: true } }),
      prisma.venda.findFirst({ where: { ...escopo, contatoId: id, tipo: 'PEDIDO', situacao: { cancelamento: false } }, orderBy: { data: 'desc' }, select: { data: true } }),
    ]);
    return {
      ...c,
      resumo: {
        totalVendas: vendasAgg._sum.total || 0,
        qtdVendas: vendasAgg._count.id,
        qtdOs,
        emAberto: (emAberto._sum.valor || 0) - (emAberto._sum.valorRecebido || 0),
        ultimaCompra: ultima?.data || null,
      },
    };
  });

  // ---- Histórico unificado
  app.get('/api/v1/contatos/:id/historico', async (req) => {
    const id = idDe(req);
    const c = await prisma.contato.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw new NotFound('Contato');
    const limite = z.object({ limite: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query).limite;
    const escopo = await whereVendasDoUsuario(req.user);

    const [vendas, ordens, contasReceber, notificacoes] = await Promise.all([
      prisma.venda.findMany({
        where: { ...escopo, contatoId: id },
        orderBy: { data: 'desc' },
        take: limite,
        select: { id: true, tipo: true, numero: true, data: true, total: true, situacao: { select: { id: true, nome: true, cor: true } } },
      }),
      prisma.ordemServico.findMany({
        where: { contatoId: id },
        orderBy: { dataEntrada: 'desc' },
        take: limite,
        select: { id: true, numero: true, dataEntrada: true, equipamento: true, marca: true, modelo: true, total: true, situacao: { select: { id: true, nome: true, cor: true } } },
      }),
      prisma.contaReceber.findMany({
        where: { contatoId: id },
        orderBy: { vencimento: 'desc' },
        take: limite,
        select: { id: true, descricao: true, vencimento: true, valor: true, valorRecebido: true, situacao: true, dataRecebimento: true, origemTipo: true, origemId: true },
      }),
      prisma.notificacao.findMany({
        where: { contatoId: id },
        orderBy: { criadoEm: 'desc' },
        take: limite,
        select: { id: true, canal: true, destinatario: true, assunto: true, corpo: true, status: true, criadoEm: true, enviadaEm: true, origemTipo: true, origemId: true },
      }),
    ]);

    const historicos = await prisma.historicoSituacao.findMany({
      where: {
        OR: [
          { entidadeTipo: 'VENDA', entidadeId: { in: vendas.map((v) => v.id) } },
          { entidadeTipo: 'OS', entidadeId: { in: ordens.map((o) => o.id) } },
        ],
      },
      orderBy: { data: 'desc' },
      take: limite * 2,
      include: { usuario: { select: { nome: true } } },
    });

    type Item = { data: Date; tipo: string; titulo: string; descricao: string; referencia: { tipo: string; id: number } };
    const timeline: Item[] = [];
    for (const v of vendas) {
      timeline.push({ data: v.data, tipo: 'VENDA', titulo: `Venda nº ${v.numero}`, descricao: `Total ${fmt(v.total)} — ${v.situacao.nome}`, referencia: { tipo: 'VENDA', id: v.id } });
    }
    for (const o of ordens) {
      timeline.push({
        data: o.dataEntrada,
        tipo: 'OS',
        titulo: `OS nº ${o.numero}`,
        descricao: `${[o.equipamento, o.marca, o.modelo].filter(Boolean).join(' ')} — ${o.situacao.nome} — ${fmt(o.total)}`,
        referencia: { tipo: 'OS', id: o.id },
      });
    }
    for (const cr of contasReceber) {
      timeline.push({
        data: cr.dataRecebimento || cr.vencimento,
        tipo: cr.situacao === 'RECEBIDO' ? 'RECEBIMENTO' : 'CONTA_RECEBER',
        titulo: cr.descricao,
        descricao: `${fmt(cr.valor)} — ${cr.situacao}${cr.valorRecebido ? ` (recebido ${fmt(cr.valorRecebido)})` : ''}`,
        referencia: { tipo: 'CONTA_RECEBER', id: cr.id },
      });
    }
    for (const n of notificacoes) {
      timeline.push({
        data: n.enviadaEm || n.criadoEm,
        tipo: 'NOTIFICACAO',
        titulo: `${n.canal === 'WHATSAPP' ? 'WhatsApp' : 'E-mail'} — ${n.status}`,
        descricao: (n.assunto ? n.assunto + ': ' : '') + n.corpo.slice(0, 140),
        referencia: { tipo: 'NOTIFICACAO', id: n.id },
      });
    }
    const numVenda = new Map(vendas.map((v) => [v.id, v.numero]));
    const numOs = new Map(ordens.map((o) => [o.id, o.numero]));
    for (const h of historicos) {
      const num = h.entidadeTipo === 'VENDA' ? numVenda.get(h.entidadeId) : numOs.get(h.entidadeId);
      timeline.push({
        data: h.data,
        tipo: 'SITUACAO',
        titulo: `${h.entidadeTipo === 'VENDA' ? 'Venda' : 'OS'} nº ${num ?? h.entidadeId}: ${h.deSituacao ? h.deSituacao + ' → ' : ''}${h.paraSituacao}`,
        descricao: [h.observacao, h.usuario?.nome ? `por ${h.usuario.nome}` : ''].filter(Boolean).join(' — '),
        referencia: { tipo: h.entidadeTipo, id: h.entidadeId },
      });
    }
    timeline.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

    return { vendas, ordens, contasReceber, notificacoes, timeline: timeline.slice(0, limite * 2) };
  });

  // ---- Criar
  app.post('/api/v1/contatos', async (req, reply) => {
    const body = normalizar(contatoSchema.parse(req.body));
    validarDocumento(body.documento, body.tipoPessoa);
    if (body.documento) {
      const dup = await prisma.contato.findFirst({ where: { documento: body.documento }, select: { id: true, nome: true } });
      if (dup) throw new AppError(`Já existe um contato com este documento: ${dup.nome} (id ${dup.id}).`, 409, 'DOCUMENTO_DUPLICADO', { contatoId: dup.id });
    }
    const c = await prisma.contato.create({ data: body as any });
    await auditar(req, 'Contato', c.id, 'CRIAR', { nome: c.nome, documento: c.documento });
    return reply.code(201).send(c);
  });

  // ---- Atualizar
  app.put('/api/v1/contatos/:id', async (req) => {
    const id = idDe(req);
    const atual = await prisma.contato.findUnique({ where: { id } });
    if (!atual) throw new NotFound('Contato');
    const body = normalizar(contatoSchema.partial().parse(req.body));
    validarDocumento(body.documento, body.tipoPessoa ?? atual.tipoPessoa);
    if (body.documento && body.documento !== atual.documento) {
      const dup = await prisma.contato.findFirst({ where: { documento: body.documento, id: { not: id } }, select: { id: true, nome: true } });
      if (dup) throw new AppError(`Já existe um contato com este documento: ${dup.nome} (id ${dup.id}).`, 409, 'DOCUMENTO_DUPLICADO', { contatoId: dup.id });
    }
    const c = await prisma.contato.update({ where: { id }, data: body as any });
    await auditar(req, 'Contato', id, 'ALTERAR', body);
    return c;
  });

  // ---- Excluir (soft se tiver movimento)
  app.delete('/api/v1/contatos/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    const c = await prisma.contato.findUnique({ where: { id } });
    if (!c) throw new NotFound('Contato');
    const movimento =
      (await prisma.venda.count({ where: { OR: [{ contatoId: id }, { transportadoraId: id }] } })) +
      (await prisma.compra.count({ where: { fornecedorId: id } })) +
      (await prisma.ordemServico.count({ where: { contatoId: id } })) +
      (await prisma.contaReceber.count({ where: { contatoId: id } })) +
      (await prisma.contaPagar.count({ where: { contatoId: id } })) +
      (await prisma.notaFiscal.count({ where: { contatoId: id } })) +
      (await prisma.notificacao.count({ where: { contatoId: id } }));
    if (movimento > 0) {
      await prisma.contato.update({ where: { id }, data: { ativo: false } });
      await auditar(req, 'Contato', id, 'EXCLUIR', { desativado: true });
      return { ok: true, desativado: true, mensagem: 'Contato possui movimentações: foi desativado em vez de excluído.' };
    }
    await prisma.contato.delete({ where: { id } });
    await auditar(req, 'Contato', id, 'EXCLUIR');
    return { ok: true, desativado: false };
  });
}

function fmt(v: number) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
