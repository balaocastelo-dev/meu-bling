/**
 * Coloca o vendedor certo nas vendas migradas do Bling (que vieram sem vendedor).
 *
 *   npx tsx scripts/vendedores-do-bling.ts <pedidos.json> <nomes.json>            → só mostra o que faria
 *   npx tsx scripts/vendedores-do-bling.ts <pedidos.json> <nomes.json> --aplicar  → grava
 *
 * pedidos.json: { "pedidos": { "<id do pedido no Bling>": "<id do vendedor no Bling>" } }
 * nomes.json:   { "<id do vendedor no Bling>": "Nome do vendedor no MEU BLING" }   (vendedor sem nome = ignorado)
 *
 * Só mexe em vendas SEM vendedor; nunca troca um vendedor já escolhido. Vendedor que não existir é criado
 * (inativo, para não aparecer na lista de quem vende hoje) e guarda o id do Bling em Vendedor.blingId.
 * Não gera comissão retroativa.
 */
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const [arqPedidos, arqNomes] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const aplicar = process.argv.includes('--aplicar');
  if (!arqPedidos || !arqNomes) throw new Error('uso: vendedores-do-bling.ts <pedidos.json> <nomes.json> [--aplicar]');
  const pedidos: Record<string, string> = JSON.parse(fs.readFileSync(arqPedidos, 'utf8')).pedidos;
  const nomes: Record<string, string> = JSON.parse(fs.readFileSync(arqNomes, 'utf8'));

  const vendedores = await prisma.vendedor.findMany();
  const idPorBling = new Map<string, number>();
  for (const [blingVend, nome] of Object.entries(nomes)) {
    if (!nome?.trim()) continue;
    let v = vendedores.find((x) => x.blingId === blingVend) || vendedores.find((x) => norm(x.nome) === norm(nome));
    if (!v) {
      console.log(`+ criar vendedor "${nome}" (Bling ${blingVend})`);
      if (aplicar) v = await prisma.vendedor.create({ data: { nome: nome.trim(), ativo: false, blingId: blingVend } });
    } else if (!v.blingId && aplicar) {
      await prisma.vendedor.update({ where: { id: v.id }, data: { blingId: blingVend } }).catch(() => undefined);
    }
    if (v) idPorBling.set(blingVend, v.id);
  }

  const semVendedor = await prisma.venda.findMany({ where: { blingId: { not: null }, vendedorId: null }, select: { id: true, blingId: true } });
  const porVendedor = new Map<number, number[]>();
  let semMapa = 0;
  for (const v of semVendedor) {
    const vb = pedidos[v.blingId!];
    const alvo = vb && idPorBling.get(vb);
    if (!alvo) {
      semMapa++;
      continue;
    }
    porVendedor.set(alvo, [...(porVendedor.get(alvo) || []), v.id]);
  }
  for (const [vid, ids] of porVendedor) {
    const nome = (await prisma.vendedor.findUnique({ where: { id: vid } }))?.nome;
    console.log(`${aplicar ? '✔' : '·'} ${ids.length} vendas → ${nome}`);
    if (aplicar) {
      for (let i = 0; i < ids.length; i += 200) {
        const lote = ids.slice(i, i + 200);
        await prisma.venda.updateMany({ where: { id: { in: lote }, vendedorId: null }, data: { vendedorId: vid } });
        await prisma.contaReceber.updateMany({ where: { origemTipo: 'VENDA', origemId: { in: lote }, vendedorId: null }, data: { vendedorId: vid } });
      }
    }
  }
  console.log(`${semVendedor.length} vendas do Bling sem vendedor; ${semVendedor.length - semMapa} com vendedor identificado; ${semMapa} ficam sem (sem vendedor no Bling ou nome não informado).`);
  if (!aplicar) console.log('Nada foi gravado. Rode de novo com --aplicar.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
