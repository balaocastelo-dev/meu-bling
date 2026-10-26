/**
 * RELATÓRIOS — DRE, vendas por período, produtos mais vendidos, estoque, comissões.
 * Todos aceitam `?formato=csv` (exceto DRE, que também aceita e exporta as linhas).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { dataSchema, arredondar } from '../../lib/util.js';
import { chavePeriodo, listarPeriodos, resolverPeriodo, agruparPadrao, type Agrupar } from '../financeiro/periodos.js';
import { gerarDre } from './dre.js';

/** Gera CSV (separador ';', compatível com Excel BR) a partir de linhas-objeto. */
function csv(linhas: Record<string, any>[], colunas?: { chave: string; titulo: string }[]): string {
  if (!linhas.length && !colunas) return '';
  const cols = colunas || Object.keys(linhas[0]).map((k) => ({ chave: k, titulo: k }));
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toLocaleDateString('pt-BR');
    // inteiros (ids, contagens, números de documento) sem casas decimais; valores com 2 casas e vírgula decimal
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cab = cols.map((c) => esc(c.titulo)).join(';');
  const corpo = linhas.map((l) => cols.map((c) => esc(l[c.chave])).join(';'));
  return '﻿' + [cab, ...corpo].join('\r\n');
}

function enviarCsv(reply: FastifyReply, nome: string, conteudo: string) {
  return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${nome}.csv"`).send(conteudo);
}

const formatoSchema = z.enum(['json', 'csv']).default('json');

export default async function relatoriosRoutes(app: FastifyInstance) {
  const gestao = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');
  const leitura = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR');

  // ---- DRE
  app.get('/api/v1/relatorios/dre', { preHandler: gestao }, async (req, reply) => {
    const q = z
      .object({ dataInicial: dataSchema, dataFinal: dataSchema, regime: z.enum(['competencia', 'caixa']).default('competencia'), comparar: z.enum(['true', 'false']).default('false'), formato: formatoSchema })
      .parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    const dre = await gerarDre({ ini, fim, regime: q.regime, comparar: q.comparar === 'true' });
    if (q.formato === 'csv') {
      const linhas: Record<string, any>[] = [];
      for (const l of dre.linhas) {
        linhas.push({ codigo: l.codigo, conta: l.nome, valor: l.valor, pct: l.pct ?? '' });
        for (const i of l.itens || []) linhas.push({ codigo: '', conta: '   ' + i.nome, valor: i.valor, pct: '' });
      }
      return enviarCsv(reply, `dre-${q.regime}`, csv(linhas, [{ chave: 'codigo', titulo: 'Código' }, { chave: 'conta', titulo: 'Conta' }, { chave: 'valor', titulo: 'Valor (R$)' }, { chave: 'pct', titulo: '% Receita' }]));
    }
    return dre;
  });

  // ---- Vendas por período
  app.get('/api/v1/relatorios/vendas-por-periodo', { preHandler: leitura }, async (req, reply) => {
    const q = z
      .object({ dataInicial: dataSchema, dataFinal: dataSchema, agrupar: z.enum(['dia', 'semana', 'mes']).optional(), vendedorId: z.coerce.number().int().optional(), todas: z.enum(['true', 'false']).default('true'), formato: formatoSchema })
      .parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const sit = await prisma.situacao.findMany({ where: { modulo: 'VENDA', ...(q.todas === 'true' ? { cancelamento: false } : { final: true, cancelamento: false }) }, select: { id: true } });
    const vendas = await prisma.venda.findMany({
      where: { tipo: 'PEDIDO', data: { gte: ini, lte: fim }, situacaoId: { in: sit.map((s) => s.id) }, ...(q.vendedorId ? { vendedorId: q.vendedorId } : {}) },
      select: { data: true, total: true, custoTotal: true, custoLogistica: true, descontoValor: true, frete: true, itens: { select: { quantidade: true } } },
    });
    const mapa = new Map(listarPeriodos(ini, fim, agrupar).map((p) => [p, { periodo: p, qtdVendas: 0, itens: 0, faturamento: 0, descontos: 0, frete: 0, custo: 0, lucro: 0, ticketMedio: 0 }]));
    for (const v of vendas) {
      const k = chavePeriodo(v.data, agrupar);
      const s = mapa.get(k) || mapa.set(k, { periodo: k, qtdVendas: 0, itens: 0, faturamento: 0, descontos: 0, frete: 0, custo: 0, lucro: 0, ticketMedio: 0 }).get(k)!;
      s.qtdVendas += 1;
      s.itens += v.itens.reduce((a, i) => a + i.quantidade, 0);
      s.faturamento += v.total;
      s.descontos += v.descontoValor;
      s.frete += v.frete;
      s.custo += v.custoTotal + v.custoLogistica;
      s.lucro += v.total - v.custoTotal - v.custoLogistica;
    }
    const data = [...mapa.values()]
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((s) => ({ ...s, faturamento: arredondar(s.faturamento), descontos: arredondar(s.descontos), frete: arredondar(s.frete), custo: arredondar(s.custo), lucro: arredondar(s.lucro), ticketMedio: s.qtdVendas ? arredondar(s.faturamento / s.qtdVendas) : 0 }));
    const totais = data.reduce((t, s) => ({ qtdVendas: t.qtdVendas + s.qtdVendas, itens: t.itens + s.itens, faturamento: arredondar(t.faturamento + s.faturamento), custo: arredondar(t.custo + s.custo), lucro: arredondar(t.lucro + s.lucro) }), { qtdVendas: 0, itens: 0, faturamento: 0, custo: 0, lucro: 0 });
    if (q.formato === 'csv') return enviarCsv(reply, 'vendas-por-periodo', csv(data, [{ chave: 'periodo', titulo: 'Período' }, { chave: 'qtdVendas', titulo: 'Qtd vendas' }, { chave: 'itens', titulo: 'Itens' }, { chave: 'faturamento', titulo: 'Faturamento' }, { chave: 'descontos', titulo: 'Descontos' }, { chave: 'frete', titulo: 'Frete' }, { chave: 'custo', titulo: 'Custo' }, { chave: 'lucro', titulo: 'Lucro bruto' }, { chave: 'ticketMedio', titulo: 'Ticket médio' }]));
    return { periodo: { dataInicial: ini, dataFinal: fim, agrupar }, data, totais };
  });

  // ---- Produtos mais vendidos
  app.get('/api/v1/relatorios/produtos-mais-vendidos', { preHandler: leitura }, async (req, reply) => {
    const q = z.object({ dataInicial: dataSchema, dataFinal: dataSchema, limite: z.coerce.number().int().min(1).max(500).default(50), categoriaId: z.coerce.number().int().optional(), incluirOs: z.enum(['true', 'false']).default('true'), formato: formatoSchema }).parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    // vendas não canceladas (em aberto já conta), igual ao painel e ao dashboard de vendas
    const sitV = await prisma.situacao.findMany({ where: { modulo: 'VENDA', cancelamento: false }, select: { id: true } });
    const itens = await prisma.vendaItem.findMany({
      where: { venda: { tipo: 'PEDIDO', data: { gte: ini, lte: fim }, situacaoId: { in: sitV.map((s) => s.id) } }, ...(q.categoriaId ? { produto: { categoriaId: q.categoriaId } } : {}) },
      select: { produtoId: true, descricao: true, codigo: true, quantidade: true, total: true, custoUnitario: true, produto: { select: { categoria: { select: { nome: true } } } } },
    });
    const mapa = new Map<string, { produtoId: number | null; codigo: string | null; nome: string; categoria: string; qtd: number; valor: number; custo: number; lucro: number; vendas: number; os: number }>();
    const acum = (k: string, init: () => any, fn: (x: any) => void) => fn(mapa.get(k) || mapa.set(k, init()).get(k)!);
    for (const i of itens) {
      acum(i.produtoId ? `p${i.produtoId}` : `d${i.descricao}`, () => ({ produtoId: i.produtoId, codigo: i.codigo, nome: i.descricao, categoria: i.produto?.categoria?.nome || '', qtd: 0, valor: 0, custo: 0, lucro: 0, vendas: 0, os: 0 }), (s) => {
        s.qtd += i.quantidade;
        s.valor += i.total;
        s.custo += i.custoUnitario * i.quantidade;
        s.lucro += i.total - i.custoUnitario * i.quantidade;
        s.vendas += 1;
      });
    }
    if (q.incluirOs === 'true') {
      const sitO = await prisma.situacao.findMany({ where: { modulo: 'OS', final: true, cancelamento: false }, select: { id: true } });
      const osItens = await prisma.ordemServicoItem.findMany({
        where: { os: { dataEntrada: { gte: ini, lte: fim }, situacaoId: { in: sitO.map((s) => s.id) } }, ...(q.categoriaId ? { produto: { categoriaId: q.categoriaId } } : {}) },
        select: { produtoId: true, descricao: true, quantidade: true, total: true, custoUnitario: true, produto: { select: { codigo: true, categoria: { select: { nome: true } } } } },
      });
      for (const i of osItens) {
        acum(i.produtoId ? `p${i.produtoId}` : `d${i.descricao}`, () => ({ produtoId: i.produtoId, codigo: i.produto?.codigo || null, nome: i.descricao, categoria: i.produto?.categoria?.nome || '', qtd: 0, valor: 0, custo: 0, lucro: 0, vendas: 0, os: 0 }), (s) => {
          s.qtd += i.quantidade;
          s.valor += i.total;
          s.custo += i.custoUnitario * i.quantidade;
          s.lucro += i.total - i.custoUnitario * i.quantidade;
          s.os += 1;
        });
      }
    }
    const data = [...mapa.values()]
      .sort((a, b) => b.valor - a.valor)
      .slice(0, q.limite)
      .map((s, i) => ({ posicao: i + 1, ...s, qtd: arredondar(s.qtd), valor: arredondar(s.valor), custo: arredondar(s.custo), lucro: arredondar(s.lucro), margemPct: s.valor ? arredondar((s.lucro / s.valor) * 100, 1) : 0 }));
    if (q.formato === 'csv') return enviarCsv(reply, 'produtos-mais-vendidos', csv(data, [{ chave: 'posicao', titulo: '#' }, { chave: 'codigo', titulo: 'Código' }, { chave: 'nome', titulo: 'Produto' }, { chave: 'categoria', titulo: 'Categoria' }, { chave: 'qtd', titulo: 'Qtd' }, { chave: 'valor', titulo: 'Valor' }, { chave: 'custo', titulo: 'Custo' }, { chave: 'lucro', titulo: 'Lucro' }, { chave: 'margemPct', titulo: 'Margem %' }, { chave: 'vendas', titulo: 'Nº vendas' }, { chave: 'os', titulo: 'Nº OS' }]));
    return { periodo: { dataInicial: ini, dataFinal: fim }, data };
  });

  // ---- Estoque (valor em estoque por depósito)
  app.get('/api/v1/relatorios/estoque', { preHandler: leitura }, async (req, reply) => {
    const q = z.object({ depositoId: z.coerce.number().int().optional(), categoriaId: z.coerce.number().int().optional(), somenteComSaldo: z.enum(['true', 'false']).default('false'), formato: formatoSchema }).parse(req.query);
    const saldos = await prisma.estoqueSaldo.findMany({
      where: { ...(q.depositoId ? { depositoId: q.depositoId } : {}), produto: { ativo: true, tipo: 'P', ...(q.categoriaId ? { categoriaId: q.categoriaId } : {}) }, ...(q.somenteComSaldo === 'true' ? { saldo: { not: 0 } } : {}) },
      include: { produto: { select: { id: true, nome: true, codigo: true, precoCusto: true, preco: true, estoqueMinimo: true, categoria: { select: { nome: true } } } }, deposito: { select: { id: true, nome: true, desconsiderarSaldo: true } } },
      orderBy: [{ depositoId: 'asc' }, { produto: { nome: 'asc' } }],
    });
    const data = saldos.map((s) => ({
      depositoId: s.depositoId,
      deposito: s.deposito.nome,
      produtoId: s.produtoId,
      codigo: s.produto.codigo,
      produto: s.produto.nome,
      categoria: s.produto.categoria?.nome || '',
      saldo: arredondar(s.saldo),
      reservado: arredondar(s.reservado),
      estoqueMinimo: s.produto.estoqueMinimo,
      custoUnitario: s.produto.precoCusto,
      precoVenda: s.produto.preco,
      valorCusto: arredondar(s.saldo * s.produto.precoCusto),
      valorVenda: arredondar(s.saldo * s.produto.preco),
      contaSaldo: !s.deposito.desconsiderarSaldo,
    }));
    const porDeposito = new Map<number, { depositoId: number; deposito: string; itens: number; quantidade: number; valorCusto: number; valorVenda: number; contaSaldo: boolean }>();
    for (const d of data) {
      const x = porDeposito.get(d.depositoId) || porDeposito.set(d.depositoId, { depositoId: d.depositoId, deposito: d.deposito, itens: 0, quantidade: 0, valorCusto: 0, valorVenda: 0, contaSaldo: d.contaSaldo }).get(d.depositoId)!;
      x.itens += 1;
      x.quantidade += d.saldo;
      x.valorCusto += d.valorCusto;
      x.valorVenda += d.valorVenda;
    }
    const resumo = [...porDeposito.values()].map((x) => ({ ...x, quantidade: arredondar(x.quantidade), valorCusto: arredondar(x.valorCusto), valorVenda: arredondar(x.valorVenda) }));
    const totais = resumo.filter((r) => r.contaSaldo).reduce((t, r) => ({ itens: t.itens + r.itens, quantidade: arredondar(t.quantidade + r.quantidade), valorCusto: arredondar(t.valorCusto + r.valorCusto), valorVenda: arredondar(t.valorVenda + r.valorVenda) }), { itens: 0, quantidade: 0, valorCusto: 0, valorVenda: 0 });
    if (q.formato === 'csv') return enviarCsv(reply, 'estoque', csv(data, [{ chave: 'deposito', titulo: 'Depósito' }, { chave: 'codigo', titulo: 'Código' }, { chave: 'produto', titulo: 'Produto' }, { chave: 'categoria', titulo: 'Categoria' }, { chave: 'saldo', titulo: 'Saldo' }, { chave: 'reservado', titulo: 'Reservado' }, { chave: 'estoqueMinimo', titulo: 'Mínimo' }, { chave: 'custoUnitario', titulo: 'Custo unit.' }, { chave: 'valorCusto', titulo: 'Valor custo' }, { chave: 'precoVenda', titulo: 'Preço venda' }, { chave: 'valorVenda', titulo: 'Valor venda' }]));
    return { resumo, totais, data };
  });

  // ---- Comissões
  app.get('/api/v1/relatorios/comissoes', { preHandler: gestao }, async (req, reply) => {
    const q = z.object({ competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'competência no formato AAAA-MM').optional(), dataInicial: dataSchema, dataFinal: dataSchema, tipo: z.enum(['VENDEDOR', 'TECNICO']).optional(), status: z.string().optional(), formato: formatoSchema }).parse(req.query);
    const where: any = {};
    if (q.competencia) where.competencia = q.competencia;
    else if (q.dataInicial || q.dataFinal) {
      const { ini, fim } = resolverPeriodo(q, 'mes');
      where.criadoEm = { gte: ini, lte: fim };
    } else where.competencia = chavePeriodo(new Date(), 'mes');
    if (q.tipo) where.tipo = q.tipo;
    if (q.status) where.status = q.status;
    const comissoes = await prisma.comissao.findMany({
      where,
      include: { vendedor: { select: { id: true, nome: true } }, tecnico: { select: { id: true, nome: true } }, venda: { select: { numero: true, data: true, contato: { select: { nome: true } } } }, os: { select: { numero: true, dataEntrada: true, contato: { select: { nome: true } } } } },
      orderBy: [{ tipo: 'asc' }, { criadoEm: 'asc' }],
    });
    const data = comissoes.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      pessoaId: c.vendedorId ?? c.tecnicoId,
      pessoa: c.vendedor?.nome || c.tecnico?.nome || '',
      origem: c.origemTipo,
      numero: c.venda?.numero ?? c.os?.numero ?? null,
      cliente: c.venda?.contato?.nome || c.os?.contato?.nome || '',
      data: c.venda?.data || c.os?.dataEntrada || c.criadoEm,
      descricao: c.descricao,
      base: c.base,
      pct: c.pct,
      valor: c.valor,
      status: c.status,
      competencia: c.competencia,
      pagoEm: c.pagoEm,
    }));
    const porPessoa = new Map<string, { tipo: string; pessoaId: number | null; nome: string; qtd: number; base: number; valor: number; pendente: number; aprovada: number; paga: number }>();
    for (const c of data) {
      const k = `${c.tipo}:${c.pessoaId}`;
      const p = porPessoa.get(k) || porPessoa.set(k, { tipo: c.tipo, pessoaId: c.pessoaId ?? null, nome: c.pessoa, qtd: 0, base: 0, valor: 0, pendente: 0, aprovada: 0, paga: 0 }).get(k)!;
      p.qtd += 1;
      p.base += c.base;
      p.valor += c.valor;
      if (c.status === 'PENDENTE') p.pendente += c.valor;
      if (c.status === 'APROVADA') p.aprovada += c.valor;
      if (c.status === 'PAGA') p.paga += c.valor;
    }
    const resumo = [...porPessoa.values()].map((p) => ({ ...p, base: arredondar(p.base), valor: arredondar(p.valor), pendente: arredondar(p.pendente), aprovada: arredondar(p.aprovada), paga: arredondar(p.paga) }));
    if (q.formato === 'csv') return enviarCsv(reply, 'comissoes', csv(data, [{ chave: 'tipo', titulo: 'Tipo' }, { chave: 'pessoa', titulo: 'Pessoa' }, { chave: 'origem', titulo: 'Origem' }, { chave: 'numero', titulo: 'Nº' }, { chave: 'cliente', titulo: 'Cliente' }, { chave: 'data', titulo: 'Data' }, { chave: 'base', titulo: 'Base' }, { chave: 'pct', titulo: '%' }, { chave: 'valor', titulo: 'Comissão' }, { chave: 'status', titulo: 'Status' }, { chave: 'competencia', titulo: 'Competência' }]));
    return { filtro: where, resumo, data };
  });

  // ---- Contas a receber/pagar (CSV simples para contador)
  app.get('/api/v1/relatorios/contas', { preHandler: gestao }, async (req, reply) => {
    const q = z.object({ tipo: z.enum(['receber', 'pagar']).default('receber'), dataInicial: dataSchema, dataFinal: dataSchema, situacao: z.string().optional(), formato: formatoSchema }).parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    const where: any = { vencimento: { gte: ini, lte: fim } };
    if (q.situacao) where.situacao = q.situacao;
    const data =
      q.tipo === 'receber'
        ? (await prisma.contaReceber.findMany({ where, include: { contato: { select: { nome: true } }, categoria: { select: { nome: true } } }, orderBy: { vencimento: 'asc' } })).map((c) => ({ id: c.id, contato: c.contato?.nome || '', descricao: c.descricao, categoria: c.categoria?.nome || '', emissao: c.dataEmissao, vencimento: c.vencimento, valor: c.valor, recebido: c.valorRecebido, situacao: c.situacao, dataBaixa: c.dataRecebimento }))
        : (await prisma.contaPagar.findMany({ where, include: { contato: { select: { nome: true } }, categoria: { select: { nome: true } } }, orderBy: { vencimento: 'asc' } })).map((c) => ({ id: c.id, contato: c.contato?.nome || '', descricao: c.descricao, categoria: c.categoria?.nome || '', emissao: c.dataEmissao, vencimento: c.vencimento, valor: c.valor, recebido: c.valorPago, situacao: c.situacao, dataBaixa: c.dataPagamento }));
    if (q.formato === 'csv') return enviarCsv(reply, `contas-${q.tipo}`, csv(data, [{ chave: 'id', titulo: 'ID' }, { chave: 'contato', titulo: q.tipo === 'receber' ? 'Cliente' : 'Fornecedor' }, { chave: 'descricao', titulo: 'Descrição' }, { chave: 'categoria', titulo: 'Categoria' }, { chave: 'emissao', titulo: 'Emissão' }, { chave: 'vencimento', titulo: 'Vencimento' }, { chave: 'valor', titulo: 'Valor' }, { chave: 'recebido', titulo: q.tipo === 'receber' ? 'Recebido' : 'Pago' }, { chave: 'situacao', titulo: 'Situação' }, { chave: 'dataBaixa', titulo: 'Data baixa' }]));
    return { periodo: { dataInicial: ini, dataFinal: fim }, data };
  });
}
