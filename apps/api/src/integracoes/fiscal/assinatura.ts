/**
 * Assinatura digital XML (XMLDSig) exigida pela SEFAZ:
 *  - Referência ao infNFe (URI="#NFe<chave>") / infEvento / infInut
 *  - Transforms: enveloped-signature + C14N
 *  - DigestMethod SHA1, SignatureMethod RSA-SHA1, CanonicalizationMethod C14N
 *  - KeyInfo com X509Certificate
 */
import { SignedXml } from 'xml-crypto';
import type { CertificadoA1 } from './certificado.js';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA1 = 'http://www.w3.org/2000/09/xmldsig#sha1';
const RSA_SHA1 = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';

/**
 * Assina o elemento `tag` (ex.: infNFe, infEvento, infInut) cujo atributo Id é `id`
 * e insere o <Signature> logo após o elemento `aposTag` (padrão: o próprio `tag`).
 */
export function assinarXml(xml: string, cert: CertificadoA1, tag: string, id: string, aposTag?: string): string {
  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    canonicalizationAlgorithm: C14N,
    signatureAlgorithm: RSA_SHA1,
  });
  sig.addReference({
    xpath: `//*[local-name(.)='${tag}']`,
    transforms: [ENVELOPED, C14N],
    digestAlgorithm: SHA1,
    uri: `#${id}`,
    isEmptyUri: false,
  });
  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${aposTag || tag}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

/** Assina a NF-e: referência ao infNFe; assinatura após infNFeSupl (NFC-e) ou infNFe. */
export function assinarNfe(xmlNfe: string, cert: CertificadoA1, chave: string): string {
  const apos = xmlNfe.includes('<infNFeSupl>') ? 'infNFeSupl' : 'infNFe';
  return assinarXml(xmlNfe, cert, 'infNFe', `NFe${chave}`, apos);
}
