/**
 * NCM AUTOMÁTICO do robô de NF.
 *
 * Três camadas, da mais confiável para a menos:
 *  1. HISTÓRICO  — o NCM com que o próprio produto já saiu em nota AUTORIZADA (inclusive as do Bling).
 *  2. MESMO NOME — outro produto com o mesmo nome e NCM conferido.
 *  3. REGRAS     — pelo nome/categoria (notebook, celular, cabo HDMI...). Vira "SUGERIDO":
 *                  o produto só fica pronto para a NF depois que alguém confirma uma vez.
 *
 * As camadas 1 e 2 são gravadas como HISTORICO (confiável, não pede confirmação).
 * NCM errado dá multa, por isso o robô NUNCA troca um NCM que alguém digitou.
 */
import type { Db } from '../comum/nfe.js';
import { somenteDigitos } from '../../lib/util.js';

export interface SugestaoNcm {
  ncm: string;
  origem: 'HISTORICO' | 'SUGERIDO';
  /** de onde veio, em português (vai para a tela e para o log do robô) */
  motivo: string;
}

/** minúsculas, sem acento, só letras/números separados por espaço */
export function normalizar(t: string | null | undefined): string {
  return (t || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Regra {
  ncm: string;
  rotulo: string;
  /** testado no texto normalizado (nome + categoria) */
  teste: RegExp;
  /** se casar, a regra NÃO vale (ex.: "case" de gabinete × capinha) */
  exceto?: RegExp;
}

/**
 * Tabela de NCM dos produtos mais comuns da loja. Vale a palavra que aparece PRIMEIRO no nome
 * ("Notebook Dell 8GB SSD" é notebook; "SSD para notebook" é SSD; "Capinha iPhone" é capinha).
 * Empate na mesma posição: vale a regra que vem antes na lista (peças/acessórios antes dos aparelhos).
 * Tudo que sai daqui é SUGERIDO — confirme com o contador os casos de dúvida.
 */
export const REGRAS_NCM: Regra[] = [
  // ---- acessórios de celular / tablet
  { ncm: '39269090', rotulo: 'capa / capinha', teste: /\b(capa|capinha|capas|capinhas|bumper)\b|\bcase\b(?=.*\b(iphone|celular|galaxy|redmi|moto|xiaomi|samsung|ipad|tablet|airpods)\b)/ },
  { ncm: '70071900', rotulo: 'película de vidro', teste: /\bpelicula\b.*\bvidro\b|\bvidro\b.*\bpelicula\b|\bpelicula 3d\b/ },
  { ncm: '39199000', rotulo: 'película plástica / hidrogel', teste: /\bpelicula\b/ },
  { ncm: '85444200', rotulo: 'cabo com conector', teste: /^cabo\b/ },
  { ncm: '85044010', rotulo: 'carregador', teste: /\b(carregador|carregadores|fonte usb|fonte de celular|power adapter|adaptador de energia)\b/, exceto: /\bnotebook\b|\bmacbook\b|\bportatil\b(?!.*celular)|\bpower ?bank\b/ },
  { ncm: '85044090', rotulo: 'carregador de notebook', teste: /\b(carregador|fonte)\b.*\b(notebook|macbook|laptop)\b|\b(notebook|macbook|laptop)\b.*\b(carregador|fonte)\b/ },
  { ncm: '85076000', rotulo: 'bateria de lítio / power bank', teste: /\b(bateria|power ?bank|carregador portatil)\b/, exceto: /\bpilha\b/ },
  { ncm: '85444200', rotulo: 'cabo com conector', teste: /\bcabo\b/, exceto: /\bcabo de aco\b/ },
  { ncm: '85183000', rotulo: 'fone de ouvido / headset', teste: /\b(fone|fones|headset|headphone|earphone|earbuds?|airpods|auricular)\b/ },
  { ncm: '85182200', rotulo: 'caixa de som', teste: /\b(caixa de som|caixinha de som|speaker|soundbar|jbl (go|flip|charge|clip|boombox|partybox))\b/ },
  { ncm: '85181090', rotulo: 'microfone', teste: /\bmicrofone\b/ },
  // ---- peças de celular (assistência)
  { ncm: '85177900', rotulo: 'tela/peça de celular', teste: /\b(tela|display|frontal|touch|lcd|oled|tampa traseira|flex|conector de carga)\b.*\b(iphone|celular|galaxy|redmi|moto|xiaomi|samsung)\b|\b(iphone|celular|galaxy|redmi|moto|xiaomi|samsung)\b.*\b(tela|display|frontal|touch|lcd|oled|tampa traseira|flex|conector de carga)\b/ },
  // ---- periféricos
  { ncm: '84716052', rotulo: 'teclado', teste: /\bteclado\b/ },
  { ncm: '84716053', rotulo: 'mouse', teste: /\bmouse\b/, exceto: /\bmouse ?pad\b/ },
  { ncm: '85258929', rotulo: 'webcam', teste: /\bwebcam\b|\bweb cam\b/ },
  { ncm: '85285220', rotulo: 'monitor', teste: /\bmonitor\b/, exceto: /\bmonitor de (pressao|glicose|bebe)\b|\bsuporte\b/ },
  { ncm: '85287200', rotulo: 'televisor', teste: /\b(smart ?tv|televisor|televisao)\b|\btv \d{2}\b/ },
  // ---- armazenamento / memória / componentes
  { ncm: '85235110', rotulo: 'SSD / pendrive / cartão de memória', teste: /\b(ssd|nvme|pen ?drive|cartao de memoria|micro ?sd|memoria flash)\b/ },
  { ncm: '84717012', rotulo: 'HD (disco rígido)', teste: /\b(hd|hdd|disco rigido)\b/, exceto: /\bhdmi\b/ },
  { ncm: '84733042', rotulo: 'memória RAM', teste: /\bmemoria\b.*\b(ram|ddr\d|dimm|sodimm)\b|\b(ddr3|ddr4|ddr5)\b/ },
  { ncm: '84733041', rotulo: 'placa-mãe', teste: /\bplaca ?mae\b|\bmotherboard\b/ },
  { ncm: '84718000', rotulo: 'placa de vídeo', teste: /\bplaca de video\b|\b(geforce|radeon)\b|\b(rtx|gtx|rx) ?\d{3,4}\b/ },
  { ncm: '85423190', rotulo: 'processador', teste: /\bprocessador\b|\bryzen [3579]\b|\bcore i[3579]\b/, exceto: /\bnotebook\b|\bcomputador\b|\bpc\b|\bdesktop\b/ },
  { ncm: '84733090', rotulo: 'gabinete', teste: /\bgabinete\b/ },
  { ncm: '84733099', rotulo: 'cooler / ventoinha', teste: /\b(cooler|water ?cooler|ventoinha|fan)\b/ },
  { ncm: '85044090', rotulo: 'fonte de computador', teste: /\bfonte\b/ },
  { ncm: '85044040', rotulo: 'nobreak', teste: /\b(nobreak|no break|ups)\b/ },
  { ncm: '90328911', rotulo: 'estabilizador', teste: /\bestabilizador\b/ },
  // ---- rede
  { ncm: '85176277', rotulo: 'roteador / repetidor wi-fi', teste: /\b(roteador|router|repetidor|access point|wi ?fi mesh|mesh)\b/ },
  // ---- games
  { ncm: '95045000', rotulo: 'console / controle de videogame', teste: /\b(playstation|ps[45]|xbox|nintendo|console|joystick|gamepad|controle (ps\d|xbox|dualsense|dualshock|sem fio|gamer))\b/ },
  // ---- aparelhos (por último)
  { ncm: '85176277', rotulo: 'smartwatch / pulseira inteligente', teste: /\b(smartwatch|apple watch|relogio inteligente|smart ?band|mi band|galaxy watch|galaxy fit)\b/ },
  { ncm: '84713012', rotulo: 'notebook / tablet', teste: /\b(notebook|laptop|macbook|chromebook|ultrabook|tablet|ipad|galaxy tab|redmi pad|xiaomi pad|lenovo tab)\b/ },
  { ncm: '84714190', rotulo: 'computador all-in-one', teste: /\b(all in one|allinone|imac)\b/ },
  { ncm: '84715010', rotulo: 'computador / desktop', teste: /\b(computador|desktop|pc gamer|mac mini|mini pc|cpu completa)\b/ },
  { ncm: '85171300', rotulo: 'celular / smartphone', teste: /\b(celular|smartphone|iphone|galaxy [asmz]\d*|redmi|poco|moto [eg]\d*|motorola|xiaomi)\b/ },
];

/** Acessórios genéricos que a tabela não sabe classificar: o robô não chuta, pede para alguém informar. */
const NAO_CHUTAR = /^(suporte|mochila|bolsa|maleta|base|adaptador|hub|dock|limpa|kit limpeza|mouse ?pad|caneta|stylus|lapis|tripe|ring light|organizador|servico|mao de obra)\b/;

function melhorRegra(texto: string): Regra | null {
  let melhor: { r: Regra; pos: number } | null = null;
  for (const r of REGRAS_NCM) {
    const m = r.teste.exec(texto);
    if (!m || (r.exceto && r.exceto.test(texto))) continue;
    if (!melhor || m.index < melhor.pos) melhor = { r, pos: m.index };
  }
  return melhor?.r ?? null;
}

/** Só pela tabela (nome; se o nome não diz, a categoria). null se nenhuma regra serve. */
export function ncmPorRegra(nome: string, categoria?: string | null): { ncm: string; rotulo: string } | null {
  const texto = normalizar(nome);
  if (!texto || NAO_CHUTAR.test(texto)) return null;
  const r = melhorRegra(texto) ?? (categoria ? melhorRegra(normalizar(categoria)) : null);
  return r ? { ncm: r.ncm, rotulo: r.rotulo } : null;
}

export const ncmValido = (v: string | null | undefined) => {
  const d = somenteDigitos(v);
  return d.length === 8 && d !== '00000000';
};

/** Descobre o NCM de um produto (não grava nada). */
export async function sugerirNcm(db: Db, produto: { id: number; nome: string; categoria?: { nome: string } | null }): Promise<SugestaoNcm | null> {
  // 1. histórico: NCM com que este produto já saiu em nota autorizada
  const itens = await db.notaFiscalItem.findMany({
    where: { produtoId: produto.id, nota: { situacao: { in: ['AUTORIZADA', 'CANCELADA'] } } },
    select: { ncm: true },
    take: 50,
    orderBy: { id: 'desc' },
  });
  const contagem = new Map<string, number>();
  for (const i of itens) {
    const d = somenteDigitos(i.ncm);
    if (ncmValido(d)) contagem.set(d, (contagem.get(d) || 0) + 1);
  }
  if (contagem.size) {
    const [ncm, vezes] = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0];
    return { ncm, origem: 'HISTORICO', motivo: `NCM das notas já autorizadas deste produto (${vezes} nota${vezes > 1 ? 's' : ''})` };
  }

  // 2. outro produto com o MESMO nome e NCM conferido (digitado, do Bling ou confirmado)
  const nomeNorm = normalizar(produto.nome);
  if (nomeNorm.length >= 6) {
    const parecidos = await db.produto.findMany({
      where: { id: { not: produto.id }, ncm: { not: null }, nome: produto.nome.trim() },
      select: { nome: true, ncm: true, ncmOrigem: true },
      take: 10,
    });
    const igual = parecidos.find((p) => normalizar(p.nome) === nomeNorm && ncmValido(p.ncm) && p.ncmOrigem !== 'SUGERIDO');
    if (igual) return { ncm: somenteDigitos(igual.ncm), origem: 'HISTORICO', motivo: 'mesmo NCM de outro produto com o mesmo nome' };
  }

  // 3. regras pelo nome/categoria → precisa de confirmação
  const r = ncmPorRegra(produto.nome, produto.categoria?.nome);
  if (r) return { ncm: r.ncm, origem: 'SUGERIDO', motivo: `pelo tipo de produto (${r.rotulo})` };
  return null;
}

/** 84713012 → 8471.30.12 */
export function formatarNcm(ncm: string | null | undefined): string {
  const d = somenteDigitos(ncm);
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
}
