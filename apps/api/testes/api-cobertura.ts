/**
 * VARREDURA DA API EXTERNA — toda rota do sistema tem que estar numa destas situações:
 *   1. aberta para chave de API E documentada no catálogo (recursos.ts → ENDPOINTS), ou
 *   2. fechada de propósito (administração: usuários, chaves, certificado, Bling…; ou pública/integração).
 * Rota nova que abre para chave sem documentação reprova aqui: assim os agentes de IA sempre enxergam tudo.
 *   npx tsx testes/api-cobertura.ts
 */
import { construirApp, ROTAS_REGISTRADAS } from '../src/app.js';
import { ENDPOINTS, RECURSOS, chavePode } from '../src/modules/api-externa/recursos.js';
import { encerrar, falhar, placar, secao } from './lib.js';

/** Rotas que não precisam de documentação para chave (próprias da API externa, públicas ou de integração). */
const FORA = [/^\/(saude|mcp|publico\/|webhooks\/|integracoes\/site\/)/, /^\/mcp\/:chave$/];

const normal = (u: string) => u.replace(/:[a-zA-Z]+/g, '{}').replace(/\{[^}]*\}/g, '{}');

async function main() {
  const app = await construirApp();
  await app.ready();
  const tudo = Object.fromEntries(RECURSOS.map((r) => [r.chave, 'TOTAL'])) as any;
  const rotas = [...new Set(ROTAS_REGISTRADAS.filter((r) => r.url.startsWith('/api/v1/')).map((r) => `${r.metodo} ${r.url.replace('/api/v1', '')}`))];
  const documentadas = new Set(ENDPOINTS.map((e) => `${e.metodo} ${normal(e.caminho)}`));
  secao(`Varredura: ${rotas.length} rotas do sistema, ${ENDPOINTS.length} endpoints documentados`);
  let abertas = 0;
  for (const r of rotas) {
    const [metodo, url] = r.split(' ');
    if (FORA.some((f) => f.test(url))) continue;
    if (!chavePode(tudo, metodo, url).ok) continue;
    abertas++;
    if (documentadas.has(`${metodo} ${normal(url)}`)) placar.ok++;
    else falhar(`rota aberta para chave sem documentação no catálogo: ${metodo} ${url}`);
  }
  for (const e of ENDPOINTS) {
    if (!rotas.some((r) => normal(r) === `${e.metodo} ${normal(e.caminho)}`)) falhar(`endpoint documentado que não existe: ${e.metodo} ${e.caminho}`);
    else placar.ok++;
  }
  console.log(`  ${abertas} rotas abertas para chave com nível total, todas conferidas`);
  await app.close();
  encerrar('Varredura da API externa');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
