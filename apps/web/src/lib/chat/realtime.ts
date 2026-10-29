/**
 * Ligação em tempo real do chat da equipe.
 *
 * 1. Tenta o WebSocket (em `realtimeUrl` da config, ou na própria origem do sistema). Autentica mandando
 *    {tipo:'auth', token} como primeira mensagem; o servidor responde {tipo:'pronto'}.
 * 2. Se o WebSocket não conecta (ex.: proxy no caminho que não repassa a conexão), cai para o long polling
 *    (GET /chat/eventos?desde=N), que funciona em qualquer proxy; de tempos em tempos tenta o WebSocket de novo.
 * 3. Reconecta sozinho com espera crescente; ao voltar à aba, religa na hora.
 */
import { api, API_BASE } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import type { Chamada, ConfigChat, EventoChat, EstadoPresenca } from './tipos';

type Ouvinte = (e: EventoChat) => void;
const ouvintes = new Set<Ouvinte>();

let ws: WebSocket | null = null;
let ligado = false;
let tentativasWs = 0;
let falhasSeguidasWs = 0;
let timerReconectar: ReturnType<typeof setTimeout> | null = null;
let timerPing: ReturnType<typeof setInterval> | null = null;
let pollingAtivo = false;
let pollingSeq = 0;
let pollingAbort: AbortController | null = null;
let ultimaTentativaWs = 0;
let visibilidadeLigada = false;

/** Recebe todos os eventos (além do store). Devolve a função para parar de ouvir. */
export function ouvirChat(fn: Ouvinte): () => void {
  ouvintes.add(fn);
  return () => {
    ouvintes.delete(fn);
  };
}

function distribuir(e: EventoChat) {
  useChat.getState().aplicarEvento(e);
  for (const fn of ouvintes) {
    try {
      fn(e);
    } catch (err) {
      console.error('[chat] ouvinte falhou', err);
    }
  }
}

function urlWs(cfg: ConfigChat | null): string {
  const base = cfg?.realtimeUrl ? cfg.realtimeUrl.replace(/\/$/, '') + '/api/v1' : `${location.origin}${API_BASE}`;
  return base.replace(/^http/, 'ws') + '/chat/ws';
}

async function carregarConfig(): Promise<ConfigChat | null> {
  try {
    const cfg = await api.get<ConfigChat>('/chat/config');
    useChat.getState().setConfig(cfg);
    return cfg;
  } catch {
    return useChat.getState().config;
  }
}

/** Liga o chat (chamado quando há usuário logado). Idempotente. */
export async function ligarChat() {
  if (ligado) return;
  ligado = true;
  useChat.getState().setLigacao('ligando');
  if (!visibilidadeLigada && typeof document !== 'undefined') {
    visibilidadeLigada = true;
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    window.addEventListener('online', () => ligado && reconectarAgora());
    window.addEventListener('focus', () => ligado && document.visibilityState === 'visible' && garantirLigacao());
  }
  await carregarConfig();
  void useChat.getState().carregarConversas().catch(() => undefined);
  conectarWs();
}

export function desligarChat() {
  ligado = false;
  pararPolling();
  if (timerReconectar) clearTimeout(timerReconectar);
  timerReconectar = null;
  if (timerPing) clearInterval(timerPing);
  timerPing = null;
  if (ws) {
    try {
      ws.close(1000, 'logout');
    } catch {
      /* já fechado */
    }
  }
  ws = null;
  useChat.getState().limpar();
}

function garantirLigacao() {
  if (!ligado) return;
  const aberto = ws && ws.readyState === WebSocket.OPEN;
  if (!aberto && !pollingAtivo) reconectarAgora();
}

function reconectarAgora() {
  if (timerReconectar) clearTimeout(timerReconectar);
  timerReconectar = null;
  tentativasWs = 0;
  if (!(ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) conectarWs();
}

function aoMudarVisibilidade() {
  const estado: EstadoPresenca = document.visibilityState === 'visible' ? 'online' : 'ausente';
  enviarWs({ tipo: 'estado', valor: estado });
  if (document.visibilityState === 'visible') garantirLigacao();
}

function conectarWs() {
  if (!ligado) return;
  const token = useAuth.getState().token;
  if (!token) return;
  ultimaTentativaWs = Date.now();
  let pronto = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(urlWs(useChat.getState().config));
  } catch {
    falhaWs();
    return;
  }
  ws = socket;
  const prazo = setTimeout(() => {
    if (!pronto) {
      try {
        socket.close();
      } catch {
        /* nada */
      }
    }
  }, 10_000);
  socket.onopen = () => {
    socket.send(JSON.stringify({ tipo: 'auth', token }));
  };
  socket.onmessage = (ev) => {
    let e: EventoChat;
    try {
      e = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (e.tipo === 'pronto') {
      pronto = true;
      clearTimeout(prazo);
      tentativasWs = 0;
      falhasSeguidasWs = 0;
      pararPolling();
      useChat.getState().setLigacao('websocket');
      if (document.visibilityState !== 'visible') socket.send(JSON.stringify({ tipo: 'estado', valor: 'ausente' }));
      if (timerPing) clearInterval(timerPing);
      timerPing = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ tipo: 'ping' }));
      }, 40_000);
      // ao religar, a caixa de entrada pode ter mudado
      void useChat.getState().carregarConversas().catch(() => undefined);
    }
    if (e.tipo === 'pong') return;
    distribuir(e);
  };
  socket.onclose = (ev) => {
    clearTimeout(prazo);
    if (timerPing) clearInterval(timerPing);
    timerPing = null;
    if (ws === socket) ws = null;
    if (!ligado) return;
    if (ev.code === 4401) {
      // token inválido/expirado: a sessão caiu; o api.ts cuida do redirecionamento na próxima chamada
      useChat.getState().setLigacao('desligado');
      return;
    }
    if (!pronto) falhaWs();
    else {
      useChat.getState().setLigacao('ligando');
      agendarReconexao();
    }
  };
  socket.onerror = () => {
    /* o close trata */
  };
}

function falhaWs() {
  falhasSeguidasWs++;
  // duas falhas seguidas sem chegar ao "pronto": o WebSocket não passa por aqui → long polling
  if (falhasSeguidasWs >= 2) {
    iniciarPolling();
    return;
  }
  agendarReconexao();
}

function agendarReconexao() {
  if (!ligado || timerReconectar) return;
  tentativasWs++;
  const espera = Math.min(30_000, 1000 * 2 ** Math.min(tentativasWs, 5));
  timerReconectar = setTimeout(() => {
    timerReconectar = null;
    conectarWs();
  }, espera);
}

// ---------------------------------------------------------------- long polling (reserva)

function iniciarPolling() {
  if (pollingAtivo || !ligado) return;
  pollingAtivo = true;
  pollingSeq = 0;
  useChat.getState().setLigacao('polling');
  void loopPolling();
}

function pararPolling() {
  pollingAtivo = false;
  if (pollingAbort) pollingAbort.abort();
  pollingAbort = null;
}

async function loopPolling() {
  let erros = 0;
  while (pollingAtivo && ligado) {
    // de 2 em 2 minutos tenta o WebSocket de novo (se voltar a passar, o polling para no "pronto")
    if (Date.now() - ultimaTentativaWs > 120_000 && !(ws && ws.readyState !== WebSocket.CLOSED)) {
      falhasSeguidasWs = 1;
      conectarWs();
    }
    pollingAbort = new AbortController();
    try {
      const espera = useChat.getState().config?.pollingMs ?? 25_000;
      const token = useAuth.getState().token;
      if (!token) break;
      const res = await fetch(`${API_BASE}/chat/eventos?desde=${pollingSeq}&espera=${espera}`, { headers: { Authorization: `Bearer ${token}` }, signal: pollingAbort.signal });
      if (res.status === 401) break;
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as { seq: number; eventos: { seq: number; evento: EventoChat }[]; naoLidas: number; online: { usuarioId: number; estado: EstadoPresenca }[] };
      if (pollingSeq === 0) {
        // primeira volta: carrega o estado como o "pronto" do WebSocket faria
        distribuir({ tipo: 'pronto', usuarioId: useAuth.getState().usuario?.id ?? 0, online: r.online, chamadas: await api.get<Chamada[]>('/chat/chamadas/ativas').catch(() => [] as Chamada[]), naoLidas: r.naoLidas });
      }
      pollingSeq = r.seq;
      for (const ev of r.eventos) distribuir(ev.evento);
      erros = 0;
    } catch (e) {
      if ((e as Error).name === 'AbortError') break;
      erros++;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * erros)));
    }
  }
  pollingAbort = null;
}

// ---------------------------------------------------------------- envio pelo WebSocket (com reserva por HTTP)

export function enviarWs(obj: Record<string, unknown>): boolean {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function avisarDigitando(conversaId: number) {
  if (!enviarWs({ tipo: 'digitando', conversaId })) void api.post(`/chat/conversas/${conversaId}/digitando`, {}).catch(() => undefined);
}

/** Sinalização WebRTC: pelo WebSocket; sem ele, por HTTP (o servidor entrega pela fila do polling). */
export function enviarRtc(chamadaId: number, para: number, dados: unknown) {
  if (!enviarWs({ tipo: 'rtc', chamadaId, para, dados })) void api.post(`/chat/chamadas/${chamadaId}/rtc`, { para, dados }).catch(() => undefined);
}

export function ligacaoAtual() {
  return useChat.getState().ligacao;
}
