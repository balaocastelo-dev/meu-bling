/**
 * Vincula na fila de revisão os lançamentos que JÁ foram feitos pelo caminho normal.
 * Não cria movimento e não altera saldo. O mesmo e-mail não entra duas vezes.
 *
 * Sem --aplicar só mostra o que faria (não abre o banco para gravar).
 * Não aponte DATABASE_URL para produção sem querer: --aplicar grava no banco dessa variável.
 *
 *   npx tsx scripts/importar-lancamentos-automaticos.ts
 *   npx tsx scripts/importar-lancamentos-automaticos.ts --aplicar
 *   npx tsx scripts/importar-lancamentos-automaticos.ts prisma/dados/lancamentos-futrico.json --aplicar
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/lib/prisma.js';
import { interpretarItem, importarJaLancados, type ItemArquivo } from '../src/modules/lancamentos-automaticos/importar.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PADRAO = path.resolve(AQUI, '../prisma/dados/lancamentos-futrico.json');
const APLICAR = process.argv.includes('--aplicar');
const arquivo = process.argv.find((a) => a.endsWith('.json')) ?? PADRAO;

const bruto = JSON.parse(fs.readFileSync(arquivo, 'utf8')) as { lancamentos?: ItemArquivo[] };
const itens = bruto.lancamentos ?? [];
console.log(`${path.basename(arquivo)}: ${itens.length} lançamento(s).`);

let invalidos = 0;
for (const item of itens) {
  try {
    const l = interpretarItem(item);
    const onde = l.tipo === 'TRANSFERENCIA' ? `conta ${l.contaFinanceiraId} → ${l.contaDestinoId}` : l.contaFinanceiraId ? `conta ${l.contaFinanceiraId}` : 'sem conta (título em aberto)';
    console.log(`  ${l.tipo} ${l.valor.toFixed(2)} ${l.data.toISOString().slice(0, 10)} ${l.contraparte} · ${onde} · ${l.emailOrigemId}`);
  } catch (e) {
    invalidos += 1;
    console.log(`  ✖ ${item?.emailOrigemId || '(sem id)'}: ${e instanceof Error ? e.message : e}`);
  }
}

if (!APLICAR) {
  console.log(`\nSimulação. Nada foi gravado${invalidos ? ` (${invalidos} inválido(s) no formato)` : ''}. Para gravar no banco de DATABASE_URL: --aplicar`);
  process.exit(invalidos ? 1 : 0);
}

const r = await importarJaLancados(itens, { botNome: 'importação do arquivo' });
console.log(`\nGravados: ${r.criados}. Já estavam na fila: ${r.idempotentes}. Erros: ${r.erros.length}.`);
for (const e of r.erros) console.log(`  ✖ ${e.emailOrigemId}: ${e.erro}`);
await prisma.$disconnect();
process.exit(r.erros.length ? 1 : 0);
