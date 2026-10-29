/**
 * DASHBOARD DE CONSIGNAÇÃO — estoque consignado (valor, custo, quanto dá para lucrar), vendas do período
 * (faturamento, custo, lucro, margem, giro), pagamentos aos consignantes e totais desde o início.
 * Custo de cada item = valor do consignante (o que a loja paga); lucro = preço vendido − valor do consignante.
 */
import { differenceInCalendarDays, endOfDay, format, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';
import { saldoContaPagar } from '../financeiro/service.js';
import { CATEGORIA_TAXA, ROTULO_STATUS, STATUS_ATIVOS, type Status } from './nucleo.js';

const pct = (a: number, b: number) => (b ? arredondar((a / b) * 100, 1) : 0);

export async function dashboardConsignacao(p: { dataInicial?: Date | null; dataFinal?: Date | null }) {
  const hoje = new Date();
  const ini = p.dataInicial ? startOfDay(p.dataInicial) : startOfMonth(hoje);
  const fim = p.dataFinal ? endOfDay(p.dataFinal) : endOfDay(hoje);

  const todas = await prisma.consignacao.findMany({
    select: {
      id: true, numero: true, descricao: true, tipoEquipamento: true, status: true, precoVenda: true, valorConsignante: true,
      dataEntrada: true, dataLimite: true, vendidoEm: true, vendaId: true, vendaNumero: true, produtoId: true, retiradoEm: true, canceladoEm: true,
      assinadoEm: true,
      consignante: { select: { id: true, nome: true } },
      contasPagar: { select: { valor: true, valorPago: true, juros: true, desconto: true, situacao: true, dataPagamento: true, categoria: { select: { nome: true } } } },
      contasReceber: { select: { valor: true, valorRecebido: true, situacao: true, dataRecebimento: true, categoria: { select: { nome: true } } } },
    },
  });

  // preço efetivamente vendido (item da venda); sem venda ligada usa o preço do contrato
  const vendidas = todas.filter((c) => c.vendaId && c.vendidoEm);
  const itensVenda = vendidas.length
    ? await prisma.vendaItem.findMany({ where: { vendaId: { in: vendidas.map((c) => c.vendaId!) }, produtoId: { in: vendidas.map((c) => c.produtoId).filter((x): x is number => !!x) } }, select: { vendaId: true, produtoId: true, total: true } })
    : [];
  const precoVendido = (c: (typeof todas)[number]) => itensVenda.find((i) => i.vendaId === c.vendaId && i.produtoId === c.produtoId)?.total ?? c.precoVenda;

  // ---- estoque consignado (agora)
  const emLoja = todas.filter((c) => (STATUS_ATIVOS as string[]).includes(c.status));
  const itensEstoque = emLoja
    .map((c) => {
      const lucro = arredondar(c.precoVenda - c.valorConsignante);
      return {
        id: c.id, numero: c.numero, descricao: c.descricao, tipo: c.tipoEquipamento, status: c.status, statusRotulo: ROTULO_STATUS[c.status as Status] ?? c.status,
        consignante: c.consignante.nome, precoVenda: c.precoVenda, valorConsignante: c.valorConsignante, lucro, margemPct: pct(lucro, c.precoVenda),
        diasEmLoja: differenceInCalendarDays(hoje, c.dataEntrada), dataLimite: c.dataLimite, assinado: !!c.assinadoEm,
        pagoAoConsignante: arredondar(c.contasPagar.reduce((s, x) => s + x.valorPago, 0)),
      };
    })
    .sort((a, b) => b.diasEmLoja - a.diasEmLoja);
  const soma = <T,>(l: T[], f: (x: T) => number) => arredondar(l.reduce((s, x) => s + f(x), 0));
  const estValor = soma(itensEstoque, (x) => x.precoVenda);
  const estCusto = soma(itensEstoque, (x) => x.valorConsignante);
  const porTipoMap = new Map<string, { tipo: string; qtd: number; valorVenda: number; lucroPotencial: number }>();
  for (const i of itensEstoque) {
    const t = porTipoMap.get(i.tipo) || porTipoMap.set(i.tipo, { tipo: i.tipo, qtd: 0, valorVenda: 0, lucroPotencial: 0 }).get(i.tipo)!;
    t.qtd++;
    t.valorVenda = arredondar(t.valorVenda + i.precoVenda);
    t.lucroPotencial = arredondar(t.lucroPotencial + i.lucro);
  }

  // ---- vendas no período
  const linhaVenda = (c: (typeof todas)[number]) => {
    const vendido = arredondar(precoVendido(c));
    const lucro = arredondar(vendido - c.valorConsignante);
    return {
      id: c.id, numero: c.numero, descricao: c.descricao, tipo: c.tipoEquipamento, consignante: c.consignante.nome, vendaId: c.vendaId, vendaNumero: c.vendaNumero,
      vendidoEm: c.vendidoEm!, vendido, valorConsignante: c.valorConsignante, lucro, margemPct: pct(lucro, vendido), diasParaVender: differenceInCalendarDays(c.vendidoEm!, c.dataEntrada),
    };
  };
  const vendasPeriodo = vendidas.filter((c) => c.vendidoEm! >= ini && c.vendidoEm! <= fim).map(linhaVenda).sort((a, b) => +b.vendidoEm - +a.vendidoEm);
  const vendasTodas = vendidas.map(linhaVenda);
  const fat = soma(vendasPeriodo, (x) => x.vendido);
  const custo = soma(vendasPeriodo, (x) => x.valorConsignante);
  const lucro = arredondar(fat - custo);

  // taxas de retirada recebidas (receita extra da consignação)
  const taxas = (de: Date, ate: Date) =>
    soma(todas.flatMap((c) => c.contasReceber).filter((r) => r.categoria?.nome === CATEGORIA_TAXA && r.dataRecebimento && r.dataRecebimento >= de && r.dataRecebimento <= ate), (r) => r.valorRecebido);

  // ---- pagamentos aos consignantes
  const contasPagar = todas.flatMap((c) => c.contasPagar).filter((x) => x.situacao !== 'CANCELADO');
  const pagoPeriodo = soma(contasPagar.filter((x) => x.dataPagamento && x.dataPagamento >= ini && x.dataPagamento <= fim), (x) => x.valorPago);
  const aPagar = soma(contasPagar.filter((x) => ['ABERTO', 'PARCIAL'].includes(x.situacao)), (x) => saldoContaPagar(x));

  // ---- série dos últimos 12 meses (faturamento e lucro das vendas consignadas)
  const serie = Array.from({ length: 12 }, (_, i) => {
    const m = subMonths(startOfMonth(hoje), 11 - i);
    const chave = format(m, 'yyyy-MM');
    const doMes = vendasTodas.filter((v) => format(v.vendidoEm, 'yyyy-MM') === chave);
    return { mes: chave, qtd: doMes.length, faturamento: soma(doMes, (v) => v.vendido), lucro: soma(doMes, (v) => v.lucro) };
  });

  // ---- consignantes que mais geraram lucro (desde o início)
  const porConsignante = new Map<string, { nome: string; vendidos: number; lucro: number; emLoja: number }>();
  for (const v of vendasTodas) {
    const x = porConsignante.get(v.consignante) || porConsignante.set(v.consignante, { nome: v.consignante, vendidos: 0, lucro: 0, emLoja: 0 }).get(v.consignante)!;
    x.vendidos++;
    x.lucro = arredondar(x.lucro + v.lucro);
  }
  for (const e of itensEstoque) {
    const x = porConsignante.get(e.consignante) || porConsignante.set(e.consignante, { nome: e.consignante, vendidos: 0, lucro: 0, emLoja: 0 }).get(e.consignante)!;
    x.emLoja++;
  }

  const retirados = todas.filter((c) => c.status === 'RETIRADO').length;
  const fatTotal = soma(vendasTodas, (v) => v.vendido);
  const lucroTotal = soma(vendasTodas, (v) => v.lucro);
  return {
    periodo: { dataInicial: ini, dataFinal: fim },
    estoque: {
      qtd: itensEstoque.length,
      valorVenda: estValor,
      custo: estCusto,
      lucroPotencial: arredondar(estValor - estCusto),
      margemPct: pct(estValor - estCusto, estValor),
      diasMedioEmLoja: itensEstoque.length ? Math.round(itensEstoque.reduce((s, x) => s + x.diasEmLoja, 0) / itensEstoque.length) : 0,
      emDiarias: itensEstoque.filter((x) => x.status === 'EM_DIARIAS').length,
      semAssinatura: itensEstoque.filter((x) => !x.assinado).length,
      porTipo: [...porTipoMap.values()].sort((a, b) => b.valorVenda - a.valorVenda),
      itens: itensEstoque,
    },
    vendas: {
      qtd: vendasPeriodo.length,
      faturamento: fat,
      custo,
      lucro,
      margemPct: pct(lucro, fat),
      ticketMedio: vendasPeriodo.length ? arredondar(fat / vendasPeriodo.length) : 0,
      diasMedioParaVender: vendasPeriodo.length ? Math.round(vendasPeriodo.reduce((s, x) => s + x.diasParaVender, 0) / vendasPeriodo.length) : 0,
      taxasRetirada: taxas(ini, fim),
      itens: vendasPeriodo,
    },
    pagamentos: { pagoNoPeriodo: pagoPeriodo, aPagar },
    total: {
      contratos: todas.length,
      vendidos: vendasTodas.length,
      retirados,
      cancelados: todas.filter((c) => c.status === 'CANCELADO').length,
      faturamento: fatTotal,
      lucro: lucroTotal,
      margemPct: pct(lucroTotal, fatTotal),
      taxasRetirada: taxas(new Date(0), endOfDay(hoje)),
      conversaoPct: pct(vendasTodas.length, vendasTodas.length + retirados),
    },
    serie,
    consignantes: [...porConsignante.values()].sort((a, b) => b.lucro - a.lucro || b.emLoja - a.emLoja).slice(0, 10),
    atualizadoEm: hoje,
  };
}
