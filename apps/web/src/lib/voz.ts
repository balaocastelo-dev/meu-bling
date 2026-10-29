/**
 * Voz do JARVIS — falar e ouvir, usando o que o próprio navegador já tem.
 *
 * Falar  (speechSynthesis): funciona em qualquer navegador moderno, sem servidor e sem custo.
 * Ouvir  (SpeechRecognition): Chrome e Edge. O áudio vai para o serviço de reconhecimento do
 *        navegador (no Chrome, do Google) — é o mesmo caminho do ditado do Android.
 *        Exige HTTPS (o /sistema já é) e permissão do microfone.
 *
 * O "duplex" possível aqui: o JARVIS fala e continua ouvindo; se você começar a falar por
 * cima, ele cala na hora e escuta (barge-in). Não é uma ligação de verdade — cada volta
 * leva um ou dois segundos —, mas dá para conversar sem tocar no teclado.
 */

export const TTS_DISPONIVEL = typeof window !== 'undefined' && 'speechSynthesis' in window;

type RecCtor = new () => any;
const RecognitionCtor: RecCtor | null =
  typeof window !== 'undefined'
    ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null)
    : null;

export const STT_DISPONIVEL = !!RecognitionCtor;

// ---------------------------------------------------------------- falar
let vozPtBr: SpeechSynthesisVoice | null = null;

function escolherVoz(): SpeechSynthesisVoice | null {
  if (!TTS_DISPONIVEL) return null;
  if (vozPtBr) return vozPtBr;
  const vozes = window.speechSynthesis.getVoices();
  if (!vozes.length) return null;
  const pt = vozes.filter((v) => /pt[-_]?BR/i.test(v.lang) || /portugu/i.test(v.name));
  // prefere voz natural/online quando existir
  vozPtBr = pt.find((v) => /natural|neural|google|luciana|francisca/i.test(v.name)) ?? pt[0] ?? null;
  return vozPtBr;
}

if (TTS_DISPONIVEL) {
  window.speechSynthesis.onvoiceschanged = () => {
    vozPtBr = null;
    escolherVoz();
  };
}

/** Deixa o texto pronto para ser falado: tira marcação e lê dinheiro como gente fala. */
export function prepararFala(texto: string): string {
  return texto
    .replace(/[*_#`>]/g, '')
    .replace(/\r/g, '')
    .replace(/R\$\s?([\d.]+),(\d{2})/g, (_m, inteiro: string, centavos: string) => {
      const n = inteiro.replace(/\./g, '');
      const c = Number(centavos);
      return `${n} reais${c ? ` e ${c} centavos` : ''}`;
    })
    .replace(/R\$\s?([\d.]+)/g, (_m, n: string) => `${n.replace(/\./g, '')} reais`)
    .replace(/(\d+)%/g, '$1 por cento')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function pararDeFalar() {
  if (TTS_DISPONIVEL) window.speechSynthesis.cancel();
}

export function estaFalando(): boolean {
  return TTS_DISPONIVEL && window.speechSynthesis.speaking;
}

/** Fala um texto. A promessa resolve quando termina (ou se for interrompido). */
export function falar(texto: string, opcoes: { velocidade?: number } = {}): Promise<void> {
  if (!TTS_DISPONIVEL || !texto.trim()) return Promise.resolve();
  pararDeFalar();

  return new Promise((resolve) => {
    const fala = new SpeechSynthesisUtterance(prepararFala(texto));
    const voz = escolherVoz();
    if (voz) fala.voice = voz;
    fala.lang = voz?.lang || 'pt-BR';
    fala.rate = opcoes.velocidade ?? 1.05;
    fala.pitch = 1;
    fala.onend = () => resolve();
    fala.onerror = () => resolve();
    window.speechSynthesis.speak(fala);
  });
}

// ---------------------------------------------------------------- ouvir
export type Escuta = {
  parar: () => void;
  ativa: () => boolean;
};

/**
 * Escuta contínua. Chama `onParcial` enquanto você fala (serve para o barge-in) e
 * `onFrase` quando a frase fecha. Reinicia sozinha — o navegador corta a escuta sozinho
 * de tempos em tempos.
 */
export function escutar(p: {
  onFrase: (texto: string) => void;
  onParcial?: (texto: string) => void;
  onErro?: (motivo: string) => void;
  onFim?: () => void;
}): Escuta | null {
  if (!RecognitionCtor) return null;

  let parado = false;
  let rec: any = null;

  const criar = () => {
    rec = new RecognitionCtor();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const texto = String(r[0]?.transcript ?? '').trim();
        if (!texto) continue;
        if (r.isFinal) p.onFrase(texto);
        else p.onParcial?.(texto);
      }
    };

    rec.onerror = (e: any) => {
      const erro = String(e?.error ?? 'desconhecido');
      // 'no-speech' e 'aborted' são normais: só reiniciar
      if (erro !== 'no-speech' && erro !== 'aborted') p.onErro?.(erro);
      if (erro === 'not-allowed' || erro === 'service-not-allowed') {
        parado = true;
        p.onErro?.('microfone-negado');
      }
    };

    rec.onend = () => {
      if (parado) {
        p.onFim?.();
        return;
      }
      // o navegador encerra sozinho de tempos em tempos: volta a ouvir
      setTimeout(() => {
        if (!parado) {
          try {
            rec.start();
          } catch {
            /* já estava ouvindo */
          }
        }
      }, 250);
    };

    try {
      rec.start();
    } catch {
      /* já estava ouvindo */
    }
  };

  criar();

  return {
    parar: () => {
      parado = true;
      try {
        rec?.stop();
      } catch {
        /* já parou */
      }
    },
    ativa: () => !parado,
  };
}
