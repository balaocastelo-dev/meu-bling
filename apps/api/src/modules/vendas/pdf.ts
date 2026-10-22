/**
 * PDF do pedido de venda / orçamento (A4) — para anexar no e-mail e mandar como documento no WhatsApp.
 * Mesmo conteúdo da impressão HTML (imprimir.ts), gerado com pdfkit (sem navegador no servidor).
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { env } from '../../lib/env.js';
import { arredondar } from '../../lib/util.js';
import { dadosEmpresa, enderecoLinha, formatarDocumento, formatarTelefone } from '../comum/html.js';
import { logoParaPdf } from '../comum/logo.js';
import type { carregarVenda } from './service.js';

type Venda = Awaited<ReturnType<typeof carregarVenda>>;

const moeda = (v: number | null | undefined) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
const data = (d?: Date | string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');

function pdfParaBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function fretePorConta(v: number) {
  return ({ 0: 'Emitente (CIF)', 1: 'Destinatário (FOB)', 2: 'Terceiros', 9: 'Sem frete' } as Record<number, string>)[v] || String(v);
}

/** Nome do arquivo público do PDF (ex.: Orcamento-12.pdf / Pedido-24838.pdf). */
export function nomeArquivoPdf(v: { tipo: string; numero: number }) {
  return `${v.tipo === 'ORCAMENTO' ? 'Orcamento' : 'Pedido'}-${v.numero}.pdf`;
}

export async function pdfVenda(v: Venda): Promise<Buffer> {
  const emp = await dadosEmpresa();
  const c = v.contato;
  const orcamento = v.tipo === 'ORCAMENTO';
  const titulo = orcamento ? 'ORÇAMENTO' : 'PEDIDO DE VENDA';
  const descontoCalc = v.descontoTipo === 'PERCENTUAL' ? arredondar(v.totalProdutos * (v.descontoValor / 100)) : v.descontoValor;

  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `${titulo} nº ${v.numero}`, Author: emp.nome } });
  const x0 = 36;
  const W = 595.28 - 72;
  let y = 36;
  const cinza = '#555555';
  const preto = '#111111';
  const linha = (yy: number, cor = '#d1d5db', largura = 0.5) => doc.moveTo(x0, yy).lineTo(x0 + W, yy).lineWidth(largura).stroke(cor);

  // ---- Cabeçalho: logo + empresa à esquerda, documento à direita
  let xTexto = x0;
  // logo em PNG/JPEG (WEBP, SVG e GIF são convertidos — o PDFKit só lê PNG e JPEG)
  const logo = await logoParaPdf(emp.logoPath);
  if (logo) {
    try {
      doc.image(logo, x0, y, { fit: [110, 48] });
      xTexto = x0 + 120;
    } catch {
      /* logo inválido: segue sem */
    }
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor(preto).text(emp.nome, xTexto, y, { width: W * 0.6 - (xTexto - x0), lineBreak: false });
  doc.font('Helvetica').fontSize(8).fillColor(cinza).text(
    [[emp.razaoSocial, emp.cnpj ? 'CNPJ ' + emp.cnpj : '', emp.ie ? 'IE ' + emp.ie : ''].filter(Boolean).join(' — '), emp.endereco, [emp.telefone, emp.email, emp.site].filter(Boolean).join(' · ')].filter(Boolean).join('\n'),
    xTexto,
    y + 16,
    { width: W * 0.6 - (xTexto - x0), lineGap: 1 },
  );
  const xDoc = x0 + W * 0.62;
  const wDoc = W * 0.38;
  doc.font('Helvetica').fontSize(8).fillColor(cinza).text(titulo, xDoc, y, { width: wDoc, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(preto).text(`Nº ${v.numero}`, xDoc, y + 10, { width: wDoc, align: 'right' });
  const infoDoc = [`Data: ${data(v.data)}`];
  if (orcamento && v.validade) infoDoc.push(`Válido até: ${data(v.validade)}`);
  if (!orcamento && v.dataPrevista) infoDoc.push(`Previsão: ${data(v.dataPrevista)}`);
  doc.font('Helvetica').fontSize(8.5).fillColor(preto).text(infoDoc.join('   ·   '), xDoc, y + 36, { width: wDoc, align: 'right' });
  // situação (pílula)
  const sitTxt = v.situacao.nome;
  doc.font('Helvetica-Bold').fontSize(8);
  const wSit = doc.widthOfString(sitTxt) + 14;
  doc.roundedRect(xDoc + wDoc - wSit, y + 50, wSit, 14, 7).fill(v.situacao.cor || '#64748b');
  doc.fillColor('#ffffff').text(sitTxt, xDoc + wDoc - wSit, y + 53.5, { width: wSit, align: 'center', lineBreak: false });
  if (v.nota) doc.font('Helvetica').fontSize(7.5).fillColor(cinza).text(`NF-e ${v.nota.numero}/${v.nota.serie} — ${v.nota.situacao}`, xDoc, y + 68, { width: wDoc, align: 'right' });
  y += 84;
  linha(y, preto, 1.2);
  y += 10;

  const secao = (t: string) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(t.toUpperCase(), x0, y, { characterSpacing: 0.4 });
    y += 13;
    linha(y - 2);
    y += 4;
  };
  const campo = (rotulo: string, valor: string, x: number, w: number, yy: number) => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#374151').text(rotulo + ': ', x, yy, { continued: true, width: w });
    doc.font('Helvetica').fillColor(preto).text(valor || '-', { width: w });
  };

  // ---- Cliente
  secao('Cliente');
  const col = W / 2;
  campo('Nome', c.nome + (c.fantasia ? ` (${c.fantasia})` : ''), x0, col - 8, y);
  campo(c.tipoPessoa === 'J' ? 'CNPJ' : 'CPF', (formatarDocumento(c.documento) || '-') + (c.ie ? ' · IE ' + c.ie : ''), x0 + col, col, y);
  y += 13;
  campo('Telefone', formatarTelefone(c.celular || c.telefone) || '-', x0, col - 8, y);
  campo('E-mail', c.email || '-', x0 + col, col, y);
  y += 13;
  campo('Endereço', enderecoLinha(c) || '-', x0, W, y);
  y += 13;
  campo('Vendedor', v.vendedor?.nome || '-', x0, col - 8, y);
  campo('Origem', v.origem + (v.numeroPedidoLoja ? ' · Pedido loja ' + v.numeroPedidoLoja : ''), x0 + col, col, y);
  y += 20;

  // ---- Itens
  secao('Itens');
  const cols = [
    { t: '#', w: 18, al: 'right' as const },
    { t: 'Código', w: 78, al: 'left' as const },
    { t: 'Descrição', w: W - 18 - 78 - 62 - 70 - 60 - 72, al: 'left' as const },
    { t: 'Qtd', w: 62, al: 'right' as const },
    { t: 'Unitário', w: 70, al: 'right' as const },
    { t: 'Desc.', w: 60, al: 'right' as const },
    { t: 'Total', w: 72, al: 'right' as const },
  ];
  const cabecalhoItens = () => {
    doc.rect(x0, y, W, 15).fill('#f3f4f6');
    let x = x0;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#374151');
    for (const cl of cols) {
      doc.text(cl.t.toUpperCase(), x + 3, y + 4, { width: cl.w - 6, align: cl.al, lineBreak: false });
      x += cl.w;
    }
    y += 15;
  };
  cabecalhoItens();
  doc.font('Helvetica').fontSize(8.5).fillColor(preto);
  v.itens.forEach((i, idx) => {
    const descW = cols[2].w - 6;
    const codigo = i.codigo || i.produto?.codigo || '';
    const hDesc = doc.heightOfString(i.descricao, { width: descW });
    // código longo (ex.: SITE-tob-6042, dos produtos do site) quebra dentro da própria célula, em letra menor
    doc.fontSize(7);
    const hCod = codigo ? doc.heightOfString(codigo, { width: cols[1].w - 6 }) : 0;
    doc.fontSize(8.5);
    const h = Math.max(14, hDesc + 5, hCod + 5);
    if (y + h > 800) {
      doc.addPage();
      y = 36;
      cabecalhoItens();
      doc.font('Helvetica').fontSize(8.5).fillColor(preto);
    }
    const valores = [String(idx + 1), codigo, i.descricao, `${qtd(i.quantidade)} ${i.unidade}`, moeda(i.valorUnitario), i.desconto ? moeda(i.desconto) : '-', moeda(i.total)];
    let x = x0;
    cols.forEach((cl, k) => {
      if (k === 1) doc.fontSize(7).fillColor(cinza);
      doc.text(valores[k], x + 3, y + 3, { width: cl.w - 6, align: cl.al, lineBreak: k === 1 || k === 2 });
      if (k === 1) doc.fontSize(8.5).fillColor(preto);
      x += cl.w;
    });
    y += h;
    linha(y, '#e5e7eb');
  });

  // ---- Totais (à direita)
  y += 6;
  const xTot = x0 + W - 230;
  const totLinha = (rot: string, val: string, destaque = false) => {
    doc.font(destaque ? 'Helvetica-Bold' : 'Helvetica').fontSize(destaque ? 11 : 9).fillColor(destaque ? preto : cinza).text(rot, xTot, y, { width: 130, lineBreak: false });
    doc.fillColor(preto).text(val, xTot + 130, y, { width: 100, align: 'right', lineBreak: false });
    y += destaque ? 16 : 13;
  };
  totLinha('Total dos produtos', moeda(v.totalProdutos));
  if (descontoCalc) totLinha(`Desconto${v.descontoTipo === 'PERCENTUAL' ? ` (${v.descontoValor}%)` : ''}`, '- ' + moeda(descontoCalc));
  if (v.frete) totLinha('Frete', moeda(v.frete));
  if (v.outrasDespesas) totLinha('Outras despesas', moeda(v.outrasDespesas));
  doc.moveTo(xTot, y).lineTo(x0 + W, y).lineWidth(1.2).stroke(preto);
  y += 4;
  totLinha('TOTAL', moeda(v.total), true);
  y += 6;

  // ---- Pagamento
  if (y > 700) {
    doc.addPage();
    y = 36;
  }
  secao(orcamento ? 'Condições de pagamento' : 'Pagamento');
  doc.font('Helvetica').fontSize(8.5).fillColor(preto);
  for (const p of v.parcelas) {
    const txt = `${p.numero}/${v.parcelas.length}   ${data(p.dataVencimento)}   ${p.formaPagamento?.nome || '-'}${p.contaReceber && !orcamento ? '   (' + p.contaReceber.situacao + ')' : ''}`;
    doc.text(txt, x0, y, { width: W - 110, lineBreak: false });
    doc.text(moeda(p.valor), x0 + W - 100, y, { width: 100, align: 'right', lineBreak: false });
    y += 13;
  }
  y += 6;

  // ---- Transporte
  if (v.transportadora || v.fretePorConta !== 9 || v.quantidadeVolumes) {
    secao('Transporte');
    campo('Transportadora', v.transportadora?.nome || '-', x0, col - 8, y);
    campo('Frete por conta', fretePorConta(v.fretePorConta), x0 + col, col, y);
    y += 13;
    campo('Volumes', v.quantidadeVolumes ? String(v.quantidadeVolumes) : '-', x0, col - 8, y);
    campo('Peso bruto', v.pesoBruto ? v.pesoBruto + ' kg' : '-', x0 + col, col, y);
    y += 20;
  }

  // ---- Observações
  if (v.observacoes) {
    if (y > 720) {
      doc.addPage();
      y = 36;
    }
    secao('Observações');
    doc.font('Helvetica').fontSize(8.5).fillColor(preto).text(v.observacoes, x0, y, { width: W });
    y = doc.y + 10;
  }

  // ---- Rodapé: aprovação (orçamento) ou assinatura (pedido)
  if (y > 700) {
    doc.addPage();
    y = 36;
  }
  y += 24;
  if (orcamento) {
    doc.font('Helvetica').fontSize(8.5).fillColor(cinza).text(
      `Orçamento sem valor fiscal${v.validade ? `, válido até ${data(v.validade)}` : ''}. Preços sujeitos à disponibilidade de estoque. Para aprovar, responda este orçamento ou use o link enviado por e-mail/WhatsApp.`,
      x0,
      y,
      { width: W },
    );
    y = doc.y + 30;
    doc.moveTo(x0 + W / 2 + 20, y).lineTo(x0 + W, y).lineWidth(0.6).stroke(preto);
    doc.fontSize(8).fillColor(cinza).text(`${c.nome} — De acordo (aprovação do orçamento)`, x0 + W / 2 + 20, y + 3, { width: W / 2 - 20, align: 'center' });
  } else {
    doc.moveTo(x0, y).lineTo(x0 + W / 2 - 20, y).lineWidth(0.6).stroke(preto);
    doc.moveTo(x0 + W / 2 + 20, y).lineTo(x0 + W, y).lineWidth(0.6).stroke(preto);
    doc.font('Helvetica').fontSize(8).fillColor(cinza);
    doc.text(emp.nome, x0, y + 3, { width: W / 2 - 20, align: 'center' });
    doc.text(`${c.nome}\nRecebi os produtos acima descritos`, x0 + W / 2 + 20, y + 3, { width: W / 2 - 20, align: 'center' });
  }
  // rodapé fora da margem inferior (senão o pdfkit abre uma página nova em branco)
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(7).fillColor('#9ca3af').text(`Documento sem valor fiscal · emitido em ${new Date().toLocaleString('pt-BR')} · ${emp.nome}`, x0, 812, { width: W, align: 'center', lineBreak: false });

  return pdfParaBuffer(doc);
}

/** Gera e grava o PDF em storage/pedidos (sobrescreve a versão anterior). Retorna o caminho no disco. */
export async function gravarPdfVenda(v: Venda): Promise<string> {
  const pasta = path.join(env.STORAGE_DIR, 'pedidos');
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, nomeArquivoPdf(v));
  fs.writeFileSync(arquivo, await pdfVenda(v));
  return arquivo;
}
