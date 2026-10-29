/**
 * MEU DASHBOARD (29/10/2026) — vendedor, técnico, gerente e gestor
 * - Vendedor e técnico NUNCA recebem custo, lucro, margem, DRE ou saldo de banco (checagem de todas as chaves).
 * - O técnico também vende: ganha cadastro de vendedor sozinho; a venda dele aparece no dashboard e no ranking.
 * - Alertas com "Corrija": venda sem custo, OS sem técnico, OS sem custo de peça — somem quando corrigidos.
 * - Lembretes: cada um os seus; a gestão manda para a equipe; vendedor não mexe no lembrete de outro.
 * - Metas de técnico em R$ de serviços ou nº de OS; desafio de técnicos conta OS concluídas e paga o prêmio.
 * - "Ver como": só ADMIN/GERENTE; a gerente não abre o do gestor; gerente/financeiro não recebem lucro.
 *   npx tsx testes/meu-dashboard.ts http://localhost:3333
 */
import { aguardar, clienteCompleto, encerrar, entrar, hoje, igual, secao, Sessao, SUF, verifica } from './lib.js';

/** chaves (em qualquer profundidade) que contenham um dos termos proibidos */
function chavesProibidas(obj: unknown, termos = ['lucro', 'margem', 'custo', 'dre', 'saldo'], caminho = '', achadas: string[] = []): string[] {
  if (Array.isArray(obj)) obj.forEach((x, i) => chavesProibidas(x, termos, `${caminho}[${i}]`, achadas));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (termos.some((t) => k.toLowerCase().includes(t))) achadas.push(`${caminho}.${k}`);
      chavesProibidas(v, termos, `${caminho}.${k}`, achadas);
    }
  }
  return achadas;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'Senha@Teste123';

  // ------------------------------------------------------------------ base
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const sitOs: any[] = await adm.get('/situacoes?modulo=OS');
  const osFinal = sitOs.find((s) => s.nome === 'Entregue')?.id ?? sitOs.find((s) => s.final && !s.cancelamento)?.id;
  const formas: any[] = await adm.get('/formas-pagamento');
  const forma = formas.find((f) => f.tipo === 'DINHEIRO')?.id ?? formas[0].id;
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Dash ${SUF}`), 201);
  const incompleto = await adm.post('/contatos', { nome: `Cliente Incompleto ${SUF}`, tipoPessoa: 'F' }, 201);

  const vend = await adm.post('/vendedores', { nome: `Vendedor Dash ${SUF}`, comissaoPadraoPct: 2, ativo: true }, [200, 201]);
  const uVend = await adm.post('/usuarios', { nome: `Vendedor Dash ${SUF}`, email: `vd${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  const uTec = await adm.post('/usuarios', { nome: `Tecnico Dash ${SUF}`, email: `td${SUF}@teste.com`, senha, perfil: 'TECNICO' }, 201);
  const uGer = await adm.post('/usuarios', { nome: `Gerente Dash ${SUF}`, email: `gd${SUF}@teste.com`, senha, perfil: 'GERENTE' }, 201);
  const V = await entrar(`vd${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  const T = await entrar(`td${SUF}@teste.com`, senha);
  T.nome = 'TECNICO';
  const G = await entrar(`gd${SUF}@teste.com`, senha);
  G.nome = 'GERENTE';

  // ================================================================== técnico que vende
  secao('Técnico ganha cadastro de técnico E de vendedor ao entrar (ele também vende)');
  const eu: any = await T.get('/auth/eu');
  verifica(!!eu.tecnicoId && !!eu.vendedorId, 'login do técnico vinculou tecnicoId e vendedorId', eu);
  const vendaTec = await T.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: 'Mouse dash', quantidade: 1, valorUnitario: 120, custoUnitario: 60 }], parcelas: [{ dataVencimento: hoje(), valor: 120, formaPagamentoId: forma }] }, 201);
  verifica(vendaTec.vendedorId === eu.vendedorId, 'venda feita pelo técnico fica no nome dele (como vendedor)', vendaTec.vendedorId);
  const osTec = await T.post('/ordens-servico', { contatoId: cli.id, equipamento: 'Notebook', defeitoRelatado: 'Não liga', itens: [{ tipo: 'SERVICO', descricao: 'Reparo placa', quantidade: 1, valorUnitario: 300 }] }, 201);
  verifica(osTec.tecnicoId === eu.tecnicoId, 'OS aberta pelo técnico fica no nome dele', osTec.tecnicoId);

  // ================================================================== vendedor
  secao('Meu Dashboard do vendedor: só as vendas dele, sem custo/lucro');
  const v1 = await V.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: 'Notebook dash', quantidade: 1, valorUnitario: 2500, custoUnitario: 1500 }], parcelas: [{ dataVencimento: hoje(), valor: 2500, formaPagamentoId: forma }] }, 201);
  const dv: any = await V.get('/meu-dashboard');
  verifica(dv.usuario?.perfil === 'VENDEDOR' && dv.vendas && !dv.gerente && !dv.assistencia, 'vendedor recebe o bloco de vendas (e nada de gerente/assistência)', Object.keys(dv));
  verifica(igual(dv.vendas.periodo.faturamento, 2500) && dv.vendas.periodo.qtd === 1, 'faturamento de hoje = a venda dele (R$ 2.500)', dv.vendas.periodo);
  verifica(dv.vendas.serie.some((s: any) => igual(s.valor, 2500)), 'série por dia traz a venda', dv.vendas.serie);
  verifica(dv.vendas.topProdutos[0]?.nome === 'Notebook dash', 'produto mais vendido', dv.vendas.topProdutos);
  verifica(Array.isArray(dv.lembretes) && Array.isArray(dv.alertas), 'lembretes e alertas vêm junto');
  const proibidasV = chavesProibidas(dv);
  verifica(proibidasV.length === 0, 'NENHUMA chave de custo/lucro/margem/DRE/saldo para o vendedor', proibidasV);
  verifica(dv.vendas.ranking.lista.some((r: any) => r.eu && r.faturamento !== null) && dv.vendas.ranking.lista.filter((r: any) => !r.eu).every((r: any) => r.faturamento === null), 'ranking: vendedor vê só o próprio valor', dv.vendas.ranking.lista);
  void v1;

  secao('Alertas com "Corrija" (vendedor): venda sem custo e cliente incompleto');
  const semCusto = await V.post('/vendas', { contatoId: incompleto.id, data: hoje(), itens: [{ descricao: 'Cabo dash', quantidade: 1, valorUnitario: 30 }], parcelas: [{ dataVencimento: hoje(), valor: 30, formaPagamentoId: forma }] }, 201);
  let dv2: any = await V.get('/meu-dashboard');
  const aCusto = dv2.alertas.find((a: any) => a.id === 'venda-sem-custo');
  verifica(!!aCusto && aCusto.botao === 'Corrija' && aCusto.itens.some((i: any) => i.link === `/vendas/${semCusto.id}/editar`), 'alerta "venda com produto sem custo" com link para editar a venda', aCusto);
  const aCli = dv2.alertas.find((a: any) => a.id === 'venda-cliente-incompleto');
  verifica(!!aCli && aCli.itens.some((i: any) => i.link === `/contatos/${incompleto.id}/editar`), 'alerta "cliente incompleto" com link para editar o cliente', aCli);
  verifica(!dv2.alertas.some((a: any) => a.itens.some((i: any) => i.link === `/vendas/${vendaTec.id}/editar`)), 'o alerta do vendedor NÃO traz a venda do técnico', dv2.alertas);
  // corrige: informa o custo
  await V.put(`/vendas/${semCusto.id}`, { contatoId: incompleto.id, data: hoje(), itens: [{ descricao: 'Cabo dash', quantidade: 1, valorUnitario: 30, custoUnitario: 10 }], parcelas: [{ dataVencimento: hoje(), valor: 30, formaPagamentoId: forma }] });
  dv2 = await V.get('/meu-dashboard');
  verifica(!dv2.alertas.some((a: any) => a.id === 'venda-sem-custo' && a.itens.some((i: any) => i.link === `/vendas/${semCusto.id}/editar`)), 'informou o custo → o alerta some', dv2.alertas.map((a: any) => a.id));
  // cancela a venda do cliente incompleto para não sujar o resto
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  await V.post(`/vendas/${semCusto.id}/situacao`, { situacaoId: cancelada });

  secao('Vendedor não vê o dashboard de outro nem o do gestor');
  await V.get(`/meu-dashboard?usuarioId=${uTec.id}`, 403);
  await V.get('/meu-dashboard/equipe', 403);
  await V.get('/metas-tecnicos', 403);

  // ================================================================== técnico
  secao('Meu Dashboard do técnico: OS dele + vendas dele, sem custo/lucro');
  const dt: any = await T.get('/meu-dashboard');
  verifica(dt.usuario?.perfil === 'TECNICO' && dt.assistencia && dt.vendas && !dt.gerente, 'técnico recebe assistência + vendas (e nada de gerente)', Object.keys(dt));
  verifica(dt.assistencia.agora.comigo >= 1 && dt.assistencia.fila.some((o: any) => o.id === osTec.id), 'OS aberta dele aparece em "abertas comigo" e na fila', dt.assistencia.agora);
  verifica(igual(dt.vendas.periodo.faturamento, 120), 'vendas dele no dashboard (R$ 120)', dt.vendas.periodo);
  const proibidasT = chavesProibidas(dt);
  verifica(proibidasT.length === 0, 'NENHUMA chave de custo/lucro/margem/DRE/saldo para o técnico', proibidasT);
  verifica(!dt.alertas.some((a: any) => a.id === 'venda-pronta-nf'), 'técnico não recebe o alerta "pronto pra NF" (não emite NF)');

  secao('Alertas (técnico): OS sem técnico e OS com peça sem custo');
  const osSemTec = await adm.post('/ordens-servico', { contatoId: cli.id, tecnicoId: null, equipamento: 'Impressora', defeitoRelatado: 'Atolando', itens: [{ tipo: 'SERVICO', descricao: 'Limpeza', quantidade: 1, valorUnitario: 80 }] }, 201);
  verifica(osSemTec.tecnicoId === null, 'OS criada pelo ADMIN sem técnico', osSemTec.tecnicoId);
  const osPeca = await T.post('/ordens-servico', { contatoId: cli.id, equipamento: 'PC', defeitoRelatado: 'Sem vídeo', itens: [{ tipo: 'PECA', descricao: 'Placa de vídeo', quantidade: 1, valorUnitario: 900 }] }, 201);
  let dt2: any = await T.get('/meu-dashboard');
  const aTec = dt2.alertas.find((a: any) => a.id === 'os-sem-tecnico');
  verifica(!!aTec && aTec.botao === 'Corrija' && aTec.itens.some((i: any) => i.link === `/ordens-servico/${osSemTec.id}/editar`), 'alerta "OS sem técnico" com link para assumir', aTec);
  const aPeca = dt2.alertas.find((a: any) => a.id === 'os-sem-custo-peca');
  verifica(!!aPeca && aPeca.itens.some((i: any) => i.link === `/ordens-servico/${osPeca.id}/editar`), 'alerta "OS com peça sem custo" aponta a OS', aPeca);
  verifica(igual(dt2.assistencia.agora.semTecnico, (dt.assistencia.agora.semTecnico || 0) + 1), 'contador "sem técnico na loja" subiu', dt2.assistencia.agora);
  // corrige os dois
  await T.put(`/ordens-servico/${osSemTec.id}`, { contatoId: cli.id, tecnicoId: eu.tecnicoId, equipamento: 'Impressora', defeitoRelatado: 'Atolando', itens: [{ tipo: 'SERVICO', descricao: 'Limpeza', quantidade: 1, valorUnitario: 80 }] });
  await T.put(`/ordens-servico/${osPeca.id}`, { contatoId: cli.id, equipamento: 'PC', defeitoRelatado: 'Sem vídeo', custoPeca: 600, itens: [{ tipo: 'PECA', descricao: 'Placa de vídeo', quantidade: 1, valorUnitario: 900, custoUnitario: 600 }] });
  dt2 = await T.get('/meu-dashboard');
  verifica(!dt2.alertas.some((a: any) => a.id === 'os-sem-tecnico' && a.itens.some((i: any) => i.link === `/ordens-servico/${osSemTec.id}/editar`)), 'assumiu a OS → alerta some');
  verifica(!dt2.alertas.some((a: any) => a.id === 'os-sem-custo-peca' && a.itens.some((i: any) => i.link === `/ordens-servico/${osPeca.id}/editar`)), 'informou o custo da peça → alerta some');

  // ================================================================== metas e desafios de técnico
  secao('Meta do técnico em nº de OS e desafio de OS concluídas');
  await adm.put('/metas-tecnicos', { competencia: hoje().slice(0, 7), itens: [{ tecnicoId: eu.tecnicoId, tipoPadrao: 'QTD_OS', metaPadrao: 2, metaMes: null }] });
  const des = await adm.post('/desafios', { titulo: `Concluir 2 OS ${SUF}`, publico: 'TECNICOS', tipo: 'QTD_OS', alvo: 2, inicio: hoje(), fim: hoje(), premio: 75, todosVendedores: false, tecnicosIds: [eu.tecnicoId] }, 201);
  verifica(des.publico === 'TECNICOS' && des.participantes.some((p: any) => p.participanteId === eu.tecnicoId), 'desafio de técnicos criado com o técnico participando', des.participantes);
  await adm.post('/desafios', { titulo: 'errado', publico: 'TECNICOS', tipo: 'VALOR', alvo: 1, inicio: hoje(), fim: hoje(), premio: 10 }, 422);
  // conclui as duas OS (Entregue)
  for (const id of [osTec.id, osPeca.id]) await T.post(`/ordens-servico/${id}/situacao`, { situacaoId: osFinal, forcar: false }, [200, 422]).then(async (r: any) => {
    if (r?.erro) await adm.post(`/ordens-servico/${id}/situacao`, { situacaoId: osFinal, forcar: true });
  });
  const dt3: any = await aguardar(() => T.get('/meu-dashboard'), (d: any) => d.assistencia?.meta?.atingido >= 2, 6000);
  verifica(dt3.assistencia.meta.tipo === 'QTD_OS' && dt3.assistencia.meta.valor === 2 && dt3.assistencia.meta.atingido >= 2 && dt3.assistencia.meta.ritmo === 'batida', 'meta de 2 OS batida (tipo QTD_OS)', dt3.assistencia.meta);
  verifica(dt3.assistencia.periodo.concluidas >= 2 && dt3.assistencia.periodo.valorServicos >= 1200, 'OS concluídas e valor cobrado no período', dt3.assistencia.periodo);
  const card = dt3.assistencia.desafios.find((d: any) => d.id === des.id);
  verifica(card?.status === 'CONQUISTADO', 'card do desafio de OS: conquistado', card);
  const com: any = await adm.get(`/comissoes?tecnicoId=${eu.tecnicoId}&status=APROVADA`);
  const lista = Array.isArray(com) ? com : com?.data ?? [];
  verifica(lista.some((c: any) => c.origemTipo === 'DESAFIO' && igual(c.valor, 75) && c.tecnicoId === eu.tecnicoId), 'prêmio de R$ 75 lançado como comissão do técnico', lista.filter((c: any) => c.origemTipo === 'DESAFIO'));

  // ================================================================== lembretes
  secao('Lembretes: meus, da gestão para mim, e ninguém mexe no do outro');
  const l1 = await V.post('/lembretes', { titulo: 'Ligar para o cliente do notebook', data: hoje() }, 201);
  verifica(l1.situacao === 'HOJE' && l1.paraUsuarioId === uVend.id, 'lembrete do vendedor para hoje', l1);
  await V.post('/lembretes', { titulo: 'tentando mandar para outro', data: hoje(), paraUsuarioId: uTec.id }, 403);
  const l2 = await adm.post('/lembretes', { titulo: 'Fechar o caixa', data: '2020-01-01', paraUsuarioId: uVend.id }, 201);
  verifica(l2.situacao === 'ATRASADO' && l2.criadoPor?.id === 1, 'gestão manda lembrete atrasado para o vendedor', l2);
  const dl: any = await V.get('/meu-dashboard');
  verifica(dl.lembretes.length >= 2 && dl.lembretes[0].id === l2.id, 'lembretes no dashboard, atrasado primeiro', dl.lembretes.map((l: any) => [l.titulo, l.situacao]));
  await T.post(`/lembretes/${l1.id}/concluir`, {}, 403);
  await T.del(`/lembretes/${l1.id}`, 403);
  const c1 = await V.post(`/lembretes/${l1.id}/concluir`, {});
  verifica(c1.situacao === 'CONCLUIDO', 'vendedor conclui o seu', c1);
  const dl2: any = await V.get('/meu-dashboard');
  verifica(!dl2.lembretes.some((l: any) => l.id === l1.id), 'concluído sai do dashboard');
  const lg = await G.post('/lembretes', { titulo: 'Conferir estoque', data: hoje(), paraUsuarioId: uTec.id }, 201);
  verifica(lg.paraUsuarioId === uTec.id, 'gerente manda lembrete para o técnico', lg);
  await V.del(`/lembretes/${l2.id}`);

  // ================================================================== gerente / gestor
  secao('Gerente: loja inteira, caixinhas e equipe — sem lucro/margem/DRE');
  const dg: any = await G.get('/meu-dashboard');
  verifica(dg.usuario?.perfil === 'GERENTE' && dg.gerente && !dg.vendas && !dg.assistencia, 'gerente recebe o bloco da loja', Object.keys(dg));
  verifica(typeof dg.gerente.financeiro.saldoTotal === 'number' && Array.isArray(dg.gerente.financeiro.saldoContas), 'saldo em bancos + caixa');
  verifica(dg.gerente.periodo.receita >= 2620 && dg.gerente.periodo.vendas.valor >= 2620, 'receita do dia soma as vendas de todos (R$ 2.500 + R$ 120)', dg.gerente.periodo);
  verifica(dg.gerente.equipe.vendedores.some((x: any) => x.id === vend.id) && dg.gerente.equipe.tecnicos.some((x: any) => x.id === eu.tecnicoId && x.tipo === 'QTD_OS'), 'equipe com vendedores e técnicos × meta', dg.gerente.equipe);
  verifica(Array.isArray(dg.gerente.avisos) && Array.isArray(dg.gerente.caixinhas.lista), 'avisos e caixinhas');
  const proibidasG = chavesProibidas(dg, ['lucro', 'margem', 'dre']);
  verifica(proibidasG.length === 0, 'gerente NÃO recebe lucro/margem/DRE', proibidasG);
  const alertaLoja = dg.alertas.find((a: any) => a.id === 'venda-sem-vendedor' || a.id === 'os-sem-tecnico' || a.id === 'venda-sem-custo');
  verifica(Array.isArray(dg.alertas) && (alertaLoja === undefined || alertaLoja.botao), 'alertas da loja inteira com botão', dg.alertas.map((a: any) => a.id));

  secao('"Ver como": gerente abre o do vendedor/técnico, não o do gestor; gestor abre o da gerente');
  const vc: any = await G.get(`/meu-dashboard?usuarioId=${uVend.id}`);
  verifica(vc.verComo === true && vc.usuario.id === uVend.id && vc.vendas && chavesProibidas(vc).length === 0, 'gerente vê o dashboard do vendedor como ele vê (sem custo/lucro)', Object.keys(vc));
  const vct: any = await G.get(`/meu-dashboard?usuarioId=${uTec.id}`);
  verifica(vct.verComo === true && vct.assistencia && vct.vendas, 'gerente vê o do técnico', Object.keys(vct));
  await G.get('/meu-dashboard?usuarioId=1', 403);
  const vcg: any = await adm.get(`/meu-dashboard?usuarioId=${uGer.id}`);
  verifica(vcg.verComo === true && vcg.gerente, 'gestor vê o da gerente', Object.keys(vcg));
  const eq: any = await adm.get('/meu-dashboard/equipe');
  verifica(eq.some((u: any) => u.id === uVend.id) && eq.some((u: any) => u.id === uTec.id) && eq.some((u: any) => u.id === uGer.id), 'equipe para o "ver como"', eq.length);
  const eqG: any = await G.get('/meu-dashboard/equipe');
  verifica(!eqG.some((u: any) => u.perfil === 'ADMIN'), 'a gerente não lista o gestor', eqG.map((u: any) => u.perfil));

  secao('Filtro de período');
  const dp: any = await V.get('/meu-dashboard?dataInicial=2020-01-01&dataFinal=2020-01-31');
  verifica(dp.vendas.periodo.faturamento === 0 && dp.periodo.agrupar === 'dia', 'período sem vendas devolve zero', dp.vendas.periodo);

  secao('"Todo o período" (desde sempre): começa no primeiro registro e não compara com o período anterior');
  const dt_: any = await V.get(`/meu-dashboard?dataInicial=2000-01-01&dataFinal=${hoje()}`);
  verifica(dt_.periodo.tudo === true && new Date(dt_.periodo.dataInicial).getFullYear() >= 2020, 'início recuado até o primeiro registro (não 2000)', dt_.periodo);
  verifica(dt_.vendas.periodo.anterior === null && dt_.vendas.periodo.faturamento >= 2500, 'sem "período anterior"; soma tudo', dt_.vendas.periodo);
  const pan: any = await adm.get(`/dashboard/panorama?dataInicial=2000-01-01&dataFinal=${hoje()}`);
  verifica(pan.resumo.comparativo === null && pan.series.length > 0 && pan.series.length < 400, 'panorama do gestor: sem comparativo e série do tamanho certo', { comparativo: pan.resumo.comparativo, series: pan.series.length });
  const dv_: any = await adm.get(`/dashboard/vendas?dataInicial=2000-01-01&dataFinal=${hoje()}&comparar=true`);
  verifica(!dv_.resumo.comparativo && dv_.resumo.faturamento >= 2500, 'dashboard de vendas: sem comparativo, soma tudo', dv_.resumo.faturamento);

  encerrar('Meu Dashboard');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
