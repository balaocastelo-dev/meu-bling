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

import { api } from '@/lib/api';

export const TTS_DISPONIVEL = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---------------------------------------------------------------- a voz do Thiago
/**
 * A primeira escolha é a voz clonada dele, gerada no PC-servidor da loja e entregue
 * pelo próprio sistema. Se o PC não responder, cai na voz do navegador sem drama —
 * o JARVIS continua falando, só que com a voz de fábrica.
 */
let audioAtual: HTMLAudioElement | null = null;
let clonadaOk: boolean | null = null; // null = ainda não tentei nesta sessão

async function falarClonada(texto: string): Promise<boolean> {
  if (clonadaOk === false) return false;
  const blob = await api.blobPost('/jarvis/voz', { texto });
  if (!blob || blob.size < 100) {
    clonadaOk = false; // não insiste a cada frase; recarregar a página tenta de novo
    return false;
  }
  clonadaOk = true;

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audioAtual = audio;
  await new Promise<void>((resolve) => {
    const fim = () => {
      URL.revokeObjectURL(url);
      if (audioAtual === audio) audioAtual = null;
      resolve();
    };
    audio.onended = fim;
    audio.onerror = fim;
    audio.play().catch(fim);
  });
  return true;
}

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


// ---------------------------------------------------------------- dinheiro falado
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** Número até 999 por extenso. */
function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r) partes.push(r < 20 ? UNID[r] : [DEZ[Math.floor(r / 10)], UNID[r % 10]].filter(Boolean).join(' e '));
  return partes.join(' e ');
}

/**
 * Dinheiro do jeito que a gente fala: R$ 40.500,45 vira "quarenta mil e quinhentos reais".
 * Arredonda o que não muda a decisão — centavos somem acima de cem reais, e valores
 * grandes vão para o milhar/milhão mais próximo.
 */
export function reaisFalados(valor: number): string {
  const neg = valor < 0;
  let v = Math.abs(valor);

  // arredonda ANTES de decompor: a partir de mil, até a centena; a partir do
  // milhão, até o milhar. É o jeito que se fala um número desses em voz alta.
  if (v >= 1_000_000) v = Math.round(v / 1000) * 1000;
  else if (v >= 1000) v = Math.round(v / 100) * 100;

  const milhoes = Math.floor(v / 1_000_000);
  const milhares = Math.floor((v % 1_000_000) / 1000);
  const resto = Math.floor(v % 1000);

  const partes: string[] = [];
  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);

  // só um valor "pequeno" merece centavos — acima disso eles não mudam decisão
  if (v < 1000) {
    const centavos = Math.round((Math.abs(valor) - resto) * 100);
    if (resto) partes.push(`${ate999(resto)} ${resto === 1 ? 'real' : 'reais'}`);
    if (centavos && resto < 100) partes.push(`${ate999(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
    if (!partes.length) return 'zero reais';
    return `${neg ? 'menos ' : ''}${partes.join(' e ')}`;
  }

  if (resto) partes.push(ate999(resto));
  // "um milhão de reais", mas "um milhão e duzentos mil reais"
  const fecho = partes.length === 1 && milhoes ? 'de reais' : 'reais';
  return `${neg ? 'menos ' : ''}${partes.join(' e ')} ${fecho}`;
}

/** Deixa o texto pronto para ser falado: tira marcação e lê dinheiro como gente fala. */
export function prepararFala(texto: string): string {
  return texto
    .replace(/[*_#`>]/g, '')
    .replace(/\r/g, '')
    // dinheiro do jeito que se fala, sem centavos quando não importam
    .replace(/R\$\s?(-?[\d.]+)(?:,(\d{2}))?/g, (_m, inteiro: string, centavos?: string) => {
      const n = Number(`${inteiro.replace(/\./g, '')}.${centavos ?? '00'}`);
      return Number.isFinite(n) ? reaisFalados(n) : _m;
    })
    .replace(/(\d+)%/g, '$1 por cento')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function pararDeFalar() {
  if (TTS_DISPONIVEL) window.speechSynthesis.cancel();
  if (audioAtual) {
    audioAtual.pause();
    audioAtual.onended?.(new Event('ended'));
    audioAtual = null;
  }
}

export function estaFalando(): boolean {
  if (audioAtual && !audioAtual.paused) return true;
  return TTS_DISPONIVEL && window.speechSynthesis.speaking;
}

/** Fala um texto. A promessa resolve quando termina (ou se for interrompido). */
export async function falar(texto: string, opcoes: { velocidade?: number } = {}): Promise<void> {
  if (!texto.trim()) return;
  pararDeFalar();

  const pronto = prepararFala(texto);
  if (await falarClonada(pronto)) return;
  if (!TTS_DISPONIVEL) return;

  return new Promise((resolve) => {
    const fala = new SpeechSynthesisUtterance(pronto);
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

// ---------------------------------------------------------------- ouvir o volume (para o barge-in)
/**
 * O problema do duplex: o microfone escuta a própria voz do JARVIS, o reconhecedor
 * transcreve e ele responde a si mesmo. A saída é NÃO transcrever enquanto ele fala —
 * e, em vez disso, vigiar só o VOLUME do microfone. Se alguém falar alto por um tempinho,
 * a fala do JARVIS é cortada e a escuta volta.
 *
 * O navegador já cancela o eco (echoCancellation), mas em caixa de som aberta sobra sinal,
 * por isso o limiar e o tempo mínimo.
 */
export type MonitorVoz = { parar: () => void };

export async function monitorarVoz(
  aoFalar: () => void,
  opcoes: { limiar?: number; msMinimo?: number } = {},
): Promise<MonitorVoz | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  const limiar = opcoes.limiar ?? 0.075;
  const msMinimo = opcoes.msMinimo ?? 220;

  let fluxo: MediaStream;
  try {
    fluxo = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    return null;
  }

  const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  const ctx = new Ctx();
  const fonte = ctx.createMediaStreamSource(fluxo);
  const analisador = ctx.createAnalyser();
  analisador.fftSize = 1024;
  fonte.connect(analisador);

  const amostra = new Float32Array(analisador.fftSize);
  let desde = 0;
  let parado = false;
  let quadro = 0;

  const olhar = () => {
    if (parado) return;
    analisador.getFloatTimeDomainData(amostra);
    let soma = 0;
    for (let i = 0; i < amostra.length; i++) soma += amostra[i] * amostra[i];
    const volume = Math.sqrt(soma / amostra.length);

    if (volume > limiar) {
      if (!desde) desde = performance.now();
      else if (performance.now() - desde >= msMinimo) {
        desde = 0;
        aoFalar();
      }
    } else {
      desde = 0;
    }
    quadro = requestAnimationFrame(olhar);
  };
  quadro = requestAnimationFrame(olhar);

  return {
    parar: () => {
      parado = true;
      cancelAnimationFrame(quadro);
      fluxo.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}

/** Duas frases são "a mesma coisa"? Usado para descartar eco que escapou. */
export function pareceEco(dito: string, ouvido: string): boolean {
  const limpar = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((x) => x.length > 3);

  const a = new Set(limpar(dito));
  const b = limpar(ouvido);
  if (!b.length || a.size === 0) return false;
  const iguais = b.filter((x) => a.has(x)).length;
  return iguais / b.length > 0.6;
}
