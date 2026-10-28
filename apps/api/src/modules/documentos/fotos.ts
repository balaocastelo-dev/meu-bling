/**
 * Fotos dos certificados de garantia: uma imagem realista por tipo (PC, PC Gamer, Notebook,
 * iPhone/celular, Games), geradas por IA no PC da loja (ComfyUI, Juggernaut XL) em 28/10/2026.
 * Ficam em assets/certificados/<TIPO>.jpg e entram embutidas no documento (não dependem de internet).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TipoCertificado } from './classificar.js';

const cache = new Map<TipoCertificado, string | null>();

export function fotoDoTipo(tipo: TipoCertificado): string | null {
  if (cache.has(tipo)) return cache.get(tipo)!;
  let uri: string | null = null;
  try {
    const buf = readFileSync(fileURLToPath(new URL(`../../../assets/certificados/${tipo}.jpg`, import.meta.url)));
    uri = `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    uri = null; // sem a foto: o certificado usa a ilustração
  }
  cache.set(tipo, uri);
  return uri;
}
