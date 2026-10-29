/** Sons do chat gerados no próprio navegador (Web Audio): "plim" de mensagem e toque de chamada. */

let ctx: AudioContext | null = null;
function contexto(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function nota(c: AudioContext, freq: number, inicio: number, dur: number, volume = 0.12, tipo: OscillatorType = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipo;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, inicio);
  g.gain.linearRampToValueAtTime(volume, inicio + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
  o.connect(g).connect(c.destination);
  o.start(inicio);
  o.stop(inicio + dur + 0.02);
}

/** "Plim" curto de mensagem nova. */
export function somMensagem() {
  const c = contexto();
  if (!c) return;
  const t = c.currentTime;
  nota(c, 880, t, 0.12);
  nota(c, 1318, t + 0.08, 0.18);
}

/** Som de enviado (bem discreto). */
export function somEnviado() {
  const c = contexto();
  if (!c) return;
  nota(c, 660, c.currentTime, 0.08, 0.05);
}

let toqueTimer: ReturnType<typeof setInterval> | null = null;

/** Toque de chamada: repete até `pararToque()`. */
export function iniciarToque() {
  pararToque();
  const tocar = () => {
    const c = contexto();
    if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      nota(c, 784, t + i * 0.25, 0.14, 0.14, 'triangle');
      nota(c, 988, t + i * 0.25 + 0.1, 0.14, 0.12, 'triangle');
    }
  };
  tocar();
  toqueTimer = setInterval(tocar, 2000);
  try {
    navigator.vibrate?.([300, 200, 300]);
  } catch {
    /* sem vibração */
  }
}

export function pararToque() {
  if (!toqueTimer) return; // nada tocando (o navegador reclama de vibrate(0) sem toque antes)
  clearInterval(toqueTimer);
  toqueTimer = null;
  try {
    navigator.vibrate?.(0);
  } catch {
    /* nada */
  }
}

/** Tom de chamando (quem liga ouve enquanto espera). */
let chamandoTimer: ReturnType<typeof setInterval> | null = null;
export function iniciarChamando() {
  pararChamando();
  const tocar = () => {
    const c = contexto();
    if (!c) return;
    nota(c, 440, c.currentTime, 0.9, 0.06);
  };
  tocar();
  chamandoTimer = setInterval(tocar, 3000);
}
export function pararChamando() {
  if (chamandoTimer) clearInterval(chamandoTimer);
  chamandoTimer = null;
}
