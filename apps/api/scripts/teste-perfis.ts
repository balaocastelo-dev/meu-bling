/**
 * Testa a política de acesso por perfil contra a API no ar.
 *   npx tsx scripts/teste-perfis.ts [http://localhost:3333]
 */
const BASE = (process.argv[2] || 'http://localhost:3333');
const API = BASE + '/api/v1';
let falhas = 0, ok = 0;

async function chamar(token: string | null, metodo: string, rota: string, body?: unknown) {
  const r = await fetch(API + rota, { method: metodo, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return r.status;
}
async function esperar(token: string | null, metodo: string, rota: string, esperado: number[], body?: unknown, rotulo = '') {
  const s = await chamar(token, metodo, rota, body);
  if (esperado.includes(s)) ok++; else { falhas++; console.log(`  ✖ ${rotulo} ${metodo} ${rota} → ${s} (esperado ${esperado.join('/')})`); }
}
async function login(email: string, senha: string) {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  const j: any = await r.json();
  return j.token as string;
}

async function main() {
  const admin = await login('admin@balao.info', 'admin123');
  // cria um vendedor para vincular ao usuário VENDEDOR
  const vr = await fetch(API + '/vendedores', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` }, body: JSON.stringify({ nome: 'Vendedor Teste Perfil', comissaoPadraoPct: 3 }) });
  const vendedorNovo: any = await vr.json();
  // cria usuários de cada perfil
  for (const [email, perfil] of [['gerente@teste.com', 'GERENTE'], ['vendedor@teste.com', 'VENDEDOR'], ['tecnico@teste.com', 'TECNICO'], ['financeiro@teste.com', 'FINANCEIRO']]) {
    const s = await chamar(admin, 'POST', '/usuarios', { nome: perfil, email, senha: 'Senha@12345', perfil, vendedorId: perfil === 'VENDEDOR' ? vendedorNovo.id : null });
    if (![201, 409].includes(s)) console.log('  ! criar usuário', perfil, s);
  }
  const gerente = await login('gerente@teste.com', 'Senha@12345');
  const vendedor = await login('vendedor@teste.com', 'Senha@12345');
  const tecnico = await login('tecnico@teste.com', 'Senha@12345');
  const financeiro = await login('financeiro@teste.com', 'Senha@12345');

  console.log('== GERENTE (administrativo, sem usuários/segredos)');
  await esperar(gerente, 'GET', '/usuarios', [403], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/desafios', [200], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/metas', [200], undefined, 'GERENTE');
  await esperar(gerente, 'POST', '/usuarios', [403], { nome: 'x', email: 'x@x.com', senha: 'Senha@12345', perfil: 'ADMIN' }, 'GERENTE');
  await esperar(gerente, 'DELETE', '/empresa/certificado', [403], undefined, 'GERENTE');
  await esperar(gerente, 'POST', '/situacoes', [403], { modulo: 'VENDA', nome: 'X' }, 'GERENTE');
  await esperar(gerente, 'GET', '/bling/status', [403], undefined, 'GERENTE');
  await esperar(gerente, 'POST', '/empresa/smtp/testar', [403], { para: 'a@b.com' }, 'GERENTE');
  await esperar(admin, 'GET', '/dashboard/geral', [200], undefined, 'ADMIN');
  await esperar(admin, 'GET', '/dashboard/vendas', [200], undefined, 'ADMIN');
  await esperar(gerente, 'GET', '/dashboard/geral', [403], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/dashboard/vendas', [403], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/dashboard/os', [403], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/financeiro/resumo', [200], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/relatorios/dre', [200], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/compras', [200], undefined, 'GERENTE');
  await esperar(gerente, 'GET', '/situacoes?modulo=VENDA', [200], undefined, 'GERENTE');
  await esperar(gerente, 'PUT', '/empresa', [200], { telefone: '(19) 3000-0000', cnpj: '00000000000000' }, 'GERENTE');
  const emp: any = await (await fetch(API + '/empresa', { headers: { authorization: `Bearer ${admin}` } })).json();
  if (emp.cnpj === '00000000000000') { falhas++; console.log('  ✖ GERENTE conseguiu alterar o CNPJ'); } else ok++;

  console.log('== VENDEDOR');
  await esperar(vendedor, 'GET', '/vendas', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/contatos', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/produtos', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/ordens-servico/kanban', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/dashboard/geral', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/dashboard/vendas', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/comissoes', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/contatos', [201], { nome: 'Cliente do vendedor', tipoPessoa: 'F' }, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/financeiro/resumo', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/contas-pagar', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/compras', [200], undefined, 'VENDEDOR');
  await esperar(vendedor, 'DELETE', '/compras/1', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/relatorios/dre', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/bancos/transacoes', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/produtos', [403], { nome: 'x', preco: 1 }, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/estoque/ajuste', [403], { produtoId: 1, depositoId: 1, tipo: 'ENTRADA', quantidade: 1 }, 'VENDEDOR');
  await esperar(vendedor, 'DELETE', '/vendas/1', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/usuarios', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'PUT', '/empresa', [403], { telefone: 'x' }, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/comissoes/pagar', [403], { ids: [1], contaFinanceiraId: 1 }, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/notas-fiscais/1/cancelar', [403], { justificativa: 'xxxxxxxxxxxxxxxxxxx' }, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/whatsapp/conectar', [403], undefined, 'VENDEDOR');
  // painel do vendedor: abre (200) ou pede o vínculo com o cadastro de vendedor (422); metas/desafios são da gestão
  await esperar(vendedor, 'GET', '/painel-vendedor', [200, 422], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/metas', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'GET', '/desafios', [403], undefined, 'VENDEDOR');
  await esperar(vendedor, 'POST', '/desafios', [403], { titulo: 'x' }, 'VENDEDOR');
  await esperar(vendedor, 'PUT', '/metas', [403], { competencia: '2026-10', itens: [] }, 'VENDEDOR');

  console.log('== TECNICO');
  await esperar(tecnico, 'GET', '/ordens-servico', [200], undefined, 'TECNICO');
  await esperar(tecnico, 'GET', '/vendas', [200], undefined, 'TECNICO');
  await esperar(tecnico, 'GET', '/compras', [200], undefined, 'TECNICO');
  await esperar(tecnico, 'POST', '/vendas', [400, 422], { contatoId: 1, itens: [] }, 'TECNICO');
  await esperar(tecnico, 'DELETE', '/vendas/1', [403], undefined, 'TECNICO');
  await esperar(tecnico, 'DELETE', '/ordens-servico/1', [403], undefined, 'TECNICO');
  await esperar(tecnico, 'GET', '/financeiro/resumo', [403], undefined, 'TECNICO');
  await esperar(tecnico, 'GET', '/painel-vendedor', [403], undefined, 'TECNICO');

  console.log('== FINANCEIRO');
  await esperar(financeiro, 'GET', '/financeiro/resumo', [200], undefined, 'FINANCEIRO');
  await esperar(financeiro, 'GET', '/compras', [200], undefined, 'FINANCEIRO');
  await esperar(financeiro, 'GET', '/usuarios', [403], undefined, 'FINANCEIRO');
  await esperar(financeiro, 'POST', '/situacoes', [403], { modulo: 'VENDA', nome: 'X' }, 'FINANCEIRO');

  console.log('== Arquivos (/uploads)');
  const st = async (p: string, h?: Record<string, string>) => (await fetch(BASE + p, { headers: h })).status;
  const a = await st('/uploads/whatsapp/creds.json'); if (a === 404) ok++; else { falhas++; console.log('  ✖ sessão do WhatsApp exposta', a); }
  const b = await new Promise<number>((res) => { import('node:http').then((http) => { const u = new URL(BASE); http.request({ host: u.hostname, port: u.port, path: '/uploads/%2e%2e/apps/api/.env', method: 'GET' }, (r) => res(r.statusCode || 0)).end(); }); });
  if ([404, 400].includes(b)) ok++; else { falhas++; console.log('  ✖ path traversal', b); }
  const c = await st('/uploads/danfe/qualquer.pdf'); if (c === 401) ok++; else { falhas++; console.log('  ✖ danfe sem login deveria dar 401, deu', c); }
  const d = await st('/uploads/danfe/qualquer.pdf', { authorization: `Bearer ${vendedor}` }); if (d === 404) ok++; else { falhas++; console.log('  ✖ danfe com login deveria dar 404 (inexistente), deu', d); }
  const e = await st('/uploads/logos/nao-existe.png'); if (e === 404) ok++; else { falhas++; console.log('  ✖ logos', e); }

  console.log('== Sem token');
  await esperar(null, 'GET', '/vendas', [401], undefined, 'ANONIMO');
  await esperar(null, 'GET', '/saude', [200], undefined, 'ANONIMO');

  console.log(`\nResultado: ${ok} ok, ${falhas} falhas`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
