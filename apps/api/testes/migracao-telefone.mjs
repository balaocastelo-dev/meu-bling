/**
 * Prova que o start aplica Usuario.telefone sem apagar linha.
 * Rode na pasta apps/api: node testes/migracao-telefone.mjs
 *
 * Não usa o banco de verdade. Cada caso é um arquivo temporário.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { classificarLancamento } from '../prisma/aplicar-migracoes.mjs';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAIZ = path.resolve(API, '../..');
let falhas = 0;

function verifica(cond, msg, extra) {
  if (cond) console.log(`  ok  ${msg}`);
  else {
    falhas++;
    console.error(`  FALHOU  ${msg}${extra !== undefined ? ` — ${extra}` : ''}`);
  }
}

function abrir(arquivo) {
  return new DatabaseSync(arquivo);
}

function colunas(db, tabela) {
  return db.prepare(`SELECT name FROM pragma_table_info('${tabela}')`).all().map((r) => r.name);
}

function aplicar(arquivo) {
  return spawnSync('node', ['prisma/aplicar-migracoes.mjs'], {
    cwd: API,
    env: { ...process.env, DATABASE_URL: `file:${arquivo}`, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
    timeout: 180000,
  });
}

function usuario(db) {
  return db.prepare(`SELECT id, nome, email, senhaHash, telefone FROM Usuario ORDER BY id`).all();
}

function semHistorico(db) {
  db.exec(`DROP TABLE IF EXISTS _prisma_migrations`);
}

const script = readFileSync(path.join(API, 'prisma/aplicar-migracoes.mjs'), 'utf8');
const docker = readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');
const vps = readFileSync(path.join(RAIZ, 'deploy/vps/instalar-vps.sh'), 'utf8');
const sql = readFileSync(path.join(API, 'prisma/migrations/20261031140000_usuario_telefone/migration.sql'), 'utf8');
const chamadas = [...script.matchAll(/prisma\(\[([\s\S]*?)\]\)/g)].map((m) => m[1]);

verifica(chamadas.some((c) => c.includes("'migrate', 'deploy'")), 'o start chama prisma migrate deploy');
verifica(chamadas.every((c) => !c.includes('accept-data-loss') && !c.includes('force-reset') && !c.includes("'reset'")), 'nenhuma chamada aceita perda de dados nem reset');
verifica(!docker.includes('accept-data-loss') && !docker.includes('migrate reset') && !docker.includes('force-reset'), 'a imagem não reseta o banco');
verifica(docker.includes('prisma/aplicar-migracoes.mjs'), 'a imagem aplica as migrações ao subir');
verifica(vps.includes('prisma/aplicar-migracoes.mjs') && !vps.includes('db push --skip-generate'), 'o deploy da VPS testa a mesma aplicação, numa cópia');
verifica(sql.includes('ADD COLUMN "telefone" TEXT') && !/DROP\s+TABLE/i.test(sql), 'a migração do telefone só acrescenta a coluna');
verifica(classificarLancamento(null) === 'ausente', 'sem tabela de lançamento');
verifica(classificarLancamento(['id', 'contaDestinoId', 'jaLancado', 'movimentoEntradaId', 'contaPagarId', 'contaReceberId', 'contaPagarCanceladaId', 'requerEstornoManual', 'extra']) === 'novo', 'formato novo não é recriado');
verifica(classificarLancamento(['id', 'extra']) === 'inesperado', 'coluna desconhecida não entra na cópia');

function caso(nome, fn) {
  console.log(`\n${nome}`);
  const pasta = mkdtempSync(path.join(tmpdir(), 'mb-mig-'));
  const arquivo = path.join(pasta, 't.db');
  try {
    fn(arquivo);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

caso('banco vazio: cria a coluna e registra a migração', (arquivo) => {
  const r = aplicar(arquivo);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  verifica(r.status === 0, 'aplicou no banco vazio', r.status);
  const db = abrir(arquivo);
  verifica(colunas(db, 'Usuario').includes('telefone'), 'Usuario.telefone existe');
  const hist = db.prepare(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all().map((x) => x.migration_name);
  verifica(hist.includes('20261031140000_usuario_telefone'), 'migração do telefone registrada', hist.join(','));
  db.close();
});

caso('banco que já tem gente, sem a coluna: a pessoa continua e o celular fica vazio', (arquivo) => {
  let r = aplicar(arquivo);
  verifica(r.status === 0, 'schema inicial', r.status);
  const db = abrir(arquivo);
  db.prepare(`INSERT INTO Usuario (nome, email, senhaHash, perfil, ativo, telefone, criadoEm, atualizadoEm) VALUES (?, ?, ?, 'TECNICO', 1, ?, datetime('now'), datetime('now'))`).run('Marina', 'marina@balao.info', 'hash-marina', '(19) 98888-7777');
  db.prepare(`INSERT INTO ContaFinanceira (nome) VALUES ('Caixa')`).run();
  db.prepare(`INSERT INTO LancamentoAutomatico (
      tipo, data, valor, contraparte, contraparteChave, emailOrigemId, botNome, descricao, jaLancado, contaDestinoId, criadoEm, atualizadoEm
    ) VALUES ('SAIDA', datetime('now'), 99, 'Loja', 'loja', 'email-novo', 'bot', 'ja no formato novo', 1, 1, datetime('now'), datetime('now'))`).run();
  db.exec(`ALTER TABLE Usuario DROP COLUMN telefone`);
  semHistorico(db);
  db.close();

  r = aplicar(arquivo);
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  verifica(r.status === 0, 'deploy no banco que já tinha usuário', r.status);
  verifica((r.stdout || '').includes('Applying migration') && (r.stdout || '').includes('20261031140000_usuario_telefone'), 'migrate deploy executou o ALTER do telefone');
  const db2 = abrir(arquivo);
  const linhas = usuario(db2);
  verifica(linhas.length === 1 && linhas[0].nome === 'Marina' && linhas[0].email === 'marina@balao.info' && linhas[0].senhaHash === 'hash-marina', 'a linha da Marina ficou inteira', JSON.stringify(linhas));
  verifica(linhas[0]?.telefone == null, 'celular novo nasce vazio', linhas[0]?.telefone);
  const hist = db2.prepare(`SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name = '20261031140000_usuario_telefone'`).get();
  verifica(!!hist?.finished_at, 'prisma migrate deploy registrou a coluna');
  const lanc = db2.prepare(`SELECT valor, descricao, jaLancado, contaDestinoId FROM LancamentoAutomatico WHERE emailOrigemId = 'email-novo'`).get();
  verifica(lanc?.valor === 99 && lanc?.descricao === 'ja no formato novo' && lanc?.jaLancado === 1 && lanc?.contaDestinoId === 1, 'lançamento novo não foi recriado', JSON.stringify(lanc));
  db2.close();
});

caso('celular já preenchido: rodar de novo não apaga o número', (arquivo) => {
  let r = aplicar(arquivo);
  verifica(r.status === 0, 'schema inicial', r.status);
  const db = abrir(arquivo);
  db.prepare(`INSERT INTO Usuario (nome, email, senhaHash, perfil, ativo, telefone, criadoEm, atualizadoEm) VALUES (?, ?, ?, 'ADMIN', 1, ?, datetime('now'), datetime('now'))`).run('Administrador', 'admin@balao.info', 'hash-admin', '(19) 98888-7777');
  db.close();
  r = aplicar(arquivo);
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  verifica(r.status === 0, 'segunda subida', r.status);
  const db2 = abrir(arquivo);
  const linhas = usuario(db2);
  verifica(linhas.length === 1 && linhas[0].telefone === '(19) 98888-7777', 'o WhatsApp continua (19) 98888-7777', linhas[0]?.telefone);
  db2.close();
});

caso('lançamento no formato antigo: a linha é copiada e o usuário continua', (arquivo) => {
  let r = aplicar(arquivo);
  verifica(r.status === 0, 'schema inicial', r.status);
  const db = abrir(arquivo);
  db.exec(`PRAGMA foreign_keys = OFF`);
  db.prepare(`INSERT INTO Usuario (nome, email, senhaHash, perfil, ativo, criadoEm, atualizadoEm) VALUES ('Marina', 'marina@balao.info', 'hash-marina', 'TECNICO', 1, datetime('now'), datetime('now'))`).run();
  db.prepare(`INSERT INTO ContaFinanceira (nome, tipo, saldoInicial, saldoAtual, ativo) VALUES ('Caixa', 'CAIXA', 0, 0, 1)`).run();
  db.exec(`DROP TABLE LancamentoAutomatico`);
  const criar = readFileSync(path.join(API, 'prisma/migrations/20261031120000_lancamentos_automaticos/migration.sql'), 'utf8');
  db.exec(criar);
  db.prepare(`INSERT INTO LancamentoAutomatico (
      tipo, data, valor, contaFinanceiraId, contraparte, contraparteChave, emailOrigemId, botNome, status, descricao, criadoEm, atualizadoEm
    ) VALUES ('SAIDA', datetime('now'), 42.5, 1, 'Fornecedor', 'fornecedor', 'email-1', 'bot', 'PENDENTE', 'compra de cabo', datetime('now'), datetime('now'))`).run();
  db.exec(`ALTER TABLE Usuario DROP COLUMN telefone`);
  semHistorico(db);
  db.close();

  r = aplicar(arquivo);
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  verifica(r.status === 0, 'deploy com lançamento antigo', r.status);
  const db2 = abrir(arquivo);
  const u = usuario(db2);
  const lanc = db2.prepare(`SELECT valor, descricao, emailOrigemId FROM LancamentoAutomatico`).all();
  verifica(u.length === 1 && u[0].nome === 'Marina' && u[0].senhaHash === 'hash-marina', 'usuário preservado', JSON.stringify(u));
  verifica(colunas(db2, 'Usuario').includes('telefone') && u[0].telefone == null, 'telefone acrescentado sem valor inventado');
  verifica(lanc.length === 1 && lanc[0].valor === 42.5 && lanc[0].descricao === 'compra de cabo' && lanc[0].emailOrigemId === 'email-1', 'lançamento copiado, não apagado', JSON.stringify(lanc));
  verifica(colunas(db2, 'LancamentoAutomatico').includes('contaDestinoId'), 'colunas novas do lançamento entraram');
  db2.close();
});

caso('coluna que não está no schema não é apagada', (arquivo) => {
  let r = aplicar(arquivo);
  verifica(r.status === 0, 'schema inicial', r.status);
  const db = abrir(arquivo);
  db.exec(`ALTER TABLE LancamentoAutomatico ADD COLUMN legado TEXT`);
  db.prepare(`INSERT INTO LancamentoAutomatico (
      tipo, data, valor, contraparte, contraparteChave, emailOrigemId, botNome, descricao, legado, criadoEm, atualizadoEm
    ) VALUES ('SAIDA', datetime('now'), 7, 'X', 'x', 'e-legado', 'bot', 'nota', 'guardar', datetime('now'), datetime('now'))`).run();
  db.close();
  r = aplicar(arquivo);
  if (r.status !== 0) {
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
  }
  const db2 = abrir(arquivo);
  const tem = colunas(db2, 'LancamentoAutomatico').includes('legado');
  const row = tem ? db2.prepare(`SELECT legado, valor FROM LancamentoAutomatico WHERE emailOrigemId = 'e-legado'`).get() : null;
  verifica(tem && row?.legado === 'guardar' && row?.valor === 7, 'coluna fora do schema continua no arquivo', JSON.stringify({ status: r.status, row }));
  db2.close();
});

console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
