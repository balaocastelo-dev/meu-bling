/**
 * CAMPO DE CUSTO ESCONDIDO (coluna "Custo un." da venda/orçamento e da OS).
 *
 * O custo fica como "****" com um olhinho (pedido do Thiago em 28/10/2026, para o cliente não ver
 * o custo na tela enquanto o vendedor digita a venda). Quem clica PRIMEIRO no campo escondido e
 * só depois no olho já deixa o input focado — e o focus() do olho não dispara onFocus de novo.
 * Sem o conserto, o componente achava que ninguém estava digitando e reformatava o texto a cada
 * tecla: digitar 107 virava "1,0007" e terminava gravando 1,00.
 *
 *   npx tsx testes/campo-custo.ts http://localhost:3333
 */
import { chromium, type Page } from 'playwright';
import { encerrar, falhar, placar, secao, verifica } from './lib.js';

const RAIZ = (process.argv[2] || 'http://localhost:3333').replace(/\/$/, '');

async function entrarNoSistema(page: Page) {
  await page.goto(`${RAIZ}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', 'admin@balao.info');
  await page.fill('input[type=password]', 'admin123');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 });
}

/** Abre um orçamento novo com uma linha livre e devolve o campo de custo e o botão do olho. */
async function abrirLinhaComCusto(page: Page) {
  await page.goto(`${RAIZ}/orcamentos/novo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const livre = page.getByRole('button', { name: /linha livre|item livre|livre/i }).first();
  if (await livre.count()) {
    await livre.click();
    await page.waitForTimeout(400);
  }
  const celula = page.locator('td[data-rotulo="Custo un. (interno)"]').first();
  if (!(await celula.count())) falhar('campo de custo não encontrado na tela do orçamento');
  return { campo: celula.locator('input').first(), olho: celula.locator('button').first() };
}

async function digitar(page: Page, campo: any, olho: any, clicarNoCampoAntes: boolean) {
  if (clicarNoCampoAntes) {
    await campo.click(); // foca o input ainda escondido (readOnly)
    await page.waitForTimeout(120);
  }
  await olho.click(); // revela
  await page.waitForTimeout(200);
  await page.keyboard.type('107', { delay: 80 });
  await page.waitForTimeout(200);
  const enquantoDigita = await campo.inputValue();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250);
  await olho.click(); // revela de novo para conferir o que ficou
  await page.waitForTimeout(200);
  return { enquantoDigita, final: await campo.inputValue() };
}

async function main() {
  const navegador = await chromium.launch();
  const page = await navegador.newPage();
  try {
    await entrarNoSistema(page);

    secao('Custo escondido: clicar no olho e digitar');
    const a = await abrirLinhaComCusto(page);
    const r1 = await digitar(page, a.campo, a.olho, false);
    verifica(r1.enquantoDigita === '107', 'o que foi digitado aparece inteiro no campo (107)', r1.enquantoDigita);
    verifica(r1.final === '107,00', 'ao sair do campo o custo fica 107,00', r1.final);

    secao('Custo escondido: clicar no CAMPO antes do olho (o jeito que trava)');
    const b = await abrirLinhaComCusto(page);
    const r2 = await digitar(page, b.campo, b.olho, true);
    verifica(r2.enquantoDigita === '107', 'o campo não reformata por baixo de quem digita', r2.enquantoDigita);
    verifica(r2.final === '107,00', 'o custo digitado é o que fica gravado (não volta para 1,00)', r2.final);
  } finally {
    await navegador.close();
  }
  encerrar('Campo de custo escondido');
}

main().catch((e) => {
  falhar(String(e?.message || e));
  encerrar('Campo de custo escondido');
});
