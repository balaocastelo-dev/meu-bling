/**
 * Vozes neurais da Azure — o português impecável do JARVIS.
 *
 * São as vozes da Microsoft (Thalita, Francisca, Antonio) pela API oficial: entonação,
 * acentos e pausas de quem fala a língua. A camada gratuita (F0) dá 500 mil caracteres
 * por mês, que com o cache de frases sobra para a loja inteira.
 *
 * Sem chave configurada, esta porta simplesmente não abre e quem fala é a reserva.
 */
const CHAVE = process.env.AZURE_SPEECH_KEY || '';
const REGIAO = process.env.AZURE_SPEECH_REGION || 'brazilsouth';
const VOZ = process.env.JARVIS_VOZ_AZURE || 'pt-BR-ThalitaMultilingualNeural';
const ESPERA_MS = 12_000;

export const azureLigada = () => CHAVE.length > 0;

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Gera o MP3 da frase. `null` = sem chave, cota estourada ou fora do ar. */
export async function falaAzure(texto: string): Promise<Buffer | null> {
  if (!CHAVE) return null;

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">` +
    `<voice name="${VOZ}">${escapar(texto)}</voice></speak>`;

  try {
    const r = await fetch(`https://${REGIAO}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': CHAVE,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'meu-bling-jarvis',
      },
      body: ssml,
      signal: AbortSignal.timeout(ESPERA_MS),
    });
    if (!r.ok) return null;
    const mp3 = Buffer.from(await r.arrayBuffer());
    return mp3.length > 500 ? mp3 : null;
  } catch {
    return null;
  }
}
