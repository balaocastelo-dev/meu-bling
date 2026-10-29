/**
 * VENDA CANCELADA/EXCLUÍDA DESFAZ A COMPRA REGISTRADA AO FINALIZAR (29/10/2026)
 * Caso real: venda finalizada com "compra já paga" (R$ 2.691,99 saindo do Mercado Pago); a venda foi
 * cancelada e excluída, mas a compra e o pagamento dela ficaram → banco negativo e mercadoria fantasma.
 * - Cancelar a venda: pagamento automático volta ao banco, contas a pagar canceladas, estoque da compra
 *   estornado, compra em "Cancelado". Finalizar de novo registra uma compra nova.
 * - Excluir a venda: a compra (e as contas canceladas dela) somem junto.
 * - Compra paga À MÃO não é tocada (quem pagou decide), e o aviso fica no histórico da compra.
 *   npx tsx testes/venda-cancelada-compra.ts http://localhost:3333
 */
import { aguardar, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  const contas = async () => {
    const r: any = await adm.get('/contas-financeiras?ativo=true');
    return (Array.isArray(r) ? r : r.data) as any[];
  };
  const saldo = async (id: number) => (await contas()).find((c) => c.id === id)?.saldoAtual ?? 0;
  const pagar = async (compraId: number) => {
    const r: any = await adm.get(`/contas-pagar?origemTipo=COMPRA&origemId=${compraId}`);
    return (Array.isArray(r) ? r : r.data) as any[];
  };
  const estoque = async (produtoId: number) => {
    const p: any = await adm.get(`/produtos/${produtoId}`);
    return Number(p.estoqueTotal ?? 0);
  };
  const cf: any = await adm.get('/vendas/consumidor-final');
  const vend = await adm.post('/vendedores', { nome: `Vendedor Cancela ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `PC GAMER CANCELA ${SUF}`, codigo: `CAN-${SUF}`, preco: 3500, precoCusto: 2691.99, ncm: '84714900', csosn: '102' }, 201);
  const mp = await adm.post('/contas-financeiras', { nome: `Mercado Pago Cancela ${SUF}`, tipo: 'BANCO', saldoInicial: 0, taxaRecebimentoPct: 5, padrao: false, ativo: true }, [200, 201]);
  const cora = await adm.post('/contas-financeiras', { nome: `Cora Cancela ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  const estoque0 = await estoque(prod.id);

  const novaVenda = () =>
    adm.post('/vendas', { contatoId: cf.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 3500, custoUnitario: 2691.99 }], parcelas: [{ dataVencimento: hoje(), valor: 3500, formaPagamentoId: dinheiro.id }] }, 201);
  const finalizar = async (vendaId: number) => {
    const chk: any = await adm.get(`/vendas/${vendaId}/finalizacao`);
    return adm.post(`/vendas/${vendaId}/finalizar`, { recebimentos: [{ parcelaId: chk.parcelas[0].id, recebido: true, contaFinanceiraId: cora.id }], compra: { paga: true, contaFinanceiraId: mp.id } }, 200);
  };

  secao('Finalizar: recebimento no Cora, compra paga saindo do Mercado Pago');
  const v = await novaVenda();
  const fin: any = await finalizar(v.id);
  verifica(fin.compra?.compra && fin.compra.paga, 'compra registrada e paga', fin.compra);
  const compraId = fin.compra.compra.id as number;
  verifica(igual(await saldo(cora.id), 3500) && igual(await saldo(mp.id), -2691.99), 'Cora +3.500 e Mercado Pago −2.691,99 (compra paga de lá)', { cora: await saldo(cora.id), mp: await saldo(mp.id) });
  verifica((await pagar(compraId)).some((c) => c.situacao === 'PAGO'), 'conta a pagar da compra está PAGA');

  secao('Cancelar a venda: o pagamento da compra volta para o banco e a compra é cancelada');
  if (!cancelada) throw new Error('sem situação de cancelamento para VENDA');
  const canc: any = await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: cancelada }, 200);
  verifica(canc.compra?.desfeita === true && canc.compra.numero === fin.compra.compra.numero, 'resposta diz que a compra foi desfeita', canc.compra);
  verifica(igual(canc.compra?.devolvido?.reduce((s: number, d: any) => s + d.valor, 0) ?? 0, 2691.99), 'devolveu 2.691,99', canc.compra?.devolvido);
  verifica(igual(await saldo(mp.id), 0), 'Mercado Pago voltou a zero', await saldo(mp.id));
  verifica(igual(await saldo(cora.id), 0), 'Cora: o recebimento da venda também foi estornado', await saldo(cora.id));
  const compraCanc: any = await adm.get(`/compras/${compraId}`);
  verifica(compraCanc.situacao?.cancelamento === true && !compraCanc.estoqueLancado && !compraCanc.contasLancadas, 'compra em "Cancelado", sem estoque nem contas', { s: compraCanc.situacao, e: compraCanc.estoqueLancado, c: compraCanc.contasLancadas });
  verifica((await pagar(compraId)).every((c) => c.situacao === 'CANCELADO' && igual(c.valorPago, 0)), 'contas a pagar da compra canceladas e zeradas', await pagar(compraId));
  verifica(igual(await estoque(prod.id), estoque0), 'estoque do produto voltou ao de antes (sem mercadoria fantasma)', { antes: estoque0, depois: await estoque(prod.id) });
  const hist = (compraCanc.historico || []).map((h: any) => h.observacao || '').join(' | ');
  verifica(/venda nº \d+ cancelada/i.test(hist), 'histórico da compra diz que foi a venda cancelada', hist);

  secao('Finalizar de novo registra uma compra nova (a cancelada fica no histórico)');
  const chk2: any = await adm.get(`/vendas/${v.id}/finalizacao`);
  verifica(!chk2.compraRegistrada, 'tela de finalizar não considera a compra cancelada como registrada', chk2.compraRegistrada);
  const fin2: any = await finalizar(v.id);
  verifica(fin2.compra?.compra && !fin2.compra.jaExistia && fin2.compra.compra.id !== compraId, 'nova compra criada', fin2.compra);
  verifica(igual(await saldo(mp.id), -2691.99) && igual(await saldo(cora.id), 3500), 'bancos lançados de novo', { mp: await saldo(mp.id), cora: await saldo(cora.id) });

  secao('Excluir a venda (depois de cancelar): a compra some junto e o dinheiro volta');
  await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: cancelada }, 200);
  const del: any = await adm.del(`/vendas/${v.id}`, 200);
  verifica(del.ok && (del.compra === null || del.compra === undefined), 'ao excluir, a compra já tinha sido desfeita no cancelamento', del);
  const compraNova: any = await adm.get(`/compras/${fin2.compra.compra.id}`, 404);
  verifica(!compraNova?.id, 'segunda compra (cancelada junto com a venda) foi apagada ao excluir', compraNova);
  const primeira: any = await adm.get(`/compras/${compraId}`, 404);
  verifica(!primeira?.id, 'a primeira compra cancelada também saiu', primeira);
  verifica(igual(await saldo(mp.id), 0) && igual(await saldo(cora.id), 0), 'bancos zerados', { mp: await saldo(mp.id), cora: await saldo(cora.id) });

  secao('Excluir direto (venda só recebida automaticamente): a compra é apagada');
  const v3 = await novaVenda();
  const fin3: any = await finalizar(v3.id);
  await adm.post(`/vendas/${v3.id}/situacao`, { situacaoId: cancelada }, 200); // estorno (estoque/contas) é obrigatório antes de excluir
  verifica(igual(await saldo(mp.id), 0), 'cancelou: Mercado Pago zerado', await saldo(mp.id));
  const del3: any = await adm.del(`/vendas/${v3.id}`, 200);
  verifica(del3.ok, 'venda excluída', del3);
  const aindaExiste: any = await adm.get(`/compras/${fin3.compra.compra.id}`, 404);
  verifica(!aindaExiste?.id, 'compra da venda excluída foi apagada junto', aindaExiste);
  verifica(igual(await saldo(mp.id), 0), 'Mercado Pago continua zerado', await saldo(mp.id));

  secao('Compra paga À MÃO não é desfeita (e o motivo fica no histórico)');
  const v4 = await novaVenda();
  const chk4: any = await adm.get(`/vendas/${v4.id}/finalizacao`);
  const fin4: any = await adm.post(`/vendas/${v4.id}/finalizar`, { recebimentos: [{ parcelaId: chk4.parcelas[0].id, recebido: true, contaFinanceiraId: cora.id }], compra: { paga: false, contaFinanceiraId: mp.id } }, 200);
  const cp4 = (await pagar(fin4.compra.compra.id)).find((c) => c.situacao === 'ABERTO');
  verifica(!!cp4, 'compra registrada em aberto', await pagar(fin4.compra.compra.id));
  await adm.post(`/contas-pagar/${cp4.id}/baixar`, { valor: 2691.99, data: hoje(), contaFinanceiraId: mp.id }, [200, 201]);
  verifica(igual(await saldo(mp.id), -2691.99), 'pagamento manual saiu do Mercado Pago', await saldo(mp.id));
  const canc4: any = await adm.post(`/vendas/${v4.id}/situacao`, { situacaoId: cancelada }, 200);
  verifica(canc4.compra && canc4.compra.desfeita === false && /à mão/.test(canc4.compra.motivo || ''), 'venda cancelada, compra mantida por ter pagamento manual', canc4.compra);
  verifica(igual(await saldo(mp.id), -2691.99), 'o pagamento manual continua no banco', await saldo(mp.id));
  const c4: any = await adm.get(`/compras/${fin4.compra.compra.id}`);
  verifica(!c4.situacao?.cancelamento && (c4.historico || []).some((h: any) => /mantida/.test(h.observacao || '')), 'compra não cancelada e histórico explica', { s: c4.situacao, h: c4.historico?.map((h: any) => h.observacao) });
  await aguardar(() => saldo(cora.id), (s) => igual(s, 0));

  encerrar('Venda cancelada/excluída desfaz a compra registrada ao finalizar');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
