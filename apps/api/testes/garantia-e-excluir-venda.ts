/**
 * GARANTIA ESCOLHIDA PELO VENDEDOR + APAGAR VENDA PELO ADMIN (pedidos do Thiago, 10/11/2026).
 *
 * 1. Antes de imprimir o certificado o vendedor confirma 3, 6 ou 12 meses; o prazo fica
 *    gravado no item, então o certificado, o recibo e a 2ª via saem sempre iguais.
 * 2. O ADMIN apaga venda de teste/cancelada: o sistema estorna estoque e contas antes.
 *    Venda com NF-e autorizada ou com dinheiro de verdade recebido NÃO é apagada.
 *
 *   npx tsx testes/garantia-e-excluir-venda.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const cli = await adm.post('/contatos', { nome: `Cliente Garantia ${SUF}`, tipoPessoa: 'F', documento: '19100000000', celular: '19999991111' }, 201);
  // "Notebook" no nome é o que faz o item ganhar certificado de garantia
  const note = await adm.post('/produtos', { nome: `Notebook Dell Inspiron ${SUF}`, preco: 3500, precoCusto: 2400, ncm: '84713012' }, 201);

  const novaVenda = async () =>
    adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: note.id, quantidade: 1, valorUnitario: 3500 }] }, 201);

  // ------------------------------------------------------------------ 1. prazo de garantia
  secao('Certificado: o vendedor confirma 3, 6 ou 12 meses antes de imprimir');
  const venda = await novaVenda();

  const resumo = await adm.get(`/vendas/${venda.id}/documentos/resumo`);
  verifica(resumo.temKit === true, 'o notebook gera certificado de garantia');
  const cert = resumo.certificados[0];
  verifica(!!cert?.itemId, 'o resumo diz qual item da venda é o certificado (a tela precisa disso)', cert?.itemId);
  verifica(cert?.garantiaMeses === 12, 'sem escolha, vem o padrão da loja: 12 meses (produto novo)', cert?.garantiaMeses);
  verifica(cert?.garantiaEscolhida === false, 'e o sistema diz que ninguém confirmou ainda', cert?.garantiaEscolhida);

  // vendedor confirma 6 meses
  const r6 = await adm.put(`/vendas/${venda.id}/documentos/garantia`, { itens: [{ itemId: cert.itemId, meses: 6 }] });
  verifica(/6 meses/.test(String(r6.certificados?.[0]?.garantia)), 'escolhendo 6 meses, o certificado passa a dizer 6 meses', r6.certificados?.[0]?.garantia);

  const depois = await adm.get(`/vendas/${venda.id}/documentos/resumo`);
  verifica(depois.certificados[0].garantiaMeses === 6, 'a escolha fica gravada (a 2ª via sai igual)', depois.certificados[0].garantiaMeses);
  verifica(depois.certificados[0].garantiaEscolhida === true, 'e o sistema marca como confirmada', depois.certificados[0].garantiaEscolhida);

  // a validade acompanha: 6 meses depois da data da venda
  const validade = new Date(depois.certificados[0].validaAte);
  const esperada = new Date(hoje() + 'T00:00:00');
  esperada.setMonth(esperada.getMonth() + 6);
  verifica(validade.toISOString().slice(0, 7) === esperada.toISOString().slice(0, 7), 'a validade do certificado anda junto com o prazo', depois.certificados[0].validaAte);

  // o documento impresso traz o prazo escolhido
  const html = String(await adm.get(`/vendas/${venda.id}/documentos?formato=garantia`));
  verifica(/6\s*meses/.test(html), 'o certificado impresso sai com 6 meses', html.slice(0, 120));

  // 3 e 12 também valem; prazo fora da lista é recusado
  await adm.put(`/vendas/${venda.id}/documentos/garantia`, { itens: [{ itemId: cert.itemId, meses: 3 }] });
  verifica((await adm.get(`/vendas/${venda.id}/documentos/resumo`)).certificados[0].garantiaMeses === 3, 'dá para voltar para 3 meses');
  await adm.put(`/vendas/${venda.id}/documentos/garantia`, { itens: [{ itemId: cert.itemId, meses: 9 }] }, 400);
  await adm.put(`/vendas/${venda.id}/documentos/garantia`, { itens: [{ itemId: 999999, meses: 6 }] }, 422);

  // ------------------------------------------------------------------ 2. apagar venda (ADMIN)
  secao('ADMIN apaga venda de teste, estornando estoque e contas antes');
  const paraApagar = await novaVenda();
  await adm.post(`/vendas/${paraApagar.id}/finalizar`, {});
  const antes = await adm.get(`/vendas/${paraApagar.id}`);
  verifica(antes.estoqueLancado || antes.contasLancadas, 'a venda finalizada tem estoque/contas lançados (o caso que não deixava apagar)', {
    estoque: antes.estoqueLancado,
    contas: antes.contasLancadas,
  });

  await adm.del(`/vendas/${paraApagar.id}`);
  await adm.get(`/vendas/${paraApagar.id}`, 404);
  verifica(true, 'o ADMIN apagou a venda mesmo com estoque/contas lançados');

  // nada de resto financeiro da venda apagada
  const receber = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${paraApagar.id}&limite=50`).catch(() => ({ data: [] }));
  verifica(!(receber.data || []).some((c: any) => c.situacao !== 'CANCELADO'), 'não ficou conta a receber viva da venda apagada', (receber.data || []).length);

  // ------------------------------------------------------------------ 3. quem não pode
  secao('O que NÃO pode ser apagado');
  const emailGer = `gerente.exc.${SUF}@balao.info`;
  await adm.post('/usuarios', { nome: `Gerente Exc ${SUF}`, email: emailGer, senha: 'teste12345', perfil: 'GERENTE' }, 201);
  const ger = await entrar(emailGer, 'teste12345');

  const daGerente = await novaVenda();
  await adm.post(`/vendas/${daGerente.id}/finalizar`, {});
  const recusa = await ger.del(`/vendas/${daGerente.id}`, 422);
  verifica(/administrador|estorne/i.test(JSON.stringify(recusa)), 'GERENTE com venda lançada é recusado e mandado ao administrador', recusa?.erro?.mensagem ?? recusa?.mensagem);
  await adm.get(`/vendas/${daGerente.id}`);
  verifica(true, 'e a venda continua lá');
  await adm.del(`/vendas/${daGerente.id}`);

  const vendedorNaoApaga = await novaVenda();
  const emailVend = `vend.exc.${SUF}@balao.info`;
  await adm.post('/usuarios', { nome: `Vend Exc ${SUF}`, email: emailVend, senha: 'teste12345', perfil: 'VENDEDOR' }, 201);
  const vend = await entrar(emailVend, 'teste12345');
  await vend.del(`/vendas/${vendedorNaoApaga.id}`, 403);
  verifica(true, 'VENDEDOR não apaga venda nenhuma');
  await adm.del(`/vendas/${vendedorNaoApaga.id}`);
}

main()
  .then(() => encerrar('Garantia escolhida + apagar venda pelo ADMIN'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
