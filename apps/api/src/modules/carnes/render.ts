/**
 * CARNÊ IMPRESSO (HTML pronto para imprimir em A4 ou "Salvar como PDF").
 * Pedido do Thiago (28/10/2026): 3 por página, igual carnê, com capa e página final de agradecimento —
 * a loja corta, monta e grampeia. Por isso capa e agradecimento têm o mesmo tamanho das parcelas
 * (1/3 de A4): capa → parcelas → agradecimento, na ordem, 3 por folha.
 * Cada parcela: canhoto à esquerda (fica no carnê, lado do grampo) e a lâmina com o QR Code do PIX.
 */
import QRCode from 'qrcode';
import { esc, formatarDocumento, formatarTelefone } from '../comum/html.js';
import { COR_MARCA } from '../documentos/config.js';
import { VERSICULOS } from '../documentos/versiculos.js';
import type { carneCompleto } from './service.js';

type Carne = Awaited<ReturnType<typeof carneCompleto>>;
type Empresa = { nome: string; razaoSocial: string; cnpj: string; telefone: string; email: string; site: string; endereco: string; logoSrc: string | null };

const moeda = (v: number) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBr = (d: Date | string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const pct = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%';

const CSS = `
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #e5e7eb; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; color: #111827; }
@page { size: A4; margin: 0; }
.botoes { position: fixed; top: 10px; right: 10px; z-index: 10; display: flex; gap: 6px; }
.botoes button { padding: 8px 14px; font-size: 13px; cursor: pointer; border: 0; border-radius: 6px; background: ${COR_MARCA}; color: #fff; font-weight: 600; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
@media print { html, body { background: #fff; } .botoes { display: none !important; } .folha { margin: 0 !important; box-shadow: none !important; } }
.folha { width: 210mm; height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 4px 18px rgba(0,0,0,.15); page-break-after: always; break-after: page; display: flex; flex-direction: column; overflow: hidden; }
.folha:last-child { page-break-after: auto; break-after: auto; }
.lamina { height: 99mm; position: relative; display: flex; border-bottom: 1px dashed #9ca3af; overflow: hidden; }
.lamina:last-child { border-bottom: 0; }
.lamina .tesoura { position: absolute; right: 4mm; bottom: -2.4mm; font-size: 10px; color: #9ca3af; background: #fff; padding: 0 2px; }
.vazia { background: repeating-linear-gradient(45deg, #fff, #fff 6px, #f9fafb 6px, #f9fafb 12px); }
/* canhoto (fica no carnê, lado do grampo) */
.canhoto { width: 58mm; padding: 6mm 4mm 5mm 12mm; border-right: 1px dashed #9ca3af; font-size: 9px; display: flex; flex-direction: column; gap: 1.6mm; position: relative; background: #fafafa; }
.canhoto .grampo { position: absolute; left: 4mm; top: 0; bottom: 0; width: 0; border-left: 1px dotted #d1d5db; }
.canhoto .t { font-size: 8px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; font-weight: 700; }
.canhoto .v { font-size: 11px; font-weight: 700; }
.canhoto .grande { font-size: 15px; font-weight: 800; color: ${COR_MARCA}; }
.canhoto .linha { border-bottom: 1px solid #9ca3af; height: 5mm; }
/* lâmina da parcela */
.corpo { flex: 1; padding: 5mm 7mm 4mm 6mm; display: flex; flex-direction: column; font-size: 9.5px; }
.cab { display: flex; align-items: center; gap: 8px; border-bottom: 2px solid ${COR_MARCA}; padding-bottom: 2mm; }
.cab img { height: 9mm; max-width: 34mm; object-fit: contain; }
.cab .emp { flex: 1; line-height: 1.3; font-size: 8.5px; color: #374151; }
.cab .emp b { font-size: 10px; color: #111; }
.cab .num { text-align: right; font-size: 9px; color: #374151; }
.cab .num b { display: block; font-size: 15px; color: #111; }
.meio { flex: 1; display: flex; gap: 5mm; padding-top: 3mm; }
.dados { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 2.2mm 4mm; align-content: start; }
.dados .c { border: 1px solid #e5e7eb; border-radius: 4px; padding: 1.4mm 2mm; }
.dados .c .t { font-size: 7.5px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; font-weight: 700; }
.dados .c .v { font-size: 11px; font-weight: 700; margin-top: .4mm; }
.dados .c.destaque { background: #fef2f2; border-color: #fecaca; }
.dados .c.destaque .v { font-size: 17px; color: ${COR_MARCA}; }
.dados .full { grid-column: 1 / -1; }
.qr { width: 40mm; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1mm; }
.qr img { width: 36mm; height: 36mm; }
.qr .pix { font-weight: 800; font-size: 11px; color: #0f766e; letter-spacing: .03em; }
.qr .como { font-size: 7.5px; color: #374151; line-height: 1.25; }
.copia { margin-top: 2mm; font-family: Consolas, 'Courier New', monospace; font-size: 6.6px; color: #374151; word-break: break-all; line-height: 1.25; background: #f3f4f6; border-radius: 3px; padding: 1.2mm 1.6mm; }
.copia b { font-family: Arial, sans-serif; font-size: 7px; color: #111; }
.rodape { margin-top: 1.6mm; font-size: 7.3px; color: #6b7280; display: flex; justify-content: space-between; gap: 6px; }
.paga { position: absolute; left: 92mm; top: 64mm; transform: rotate(-14deg); border: 3px solid #16a34a; color: #16a34a; font-weight: 900; font-size: 22px; padding: 1mm 4mm; border-radius: 6px; opacity: .85; background: rgba(255,255,255,.7); }
/* capa e agradecimento (mesmo tamanho da lâmina) */
.capa { flex: 1; display: flex; background: linear-gradient(120deg, #fff 0 62%, #fef2f2 62% 100%); }
.capa .esq { width: 58mm; padding: 7mm 4mm 6mm 12mm; border-right: 1px dashed #9ca3af; display: flex; flex-direction: column; justify-content: space-between; background: ${COR_MARCA}; color: #fff; }
.capa .esq .titulo { font-size: 21px; font-weight: 900; line-height: 1.05; letter-spacing: .02em; }
.capa .esq .sub { font-size: 9px; opacity: .9; margin-top: 2mm; }
.capa .esq .num { font-size: 10px; }
.capa .esq .num b { display: block; font-size: 26px; font-weight: 900; }
.capa .dir { flex: 1; padding: 6mm 7mm 5mm 6mm; display: flex; flex-direction: column; gap: 2.5mm; font-size: 9.5px; }
.capa .dir img.logo { height: 12mm; max-width: 60mm; object-fit: contain; align-self: flex-start; }
.capa .cliente { border-left: 3px solid ${COR_MARCA}; padding-left: 3mm; }
.capa .cliente b { font-size: 13px; display: block; }
.capa table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
.capa td { padding: 1mm 1.5mm; border-bottom: 1px solid #f3f4f6; }
.capa td.v { text-align: right; font-weight: 700; }
.capa .passos { display: flex; gap: 3mm; font-size: 8px; color: #374151; }
.capa .passos div { flex: 1; background: #f9fafb; border-radius: 4px; padding: 1.4mm 2mm; }
.capa .passos b { color: ${COR_MARCA}; font-size: 11px; display: block; }
.fim { flex: 1; display: flex; }
.fim .esq { width: 58mm; padding: 7mm 4mm 6mm 12mm; border-right: 1px dashed #9ca3af; background: #111827; color: #fff; display: flex; flex-direction: column; justify-content: center; gap: 3mm; }
.fim .esq .obrigado { font-size: 24px; font-weight: 900; line-height: 1.05; }
.fim .esq .sub { font-size: 9px; opacity: .85; }
.fim .dir { flex: 1; padding: 7mm 8mm 6mm 7mm; display: flex; flex-direction: column; justify-content: space-between; font-size: 10px; }
.fim .msg { font-size: 11.5px; line-height: 1.5; color: #1f2937; }
.fim .versiculo { font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #374151; font-size: 10.5px; border-left: 3px solid ${COR_MARCA}; padding-left: 3mm; }
.fim .versiculo b { font-style: normal; font-family: Arial, sans-serif; color: ${COR_MARCA}; font-size: 9px; }
.fim .contatos { display: flex; align-items: center; gap: 4mm; }
.fim .contatos img { width: 22mm; height: 22mm; }
.fim .contatos .tx { flex: 1; line-height: 1.5; font-size: 9px; color: #374151; }
`;

function capa(c: Carne, e: Empresa) {
  const ultima = c.parcelasLista[c.parcelasLista.length - 1];
  return `<div class="lamina"><div class="capa">
    <div class="esq">
      <div><div class="titulo">CARNÊ DE<br>PAGAMENTO</div><div class="sub">Pague cada parcela por PIX, lendo o QR Code com o app do seu banco.</div></div>
      <div class="num">Carnê nº<b>${c.numero}</b>${c.venda ? `Venda nº ${c.venda.numero}` : ''}</div>
    </div>
    <div class="dir">
      ${e.logoSrc ? `<img class="logo" src="${e.logoSrc}" alt="">` : `<b style="font-size:16px">${esc(e.nome)}</b>`}
      <div class="cliente"><span style="font-size:8px;color:#6b7280;text-transform:uppercase;font-weight:700;letter-spacing:.05em">Cliente</span><b>${esc(c.cliente.nome)}</b>${c.cliente.documento ? `CPF/CNPJ ${esc(formatarDocumento(c.cliente.documento))}` : ''}${c.cliente.celular || c.cliente.telefone ? ` · ${esc(formatarTelefone(c.cliente.celular || c.cliente.telefone))}` : ''}</div>
      <table>
        <tr><td>Valor financiado</td><td class="v">${moeda(c.valorFinanciado)}</td><td>Emissão</td><td class="v">${dataBr(c.dataEmissao)}</td></tr>
        <tr><td>Parcelas</td><td class="v">${c.parcelasLista.length}x de ${moeda(c.valorParcela)}</td><td>1º vencimento</td><td class="v">${dataBr(c.primeiroVencimento)}</td></tr>
        <tr><td>Juros</td><td class="v">${pct(c.taxaMensalPct)} ao mês</td><td>Último vencimento</td><td class="v">${ultima ? dataBr(ultima.vencimento) : '—'}</td></tr>
        <tr><td>Total do carnê</td><td class="v">${moeda(c.total)}</td><td>Após o vencimento</td><td class="v">multa ${pct(c.multaPct)} + ${pct(c.moraMesPct)} a.m.</td></tr>
      </table>
      <div class="passos"><div><b>1</b>Abra o app do banco e escolha <b style="display:inline;font-size:8px">Pix › Ler QR Code</b>.</div><div><b>2</b>Aponte para o QR da parcela: valor e recebedor aparecem sozinhos.</div><div><b>3</b>Confira <b style="display:inline;font-size:8px">${esc(c.recebedor.nome)}</b> e confirme.</div></div>
      <div style="font-size:7.5px;color:#6b7280">${esc(e.razaoSocial || e.nome)} · CNPJ ${esc(e.cnpj)} · ${esc(e.endereco)}${e.telefone ? ` · ${esc(e.telefone)}` : ''}</div>
    </div>
  </div><span class="tesoura">✂</span></div>`;
}

async function parcela(c: Carne, p: Carne['parcelasLista'][number], e: Empresa) {
  const qr = await QRCode.toDataURL(p.pix, { margin: 1, width: 320, errorCorrectionLevel: 'M' });
  const n = c.parcelasLista.length;
  const paga = p.situacao === 'RECEBIDO';
  return `<div class="lamina">
    <div class="canhoto"><span class="grampo"></span>
      <div class="t">Canhoto do cliente</div>
      <div><div class="t">Carnê nº</div><div class="v">${c.numero}</div></div>
      <div><div class="t">Parcela</div><div class="grande">${p.carneParcela}/${n}</div></div>
      <div><div class="t">Vencimento</div><div class="v">${dataBr(p.vencimento)}</div></div>
      <div><div class="t">Valor</div><div class="v">${moeda(p.valor)}</div></div>
      <div style="margin-top:auto"><div class="t">Pago em</div><div class="linha"></div></div>
    </div>
    <div class="corpo">
      <div class="cab">
        ${e.logoSrc ? `<img src="${e.logoSrc}" alt="">` : ''}
        <div class="emp"><b>${esc(e.nome)}</b><br>${esc(e.telefone)}${e.site ? ` · ${esc(e.site)}` : ''}</div>
        <div class="num">Carnê nº ${c.numero}<b>Parcela ${p.carneParcela}/${n}</b></div>
      </div>
      <div class="meio">
        <div class="dados">
          <div class="c destaque"><div class="t">Vencimento</div><div class="v">${dataBr(p.vencimento)}</div></div>
          <div class="c destaque"><div class="t">Valor</div><div class="v">${moeda(p.valor)}</div></div>
          <div class="c full"><div class="t">Cliente</div><div class="v">${esc(c.cliente.nome)}</div></div>
          <div class="c full"><div class="t">Recebedor (PIX)</div><div class="v" style="font-size:9.5px">${esc(c.recebedor.nome)} · ${c.recebedor.chave.length === 14 ? 'CNPJ ' + esc(formatarDocumento(c.recebedor.chave)) : 'Chave ' + esc(c.recebedor.chave)} · Banco Cora</div></div>
        </div>
        <div class="qr"><img src="${qr}" alt="QR Code PIX"><div class="pix">PAGUE COM PIX</div><div class="como">Pix › Ler QR Code<br>ou copie o código abaixo</div></div>
      </div>
      <div class="copia"><b>PIX copia e cola:</b> ${esc(p.pix)}</div>
      <div class="rodape"><span>Após o vencimento: multa de ${pct(c.multaPct)} + juros de ${pct(c.moraMesPct)} ao mês. Atrasou? Chame no WhatsApp ${esc(e.telefone)} e mandamos o PIX atualizado.</span><span>${c.venda ? `Venda nº ${c.venda.numero}` : ''}</span></div>
    </div>
    ${paga ? `<div class="paga">PAGA${p.dataRecebimento ? ' ' + dataBr(p.dataRecebimento) : ''}</div>` : ''}
    <span class="tesoura">✂</span>
  </div>`;
}

async function agradecimento(c: Carne, e: Empresa) {
  const v = VERSICULOS[c.numero % VERSICULOS.length];
  const fone = (e.telefone || '').replace(/\D/g, '');
  const site = e.site ? (/^https?:\/\//.test(e.site) ? e.site : `https://${e.site}`) : null;
  const alvo = fone.length >= 10 ? `https://wa.me/55${fone}` : site;
  const qr = alvo ? await QRCode.toDataURL(alvo, { margin: 0, width: 200 }) : null;
  return `<div class="lamina"><div class="fim">
    <div class="esq"><div class="obrigado">Obrigado<br>pela<br>confiança!</div><div class="sub">Guarde este carnê até a última parcela.</div></div>
    <div class="dir">
      <div class="msg">${esc(c.cliente.nome.split(' ')[0])}, é uma alegria ter você com a gente. Qualquer dúvida sobre o carnê, precisando de 2ª via ou do PIX atualizado, é só chamar. Bom proveito!</div>
      <div class="versiculo">“${esc(v.texto)}” <b>— ${esc(v.ref)}</b></div>
      <div class="contatos">${qr ? `<img src="${qr}" alt="">` : ''}<div class="tx"><b>${esc(e.nome)}</b><br>${esc(e.telefone)}${e.email ? ` · ${esc(e.email)}` : ''}${e.site ? `<br>${esc(e.site)}` : ''}<br>${esc(e.endereco)}</div></div>
    </div>
  </div></div>`;
}

export async function htmlCarne(c: Carne, e: Empresa, opcoes: { soAbertas?: boolean } = {}) {
  const lista = opcoes.soAbertas ? c.parcelasLista.filter((p) => p.situacao !== 'RECEBIDO') : c.parcelasLista;
  const laminas = [capa(c, e), ...(await Promise.all(lista.map((p) => parcela(c, p, e)))), await agradecimento(c, e)];
  const folhas: string[] = [];
  for (let i = 0; i < laminas.length; i += 3) {
    const grupo = laminas.slice(i, i + 3);
    while (grupo.length < 3) grupo.push('<div class="lamina vazia"></div>');
    folhas.push(`<div class="folha">${grupo.join('')}</div>`);
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Carnê nº ${c.numero} — ${esc(c.cliente.nome)}</title><style>${CSS}</style></head>
<body><div class="botoes"><button onclick="window.print()">Imprimir / salvar PDF</button></div>${folhas.join('')}</body></html>`;
}
