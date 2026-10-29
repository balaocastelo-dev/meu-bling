/**
 * RODA TODOS OS TESTES DO MEU BLING com um comando (na raiz do projeto: `npm test`).
 *
 * 1. Confere os tipos da API e da tela (TypeScript) e compila a tela.
 * 2. Cria um banco NOVO e vazio numa pasta temporária (nunca toca o banco de verdade),
 *    carrega os dados de exemplo e sobe uma API de teste numa porta livre.
 * 3. Roda as suítes: fluxo completo (2 rodadas), perfis de acesso, regras de vendas/painel/metas/desafios
 *    as telas no navegador (todas as páginas × 5 perfis + celular) e o layout em 5 tamanhos de tela.
 * 4. Mostra o resumo e sai com erro se qualquer coisa falhar.
 *
 * Opções: --rapido (pula compilação e telas) · --manter (não apaga a pasta temporária)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.resolve(API, '../..');
const WEB = path.join(RAIZ, 'apps/web');
const RAPIDO = process.argv.includes('--rapido');
const MANTER = process.argv.includes('--manter');
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const resultados: { nome: string; ok: boolean; segundos: number; detalhe?: string }[] = [];

function rodar(nome: string, cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const t = Date.now();
  console.log(`\n\x1b[1;36m━━ ${nome}\x1b[0m`);
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? API, env: { ...process.env, ...opts.env }, stdio: 'inherit', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  resultados.push({ nome, ok, segundos: Math.round((Date.now() - t) / 1000) });
  return ok;
}

function portaLivre(): Promise<number> {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => res(p));
    });
  });
}

async function main() {
  const inicio = Date.now();
  if (!RAPIDO) {
    rodar('Tipos da API (TypeScript)', NPX, ['tsc', '-p', 'tsconfig.json', '--noEmit']);
    rodar('Tipos da tela (TypeScript)', NPX, ['tsc', '--noEmit', '-p', 'tsconfig.json'], { cwd: WEB });
    rodar('Compilação da tela (vite build)', NPX, ['vite', 'build', '--logLevel', 'warn'], { cwd: WEB });
  }

  // ---- ambiente isolado
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-bling-teste-'));
  const porta = await portaLivre();
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: `file:${path.join(pasta, 'teste.db').replace(/\\/g, '/')}`,
    STORAGE_DIR: path.join(pasta, 'storage'),
    PORT: String(porta),
    HOST: '127.0.0.1',
    NODE_ENV: 'development',
    TZ: 'America/Sao_Paulo',
    SITE_SINCRONIZAR: '0',
    SITE_CHAVE_INTEGRACAO: 'chave-de-teste-do-pdv-do-site-1234567890',
    JWT_SECRET: 'teste-jwt-secret-com-mais-de-trinta-e-dois-caracteres-ok',
    APP_SECRET: 'teste-app-secret-com-mais-de-trinta-e-dois-caracteres-ok',
    APP_URL: `http://127.0.0.1:${porta}`,
    // o Robô da Saúde só roda quando o teste pede (senão corrige sozinho o que outro teste está conferindo)
    ROBO_SAUDE: 'off',
    // idem o JARVIS: a rodada de 30 min só acontece quando o teste manda
    JARVIS: 'off',
  };
  const base = `http://127.0.0.1:${porta}`;
  console.log(`\nBanco de teste: ${pasta} · API de teste: ${base}`);
  rodar('Banco de teste (prisma db push)', NPX, ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], { env });
  rodar('Dados de exemplo (seed --demo)', NPX, ['tsx', 'prisma/seed.ts', '--demo'], { env });

  const log = fs.openSync(path.join(pasta, 'api.log'), 'w');
  const api = spawn(NPX, ['tsx', 'src/server.ts'], { cwd: API, env: { ...process.env, ...env }, stdio: ['ignore', log, log], shell: process.platform === 'win32' });
  let subiu = false;
  for (let i = 0; i < 90 && !subiu; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    subiu = await fetch(`${base}/api/v1/saude`).then((r) => r.ok).catch(() => false);
  }
  if (!subiu) {
    resultados.push({ nome: 'Subir a API de teste', ok: false, segundos: 90, detalhe: fs.readFileSync(path.join(pasta, 'api.log'), 'utf8').slice(-2000) });
  } else {
    rodar('Fluxo completo de ponta a ponta (1ª rodada)', NPX, ['tsx', 'scripts/smoke.ts', base]);
    rodar('Fluxo completo (2ª rodada no mesmo banco: numeração/duplicidade)', NPX, ['tsx', 'scripts/smoke.ts', base]);
    rodar('Perfis de acesso', NPX, ['tsx', 'scripts/teste-perfis.ts', base]);
    rodar('Vendas por vendedor: cada vendedor/técnico só vê as próprias vendas, sem total da loja; gerente e ADMIN veem todas', NPX, ['tsx', 'testes/vendas-por-vendedor.ts', base]);
    rodar('Regras de vendas, painel, metas e desafios', NPX, ['tsx', 'testes/regras-vendas.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Baixa parcial de contas a pagar (pagar em partes, histórico, estorno de um pagamento)', NPX, ['tsx', 'testes/baixa-parcial.ts', base]);
    rodar('OS: custos internos (peça, logística, terceiros) fora da impressão + dashboard de assistência', NPX, ['tsx', 'testes/os-custos.ts', base]);
    rodar('Vendas: custo do produto e logística internos (fora do cliente) + ordem do contas a pagar', NPX, ['tsx', 'testes/venda-custos.ts', base]);
    rodar('Venda paga na hora entra no caixa + ajuste de saldo fora do DRE + DRE', NPX, ['tsx', 'testes/pago-na-hora.ts', base]);
    rodar('Empréstimos (Lumicred): repasse, cliente paga direto, capital de giro, cancelar; DRE só com juros', NPX, ['tsx', 'testes/emprestimos.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Crédito bancário como forma de pagamento: venda (cliente ou loja paga) e compra geram o empréstimo', NPX, ['tsx', 'testes/credito-bancario.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Carnê próprio: PIX no Cora, risco 7–15%, auditoria, venda no carnê, receber, DRE e impressão', NPX, ['tsx', 'testes/carnes.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Consignação: contrato, assinatura pelo celular, desconto autorizado, venda na hora, diárias em dias úteis, quitação, retirada e vitrine do site', NPX, ['tsx', 'testes/consignacao.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Caixinhas (Nubank): por dia, sugestão de hoje, guardar/retirar fora do DRE + avisos do gestor', NPX, ['tsx', 'testes/caixinhas.ts', base]);
    rodar('Meu Dashboard: vendedor/técnico sem lucro, técnico que vende, alertas "Corrija", lembretes, metas e desafios de técnico, ver como', NPX, ['tsx', 'testes/meu-dashboard.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Robô de NF: NCM automático, cliente completo, Pronto pra NF, emitir com um clique, CFOP fora do estado', NPX, ['tsx', 'testes/robo-nf.ts', base]);
    rodar('Documentos da venda: recibo 80mm/A4, certificados de garantia, termo, licenças e versículo', NPX, ['tsx', 'testes/documentos.ts', base]);
    rodar('Porta do site: PDV, JUL.IA (orçamento e pedido em aberto), vendas por dia e por período', NPX, ['tsx', 'testes/integracao-site.ts', base], { env: { TZ: 'America/Sao_Paulo', SITE_CHAVE_INTEGRACAO: env.SITE_CHAVE_INTEGRACAO } });
    rodar('API externa: chaves, permissões, MCP para agentes de IA e webhooks', NPX, ['tsx', 'testes/api-externa.ts', base]);
    rodar('API externa: varredura — toda rota aberta para chave está documentada', NPX, ['tsx', 'testes/api-cobertura.ts'], { env });
    if (!RAPIDO) rodar('Telas no navegador (todas as páginas × perfis + celular)', NPX, ['tsx', 'testes/telas.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    if (!RAPIDO) rodar('Layout em celular, tablet e computador (nada vaza da tela ou do card)', NPX, ['tsx', 'testes/layout.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Robô da Saúde: corrige sozinho, sugere com 1 clique, ignora, só ADMIN', NPX, ['tsx', 'testes/robo-saude.ts', base], { env: { DATABASE_URL: env.DATABASE_URL, TZ: 'America/Sao_Paulo' } });
    rodar('Lembretes de custo: OS com os campos da venda, lembrete ao fechar, robô avisa técnicos e vendedores, DRE', NPX, ['tsx', 'testes/lembretes-custo.ts', base], { env: { DATABASE_URL: env.DATABASE_URL, TZ: 'America/Sao_Paulo' } });
    rodar('JARVIS: caixa livre, regras, sugestões (aceitar/adiar/recusar), feed por perfil, só ADMIN', NPX, ['tsx', 'testes/jarvis.ts', base], { env: { DATABASE_URL: env.DATABASE_URL, TZ: 'America/Sao_Paulo' } });
    rodar('Robô de e-mail dos bancos: parsers reais (SumUp/Asaas), trava de DKIM, baixa 1:1, senha mascarada, só ADMIN', NPX, ['tsx', 'testes/email-banco.ts', base], { env: { DATABASE_URL: env.DATABASE_URL, TZ: 'America/Sao_Paulo' } });
    rodar('Chat da equipe: direta, sala privada, áudio, lida, WebSocket/polling, chamadas de voz e vídeo, push, ADMIN lê tudo', NPX, ['tsx', 'testes/chat.ts', base]);
    rodar('Painel de auditoria: senha do dia, trilha antes/depois (itens e cascata), ao vivo, funcionários, reversão e refazer, agentes', NPX, ['tsx', 'testes/auditoria.ts', base], { env: { TZ: 'America/Sao_Paulo' } });
    rodar('Links: todo link do sistema leva a uma tela que existe', NPX, ['tsx', 'testes/links.ts', base]);
    rodar('Integridade dos dados depois dos testes (Saúde do sistema)', NPX, ['tsx', 'testes/integridade.ts', base]);
    // por último: manda lixo em todas as rotas (pode bagunçar os dados de teste)
    rodar('Robustez: todas as rotas da API com dados errados e sem login (nunca 500)', NPX, ['tsx', 'testes/robustez.ts'], { env });

    // erros não tratados no log da API durante os testes
    const textoLog = fs.readFileSync(path.join(pasta, 'api.log'), 'utf8');
    const graves = textoLog.split('\n').filter((l) => /"level":50|"level":60|Unhandled|TypeError|ReferenceError/.test(l) && !/"statusCode":4\d\d/.test(l));
    resultados.push({ nome: 'Log da API sem erros internos (500)', ok: graves.length === 0, segundos: 0, detalhe: graves.slice(0, 8).map((l) => l.slice(0, 400)).join('\n') });
  }
  api.kill();
  if (process.platform === 'win32' && api.pid) spawnSync('taskkill', ['/pid', String(api.pid), '/T', '/F']);

  // ---- resumo
  console.log('\n\x1b[1m════════ RESUMO DOS TESTES ════════\x1b[0m');
  for (const r of resultados) console.log(`${r.ok ? '\x1b[32m✔' : '\x1b[31m✖'} ${r.nome}\x1b[0m ${r.segundos ? `(${r.segundos}s)` : ''}${!r.ok && r.detalhe ? `\n${r.detalhe}` : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${falhas ? '\x1b[31m' : '\x1b[32m'}${resultados.length - falhas}/${resultados.length} etapas ok em ${Math.round((Date.now() - inicio) / 1000)}s\x1b[0m`);
  if (!MANTER && !falhas) fs.rmSync(pasta, { recursive: true, force: true });
  else console.log(`Arquivos do teste (banco e log da API): ${pasta}`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
