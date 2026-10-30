/**
 * PARSERS DOS AVISOS DE BANCO POR E-MAIL
 *
 * Cada parser recebe o texto limpo de um e-mail e devolve o evento financeiro
 * que ele descreve — ou null, quando aquele e-mail não é um aviso de dinheiro
 * (propaganda, aviso de manutenção, pesquisa de satisfação).
 *
 * Regra de ouro: na dúvida, devolver null. É melhor o robô deixar o aviso como
 * pendência para alguém olhar do que inventar um lançamento no caixa.
 */

export interface EventoBancario {
  /** identificador estável do evento, para não importar o mesmo aviso duas vezes */
  externalId: string;
  data: Date;
  descricao: string;
  /** positivo = entrou na conta; negativo = saiu */
  valor: number;
  tipo: 'CREDITO' | 'DEBITO';
  /** quem pagou ou recebeu */
  contraparte?: string | null;
  /** número de pedido/cobrança citado no aviso, quando houver (casa direto, sem adivinhar) */
  referencia?: string | null;
  /** juros/multa embutidos no valor, quando o aviso informa */
  juros?: number | null;
  bruto?: unknown;
}

export type NomeParser =
  | 'SUMUP_PIX'
  | 'SUMUP_PAYOUT'
  | 'CORA'
  | 'ASAAS'
  | 'MERCADOPAGO'
  | 'BOLETO_FORNECEDOR';

/** "2.000,00" -> 2000, "39,00" -> 39, "300.90" -> 300.9 */
export function valorBr(texto: string): number | null {
  if (!texto) return null;
  // tira pontuação solta nas pontas ("R$ 2.000,00," -> "2.000,00")
  const limpo = texto.trim().replace(/\s/g, '').replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!/\d/.test(limpo)) return null;
  // formato brasileiro: ponto é milhar, vírgula é decimal
  const br = limpo.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(br)) return null;
  const n = Number(br);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * "28/10/2026" + "17:33:40" -> Date no fuso do servidor (America/Sao_Paulo em produção).
 * Os avisos dizem "horário de Brasília", que é o fuso em que o sistema roda.
 */
export function dataHoraBr(data: string, hora?: string | null): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.trim());
  if (!m) return null;
  const [, d, mes, ano] = m;
  let h = 0, min = 0, s = 0;
  if (hora) {
    const mh = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hora.trim());
    if (mh) {
      h = Number(mh[1]);
      min = Number(mh[2]);
      s = Number(mh[3] || 0);
    }
  }
  const dt = new Date(Number(ano), Number(mes) - 1, Number(d), h, min, s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Tira a formatação de tabela do HTML convertido e normaliza espaços. */
export function limpar(texto: string): string {
  return (texto || '')
    .replace(/\|/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ') // links markdown
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza o remetente para comparar com a regra:
 * "cobrancas+5357164@asaas.com" -> "cobrancas@asaas.com"
 * Devolve também o domínio, para regras por domínio ("@cora.com.br").
 */
export function normalizarRemetente(de: string): { endereco: string; dominio: string } {
  const bruto = (de || '').toLowerCase();
  const m = /<([^>]+)>/.exec(bruto);
  const end = (m ? m[1] : bruto).trim();
  const semTag = end.replace(/\+[^@]*@/, '@');
  const dominio = semTag.includes('@') ? '@' + semTag.split('@')[1] : '';
  return { endereco: semTag, dominio };
}

// ---------------------------------------------------------------------------
// SumUp — Pix recebido e Pix enviado (texto no corpo, com hora cravada)
// ---------------------------------------------------------------------------

const SUMUP_RECEBIDO =
  /Pix de (.+?) no valor de R\$\s*([\d.,]*\d)[,.]?\s*em (\d{2}\/\d{2}\/\d{4})\s*às\s*(\d{2}:\d{2}:\d{2})/i;
const SUMUP_ENVIADO =
  /Pix que você fez para (.+?) no valor de R\$\s*([\d.,]*\d)[,.]?\s*em (\d{2}\/\d{2}\/\d{4})\s*às\s*(\d{2}:\d{2}:\d{2})/i;

export function parseSumUpPix(texto: string, messageId: string): EventoBancario | null {
  const t = limpar(texto);

  const env = SUMUP_ENVIADO.exec(t);
  if (env) {
    const [, para, valorTxt, data, hora] = env;
    const valor = valorBr(valorTxt);
    const dt = dataHoraBr(data, hora);
    if (valor === null || !dt) return null;
    return {
      externalId: `sumup:pix:${messageId}`,
      data: dt,
      descricao: `Pix enviado para ${para.trim()}`,
      valor: -valor,
      tipo: 'DEBITO',
      contraparte: para.trim(),
      bruto: { parser: 'SUMUP_PIX', direcao: 'ENVIADO' },
    };
  }

  const rec = SUMUP_RECEBIDO.exec(t);
  if (rec) {
    const [, de, valorTxt, data, hora] = rec;
    const valor = valorBr(valorTxt);
    const dt = dataHoraBr(data, hora);
    if (valor === null || !dt) return null;
    return {
      externalId: `sumup:pix:${messageId}`,
      data: dt,
      descricao: `Pix recebido de ${de.trim()}`,
      valor,
      tipo: 'CREDITO',
      contraparte: de.trim(),
      bruto: { parser: 'SUMUP_PIX', direcao: 'RECEBIDO' },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Asaas — cobrança confirmada (traz cliente, juros e o número do pedido)
// ---------------------------------------------------------------------------

export function parseAsaas(texto: string, messageId: string, assunto = ''): EventoBancario | null {
  const t = limpar(texto);

  // só confirmação de pagamento vira lançamento; "não registramos o pagamento" é cobrança, não dinheiro
  if (!/pagamento\s+da\s+cobran[çc]a\s+#?\s*\d+\s+foi\s+confirmado/i.test(t)) return null;

  const cobranca = /cobran[çc]a\s+#?\s*(\d+)/i.exec(t)?.[1] ?? /Fatura\s+(\d+)/i.exec(assunto)?.[1] ?? null;
  const valor = valorBr(/Valor\s+R\$\s*([\d.,]*\d)/i.exec(t)?.[1] ?? '');
  const juros = valorBr(/Juros e multa\s+R\$\s*([\d.,]*\d)/i.exec(t)?.[1] ?? '');
  const cliente = /Cliente\s+(.+?)\s+Forma de pagamento/i.exec(t)?.[1]?.trim() ?? null;
  const confirmado = /Confirmado em\s+(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1] ?? null;
  const pedido = /Pedido\s+(\d+)/i.exec(t)?.[1] ?? null;

  if (valor === null) return null;
  const dt = confirmado ? dataHoraBr(confirmado) : null;
  if (!dt) return null;

  return {
    externalId: cobranca ? `asaas:cobranca:${cobranca}` : `asaas:msg:${messageId}`,
    data: dt,
    descricao: `Asaas — cobrança ${cobranca ?? 's/n'} confirmada${cliente ? ` (${cliente})` : ''}`,
    valor,
    tipo: 'CREDITO',
    contraparte: cliente,
    referencia: pedido ? `Pedido ${pedido}` : cobranca,
    juros: juros ?? null,
    bruto: { parser: 'ASAAS', cobranca, pedido },
  };
}

// ---------------------------------------------------------------------------
// Despachante
// ---------------------------------------------------------------------------

export function aplicarParser(
  parser: NomeParser,
  texto: string,
  messageId: string,
  assunto = '',
): EventoBancario | null {
  switch (parser) {
    case 'SUMUP_PIX':
      return parseSumUpPix(texto, messageId);
    case 'ASAAS':
      return parseAsaas(texto, messageId, assunto);
    // Parsers ainda sem amostra real do corpo: o robô registra o e-mail como
    // SEM_DADOS para alguém olhar, em vez de adivinhar valores.
    case 'SUMUP_PAYOUT':
    case 'CORA':
    case 'MERCADOPAGO':
    case 'BOLETO_FORNECEDOR':
      return null;
    default:
      return null;
  }
}
