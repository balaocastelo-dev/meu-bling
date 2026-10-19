/**
 * E-MAIL (SMTP) — envio via nodemailer com a configuração da Empresa
 * (smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass criptografada, smtpFrom, smtpAtivo).
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';

export interface AnexoEmail {
  filename: string;
  path?: string;
  content?: Buffer | string;
  contentType?: string;
}

export interface EnvioEmail {
  para: string | string[];
  assunto: string;
  html: string;
  texto?: string;
  anexos?: AnexoEmail[];
  replyTo?: string;
}

let cache: { chave: string; transporter: Transporter; from: string } | null = null;

export async function configuracaoSmtp() {
  const e = await prisma.empresa.findUnique({
    where: { id: 1 },
    select: { smtpHost: true, smtpPort: true, smtpSecure: true, smtpUser: true, smtpPass: true, smtpFrom: true, smtpAtivo: true, nomeFantasia: true, razaoSocial: true, email: true },
  });
  if (!e) throw new AppError('Empresa não configurada.', 500);
  return e;
}

export async function smtpConfigurado(): Promise<boolean> {
  const e = await configuracaoSmtp();
  return !!(e.smtpAtivo && e.smtpHost);
}

async function obterTransporter() {
  const e = await configuracaoSmtp();
  if (!e.smtpAtivo || !e.smtpHost) throw new AppError('SMTP não configurado', 422, 'SMTP_NAO_CONFIGURADO');
  const senha = decrypt(e.smtpPass) || '';
  const chave = [e.smtpHost, e.smtpPort, e.smtpSecure, e.smtpUser, senha.slice(-4), e.smtpFrom].join('|');
  if (!cache || cache.chave !== chave) {
    const transporter = nodemailer.createTransport({
      host: e.smtpHost,
      port: e.smtpPort || 587,
      secure: !!e.smtpSecure,
      auth: e.smtpUser ? { user: e.smtpUser, pass: senha } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
      tls: { rejectUnauthorized: false },
    });
    const nome = e.nomeFantasia || e.razaoSocial;
    const endereco = e.smtpFrom || e.smtpUser || e.email || '';
    const from = /</.test(endereco) ? endereco : `"${nome.replace(/"/g, '')}" <${endereco}>`;
    cache = { chave, transporter, from };
  }
  return cache;
}

export function limparCacheSmtp() {
  cache = null;
}

/** Envia um e-mail. Lança AppError 422 se SMTP não configurado; outros erros viram AppError 502. */
export async function enviarEmail(p: EnvioEmail): Promise<{ messageId: string }> {
  const { transporter, from } = await obterTransporter();
  const para = Array.isArray(p.para) ? p.para : [p.para];
  if (!para.length || !para.every((x) => /\S+@\S+\.\S+/.test(x))) throw new AppError('Destinatário de e-mail inválido.', 422, 'EMAIL_INVALIDO');
  try {
    const info = await transporter.sendMail({
      from,
      to: para.join(', '),
      subject: p.assunto,
      html: p.html,
      text: p.texto || p.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''),
      replyTo: p.replyTo,
      attachments: p.anexos?.map((a) => ({ filename: a.filename, path: a.path, content: a.content, contentType: a.contentType })),
    });
    return { messageId: String(info.messageId || '') };
  } catch (e: any) {
    throw new AppError('Falha ao enviar e-mail: ' + (e?.message || e), 502, 'SMTP_ERRO');
  }
}

/** Testa a conexão SMTP (sem enviar). */
export async function verificarSmtp() {
  const { transporter } = await obterTransporter();
  try {
    await transporter.verify();
    return true;
  } catch (e: any) {
    throw new AppError('Falha na conexão SMTP: ' + (e?.message || e), 502, 'SMTP_ERRO');
  }
}
