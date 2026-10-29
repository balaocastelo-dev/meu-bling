/**
 * TESTE DE ROBUSTEZ DA API — chama TODAS as rotas registradas (lidas do próprio app, então rota nova entra
 * sozinha) de vários jeitos e acusa qualquer erro interno (500) ou rota aberta sem login:
 *   1. sem login                       → tem que dar 401 (exceto as rotas públicas da lista abaixo)
 *   2. ADMIN, ids inexistentes, corpo vazio
 *   3. ADMIN, corpo e filtros com lixo (texto em número, datas inválidas, negativos, tipos trocados)
 *   4. VENDEDOR e TECNICO com o mesmo lixo
 * Em todos os casos a resposta tem que ser um erro tratado (400/403/404/409/422…), nunca 500.
 * Roda dentro do processo (app.inject) contra o banco de teste do rodar.ts.
 *   npx tsx testes/robustez.ts [--listar]
 */
import bcrypt from 'bcryptjs';
import { construirApp, ROTAS_REGISTRADAS } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { encerrar, falhar, placar, secao, SUF } from './lib.js';

/** Rotas que podem ser chamadas sem login (o resto tem que exigir login) */
const PUBLICAS = [/^\/api\/v1\/auth\/(login|logout|perfis)$/, /^\/api\/v1\/saude$/, /^\/api\/v1\/publico\//, /^\/api\/v1\/webhooks\//, /^\/api\/v1\/integracoes\/site\//, /^\/uploads/, /^\/$/, /^\/\*$/, /^\/assets/, /^\/api\/v1\/bling\/callback/, /^\/api\/v1\/jarvis\/ml\/callback/];

/** Rotas que falam com serviços de fora (WhatsApp real, Bling, SEFAZ, site): não são disparadas aqui */
const EXTERNAS = [/whatsapp\/(conectar|desconectar|reconectar|enviar-teste|eventos)/, /^\/api\/v1\/bling\//, /catalogo\/sincronizar/, /open-finance\/(sincronizar|connect-token|vincular)/, /notas-fiscais\/(:id\/)?(transmitir|consultar|cancelar|carta-correcao|inutilizar|enviar-email)/, /smtp\/testar/, /status-sefaz/, /contatos\/cep/, /notificacoes\/(processar|lembretes-contas)/, /\/notificar$/, /\/notificacoes\/:id\/reenviar/, /integracoes\/site\/notas/, /api-externa\/webhooks\/:id\/testar/, /api-externa\/entregas\/:id\/reenviar/];

const LIXO_QUERY = '?pagina=-1&limite=abc&dataInicial=2026-13-45&dataFinal=ontem&competencia=2026-99&id=xyz&vendedorId=-5&situacao=%27%3B--&tipo=QUALQUER&pesquisa=%25%25%25';
const LIXO_BODY = { id: 'abc', nome: 12345, data: '31/02/2026', valor: 'mil reais', quantidade: -3, itens: 'nada', parcelas: [{ valor: 'x' }], situacaoId: 'aberta', contatoId: -1, ids: ['a', null], email: 'nao-e-email', competencia: '2026-13', inicio: 'amanhã', fim: null, alvo: -10, premio: 'cem' };

async function main() {
  const app = await construirApp();
  await app.ready();
  const rotas = [...new Map(ROTAS_REGISTRADAS.filter((r) => r.url.startsWith('/api/')).map((r) => [`${r.metodo} ${r.url}`, r])).values()];
  if (process.argv.includes('--listar')) {
    console.log(rotas.map((r) => `${r.metodo} ${r.url}`).join('\n'));
    process.exit(0);
  }

  // ---- usuários de teste (direto no banco, sem depender de outras rotas)
  const hash = await bcrypt.hash('Robusto@123', 4);
  const mk = async (perfil: string) => {
    const u = await prisma.usuario.create({ data: { nome: `Robustez ${perfil}`, email: `robustez-${perfil.toLowerCase()}-${SUF}@teste.com`, senhaHash: hash, perfil } });
    return app.jwt.sign({ id: u.id, nome: u.nome, email: u.email, perfil: perfil as any, vendedorId: null, tecnicoId: null });
  };
  const adm = await prisma.usuario.findFirst({ where: { perfil: 'ADMIN' } });
  const tokens: Record<string, string> = {
    ADMIN: app.jwt.sign({ id: adm!.id, nome: adm!.nome, email: adm!.email, perfil: 'ADMIN', vendedorId: adm!.vendedorId, tecnicoId: null }),
    VENDEDOR: await mk('VENDEDOR'),
    TECNICO: await mk('TECNICO'),
  };

  const chamar = async (metodo: string, url: string, token: string | null, body?: unknown) => {
    const r = await app.inject({
      method: metodo as any,
      url,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return r;
  };
  const urlCom = (url: string, id: string) => url.replace(/:[a-zA-Z]+/g, id).replace(/\*$/, 'x');

  secao(`Robustez: ${rotas.length} rotas da API`);
  let puladas = 0;
  for (const r of rotas) {
    const nome = `${r.metodo} ${r.url}`;
    const externa = EXTERNAS.some((e) => e.test(r.url));
    const publica = PUBLICAS.some((p) => p.test(r.url));
    const problemas: string[] = [];

    // 1) sem login
    const semLogin = await chamar(r.metodo, urlCom(r.url, '999999'), null, r.metodo === 'GET' ? undefined : {});
    if (!publica && semLogin.statusCode !== 401) problemas.push(`sem login respondeu ${semLogin.statusCode} (deveria exigir login: 401)`);
    if (semLogin.statusCode >= 500 && !externa) problemas.push(`sem login: 500 ${semLogin.body.slice(0, 200)}`);

    if (externa) {
      puladas++;
    } else {
      const casos: [string, string, string, unknown][] = [
        ['ADMIN', 'id inexistente', urlCom(r.url, '999999'), r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : {}],
        ['ADMIN', 'lixo', urlCom(r.url, 'abc') + (r.metodo === 'GET' ? LIXO_QUERY : ''), r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : LIXO_BODY],
        ['ADMIN', 'id negativo', urlCom(r.url, '-1'), r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : { ...LIXO_BODY, ids: [-1] }],
        ['VENDEDOR', 'lixo', urlCom(r.url, '999999') + (r.metodo === 'GET' ? LIXO_QUERY : ''), r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : LIXO_BODY],
        ['TECNICO', 'lixo', urlCom(r.url, '999999') + (r.metodo === 'GET' ? LIXO_QUERY : ''), r.metodo === 'GET' || r.metodo === 'DELETE' ? undefined : LIXO_BODY],
      ];
      for (const [perfil, caso, url, body] of casos) {
        const resp = await chamar(r.metodo, url, tokens[perfil], body);
        if (resp.statusCode >= 500) problemas.push(`${perfil} (${caso}) → ${resp.statusCode}: ${resp.body.slice(0, 220)}`);
      }
    }
    if (problemas.length) for (const p of problemas) falhar(`${nome}: ${p}`);
    else placar.ok++;
  }
  console.log(`  (${puladas} rotas que falam com serviços externos só tiveram o teste de login)`);
  await app.close();
  await prisma.$disconnect();
  encerrar('Robustez da API');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
