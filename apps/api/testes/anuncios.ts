/**
 * VITRINE DA EQUIPE — anúncios próprios com comissão sobre o lucro (docs/VITRINE-EQUIPE.md).
 *
 * Pedido do Thiago (30/10/2026): técnico PJ ganha 33% do lucro do que é dele, vendedor ganha 20%
 * do lucro da venda que veio pelo anúncio dele, tudo calculado sozinho pelo fluxo.
 *
 * É código de dinheiro, então este teste usa um técnico e um vendedor DE VERDADE (não o ADMIN,
 * que é vendedor no seed e esconderia o caminho do técnico) e garante:
 *   1. a conta bate com a fórmula de lucro do DRE, não com uma conta inventada;
 *   2. o custo da venda inteira é rateado por item, sem sobra nem duplicação;
 *   3. ninguém recebe duas vezes pelo mesmo serviço;
 *   4. cada um mexe só no que é dele.
 *
 *   npx tsx testes/anuncios.ts http://localhost:3333
 */
import { clienteCompleto, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const RAIZ = (process.argv[2] || 'http://localhost:3333').replace(/\/$/, '');
const publico = (rota: string) => fetch(`${RAIZ}/api/v1/publico/${rota}`).then((r) => r.json() as Promise<any>);
const cent = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'teste123456';

  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const situacao = (nome: string) => sitV.find((s) => s.nome === nome)?.id;
  const fechar = async (id: number, aceitar: number[] = [200, 201]) => {
    for (const nome of ['Em aberto', 'Fechada']) if (situacao(nome)) await adm.post(`/vendas/${id}/situacao`, { situacaoId: situacao(nome) }, aceitar);
  };
  const depositos: any[] = await adm.get('/depositos');
  const dep = depositos.find((d) => d.padrao)?.id ?? depositos[0].id;
  const cli = await adm.post('/contatos', { ...clienteCompleto(`Cliente Anúncio ${SUF}`), email: `anun${SUF}@example.com` }, 201);

  // técnico e vendedor de verdade, cada um com o seu usuário
  const tec = await adm.post('/tecnicos', { nome: `Tec Anuncio ${SUF}` }, 201);
  await adm.post('/usuarios', { nome: `Tec Anuncio ${SUF}`, email: `tanun${SUF}@teste.com`, senha, perfil: 'TECNICO', tecnicoId: tec.id }, 201);
  const vend = await adm.post('/vendedores', { nome: `Vend Anuncio ${SUF}`, comissaoPadraoPct: 0 }, 201);
  await adm.post('/usuarios', { nome: `Vend Anuncio ${SUF}`, email: `vanun${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  const T = await entrar(`tanun${SUF}@teste.com`, senha);
  T.nome = 'TECNICO';
  const V = await entrar(`vanun${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';

  // ---------------------------------------------------------------- 1. cadastro sem aprovação
  secao('Técnico PJ publica sozinho, sem pedir aprovação');
  const anTec = await T.post(
    '/anuncios',
    { titulo: `Troca de tela iPhone ${SUF}`, descricao: 'Tela original, 90 min na loja', tipo: 'SERVICO', preco: 1000, precoCusto: 400, prazoDias: 1, precoAPartirDe: 800 },
    201,
  );
  verifica(anTec?.donoTipo === 'TECNICO', 'o anúncio nasce como do técnico', anTec?.donoTipo);
  verifica(anTec?.comissaoPct === 33, 'técnico: 33% congelados no anúncio', anTec?.comissaoPct);
  verifica(anTec?.produto?.tipo === 'S', 'o serviço nasce junto como produto tipo S', anTec?.produto?.tipo);
  verifica(anTec?.produto?.controlaEstoque === false, 'serviço não controla estoque');
  verifica(anTec?.codigo?.length >= 3, 'ganha código para o link público', anTec?.codigo);

  const anVend = await V.post('/anuncios', { titulo: `Notebook Gamer ${SUF}`, tipo: 'PRODUTO', preco: 5000, precoCusto: 3500 }, 201);
  verifica(anVend?.donoTipo === 'VENDEDOR', 'o anúncio do vendedor nasce como dele', anVend?.donoTipo);
  verifica(anVend?.comissaoPct === 20, 'vendedor: 20% congelados no anúncio', anVend?.comissaoPct);

  // ---------------------------------------------------------------- 2. cada um mexe só no seu
  secao('Liberdade com limite: ninguém mexe no anúncio do colega');
  await V.req('PUT', `/anuncios/${anTec.id}`, { titulo: 'tentando mexer' }, 403);
  await T.req('PUT', `/anuncios/${anVend.id}`, { titulo: 'tentando mexer' }, 403);
  await V.req('DELETE', `/anuncios/${anTec.id}`, undefined, 403);
  const meusT: any = await T.get('/anuncios');
  verifica(meusT?.data?.every((a: any) => a.id !== anVend.id), 'o técnico não vê o anúncio do vendedor na lista dele');
  verifica(meusT?.meuPercentual === 33, 'a tela diz ao técnico quanto ele ganha antes de publicar', meusT?.meuPercentual);
  const todosAdm: any = await adm.get('/anuncios');
  verifica(todosAdm?.data?.some((a: any) => a.id === anTec.id) && todosAdm?.data?.some((a: any) => a.id === anVend.id), 'a gestão vê os anúncios de todo mundo');

  // ---------------------------------------------------------------- 3. vitrine pública
  secao('Vitrine do site: com o nome de quem atende e sem nenhum custo');
  const vitrine = await publico('anuncios');
  const naVitrine = vitrine?.data?.find((a: any) => a.codigo === anTec.codigo);
  verifica(!!naVitrine, 'o anúncio aparece na vitrine pública');
  verifica(naVitrine?.atendeCom === tec.nome, 'a vitrine mostra o nome do técnico responsável', naVitrine?.atendeCom);
  verifica(naVitrine && !JSON.stringify(naVitrine).includes('400'), 'a vitrine não expõe o custo de 400', JSON.stringify(naVitrine).slice(0, 120));
  verifica(naVitrine?.precoAPartirDe === 800, 'serviço sem preço fechado mostra "a partir de"', naVitrine?.precoAPartirDe);
  verifica(naVitrine?.link === `/a/${anTec.codigo}`, 'o link sai pronto para mandar no WhatsApp', naVitrine?.link);
  const umSo = await publico(`anuncios/${anTec.codigo}`);
  verifica(umSo?.titulo === anTec.titulo, 'a página do anúncio abre pelo código');

  // ---------------------------------------------------------------- 4. técnico: 33% do lucro do ITEM dele
  secao('Técnico: 33% do lucro do item dele, com o custo da venda rateado');
  const capinha = await adm.post('/produtos', { nome: `Capinha ${SUF}`, codigo: `CAP-${SUF}`, preco: 100, precoCusto: 30, ncm: '39269090', csosn: '102' }, 201);
  await adm.post('/estoque/ajuste', { produtoId: capinha.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 5, custoUnitario: 30 }, [200, 201]);

  const mista = await adm.post(
    '/vendas',
    {
      contatoId: cli.id,
      depositoId: dep,
      data: hoje(),
      itens: [
        { produtoId: anTec.produto.id, quantidade: 1, valorUnitario: 1000, custoUnitario: 400, anuncioId: anTec.id },
        { produtoId: capinha.id, quantidade: 1, valorUnitario: 100, custoUnitario: 30 },
      ],
    },
    201,
  );
  await fechar(mista.id);
  const mistaFechada = await adm.get(`/vendas/${mista.id}`);
  const cTec: any = await T.get(`/anuncios/${anTec.id}/comissoes`);
  const daMista = cTec?.data?.find((c: any) => c.vendaId === mista.id);
  verifica(!!daMista, 'a venda fechada gera a comissão do anúncio sozinha');

  if (daMista) {
    const f = mistaFechada?.fechamento;
    // lucro do item do técnico = receita − custo da peça − fatia dele dos custos da venda
    const rateavel = cent(f.custoTotal - f.custoProdutos);
    const esperado = cent(1000 - 400 - rateavel * (1000 / 1100));
    verifica(igual(daMista.base, esperado), 'a base é o lucro do item dele, com o custo da venda rateado pela receita', `${daMista.base} (esperado ${esperado})`);
    verifica(igual(daMista.valor, cent(esperado * 0.33)), 'comissão = 33% desse lucro', daMista.valor);
    verifica(daMista.base < f.lucro, 'o técnico não recebe sobre o lucro da capinha, que não é dele', `${daMista.base} < ${f.lucro}`);
    verifica(daMista.base < 1000, 'a base é lucro, não a receita de 1.000', daMista.base);
    verifica(daMista.pct === 33, 'o percentual gravado é o do anúncio', daMista.pct);
    verifica(daMista.status === 'PENDENTE', 'entra no fluxo de aprovar → pagar que já existe', daMista.status);
  }

  // ---------------------------------------------------------------- 5. vendedor: 20% do lucro da VENDA
  secao('Vendedor: 20% do lucro da venda inteira que o anúncio dele trouxe');
  const doVend = await adm.post(
    '/vendas',
    {
      contatoId: cli.id,
      depositoId: dep,
      data: hoje(),
      anuncioId: anVend.id,
      itens: [
        { produtoId: anVend.produto.id, quantidade: 1, valorUnitario: 5000, custoUnitario: 3500 },
        { produtoId: capinha.id, quantidade: 1, valorUnitario: 100, custoUnitario: 30 },
      ],
    },
    201,
  );
  verifica(doVend?.anuncioId === anVend.id, 'a venda guarda de qual anúncio veio o cliente', doVend?.anuncioId);
  await fechar(doVend.id);
  const vendFechada = await adm.get(`/vendas/${doVend.id}`);
  const cVend: any = await V.get(`/anuncios/${anVend.id}/comissoes`);
  const daVenda = cVend?.data?.find((c: any) => c.vendaId === doVend.id);
  verifica(!!daVenda, 'a comissão do vendedor sai sozinha ao fechar');
  if (daVenda) {
    verifica(igual(daVenda.base, vendFechada?.fechamento?.lucro), 'a base é exatamente o lucro da venda que o sistema mostra (mesma conta do DRE)', `${daVenda.base} vs ${vendFechada?.fechamento?.lucro}`);
    verifica(igual(daVenda.valor, cent(vendFechada.fechamento.lucro * 0.2)), 'comissão = 20% do lucro da venda', daVenda.valor);
    verifica(daVenda.base > 100, 'o item que o cliente levou junto entra no lucro (o anúncio trouxe o cliente)', daVenda.base);
  }

  // ---------------------------------------------------------------- 6. prejuízo
  secao('Venda no prejuízo: não paga comissão e não inventa valor negativo');
  const ruim = await adm.post(
    '/vendas',
    { contatoId: cli.id, depositoId: dep, data: hoje(), anuncioId: anVend.id, itens: [{ produtoId: anVend.produto.id, quantidade: 1, valorUnitario: 100, custoUnitario: 3500 }] },
    201,
  );
  await fechar(ruim.id, [200, 422]);
  const cVend2: any = await V.get(`/anuncios/${anVend.id}/comissoes`);
  verifica(!cVend2?.data?.find((c: any) => c.vendaId === ruim.id), 'venda com prejuízo não gera comissão nenhuma');

  // ---------------------------------------------------------------- 7. não pagar duas vezes
  secao('Trava: o mesmo serviço não é pago duas vezes');
  const previa: any = await adm.post(
    '/dashboard/assistencia/pagar-tecnico',
    { tecnicoId: tec.id, percentual: 10, escopo: 'TODAS', dataInicial: hoje(), dataFinal: hoje(), simular: true },
    [200, 422],
  );
  if (previa?.jaPagoPorAnuncio) {
    verifica(previa.jaPagoPorAnuncio.lucro >= 0, '"Pagar técnico" enxerga o que já foi pago pelos anúncios', previa.jaPagoPorAnuncio.lucro);
    verifica(igual(previa.lucroConsiderado, cent(Math.max(0, previa.lucro - previa.jaPagoPorAnuncio.lucro))), 'e tira essa fatia da base antes de calcular o pagamento do mês', `${previa.lucroConsiderado} = ${previa.lucro} − ${previa.jaPagoPorAnuncio.lucro}`);
  }

  // ---------------------------------------------------------------- 8. retorno para o dono
  secao('O dono vê o que o anúncio rendeu');
  const meus: any = await T.get('/anuncios');
  const meu = meus?.data?.find((a: any) => a.id === anTec.id);
  verifica(meu?.retorno?.vendas >= 1, 'quantas vendas o anúncio trouxe', meu?.retorno?.vendas);
  verifica(meu?.retorno?.comissaoTotal > 0, 'quanto já rendeu de comissão', meu?.retorno?.comissaoTotal);
  verifica(meu?.retorno?.lucroGerado > 0, 'e quanto lucro trouxe para a loja', meu?.retorno?.lucroGerado);

  // ---------------------------------------------------------------- 9. painel do ADM
  secao('Painel do ADMIN: pagamento extra por anúncio da equipe');
  const painel: any = await adm.get(`/dashboard/anuncios?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  verifica(painel?.comissaoTotal > 0, 'soma o pagamento extra do período', painel?.comissaoTotal);
  verifica(painel?.lucroGerado >= painel?.comissaoTotal, 'mostra o lucro que os anúncios trouxeram, não só a despesa', painel?.lucroGerado);
  verifica(igual(painel?.lucroLiquido, cent(painel.lucroGerado - painel.comissaoTotal)), 'e o que sobra para a loja depois de pagar a equipe', painel?.lucroLiquido);
  const tipos = (painel?.porDono || []).map((d: any) => d.tipo);
  verifica(tipos.includes('TECNICO') && tipos.includes('VENDEDOR'), 'separa técnicos e vendedores', tipos.join(','));
  verifica((painel?.topAnuncios || []).length >= 2, 'e mostra os anúncios que mais renderam', painel?.topAnuncios?.length);

  // ---------------------------------------------------------------- 10. histórico
  secao('Anúncio que já pagou comissão não some do sistema');
  const apagar: any = await T.req('DELETE', `/anuncios/${anTec.id}`, undefined, [200, 204]);
  verifica(apagar?.desativado === true, 'é desligado em vez de excluído, para o histórico de pagamento continuar', apagar?.desativado);
  const depois = await T.get(`/anuncios/${anTec.id}`);
  verifica(depois?.ativo === false && depois?.naVitrine === false, 'sai da vitrine mas continua consultável');
  const vitrine2 = await publico('anuncios');
  verifica(!vitrine2?.data?.find((a: any) => a.codigo === anTec.codigo), 'e realmente sai da vitrine do site');

  encerrar('Vitrine da equipe (anúncios com comissão sobre o lucro)');
}

main();
