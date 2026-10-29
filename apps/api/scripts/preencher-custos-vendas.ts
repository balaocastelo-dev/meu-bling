/**
 * Preenche o custo de TODOS os pedidos de venda (28/10/2026):
 *  - custo do produto: estimativa fixa por venda entre custoProdutoMinPct e custoProdutoMaxPct (Configurações),
 *    mantendo os custos reais informados (itens em MANTER e itens com custo de vendas criadas depois de DEPOIS_DE_ID);
 *  - frete (logística): freteVendaPadrao nas vendas sem logística lançada.
 * Imposto e taxa do cartão não são gravados: saem sempre da regra em comum/custos-venda.ts.
 *
 *   npx tsx scripts/preencher-custos-vendas.ts [--aplicar] [--aliquota=10] [--manter=1,2,3] [--depois-de-id=7287]
 * Sem --aplicar só mostra o resumo.
 */
import { prisma } from '../src/lib/prisma.js';
import { arredondar } from '../src/lib/util.js';
import { carregarCfgCustos, pctCustoEstimado } from '../src/modules/comum/custos-venda.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const APLICAR = process.argv.includes('--aplicar');
const MANTER = new Set((arg('manter') || '').split(',').filter(Boolean).map(Number));
const DEPOIS_DE_ID = Number(arg('depois-de-id') || 0);

async function main() {
  const aliquota = arg('aliquota');
  if (APLICAR && aliquota) await prisma.empresa.update({ where: { id: 1 }, data: { aliquotaSimplesPct: Number(aliquota) } });
  const cfg = await carregarCfgCustos(true);
  console.log('Regra:', cfg);
  const vendas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO' },
    select: { id: true, total: true, custoLogistica: true, itens: { select: { id: true, quantidade: true, total: true, custoUnitario: true } } },
  });
  let itensEstimados = 0, itensMantidos = 0, freteLancado = 0, somaTotal = 0, somaCusto = 0;
  const lote: (() => Promise<unknown>)[] = [];
  for (const v of vendas) {
    const pct = pctCustoEstimado(v.id, cfg);
    let custoTotal = 0;
    for (const i of v.itens) {
      const real = MANTER.has(i.id) || (DEPOIS_DE_ID > 0 && v.id > DEPOIS_DE_ID && i.custoUnitario > 0);
      let custo = i.custoUnitario;
      if (real) itensMantidos++;
      else {
        custo = i.quantidade > 0 ? arredondar((i.total / i.quantidade) * (pct / 100)) : 0;
        itensEstimados++;
        const id = i.id;
        lote.push(() => prisma.vendaItem.update({ where: { id }, data: { custoUnitario: custo, custoInformado: true } }));
      }
      custoTotal += custo * i.quantidade;
    }
    const dados: { custoTotal: number; custoLogistica?: number } = { custoTotal: arredondar(custoTotal) };
    if (!(v.custoLogistica > 0) && v.total > 0) {
      dados.custoLogistica = cfg.frete;
      freteLancado++;
    }
    lote.push(() => prisma.venda.update({ where: { id: v.id }, data: dados }));
    somaTotal += v.total;
    somaCusto += custoTotal;
  }
  console.log({ vendas: vendas.length, itensEstimados, itensMantidos, freteLancado, custoMedioPct: arredondar((somaCusto / (somaTotal || 1)) * 100, 1) });
  if (!APLICAR) return console.log('Simulação: nada gravado (use --aplicar).');
  for (let i = 0; i < lote.length; i += 500) await prisma.$transaction(lote.slice(i, i + 500).map((f) => f() as any));
  console.log('Gravado.');
}

main().finally(() => prisma.$disconnect());
