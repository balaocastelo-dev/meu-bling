/**
 * Conferência: contas a pagar importadas do Bling em que o saldo não veio.
 * Situação PARCIAL ou PAGO, com blingId, valor pago ≈ valor e nenhum movimento.
 * Não altera nada e não inventa quanto falta — só lista o que está gravado.
 *
 *   npx tsx scripts/conferir-contas-pagar-importadas.ts
 */
import { prisma } from '../src/lib/prisma.js';
import { listarContasPagarImportadasSemSaldo } from '../src/modules/financeiro/service.js';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function dataBr(d: Date) {
  return d.toLocaleDateString('pt-BR');
}

async function main() {
  const contas = await listarContasPagarImportadasSemSaldo();
  console.log(`Contas a pagar importadas sem saldo informado: ${contas.length}`);
  if (!contas.length) {
    console.log('Nenhuma. O saldo gravado como zero só entra aqui quando a conta veio do Bling sem movimento.');
    return;
  }
  console.log('O saldo abaixo é o que está gravado (em geral zero). Não é o que falta pagar.');
  console.log('');
  for (const c of contas) {
    console.log(
      [
        `#${c.id}`,
        dataBr(c.vencimento),
        c.situacao,
        `valor ${brl(c.valor)}`,
        `pago ${brl(c.valorPago)}`,
        `saldo gravado ${brl(c.saldo)}`,
        c.contato || 'sem contato',
        c.descricao,
        `bling ${c.blingId}`,
      ].join(' · '),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
