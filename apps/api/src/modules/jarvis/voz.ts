/**
 * A voz do JARVIS — a voz clonada do Thiago, gerada no PC-servidor da loja.
 *
 * O modelo (OmniVoice, perfil "Thiago herrera 3") roda na GPU do PC dele, que fala
 * só em 127.0.0.1. Um túnel reverso traz essa porta até a VPS, onde o container a
 * alcança em http://172.16.1.1:8770 — nada disso aparece na internet.
 *
 * Aqui dentro:
 *  - o navegador nunca fala com o PC: ele pede o áudio ao próprio sistema (HTTPS, com login);
 *  - cada frase gerada vira um arquivo em storage/voz, pela impressão digital do texto —
 *    as falas do JARVIS se repetem muito, e repetida sai na hora, sem ocupar a GPU;
 *  - se o PC estiver fora do ar, a rota responde 503 e o navegador usa a voz dele.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../lib/env.js';

const SERVIDOR = process.env.VOZ_CLONE_URL || 'http://172.16.1.1:8770';
// ElevenLabs: a voz com o melhor português — entonação e acentos de gente da terra.
// É paga por caractere, por isso o cache abaixo é o que segura a conta.
const ELEVEN_CHAVE = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_VOZ = process.env.JARVIS_VOZ_ID || 'xHUwLsLfyqiYOIVTzLRW'; // Marcos, brasileiro
const ELEVEN_MODELO = process.env.JARVIS_VOZ_MODELO || 'eleven_multilingual_v2';
const PERFIL = process.env.VOZ_CLONE_PERFIL || '2af6be27'; // "Thiago herrera 3"
const TAXA = Number(process.env.VOZ_CLONE_TAXA || 24000); // 24 kHz: 8 kHz é qualidade de telefone
const LIMITE_TEXTO = 600;
const PASTA = path.join(env.STORAGE_DIR, 'voz');

/** Quanto tempo esperar o PC: gerar leva menos de 1s, mas a fila é de uma frase por vez. */
const ESPERA_MS = 20_000;

function digital(texto: string, marca: string): string {
  return crypto.createHash('sha1').update(`${marca}|${texto}`).digest('hex');
}

/** Pede a frase à ElevenLabs. `null` = sem chave, sem crédito ou fora do ar. */
async function falaEleven(texto: string): Promise<Buffer | null> {
  if (!ELEVEN_CHAVE) return null;
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOZ}`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVEN_CHAVE, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: texto,
        model_id: ELEVEN_MODELO,
        language_code: ELEVEN_MODELO.includes('v2_5') || ELEVEN_MODELO.includes('turbo') ? 'pt' : undefined,
        voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) return null;
    const mp3 = Buffer.from(await r.arrayBuffer());
    return mp3.length > 500 ? mp3 : null;
  } catch {
    return null;
  }
}

/** O PC está no ar e com a voz carregada? */
export async function vozDisponivel(): Promise<boolean> {
  if (ELEVEN_CHAVE) return true;
  try {
    const r = await fetch(`${SERVIDOR}/saude`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return false;
    const s = (await r.json()) as { ok?: boolean };
    return s.ok === true;
  } catch {
    return false;
  }
}

/**
 * Devolve o WAV da frase. Procura primeiro no que já foi falado antes;
 * só incomoda a GPU quando é frase nova. `null` = o PC não respondeu.
 */
export async function falaDe(texto: string): Promise<{ audio: Buffer; tipo: string } | null> {
  const limpo = texto.trim().slice(0, LIMITE_TEXTO);
  if (!limpo) return null;

  const marca = ELEVEN_CHAVE ? `el|${ELEVEN_VOZ}|${ELEVEN_MODELO}` : `cl|${PERFIL}|${TAXA}`;
  const ext = ELEVEN_CHAVE ? 'mp3' : 'wav';
  const tipo = ELEVEN_CHAVE ? 'audio/mpeg' : 'audio/wav';
  const arquivo = path.join(PASTA, `${digital(limpo, marca)}.${ext}`);
  try {
    return { audio: await fs.readFile(arquivo), tipo };
  } catch {
    /* frase nova */
  }

  // primeiro a voz boa; se ela falhar, a clonada do PC da loja
  let audio = await falaEleven(limpo);
  let tipoFinal = 'audio/mpeg';
  let arquivoFinal = arquivo;
  if (!audio) {
    audio = await falaClonada(limpo);
    tipoFinal = 'audio/wav';
    arquivoFinal = path.join(PASTA, `${digital(limpo, `cl|${PERFIL}|${TAXA}`)}.wav`);
  }
  if (!audio) return null;

  // guarda para a próxima vez; se o disco falhar, o áudio vai do mesmo jeito
  try {
    await fs.mkdir(PASTA, { recursive: true });
    await fs.writeFile(arquivoFinal, audio);
  } catch {
    /* sem cache desta vez */
  }
  return { audio, tipo: tipoFinal };
}

/** A voz clonada do Thiago, no PC-servidor da loja. */
async function falaClonada(texto: string): Promise<Buffer | null> {
  let resposta: Response;
  try {
    resposta = await fetch(`${SERVIDOR}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, perfil: PERFIL, taxa: TAXA, formato: 'wav' }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    return null; // PC desligado, túnel caído ou GPU ocupada demais
  }
  if (!resposta.ok) return null;
  const wav = Buffer.from(await resposta.arrayBuffer());
  return wav.length > 100 ? wav : null;
}
