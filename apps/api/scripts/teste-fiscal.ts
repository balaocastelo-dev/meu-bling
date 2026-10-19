/**
 * Teste local do motor fiscal (sem SEFAZ): lê um .pfx, monta o XML de uma NF-e/NFC-e
 * a partir dos dados do banco, assina, valida a assinatura e gera o DANFE em PDF.
 *
 *   npx tsx scripts/teste-fiscal.ts <caminho.pfx> <senha>
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { SignedXml } from 'xml-crypto';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '../src/lib/prisma.js';
import { lerPfx } from '../src/integracoes/fiscal/certificado.js';
import { montarXmlNfe } from '../src/integracoes/fiscal/xml.js';
import { assinarNfe } from '../src/integracoes/fiscal/assinatura.js';
import { gerarDanfe, gerarDanfeNfce } from '../src/integracoes/fiscal/danfe.js';

const [pfxPath, senha] = process.argv.slice(2);

async function main() {
  const cert = lerPfx(fs.readFileSync(pfxPath), senha || '');
  console.log('Certificado:', cert.nome, '| CNPJ:', cert.cnpj, '| válido até', cert.validade.toISOString());

  const emp = (await prisma.empresa.findUnique({ where: { id: 1 } }))!;
  let contato = await prisma.contato.findFirst({ where: { documento: { not: null }, tipoPessoa: 'F' } });
  if (!contato) throw new Error('Rode o seed --demo primeiro');
  contato = await prisma.contato.update({ where: { id: contato.id }, data: { logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Campinas', codigoMunicipio: '3509502', uf: 'SP', cep: '13010000' } });
  const produtos = await prisma.produto.findMany({ where: { tipo: 'P' }, take: 2 });

  for (const modelo of [55, 65] as const) {
    const nota = await prisma.notaFiscal.create({
      data: {
        tipo: 1, modelo, serie: modelo === 55 ? emp.serieNfe : emp.serieNfce, numero: 900000 + Math.floor(Math.random() * 90000), ambiente: 2, situacao: 'PENDENTE',
        contatoId: contato.id, naturezaOperacao: 'Venda de mercadoria', formaPagamentoFiscal: '17',
        valorProdutos: produtos.reduce((s, p) => s + p.preco, 0), valorTotal: produtos.reduce((s, p) => s + p.preco, 0),
        itens: { create: produtos.map((p, i) => ({ numeroItem: i + 1, produtoId: p.id, codigo: p.codigo || String(p.id), descricao: p.nome, ncm: p.ncm || '85171231', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: p.preco, valorTotal: p.preco, csosn: '102', valorTributosAprox: Math.round(p.preco * 30) / 100 })) },
      },
      include: { itens: true, contato: true },
    });
    const montado = montarXmlNfe(emp, nota as any, { csc: 'CSC-TESTE', cscId: '1' });
    const assinado = assinarNfe(montado.xml, cert, montado.chave);

    // valida estrutura e assinatura
    new XMLParser().parse(assinado);
    const sig = new SignedXml({ publicCert: cert.certificadoPem });
    const sigNode = assinado.match(/<Signature[\s\S]*?<\/Signature>/)![0];
    sig.loadSignature(sigNode);
    const ok = sig.checkSignature(assinado);
    console.log(`Modelo ${modelo}: chave ${montado.chave} | assinatura válida: ${ok} | tamanho ${assinado.length} bytes${montado.qrCode ? ' | QR: ' + montado.qrCode.slice(0, 60) + '...' : ''}`);
    fs.writeFileSync(path.join(process.cwd(), `storage/temp/teste-nfe-${modelo}.xml`), assinado);

    const pdf = modelo === 65 ? await gerarDanfeNfce(emp, { ...(nota as any), chave: montado.chave, qrCode: montado.qrCode, situacao: 'AUTORIZADA', protocolo: '135260000000001', dataAutorizacao: new Date() }) : await gerarDanfe(emp, { ...(nota as any), chave: montado.chave, situacao: 'AUTORIZADA', protocolo: '135260000000001', dataAutorizacao: new Date() });
    fs.writeFileSync(path.join(process.cwd(), `storage/temp/teste-danfe-${modelo}.pdf`), pdf);
    console.log(`  DANFE ${modelo}: ${pdf.length} bytes → storage/temp/teste-danfe-${modelo}.pdf`);
    await prisma.notaFiscal.delete({ where: { id: nota.id } });
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
