/**
 * VENDA PAGA NA HORA ENTRA NO CAIXA + AJUSTE DE SALDO + DRE COM COMPRAS REAIS (28/10/2026)
 * - Venda em dinheiro/PIX/cartão: ao salvar já gera o conta a receber RECEBIDO e o dinheiro entra no caixa.
 * - Crediário fica em aberto no contas a receber.
 * - Editar a venda refaz o recebimento com o novo valor; cancelar tira o dinheiro do caixa.
 * - Ajustar saldo acerta a conta com o valor real e NÃO entra no DRE.
 * - DRE competência: custo de cada venda; compra de mercadoria fica no informativo; demais despesas entram.
 *   npx tsx testes/pago-na-hora.ts http://localhost:3333
 */
import { aguardar, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  const crediario = formas.find((f) => f.tipo === 'CREDIARIO') ?? formas.find((f) => f.tipo === 'BOLETO');
  const contas = async () => {
    const r: any = await adm.get('/contas-financeiras?ativo=true');
    return (Array.isArray(r) ? r : r.data) as any[];
  };
  const saldoTotal = async () => (await contas()).reduce((s, c) => s + c.saldoAtual, 0);
  const receber = async (vendaId: number) => {
    const r: any = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${vendaId}`);
    return ((Array.isArray(r) ? r : r.data) as any[]).filter((c) => c.situacao !== 'CANCELADO');
  };
  const cli = await adm.post('/contatos', { nome: `Cliente Pago Na Hora ${SUF}`, tipoPessoa: 'F', celular: '19999992222' }, 201);
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento)?.id;

  secao('Venda em dinheiro entra no caixa ao salvar');
  const antes = await saldoTotal();
  const v = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: `Cabo HDMI ${SUF}`, quantidade: 1, valorUnitario: 150 }], parcelas: [{ dataVencimento: hoje(), valor: 150, formaPagamentoId: dinheiro.id }] }, 201);
  const crs = await aguardar(() => receber(v.id), (l) => l.length > 0 && l.every((c) => c.situacao === 'RECEBIDO'));
  verifica(crs.length === 1 && crs[0].situacao === 'RECEBIDO' && igual(crs[0].valorRecebido, 150), 'conta a receber da venda já RECEBIDA (150)', crs);
  verifica(igual((await saldoTotal()) - antes, 150), 'saldo em contas subiu 150', { antes, depois: await saldoTotal() });

  secao('Editar a venda refaz o recebimento com o novo valor');
  await adm.put(`/vendas/${v.id}`, { itens: [{ descricao: `Cabo HDMI ${SUF}`, quantidade: 2, valorUnitario: 150 }], parcelas: [{ dataVencimento: hoje(), valor: 300, formaPagamentoId: dinheiro.id }] }, 200);
  const crs2 = await aguardar(() => receber(v.id), (l) => l.length === 1 && l[0].situacao === 'RECEBIDO' && igual(l[0].valorRecebido, 300));
  verifica(crs2.length === 1 && igual(crs2[0].valorRecebido, 300), 'depois de editar: recebido 300 (sem duplicar)', crs2);
  verifica(igual((await saldoTotal()) - antes, 300), 'saldo em contas: +300 no total', { antes, depois: await saldoTotal() });

  secao('Cancelar a venda tira o dinheiro do caixa');
  if (cancelada) {
    await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: cancelada, forcar: true }, 200);
    const depois = await aguardar(saldoTotal, (s) => igual(s, antes));
    verifica(igual(depois, antes), 'saldo voltou ao valor de antes da venda', { antes, depois });
  }

  secao('Crediário fica a receber');
  if (crediario) {
    const v2 = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: `Notebook ${SUF}`, quantidade: 1, valorUnitario: 1000 }], parcelas: [{ dataVencimento: hoje(), valor: 1000, formaPagamentoId: crediario.id }] }, 201);
    await new Promise((r) => setTimeout(r, 800));
    const crs3 = await receber(v2.id);
    verifica(crs3.every((c) => c.situacao !== 'RECEBIDO'), 'venda no crediário não entra no caixa', crs3);
  }

  secao('Ajustar saldo: acerta com o valor real e fica fora do DRE');
  const conta = (await contas())[0];
  const r = await adm.post(`/contas-financeiras/${conta.id}/ajustar-saldo`, { saldoReal: 7500, data: hoje() }, 201);
  const contaDepois = (await contas()).find((c) => c.id === conta.id);
  verifica(igual(contaDepois.saldoAtual, 7500), 'conta ficou com saldo 7.500', { r, contaDepois });
  const dreCaixa: any = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=caixa`);
  const temAjuste = JSON.stringify(dreCaixa.linhas).includes('Ajuste de saldo');
  verifica(!temAjuste, 'DRE (caixa) não mostra o ajuste de saldo', dreCaixa.linhas);

  secao('DRE competência: compra de mercadoria fica de fora (custo vem de cada venda); outras despesas entram');
  const cats: any[] = await adm.get('/categorias-financeiras');
  const cmv = cats.find((c) => c.grupoDre === 'CMV');
  const oper = cats.find((c) => c.grupoDre === 'DESPESA_OPERACIONAL' && !/log[ií]stica|frete|entrega/i.test(c.nome));
  const dre0: any = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=competencia&comparar=false`);
  if (cmv) await adm.post('/contas-pagar', { descricao: `Compra mercadoria ${SUF}`, vencimento: hoje(), valor: 1234, categoriaId: cmv.id }, 201);
  if (oper) await adm.post('/contas-pagar', { descricao: `Aluguel teste ${SUF}`, vencimento: hoje(), valor: 432, categoriaId: oper.id }, 201);
  await adm.post('/contas-pagar', { descricao: `Despesa sem categoria ${SUF}`, vencimento: hoje(), valor: 100 }, 201);
  const dre1: any = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=competencia&comparar=false`);
  const linha = (d: any, c: string) => d.linhas.find((l: any) => l.codigo === c)?.valor || 0;
  const info = (d: any) => (d.informativo || []).reduce((s: number, i: any) => s + i.valor, 0);
  if (cmv) verifica(igual(linha(dre1, '4') - linha(dre0, '4'), 0), 'compra de mercadoria NÃO entra no CMV (o custo vem de cada venda)', { antes: linha(dre0, '4'), depois: linha(dre1, '4') });
  if (cmv) verifica(igual(info(dre1) - info(dre0), 1234), 'compra de mercadoria aparece no informativo (1.234)', dre1.informativo);
  verifica(igual(linha(dre1, '6') - linha(dre0, '6'), (oper ? 432 : 0) + 100), 'despesas operacionais subiram (aluguel + sem categoria)', { antes: linha(dre0, '6'), depois: linha(dre1, '6') });

  secao('Finalizar resolve tudo: recebimento no banco escolhido + compra paga');
  const cf: any = await adm.get('/vendas/consumidor-final');
  const vend = await adm.post('/vendedores', { nome: `Vendedor Finalizar ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `SSD FINALIZAR ${SUF}`, codigo: `FIN-${SUF}`, preco: 400, precoCusto: 250, ncm: '84717012', csosn: '102' }, 201);
  const listaContas = await contas();
  const bancoA = listaContas[0];
  const bancoB = await adm.post('/contas-financeiras', { nome: `Banco Teste B ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  const totalAntes = await saldoTotal();
  const vf = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 400, custoUnitario: 250 }], parcelas: [{ dataVencimento: hoje(), valor: 400, formaPagamentoId: dinheiro.id }] }, 201);
  await aguardar(() => receber(vf.id), (l) => l.length > 0 && l.every((c) => c.situacao === 'RECEBIDO'));
  const chk: any = await adm.get(`/vendas/${vf.id}/finalizacao`);
  verifica(chk.podeFinalizar && igual(chk.custoProdutos, 250) && chk.parcelas.length === 1 && chk.parcelas[0].recebidoSugerido, 'tela de finalizar: custo 250 e parcela sugerida como recebida', chk);
  const saldoB0 = 0;
  const saldoA0 = (await contas()).find((c) => c.id === bancoA.id).saldoAtual;
  const fin: any = await adm.post(`/vendas/${vf.id}/finalizar`, {
    recebimentos: [{ parcelaId: chk.parcelas[0].id, recebido: true, contaFinanceiraId: bancoB.id }],
    compra: { paga: true, contaFinanceiraId: bancoA.id },
  }, 200);
  verifica(fin.compra && !fin.compra.jaExistia && fin.compra.paga, 'compra registrada e paga', fin.compra);
  const cs = await contas();
  const sB = cs.find((c) => c.id === bancoB.id).saldoAtual;
  const sA = cs.find((c) => c.id === bancoA.id).saldoAtual;
  verifica(igual(sB - saldoB0, 400), 'recebimento de 400 entrou no banco escolhido (B)', { sB });
  verifica(igual(sA - saldoA0, -650), 'banco A: tirou o recebimento automático (400, foi para o B) e pagou a compra (250)', { sA, saldoA0 });
  verifica(igual((await saldoTotal()) - totalAntes, 150), 'no total: +400 da venda − 250 da compra', { totalAntes });
  const compra: any = await adm.get(`/compras/${fin.compra.compra.id}`);
  verifica(compra.situacao?.nome === 'Vendido' || compra.situacao?.nome === 'Fechado', 'compra criada (Vendido/Fechado)', compra.situacao);
  const chk2: any = await adm.get(`/vendas/${vf.id}/finalizacao`);
  verifica(chk2.jaFinalizada && chk2.compraRegistrada?.id === fin.compra.compra.id, 'venda finalizada e compra ligada a ela', chk2);

  secao('Fechamento troca a forma de pagamento e só aceita banco permitido');
  const pix = formas.find((f) => f.tipo === 'PIX');
  if (pix) {
    await adm.put(`/formas-pagamento/${pix.id}`, { contasPermitidas: [bancoB.id], contaFinanceiraId: bancoB.id }, 200);
    const v3 = await adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 100, custoUnitario: 60 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: crediario?.id ?? dinheiro.id }] }, 201);
    const c3: any = await adm.get(`/vendas/${v3.id}/finalizacao`);
    const fp = c3.formas.find((f: any) => f.id === pix.id);
    verifica(fp && fp.contasPermitidas.includes(bancoB.id), 'tela recebe os bancos permitidos da forma', fp);
    await adm.post(`/vendas/${v3.id}/finalizar`, { recebimentos: [{ parcelaId: c3.parcelas[0].id, formaPagamentoId: pix.id, recebido: true, contaFinanceiraId: bancoA.id }], compra: null }, 422);
    const ok3: any = await adm.post(`/vendas/${v3.id}/finalizar`, { recebimentos: [{ parcelaId: c3.parcelas[0].id, formaPagamentoId: pix.id, recebido: true, contaFinanceiraId: bancoB.id }] }, 200);
    const v3d: any = await adm.get(`/vendas/${v3.id}`);
    verifica(v3d.parcelas[0].formaPagamentoId === pix.id, 'parcela passou a ser PIX', v3d.parcelas[0]);
    const cr3 = await receber(v3.id);
    verifica(cr3.length === 1 && cr3[0].situacao === 'RECEBIDO' && cr3[0].contaFinanceiraId === bancoB.id, 'PIX recebido no banco permitido', { ok3, cr3 });
  }

  secao('Link de pagamento sem token do Mercado Pago avisa o que falta');
  const semToken: any = await adm.post(`/vendas/${vf.id}/link-pagamento`, {}, 422);
  verifica(semToken.code === 'MERCADOPAGO_SEM_TOKEN', 'erro diz para configurar o Mercado Pago', semToken);

  encerrar('Venda paga na hora / ajuste de saldo / DRE');
}

main();
