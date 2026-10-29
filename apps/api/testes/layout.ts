/**
 * TESTE DE LAYOUT — abre TODAS as telas do sistema em celular pequeno (360), celular (390),
 * tablet (768), tablet deitado (1024) e computador (1440) e acusa o que vaza:
 *   - página que rola para o lado;
 *   - elemento que sai da janela ou do card (pedaço para fora da tela);
 *   - texto cortado sem reticências.
 * Tabelas largas que rolam para o lado DENTRO do próprio card são permitidas (aviso, não falha).
 * As rotas são lidas do routes.tsx, então tela nova entra no teste sozinha.
 *
 *   npx tsx testes/layout.ts <url da API> [url das telas] [pasta para salvar prints]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { encerrar, entrar, falhar, placar, secao } from './lib.js';
import { lerRotas } from './rotas.js';

const API = (process.argv[2] || 'http://localhost:3333').replace(/\/$/, '');
const RAIZ = (process.argv[3] || API).replace(/\/$/, '');
const PRINTS = process.argv[4] || '';
const SO = process.env.LAYOUT_SO ? new RegExp(process.env.LAYOUT_SO) : null;

const TAMANHOS = [
  { nome: 'celular pequeno', w: 360, h: 740, movel: true },
  { nome: 'celular', w: 390, h: 844, movel: true },
  { nome: 'tablet', w: 768, h: 1024, movel: true },
  { nome: 'tablet deitado', w: 1024, h: 768, movel: true },
  { nome: 'computador', w: 1440, h: 900, movel: false },
];

interface Achado {
  tipo: 'pagina' | 'fora' | 'cortado' | 'rolagem' | 'card' | 'sobreposto' | 'quebrado';
  onde: string;
  px: number;
}

/** Roda dentro da página: mede o que vaza */
function medir(W: number): Achado[] {
  // largura do aparelho, não window.innerWidth: no celular, página larga faz o navegador afastar o zoom
  // e o innerWidth cresce junto, escondendo o problema
  const achados: Achado[] = [];
  const doc = document.documentElement.scrollWidth;
  if (doc > W + 1) achados.push({ tipo: 'pagina', onde: 'página', px: doc - W });

  const rolaX = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX);
  const visivel = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const nome = (el: Element) => {
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    const txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
    return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}> "${txt}"`;
  };
  /** dentro de algo que rola de lado (tabela com rolagem própria) ou de algo fixo fora da tela (menu fechado) */
  const protegido = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (rolaX(a) && a.scrollWidth > a.clientWidth + 1) return true;
      // dentro de algo que corta o excesso (truncate com "…") e que está ele próprio dentro da tela
      if (/(hidden|clip)/.test(getComputedStyle(a).overflowX) && a.getBoundingClientRect().right <= W + 1) return true;
      const s = getComputedStyle(a);
      if ((s.position === 'fixed' || s.position === 'sticky') && a.getBoundingClientRect().right <= 0) return true;
    }
    return false;
  };

  /** card = contêiner com cantos arredondados e borda ou fundo próprios */
  const ehCard = (a: Element) => {
    const s = getComputedStyle(a);
    if (parseFloat(s.borderTopLeftRadius) < 6) return false;
    if (a.tagName === 'BUTTON' || a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') return false;
    return parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0 || (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent');
  };
  const cardDe = (el: Element) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (ehCard(a)) return a;
    return null;
  };
  /** posicionado de propósito (absoluto) em algum ponto entre o elemento e o card */
  const soltoNoCard = (el: Element) => {
    const card = cardDe(el);
    for (let a: Element | null = el.parentElement; a && a !== card; a = a.parentElement) {
      const p = getComputedStyle(a).position;
      if (p === 'absolute' || p === 'fixed') return true;
    }
    return false;
  };

  const marcados = new Set<Element>();
  const dentroDeMarcado = (el: Element) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (marcados.has(a)) return true;
    return false;
  };

  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if ((el.getAttribute('class') || '').includes('sr-only')) continue;
    if (['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'option', 'script', 'style'].includes(el.tagName.toLowerCase())) continue;
    if (!visivel(el)) continue;
    const r = el.getBoundingClientRect();
    // pedaço para fora da janela (inteiro fora = escondido de propósito, ex.: menu lateral fechado)
    const inteiroFora = r.right <= 0 || r.left >= W;
    if (!inteiroFora && (r.right > W + 1 || r.left < -1) && !protegido(el) && !dentroDeMarcado(el)) {
      marcados.add(el);
      achados.push({ tipo: 'fora', onde: nome(el), px: Math.round(Math.max(r.right - W, -r.left)) });
      continue;
    }
    // texto cortado: tem texto próprio, esconde o excesso e não põe reticências
    const s = getComputedStyle(el);
    const temTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 0);
    if (temTexto && el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && !protegido(el)) {
      achados.push({ tipo: 'cortado', onde: nome(el), px: el.scrollWidth - el.clientWidth });
    }
    // pedaço que passa da borda do card (contêiner com fundo/borda e cantos arredondados)
    const pos = s.position;
    if (pos !== 'absolute' && pos !== 'fixed' && !protegido(el) && !dentroDeMarcado(el) && !soltoNoCard(el)) {
      const card = cardDe(el);
      if (card) {
        const c = card.getBoundingClientRect();
        const passa = Math.max(r.right - c.right, c.left - r.left, r.bottom - c.bottom > 2 && /(hidden|clip)/.test(getComputedStyle(card).overflowY) ? r.bottom - c.bottom : 0);
        if (passa > 2) {
          marcados.add(el);
          achados.push({ tipo: 'card', onde: nome(el), px: Math.round(passa) });
          continue;
        }
      }
    }
    // textos encavalados: dois filhos do mesmo bloco, com texto, ocupando o mesmo lugar
    const filhos = Array.from(el.children).filter((f) => {
      const fs = getComputedStyle(f);
      return fs.display !== 'inline' && fs.position !== 'absolute' && fs.position !== 'fixed' && visivel(f) && (f.textContent || '').trim().length > 0;
    });
    if (filhos.length > 1 && filhos.length < 60 && !protegido(el)) {
      const rs = filhos.map((f) => f.getBoundingClientRect());
      for (let i = 0; i < rs.length; i++)
        for (let j = i + 1; j < rs.length; j++) {
          const w = Math.min(rs[i].right, rs[j].right) - Math.max(rs[i].left, rs[j].left);
          const h = Math.min(rs[i].bottom, rs[j].bottom) - Math.max(rs[i].top, rs[j].top);
          if (w > 4 && h > 4 && !marcados.has(filhos[j])) {
            marcados.add(filhos[j]);
            achados.push({ tipo: 'sobreposto', onde: `${nome(filhos[i])} × ${nome(filhos[j])}`, px: Math.round(Math.min(w, h)) });
          }
        }
    }
    // valor em dinheiro / porcentagem partido em duas linhas, ou rótulo curto de botão/aba quebrado
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 3 || s.whiteSpace === 'nowrap') continue;
      const t = n.textContent || '';
      const re = /R\$\s?-?[\d.]+(,\d+)?|-?\d+(,\d+)?\s?%/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) {
        const rg = document.createRange();
        rg.setStart(n, m.index);
        rg.setEnd(n, m.index + m[0].length);
        const tops = new Set(Array.from(rg.getClientRects()).filter((q) => q.width > 0).map((q) => Math.round(q.top)));
        if (tops.size > 1 && !protegido(el)) achados.push({ tipo: 'quebrado', onde: `${nome(el)} "${m[0]}"`, px: 0 });
      }
    }
    if (/^(BUTTON)$/.test(el.tagName) || el.getAttribute('role') === 'tab') {
      const txt = (el.textContent || '').trim();
      if (txt.length > 0 && txt.length <= 18 && !/\s/.test(txt)) {
        // linhas do texto (só os nós de texto, sem o ícone): topos que diferem mais de 8px
        const tops: number[] = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let tn = w.nextNode(); tn; tn = w.nextNode()) {
          const rg = document.createRange();
          rg.selectNodeContents(tn);
          for (const q of Array.from(rg.getClientRects())) if (q.width > 0 && !tops.some((t) => Math.abs(t - q.top) < 8)) tops.push(q.top);
        }
        if (tops.length > 1 && !protegido(el)) achados.push({ tipo: 'quebrado', onde: nome(el), px: 0 });
      }
    }
    // área com rolagem lateral própria (tabelas): só aviso
    if (rolaX(el) && el.scrollWidth > el.clientWidth + 8 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
      achados.push({ tipo: 'rolagem', onde: nome(el), px: el.scrollWidth - el.clientWidth });
    }
  }
  return achados;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
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
    consignacoes: await primeiro('/consignacoes'),
    financeiro: await primeiro('/contas-financeiras'),
  };
  const montar = (c: string) => (c.includes(':id') ? (ids[c.split('/')[1]] ? c.replace(':id', String(ids[c.split('/')[1]])) : null) : c);
  // a tela inicial (dashboard do ADMIN) é rota "index", sem path no routes.tsx
  const rotas = ['/', ...lerRotas().map((r) => r.caminho)]
    .map((r) => montar(r))
    .filter((c): c is string => !!c && (!SO || SO.test(c)));

  const browser = await chromium.launch();
  const avisos: string[] = [];
  for (const t of TAMANHOS) {
    secao(`Layout em ${t.nome} (${t.w}px): ${rotas.length} telas`);
    const ctx = await browser.newContext({ viewport: { width: t.w, height: t.h }, isMobile: t.movel && t.w < 1024, hasTouch: t.movel, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    // sem animação: mede e fotografa a tela já parada (números com o valor final, nada no meio do movimento)
    // o tsx (esbuild keepNames) embrulha funções com __name, que não existe dentro do navegador
    await ctx.addInitScript('window.__name = (f) => f;');
    const page: Page = await ctx.newPage();
    await page.goto(`${RAIZ}/login`);
    await page.fill('input[type=email]', 'admin@balao.info');
    await page.fill('input[type=password]', 'admin123');
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => falhar(`[${t.w}] login não entrou`));
    for (const c of rotas) {
      await page.goto(RAIZ + c, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(250);
      // a página pode navegar no meio da medição (redirect tardio) — espera assentar e mede de novo
      const achados = await page.evaluate(medir, t.w).catch(async (e) => {
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
        await page.waitForTimeout(400);
        return page.evaluate(medir, t.w).catch(() => [{ tipo: 'pagina' as const, onde: `erro ao medir: ${e.message}`, px: 0 }]);
      });
      if (PRINTS) {
        const arq = path.join(PRINTS, `${t.w}`, `${c.replace(/\//g, '_') || '_'}.png`);
        fs.mkdirSync(path.dirname(arq), { recursive: true });
        await page.screenshot({ path: arq, fullPage: true }).catch(() => undefined);
      }
      const graves = achados.filter((a) => a.tipo !== 'rolagem');
      for (const a of achados.filter((a) => a.tipo === 'rolagem')) avisos.push(`[${t.w}] ${c}: rola para o lado dentro do card (+${a.px}px) ${a.onde}`);
      if (graves.length) {
        const desc = (a: Achado) =>
          a.tipo === 'pagina' ? `página rola para o lado (+${a.px}px)` : a.tipo === 'fora' ? `sai da tela (+${a.px}px)` : a.tipo === 'card' ? `sai do card (+${a.px}px)` : a.tipo === 'sobreposto' ? `texto encavalado (${a.px}px)` : a.tipo === 'quebrado' ? 'valor/rótulo partido em duas linhas' : `texto cortado (+${a.px}px)`;
        for (const a of graves.slice(0, 6)) falhar(`[${t.w}px] ${c}: ${desc(a)} ${a.onde}`);
        if (graves.length > 6) falhar(`[${t.w}px] ${c}: … e mais ${graves.length - 6}`);
      } else {
        placar.ok++;
        console.log(`  ✔ [${t.w}px] ${c}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  if (avisos.length) {
    secao(`Avisos (não falham): ${avisos.length} áreas com rolagem lateral própria`);
    for (const a of avisos.slice(0, 80)) console.log('  · ' + a);
  }
  encerrar('Layout');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
