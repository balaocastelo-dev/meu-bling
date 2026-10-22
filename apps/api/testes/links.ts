/**
 * LINKS QUEBRADOS — confere se todo link interno do sistema leva a uma tela que existe.
 * (Bug de 22/10: alertas do dashboard abriam "Página não encontrada": /financeiro/contas-receber
 *  em vez de /financeiro/receber, /configuracoes/whatsapp em vez de /comunicacao/whatsapp…)
 *
 * 1. Lê as telas do apps/web/src/routes.tsx.
 * 2. Varre o código da API (link: '...') e da tela (to="...", navigate('...'), para: '...', link: '...').
 * 3. Com a API de teste no ar, pega os links que o dashboard e a Saúde do sistema devolvem de verdade.
 * Todo caminho tem que casar com uma tela (":id" casa com qualquer número).
 *   npx tsx testes/links.ts http://localhost:3333
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encerrar, entrar, falhar, placar, secao } from './lib.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const API_SRC = path.resolve(AQUI, '../src');
const WEB_SRC = path.resolve(AQUI, '../../web/src');

function telas(): RegExp[] {
  const src = fs.readFileSync(path.join(WEB_SRC, 'routes.tsx'), 'utf8');
  const caminhos = [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== '*' && p !== '/');
  const pads = caminhos.map((c) => {
    const abs = c.startsWith('/') ? c : '/' + c;
    return new RegExp('^' + abs.replace(/:[a-zA-Z]+/g, '[^/]+') + '/?$');
  });
  pads.push(/^\/$/);
  return pads;
}

function arquivos(dir: string, ext: RegExp): string[] {
  const r: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) r.push(...arquivos(p, ext));
    else if (ext.test(e.name)) r.push(p);
  }
  return r;
}

/** Normaliza um link: tira query/hash, troca ${...} por um valor */
function normalizar(l: string) {
  return l.replace(/\$\{[^}]*\}/g, '1').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
}

async function main() {
  const pads = telas();
  const casa = (l: string) => pads.some((p) => p.test(normalizar(l)));
  secao(`Links no código (${pads.length} telas)`);

  const fontes: { arquivo: string; links: string[] }[] = [];
  const RE_API = /link:\s*(['`])(\/[^'`]*)\1/g;
  const RE_WEB = /(?:\bto=\{?|navigate\(|\bpara:\s*|\blink:\s*|\bhref=\{?)\s*(['"`])(\/[^'"`]*)\1/g;
  for (const f of arquivos(API_SRC, /\.ts$/)) fontes.push({ arquivo: f, links: [...fs.readFileSync(f, 'utf8').matchAll(RE_API)].map((m) => m[2]) });
  for (const f of arquivos(WEB_SRC, /\.tsx?$/)) fontes.push({ arquivo: f, links: [...fs.readFileSync(f, 'utf8').matchAll(RE_WEB)].map((m) => m[2]) });

  let total = 0;
  for (const { arquivo, links } of fontes) {
    for (const l of links) {
      // links de arquivos/API e páginas públicas não são telas do app
      if (/^\/(api|uploads|assets)\//.test(l) || l.startsWith('/p/') || l === '/login') continue;
      total++;
      if (casa(l)) placar.ok++;
      else falhar(`link para tela inexistente "${l}" em ${path.relative(path.resolve(AQUI, '../..'), arquivo)}`);
    }
  }
  console.log(`  ✔ ${total} links do código conferidos`);

  secao('Links que a API devolve de verdade (alertas do dashboard e Saúde do sistema)');
  const adm = await entrar('admin@balao.info', 'admin123');
  const dash = await adm.get('/dashboard/geral');
  const diag = await adm.get('/diagnostico');
  const vivos: string[] = [
    ...(dash?.alertas || []).map((a: any) => a.link),
    ...(diag?.achados || []).flatMap((a: any) => [a.link, ...(a.exemplos || []).map((e: any) => e.link)]),
  ].filter(Boolean);
  for (const l of vivos) {
    if (casa(l)) placar.ok++;
    else falhar(`a API devolveu link para tela inexistente: "${l}"`);
  }
  console.log(`  ✔ ${vivos.length} links devolvidos pela API conferidos`);
  encerrar('Links');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
