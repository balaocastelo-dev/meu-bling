/**
 * RELATÓRIO DA SELEÇÃO (pedido do Thiago, 10/11/2026).
 *
 * Monta uma folha A4 com o que estiver marcado na lista e manda direto para a
 * impressão. Serve para qualquer lista — vendas, OS, notas, produtos: quem chama
 * passa o título, os nomes das colunas e as linhas já prontas em texto.
 *
 * É gerado no navegador de propósito: o relatório é sempre o que está na tela,
 * com os mesmos filtros e a mesma ordem que a pessoa está vendo.
 */
export interface RelatorioSelecao {
  titulo: string;
  colunas: string[];
  linhas: string[][];
  /** rodapé: { 'Total': 'R$ 1.234,00' } — some quando não vier nada */
  totais?: Record<string, string>;
  /** linha abaixo do título (ex.: o período filtrado) */
  subtitulo?: string;
}

const esc = (v: string) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** Colunas de número (valor, total, qtd) saem alinhadas à direita. */
const ehNumero = (titulo: string) => /valor|total|pre[çc]o|custo|qtd|quantidade|saldo|estoque/i.test(titulo);

export function relatorioDaSelecao(r: RelatorioSelecao) {
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(r.titulo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; margin: 0; font-size: 11px; }
  header { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
  h1 { font-size: 15px; margin: 0; }
  .sub { color: #555; font-size: 10px; margin-top: 2px; }
  .quando { color: #555; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .03em; color: #444; border-bottom: 1px solid #bbb; padding: 4px 5px; }
  td { padding: 4px 5px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: 700; padding-top: 6px; }
  footer { margin-top: 10px; color: #777; font-size: 9px; text-align: right; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
  <header>
    <div>
      <h1>${esc(r.titulo)}</h1>
      ${r.subtitulo ? `<div class="sub">${esc(r.subtitulo)}</div>` : ''}
      <div class="sub">${r.linhas.length} registro${r.linhas.length === 1 ? '' : 's'}</div>
    </div>
    <div class="quando">Balão da Informática<br>${esc(agora)}</div>
  </header>
  <table>
    <thead><tr>${r.colunas.map((c) => `<th class="${ehNumero(c) ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>
      ${r.linhas.map((l) => `<tr>${l.map((v, i) => `<td class="${ehNumero(r.colunas[i] ?? '') ? 'num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}
    </tbody>
    ${
      r.totais && Object.keys(r.totais).length
        ? `<tfoot><tr><td colspan="${Math.max(1, r.colunas.length - Object.keys(r.totais).length)}">${esc(Object.keys(r.totais).join(' · '))}</td>${Object.values(r.totais)
            .map((v) => `<td class="num">${esc(v)}</td>`)
            .join('')}</tr></tfoot>`
        : ''
    }
  </table>
  <footer>Documento interno — gerado pelo MEU BLING</footer>
  <script>window.onload = () => { window.focus(); window.print(); };<\/script>
</body></html>`;

  const janela = window.open('', '_blank');
  if (!janela) throw new Error('O navegador bloqueou a janela. Libere os pop-ups deste site para imprimir.');
  janela.document.write(html);
  janela.document.close();
}
