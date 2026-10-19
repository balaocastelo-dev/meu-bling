/**
 * Provedores fiscais:
 *  - SefazProvedor: emissão direta na SEFAZ com certificado A1 (produção/homologação)
 *  - MockProvedor:  simula autorização/cancelamento (sem certificado) para testes e treinamento
 */
import crypto from 'node:crypto';
import type { Empresa } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { carregarCertificadoEmpresa, type CertificadoA1 } from './certificado.js';
import { montarXmlNfe, t, type NotaCompleta } from './xml.js';
import { assinarNfe, assinarXml } from './assinatura.js';
import { CODIGO_UF } from './chave.js';
import {
  chamarSefaz, parsearRetorno, extrairTrecho, urlServico,
  CSTAT_AUTORIZADA, CSTAT_CANCELADA, CSTAT_DENEGADA, CSTAT_LOTE_PROCESSADO, CSTAT_LOTE_RECEBIDO, CSTAT_EM_PROCESSAMENTO,
} from './sefaz.js';

export interface ResultadoTransmissao {
  situacao: 'AUTORIZADA' | 'REJEITADA' | 'DENEGADA' | 'ERRO' | 'PROCESSANDO';
  chave: string;
  protocolo?: string | null;
  recibo?: string | null;
  cStat: string;
  motivo: string;
  xmlAssinado: string;
  xmlProc?: string | null;
  dataAutorizacao?: Date | null;
  qrCode?: string | null;
  urlChave?: string | null;
}

export interface ResultadoConsulta {
  cStat: string;
  motivo: string;
  situacao: 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA' | 'NAO_ENCONTRADA' | 'OUTRO';
  protocolo?: string | null;
  xmlProt?: string | null;
}

export interface ResultadoEvento {
  sucesso: boolean;
  cStat: string;
  motivo: string;
  protocolo?: string | null;
  xml?: string | null;
}

export interface ProvedorFiscal {
  nome: string;
  transmitir(nota: NotaCompleta, emp: Empresa): Promise<ResultadoTransmissao>;
  consultar(chave: string, emp: Empresa, modelo: 55 | 65): Promise<ResultadoConsulta>;
  cancelar(nota: NotaCompleta, emp: Empresa, justificativa: string, sequencia: number): Promise<ResultadoEvento>;
  cartaCorrecao(nota: NotaCompleta, emp: Empresa, texto: string, sequencia: number): Promise<ResultadoEvento>;
  inutilizar(emp: Empresa, modelo: 55 | 65, serie: number, inicio: number, fim: number, justificativa: string, ambiente: 1 | 2): Promise<ResultadoEvento>;
  statusServico(emp: Empresa, modelo: 55 | 65, ambiente: 1 | 2): Promise<{ online: boolean; cStat: string; motivo: string }>;
}

function dhAgora(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-03:00`;
}

async function cscEmpresa(emp: Empresa) {
  return { csc: decrypt(emp.cscToken), cscId: emp.cscId };
}

// ---------------------------------------------------------------------
// SEFAZ (real)
// ---------------------------------------------------------------------
export class SefazProvedor implements ProvedorFiscal {
  nome = 'sefaz';

  async transmitir(nota: NotaCompleta, emp: Empresa): Promise<ResultadoTransmissao> {
    const cert = await carregarCertificadoEmpresa();
    const { csc, cscId } = await cscEmpresa(emp);
    if (nota.modelo === 65 && !csc) throw new AppError('CSC (Código de Segurança do Contribuinte) não configurado — obrigatório para NFC-e.', 422, 'CSC_AUSENTE');

    const montado = montarXmlNfe(emp, nota, { csc, cscId });
    const assinado = assinarNfe(montado.xml, cert, montado.chave);
    const modelo = nota.modelo as 55 | 65;
    const amb = nota.ambiente as 1 | 2;

    const idLote = String(nota.id).padStart(15, '0');
    const envi = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${assinado}</enviNFe>`;
    const url = await urlServico(emp.uf!, modelo, amb, 'autorizacao');
    const respostaXml = await chamarSefaz(url, 'autorizacao', envi, cert);
    const ret = parsearRetorno(respostaXml)?.retEnviNFe;
    if (!ret) throw new AppError('Resposta inesperada da SEFAZ (sem retEnviNFe).', 502, 'SEFAZ_RESPOSTA');

    const base = { chave: montado.chave, xmlAssinado: assinado, qrCode: montado.qrCode, urlChave: montado.urlChave };
    let protXml: string | null = null;
    let infProt: any = null;

    if (CSTAT_LOTE_PROCESSADO.includes(String(ret.cStat))) {
      infProt = ret.protNFe?.infProt;
      protXml = extrairTrecho(respostaXml, 'protNFe');
    } else if (CSTAT_LOTE_RECEBIDO.includes(String(ret.cStat)) && ret.infRec?.nRec) {
      // assíncrono: consulta o recibo
      const nRec = String(ret.infRec.nRec);
      const tMed = Math.min(Number(ret.infRec.tMed || 2), 15);
      const urlRet = await urlServico(emp.uf!, modelo, amb, 'retAutorizacao');
      for (let tentativa = 0; tentativa < 10; tentativa++) {
        await new Promise((r) => setTimeout(r, Math.max(1000, tMed * 1000)));
        const consRec = `<consReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${amb}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`;
        const retXml = await chamarSefaz(urlRet, 'retAutorizacao', consRec, cert);
        const r = parsearRetorno(retXml)?.retConsReciNFe;
        if (r && CSTAT_LOTE_PROCESSADO.includes(String(r.cStat))) {
          infProt = (Array.isArray(r.protNFe) ? r.protNFe[0] : r.protNFe)?.infProt;
          protXml = extrairTrecho(retXml, 'protNFe');
          break;
        }
        if (r && !CSTAT_EM_PROCESSAMENTO.includes(String(r.cStat)) && !CSTAT_LOTE_RECEBIDO.includes(String(r.cStat))) {
          return { ...base, situacao: 'REJEITADA', recibo: nRec, cStat: String(r.cStat), motivo: String(r.xMotivo || '') };
        }
      }
      if (!infProt) return { ...base, situacao: 'PROCESSANDO', recibo: nRec, cStat: '105', motivo: 'Lote em processamento. Consulte novamente em instantes.' };
    } else {
      // rejeição do lote (ex.: 225 schema, 539 duplicidade...)
      return { ...base, situacao: 'REJEITADA', cStat: String(ret.cStat), motivo: String(ret.xMotivo || 'Lote rejeitado') };
    }

    const cStat = String(infProt?.cStat || '');
    const motivo = String(infProt?.xMotivo || '');
    if (CSTAT_AUTORIZADA.includes(cStat)) {
      const xmlProc = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${assinado}${protXml || ''}</nfeProc>`;
      return { ...base, situacao: 'AUTORIZADA', protocolo: String(infProt.nProt), cStat, motivo, xmlProc, dataAutorizacao: new Date(String(infProt.dhRecbto || Date.now())) };
    }
    if (CSTAT_DENEGADA.includes(cStat)) return { ...base, situacao: 'DENEGADA', protocolo: infProt?.nProt ? String(infProt.nProt) : null, cStat, motivo };
    return { ...base, situacao: 'REJEITADA', cStat, motivo };
  }

  async consultar(chave: string, emp: Empresa, modelo: 55 | 65): Promise<ResultadoConsulta> {
    const cert = await carregarCertificadoEmpresa();
    const amb = (emp.ambienteFiscal || 2) as 1 | 2;
    const xml = `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${amb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
    const url = await urlServico(emp.uf!, modelo, amb, 'consulta');
    const resp = await chamarSefaz(url, 'consulta', xml, cert);
    const ret = parsearRetorno(resp)?.retConsSitNFe;
    const cStat = String(ret?.cStat || '');
    const motivo = String(ret?.xMotivo || '');
    const situacao: ResultadoConsulta['situacao'] = CSTAT_AUTORIZADA.includes(cStat) ? 'AUTORIZADA' : CSTAT_CANCELADA.includes(cStat) ? 'CANCELADA' : CSTAT_DENEGADA.includes(cStat) ? 'DENEGADA' : cStat === '217' ? 'NAO_ENCONTRADA' : 'OUTRO';
    return { cStat, motivo, situacao, protocolo: ret?.protNFe?.infProt?.nProt ? String(ret.protNFe.infProt.nProt) : null, xmlProt: extrairTrecho(resp, 'protNFe') };
  }

  private async enviarEvento(nota: NotaCompleta, emp: Empresa, tpEvento: string, sequencia: number, detEvento: string): Promise<ResultadoEvento> {
    const cert = await carregarCertificadoEmpresa();
    const amb = nota.ambiente as 1 | 2;
    const modelo = nota.modelo as 55 | 65;
    const chave = nota.chave!;
    const id = `ID${tpEvento}${chave}${String(sequencia).padStart(2, '0')}`;
    const cOrgao = CODIGO_UF[emp.uf!.toUpperCase()];
    const infEvento =
      `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}"><cOrgao>${cOrgao}</cOrgao><tpAmb>${amb}</tpAmb><CNPJ>${emp.cnpj.replace(/\D/g, '')}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${dhAgora()}</dhEvento><tpEvento>${tpEvento}</tpEvento><nSeqEvento>${sequencia}</nSeqEvento><verEvento>1.00</verEvento>${detEvento}</infEvento></evento>`;
    const assinado = assinarXml(infEvento, cert, 'infEvento', id);
    const env = `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${String(nota.id).padStart(15, '0')}</idLote>${assinado}</envEvento>`;
    const url = await urlServico(emp.uf!, modelo, amb, 'evento');
    const resp = await chamarSefaz(url, 'evento', env, cert);
    const ret = parsearRetorno(resp)?.retEnvEvento;
    const inf = (Array.isArray(ret?.retEvento) ? ret.retEvento[0] : ret?.retEvento)?.infEvento;
    const cStat = String(inf?.cStat || ret?.cStat || '');
    const motivo = String(inf?.xMotivo || ret?.xMotivo || '');
    const sucesso = ['135', '136', '155'].includes(cStat);
    const retEventoXml = extrairTrecho(resp, 'retEvento');
    const xml = sucesso ? `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">${assinado}${retEventoXml || ''}</procEventoNFe>` : null;
    return { sucesso, cStat, motivo, protocolo: inf?.nProt ? String(inf.nProt) : null, xml };
  }

  async cancelar(nota: NotaCompleta, emp: Empresa, justificativa: string, sequencia: number) {
    const det = `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${nota.protocolo}</nProt><xJust>${t(justificativa, 255)}</xJust></detEvento>`;
    return this.enviarEvento(nota, emp, '110111', sequencia, det);
  }

  async cartaCorrecao(nota: NotaCompleta, emp: Empresa, texto: string, sequencia: number) {
    const condUso = 'A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.';
    const det = `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento><xCorrecao>${t(texto, 1000)}</xCorrecao><xCondUso>${condUso}</xCondUso></detEvento>`;
    return this.enviarEvento(nota, emp, '110110', sequencia, det);
  }

  async inutilizar(emp: Empresa, modelo: 55 | 65, serie: number, inicio: number, fim: number, justificativa: string, ambiente: 1 | 2): Promise<ResultadoEvento> {
    const cert = await carregarCertificadoEmpresa();
    const cUF = CODIGO_UF[emp.uf!.toUpperCase()];
    const ano = String(new Date().getFullYear()).slice(2);
    const cnpj = emp.cnpj.replace(/\D/g, '');
    const id = `ID${cUF}${ano}${cnpj}${modelo}${String(serie).padStart(3, '0')}${String(inicio).padStart(9, '0')}${String(fim).padStart(9, '0')}`;
    const inut = `<inutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infInut Id="${id}"><tpAmb>${ambiente}</tpAmb><xServ>INUTILIZAR</xServ><cUF>${cUF}</cUF><ano>${ano}</ano><CNPJ>${cnpj}</CNPJ><mod>${modelo}</mod><serie>${serie}</serie><nNFIni>${inicio}</nNFIni><nNFFin>${fim}</nNFFin><xJust>${t(justificativa, 255)}</xJust></infInut></inutNFe>`;
    const assinado = assinarXml(inut, cert, 'infInut', id);
    const url = await urlServico(emp.uf!, modelo, ambiente, 'inutilizacao');
    const resp = await chamarSefaz(url, 'inutilizacao', assinado, cert);
    const inf = parsearRetorno(resp)?.retInutNFe?.infInut;
    const cStat = String(inf?.cStat || '');
    return { sucesso: cStat === '102', cStat, motivo: String(inf?.xMotivo || ''), protocolo: inf?.nProt ? String(inf.nProt) : null, xml: extrairTrecho(resp, 'retInutNFe') };
  }

  async statusServico(emp: Empresa, modelo: 55 | 65, ambiente: 1 | 2) {
    const cert = await carregarCertificadoEmpresa();
    const cUF = CODIGO_UF[emp.uf!.toUpperCase()];
    const xml = `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;
    const url = await urlServico(emp.uf!, modelo, ambiente, 'status');
    const resp = await chamarSefaz(url, 'status', xml, cert, 20000);
    const ret = parsearRetorno(resp)?.retConsStatServ;
    const cStat = String(ret?.cStat || '');
    return { online: cStat === '107', cStat, motivo: String(ret?.xMotivo || '') };
  }
}

// ---------------------------------------------------------------------
// MOCK (simulação — sem certificado)
// ---------------------------------------------------------------------
export class MockProvedor implements ProvedorFiscal {
  nome = 'mock';

  async transmitir(nota: NotaCompleta, emp: Empresa): Promise<ResultadoTransmissao> {
    const { csc, cscId } = await cscEmpresa(emp);
    const montado = montarXmlNfe(emp, nota, { csc: csc || 'CSC-SIMULADO', cscId: cscId || '1' });
    let cert: CertificadoA1 | null = null;
    try {
      cert = await carregarCertificadoEmpresa();
    } catch {
      cert = null;
    }
    const assinado = cert ? assinarNfe(montado.xml, cert, montado.chave) : montado.xml;
    const nProt = `1${String(nota.ambiente)}${String(Date.now()).slice(-13)}`;
    const protNFe = `<protNFe versao="4.00"><infProt><tpAmb>${nota.ambiente}</tpAmb><verAplic>MEUBLING_SIMULADO</verAplic><chNFe>${montado.chave}</chNFe><dhRecbto>${dhAgora()}</dhRecbto><nProt>${nProt}</nProt><digVal>${crypto.createHash('sha1').update(assinado).digest('base64')}</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (SIMULACAO - provedor mock)</xMotivo></infProt></protNFe>`;
    return {
      situacao: 'AUTORIZADA',
      chave: montado.chave,
      protocolo: nProt,
      cStat: '100',
      motivo: 'Autorizado o uso da NF-e (SIMULAÇÃO — provedor mock, sem valor fiscal)',
      xmlAssinado: assinado,
      xmlProc: `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${assinado}${protNFe}</nfeProc>`,
      dataAutorizacao: new Date(),
      qrCode: montado.qrCode,
      urlChave: montado.urlChave,
    };
  }

  async consultar(chave: string): Promise<ResultadoConsulta> {
    const nota = await prisma.notaFiscal.findUnique({ where: { chave } });
    if (!nota) return { cStat: '217', motivo: 'NF-e não consta na base de dados da SEFAZ (simulação)', situacao: 'NAO_ENCONTRADA' };
    if (nota.situacao === 'CANCELADA') return { cStat: '101', motivo: 'Cancelamento de NF-e homologado (simulação)', situacao: 'CANCELADA', protocolo: nota.protocolo };
    return { cStat: '100', motivo: 'Autorizado o uso da NF-e (simulação)', situacao: 'AUTORIZADA', protocolo: nota.protocolo };
  }

  async cancelar(nota: NotaCompleta, _emp: Empresa, justificativa: string): Promise<ResultadoEvento> {
    if (justificativa.trim().length < 15) return { sucesso: false, cStat: '295', motivo: 'Justificativa deve ter no mínimo 15 caracteres' };
    return { sucesso: true, cStat: '135', motivo: 'Evento registrado e vinculado a NF-e (simulação)', protocolo: `1${nota.ambiente}${String(Date.now()).slice(-13)}`, xml: `<procEventoNFe versao="1.00"><simulado>cancelamento</simulado></procEventoNFe>` };
  }

  async cartaCorrecao(nota: NotaCompleta): Promise<ResultadoEvento> {
    return { sucesso: true, cStat: '135', motivo: 'Evento registrado e vinculado a NF-e (simulação)', protocolo: `1${nota.ambiente}${String(Date.now()).slice(-13)}`, xml: `<procEventoNFe versao="1.00"><simulado>carta-correcao</simulado></procEventoNFe>` };
  }

  async inutilizar(): Promise<ResultadoEvento> {
    return { sucesso: true, cStat: '102', motivo: 'Inutilização de número homologado (simulação)', protocolo: `1${String(Date.now()).slice(-14)}` };
  }

  async statusServico() {
    return { online: true, cStat: '107', motivo: 'Serviço em Operação (simulação — provedor mock)' };
  }
}

export async function obterProvedor(emp?: Empresa | null): Promise<ProvedorFiscal> {
  const e = emp ?? (await prisma.empresa.findUnique({ where: { id: 1 } }));
  return e?.provedorFiscal === 'sefaz' ? new SefazProvedor() : new MockProvedor();
}
