/**
 * DOCUMENTOS DA VENDA (HTML pronto para imprimir ou "Salvar como PDF"):
 *   cupom    → recibo 80mm (impressora térmica)
 *   a4       → recibo A4 completo + kit de garantia
 *   garantia → só o kit: certificado de cada aparelho + termo de garantia + folha de licenças
 *
 * Pedido do Thiago (28/10/2026): documentos totalmente preenchidos, sem espaço em branco,
 * com informações institucionais e um versículo bíblico sorteado (com citação) no rodapé de cada folha.
 */
import { esc, formatarDocumento, formatarTelefone, enderecoLinha } from '../comum/html.js';
import { arredondar } from '../../lib/util.js';
import { COR_MARCA, INSTITUCIONAL, OFERTA_LICENCA, TEMAS } from './config.js';
import type { ContextoDoc, ItemDoc } from './dados.js';
import { cantoneira, ICONE_ALERTA, ICONE_ESCUDO, ICONE_JANELA, ICONE_OK, ICONE_X, ICONES, ICONES_SERVICOS, selo } from './icones.js';
import { VERSICULOS, type Versiculo } from './versiculos.js';

export type FormatoDoc = 'cupom' | 'a4' | 'garantia';

const moeda = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
const dataBr = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const horaBr = (d: Date | string) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dataExtenso = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });

/** um versículo diferente para cada folha do mesmo documento */
function sorteador() {
  const usados = new Set<number>();
  return (): Versiculo => {
    if (usados.size >= VERSICULOS.length) usados.clear();
    let i = Math.floor(Math.random() * VERSICULOS.length);
    while (usados.has(i)) i = (i + 1) % VERSICULOS.length;
    usados.add(i);
    return VERSICULOS[i];
  };
}

const versiculoHtml = (v: Versiculo, classe = 'versiculo') => `<div class="${classe}"><span class="aspas">“</span>${esc(v.texto)}<span class="aspas">”</span> <b>— ${esc(v.ref)}</b></div>`;

function descontoGeral(c: ContextoDoc) {
  const v = c.venda;
  return v.descontoTipo === 'PERCENTUAL' ? arredondar(v.totalProdutos * (v.descontoValor / 100)) : v.descontoValor;
}

function formasPagamento(c: ContextoDoc): { forma: string; valor: number; vencimento: Date; numero: number }[] {
  return c.venda.parcelas.map((p) => ({ forma: p.formaPagamento?.nome || 'A combinar', valor: p.valor, vencimento: p.dataVencimento, numero: p.numero }));
}

function resumoPagamento(c: ContextoDoc): string {
  const ps = formasPagamento(c);
  if (!ps.length) return 'À vista';
  const formas = [...new Set(ps.map((p) => p.forma))];
  if (ps.length === 1) return `${formas[0]} — ${moeda(ps[0].valor)}`;
  return `${formas.join(' + ')} — ${ps.length} parcelas`;
}

// =====================================================================================================
// CSS
// =====================================================================================================
const CSS = `
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #e5e7eb; }
body { font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111827; }
.botoes { position: fixed; top: 10px; right: 10px; z-index: 10; display: flex; gap: 6px; }
.botoes button { padding: 8px 14px; font-size: 13px; cursor: pointer; border: 0; border-radius: 6px; background: ${COR_MARCA}; color: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
@media print { html, body { background: #fff; } .botoes { display: none !important; } .folha, .cupom, .cert { margin: 0 !important; box-shadow: none !important; } }
.versiculo { font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #374151; text-align: center; }
.versiculo b { font-style: normal; font-family: Arial, sans-serif; font-weight: 700; color: ${COR_MARCA}; font-size: .9em; white-space: nowrap; }
.aspas { color: ${COR_MARCA}; font-weight: 700; }

/* ---------------- A4 retrato */
@page { size: A4; margin: 0; }
@page paisagem { size: A4 landscape; margin: 0; }
.folha { width: 210mm; min-height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15);
  padding: 11mm 12mm 9mm; display: flex; flex-direction: column; page-break-after: always; break-after: page; position: relative; font-size: 10.5px; }
.folha:last-child { page-break-after: auto; break-after: auto; }
.faixa { position: absolute; left: 0; top: 0; bottom: 0; width: 5mm; background: linear-gradient(${COR_MARCA}, #a3120f); }
.topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 7px; border-bottom: 2.5px solid ${COR_MARCA}; }
.topo img.logo { height: 46px; max-width: 190px; object-fit: contain; }
.topo .emp { font-size: 9.5px; line-height: 1.45; color: #374151; flex: 1; }
.topo .emp b { color: #111; font-size: 11px; }
.topo .doc { text-align: right; min-width: 150px; }
.topo .doc .tipo { font-size: 9px; letter-spacing: .14em; color: #6b7280; font-weight: 700; text-transform: uppercase; }
.topo .doc .num { font-size: 22px; font-weight: 800; color: #111; line-height: 1.1; }
.topo .doc .quando { font-size: 9.5px; color: #374151; }
.titulo-sec { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: ${COR_MARCA}; margin: 9px 0 4px; display: flex; align-items: center; gap: 6px; }
.titulo-sec::after { content: ''; flex: 1; height: 1px; background: #f3c4c3; }
.caixas { display: grid; grid-template-columns: 1.4fr 1fr; gap: 8px; }
.caixa { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; background: #fafafa; line-height: 1.5; }
.caixa .r { color: #6b7280; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; display: block; }
.caixa b { font-size: 11px; }
table.itens { width: 100%; border-collapse: collapse; }
table.itens th { background: #111827; color: #fff; font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; padding: 5px 6px; text-align: left; }
table.itens td { padding: 5px 6px; border-bottom: 1px solid #eef0f3; vertical-align: middle; }
table.itens tr:nth-child(even) td { background: #fafbfc; }
table.itens .n { text-align: right; white-space: nowrap; }
table.itens img { width: 34px; height: 34px; object-fit: contain; border-radius: 4px; background: #fff; border: 1px solid #eee; }
.tag { display: inline-block; font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 8px; margin-left: 3px; vertical-align: middle; }
.tag.g { background: #ecfdf5; color: #047857; } .tag.s { background: #fff7ed; color: #c2410c; } .tag.c { background: #eef2ff; color: #3730a3; }
.totais-linha { display: grid; grid-template-columns: 1fr 230px; gap: 10px; margin-top: 7px; }
.totais { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
.totais div { display: flex; justify-content: space-between; padding: 3px 9px; }
.totais .total { background: ${COR_MARCA}; color: #fff; font-size: 15px; font-weight: 800; padding: 6px 9px; }
.pag table { width: 100%; border-collapse: collapse; } .pag td { padding: 3px 6px; border-bottom: 1px dashed #e5e7eb; }
.crescer { flex: 1; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.inst { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; align-content: stretch; }
.inst .card { border: 1px solid #f1d5d4; border-radius: 8px; padding: 5px 8px; background: linear-gradient(180deg, #fff, #fff6f6); display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 4px; }
.inst .card svg { width: 22px; height: 22px; color: ${COR_MARCA}; flex: none; }
.inst .card b { color: ${COR_MARCA}; font-size: 11.5px; } .inst .card span { color: #4b5563; font-size: 10px; line-height: 1.4; }
.contato { display: grid; grid-template-columns: 74px 1fr 74px; gap: 10px; align-items: center; border: 1px solid #e5e7eb; border-radius: 8px; padding: 7px 10px; }
.contato img { width: 62px; height: 62px; } .contato .meio { text-align: center; line-height: 1.55; font-size: 10px; } .contato .meio b { font-size: 13px; color: ${COR_MARCA}; }
.qr-r { font-size: 7.5px; text-align: center; color: #6b7280; }
.assin { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-top: 12px; }
.assin div { border-top: 1px solid #111; text-align: center; padding-top: 3px; font-size: 9px; color: #374151; }
.rodape { margin-top: 8px; padding-top: 7px; border-top: 1px solid #e5e7eb; }
.rodape .versiculo { font-size: 11px; line-height: 1.45; }
.rodape .legal { font-size: 8px; color: #9ca3af; text-align: center; margin-top: 3px; }
.garantia-box { border: 1.5px solid #10b981; background: #f0fdf9; border-radius: 8px; padding: 7px 10px; display: grid; grid-template-columns: 34px 1fr; gap: 9px; align-items: center; }
.garantia-box svg { width: 32px; height: 32px; color: #059669; }
.lista-g { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 16px; } .lista-g li { font-size: 9.5px; line-height: 1.45; break-inside: avoid; }

/* ---------------- termo de garantia e licenças */
.duas { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.bloco { border-radius: 9px; padding: 9px 11px; display: flex; flex-direction: column; }
.bloco h3 { margin: 0 0 5px; font-size: 12px; display: flex; align-items: center; gap: 7px; }
.bloco h3 svg { width: 20px; height: 20px; }
.bloco ul { margin: 0; padding-left: 15px; } .bloco li { font-size: 10.5px; line-height: 1.5; margin-bottom: 2px; }
.estica .bloco ul { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; }
.estica .bloco li { font-size: 11px; }
.estica .bloco > .duas { flex: 1; } .estica .bloco > .duas ul { height: 100%; }
.bloco.ok { background: #f0fdf4; border: 1.5px solid #86efac; } .bloco.ok h3 { color: #15803d; }
.bloco.nao { background: #fef2f2; border: 1.5px solid #fca5a5; } .bloco.nao h3 { color: #b91c1c; }
.bloco.info { background: #f8fafc; border: 1.5px solid #cbd5e1; } .bloco.info h3 { color: #0f172a; }
.bloco.alerta { background: #fffbeb; border: 1.5px solid #fcd34d; } .bloco.alerta h3 { color: #b45309; }
.estica { flex: 1; display: flex; flex-direction: column; gap: 9px; margin-top: 8px; } .estica > .duas { flex: 1; }
.oferta { border-radius: 12px; padding: 12px 16px; color: #fff; background: linear-gradient(120deg, #0f172a, #1e3a8a 60%, #2563eb); display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; }
.oferta .t { font-size: 18px; font-weight: 800; line-height: 1.2; } .oferta .s { font-size: 10.5px; opacity: .9; margin-top: 3px; }
.oferta .preco { text-align: center; background: #fff; color: #0f172a; border-radius: 10px; padding: 8px 14px; }
.oferta .preco .de { font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: #64748b; font-weight: 700; }
.oferta .preco .v { font-size: 30px; font-weight: 900; color: ${COR_MARCA}; line-height: 1; }
.oferta .preco .q { font-size: 8.5px; color: #475569; margin-top: 3px; }
.aceite { border: 1.5px dashed #94a3b8; border-radius: 9px; padding: 8px 11px; display: grid; grid-template-columns: auto 1fr 1fr; gap: 14px; align-items: end; font-size: 10px; }
.aceite .q { display: inline-block; width: 12px; height: 12px; border: 1.5px solid #111; border-radius: 2px; vertical-align: -2px; margin-right: 5px; }
.aceite .linha { border-top: 1px solid #111; text-align: center; padding-top: 2px; font-size: 8.5px; color: #374151; }

/* ---------------- certificado (A4 paisagem) */
.cert { page: paisagem; width: 297mm; height: 210mm; margin: 12px auto; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.cert:last-child { page-break-after: auto; break-after: auto; }
.cert .fundo { position: absolute; inset: 0; }
.cert .moldura { position: absolute; inset: 8mm; border: 3px double var(--cor); }
.cert .moldura2 { position: absolute; inset: 11mm; border: 1px solid var(--cor2); }
.cert .canto { position: absolute; width: 26mm; height: 26mm; }
.cert .canto.tl { top: 6mm; left: 6mm; } .cert .canto.tr { top: 6mm; right: 6mm; transform: scaleX(-1); }
.cert .canto.bl { bottom: 6mm; left: 6mm; transform: scaleY(-1); } .cert .canto.br { bottom: 6mm; right: 6mm; transform: scale(-1,-1); }
.cert .miolo { position: absolute; inset: 15mm 20mm 13mm; display: flex; flex-direction: column; }
.cert .cab { display: flex; align-items: center; justify-content: space-between; }
.cert .cab img { height: 40px; }
.cert .cab .nc { text-align: right; font-size: 9px; color: #4b5563; line-height: 1.4; } .cert .cab .nc b { color: var(--cor); font-size: 12px; }
.cert h1 { font-family: Georgia, 'Times New Roman', serif; font-weight: 400; font-size: 34px; letter-spacing: .06em; margin: 4px 0 0; text-align: center; color: var(--cor); text-transform: uppercase; }
.cert .sub { text-align: center; font-size: 11px; letter-spacing: .32em; text-transform: uppercase; color: var(--cor2); font-weight: 700; margin-top: 1px; }
.cert .orna { display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--cor2); margin: 4px 0 2px; }
.cert .orna i { display: block; width: 90px; height: 1px; background: var(--cor2); } .cert .orna span { font-size: 12px; }
.cert .declara { text-align: center; font-family: Georgia, serif; font-size: 13px; line-height: 1.55; color: #1f2937; margin: 3px 30px 0; }
.cert .declara b { color: var(--cor); }
.cert .corpo { flex: 1; display: grid; grid-template-columns: 62mm 1fr 46mm; gap: 7mm; align-items: stretch; margin-top: 4mm; min-height: 0; }
.cert .foto { min-height: 52mm; border-radius: 6px; border: 1px solid #e5e7eb; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--cor); }
.cert .foto img { max-width: 100%; max-height: 100%; object-fit: contain; } .cert .foto svg { width: 70%; height: 70%; }
.cert .ficha { border-left: 3px solid var(--cor); padding-left: 12px; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
.cert .ficha .prod { font-size: 20px; font-weight: 800; color: #111; line-height: 1.25; }
.cert .ficha table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cert .ficha td { padding: 5px 0; border-bottom: 1px dotted #d1d5db; vertical-align: top; } .cert .ficha td:first-child { color: #6b7280; width: 38%; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
.cert .ficha .specs { margin-top: 5px; display: flex; flex-wrap: wrap; gap: 3px; } .cert .ficha .specs span { font-size: 10px; padding: 3px 8px; border-radius: 9px; background: var(--fundo); border: 1px solid var(--cor2); color: #1f2937; }
.cert .selo { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; } .cert .selo svg { width: 44mm; height: 44mm; }
.cert .selo .ate { font-size: 9.5px; text-align: center; color: #374151; } .cert .selo .ate b { display: block; font-size: 13px; color: var(--cor); }
.cert .pe { display: grid; grid-template-columns: 1fr 1.6fr 1fr; gap: 8mm; align-items: end; margin-top: 3mm; }
.cert .pe .ass { border-top: 1px solid #111; text-align: center; font-size: 9px; padding-top: 3px; color: #374151; }
.cert .pe .ass .nome { font-family: 'Brush Script MT', 'Segoe Script', Georgia, serif; font-style: italic; font-size: 19px; color: var(--cor); margin-bottom: -2px; display: block; }
.cert .pe .versiculo { font-size: 10.5px; line-height: 1.4; }
.cert .pe .qr { display: flex; align-items: center; gap: 6px; justify-content: flex-end; font-size: 8.5px; color: #4b5563; } .cert .pe .qr img { width: 54px; height: 54px; }
.cert .cob { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 4mm; }
.cert .cob div { border: 1px solid var(--cor2); border-radius: 8px; padding: 5px 8px; font-size: 10px; display: flex; align-items: center; gap: 6px; background: var(--fundo); }
.cert .cob svg { width: 16px; height: 16px; color: var(--cor); flex: none; }
.cert .regras { font-size: 8px; color: #6b7280; text-align: center; margin-top: 2mm; }

/* ---------------- cupom 80mm */
.cupom { width: 80mm; margin: 12px auto; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); padding: 3mm 3.5mm 4mm; font-family: 'Courier New', Consolas, monospace; font-size: 11px; color: #000; line-height: 1.32; }
.cupom .c { text-align: center; } .cupom .logo { width: 62mm; max-height: 22mm; object-fit: contain; display: block; margin: 0 auto 2px; filter: grayscale(1) contrast(1.4); }
.cupom .sep { border-top: 1px dashed #000; margin: 4px 0; } .cupom .sep2 { border-top: 2px solid #000; margin: 4px 0; }
.cupom .tit { font-weight: 800; font-size: 13px; letter-spacing: .04em; }
.cupom .l { display: flex; justify-content: space-between; gap: 6px; } .cupom .l span:last-child { text-align: right; white-space: nowrap; }
.cupom .it { margin: 3px 0; } .cupom .it .d { font-weight: 700; }
.cupom .tot { font-size: 15px; font-weight: 900; }
.cupom .g { font-size: 10px; } .cupom .versiculo { font-size: 10.5px; color: #000; margin-top: 4px; } .cupom .versiculo b, .cupom .aspas { color: #000; }
.cupom .qr { width: 26mm; height: 26mm; display: block; margin: 3px auto; }
.cupom .peq { font-size: 9px; }
`;

function pagina(titulo: string, corpo: string, cupom = false): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title><style>${CSS}${cupom ? '@page { size: 80mm auto; margin: 0; }' : ''}</style></head>
<body><div class="botoes"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>${corpo}
<script>if (location.search.includes('auto=1')) window.addEventListener('load', () => setTimeout(() => window.print(), 500));</script></body></html>`;
}

// =====================================================================================================
// pedaços comuns das folhas A4
// =====================================================================================================
function topoA4(c: ContextoDoc, tipo: string, numero: string, quando: string): string {
  const e = c.emp;
  return `<div class="topo">
    ${e.logoSrc ? `<img class="logo" src="${esc(e.logoSrc)}" alt="logo">` : `<b style="font-size:20px;color:${COR_MARCA}">${esc(e.nome)}</b>`}
    <div class="emp"><b>${esc(e.razaoSocial || e.nome)}</b><br>${e.cnpj ? 'CNPJ ' + esc(e.cnpj) : ''}${e.ie ? ' · IE ' + esc(e.ie) : ''}<br>${esc(e.endereco)}<br>${[e.telefone, e.email, c.site].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="doc"><div class="tipo">${esc(tipo)}</div><div class="num">${esc(numero)}</div><div class="quando">${esc(quando)}</div></div>
  </div>`;
}

function rodapeA4(c: ContextoDoc, v: Versiculo, legal: string): string {
  return `<div class="rodape">${versiculoHtml(v)}<div class="legal">${esc(legal)} · ${esc(c.emp.nome)} · emitido em ${dataBr(c.emitidoEm)} ${horaBr(c.emitidoEm)}</div></div>`;
}

function blocoCliente(c: ContextoDoc): string {
  const cli = c.venda.contato;
  const v = c.venda;
  const end = enderecoLinha(cli);
  return `<div class="caixas">
    <div class="caixa"><span class="r">Cliente</span><b>${esc(cli.nome)}</b>${cli.documento ? ` · ${cli.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'} ${esc(formatarDocumento(cli.documento))}` : ''}<br>
      ${[formatarTelefone(cli.celular || cli.telefone), cli.email].filter(Boolean).map((x) => esc(x)).join(' · ') || 'Contato não informado'}<br>
      ${end ? esc(end) : 'Retirada na loja'}</div>
    <div class="caixa"><span class="r">Atendimento</span>
      Vendedor: <b>${esc(v.vendedor?.nome || 'Balão da Informática')}</b><br>
      Data: <b>${dataBr(v.data)}</b> · Pedido nº <b>${v.numero}</b><br>
      Pagamento: <b>${esc(resumoPagamento(c))}</b>${v.nota ? `<br>NF-e nº <b>${v.nota.numero}</b>` : ''}</div>
  </div>`;
}

function tabelaItens(c: ContextoDoc): string {
  const linhas = c.itens
    .map(
      (i) => `<tr>
      <td>${i.imagemUrl ? `<img src="${esc(i.imagemUrl)}" alt="">` : ''}</td>
      <td><b>${esc(i.descricao)}</b>${i.seminovo ? '<span class="tag s">SEMINOVO</span>' : ''}${i.tipo ? '<span class="tag c">CERTIFICADO</span>' : ''}<br>
        <span style="color:#6b7280;font-size:9px">${[i.codigo ? 'Cód. ' + esc(i.codigo) : '', i.marca ? esc(i.marca) : '', i.numeroSerie ? 'Série/IMEI ' + esc(i.numeroSerie) : ''].filter(Boolean).join(' · ')}</span></td>
      <td class="n">${qtd(i.quantidade)} ${esc(i.unidade)}</td>
      <td class="n">${moeda(i.valorUnitario)}</td>
      <td class="n">${i.desconto ? '- ' + moeda(i.desconto) : '—'}</td>
      <td class="n"><b>${moeda(i.total)}</b></td>
      <td class="n">${i.servico ? '<span class="tag g">90 dias</span>' : i.garantia.dias ? `<span class="tag g">${esc(i.garantia.texto.replace(' (1 ano)', ''))}</span><br><span style="font-size:8px;color:#6b7280">até ${dataBr(i.garantia.validaAte)}</span>` : '—'}</td>
    </tr>`,
    )
    .join('');
  return `<table class="itens"><thead><tr><th style="width:42px"></th><th>Produto / serviço</th><th class="n">Qtd</th><th class="n">Unitário</th><th class="n">Desc.</th><th class="n">Total</th><th class="n">Garantia</th></tr></thead><tbody>${linhas}</tbody></table>`;
}

function blocoTotais(c: ContextoDoc): string {
  const v = c.venda;
  const desc = descontoGeral(c);
  const ps = formasPagamento(c);
  return `<div class="totais-linha">
    <div class="pag caixa" style="background:#fff"><span class="r">Pagamento</span>
      <table>${ps.length ? ps.map((p) => `<tr><td>${p.numero}/${ps.length}</td><td>${esc(p.forma)}</td><td>${dataBr(p.vencimento)}</td><td style="text-align:right"><b>${moeda(p.valor)}</b></td></tr>`).join('') : '<tr><td>À vista na loja</td></tr>'}</table>
      ${v.observacoes ? `<div style="margin-top:4px"><span class="r">Observações</span>${esc(v.observacoes)}</div>` : ''}
    </div>
    <div class="totais">
      <div><span>Produtos</span><span>${moeda(v.totalProdutos)}</span></div>
      ${desc ? `<div><span>Desconto</span><span>- ${moeda(desc)}</span></div>` : ''}
      ${v.frete ? `<div><span>Frete</span><span>${moeda(v.frete)}</span></div>` : ''}
      ${v.outrasDespesas ? `<div><span>Outras despesas</span><span>${moeda(v.outrasDespesas)}</span></div>` : ''}
      <div><span>Itens</span><span>${c.itens.reduce((s, i) => s + i.quantidade, 0)}</span></div>
      <div class="total"><span>TOTAL</span><span>${moeda(v.total)}</span></div>
    </div>
  </div>`;
}

function blocoInstitucional(c: ContextoDoc): string {
  const e = c.emp;
  return `<div class="titulo-sec">Conheça o Balão</div>
  <div class="inst">${INSTITUCIONAL.servicos.map((s, k) => `<div class="card">${ICONES_SERVICOS[k] || ''}<b>${esc(s.titulo)}</b><span>${esc(s.texto)}</span></div>`).join('')}</div>
  <div class="contato">
    <div><img src="${c.qrSite}" alt=""><div class="qr-r">${esc(c.site)}</div></div>
    <div class="meio"><b>${esc(e.nome)}</b><br>${esc(INSTITUCIONAL.slogan)}<br>${esc(e.endereco)}<br>${[e.telefone, e.email].filter(Boolean).map(esc).join(' · ')}</div>
    <div>${c.qrWhats ? `<img src="${c.qrWhats}" alt=""><div class="qr-r">Fale conosco</div>` : `<img src="${c.qrSite}" alt=""><div class="qr-r">Loja online</div>`}</div>
  </div>`;
}

// =====================================================================================================
// RECIBO A4
// =====================================================================================================
function reciboA4(c: ContextoDoc, vers: () => Versiculo): string {
  const v = c.venda;
  const comGarantia = c.itens.filter((i) => !i.servico && i.garantia.dias > 0);
  return `<section class="folha"><div class="faixa"></div>
    ${topoA4(c, v.nota ? 'Recibo de venda · NF-e ' + v.nota.numero : 'Recibo de venda', `Nº ${v.numero}`, `${dataBr(v.data)} · ${horaBr(v.criadoEm)}`)}
    <div class="titulo-sec">Cliente e atendimento</div>${blocoCliente(c)}
    <div class="titulo-sec">Itens da compra</div>${tabelaItens(c)}
    ${blocoTotais(c)}
    <div class="crescer">
      ${
        comGarantia.length
          ? `<div class="garantia-box">${ICONE_ESCUDO}<div><b style="color:#047857">Sua garantia está registrada.</b> Guarde este recibo: ele vale como comprovante.
            ${comGarantia.map((i) => `${esc(i.descricao.slice(0, 60))}: <b>${esc(i.garantia.texto)}</b> (até ${dataBr(i.garantia.validaAte)})`).join(' · ')}.
            ${c.certificados.length ? ' O certificado e o termo completo de garantia acompanham este recibo.' : ' Cobre defeitos de fabricação; não cobre quedas, líquidos, mau uso ou lacre violado.'}</div></div>`
          : ''
      }
      ${blocoInstitucional(c)}
      <div class="assin"><div>${esc(c.emp.nome)}</div><div>${esc(v.contato.nome)} — recebi os itens acima em perfeito estado</div></div>
    </div>
    ${rodapeA4(c, vers(), v.nota ? 'Recibo de venda — a NF-e é o documento fiscal' : 'Recibo de venda sem valor fiscal')}
  </section>`;
}

// =====================================================================================================
// CUPOM 80mm
// =====================================================================================================
function cupom80(c: ContextoDoc, vers: () => Versiculo): string {
  const v = c.venda;
  const e = c.emp;
  const cli = v.contato;
  const desc = descontoGeral(c);
  const ps = formasPagamento(c);
  const garantias = c.itens.filter((i) => !i.servico && i.garantia.dias > 0);
  return `<section class="cupom">
    ${e.logoSrc ? `<img class="logo" src="${esc(e.logoSrc)}" alt="">` : ''}
    <div class="c"><b>${esc(e.razaoSocial || e.nome)}</b><br>${e.cnpj ? 'CNPJ ' + esc(e.cnpj) : ''}<br>${esc(e.endereco)}<br>${[e.telefone, c.site].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="sep2"></div>
    <div class="c tit">RECIBO DE VENDA Nº ${v.numero}</div>
    <div class="c">${dataBr(v.data)} ${horaBr(v.criadoEm)} · Vend.: ${esc(v.vendedor?.nome || 'Loja')}</div>
    <div class="sep"></div>
    <div>Cliente: <b>${esc(cli.nome)}</b>${cli.documento ? `<br>${cli.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}: ${esc(formatarDocumento(cli.documento))}` : ''}${cli.celular || cli.telefone ? `<br>Fone: ${esc(formatarTelefone(cli.celular || cli.telefone))}` : ''}</div>
    <div class="sep"></div>
    ${c.itens
      .map(
        (i) => `<div class="it"><div class="d">${i.idx}. ${esc(i.descricao)}</div>
        ${i.codigo || i.numeroSerie ? `<div class="peq">${[i.codigo ? 'Cód ' + esc(i.codigo) : '', i.numeroSerie ? 'S/N ' + esc(i.numeroSerie) : ''].filter(Boolean).join(' · ')}</div>` : ''}
        <div class="l"><span>${qtd(i.quantidade)} ${esc(i.unidade)} x ${moeda(i.valorUnitario)}${i.desconto ? ` -${moeda(i.desconto)}` : ''}</span><span>${moeda(i.total)}</span></div>
        ${!i.servico && i.garantia.dias ? `<div class="g">Garantia: ${esc(i.garantia.texto)} até ${dataBr(i.garantia.validaAte)}${i.seminovo ? ' (seminovo)' : ''}</div>` : ''}</div>`,
      )
      .join('')}
    <div class="sep"></div>
    <div class="l"><span>Subtotal (${c.itens.reduce((s, i) => s + i.quantidade, 0)} itens)</span><span>${moeda(v.totalProdutos)}</span></div>
    ${desc ? `<div class="l"><span>Desconto</span><span>-${moeda(desc)}</span></div>` : ''}
    ${v.frete ? `<div class="l"><span>Frete</span><span>${moeda(v.frete)}</span></div>` : ''}
    ${v.outrasDespesas ? `<div class="l"><span>Outras despesas</span><span>${moeda(v.outrasDespesas)}</span></div>` : ''}
    <div class="sep2"></div>
    <div class="l tot"><span>TOTAL</span><span>${moeda(v.total)}</span></div>
    <div class="sep"></div>
    ${ps.length ? ps.map((p) => `<div class="l"><span>${ps.length > 1 ? `${p.numero}/${ps.length} ` : ''}${esc(p.forma)}${ps.length > 1 ? ' ' + dataBr(p.vencimento) : ''}</span><span>${moeda(p.valor)}</span></div>`).join('') : '<div>Pagamento à vista</div>'}
    ${v.observacoes ? `<div class="sep"></div><div class="peq">Obs.: ${esc(v.observacoes)}</div>` : ''}
    ${
      garantias.length
        ? `<div class="sep"></div><div class="g"><b>GARANTIA</b>: cobre defeitos de fabricação. Não cobre quedas, líquidos, oxidação, mau uso, surtos elétricos ou lacre violado. Apresente este recibo.${c.certificados.length ? ' Certificado e termo completo entregues junto.' : ''}</div>`
        : ''
    }
    <div class="sep"></div>
    <div class="c peq"><b>${esc(INSTITUCIONAL.slogan)}</b><br>${INSTITUCIONAL.servicos.slice(0, 4).map((s) => esc(s.titulo)).join(' · ')}</div>
    <img class="qr" src="${c.qrSite}" alt="">
    <div class="c peq">${esc(c.site)}</div>
    <div class="sep"></div>
    ${versiculoHtml(vers())}
    <div class="sep"></div>
    <div class="c peq">${v.nota ? `NF-e nº ${v.nota.numero} emitida para esta venda` : 'Documento sem valor fiscal'}<br>Obrigado pela preferência!</div>
  </section>`;
}

// =====================================================================================================
// CERTIFICADO DE GARANTIA (A4 paisagem, emoldurado)
// =====================================================================================================
function certificado(c: ContextoDoc, i: ItemDoc, nCert: number, vers: () => Versiculo): string {
  const tema = TEMAS[i.tipo!];
  const v = c.venda;
  const cli = v.contato;
  const g = i.garantia;
  const numeroCert = `${v.numero}-${String(nCert).padStart(2, '0')}`;
  const padrao = `repeating-linear-gradient(45deg, ${tema.fundo} 0 6px, #fff 6px 12px)`;
  const linhas: [string, string][] = [
    ['Proprietário', `${cli.nome}${cli.documento ? ` — ${cli.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'} ${formatarDocumento(cli.documento)}` : ''}`],
    ['Equipamento', [tema.titulo, i.marca].filter(Boolean).join(' · ')],
    ['Nº de série / IMEI', i.numeroSerie || `Registrado no pedido nº ${v.numero}, item ${i.idx}`],
    ['Condição', i.seminovo ? 'Seminovo revisado e testado' : 'Novo'],
    ['Data da compra', `${dataBr(v.data)} · Pedido nº ${v.numero}${v.nota ? ` · NF-e ${v.nota.numero}` : ''}`],
    ['Valor', moeda(i.total)],
  ];
  return `<section class="cert" style="--cor:${tema.cor};--cor2:${tema.cor2};--fundo:${tema.fundo}">
    <div class="fundo" style="background:${padrao}"></div>
    <div class="fundo" style="inset:13mm;background:#fff"></div>
    <div class="moldura"></div><div class="moldura2"></div>
    <div class="canto tl">${cantoneira(tema.cor)}</div><div class="canto tr">${cantoneira(tema.cor)}</div><div class="canto bl">${cantoneira(tema.cor)}</div><div class="canto br">${cantoneira(tema.cor)}</div>
    <div class="miolo">
      <div class="cab">
        ${c.emp.logoSrc ? `<img src="${esc(c.emp.logoSrc)}" alt="">` : `<b>${esc(c.emp.nome)}</b>`}
        <div class="nc">Certificado nº <b>${esc(numeroCert)}</b><br>${esc(c.emp.razaoSocial || c.emp.nome)}${c.emp.cnpj ? ' · CNPJ ' + esc(c.emp.cnpj) : ''}<br>${esc(c.emp.endereco)}</div>
      </div>
      <h1>Certificado de Garantia</h1>
      <div class="sub">${esc(tema.titulo)}</div>
      <div class="orna"><i></i><span>✦</span><i></i></div>
      <div class="declara">Certificamos que o equipamento abaixo foi adquirido no <b>${esc(c.emp.nome)}</b>, conferido e entregue em perfeito funcionamento,
        e está coberto por garantia de <b>${esc(g.texto)}</b> contra defeitos de fabricação, de <b>${dataExtenso(v.data)}</b> a <b>${dataExtenso(g.validaAte)}</b>.</div>
      <div class="corpo">
        <div class="foto">${i.imagemUrl ? `<img src="${esc(i.imagemUrl)}" alt="">` : ICONES[i.tipo!]}</div>
        <div class="ficha">
          <div class="prod">${esc(i.descricao)}</div>
          <table>${linhas.map(([r, val]) => `<tr><td>${esc(r)}</td><td>${esc(val)}</td></tr>`).join('')}</table>
          ${i.especificacoes.length ? `<div class="specs">${i.especificacoes.map((s) => `<span>${esc(s)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="selo">${selo(tema.cor, tema.cor2, String(g.meses ?? g.dias), g.meses ? (g.meses === 1 ? 'MÊS' : 'MESES') : 'DIAS')}
          <div class="ate">Válida até<b>${dataBr(g.validaAte)}</b></div></div>
      </div>
      <div class="cob">${['Defeitos de fabricação', 'Diagnóstico grátis na loja', 'Laboratório técnico próprio', 'Troca se o reparo passar de 30 dias'].map((t) => `<div>${ICONE_OK}${esc(t)}</div>`).join('')}</div>
      <div class="pe">
        <div class="ass"><span class="nome">${esc(c.emp.nome)}</span>${esc(v.vendedor?.nome ? 'Atendido por ' + v.vendedor.nome : 'Departamento de garantia')}</div>
        ${versiculoHtml(vers())}
        <div class="qr"><div style="text-align:right">Acione a garantia<br>${esc(c.emp.telefone || c.site)}<br>${esc(c.site)}</div><img src="${c.qrWhats || c.qrSite}" alt=""></div>
      </div>
      <div class="regras">Válido com a apresentação deste certificado ou do recibo/NF da compra. Cobre defeitos de fabricação; não cobre quedas, líquidos, oxidação, mau uso, surtos elétricos, lacre violado ou software. Termo completo na folha anexa.</div>
    </div>
  </section>`;
}

// =====================================================================================================
// TERMO DE GARANTIA (A4)
// =====================================================================================================
function termoGarantia(c: ContextoDoc, vers: () => Versiculo): string {
  const v = c.venda;
  const itens = c.itens.filter((i) => !i.servico && i.garantia.dias > 0);
  const temSeminovo = itens.some((i) => i.seminovo);
  const temCelular = itens.some((i) => i.tipo === 'IPHONE' || /celular|smartphone|iphone/i.test(i.descricao));
  const temBateria = itens.some((i) => i.tipo === 'NOTEBOOK' || i.tipo === 'IPHONE' || temCelular);
  return `<section class="folha"><div class="faixa"></div>
    ${topoA4(c, 'Termo de garantia', `Pedido ${v.numero}`, `Compra em ${dataBr(v.data)}`)}
    <div class="titulo-sec">Itens garantidos</div>
    <table class="itens"><thead><tr><th>Produto</th><th>Série / IMEI</th><th>Condição</th><th class="n">Garantia</th><th class="n">Válida até</th></tr></thead><tbody>
      ${itens.map((i) => `<tr><td><b>${esc(i.descricao)}</b></td><td>${esc(i.numeroSerie || `Pedido ${v.numero} · item ${i.idx}`)}</td><td>${i.seminovo ? 'Seminovo' : 'Novo'}</td><td class="n"><b>${esc(i.garantia.texto)}</b></td><td class="n">${dataBr(i.garantia.validaAte)}</td></tr>`).join('')}
    </tbody></table>
    <div class="caixas" style="margin-top:7px"><div class="caixa"><span class="r">Cliente</span><b>${esc(v.contato.nome)}</b>${v.contato.documento ? ` · ${esc(formatarDocumento(v.contato.documento))}` : ''}</div>
      <div class="caixa"><span class="r">Prazos</span>Aparelhos novos: <b>12 meses</b> · seminovos: <b>3 meses</b>${itens.some((i) => !i.tipo && !i.seminovo) ? ' · acessórios: conforme a tabela acima' : ''}. Já incluída a garantia legal de 90 dias (CDC, art. 26).</div></div>
    <div class="estica">
      <div class="duas">
        <div class="bloco ok"><h3>${ICONE_OK} O que a garantia cobre</h3><ul>
          <li>Defeitos de fabricação em peças e componentes, com uso normal.</li>
          <li>Falhas de funcionamento que não tenham sido causadas pelo usuário.</li>
          <li>Mão de obra do nosso laboratório para o reparo ou a troca da peça.</li>
          <li>Troca do produto quando o reparo não for possível em até 30 dias (CDC, art. 18).</li>
          ${c.itens.some((i) => i.tipo === 'PC' || i.tipo === 'PC_GAMER') ? '<li>Montagem e configuração feitas pela loja (conexões, cabos, BIOS).</li>' : ''}
          ${temSeminovo ? '<li>Seminovos: funcionamento conforme revisado e testado na entrega.</li>' : ''}
          <li>Diagnóstico gratuito na loja durante todo o prazo.</li>
        </ul></div>
        <div class="bloco nao"><h3>${ICONE_X} O que a garantia não cobre</h3><ul>
          <li>Quedas, batidas, trincas, telas quebradas e amassados.</li>
          <li>Contato com líquidos, umidade, oxidação, sujeira ou insetos.</li>
          <li>Surtos e picos de energia, raios, tomada sem aterramento ou fonte inadequada.</li>
          <li>Lacre violado ou conserto/abertura por terceiros.</li>
          <li>Vírus, programas, formatação, senhas e perda de dados — faça backup.</li>
          ${temBateria ? '<li>Desgaste natural da bateria e perda de autonomia com o uso.</li>' : ''}
          <li>Desgaste de uso: riscos, teclas, borrachas, cabos e acessórios.</li>
          <li>Overclock, alterações de hardware ou uso fora das especificações.</li>
        </ul></div>
      </div>
      <div class="duas">
        <div class="bloco info"><h3>${ICONE_ESCUDO} Como acionar</h3><ul>
          <li>Traga o produto à loja com este termo, o certificado ou o recibo/NF.</li>
          <li>Na avaliação emitimos a ordem de serviço com o prazo do reparo.</li>
          <li>Atendimento: ${esc(c.emp.telefone || '')} ${c.emp.email ? '· ' + esc(c.emp.email) : ''} · ${esc(c.emp.endereco)}.</li>
          <li>Se o defeito não for coberto, você recebe o orçamento antes de qualquer serviço.</li>
        </ul></div>
        <div class="bloco alerta"><h3>${ICONE_ALERTA} Cuidados que prolongam a vida do equipamento</h3><ul>
          <li>Use estabilizador ou nobreak e tomada com aterramento.</li>
          <li>Mantenha as entradas de ar livres; limpeza interna a cada 12 meses.</li>
          <li>Mantenha o sistema e o antivírus atualizados e faça backup.</li>
          ${temCelular ? '<li>Use capa e película; evite carregar no calor ou com carregador não certificado.</li>' : '<li>Transporte em mochila acolchoada e desligado.</li>'}
        </ul></div>
      </div>
      <div class="assin"><div>${esc(c.emp.nome)}</div><div>${esc(v.contato.nome)} — li e recebi o termo de garantia</div></div>
    </div>
    ${rodapeA4(c, vers(), 'Garantia contratual complementar à legal (CDC, arts. 26 e 50)')}
  </section>`;
}

// =====================================================================================================
// LICENÇAS — Windows 11 Pro + Office 2021 Professional (A4)
// =====================================================================================================
function folhaLicencas(c: ContextoDoc, vers: () => Versiculo): string {
  const v = c.venda;
  const o = OFERTA_LICENCA;
  const equip = c.certificados.filter((i) => i.tipo === 'PC' || i.tipo === 'PC_GAMER' || i.tipo === 'NOTEBOOK').map((i) => i.descricao).join(', ');
  return `<section class="folha"><div class="faixa"></div>
    ${topoA4(c, 'Licenciamento original', `Pedido ${v.numero}`, dataBr(v.data))}
    <div style="margin-top:9px" class="oferta">
      <div><div class="t">Seu ${esc(c.certificados.find((i) => i.tipo)?.tipo === 'NOTEBOOK' ? 'notebook' : 'computador')} merece software original.</div>
        <div class="s">${esc(o.windows)} + ${esc(o.office)} (${o.officeApps.join(', ')}), instalados e ativados pela nossa equipe no seu equipamento${equip ? `: ${esc(equip.slice(0, 120))}` : ''}.</div></div>
      <div class="preco"><div class="de">Preço especial na compra</div><div class="v">${moeda(o.preco)}</div><div class="q">pacote completo · instalação inclusa</div></div>
    </div>
    <div class="estica">
      <div class="duas">
        <div class="bloco ok"><h3>${ICONE_JANELA} O que o ${esc(o.windows)} traz</h3><ul>
          <li>Atualizações de segurança e de recursos direto da Microsoft.</li>
          <li>BitLocker: criptografa o disco e protege seus arquivos se o equipamento for perdido ou roubado.</li>
          <li>Área de Trabalho Remota para acessar este computador de outro lugar.</li>
          <li>Windows Sandbox e Hyper-V para testar programas com segurança.</li>
          <li>Ingressar em domínio e políticas de grupo: pronto para empresas.</li>
          <li>Sem marca d’água “Ativar o Windows” e com personalização liberada.</li>
          <li>Licença original vinculada ao equipamento, válida para reinstalações.</li>
        </ul></div>
        <div class="bloco ok"><h3>${ICONE_OK} O que o ${esc(o.office)} traz</h3><ul>
          <li>${o.officeApps.join(', ')} instalados no computador.</li>
          <li>Licença perpétua: paga uma vez, sem mensalidade.</li>
          <li>Funciona sem internet e abre/edita os formatos usados por escolas, empresas e órgãos públicos.</li>
          <li>Ativação original: sem programas de ativação, cracks ou geradores de chave.</li>
          <li>Instalação e ativação feitas pela loja, com o equipamento testado na entrega.</li>
        </ul>
        <div style="font-size:8.5px;color:#4b5563;margin-top:4px">A Microsoft encerrou o suporte do Office 2021 em 13/10/2026: ele segue funcionando, mas não recebe novas atualizações de segurança. Se preferir uma versão com suporte, consulte-nos.</div></div>
      </div>
      <div class="bloco nao" style="flex:1"><h3>${ICONE_ALERTA} Os riscos de usar sistema ou Office sem licença</h3>
        <div class="duas" style="gap:4px 16px"><ul>
          <li><b>Vírus e sequestro de dados:</b> ativadores e “cracks” são a porta de entrada mais comum de ransomware e programas espiões.</li>
          <li><b>Senhas e bancos expostos:</b> versões alteradas podem capturar o que você digita.</li>
          <li><b>Sem atualizações:</b> falhas de segurança ficam abertas e o sistema fica instável.</li>
        </ul><ul>
          <li><b>Perda de arquivos:</b> travamentos, telas azuis e corrompimento de documentos.</li>
          <li><b>Risco legal:</b> uso de software sem licença é crime (Lei 9.609/98, art. 12) e gera multa e indenização, principalmente para empresas.</li>
          <li><b>Bloqueios e avisos:</b> recursos limitados, marca d’água e reativações frequentes.</li>
        </ul></div></div>
      <div class="aceite">
        <div><span class="q"></span><b>Quero o pacote ${esc(o.titulo)} por ${moeda(o.preco)}</b><br><span class="q"></span>Não desejo o licenciamento original neste momento</div>
        <div class="linha">${esc(v.contato.nome)}</div>
        <div class="linha">${esc(v.vendedor?.nome || c.emp.nome)} · ${dataBr(v.data)}</div>
      </div>
    </div>
    ${rodapeA4(c, vers(), `Oferta válida na ocasião da compra do equipamento (pedido ${v.numero}) · Windows e Office são marcas da Microsoft Corporation`)}
  </section>`;
}

// =====================================================================================================
// montagem
// =====================================================================================================
/** Só as folhas do kit de garantia (certificados + termo + licenças), na ordem de impressão */
function kit(c: ContextoDoc, vers: () => Versiculo): string {
  const partes: string[] = [];
  let numero = 0;
  // um certificado por aparelho (2 notebooks = 2 certificados), até 10 por item
  for (const i of c.certificados) {
    for (let q = 0; q < Math.max(1, Math.min(Math.round(i.quantidade), 10)); q++) partes.push(certificado(c, i, ++numero, vers));
  }
  if (c.certificados.length) partes.push(termoGarantia(c, vers));
  if (c.temLicenca) partes.push(folhaLicencas(c, vers));
  return partes.join('');
}

export function htmlDocumento(c: ContextoDoc, formato: FormatoDoc): string {
  const vers = sorteador();
  const n = c.venda.numero;
  if (formato === 'cupom') return pagina(`Recibo ${n} (80mm)`, cupom80(c, vers), true);
  if (formato === 'garantia') {
    const k = kit(c, vers);
    // sem aparelho com certificado: o recibo A4 já traz a garantia de cada item
    return pagina(`Garantia — pedido ${n}`, k || reciboA4(c, vers));
  }
  return pagina(`Recibo ${n}`, reciboA4(c, vers) + kit(c, vers));
}
