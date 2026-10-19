/**
 * Certificado digital A1 (.pfx / .p12) — leitura, validação e extração
 * da chave privada e do certificado em PEM (usados na assinatura do XML e
 * na conexão TLS mútua com a SEFAZ).
 */
import forge from 'node-forge';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export interface CertificadoA1 {
  pfx: Buffer;
  senha: string;
  chavePrivadaPem: string;
  certificadoPem: string;
  /** certificado sem cabeçalhos/quebras (vai dentro de <X509Certificate>) */
  certificadoBase64: string;
  nome: string; // CN
  cnpj: string | null;
  validade: Date;
  inicio: Date;
}

export function lerPfx(pfx: Buffer, senha: string): CertificadoA1 {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e: any) {
    if (/invalid password|MAC/i.test(String(e?.message))) throw new AppError('Senha do certificado incorreta.', 422, 'CERT_SENHA');
    throw new AppError('Arquivo de certificado inválido (esperado .pfx/.p12 do tipo A1).', 422, 'CERT_INVALIDO');
  }

  // chave privada
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ||
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ||
    [];
  const keyBag = keyBags.find((b) => b.key);
  if (!keyBag?.key) throw new AppError('Chave privada não encontrada no certificado.', 422, 'CERT_INVALIDO');

  // certificado do titular (o que tem a mesma chave pública / não é CA)
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!certs.length) throw new AppError('Certificado não encontrado no arquivo.', 422, 'CERT_INVALIDO');
  const pubKeyPem = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey((keyBag.key as any).n, (keyBag.key as any).e));
  const titular =
    certs.find((c) => forge.pki.publicKeyToPem(c.publicKey as forge.pki.rsa.PublicKey) === pubKeyPem) ||
    certs.find((c) => !c.getExtension('basicConstraints') || !(c.getExtension('basicConstraints') as any)?.cA) ||
    certs[0];

  const cn = titular.subject.getField('CN')?.value || 'Certificado';
  const cnpjMatch = String(cn).match(/(\d{14})/);
  const certificadoPem = forge.pki.certificateToPem(titular);
  const certificadoBase64 = certificadoPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

  return {
    pfx,
    senha,
    chavePrivadaPem: forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey),
    certificadoPem,
    certificadoBase64,
    nome: String(cn),
    cnpj: cnpjMatch ? cnpjMatch[1] : null,
    validade: titular.validity.notAfter,
    inicio: titular.validity.notBefore,
  };
}

/** Carrega o certificado salvo na Empresa (criptografado) e valida vigência. */
export async function carregarCertificadoEmpresa(): Promise<CertificadoA1> {
  const emp = await prisma.empresa.findUnique({ where: { id: 1 } });
  if (!emp?.certificadoPfx || !emp.certificadoSenha) {
    throw new AppError('Certificado digital A1 não configurado. Envie o .pfx em Configurações → Fiscal.', 422, 'CERT_AUSENTE');
  }
  const cert = lerPfx(Buffer.from(emp.certificadoPfx), decrypt(emp.certificadoSenha) || '');
  if (cert.validade.getTime() < Date.now()) {
    throw new AppError(`Certificado digital vencido em ${cert.validade.toLocaleDateString('pt-BR')}. Renove o A1.`, 422, 'CERT_VENCIDO');
  }
  return cert;
}
