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
import { azureLigada, falaAzure } from './voz-azure.js';

const SERVIDOR = process.env.VOZ_CLONE_URL || 'http://172.16.1.1:8770';
/** Mais passos = fala mais natural. A URA fica em 16 (ligação não espera); aqui dá para 32. */
const PASSOS = Number(process.env.JARVIS_VOZ_PASSOS || 32);
const PERFIL = process.env.VOZ_CLONE_PERFIL || '2af6be27'; // "Thiago herrera 3"
const TAXA = Number(process.env.VOZ_CLONE_TAXA || 24000); // 24 kHz: 8 kHz é qualidade de telefone
const LIMITE_TEXTO = 600;
const PASTA = path.join(env.STORAGE_DIR, 'voz');

/**
 * Quanto tempo esperar o PC. Gerar uma frase leva menos de 1s; 8s já é folga larga.
 * Esperar mais não ajuda e atrasa a conversa: numa ligação, cada frase que trava
 * aqui é o chefe olhando para a tela em silêncio.
 */
const ESPERA_MS = 8_000;

/**
 * Memória de falha. Quando o PC está desligado, a tentativa só descobre isso
 * depois de segundos — e numa ligação são várias frases seguidas pagando esse
 * preço. Depois de uma falha, as próximas desistem na hora e a conversa segue
 * com a voz do navegador.
 */
const PAUSA_APOS_FALHA_MS = 60_000;
let falhouEm = 0;

/** Depois de uma falha recente, nem tenta: devolve na hora para não travar a fala. */
function emPausa(): boolean {
  return falhouEm > 0 && Date.now() - falhouEm < PAUSA_APOS_FALHA_MS;
}

function digital(texto: string, marca: string): string {
  return crypto.createHash('sha1').update(`${marca}|${texto}`).digest('hex');
}

/** Quem fala agora: a Azure quando há chave, senão a voz do PC da loja. */
function vozEscolhida() {
  return azureLigada()
    ? { marca: `az|${process.env.JARVIS_VOZ_AZURE || 'thalita'}`, ext: 'mp3', tipo: 'audio/mpeg' as const }
    : { marca: `cl|${PERFIL}|${TAXA}|${PASSOS}`, ext: 'wav', tipo: 'audio/wav' as const };
}

/** O PC está no ar e com a voz carregada? */
export async function vozDisponivel(): Promise<boolean> {
  if (azureLigada()) return true;
  try {
    const r = await fetch(`${SERVIDOR}/saude`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return false;
    const s = (await r.json()) as { ok?: boolean };
    if (s.ok === true) {
      falhouEm = 0; // respondeu: pode tentar falar de novo
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Devolve o áudio da frase, com o tipo para o navegador tocar.
 *
 * Procura primeiro no que já foi falado antes — as falas do JARVIS se repetem muito,
 * e repetida sai na hora sem gastar cota nem GPU. Frase nova vai para a Azure; se ela
 * não responder, para a voz do PC da loja. `null` = ninguém atendeu, e aí quem fala
 * é o próprio navegador.
 */
export async function falaDe(texto: string): Promise<{ audio: Buffer; tipo: string } | null> {
  const limpo = texto.trim().slice(0, LIMITE_TEXTO);
  if (!limpo) return null;

  const escolha = vozEscolhida();
  const arquivo = path.join(PASTA, `${digital(limpo, escolha.marca)}.${escolha.ext}`);
  try {
    return { audio: await fs.readFile(arquivo), tipo: escolha.tipo };
  } catch {
    /* frase nova */
  }

  // 1ª escolha: a voz boa da Azure
  const mp3 = await falaAzure(limpo);
  if (mp3) {
    await guardar(arquivo, mp3);
    return { audio: mp3, tipo: 'audio/mpeg' };
  }

  // 2ª: a voz do PC da loja (o cache dela tem marca própria)
  const wav = await falaClonada(limpo);
  if (!wav) return null;
  const arquivoPc = path.join(PASTA, `${digital(limpo, `cl|${PERFIL}|${TAXA}|${PASSOS}`)}.wav`);
  await guardar(arquivoPc, wav);
  return { audio: wav, tipo: 'audio/wav' };
}

/** Guarda a frase falada; se o disco falhar, o áudio vai do mesmo jeito. */
async function guardar(arquivo: string, audio: Buffer) {
  try {
    await fs.mkdir(PASTA, { recursive: true });
    await fs.writeFile(arquivo, audio);
  } catch {
    /* sem cache desta vez */
  }
}

/** A voz que roda no PC-servidor da loja (reserva). */
async function falaClonada(texto: string): Promise<Buffer | null> {
  if (emPausa()) return null;

  let resposta: Response;
  try {
    resposta = await fetch(`${SERVIDOR}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto, perfil: PERFIL, taxa: TAXA, formato: 'wav', passos: PASSOS }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    falhouEm = Date.now();
    return null; // PC desligado, túnel caído ou GPU ocupada demais
  }
  if (!resposta.ok) {
    falhouEm = Date.now();
    return null;
  }
  const wav = Buffer.from(await resposta.arrayBuffer());
  if (wav.length < 100) {
    falhouEm = Date.now();
    return null;
  }
  falhouEm = 0; // voltou a responder
  return wav;
}
