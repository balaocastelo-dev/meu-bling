/**
 * COMPRA JÁ PAGA NÃO TIRA O CUSTO DUAS VEZES
 * - Finalizar com compra paga: sai só o pagamento da compra, não o CMV.
 * - CMV que já existia (pago na hora, antes da compra) é cancelado e o saldo volta.
 * - Corrigir o custo numa venda fechada não recria o CMV.
 * - Cancelar a venda desfaz a compra e não deixa CMV pendurado.
 * - Venda sem compra continua lançando o CMV.
 * - Cancelar a compra à mão faz o CMV voltar (o custo deixa de estar coberto).
 * - A correção admin é prévia por padrão e, no modo real, estorna o duplicado uma vez só.
 *   DATABASE_URL=file:... npx tsx testes/cmv-compra.ts http://127.0.0.1:PORTA
 */
import { PrismaClient } from '@prisma/client';
import { aguardar, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const db = new PrismaClient();
const lista = (r: any) => (Array.isArray(r) ? r : r.data ?? []) as any[];

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  const sitC: any[] = await adm.get('/situacoes?modulo=COMPRA');
  const compraCancelada = sitC.find((s) => s.cancelamento)?.id;
  const cf: any = await adm.get('/vendas/consumidor-final');
  const vend = await adm.post('/vendedores', { nome: `Vendedor CMV ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `SSD CMV ${SUF}`, codigo: `CMV-${SUF}`, preco: 1000, precoCusto: 400, ncm: '84717012', csosn: '102' }, 201);
  const caixa = await adm.post('/contas-financeiras', { nome: `Caixa CMV ${SUF}`, tipo: 'CAIXA', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  const fornecedor = await adm.post('/contas-financeiras', { nome: `Fornecedor CMV ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  const contaDinheiro = dinheiro.contaFinanceiraId ?? null;
  await adm.put(`/formas-pagamento/${dinheiro.id}`, { contaFinanceiraId: caixa.id }, 200);

  const contas = async () => lista(await adm.get('/contas-financeiras?ativo=true'));
  const saldo = async (id: number) => (await contas()).find((c) => c.id === id)?.saldoAtual ?? 0;
  const saidas = async (vendaId: number) => lista(await adm.get(`/contas-pagar?origemTipo=VENDA&origemId=${vendaId}&limite=20`));
  const cmvAtivo = (linhas: any[]) => linhas.find((c) => (c.observacoes === 'CMV_VENDA' || c.parcela === 'CMV_VENDA') && c.situacao !== 'CANCELADO');
  const pagarCompra = async (compraId: number) => lista(await adm.get(`/contas-pagar?origemTipo=COMPRA&origemId=${compraId}&limite=20`)).filter((c) => c.situacao !== 'CANCELADO');

  const criar = (valor: number, custo: number) =>
    adm.post('/vendas', {
      contatoId: cf.id,
      vendedorId: vend.id,
      data: hoje(),
      itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: valor, custoUnitario: custo }],
      parcelas: [{ dataVencimento: hoje(), valor, formaPagamentoId: dinheiro.id }],
    }, 201);

  try {
    secao('A/B: finalizar com compra paga gera uma saída só; CMV que já existia é cancelado e o saldo volta');
    const antesCaixa = await saldo(caixa.id);
    const antesForn = await saldo(fornecedor.id);
    const v = await criar(1000, 400);
    const comCmv = await aguardar(async () => ({ saldo: await saldo(caixa.id), linhas: await saidas(v.id) }), (s) => !!cmvAtivo(s.linhas) && igual(s.saldo, antesCaixa + 600));
    verifica(!!cmvAtivo(comCmv.linhas) && igual(cmvAtivo(comCmv.linhas).valor, 400), 'ao salvar, o CMV de 400 já saiu do caixa (pago na hora)', comCmv.linhas.map((c) => ({ o: c.observacoes, v: c.valor, s: c.situacao })));
    const chk: any = await adm.get(`/vendas/${v.id}/finalizacao`);
    const fin: any = await adm.post(`/vendas/${v.id}/finalizar`, {
      recebimentos: [{ parcelaId: chk.parcelas[0].id, formaPagamentoId: dinheiro.id, recebido: true, contaFinanceiraId: caixa.id }],
      compra: { paga: true, contaFinanceiraId: fornecedor.id },
    }, 200);
    const depois = await saidas(v.id);
    const compraPaga = await pagarCompra(fin.compra.compra.id);
    verifica(!cmvAtivo(depois), 'não ficou CMV ativo: o custo não sai duas vezes', depois.map((c) => ({ o: c.observacoes, v: c.valor, s: c.situacao })));
    verifica(compraPaga.length === 1 && compraPaga[0].situacao === 'PAGO' && igual(compraPaga[0].valor, 400), 'a única saída do custo é a compra paga de 400', compraPaga.map((c) => ({ v: c.valor, s: c.situacao })));
    verifica(igual(await saldo(caixa.id), antesCaixa + 1000), 'o caixa ficou com os 1.000 recebidos: os 400 do CMV voltaram', { antes: antesCaixa, agora: await saldo(caixa.id) });
    verifica(igual(await saldo(fornecedor.id), antesForn - 400), 'a conta do fornecedor pagou os 400 uma vez só', await saldo(fornecedor.id));
    const det: any = await adm.get(`/vendas/${v.id}`);
    verifica(igual(det.caixa?.custoProduto, 0), 'o resumo de caixa não manda esse custo para o CMV', det.caixa);

    secao('C: PUT de custo em venda fechada não recria o CMV');
    const saldoAntesPut = await saldo(caixa.id);
    await adm.put(`/vendas/${v.id}`, {
      itens: det.itens.map((i: any) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto || 0, custoUnitario: 550 })),
    }, 200);
    const aposPut = await aguardar(() => saidas(v.id), (linhas) => !cmvAtivo(linhas));
    const item: any = await adm.get(`/vendas/${v.id}`);
    verifica(!cmvAtivo(aposPut) && igual(item.itens[0].custoUnitario, 550), 'o custo foi para 550 e o CMV continua cancelado', { cmv: cmvAtivo(aposPut), custo: item.itens[0].custoUnitario });
    verifica(igual(await saldo(caixa.id), saldoAntesPut), 'corrigir o custo não tirou mais dinheiro do caixa', await saldo(caixa.id));

    secao('Relatório trata o custo da compra como coberto');
    const rel: any = await adm.get(`/relatorios/custos-nao-lancados?dataInicial=${hoje()}&dataFinal=${hoje()}`);
    const linha = (rel.vendas || []).find((x: any) => x.id === v.id);
    verifica(!linha || (igual(linha.custoNaoLancado, 0) && igual(linha.custoNaCompra, 550)), 'o custo que está na compra não aparece como não lançado', linha);

    secao('D: cancelar a venda desfaz a compra e não deixa CMV pendurado');
    if (!cancelada) throw new Error('sem situação de cancelamento');
    const canc: any = await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: cancelada }, 200);
    verifica(canc.compra?.desfeita === true, 'a compra foi desfeita junto com a venda', canc.compra);
    const aposCancel = await aguardar(async () => ({ caixa: await saldo(caixa.id), forn: await saldo(fornecedor.id), linhas: await saidas(v.id) }), (s) => igual(s.caixa, antesCaixa) && igual(s.forn, antesForn) && !cmvAtivo(s.linhas));
    verifica(igual(aposCancel.caixa, antesCaixa) && igual(aposCancel.forn, antesForn), 'recebimento e pagamento da compra voltaram; nenhum CMV ficou de fora', aposCancel);
    verifica(!cmvAtivo(aposCancel.linhas), 'nenhum CMV ativo depois do cancelamento', aposCancel.linhas.map((c) => c.situacao));

    secao('E: venda sem compra continua lançando o CMV');
    const antesE = await saldo(caixa.id);
    const sem = await criar(200, 80);
    const chkSem: any = await adm.get(`/vendas/${sem.id}/finalizacao`);
    await adm.post(`/vendas/${sem.id}/finalizar`, {
      recebimentos: [{ parcelaId: chkSem.parcelas[0].id, formaPagamentoId: dinheiro.id, recebido: true, contaFinanceiraId: caixa.id }],
    }, 200);
    const cmvSem = await aguardar(async () => cmvAtivo(await saidas(sem.id)), (c) => !!c && igual(c.valor, 80) && c.situacao === 'PAGO');
    verifica(cmvSem && cmvSem.situacao === 'PAGO' && igual(cmvSem.valor, 80), 'sem compra, o CMV de 80 sai do caixa', cmvSem);
    verifica(igual((await saldo(caixa.id)) - antesE, 120), 'caixa: +200 recebidos − 80 de CMV', { antes: antesE, agora: await saldo(caixa.id) });

    secao('Cancelar a compra à mão devolve o CMV');
    if (!compraCancelada) throw new Error('sem situação de cancelamento de compra');
    const aberta = await criar(300, 90);
    await aguardar(async () => cmvAtivo(await saidas(aberta.id)), (c) => !!c);
    const chkAb: any = await adm.get(`/vendas/${aberta.id}/finalizacao`);
    const finAb: any = await adm.post(`/vendas/${aberta.id}/finalizar`, {
      recebimentos: [{ parcelaId: chkAb.parcelas[0].id, formaPagamentoId: dinheiro.id, recebido: true, contaFinanceiraId: caixa.id }],
      compra: { paga: false, contaFinanceiraId: fornecedor.id },
    }, 200);
    const semCmv = await aguardar(async () => saidas(aberta.id), (linhas) => !cmvAtivo(linhas));
    verifica(!cmvAtivo(semCmv), 'com a compra em aberto o CMV sai, para não cobrar de novo quando ela for paga', semCmv.map((c) => c.situacao));
    const saldoAntesCancCompra = await saldo(caixa.id);
    await adm.post(`/compras/${finAb.compra.compra.id}/situacao`, { situacaoId: compraCancelada }, 200);
    const cmvDeVolta = await aguardar(async () => cmvAtivo(await saidas(aberta.id)), (c) => !!c && igual(c.valor, 90));
    verifica(cmvDeVolta && cmvDeVolta.situacao === 'PAGO' && igual(cmvDeVolta.valor, 90), 'compra cancelada: o CMV de 90 volta a ser a saída do custo', cmvDeVolta);
    verifica(igual(saldoAntesCancCompra - (await saldo(caixa.id)), 90), 'os 90 saíram uma vez, no CMV, depois que a compra deixou de cobrir', { antes: saldoAntesCancCompra, agora: await saldo(caixa.id) });

    secao('Correção admin: prévia por padrão, modo real estorna e a segunda vez não acha nada');
    const dup = await criar(770, 610);
    await aguardar(async () => cmvAtivo(await saidas(dup.id)), (c) => !!c);
    const chkDup: any = await adm.get(`/vendas/${dup.id}/finalizacao`);
    const finDup: any = await adm.post(`/vendas/${dup.id}/finalizar`, {
      recebimentos: [{ parcelaId: chkDup.parcelas[0].id, formaPagamentoId: dinheiro.id, recebido: true, contaFinanceiraId: caixa.id }],
      compra: { paga: true, contaFinanceiraId: fornecedor.id },
    }, 200);
    const cancelado = await db.contaPagar.findFirst({ where: { origemTipo: 'VENDA', origemId: dup.id, observacoes: 'CMV_VENDA', situacao: 'CANCELADO' } });
    if (!cancelado) throw new Error('CMV cancelado não encontrado para simular o duplicado');
    const saldoAntesSim = await saldo(caixa.id);
    await db.contaPagar.update({ where: { id: cancelado.id }, data: { situacao: 'PAGO', valorPago: cancelado.valor, dataPagamento: new Date() } });
    await db.movimentoFinanceiro.create({
      data: { contaFinanceiraId: caixa.id, data: new Date(), tipo: 'SAIDA', valor: cancelado.valor, descricao: `CMV duplicado ${SUF}`, contaPagarId: cancelado.id, observacoes: 'CMV_VENDA', categoriaId: cancelado.categoriaId },
    });
    await db.contaFinanceira.update({ where: { id: caixa.id }, data: { saldoAtual: { decrement: cancelado.valor } } });
    verifica(igual((await saldo(caixa.id)) + cancelado.valor, saldoAntesSim), 'simulação: o CMV duplicado tirou o valor do caixa de novo', { valor: cancelado.valor, saldo: await saldo(caixa.id) });

    const senha = 'senha-cmv-compra-1';
    const vendUser = await adm.post('/vendedores', { nome: `Vend Bloqueio ${SUF}` }, 201);
    await adm.post('/usuarios', { nome: `Vend Bloqueio ${SUF}`, email: `cmv${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vendUser.id }, 201);
    const V = await entrar(`cmv${SUF}@teste.com`, senha);
    V.nome = 'VENDEDOR';
    await V.post('/vendas/corrigir-cmv-duplicado', {}, 403);

    const numeroDup = (await adm.get(`/vendas/${dup.id}`)).numero as number;
    const previa: any = await adm.post('/vendas/corrigir-cmv-duplicado', {}, 200);
    const linhaDup = (previa.vendas || []).find((x: any) => x.vendaId === dup.id);
    verifica(previa.dryRun === true && linhaDup && linhaDup.numero === numeroDup && igual(linhaDup.valor, 610), 'prévia (padrão) lista a venda com CMV duplicado de 610', { q: previa.quantidade, esta: linhaDup });
    verifica(igual(await saldo(caixa.id), saldoAntesSim - 610), 'a prévia não mexe no saldo', await saldo(caixa.id));
    const real: any = await adm.post('/vendas/corrigir-cmv-duplicado', { dryRun: false }, 200);
    verifica(real.dryRun === false && real.vendas.some((x: any) => x.numero === numeroDup) && real.restantes === 0, 'modo real estornou o duplicado e não sobrou nenhum', { aplicados: real.aplicados, restantes: real.restantes });
    const limpo = await aguardar(async () => ({ saldo: await saldo(caixa.id), cmv: cmvAtivo(await saidas(dup.id)) }), (s) => igual(s.saldo, saldoAntesSim) && !s.cmv);
    verifica(igual(limpo.saldo, saldoAntesSim) && !limpo.cmv, 'o saldo do CMV duplicado voltou e o título ficou cancelado', limpo);
    const compraAinda: any = await adm.get(`/compras/${finDup.compra.compra.id}`);
    verifica(!compraAinda.situacao?.cancelamento && (await pagarCompra(finDup.compra.compra.id)).some((c) => c.situacao === 'PAGO'), 'a compra paga continua: só o CMV duplicado saiu', compraAinda.situacao);
    const deNovo: any = await adm.post('/vendas/corrigir-cmv-duplicado', { dryRun: false }, 200);
    verifica(deNovo.quantidade === 0 && deNovo.aplicados === 0 && igual(await saldo(caixa.id), saldoAntesSim), 'rodar de novo não acha nada e não mexe no saldo', deNovo);
  } finally {
    await adm.put(`/formas-pagamento/${dinheiro.id}`, { contaFinanceiraId: contaDinheiro }, 200);
    await db.$disconnect();
  }

  encerrar('CMV não sai junto com a compra da venda');
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect().catch(() => undefined);
  process.exit(1);
});
