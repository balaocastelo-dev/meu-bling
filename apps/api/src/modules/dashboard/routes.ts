/**
 * DASHBOARDS — geral, vendas e OS.
 * "Realizadas" = situação com final=true e cancelamento=false.
 * Agregações feitas em JS (SQLite) após filtrar por data no banco.
 */
import type { FastifyInstance } from 'fastify';
import { avisosCaixinhas } from '../caixinhas/service.js';
import { OBS_FORA_DO_RESULTADO } from '../comum/financeiro.js';
import { z } from 'zod';
import { startOfDay, endOfDay, differenceInCalendarDays } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { dataSchema, arredondar } from '../../lib/util.js';
import { resumoFinanceiro } from '../financeiro/service.js';
import { chavePeriodo, listarPeriodos, resolverPeriodo, periodoAnterior, agruparPadrao, type Agrupar } from '../financeiro/periodos.js';
import { comissaoDeAnuncioDoTecnico, painelAnuncios } from '../anuncios/painel.js';
import { status as statusWhatsApp } from '../../integracoes/whatsapp/provedor.js';
import { ultimosAcontecimentos, ultimosLancamentos } from './atividades.js';
import { fechamentoOs } from '../ordens-servico/service.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { competenciaDe } from '../../lib/util.js';
import { categoriaPadraoId } from '../comum/financeiro.js';
import { format } from 'date-fns';
import { carregarCfgCustos, custosVenda } from '../comum/custos-venda.js';
import { cfgCustosOs, SELECT_CUSTO_OS } from '../comum/custos-os.js';
import { resumo as resumoLancamentos } from '../lancamentos-automaticos/service.js';

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

/** OS do dashboard de assistência no período (base = data de entrada ou de conclusão). */
async function ordensAssistencia(de: Date, ate: Date, base: 'entrada' | 'conclusao', tecnicoId: number | undefined, sitOk: number[]) {
  const filtroTec = tecnicoId ? { tecnicoId } : {};
  // carrega a configuração de custos (imposto, taxa de cartão) que o fechamentoOs() usa — mesma regra da venda
  await cfgCustosOs();
  return prisma.ordemServico.findMany({
    where: base === 'conclusao' ? { dataConclusao: { gte: de, lte: ate }, situacaoId: { in: sitOk }, ...filtroTec } : { dataEntrada: { gte: de, lte: ate }, ...filtroTec },
    orderBy: [{ dataEntrada: 'desc' }, { numero: 'desc' }],
    select: {
      id: true, numero: true, dataEntrada: true, dataConclusao: true, equipamento: true, marca: true, modelo: true, situacaoId: true, tecnicoId: true,
      totalServicos: true, descontoValor: true, ...SELECT_CUSTO_OS,
      contato: { select: { id: true, nome: true } },
      tecnico: { select: { id: true, nome: true } },
      situacao: { select: { id: true, nome: true, cor: true } },
    },
  });
}
type LinhaAssistencia = Awaited<ReturnType<typeof ordensAssistencia>>[number];

function somarAssistencia(lista: LinhaAssistencia[]) {
  const t = { qtd: 0, valorEntrada: 0, maoDeObra: 0, pecas: 0, descontos: 0, custoPecas: 0, custoImposto: 0, custoCartao: 0, custoLogistica: 0, custoTerceiros: 0, custoTotal: 0, lucro: 0, osSemCusto: 0 };
  for (const o of lista) {
    // custo completo da OS (peças + imposto + cartão + logística + terceiro) — mesma regra da venda e do DRE
    const f = fechamentoOs(o);
    t.qtd += 1;
    t.valorEntrada += o.total;
    t.maoDeObra += o.totalServicos;
    t.pecas += o.totalPecas;
    t.descontos += o.descontoValor;
    t.custoPecas += f.custoPecas;
    t.custoImposto += f.imposto;
    t.custoCartao += f.taxaCartao;
    t.custoLogistica += f.custoLogistica;
    t.custoTerceiros += f.custoMaoObraTerceiro;
    t.custoTotal += f.custoTotal;
    t.lucro += f.lucro;
    if (f.pecasSemCusto > 0) t.osSemCusto += 1;
  }
  const r = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, arredondar(v)])) as typeof t;
  return {
    ...r,
    ticketMedio: r.qtd ? arredondar(r.valorEntrada / r.qtd) : 0,
    margemPct: pct(r.lucro, r.valorEntrada),
    // lucro da mão de obra = serviços - terceiros; lucro das peças = peças - custo das peças
    lucroMaoDeObra: arredondar(r.maoDeObra - r.custoTerceiros),
    lucroPecas: arredondar(r.pecas - r.custoPecas),
  };
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

    const [vendasHoje, osAbertas, osConcluidasHoje, financeiro, sitOs, sitVendas, osAtrasadas, saldos, notasPendentes, notasRejeitadas, comissoesPendentes, ultimosMovimentos, notifErro, notifPendentes, lancamentosAutomaticos] =
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
        resumoLancamentos(),
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

    const wa = await statusWhatsApp();
    const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { whatsappAtivo: true, smtpAtivo: true, certificadoValidade: true, ambienteFiscal: true } });

    const alertas: { tipo: 'erro' | 'aviso' | 'info'; mensagem: string; link: string }[] = [];
    // caixinhas (Nubank) primeiro: completar no prazo é prioridade
    for (const a of (await avisosCaixinhas()).avisos) alertas.push({ tipo: a.tipo, mensagem: a.mensagem, link: a.link });
    if (osAtrasadas) alertas.push({ tipo: 'aviso', mensagem: `${osAtrasadas} OS atrasada${osAtrasadas > 1 ? 's' : ''} (previsão vencida)`, link: '/ordens-servico?atrasadas=true' });
    if (financeiro.receberAtrasado > 0) alertas.push({ tipo: 'aviso', mensagem: `Contas a receber vencidas: R$ ${financeiro.receberAtrasado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/receber?situacao=ATRASADO' });
    if (financeiro.pagarAtrasado > 0) alertas.push({ tipo: 'erro', mensagem: `Contas a pagar vencidas: R$ ${financeiro.pagarAtrasado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/pagar?situacao=ATRASADO' });
    if (financeiro.pagarHoje > 0) alertas.push({ tipo: 'info', mensagem: `Contas a pagar hoje: R$ ${financeiro.pagarHoje.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, link: '/financeiro/pagar?situacao=ABERTO' });
    if (abaixoMinimo.length) alertas.push({ tipo: 'aviso', mensagem: `${abaixoMinimo.length} produto${abaixoMinimo.length > 1 ? 's' : ''} abaixo do estoque mínimo`, link: '/estoque?abaixoMinimo=true' });
    if (notasRejeitadas) alertas.push({ tipo: 'erro', mensagem: `${notasRejeitadas} NF-e rejeitada${notasRejeitadas > 1 ? 's' : ''}/com erro`, link: '/notas-fiscais?situacao=REJEITADA' });
    if (notasPendentes) alertas.push({ tipo: 'info', mensagem: `${notasPendentes} NF-e pendente${notasPendentes > 1 ? 's' : ''} de transmissão`, link: '/notas-fiscais?situacao=PENDENTE' });
    if (wa.status !== 'CONECTADO' && (empresa?.whatsappAtivo || notifPendentes > 0)) alertas.push({ tipo: 'aviso', mensagem: 'WhatsApp desconectado', link: '/comunicacao/whatsapp' });
    if (notifErro) alertas.push({ tipo: 'aviso', mensagem: `${notifErro} notificaç${notifErro > 1 ? 'ões' : 'ão'} com erro de envio`, link: '/comunicacao/notificacoes?status=ERRO' });
    if (empresa?.certificadoValidade) {
      const dias = differenceInCalendarDays(empresa.certificadoValidade, hoje);
      if (dias < 0) alertas.push({ tipo: 'erro', mensagem: 'Certificado digital A1 vencido', link: '/configuracoes/fiscal' });
      else if (dias <= 30) alertas.push({ tipo: 'aviso', mensagem: `Certificado digital vence em ${dias} dia${dias === 1 ? '' : 's'}`, link: '/configuracoes/fiscal' });
    }
    // Robô da Saúde (roda a cada 5 min e logo depois de cada movimento): o que ainda precisa de um clique do ADMIN
    if (req.user.perfil === 'ADMIN') {
      const [errosRobo, pendRobo] = await Promise.all([
        prisma.roboSaudeAviso.count({ where: { status: 'ABERTA', nivel: 'erro' } }).catch(() => 0),
        prisma.roboSaudeAviso.count({ where: { status: 'ABERTA' } }).catch(() => 0),
      ]);
      if (errosRobo > 0) alertas.push({ tipo: 'erro', mensagem: `Robô da Saúde: ${errosRobo} problema${errosRobo > 1 ? 's' : ''} para resolver (${pendRobo} no total, a maioria com 1 clique)`, link: '/configuracoes/saude' });
      else if (pendRobo > 0) alertas.push({ tipo: 'aviso', mensagem: `Robô da Saúde: ${pendRobo} ponto${pendRobo > 1 ? 's' : ''} de atenção para resolver com poucos cliques`, link: '/configuracoes/saude' });
    }
    if ((comissoesPendentes._count as number) > 0) alertas.push({ tipo: 'info', mensagem: `${comissoesPendentes._count} comiss${(comissoesPendentes._count as number) > 1 ? 'ões' : 'ão'} pendente${(comissoesPendentes._count as number) > 1 ? 's' : ''} de aprovação`, link: '/comissoes?status=PENDENTE' });
    if (lancamentosAutomaticos.pendentes > 0) {
      const n = lancamentosAutomaticos.pendentes;
      alertas.unshift({
        tipo: 'aviso',
        mensagem: `${n} lançamento${n > 1 ? 's' : ''} automático${n > 1 ? 's' : ''} de e-mail de banco pendente${n > 1 ? 's' : ''} de revisão`,
        link: '/financeiro/lancamentos-automaticos',
      });
    }

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
      lancamentosAutomaticos,
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
  // ÚLTIMOS LANÇAMENTOS E ACONTECIMENTOS (só o dono)
  // =====================================================================
  app.get('/api/v1/dashboard/atividades', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const q = z
      .object({
        limite: z.coerce.number().int().min(5).max(200).default(15),
        categoria: z.enum(['vendas', 'os', 'compras', 'fiscal', 'financeiro', 'cadastros', 'sistema', 'acessos']).optional(),
        /** só uma das listas (cada card da tela pede a sua) */
        so: z.enum(['lancamentos', 'acontecimentos']).optional(),
      })
      .parse(req.query);
    const [lancamentos, acontecimentos] = await Promise.all([
      q.so === 'acontecimentos' ? [] : ultimosLancamentos(q.limite),
      q.so === 'lancamentos' ? [] : ultimosAcontecimentos(q.limite, q.categoria),
    ]);
    return { lancamentos, acontecimentos };
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
        // padrão: toda venda não cancelada (em aberto já conta), igual ao painel do vendedor; todas=false = só fechadas/NF
        todas: z.enum(['true', 'false']).default('true'),
      })
      .parse(req.query);
    const { ini, fim, tudo } = await resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const sitOk = await situacoesRealizadas('VENDA');
    const sitCanc = await situacoesCanceladas('VENDA');
    const whereSit = q.todas === 'true' ? { situacaoId: { notIn: sitCanc } } : { situacaoId: { in: sitOk } };

    const carregar = (de: Date, ate: Date) =>
      prisma.venda.findMany({
        where: { tipo: 'PEDIDO', data: { gte: de, lte: ate }, ...whereSit, ...(q.vendedorId ? { vendedorId: q.vendedorId } : {}) },
        include: {
          itens: { select: { produtoId: true, descricao: true, quantidade: true, total: true, custoUnitario: true, comissaoValor: true, produto: { select: { categoriaId: true, categoria: { select: { nome: true } } } } } },
          parcelas: { select: { valor: true, formaPagamento: { select: { nome: true, tipo: true } } } },
          vendedor: { select: { id: true, nome: true } },
          contato: { select: { id: true, nome: true } },
          situacao: { select: { id: true, nome: true, cor: true } },
        },
      });

    const vendas = await carregar(ini, fim);
    // custo completo da venda: produto + imposto + taxa de cartão + frete (mesma regra do DRE)
    const cfgC = await carregarCfgCustos();
    const resumoDe = (lista: typeof vendas) => {
      const faturamento = lista.reduce((s, v) => s + v.total, 0);
      const custo = lista.reduce((s, v) => s + custosVenda(v, cfgC).total, 0);
      const itensVendidos = lista.reduce((s, v) => s + v.itens.reduce((a, i) => a + i.quantidade, 0), 0);
      return {
        faturamento: arredondar(faturamento),
        qtdVendas: lista.length,
        ticketMedio: lista.length ? arredondar(faturamento / lista.length) : 0,
        itensVendidos: arredondar(itensVendidos),
        lucroBruto: arredondar(faturamento - custo),
        margemPct: pct(faturamento - custo, faturamento),
        // vendas com algum item sem custo: o lucro delas está maior que o real
        semCusto: lista.filter((v) => v.itens.some((i) => !i.custoUnitario)).length,
      };
    };
    const resumo: any = resumoDe(vendas);
    // "todo o período": não há período anterior para comparar
    if (q.comparar === 'true' && !tudo) {
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
      const custo = custosVenda(v, cfgC).total;
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
    // foto dos mais vendidos (produtos do site têm imagemUrl)
    const top = [...topProdutos.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
    const idsTop = top.map((t) => t.produtoId).filter((x): x is number => !!x);
    const fotos = idsTop.length ? await prisma.produto.findMany({ where: { id: { in: idsTop } }, select: { id: true, imagemUrl: true } }) : [];
    const fotoDe = new Map(fotos.map((f) => [f.id, f.imagemUrl]));
    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar },
      resumo,
      series: [...serie.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(r2),
      porVendedor: [...porVendedor.values()].sort((a, b) => b.faturamento - a.faturamento).map(r2),
      porFormaPagamento: [...porForma.values()].sort((a, b) => b.valor - a.valor).map(r2),
      porOrigem: [...porOrigem.values()].sort((a, b) => b.valor - a.valor).map(r2),
      topProdutos: top.map((t) => ({ ...r2(t), imagemUrl: t.produtoId ? fotoDe.get(t.produtoId) ?? null : null })),
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
    const { ini, fim, tudo } = await resolverPeriodo(q, 'mes');
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
  // =====================================================================
  // ASSISTÊNCIA TÉCNICA (só ADMIN) — panorama completo com custos e lucro
  // base=entrada: OS que ENTRARAM no período; base=conclusao: OS CONCLUÍDAS no período (fechamento do mês)
  // Canceladas ficam fora dos valores (aparecem só na contagem).
  // =====================================================================
  app.get('/api/v1/dashboard/assistencia', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const q = z
      .object({
        dataInicial: dataSchema,
        dataFinal: dataSchema,
        tecnicoId: z.coerce.number().int().optional(),
        base: z.enum(['entrada', 'conclusao']).default('entrada'),
        agrupar: z.enum(['dia', 'semana', 'mes']).optional(),
      })
      .parse(req.query);
    const { ini, fim, tudo } = await resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const [sitOk, sitCanc] = await Promise.all([situacoesRealizadas('OS'), situacoesCanceladas('OS')]);
    const dataBase = (o: { dataEntrada: Date; dataConclusao: Date | null }) => (q.base === 'conclusao' ? o.dataConclusao || o.dataEntrada : o.dataEntrada);

    const carregar = (de: Date, ate: Date) => ordensAssistencia(de, ate, q.base, q.tecnicoId, sitOk);

    const somar = somarAssistencia;
    const ordens = await carregar(ini, fim);
    const validas = ordens.filter((o) => !sitCanc.includes(o.situacaoId));
    const concluidas = validas.filter((o) => sitOk.includes(o.situacaoId));
    const emAndamento = validas.filter((o) => !sitOk.includes(o.situacaoId));
    const resumo: any = {
      ...somar(validas),
      entradas: ordens.length,
      concluidas: concluidas.length,
      emAndamento: emAndamento.length,
      canceladas: ordens.length - validas.length,
      realizado: somar(concluidas),
      previsto: somar(emAndamento),
      // concluídas com peça mas sem custo nenhum: o lucro delas está inflado
      semCusto: concluidas.filter((o) => o.totalPecas > 0 && fechamentoOs(o).custoPecas === 0).length,
    };
    if (!tudo) {
      const ant = periodoAnterior(ini, fim);
      const anteriores = (await carregar(ant.ini, ant.fim)).filter((o) => !sitCanc.includes(o.situacaoId));
      resumo.comparativo = { ...somar(anteriores), periodo: { dataInicial: ant.ini, dataFinal: ant.fim } };
    } else resumo.comparativo = null; // "todo o período": não há período anterior

    const serie = new Map(listarPeriodos(ini, fim, agrupar).map((p) => [p, { periodo: p, valorEntrada: 0, custo: 0, lucro: 0, qtd: 0 }]));
    const porTecnico = new Map<number, { id: number | null; nome: string; qtd: number; valorEntrada: number; maoDeObra: number; pecas: number; custo: number; lucro: number }>();
    const porEquip = new Map<string, { nome: string; qtd: number; valorEntrada: number; lucro: number }>();
    for (const o of validas) {
      const f = fechamentoOs(o);
      const kp = chavePeriodo(dataBase(o), agrupar);
      const s = serie.get(kp) || serie.set(kp, { periodo: kp, valorEntrada: 0, custo: 0, lucro: 0, qtd: 0 }).get(kp)!;
      s.valorEntrada += o.total;
      s.custo += f.custoTotal;
      s.lucro += f.lucro;
      s.qtd += 1;
      const kt = o.tecnicoId ?? 0;
      const t = porTecnico.get(kt) || porTecnico.set(kt, { id: o.tecnicoId ?? null, nome: o.tecnico?.nome || 'Sem técnico', qtd: 0, valorEntrada: 0, maoDeObra: 0, pecas: 0, custo: 0, lucro: 0 }).get(kt)!;
      t.qtd += 1;
      t.valorEntrada += o.total;
      t.maoDeObra += o.totalServicos;
      t.pecas += o.totalPecas;
      t.custo += f.custoTotal;
      t.lucro += f.lucro;
      const eq = (o.equipamento || 'Não informado').trim();
      const e = porEquip.get(eq) || porEquip.set(eq, { nome: eq, qtd: 0, valorEntrada: 0, lucro: 0 }).get(eq)!;
      e.qtd += 1;
      e.valorEntrada += o.total;
      e.lucro += f.lucro;
    }
    const porSituacao = new Map<number, { id: number; nome: string; cor: string; qtd: number; valor: number }>();
    for (const o of ordens) {
      const s = porSituacao.get(o.situacaoId) || porSituacao.set(o.situacaoId, { id: o.situacao.id, nome: o.situacao.nome, cor: o.situacao.cor, qtd: 0, valor: 0 }).get(o.situacaoId)!;
      s.qtd += 1;
      s.valor += o.total;
    }
    const r2 = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? arredondar(v) : v]));
    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar, base: q.base },
      resumo,
      series: [...serie.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(r2),
      porTecnico: [...porTecnico.values()].sort((a, b) => b.lucro - a.lucro).map(r2),
      porEquipamento: [...porEquip.values()].sort((a, b) => b.valorEntrada - a.valorEntrada).slice(0, 8).map(r2),
      porSituacao: [...porSituacao.values()].sort((a, b) => b.qtd - a.qtd).map(r2),
      ordens: ordens.map((o) => {
        const f = fechamentoOs(o);
        return {
          id: o.id,
          numero: o.numero,
          dataEntrada: o.dataEntrada,
          dataConclusao: o.dataConclusao,
          cliente: o.contato.nome,
          contatoId: o.contato.id,
          equipamento: [o.equipamento, o.marca, o.modelo].filter(Boolean).join(' '),
          tecnico: o.tecnico?.nome || null,
          situacao: o.situacao,
          cancelada: sitCanc.includes(o.situacaoId),
          concluida: sitOk.includes(o.situacaoId),
          valorEntrada: o.total,
          maoDeObra: o.totalServicos,
          pecas: o.totalPecas,
          desconto: o.descontoValor,
          ...f,
        };
      }),
    };
  });
  // =====================================================================
  // PANORAMA (só ADMIN) — tela inicial: vendas + assistência no período escolhido
  // Vendas: pedidos não cancelados (igual ao dashboard de vendas). Assistência: OS não canceladas
  // por data de entrada ou de conclusão (igual ao dashboard de assistência). Caixa: movimentos reais
  // das contas no período, sem as transferências entre contas.
  // =====================================================================
  app.get('/api/v1/dashboard/panorama', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const q = z
      .object({ dataInicial: dataSchema, dataFinal: dataSchema, base: z.enum(['entrada', 'conclusao']).default('entrada'), agrupar: z.enum(['dia', 'semana', 'mes']).optional() })
      .parse(req.query);
    const { ini, fim, tudo } = await resolverPeriodo(q, 'mes');
    const agrupar: Agrupar = q.agrupar || agruparPadrao(ini, fim);
    const [sitVendaCanc, sitOsOk, sitOsCanc] = await Promise.all([situacoesCanceladas('VENDA'), situacoesRealizadas('OS'), situacoesCanceladas('OS')]);

    const carregarVendas = (de: Date, ate: Date) =>
      prisma.venda.findMany({
        where: { tipo: 'PEDIDO', data: { gte: de, lte: ate }, situacaoId: { notIn: sitVendaCanc } },
        select: {
          id: true, data: true, total: true, custoTotal: true, custoLogistica: true, vendedorId: true,
          parcelas: { select: { valor: true, formaPagamento: { select: { tipo: true } } } },
          vendedor: { select: { id: true, nome: true } },
          itens: { select: { quantidade: true, custoUnitario: true } },
        },
      });
    const carregarOs = async (de: Date, ate: Date) => (await ordensAssistencia(de, ate, q.base, undefined, sitOsOk)).filter((o) => !sitOsCanc.includes(o.situacaoId));
    const carregarCaixa = async (de: Date, ate: Date) => {
      // a conta "Encontro de contas (empréstimos)" não é dinheiro de verdade: fica de fora do caixa
      const movs = await prisma.movimentoFinanceiro.findMany({ where: { data: { gte: de, lte: ate }, tipo: { in: ['ENTRADA', 'SAIDA'] }, contaFinanceira: { tipo: { not: 'COMPENSACAO' } } }, select: { data: true, tipo: true, valor: true, observacoes: true } });
      return movs.filter((m) => !OBS_FORA_DO_RESULTADO.includes(m.observacoes || ''));
    };
    const cfgC = await carregarCfgCustos();
    const custoVenda = (v: Parameters<typeof custosVenda>[0]) => custosVenda(v, cfgC).total;

    type Vendas = Awaited<ReturnType<typeof carregarVendas>>;
    type Caixa = Awaited<ReturnType<typeof carregarCaixa>>;
    const resumir = (vendas: Vendas, ordens: LinhaAssistencia[], caixa: Caixa) => {
      const vValor = vendas.reduce((s, v) => s + v.total, 0);
      const vCusto = vendas.reduce((s, v) => s + custoVenda(v), 0);
      const a = somarAssistencia(ordens);
      const entradas = caixa.filter((m) => m.tipo === 'ENTRADA').reduce((s, m) => s + m.valor, 0);
      const saidas = caixa.filter((m) => m.tipo === 'SAIDA').reduce((s, m) => s + m.valor, 0);
      const faturamento = vValor + a.valorEntrada;
      const lucro = vValor - vCusto + a.lucro;
      const qtd = vendas.length + a.qtd;
      return {
        faturamento: arredondar(faturamento),
        custo: arredondar(vCusto + a.custoTotal),
        lucro: arredondar(lucro),
        margemPct: pct(lucro, faturamento),
        qtd,
        ticketMedio: qtd ? arredondar(faturamento / qtd) : 0,
        vendas: { valor: arredondar(vValor), qtd: vendas.length, custo: arredondar(vCusto), lucro: arredondar(vValor - vCusto), margemPct: pct(vValor - vCusto, vValor), ticketMedio: vendas.length ? arredondar(vValor / vendas.length) : 0 },
        assistencia: { valor: a.valorEntrada, qtd: a.qtd, maoDeObra: a.maoDeObra, pecas: a.pecas, custoPecas: a.custoPecas, custoLogistica: a.custoLogistica, custoTerceiros: a.custoTerceiros, custo: a.custoTotal, lucro: a.lucro, margemPct: a.margemPct, ticketMedio: a.ticketMedio },
        caixa: { entradas: arredondar(entradas), saidas: arredondar(saidas), saldo: arredondar(entradas - saidas) },
      };
    };

    const [vendas, ordens, caixa] = await Promise.all([carregarVendas(ini, fim), carregarOs(ini, fim), carregarCaixa(ini, fim)]);
    const resumo: any = resumir(vendas, ordens, caixa);
    if (!tudo) {
      const ant = periodoAnterior(ini, fim);
      const [vendasAnt, ordensAnt, caixaAnt] = await Promise.all([carregarVendas(ant.ini, ant.fim), carregarOs(ant.ini, ant.fim), carregarCaixa(ant.ini, ant.fim)]);
      resumo.comparativo = { ...resumir(vendasAnt, ordensAnt, caixaAnt), periodo: { dataInicial: ant.ini, dataFinal: ant.fim } };
    } else resumo.comparativo = null; // "todo o período": não há período anterior
    resumo.osSemCusto = ordens.filter((o) => sitOsOk.includes(o.situacaoId) && o.totalPecas > 0 && fechamentoOs(o).custoPecas === 0).length;

    // série: vendas x assistência x lucro x caixa
    const nova = (p: string) => ({ periodo: p, vendas: 0, assistencia: 0, lucro: 0, entradas: 0, saidas: 0 });
    const serie = new Map(listarPeriodos(ini, fim, agrupar).map((p) => [p, nova(p)]));
    const ponto = (d: Date) => {
      const k = chavePeriodo(d, agrupar);
      return serie.get(k) || serie.set(k, nova(k)).get(k)!;
    };
    for (const v of vendas) {
      const s = ponto(v.data);
      s.vendas += v.total;
      s.lucro += v.total - custoVenda(v);
    }
    for (const o of ordens) {
      const s = ponto(q.base === 'conclusao' ? o.dataConclusao || o.dataEntrada : o.dataEntrada);
      s.assistencia += o.total;
      s.lucro += fechamentoOs(o).lucro;
    }
    for (const m of caixa) {
      const s = ponto(m.data);
      if (m.tipo === 'ENTRADA') s.entradas += m.valor;
      else s.saidas += m.valor;
    }

    // equipe
    const porVendedor = new Map<number, { id: number | null; nome: string; valor: number; qtd: number; lucro: number }>();
    for (const v of vendas) {
      const k = v.vendedorId ?? 0;
      const x = porVendedor.get(k) || porVendedor.set(k, { id: v.vendedorId ?? null, nome: v.vendedor?.nome || 'Sem vendedor', valor: 0, qtd: 0, lucro: 0 }).get(k)!;
      x.valor += v.total;
      x.qtd += 1;
      x.lucro += v.total - custoVenda(v);
    }
    const porTecnico = new Map<number, { id: number | null; nome: string; valor: number; qtd: number; lucro: number }>();
    for (const o of ordens) {
      const k = o.tecnicoId ?? 0;
      const x = porTecnico.get(k) || porTecnico.set(k, { id: o.tecnicoId ?? null, nome: o.tecnico?.nome || 'Sem técnico', valor: 0, qtd: 0, lucro: 0 }).get(k)!;
      x.valor += o.total;
      x.qtd += 1;
      x.lucro += fechamentoOs(o).lucro;
    }
    const r2 = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? arredondar(v) : v]));
    const series = [...serie.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map(r2);
    const melhor = series.reduce<any>((m, s: any) => (!m || s.vendas + s.assistencia > m.vendas + m.assistencia ? s : m), null);
    resumo.melhorPeriodo = melhor && melhor.vendas + melhor.assistencia > 0 ? { periodo: melhor.periodo, valor: arredondar(melhor.vendas + melhor.assistencia) } : null;
    return {
      periodo: { dataInicial: ini, dataFinal: fim, agrupar, base: q.base },
      resumo,
      series,
      porVendedor: [...porVendedor.values()].sort((a, b) => b.valor - a.valor).slice(0, 6).map(r2),
      porTecnico: [...porTecnico.values()].sort((a, b) => b.valor - a.valor).slice(0, 6).map(r2),
    };
  });

  // =====================================================================
  // PAGAR TÉCNICO (só ADMIN): % do lucro da assistência no período → contas a pagar
  // O lucro é recalculado aqui (não confia no número da tela).
  // =====================================================================
  const pagarTecnicoSchema = z.object({
    dataInicial: dataSchema,
    dataFinal: dataSchema,
    base: z.enum(['entrada', 'conclusao']).default('entrada'),
    /** filtro de técnico do dashboard (lucro só das OS dele); vazio = lucro de toda a assistência */
    filtroTecnicoId: z.coerce.number().int().positive().nullable().optional(),
    /** técnico que recebe */
    tecnicoId: z.coerce.number().int().positive(),
    percentual: z.coerce.number().gt(0, 'Informe a porcentagem').max(100, 'Máximo 100%'),
    /** SOMENTE_CONCLUIDAS (padrão: só o que já é dinheiro certo) | TODAS */
    escopo: z.enum(['SOMENTE_CONCLUIDAS', 'TODAS']).default('SOMENTE_CONCLUIDAS'),
    vencimento: dataSchema,
    observacoes: z.string().trim().max(1000).nullable().optional(),
    /** lança mesmo já existindo pagamento para o mesmo técnico e período */
    confirmarDuplicado: z.boolean().default(false),
    /** só calcula (prévia), não grava */
    simular: z.boolean().default(false),
  });

  app.post('/api/v1/dashboard/assistencia/pagar-tecnico', { preHandler: app.exigirPerfil('ADMIN') }, async (req, reply) => {
    const b = pagarTecnicoSchema.parse(req.body);
    const tecnico = await prisma.tecnico.findUnique({ where: { id: b.tecnicoId } });
    if (!tecnico) throw new NotFound('Técnico');
    const { ini, fim, tudo } = await resolverPeriodo(b, 'mes');
    const [sitOk, sitCanc] = await Promise.all([situacoesRealizadas('OS'), situacoesCanceladas('OS')]);
    const todas = (await ordensAssistencia(ini, fim, b.base, b.filtroTecnicoId ?? undefined, sitOk)).filter((o) => !sitCanc.includes(o.situacaoId));
    const consideradas = b.escopo === 'TODAS' ? todas : todas.filter((o) => sitOk.includes(o.situacaoId));
    const totais = somarAssistencia(consideradas);
    // Lucro já pago a este técnico pela vitrine da equipe no período (33% do anúncio dele).
    // Tirar essa fatia da base evita pagar duas vezes pelo mesmo serviço — ver docs/VITRINE-EQUIPE.md.
    const porAnuncio = await comissaoDeAnuncioDoTecnico(tecnico.id, ini, fim);
    const lucroConsiderado = arredondar(Math.max(0, totais.lucro - porAnuncio.lucro));
    const valor = arredondar((lucroConsiderado * b.percentual) / 100);
    const faixa = `${format(ini, 'dd/MM/yyyy')} a ${format(fim, 'dd/MM/yyyy')}`;
    const descricao = `Pagamento técnico ${tecnico.nome} — ${b.percentual}% do lucro da assistência (${faixa})`;
    const previa = {
      tecnico: { id: tecnico.id, nome: tecnico.nome },
      periodo: { dataInicial: ini, dataFinal: fim, base: b.base },
      escopo: b.escopo,
      qtdOs: totais.qtd,
      lucro: totais.lucro,
      lucroConsiderado,
      jaPagoPorAnuncio: porAnuncio,
      percentual: b.percentual,
      valor,
      descricao,
    };
    if (b.simular) return previa;
    if (valor <= 0) {
      const porque = porAnuncio.lucro > 0
        ? ` (do lucro de ${totais.lucro.toFixed(2)}, ${porAnuncio.lucro.toFixed(2)} já foi pago pelos anúncios da vitrine, em ${porAnuncio.qtd} venda(s))`
        : '';
      throw new AppError(`O lucro considerado no período é ${lucroConsiderado.toFixed(2)}${porque}: não há valor a pagar. Confira o período, o escopo (só concluídas?) e os custos lançados nas OS.`, 422, 'SEM_LUCRO', previa);
    }

    const jaExiste = await prisma.contaPagar.findFirst({ where: { origemTipo: 'PAGAMENTO_TECNICO', origemId: tecnico.id, descricao: { contains: `(${faixa})` }, situacao: { not: 'CANCELADO' } } });
    if (jaExiste && !b.confirmarDuplicado) {
      throw new AppError(`Já existe um pagamento para ${tecnico.nome} neste período (conta a pagar nº ${jaExiste.id}, ${jaExiste.valor.toFixed(2)}). Confirme para lançar outro.`, 409, 'PAGAMENTO_DUPLICADO', { contaId: jaExiste.id, ...previa });
    }
    const vencimento = b.vencimento || new Date();
    const categoriaId = await categoriaPadraoId(prisma, 'Pagamento de técnicos (assistência)', 'DESPESA');
    const detalhe = [
      `${totais.qtd} OS ${b.escopo === 'TODAS' ? '(todas, inclusive em andamento)' : 'concluídas'} · ${b.base === 'conclusao' ? 'por data de conclusão' : 'por data de entrada'}`,
      porAnuncio.lucro > 0
        ? `lucro ${totais.lucro.toFixed(2)} − ${porAnuncio.lucro.toFixed(2)} já pago pelos anúncios da vitrine = ${lucroConsiderado.toFixed(2)} × ${b.percentual}%`
        : `lucro ${lucroConsiderado.toFixed(2)} × ${b.percentual}%`,
    ].join(' · ');
    const conta = await prisma.contaPagar.create({
      data: {
        descricao,
        vencimento,
        competencia: competenciaDe(fim),
        valor,
        categoriaId,
        origemTipo: 'PAGAMENTO_TECNICO',
        origemId: tecnico.id,
        observacoes: [detalhe, b.observacoes].filter(Boolean).join('\n'),
      },
    });
    await auditar(req, 'ContaPagar', conta.id, 'CRIAR', { origem: 'PAGAMENTO_TECNICO', tecnicoId: tecnico.id, valor, percentual: b.percentual, lucro: totais.lucro });
    return reply.code(201).send({ ...previa, contaPagar: { id: conta.id, valor: conta.valor, vencimento: conta.vencimento, situacao: conta.situacao } });
  });

  /**
   * Pagamento extra por anúncio da equipe (vitrine) — card do dashboard principal do ADMIN.
   * Thiago, 30/10/2026: quer ver no painel dele quanto a vitrine rendeu e quanto virou pagamento.
   */
  app.get('/api/v1/dashboard/anuncios', { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') }, async (req) => {
    const q = z.object({ dataInicial: dataSchema, dataFinal: dataSchema }).parse(req.query);
    const { ini, fim } = await resolverPeriodo(q, 'mes');
    return { periodo: { dataInicial: ini, dataFinal: fim }, ...(await painelAnuncios(ini, fim)) };
  });

  // últimos pagamentos de técnico lançados (histórico na tela)
  app.get('/api/v1/dashboard/assistencia/pagamentos-tecnico', { preHandler: app.exigirPerfil('ADMIN') }, async () => {
    const contas = await prisma.contaPagar.findMany({
      where: { origemTipo: 'PAGAMENTO_TECNICO' },
      orderBy: { id: 'desc' },
      take: 10,
      select: { id: true, descricao: true, valor: true, valorPago: true, vencimento: true, situacao: true, origemId: true, criadoEm: true },
    });
    return contas;
  });
}
