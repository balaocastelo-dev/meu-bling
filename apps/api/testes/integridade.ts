/**
 * INTEGRIDADE DOS DADOS depois de todos os testes: roda a mesma "Saúde do sistema" usada em produção sobre o
 * banco de teste. Depois de criar/fechar/cancelar/transferir centenas de vendas, compras, OS e contas,
 * nenhuma verificação de nível "erro" pode acusar nada (saldo de conta ≠ movimentos, estoque ≠ histórico,
 * venda cancelada com contas abertas, comissão de venda cancelada…).
 *   npx tsx testes/integridade.ts http://localhost:3333
 */
import { encerrar, entrar, secao, verifica } from './lib.js';

/** "Erros" que são do ambiente de teste, não do sistema */
const ESPERADOS_NO_TESTE = new Set(['certificado']);

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  secao('Saúde do sistema sobre o banco de teste');
  const d = await adm.get('/diagnostico');
  verifica(d?.verificacoes >= 15, `diagnóstico roda as verificações (${d?.verificacoes})`);
  const erros = (d?.achados || []).filter((a: any) => a.nivel === 'erro' && !ESPERADOS_NO_TESTE.has(a.id));
  for (const a of erros) verifica(false, `integridade: ${a.titulo}`, a.exemplos.map((e: any) => e.rotulo));
  if (!erros.length) verifica(true, 'nenhuma inconsistência de nível "erro" nos dados depois dos testes');
  encerrar('Integridade dos dados');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
