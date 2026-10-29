/**
 * FORMA DE PAGAMENTO "CRÉDITO BANCÁRIO" (Lumicred) — 28/10/2026
 * - Venda com crédito, cliente paga: cria o empréstimo (cliente paga direto), R$ 1.000 entram no banco da forma,
 *   R$ 1.060 no contas a pagar; "cliente pagou" deixa R$ 60.
 * - Venda finalizada trocando para crédito com a loja pagando: empréstimo "cliente paga a loja"; nada de "já recebido".
 * - Cancelar a venda cancela o empréstimo e tira o dinheiro do banco; com o credor já pago, bloqueia.
 * - Compra da mercadoria paga com crédito (finalizar venda): fornecedor pago, devolução + 6% para o credor,
 *   saldo do banco não muda (entra e sai no mesmo dia). Cancelar a compra desfaz tudo.
 *   npx tsx testes/credito-bancario.ts http://localhost:3333
 */
import { aguardar, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const daqui = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const credito = formas.find((f) => f.tipo === 'CREDITO_BANCARIO');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  const crediario = formas.find((f) => f.tipo === 'CREDIARIO') ?? formas.find((f) => f.tipo === 'BOLETO');
  verifica(!!credito && credito.taxaPct === 6 && credito.diasRecebimento === 30, 'existe a forma "Crédito bancário" com 6% em 30 dias', credito);
  if (!credito) return encerrar('Crédito bancário');

  const credor = await adm.post('/contatos', { nome: `Lumicred CB ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'J' }, 201);
  const cora = await adm.post('/contas-financeiras', { nome: `Cora CB ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  await adm.put(`/formas-pagamento/${credito.id}`, { credorId: credor.id, contaFinanceiraId: cora.id }, 200);
  const saldoCora = async () => {
    const r: any = await adm.get('/contas-financeiras?ativo=true');
    return ((Array.isArray(r) ? r : r.data) as any[]).find((c) => c.id === cora.id)?.saldoAtual ?? NaN;
  };
  const opsDa = async (pred: (e: any) => boolean) => ((await adm.get('/financeiro/emprestimos?status=')).data as any[]).filter(pred);
  const listaTodos = async () => (await adm.get('/financeiro/emprestimos')).data as any[];
  const cf: any = await adm.get('/vendas/consumidor-final');
  const vend = await adm.post('/vendedores', { nome: `Vendedor CB ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `NOTEBOOK CB ${SUF}`, codigo: `CB-${SUF}`, preco: 1000, precoCusto: 600, ncm: '84713012', csosn: '102' }, 201);
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento);
  void opsDa;

  secao('Venda com crédito bancário, cliente paga direto: empréstimo criado ao finalizar');
  const s0 = await saldoCora();
  const v1 = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 1000, custoUnitario: 600 }], parcelas: [{ dataVencimento: daqui(30), valor: 1000, formaPagamentoId: credito.id, creditoPagador: 'CLIENTE' }] }, 201);
  verifica(v1.parcelas?.[0]?.creditoPagador === 'CLIENTE', 'parcela guarda quem paga o credor (cliente)', v1.parcelas?.[0]);
  const chk1: any = await adm.get(`/vendas/${v1.id}/finalizacao`);
  verifica(chk1.parcelas[0].recebidoSugerido === false && chk1.parcelas[0].creditoPagador === 'CLIENTE', 'finalizar não sugere "já recebido" no crédito bancário', chk1.parcelas[0]);
  await adm.post(`/vendas/${v1.id}/finalizar`, {}, 200);
  const op1 = (await aguardar(listaTodos, (l) => l.some((e) => e.venda?.id === v1.id))).find((e) => e.venda?.id === v1.id);
  verifica(op1 && op1.modalidade === 'DIRETO' && igual(op1.valorRecebido, 1000) && igual(op1.valorDevolver, 1060) && op1.credor.id === credor.id, 'empréstimo: cliente paga o credor, R$ 1.000 → R$ 1.060, credor da forma', op1 && { m: op1.modalidade, d: op1.valorDevolver });
  verifica(igual((await saldoCora()) - s0, 1000), 'R$ 1.000 entraram no banco da forma (Cora)', (await saldoCora()) - s0);
  verifica(op1?.boleto && op1.boleto.situacao === 'ABERTO' && igual(op1.boleto.valor, 1000), 'o boleto do cliente é a conta a receber da venda, em aberto', op1?.boleto);
  verifica(op1?.contasPagar?.length === 1 && igual(op1.contasPagar[0].valor, 1060), 'contas a pagar: R$ 1.060 inteiros até o cliente pagar', op1?.contasPagar);
  const pago1 = await adm.post(`/financeiro/emprestimos/${op1.id}/cliente-pagou-direto`, { data: hoje() }, 200);
  verifica(igual(pago1.saldoDevedor, 60), 'cliente pagou a Lumicred: falta só R$ 60 de taxa', pago1.saldoDevedor);
  if (cancelada) {
    await adm.post(`/vendas/${v1.id}/situacao`, { situacaoId: cancelada.id }, 422);
    const ainda = (await listaTodos()).find((e) => e.id === op1.id);
    verifica(ainda && ainda.status !== 'CANCELADO', 'cancelar venda com o boleto já compensado é bloqueado', ainda?.status);
  }

  secao('Finalizar trocando para crédito bancário, loja paga: "cliente paga a loja" e nada entra duas vezes');
  const s1 = await saldoCora();
  const v2 = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 1000, custoUnitario: 600 }], parcelas: [{ dataVencimento: daqui(30), valor: 1000, formaPagamentoId: crediario.id }] }, 201);
  const chk2: any = await adm.get(`/vendas/${v2.id}/finalizacao`);
  await adm.post(`/vendas/${v2.id}/finalizar`, { recebimentos: [{ parcelaId: chk2.parcelas[0].id, formaPagamentoId: credito.id, recebido: true, contaFinanceiraId: cora.id, creditoPagador: 'LOJA' }] }, 200);
  const op2 = (await listaTodos()).find((e) => e.venda?.id === v2.id);
  verifica(op2 && op2.modalidade === 'REPASSE' && igual(op2.valorDevolver, 1060), 'empréstimo: cliente paga a loja e a loja repassa R$ 1.060', op2 && op2.modalidade);
  verifica(igual((await saldoCora()) - s1, 1000), 'entrou só o dinheiro do credor (R$ 1.000), não "recebido" em dobro', (await saldoCora()) - s1);
  verifica(op2?.boleto?.situacao === 'ABERTO', 'boleto do cliente continua em aberto', op2?.boleto);

  secao('Cancelar a venda cancela o empréstimo e tira o dinheiro do banco');
  if (cancelada) {
    const s2 = await saldoCora();
    await adm.post(`/vendas/${v2.id}/situacao`, { situacaoId: cancelada.id }, 200);
    const op2c = (await adm.get(`/financeiro/emprestimos/${op2.id}`)) as any;
    verifica(op2c.status === 'CANCELADO' && op2c.contasPagar.every((c: any) => c.situacao === 'CANCELADO'), 'empréstimo e devolução cancelados', op2c.status);
    verifica(igual((await saldoCora()) - s2, -1000), 'R$ 1.000 saíram do banco', (await saldoCora()) - s2);
  }

  secao('Compra da mercadoria paga com crédito bancário: fornecedor pago, devolução + 6% para o credor');
  const forn = await adm.post('/contatos', { nome: `Distribuidor CB ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'J' }, 201);
  const v3 = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 1000, custoUnitario: 600 }], parcelas: [{ dataVencimento: hoje(), valor: 1000, formaPagamentoId: dinheiro.id }] }, 201);
  const s3 = await saldoCora();
  const fin3: any = await adm.post(`/vendas/${v3.id}/finalizar`, { compra: { fornecedorId: forn.id, paga: false, creditoBancario: true } }, 200);
  const compraId = fin3.compra?.compra?.id;
  verifica(!!compraId, 'compra registrada', fin3.compra);
  const op3 = (await listaTodos()).find((e) => e.compra?.id === compraId);
  verifica(op3 && op3.modalidade === 'CAPITAL_GIRO' && igual(op3.valorRecebido, 600) && igual(op3.valorDevolver, 636), 'empréstimo da compra: R$ 600 → R$ 636 (6%)', op3 && { r: op3.valorRecebido, d: op3.valorDevolver });
  const cpForn: any = await adm.get(`/contas-pagar?origemTipo=COMPRA&origemId=${compraId}`);
  const cps = (Array.isArray(cpForn) ? cpForn : cpForn.data) as any[];
  verifica(cps.length === 1 && cps[0].situacao === 'PAGO', 'conta do fornecedor paga com o dinheiro do crédito', cps.map((c) => c.situacao));
  verifica(igual((await saldoCora()) - s3, 0), 'saldo do banco não muda: o dinheiro entra e sai no mesmo dia', (await saldoCora()) - s3);
  const cpCredor: any = await adm.get(`/contas-pagar?contatoId=${credor.id}`);
  const devol = ((Array.isArray(cpCredor) ? cpCredor : cpCredor.data) as any[]).find((c) => c.descricao.includes(`nº ${op3?.numero}`));
  verifica(devol && igual(devol.valor, 636) && devol.vencimento.slice(0, 10) === daqui(30), 'no contas a pagar: R$ 636 para o credor em 30 dias', devol && { v: devol.valor, venc: devol.vencimento });

  secao('Cancelar a compra desfaz o pagamento ao fornecedor e o empréstimo');
  const sitC: any[] = await adm.get('/situacoes?modulo=COMPRA');
  const compraCancelada = sitC.find((s) => s.cancelamento);
  if (compraCancelada && compraId) {
    const s4 = await saldoCora();
    await adm.post(`/compras/${compraId}/situacao`, { situacaoId: compraCancelada.id }, [200, 422]);
    const op3c = (await adm.get(`/financeiro/emprestimos/${op3.id}`)) as any;
    if (op3c.status === 'CANCELADO') {
      verifica(true, 'compra cancelada: empréstimo cancelado');
      verifica(igual((await saldoCora()) - s4, 0), 'banco continua igual (estorno do pagamento e da entrada)', (await saldoCora()) - s4);
    } else console.log('  (a compra não pôde ser cancelada a partir desta situação — sem estorno para conferir)');
  }

  secao('Taxa e prazo da forma valem para as próximas operações');
  await adm.put(`/formas-pagamento/${credito.id}`, { taxaPct: 8, diasRecebimento: 45 }, 200);
  const v4 = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 500, custoUnitario: 300 }], parcelas: [{ dataVencimento: daqui(45), valor: 500, formaPagamentoId: credito.id }] }, 201);
  await adm.post(`/vendas/${v4.id}/finalizar`, {}, 200);
  const op4 = (await listaTodos()).find((e) => e.venda?.id === v4.id);
  verifica(op4 && igual(op4.valorDevolver, 540) && op4.contasPagar[0].vencimento.slice(0, 10) === daqui(45) && op4.modalidade === 'DIRETO', 'forma a 8% em 45 dias: R$ 500 → R$ 540; sem escolha = cliente paga', op4 && { d: op4.valorDevolver, v: op4.contasPagar?.[0]?.vencimento, m: op4.modalidade });
  const f4: any = (await adm.get('/formas-pagamento')).find((f: any) => f.id === credito.id);
  verifica(f4?.tipo === 'CREDITO_BANCARIO' && f4.credorId === credor.id && f4.contaFinanceiraId === cora.id, 'alterar só a taxa da forma não apaga tipo, credor nem banco', f4);
  if (op4) {
    const alt = await adm.put(`/financeiro/emprestimos/${op4.id}`, { taxaPct: 9, prazoDias: 30, parcelas: 3 }, 200);
    verifica(igual(alt.valorDevolver, 545) && alt.contasPagar.filter((c: any) => c.situacao !== 'CANCELADO').length === 3, 'na operação dá para mudar taxa, prazo e parcelas (9% em 3x: R$ 545)', alt.valorDevolver);
    await adm.put(`/financeiro/emprestimos/${op4.id}`, { valorRecebido: 400 }, 422);
  }
  await adm.put(`/formas-pagamento/${credito.id}`, { taxaPct: 6, diasRecebimento: 30 }, 200);

  encerrar('Crédito bancário');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
