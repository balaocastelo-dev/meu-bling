/**
 * Fábrica do provedor Open Finance: Pluggy quando `openFinanceAtivo` e credenciais
 * configuradas; caso contrário, provedor simulado (mock).
 */
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { env } from '../../lib/env.js';
import { ProvedorPluggy } from './pluggy.js';
import { ProvedorMock } from './mock.js';
import type { ProvedorOpenFinance } from './provedor.js';

let cache: { chave: string; provedor: ProvedorOpenFinance } | null = null;

export async function statusOpenFinance() {
  const e = await prisma.empresa.findUnique({
    where: { id: 1 },
    select: { openFinanceAtivo: true, openFinanceClientId: true, openFinanceClientSecret: true, openFinanceProvedor: true },
  });
  const configurado = !!(e?.openFinanceClientId && e?.openFinanceClientSecret);
  const ativo = !!e?.openFinanceAtivo && configurado;
  return { ativo, configurado, provedor: ativo ? e?.openFinanceProvedor || 'pluggy' : 'mock', clientId: e?.openFinanceClientId || null };
}

export async function obterProvedor(): Promise<ProvedorOpenFinance> {
  const st = await statusOpenFinance();
  if (!st.ativo) {
    if (!cache || cache.chave !== 'mock') cache = { chave: 'mock', provedor: new ProvedorMock() };
    return cache.provedor;
  }
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { openFinanceClientId: true, openFinanceClientSecret: true } });
  const secret = decrypt(e!.openFinanceClientSecret) || '';
  const chave = `pluggy:${e!.openFinanceClientId}:${secret.slice(-4)}`;
  if (!cache || cache.chave !== chave) {
    cache = { chave, provedor: new ProvedorPluggy(e!.openFinanceClientId!, secret, `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/pluggy`) };
  }
  return cache.provedor;
}

export function limparCacheProvedor() {
  cache = null;
}

export type { ProvedorOpenFinance, ContaOpenFinance, TransacaoOpenFinance } from './provedor.js';
