/**
 * VITRINE DA EQUIPE — peças usadas pelas telas de anúncio (ver docs/VITRINE-EQUIPE.md).
 *
 * Um anúncio é a vitrine de um produto ou serviço com DONO: o técnico ganha 33% do lucro e o
 * vendedor 20%. O percentual fica congelado no anúncio, então o que foi combinado na criação é o
 * que continua valendo — por isso a tela mostra o percentual do anúncio, não a regra de hoje.
 */
import { toast } from 'sonner';

export interface RetornoAnuncio {
  /** vendas e OS que vieram deste anúncio */
  vendas: number;
  /** lucro que o anúncio trouxe para a loja (base da comissão) */
  lucroGerado: number;
  comissaoTotal: number;
  comissaoPaga: number;
  comissaoAReceber: number;
}

export interface ProdutoDoAnuncio {
  id: number;
  nome: string;
  codigo?: string | null;
  preco: number;
  precoCusto: number;
  /** 'P' = produto · 'S' = serviço */
  tipo: string;
  imagemUrl: string | null;
  garantiaDias: number;
  ativo?: boolean;
  controlaEstoque: boolean;
}

export interface Anuncio {
  id: number;
  codigo: string;
  titulo: string;
  descricao: string | null;
  /** uma ou mais URLs de foto separadas por vírgula */
  fotos: string | null;
  produtoId: number;
  donoTipo: 'VENDEDOR' | 'TECNICO';
  comissaoPct: number;
  precoAPartirDe: number | null;
  prazoDias: number | null;
  naVitrine: boolean;
  ativo: boolean;
  visitas: number;
  criadoEm?: string;
  produto: ProdutoDoAnuncio;
  vendedor: { id: number; nome: string } | null;
  tecnico: { id: number; nome: string } | null;
  retorno: RetornoAnuncio;
}

export interface RespostaAnuncios {
  data: Anuncio[];
  /** quanto EU ganho por anúncio novo (33 técnico · 20 vendedor); null = sem cadastro de dono */
  meuPercentual: number | null;
  souDono: 'TECNICO' | 'VENDEDOR' | null;
}

export interface ComissaoDoAnuncio {
  id: number;
  descricao: string;
  /** lucro da venda/OS sobre o qual o percentual incidiu */
  base: number;
  pct: number;
  valor: number;
  status: string;
  competencia: string;
  criadoEm: string;
  vendaId: number | null;
  osId: number | null;
}

/** Fotos do anúncio (ou a imagem do produto, que é o que a vitrine mostra quando não há foto própria). */
export function fotosDe(a: Pick<Anuncio, 'fotos' | 'produto'>): string[] {
  const lista = (a.fotos || '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);
  if (lista.length) return lista;
  return a.produto?.imagemUrl ? [a.produto.imagemUrl] : [];
}

/**
 * Link que o dono manda no WhatsApp. A página /a/<codigo> é do site (www.balao.info), fora do
 * caminho do sistema — é ela que registra de onde o cliente veio.
 */
export function linkDoAnuncio(codigo: string): string {
  return `${location.origin}/a/${codigo}`;
}

export async function copiarLink(codigo: string) {
  try {
    await navigator.clipboard.writeText(linkDoAnuncio(codigo));
    toast.success('Link copiado — cole no WhatsApp do cliente.');
  } catch {
    toast.error('Não deu para copiar o link. Copie da tela.');
  }
}

export function ehServico(a: Pick<Anuncio, 'produto'>): boolean {
  return a.produto?.tipo === 'S';
}

export function nomeDoDono(a: Pick<Anuncio, 'donoTipo' | 'vendedor' | 'tecnico'>): string {
  return a.tecnico?.nome ?? a.vendedor?.nome ?? (a.donoTipo === 'TECNICO' ? 'técnico' : 'vendedor');
}

export function rotuloDono(tipo: 'TECNICO' | 'VENDEDOR'): string {
  return tipo === 'TECNICO' ? 'Técnico' : 'Vendedor';
}

/** A frase que faz a pessoa querer publicar. */
export function frasePercentual(pct: number): string {
  return `Você ganha ${pct}% do lucro de cada venda deste anúncio.`;
}
