/**
 * MERCADO PAGO — link de pagamento (Checkout Pro).
 * O vendedor gera o link dentro do pedido; o cliente paga no cartão (até 12x) ou PIX pelo Mercado Pago.
 * Os juros do parcelamento são sempre do cliente. Não há escolha de parcelas sem juros.
 * Token: Configurações → Mercado Pago (Access Token de produção, guardado criptografado na Empresa).
 */
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';

const API = 'https://api.mercadopago.com';

export interface CorpoPreferencia {
  items: { id: string; title: string; quantity: number; currency_id: 'BRL'; unit_price: number }[];
  external_reference: string;
  statement_descriptor: string;
  payment_methods: { installments: number };
  payer?: { email: string; name?: string };
}

/** Monta o JSON da preferência: até 12x, sem metadata. Os juros ficam com o cliente. */
export function montarCorpoPreferencia(p: { referencia: string; titulo: string; valor: number; email?: string | null; nome?: string | null; parcelasMax?: number }): CorpoPreferencia {
  return {
    items: [{ id: p.referencia, title: p.titulo.slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: p.valor }],
    external_reference: p.referencia,
    statement_descriptor: 'BALAO INFO',
    payment_methods: { installments: p.parcelasMax ?? 12 },
    ...(p.email ? { payer: { email: p.email, name: p.nome || undefined } } : {}),
  };
}

export async function tokenMercadoPago(): Promise<string | null> {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { mercadoPagoAccessToken: true } });
  return decrypt(e?.mercadoPagoAccessToken) || process.env.MERCADOPAGO_ACCESS_TOKEN || null;
}

export interface LinkGerado {
  url: string;
  id: string;
  valor: number;
  /** preenchido só na simulação de teste — o JSON que iria ao Mercado Pago, sem cobrança */
  preferencia?: CorpoPreferencia;
}

/** Cria a preferência de pagamento no Mercado Pago e devolve o link (init_point). */
export async function criarLinkPagamento(p: {
  referencia: string;
  titulo: string;
  valor: number;
  email?: string | null;
  nome?: string | null;
  parcelasMax?: number;
  /** só com MERCADOPAGO_MOCK=1 (testes): não chama o Mercado Pago */
  simulacao?: boolean;
}): Promise<LinkGerado> {
  const simular = p.simulacao === true && process.env.MERCADOPAGO_MOCK === '1';
  // no caminho real o token vem antes do valor, como sempre. A simulação não chama o Mercado Pago.
  const token = simular ? null : await tokenMercadoPago();
  if (!simular && !token) throw new AppError('Mercado Pago não configurado: cole o Access Token em Configurações → Mercado Pago.', 422, 'MERCADOPAGO_SEM_TOKEN', { link: '/configuracoes/mercado-pago' });
  const valor = arredondar(p.valor);
  if (!(valor > 0)) throw new AppError('Valor do link deve ser maior que zero.', 422, 'VALOR_INVALIDO');
  const corpo = montarCorpoPreferencia({ ...p, valor });
  if (simular) {
    return {
      url: `https://simulacao.local/mercadopago/${p.referencia}`,
      id: `simulacao-${p.referencia}`,
      valor,
      preferencia: corpo,
    };
  }
  if (!token) throw new AppError('Mercado Pago não configurado: cole o Access Token em Configurações → Mercado Pago.', 422, 'MERCADOPAGO_SEM_TOKEN', { link: '/configuracoes/mercado-pago' });
  let r: Response;
  try {
    r = await fetch(`${API}/checkout/preferences`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-idempotency-key': `${p.referencia}-${valor}-${Date.now()}` },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) {
    throw new AppError(`Não consegui falar com o Mercado Pago (${e?.message || 'sem resposta'}). Tente de novo.`, 502, 'MERCADOPAGO_FORA');
  }
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new AppError('O Mercado Pago recusou o Access Token. Confira em Configurações → Mercado Pago.', 422, 'MERCADOPAGO_TOKEN', { link: '/configuracoes/mercado-pago' });
    throw new AppError(`Mercado Pago recusou o link: ${json?.message || r.status}`, 502, 'MERCADOPAGO_ERRO');
  }
  const url = json.init_point || json.sandbox_init_point;
  if (!url) throw new AppError('O Mercado Pago não devolveu o link de pagamento.', 502, 'MERCADOPAGO_ERRO');
  return { url, id: String(json.id), valor };
}

/** Testa o token (GET /users/me) — usado na tela de configuração. */
export async function testarTokenMercadoPago() {
  const token = await tokenMercadoPago();
  if (!token) throw new AppError('Cole o Access Token e salve antes de testar.', 422, 'MERCADOPAGO_SEM_TOKEN');
  const r = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r) throw new AppError('Não consegui falar com o Mercado Pago.', 502, 'MERCADOPAGO_FORA');
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new AppError('Token inválido ou sem permissão.', 422, 'MERCADOPAGO_TOKEN');
  return { conta: j.nickname || j.email || String(j.id), email: j.email ?? null };
}
