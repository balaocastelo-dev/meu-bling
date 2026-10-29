/**
 * DRE — Demonstração do Resultado do Exercício (Simples Nacional).
 *
 * Regime COMPETÊNCIA: receita = vendas/OS em situação final (não cancelada) pela data;
 *   CMV = compras REAIS de mercadoria (contas a pagar da categoria CMV e as geradas por pedido de compra
 *   sem outra categoria) por competência + custo das peças das OS;
 *   despesas = todas as demais contas a pagar por competência (ou vencimento), exceto canceladas.
 *   Desde 28/10/2026 o resultado usa o CUSTO DE CADA VENDA (comum/custos-venda.ts): produto (CMV), imposto
 *   (alíquota em deduções), taxa de cartão e frete (despesas operacionais). As contas a pagar de compra de
 *   mercadoria, imposto sobre vendas e logística ficam fora do resultado (já cobertas) e saem em `informativo`.
 * Empréstimos (módulo Financeiro › Empréstimos): o dinheiro que entra não é receita e, de cada devolução,
 *   só a parte de juros entra no resultado financeiro; o principal também vai para `informativo`.
 * Regime CAIXA: receita = MovimentoFinanceiro ENTRADA por categoria; despesas = SAIDA por categoria.
 * Deduções: aliquotaSimplesPct × receita bruta + categorias DEDUCAO.
 */
import { endOfMonth, format, startOfMonth, addMonths } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';
import { OBS_FORA_DO_RESULTADO } from '../comum/financeiro.js';
import { carregarCfgCustos, custosVenda, SELECT_CUSTO_VENDA } from '../comum/custos-venda.js';

/**
 * Contas a pagar que o custo por venda já cobre (não entram no DRE para não contar duas vezes; aparecem
 * como informativo): compra de mercadoria (CMV / pedido de compra sem categoria), imposto sobre vendas e logística.
 */
function cobertaPeloCustoDaVenda(cat: Cat | null | undefined, origemTipo: string | null): string | null {
  if (cat?.grupoDre === 'CMV' || (origemTipo === 'COMPRA' && !cat)) return cat?.nome || 'Compra de mercadorias (pedidos de compra)';
  if (cat && cat.grupoDre === 'DEDUCAO' && /imposto|simples|das\b/i.test(cat.nome)) return cat.nome;
  if (cat && /log[ií]stica|frete|entrega/i.test(cat.nome)) return cat.nome;
  return null;
}

export type Regime = 'competencia' | 'caixa';

export interface LinhaDre {
  codigo: string;
  nome: string;
  valor: number;
  nivel?: number;
  total?: boolean;
  pct?: number;
  itens?: { nome: string; valor: number; categoriaId?: number | null }[];
}

interface Acumulado {
  receitaProdutos: number;
  receitaServicos: number;
  receitaOutrasCat: Map<string, { nome: string; valor: number; categoriaId: number | null }>; // receitas RECEITA_BRUTA (caixa) por categoria
  deducoes: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  cmv: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  despOper: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  despPessoal: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  resultFin: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  outras: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
  /** pago/lançado, mas já coberto pelo custo de cada venda — só para conferência */
  informativo: Map<string, { nome: string; valor: number; categoriaId: number | null }>;
}

function novoAcumulado(): Acumulado {
  return { receitaProdutos: 0, receitaServicos: 0, receitaOutrasCat: new Map(), deducoes: new Map(), cmv: new Map(), despOper: new Map(), despPessoal: new Map(), resultFin: new Map(), outras: new Map(), informativo: new Map() };
}

function add(mapa: Map<string, { nome: string; valor: number; categoriaId: number | null }>, nome: string, valor: number, categoriaId: number | null = null) {
  const k = String(categoriaId ?? nome);
  const a = mapa.get(k) || mapa.set(k, { nome, valor: 0, categoriaId }).get(k)!;
  a.valor += valor;
}

type Cat = { id: number; nome: string; tipo: string; grupoDre: string };

/** Direciona um valor para o grupo DRE da categoria. */
function lancarPorCategoria(ac: Acumulado, cat: Cat | null | undefined, valor: number, tipoMov: 'RECEITA' | 'DESPESA') {
  const grupo = cat?.grupoDre || (tipoMov === 'RECEITA' ? 'OUTRAS' : 'DESPESA_OPERACIONAL');
  const nome = cat?.nome || (tipoMov === 'RECEITA' ? 'Outras receitas (sem categoria)' : 'Outras despesas (sem categoria)');
  const id = cat?.id ?? null;
  switch (grupo) {
    case 'RECEITA_BRUTA':
      if (/servi/i.test(nome)) ac.receitaServicos += valor;
      else ac.receitaProdutos += valor;
      add(ac.receitaOutrasCat, nome, valor, id);
      break;
    case 'DEDUCAO':
      add(ac.deducoes, nome, valor, id);
      break;
    case 'CMV':
      add(ac.cmv, nome, valor, id);
      break;
    case 'DESPESA_PESSOAL':
      add(ac.despPessoal, nome, valor, id);
      break;
    case 'DESPESA_FINANCEIRA':
      add(ac.resultFin, nome, -valor, id);
      break;
    case 'RECEITA_FINANCEIRA':
      add(ac.resultFin, nome, valor, id);
      break;
    case 'OUTRAS':
      add(ac.outras, nome, tipoMov === 'RECEITA' ? valor : -valor, id);
      break;
    default:
      add(ac.despOper, nome, valor, id);
  }
}

/** Parcela/pagamento de empréstimo: juros vão para o resultado financeiro, o principal só para o informativo. */
function lancarEmprestimo(ac: Acumulado, valor: number, e: { juros: number; valorDevolver: number }) {
  const fator = e.valorDevolver > 0 ? Math.min(1, Math.max(0, e.juros / e.valorDevolver)) : 0;
  const juros = valor * fator;
  if (juros) add(ac.resultFin, 'Juros de empréstimos', -juros);
  if (valor - juros) add(ac.informativo, 'Devolução de empréstimos (principal)', valor - juros);
}

/** Parcela de carnê próprio: juros vão para o resultado financeiro; o principal já é a receita da venda. */
function partesCarne(valor: number, c: { juros: number; total: number }) {
  const fator = c.total > 0 ? Math.min(1, Math.max(0, c.juros / c.total)) : 0;
  const juros = valor * fator;
  return { juros, principal: valor - juros };
}

async function acumularCompetencia(ini: Date, fim: Date, cats: Map<number, Cat>): Promise<Acumulado> {
  const ac = novoAcumulado();
  const [sitVenda, sitOs] = await Promise.all([
    prisma.situacao.findMany({ where: { modulo: 'VENDA', final: true, cancelamento: false }, select: { id: true } }),
    prisma.situacao.findMany({ where: { modulo: 'OS', final: true, cancelamento: false }, select: { id: true } }),
  ]);
  const vendas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', data: { gte: ini, lte: fim }, situacaoId: { in: sitVenda.map((s) => s.id) } },
    select: { ...SELECT_CUSTO_VENDA, itens: { select: { custoUnitario: true, quantidade: true, produto: { select: { tipo: true } }, total: true } } },
  });
  // custo completo de cada venda: produto (CMV) + imposto (deduções, pela alíquota) + taxa de cartão + frete
  const cfg = await carregarCfgCustos();
  for (const v of vendas) {
    const servicos = v.itens.filter((i) => i.produto?.tipo === 'S').reduce((s, i) => s + i.total, 0);
    ac.receitaProdutos += v.total - servicos;
    ac.receitaServicos += servicos;
    const c = custosVenda(v, cfg);
    if (c.produto) add(ac.cmv, 'Custo dos produtos vendidos', c.produto);
    if (c.taxaCartao) add(ac.despOper, 'Taxas de cartão (vendas)', c.taxaCartao);
    if (c.frete) add(ac.despOper, 'Frete das vendas', c.frete);
  }
  const ordens = await prisma.ordemServico.findMany({
    where: { dataEntrada: { gte: ini, lte: fim }, situacaoId: { in: sitOs.map((s) => s.id) } },
    select: { totalServicos: true, totalPecas: true, descontoValor: true, custoPeca: true, itens: { select: { tipo: true, custoUnitario: true, quantidade: true } } },
  });
  for (const o of ordens) {
    ac.receitaServicos += o.totalServicos - Math.min(o.descontoValor, o.totalServicos);
    ac.receitaProdutos += o.totalPecas - Math.max(0, o.descontoValor - o.totalServicos);
    // custo informado na OS (fechamento) tem prioridade sobre o custo das peças cadastradas.
    // Logística e mão de obra de terceiros não entram aqui para não duplicar com contas a pagar.
    const custoPecas = o.custoPeca > 0 ? o.custoPeca : o.itens.filter((i) => i.tipo === 'PECA').reduce((s, i) => s + i.custoUnitario * i.quantidade, 0);
    if (custoPecas) add(ac.cmv, 'Custo das peças (OS)', custoPecas);
  }
  // TODAS as contas a pagar por competência (fallback: vencimento), exceto canceladas.
  // Compra de mercadoria (categoria CMV, ou gerada por pedido de compra sem outra categoria) vai para o CMV;
  // o resto vai para o grupo DRE da categoria (sem categoria → despesas operacionais).
  const compIni = format(ini, 'yyyy-MM');
  const compFim = format(fim, 'yyyy-MM');
  const contas = await prisma.contaPagar.findMany({
    where: {
      situacao: { not: 'CANCELADO' },
      OR: [{ competencia: { gte: compIni, lte: compFim } }, { competencia: null, vencimento: { gte: ini, lte: fim } }],
    },
    select: { valor: true, categoriaId: true, origemTipo: true, emprestimo: { select: { juros: true, valorDevolver: true } } },
  });
  for (const c of contas) {
    const cat = c.categoriaId ? cats.get(c.categoriaId) : null;
    // devolução de empréstimo: no resultado só os juros; o principal é só a volta do dinheiro emprestado
    if (c.emprestimo) {
      lancarEmprestimo(ac, c.valor, c.emprestimo);
      continue;
    }
    const coberta = cobertaPeloCustoDaVenda(cat, c.origemTipo);
    if (coberta) {
      add(ac.informativo, coberta, c.valor, cat?.id ?? null);
      continue;
    }
    lancarPorCategoria(ac, cat, c.valor, 'DESPESA');
  }
  // receitas manuais a receber (não originadas de venda/OS) por competência
  const receitas = await prisma.contaReceber.findMany({
    where: {
      situacao: { not: 'CANCELADO' },
      origemTipo: { notIn: ['VENDA', 'OS'] },
      OR: [{ competencia: { gte: compIni, lte: compFim } }, { competencia: null, vencimento: { gte: ini, lte: fim } }],
    },
    select: { valor: true, categoriaId: true, emprestimoId: true, carne: { select: { juros: true, total: true } } },
  });
  for (const r of receitas) {
    if (r.carne) {
      const { juros, principal } = partesCarne(r.valor, r.carne);
      if (juros) add(ac.resultFin, 'Juros de carnê', juros);
      if (principal) add(ac.informativo, 'Carnês: principal das parcelas (já é receita da venda)', principal);
      continue;
    }
    if (r.emprestimoId) {
      add(ac.informativo, 'Empréstimos recebidos (dinheiro que entrou)', r.valor);
      continue;
    }
    const cat = r.categoriaId ? cats.get(r.categoriaId) : null;
    if (cat?.grupoDre === 'RECEITA_BRUTA') {
      if (/servi/i.test(cat.nome)) ac.receitaServicos += r.valor;
      else ac.receitaProdutos += r.valor;
    } else lancarPorCategoria(ac, cat, r.valor, 'RECEITA');
  }
  return ac;
}

async function acumularCaixa(ini: Date, fim: Date, cats: Map<number, Cat>): Promise<Acumulado> {
  const ac = novoAcumulado();
  const movs = await prisma.movimentoFinanceiro.findMany({
    // transferências entre contas e ajustes de saldo não entram no DRE; NULL precisa ser incluído explicitamente
    where: { data: { gte: ini, lte: fim }, tipo: { in: ['ENTRADA', 'SAIDA'] }, OR: [{ observacoes: null }, { observacoes: { notIn: OBS_FORA_DO_RESULTADO } }] },
    select: { tipo: true, valor: true, categoriaId: true, contaReceberId: true, contaPagarId: true, contaReceber: { select: { emprestimoId: true, carne: { select: { juros: true, total: true } } } }, contaPagar: { select: { emprestimo: { select: { juros: true, valorDevolver: true } } } } },
  });
  for (const m of movs) {
    const cat = m.categoriaId ? cats.get(m.categoriaId) : null;
    if (m.tipo === 'ENTRADA' && m.contaReceber?.emprestimoId) {
      add(ac.informativo, 'Empréstimos recebidos (dinheiro que entrou)', m.valor);
      continue;
    }
    if (m.tipo === 'ENTRADA' && m.contaReceber?.carne) {
      // carnê recebido: o principal é a venda entrando no caixa; a parte de juros é resultado financeiro
      const { juros, principal } = partesCarne(m.valor, m.contaReceber.carne);
      if (juros) add(ac.resultFin, 'Juros de carnê', juros);
      ac.receitaProdutos += principal;
      continue;
    }
    if (m.tipo === 'SAIDA' && m.contaPagar?.emprestimo) {
      lancarEmprestimo(ac, m.valor, m.contaPagar.emprestimo);
      continue;
    }
    if (m.tipo === 'ENTRADA') {
      if (!cat || cat.grupoDre === 'RECEITA_BRUTA') {
        if (cat && /servi/i.test(cat.nome)) ac.receitaServicos += m.valor;
        else ac.receitaProdutos += m.valor;
      } else lancarPorCategoria(ac, cat, m.valor, 'RECEITA');
    } else if (cat && cat.grupoDre === 'DEDUCAO' && /imposto|simples|das\b/i.test(cat.nome)) {
      // imposto já entra pela alíquota sobre a receita (linha de deduções)
      add(ac.informativo, cat.nome, m.valor, cat.id);
    } else {
      lancarPorCategoria(ac, cat, m.valor, 'DESPESA');
    }
  }
  return ac;
}

function montarLinhas(ac: Acumulado, aliquotaSimplesPct: number): LinhaDre[] {
  const receitaBruta = ac.receitaProdutos + ac.receitaServicos;
  const impostos = arredondar(receitaBruta * (aliquotaSimplesPct / 100));
  const deducoesItens = [{ nome: `Impostos sobre vendas (${aliquotaSimplesPct}%)`, valor: impostos }, ...[...ac.deducoes.values()].map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }))];
  if (!ac.deducoes.size) deducoesItens.push({ nome: 'Devoluções e cancelamentos', valor: 0 });
  const deducoes = deducoesItens.reduce((s, i) => s + i.valor, 0);
  const receitaLiquida = receitaBruta - deducoes;
  const cmvItens = [...ac.cmv.values()].map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));
  const cmv = cmvItens.reduce((s, i) => s + i.valor, 0);
  const lucroBruto = receitaLiquida - cmv;
  const operItens = [...ac.despOper.values()].sort((a, b) => b.valor - a.valor).map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));
  const oper = operItens.reduce((s, i) => s + i.valor, 0);
  const pessoalItens = [...ac.despPessoal.values()].sort((a, b) => b.valor - a.valor).map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));
  const pessoal = pessoalItens.reduce((s, i) => s + i.valor, 0);
  const ebitda = lucroBruto - oper - pessoal;
  const finItens = [...ac.resultFin.values()].map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));
  const fin = finItens.reduce((s, i) => s + i.valor, 0);
  const outrasItens = [...ac.outras.values()].map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));
  const outras = outrasItens.reduce((s, i) => s + i.valor, 0);
  const liquido = ebitda + fin + outras;
  const r = arredondar;
  return [
    { codigo: '1', nome: 'RECEITA BRUTA', valor: r(receitaBruta), nivel: 0, itens: [{ nome: 'Venda de produtos', valor: r(ac.receitaProdutos) }, { nome: 'Prestação de serviços (OS)', valor: r(ac.receitaServicos) }] },
    { codigo: '2', nome: '(-) DEDUÇÕES', valor: r(deducoes), nivel: 0, itens: deducoesItens },
    { codigo: '3', nome: '= RECEITA LÍQUIDA', valor: r(receitaLiquida), nivel: 0, total: true, pct: receitaBruta ? r((receitaLiquida / receitaBruta) * 100, 1) : 0 },
    { codigo: '4', nome: '(-) CMV / CUSTO DOS SERVIÇOS', valor: r(cmv), nivel: 0, itens: cmvItens },
    { codigo: '5', nome: '= LUCRO BRUTO', valor: r(lucroBruto), nivel: 0, total: true, pct: receitaBruta ? r((lucroBruto / receitaBruta) * 100, 1) : 0 },
    { codigo: '6', nome: '(-) DESPESAS OPERACIONAIS', valor: r(oper), nivel: 0, itens: operItens },
    { codigo: '7', nome: '(-) DESPESAS COM PESSOAL', valor: r(pessoal), nivel: 0, itens: pessoalItens },
    { codigo: '8', nome: '= RESULTADO OPERACIONAL (EBITDA)', valor: r(ebitda), nivel: 0, total: true, pct: receitaBruta ? r((ebitda / receitaBruta) * 100, 1) : 0 },
    { codigo: '9', nome: '(+/-) RESULTADO FINANCEIRO', valor: r(fin), nivel: 0, itens: finItens },
    { codigo: '10', nome: '(+/-) OUTRAS RECEITAS/DESPESAS', valor: r(outras), nivel: 0, itens: outrasItens },
    { codigo: '11', nome: '= RESULTADO LÍQUIDO', valor: r(liquido), nivel: 0, total: true, pct: receitaBruta ? r((liquido / receitaBruta) * 100, 1) : 0 },
  ];
}

function resumoDe(linhas: LinhaDre[]) {
  const v = (c: string) => linhas.find((l) => l.codigo === c)?.valor || 0;
  return { receita: v('1'), deducoes: v('2'), cmv: v('4'), lucroBruto: v('5'), despesas: arredondar(v('6') + v('7')), ebitda: v('8'), resultado: v('11') };
}

export async function gerarDre(p: { ini: Date; fim: Date; regime: Regime; comparar: boolean; mensal?: boolean }) {
  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { aliquotaSimplesPct: true } });
  const aliquota = empresa?.aliquotaSimplesPct ?? 10;
  const catsLista = await prisma.categoriaFinanceira.findMany({ select: { id: true, nome: true, tipo: true, grupoDre: true } });
  const cats = new Map(catsLista.map((c) => [c.id, c]));
  const acumular = (ini: Date, fim: Date) => (p.regime === 'caixa' ? acumularCaixa(ini, fim, cats) : acumularCompetencia(ini, fim, cats));

  const acPeriodo = await acumular(p.ini, p.fim);
  const linhas = montarLinhas(acPeriodo, aliquota);
  const resumo = resumoDe(linhas);
  const informativo = [...acPeriodo.informativo.values()].sort((a, b) => b.valor - a.valor).map((d) => ({ nome: d.nome, valor: arredondar(d.valor), categoriaId: d.categoriaId }));

  // mensal: um item por mês do período
  const mensal: { competencia: string; receita: number; cmv: number; despesas: number; resultado: number }[] = [];
  if (p.mensal !== false) {
    let cursor = startOfMonth(p.ini);
    let guard = 0;
    while (cursor <= p.fim && guard++ < 36) {
      const mi = cursor < p.ini ? p.ini : cursor;
      const mf = endOfMonth(cursor) > p.fim ? p.fim : endOfMonth(cursor);
      const r = resumoDe(montarLinhas(await acumular(mi, mf), aliquota));
      mensal.push({ competencia: format(cursor, 'yyyy-MM'), receita: r.receita, cmv: r.cmv, despesas: r.despesas, resultado: r.resultado });
      cursor = addMonths(cursor, 1);
    }
  }

  let comparativo: any = null;
  if (p.comparar) {
    const dias = Math.round((p.fim.getTime() - p.ini.getTime()) / 86400000) + 1;
    const fimAnt = new Date(p.ini.getTime() - 1);
    const iniAnt = new Date(fimAnt.getFullYear(), fimAnt.getMonth(), fimAnt.getDate() - dias + 1, 0, 0, 0, 0);
    const linhasAnt = montarLinhas(await acumular(iniAnt, fimAnt), aliquota);
    comparativo = { periodo: { dataInicial: iniAnt, dataFinal: fimAnt }, regime: p.regime, linhas: linhasAnt, resumo: resumoDe(linhasAnt) };
  }

  return { periodo: { dataInicial: p.ini, dataFinal: p.fim }, regime: p.regime, aliquotaSimplesPct: aliquota, linhas, resumo, mensal, comparativo, informativo };
}
