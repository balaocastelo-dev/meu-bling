/**
 * Lançamentos automáticos (e-mail de banco) — fila de revisão.
 * Pendente não mexe no saldo nem dá baixa. Confio lança o movimento. Contestar não.
 * O mesmo ID de e-mail não duplica. Escopo próprio: lancamentos-automaticos.
 *   npx tsx testes/lancamentos-automaticos.ts http://localhost:3333
 */
import { BASE, SUF, encerrar, entrar, falhar, hoje, igual, secao, verifica } from './lib.js';

async function comChave(chave: string, metodo: string, rota: string, body?: unknown) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'x-api-key': chave, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json: any = texto;
  try {
    json = JSON.parse(texto);
  } catch {
    /* texto */
  }
  return { status: r.status, json };
}

async function mcp(chave: string, nome: string, arguments_: Record<string, unknown>) {
  const r = await fetch(BASE + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': chave },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nome, arguments: arguments_ } }),
  });
  const json: any = await r.json();
  const texto = json?.result?.content?.[0]?.text ?? '';
  return { status: r.status, json, texto, erro: !!json?.result?.isError };
}

function saldoDe(conta: any) {
  return Number(conta?.saldoAtual);
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  const eu: any = await adm.get('/auth/eu');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend Rev ${SUF}`, email: `vrev${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  await adm.post('/usuarios', { nome: `Fin Rev ${SUF}`, email: `frev${SUF}@teste.com`, senha, perfil: 'FINANCEIRO' }, [201, 409]);
  await adm.post('/usuarios', { nome: `Ger Rev ${SUF}`, email: `grev${SUF}@teste.com`, senha, perfil: 'GERENTE' }, [201, 409]);
  const vend = await entrar(`vrev${SUF}@teste.com`, senha);
  const fin = await entrar(`frev${SUF}@teste.com`, senha);
  const ger = await entrar(`grev${SUF}@teste.com`, senha);

  secao('Só o ADMIN revisa; o bot usa a chave');
  await vend.get('/lancamentos-automaticos', 403);
  await fin.get('/lancamentos-automaticos', 403);
  await ger.get('/lancamentos-automaticos', 403);
  await adm.post('/lancamentos-automaticos', { tipo: 'SAIDA', data: hoje(), valor: 10, contaFinanceiraId: 1, contraparte: 'Xis', emailOrigemId: `sessao-${SUF}` }, 403);

  const conta: any = await adm.post('/contas-financeiras', { nome: `Banco revisão ${SUF}`, tipo: 'BANCO', saldoInicial: 5000 }, 201);
  verifica(igual(saldoDe(conta), 5000), 'conta de teste começa com R$ 5.000', saldoDe(conta));
  const saldo0 = saldoDe(conta);

  const soFinanceiro: any = await adm.post('/api-externa/chaves', { nome: `Só financeiro ${SUF}`, permissoes: { financeiro: 'TOTAL' } }, 201);
  const leitura: any = await adm.post('/api-externa/chaves', { nome: `Leitura revisão ${SUF}`, permissoes: { 'lancamentos-automaticos': 'LEITURA' } }, 201);
  const bot: any = await adm.post('/api-externa/chaves', { nome: `Bot bancos ${SUF}`, permissoes: { 'lancamentos-automaticos': 'GRAVACAO' } }, 201);
  verifica(bot?.permissoes?.['lancamentos-automaticos'] === 'GRAVACAO' && !bot?.permissoes?.financeiro, 'escopo próprio, sem financeiro', bot?.permissoes);

  const corpoBase = {
    tipo: 'SAIDA' as const,
    data: hoje(),
    valor: 1500.5,
    contaFinanceiraId: conta.id,
    contraparte: `Fornecedor Inédito ${SUF}`,
    emailOrigemId: `mail-${SUF}-alto`,
    emailOrigemUrl: 'https://mail.google.com/mail/u/0/#inbox/abc',
    descricao: 'PIX enviado',
  };

  verifica((await comChave(soFinanceiro.chave, 'POST', '/lancamentos-automaticos', corpoBase)).status === 403, 'escopo financeiro não cria lançamento automático');
  verifica((await comChave(leitura.chave, 'POST', '/lancamentos-automaticos', corpoBase)).status === 403, 'leitura não cria');
  verifica((await comChave(leitura.chave, 'GET', '/lancamentos-automaticos?status=PENDENTE')).status === 200, 'leitura lista');
  verifica((await comChave(bot.chave, 'GET', '/contas-pagar')).status === 403, 'esta chave não baixa nem lista contas a pagar');
  verifica((await comChave(bot.chave, 'POST', '/lancamentos-automaticos/1/confiar', {})).status === 403, 'chave não confia');
  verifica((await comChave(bot.chave, 'POST', '/lancamentos-automaticos/1/contestar', { observacao: 'não' })).status === 403, 'chave não contesta');
  verifica((await comChave(bot.chave, 'PUT', '/lancamentos-automaticos/config', { limiteValorAlto: 1 })).status === 403, 'chave não muda o limite');

  secao('Criar pendente, sem saldo e sem duplicar');
  const antes: any = await adm.get('/lancamentos-automaticos/resumo');
  const criado = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', corpoBase);
  verifica(criado.status === 201 && criado.json?.idempotente === false && criado.json?.lancamento?.status === 'PENDENTE', 'nasce pendente', criado.json);
  const id = criado.json?.lancamento?.id;
  verifica(criado.json?.lancamento?.botNome === `Bot bancos ${SUF}`, 'o bot gravado é o nome da chave', criado.json?.lancamento?.botNome);
  verifica(criado.json?.lancamento?.valorAlto === true && criado.json?.lancamento?.contraparteNova === true, 'valor alto e pagador novo', criado.json?.lancamento);
  verifica(criado.json?.lancamento?.movimentoId == null, 'pendente não tem movimento');
  const conta1: any = await adm.get(`/contas-financeiras/${conta.id}`);
  verifica(igual(saldoDe(conta1), saldo0), 'pendente não altera o saldo', saldoDe(conta1));
  const depois: any = await adm.get('/lancamentos-automaticos/resumo');
  verifica(depois.pendentes === antes.pendentes + 1, 'contador de pendentes sobe 1', { antes: antes.pendentes, depois: depois.pendentes });

  const dup = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', { ...corpoBase, valor: 1, contraparte: 'Outro nome' });
  verifica(dup.status === 200 && dup.json?.idempotente === true && dup.json?.lancamento?.id === id && igual(dup.json?.lancamento?.valor, 1500.5), 'mesmo e-mail não duplica e não troca o valor', dup.json);
  const ainda: any = await adm.get('/lancamentos-automaticos/resumo');
  verifica(ainda.pendentes === depois.pendentes, 'repetir o e-mail não aumenta a fila', ainda.pendentes);

  const lista = await comChave(bot.chave, 'GET', `/lancamentos-automaticos?status=PENDENTE&contaFinanceiraId=${conta.id}`);
  verifica(lista.status === 200 && lista.json?.data?.some((l: any) => l.id === id), 'GET por status acha o pendente');
  const soConfiados = await comChave(bot.chave, 'GET', `/lancamentos-automaticos?status=CONFIADO&contaFinanceiraId=${conta.id}`);
  verifica(soConfiados.status === 200 && !soConfiados.json?.data?.some((l: any) => l.id === id), 'filtro confiado ainda não traz este');

  const baixo = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    ...corpoBase,
    valor: 10,
    emailOrigemId: `mail-${SUF}-baixo`,
    contraparte: `Fornecedor Inédito ${SUF}`,
  });
  verifica(baixo.status === 201 && baixo.json?.lancamento?.valorAlto === false && baixo.json?.lancamento?.contraparteNova === true, 'abaixo do limite não é valor alto; o nome segue novo até um Confio', baixo.json?.lancamento);

  secao('Contato conhecido, categoria e período');
  await adm.post('/contatos', { nome: `João da Silva ${SUF}`, tipo: 'FORNECEDOR' }, 201);
  const conhecido = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    ...corpoBase,
    valor: 40,
    emailOrigemId: `mail-${SUF}-joao`,
    contraparte: `joao da silva ${SUF}`,
  });
  verifica(conhecido.status === 201 && conhecido.json?.lancamento?.contraparteNova === false, 'nome igual a um contato (sem acento) não é novo', conhecido.json?.lancamento);

  const despesa: any = await adm.post('/categorias-financeiras', { nome: `Despesa revisão ${SUF}`, tipo: 'DESPESA' }, 201);
  const tipoErrado = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    ...corpoBase,
    tipo: 'ENTRADA',
    valor: 30,
    emailOrigemId: `mail-${SUF}-cat`,
    categoriaId: despesa.id,
    contraparte: `Cliente ${SUF}`,
  });
  verifica(tipoErrado.status === 422 && tipoErrado.json?.code === 'CATEGORIA_TIPO', 'entrada não aceita categoria de despesa', tipoErrado.json);
  const urlRuim = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', { ...corpoBase, emailOrigemId: `mail-${SUF}-url`, emailOrigemUrl: 'javascript:alert(1)' });
  verifica(urlRuim.status === 400, 'link do e-mail tem que ser http(s)', urlRuim.status);
  verifica((await comChave(bot.chave, 'POST', '/lancamentos-automaticos', { ...corpoBase, emailOrigemId: `mail-${SUF}-conta`, contaFinanceiraId: 999999 })).status === 404, 'conta inexistente → 404');

  const antigo = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    ...corpoBase,
    data: '2020-01-15',
    valor: 12,
    emailOrigemId: `mail-${SUF}-2020`,
    contraparte: `Arquivo ${SUF}`,
  });
  const noPeriodo = await comChave(bot.chave, 'GET', `/lancamentos-automaticos?status=PENDENTE&contaFinanceiraId=${conta.id}&dataInicial=2020-01-01&dataFinal=2020-01-31`);
  const fora = await comChave(bot.chave, 'GET', `/lancamentos-automaticos?status=PENDENTE&contaFinanceiraId=${conta.id}&dataInicial=2020-02-01&dataFinal=2020-02-28`);
  verifica(noPeriodo.json?.data?.some((l: any) => l.id === antigo.json?.lancamento?.id), 'filtro de período inclui a data');
  verifica(!fora.json?.data?.some((l: any) => l.id === antigo.json?.lancamento?.id), 'filtro de período exclui o que está fora');

  secao('Confio mexe no saldo e não dá baixa; contestar não mexe');
  const titulo: any = await adm.post('/contas-pagar', { descricao: `Boleto revisão ${SUF}`, valor: 80, vencimento: hoje() }, 201);
  const filaAntes: any = await adm.get('/lancamentos-automaticos/resumo');
  const aceito: any = await adm.post(`/lancamentos-automaticos/${id}/confiar`, {});
  verifica(aceito?.status === 'CONFIADO' && aceito?.confiadoPor?.id === eu.id && !!aceito?.confiadoEm && !!aceito?.movimentoId, 'Confio grava quem, quando e o movimento', aceito);
  const conta2: any = await adm.get(`/contas-financeiras/${conta.id}`);
  verifica(igual(saldoDe(conta2), saldo0 - 1500.5), 'saída aceita diminui o saldo', saldoDe(conta2));
  const tituloDepois: any = await adm.get(`/contas-pagar/${titulo.id}`);
  verifica(tituloDepois?.situacao === 'ABERTO' && igual(tituloDepois?.valorPago || 0, 0), 'Confio não dá baixa na conta a pagar', tituloDepois);
  const movs: any = await adm.get(`/financeiro/movimentos?contaFinanceiraId=${conta.id}&limite=50`);
  verifica(movs?.data?.some((m: any) => m.id === aceito.movimentoId && m.contaPagarId == null && m.contaReceberId == null), 'o movimento não está ligado a um título', movs?.data);

  const repetido = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    ...corpoBase,
    valor: 20,
    emailOrigemId: `mail-${SUF}-repetido`,
  });
  verifica(repetido.json?.lancamento?.contraparteNova === false, 'depois do Confio o mesmo nome deixa de ser novo', repetido.json?.lancamento);
  const filaDepois: any = await adm.get('/lancamentos-automaticos/resumo');
  verifica(filaDepois.pendentes === filaAntes.pendentes - 1 + 1, 'Confio tira um da fila e o lançamento seguinte entra pendente', { antes: filaAntes.pendentes, depois: filaDepois.pendentes });

  await adm.post(`/lancamentos-automaticos/${baixo.json.lancamento.id}/contestar`, {}, 400);
  await adm.post(`/lancamentos-automaticos/${baixo.json.lancamento.id}/contestar`, { observacao: 'x' }, 400);
  const contestado: any = await adm.post(`/lancamentos-automaticos/${baixo.json.lancamento.id}/contestar`, { observacao: 'Valor não bate com o extrato.' });
  verifica(contestado?.status === 'CONTESTADO' && contestado?.contestadoPor?.id === eu.id && !!contestado?.contestadoEm && contestado?.observacaoContestacao === 'Valor não bate com o extrato.', 'Contestar grava quem, quando e a observação', contestado);
  const conta3: any = await adm.get(`/contas-financeiras/${conta.id}`);
  verifica(igual(saldoDe(conta3), saldo0 - 1500.5), 'contestado não mexe no saldo', saldoDe(conta3));
  await adm.post(`/lancamentos-automaticos/${baixo.json.lancamento.id}/confiar`, {}, 409);
  await adm.post(`/lancamentos-automaticos/${id}/contestar`, { observacao: 'tarde demais' }, 409);

  const entrada = await comChave(bot.chave, 'POST', '/lancamentos-automaticos', {
    tipo: 'ENTRADA',
    data: hoje(),
    valor: 25,
    contaFinanceiraId: conta.id,
    contraparte: `Cliente Pix ${SUF}`,
    emailOrigemId: `mail-${SUF}-entrada`,
  });
  const aceitaEntrada: any = await adm.post(`/lancamentos-automaticos/${entrada.json.lancamento.id}/confiar`, {});
  const conta4: any = await adm.get(`/contas-financeiras/${conta.id}`);
  verifica(igual(saldoDe(conta4), saldo0 - 1500.5 + 25), 'entrada aceita aumenta o saldo', saldoDe(conta4));
  verifica(aceitaEntrada?.tipo === 'ENTRADA' && aceitaEntrada?.status === 'CONFIADO', 'entrada ficou confiada');

  secao('Limite, dashboard e listar_endpoints');
  await adm.put('/lancamentos-automaticos/config', { limiteValorAlto: 15 });
  const comLimite: any = await adm.get(`/lancamentos-automaticos?status=PENDENTE&contaFinanceiraId=${conta.id}&limite=50`);
  const deVinte = comLimite?.data?.find((l: any) => l.emailOrigemId === `mail-${SUF}-repetido`);
  const deDoze = comLimite?.data?.find((l: any) => l.emailOrigemId === `mail-${SUF}-2020`);
  verifica(deVinte?.valorAlto === true && deDoze?.valorAlto === false, 'o limite configurável passa a valer na lista', { vinte: deVinte?.valorAlto, doze: deDoze?.valorAlto });
  const todos: any = await adm.get(`/lancamentos-automaticos?contaFinanceiraId=${conta.id}&limite=50`);
  const temPendente = todos?.data?.some((l: any) => l.status === 'PENDENTE');
  const temConfiado = todos?.data?.some((l: any) => l.status === 'CONFIADO');
  const temContestado = todos?.data?.some((l: any) => l.status === 'CONTESTADO');
  verifica(temPendente && temConfiado && temContestado, 'sem filtro de status vêm os três', { temPendente, temConfiado, temContestado });

  const dash: any = await adm.get('/dashboard/geral');
  const resumoAgora: any = await adm.get('/lancamentos-automaticos/resumo');
  verifica(dash?.lancamentosAutomaticos?.pendentes === resumoAgora.pendentes && dash.lancamentosAutomaticos.pendentes > 0, 'o dashboard conta os pendentes', dash?.lancamentosAutomaticos);
  verifica(dash?.alertas?.some((a: any) => a.link === '/financeiro/lancamentos-automaticos'), 'o alerta do dashboard aponta para a tela', dash?.alertas);

  const catalogo = await mcp(bot.chave, 'listar_endpoints', { recurso: 'lancamentos-automaticos' });
  let endpoints: any[] = [];
  try {
    endpoints = JSON.parse(catalogo.texto);
  } catch {
    falhar('listar_endpoints não devolveu JSON: ' + catalogo.texto.slice(0, 200));
  }
  const post = endpoints.find((e) => e.metodo === 'POST' && e.caminho === '/lancamentos-automaticos');
  const get = endpoints.find((e) => e.metodo === 'GET' && e.caminho === '/lancamentos-automaticos');
  verifica(!!post && post.corpo?.emailOrigemId && post.corpo?.contaFinanceiraId && /PENDENTE|saldo/i.test(post.resumo), 'listar_endpoints traz o POST com exemplo de corpo', post);
  verifica(!!get && (get.filtros || []).some((f: string) => f.includes('PENDENTE')), 'listar_endpoints traz o GET com filtro de status', get);
  const doFinanceiro = await mcp(soFinanceiro.chave, 'listar_endpoints', { recurso: 'lancamentos-automaticos' });
  let vazio: any[] = [];
  try {
    vazio = JSON.parse(doFinanceiro.texto);
  } catch {
    vazio = [];
  }
  verifica(Array.isArray(vazio) && vazio.length === 0, 'chave sem o escopo não vê a rota no listar_endpoints', vazio);

  const viaGravar = await mcp(bot.chave, 'gravar', {
    metodo: 'POST',
    caminho: '/lancamentos-automaticos',
    corpo: {
      tipo: 'SAIDA',
      data: hoje(),
      valor: 8,
      contaFinanceiraId: conta.id,
      contraparte: `Via gravar ${SUF}`,
      emailOrigemId: `mail-${SUF}-mcp`,
    },
  });
  verifica(!viaGravar.erro && viaGravar.texto.includes('PENDENTE') && viaGravar.texto.includes(`mail-${SUF}-mcp`), 'gravar cria pendente pelo MCP', viaGravar.texto.slice(0, 300));
  const viaConsultar = await mcp(bot.chave, 'consultar', { caminho: `/lancamentos-automaticos?status=PENDENTE&contaFinanceiraId=${conta.id}&limite=50` });
  verifica(!viaConsultar.erro && viaConsultar.texto.includes(`mail-${SUF}-mcp`), 'consultar lista o que o gravar criou');

  const contaFim: any = await adm.get(`/contas-financeiras/${conta.id}`);
  verifica(igual(saldoDe(contaFim), saldo0 - 1500.5 + 25), 'o que ficou pendente ou contestado, inclusive o do MCP, não mexeu mais no saldo', saldoDe(contaFim));

  encerrar('Lançamentos automáticos');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
