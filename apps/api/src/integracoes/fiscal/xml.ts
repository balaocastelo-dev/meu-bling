/**
 * Montagem do XML da NF-e / NFC-e (leiaute 4.00) a partir da NotaFiscal do banco.
 * Foco: emitente Simples Nacional (CRT=1, CSOSN), mas suporta CST (regime normal).
 */
import crypto from 'node:crypto';
import type { Empresa, NotaFiscal, NotaFiscalItem, Contato } from '@prisma/client';
import { CODIGO_UF, gerarChaveAcesso } from './chave.js';
import { AppError } from '../../lib/errors.js';

export type NotaCompleta = NotaFiscal & {
  itens: NotaFiscalItem[];
  contato: Contato | null;
  venda?: { id: number; numero: number } | null;
  os?: { id: number; numero: number } | null;
};

const HOMOLOG_DEST = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
const HOMOLOG_PROD = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/** Escapa e normaliza texto para XML (sem quebras de linha, sem caracteres de controle). */
export function t(v: unknown, max = 0): string {
  let s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const d2 = (v: number) => (Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2);
const d4 = (v: number) => (Math.round((v + Number.EPSILON) * 10000) / 10000).toFixed(4);
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

function fmtDataHora(d: Date): string {
  // dhEmi no fuso de Brasília (-03:00)
  const p = (n: number) => String(n).padStart(2, '0');
  const local = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}-03:00`;
}

function tagOpc(nome: string, valor: unknown, max = 0): string {
  const s = String(valor ?? '').trim();
  return s ? `<${nome}>${t(s, max)}</${nome}>` : '';
}

/** Grupo ICMS conforme CRT (Simples → CSOSN; Normal → CST). */
function grupoIcms(emp: Empresa, it: NotaFiscalItem): string {
  const orig = it.origem ?? 0;
  if (emp.crt === 1 || emp.crt === 2) {
    const csosn = it.csosn || emp.csosnPadrao || '102';
    switch (csosn) {
      case '101':
        return `<ICMSSN101><orig>${orig}</orig><CSOSN>101</CSOSN><pCredSN>${d4(it.icmsAliquota)}</pCredSN><vCredICMSSN>${d2(it.icmsValor)}</vCredICMSSN></ICMSSN101>`;
      case '102':
      case '103':
      case '300':
      case '400':
        return `<ICMSSN102><orig>${orig}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102>`;
      case '500':
        return `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
      case '900':
        return `<ICMSSN900><orig>${orig}</orig><CSOSN>900</CSOSN><modBC>3</modBC><vBC>${d2(it.icmsBase)}</vBC><pICMS>${d4(it.icmsAliquota)}</pICMS><vICMS>${d2(it.icmsValor)}</vICMS></ICMSSN900>`;
      default:
        return `<ICMSSN102><orig>${orig}</orig><CSOSN>102</CSOSN></ICMSSN102>`;
    }
  }
  const cst = it.cst || '00';
  switch (cst) {
    case '00':
      return `<ICMS00><orig>${orig}</orig><CST>00</CST><modBC>3</modBC><vBC>${d2(it.icmsBase)}</vBC><pICMS>${d4(it.icmsAliquota)}</pICMS><vICMS>${d2(it.icmsValor)}</vICMS></ICMS00>`;
    case '40':
    case '41':
    case '50':
      return `<ICMS40><orig>${orig}</orig><CST>${cst}</CST></ICMS40>`;
    case '60':
      return `<ICMS60><orig>${orig}</orig><CST>60</CST></ICMS60>`;
    default:
      return `<ICMS90><orig>${orig}</orig><CST>90</CST></ICMS90>`;
  }
}

function grupoPisCofins(tipo: 'PIS' | 'COFINS', cst: string): string {
  const c = (cst || '49').padStart(2, '0');
  if (['04', '05', '06', '07', '08', '09'].includes(c)) return `<${tipo}><${tipo}NT><CST>${c}</CST></${tipo}NT></${tipo}>`;
  if (['01', '02'].includes(c)) return `<${tipo}><${tipo}Aliq><CST>${c}</CST><vBC>0.00</vBC><p${tipo}>0.0000</p${tipo}><v${tipo}>0.00</v${tipo}></${tipo}Aliq></${tipo}>`;
  return `<${tipo}><${tipo}Outr><CST>${c}</CST><vBC>0.00</vBC><p${tipo}>0.0000</p${tipo}><v${tipo}>0.00</v${tipo}></${tipo}Outr></${tipo}>`;
}

export interface XmlMontado {
  xml: string; // <NFe>...</NFe> sem assinatura
  chave: string;
  qrCode: string | null;
  urlChave: string | null;
  dhEmi: string;
}

/** URLs de consulta de QR Code da NFC-e por UF (ambiente 1 = produção, 2 = homologação). */
export const URL_QRCODE: Record<string, { 1: string; 2: string; consulta1: string; consulta2: string }> = {
  SP: {
    1: 'https://www.nfce.fazenda.sp.gov.br/qrcode',
    2: 'https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode',
    consulta1: 'https://www.nfce.fazenda.sp.gov.br/consulta',
    consulta2: 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
  },
  MG: { 1: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', 2: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml', consulta1: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml', consulta2: 'https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/consultaarg.xhtml' },
  RS: { 1: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', 2: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', consulta1: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx', consulta2: 'https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx' },
  PR: { 1: 'http://www.fazenda.pr.gov.br/nfce/qrcode', 2: 'http://www.fazenda.pr.gov.br/nfce/qrcode', consulta1: 'http://www.fazenda.pr.gov.br/nfce/consulta', consulta2: 'http://www.fazenda.pr.gov.br/nfce/consulta' },
  RJ: { 1: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode', 2: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode', consulta1: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode', consulta2: 'http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode' },
};

export function montarXmlNfe(emp: Empresa, nota: NotaCompleta, opts: { csc?: string | null; cscId?: string | null } = {}): XmlMontado {
  if (!emp.uf || !emp.codigoMunicipio || !emp.cnpj) throw new AppError('Complete os dados da empresa (UF, município IBGE, CNPJ) em Configurações → Empresa.', 422, 'EMPRESA_INCOMPLETA');
  if (!emp.ie && emp.crt !== 1) throw new AppError('Inscrição Estadual da empresa não informada.', 422, 'EMPRESA_INCOMPLETA');
  if (!nota.itens.length) throw new AppError('A nota não possui itens.', 422);

  const homolog = nota.ambiente === 2;
  const nfce = nota.modelo === 65;
  const dest = nota.contato;
  const cnpjEmp = dig(emp.cnpj);
  const ufEmp = emp.uf.toUpperCase();
  const cUF = CODIGO_UF[ufEmp];
  const dataEmissao = nota.dataEmissao ?? new Date();

  const { chave, cNF, cDV } = gerarChaveAcesso({ uf: ufEmp, dataEmissao, cnpj: cnpjEmp, modelo: nota.modelo, serie: nota.serie, numero: nota.numero });

  // ---- destinatário
  const docDest = dig(dest?.documento);
  if (!nfce && !docDest) throw new AppError('Para NF-e (modelo 55) é obrigatório informar CPF ou CNPJ do cliente.', 422, 'DEST_SEM_DOCUMENTO');
  const ufDest = (dest?.uf || ufEmp).toUpperCase();
  const idDest = ufDest === ufEmp ? 1 : 2;

  let xDest = '';
  if (dest && (docDest || !nfce)) {
    const nomeDest = homolog ? HOMOLOG_DEST : t(dest.nome, 60);
    const idTag = docDest.length === 14 ? `<CNPJ>${docDest}</CNPJ>` : docDest.length === 11 ? `<CPF>${docDest}</CPF>` : '';
    const temEndereco = dest.logradouro && dest.municipio && dest.codigoMunicipio && dest.uf;
    const ender = temEndereco
      ? `<enderDest><xLgr>${t(dest.logradouro, 60)}</xLgr><nro>${t(dest.numero || 'S/N', 60)}</nro>${tagOpc('xCpl', dest.complemento, 60)}<xBairro>${t(dest.bairro || 'Centro', 60)}</xBairro><cMun>${dig(dest.codigoMunicipio)}</cMun><xMun>${t(dest.municipio, 60)}</xMun><UF>${ufDest}</UF>${tagOpc('CEP', dig(dest.cep))}<cPais>1058</cPais><xPais>BRASIL</xPais>${tagOpc('fone', dig(dest.telefone || dest.celular).slice(0, 14))}</enderDest>`
      : '';
    if (!nfce && !temEndereco) throw new AppError('Endereço completo do cliente (logradouro, bairro, município com código IBGE, UF) é obrigatório para NF-e.', 422, 'DEST_SEM_ENDERECO');
    // indIEDest: 1 contribuinte, 2 isento, 9 não contribuinte
    let indIE = 9;
    let ieTag = '';
    if (docDest.length === 14 && dest.ie && !dest.ieIsento) {
      indIE = 1;
      ieTag = `<IE>${dig(dest.ie)}</IE>`;
    } else if (docDest.length === 14 && dest.ieIsento) indIE = 2;
    if (nfce) indIE = 9;
    xDest = `<dest>${idTag}<xNome>${nomeDest}</xNome>${ender}<indIEDest>${indIE}</indIEDest>${ieTag}${tagOpc('email', dest.email, 60)}</dest>`;
  }

  // ---- itens
  let vProd = 0, vDesc = 0, vTotTrib = 0, vICMS = 0, vBC = 0;
  const det = nota.itens
    .sort((a, b) => a.numeroItem - b.numeroItem)
    .map((it, idx) => {
      const n = idx + 1;
      const xProd = homolog && n === 1 && nfce ? HOMOLOG_PROD : t(it.descricao, 120);
      const gtin = dig(it.gtin);
      const ean = gtin && [8, 12, 13, 14].includes(gtin.length) ? gtin : 'SEM GTIN';
      vProd += it.valorTotal;
      vDesc += it.desconto || 0;
      vTotTrib += it.valorTributosAprox || 0;
      vICMS += it.icmsValor || 0;
      vBC += it.icmsBase || 0;
      const cfop = dig(it.cfop) || (idDest === 1 ? emp.cfopPadraoDentroUf : emp.cfopPadraoForaUf);
      const ncm = dig(it.ncm).padStart(8, '0');
      return (
        `<det nItem="${n}"><prod>` +
        `<cProd>${t(it.codigo || String(it.produtoId || n), 60)}</cProd><cEAN>${ean}</cEAN><xProd>${xProd}</xProd><NCM>${ncm}</NCM>${tagOpc('CEST', dig(it.cest))}<CFOP>${cfop}</CFOP>` +
        `<uCom>${t(it.unidade || 'UN', 6)}</uCom><qCom>${d4(it.quantidade)}</qCom><vUnCom>${(Math.round(it.valorUnitario * 1e10) / 1e10).toFixed(10)}</vUnCom><vProd>${d2(it.valorTotal)}</vProd>` +
        `<cEANTrib>${ean}</cEANTrib><uTrib>${t(it.unidade || 'UN', 6)}</uTrib><qTrib>${d4(it.quantidade)}</qTrib><vUnTrib>${(Math.round(it.valorUnitario * 1e10) / 1e10).toFixed(10)}</vUnTrib>` +
        (it.desconto ? `<vDesc>${d2(it.desconto)}</vDesc>` : '') +
        `<indTot>1</indTot></prod>` +
        `<imposto>` +
        (it.valorTributosAprox ? `<vTotTrib>${d2(it.valorTributosAprox)}</vTotTrib>` : '') +
        `<ICMS>${grupoIcms(emp, it)}</ICMS>` +
        grupoPisCofins('PIS', it.pisCst) +
        grupoPisCofins('COFINS', it.cofinsCst) +
        `</imposto>` +
        (it.informacoesAdicionais ? `<infAdProd>${t(it.informacoesAdicionais, 500)}</infAdProd>` : '') +
        `</det>`
      );
    })
    .join('');

  const vFrete = nota.valorFrete || 0;
  const vOutro = nota.valorOutras || 0;
  const vDescNota = (nota.valorDesconto || 0) + vDesc - (nota.valorDesconto ? vDesc : 0); // se a nota tem desconto global usa ele; senão soma dos itens
  const vDescTotal = nota.valorDesconto ? nota.valorDesconto : vDesc;
  const vNF = Math.round((vProd - vDescTotal + vFrete + vOutro) * 100) / 100;
  void vDescNota;

  // ---- ide
  const dhEmi = fmtDataHora(dataEmissao);
  const ide =
    `<ide><cUF>${cUF}</cUF><cNF>${cNF}</cNF><natOp>${t(nota.naturezaOperacao || 'Venda de mercadoria', 60)}</natOp><mod>${nota.modelo}</mod><serie>${nota.serie}</serie><nNF>${nota.numero}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    (!nfce ? `<dhSaiEnt>${fmtDataHora(nota.dataSaida ?? dataEmissao)}</dhSaiEnt>` : '') +
    `<tpNF>${nota.tipo}</tpNF><idDest>${nfce ? 1 : idDest}</idDest><cMunFG>${dig(emp.codigoMunicipio)}</cMunFG><tpImp>${nfce ? 4 : 1}</tpImp><tpEmis>1</tpEmis><cDV>${cDV}</cDV><tpAmb>${nota.ambiente}</tpAmb>` +
    `<finNFe>${nota.finalidade || 1}</finNFe><indFinal>${nfce ? 1 : nota.consumidorFinal ?? 1}</indFinal><indPres>${nfce ? 1 : nota.indicadorPresenca ?? 1}</indPres><procEmi>0</procEmi><verProc>MEUBLING 0.1</verProc></ide>`;

  // ---- emitente
  const emit =
    `<emit><CNPJ>${cnpjEmp}</CNPJ><xNome>${t(emp.razaoSocial, 60)}</xNome>${tagOpc('xFant', emp.nomeFantasia, 60)}` +
    `<enderEmit><xLgr>${t(emp.logradouro, 60)}</xLgr><nro>${t(emp.numero || 'S/N', 60)}</nro>${tagOpc('xCpl', emp.complemento, 60)}<xBairro>${t(emp.bairro, 60)}</xBairro><cMun>${dig(emp.codigoMunicipio)}</cMun><xMun>${t(emp.municipio, 60)}</xMun><UF>${ufEmp}</UF><CEP>${dig(emp.cep).padStart(8, '0')}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>${tagOpc('fone', dig(emp.telefone).slice(0, 14))}</enderEmit>` +
    `<IE>${dig(emp.ie) || 'ISENTO'}</IE>${tagOpc('IM', dig(emp.im))}<CRT>${emp.crt || 1}</CRT></emit>`;

  // ---- totais
  const total =
    `<total><ICMSTot><vBC>${d2(vBC)}</vBC><vICMS>${d2(vICMS)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${d2(vProd)}</vProd><vFrete>${d2(vFrete)}</vFrete><vSeg>0.00</vSeg><vDesc>${d2(vDescTotal)}</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>${d2(vOutro)}</vOutro><vNF>${d2(vNF)}</vNF>` +
    (vTotTrib ? `<vTotTrib>${d2(vTotTrib)}</vTotTrib>` : '') +
    `</ICMSTot></total>`;

  const transp = `<transp><modFrete>${nfce ? 9 : nota.fretePorConta ?? 9}</modFrete></transp>`;

  // ---- cobrança (NF-e) e pagamento
  const cobr = !nfce ? `<cobr><fat><nFat>${String(nota.numero).padStart(9, '0')}</nFat><vOrig>${d2(vNF)}</vOrig><vDesc>0.00</vDesc><vLiq>${d2(vNF)}</vLiq></fat><dup><nDup>001</nDup><dVenc>${dhEmi.slice(0, 10)}</dVenc><vDup>${d2(vNF)}</vDup></dup></cobr>` : '';
  const tPag = (nota.formaPagamentoFiscal || '99').padStart(2, '0');
  const pag = `<pag><detPag><indPag>${['15', '05'].includes(tPag) ? 1 : 0}</indPag><tPag>${tPag}</tPag><vPag>${d2(vNF)}</vPag></detPag></pag>`;

  const infAdic = nota.informacoesComplementares ? `<infAdic><infCpl>${t(nota.informacoesComplementares, 5000)}</infCpl></infAdic>` : '';

  const infNFe = `<infNFe Id="NFe${chave}" versao="4.00">${ide}${emit}${xDest}${det}${total}${transp}${cobr}${pag}${infAdic}</infNFe>`;

  // ---- NFC-e: QR Code (versão 2 — emissão normal)
  let qrCode: string | null = null;
  let urlChave: string | null = null;
  let infNFeSupl = '';
  if (nfce) {
    const urls = URL_QRCODE[ufEmp] || URL_QRCODE.SP;
    const amb = nota.ambiente === 1 ? 1 : 2;
    const idCsc = String(Number(opts.cscId || '1'));
    const csc = opts.csc || '';
    const params = `${chave}|2|${amb}|${idCsc}`;
    const hash = crypto.createHash('sha1').update(params + csc).digest('hex').toUpperCase();
    qrCode = `${urls[amb]}?p=${params}|${hash}`;
    urlChave = amb === 1 ? urls.consulta1 : urls.consulta2;
    infNFeSupl = `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${urlChave}</urlChave></infNFeSupl>`;
  }

  const xml = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}${infNFeSupl}</NFe>`;
  return { xml, chave, qrCode, urlChave, dhEmi };
}
