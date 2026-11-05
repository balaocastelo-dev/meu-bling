/**
 * Provedor Open Finance SIMULADO — usado quando `openFinanceAtivo=false` ou sem credenciais
 * Pluggy. Gera 2 contas fictícias e transações plausíveis (determinísticas por dia) para
 * que a conciliação bancária funcione sem conta no Pluggy.
 */
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns';
import type { ProvedorOpenFinance, ContaOpenFinance, TransacaoOpenFinance } from './provedor.js';

const CONTAS: ContaOpenFinance[] = [
  { id: 'mock-cc-001', itemId: 'mock', nome: 'Conta Corrente (simulada)', tipo: 'BANK', subtipo: 'CHECKING_ACCOUNT', numero: '12345-6', saldo: 18450.37, banco: 'Banco Simulado', agencia: '0001' },
  { id: 'mock-cc-002', itemId: 'mock', nome: 'Conta Poupança (simulada)', tipo: 'BANK', subtipo: 'SAVINGS_ACCOUNT', numero: '98765-4', saldo: 7300.0, banco: 'Banco Simulado', agencia: '0001' },
];

const DESCRICOES_CREDITO = ['PIX RECEBIDO - CLIENTE', 'TED RECEBIDA', 'CRED. CARTAO VISA', 'CRED. CARTAO MASTER', 'PIX RECEBIDO - VENDA BALCAO', 'DEPOSITO EM DINHEIRO'];
const DESCRICOES_DEBITO = ['PAGTO BOLETO FORNECEDOR', 'TARIFA BANCARIA', 'PIX ENVIADO - PECAS', 'DEB. AUT. ENERGIA', 'PAGTO ALUGUEL', 'DEB. AUT. INTERNET', 'COMPRA CARTAO DEBITO'];

/** gerador pseudo-aleatório determinístico (mulberry32) para reproduzir as mesmas transações */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Acha a conta fictícia mesmo quando o id veio prefixado com o item (`item:mock-cc-001`). */
function contaBase(accountId: string) {
  return CONTAS.find((c) => accountId === c.id || accountId.endsWith(`:${c.id}`)) ?? CONTAS[0];
}

export class ProvedorMock implements ProvedorOpenFinance {
  nome = 'mock';

  async connectToken(_opcoes?: { itemId?: string }) {
    return { accessToken: 'mock-connect-token' };
  }

  async contasDoItem(itemId: string) {
    // Cada conexão (item) tem as próprias contas. No banco de verdade o id da conta
    // muda de um item para outro; se o mock repetisse o mesmo id, a segunda conexão
    // pareceria a mesma conta já vinculada.
    const item = itemId || 'mock';
    return CONTAS.map((c) => ({ ...c, id: `${item}:${c.id}`, itemId: item }));
  }

  async saldo(accountId: string) {
    const c = contaBase(accountId);
    return { saldo: c.saldo, em: new Date(), status: 'UPDATED' };
  }

  async transacoes(accountId: string, de: Date, ate: Date): Promise<TransacaoOpenFinance[]> {
    const out: TransacaoOpenFinance[] = [];
    const base = contaBase(accountId);
    const idx = Math.max(0, CONTAS.findIndex((c) => c.id === base.id));
    const dias = Math.min(120, differenceInCalendarDays(startOfDay(ate), startOfDay(de)));
    for (let i = 0; i <= dias; i++) {
      const dia = addDays(startOfDay(de), i);
      if (dia.getDay() === 0) continue; // domingo sem movimento
      const seed = Number(format(dia, 'yyyyMMdd')) * 10 + idx;
      const rand = rng(seed);
      const qtd = idx === 0 ? 1 + Math.floor(rand() * 3) : rand() < 0.3 ? 1 : 0;
      for (let k = 0; k < qtd; k++) {
        const credito = rand() < 0.6;
        const lista = credito ? DESCRICOES_CREDITO : DESCRICOES_DEBITO;
        const desc = lista[Math.floor(rand() * lista.length)];
        const base = credito ? 80 + rand() * 1500 : 30 + rand() * 900;
        const valor = Math.round(base * 100) / 100;
        out.push({
          externalId: `${accountId}-${format(dia, 'yyyyMMdd')}-${k}`,
          data: new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), 9 + k * 2),
          descricao: `${desc} ${String(Math.floor(rand() * 9000) + 1000)}`,
          valor: credito ? valor : -valor,
          tipo: credito ? 'CREDITO' : 'DEBITO',
          categoria: credito ? 'Receita' : 'Despesa',
          bruto: { simulado: true },
        });
      }
    }
    return out;
  }

  async conectores() {
    return [{ id: 0, nome: 'Banco Simulado (mock)', tipo: 'PERSONAL_BANK' }];
  }
}
