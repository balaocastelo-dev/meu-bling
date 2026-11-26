/**
 * Tela do cadastro rápido: CPF repetido mostra "Usar este contato" (compra, venda e OS)
 * em vez de só o toast sem saída. Reativar o inativo também.
 *   npx tsx testes/contato-papel-tela.ts http://127.0.0.1:5173
 */
import { chromium, type Page } from 'playwright';
import { cpfTeste, encerrar, falhar, secao, SUF, verifica } from './lib.js';

const RAIZ = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const API = `${RAIZ}/api/v1`;

function doc(n: number) {
  return cpfTeste(String((Number(SUF) + n) % 1_000_000).padStart(6, '0'));
}

async function api(token: string, metodo: string, rota: string, body?: unknown) {
  const r = await fetch(API + rota, {
    method: metodo,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function entrar(page: Page, token: string, usuario: unknown) {
  await page.goto(`${RAIZ}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((dados) => {
    localStorage.setItem('meu-bling-auth', JSON.stringify({ state: dados, version: 0 }));
  }, { token, usuario });
}

/** Abre o drawer, tenta salvar o CPF que já existe e devolve o diálogo. */
async function provocar409(page: Page, caminho: string, tituloPagina: RegExp, rotuloCampo: RegExp, botaoNovo: string, nome: string, cpf: string) {
  await page.goto(`${RAIZ}${caminho}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: tituloPagina }).waitFor({ timeout: 15000 });
  const campo = page.getByLabel(rotuloCampo);
  await campo.click();
  const novo = page.getByRole('button', { name: botaoNovo });
  await novo.waitFor({ timeout: 8000 });
  await novo.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Nome/).fill(nome);
  await dialog.getByLabel('CPF').fill(cpf);
  await dialog.getByRole('button', { name: 'Salvar e selecionar' }).click();
  return dialog;
}

async function main() {
  const login = await api('', 'POST', '/auth/login', { email: 'admin@balao.info', senha: 'admin123' });
  if (login.status !== 200 || !login.json?.token) {
    falhar(`login da tela → ${login.status}`);
    return encerrar('Tela Usar este contato');
  }
  const token = login.json.token as string;
  const cpfCliente = doc(71);
  const cpfForn = doc(72);
  const cpfInativo = doc(73);
  const nomeCli = `CLIENTE TELA ${SUF}`;
  const nomeForn = `FORNECEDOR TELA ${SUF}`;
  const nomeInativo = `INATIVO TELA ${SUF}`;

  const cli = await api(token, 'POST', '/contatos', { nome: nomeCli, tipo: 'CLIENTE', tipoPessoa: 'F', documento: cpfCliente, celular: '19970001111' });
  const forn = await api(token, 'POST', '/contatos', { nome: nomeForn, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfForn, celular: '19970002222' });
  const inativo = await api(token, 'POST', '/contatos', { nome: nomeInativo, tipo: 'CLIENTE', tipoPessoa: 'F', documento: cpfInativo });
  await api(token, 'PUT', `/contatos/${inativo.json.id}`, { ativo: false });
  if (cli.status !== 201 || forn.status !== 201 || inativo.status !== 201) {
    falhar(`não criou os contatos da tela ${cli.status}/${forn.status}/${inativo.status}`);
    return encerrar('Tela Usar este contato');
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await entrar(page, token, login.json.usuario);

    secao('Compra: cliente aparece na busca com a tag e o 409 oferece Usar este contato');
    await page.goto(`${RAIZ}/compras/nova`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Nova compra' }).waitFor({ timeout: 15000 });
    const busca = page.getByLabel(/^Fornecedor/);
    await busca.click();
    await busca.fill(nomeCli);
    const opcao = page.getByRole('button', { name: new RegExp(nomeCli) }).first();
    await opcao.waitFor({ timeout: 8000 });
    verifica((await opcao.innerText()).includes('Cliente'), 'a opção do cliente mostra a tag Cliente', await opcao.innerText());
    await page.keyboard.press('Escape');

    const drawerForn = await provocar409(page, '/compras/nova', /^Nova compra$/, /^Fornecedor/, 'Cadastrar novo fornecedor', nomeCli, cpfCliente);
    const usar = drawerForn.getByRole('button', { name: 'Usar este contato' });
    await usar.waitFor({ timeout: 8000 });
    verifica(await usar.isVisible(), 'drawer de fornecedor mostra Usar este contato');
    verifica((await drawerForn.innerText()).includes('Cliente'), 'o bloco mostra a tag do tipo atual');
    await usar.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
    const campoForn = page.locator('label', { hasText: /^Fornecedor/ }).locator('..');
    verifica((await campoForn.innerText()).includes(nomeCli), 'o fornecedor da compra ficou o contato existente');
    const promovido = await api(token, 'GET', `/contatos/${cli.json.id}`);
    verifica(promovido.json?.tipo === 'AMBOS', 'Usar este contato promoveu o cliente para AMBOS', promovido.json?.tipo);

    secao('Venda: fornecedor puro no Novo cliente');
    const drawerVenda = await provocar409(page, '/vendas/nova', /^Nova venda$/, /^Cliente/, 'Cadastrar novo cliente', nomeForn, cpfForn);
    await drawerVenda.getByRole('button', { name: 'Usar este contato' }).waitFor({ timeout: 8000 });
    verifica((await drawerVenda.innerText()).includes('Fornecedor'), 'drawer da venda mostra a tag Fornecedor');
    await drawerVenda.getByRole('button', { name: 'Usar este contato' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
    verifica((await api(token, 'GET', `/contatos/${forn.json.id}`)).json?.tipo === 'AMBOS', 'na venda, o fornecedor passou a AMBOS');

    secao('OS: o mesmo bloco no Novo cliente');
    const cpfOs = doc(74);
    const nomeOs = `FORNECEDOR OS TELA ${SUF}`;
    const fornOs = await api(token, 'POST', '/contatos', { nome: nomeOs, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfOs, celular: '19970003333' });
    const drawerOs = await provocar409(page, '/ordens-servico/nova', /Nova ordem de serviço/, /^Cliente/, 'Cadastrar novo cliente', nomeOs, cpfOs);
    await drawerOs.getByRole('button', { name: 'Usar este contato' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
    const campoCli = page.locator('label', { hasText: /^Cliente/ }).locator('..');
    verifica((await campoCli.innerText()).includes(nomeOs), 'a OS selecionou o contato existente');
    verifica((await api(token, 'GET', `/contatos/${fornOs.json.id}`)).json?.tipo === 'AMBOS', 'na OS, o fornecedor passou a AMBOS');

    secao('Inativo: o botão reativa e usa');
    const drawerInativo = await provocar409(page, '/compras/nova', /^Nova compra$/, /^Fornecedor/, 'Cadastrar novo fornecedor', nomeInativo, cpfInativo);
    const reativar = drawerInativo.getByRole('button', { name: 'Reativar e usar' });
    await reativar.waitFor({ timeout: 8000 });
    await reativar.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
    const vivo = await api(token, 'GET', `/contatos/${inativo.json.id}`);
    verifica(vivo.json?.ativo === true && vivo.json?.tipo === 'AMBOS', 'Reativar e usar ligou o contato e marcou como fornecedor também', { ativo: vivo.json?.ativo, tipo: vivo.json?.tipo });
  } catch (e) {
    falhar(e instanceof Error ? e.message : String(e));
    await page.screenshot({ path: '/tmp/contato-papel-tela-erro.png' }).catch(() => undefined);
  } finally {
    await browser.close();
  }
  encerrar('Tela Usar este contato');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
