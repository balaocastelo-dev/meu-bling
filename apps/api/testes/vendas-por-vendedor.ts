/**
 * VENDAS POR VENDEDOR (regra do Thiago, 29/10/2026)
 *   - cada vendedor (e técnico, que também vende) só acessa as PRÓPRIAS vendas e orçamentos;
 *   - não vê o total vendido da loja toda nem o "vendedor destaque";
 *   - gerente e ADMIN veem todas as vendas.
 *   npx tsx testes/vendas-por-vendedor.ts http://localhost:3333
 */
import { clienteCompleto, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'Senha@Teste123';
  const formas: any[] = await adm.get('/formas-pagamento');
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Escopo ${SUF}`), 201);

  const vA = await adm.post('/vendedores', { nome: `Escopo A ${SUF}`, ativo: true }, [200, 201]);
  const vB = await adm.post('/vendedores', { nome: `Escopo B ${SUF}`, ativo: true }, [200, 201]);
  await adm.post('/usuarios', { nome: `Escopo A ${SUF}`, email: `ea${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vA.id }, 201);
  await adm.post('/usuarios', { nome: `Escopo B ${SUF}`, email: `eb${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vB.id }, 201);
  await adm.post('/usuarios', { nome: `Escopo Gerente ${SUF}`, email: `eg${SUF}@teste.com`, senha, perfil: 'GERENTE' }, 201);
  await adm.post('/usuarios', { nome: `Escopo Tecnico ${SUF}`, email: `et${SUF}@teste.com`, senha, perfil: 'TECNICO' }, 201);
  const A = await entrar(`ea${SUF}@teste.com`, senha);
  A.nome = 'Vendedor A';
  const B = await entrar(`eb${SUF}@teste.com`, senha);
  B.nome = 'Vendedor B';
  const G = await entrar(`eg${SUF}@teste.com`, senha);
  G.nome = 'Gerente';
  const T = await entrar(`et${SUF}@teste.com`, senha);
  T.nome = 'Técnico';

  const venda = (valor: number, extra: Record<string, unknown> = {}) => ({
    contatoId: cli.id,
    data: hoje(),
    itens: [{ descricao: 'Item escopo', quantidade: 1, valorUnitario: valor, custoUnitario: Math.round(valor / 2) }],
    parcelas: [{ dataVencimento: hoje(), valor, formaPagamentoId: formas[0].id }],
    ...extra,
  });

  secao('Cada vendedor vende no próprio nome');
  const deA = await A.post('/vendas', venda(1111), 201);
  verifica(deA.vendedorId === vA.id, 'venda do vendedor A fica no nome dele', deA.vendedorId);
  const tentativa = await A.post('/vendas', venda(222, { vendedorId: vB.id }), 201);
  verifica(tentativa.vendedorId === vA.id, 'vendedor não consegue lançar venda no nome de outro', tentativa.vendedorId);
  const deB = await B.post('/vendas', venda(3333), 201);
  const orcB = await B.post('/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, itens: [{ descricao: 'Orçamento escopo', quantidade: 1, valorUnitario: 900 }] }, 201);
  const daLoja = await adm.post('/vendas', venda(5000, { vendedorId: null }), 201);

  secao('Lista: vendedor só vê as próprias vendas');
  const listaA = await A.get('/vendas?limite=200&tipo=TODOS');
  verifica(listaA.data.length > 0 && listaA.data.every((v: any) => v.vendedorId === vA.id), 'lista do A só tem vendas do A', listaA.data.map((v: any) => v.vendedorId));
  const forcado = await A.get(`/vendas?limite=200&vendedorId=${vB.id}`);
  verifica(forcado.data.every((v: any) => v.vendedorId === vA.id), 'filtrar pelo vendedor B na URL não mostra as vendas do B', forcado.data.length);
  const totalA = listaA.data.filter((v: any) => v.tipo === 'PEDIDO').reduce((s: number, v: any) => s + v.total, 0);
  const resumoA = (await A.get('/vendas?limite=200')).resumo;
  verifica(igual(resumoA.valor, totalA), 'total do painel é só das vendas dele, não da loja toda', { resumo: resumoA.valor, dele: totalA });
  verifica(!resumoA.destaque || resumoA.destaque.id === vA.id, 'vendedor não vê outro vendedor como destaque', resumoA.destaque);

  secao('Detalhe, documentos e ações: venda de outro vendedor é bloqueada');
  const neg = await A.get(`/vendas/${deB.id}`, 403);
  verifica(neg?.code === 'VENDA_DE_OUTRO_VENDEDOR', 'abrir venda do B → 403 com explicação', neg);
  await A.get(`/vendas/${orcB.id}`, 403);
  await A.get(`/vendas/${daLoja.id}`, 403);
  await A.get(`/vendas/${deB.id}/pdf`, 403);
  await A.get(`/vendas/${deB.id}/imprimir`, 403);
  await A.get(`/vendas/${deB.id}/documentos/resumo`, 403);
  await A.put(`/vendas/${deB.id}`, { observacoes: 'invasão' }, 403);
  await A.post(`/vendas/${deB.id}/duplicar`, {}, 403);
  await A.post(`/vendas/${deB.id}/transferir-vendedor`, { vendedorId: vA.id }, 403);
  await A.get(`/vendas/${deA.id}`, 200);
  const editada = await A.put(`/vendas/${deA.id}`, { observacoes: 'minha', vendedorId: vB.id }, 200);
  verifica(editada.vendedorId === vA.id, 'editando a própria venda o vendedor não troca o dono', editada.vendedorId);

  secao('Histórico do cliente: só as vendas do próprio vendedor');
  const histA = await A.get(`/contatos/${cli.id}/historico`);
  const itensHist: any[] = Array.isArray(histA) ? histA : histA.timeline || histA.data || [];
  const vendasHist = itensHist.filter((i) => i.referencia?.tipo === 'VENDA').map((i) => i.referencia.id);
  verifica(vendasHist.includes(deA.id) && !vendasHist.includes(deB.id) && !vendasHist.includes(daLoja.id), 'histórico do cliente mostra só as vendas do A', vendasHist);
  const cliA = await A.get(`/contatos/${cli.id}`);
  verifica(igual(cliA.resumo.totalVendas, 1111 + 222), 'resumo do cliente soma só as vendas do A', cliA.resumo.totalVendas);

  secao('Técnico (também vende): mesma regra');
  const listaT = await T.get('/vendas?limite=200');
  verifica(listaT.data.every((v: any) => v.vendedorId !== vA.id && v.vendedorId !== vB.id), 'técnico não vê vendas dos vendedores', listaT.data.length);
  await T.get(`/vendas/${deA.id}`, 403);

  secao('Gerente e ADMIN veem todas');
  const listaG = await G.get('/vendas?limite=500&tipo=TODOS');
  const idsG = listaG.data.map((v: any) => v.id);
  verifica([deA.id, deB.id, orcB.id, daLoja.id].every((id) => idsG.includes(id)), 'gerente vê as vendas de todos (e sem vendedor)', idsG.length);
  await G.get(`/vendas/${deB.id}`, 200);
  await adm.get(`/vendas/${deA.id}`, 200);
  const resumoG = (await G.get('/vendas?limite=500')).resumo;
  verifica(resumoG.valor >= 1111 + 222 + 3333 + 5000 - 0.01, 'gerente vê o total vendido da loja toda', resumoG.valor);
  const filtroG = await G.get(`/vendas?limite=200&vendedorId=${vB.id}`);
  verifica(filtroG.data.length > 0 && filtroG.data.every((v: any) => v.vendedorId === vB.id), 'gerente pode filtrar por vendedor');

  encerrar('Vendas por vendedor');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
