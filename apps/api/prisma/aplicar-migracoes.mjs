/**
 * Aplica o schema no start/deploy sem apagar dados.
 *
 * O histórico do Prisma não cobre o banco inteiro: a loja nasceu com `db push`.
 * As pastas em prisma/migrations são incrementais. Este script:
 *
 * 1. Marca como já aplicada (`migrate resolve --applied`) a migração cujo efeito
 *    já está no arquivo, para o Prisma não recriar nem dropar tabela.
 * 2. Roda `prisma migrate deploy`, que executa só o que falta — em especial
 *    `ALTER TABLE Usuario ADD COLUMN telefone` (coluna opcional; as linhas ficam).
 * 3. Roda `prisma db push` sem `--accept-data-loss` para o resto do schema,
 *    que ainda não tem migração. Se a mudança apagaria dados, o comando para
 *    e o banco fica como está.
 *
 * Nunca usa `migrate reset`, `db push --force-reset` nem `--accept-data-loss`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prismaDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(prismaDir, '..');

const CRIAR = '20261031120000_lancamentos_automaticos';
const TRANSFERIR = '20261031140000_lancamentos_transferencia_importacao';
const TELEFONE = '20261031140000_usuario_telefone';

/** Colunas que a migração de transferência copia antes de trocar a tabela. */
const COLUNAS_ANTIGAS = [
  'id', 'tipo', 'data', 'valor', 'contaFinanceiraId', 'contraparte', 'contraparteChave', 'categoriaId',
  'emailOrigemId', 'emailOrigemUrl', 'descricao', 'botNome', 'chaveApiId', 'status', 'movimentoId',
  'confiadoPorId', 'confiadoEm', 'contestadoPorId', 'contestadoEm', 'observacaoContestacao', 'criadoEm', 'atualizadoEm',
];

/** Colunas novas dessa migração. Se já existem, recriar a tabela jogaria o valor fora. */
const COLUNAS_NOVAS = [
  'contaDestinoId', 'jaLancado', 'movimentoEntradaId', 'contaPagarId', 'contaReceberId',
  'contaPagarCanceladaId', 'requerEstornoManual',
];

export function classificarLancamento(nomes) {
  if (!nomes) return 'ausente';
  const set = new Set(nomes);
  if (COLUNAS_NOVAS.every((c) => set.has(c))) return 'novo';
  const soAntigas = nomes.every((c) => COLUNAS_ANTIGAS.includes(c));
  const temTodasAntigas = COLUNAS_ANTIGAS.every((c) => set.has(c));
  if (soAntigas && temTodasAntigas) return 'antigo';
  return 'inesperado';
}

function carregarEnv() {
  if (process.env.DATABASE_URL) return;
  const arquivo = path.join(apiDir, '.env');
  if (!existsSync(arquivo)) return;
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    const s = linha.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const chave = s.slice(0, i).trim();
    if (process.env[chave] !== undefined) continue;
    let valor = s.slice(i + 1).trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    process.env[chave] = valor;
  }
}

function arquivoDoBanco() {
  carregarEnv();
  const url = (process.env.DATABASE_URL || 'file:../data/meubling.db').trim();
  if (!/^file:/i.test(url)) {
    console.error('[banco] DATABASE_URL precisa ser um arquivo SQLite (file:).');
    process.exit(1);
  }
  let spec = url.replace(/^file:/i, '');
  const q = spec.indexOf('?');
  if (q >= 0) spec = spec.slice(0, q);
  try {
    spec = decodeURIComponent(spec);
  } catch {
    console.error('[banco] DATABASE_URL do SQLite está ilegível.');
    process.exit(1);
  }
  if (spec.startsWith('//')) spec = spec.replace(/^\/\/(?:localhost)?/, '');
  if (!path.isAbsolute(spec)) spec = path.resolve(prismaDir, spec);
  return spec;
}

function prisma(args) {
  console.log(`[banco] npx prisma ${args.join(' ')}`);
  const r = spawnSync('npx', ['--no-install', 'prisma', ...args], {
    cwd: apiDir,
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error) {
    console.error('[banco]', r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    if (args[0] === 'db' && args[1] === 'push') {
      console.error('[banco] parei para não apagar dados. Não use --accept-data-loss.');
    }
    process.exit(r.status ?? 1);
  }
}

function abrir(DatabaseSync, arquivo) {
  if (!existsSync(arquivo) || statSync(arquivo).size === 0) return null;
  try {
    return new DatabaseSync(arquivo, { readOnly: true, timeout: 10000 });
  } catch (e) {
    console.error('[banco] não consegui ler o arquivo do banco:', e.message);
    process.exit(1);
  }
}

function tabela(db, nome) {
  return !!db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).get(nome);
}

function colunas(db, nome) {
  return db.prepare(`SELECT name FROM pragma_table_info('${nome}')`).all().map((r) => r.name);
}

function historico(db) {
  const aplicadas = new Set();
  const falhas = new Set();
  if (!tabela(db, '_prisma_migrations')) return { aplicadas, falhas };
  for (const r of db.prepare(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`).all()) {
    if (r.finished_at && !r.rolled_back_at) aplicadas.add(r.migration_name);
    else if (!r.rolled_back_at) falhas.add(r.migration_name);
  }
  return { aplicadas, falhas };
}

function lerEstado(DatabaseSync, arquivo) {
  const db = abrir(DatabaseSync, arquivo);
  if (!db) return null;
  try {
    const usuario = tabela(db, 'Usuario');
    const nomes = tabela(db, 'LancamentoAutomatico') ? colunas(db, 'LancamentoAutomatico') : null;
    const { aplicadas, falhas } = historico(db);
    return {
      usuario,
      telefone: usuario && colunas(db, 'Usuario').includes('telefone'),
      formato: classificarLancamento(nomes),
      aplicadas,
      falhas,
    };
  } finally {
    db.close();
  }
}

function resolver(nome) {
  console.log(`[banco] já está no banco, sem rodar de novo: ${nome}`);
  prisma(['migrate', 'resolve', '--applied', nome]);
}

const ehPrincipal = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ehPrincipal) {
  process.on('warning', (w) => {
    if (w.name === 'ExperimentalWarning') return;
    console.warn(w.stack || w.message);
  });
  const { DatabaseSync } = await import('node:sqlite');
  const arquivo = arquivoDoBanco();
  mkdirSync(path.dirname(arquivo), { recursive: true });

  let estado = lerEstado(DatabaseSync, arquivo);
  if (!estado?.usuario) {
    console.log('[banco] schema base ainda não existe — db push em banco vazio (não há linha para apagar)');
    prisma(['db', 'push', '--skip-generate']);
    estado = lerEstado(DatabaseSync, arquivo);
    if (!estado?.usuario) {
      console.error('[banco] o schema não ficou pronto.');
      process.exit(1);
    }
  }

  if (estado.falhas.has(CRIAR) || estado.falhas.has(TRANSFERIR)) {
    console.error('[banco] uma migração de lançamento ficou pela metade. O banco não foi resetado. Use a cópia de antes do deploy se precisar voltar.');
    process.exit(1);
  }
  if (estado.falhas.has(TELEFONE)) {
    if (estado.telefone) resolver(TELEFONE);
    else {
      console.log('[banco] a migração do telefone falhou antes de criar a coluna; vou tentar de novo');
      prisma(['migrate', 'resolve', '--rolled-back', TELEFONE]);
    }
    estado = lerEstado(DatabaseSync, arquivo);
  }

  if (estado.formato === 'ausente' && estado.telefone) {
    console.log('[banco] lançamentos ainda sem tabela e o telefone já existe — db push cria a tabela final, sem DROP');
    prisma(['db', 'push', '--skip-generate']);
    estado = lerEstado(DatabaseSync, arquivo);
  }

  const marcar = [];
  if (estado.formato === 'novo') {
    marcar.push(CRIAR, TRANSFERIR);
  } else if (estado.formato === 'inesperado') {
    console.log('[banco] LancamentoAutomatico não está no formato da migração. Não vou recriar a tabela.');
    marcar.push(CRIAR, TRANSFERIR);
  } else if (estado.formato === 'antigo') {
    console.log('[banco] LancamentoAutomatico no formato anterior: a migração copia as linhas e acrescenta colunas.');
    marcar.push(CRIAR);
  }
  if (estado.telefone) marcar.push(TELEFONE);

  for (const nome of marcar) {
    if (!estado.aplicadas.has(nome)) resolver(nome);
  }

  console.log('[banco] prisma migrate deploy — aplica Usuario.telefone se a coluna ainda não existe');
  prisma(['migrate', 'deploy']);
  prisma(['db', 'push', '--skip-generate']);

  estado = lerEstado(DatabaseSync, arquivo);
  if (!estado?.telefone) {
    console.error('[banco] Usuario.telefone não ficou criada.');
    process.exit(1);
  }
  console.log('[banco] Usuario.telefone pronta. Nenhum reset, nenhum --accept-data-loss.');
}
