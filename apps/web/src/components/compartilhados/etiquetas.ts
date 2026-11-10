/**
 * ETIQUETAS (pedido do Thiago, 10/11/2026) — produto e ordem de serviço.
 *
 * Dois formatos, escolhidos na hora de imprimir (decisão do Thiago):
 *   'a4'     → cartela adesiva tipo Pimaco, 3 colunas × 8 linhas na folha A4
 *   'termica'→ etiquetadora de rolo, uma etiqueta por página, 50×30 mm
 *
 * O código de barras é desenhado aqui mesmo (Code 128 em barras pretas), sem
 * biblioteca nem internet: a etiqueta precisa sair igual em qualquer máquina da
 * loja, inclusive com a rede fora do ar.
 */

export type FormatoEtiqueta = 'a4' | 'termica';

export interface Etiqueta {
  /** linha de cima, em negrito (nome do produto, nº da OS) */
  titulo: string;
  /** linhas menores embaixo do título */
  linhas?: string[];
  /** canto direito, grande (preço) */
  destaque?: string;
  /** o que vira código de barras e sai escrito embaixo dele */
  codigo?: string;
}

const esc = (v: string) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

// ---------------------------------------------------------------- Code 128
// Larguras das 107 combinações do Code 128 (6 barras/espaços por símbolo).
const C128 = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','233111',
];
const INICIO_B = 104;
const PARADA = 106;

/** Barras do Code 128-B (texto comum). Devolve a sequência de larguras alternando barra/espaço. */
function code128B(texto: string): number[] {
  const limpo = [...texto].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  if (!limpo.length) return [];
  const simbolos = [INICIO_B, ...limpo.map((c) => c.charCodeAt(0) - 32)];
  const soma = simbolos.reduce((t, v, i) => t + v * (i === 0 ? 1 : i), 0);
  simbolos.push(soma % 103, PARADA);
  return simbolos.flatMap((s) => [...C128[s]].map(Number));
}

/** Código de barras como SVG: barras pretas de largura variável, sem dependência externa. */
function svgCodigo(texto: string, altura = 28): string {
  const larguras = code128B(texto);
  if (!larguras.length) return '';
  const unidade = 1; // 1 unidade por módulo; o SVG se estica no CSS
  const total = larguras.reduce((t, l) => t + l, 0) * unidade;
  let x = 0;
  const barras = larguras
    .map((l, i) => {
      const w = l * unidade;
      const r = i % 2 === 0 ? `<rect x="${x}" y="0" width="${w}" height="${altura}" fill="#000"/>` : '';
      x += w;
      return r;
    })
    .join('');
  return `<svg viewBox="0 0 ${total} ${altura}" preserveAspectRatio="none" width="100%" height="${altura}">${barras}</svg>`;
}

// ---------------------------------------------------------------- folha
function corpo(e: Etiqueta, comBarras: boolean): string {
  return `
    <div class="topo">
      <div class="tit">${esc(e.titulo)}</div>
      ${e.destaque ? `<div class="dest">${esc(e.destaque)}</div>` : ''}
    </div>
    ${(e.linhas ?? []).filter(Boolean).map((l) => `<div class="sub">${esc(l)}</div>`).join('')}
    ${comBarras && e.codigo ? `<div class="bc">${svgCodigo(e.codigo)}<div class="cod">${esc(e.codigo)}</div></div>` : e.codigo ? `<div class="cod">${esc(e.codigo)}</div>` : ''}
  `;
}

const ESTILO_COMUM = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; margin: 0; }
  .et { overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
  .topo { display: flex; align-items: baseline; gap: 4px; }
  .tit { font-weight: 700; line-height: 1.15; overflow: hidden; flex: 1; }
  .dest { font-weight: 700; white-space: nowrap; }
  .sub { color: #333; line-height: 1.2; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .bc { margin-top: 2px; }
  .cod { font-family: ui-monospace, "Courier New", monospace; letter-spacing: .06em; text-align: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`;

/**
 * Abre a janela de impressão com as etiquetas.
 * `copias` repete cada etiqueta (ex.: 5 unidades do mesmo produto na prateleira).
 */
export function imprimirEtiquetas(etiquetas: Etiqueta[], formato: FormatoEtiqueta, copias = 1) {
  if (!etiquetas.length) throw new Error('Nenhuma etiqueta para imprimir.');
  const lista = etiquetas.flatMap((e) => Array.from({ length: Math.max(1, Math.min(copias, 50)) }, () => e));

  const estilo =
    formato === 'termica'
      ? `@page { size: 50mm 30mm; margin: 0; }
         .et { width: 50mm; height: 30mm; padding: 2mm 2.5mm; page-break-after: always; }
         .tit { font-size: 9pt; max-height: 2.4em; } .dest { font-size: 11pt; } .sub { font-size: 7pt; } .cod { font-size: 6.5pt; }`
      : `@page { size: A4; margin: 8mm 5mm; }
         .folha { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
         .et { height: 33mm; padding: 2.5mm 3mm; border: 1px dashed #ccc; border-radius: 2mm; }
         .tit { font-size: 10pt; max-height: 2.4em; } .dest { font-size: 12pt; } .sub { font-size: 8pt; } .cod { font-size: 7pt; }
         @media print { .et { border-color: #eee; } }`;

  const conteudo = lista.map((e) => `<div class="et">${corpo(e, true)}</div>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title>
<style>${ESTILO_COMUM}${estilo}</style></head>
<body>${formato === 'a4' ? `<div class="folha">${conteudo}</div>` : conteudo}
<script>window.onload = () => { window.focus(); window.print(); };<\/script></body></html>`;

  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a janela. Libere os pop-ups deste site para imprimir.');
  janela.document.write(html);
  janela.document.close();
}
