/**
 * CUSTOS INTERNOS DA VENDA + ORDEM DO CONTAS A PAGAR (26/10/2026)
 * - Vendedor informa o custo do produto (por item) e o custo de logística; nada disso sai para o cliente.
 * - Custo pode ser lançado/corrigido com a venda já fechada; lucro só para ADMIN/GERENTE.
 * - Contas a pagar: vencidas primeiro, depois a vencer, pagas por último (por vencimento).
 *   npx tsx testes/venda-custos.ts http://localhost:3333
 */
import { clienteCompleto, diasAtras, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const amanha = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const sit = (nome: string) => sitV.find((s) => s.nome === nome)?.id;
  const depositos: any[] = await adm.get('/depositos');
  const dep = depositos.find((d) => d.padrao)?.id ?? depositos[0].id;
  const cli = await adm.post('/contatos', { ...clienteCompleto(`Cliente Teste Venda ${SUF}`), celular: '19999991111', email: `cv${SUF}@example.com` }, 201);
  const prodA = await adm.post('/produtos', { nome: `SSD TESTE A ${SUF}`, codigo: `CVA-${SUF}`, preco: 500, precoCusto: 300, ncm: '84717012', csosn: '102' }, 201);
  const prodB = await adm.post('/produtos', { nome: `MOUSE TESTE B ${SUF}`, codigo: `CVB-${SUF}`, preco: 100, precoCusto: 40, ncm: '84716053', csosn: '102' }, 201);
  await adm.post('/estoque/ajuste', { produtoId: prodA.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 5, custoUnitario: 300 }, [200, 201]);
  await adm.post('/estoque/ajuste', { produtoId: prodB.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 5, custoUnitario: 40 }, [200, 201]);

  secao('Pedido com custo informado pelo vendedor + logística');
  const v = await adm.post(
    '/vendas',
    {
      contatoId: cli.id,
      depositoId: dep,
      data: hoje(),
      itens: [
        { produtoId: prodA.id, quantidade: 1, valorUnitario: 500, custoUnitario: 280 }, // vendedor sabe que pagou 280
        { produtoId: prodB.id, quantidade: 2, valorUnitario: 100 }, // sem custo digitado: usa o do cadastro (40)
      ],
      custoLogistica: 30,
    },
    201,
  );
  const iA = v.itens.find((i: any) => i.produtoId === prodA.id);
  const iB = v.itens.find((i: any) => i.produtoId === prodB.id);
  verifica(igual(v.total, 700), 'total do pedido = 700', v.total);
  verifica(igual(iA.custoUnitario, 280) && iA.custoInformado === true, 'item A: custo 280 informado pelo vendedor', iA);
  verifica(igual(iB.custoUnitario, 40) && iB.custoInformado === false, 'item B: custo 40 do cadastro', iB);
  verifica(igual(v.custoTotal, 360) && igual(v.custoLogistica, 30), 'custo dos produtos 360 + logística 30', { custoTotal: v.custoTotal, log: v.custoLogistica });
  verifica(v.fechamento && igual(v.fechamento.custoTotal, 390) && igual(v.fechamento.lucro, 310), 'fechamento: custo 390, lucro 310', v.fechamento);

  secao('Nada de custo para o cliente');
  const html: string = String(await adm.get(`/vendas/${v.id}/imprimir`, [200]));
  const vazouHtml = /280,00|360,00|390,00|custo|log[ií]stica|lucro/i.exec(html);
  verifica(!vazouHtml, 'impressão do pedido sem custos', vazouHtml && html.slice(Math.max(0, vazouHtml.index - 80), vazouHtml.index + 60));
  const pub = JSON.stringify(await adm.get(`/publico/venda/${v.tokenPublico}`));
  const vazouPub = /custo|Logistica|fechamento|lucro/i.exec(pub);
  verifica(!vazouPub, 'link público do cliente sem custos', vazouPub && pub.slice(Math.max(0, vazouPub.index - 80), vazouPub.index + 60));
  const pdf = await fetch(`${process.argv[2] || 'http://localhost:3333'}/api/v1/vendas/${v.id}/pdf`, { headers: { authorization: `Bearer ${adm.token}` } });
  if (pdf.ok) {
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    verifica(!/custo|log.stica|lucro/i.test(bytes), 'PDF do pedido sem custos');
  }

  secao('Fechar a venda e lançar/corrigir custo depois');
  for (const nome of ['Em aberto', 'Fechada']) if (sit(nome)) await adm.post(`/vendas/${v.id}/situacao`, { situacaoId: sit(nome) });
  const fechada = await adm.get(`/vendas/${v.id}`);
  verifica(fechada.estoqueLancado || fechada.contasLancadas, 'venda fechada (estoque/contas lançados)', fechada.situacao?.nome);
  const corpo = {
    ...fechada,
    itens: fechada.itens.map((i: any) => ({ produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, custoUnitario: i.produtoId === prodB.id ? 35 : i.custoInformado ? i.custoUnitario : null })),
    custoLogistica: 45,
  };
  const ajustada = await adm.put(`/vendas/${v.id}`, corpo);
  const iB2 = ajustada.itens.find((i: any) => i.produtoId === prodB.id);
  verifica(igual(iB2.custoUnitario, 35) && iB2.custoInformado === true, 'custo do item B corrigido para 35 com a venda fechada', iB2);
  verifica(igual(ajustada.custoTotal, 350) && igual(ajustada.custoLogistica, 45), 'custo produtos 350 + logística 45', { ct: ajustada.custoTotal, l: ajustada.custoLogistica });
  verifica(igual(ajustada.fechamento.lucro, 305), 'lucro recalculado = 700 - 395 = 305', ajustada.fechamento);
  verifica(igual(ajustada.total, 700) && ajustada.estoqueLancado === fechada.estoqueLancado, 'total e lançamentos não mudam', ajustada.total);
  // PUT parcial não zera campos de transporte (bug antigo dos defaults)
  await adm.put(`/vendas/${v.id}`, { pesoBruto: 1.5, quantidadeVolumes: 2, fretePorConta: 0 });
  const soObs = await adm.put(`/vendas/${v.id}`, { observacoesInternas: 'conferido' });
  verifica(soObs.quantidadeVolumes === 2 && igual(soObs.pesoBruto, 1.5) && soObs.fretePorConta === 0 && igual(soObs.custoLogistica, 45), 'PUT só de observação não apaga transporte nem logística', soObs);
  // continua bloqueado mexer em preço/quantidade
  await adm.put(`/vendas/${v.id}`, { ...corpo, itens: corpo.itens.map((i: any) => ({ ...i, quantidade: i.quantidade + 1 })) }, 422);

  secao('Dashboards usam a logística no lucro');
  const dv = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  verifica(typeof dv.resumo.semCusto === 'number', 'dashboard de vendas conta vendas sem custo', dv.resumo.semCusto);
  const semV = await adm.post('/vendas', { contatoId: cli.id, depositoId: dep, data: hoje(), itens: [{ descricao: `Item avulso sem custo ${SUF}`, quantidade: 1, valorUnitario: 50 }] }, 201);
  const dv2 = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  verifica(dv2.resumo.semCusto === dv.resumo.semCusto + 1, 'venda com item sem custo aparece no aviso', { antes: dv.resumo.semCusto, depois: dv2.resumo.semCusto });
  verifica(igual(dv2.resumo.lucroBruto - dv.resumo.lucroBruto, 50), 'lucro da venda sem custo = 50 (sem descontar nada)', dv2.resumo.lucroBruto - dv.resumo.lucroBruto);
  const pano = await adm.get(`/dashboard/panorama?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  verifica(igual(pano.resumo.vendas.lucro, dv2.resumo.lucroBruto), 'panorama e dashboard de vendas com o mesmo lucro', { p: pano.resumo.vendas.lucro, v: dv2.resumo.lucroBruto });
  await adm.del(`/vendas/${semV.id}`, [200, 204]);

  secao('Orçamento → venda leva o custo digitado');
  const orc = await adm.post('/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, itens: [{ produtoId: prodA.id, quantidade: 1, custoUnitario: 260 }], custoLogistica: 15 }, 201);
  const conv = await adm.post(`/vendas/${orc.id}/converter`, {}, [200, 201]);
  const vendaConv = conv?.itens ? conv : conv?.venda;
  verifica(vendaConv?.itens && igual(vendaConv.itens[0].custoUnitario, 260) && igual(vendaConv.custoLogistica, 15), 'venda gerada mantém custo 260 e logística 15', vendaConv && { c: vendaConv.itens?.[0]?.custoUnitario, l: vendaConv.custoLogistica });

  secao('Vendedor lança custo mas não vê lucro');
  const senha = 'Senha@12345';
  const vend = await adm.post('/vendedores', { nome: `Vendedor Teste ${SUF}`, comissaoPadraoPct: 1, ativo: true }, [200, 201]);
  await adm.post('/usuarios', { nome: `Vendedor Teste ${SUF}`, email: `vc${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  const V = await entrar(`vc${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  const vv = await V.post('/vendas', { contatoId: cli.id, depositoId: dep, data: hoje(), itens: [{ produtoId: prodB.id, quantidade: 1, custoUnitario: 33 }], custoLogistica: 5 }, 201);
  verifica(vv.fechamento === null && igual(vv.itens[0].custoUnitario, 33) && igual(vv.custoLogistica, 5), 'vendedor grava custo e logística; fechamento (lucro) vem vazio', vv.fechamento);
  const vvGet = await V.get(`/vendas/${vv.id}`);
  verifica(vvGet.fechamento === null, 'GET do vendedor também sem lucro');
  const vvAdm = await adm.get(`/vendas/${vv.id}`);
  verifica(vvAdm.fechamento && igual(vvAdm.fechamento.lucro, 62), 'ADMIN vê o lucro dessa venda (100 - 38 = 62)', vvAdm.fechamento);

  secao('Contas a pagar: vencidas → a vencer → pagas, por vencimento');
  const tag = `ordem ${SUF}`;
  const aVencer2 = await adm.post('/contas-pagar', { descricao: `${tag} a vencer depois`, vencimento: amanha(), valor: 10 }, 201);
  const vencida1 = await adm.post('/contas-pagar', { descricao: `${tag} vencida antiga`, vencimento: diasAtras(10), valor: 10 }, 201);
  const paga = await adm.post('/contas-pagar', { descricao: `${tag} paga`, vencimento: diasAtras(20), valor: 10 }, 201);
  const vencida2 = await adm.post('/contas-pagar', { descricao: `${tag} vencida recente`, vencimento: diasAtras(2), valor: 10 }, 201);
  const aVencer1 = await adm.post('/contas-pagar', { descricao: `${tag} vence hoje`, vencimento: hoje(), valor: 10 }, 201);
  const contas: any[] = await adm.get('/contas-financeiras');
  await adm.post(`/contas-pagar/${paga.id}/baixar`, { data: hoje(), contaFinanceiraId: (contas.find((c) => c.padrao) ?? contas[0]).id });
  const lista = await adm.get(`/contas-pagar?pesquisa=${encodeURIComponent(tag)}&limite=50`);
  const ordem = lista.data.map((c: any) => c.id);
  const esperado = [vencida1.id, vencida2.id, aVencer1.id, aVencer2.id, paga.id];
  verifica(JSON.stringify(ordem) === JSON.stringify(esperado), 'ordem: vencida antiga, vencida recente, vence hoje, vence amanhã, paga', lista.data.map((c: any) => c.descricao));
  const p1 = await adm.get(`/contas-pagar?pesquisa=${encodeURIComponent(tag)}&limite=2&pagina=1`);
  const p3 = await adm.get(`/contas-pagar?pesquisa=${encodeURIComponent(tag)}&limite=2&pagina=3`);
  verifica(p1.data.map((c: any) => c.id).join() === esperado.slice(0, 2).join() && p3.data.map((c: any) => c.id).join() === esperado.slice(4).join(), 'paginação respeita a mesma ordem', { p1: p1.data.length, p3: p3.data.length });

  encerrar('Custos internos da venda e ordem do contas a pagar');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
