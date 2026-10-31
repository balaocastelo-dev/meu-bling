/**
 * Anti-spam do "chamar atenção" (nudge), por par remetente → destinatário.
 * Tremor da tela: no máximo 1 a cada 30 s. WhatsApp: no máximo 1 a cada 5 min.
 * Fica em memória (como o restante do tempo real do chat): reiniciar a API zera os prazos.
 */

export const INTERVALO_ATENCAO_MS = 30_000;
export const INTERVALO_WHATSAPP_MS = 5 * 60_000;

const ultimaAtencao = new Map<string, number>();
const ultimoWhatsapp = new Map<string, number>();

function chave(de: number, para: number) {
  return `${de}:${para}`;
}

function falta(mapa: Map<string, number>, de: number, para: number, intervalo: number, agora: number) {
  const quando = mapa.get(chave(de, para)) ?? 0;
  const resta = intervalo - (agora - quando);
  return resta > 0 ? resta : 0;
}

export function podeAtencao(de: number, para: number, agora = Date.now()): { ok: true } | { ok: false; esperaMs: number } {
  const resta = falta(ultimaAtencao, de, para, INTERVALO_ATENCAO_MS, agora);
  return resta > 0 ? { ok: false, esperaMs: resta } : { ok: true };
}

export function registrarAtencao(de: number, para: number, agora = Date.now()) {
  ultimaAtencao.set(chave(de, para), agora);
}

export function podeWhatsapp(de: number, para: number, agora = Date.now()): { ok: true } | { ok: false; esperaMs: number } {
  const resta = falta(ultimoWhatsapp, de, para, INTERVALO_WHATSAPP_MS, agora);
  return resta > 0 ? { ok: false, esperaMs: resta } : { ok: true };
}

export function registrarWhatsapp(de: number, para: number, agora = Date.now()) {
  ultimoWhatsapp.set(chave(de, para), agora);
}

/** Só para testes: esvazia os prazos. */
export function limparLimitesAtencao() {
  ultimaAtencao.clear();
  ultimoWhatsapp.clear();
}
