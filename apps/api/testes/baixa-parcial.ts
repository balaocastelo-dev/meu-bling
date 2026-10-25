/**
 * BAIXA PARCIAL DE CONTAS A PAGAR (25/10/2026)
 * Pagar uma conta em partes, ver o histórico, estornar só um dos pagamentos e quitar o restante.
 *   npx tsx testes/baixa-parcial.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const contas: any[] = await adm.get('/contas-financeiras');
  const cf = contas.find((c) => c.padrao) ?? contas[0];
  const saldoCaixa = async () => (await adm.get('/contas-financeiras')).find((c: any) => c.id === cf.id).saldoAtual as number;

  const conta = await adm.post('/contas-pagar', { descricao: `Fornecedor parcial ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  const caixa0 = await saldoCaixa();

  secao('Pagar uma parte da conta');
  const r1 = await adm.post(`/contas-pagar/${conta.id}/baixar`, { valor: 300, data: hoje(), contaFinanceiraId: cf.id });
  verifica(r1.conta.situacao === 'PARCIAL', 'conta fica PARCIAL depois de pagar 300 de 1000', r1.conta.situacao);
  verifica(igual(r1.conta.valorPago, 300), 'valor pago registrado = 300', r1.conta.valorPago);
  verifica(igual(await saldoCaixa(), caixa0 - 300), 'saiu 300 do caixa');
  let d = await adm.get(`/contas-pagar/${conta.id}`);
  verifica(igual(d.saldo, 700), 'detalhe mostra saldo 700 em aberto', d.saldo);
  verifica(d.lancamentos?.length === 1, 'histórico com 1 pagamento', d.lancamentos?.length);

  secao('Segundo pagamento parcial, com juros');
  const r2 = await adm.post(`/contas-pagar/${conta.id}/baixar`, { valor: 210, juros: 10, data: hoje(), contaFinanceiraId: cf.id });
  verifica(r2.conta.situacao === 'PARCIAL', 'continua PARCIAL', r2.conta.situacao);
  d = await adm.get(`/contas-pagar/${conta.id}`);
  verifica(igual(d.saldo, 500), 'juros não abatem o principal: saldo 500', d.saldo);
  verifica(d.lancamentos?.length === 2 && igual(d.lancamentos[1].juros, 10), 'histórico guarda os juros do pagamento', d.lancamentos);

  secao('Não deixa pagar mais que o saldo');
  await adm.post(`/contas-pagar/${conta.id}/baixar`, { valor: 600, data: hoje(), contaFinanceiraId: cf.id }, 422);
  const lista = await adm.get(`/contas-pagar?situacao=PARCIAL&pesquisa=${encodeURIComponent(`parcial ${SUF}`)}`);
  const item = lista.data.find((c: any) => c.id === conta.id);
  verifica(item && igual(item.saldo, 500), 'aparece no filtro "Parciais" com saldo 500', item);

  secao('Estornar só o primeiro pagamento');
  const mov1 = d.lancamentos[0].id;
  const e = await adm.post(`/contas-pagar/${conta.id}/pagamentos/${mov1}/estornar`);
  verifica(e.conta.situacao === 'PARCIAL' && igual(e.conta.valorPago, 210) && igual(e.conta.juros, 10), 'mantém o 2º pagamento (210 c/ 10 de juros)', e.conta);
  d = await adm.get(`/contas-pagar/${conta.id}`);
  verifica(igual(d.saldo, 800) && d.lancamentos.length === 1, 'saldo volta para 800 e o histórico fica com 1 pagamento', d.saldo);
  verifica(igual(await saldoCaixa(), caixa0 - 210), 'os 300 voltaram para o caixa');

  secao('Pagar o restante quita a conta');
  const r3 = await adm.post(`/contas-pagar/${conta.id}/baixar`, { data: hoje(), contaFinanceiraId: cf.id });
  verifica(r3.conta.situacao === 'PAGO' && igual(r3.movimento.valor, 800), 'sem valor informado paga o saldo (800) e fica PAGO', r3.conta);
  verifica(igual(await saldoCaixa(), caixa0 - 1010), 'caixa: saiu 1000 + 10 de juros');

  secao('Estornar um pagamento de conta quitada volta para PARCIAL');
  d = await adm.get(`/contas-pagar/${conta.id}`);
  const ultimo = d.lancamentos[d.lancamentos.length - 1].id;
  const e2 = await adm.post(`/contas-pagar/${conta.id}/pagamentos/${ultimo}/estornar`);
  verifica(e2.conta.situacao === 'PARCIAL' && e2.conta.dataPagamento === null, 'volta para PARCIAL sem data de pagamento', e2.conta);
  await adm.post(`/contas-pagar/${conta.id}/pagamentos/${ultimo}/estornar`, {}, 404);
  const e3 = await adm.post(`/contas-pagar/${conta.id}/estornar`);
  verifica(e3.conta.situacao === 'ABERTO' && igual(e3.conta.valorPago, 0), 'estorno geral zera tudo', e3.conta);
  verifica(igual(await saldoCaixa(), caixa0), 'caixa volta ao saldo inicial');

  encerrar('Baixa parcial de contas a pagar');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
