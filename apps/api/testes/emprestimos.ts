/**
 * EMPRÉSTIMOS / ANTECIPAÇÕES (Lumicred) — 28/10/2026
 * - Operação de R$ 1.000 a 6% → R$ 1.060 no contas a pagar; o dinheiro entra na conta e NÃO é receita.
 * - REPASSE: cliente paga o boleto à loja → aviso "repasse ao credor" → pagar → quitado. DRE: só R$ 60 de juros.
 * - DIRETO: cliente paga direto ao credor → baixa o boleto e abate R$ 1.000 sem mexer no banco → falta R$ 60.
 * - Cancelar devolve o caixa; ligar pela venda acha o boleto do cliente; erros dizem o que falta.
 *   npx tsx testes/emprestimos.ts http://localhost:3333
 */
import { aguardar, clienteCompleto, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const daqui = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const contas = async () => {
    const r: any = await adm.get('/contas-financeiras?ativo=true');
    return (Array.isArray(r) ? r : r.data) as any[];
  };
  const reais = async () => (await contas()).filter((c) => c.tipo !== 'COMPENSACAO');
  const banco = (await reais())[0];
  const saldo = async (id: number) => (await contas()).find((c) => c.id === id)?.saldoAtual ?? NaN;
  const saldoReais = async () => (await reais()).reduce((s, c) => s + c.saldoAtual, 0);
  const dre = (regime: string) => adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=${regime}&comparar=false`);
  const ln = (d: any, c: string) => d.linhas.find((l: any) => l.codigo === c)?.valor || 0;

  const credor = await adm.post('/contatos', { nome: `Lumicred Teste ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'J' }, 201);
  const cli = await adm.post('/contatos', { ...clienteCompleto(`Empresa Boleto ${SUF}`), celular: '19999993333', email: `emp${SUF}@example.com` }, 201);

  secao('Lançar operação de R$ 1.000 a 6% (REPASSE): dinheiro entra, R$ 1.060 a pagar, não é receita');
  const boleto = await adm.post('/contas-receber', { descricao: `Boleto cliente ${SUF}`, contatoId: cli.id, valor: 1000, vencimento: daqui(28) }, 201);
  const comp0 = await dre('competencia');
  const caixa0 = await dre('caixa');
  const s0 = await saldo(banco.id);
  const e = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'REPASSE', contaReceberClienteId: boleto.id, valorRecebido: 1000, taxaPct: 6, prazoDias: 30, contaFinanceiraId: banco.id, codigo: `E-${SUF}` }, 201);
  verifica(e && igual(e.valorDevolver, 1060) && igual(e.juros, 60), 'devolver R$ 1.060 (juros R$ 60)', e && { d: e.valorDevolver, j: e.juros });
  verifica(e.contasPagar?.length === 1 && igual(e.contasPagar[0].valor, 1060) && e.contasPagar[0].vencimento.slice(0, 10) === daqui(30), 'uma conta a pagar de R$ 1.060 para daqui a 30 dias', e.contasPagar);
  verifica(igual((await saldo(banco.id)) - s0, 1000), 'R$ 1.000 entraram na conta escolhida', { antes: s0, depois: await saldo(banco.id) });
  verifica(e.status === 'ABERTO' && igual(e.saldoDevedor, 1060) && e.clienteId === cli.id, 'operação em aberto, devendo R$ 1.060, ligada ao cliente do boleto', { s: e.status, sd: e.saldoDevedor, c: e.clienteId });
  const comp1 = await dre('competencia');
  const caixa1 = await dre('caixa');
  verifica(igual(ln(comp1, '1') - ln(comp0, '1'), 0) && igual(ln(caixa1, '1') - ln(caixa0, '1'), 0), 'o dinheiro do empréstimo não vira receita (competência e caixa)', { comp: ln(comp1, '1') - ln(comp0, '1'), caixa: ln(caixa1, '1') - ln(caixa0, '1') });
  verifica(igual(ln(comp1, '9') - ln(comp0, '9'), -60), 'DRE competência: só R$ 60 de juros no resultado financeiro', ln(comp1, '9') - ln(comp0, '9'));
  verifica(igual(ln(comp1, '6') + ln(comp1, '7') - ln(comp0, '6') - ln(comp0, '7'), 0), 'o principal (R$ 1.000) não entra como despesa', ln(comp1, '6') - ln(comp0, '6'));
  const lista = await adm.get('/financeiro/emprestimos?status=ABERTO');
  verifica(lista.data.some((x: any) => x.id === e.id) && lista.totais.emAberto >= 1060, 'aparece na lista de em aberto com os totais', lista.totais);

  secao('Cliente paga o boleto à loja → aviso para repassar → pagar o credor → quitado');
  await adm.post(`/contas-receber/${boleto.id}/baixar`, { valor: 1000, data: hoje(), contaFinanceiraId: banco.id }, [200, 201]);
  const e2 = await adm.get(`/financeiro/emprestimos/${e.id}`);
  verifica(e2.alerta?.texto?.includes('repasse') && e2.boleto?.situacao === 'RECEBIDO', 'aviso: "cliente já pagou: repasse ao credor"', e2.alerta);
  const caixa2 = await dre('caixa');
  const e3 = await adm.post(`/financeiro/emprestimos/${e.id}/pagar`, { contaFinanceiraId: banco.id, data: hoje() }, 200);
  verifica(e3.status === 'QUITADO' && igual(e3.saldoDevedor, 0) && igual(e3.pago, 1060), 'pagou R$ 1.060 e a operação ficou QUITADA', { s: e3.status, p: e3.pago });
  const caixa3 = await dre('caixa');
  verifica(igual(ln(caixa3, '9') - ln(caixa2, '9'), -60), 'DRE caixa: do pagamento de R$ 1.060 só R$ 60 são juros', ln(caixa3, '9') - ln(caixa2, '9'));
  verifica(igual((await saldo(banco.id)) - s0, 1000 + 1000 - 1060), 'banco: +1.000 credor +1.000 cliente −1.060 devolução', (await saldo(banco.id)) - s0);

  secao('DIRETO: cliente paga direto ao credor → abate R$ 1.000 sem mexer no banco → paga só os R$ 60');
  const boleto2 = await adm.post('/contas-receber', { descricao: `Boleto direto ${SUF}`, contatoId: cli.id, valor: 1000, vencimento: daqui(30) }, 201);
  const d = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'DIRETO', contaReceberClienteId: boleto2.id, valorRecebido: 1000, taxaPct: 6, prazoDias: 30, contaFinanceiraId: banco.id }, 201);
  const reais0 = await saldoReais();
  const d2 = await adm.post(`/financeiro/emprestimos/${d.id}/cliente-pagou-direto`, { data: hoje() }, 200);
  verifica(d2.boleto?.situacao === 'RECEBIDO', 'boleto do cliente baixado', d2.boleto);
  verifica(igual(d2.saldoDevedor, 60) && d2.status === 'ABERTO', 'dívida com o credor caiu para R$ 60', d2.saldoDevedor);
  verifica(igual(await saldoReais(), reais0), 'saldo dos bancos não mudou (encontro de contas)', { antes: reais0, depois: await saldoReais() });
  const comp = (await contas()).find((c) => c.tipo === 'COMPENSACAO');
  verifica(comp && igual(comp.saldoAtual, 0), 'conta "Encontro de contas" fica com saldo zero', comp);
  await adm.post(`/financeiro/emprestimos/${d.id}/cliente-pagou-direto`, { data: hoje() }, 422);
  const d3 = await adm.post(`/financeiro/emprestimos/${d.id}/pagar`, { contaFinanceiraId: banco.id, data: hoje() }, 200);
  verifica(d3.status === 'QUITADO' && igual(d3.pago, 1060), 'pagou os R$ 60 de diferença e quitou', { s: d3.status, p: d3.pago });

  secao('Erros explicam o que falta');
  const semBoleto: any = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'DIRETO', valorRecebido: 500, contaFinanceiraId: banco.id }, 422);
  verifica(/boleto|conta a receber/i.test(semBoleto?.erro || ''), 'DIRETO sem boleto do cliente pede a venda ou o boleto', semBoleto?.erro);
  await adm.post('/financeiro/emprestimos', { credorId: credor.id, valorRecebido: 0 }, [400, 422]);
  await adm.post(`/financeiro/emprestimos/${e.id}/pagar`, { contaFinanceiraId: banco.id }, 422);

  secao('Capital de giro em 3 parcelas mensais');
  const g = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'CAPITAL_GIRO', valorRecebido: 3000, taxaPct: 6, prazoDias: 30, parcelas: 3, contaFinanceiraId: banco.id }, 201);
  verifica(g.contasPagar?.length === 3 && igual(g.contasPagar.reduce((s: number, c: any) => s + c.valor, 0), 3180), '3 parcelas somando R$ 3.180', g.contasPagar?.map((c: any) => c.valor));
  const g2 = await adm.put(`/financeiro/emprestimos/${g.id}`, { valorRecebido: 2000 }, 200);
  verifica(igual(g2.valorDevolver, 2120) && g2.contasPagar.filter((c: any) => c.situacao !== 'CANCELADO').length === 3, 'sem pagamento, alterar o valor recalcula a devolução (R$ 2.120)', g2.valorDevolver);

  secao('Cancelar operação lançada por engano devolve o caixa');
  const sAntes = await saldo(banco.id);
  const c = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'CAPITAL_GIRO', valorRecebido: 700, contaFinanceiraId: banco.id }, 201);
  verifica(igual((await saldo(banco.id)) - sAntes, 700), 'entrou R$ 700', (await saldo(banco.id)) - sAntes);
  const c2 = await adm.post(`/financeiro/emprestimos/${c.id}/cancelar`, {}, 200);
  verifica(c2.status === 'CANCELADO' && c2.contasPagar.every((x: any) => x.situacao === 'CANCELADO'), 'operação e devolução canceladas', c2.contasPagar);
  verifica(igual(await saldo(banco.id), sAntes), 'saldo voltou ao que era', { antes: sAntes, depois: await saldo(banco.id) });
  await adm.post(`/financeiro/emprestimos/${e.id}/cancelar`, {}, 422);

  secao('Ligar pela venda acha o boleto do cliente');
  const formas: any[] = await adm.get('/formas-pagamento');
  const fBoleto = formas.find((f) => f.tipo === 'BOLETO') ?? formas.find((f) => f.tipo === 'CREDIARIO');
  const v = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: `Notebook ${SUF}`, quantidade: 1, valorUnitario: 1500, custoUnitario: 900 }], parcelas: [{ dataVencimento: daqui(30), valor: 1500, formaPagamentoId: fBoleto.id }] }, 201);
  const pv0 = await adm.post('/financeiro/emprestimos', { credorId: credor.id, modalidade: 'REPASSE', vendaId: v.id, valorRecebido: 1500, contaFinanceiraId: banco.id }, 201);
  verifica(pv0.venda?.id === v.id && pv0.clienteId === cli.id, 'operação ligada à venda e ao cliente dela (antes de existir o boleto)', { v: pv0.venda?.id, c: pv0.clienteId });
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const fechada = sitV.find((x) => x.final && !x.cancelamento && /fechad/i.test(x.nome));
  if (fechada) await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: fechada.id }, [200, 422]);
  const crs = await aguardar(async () => { const r: any = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${v.id}`); return ((Array.isArray(r) ? r : r.data) as any[]).filter((x) => x.situacao !== 'CANCELADO'); }, (l) => l.length > 0, 3000);
  if (crs.length) {
    const pv = await adm.get(`/financeiro/emprestimos/${pv0.id}`);
    verifica(pv.contaReceberClienteId === crs[0].id && pv.boleto?.id === crs[0].id, 'quando a venda gera o boleto, a operação se liga a ele sozinha', { cr: pv.contaReceberClienteId, esperado: crs[0].id });
  } else console.log('  (venda não foi finalizada neste banco de teste — boleto ainda não existe)');

  encerrar('Empréstimos');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
