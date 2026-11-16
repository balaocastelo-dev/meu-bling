/**
 * CMV que saiu duas vezes: a venda foi finalizada com "compra já paga" e o CMV_VENDA também ficou ativo.
 * A prévia (padrão) não grava. O modo real estorna e cancela esse CMV.
 *
 * Na loja, a prévia deve listar estes pedidos (e só estes):
 *   25096, 25094, 25102, 25099, 25092, 25091, 25075, 25079,
 *   25032, 25039, 25026, 25012, 24994, 24968, 24953, 24906
 * Não rode --aplicar em produção sem o OK do Thiago.
 *
 *   npx tsx scripts/corrigir-cmv-duplicado.ts
 *   CONFIRMAR_CMV_DUPLICADO=sim npx tsx scripts/corrigir-cmv-duplicado.ts --aplicar
 */
import { prisma } from '../src/lib/prisma.js';
import { corrigirCmvDuplicadoDaCompra } from '../src/modules/vendas/saidas.js';

const APLICAR = process.argv.includes('--aplicar');

if (APLICAR && process.env.CONFIRMAR_CMV_DUPLICADO !== 'sim') {
  console.error('Nada foi gravado. Para estornar o CMV duplicado no banco de DATABASE_URL, use --aplicar e CONFIRMAR_CMV_DUPLICADO=sim.');
  console.error('Não faça isso na loja sem o OK do Thiago.');
  process.exit(1);
}

const ESPERADOS_NA_LOJA = [25096, 25094, 25102, 25099, 25092, 25091, 25075, 25079, 25032, 25039, 25026, 25012, 24994, 24968, 24953, 24906];

const r = await corrigirCmvDuplicadoDaCompra({ dryRun: !APLICAR });
console.log(r.dryRun ? 'Prévia. Nada foi gravado.' : 'Modo real. CMV duplicado estornado.');
console.log(`Na loja, a prévia deve listar exatamente estes ${ESPERADOS_NA_LOJA.length} pedidos: ${ESPERADOS_NA_LOJA.join(', ')}.`);
console.log(`${r.quantidade} venda(s), R$ ${r.valor.toFixed(2)}.`);
for (const v of r.vendas) {
  console.log(`  pedido ${v.numero}  CMV ${v.valor.toFixed(2)}  compra nº ${v.compraNumero}`);
}
if (!r.vendas.length) console.log('  (nenhuma)');
if (!r.dryRun) console.log(`Ainda com CMV duplicado depois: ${r.restantes}.`);

await prisma.$disconnect();
process.exit(0);
