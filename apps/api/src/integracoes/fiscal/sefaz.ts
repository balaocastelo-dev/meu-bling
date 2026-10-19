/**
 * Comunicação com os webservices da SEFAZ (NF-e 4.00) via SOAP 1.2 + TLS mútuo (certificado A1).
 *
 * Serviços: autorização (síncrona/assíncrona), retorno de autorização, consulta de protocolo,
 * status do serviço, recepção de eventos (cancelamento, carta de correção) e inutilização.
 *
 * As URLs podem ser sobrescritas na tabela Configuracao com as chaves:
 *   fiscal.url.<UF>.<modelo>.<ambiente>.<servico>  ex.: fiscal.url.SP.55.1.autorizacao
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import type { CertificadoA1 } from './certificado.js';
import { env } from '../../lib/env.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';

export type Servico = 'autorizacao' | 'retAutorizacao' | 'consulta' | 'status' | 'evento' | 'inutilizacao';

interface UrlsAmbiente { autorizacao: string; retAutorizacao: string; consulta: string; status: string; evento: string; inutilizacao: string }
type UrlsModelo = { 1: UrlsAmbiente; 2: UrlsAmbiente };

const sp = (base: string): UrlsAmbiente => ({
  autorizacao: `${base}/ws/NFeAutorizacao4.asmx`,
  retAutorizacao: `${base}/ws/NFeRetAutorizacao4.asmx`,
  consulta: `${base}/ws/NFeConsultaProtocolo4.asmx`,
  status: `${base}/ws/NFeStatusServico4.asmx`,
  evento: `${base}/ws/NFeRecepcaoEvento4.asmx`,
  inutilizacao: `${base}/ws/NFeInutilizacao4.asmx`,
});
const svrs = (base: string): UrlsAmbiente => ({
  autorizacao: `${base}/ws/NfeAutorizacao/NFeAutorizacao4.asmx`,
  retAutorizacao: `${base}/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx`,
  consulta: `${base}/ws/NfeConsulta/NfeConsulta4.asmx`,
  status: `${base}/ws/NfeStatusServico/NfeStatusServico4.asmx`,
  evento: `${base}/ws/recepcaoevento/recepcaoevento4.asmx`,
  inutilizacao: `${base}/ws/nfeinutilizacao/nfeinutilizacao4.asmx`,
});

/** Autorizadores conhecidos. Demais UFs caem na SVRS (Sefaz Virtual RS). */
const URLS: Record<string, { 55: UrlsModelo; 65: UrlsModelo }> = {
  SP: {
    55: { 1: sp('https://nfe.fazenda.sp.gov.br'), 2: sp('https://homologacao.nfe.fazenda.sp.gov.br') },
    65: { 1: sp('https://nfce.fazenda.sp.gov.br'), 2: sp('https://homologacao.nfce.fazenda.sp.gov.br') },
  },
  SVRS: {
    55: { 1: svrs('https://nfe.svrs.rs.gov.br'), 2: svrs('https://nfe-homologacao.svrs.rs.gov.br') },
    65: { 1: svrs('https://nfce.svrs.rs.gov.br'), 2: svrs('https://nfce-homologacao.svrs.rs.gov.br') },
  },
};

const WSDL: Record<Servico, { ns: string; metodo: string }> = {
  autorizacao: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4', metodo: 'nfeAutorizacaoLote' },
  retAutorizacao: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4', metodo: 'nfeRetAutorizacaoLote' },
  consulta: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4', metodo: 'nfeConsultaNF' },
  status: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4', metodo: 'nfeStatusServicoNF' },
  evento: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4', metodo: 'nfeRecepcaoEvento' },
  inutilizacao: { ns: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4', metodo: 'nfeInutilizacaoNF' },
};

export async function urlServico(uf: string, modelo: 55 | 65, ambiente: 1 | 2, servico: Servico): Promise<string> {
  const chave = `fiscal.url.${uf}.${modelo}.${ambiente}.${servico}`;
  const custom = await prisma.configuracao.findUnique({ where: { chave } });
  if (custom?.valor) return custom.valor;
  const auto = URLS[uf.toUpperCase()] || URLS.SVRS;
  return auto[modelo][ambiente][servico];
}

function agenteTls(cert: CertificadoA1): https.Agent {
  const caPath = path.join(env.STORAGE_DIR, 'ca-icpbrasil.pem');
  const temCa = fs.existsSync(caPath);
  return new https.Agent({
    pfx: cert.pfx,
    passphrase: cert.senha,
    // A cadeia ICP-Brasil não vem no Node por padrão. Se o arquivo storage/ca-icpbrasil.pem existir, validamos a cadeia;
    // caso contrário, a verificação do certificado do servidor é desativada (comportamento comum em emissores).
    ca: temCa ? fs.readFileSync(caPath) : undefined,
    rejectUnauthorized: temCa,
    keepAlive: false,
    minVersion: 'TLSv1.2',
  });
}

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

/** Executa uma chamada SOAP 1.2 e devolve o XML bruto da resposta. */
export async function chamarSefaz(url: string, servico: Servico, payloadXml: string, cert: CertificadoA1, timeoutMs = 45000): Promise<string> {
  const { ns, metodo } = WSDL[servico];
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body><nfeDadosMsg xmlns="${ns}">${payloadXml}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  return new Promise<string>((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        agent: agenteTls(cert),
        timeout: timeoutMs,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${ns}/${metodo}"`,
          SOAPAction: `${ns}/${metodo}`,
          'Content-Length': Buffer.byteLength(envelope),
          'User-Agent': 'MEU-BLING/0.1 (Node.js)',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode || 500) >= 400) {
            return reject(new AppError(`SEFAZ respondeu HTTP ${res.statusCode}: ${body.slice(0, 300)}`, 502, 'SEFAZ_HTTP'));
          }
          resolve(body);
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new AppError('Tempo esgotado ao comunicar com a SEFAZ. Tente novamente.', 504, 'SEFAZ_TIMEOUT'));
    });
    req.on('error', (e: any) => reject(e instanceof AppError ? e : new AppError(`Falha de conexão com a SEFAZ: ${e?.message || e}`, 502, 'SEFAZ_CONEXAO')));
    req.write(envelope);
    req.end();
  });
}

/** Extrai o conteúdo de <nfeResultMsg> (ou o body) já parseado. */
export function parsearRetorno(xml: string): any {
  const obj = parser.parse(xml);
  const body = obj?.Envelope?.Body ?? obj;
  const result = body?.nfeResultMsg ?? body;
  if (body?.Fault) {
    const f = body.Fault;
    throw new AppError(`Erro SOAP da SEFAZ: ${f?.Reason?.Text ?? f?.faultstring ?? JSON.stringify(f).slice(0, 200)}`, 502, 'SEFAZ_FAULT');
  }
  return result;
}

/** Captura um trecho XML bruto (ex.: <protNFe ...>...</protNFe>) sem o envelope SOAP. */
export function extrairTrecho(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`);
  const m = xml.match(re);
  return m ? m[0] : null;
}

export const CSTAT_AUTORIZADA = ['100', '150'];
export const CSTAT_CANCELADA = ['101', '151', '135', '155'];
export const CSTAT_DENEGADA = ['110', '301', '302', '303'];
export const CSTAT_LOTE_RECEBIDO = ['103'];
export const CSTAT_LOTE_PROCESSADO = ['104'];
export const CSTAT_EM_PROCESSAMENTO = ['105'];
