/**
 * TESTES DA API EXTERNA (chaves de API, permissões, MCP para agentes de IA e webhooks de saída).
 *   npx tsx testes/api-externa.ts <url da API>
 *
 * Confere: só o ADMIN mexe nas chaves; a chave lê/grava só o que foi liberado; rotas de administração
 * nunca abrem para chave; chave inválida/desativada/vencida/IP errado/na URL sem permissão é barrada;
 * limite por minuto; regenerar mata a chave antiga; OpenAPI e MCP só mostram o permitido; webhook chega
 * assinado quando uma venda é criada pela própria chave; registro de chamadas.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BASE, SUF, aguardar, encerrar, entrar, hoje, secao, verifica } from './lib.js';

async function comChave(chave: string, metodo: string, rota: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { 'x-api-key': chave, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
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

async function mcp(url: string, cabecalhos: Record<string, string>, corpo: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cabecalhos }, body: JSON.stringify(corpo) });
  const texto = await r.text();
  return { status: r.status, json: texto ? JSON.parse(texto) : null };
}

async function main() {
  const admin = await entrar('admin@balao.info', 'admin123');

  // ---------------------------------------------------------------- só o ADMIN
  secao('Só o ADMIN configura a API');
  await admin.post('/usuarios', { nome: 'Gerente API', email: `gerente-api-${SUF}@teste.com`, senha: 'Senha@12345', perfil: 'GERENTE' }, [201, 409]);
  const gerente = await entrar(`gerente-api-${SUF}@teste.com`, 'Senha@12345');
  await gerente.get('/api-externa/chaves', 403);
  await gerente.post('/api-externa/chaves', { nome: 'x', permissoes: { vendas: 'LEITURA' } }, 403);
  await gerente.get('/api-externa/webhooks', 403);
  const recursos = await admin.get('/api-externa/recursos');
  verifica(recursos?.recursos?.length >= 10 && recursos?.endpoints?.length > 30, 'catálogo de recursos e endpoints para a tela', recursos?.recursos?.length);
  await admin.post('/api-externa/chaves', { nome: 'Sem nada', permissoes: {} }, 422);
  await admin.post('/api-externa/chaves', { nome: 'IP errado', permissoes: { vendas: 'LEITURA' }, ipsPermitidos: 'nao-e-ip' }, 400);

  // ---------------------------------------------------------------- chave com permissões
  secao('Chave lê e grava só o que foi liberado');
  const criada = await admin.post(
    '/api-externa/chaves',
    { nome: `Agente de vendas ${SUF}`, permissoes: { clientes: 'LEITURA', produtos: 'LEITURA', vendas: 'GRAVACAO', cadastros: 'LEITURA', relatorios: 'TOTAL', inexistente: 'TOTAL' } },
    201,
  );
  const chave: string = criada?.chave;
  verifica(/^mb_[0-9a-f]{48}$/.test(chave || ''), 'chave criada no formato mb_ + 48 caracteres (mostrada uma vez)', chave);
  verifica(criada?.permissoes?.relatorios === 'LEITURA' && !criada?.permissoes?.inexistente, 'relatórios ficam só leitura e recurso desconhecido é descartado', criada?.permissoes);
  const lista = await admin.get('/api-externa/chaves');
  verifica(Array.isArray(lista) && !JSON.stringify(lista).includes(chave) && !JSON.stringify(lista).includes('"hash"'), 'a lista nunca devolve a chave nem o hash');

  verifica((await comChave(chave, 'GET', '/contatos?limite=2')).status === 200, 'leitura liberada: GET /contatos → 200');
  const neg = await comChave(chave, 'POST', '/contatos', { nome: 'Não pode' });
  verifica(neg.status === 403 && neg.json?.code === 'CHAVE_SEM_PERMISSAO', 'gravação não liberada: POST /contatos → 403 CHAVE_SEM_PERMISSAO', neg);
  verifica((await comChave(chave, 'GET', '/contas-receber')).status === 403, 'área não liberada: GET /contas-receber → 403');
  for (const rota of ['/usuarios', '/api-externa/chaves', '/empresa/certificado', '/configuracoes', '/bling/status', '/auditoria', '/diagnostico', '/auth/eu']) {
    verifica((await comChave(chave, 'GET', rota)).status === 403, `rota de administração nunca abre para chave: GET ${rota} → 403`);
  }
  verifica((await comChave(chave, 'PUT', '/empresa', { nomeFantasia: 'x' })).status === 403, 'chave não altera a empresa');
  verifica((await comChave(chave, 'GET', '/empresa')).status === 200, 'chave com cadastros lê os dados da empresa');

  // Bearer também vale
  const rb = await fetch(BASE + '/produtos?limite=1', { headers: { authorization: `Bearer ${chave}` } });
  verifica(rb.status === 200, 'chave aceita no Authorization: Bearer');
  verifica((await comChave('mb_' + '0'.repeat(48), 'GET', '/contatos')).status === 401, 'chave inexistente → 401');
  verifica((await comChave('qualquer-coisa', 'GET', '/contatos')).status === 401, 'chave mal formada → 401');

  // gravação: cria uma venda com a chave
  const cli = await comChave(chave, 'GET', '/contatos?tipo=CLIENTE&limite=1');
  const prod = await comChave(chave, 'GET', '/produtos?limite=1&ativo=true');
  const contatoId = cli.json?.data?.[0]?.id;
  const produtoId = prod.json?.data?.[0]?.id;
  verifica(contatoId && produtoId, 'achou cliente e produto pela chave', { contatoId, produtoId });

  // ---------------------------------------------------------------- webhook recebendo
  secao('Webhook de saída assinado');
  const recebidos: { evento: string; corpo: string; assinatura: string }[] = [];
  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      recebidos.push({ evento: String(req.headers['x-meubling-evento']), corpo, assinatura: String(req.headers['x-meubling-assinatura']) });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const porta = (servidor.address() as AddressInfo).port;
  const wh = await admin.post('/api-externa/webhooks', { nome: `Teste ${SUF}`, url: `http://127.0.0.1:${porta}/receber`, eventos: ['venda.criada', 'nao-existe'] }, 201);
  verifica(String(wh?.segredo || '').startsWith('whsec_') && wh?.eventos?.join() === 'venda.criada', 'webhook criado com segredo e só eventos válidos', wh);
  const teste = await admin.post(`/api-externa/webhooks/${wh.id}/testar`);
  verifica(teste?.ok === true && recebidos.some((r) => r.evento === 'teste'), 'botão "testar" entrega o evento teste', teste);
  await admin.post('/api-externa/webhooks', { nome: 'Endereço ruim', url: 'ftp://x' }, 400);
  const morto = await admin.post('/api-externa/webhooks', { nome: `Fora do ar ${SUF}`, url: 'http://127.0.0.1:9/nada', eventos: ['os.criada'] }, 201);
  const tm = await admin.post(`/api-externa/webhooks/${morto.id}/testar`);
  verifica(tm?.ok === false && /Falha/.test(tm?.resposta || ''), 'endereço fora do ar: teste mostra a falha sem quebrar', tm);
  await admin.del(`/api-externa/webhooks/${morto.id}`);

  const venda = await comChave(chave, 'POST', '/vendas', { contatoId, data: hoje(), itens: [{ produtoId, quantidade: 1, valorUnitario: 10 }] });
  verifica(venda.status === 201 && venda.json?.id, 'chave com gravação em vendas cria pedido (201)', venda.status);
  const chegou = await aguardar(async () => recebidos.find((r) => r.evento === 'venda.criada'), (v) => !!v, 8000);
  verifica(!!chegou, 'webhook venda.criada chegou ao sistema de fora');
  if (chegou) {
    const esperado = 'sha256=' + crypto.createHmac('sha256', wh.segredo).update(chegou.corpo).digest('hex');
    verifica(chegou.assinatura === esperado, 'assinatura HMAC confere com o segredo');
    const corpo = JSON.parse(chegou.corpo);
    verifica(corpo?.dados?.vendaId === venda.json.id && corpo?.dados?.venda?.numero && corpo?.dados?.recurso === `/vendas/${venda.json.id}`, 'evento traz a venda resumida e o caminho na API', corpo?.dados);
  }
  const entregas = await admin.get(`/api-externa/webhooks/${wh.id}/entregas`);
  verifica(Array.isArray(entregas) && entregas.some((e: any) => e.evento === 'venda.criada' && e.status === 'ENTREGUE'), 'entrega registrada como ENTREGUE');
  verifica((await comChave(chave, 'DELETE', `/vendas/${venda.json?.id}`)).status === 403, 'excluir exige nível total → 403');
  const aud = await admin.get(`/auditoria?entidade=Venda&entidadeId=${venda.json?.id}`);
  verifica(JSON.stringify(aud).includes('API: Agente de vendas'), 'auditoria marca que a venda veio pela API', JSON.stringify(aud).slice(0, 200));
  servidor.close();
  await admin.put(`/api-externa/webhooks/${wh.id}`, { ativo: false });

  // ---------------------------------------------------------------- documentação e "quem sou eu"
  secao('Documentação para quem chama');
  const eu = await comChave(chave, 'GET', '/externo/eu');
  verifica(eu.status === 200 && eu.json?.chave?.nome?.startsWith('Agente de vendas') && eu.json?.permissoes?.some((p: any) => p.recurso === 'vendas' && p.nivel === 'GRAVACAO'), '/externo/eu mostra a chave e as permissões', eu.json);
  const oa = await comChave(chave, 'GET', '/externo/openapi.json');
  const caminhos = Object.keys(oa.json?.paths || {});
  verifica(oa.json?.openapi === '3.1.0' && caminhos.includes('/vendas') && !caminhos.includes('/contas-receber'), 'OpenAPI só com o que a chave pode', caminhos.length);
  verifica(!oa.json?.paths?.['/contatos']?.post, 'OpenAPI não mostra gravação de contatos (só leitura liberada)');

  // ---------------------------------------------------------------- MCP
  secao('Servidor MCP para agentes de IA');
  const urlMcp = BASE + '/mcp';
  const ini = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } });
  verifica(ini.status === 200 && ini.json?.result?.serverInfo?.name === 'meu-bling' && ini.json?.result?.protocolVersion === '2025-06-18', 'initialize responde', ini.json);
  const notif = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', method: 'notifications/initialized' });
  verifica(notif.status === 202, 'notificação → 202 sem corpo', notif.status);
  const tl = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const nomes: string[] = (tl.json?.result?.tools || []).map((t: any) => t.name);
  verifica(nomes.includes('buscar_clientes') && nomes.includes('ver_venda') && nomes.includes('gravar') && !nomes.includes('resumo_financeiro') && !nomes.includes('enviar_whatsapp') && !nomes.includes('excluir'), 'tools/list só com as ferramentas permitidas', nomes);
  const bc = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'buscar_produtos', arguments: { pesquisa: 'a' } } });
  verifica(bc.json?.result?.isError !== true && /"data"/.test(bc.json?.result?.content?.[0]?.text || ''), 'tools/call buscar_produtos devolve dados', bc.json);
  const proibido = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'consultar', arguments: { caminho: '/contas-receber' } } });
  verifica(proibido.json?.result?.isError === true && /403/.test(proibido.json?.result?.content?.[0]?.text || ''), 'consultar área não liberada volta erro 403 para o agente', proibido.json);
  const fora = await mcp(urlMcp, { 'x-api-key': chave }, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'consultar', arguments: { caminho: '/mcp' } } });
  verifica(fora.json?.result?.isError === true, 'caminho inválido (recursão no /mcp) é recusado');
  const lote = await mcp(urlMcp, { 'x-api-key': chave }, [{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', id: 7, method: 'nao/existe' }]);
  verifica(Array.isArray(lote.json) && lote.json[0]?.result && lote.json[1]?.error?.code === -32601, 'lote JSON-RPC e método desconhecido', lote.json);
  verifica((await mcp(urlMcp, {}, { jsonrpc: '2.0', id: 1, method: 'ping' })).status === 401, 'MCP sem chave → 401');
  verifica((await mcp(`${urlMcp}/${chave}`, {}, { jsonrpc: '2.0', id: 1, method: 'ping' })).status === 401, 'chave na URL sem "permitir na URL" → 401');
  await admin.put(`/api-externa/chaves/${criada.id}`, { permitirNaUrl: true });
  const naUrl = await mcp(`${urlMcp}/${chave}`, {}, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  verifica(naUrl.status === 200 && naUrl.json?.result?.tools?.length > 3, 'com "permitir na URL" o MCP funciona pela URL');

  // ---------------------------------------------------------------- registro de chamadas
  secao('Registro de chamadas');
  const logs = await aguardar(() => admin.get(`/api-externa/logs?chaveId=${criada.id}&limite=200`), (l: any) => l?.meta?.total > 10, 4000);
  verifica(logs?.data?.some((l: any) => l.status === 403 && /permissão/.test(l.erro || '')), 'chamadas negadas ficam registradas com o motivo');
  verifica(logs?.data?.some((l: any) => l.origem === 'MCP' && l.rota.startsWith('/produtos')), 'chamadas do agente (MCP) registradas como MCP');
  verifica(!JSON.stringify(logs).includes(chave), 'a chave não aparece no registro (nem a da URL)');
  const resumo = await admin.get('/api-externa/resumo');
  verifica(resumo?.chamadas24h > 0 && /\/api\/v1\/mcp$/.test(resumo?.urlMcp || ''), 'resumo com chamadas e endereço do MCP', resumo);

  // ---------------------------------------------------------------- bloqueios
  secao('Desativar, vencer, IP, limite e regenerar');
  await admin.put(`/api-externa/chaves/${criada.id}`, { ativo: false });
  verifica((await comChave(chave, 'GET', '/contatos')).json?.code === 'CHAVE_INATIVA', 'chave desativada → 401 na hora');
  await admin.put(`/api-externa/chaves/${criada.id}`, { ativo: true, expiraEm: '2020-01-01' });
  verifica((await comChave(chave, 'GET', '/contatos')).json?.code === 'CHAVE_VENCIDA', 'chave vencida → 401');
  await admin.put(`/api-externa/chaves/${criada.id}`, { expiraEm: null, ipsPermitidos: '10.9.9.9' });
  verifica((await comChave(chave, 'GET', '/contatos')).json?.code === 'IP_NAO_PERMITIDO', 'IP fora da lista → 403');
  await admin.put(`/api-externa/chaves/${criada.id}`, { ipsPermitidos: '' });
  verifica((await comChave(chave, 'GET', '/contatos')).status === 200, 'sem lista de IP volta a funcionar');

  const lenta = await admin.post('/api-externa/chaves', { nome: `Limitada ${SUF}`, permissoes: { produtos: 'LEITURA' }, limitePorMinuto: 3 }, 201);
  const sts: number[] = [];
  for (let i = 0; i < 6; i++) sts.push((await comChave(lenta.chave, 'GET', '/produtos?limite=1')).status);
  verifica(sts.includes(429) && sts[0] === 200, 'limite por minuto da chave → 429', sts);
  await admin.del(`/api-externa/chaves/${lenta.id}`);
  verifica((await comChave(lenta.chave, 'GET', '/produtos')).status === 401, 'chave excluída → 401');

  const nova = await admin.post(`/api-externa/chaves/${criada.id}/regenerar`);
  verifica(nova?.chave && nova.chave !== chave, 'regenerar devolve outra chave');
  verifica((await comChave(chave, 'GET', '/contatos')).status === 401, 'a chave antiga para de funcionar');
  verifica((await comChave(nova.chave, 'GET', '/contatos')).status === 200, 'a nova funciona com as mesmas permissões');
  await admin.del(`/api-externa/chaves/${criada.id}`);
  await admin.del(`/api-externa/webhooks/${wh.id}`);

  encerrar('API externa');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
