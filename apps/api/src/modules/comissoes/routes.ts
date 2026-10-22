/**
 * Comissões de vendedores e técnicos: listagem, resumo, aprovar/pagar/cancelar e recálculo.
 * Pagar: marca PAGA e gera 1 conta a pagar (já PAGA) por pessoa na categoria "Comissões",
 * com MovimentoFinanceiro SAIDA na conta informada (atualiza saldoAtual).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar, competenciaDe, dataSchema, paginacaoSchema, paginar, respostaPaginada } from '../../lib/util.js';
import { categoriaPadraoId, recriarComissoes } from '../comum/financeiro.js';
import { hojeMeioDia } from '../comum/datas.js';

const STATUS = ['PENDENTE', 'APROVADA', 'PAGA', 'CANCELADA'] as const;
const PERFIS = ['ADMIN', 'GERENTE', 'FINANCEIRO'] as const;

const includeComissao = {
  vendedor: { select: { id: true, nome: true } },
  tecnico: { select: { id: true, nome: true } },
  venda: { select: { id: true, numero: true, data: true, total: true, contato: { select: { id: true, nome: true } } } },
  os: { select: { id: true, numero: true, dataEntrada: true, total: true, contato: { select: { id: true, nome: true } } } },
  desafio: { select: { id: true, titulo: true } },
  contaPagar: { select: { id: true, situacao: true, dataPagamento: true, valor: true } },
} as const;

const competenciaSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM').optional();

export default async function comissoesRoutes(app: FastifyInstance) {
  const gestao = { preHandler: app.exigirPerfil(...PERFIS) };

  app.get('/api/v1/comissoes', async (req) => {
    const q = paginacaoSchema
      .extend({
        competencia: competenciaSchema,
        tipo: z.enum(['VENDEDOR', 'TECNICO']).optional(),
        vendedorId: z.coerce.number().int().optional(),
        tecnicoId: z.coerce.number().int().optional(),
        status: z.enum(STATUS).optional(),
        origemTipo: z.enum(['VENDA', 'OS', 'DESAFIO']).optional(),
      })
      .parse(req.query);
    // vendedor/técnico logado sem perfil de gestão vê só as próprias
    const where: any = { competencia: q.competencia, tipo: q.tipo, vendedorId: q.vendedorId, tecnicoId: q.tecnicoId, status: q.status, origemTipo: q.origemTipo };
    if (!['ADMIN', 'GERENTE', 'FINANCEIRO'].includes(req.user.perfil)) {
      where.OR = [{ vendedorId: req.user.vendedorId ?? -1 }, { tecnicoId: req.user.tecnicoId ?? -1 }];
    }
    const [total, data, grupos] = await Promise.all([
      prisma.comissao.count({ where }),
      prisma.comissao.findMany({ where, ...paginar(q), orderBy: [{ criadoEm: 'desc' }, { id: 'desc' }], include: includeComissao }),
      prisma.comissao.groupBy({ by: ['status'], where, _sum: { valor: true } }),
    ]);
    const totais = { pendente: 0, aprovada: 0, paga: 0, cancelada: 0 };
    for (const g of grupos) {
      const k = g.status.toLowerCase() as keyof typeof totais;
      if (k in totais) totais[k] = arredondar(g._sum.valor || 0);
    }
    return { ...respostaPaginada(data, total, q), totais };
  });

  app.get('/api/v1/comissoes/resumo', async (req) => {
    const q = z.object({ competencia: competenciaSchema, tipo: z.enum(['VENDEDOR', 'TECNICO']).optional() }).parse(req.query);
    const lista = await prisma.comissao.findMany({
      where: { competencia: q.competencia, tipo: q.tipo, status: { not: 'CANCELADA' } },
      include: { vendedor: { select: { nome: true } }, tecnico: { select: { nome: true } } },
    });
    const mapa = new Map<string, { tipo: string; pessoaId: number; nome: string; qtd: number; base: number; valor: number; pendente: number; aprovada: number; paga: number }>();
    for (const c of lista) {
      const pessoaId = (c.tipo === 'VENDEDOR' ? c.vendedorId : c.tecnicoId) ?? 0;
      const k = `${c.tipo}:${pessoaId}`;
      const r = mapa.get(k) || { tipo: c.tipo, pessoaId, nome: c.vendedor?.nome || c.tecnico?.nome || '-', qtd: 0, base: 0, valor: 0, pendente: 0, aprovada: 0, paga: 0 };
      r.qtd += 1;
      r.base = arredondar(r.base + c.base);
      r.valor = arredondar(r.valor + c.valor);
      if (c.status === 'PENDENTE') r.pendente = arredondar(r.pendente + c.valor);
      if (c.status === 'APROVADA') r.aprovada = arredondar(r.aprovada + c.valor);
      if (c.status === 'PAGA') r.paga = arredondar(r.paga + c.valor);
      mapa.set(k, r);
    }
    return [...mapa.values()].sort((a, b) => a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome));
  });

  app.get('/api/v1/comissoes/:id', async (req) => {
    const id = Number((req.params as any).id);
    const c = await prisma.comissao.findUnique({ where: { id }, include: includeComissao });
    if (!c) throw new NotFound('Comissão');
    return c;
  });

  app.post('/api/v1/comissoes/aprovar', gestao, async (req) => {
    const body = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1) }).parse(req.body);
    const r = await prisma.comissao.updateMany({ where: { id: { in: body.ids }, status: 'PENDENTE' }, data: { status: 'APROVADA' } });
    await auditar(req, 'Comissao', null, 'ACAO', { acao: 'aprovar', ids: body.ids, aprovadas: r.count });
    return { ok: true, aprovadas: r.count };
  });

  app.post('/api/v1/comissoes/cancelar', gestao, async (req) => {
    const body = z.object({ ids: z.array(z.coerce.number().int().positive()).min(1) }).parse(req.body);
    const pagas = await prisma.comissao.count({ where: { id: { in: body.ids }, status: 'PAGA' } });
    if (pagas) throw new AppError(`${pagas} comissão(ões) já paga(s) não podem ser canceladas. Estorne o pagamento primeiro.`, 422, 'COMISSAO_PAGA');
    const r = await prisma.comissao.updateMany({ where: { id: { in: body.ids }, status: { in: ['PENDENTE', 'APROVADA'] } }, data: { status: 'CANCELADA' } });
    await auditar(req, 'Comissao', null, 'ACAO', { acao: 'cancelar', ids: body.ids, canceladas: r.count });
    return { ok: true, canceladas: r.count };
  });

  app.post('/api/v1/comissoes/pagar', gestao, async (req) => {
    const body = z
      .object({
        ids: z.array(z.coerce.number().int().positive()).min(1),
        contaFinanceiraId: z.coerce.number().int().positive(),
        data: dataSchema,
        observacoes: z.string().trim().nullable().optional(),
      })
      .parse(req.body);
    const conta = await prisma.contaFinanceira.findUnique({ where: { id: body.contaFinanceiraId } });
    if (!conta || !conta.ativo) throw new AppError('Conta financeira inválida.', 422, 'CONTA_FINANCEIRA');
    const data = body.data || hojeMeioDia();

    const resultado = await prisma.$transaction(async (tx) => {
      const comissoes = await tx.comissao.findMany({
        where: { id: { in: body.ids } },
        include: { vendedor: { select: { id: true, nome: true } }, tecnico: { select: { id: true, nome: true } } },
      });
      if (comissoes.length !== body.ids.length) throw new NotFound('Comissão');
      const invalidas = comissoes.filter((c) => c.status === 'PAGA' || c.status === 'CANCELADA');
      if (invalidas.length) throw new AppError(`Comissões ${invalidas.map((c) => c.id).join(', ')} já estão pagas ou canceladas.`, 422, 'COMISSAO_STATUS');

      const categoriaId = await categoriaPadraoId(tx, 'Comissões', 'DESPESA', 'DESPESA_PESSOAL');
      // agrupa por pessoa
      const grupos = new Map<string, typeof comissoes>();
      for (const c of comissoes) {
        const k = `${c.tipo}:${c.tipo === 'VENDEDOR' ? c.vendedorId : c.tecnicoId}`;
        grupos.set(k, [...(grupos.get(k) || []), c]);
      }
      const contasPagar = [];
      let totalPago = 0;
      for (const [, lista] of grupos) {
        const primeira = lista[0];
        const nome = primeira.vendedor?.nome || primeira.tecnico?.nome || 'Comissionado';
        const valor = arredondar(lista.reduce((s, c) => s + c.valor, 0));
        const competencias = [...new Set(lista.map((c) => c.competencia))].sort().join(', ');
        const cp = await tx.contaPagar.create({
          data: {
            descricao: `Comissão ${primeira.tipo === 'VENDEDOR' ? 'vendedor' : 'técnico'} ${nome} — ${competencias}`,
            dataEmissao: data,
            vencimento: data,
            competencia: competenciaDe(data),
            valor,
            valorPago: valor,
            situacao: 'PAGO',
            dataPagamento: data,
            contaFinanceiraId: conta.id,
            categoriaId,
            origemTipo: 'COMISSAO',
            observacoes: [body.observacoes, `Comissões: ${lista.map((c) => `#${c.id} ${c.descricao || ''}`).join('; ')}`].filter(Boolean).join('\n'),
          },
        });
        await tx.movimentoFinanceiro.create({
          data: { contaFinanceiraId: conta.id, data, tipo: 'SAIDA', valor, descricao: cp.descricao, categoriaId, contaPagarId: cp.id },
        });
        await tx.comissao.updateMany({ where: { id: { in: lista.map((c) => c.id) } }, data: { status: 'PAGA', pagoEm: data, contaPagarId: cp.id } });
        contasPagar.push({ id: cp.id, pessoa: nome, tipo: primeira.tipo, valor, qtd: lista.length });
        totalPago = arredondar(totalPago + valor);
      }
      await tx.contaFinanceira.update({ where: { id: conta.id }, data: { saldoAtual: { decrement: totalPago } } });
      return { pagas: comissoes.length, totalPago, contasPagar };
    });
    await auditar(req, 'Comissao', null, 'ACAO', { acao: 'pagar', ids: body.ids, contaFinanceiraId: body.contaFinanceiraId, totalPago: resultado.totalPago });
    return { ok: true, ...resultado };
  });

  // ---- recalcular comissões de uma venda/OS (se não pagas)
  app.post('/api/v1/comissoes/recalcular/:origemTipo/:id', gestao, async (req) => {
    const p = z.object({ origemTipo: z.enum(['VENDA', 'OS', 'venda', 'os']), id: z.coerce.number().int().positive() }).parse(req.params);
    const tipo = p.origemTipo.toUpperCase() as 'VENDA' | 'OS';
    const criadas = await prisma.$transaction(async (tx) => {
      if (tipo === 'VENDA') {
        const v = await tx.venda.findUnique({ where: { id: p.id }, include: { itens: true } });
        if (!v) throw new NotFound('Venda');
        if (!v.contasLancadas) throw new AppError('A venda ainda não teve as contas lançadas; as comissões são geradas ao lançar contas.', 422, 'CONTAS_NAO_LANCADAS');
        if (!v.vendedorId) return recriarComissoes(tx, { origemTipo: 'VENDA', vendaId: v.id }, competenciaDe(v.data), []);
        const base = arredondar(v.itens.reduce((s, i) => s + (i.comissaoPct > 0 ? i.total : 0), 0));
        const valor = arredondar(v.itens.reduce((s, i) => s + i.total * (i.comissaoPct / 100), 0));
        // atualiza comissaoValor dos itens
        for (const i of v.itens) await tx.vendaItem.update({ where: { id: i.id }, data: { comissaoValor: arredondar(i.total * (i.comissaoPct / 100)) } });
        return recriarComissoes(tx, { origemTipo: 'VENDA', vendaId: v.id }, competenciaDe(v.data), [
          { tipo: 'VENDEDOR', vendedorId: v.vendedorId, descricao: `Venda nº ${v.numero}`, base, pct: base > 0 ? arredondar((valor / base) * 100, 4) : 0, valor },
        ]);
      }
      const os = await tx.ordemServico.findUnique({ where: { id: p.id }, include: { itens: true } });
      if (!os) throw new NotFound('Ordem de serviço');
      if (!os.contasLancadas) throw new AppError('A OS ainda não teve as contas lançadas; as comissões são geradas ao lançar contas.', 422, 'CONTAS_NAO_LANCADAS');
      const novas = [];
      if (os.tecnicoId) {
        const it = os.itens.filter((i) => i.comissaoTecnicoPct > 0);
        const base = arredondar(it.reduce((s, i) => s + i.total, 0));
        const valor = arredondar(it.reduce((s, i) => s + i.total * (i.comissaoTecnicoPct / 100), 0));
        novas.push({ tipo: 'TECNICO' as const, tecnicoId: os.tecnicoId, descricao: `OS nº ${os.numero}`, base, pct: base > 0 ? arredondar((valor / base) * 100, 4) : 0, valor });
      }
      if (os.vendedorId) {
        const it = os.itens.filter((i) => i.comissaoVendedorPct > 0);
        const base = arredondar(it.reduce((s, i) => s + i.total, 0));
        const valor = arredondar(it.reduce((s, i) => s + i.total * (i.comissaoVendedorPct / 100), 0));
        novas.push({ tipo: 'VENDEDOR' as const, vendedorId: os.vendedorId, descricao: `OS nº ${os.numero}`, base, pct: base > 0 ? arredondar((valor / base) * 100, 4) : 0, valor });
      }
      return recriarComissoes(tx, { origemTipo: 'OS', osId: os.id }, competenciaDe(os.dataConclusao || os.dataEntrada), novas);
    });
    await auditar(req, 'Comissao', null, 'ACAO', { acao: 'recalcular', origemTipo: tipo, id: p.id, criadas: criadas.length });
    return { ok: true, comissoes: criadas };
  });
}
