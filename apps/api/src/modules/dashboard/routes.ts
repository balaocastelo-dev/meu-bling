/**
 * DASHBOARDS — geral, vendas e OS.
 * "Realizadas" = situação com final=true e cancelamento=false.
 * Agregações feitas em JS (SQLite) após filtrar por data no banco.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { startOfDay, endOfDay, differenceInCalendarDays } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { dataSchema, arredondar } from '../../lib/util.js';
import { resumoFinanceiro } from '../financeiro/service.js';
import { chavePeriodo, listarPeriodos, resolverPeriodo, periodoAnterior, agruparPadrao, type Agrupar } from '../financeiro/periodos.js';
import { status as statusWhatsApp } from '../../integracoes/whatsapp/servico.js';

async function situacoesRealizadas(modulo: 'VENDA' | 'COMPRA' | 'OS') {
  const s = await prisma.situacao.findMany({ where: { modulo, final: true, cancelamento: false }, select: { id: true } });
  return s.map((x) => x.id);
}

async function situacoesCanceladas(modulo: 'VENDA' | 'COMPRA' | 'OS') {
  const s = await prisma.situacao.findMany({ where: { modulo, cancelamento: true }, select: { id: true } });
  return s.map((x) => x.id);
}

function pct(parte: number, total: number) {
  return total ? arredondar((parte / total) * 100, 1) : 0;
}

export default async function dashboardRoutes(app: FastifyInstance) {
  const leitura = app.exigirPerfil('ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO');
  const gestao = app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO');

  // =====================================================================
  // GERAL
  // =====================================================================
  app.get('/api/v1/dashboard/geral', { preHandler: leitura }, async (req) => {
    const hoje = new Date();
    const ini = startOfDay(hoje);
    const fim = endOfDay(hoje);
    const [sitVendaOk, sitVendaCanc, sitOsOk, sitOsCanc] = await Promise.all([situacoesRealizadas('VENDA'), situacoesCanceladas('VENDA'), situacoesRealizadas('OS'), situacoesCanceladas('OS')]);

    const [vendasHoje, osAbertas, osConcluidasHoje, financeiro, sitOs, sitVendas, osAtrasadas, saldos, notasPendentes, notasRejeitadas, comissoesPendentes, ultimosMovimentos, notifErro, notifPendentes] =
      await Promise.all([
        prisma.venda.findMany({ where: { tipo: 'PEDIDO', data: { gte: ini, lte: fim }, situacaoId: { notIn: sitVendaCanc } }, select: { total: true } }),
        prisma.ordemServico.count({ where: { situacaoId: { notIn: [...sitOsOk, ...sitOsCanc] } } }),
        prisma.ordemServico.count({ where: { OR: [{ dataConclusao: { gte: ini, lte: fim } }, { situacaoId: { in: sitOsOk }, atualizadoEm: { gte: ini, lte: fim } }] } }),
        resumoFinanceiro(),
        prisma.situacao.findMany({ where: { modulo: 'OS', ativo: true }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true, cor: true, final: true, cancelamento: true } }),
        prisma.situacao.findMany({ where: { modulo: 'VENDA', ativo: true }, orderBy: { ordem: 'asc' }, select: { id: true, nome: true, cor: true, final: true, cancelamento: true } }),
        prisma.ordemServico.count({ where: { dataPrevista: { lt: ini }, situacaoId: { notIn: [...sitOsOk, ...sitOsCanc] } } }),
        prisma.estoqueSaldo.findMany({ where: { deposito: { desconsiderarSaldo: false, ativo: true }, produto: { ativo: true, controlaEstoque: true, tipo: 'P' } }, include: { produto: { select: { id: true, nome: true, codigo: true, estoqueMinimo: true } } } }),
        prisma.notaFiscal.count({ where: { situacao: { in: ['PENDENTE', 'PROCESSANDO'] } } }),
        prisma.notaFiscal.count({ where: { situacao: { in: ['REJEITADA', 'ERRO'] } } }),
        prisma.comissao.aggregate({ where: { status: 'PENDENTE' }, _sum: { valor: true }, _count: true }),
        prisma.movimentoFinanceiro.findMany({ take: 10, orderBy: [{ data: 'desc' }, { id: 'desc' }], include: { contaFinanceira: { select: { id: true, nome: true, cor: true } }, categoria: { select: { id: true, nome: true } } } }),
        prisma.notificacao.count({ where: { status: 'ERRO' } }),
        prisma.notificacao.count({ where: { status: 'PENDENTE' } }),
      ]);

    // contagem por situação (OS e vendas abertas) — agregação em JS
    const osPorSit = await prisma.ordemServico.groupBy({ by: ['situacaoId'], _count: { _all: true } });
    const vendasPorSit = await prisma.venda.groupBy({ by: ['situacaoId'], _count: { _all: true }, where: { tipo: 'PEDIDO', data: { gte: startOfDay(new Date(hoje.getFullYear(), hoje.getMonth(), 1)) } } });
    const qtdOs = (id: number) => osPorSit.find((x) => x.situacaoId === id)?._count._all || 0;
    const qtdVenda = (id: number) => vendasPorSit.find((x) => x.situacaoId === id)?._count._all || 0;

    // estoque abaixo do mínimo: soma por produto nos depósitos que contam
    const porProduto = new Map<number, { produtoId: number; nome: string; codigo: string | null; saldo: number; estoqueMinimo: number }>();
    for (const s of saldos) {
      const p = porProduto.get(s.produtoId) || { produtoId: s.produtoId, nome: s.produto.nome, codigo: s.produto.codigo, saldo: 0, estoqueMinimo: s.produto.estoqueMinimo };
      p.saldo += s.saldo;
      porProduto.set(s.produtoId, p);
    }
    const abaixoMinimo = [...porProduto.values()].filter((p) => p.estoqueMinimo > 0 && p.saldo < p.estoqueMinimo).sort((a, b) => a.saldo - b.saldo);

    const wa = statusWhatsApp();
    const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { whatsappAtivo: true, smtpAtivo: true, certificadoValidade: true, ambienteFiscal: true } });

    const alertas: { tipo: 'erro' | 'aviso' | 'info'; mensagem: string; link: string }[] = [];
    if (osAtrasadas) alertas.push({ tipo: 'aviso', mensagem: `${osAtrasadas} OS atrasada${osAtrasadas > 1 ? 's' : ''} (previsão vencida)`, link: '/ordens-servico?atrasadas=true' });
    if (financeiro.receberAtrasado > 0) alertas.push({ tipo: 'aviso', mensagem: `Contas a receber vencidas: R$ ${financeiro.receberAtrasado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/contas-receber?situacao=ATRASADO' });
    if (financeiro.pagarAtrasado > 0) alertas.push({ tipo: 'erro', mensagem: `Contas a pagar vencidas: R$ ${financeiro.pagarAtrasado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/contas-pagar?situacao=ATRASADO' });
    if (financeiro.pagarHoje > 0) alertas.push({ tipo: 'info', mensagem: `Contas a pagar hoje: R$ ${financeiro.pagarHoje.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/contas-pagar?situacao=ABERTO' });
    if (abaixoMinimo.length) alertas.push({ tipo: 'aviso', mensagem: `${abaixoMinimo.length} produto${abaixoMinimo.length > 1 ? 's' : ''} abaixo do estoque mínimo`, link: '/estoque?abaixoMinimo=true' });
    if (notasRejeitadas) alertas.push({ tipo: 'erro', mensagem: `${notasRejeitadas} NF-e rejeitada${notasRejeitadas > 1 ? 's' : ''}/com erro`, link: '/notas-fiscais?situacao=REJEITADA' });
    if (notasPendentes) alertas.push({ tipo: 'info', mensagem: `${notasPendentes} NF-e pendente${notasPendentes > 1 ? 's' : ''} de transmissão`, link: '/notas-fiscais?situacao=PENDENTE' });
    if (wa.status !== 'CONECTADO' && (empresa?.whatsappAtivo || notifPendentes > 0)) alertas.push({ tipo: 'aviso', mensagem: 'WhatsApp desconectado', link: '/configuracoes/whatsapp' });
    if (notifErro) alertas.push({ tipo: 'aviso', mensagem: `${notifErro} notificaç${notifErro > 1 ? 'ões' : 'ão'} com erro de envio`, link: '/notificacoes?status=ERRO' });
    if (empresa?.certificadoValidade) {
      const dias = differenceInCalendarDays(empresa.certificadoValidade, hoje);
      if (dias < 0) alertas.push({ tipo: 'erro', mensagem: 'Certificado digital A1 vencido', link: '/configuracoes/fiscal' });
      else if (dias <= 30) alertas.push({ tipo: 'aviso', mensagem: `Certificado digital vence em ${dias} dia${dias === 1 ? '' : 's'}`, link: '/configuracoes/fiscal' });
    }
    // resultado da última verificação de "Saúde do sistema" (roda sozinha a cada 6 h)
    const diag = await prisma.configuracao.findUnique({ where: { chave: 'diagnostico.ultimo' } }).catch(() => null);
    if (diag) {
      try {
        const d = JSON.parse(diag.valor);
        if (d.erro > 0) alertas.push({ tipo: 'erro', mensagem: `Saúde do sistema: ${d.erro} problema${d.erro > 1 ? 's' : ''} nos dados para corrigir`, link: '/configuracoes/saude' });
        else if (d.aviso > 0) alertas.push({ tipo: 'aviso', mensagem: `Saúde do sistema: ${d.aviso} ponto${d.aviso > 1 ? 's' : ''} de atenção`, link: '/configuracoes/saude' });
      } catch {
        /* ignora */
      }
    }
    if ((comissoesPendentes._count as number) > 0) alertas.push({ tipo: 'info', mensagem: `${comissoesPendentes._count} comiss${(comissoesPendentes._count as number) > 1 ? 'ões' : 'ão'} pendente${(comissoesPendentes._count as number) > 1 ? 's' : ''} de aprovação`, link: '/comissoes?status=PENDENTE' });

    const resposta = {
      hoje: {
        vendas: vendasHoje.length,
        valorVendas: arredondar(vendasHoje.reduce((s, v) => s + v.total, 0)),
        osAbertas,
        osConcluidasHoje,
      },
      financeiro: {
        saldoTotal: financeiro.saldoTotal,
        saldoContas: financeiro.saldoContas,
        receberHoje: financeiro.receberHoje,
        receberAtrasado: financeiro.receberAtrasado,
        pagarHoje: financeiro.pagarHoje,
        pagarAtrasado: financeiro.pagarAtrasado,
      },
      os: {
        porSituacao: sitOs.filter((s) => !s.final && !s.cancelamento).map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, qtd: qtdOs(s.id) })),
        atrasadas: osAtrasadas,
      },
      vendas: {
        porSituacao: sitVendas.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, qtd: qtdVenda(s.id) })),
        realizadasNoMes: sitVendaOk.reduce((s, id) => s + qtdVenda(id), 0),
      },
      estoque: { abaixoMinimo: abaixoMinimo.slice(0, 20), qtdAbaixoMinimo: abaixoMinimo.length },
      fiscal: { pendentes: notasPendentes, rejeitadas: notasRejeitadas, ambiente: empresa?.ambienteFiscal === 1 ? 'producao' : 'homologacao' },
      comissoes: { pendentes: comissoesPendentes._count as number, valorPendente: arredondar(comissoesPendentes._sum.valor || 0) },
      whatsapp: { status: wa.status, numero: wa.numero ?? null },
      notificacoes: { pendentes: notifPendentes, erros: notifErro },
      ultimosMovimentos,
      alertas,
    };
    // VENDEDOR/TECNICO não veem dados financeiros da loja (saldos, contas, comissões de terceiros, extrato)
    if (!['ADMIN', 'GERENTE', 'FINANCEIRO'].includes(req.user.perfil)) {
      const r = resposta as any;
      r.financeiro = null;
      r.comissoes = null;
      r.ultimosMovimentos = [];
      r.alertas = alertas.filter((a) => !a.link.startsWith('/financeiro') && !a.link.startsWith('/comissoes'));
    }
    return resposta;
  });

  // =====================================================================
  // VENDAS
  // =====================================================================
  // VENDEDOR vê o dashboard restrito às próprias vendas
  app.get('/api/v1/dashboard/vendas', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR') }, async (req) => {
    if (req.user.perfil === 'VENDEDOR') (req.query as any).vendedorId = String(req.user.vendedorId ?? 0);
    const q = z
      .object({
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        vendedorId: z.coerce.number().int().optional(),
        agrupar: z.enum(['dia', 'semana', 'mes']).optional(),
        comparar: z.enum(['true', 'false']).default('true'),
        todas: z.enum(['true', 'false']).default('false'),
      })
      .parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const sitOk = await situacoesRealizadas('VENDA');
    const sitCanc = await situacoesCanceladas('VENDA');
    const whereSit = q.todas === 'true' ? { situacaoId: { notIn: sitCanc } } : { situacaoId: { in: sitOk } };

    const carregar = (de: Date, ate: Date) =>
      prisma.venda.findMany({
        where: { tipo: 'PEDIDO', data: { gte: de, lte: ate }, ...whereSit, ...(q.vendedorId ? { vendedorId: q.vendedorId } : {}) },
        include: {
          itens: { select: { produtoId: true, descricao: true, quantidade: true, total: true, custoUnitario: true, comissaoValor: true, produto: { select: { categoriaId: true, categoria: { select: { nome: true } } } } } },
          parcelas: { select: { valor: true, formaPagamento: { select: { nome: true } } } },
          vendedor: { select: { id: true, nome: true } },
          contato: { select: { id: true, nome: true } },
          situacao: { select: { id: true, nome: true, cor: true } },
        },
      });

    const vendas = await carregar(ini, fim);
    const resumoDe = (lista: typeof vendas) => {
      const faturamento = lista.reduce((s, v) => s + v.total, 0);
      const custo = lista.reduce((s, v) => s + (v.custoTotal || v.itens.reduce((a, i) => a + i.custoUnitario * i.quantidade, 0)), 0);
      const itensVendidos = lista.reduce((s, v) => s + v.itens.reduce((a, i) => a + i.quantidade, 0), 0);
      return {
        faturamento: arredondar(faturamento),
        qtdVendas: lista.length,
        ticketMedio: lista.length ? arredondar(faturamento / lista.length) : 0,
        itensVendidos: arredondar(itensVendidos),
        lucroBruto: arredondar(faturamento - custo),
        margemPct: pct(faturamento - custo, faturamento),
      };
    };
    const resumo: any = resumoDe(vendas);
    if (q.comparar === 'true') {
      const ant = periodoAnterior(ini, fim);
      const r = resumoDe(await carregar(ant.ini, ant.fim));
      resumo.comparativo = {
        ...r,
        periodo: { dataInicial: ant.ini, dataFinal: ant.fim },
        variacaoFaturamentoPct: r.faturamento ? arredondar(((resumo.faturamento - r.faturamento) / r.faturamento) * 100, 1) : null,
        variacaoQtdPct: r.qtdVendas ? arredondar(((resumo.qtdVendas - r.qtdVendas) / r.qtdVendas) * 100, 1) : null,
      };
    }

    // séries
    const periodos = listarPeriodos(ini, fim, agrupar);
    const serie = new Map(periodos.map((p) => [p, { periodo: p, faturamento: 0, qtd: 0, lucro: 0 }]));
    const acumula = <K>(mapa: Map<K, any>, chave: K, init: () => any, fn: (x: any) => void) => {
      const atual = mapa.get(chave) || mapa.set(chave, init()).get(chave)!;
      fn(atual);
    };
    const porVendedor = new Map<number, { id: number | null; nome: string; faturamento: number; qtd: number; comissao: number }>();
    const porForma = new Map<string, { nome: string; valor: number; qtd: number }>();
    const porOrigem = new Map<string, { nome: string; valor: number; qtd: number }>();
    const porSituacao = new Map<number, { id: number; nome: string; cor: string; valor: number; qtd: number }>();
    const porCategoria = new Map<string, { nome: string; valor: number; qtd: number }>();
    const topProdutos = new Map<string, { produtoId: number | null; nome: string; qtd: number; valor: number }>();
    const topClientes = new Map<number, { contatoId: number; nome: string; valor: number; qtd: number }>();

    for (const v of vendas) {
      const custo = v.custoTotal || v.itens.reduce((a, i) => a + i.custoUnitario * i.quantidade, 0);
      acumula(serie, chavePeriodo(v.data, agrupar), () => ({ periodo: chavePeriodo(v.data, agrupar), faturamento: 0, qtd: 0, lucro: 0 }), (s) => {
        s.faturamento += v.total;
        s.qtd += 1;
        s.lucro += v.total - custo;
      });
      acumula(porVendedor, v.vendedorId ?? 0, () => ({ id: v.vendedorId ?? null, nome: v.vendedor?.nome || 'Sem vendedor', faturamento: 0, qtd: 0, comissao: 0 }), (s) => {
        s.faturamento += v.total;
        s.qtd += 1;
        s.comissao += v.itens.reduce((a, i) => a + i.comissaoValor, 0);
      });
      for (const p of v.parcelas) {
        const nome = p.formaPagamento?.nome || 'Não informada';
        acumula(porForma, nome, () => ({ nome, valor: 0, qtd: 0 }), (s) => {
          s.valor += p.valor;
          s.qtd += 1;
        });
      }
      acumula(porOrigem, v.origem, () => ({ nome: v.origem, valor: 0, qtd: 0 }), (s) => {
        s.valor += v.total;
        s.qtd += 1;
      });
      acumula(porSituacao, v.situacaoId, () => ({ id: v.situacao.id, nome: v.situacao.nome, cor: v.situacao.cor, valor: 0, qtd: 0 }), (s) => {
        s.valor += v.total;
        s.qtd += 1;
      });
      acumula(topClientes, v.contatoId, () => ({ contatoId: v.contatoId, nome: v.contato.nome, valor: 0, qtd: 0 }), (s) => {
        s.valor += v.total;
        s.qtd += 1;
      });
      for (const i of v.itens) {
        const cat = i.produto?.categoria?.nome || 'Sem categoria';
        acumula(porCategoria, cat, () => ({ nome: cat, valor: 0, qtd: 0 }), (s) => {
          s.valor += i.total;
          s.qtd += i.quantidade;
        });
        const k = i.produtoId ? `p${i.produtoId}` : `d:${i.descricao}`;
        acumula(topProdutos, k, () => ({ produtoId: i.produtoId, nome: i.descricao, qtd: 0, valor: 0 }), (s) => {
          s.qtd += i.quantidade;
          s.valor += i.total;
        });
      }
    }
    const r2 = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? arredondar(v) : v]));
    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar },
      resumo,
      series: [...serie.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(r2),
      porVendedor: [...porVendedor.values()].sort((a, b) => b.faturamento - a.faturamento).map(r2),
      porFormaPagamento: [...porForma.values()].sort((a, b) => b.valor - a.valor).map(r2),
      porOrigem: [...porOrigem.values()].sort((a, b) => b.valor - a.valor).map(r2),
      topProdutos: [...topProdutos.values()].sort((a, b) => b.valor - a.valor).slice(0, 10).map(r2),
      topClientes: [...topClientes.values()].sort((a, b) => b.valor - a.valor).slice(0, 10).map(r2),
      porSituacao: [...porSituacao.values()].map(r2),
      porCategoria: [...porCategoria.values()].sort((a, b) => b.valor - a.valor).map(r2),
    };
  });

  // =====================================================================
  // OS
  // =====================================================================
  app.get('/api/v1/dashboard/os', { preHandler: leitura }, async (req) => {
    const q = z
      .object({ dataInicial: dataSchema, dataFinal: dataSchema, tecnicoId: z.coerce.number().int().optional(), agrupar: z.enum(['dia', 'semana', 'mes']).optional() })
      .parse(req.query);
    const { ini, fim } = resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const sitOk = await situacoesRealizadas('OS');
    const sitCanc = await situacoesCanceladas('OS');
    const filtroTec = q.tecnicoId ? { tecnicoId: q.tecnicoId } : {};

    const [ordens, situacoes, abertasAgora] = await Promise.all([
      prisma.ordemServico.findMany({
        where: { dataEntrada: { gte: ini, lte: fim }, ...filtroTec },
        include: { tecnico: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true, cor: true } }, itens: { select: { tipo: true, total: true, custoUnitario: true, quantidade: true } } },
      }),
      prisma.situacao.findMany({ where: { modulo: 'OS', ativo: true }, orderBy: { ordem: 'asc' } }),
      prisma.ordemServico.count({ where: { situacaoId: { notIn: [...sitOk, ...sitCanc] }, ...filtroTec } }),
    ]);
    const concluidas = ordens.filter((o) => sitOk.includes(o.situacaoId));
    const faturamento = concluidas.reduce((s, o) => s + o.total, 0);
    const tempos = concluidas.map((o) => differenceInCalendarDays(o.dataConclusao || o.dataSaida || o.atualizadoEm, o.dataEntrada)).filter((d) => d >= 0);
    const tempoMedioDias = tempos.length ? arredondar(tempos.reduce((a, b) => a + b, 0) / tempos.length, 1) : 0;

    const porTecnico = new Map<number, { id: number | null; nome: string; abertas: number; concluidas: number; faturamento: number; servicos: number; pecas: number }>();
    const porEquip = new Map<string, { equipamento: string; qtd: number; faturamento: number }>();
    const serie = new Map(listarPeriodos(ini, fim, agrupar).map((p) => [p, { periodo: p, abertas: 0, concluidas: 0, faturamento: 0 }]));
    for (const o of ordens) {
      const k = o.tecnicoId ?? 0;
      const t = porTecnico.get(k) || porTecnico.set(k, { id: o.tecnicoId ?? null, nome: o.tecnico?.nome || 'Sem técnico', abertas: 0, concluidas: 0, faturamento: 0, servicos: 0, pecas: 0 }).get(k)!;
      const concl = sitOk.includes(o.situacaoId);
      if (concl) {
        t.concluidas += 1;
        t.faturamento += o.total;
        t.servicos += o.totalServicos;
        t.pecas += o.totalPecas;
      } else if (!sitCanc.includes(o.situacaoId)) t.abertas += 1;
      const eq = (o.equipamento || 'Não informado').trim();
      const e = porEquip.get(eq) || porEquip.set(eq, { equipamento: eq, qtd: 0, faturamento: 0 }).get(eq)!;
      e.qtd += 1;
      if (concl) e.faturamento += o.total;
      const kp = chavePeriodo(o.dataEntrada, agrupar);
      const s = serie.get(kp) || serie.set(kp, { periodo: kp, abertas: 0, concluidas: 0, faturamento: 0 }).get(kp)!;
      s.abertas += 1;
      if (concl) {
        s.concluidas += 1;
        s.faturamento += o.total;
      }
    }
    const r2 = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? arredondar(v) : v]));
    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar },
      resumo: {
        abertas: abertasAgora,
        entradas: ordens.length,
        concluidas: concluidas.length,
        canceladas: ordens.filter((o) => sitCanc.includes(o.situacaoId)).length,
        faturamento: arredondar(faturamento),
        tempoMedioDias,
        ticketMedio: concluidas.length ? arredondar(faturamento / concluidas.length) : 0,
        aguardandoAprovacao: ordens.filter((o) => o.orcar && !o.orcamentoAprovado && !sitOk.includes(o.situacaoId) && !sitCanc.includes(o.situacaoId)).length,
      },
      porTecnico: [...porTecnico.values()].sort((a, b) => b.faturamento - a.faturamento).map(r2),
      porSituacao: situacoes.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, qtd: ordens.filter((o) => o.situacaoId === s.id).length })),
      porEquipamento: [...porEquip.values()].sort((a, b) => b.qtd - a.qtd).map(r2),
      series: [...serie.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(r2),
    };
  });
}
