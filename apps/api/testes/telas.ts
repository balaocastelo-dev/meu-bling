/**
 * TESTE DAS TELAS — abre todas as páginas do sistema num navegador de verdade, com cada perfil,
 * e acusa: erro de JavaScript, tela "Ops, algo deu errado", chamada à API com erro (4xx/5xx)
 * numa tela que o perfil pode usar, página que estoura a largura no celular.
 * As rotas são lidas do apps/web/src/routes.tsx, então página nova entra no teste sozinha.
 *   npx tsx testes/telas.ts http://localhost:3333
 */
import { chromium, type Browser, type Page } from 'playwright';
import { encerrar, entrar, falhar, placar, secao, SUF } from './lib.js';
import { lerRotas, type Perfil } from './rotas.js';

const RAIZ = (process.argv[2] || 'http://localhost:3333').replace(/\/$/, '');

/** Ruídos conhecidos que não são erro do sistema */
const IGNORAR = [/favicon/i, /Download the React DevTools/i, /ResizeObserver loop/i, /net::ERR_ABORTED/i, /status of 401/i];

async function visitar(page: Page, url: string) {
  const problemas: string[] = [];
  const onErro = (e: Error) => problemas.push(`erro de JavaScript: ${e.message}`);
  const onConsole = (m: any) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORAR.some((r) => r.test(t))) return;
    if (/Failed to load resource/.test(t)) return; // a resposta é tratada abaixo, com a URL
    problemas.push(`console: ${t.slice(0, 200)}`);
  };
  const respostas: { url: string; status: number }[] = [];
  const onResp = (r: any) => {
    const u: string = r.url();
    if (u.includes('/api/v1/') && r.status() >= 400) respostas.push({ url: u.replace(RAIZ, ''), status: r.status() });
  };
  page.on('pageerror', onErro);
  page.on('console', onConsole);
  page.on('response', onResp);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  } catch (e: any) {
    problemas.push(`não carregou: ${e.message}`);
  }
  const texto = (await page.locator('body').innerText().catch(() => '')) || '';
  const semPermissao = texto.includes('Sem permissão');
  if (texto.includes('Ops, algo deu errado')) problemas.push('tela de erro "Ops, algo deu errado"');
  const larguras = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth })).catch(() => ({ doc: 0, tela: 0 }));
  page.off('pageerror', onErro);
  page.off('console', onConsole);
  page.off('response', onResp);
  return { problemas, respostas, semPermissao, larguras, texto };
}

async function main() {
  // ---- usuários de teste de cada perfil (criados pelo ADMIN via API)
  const adm = await entrar('admin@balao.info', 'admin123');
  const senha = 'Senha@Telas123';
  const vendedores = (await adm.get('/vendedores')) as any[];
  const vend = await adm.post('/vendedores', { nome: `Vendedor Telas ${SUF}`, ativo: true }, [200, 201]);
  const tec = await adm.post('/tecnicos', { nome: `Técnico Telas ${SUF}`, ativo: true }, [200, 201]);
  const contas: Record<Perfil, string> = { ADMIN: 'admin@balao.info', GERENTE: '', VENDEDOR: '', TECNICO: '', FINANCEIRO: '' };
  for (const p of ['GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'] as Perfil[]) {
    const email = `telas-${p.toLowerCase()}-${SUF}@teste.com`;
    await adm.post('/usuarios', { nome: `Telas ${p}`, email, senha, perfil: p, ...(p === 'VENDEDOR' ? { vendedorId: vend.id } : {}), ...(p === 'TECNICO' ? { tecnicoId: tec.id } : {}) }, 201);
    contas[p] = email;
  }
  void vendedores;

  // ---- ids reais para as telas de detalhe
  const primeiro = async (rota: string) => {
    const r = await adm.get(rota);
    const l = Array.isArray(r) ? r : r?.data;
    return l?.[0]?.id ?? null;
  };
  const ids: Record<string, number | null> = {
    vendas: await primeiro('/vendas?limite=1'),
    orcamentos: await primeiro('/vendas?tipo=ORCAMENTO&limite=1'),
    compras: await primeiro('/compras?limite=1'),
    'ordens-servico': await primeiro('/ordens-servico?limite=1'),
    contatos: await primeiro('/contatos?limite=1'),
    produtos: await primeiro('/produtos?limite=1'),
    'notas-fiscais': await primeiro('/notas-fiscais?limite=1'),
  };
  const montar = (caminho: string) => {
    if (!caminho.includes(':id')) return caminho;
    const base = caminho.split('/')[1];
    const id = ids[base];
    return id ? caminho.replace(':id', String(id)) : null;
  };

  const rotas = lerRotas();
  secao(`Telas: ${rotas.length} rotas lidas do routes.tsx × 5 perfis`);
  if (rotas.length < 40) falhar(`só ${rotas.length} rotas lidas do routes.tsx — o leitor de rotas precisa de ajuste`);

  const browser: Browser = await chromium.launch();
  for (const perfil of ['ADMIN', 'GERENTE', 'VENDEDOR', 'TECNICO', 'FINANCEIRO'] as Perfil[]) {
    secao(`Perfil ${perfil}`);
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const page = await ctx.newPage();
    await page.goto(`${RAIZ}/login`);
    await page.fill('input[type=email]', contas[perfil]);
    await page.fill('input[type=password]', perfil === 'ADMIN' ? 'admin123' : senha);
    await page.keyboard.press('Enter');
    let entrou = await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false);
    if (!entrou) {
      // o login tem limite de 20/min: depois das etapas de API pode estar estourado — espera a janela e tenta de novo
      await page.waitForTimeout(62_000);
      await page.keyboard.press('Enter');
      entrou = await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).then(() => true).catch(() => false);
    }
    if (!entrou) falhar(`[${perfil}] login pela tela não entrou`);
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

    for (const r of rotas) {
      const caminho = montar(r.caminho);
      if (!caminho) continue;
      const pode = r.perfis === 'TODOS' || perfil === 'ADMIN' || r.perfis.includes(perfil);
      const v = await visitar(page, RAIZ + caminho);
      const rotulo = `[${perfil}] ${caminho}`;
      const erros = [...v.problemas];
      if (pode) {
        if (v.semPermissao) erros.push('mostra "Sem permissão" para um perfil que deveria acessar');
        // telas que o perfil pode usar não devem chamar API proibida, inexistente ou com erro
        for (const x of v.respostas) erros.push(`API ${x.status} em ${x.url}`);
      } else {
        if (!v.semPermissao) erros.push('perfil sem acesso consegue abrir a tela (deveria mostrar "Sem permissão")');
        for (const x of v.respostas.filter((x) => x.status >= 500)) erros.push(`API ${x.status} em ${x.url}`);
      }
      if (erros.length) for (const e of [...new Set(erros)]) falhar(`${rotulo}: ${e}`);
      else {
        placar.ok++;
        console.log(`  ✔ ${rotulo}${pode ? '' : ' (bloqueada corretamente)'}`);
      }
    }
    await ctx.close();
  }

  // ---- custos escondidos (28/10): o cliente olha a tela do balcão — custo e lucro aparecem como **** com olhinho
  secao('Custos escondidos com **** e olhinho (cliente olhando a tela)');
  {
    const ctxC = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const pg = await ctxC.newPage();
    await pg.goto(`${RAIZ}/login`);
    await pg.fill('input[type=email]', 'admin@balao.info');
    await pg.fill('input[type=password]', 'admin123');
    await pg.keyboard.press('Enter');
    await pg.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => undefined);
    for (const c of [`/vendas/${ids.vendas}`, `/produtos/${ids.produtos}`, '/produtos', '/estoque', `/ordens-servico/${ids['ordens-servico']}`]) {
      await visitar(pg, RAIZ + c);
      const olhos = pg.locator('button[aria-label="Mostrar valor"]');
      const n = await olhos.count();
      if (!n) {
        falhar(`[custos] ${c}: nenhum custo escondido com olhinho`);
        continue;
      }
      const antes = await pg.locator('body').innerText();
      await olhos.first().click();
      await pg.waitForTimeout(150);
      const depois = await pg.locator('body').innerText();
      const mostrou = (await pg.locator('button[aria-label="Esconder valor"]').count()) > 0 && depois.split('****').length < antes.split('****').length;
      if (!antes.includes('****')) falhar(`[custos] ${c}: custo não aparece como ****`);
      else if (!mostrou) falhar(`[custos] ${c}: o olhinho não mostrou o valor`);
      else {
        placar.ok++;
        console.log(`  ✔ [custos] ${c}: ${n} valor(es) escondido(s), olhinho mostra`);
      }
    }
    // tela de digitar a venda: o custo do item é um campo escondido que abre no olho
    await visitar(pg, RAIZ + `/vendas/${ids.vendas}/editar`);
    const campos = pg.locator('input[title="Custo escondido: clique no olho para ver"]');
    if (!(await campos.count())) falhar('[custos] /vendas/:id/editar: campo de custo não está escondido');
    else if ((await campos.first().inputValue()) !== '****') falhar('[custos] /vendas/:id/editar: campo de custo mostra o valor');
    else {
      placar.ok++;
      console.log(`  ✔ [custos] /vendas/:id/editar: ${await campos.count()} campo(s) de custo como ****`);
    }
    await ctxC.close();
  }

  // ---- celular: nenhuma tela principal pode estourar a largura
  secao('Celular (390 px): telas principais sem rolagem lateral');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${RAIZ}/login`);
  await page.fill('input[type=email]', 'admin@balao.info');
  await page.fill('input[type=password]', 'admin123');
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => undefined);
  for (const c of ['/', '/meu-painel', '/vendas', '/vendas/nova', '/orcamentos', '/ordens-servico', '/contatos', '/produtos', '/estoque', '/comissoes', '/metas-desafios', '/financeiro/receber', `/vendas/${ids.vendas}`]) {
    const v = await visitar(page, RAIZ + c);
    if (v.larguras.doc > v.larguras.tela + 2) falhar(`[celular] ${c}: página com ${v.larguras.doc}px numa tela de ${v.larguras.tela}px (rola para o lado)`);
    else if (v.problemas.length) for (const e of v.problemas) falhar(`[celular] ${c}: ${e}`);
    else {
      placar.ok++;
      console.log(`  ✔ [celular] ${c}`);
    }
  }
  await ctx.close();
  await browser.close();
  encerrar('Telas');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
