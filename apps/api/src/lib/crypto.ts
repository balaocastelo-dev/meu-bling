import crypto from 'node:crypto';
import { env } from './env.js';

/** Chave AES-256 derivada do APP_SECRET (segredos ficam criptografados no banco). */
const key = crypto.createHash('sha256').update(env.APP_SECRET).digest();

export function encrypt(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('enc:')) return value; // valor legado/sem criptografia
  const [, ivB, tagB, dataB] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

/** Mascara um segredo para exibir na UI ("••••1234"). */
export function mask(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = decrypt(value) || '';
  if (v.length <= 4) return '••••';
  return '••••' + v.slice(-4);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
