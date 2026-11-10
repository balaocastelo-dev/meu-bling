/**
 * Descobre, pelo nome/categoria do produto, se o item da venda ganha CERTIFICADO DE GARANTIA
 * (PC, PC Gamer, Notebook, iPhone, Games), se é seminovo e qual o prazo de garantia.
 */
import { normalizar } from '../robo-nf/ncm.js';
import { GARANTIA_NOVO_MESES, GARANTIA_SEMINOVO_MESES } from './config.js';

export type TipoCertificado = 'PC' | 'PC_GAMER' | 'NOTEBOOK' | 'IPHONE' | 'GAMES';

/** peças e acessórios: nunca ganham certificado, mesmo citando "notebook", "PC" ou "iPhone" no nome */
const ACESSORIO = /^(gabinete|fonte|placa|memoria|ssd|hd|cooler|water|cabo|capa|capinha|case|pelicula|carregador|bateria|tela|display|frontal|teclado|mouse|suporte|mochila|bolsa|maleta|controle|joystick|headset|fone|adaptador|hub|dock|base|kit|pasta|processador|monitor|webcam|caixa|jogo|game pass|cartao|gift|skin|pen ?drive)\b/;

export function tipoCertificado(nome: string, categoria?: string | null): TipoCertificado | null {
  const n = normalizar(nome);
  const cat = normalizar(categoria);
  if (!n || ACESSORIO.test(n)) return null;
  const t = `${n} ${cat}`;
  if (/\biphone\b/.test(n)) return 'IPHONE';
  if (/\b(notebook|laptop|macbook|chromebook|ultrabook)\b/.test(n)) return 'NOTEBOOK';
  if (/\b(playstation|ps[45]|xbox|nintendo switch|switch (oled|lite|2)|console|steam deck|rog ally|legion go)\b/.test(n)) return 'GAMES';
  const ehPc = /\b(pc|computador|desktop|cpu completa|mini pc|all in one|imac|mac mini|mac studio|workstation)\b/.test(n);
  if (ehPc && /\bgamer\b|\b(rtx|gtx|rx) ?\d{3,4}\b|\bgeforce\b|\bradeon\b/.test(t)) return 'PC_GAMER';
  if (ehPc) return 'PC';
  // categoria explícita e nome sem cara de acessório
  if (/\bpc gamer\b/.test(cat)) return 'PC_GAMER';
  if (/\b(computadores|desktops?)\b/.test(cat)) return 'PC';
  if (/\bnotebooks?\b/.test(cat)) return 'NOTEBOOK';
  if (/\b(consoles?|videogames?)\b/.test(cat)) return 'GAMES';
  return null;
}

export function ehSeminovo(nome: string, categoria?: string | null): boolean {
  return /\b(semi ?nov[oa]s?|usad[oa]s?|recondicionad[oa]s?|vitrine|open ?box|refurb\w*|mostruario|reembalad[oa])\b/.test(normalizar(`${nome} ${categoria || ''}`));
}

export interface Garantia {
  meses: number | null;
  dias: number;
  /** "12 meses", "3 meses", "90 dias" */
  texto: string;
  validaAte: Date;
  /** true quando o prazo veio da escolha do vendedor, e não da regra automática */
  escolhido?: boolean;
}

/** Prazos que o vendedor pode escolher no certificado (confirmação antes de imprimir). */
export const PRAZOS_GARANTIA = [3, 6, 12] as const;
export type PrazoGarantia = (typeof PRAZOS_GARANTIA)[number];

export function prazoGarantiaValido(v: unknown): v is PrazoGarantia {
  return PRAZOS_GARANTIA.includes(v as PrazoGarantia);
}

/**
 * Prazo de garantia do item.
 *
 * Manda primeiro o que o VENDEDOR escolheu na hora de imprimir o certificado
 * (`escolhidoMeses`: 3, 6 ou 12) — é ele que está com o cliente e sabe o que foi
 * combinado. Sem escolha, vale a regra da loja: aparelho com certificado 12 meses
 * (novo) / 3 meses (seminovo); seminovo em geral 3 meses; o resto, o cadastro do produto.
 */
export function garantiaDoItem(
  dataVenda: Date,
  tipo: TipoCertificado | null,
  seminovo: boolean,
  garantiaDiasCadastro: number | null | undefined,
  escolhidoMeses?: number | null,
): Garantia {
  let meses: number | null = null;
  let dias = 0;
  if (prazoGarantiaValido(escolhidoMeses)) meses = escolhidoMeses;
  else if (tipo) meses = seminovo ? GARANTIA_SEMINOVO_MESES : GARANTIA_NOVO_MESES;
  else if (seminovo) meses = GARANTIA_SEMINOVO_MESES;
  else {
    dias = Math.max(0, garantiaDiasCadastro ?? 90);
    if (dias && dias % 30 === 0) meses = dias / 30;
  }
  const validaAte = new Date(dataVenda);
  if (meses !== null) validaAte.setMonth(validaAte.getMonth() + meses);
  else validaAte.setDate(validaAte.getDate() + dias);
  if (meses !== null) dias = Math.round((validaAte.getTime() - new Date(dataVenda).getTime()) / 86400000);
  const texto = meses !== null ? (meses === 12 ? '12 meses (1 ano)' : `${meses} ${meses === 1 ? 'mês' : 'meses'}`) : dias ? `${dias} dias` : 'sem garantia';
  return { meses, dias, texto, validaAte, escolhido: prazoGarantiaValido(escolhidoMeses) };
}
