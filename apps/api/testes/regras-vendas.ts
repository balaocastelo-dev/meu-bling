/**
 * REGRAS DE VENDAS, PAINEL DO VENDEDOR, METAS E DESAFIOS
 * Cada bloco testa uma regra de negócio que o Balão espera — inclusive os problemas já encontrados
 * em produção (ex.: venda "Em aberto" que não aparecia no painel da vendedora, 22/10/2026).
 *   npx tsx testes/regras-vendas.ts http://localhost:3333
 */
import { aguardar, diasAtras, encerrar, entrar, espera, hoje, igual, secao, Sessao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  // ------------------------------------------------------------------ base
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const sit = (nome: string) => sitV.find((s) => s.nome === nome)?.id;
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  const formas: any[] = await adm.get('/formas-pagamento');
  const depositos: any[] = await adm.get('/depositos');
  const dep = depositos.find((d) => d.padrao)?.id ?? depositos[0].id;
  const cli = await adm.post('/contatos', { nome: `Cliente Regras ${SUF}`, tipoPessoa: 'F' }, 201);
  const cat = await adm.post('/categorias-produto', { nome: `Categoria Regras ${SUF}` }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `NOTEBOOK REGRAS ${SUF}`, codigo: `RG-${SUF}`, preco: 1000, precoCusto: 700, categoriaId: cat.id }, 201);
  const prod2 = await adm.post('/produtos', { nome: `MOUSE REGRAS ${SUF}`, codigo: `RM-${SUF}`, preco: 50, precoCusto: 20 }, 201);
  await adm.post('/estoque/ajuste', { produtoId: prod.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 50, custoUnitario: 700 }, [200, 201]);
  await adm.post('/estoque/ajuste', { produtoId: prod2.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 50, custoUnitario: 20 }, [200, 201]);

  // dois vendedores com login
  const senha = 'Senha@Teste123';
  const vA = await adm.post('/vendedores', { nome: `Vendedora A ${SUF}`, comissaoPadraoPct: 2, ativo: true }, [200, 201]);
  const vB = await adm.post('/vendedores', { nome: `Vendedor B ${SUF}`, comissaoPadraoPct: 2, ativo: true }, [200, 201]);
  await adm.post('/usuarios', { nome: `Vendedora A ${SUF}`, email: `va${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vA.id }, 201);
  await adm.post('/usuarios', { nome: `Vendedor B ${SUF}`, email: `vb${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vB.id }, 201);
  const A = await entrar(`va${SUF}@teste.com`, senha);
  A.nome = 'Vendedora A';
  const B = await entrar(`vb${SUF}@teste.com`, senha);
  B.nome = 'Vendedor B';

  const vender = async (s: Sessao, valor: number, extra: Record<string, unknown> = {}) =>
    s.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: 'Item avulso regras', quantidade: 1, valorUnitario: valor }], parcelas: [{ dataVencimento: hoje(), valor, formaPagamentoId: formas[0].id }], ...extra }, 201);
  const painel = (s: Sessao, q = '') => s.get('/painel-vendedor' + q);
  const hojeDe = (p: any) => p?.periodos?.find((x: any) => x.chave === 'hoje');

  // ================================================================== painel ao vivo
  secao('Painel do vendedor conta a venda na hora (bug de 22/10: venda "Em aberto" não aparecia)');
  const antes = hojeDe(await painel(A));
  const v1 = await vender(A, 349);
  verifica(v1.vendedorId === vA.id, 'venda feita pelo login do vendedor fica no nome dele', v1.vendedorId);
  verifica(!sitV.find((s) => s.id === v1.situacaoId)?.final, 'venda nova nasce em situação não final ("Em aberto")', v1.situacao?.nome);
  const depois = hojeDe(await painel(A));
  verifica(igual(depois.faturamento - antes.faturamento, 349) && depois.qtd === antes.qtd + 1, 'venda "Em aberto" já soma no card "Hoje" do vendedor', { antes, depois });
  const mesA = (await painel(A)).periodos.find((x: any) => x.chave === 'mes');
  verifica(mesA.faturamento >= 349, 'e no card "Este mês"', mesA);

  const orc = await A.post('/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, itens: [{ descricao: 'Orçamento regras', quantidade: 1, valorUnitario: 5000 }] }, 201);
  verifica(igual(hojeDe(await painel(A)).faturamento, depois.faturamento), 'orçamento NÃO conta no painel', orc.numero);

  await A.post(`/vendas/${v1.id}/situacao`, { situacaoId: sit('Fechada') });
  verifica(igual(hojeDe(await painel(A)).faturamento, depois.faturamento), 'fechar a venda não conta em dobro');
  await A.post(`/vendas/${v1.id}/situacao`, { situacaoId: cancelada });
  verifica(igual(hojeDe(await painel(A)).faturamento, antes.faturamento), 'venda cancelada sai do painel');

  secao('Dashboard de vendas e relatórios contam a venda em aberto (bug de 22/10: dashboard de hoje vazio)');
  const dashAntes = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  const vDash = await vender(A, 777);
  const dashDepois = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  verifica(igual(dashDepois.resumo.faturamento - dashAntes.resumo.faturamento, 777) && dashDepois.resumo.qtdVendas === dashAntes.resumo.qtdVendas + 1, 'dashboard de vendas de hoje soma a venda em aberto', { antes: dashAntes.resumo, depois: dashDepois.resumo });
  const relHoje = await adm.get(`/relatorios/vendas-por-periodo?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  verifica(igual(relHoje.totais?.faturamento ?? relHoje.totais?.total ?? 0, dashDepois.resumo.faturamento), 'relatório de vendas por período bate com o dashboard', { rel: relHoje.totais, dash: dashDepois.resumo.faturamento });
  await A.post(`/vendas/${vDash.id}/situacao`, { situacaoId: cancelada });
  const dashCanc = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  verifica(igual(dashCanc.resumo.faturamento, dashAntes.resumo.faturamento), 'cancelada sai do dashboard');

  secao('Transferir, editar e excluir refletem no painel');
  const v2 = await vender(A, 500);
  const bAntes = hojeDe(await painel(B)).faturamento;
  await A.post(`/vendas/${v2.id}/transferir-vendedor`, { vendedorId: vB.id });
  verifica(igual(hojeDe(await painel(B)).faturamento - bAntes, 500), 'transferida para B: soma no painel de B');
  await A.post(`/vendas/${v2.id}/transferir-vendedor`, { vendedorId: vA.id }, [403]);
  verifica(true, 'quem não é mais o dono não consegue puxar a venda de volta (403 acima)');
  const devolvida = await B.post(`/vendas/${v2.id}/transferir-vendedor`, { vendedorId: vA.id });
  verifica(devolvida?.venda?.vendedorId === vA.id, 'o novo dono consegue devolver ao colega');
  verifica(igual(hojeDe(await painel(B)).faturamento, bAntes), 'devolvida: sai do painel de B');
  const editada = await A.put(`/vendas/${v2.id}`, { contatoId: cli.id, vendedorId: vA.id, data: hoje(), itens: [{ descricao: 'Item avulso regras', quantidade: 1, valorUnitario: 800 }], parcelas: [{ dataVencimento: hoje(), valor: 800, formaPagamentoId: formas[0].id }] });
  verifica(igual(editada.total, 800), 'editar venda em aberto muda o total', editada.total);
  const pEd = hojeDe(await painel(A));
  const v3 = await vender(A, 120);
  await adm.del(`/vendas/${v3.id}`);
  verifica(igual(hojeDe(await painel(A)).faturamento, pEd.faturamento), 'venda excluída sai do painel');
  await A.del(`/vendas/${v2.id}`, [403]);

  secao('Privacidade do painel e do ranking');
  const pOutro = await A.get(`/painel-vendedor?vendedorId=${vB.id}`);
  verifica(pOutro.vendedor.id === vA.id, 'vendedor não consegue abrir o painel de outro (ignora vendedorId)', pOutro.vendedor);
  const rk = pOutro.ranking.lista;
  verifica(rk.filter((r: any) => !r.eu).every((r: any) => r.faturamento === null), 'no ranking o vendedor não vê valores dos colegas');
  verifica(rk.some((r: any) => r.eu && r.faturamento !== null), 'mas vê o próprio valor');
  const pAdm = await adm.get(`/painel-vendedor?vendedorId=${vB.id}`);
  verifica(pAdm.vendedor.id === vB.id && pAdm.ranking.lista.every((r: any) => r.faturamento !== null), 'ADMIN abre o painel de qualquer vendedor e vê todos os valores');
  const posicoes = rk.map((r: any) => r.posicao);
  verifica(posicoes.every((p: number, i: number) => p === i + 1), 'ranking numerado 1..N sem buracos', posicoes);

  secao('Períodos do painel (hoje ⊂ semana ⊂ 7 dias, mês ⊂ 30 dias ⊂ sempre)');
  await vender(A, 230, { data: diasAtras(3) });
  const P = (await painel(A)).periodos as any[];
  const f = (k: string) => P.find((x) => x.chave === k).faturamento;
  verifica(P.length === 6 && P.map((x) => x.chave).join() === 'hoje,semana,ultimos7,mes,ultimos30,sempre', 'seis cards na ordem certa', P.map((x) => x.chave));
  verifica(f('hoje') <= f('semana') + 0.01 && f('hoje') <= f('ultimos7') + 0.01, 'hoje ≤ semana e ≤ 7 dias');
  verifica(f('ultimos7') <= f('ultimos30') + 0.01 && f('ultimos30') <= f('sempre') + 0.01 && f('mes') <= f('sempre') + 0.01, '7 dias ≤ 30 dias ≤ sempre; mês ≤ sempre');
  verifica(f('ultimos7') - f('hoje') >= 229.99, 'venda de 3 dias atrás conta em "últimos 7 dias" e não em "hoje"');
  const semana = P.find((x) => x.chave === 'semana');
  verifica(new Date(semana.inicio).getDay() === 1, 'semana começa na segunda-feira', semana.inicio);
  verifica(P.every((x) => (x.qtd ? igual(x.ticketMedio, x.faturamento / x.qtd) : x.ticketMedio === 0)), 'ticket médio = total ÷ nº de vendas');

  // ================================================================== metas
  secao('Metas');
  const comp = hoje().slice(0, 7);
  await adm.put('/metas', { competencia: comp, itens: [{ vendedorId: vA.id, metaPadrao: 10000, metaMes: null }] });
  let mA = (await painel(A)).meta;
  verifica(mA.valor === 10000 && mA.origem === 'PADRAO', 'meta padrão vale para o mês', mA);
  await adm.put('/metas', { competencia: comp, itens: [{ vendedorId: vA.id, metaPadrao: 10000, metaMes: 2000 }] });
  mA = (await painel(A)).meta;
  verifica(mA.valor === 2000 && mA.origem === 'MES', '"só neste mês" sobrepõe a padrão', mA);
  verifica(igual(mA.falta, Math.max(0, 2000 - mA.vendido)) && igual(mA.pct, Math.round((mA.vendido / 2000) * 1000) / 10, 1), 'falta e % batem com vendido/meta', mA);
  verifica(mA.diasRestantes >= 1 && igual(mA.porDia, mA.falta / mA.diasRestantes), 'precisa por dia = falta ÷ dias restantes', mA);
  await adm.put('/metas', { competencia: comp, itens: [{ vendedorId: vA.id, metaPadrao: 10000, metaMes: null }] });
  verifica((await painel(A)).meta.valor === 10000, 'desligar "só neste mês" volta para a padrão');
  await A.put('/metas', { competencia: comp, itens: [{ vendedorId: vA.id, metaPadrao: 1, metaMes: null }] }, [403]);
  await A.get('/metas', [403]);
  await adm.put('/metas', { competencia: '2026-13', itens: [{ vendedorId: vA.id, metaPadrao: 1, metaMes: null }] }, [400]);
  await adm.put('/metas', { competencia: comp, itens: [{ vendedorId: vA.id, metaPadrao: -5, metaMes: null }] }, [400]);

  // ================================================================== desafios
  secao('Desafio por valor: prêmio automático e estorno');
  const d1 = await adm.post('/desafios', { titulo: `Valor ${SUF}`, tipo: 'VALOR', alvo: 1000, premio: 100, inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [vA.id, vB.id] }, 201);
  verifica(d1.participantes.length === 2, 'desafio com 2 participantes escolhidos', d1.participantes);
  const premioDe = async (vid: number, desafioId: number) => ((await adm.get(`/comissoes?origemTipo=DESAFIO&vendedorId=${vid}&limite=100`)).data as any[]).filter((c) => c.desafioId === desafioId || c.desafio?.id === desafioId);
  const baseA = (await adm.get(`/desafios/${d1.id}`)).participantes.find((p: any) => p.vendedorId === vA.id).atingido;
  const precisa = Math.max(1, 1000 - baseA);
  const vd = await vender(A, precisa); // em aberto já conta
  const pr = await aguardar(() => premioDe(vA.id, d1.id), (l) => l.length > 0);
  verifica(pr.length === 1 && pr[0].status === 'APROVADA' && pr[0].valor === 100, 'bateu o alvo com venda em aberto: prêmio de R$ 100 já liberado', pr);
  const card = (await painel(A)).desafios.find((d: any) => d.id === d1.id);
  verifica(card?.status === 'CONQUISTADO', 'card aparece "Conquistado" no painel', card?.status);
  await A.post(`/vendas/${vd.id}/situacao`, { situacaoId: cancelada });
  const pr2 = await aguardar(() => premioDe(vA.id, d1.id), (l) => l[0]?.status === 'CANCELADA');
  verifica(pr2[0]?.status === 'CANCELADA', 'venda cancelada: prêmio não pago é estornado', pr2);
  await vender(A, precisa);
  const pr3 = await aguardar(() => premioDe(vA.id, d1.id), (l) => l.some((c) => c.status === 'APROVADA'));
  verifica(pr3.filter((c) => c.status === 'APROVADA').length === 1, 'bateu de novo: um único prêmio ativo (sem duplicar)', pr3);
  await adm.put(`/desafios/${d1.id}`, { titulo: `Valor ${SUF}`, tipo: 'VALOR', alvo: 1000, premio: 150, inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [vA.id, vB.id] });
  const pr4 = await premioDe(vA.id, d1.id);
  verifica(pr4.find((c) => c.status === 'APROVADA')?.valor === 150, 'mudar o prêmio corrige a comissão ainda não paga', pr4);
  await adm.del(`/desafios/${d1.id}`, [422]);

  secao('Desafio "só o primeiro"');
  const d2 = await adm.post('/desafios', { titulo: `Primeiro ${SUF}`, tipo: 'QTD_VENDAS', alvo: 1, premio: 50, regra: 'PRIMEIRO', inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [vA.id, vB.id] }, 201);
  const d2v = await adm.get(`/desafios/${d2.id}`);
  const ganhadores = d2v.participantes.filter((p: any) => p.conquistou);
  verifica(ganhadores.length === 1, 'só um vendedor ganha mesmo com os dois acima do alvo', d2v.participantes);
  const perdedor = ganhadores[0]?.vendedorId === vA.id ? B : A;
  const cardPerd = (await painel(perdedor)).desafios.find((d: any) => d.id === d2.id);
  verifica(cardPerd?.status === 'GANHO_POR_OUTRO' && !!cardPerd?.ganhador, 'para o outro o card mostra "Já tem ganhador"', cardPerd);

  secao('Desafio por produto e por categoria (unidades)');
  const d3 = await adm.post('/desafios', { titulo: `Produto ${SUF}`, tipo: 'QTD_ITENS', alvo: 3, premio: 30, inicio: hoje(), fim: hoje(), produtoId: prod.id, todosVendedores: false, vendedoresIds: [vB.id] }, 201);
  const d4 = await adm.post('/desafios', { titulo: `Categoria ${SUF}`, tipo: 'VALOR', alvo: 2000, premio: 40, inicio: hoje(), fim: hoje(), categoriaId: cat.id, todosVendedores: false, vendedoresIds: [vB.id] }, 201);
  await B.post('/vendas', { contatoId: cli.id, data: hoje(), depositoId: dep, itens: [{ produtoId: prod.id, quantidade: 2, valorUnitario: 1000 }, { produtoId: prod2.id, quantidade: 10, valorUnitario: 50 }], parcelas: [{ dataVencimento: hoje(), valor: 2500, formaPagamentoId: formas[0].id }] }, 201);
  await espera(500);
  const d3v = await adm.get(`/desafios/${d3.id}`);
  verifica(d3v.participantes[0].atingido === 2 && !d3v.participantes[0].conquistou, 'conta só as unidades do produto do desafio (2 de 3; mouses não contam)', d3v.participantes[0]);
  const d4v = await adm.get(`/desafios/${d4.id}`);
  verifica(igual(d4v.participantes[0].atingido, 2000) && d4v.participantes[0].conquistou, 'por categoria soma só os itens da categoria (R$ 2.000 de R$ 2.500)', d4v.participantes[0]);

  secao('Desafio agendado, encerrado e validações');
  const amanha = diasAtras(-1);
  const d5 = await adm.post('/desafios', { titulo: `Futuro ${SUF}`, tipo: 'VALOR', alvo: 1, premio: 10, inicio: amanha, fim: amanha, todosVendedores: false, vendedoresIds: [vA.id] }, 201);
  verifica(d5.participantes[0].atingido === 0 && !d5.participantes[0].conquistou, 'venda de hoje não conta em desafio que começa amanhã');
  verifica((await painel(A)).desafios.find((d: any) => d.id === d5.id)?.status === 'AGENDADO', 'card aparece como "Em breve"');
  const d6 = await adm.post('/desafios', { titulo: `Encerrado ${SUF}`, tipo: 'VALOR', alvo: 999999, premio: 10, inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [vA.id] }, 201);
  await adm.post(`/desafios/${d6.id}/encerrar`);
  await adm.put(`/desafios/${d6.id}`, { titulo: `Encerrado ${SUF}`, tipo: 'VALOR', alvo: 1, premio: 10, inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [vA.id] });
  verifica(!(await adm.get(`/desafios/${d6.id}`)).participantes[0].conquistou, 'desafio encerrado não premia mais ninguém');
  await adm.del(`/desafios/${d6.id}`);
  await adm.post('/desafios', { titulo: 'Fim antes', tipo: 'VALOR', alvo: 1, premio: 1, inicio: hoje(), fim: diasAtras(2) }, [422]);
  await adm.post('/desafios', { titulo: 'Sem gente', tipo: 'VALOR', alvo: 1, premio: 1, inicio: hoje(), fim: hoje(), todosVendedores: false, vendedoresIds: [] }, [422]);
  await adm.post('/desafios', { titulo: 'Prêmio zero', tipo: 'VALOR', alvo: 1, premio: 0, inicio: hoje(), fim: hoje() }, [400]);
  await adm.post('/desafios', { titulo: 'Fração', tipo: 'QTD_VENDAS', alvo: 1.5, premio: 1, inicio: hoje(), fim: hoje() }, [422]);
  await A.post('/desafios', { titulo: 'Vendedor não cria', tipo: 'VALOR', alvo: 1, premio: 1, inicio: hoje(), fim: hoje() }, [403]);

  // ================================================================== vínculo usuário → vendedor
  secao('Usuário VENDEDOR sem cadastro de vendedor (caso do Wendell)');
  await adm.post('/usuarios', { nome: `Sem Cadastro ${SUF}`, email: `sc${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, 201);
  const SC = await entrar(`sc${SUF}@teste.com`, senha);
  SC.nome = 'Sem cadastro';
  const pSC = await SC.get('/painel-vendedor', [200]);
  verifica(pSC?.vendedor?.nome === `Sem Cadastro ${SUF}`, 'ganha cadastro de vendedor automático e o painel abre', pSC?.vendedor);
  const vSC = await vender(SC, 99);
  verifica(vSC.vendedorId === pSC?.vendedor?.id, 'e a venda dele sai no nome dele', vSC.vendedorId);
  await adm.post('/usuarios', { nome: 'Duplicado', email: `dup${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vA.id }, [422]);
  await adm.post('/usuarios', { nome: 'Email repetido', email: `va${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [422]);

  // ================================================================== estoque e financeiro da venda
  secao('Estoque e contas da venda (sem lançar em dobro, estorno no cancelamento)');
  const saldo = async () => (await adm.get(`/produtos/${prod2.id}`)).estoqueTotal;
  const s0 = await saldo();
  const ve = await A.post('/vendas', { contatoId: cli.id, data: hoje(), depositoId: dep, itens: [{ produtoId: prod2.id, quantidade: 3, valorUnitario: 50 }], parcelas: [{ dataVencimento: hoje(), valor: 150, formaPagamentoId: formas[0].id }] }, 201);
  await A.post(`/vendas/${ve.id}/situacao`, { situacaoId: sit('Fechada') });
  verifica((await saldo()) === s0 - 3, 'fechar baixa o estoque uma vez', { s0, agora: await saldo() });
  await A.post(`/vendas/${ve.id}/situacao`, { situacaoId: sit('NF emitida') }, [200, 422]);
  verifica((await saldo()) === s0 - 3, 'passar para NF emitida não baixa de novo');
  const contas = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${ve.id}`);
  const lista = (contas.data ?? contas) as any[];
  verifica(lista.length >= 1 && igual(lista.reduce((s, c) => s + c.valor, 0), 150), 'gera contas a receber com o total da venda', lista.map((c) => c.valor));
  await A.post(`/vendas/${ve.id}/situacao`, { situacaoId: cancelada });
  verifica((await saldo()) === s0, 'cancelar devolve o estoque');
  const contas2 = ((await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${ve.id}`)).data ?? []) as any[];
  verifica(contas2.every((c) => c.situacao === 'CANCELADO'), 'e cancela as contas a receber', contas2.map((c) => c.situacao));

  secao('Valores da venda');
  const vt = await A.post('/vendas', { contatoId: cli.id, data: hoje(), descontoTipo: 'PERCENTUAL', descontoValor: 10, frete: 20, itens: [{ descricao: 'A', quantidade: 2, valorUnitario: 100 }, { descricao: 'B', quantidade: 1, valorUnitario: 50, desconto: 5 }], parcelas: [] }, 201);
  verifica(igual(vt.totalProdutos, 245), 'total dos produtos = Σ(qtd × preço − desconto do item)', vt.totalProdutos);
  verifica(igual(vt.total, 245 - 24.5 + 20), 'total = produtos − desconto % + frete', vt.total);
  await A.post('/vendas', { contatoId: cli.id, itens: [] }, [400, 422]);
  await A.post('/vendas', { contatoId: 99999999, itens: [{ descricao: 'x', quantidade: 1, valorUnitario: 1 }] }, [400, 404, 422]);
  await A.post('/vendas', { contatoId: cli.id, itens: [{ descricao: 'x', quantidade: -1, valorUnitario: 1 }] }, [400, 422]);

  encerrar('Regras de vendas, painel, metas e desafios');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
