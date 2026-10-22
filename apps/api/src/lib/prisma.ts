import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Banco SQLite (arquivo): quem quer gravar espera o outro terminar em vez de
 * desistir em 5 s ("Socket timeout"). Com o PDV do site gravando vendas enquanto a
 * equipe usa o /sistema, duas gravações ao mesmo tempo passaram a ser normais.
 * `socket_timeout` é o tempo máximo (s) que o SQLite espera o arquivo ficar livre.
 */
function urlDoBanco(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url || !/^file:/i.test(url)) return undefined;
  const extras: string[] = [];
  // uma conexão só: o Prisma enfileira as consultas e o SQLite nunca disputa o arquivo consigo mesmo
  if (!/[?&]connection_limit=/.test(url)) extras.push('connection_limit=1');
  if (!/[?&]socket_timeout=/.test(url)) extras.push('socket_timeout=20');
  if (!extras.length) return undefined;
  return `${url}${url.includes('?') ? '&' : '?'}${extras.join('&')}`;
}

const url = urlDoBanco();
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  ...(url ? { datasources: { db: { url } } } : {}),
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * SQLite em modo WAL: leitura e gravação deixam de se bloquear. O modo fica
 * gravado no arquivo do banco; o backup (deploy/vps/backup.sh) já copia o
 * meubling.db-wal junto.
 */
export async function prepararBanco() {
  if (!/^file:/i.test(process.env.DATABASE_URL || '')) return;
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  } catch (e) {
    console.warn('[banco] não consegui ligar o modo WAL:', (e as Error).message);
  }
}
