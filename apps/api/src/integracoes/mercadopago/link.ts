/**
 * MERCADO PAGO — link de pagamento (Checkout Pro).
 * O vendedor gera o link dentro do pedido; o cliente paga no cartão (até 12x) ou PIX pelo Mercado Pago.
 * Token: Configurações → Mercado Pago (Access Token de produção, guardado criptografado na Empresa).
 *
 * Parcelas sem juros (juros por conta do vendedor): a API de preferência NÃO tem campo para isso.
 * O que ela aceita em `payment_methods` é o máximo de parcelas (`installments`) e a parcela sugerida
 * (`default_installments`). Quem paga os juros ("parcelado vendedor") é a configuração da conta
 * (Seu negócio → Taxas e parcelas) e vale para todos os links. Por isso o máximo continua 12:
 * 4x, 5x… seguem disponíveis. A escolha da loja (0, 2 ou 3) fica na venda e, quando é 2 ou 3,
 * também no `metadata` da preferência — registro da venda, não uma taxa do Mercado Pago.
 */
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';

const API = 'https://api.mercadopago.com';

/** 0 = nenhuma (juros do cliente). 2 ou 3 = até Nx sem juros; o restante continua com juros do cliente. */
export const PARCELAS_SEM_JUROS = [0, 2, 3] as const;
export type ParcelasSemJuros = (typeof PARCELAS_SEM_JUROS)[number];

export function ehParcelasSemJuros(n: number): n is ParcelasSemJuros {
  return n === 0 || n === 2 || n === 3;
}

export function rotuloParcelasSemJuros(n: number): string {
  if (n === 2) return 'Até 2x sem juros';
  if (n === 3) return 'Até 3x sem juros';
  return 'Nenhum (juros do cliente)';
}

/**
 * Texto para a tela quando a loja pediu sem juros. Com 0 (padrão) não há aviso:
 * o link sai como sempre saiu.
 */
export function avisoParcelasSemJuros(n: number): string | null {
  if (n !== 2 && n !== 3) return null;
  return `O Mercado Pago não marca "até ${n}x sem juros" em um link só: quem paga os juros é a configuração da conta (Seu negócio → Taxas e parcelas). Este link segue até 12x, com 4x, 5x e as demais liberadas. A opção ficou anotada na venda. Enquanto a conta estiver no padrão da loja, o cliente paga os juros em todas as parcelas.`;
}

export interface CorpoPreferencia {
  items: { id: string; title: string; quantity: number; currency_id: 'BRL'; unit_price: number }[];
  external_reference: string;
  statement_descriptor: string;
  payment_methods: { installments: number };
  payer?: { email: string; name?: string };
  /** só quando a loja pede 2x ou 3x sem juros — o Mercado Pago não usa isso para isentar juros */
  metadata?: { parcelas_sem_juros: 2 | 3; juros_ate_n: 'vendedor'; demais_parcelas: 'cliente' };
}

/** Monta o JSON da preferência. Com 0, é o mesmo corpo de sempre (sem metadata). */
export function montarCorpoPreferencia(p: { referencia: string; titulo: string; valor: number; email?: string | null; nome?: string | null; parcelasMax?: number; parcelasSemJuros?: number }): CorpoPreferencia {
  const semJuros = p.parcelasSemJuros ?? 0;
  return {
    items: [{ id: p.referencia, title: p.titulo.slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: p.valor }],
    external_reference: p.referencia,
    statement_descriptor: 'BALAO INFO',
    payment_methods: { installments: p.parcelasMax ?? 12 },
    ...(p.email ? { payer: { email: p.email, name: p.nome || undefined } } : {}),
    ...(semJuros === 2 || semJuros === 3
      ? { metadata: { parcelas_sem_juros: semJuros, juros_ate_n: 'vendedor' as const, demais_parcelas: 'cliente' as const } }
      : {}),
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
  parcelasSemJuros: ParcelasSemJuros;
  resumo: string;
  aviso: string | null;
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
  parcelasSemJuros?: number;
  /** só com MERCADOPAGO_MOCK=1 (testes): não chama o Mercado Pago */
  simulacao?: boolean;
}): Promise<LinkGerado> {
  const valor = arredondar(p.valor);
  if (!(valor > 0)) throw new AppError('Valor do link deve ser maior que zero.', 422, 'VALOR_INVALIDO');
  const parcelasSemJuros = p.parcelasSemJuros ?? 0;
  if (!ehParcelasSemJuros(parcelasSemJuros)) {
    throw new AppError('Escolha "Nenhum (juros do cliente)", "Até 2x sem juros" ou "Até 3x sem juros".', 422, 'PARCELAS_SEM_JUROS');
  }
  const corpo = montarCorpoPreferencia({ ...p, valor, parcelasSemJuros });
  const resumo = rotuloParcelasSemJuros(parcelasSemJuros);
  const aviso = avisoParcelasSemJuros(parcelasSemJuros);
  // simulação: os testes conferem o JSON sem token e sem cobrança real
  if (p.simulacao && process.env.MERCADOPAGO_MOCK === '1') {
    return {
      url: `https://simulacao.local/mercadopago/${p.referencia}`,
      id: `simulacao-${p.referencia}`,
      valor,
      parcelasSemJuros,
      resumo,
      aviso,
      preferencia: corpo,
    };
  }
  const token = await tokenMercadoPago();
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
  return { url, id: String(json.id), valor, parcelasSemJuros, resumo, aviso };
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
