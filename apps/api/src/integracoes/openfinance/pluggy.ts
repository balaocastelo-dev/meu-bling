/**
 * Provedor Open Finance real — Pluggy (https://pluggy.ai) via `pluggy-sdk`.
 * Credenciais: Empresa.openFinanceClientId / openFinanceClientSecret (criptografado).
 */
import { PluggyClient } from 'pluggy-sdk';
import { format } from 'date-fns';
import type { ProvedorOpenFinance, ContaOpenFinance, TransacaoOpenFinance } from './provedor.js';

export class ProvedorPluggy implements ProvedorOpenFinance {
  nome = 'pluggy';
  private client: PluggyClient;

  constructor(clientId: string, clientSecret: string, private webhookUrl?: string) {
    this.client = new PluggyClient({ clientId, clientSecret });
  }

  async connectToken() {
    const r = await this.client.createConnectToken(undefined, {
      webhookUrl: this.webhookUrl,
      clientUserId: 'meu-bling',
      avoidDuplicates: true,
    });
    return { accessToken: r.accessToken };
  }

  async contasDoItem(itemId: string): Promise<ContaOpenFinance[]> {
    const page = await this.client.fetchAccounts(itemId);
    return page.results.map((a) => ({
      id: a.id,
      itemId: a.itemId,
      nome: a.marketingName || a.name,
      tipo: a.type,
      subtipo: a.subtype,
      numero: a.number ?? null,
      saldo: a.balance,
      banco: null,
      agencia: null,
    }));
  }

  async saldo(accountId: string) {
    const a = await this.client.fetchAccount(accountId);
    let status: string | undefined;
    try {
      const item = await this.client.fetchItem(a.itemId);
      status = item.status;
    } catch {
      /* status é informativo */
    }
    return { saldo: a.balance, em: new Date(), status };
  }

  async transacoes(accountId: string, de: Date, ate: Date): Promise<TransacaoOpenFinance[]> {
    const out: TransacaoOpenFinance[] = [];
    const from = format(de, 'yyyy-MM-dd');
    const to = format(ate, 'yyyy-MM-dd');
    let page = 1;
    // paginação clássica (até 500 por página); para em totalPages
    for (let i = 0; i < 50; i++) {
      const r = await this.client.fetchTransactions(accountId, { from, to, page, pageSize: 500 });
      for (const t of r.results) {
        const valor = t.type === 'DEBIT' ? -Math.abs(t.amount) : Math.abs(t.amount);
        out.push({
          externalId: t.id,
          data: new Date(t.date),
          descricao: t.description || t.descriptionRaw || '(sem descrição)',
          valor,
          tipo: valor >= 0 ? 'CREDITO' : 'DEBITO',
          categoria: t.category ?? null,
          bruto: t,
        });
      }
      if (page >= (r.totalPages || 1) || r.results.length === 0) break;
      page += 1;
    }
    return out;
  }

  async conectores() {
    const r = await this.client.fetchConnectors({ countries: ['BR'] } as any);
    return r.results.map((c) => ({ id: c.id, nome: c.name, tipo: String((c as any).type || '') }));
  }
}
