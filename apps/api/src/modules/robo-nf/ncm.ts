/**
 * NCM AUTOMÁTICO do robô de NF.
 *
 * Três camadas, da mais confiável para a menos:
 *  1. HISTÓRICO  — o NCM com que o próprio produto já saiu em nota AUTORIZADA (inclusive as do Bling).
 *  2. MESMO NOME — outro produto com o mesmo nome e NCM conferido.
 *  3. TABELA     — pelo nome/categoria (notebook, celular, cabo HDMI...), pesquisa conferida na tabela
 *                  oficial. Confiança alta → TABELA (vale direto); média → SUGERIDO (confirmar uma vez).
 *
 * HISTORICO e TABELA não pedem confirmação. NCM extinto (SH 2022) é trocado pelo novo como SUGERIDO.
 * NCM errado dá multa, por isso o robô NUNCA troca um NCM que alguém digitou.
 */
import type { Db } from '../comum/nfe.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { somenteDigitos } from '../../lib/util.js';

export interface SugestaoNcm {
  ncm: string;
  /** HISTORICO e TABELA valem direto; SUGERIDO pede confirmação */
  origem: 'HISTORICO' | 'TABELA' | 'SUGERIDO';
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
  /**
   * alta  → vale direto (origem TABELA, não pede confirmação)
   * media → SUGERIDO: alguém da gestão confirma uma vez por produto
   * (pesquisa de 28/10/2026 conferida na tabela NCM oficial — docs/NCM-PESQUISA.md)
   */
  confianca: 'alta' | 'media';
  /** substituição tributária em SP para o varejo (Port. CAT 68/2019, situação em out/2026) — informativo */
  cestSp?: string;
}

/**
 * Tabela de NCM dos produtos da loja (pesquisa 28/10/2026, todos os códigos conferidos na tabela NCM
 * oficial vigente — Res. Gecex 926/2026). Vale a palavra que aparece PRIMEIRO no nome
 * ("Notebook Dell 8GB SSD" é notebook; "SSD para notebook" é SSD; "Capinha iPhone" é capinha).
 * Empate na mesma posição: vale a regra que vem antes na lista (peças/acessórios antes dos aparelhos).
 */
const CELULAR = '(iphone|celular|smartphone|galaxy|redmi|moto|motorola|xiaomi|samsung)';
/** tamanho de tela EXPLÍCITO: 15,6" / 15.6 / 14 pol / 13 polegadas (o texto já vem sem pontuação: "15 6 pol") */
const TELA = (n: string) => `\\b(${n})(( \\d)? (pol|polegadas)\\b| \\d\\b(?! ?(gb|tb|w|ghz|geracao)))`;
export const REGRAS_NCM: Regra[] = [
  // ---- acessórios de celular / tablet
  { ncm: '39269090', rotulo: 'capa / capinha', confianca: 'media', teste: /\b(capa|capinha|capas|capinhas|bumper)\b|\bcase\b(?=.*\b(iphone|celular|galaxy|redmi|moto|xiaomi|samsung|ipad|tablet|airpods)\b)/ },
  { ncm: '70071900', rotulo: 'película de vidro', confianca: 'media', teste: /\bpelicula\b.*\bvidro\b|\bvidro\b.*\bpelicula\b|\bpelicula 3d\b/ },
  { ncm: '39199090', rotulo: 'película plástica / hidrogel', confianca: 'media', teste: /\bpelicula\b/ },
  { ncm: '85444200', rotulo: 'cabo com conector', confianca: 'alta', teste: /^cabo\b/ },
  { ncm: '85044010', rotulo: 'carregador de celular', confianca: 'media', cestSp: '21.037.00', teste: /\b(carregador|carregadores|fonte usb|fonte de celular|power adapter|adaptador de energia)\b/, exceto: /\bnotebook\b|\bmacbook\b|\blaptop\b|\bpower ?bank\b|\bportatil\b/ },
  { ncm: '85044090', rotulo: 'carregador de notebook', confianca: 'media', teste: /\b(carregador|fonte)\b.*\b(notebook|macbook|laptop)\b|\b(notebook|macbook|laptop)\b.*\b(carregador|fonte)\b/ },
  { ncm: '85076000', rotulo: 'bateria de lítio / power bank', confianca: 'alta', teste: /\b(bateria|power ?bank|carregador portatil)\b/, exceto: /\bpilha\b/ },
  { ncm: '85444200', rotulo: 'cabo com conector', confianca: 'alta', teste: /\bcabo\b/, exceto: /\bcabo de aco\b/ },
  { ncm: '85183000', rotulo: 'fone de ouvido / headset', confianca: 'alta', cestSp: '21.057.00', teste: /\b(fone|fones|headset|headphone|earphone|earbuds?|airpods|auricular)\b/ },
  { ncm: '85182200', rotulo: 'caixa de som', confianca: 'media', cestSp: '21.057.00', teste: /\b(caixa de som|caixinha de som|speaker|soundbar|jbl (go|flip|charge|clip|boombox|partybox))\b/ },
  { ncm: '85181090', rotulo: 'microfone', confianca: 'media', cestSp: '21.057.00', teste: /\bmicrofone\b/ },
  // ---- peças de celular (assistência) — desde 2022 a tela tem posição própria (85.24)
  { ncm: '85249100', rotulo: 'tela / display de celular', confianca: 'media', teste: new RegExp(`\\b(tela|display|frontal|touch|lcd|oled)\\b.*\\b${CELULAR}\\b|\\b${CELULAR}\\b.*\\b(tela|display|frontal|touch|lcd|oled)\\b`) },
  { ncm: '85177900', rotulo: 'peça de celular', confianca: 'media', teste: new RegExp(`\\b(tampa traseira|flex|conector de carga|camera traseira|alto falante)\\b.*\\b${CELULAR}\\b|\\b${CELULAR}\\b.*\\b(tampa traseira|flex|conector de carga)\\b`) },
  // ---- periféricos
  { ncm: '84716052', rotulo: 'teclado', confianca: 'alta', cestSp: '21.031.00', teste: /\bteclado\b/ },
  { ncm: '84716053', rotulo: 'mouse', confianca: 'alta', cestSp: '21.031.00', teste: /\bmouse\b/, exceto: /\bmouse ?pad\b/ },
  { ncm: '85258929', rotulo: 'webcam', confianca: 'media', cestSp: '21.065.00', teste: /\bwebcam\b|\bweb cam\b/ },
  { ncm: '85258919', rotulo: 'câmera de segurança IP', confianca: 'media', cestSp: '21.107.00', teste: /\b(camera ip|camera de seguranca|camera wi ?fi|camera inteligente)\b/ },
  { ncm: '85285200', rotulo: 'monitor', confianca: 'alta', cestSp: '21.068.00', teste: /\bmonitor\b/, exceto: /\bmonitor de (pressao|glicose|bebe)\b|\bsuporte\b/ },
  { ncm: '85287200', rotulo: 'televisor', confianca: 'alta', cestSp: '21.070.00', teste: /\b(smart ?tv|televisor|televisao)\b|\btv \d{2}\b/ },
  { ncm: '84433111', rotulo: 'impressora multifuncional', confianca: 'media', cestSp: '21.016.00', teste: /\bmultifuncional\b|\bimpressora\b.*\b(jato|tanque|ecotank|ink)\b/ },
  { ncm: '84433233', rotulo: 'impressora laser', confianca: 'media', cestSp: '21.017.00', teste: /\bimpressora\b.*\blaser\b/ },
  { ncm: '84439923', rotulo: 'cartucho de tinta', confianca: 'alta', cestSp: '21.018.00', teste: /\bcartucho\b/ },
  { ncm: '84439933', rotulo: 'toner', confianca: 'alta', cestSp: '21.018.00', teste: /\btoner\b/ },
  // ---- armazenamento / memória / componentes
  { ncm: '84717040', rotulo: 'SSD', confianca: 'alta', cestSp: '21.033.00', teste: /\b(ssd|nvme)\b/, exceto: /\b(externo|portatil)\b/ },
  { ncm: '84717040', rotulo: 'SSD externo', confianca: 'media', cestSp: '21.033.00', teste: /\bssd\b/ },
  { ncm: '85235190', rotulo: 'pendrive', confianca: 'alta', teste: /\bpen ?drive\b/ },
  { ncm: '85235110', rotulo: 'cartão de memória', confianca: 'alta', cestSp: '21.062.00', teste: /\b(cartao de memoria|micro ?sd|sd card|cartao sd)\b/ },
  { ncm: '84717010', rotulo: 'HD (disco rígido)', confianca: 'alta', cestSp: '21.033.00', teste: /\b(hd|hdd|disco rigido)\b/, exceto: /\bhdmi\b/ },
  { ncm: '84733042', rotulo: 'memória RAM', confianca: 'alta', cestSp: '21.035.00', teste: /\bmemoria\b.*\b(ram|ddr\d|dimm|sodimm)\b|\b(ddr3|ddr4|ddr5)\b/ },
  { ncm: '84733041', rotulo: 'placa-mãe', confianca: 'alta', cestSp: '21.035.00', teste: /\bplaca ?mae\b|\bmotherboard\b/ },
  { ncm: '84733049', rotulo: 'placa de vídeo', confianca: 'media', cestSp: '21.035.00', teste: /\bplaca de video\b|\b(geforce|radeon)\b|\b(rtx|gtx|rx) ?\d{3,4}\b/ },
  { ncm: '85423190', rotulo: 'processador', confianca: 'media', teste: /\bprocessador\b|\bryzen [3579]\b|\bcore i[3579]\b/, exceto: /\bnotebook\b|\bcomputador\b|\bpc\b|\bdesktop\b/ },
  { ncm: '84733019', rotulo: 'gabinete', confianca: 'alta', cestSp: '21.035.00', teste: /\bgabinete\b/ },
  { ncm: '84733090', rotulo: 'cooler / water cooler', confianca: 'media', cestSp: '21.035.00', teste: /\b(cooler|water ?cooler|ventoinha|fan)\b/ },
  { ncm: '85044090', rotulo: 'fonte de computador', confianca: 'media', teste: /\bfonte\b/ },
  { ncm: '85044040', rotulo: 'nobreak', confianca: 'alta', cestSp: '21.038.00', teste: /\b(nobreak|no break|ups)\b/ },
  { ncm: '90328911', rotulo: 'estabilizador', confianca: 'alta', cestSp: '21.078.00', teste: /\bestabilizador\b/ },
  { ncm: '85363090', rotulo: 'filtro de linha', confianca: 'media', teste: /\b(filtro de linha|regua de energia)\b/ },
  // ---- rede
  { ncm: '85176234', rotulo: 'switch de rede', confianca: 'alta', cestSp: '21.110.00', teste: /\bswitch\b(?=.*\b(rede|porta|portas|gigabit|ethernet|poe)\b)/, exceto: /\bnintendo\b/ },
  { ncm: '85176241', rotulo: 'roteador / repetidor wi-fi', confianca: 'alta', cestSp: '21.083.00', teste: /\b(roteador|router|repetidor|access point|wi ?fi mesh|mesh)\b/ },
  // ---- games
  { ncm: '95045000', rotulo: 'console / controle de videogame', confianca: 'alta', cestSp: '21.079.00', teste: /\b(playstation|ps[45]|xbox|nintendo|console|joystick|gamepad|controle (ps\d|xbox|dualsense|dualshock|sem fio|gamer))\b/ },
  { ncm: '85234990', rotulo: 'jogo em mídia física', confianca: 'media', teste: /^jogo\b|\b(midia fisica|blu ?ray)\b/ },
  { ncm: '42029200', rotulo: 'mochila', confianca: 'alta', teste: /^mochila\b/ },
  // ---- aparelhos (por último)
  { ncm: '85176277', rotulo: 'smartwatch', confianca: 'media', cestSp: '21.110.00', teste: /\b(smartwatch|apple watch|relogio inteligente|galaxy watch)\b/ },
  { ncm: '85176272', rotulo: 'pulseira inteligente', confianca: 'media', cestSp: '21.110.00', teste: /\b(smart ?band|mi band|galaxy fit|pulseira inteligente)\b/ },
  // notebook: o NCM muda pela tela (8471.30.12 até ~14"; 15,6"/16"/17" passam de 560 cm² → 8471.30.19)
  { ncm: '84713019', rotulo: 'notebook 15,6" ou maior', confianca: 'alta', cestSp: '21.028.00', teste: new RegExp(`\\b(notebook|laptop|macbook|chromebook|ultrabook)\\b.*${TELA('15|16|17|18')}`) },
  { ncm: '84713012', rotulo: 'notebook até 14"', confianca: 'alta', cestSp: '21.028.00', teste: new RegExp(`\\b(notebook|laptop|macbook|chromebook|ultrabook)\\b.*${TELA('11|12|13|14')}`) },
  { ncm: '84713012', rotulo: 'notebook (confira o tamanho da tela)', confianca: 'media', cestSp: '21.028.00', teste: /\b(notebook|laptop|macbook|chromebook|ultrabook)\b/ },
  { ncm: '84713012', rotulo: 'tablet', confianca: 'media', cestSp: '21.028.00', teste: /\b(tablet|ipad|galaxy tab|redmi pad|xiaomi pad|lenovo tab)\b/ },
  { ncm: '84714100', rotulo: 'computador all-in-one', confianca: 'alta', cestSp: '21.029.00', teste: /\b(all in one|allinone|imac)\b/ },
  { ncm: '84715010', rotulo: 'computador / PC gamer / mini PC', confianca: 'alta', cestSp: '21.030.00', teste: /\b(computador|desktop|pc gamer|mac mini|mini pc|cpu completa)\b/ },
  { ncm: '85171300', rotulo: 'celular / smartphone', confianca: 'alta', cestSp: '21.053.01', teste: /\b(celular|smartphone|iphone|galaxy [asmz]\d*|redmi|poco|moto [eg]\d*|motorola|xiaomi)\b/ },
];

/**
 * Códigos extintos na mudança do Sistema Harmonizado de 2022 que ainda aparecem em cadastros antigos
 * (a SEFAZ rejeita). O robô troca pelo novo como SUGERIDO.
 */
export const NCM_EXTINTOS: Record<string, string> = {
  '85285220': '85285200',
  '85285210': '85285200',
  '85285290': '85285200',
  '85171231': '85171300',
  '85171211': '85171300',
  '85171219': '85171300',
  '85171239': '85171300',
  '85258029': '85258929',
  '85258019': '85258919',
};

/** Tabela NCM oficial vigente (assets/ncm-vigentes.txt), carregada uma vez. */
let vigentes: Set<string> | null = null;
export function ncmVigente(ncm: string | null | undefined): boolean | null {
  const d = somenteDigitos(ncm);
  if (d.length !== 8) return false;
  if (!vigentes) {
    try {
      const txt = readFileSync(fileURLToPath(new URL('../../../assets/ncm-vigentes.txt', import.meta.url)), 'utf8');
      vigentes = new Set(txt.split('\n').filter((l) => /^\d{8}$/.test(l.trim())).map((l) => l.trim()));
    } catch {
      return null; // sem a tabela: não dá para afirmar
    }
  }
  return vigentes.has(d);
}

/** Acessórios genéricos que a tabela não sabe classificar: o robô não chuta, pede para alguém informar. */
const NAO_CHUTAR = /^(suporte|bolsa|maleta|base|adaptador|hub|dock|limpa|kit limpeza|mouse ?pad|caneta|stylus|lapis|tripe|ring light|organizador|servico|mao de obra)\b/;

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
export function ncmPorRegra(nome: string, categoria?: string | null): { ncm: string; rotulo: string; confianca: 'alta' | 'media'; cestSp?: string } | null {
  const texto = normalizar(nome);
  if (!texto || NAO_CHUTAR.test(texto)) return null;
  const r = melhorRegra(texto) ?? (categoria ? melhorRegra(normalizar(categoria)) : null);
  return r ? { ncm: r.ncm, rotulo: r.rotulo, confianca: r.confianca, cestSp: r.cestSp } : null;
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
    if (ncmValido(d) && ncmVigente(d) !== false) contagem.set(d, (contagem.get(d) || 0) + 1);
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
    const igual = parecidos.find((p) => normalizar(p.nome) === nomeNorm && ncmValido(p.ncm) && ncmVigente(p.ncm) !== false && p.ncmOrigem !== 'SUGERIDO');
    if (igual) return { ncm: somenteDigitos(igual.ncm), origem: 'HISTORICO', motivo: 'mesmo NCM de outro produto com o mesmo nome' };
  }

  // 3. regras pelo nome/categoria → precisa de confirmação
  const r = ncmPorRegra(produto.nome, produto.categoria?.nome);
  if (r) return { ncm: r.ncm, origem: r.confianca === 'alta' ? 'TABELA' : 'SUGERIDO', motivo: `pelo tipo de produto (${r.rotulo})` };
  return null;
}

/** 84713012 → 8471.30.12 */
export function formatarNcm(ncm: string | null | undefined): string {
  const d = somenteDigitos(ncm);
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
}
