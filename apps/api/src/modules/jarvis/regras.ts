/**
 * JARVIS — as regras que viram sugestão nos painéis.
 *
 * Cada regra olha os dados reais do sistema e devolve alvos com números.
 * O texto padrão já vem pronto aqui (o JARVIS funciona sem IA); quando há chave da
 * Anthropic configurada, a IA reescreve esses textos na rodada (ver worker.ts).
 *
 * Decisões do Thiago em docs/JARVIS.md.
 */
import { prisma } from '../../lib/prisma.js';
import { calcularCaixaLivre } from './caixa-livre.js';

export type Sugestao = {
  regra: string;
  chave: string;
  perfis: string;
  titulo: string;
  texto: string;
  impactoEstimado?: number | null;
  prioridade: number;
  dados?: any;
  acao?: 'DESCONTO_LOTE' | 'COBRAR_WHATSAPP' | 'CRIAR_CAIXINHA' | 'ABRIR_TELA' | 'NENHUMA';
  link?: string | null;
};

const reais = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dias = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
const arred = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ ESTOQUE_PARADO
/** Produtos com estoque e sem venda há N dias: dinheiro parado na prateleira. */
async function estoqueParado(diasLimite: number): Promise<Sugestao[]> {
  const corte = new Date(Date.now() - diasLimite * 86_400_000);

  const saldos = await prisma.estoqueSaldo.findMany({
    where: { saldo: { gt: 0 }, produto: { ativo: true, tipo: 'P', controlaEstoque: true } },
    select: { produtoId: true, saldo: true, produto: { select: { nome: true, preco: true, precoCusto: true } } },
  });
  if (saldos.length === 0) return [];

  // última venda de cada produto (uma consulta só)
  const ultimas = await prisma.vendaItem.groupBy({
    by: ['produtoId'],
    where: { produtoId: { in: saldos.map((s) => s.produtoId) }, venda: { tipo: 'PEDIDO' } },
    _max: { id: true },
  });
  const ultimoItemId = new Map(ultimas.map((u) => [u.produtoId!, u._max.id!]));
  const itens = await prisma.vendaItem.findMany({
    where: { id: { in: [...ultimoItemId.values()].filter(Boolean) as number[] } },
    select: { produtoId: true, venda: { select: { data: true } } },
  });
  const ultimaVenda = new Map(itens.map((i) => [i.produtoId!, i.venda.data]));

  const parados = saldos
    .map((s) => {
      const ultima = ultimaVenda.get(s.produtoId) ?? null;
      const diasSemVender = ultima ? dias(ultima) : 9999;
      return {
        produtoId: s.produtoId,
        nome: s.produto.nome,
        saldo: s.saldo,
        custo: s.produto.precoCusto,
        preco: s.produto.preco,
        imobilizado: arred(s.saldo * (s.produto.precoCusto || 0)),
        diasSemVender,
        nuncaVendeu: !ultima,
      };
    })
    .filter((p) => p.diasSemVender >= diasLimite && p.imobilizado > 0)
    .sort((a, b) => b.imobilizado - a.imobilizado);

  if (parados.length === 0) return [];

  const top = parados.slice(0, 20);
  const total = arred(parados.reduce((s, p) => s + p.imobilizado, 0));
  // liberar com desconto costuma devolver o custo + uma margem pequena
  const impacto = arred(total * 0.9);

  return [
    {
      regra: 'ESTOQUE_PARADO',
      chave: 'ESTOQUE_PARADO:geral',
      perfis: 'ADMIN,GERENTE',
      titulo: `${parados.length} produto(s) parado(s) há mais de ${diasLimite} dias`,
      texto:
        `Tem ${reais(total)} em ${parados.length} produto(s) sem vender há mais de ${diasLimite} dias. ` +
        `Lance uma liquidação nesses itens (começando pelos maiores: ${top.slice(0, 3).map((p) => p.nome).join(', ')}) ` +
        `e crie um desafio para os vendedores; liberar isso coloca perto de ${reais(impacto)} no caixa.`,
      impactoEstimado: impacto,
      prioridade: total > 20_000 ? 1 : 2,
      dados: { total, quantidade: parados.length, produtos: top },
      acao: 'DESCONTO_LOTE',
      link: '/produtos',
    },
  ];
}

// ------------------------------------------------------------------ CREDIARIO_VENCIDO
/** Contas a receber já vencidas: dinheiro da loja na mão do cliente. */
async function crediarioVencido(): Promise<Sugestao[]> {
  const hoje = new Date();
  const contas = await prisma.contaReceber.findMany({
    where: { situacao: { in: ['ABERTO', 'PARCIAL'] }, vencimento: { lt: hoje } },
    select: {
      id: true,
      descricao: true,
      valor: true,
      valorRecebido: true,
      vencimento: true,
      contato: { select: { id: true, nome: true, celular: true } },
    },
    orderBy: { vencimento: 'asc' },
  });
  if (contas.length === 0) return [];

  const lista = contas.map((c) => ({
    id: c.id,
    descricao: c.descricao,
    falta: arred(c.valor - c.valorRecebido),
    diasVencida: dias(c.vencimento),
    contatoId: c.contato?.id ?? null,
    cliente: c.contato?.nome ?? 'Cliente',
    celular: c.contato?.celular ?? null,
  }));
  const total = arred(lista.reduce((s, c) => s + c.falta, 0));
  if (total <= 0) return [];

  return [
    {
      regra: 'CREDIARIO_VENCIDO',
      chave: 'CREDIARIO_VENCIDO:geral',
      perfis: 'ADMIN,GERENTE',
      titulo: `${lista.length} conta(s) vencida(s): ${reais(total)} para cobrar`,
      texto:
        `${reais(total)} em ${lista.length} conta(s) já venceram (a mais antiga há ${Math.max(...lista.map((c) => c.diasVencida))} dias). ` +
        `Dispare a cobrança por WhatsApp hoje — é o dinheiro mais barato de trazer para o caixa.`,
      impactoEstimado: total,
      prioridade: 1,
      dados: { total, contas: lista.slice(0, 50) },
      acao: 'COBRAR_WHATSAPP',
      link: '/financeiro/receber',
    },
  ];
}

// ------------------------------------------------------------------ CONSIGNADO_PRAZO
/** Consignados chegando no fim do prazo (depois começam as diárias de 5% ao dia útil). */
async function consignadoPrazo(): Promise<Sugestao[]> {
  const em2Dias = new Date(Date.now() + 2 * 86_400_000);

  const [quaseVencendo, emDiarias] = await Promise.all([
    prisma.consignacao.findMany({
      where: { status: 'NO_PRAZO', dataLimite: { lte: em2Dias } },
      select: { id: true, numero: true, descricao: true, precoVenda: true, valorConsignante: true, dataLimite: true },
      orderBy: { dataLimite: 'asc' },
    }),
    prisma.consignacao.findMany({
      where: { status: 'EM_DIARIAS' },
      select: { id: true, numero: true, descricao: true, diariaValor: true, diariasIniciadasEm: true, valorConsignante: true },
    }),
  ]);

  const out: Sugestao[] = [];

  if (quaseVencendo.length > 0) {
    const valor = arred(quaseVencendo.reduce((s, c) => s + c.precoVenda, 0));
    out.push({
      regra: 'CONSIGNADO_PRAZO',
      chave: 'CONSIGNADO_PRAZO:quase-vencendo',
      perfis: 'ADMIN,GERENTE',
      titulo: `${quaseVencendo.length} consignado(s) a 2 dias de começar a pagar diária`,
      texto:
        `${quaseVencendo.length} consignado(s) (${reais(valor)} em vitrine) chegam ao fim do prazo em até 2 dias — ` +
        `depois disso a loja paga 5% por dia útil. Dê destaque no site e peça desconto ao consignante antes de virar despesa.`,
      impactoEstimado: null,
      prioridade: 1,
      dados: { consignacoes: quaseVencendo },
      acao: 'ABRIR_TELA',
      link: '/consignacoes',
    });
  }

  if (emDiarias.length > 0) {
    const porDia = arred(emDiarias.reduce((s, c) => s + (c.diariaValor || 0), 0));
    out.push({
      regra: 'CONSIGNADO_PRAZO',
      chave: 'CONSIGNADO_PRAZO:em-diarias',
      perfis: 'ADMIN,GERENTE',
      titulo: `${emDiarias.length} consignado(s) já pagando diária: ${reais(porDia)} por dia útil`,
      texto:
        `A loja está pagando ${reais(porDia)} por dia útil em ${emDiarias.length} consignado(s) parado(s) — ` +
        `${reais(arred(porDia * 20))} se correr o mês inteiro. Venda ou quite esses contratos primeiro.`,
      impactoEstimado: arred(porDia * 20),
      prioridade: 1,
      dados: { consignacoes: emDiarias, porDiaUtil: porDia },
      acao: 'ABRIR_TELA',
      link: '/consignacoes',
    });
  }

  return out;
}

// ------------------------------------------------------------------ LUMICRED_CUSTO
/** Empréstimos abertos: 6% ao mês é caro — se o caixa livre cobre, quitar antes economiza juros. */
async function lumicredCusto(caixaLivre: number): Promise<Sugestao[]> {
  const emprestimos = await prisma.emprestimo.findMany({
    where: { situacao: 'ABERTO' },
    select: {
      id: true,
      numero: true,
      descricao: true,
      valorRecebido: true,
      juros: true,
      valorDevolver: true,
      taxaPct: true,
      vencimento: true,
      credor: { select: { nome: true } },
      contasPagar: { select: { valor: true, valorPago: true, situacao: true } },
    },
  });
  if (emprestimos.length === 0) return [];

  const abertos = emprestimos.map((e) => {
    const contas = e.contasPagar.filter((c) => c.situacao !== 'CANCELADO');
    const falta = contas.length
      ? contas.reduce((t, c) => t + Math.max(0, c.valor - c.valorPago), 0)
      : e.valorDevolver;
    return {
      id: e.id,
      numero: e.numero,
      credor: e.credor?.nome ?? 'Credor',
      falta: arred(falta),
      juros: arred(e.juros),
      taxaPct: e.taxaPct,
      vencimento: e.vencimento,
    };
  });

  const totalFalta = arred(abertos.reduce((s, e) => s + e.falta, 0));
  const totalJuros = arred(abertos.reduce((s, e) => s + e.juros, 0));
  if (totalFalta <= 0) return [];

  const cobre = caixaLivre >= totalFalta;
  return [
    {
      regra: 'LUMICRED_CUSTO',
      chave: 'LUMICRED_CUSTO:geral',
      perfis: 'ADMIN',
      titulo: `${abertos.length} empréstimo(s) aberto(s): ${reais(totalFalta)} a devolver`,
      texto: cobre
        ? `O caixa livre (${reais(caixaLivre)}) cobre os ${reais(totalFalta)} dos empréstimos abertos. ` +
          `Quitar agora economiza ${reais(totalJuros)} de juros — compare com o retorno de usar esse dinheiro em estoque que gira.`
        : `Há ${reais(totalFalta)} a devolver em empréstimos, com ${reais(totalJuros)} de juros (${abertos[0]?.taxaPct ?? 6}% ao mês). ` +
          `Enquanto esse saldo existir, cada venda está pagando juros antes de virar caixa: priorize quitar o mais antigo.`,
      impactoEstimado: totalJuros,
      prioridade: 2,
      dados: { emprestimos: abertos, totalFalta, totalJuros, caixaLivre, cobre },
      acao: 'ABRIR_TELA',
      link: '/financeiro/emprestimos',
    },
  ];
}

// ------------------------------------------------------------------ CAIXINHA_ATRASADA
/** Caixinhas cujo ritmo diário não está sendo cumprido (prioridade do Thiago). */
async function caixinhaAtrasada(): Promise<Sugestao[]> {
  const caixinhas = await prisma.caixinha.findMany({
    where: { ativo: true, usadaEm: null },
    select: {
      id: true,
      nome: true,
      valorMeta: true,
      dataUso: true,
      dataInicio: true,
      movimentos: { select: { tipo: true, valor: true } },
    },
  });
  if (caixinhas.length === 0) return [];

  const out: Sugestao[] = [];
  for (const cx of caixinhas) {
    const guardado = cx.movimentos.reduce((t, m) => t + (m.tipo === 'SAIDA' ? -m.valor : m.valor), 0);
    const falta = arred(Math.max(0, cx.valorMeta - guardado));
    if (falta <= 0) continue;

    const diasRestantes = Math.max(0, Math.ceil((cx.dataUso.getTime() - Date.now()) / 86_400_000));
    const porDia = arred(falta / Math.max(1, diasRestantes));

    // o ritmo esperado até hoje: quanto já deveria ter sido guardado
    const totalDias = Math.max(1, Math.ceil((cx.dataUso.getTime() - cx.dataInicio.getTime()) / 86_400_000));
    const decorridos = Math.max(0, Math.min(totalDias, Math.ceil((Date.now() - cx.dataInicio.getTime()) / 86_400_000)));
    const esperado = arred((cx.valorMeta * decorridos) / totalDias);
    const atrasada = guardado < esperado - 0.01;

    if (!atrasada && diasRestantes > 7) continue;

    out.push({
      regra: 'CAIXINHA_ATRASADA',
      chave: `CAIXINHA_ATRASADA:caixinha:${cx.id}`,
      perfis: 'ADMIN,GERENTE',
      titulo: `Caixinha "${cx.nome}": faltam ${reais(falta)}`,
      texto: diasRestantes === 0
        ? `A caixinha "${cx.nome}" vence hoje e ainda faltam ${reais(falta)}. Complete agora ou remarque a data de uso.`
        : `Para a caixinha "${cx.nome}" fechar no prazo (${diasRestantes} dia(s)), guarde ${reais(porDia)} por dia. ` +
          `Já guardou ${reais(arred(guardado))} de ${reais(cx.valorMeta)}${atrasada ? `, ${reais(arred(esperado - guardado))} atrás do ritmo` : ''}.`,
      impactoEstimado: null,
      prioridade: diasRestantes <= 3 ? 1 : 2,
      dados: { caixinhaId: cx.id, falta, porDia, guardado: arred(guardado), meta: cx.valorMeta, diasRestantes },
      acao: 'ABRIR_TELA',
      link: '/financeiro/caixinhas',
    });
  }
  return out;
}

// ------------------------------------------------------------------ TAXA_CARTAO
/** Quanto a loja pagou de taxa de cartão no mês (crédito 1x 5% … 12x 12%). */
async function taxaCartao(): Promise<Sugestao[]> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const parcelas = await prisma.vendaParcela.findMany({
    where: { venda: { data: { gte: inicioMes }, tipo: 'PEDIDO' } },
    select: { valor: true, formaPagamento: { select: { nome: true, tipo: true, taxaPct: true } } },
  });
  if (parcelas.length === 0) return [];

  // taxa real cadastrada na forma de pagamento; sem ela, a regra da loja (1x = 5% … 12x = 12%)
  let totalCartao = 0;
  let taxaTotal = 0;
  for (const p of parcelas) {
    const nome = (p.formaPagamento?.nome || '').toLowerCase();
    const tipo = (p.formaPagamento?.tipo || '').toUpperCase();
    const ehCredito = tipo === 'CARTAO_CREDITO' || nome.includes('crédito') || nome.includes('credito');
    if (!ehCredito) continue;
    let pct = p.formaPagamento?.taxaPct ?? 0;
    if (pct <= 0) {
      const m = nome.match(/(\d{1,2})\s*x/);
      const vezes = m ? Math.min(12, Math.max(1, Number(m[1]))) : 1;
      pct = 5 + (vezes - 1) * (7 / 11); // 1x = 5% … 12x = 12%
    }
    totalCartao += p.valor;
    taxaTotal += (p.valor * pct) / 100;
  }
  if (taxaTotal < 50) return [];

  return [
    {
      regra: 'TAXA_CARTAO',
      chave: 'TAXA_CARTAO:mes',
      perfis: 'ADMIN',
      titulo: `${reais(arred(taxaTotal))} de taxa de cartão neste mês`,
      texto:
        `De ${reais(arred(totalCartao))} vendidos no crédito neste mês, ${reais(arred(taxaTotal))} ficaram na maquininha. ` +
        `Um desconto de 3% no PIX à vista sai mais barato que o parcelado longo e traz o dinheiro na hora.`,
      impactoEstimado: arred(taxaTotal * 0.4),
      prioridade: 3,
      dados: { totalCartao: arred(totalCartao), taxaTotal: arred(taxaTotal) },
      acao: 'NENHUMA',
      link: '/relatorios/dre',
    },
  ];
}

// ------------------------------------------------------------------ OPORTUNIDADE_COMPRA
/** O que mais gira e está acabando: repor com o caixa livre devolve dinheiro rápido. */
async function oportunidadeCompra(caixaLivre: number): Promise<Sugestao[]> {
  if (caixaLivre <= 0) return [];
  const de30 = new Date(Date.now() - 30 * 86_400_000);

  const vendidos = await prisma.vendaItem.groupBy({
    by: ['produtoId'],
    where: { produtoId: { not: null }, venda: { tipo: 'PEDIDO', data: { gte: de30 } } },
    _sum: { quantidade: true, total: true },
    orderBy: { _sum: { total: 'desc' } },
    take: 30,
  });
  if (vendidos.length === 0) return [];

  const ids = vendidos.map((v) => v.produtoId!).filter(Boolean);
  const [produtos, saldos] = await Promise.all([
    prisma.produto.findMany({
      where: { id: { in: ids }, ativo: true },
      select: { id: true, nome: true, preco: true, precoCusto: true },
    }),
    prisma.estoqueSaldo.groupBy({ by: ['produtoId'], where: { produtoId: { in: ids } }, _sum: { saldo: true } }),
  ]);
  const saldoDe = new Map(saldos.map((s) => [s.produtoId, s._sum.saldo || 0]));
  const prodDe = new Map(produtos.map((p) => [p.id, p]));

  const repor = vendidos
    .map((v) => {
      const p = prodDe.get(v.produtoId!);
      if (!p) return null;
      const porDia = (v._sum.quantidade || 0) / 30;
      const saldo = saldoDe.get(v.produtoId!) || 0;
      const diasDeEstoque = porDia > 0 ? saldo / porDia : 999;
      const margem = p.preco > 0 && p.precoCusto > 0 ? arred(((p.preco - p.precoCusto) / p.preco) * 100) : null;
      return {
        produtoId: p.id,
        nome: p.nome,
        vendido30d: arred(v._sum.total || 0),
        quantidade30d: arred(v._sum.quantidade || 0),
        saldo: arred(saldo),
        diasDeEstoque: arred(diasDeEstoque),
        custoRepor: arred(Math.ceil(porDia * 30) * (p.precoCusto || 0)),
        margem,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.diasDeEstoque < 7 && x.custoRepor > 0)
    .sort((a, b) => b.vendido30d - a.vendido30d)
    .slice(0, 10);

  if (repor.length === 0) return [];
  const custo = arred(repor.reduce((s, r) => s + r.custoRepor, 0));
  const retorno = arred(repor.reduce((s, r) => s + r.vendido30d, 0));

  return [
    {
      regra: 'OPORTUNIDADE_COMPRA',
      chave: 'OPORTUNIDADE_COMPRA:geral',
      perfis: 'ADMIN',
      titulo: `${repor.length} item(ns) que giram estão acabando`,
      texto:
        `${repor.length} produto(s) que venderam ${reais(retorno)} nos últimos 30 dias têm menos de 7 dias de estoque. ` +
        `Repor custa perto de ${reais(custo)} e é o uso mais rápido do caixa livre de ${reais(caixaLivre)}.`,
      impactoEstimado: arred(retorno - custo),
      prioridade: caixaLivre > custo ? 2 : 3,
      dados: { produtos: repor, custo, retorno },
      acao: 'ABRIR_TELA',
      link: '/compras/nova',
    },
  ];
}


// ------------------------------------------------------------------ EMPRESTIMO_VENCIDO
/** Empréstimo cujo prazo com o credor já passou e ainda tem saldo: o mais caro de deixar correr. */
async function emprestimoVencido(): Promise<Sugestao[]> {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const emprestimos = await prisma.emprestimo.findMany({
    where: { situacao: 'ABERTO' },
    select: {
      id: true,
      numero: true,
      importado: true,
      vencimento: true,
      valorDevolver: true,
      credor: { select: { nome: true } },
      contasPagar: { select: { valor: true, valorPago: true, situacao: true, vencimento: true } },
    },
  });

  const vencidos = emprestimos
    .map((e) => {
      const contas = e.contasPagar.filter((c) => c.situacao !== 'CANCELADO');
      const abertas = contas.filter((c) => ['ABERTO', 'PARCIAL'].includes(c.situacao));
      const saldo = abertas.reduce((t, c) => t + Math.max(0, c.valor - c.valorPago), 0);
      // sem contas lançadas o vencimento da operação manda
      const vence = abertas.length ? abertas.map((c) => c.vencimento).sort((a, b) => +a - +b)[0] : e.vencimento;
      const falta = contas.length ? saldo : e.valorDevolver;
      const atraso = Math.floor((hoje.getTime() - new Date(vence).getTime()) / 86_400_000);
      return { id: e.id, numero: e.numero, credor: e.credor?.nome ?? 'Credor', falta: arred(falta), atraso, importado: e.importado };
    })
    .filter((e) => e.falta > 0 && e.atraso > 0)
    .sort((a, b) => b.atraso - a.atraso);

  if (vencidos.length === 0) return [];

  const total = arred(vencidos.reduce((s, e) => s + e.falta, 0));
  const antigos = vencidos.filter((e) => e.atraso > 90);
  const out: Sugestao[] = [
    {
      regra: 'EMPRESTIMO_VENCIDO',
      chave: 'EMPRESTIMO_VENCIDO:geral',
      perfis: 'ADMIN',
      titulo: `${vencidos.length} empréstimo(s) vencido(s): ${reais(total)} em atraso com o credor`,
      texto:
        `${reais(total)} em ${vencidos.length} operação(ões) passaram do prazo com o credor ` +
        `(a mais antiga há ${vencidos[0].atraso} dias). Quite ou renegocie antes que vire juros sobre juros.`,
      impactoEstimado: total,
      prioridade: 1,
      dados: { total, emprestimos: vencidos.slice(0, 30) },
      acao: 'ABRIR_TELA',
      link: '/financeiro/emprestimos',
    },
  ];

  // muitos em atraso antigo costuma ser baixa que não foi feita no sistema
  if (antigos.length >= 5) {
    out.push({
      regra: 'EMPRESTIMO_VENCIDO',
      chave: 'EMPRESTIMO_VENCIDO:acertar-cadastro',
      perfis: 'ADMIN',
      titulo: `${antigos.length} empréstimo(s) parados há mais de 90 dias`,
      texto:
        `${antigos.length} operações estão em aberto há mais de 90 dias, somando ${reais(arred(antigos.reduce((s, e) => s + e.falta, 0)))}. ` +
        `Se já foram pagas, dar baixa deixa o caixa livre mostrar a verdade; se não foram, são a conta mais urgente da loja.`,
      impactoEstimado: null,
      prioridade: 2,
      dados: { emprestimos: antigos.slice(0, 30) },
      acao: 'ABRIR_TELA',
      link: '/financeiro/emprestimos',
    });
  }

  return out;
}

// ------------------------------------------------------------------ EMPRESTIMO_SEM_CONTA
/**
 * Empréstimo sem nenhuma conta a pagar lançada fica "ABERTO" para sempre no cadastro —
 * o sistema só considera quitado quando as contas estão pagas. São quase sempre operações
 * trazidas do histórico do Bling que já foram pagas lá fora.
 */
async function emprestimoSemConta(semContas: number, abertos: number): Promise<Sugestao[]> {
  if (semContas < 3) return [];

  const lista = await prisma.emprestimo.findMany({
    where: { situacao: 'ABERTO' },
    select: {
      id: true,
      numero: true,
      importado: true,
      valorDevolver: true,
      dataOperacao: true,
      credor: { select: { nome: true } },
      contasPagar: { select: { situacao: true } },
    },
  });
  const fantasmas = lista
    .filter((e) => e.contasPagar.filter((c) => c.situacao !== 'CANCELADO').length === 0)
    .map((e) => ({
      id: e.id,
      numero: e.numero,
      credor: e.credor?.nome ?? 'Credor',
      valor: arred(e.valorDevolver),
      data: e.dataOperacao,
      importado: e.importado,
    }));
  if (fantasmas.length === 0) return [];

  const importados = fantasmas.filter((f) => f.importado).length;
  const total = arred(fantasmas.reduce((s, f) => s + f.valor, 0));

  return [
    {
      regra: 'EMPRESTIMO_SEM_CONTA',
      chave: 'EMPRESTIMO_SEM_CONTA:geral',
      perfis: 'ADMIN',
      titulo: `${fantasmas.length} de ${abertos} empréstimo(s) sem conta a pagar lançada`,
      texto:
        `${fantasmas.length} operações (${reais(total)}${importados ? `, ${importados} vindas do histórico do Bling` : ''}) ` +
        `não têm conta a pagar no sistema, então ficam "abertas" para sempre e sujam o número do caixa. ` +
        `Cancele as que já foram pagas lá fora e lance as que ainda devem.`,
      impactoEstimado: null,
      prioridade: 2,
      dados: { total, emprestimos: fantasmas.slice(0, 40), importados },
      acao: 'ABRIR_TELA',
      link: '/financeiro/emprestimos',
    },
  ];
}

// ------------------------------------------------------------------ MARGEM_BAIXA
/** Categorias vendendo abaixo da margem média da loja nos últimos 90 dias. */
async function margemBaixa(): Promise<Sugestao[]> {
  const de90 = new Date(Date.now() - 90 * 86_400_000);

  const itens = await prisma.vendaItem.findMany({
    where: { venda: { tipo: 'PEDIDO', data: { gte: de90 } }, produtoId: { not: null } },
    select: {
      total: true,
      quantidade: true,
      custoUnitario: true,
      produto: { select: { categoria: { select: { id: true, nome: true } } } },
    },
  });
  if (itens.length < 20) return [];

  const porCategoria = new Map<string, { nome: string; receita: number; custo: number }>();
  let receitaTotal = 0;
  let custoTotal = 0;

  for (const i of itens) {
    const custo = (i.custoUnitario || 0) * (i.quantidade || 0);
    if (custo <= 0) continue; // sem custo lançado não dá para falar de margem
    const nome = i.produto?.categoria?.nome ?? 'Sem categoria';
    const atual = porCategoria.get(nome) ?? { nome, receita: 0, custo: 0 };
    atual.receita += i.total || 0;
    atual.custo += custo;
    porCategoria.set(nome, atual);
    receitaTotal += i.total || 0;
    custoTotal += custo;
  }
  if (receitaTotal <= 0) return [];

  const margemLoja = ((receitaTotal - custoTotal) / receitaTotal) * 100;
  const fracas = [...porCategoria.values()]
    .filter((c) => c.receita > receitaTotal * 0.03) // ignora categoria irrelevante
    .map((c) => ({ ...c, margem: arred(((c.receita - c.custo) / c.receita) * 100), receita: arred(c.receita) }))
    .filter((c) => c.margem < margemLoja - 5)
    .sort((a, b) => a.margem - b.margem)
    .slice(0, 5);

  if (fracas.length === 0) return [];

  // quanto renderia subir as fracas até a média da loja
  const ganho = arred(fracas.reduce((s, c) => s + c.receita * ((margemLoja - c.margem) / 100), 0));

  return [
    {
      regra: 'MARGEM_BAIXA',
      chave: 'MARGEM_BAIXA:geral',
      perfis: 'ADMIN',
      titulo: `${fracas.length} categoria(s) vendendo abaixo da margem da loja`,
      texto:
        `A loja fecha ${fracas.length > 0 ? arred(margemLoja) : 0}% de margem, mas ${fracas[0].nome} está em ${fracas[0].margem}%` +
        `${fracas[1] ? ` e ${fracas[1].nome} em ${fracas[1].margem}%` : ''}. ` +
        `Subir essas categorias até a média da loja renderia perto de ${reais(ganho)} a cada 90 dias.`,
      impactoEstimado: ganho,
      prioridade: 3,
      dados: { margemLoja: arred(margemLoja), categorias: fracas },
      acao: 'NENHUMA',
      link: '/relatorios/dre',
    },
  ];
}

// ------------------------------------------------------------------ VENDA_SEM_CUSTO
/** Venda fechada sem custo lançado: o lucro do DRE e o próprio JARVIS ficam cegos. */
async function vendaSemCusto(): Promise<Sugestao[]> {
  const de30 = new Date(Date.now() - 30 * 86_400_000);

  const vendas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', data: { gte: de30 }, custoTotal: { lte: 0 }, total: { gt: 0 } },
    select: { id: true, numero: true, total: true, data: true, vendedor: { select: { nome: true } } },
    orderBy: { data: 'desc' },
    take: 100,
  });
  if (vendas.length === 0) return [];

  const total = arred(vendas.reduce((s, v) => s + v.total, 0));

  return [
    {
      regra: 'VENDA_SEM_CUSTO',
      chave: 'VENDA_SEM_CUSTO:geral',
      perfis: 'ADMIN,GERENTE',
      titulo: `${vendas.length} venda(s) sem custo lançado nos últimos 30 dias`,
      texto:
        `${reais(total)} em ${vendas.length} venda(s) estão sem o custo do produto. ` +
        `Enquanto isso o DRE mostra lucro maior do que o real e o JARVIS não consegue medir margem: peça aos vendedores para completar.`,
      impactoEstimado: null,
      prioridade: 2,
      dados: { total, vendas: vendas.slice(0, 30).map((v) => ({ id: v.id, numero: v.numero, total: arred(v.total), vendedor: v.vendedor?.nome ?? null })) },
      acao: 'ABRIR_TELA',
      link: '/vendas',
    },
  ];
}

// ------------------------------------------------------------------ MAPA_MILHAO
/** Uma vez por dia: onde estamos no caminho do R$ 1 milhão. */
async function mapaMilhao(meta: number, caixa: Awaited<ReturnType<typeof calcularCaixaLivre>>): Promise<Sugestao[]> {
  const falta = Math.max(0, meta - caixa.caixaLivre);
  const hoje = new Date().toISOString().slice(0, 10);
  return [
    {
      regra: 'MAPA_MILHAO',
      chave: `MAPA_MILHAO:${hoje}`,
      perfis: 'ADMIN',
      titulo: `Caixa livre hoje: ${reais(caixa.caixaLivre)}`,
      texto:
        `Faltam ${reais(falta)} para o milhão. Nos próximos 30 dias pesam ${reais(caixa.aPagar30d)} de contas, ` +
        `${reais(caixa.emprestimos30d)} de empréstimos e ${reais(caixa.caixinhasDevidas)} que já deviam estar guardados nas caixinhas. ` +
        `Somando o que vem depois, os compromissos totais dão ${reais(caixa.compromissosTotais)}.`,
      impactoEstimado: null,
      prioridade: 4,
      dados: caixa,
      acao: 'NENHUMA',
      link: '/jarvis',
    },
  ];
}

/** Roda todas as regras e devolve as sugestões da vez. */
export async function rodarRegras(cfg: { diasEstoqueParado: number; metaCaixa: number }): Promise<{
  caixa: Awaited<ReturnType<typeof calcularCaixaLivre>>;
  sugestoes: Sugestao[];
}> {
  const caixa = await calcularCaixaLivre();

  const partes = await Promise.all([
    estoqueParado(cfg.diasEstoqueParado).catch(() => []),
    crediarioVencido().catch(() => []),
    consignadoPrazo().catch(() => []),
    lumicredCusto(caixa.caixaLivre).catch(() => []),
    caixinhaAtrasada().catch(() => []),
    taxaCartao().catch(() => []),
    oportunidadeCompra(caixa.caixaLivre).catch(() => []),
    emprestimoVencido().catch(() => []),
    emprestimoSemConta(caixa.detalhes.emprestimosSemContas, caixa.detalhes.emprestimosAbertos).catch(() => []),
    margemBaixa().catch(() => []),
    vendaSemCusto().catch(() => []),
    mapaMilhao(cfg.metaCaixa, caixa).catch(() => []),
  ]);

  return { caixa, sugestoes: partes.flat() };
}
