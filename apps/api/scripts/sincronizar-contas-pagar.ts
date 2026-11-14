/**
 * Sincroniza as contas a pagar do Bling. A prévia é o padrão e não grava.
 *
 *   npx tsx scripts/sincronizar-contas-pagar.ts
 *   npx tsx scripts/sincronizar-contas-pagar.ts --de 2024-01-01 --ate 2024-12-31
 *   npx tsx scripts/sincronizar-contas-pagar.ts --aplicar
 *   npx tsx scripts/sincronizar-contas-pagar.ts --aplicar --de 2024-01-01 --ate 2024-12-31
 *
 * Sem período, varre as situações 1 a 7. Com período, junta emissão, vencimento e pagamento.
 * Não cria movimento de caixa. Usa o cliente do Bling (3 requisições por segundo).
 */
import { prisma } from '../src/lib/prisma.js';
import { sincronizarContasPagar } from '../src/integracoes/bling/contas-pagar.js';

function arg(nome: string) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const aplicar = process.argv.includes('--aplicar');
  const dataInicial = arg('--de');
  const dataFinal = arg('--ate');
  if ((dataInicial && !dataFinal) || (!dataInicial && dataFinal)) {
    throw new Error('Use --de e --ate juntos, ou nenhum dos dois.');
  }
  if ((dataInicial && !/^\d{4}-\d{2}-\d{2}$/.test(dataInicial)) || (dataFinal && !/^\d{4}-\d{2}-\d{2}$/.test(dataFinal))) {
    throw new Error('Datas no formato AAAA-MM-DD.');
  }
  const r = await sincronizarContasPagar({ modo: aplicar ? 'aplicar' : 'previa', dataInicial, dataFinal });
  console.log(r.log.join('\n'));
  console.log('---');
  console.log(JSON.stringify(r, null, 2));
  if (r.interrompido || r.erros.length) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
