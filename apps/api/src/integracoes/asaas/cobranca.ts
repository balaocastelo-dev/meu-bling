/**
 * ASAAS — cobrança a partir do pedido de venda (boleto, PIX ou cartão).
 *
 * Fluxo: a venda tem cliente e valor → o sistema garante o cliente no Asaas (pelo CPF/CNPJ)
 * → cria a cobrança → guarda o id e o link (`invoiceUrl`) na venda. O vendedor manda o link
 * ao cliente pelo WhatsApp sem sair do pedido.
 *
 * A chave de API fica em Configurações → Asaas, criptografada na Empresa (nunca no código).
 * Enquanto não houver chave, tudo aqui responde com uma mensagem dizendo onde colar.
 */
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { arredondar, somenteDigitos } from '../../lib/util.js';

const BASES = { producao: 'https://api.asaas.com/v3', sandbox: 'https://api-sandbox.asaas.com/v3' };

export type FormaAsaas = 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED';

interface ConfigAsaas {
  chave: string;
  base: string;
}

async function config(): Promise<ConfigAsaas> {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { asaasApiKey: true, asaasAmbiente: true } });
  const chave = decrypt(e?.asaasApiKey) || process.env.ASAAS_API_KEY || '';
  if (!chave) {
    throw new AppError('Asaas não configurado: cole a chave de API em Configurações → Asaas.', 422, 'ASAAS_SEM_CHAVE', { link: '/configuracoes/asaas' });
  }
  const base = BASES[(e?.asaasAmbiente as keyof typeof BASES) || 'producao'] || BASES.producao;
  return { chave, base };
}

/** Diz se a loja já tem chave de API salva (usado pela tela e pela venda, sem estourar erro). */
export async function asaasConfigurado(): Promise<boolean> {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { asaasApiKey: true } });
  return !!(decrypt(e?.asaasApiKey) || process.env.ASAAS_API_KEY);
}

async function chamar<T = any>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { chave, base } = await config();
  let r: Response;
  try {
    r = await fetch(`${base}${caminho}`, {
      method: init.method || 'GET',
      headers: { access_token: chave, 'content-type': 'application/json', accept: 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) {
    throw new AppError(`Não consegui falar com o Asaas (${e?.message || 'sem resposta'}). Tente de novo.`, 502, 'ASAAS_FORA');
  }
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) throw new AppError('O Asaas recusou a chave de API. Confira em Configurações → Asaas.', 422, 'ASAAS_CHAVE', { link: '/configuracoes/asaas' });
    const descricao = json?.errors?.[0]?.description || json?.message || `erro ${r.status}`;
    throw new AppError(`O Asaas recusou: ${descricao}`, 502, 'ASAAS_ERRO');
  }
  return json as T;
}

/** Testa a chave (GET /myAccount) — usado no botão "Testar" da tela de configuração. */
export async function testarChaveAsaas() {
  const j = await chamar<any>('/myAccount');
  return { conta: j?.name || j?.email || j?.id || 'conta Asaas', email: j?.email ?? null };
}

/**
 * Garante o cliente no Asaas: procura pelo CPF/CNPJ e cria se não existir.
 * O Asaas exige nome e documento válidos — sem eles a cobrança não é aceita.
 */
async function clienteAsaas(c: { nome: string; documento: string | null; email: string | null; celular: string | null; cep: string | null; logradouro: string | null; numero: string | null; bairro: string | null; municipio: string | null; uf: string | null }): Promise<string> {
  const doc = somenteDigitos(c.documento || '');
  if (doc.length !== 11 && doc.length !== 14) {
    throw new AppError(`${c.nome} está sem CPF/CNPJ válido — o Asaas exige o documento para gerar a cobrança.`, 422, 'ASAAS_CLIENTE_SEM_DOC');
  }
  const achados = await chamar<any>(`/customers?cpfCnpj=${doc}`);
  const existente = achados?.data?.[0]?.id;
  if (existente) return String(existente);
  const novo = await chamar<any>('/customers', {
    method: 'POST',
    body: {
      name: c.nome,
      cpfCnpj: doc,
      email: c.email || undefined,
      mobilePhone: somenteDigitos(c.celular || '') || undefined,
      postalCode: somenteDigitos(c.cep || '') || undefined,
      address: c.logradouro || undefined,
      addressNumber: c.numero || undefined,
      province: c.bairro || undefined,
    },
  });
  if (!novo?.id) throw new AppError('O Asaas não devolveu o cliente criado.', 502, 'ASAAS_ERRO');
  return String(novo.id);
}

export interface CobrancaAsaas {
  id: string;
  url: string;
  valor: number;
  status: string;
  vencimento: string;
  /** linha digitável do boleto, quando houver */
  linhaDigitavel?: string | null;
}

/**
 * Cria a cobrança no Asaas para uma venda e guarda o resultado no pedido.
 * `parcelas` > 1 divide no cartão/boleto pelo próprio Asaas (parcelamento do cliente).
 */
export async function gerarCobrancaDaVenda(vendaId: number, p: { forma?: FormaAsaas; vencimento?: Date; parcelas?: number; descricao?: string } = {}): Promise<CobrancaAsaas> {
  const v = await prisma.venda.findUnique({
    where: { id: vendaId },
    select: {
      id: true,
      numero: true,
      tipo: true,
      total: true,
      asaasCobrancaId: true,
      asaasLinkUrl: true,
      contato: { select: { nome: true, documento: true, email: true, celular: true, cep: true, logradouro: true, numero: true, bairro: true, municipio: true, uf: true } },
    },
  });
  if (!v) throw new AppError('Pedido não encontrado.', 404, 'VENDA');
  if (v.tipo === 'ORCAMENTO') throw new AppError('Orçamento não gera cobrança: converta em pedido antes.', 422, 'ASAAS_ORCAMENTO');
  const valor = arredondar(v.total);
  if (!(valor > 0)) throw new AppError('O pedido precisa ter valor maior que zero para gerar a cobrança.', 422, 'ASAAS_VALOR');

  // já existe: devolve a mesma em vez de cobrar o cliente duas vezes
  if (v.asaasCobrancaId) {
    const atual = await chamar<any>(`/payments/${v.asaasCobrancaId}`).catch(() => null);
    if (atual?.id && atual.status !== 'DELETED') {
      await prisma.venda.update({ where: { id: v.id }, data: { asaasStatus: atual.status } });
      return { id: String(atual.id), url: atual.invoiceUrl, valor: Number(atual.value), status: atual.status, vencimento: atual.dueDate, linhaDigitavel: atual.identificationField ?? null };
    }
  }

  const customer = await clienteAsaas(v.contato);
  const vencimento = p.vencimento ?? new Date();
  const dueDate = vencimento.toISOString().slice(0, 10);
  const parcelas = Math.max(1, Math.min(21, Math.round(p.parcelas || 1)));
  const corpo: Record<string, unknown> = {
    customer,
    billingType: p.forma || 'UNDEFINED', // UNDEFINED = o cliente escolhe boleto, PIX ou cartão
    value: valor,
    dueDate,
    description: p.descricao || `Pedido nº ${v.numero}`,
    externalReference: `venda-${v.id}`,
  };
  if (parcelas > 1) {
    corpo.installmentCount = parcelas;
    corpo.totalValue = valor;
    delete corpo.value;
  }
  const j = await chamar<any>('/payments', { method: 'POST', body: corpo });
  if (!j?.invoiceUrl) throw new AppError('O Asaas não devolveu o link da cobrança.', 502, 'ASAAS_ERRO');

  await prisma.venda.update({
    where: { id: v.id },
    data: { asaasCobrancaId: String(j.id), asaasLinkUrl: j.invoiceUrl, asaasStatus: j.status, asaasEm: new Date() },
  });
  return { id: String(j.id), url: j.invoiceUrl, valor: Number(j.value ?? valor), status: j.status, vencimento: j.dueDate, linhaDigitavel: j.identificationField ?? null };
}

/** Relê o status da cobrança no Asaas e atualiza a venda (usado pelo botão "Atualizar"). */
export async function atualizarCobrancaDaVenda(vendaId: number) {
  const v = await prisma.venda.findUnique({ where: { id: vendaId }, select: { asaasCobrancaId: true } });
  if (!v?.asaasCobrancaId) throw new AppError('Este pedido ainda não tem cobrança no Asaas.', 422, 'ASAAS_SEM_COBRANCA');
  const j = await chamar<any>(`/payments/${v.asaasCobrancaId}`);
  await prisma.venda.update({ where: { id: vendaId }, data: { asaasStatus: j.status } });
  return { id: String(j.id), url: j.invoiceUrl, valor: Number(j.value), status: j.status, vencimento: j.dueDate, linhaDigitavel: j.identificationField ?? null };
}

/** Cancela (remove) a cobrança no Asaas — por exemplo quando a venda é cancelada. */
export async function cancelarCobrancaDaVenda(vendaId: number) {
  const v = await prisma.venda.findUnique({ where: { id: vendaId }, select: { asaasCobrancaId: true } });
  if (!v?.asaasCobrancaId) return { ok: true };
  await chamar(`/payments/${v.asaasCobrancaId}`, { method: 'DELETE' }).catch(() => undefined);
  await prisma.venda.update({ where: { id: vendaId }, data: { asaasStatus: 'DELETED' } });
  return { ok: true };
}

/**
 * Gera a cobrança sozinho ao finalizar a venda, quando ligado em Configurações → Asaas.
 * Nunca derruba a venda: se o Asaas falhar, a venda continua e o erro fica no log.
 */
export async function cobrancaAutomatica(vendaId: number): Promise<CobrancaAsaas | null> {
  const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { asaasCobrancaAuto: true } });
  if (!e?.asaasCobrancaAuto) return null;
  if (!(await asaasConfigurado())) return null;
  return gerarCobrancaDaVenda(vendaId).catch(() => null);
}
