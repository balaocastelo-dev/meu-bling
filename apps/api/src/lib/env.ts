import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

const storageDir = path.resolve(process.cwd(), process.env.STORAGE_DIR || './storage');
for (const sub of ['', 'nfe', 'danfe', 'anexos', 'whatsapp', 'logos', 'temp', 'importacao']) {
  fs.mkdirSync(path.join(storageDir, sub), { recursive: true });
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 3333),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: req('JWT_SECRET', 'dev-jwt-secret-troque'),
  APP_SECRET: req('APP_SECRET', 'dev-app-secret-troque-por-32-chars!!'),
  APP_URL: process.env.APP_URL || 'http://localhost:5173',
  STORAGE_DIR: storageDir,
  isProd: (process.env.NODE_ENV || 'development') === 'production',
};
