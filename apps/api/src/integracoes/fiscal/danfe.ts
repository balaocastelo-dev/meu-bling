/**
 * Geração do DANFE (NF-e, A4 retrato) e do DANFE NFC-e (cupom 80mm com QR Code) em PDF.
 */
import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import type { Empresa } from '@prisma/client';
import type { NotaCompleta } from './xml.js';
import { formatarChave } from './chave.js';

const moeda = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docFmt = (d?: string | null) => {
  const s = (d || '').replace(/\D/g, '');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return d || '';
};
const dataFmt = (d?: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
const horaFmt = (d?: Date | null) => (d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

async function barcode(chave: string): Promise<Buffer> {
  return bwipjs.toBuffer({ bcid: 'code128', text: chave, scale: 3, height: 14, includetext: false });
}

function pdfParaBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** DANFE A4 para NF-e (modelo 55). */
export async function gerarDanfe(emp: Empresa, nota: NotaCompleta): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 20, info: { Title: `DANFE ${nota.numero}` } });
  const W = 595.28 - 40; // largura útil
  const x0 = 20;
  let y = 20;
  const dest = nota.contato;
  const cancelada = nota.situacao === 'CANCELADA';
  const homolog = nota.ambiente === 2;

  const box = (x: number, yy: number, w: number, h: number, titulo?: string, valor?: string, opts: { bold?: boolean; size?: number; align?: 'left' | 'center' | 'right' } = {}) => {
    doc.rect(x, yy, w, h).lineWidth(0.5).stroke('#000');
    if (titulo) doc.font('Helvetica').fontSize(5.5).fillColor('#333').text(titulo.toUpperCase(), x + 2, yy + 2, { width: w - 4, lineBreak: false });
    if (valor !== undefined) doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 8).fillColor('#000').text(valor, x + 2, yy + (titulo ? 9 : 3), { width: w - 4, align: opts.align || 'left', lineBreak: false });
  };

  // ---- Cabeçalho
  const hCab = 78;
  const wEmit = W * 0.42, wDanfe = W * 0.16, wCod = W - wEmit - wDanfe;
  doc.rect(x0, y, wEmit, hCab).lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(emp.razaoSocial, x0 + 6, y + 8, { width: wEmit - 12, align: 'center' });
  doc.font('Helvetica').fontSize(7).text(
    [`${emp.logradouro || ''}, ${emp.numero || ''} ${emp.complemento || ''}`.trim(), `${emp.bairro || ''} - ${emp.municipio || ''}/${emp.uf || ''} - CEP ${emp.cep || ''}`, `Fone: ${emp.telefone || ''}  ${emp.email || ''}`].join('\n'),
    x0 + 6, y + 30, { width: wEmit - 12, align: 'center' },
  );
  doc.rect(x0 + wEmit, y, wDanfe, hCab).stroke();
  doc.font('Helvetica-Bold').fontSize(12).text('DANFE', x0 + wEmit, y + 5, { width: wDanfe, align: 'center' });
  doc.font('Helvetica').fontSize(5.5).text('Documento Auxiliar da\nNota Fiscal Eletrônica', x0 + wEmit, y + 20, { width: wDanfe, align: 'center' });
  doc.fontSize(6).text(`${nota.tipo === 0 ? '0 - ENTRADA' : '1 - SAÍDA'}`, x0 + wEmit, y + 38, { width: wDanfe, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(8).text(`Nº ${String(nota.numero).padStart(9, '0')}\nSÉRIE ${nota.serie}\nFolha 1/1`, x0 + wEmit, y + 48, { width: wDanfe, align: 'center' });
  doc.rect(x0 + wEmit + wDanfe, y, wCod, hCab).stroke();
  if (nota.chave) {
    const png = await barcode(nota.chave);
    doc.image(png, x0 + wEmit + wDanfe + 8, y + 6, { width: wCod - 16, height: 36 });
    doc.font('Helvetica').fontSize(5.5).text('CHAVE DE ACESSO', x0 + wEmit + wDanfe + 4, y + 46, { width: wCod - 8 });
    doc.font('Helvetica-Bold').fontSize(7).text(formatarChave(nota.chave), x0 + wEmit + wDanfe + 4, y + 54, { width: wCod - 8, align: 'center' });
    doc.font('Helvetica').fontSize(5.5).text('Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora', x0 + wEmit + wDanfe + 4, y + 64, { width: wCod - 8, align: 'center' });
  }
  y += hCab + 2;

  // ---- Natureza / protocolo
  box(x0, y, W * 0.55, 22, 'Natureza da operação', nota.naturezaOperacao);
  box(x0 + W * 0.55, y, W * 0.45, 22, 'Protocolo de autorização de uso', nota.protocolo ? `${nota.protocolo} - ${dataFmt(nota.dataAutorizacao)} ${horaFmt(nota.dataAutorizacao)}` : (nota.situacao === 'PENDENTE' ? 'NÃO TRANSMITIDA' : nota.motivo || ''));
  y += 22;
  box(x0, y, W / 3, 22, 'Inscrição estadual', emp.ie || 'ISENTO');
  box(x0 + W / 3, y, W / 3, 22, 'Inscrição estadual do subst. tributário', '');
  box(x0 + (2 * W) / 3, y, W / 3, 22, 'CNPJ', docFmt(emp.cnpj));
  y += 26;

  // ---- Destinatário
  doc.font('Helvetica-Bold').fontSize(7).text('DESTINATÁRIO / REMETENTE', x0, y);
  y += 9;
  box(x0, y, W * 0.6, 22, 'Nome / Razão social', homolog ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : dest?.nome || '');
  box(x0 + W * 0.6, y, W * 0.25, 22, 'CNPJ / CPF', docFmt(dest?.documento));
  box(x0 + W * 0.85, y, W * 0.15, 22, 'Data da emissão', dataFmt(nota.dataEmissao));
  y += 22;
  box(x0, y, W * 0.5, 22, 'Endereço', `${dest?.logradouro || ''}, ${dest?.numero || ''} ${dest?.complemento || ''}`.trim());
  box(x0 + W * 0.5, y, W * 0.25, 22, 'Bairro / Distrito', dest?.bairro || '');
  box(x0 + W * 0.75, y, W * 0.1, 22, 'CEP', dest?.cep || '');
  box(x0 + W * 0.85, y, W * 0.15, 22, 'Data saída/entrada', dataFmt(nota.dataSaida || nota.dataEmissao));
  y += 22;
  box(x0, y, W * 0.4, 22, 'Município', dest?.municipio || '');
  box(x0 + W * 0.4, y, W * 0.2, 22, 'Fone / Fax', dest?.telefone || dest?.celular || '');
  box(x0 + W * 0.6, y, W * 0.08, 22, 'UF', dest?.uf || '');
  box(x0 + W * 0.68, y, W * 0.17, 22, 'Inscrição estadual', dest?.ie || '');
  box(x0 + W * 0.85, y, W * 0.15, 22, 'Hora da saída', horaFmt(nota.dataSaida || nota.dataEmissao));
  y += 26;

  // ---- Cálculo do imposto
  doc.font('Helvetica-Bold').fontSize(7).text('CÁLCULO DO IMPOSTO', x0, y);
  y += 9;
  const c6 = W / 6;
  box(x0, y, c6, 22, 'Base de cálculo do ICMS', moeda(0), { align: 'right' });
  box(x0 + c6, y, c6, 22, 'Valor do ICMS', moeda(nota.valorIcms), { align: 'right' });
  box(x0 + 2 * c6, y, c6, 22, 'Base de cálculo ICMS ST', moeda(0), { align: 'right' });
  box(x0 + 3 * c6, y, c6, 22, 'Valor do ICMS ST', moeda(0), { align: 'right' });
  box(x0 + 4 * c6, y, c6, 22, 'Valor aprox. tributos', moeda(nota.itens.reduce((s, i) => s + (i.valorTributosAprox || 0), 0)), { align: 'right' });
  box(x0 + 5 * c6, y, c6, 22, 'Valor total dos produtos', moeda(nota.valorProdutos), { align: 'right', bold: true });
  y += 22;
  box(x0, y, c6, 22, 'Valor do frete', moeda(nota.valorFrete), { align: 'right' });
  box(x0 + c6, y, c6, 22, 'Valor do seguro', moeda(0), { align: 'right' });
  box(x0 + 2 * c6, y, c6, 22, 'Desconto', moeda(nota.valorDesconto), { align: 'right' });
  box(x0 + 3 * c6, y, c6, 22, 'Outras despesas', moeda(nota.valorOutras), { align: 'right' });
  box(x0 + 4 * c6, y, c6, 22, 'Valor do IPI', moeda(0), { align: 'right' });
  box(x0 + 5 * c6, y, c6, 22, 'Valor total da nota', moeda(nota.valorTotal), { align: 'right', bold: true, size: 9 });
  y += 26;

  // ---- Transporte
  doc.font('Helvetica-Bold').fontSize(7).text('TRANSPORTADOR / VOLUMES TRANSPORTADOS', x0, y);
  y += 9;
  const frete = ['0 - Emitente', '1 - Destinatário', '2 - Terceiros', '3 - Próprio (remetente)', '4 - Próprio (destinatário)', '9 - Sem frete'];
  box(x0, y, W * 0.45, 22, 'Razão social', '');
  box(x0 + W * 0.45, y, W * 0.2, 22, 'Frete por conta', frete.find((f) => f.startsWith(String(nota.fretePorConta))) || '9 - Sem frete');
  box(x0 + W * 0.65, y, W * 0.15, 22, 'Placa do veículo', '');
  box(x0 + W * 0.8, y, W * 0.05, 22, 'UF', '');
  box(x0 + W * 0.85, y, W * 0.15, 22, 'CNPJ / CPF', '');
  y += 26;

  // ---- Produtos
  doc.font('Helvetica-Bold').fontSize(7).text('DADOS DOS PRODUTOS / SERVIÇOS', x0, y);
  y += 9;
  const cols = [
    { t: 'CÓDIGO', w: 0.09, a: 'left' }, { t: 'DESCRIÇÃO DO PRODUTO / SERVIÇO', w: 0.33, a: 'left' }, { t: 'NCM', w: 0.07, a: 'center' }, { t: 'CST', w: 0.05, a: 'center' }, { t: 'CFOP', w: 0.05, a: 'center' },
    { t: 'UN', w: 0.04, a: 'center' }, { t: 'QTD', w: 0.07, a: 'right' }, { t: 'V. UNIT', w: 0.09, a: 'right' }, { t: 'V. TOTAL', w: 0.09, a: 'right' }, { t: 'BC ICMS', w: 0.06, a: 'right' }, { t: 'V. ICMS', w: 0.06, a: 'right' },
  ] as const;
  doc.rect(x0, y, W, 12).fill('#eee').stroke();
  let cx = x0;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(5.5);
  for (const c of cols) { doc.text(c.t, cx + 2, y + 3, { width: c.w * W - 4, align: c.a, lineBreak: false }); cx += c.w * W; }
  y += 12;
  doc.font('Helvetica').fontSize(6.5);
  for (const it of nota.itens) {
    const alturaDesc = doc.heightOfString(it.descricao, { width: cols[1].w * W - 4 });
    const h = Math.max(12, alturaDesc + 4);
    if (y + h > 760) { doc.addPage(); y = 20; }
    doc.rect(x0, y, W, h).lineWidth(0.3).stroke();
    cx = x0;
    const vals = [it.codigo, it.descricao, it.ncm, it.csosn || it.cst || '', it.cfop, it.unidade, it.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 }), moeda(it.valorUnitario), moeda(it.valorTotal), moeda(it.icmsBase), moeda(it.icmsValor)];
    cols.forEach((c, i) => { doc.text(String(vals[i] ?? ''), cx + 2, y + 2, { width: c.w * W - 4, align: c.a }); cx += c.w * W; });
    y += h;
  }
  y += 6;

  // ---- Dados adicionais
  doc.font('Helvetica-Bold').fontSize(7).text('DADOS ADICIONAIS', x0, y);
  y += 9;
  const infAd = [nota.informacoesComplementares || '', homolog ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : '', nota.venda ? `Pedido de venda nº ${nota.venda.numero}` : '', nota.os ? `Ordem de serviço nº ${nota.os.numero}` : ''].filter(Boolean).join('\n');
  box(x0, y, W * 0.7, 60, 'Informações complementares', '');
  doc.font('Helvetica').fontSize(6.5).text(infAd, x0 + 2, y + 10, { width: W * 0.7 - 4, height: 48 });
  box(x0 + W * 0.7, y, W * 0.3, 60, 'Reservado ao fisco', '');

  if (cancelada) {
    doc.save().rotate(-30, { origin: [297, 420] }).font('Helvetica-Bold').fontSize(60).fillColor('#dc2626').opacity(0.35).text('CANCELADA', 100, 380, { width: 400, align: 'center' }).restore();
  } else if (nota.situacao !== 'AUTORIZADA') {
    doc.save().rotate(-30, { origin: [297, 420] }).font('Helvetica-Bold').fontSize(40).fillColor('#dc2626').opacity(0.3).text('SEM VALOR FISCAL', 60, 390, { width: 480, align: 'center' }).restore();
  }
  return pdfParaBuffer(doc);
}

/** DANFE NFC-e (modelo 65) — cupom 80mm com QR Code. */
export async function gerarDanfeNfce(emp: Empresa, nota: NotaCompleta): Promise<Buffer> {
  const largura = 226.77; // 80mm
  const doc = new PDFDocument({ size: [largura, 640 + nota.itens.length * 26], margin: 8, info: { Title: `NFC-e ${nota.numero}` } });
  const W = largura - 16;
  let y = 10;
  const texto = (txt: string, opts: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; x?: number; w?: number } = {}) => {
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 7);
    const w = opts.w ?? W;
    const h = doc.heightOfString(txt || ' ', { width: w });
    doc.text(txt || ' ', opts.x ?? 8, y, { width: w, align: opts.align ?? 'center' });
    y += h + 1;
  };
  const par = (l: string, v: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 8 : 7);
    doc.text(l, 8, y, { width: W * 0.62, align: 'left' });
    doc.text(v, 8 + W * 0.62, y, { width: W * 0.38, align: 'right' });
    y += (bold ? 10 : 9);
  };
  const linha = () => {
    doc.moveTo(8, y + 1).lineTo(8 + W, y + 1).lineWidth(0.5).dash(2, { space: 2 }).stroke('#000');
    doc.undash();
    y += 5;
  };

  texto(emp.nomeFantasia || emp.razaoSocial, { size: 9, bold: true });
  texto(`CNPJ ${docFmt(emp.cnpj)}   IE ${emp.ie || 'ISENTO'}`, { size: 6.5 });
  texto(`${emp.logradouro || ''}, ${emp.numero || ''} - ${emp.bairro || ''} - ${emp.municipio || ''}/${emp.uf || ''}`, { size: 6.5 });
  linha();
  texto('DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica', { size: 7, bold: true });
  if (nota.ambiente === 2) texto('EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL', { size: 6.5, bold: true });
  linha();
  doc.font('Helvetica-Bold').fontSize(6.5);
  doc.text('CÓD', 8, y, { width: 32 }); doc.text('DESCRIÇÃO', 42, y, { width: W - 34 });
  y += 9;
  doc.font('Helvetica').fontSize(6.5);
  for (const it of nota.itens) {
    doc.text(it.codigo.slice(0, 10), 8, y, { width: 34 });
    const h = doc.heightOfString(it.descricao, { width: W - 34 });
    doc.text(it.descricao, 42, y, { width: W - 34 });
    y += h + 1;
    doc.text(`${it.quantidade.toLocaleString('pt-BR')} ${it.unidade} x ${moeda(it.valorUnitario)}`, 42, y, { width: (W - 34) * 0.6 });
    doc.text(moeda(it.valorTotal), 42 + (W - 34) * 0.6, y, { width: (W - 34) * 0.4, align: 'right' });
    y += 10;
  }
  linha();
  par('Qtd. total de itens', String(nota.itens.length));
  par('Valor total dos produtos', moeda(nota.valorProdutos));
  if (nota.valorDesconto) par('Desconto', `- ${moeda(nota.valorDesconto)}`);
  par('VALOR A PAGAR', moeda(nota.valorTotal), true);
  const formas: Record<string, string> = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '05': 'Crédito loja', '15': 'Boleto', '16': 'Depósito', '17': 'PIX', '18': 'Transferência', '99': 'Outros' };
  par(`Pagamento: ${formas[nota.formaPagamentoFiscal] || nota.formaPagamentoFiscal}`, moeda(nota.valorTotal));
  linha();
  texto(`Consulte pela chave de acesso em ${nota.urlChave || 'www.nfce.fazenda.sp.gov.br/consulta'}`, { size: 6 });
  texto(nota.chave ? formatarChave(nota.chave) : '', { size: 6.5, bold: true });
  linha();
  if (nota.contato?.documento) texto(`CONSUMIDOR: ${docFmt(nota.contato.documento)} ${nota.contato.nome}`, { size: 6.5 });
  else texto('CONSUMIDOR NÃO IDENTIFICADO', { size: 6.5 });
  texto(`NFC-e nº ${nota.numero}  Série ${nota.serie}  —  ${dataFmt(nota.dataEmissao)} ${horaFmt(nota.dataEmissao)}`, { size: 6.5 });
  if (nota.protocolo) texto(`Protocolo de autorização: ${nota.protocolo}  ${dataFmt(nota.dataAutorizacao)} ${horaFmt(nota.dataAutorizacao)}`, { size: 6.5 });
  if (nota.qrCode) {
    const qr = await QRCode.toBuffer(nota.qrCode, { margin: 1, width: 150 });
    doc.image(qr, (largura - 110) / 2, y + 4, { width: 110 });
    y += 120;
  }
  const trib = nota.itens.reduce((s, i) => s + (i.valorTributosAprox || 0), 0);
  if (trib) texto(`Tributos totais incidentes (Lei Federal 12.741/2012): R$ ${moeda(trib)}`, { size: 6 });
  if (nota.situacao === 'CANCELADA') texto('*** NFC-e CANCELADA ***', { size: 9, bold: true });
  return pdfParaBuffer(doc);
}
