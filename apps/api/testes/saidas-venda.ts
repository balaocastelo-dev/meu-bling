/**
 * SAÍDAS REAIS AO FECHAR A VENDA
 * - Cartão: entra o valor cheio e saem custo, frete e uma taxa só. O saldo cai pelo custo.
 * - Fechar de novo não duplica.
 * - Item sem custo real fica pendente e não lança esse item (nem a estimativa de 40–70%).
 * - Cancelar estorna as saídas e tira o valor da previsão de DAS.
 * - A previsão do mês acumula e o DAS real abate, sem pagar duas vezes.
 *   npx tsx testes/saidas-venda.ts http://localhost:3333
 */
import { aguardar, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const lista = (r: any) => (Array.isArray(r) ? r : r.data ?? []) as any[];

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const credito = formas.find((f) => f.tipo === 'CARTAO_CREDITO');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  const emp: any = await adm.get('/empresa');
  const aliq = Number(emp.aliquotaSimplesPct ?? 10);
  const cf: any = await adm.get('/vendas/consumidor-final');
  const vend = await adm.post('/vendedores', { nome: `Vendedor Saídas ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `SSD SAÍDAS ${SUF}`, codigo: `SAI-${SUF}`, preco: 1000, precoCusto: 400, ncm: '84717012', csosn: '102' }, 201);
  const caixa = await adm.post('/contas-financeiras', { nome: `Caixa Saídas ${SUF}`, tipo: 'CAIXA', saldoInicial: 0, taxaRecebimentoPct: 4, padrao: false, ativo: true }, [200, 201]);
  const contas = async () => lista(await adm.get('/contas-financeiras?ativo=true'));
  const saldo = async (id: number) => (await contas()).find((c) => c.id === id)?.saldoAtual ?? 0;
  const receber = async (vendaId: number) => lista(await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${vendaId}&limite=20`)).filter((c) => c.situacao !== 'CANCELADO');
  const saidas = async (vendaId: number) => lista(await adm.get(`/contas-pagar?origemTipo=VENDA&origemId=${vendaId}&limite=20`)).filter((c) => c.situacao !== 'CANCELADO');
  const marca = (linhas: any[], m: string) => linhas.find((c) => c.parcela === m || c.observacoes === m);
  const previsoes = async () => lista(await adm.get('/contas-pagar?origemTipo=IMPOSTO&limite=50')).filter((c) => String(c.observacoes || '').includes('PREVISAO_DAS'));
  const valorDas = (linhas: any[]) => linhas.filter((c) => c.situacao !== 'CANCELADO').reduce((s, c) => s + c.valor, 0);

  secao('Cartão: entrada cheia + custo, frete e uma taxa; saldo cai pelo custo');
  const dasAntes = valorDas(await previsoes());
  const v = await adm.post('/vendas', {
    contatoId: cf.id,
    vendedorId: vend.id,
    data: hoje(),
    custoLogistica: 25,
    itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 1000, custoUnitario: 400 }],
    parcelas: [{ dataVencimento: hoje(), valor: 1000, formaPagamentoId: credito.id, parcelasCartao: 1 }],
  }, 201);
  await aguardar(() => receber(v.id), (l) => l.length === 1 && l[0].situacao === 'RECEBIDO');
  const chk: any = await adm.get(`/vendas/${v.id}/finalizacao`);
  const saldoAntes = await saldo(caixa.id);
  await adm.post(`/vendas/${v.id}/finalizar`, {
    recebimentos: [{ parcelaId: chk.parcelas[0].id, formaPagamentoId: credito.id, recebido: true, contaFinanceiraId: caixa.id }],
  }, 200);
  const det: any = await adm.get(`/vendas/${v.id}`);
  const linhas = await saidas(v.id);
  const cmv = marca(linhas, 'CMV_VENDA');
  const frete = marca(linhas, 'FRETE_VENDA');
  const taxa = marca(linhas, 'TAXA_VENDA');
  verifica(igual(det.caixa.recebido, 1000) && igual(det.caixa.custoProduto, 400) && igual(det.caixa.frete, 25) && igual(det.caixa.taxa, 40) && igual(det.caixa.impostoPrevisto, 1000 * aliq / 100), 'resumo: recebido 1.000, custo 400, frete 25, taxa 40 (4% da conta) e imposto previsto', det.caixa);
  verifica(igual(det.caixa.liquido, 1000 - 400 - 25 - 40 - det.caixa.impostoPrevisto), 'líquido = recebido − custo − frete − taxa − imposto', det.caixa.liquido);
  verifica(cmv && frete && taxa && cmv.situacao === 'PAGO' && frete.situacao === 'PAGO' && taxa.situacao === 'PAGO' && igual(cmv.valor, 400) && igual(frete.valor, 25) && igual(taxa.valor, 40), 'três saídas pagas: CMV 400, frete 25, taxa 40', linhas.map((c) => ({ p: c.parcela, v: c.valor, s: c.situacao })));
  verifica(igual((await saldo(caixa.id)) - saldoAntes, 535), 'saldo do caixa: +1.000 − 400 − 25 − 40 = 535', await saldo(caixa.id));
  const cr = await receber(v.id);
  verifica(cr[0].situacao === 'RECEBIDO' && igual(cr[0].valorRecebido, 1000) && igual(cr[0].desconto, 0), 'entrou o valor cheio; a taxa não virou desconto do título', cr[0]);
  verifica(igual(valorDas(await previsoes()) - dasAntes, det.caixa.impostoPrevisto), 'previsão de DAS subiu o imposto desta venda e continua em aberto', await previsoes());

  secao('Segunda chamada não duplica');
  const saldoMeio = await saldo(caixa.id);
  await adm.post(`/vendas/${v.id}/acoes`, { acoes: ['lancarContas'] }, 200);
  await adm.post(`/vendas/${v.id}/acoes`, { acoes: ['lancarContas'] }, 200);
  const linhas2 = await saidas(v.id);
  verifica(linhas2.length === linhas.length && igual(await saldo(caixa.id), saldoMeio), 'fechar de novo não cria outra saída nem mexe no saldo', { antes: linhas.length, depois: linhas2.length, saldo: await saldo(caixa.id) });

  secao('Item sem custo fica pendente e não lança esse item');
  const sem = await adm.post('/vendas', {
    contatoId: cf.id,
    vendedorId: vend.id,
    data: hoje(),
    itens: [
      { produtoId: prod.id, quantidade: 1, valorUnitario: 200, custoUnitario: 80 },
      { descricao: `Cabo sem custo ${SUF}`, quantidade: 1, valorUnitario: 50 },
    ],
    parcelas: [{ dataVencimento: hoje(), valor: 250, formaPagamentoId: dinheiro.id }],
  }, 201);
  const semDet: any = await aguardar(() => adm.get(`/vendas/${sem.id}`), (d) => d.contasLancadas && d.caixa);
  const semLinhas = await saidas(sem.id);
  const semCmv = marca(semLinhas, 'CMV_VENDA');
  verifica(semDet.caixa.custoPendente === true && igual(semDet.caixa.custoProduto, 80), 'venda marcada como custo pendente e só com os 80 do item que tem custo', semDet.caixa);
  verifica(semCmv && igual(semCmv.valor, 80), 'saiu 80 do caixa; o item sem custo e a estimativa de 40–70% não saíram', semCmv);
  verifica(!marca(semLinhas, 'FRETE_VENDA'), 'frete padrão de R$ 10 não virou saída', semLinhas.map((c) => c.parcela));
  const rel: any = await adm.get(`/relatorios/custos-nao-lancados?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  const linhaRel = (rel.vendas || []).find((x: any) => x.id === sem.id);
  verifica(linhaRel && linhaRel.itensSemCusto === 1 && igual(linhaRel.custoNaoLancado, 0), 'relatório mostra o item sem custo e não inventa custo estimado', linhaRel);
  await adm.put(`/vendas/${sem.id}`, {
    itens: semDet.itens.map((i: any) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto || 0, custoUnitario: i.custoUnitario > 0 ? i.custoUnitario : 30 })),
    parcelas: semDet.parcelas.map((p: any) => ({ dataVencimento: p.dataVencimento, valor: p.valor, formaPagamentoId: p.formaPagamentoId || dinheiro.id })),
  }, 200);
  const semDepois: any = await aguardar(() => adm.get(`/vendas/${sem.id}`), (d) => d.contasLancadas && d.caixa && !d.caixa.custoPendente);
  const cmvDepois = marca(await saidas(sem.id), 'CMV_VENDA');
  verifica(semDepois.caixa.custoPendente === false && cmvDepois && igual(cmvDepois.valor, 110), 'informar o custo depois gera a saída (80 + 30)', { caixa: semDepois.caixa, cmv: cmvDepois?.valor });

  secao('Cancelar estorna as saídas e reduz a previsão');
  if (!cancelada) throw new Error('sem situação de cancelamento');
  const dasComVenda = valorDas(await previsoes());
  const saldoComVenda = await saldo(caixa.id);
  await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: cancelada }, 200);
  const depoisCancel = await aguardar(async () => ({ saldo: await saldo(caixa.id), das: valorDas(await previsoes()), saidas: await saidas(v.id) }), (s) => igual(s.saldo, saldoAntes) && s.saidas.length === 0);
  verifica(igual(depoisCancel.saldo, saldoAntes), 'cancelar devolveu recebimento, custo, frete e taxa', { antes: saldoComVenda, depois: depoisCancel.saldo, origem: saldoAntes });
  verifica(igual(dasComVenda - depoisCancel.das, det.caixa.impostoPrevisto), 'previsão de DAS diminuiu o imposto da venda cancelada', { antes: dasComVenda, depois: depoisCancel.das });

  secao('Previsão do DAS acumula no mês e o DAS real abate');
  const baseDas = valorDas(await previsoes());
  const a = await adm.post('/vendas', {
    contatoId: cf.id, vendedorId: vend.id, data: hoje(),
    itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 200, custoUnitario: 50 }],
    parcelas: [{ dataVencimento: hoje(), valor: 200, formaPagamentoId: dinheiro.id }],
  }, 201);
  const b = await adm.post('/vendas', {
    contatoId: cf.id, vendedorId: vend.id, data: hoje(),
    itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 300, custoUnitario: 90 }],
    parcelas: [{ dataVencimento: hoje(), valor: 300, formaPagamentoId: dinheiro.id }],
  }, 201);
  const da: any = await aguardar(() => adm.get(`/vendas/${a.id}`), (d) => d.contasLancadas && d.caixa?.impostoPrevisto > 0);
  const db: any = await aguardar(() => adm.get(`/vendas/${b.id}`), (d) => d.contasLancadas && d.caixa?.impostoPrevisto > 0);
  const somaImposto = da.caixa.impostoPrevisto + db.caixa.impostoPrevisto;
  const acumulada = await aguardar(async () => valorDas(await previsoes()), (n) => igual(n - baseDas, somaImposto));
  verifica(igual(acumulada - baseDas, somaImposto), 'as duas vendas somaram na mesma previsão do mês', { base: baseDas, agora: acumulada, imposto: somaImposto });
  const comp = hoje().slice(0, 7);
  const abertas = (await previsoes()).filter((c) => c.situacao === 'ABERTO' && c.competencia === comp);
  verifica(abertas.length === 1, 'uma conta a pagar aberta de DAS nesta competência', abertas.map((c) => ({ c: c.competencia, v: c.valor, s: c.situacao })));
  const cats: any[] = await adm.get('/categorias-financeiras');
  const catDas = cats.find((c) => c.nome === 'DAS') ?? cats.find((c) => c.grupoDre === 'DEDUCAO' && /das|simples|imposto/i.test(c.nome));
  const abate = da.caixa.impostoPrevisto;
  await adm.post('/contas-pagar', { descricao: `DAS real ${SUF}`, vencimento: hoje(), competencia: abertas[0].competencia, valor: abate, categoriaId: catDas.id }, 201);
  const aposReal = await aguardar(async () => valorDas(await previsoes()), (n) => igual(n, acumulada - abate));
  verifica(igual(aposReal, acumulada - abate), 'o DAS real abateu a previsão, sem deixar os dois para pagar', { previsao: aposReal, abate });
  const guia: any = await adm.get(`/contas-pagar?pesquisa=${encodeURIComponent(`DAS real ${SUF}`)}&limite=5`);
  const real = lista(guia).find((c) => c.descricao?.includes(`DAS real ${SUF}`));
  verifica(real && real.situacao === 'ABERTO' && igual(real.valor, abate), 'a guia real continua em aberto, para ser paga uma vez só', real);

  encerrar('Saídas reais da venda e previsão de DAS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
