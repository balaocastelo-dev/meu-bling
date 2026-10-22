/**
 * Compras (pedidos de compra) — conforme docs/API.md.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { dataSchema, paginacaoSchema, paginar, proximoNumero, respostaPaginada } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { executarAcoes, mudarSituacao, registrarAcao, registrarModulo, situacaoInicial, type Acao } from '../../core/situacoes.js';
import { idDe, idsQuery } from '../comum/zod.js';
import { intervalo } from '../comum/datas.js';
import { cabecalhoEmpresa, dadosEmpresa, data as fData, enderecoLinha, esc, formatarDocumento, formatarTelefone, moeda, paginaHtml, qtd } from '../comum/html.js';
import {
  acaoEstornarContas,
  acaoEstornarEstoque,
  acaoLancarContas,
  acaoLancarEstoque,
  CAMPOS_LIVRES_COMPRA,
  carregarCompra,
  compraCompleta,
  compraSchema,
  importarXmlNfe,
  prepararCompra,
} from './service.js';

registrarModulo('COMPRA', {
  obterSituacaoId: async (id, tx) => {
    const c = await tx.compra.findUnique({ where: { id }, select: { situacaoId: true } });
    if (!c) throw new NotFound('Compra');
    return c.situacaoId;
  },
  gravarSituacao: async (id, situacaoId, tx) => {
    await tx.compra.update({ where: { id }, data: { situacaoId } });
  },
});
registrarAcao('COMPRA', 'lancarEstoque', acaoLancarEstoque);
registrarAcao('COMPRA', 'estornarEstoque', acaoEstornarEstoque);
registrarAcao('COMPRA', 'lancarContas', acaoLancarContas);
registrarAcao('COMPRA', 'estornarContas', acaoEstornarContas);

// todos os funcionários lançam e acompanham pedidos de compra (excluir/forçar: só gestão)
const PERFIS = ['ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR', 'TECNICO'] as const;

export default async function comprasRoutes(app: FastifyInstance) {
  const edicao = { preHandler: app.exigirPerfil(...PERFIS) };

  app.get('/api/v1/compras', async (req) => {
    const q = paginacaoSchema
      .extend({
        pesquisa: z.string().trim().optional(),
        situacaoId: z.coerce.number().int().optional(),
        situacoes: idsQuery,
        fornecedorId: z.coerce.number().int().optional(),
        dataInicial: dataSchema,
        dataFinal: dataSchema,
      })
      .parse(req.query);
    const where: any = { fornecedorId: q.fornecedorId, data: intervalo(q.dataInicial, q.dataFinal) };
    if (q.situacaoId) where.situacaoId = q.situacaoId;
    else if (q.situacoes?.length) where.situacaoId = { in: q.situacoes };
    if (q.pesquisa) {
      const p = q.pesquisa;
      const n = Number(p);
      const or: any[] = [
        { fornecedor: { nome: { contains: p } } },
        { fornecedor: { nome: { contains: p.toUpperCase() } } },
        { fornecedor: { nome: { contains: p.toLowerCase() } } },
        { nfeNumero: { contains: p } },
        { nfeChave: { contains: p } },
        { ordemCompra: { contains: p } },
      ];
      if (Number.isInteger(n) && n > 0) or.push({ numero: n });
      where.OR = or;
    }
    const [total, data, agg] = await Promise.all([
      prisma.compra.count({ where }),
      prisma.compra.findMany({
        where,
        ...paginar(q),
        orderBy: [{ data: 'desc' }, { numero: 'desc' }],
        select: {
          id: true, numero: true, data: true, dataPrevista: true, total: true, totalProdutos: true, nfeNumero: true, nfeChave: true, ordemCompra: true,
          estoqueLancado: true, contasLancadas: true,
          fornecedor: { select: { id: true, nome: true, fantasia: true, documento: true } },
          situacao: { select: { id: true, nome: true, cor: true, final: true, cancelamento: true } },
          deposito: { select: { id: true, nome: true } },
        },
      }),
      prisma.compra.aggregate({ where, _sum: { total: true } }),
    ]);
    return { ...respostaPaginada(data, total, q), totais: { valor: agg._sum.total || 0 } };
  });

  app.get('/api/v1/compras/:id', async (req) => compraCompleta(idDe(req)));

  app.post('/api/v1/compras', edicao, async (req, reply) => {
    const body = compraSchema.parse(req.body);
    const compra = await prisma.$transaction(async (tx) => {
      const { itens, totalProdutos, total, data, parcelas } = await prepararCompra(tx, body);
      const situacao = body.situacaoId ? await tx.situacao.findFirst({ where: { id: body.situacaoId, modulo: 'COMPRA', ativo: true } }) : await situacaoInicial('COMPRA', tx);
      if (!situacao) throw new AppError('Situação inválida para compras.', 422, 'SITUACAO');
      const numero = await proximoNumero('COMPRA', tx);
      const c = await tx.compra.create({
        data: {
          numero,
          data,
          dataPrevista: body.dataPrevista,
          fornecedorId: body.fornecedorId,
          situacaoId: situacao.id,
          depositoId: body.depositoId ?? null,
          categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
          ordemCompra: body.ordemCompra ?? null,
          nfeChave: body.nfeChave ?? null,
          nfeNumero: body.nfeNumero ?? null,
          totalProdutos,
          descontoValor: body.descontoValor,
          frete: body.frete,
          outrasDespesas: body.outrasDespesas,
          total,
          observacoes: body.observacoes ?? null,
          observacoesInternas: body.observacoesInternas ?? null,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
      await tx.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: c.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, usuarioId: req.user.id, observacao: 'Compra criada' } });
      return c;
    });
    const sit = await prisma.situacao.findUnique({ where: { id: compra.situacaoId } });
    const acoesIniciais = sit ? (JSON.parse(sit.acoes || '[]') as Acao[]).filter((a) => a !== 'notificarCliente') : [];
    if (acoesIniciais.length) await executarAcoes('COMPRA', compra.id, acoesIniciais, req.user.id);
    await auditar(req, 'Compra', compra.id, 'CRIAR', { numero: compra.numero, total: compra.total });
    eventos.emitir('compra.criada', { compraId: compra.id, usuarioId: req.user.id });
    return reply.code(201).send(await compraCompleta(compra.id));
  });

  app.put('/api/v1/compras/:id', edicao, async (req) => {
    const id = idDe(req);
    const atual = await carregarCompra(prisma, id);
    if (atual.estoqueLancado || atual.contasLancadas) {
      const parcial = compraSchema.partial().parse(req.body);
      const proibidos = Object.keys(req.body as object).filter((k) => !(CAMPOS_LIVRES_COMPRA as readonly string[]).includes(k));
      const alterados = proibidos.filter((k) => {
        if (k === 'itens') {
          const novos = parcial.itens || [];
          if (novos.length !== atual.itens.length) return true;
          return novos.some((n, i) => {
            const a = atual.itens[i];
            return (n.produtoId ?? null) !== a.produtoId || n.quantidade !== a.quantidade || n.valorUnitario !== a.valorUnitario || (n.ipiPct || 0) !== a.ipiPct || (n.descricao ?? a.descricao) !== a.descricao;
          });
        }
        if (k === 'parcelas') {
          const novas = parcial.parcelas || [];
          if (novas.length !== atual.parcelas.length) return true;
          return novas.some((n, i) => n.valor !== atual.parcelas[i].valor || (n.formaPagamentoId ?? null) !== atual.parcelas[i].formaPagamentoId);
        }
        const novo = (parcial as any)[k];
        const velho = (atual as any)[k];
        if (novo instanceof Date && velho instanceof Date) return novo.getTime() !== velho.getTime();
        return novo !== undefined && novo !== velho;
      });
      if (alterados.length) {
        throw new AppError(`Compra com estoque/contas lançados: só é possível alterar observações e dados da NF (campos bloqueados: ${alterados.join(', ')}). Estorne antes de editar.`, 422, 'COMPRA_LANCADA', { bloqueados: alterados });
      }
      const data: Record<string, unknown> = {};
      for (const k of CAMPOS_LIVRES_COMPRA) if ((parcial as any)[k] !== undefined) data[k] = (parcial as any)[k];
      await prisma.compra.update({ where: { id }, data });
      await auditar(req, 'Compra', id, 'ALTERAR', data);
      return compraCompleta(id);
    }
    const body = compraSchema.parse(mesclarComAtual(atual, req.body as Record<string, unknown>));
    await prisma.$transaction(async (tx) => {
      const { itens, totalProdutos, total, data, parcelas } = await prepararCompra(tx, body);
      await tx.compraItem.deleteMany({ where: { compraId: id } });
      await tx.compraParcela.deleteMany({ where: { compraId: id } });
      await tx.compra.update({
        where: { id },
        data: {
          data,
          dataPrevista: body.dataPrevista,
          fornecedorId: body.fornecedorId,
          depositoId: body.depositoId ?? null,
          categoriaFinanceiraId: body.categoriaFinanceiraId ?? null,
          ordemCompra: body.ordemCompra ?? null,
          nfeChave: body.nfeChave ?? null,
          nfeNumero: body.nfeNumero ?? null,
          totalProdutos,
          descontoValor: body.descontoValor,
          frete: body.frete,
          outrasDespesas: body.outrasDespesas,
          total,
          observacoes: body.observacoes ?? null,
          observacoesInternas: body.observacoesInternas ?? null,
          itens: { create: itens },
          parcelas: { create: parcelas },
        },
      });
    });
    await auditar(req, 'Compra', id, 'ALTERAR', { itens: body.itens.length });
    return compraCompleta(id);
  });

  app.delete('/api/v1/compras/:id', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const id = idDe(req);
    const c = await prisma.compra.findUnique({ where: { id } });
    if (!c) throw new NotFound('Compra');
    if (c.estoqueLancado || c.contasLancadas) throw new AppError('Compra com estoque/contas lançados não pode ser excluída. Estorne antes.', 422, 'COMPRA_LANCADA');
    await prisma.$transaction(async (tx) => {
      await tx.historicoSituacao.deleteMany({ where: { entidadeTipo: 'COMPRA', entidadeId: id } });
      await tx.compra.delete({ where: { id } });
    });
    await auditar(req, 'Compra', id, 'EXCLUIR', { numero: c.numero });
    return { ok: true };
  });

  app.post('/api/v1/compras/:id/situacao', edicao, async (req) => {
    const id = idDe(req);
    const body = z.object({ situacaoId: z.coerce.number().int().positive(), observacao: z.string().trim().nullable().optional(), forcar: z.boolean().optional() }).parse(req.body);
    if (body.forcar && req.user.perfil !== 'ADMIN' && req.user.perfil !== 'GERENTE') throw new AppError('Somente ADMIN/GERENTE pode forçar transições.', 403, 'SEM_PERMISSAO');
    const r = await mudarSituacao({ modulo: 'COMPRA', entidadeId: id, situacaoDestinoId: body.situacaoId, usuarioId: req.user.id, observacao: body.observacao, forcar: body.forcar });
    await auditar(req, 'Compra', id, 'SITUACAO', { para: r.situacao.nome, acoes: r.acoes });
    return { situacao: { id: r.situacao.id, nome: r.situacao.nome, cor: r.situacao.cor }, acoesExecutadas: r.acoes, alterado: r.alterado };
  });

  app.post('/api/v1/compras/:id/acoes', edicao, async (req) => {
    const id = idDe(req);
    const body = z.object({ acoes: z.array(z.enum(['lancarEstoque', 'estornarEstoque', 'lancarContas', 'estornarContas'])).min(1) }).parse(req.body);
    await executarAcoes('COMPRA', id, body.acoes as Acao[], req.user.id);
    await auditar(req, 'Compra', id, 'ACAO', { acoes: body.acoes });
    return { acoesExecutadas: body.acoes, compra: await compraCompleta(id) };
  });

  // ---- importar XML de NF-e (multipart: arquivo + depositoId? + situacaoId?)
  app.post('/api/v1/compras/importar-xml', edicao, async (req, reply) => {
    let xml = '';
    const campos: Record<string, string> = {};
    if (req.isMultipart()) {
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          xml = (await part.toBuffer()).toString('utf8');
        } else {
          campos[part.fieldname] = String(part.value);
        }
      }
    } else {
      const b = z.object({ xml: z.string().min(10), depositoId: z.coerce.number().optional(), situacaoId: z.coerce.number().optional() }).parse(req.body);
      xml = b.xml;
      if (b.depositoId) campos.depositoId = String(b.depositoId);
      if (b.situacaoId) campos.situacaoId = String(b.situacaoId);
    }
    if (!xml.trim()) throw new AppError('Envie o arquivo XML da NF-e (campo "arquivo").', 400, 'SEM_ARQUIVO');
    const r = await importarXmlNfe(xml, req.user.id, {
      depositoId: campos.depositoId ? Number(campos.depositoId) : null,
      situacaoId: campos.situacaoId ? Number(campos.situacaoId) : null,
    });
    await auditar(req, 'Compra', r.compraId, 'CRIAR', { importacaoXml: true, nfeChave: r.nfeChave, itensNovos: r.itensNovos.length });
    eventos.emitir('compra.criada', { compraId: r.compraId, usuarioId: req.user.id });
    return reply.code(201).send(r);
  });

  // ---- imprimir
  app.get('/api/v1/compras/:id/imprimir', async (req, reply) => {
    const c = await carregarCompra(prisma, idDe(req));
    const emp = await dadosEmpresa();
    const f = c.fornecedor;
    const itens = c.itens
      .map(
        (i, idx) => `<tr><td class="num">${idx + 1}</td><td>${esc(i.codigoFornecedor || i.produto?.codigo || '')}</td><td>${esc(i.descricao)}</td><td class="num">${qtd(i.quantidade)} ${esc(i.unidade)}</td><td class="num">${moeda(i.valorUnitario)}</td><td class="num">${i.ipiPct ? i.ipiPct + '%' : '-'}</td><td class="num">${moeda(i.total)}</td></tr>`,
      )
      .join('');
    const parcelas = c.parcelas
      .map((p) => `<tr><td>${p.numero}/${c.parcelas.length}</td><td>${fData(p.dataVencimento)}</td><td>${esc(p.formaPagamento?.nome || '-')}</td><td class="num">${moeda(p.valor)}</td><td>${p.contaPagar ? esc(p.contaPagar.situacao) : ''}</td></tr>`)
      .join('');
    const corpo = `
    <div class="cabecalho">
      ${cabecalhoEmpresa(emp)}
      <div class="doc">
        <div class="muted">PEDIDO DE COMPRA</div>
        <div class="numero">Nº ${c.numero}</div>
        <div>Data: ${fData(c.data)}${c.dataPrevista ? ' · Previsão: ' + fData(c.dataPrevista) : ''}</div>
        <span class="sit" style="background:${esc(c.situacao.cor)}">${esc(c.situacao.nome)}</span>
      </div>
    </div>
    <h2>Fornecedor</h2>
    <div class="grid">
      <div><b>Nome:</b> ${esc(f.nome)}${f.fantasia ? ' (' + esc(f.fantasia) + ')' : ''}</div>
      <div><b>${f.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}:</b> ${esc(formatarDocumento(f.documento)) || '-'}${f.ie ? ' · IE ' + esc(f.ie) : ''}</div>
      <div><b>Telefone:</b> ${esc(formatarTelefone(f.telefone || f.celular)) || '-'}</div>
      <div><b>E-mail:</b> ${esc(f.email || '-')}</div>
      <div style="grid-column:1/-1"><b>Endereço:</b> ${esc(enderecoLinha(f)) || '-'}</div>
      ${c.ordemCompra ? `<div><b>Pedido no fornecedor:</b> ${esc(c.ordemCompra)}</div>` : ''}
      ${c.nfeNumero ? `<div><b>NF-e:</b> ${esc(c.nfeNumero)}${c.nfeChave ? ' — chave ' + esc(c.nfeChave) : ''}</div>` : ''}
      ${c.deposito ? `<div><b>Depósito:</b> ${esc(c.deposito.nome)}</div>` : ''}
    </div>
    <h2>Itens</h2>
    <table><thead><tr><th class="num">#</th><th>Código</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">IPI</th><th class="num">Total</th></tr></thead><tbody>${itens}</tbody></table>
    <table class="totais">
      <tr><td>Total dos produtos</td><td class="num">${moeda(c.totalProdutos)}</td></tr>
      ${c.descontoValor ? `<tr><td>Desconto</td><td class="num">- ${moeda(c.descontoValor)}</td></tr>` : ''}
      ${c.frete ? `<tr><td>Frete</td><td class="num">${moeda(c.frete)}</td></tr>` : ''}
      ${c.outrasDespesas ? `<tr><td>Outras despesas</td><td class="num">${moeda(c.outrasDespesas)}</td></tr>` : ''}
      <tr class="total"><td>TOTAL</td><td class="num">${moeda(c.total)}</td></tr>
    </table>
    <h2>Pagamento</h2>
    <table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>${parcelas}</tbody></table>
    ${c.observacoes ? `<h2>Observações</h2><div class="obs">${esc(c.observacoes)}</div>` : ''}
    <div class="rodape">Emitido em ${fData(new Date())} — ${esc(emp.nome)}</div>`;
    return reply.type('text/html; charset=utf-8').send(paginaHtml(`Pedido de compra nº ${c.numero}`, corpo));
  });
}

/** Body completo do PUT a partir da compra atual + campos enviados (permite PUT parcial). */
function mesclarComAtual(atual: Awaited<ReturnType<typeof carregarCompra>>, body: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    fornecedorId: atual.fornecedorId,
    data: atual.data,
    dataPrevista: atual.dataPrevista,
    depositoId: atual.depositoId,
    categoriaFinanceiraId: atual.categoriaFinanceiraId,
    ordemCompra: atual.ordemCompra,
    nfeChave: atual.nfeChave,
    nfeNumero: atual.nfeNumero,
    descontoValor: atual.descontoValor,
    frete: atual.frete,
    outrasDespesas: atual.outrasDespesas,
    observacoes: atual.observacoes,
    observacoesInternas: atual.observacoesInternas,
    itens: atual.itens.map((i) => ({ produtoId: i.produtoId, descricao: i.descricao, codigoFornecedor: i.codigoFornecedor, unidade: i.unidade, quantidade: i.quantidade, valorUnitario: i.valorUnitario, ipiPct: i.ipiPct })),
    parcelas: atual.parcelas.map((p) => ({ dataVencimento: p.dataVencimento, valor: p.valor, formaPagamentoId: p.formaPagamentoId, observacoes: p.observacoes })),
  };
  const { situacaoId: _s, ...resto } = body;
  for (const [k, v] of Object.entries(resto)) if (v !== undefined) base[k] = v;
  const mudaTotal = ['itens', 'descontoValor', 'frete', 'outrasDespesas'].some((k) => resto[k] !== undefined);
  if (mudaTotal && resto.parcelas === undefined) base.parcelas = [];
  return base;
}
