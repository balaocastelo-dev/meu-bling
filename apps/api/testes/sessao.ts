/**
 * Sessão de 30 dias (o dono pediu 30 dias no lugar das 12 h da spec):
 * renovação deslizante, 401 de senha errada, token vencido e senha mínima de 8 caracteres.
 *   npx tsx testes/sessao.ts http://127.0.0.1:PORTA
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigner } from 'fast-jwt';
import { chromium, type Page } from 'playwright';
import { decidir401, deveRenovarSessao, expiracaoJwt, INTERVALO_USO_MS, MENSAGEM_SESSAO_EXPIRADA } from '../../web/src/lib/sessao.ts';
import { BASE, Sessao, SUF, encerrar, entrar, espera, falhar, placar, secao, verifica } from './lib.js';

const RAIZ = (process.argv[2] || 'http://127.0.0.1:3333').replace(/\/$/, '');
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TRINTA_DIAS = 30 * 24 * 60 * 60;
const SENHA = 'Senha@Sessao123';

function expDo(token: string): number {
  const parte = token.split('.')[1] || '';
  const json = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as { exp?: number };
  return json.exp ?? 0;
}

function pertoDe30Dias(token: string) {
  const falta = expDo(token) - Math.floor(Date.now() / 1000);
  return falta > TRINTA_DIAS - 180 && falta < TRINTA_DIAS + 180;
}

function maxAgeCookie(headers: Headers): number | null {
  const lista = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  const c = lista.find((s) => /(?:^|,\s*)mb_token=/.test(s) || s.includes('mb_token='));
  const m = c ? /Max-Age=(\d+)/i.exec(c) : null;
  return m ? Number(m[1]) : null;
}

function tokenComExp(exp: number) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none', typ: 'JWT' })}.${b({ exp })}.x`;
}

function assinar(payload: Record<string, unknown>, expiresIn?: string) {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) return '';
  const sign = createSigner({ key: segredo, ...(expiresIn ? { expiresIn } : {}) });
  return sign(payload) as string;
}

function testarRegras() {
  secao('Regras do cliente (relógio falso, sem rede)');
  const agora = 1_700_000_000_000;
  const exp50min = Math.floor(agora / 1000) + 50 * 60;
  const expLonge = Math.floor(agora / 1000) + 10 * 24 * 3600;
  const base = { pathname: '/', basePath: '', agoraMs: agora, visivel: true, ultimaRenovacaoMs: agora };

  verifica(deveRenovarSessao({ ...base, token: tokenComExp(exp50min), gatilho: 'periodo' }), 'faltando 50 minutos, a renovação roda');
  verifica(deveRenovarSessao({ ...base, token: tokenComExp(exp50min), gatilho: 'foco', ultimaRenovacaoMs: agora - 1000 }), 'ao voltar o foco na última hora, renova mesmo se acabou de renovar');
  verifica(!deveRenovarSessao({ ...base, token: tokenComExp(exp50min), visivel: false, gatilho: 'periodo' }), 'aba escondida não renova');
  verifica(!deveRenovarSessao({ ...base, token: null, gatilho: 'abertura' }), 'sem token não renova');
  verifica(!deveRenovarSessao({ ...base, token: tokenComExp(expLonge), pathname: '/login', gatilho: 'abertura' }), 'na tela de login não renova');
  verifica(!deveRenovarSessao({ ...base, token: tokenComExp(expLonge), pathname: '/p/os/abc', gatilho: 'abertura' }), 'página pública não renova');
  verifica(deveRenovarSessao({ ...base, token: tokenComExp(expLonge), gatilho: 'abertura', ultimaRenovacaoMs: 0 }), 'ao abrir o app, renova (sessão deslizante)');
  verifica(deveRenovarSessao({ ...base, token: tokenComExp(expLonge), gatilho: 'visivel', ultimaRenovacaoMs: agora - INTERVALO_USO_MS - 1 }), 'ao voltar a ficar visível depois de 30 min, renova');
  verifica(!deveRenovarSessao({ ...base, token: tokenComExp(expLonge), gatilho: 'visivel', ultimaRenovacaoMs: agora - 60_000 }), 'voltar a aba antes de 30 min não repete a renovação');
  verifica(expiracaoJwt(tokenComExp(exp50min)) === exp50min, 'lê o exp do JWT sem conferir assinatura');

  const senhaErrada = decidir401({ caminho: '/auth/login', pathname: '/login', code: 'CREDENCIAIS', erro: 'E-mail ou senha inválidos.' });
  verifica(!senhaErrada.deslogar && !senhaErrada.redirecionar && senhaErrada.mensagem === 'E-mail ou senha inválidos.', '401 do login não desloga e mantém a mensagem da API');
  const vencido = decidir401({ caminho: '/auth/eu', pathname: '/', code: 'NAO_AUTENTICADO', erro: 'Não autenticado. Faça login novamente.' });
  verifica(vencido.deslogar && vencido.redirecionar && vencido.mensagem === MENSAGEM_SESSAO_EXPIRADA, 'token vencido vai para o login com “Sessão expirada”');
  const inativo = decidir401({ caminho: '/auth/renovar', pathname: '/', code: 'USUARIO_INATIVO', erro: 'Seu usuário foi desativado. Fale com o administrador.' });
  verifica(inativo.deslogar && inativo.mensagem.includes('desativado') && !inativo.mensagem.includes('Sessão expirada'), 'usuário desativado não aparece como sessão expirada');
}

function testarSeed() {
  secao('Seed não regrava senha de quem já existe');
  const seed = fs.readFileSync(path.join(AQUI, '../prisma/seed.ts'), 'utf8');
  const i = seed.indexOf("email: 'admin@balao.info'");
  const trecho = seed.slice(i, i + 600);
  verifica(/update:\s*\{\s*\}/.test(trecho), 'o upsert do administrador usa update vazio');
  verifica(!/update:\s*\{[^}]*senhaHash/.test(seed), 'nenhum update do seed grava senhaHash');
  const docker = fs.readFileSync(path.join(AQUI, '../../../Dockerfile'), 'utf8');
  verifica(docker.includes('não sobrescreve usuário que já existe'), 'o container continua dizendo que o seed não sobrescreve usuário');
}

async function loginBruto(email: string, senha: string) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(BASE + '/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (r.status !== 429) return r;
    const esperaMs = (Number(r.headers.get('retry-after')) || 30) * 1000;
    await espera(Math.min(esperaMs, 62_000) + 500);
  }
  return fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
}

async function testarApi() {
  secao('API: login, renovar, dois aparelhos, senha e usuário inativo');
  const adm = await entrar('admin@balao.info', 'admin123');
  const email = `sessao-${SUF}@teste.com`;
  const criado = await adm.post('/usuarios', { nome: `Sessao ${SUF}`, email, senha: SENHA, perfil: 'VENDEDOR' }, 201);
  const curto = await adm.post('/usuarios', { nome: 'Curta', email: `curta-${SUF}@teste.com`, senha: '1234567', perfil: 'VENDEDOR' }, 400);
  verifica(String(curto?.erro || '').includes('8 caracteres'), 'criar usuário com senha de 7 caracteres é recusado');
  const edicaoCurta = await adm.put(`/usuarios/${criado.id}`, { senha: '1234567' }, 400);
  verifica(String(edicaoCurta?.erro || '').includes('8 caracteres'), 'trocar a senha na edição com menos de 8 caracteres é recusado');

  const ruim = await loginBruto(email, 'senha-errada');
  const corpoRuim: any = await ruim.json().catch(() => ({}));
  verifica(ruim.status === 401 && corpoRuim.code === 'CREDENCIAIS' && corpoRuim.erro === 'E-mail ou senha inválidos.', 'senha errada: 401 CREDENCIAIS com a mensagem da API', { status: ruim.status, code: corpoRuim.code, erro: corpoRuim.erro });
  verifica(!String(corpoRuim.erro || '').includes('Sessão expirada'), 'senha errada não diz sessão expirada');

  const resp = await loginBruto(email, SENHA);
  const corpo: any = await resp.json().catch(() => ({}));
  const cookieLogin = maxAgeCookie(resp.headers);
  verifica(resp.status === 200 && pertoDe30Dias(corpo.token || ''), 'login devolve token com exp de cerca de 30 dias');
  verifica(cookieLogin === TRINTA_DIAS, 'cookie mb_token do login dura 30 dias', cookieLogin);
  const a = new Sessao(corpo.token, email);
  const b = await entrar(email, SENHA);
  verifica(pertoDe30Dias(b.token), 'segundo login (outro aparelho) também dura 30 dias');
  await a.get('/auth/eu');
  await b.get('/auth/eu');

  await espera(1100);
  const antes = (await adm.get(`/auditoria?entidade=Usuario&entidadeId=${criado.id}&limite=30`)) as any[];
  const loginsAntes = antes.filter((x) => x.acao === 'LOGIN').length;
  const renovadoResp = await fetch(BASE + '/auth/renovar', { method: 'POST', headers: { authorization: `Bearer ${a.token}` } });
  const renovado: any = await renovadoResp.json().catch(() => ({}));
  verifica(renovadoResp.status === 200 && renovado.token && renovado.token !== a.token, 'POST /auth/renovar devolve um token novo');
  verifica(pertoDe30Dias(renovado.token || ''), 'o token renovado vence em cerca de 30 dias');
  verifica(expDo(renovado.token) > expDo(a.token), 'o exp novo é depois do exp antigo');
  verifica(maxAgeCookie(renovadoResp.headers) === TRINTA_DIAS, 'o cookie é regravado com 30 dias', maxAgeCookie(renovadoResp.headers));
  verifica(renovado.usuario?.id === criado.id && renovado.usuario?.email === email, 'a resposta traz o usuário, sem senhaFraca');
  verifica(renovado.senhaFraca === undefined, 'renovar não devolve senhaFraca');
  await a.get('/auth/eu');
  const comNovo = new Sessao(renovado.token, email);
  await comNovo.get('/auth/eu');
  await b.get('/auth/eu');

  await adm.put(`/usuarios/${criado.id}`, { nome: `Sessao Nova ${SUF}` });
  const atualizado = await comNovo.post('/auth/renovar');
  verifica(atualizado?.usuario?.nome === `Sessao Nova ${SUF}`, 'renovar lê o nome atual do banco');
  const depois = (await adm.get(`/auditoria?entidade=Usuario&entidadeId=${criado.id}&limite=30`)) as any[];
  const loginsDepois = depois.filter((x) => x.acao === 'LOGIN').length;
  verifica(loginsDepois === loginsAntes, 'renovar não grava LOGIN na auditoria', { antes: loginsAntes, depois: loginsDepois });

  const fraca = await comNovo.put('/auth/senha', { senhaAtual: SENHA, novaSenha: '123456' }, 400);
  verifica(String(fraca?.erro || '').includes('pelo menos 8 caracteres'), 'Minha conta recusa senha nova com 6 caracteres');
  await comNovo.put('/auth/senha', { senhaAtual: SENHA, novaSenha: 'Senha@Nova123' });
  await comNovo.get('/auth/eu');
  const relogou = await entrar(email, 'Senha@Nova123');
  await relogou.get('/auth/eu');
  await b.get('/auth/eu');

  const anon = new Sessao();
  const sem = await anon.post('/auth/renovar', {}, 401);
  verifica(sem?.code === 'NAO_AUTENTICADO', 'renovar sem token é 401 NAO_AUTENTICADO', sem?.code);

  if (!process.env.JWT_SECRET) {
    falhar('o processo de teste não recebeu o segredo JWT de teste — não deu para assinar um token vencido');
  } else {
    const vencido = assinar({ id: criado.id, nome: criado.nome, email, perfil: 'VENDEDOR', vendedorId: null, tecnicoId: null, exp: Math.floor(Date.now() / 1000) - 120 });
    const r = await fetch(BASE + '/auth/renovar', { method: 'POST', headers: { authorization: `Bearer ${vencido}` } });
    const j: any = await r.json().catch(() => ({}));
    verifica(r.status === 401 && j.code === 'NAO_AUTENTICADO', 'token vencido em /auth/renovar é 401 NAO_AUTENTICADO', j.code);
  }

  await adm.put(`/usuarios/${criado.id}`, { ativo: false });
  const parado = await comNovo.post('/auth/renovar', {}, 401);
  verifica(parado?.code === 'USUARIO_INATIVO' && String(parado?.erro || '').includes('desativado'), 'usuário inativo não renova', parado?.code);
  verifica(!String(parado?.erro || '').includes('Sessão expirada'), 'recusa do inativo não diz sessão expirada');
  const loginParado = await loginBruto(email, 'Senha@Nova123');
  const corpoParado: any = await loginParado.json().catch(() => ({}));
  verifica(loginParado.status === 401 && corpoParado.erro === 'E-mail ou senha inválidos.', 'login de usuário inativo não diz sessão expirada');
  await adm.put(`/usuarios/${criado.id}`, { ativo: true });

  return { id: criado.id, email, nome: `Sessao Nova ${SUF}` };
}

async function avisoNaTela(page: Page, texto: string) {
  const alvo = page.getByText(texto, { exact: false }).first();
  const ok = await alvo.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  return ok;
}

async function print(page: Page, nome: string) {
  const dir = process.env.PRINTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, nome) });
}

async function testarTela(usuario: { id: number; email: string; nome: string }) {
  secao('Tela: senha errada, login, renovar com 50 min e token vencido');
  const html = await fetch(RAIZ + '/').then((r) => r.text()).catch(() => '');
  if (!html.includes('id="root"')) {
    falhar('a tela compilada não está sendo servida — o teste de navegador precisa do build de apps/web');
    return;
  }
  if (!process.env.JWT_SECRET) {
    falhar('sem o segredo JWT de teste não dá para simular o token de 50 min nem o vencido');
    return;
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    await page.goto(`${RAIZ}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[type=email]', usuario.email);
    await page.fill('input[type=password]', 'nao-e-a-senha');
    await page.keyboard.press('Enter');
    const toastErrado = await avisoNaTela(page, 'E-mail ou senha inválidos.');
    const aindaNoLogin = page.url().includes('/login');
    const emailAinda = await page.inputValue('input[type=email]').catch(() => '');
    const disseExpirada = await page.getByText('Sessão expirada', { exact: false }).count();
    verifica(toastErrado && aindaNoLogin && emailAinda === usuario.email && disseExpirada === 0, 'senha errada: toast da API, sem redirect e sem “Sessão expirada”');
    await page.waitForTimeout(400);
    await print(page, 'senha-errada.png');
    await page.locator('[data-sonner-toast]').first().locator('button').click().catch(() => undefined);

    await page.fill('input[type=password]', 'Senha@Nova123');
    await page.keyboard.press('Enter');
    const entrou = await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false);
    verifica(entrou, 'login válido entra no sistema');
    await page.getByText(/Boa (tarde|noite|dia)/).waitFor({ timeout: 12000 }).catch(() => undefined);
    await page.getByText('E-mail ou senha inválidos.').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => undefined);
    await print(page, 'login-ok.png');

    await page.goto(`${RAIZ}/perfil`);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.getByLabel('Senha atual').fill('Senha@Nova123');
    await page.getByLabel('Nova senha', { exact: true }).fill('123456');
    await page.getByLabel('Confirmar nova senha').fill('123456');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    const recusou6 = await avisoNaTela(page, 'pelo menos 8 caracteres');
    verifica(recusou6, 'Minha conta recusa senha de 6 caracteres na tela');
    await page.getByLabel('Nova senha', { exact: true }).fill('Senha@Oito123');
    await page.getByLabel('Confirmar nova senha').fill('Senha@Oito123');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    const aceitou8 = await avisoNaTela(page, 'Senha alterada com sucesso.');
    verifica(aceitou8, 'Minha conta aceita senha de 8 ou mais caracteres');

    await ctx.close();

    const curto = assinar(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: 'VENDEDOR', vendedorId: null, tecnicoId: null },
      '50m',
    );
    verifica(expDo(curto) - Math.floor(Date.now() / 1000) < 60 * 60, 'token de teste vence em menos de 1 hora');
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page2 = await ctx2.newPage();
    let statusRenovar = 0;
    page2.on('response', (r) => {
      if (r.url().includes('/auth/renovar') && r.request().method() === 'POST') statusRenovar = r.status();
    });
    const gravarAuth = (token: string) => JSON.stringify({
      state: { token, usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: 'VENDEDOR', vendedorId: null, tecnicoId: null } },
      version: 0,
    });
    // grava o token uma vez: um init script reporia o token vencido em todo carregamento, inclusive no /login
    await page2.goto(`${RAIZ}/login`, { waitUntil: 'domcontentloaded' });
    await page2.evaluate((auth) => localStorage.setItem('meu-bling-auth', auth), gravarAuth(curto));
    await page2.goto(`${RAIZ}/`, { waitUntil: 'domcontentloaded' });
    const viuRenovar = await page2.waitForResponse((r) => r.url().includes('/auth/renovar') && r.request().method() === 'POST', { timeout: 15000 }).then((r) => r.status()).catch(() => statusRenovar);
    await page2.waitForTimeout(500);
    const guardado = await page2.evaluate(() => localStorage.getItem('meu-bling-auth') || '');
    let tokenNovo = '';
    try {
      tokenNovo = JSON.parse(guardado)?.state?.token || '';
    } catch { /* corpo inválido */ }
    verifica(viuRenovar === 200, 'com 50 minutos restantes, POST /auth/renovar responde 200', viuRenovar);
    verifica(!!tokenNovo && tokenNovo !== curto && pertoDe30Dias(tokenNovo), 'o localStorage passa a ter o token novo, com exp de cerca de 30 dias');
    await print(page2, 'renovar-50min.png');
    await ctx2.close();

    const vencido = assinar({ id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: 'VENDEDOR', vendedorId: null, tecnicoId: null, exp: Math.floor(Date.now() / 1000) - 300 });
    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page3 = await ctx3.newPage();
    await page3.goto(`${RAIZ}/login`, { waitUntil: 'domcontentloaded' });
    await page3.evaluate((auth) => localStorage.setItem('meu-bling-auth', auth), gravarAuth(vencido));
    await page3.goto(`${RAIZ}/`, { waitUntil: 'domcontentloaded' });
    const foiAoLogin = await page3.waitForURL((u) => u.pathname.endsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false);
    const toast = await avisoNaTela(page3, MENSAGEM_SESSAO_EXPIRADA);
    verifica(foiAoLogin && toast, 'token vencido abre /login com “Sessão expirada. Faça login novamente.”');
    await print(page3, 'sessao-expirada.png');
    await ctx3.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  testarRegras();
  testarSeed();
  const usuario = await testarApi();
  await testarTela(usuario);
  encerrar('Sessão de 30 dias');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
