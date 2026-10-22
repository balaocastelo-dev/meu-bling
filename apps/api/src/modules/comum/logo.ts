/**
 * O LOGO DA EMPRESA NAS IMPRESSÕES E NOS PDFs.
 *
 * Problema (22/10/2026): no ar o sistema mora em www.balao.info/sistema, mas as
 * impressões (pedido, orçamento, OS, compra — e o "Salvar como PDF" delas)
 * apontavam o logo para "/uploads/logos/…", sem o /sistema: o navegador buscava
 * www.balao.info/uploads/… e o logo saía quebrado. E o PDF gerado no servidor
 * (o que vai por e-mail/WhatsApp) só aceitava PNG/JPG, enquanto o cadastro
 * aceita também WEBP, SVG e GIF.
 *
 * Agora o logo vai EMBUTIDO no documento (data URI no HTML; PNG no PDF): não
 * depende de endereço, de sessão nem de internet, e aparece igual em qualquer lugar.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { env } from '../../lib/env.js';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** Caminho do arquivo no storage para um logoPath "/uploads/logos/x.png" (ou null se não for nosso). */
function arquivoDoLogo(logoPath: string | null | undefined): string | null {
  if (!logoPath || !logoPath.startsWith('/uploads/')) return null;
  const relativo = logoPath.replace(/^\/uploads\//, '');
  const arq = path.resolve(env.STORAGE_DIR, relativo);
  // nunca sai da pasta de armazenamento
  if (!arq.startsWith(path.resolve(env.STORAGE_DIR) + path.sep)) return null;
  return arq;
}

/** Endereço do arquivo com o caminho base do sistema (ex.: /sistema/uploads/logos/x.png). */
export function urlComBase(caminho: string): string {
  return /^https?:\/\//i.test(caminho) ? caminho : `${env.BASE_PATH}${caminho}`;
}

const cache = new Map<string, { mtime: number; dataUri: string | null; png: Buffer | null }>();

async function lerLogo(logoPath: string | null | undefined) {
  const arq = arquivoDoLogo(logoPath);
  if (!arq) return null;
  let st;
  try {
    st = await fs.stat(arq);
  } catch {
    return null; // arquivo sumiu (troca de servidor, backup restaurado sem storage…)
  }
  const emCache = cache.get(arq);
  if (emCache && emCache.mtime === st.mtimeMs) return emCache;
  const buf = await fs.readFile(arq);
  const ext = path.extname(arq).toLowerCase();
  const mime = MIME[ext] || 'image/png';
  let png: Buffer | null = null;
  try {
    // PDFKit só lê PNG e JPEG: o resto vira PNG (SVG desenhado em boa resolução)
    png = ext === '.png' || ext === '.jpg' || ext === '.jpeg' ? buf : await sharp(buf, { density: 300 }).resize({ height: 240, withoutEnlargement: false }).png().toBuffer();
  } catch {
    png = null;
  }
  const item = { mtime: st.mtimeMs, dataUri: `data:${mime};base64,${buf.toString('base64')}`, png };
  cache.set(arq, item);
  return item;
}

/** `src` do logo para as impressões em HTML: embutido; se não der, o endereço com o caminho base. */
export async function logoParaHtml(logoPath: string | null | undefined): Promise<string | null> {
  if (!logoPath) return null;
  const l = await lerLogo(logoPath).catch(() => null);
  if (l?.dataUri) return l.dataUri;
  return arquivoDoLogo(logoPath) ? null : urlComBase(logoPath); // arquivo nosso que sumiu: sem logo (melhor que quebrado)
}

/** Logo em PNG/JPEG para o PDFKit (ou null). */
export async function logoParaPdf(logoPath: string | null | undefined): Promise<Buffer | null> {
  return (await lerLogo(logoPath).catch(() => null))?.png ?? null;
}
