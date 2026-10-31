/**
 * HUB DO CHAT DA EQUIPE — tempo real dentro do sistema (29/10/2026)
 *
 * Mantém em memória quem está conectado (WebSocket), a presença (online / ausente / ocupado),
 * quem está digitando e as chamadas de voz/vídeo em andamento. Tudo o que acontece no chat vira um
 * EVENTO entregue ao navegador de cada pessoa:
 *   - pelo WebSocket, na hora, quando ele está ligado;
 *   - ou pela fila de eventos (GET /chat/eventos?desde=N — long polling), quando o WebSocket não passa
 *     pelo proxy (ex.: www.balao.info → Vercel → VPS). Cada usuário tem a sua fila numerada, com os
 *     últimos eventos, então quem reconecta não perde nada.
 *
 * Eventos (campo `tipo`):
 *   pronto      { usuarioId, online: [{usuarioId, estado}], chamadas: [...] }      ao autenticar no WebSocket
 *   presenca    { usuarioId, online, estado }                                       alguém entrou/saiu/mudou de estado
 *   digitando   { conversaId, usuarioId, nome }                                     alguém está escrevendo
 *   mensagem    { conversaId, mensagem }                                            mensagem nova (texto, áudio, arquivo, sistema)
 *   mensagem.apagada { conversaId, mensagemId }
 *   lida        { conversaId, usuarioId, ateId }                                    alguém leu até a mensagem N
 *   conversa    { conversa }                                                        conversa nova / sala alterada / você foi incluído
 *   conversa.saiu { conversaId }                                                    você saiu ou foi removido
 *   chamada     { acao: convite|entrou|saiu|recusou|encerrada|perdida, chamada }    chamadas de voz e vídeo
 *   rtc         { chamadaId, de, dados }                                            sinalização WebRTC (oferta/resposta/ICE) entre dois navegadores
 *   atencao     { conversaId, de: { id, nome }, mensagemId }                        "chamar atenção": a tela de quem recebe treme (~1 s)
 */
import type { WebSocket } from 'ws';

export type EstadoPresenca = 'online' | 'ausente' | 'ocupado';

export interface Evento {
  tipo: string;
  [k: string]: unknown;
}

interface Conexao {
  socket: WebSocket;
  usuarioId: number;
  nome: string;
  estado: EstadoPresenca;
  vivo: boolean;
}

interface Fila {
  seq: number;
  eventos: { seq: number; evento: Evento; em: number }[];
  esperando: Set<(eventos: { seq: number; evento: Evento }[]) => void>;
  /** último sinal de vida do long polling (presença sem WebSocket) */
  pollAte: number;
}

const FILA_MAX = 300;
const FILA_TTL_MS = 10 * 60 * 1000;
/** quem só usa o long polling conta como online enquanto renova a cada 35 s */
const POLL_VIVO_MS = 40 * 1000;

const conexoes = new Map<number, Set<Conexao>>();
const filas = new Map<number, Fila>();
/** usuarioId → conversaId → até quando está digitando (ms) */
const digitando = new Map<number, Map<number, number>>();
/** quem está online só pelo long polling (para avisar quando parar de renovar) */
const pollOnline = new Set<number>();
const ouvintesPresenca = new Set<(usuarioId: number, online: boolean, estado: EstadoPresenca) => void>();

function fila(usuarioId: number): Fila {
  let f = filas.get(usuarioId);
  if (!f) {
    f = { seq: 0, eventos: [], esperando: new Set(), pollAte: 0 };
    filas.set(usuarioId, f);
  }
  return f;
}

function sockets(usuarioId: number): Conexao[] {
  return [...(conexoes.get(usuarioId) ?? [])];
}

function enviarSocket(c: Conexao, evento: Evento) {
  if (c.socket.readyState !== c.socket.OPEN) return false;
  try {
    c.socket.send(JSON.stringify(evento));
    return true;
  } catch {
    return false;
  }
}

/** Presença: online se tem WebSocket aberto ou long polling recente. */
export function estadoDe(usuarioId: number): { online: boolean; estado: EstadoPresenca } {
  const cs = sockets(usuarioId);
  if (cs.length) {
    // o melhor estado entre as abas abertas (uma aba "online" ganha de outra "ausente")
    const estado = cs.some((c) => c.estado === 'ocupado') ? 'ocupado' : cs.some((c) => c.estado === 'online') ? 'online' : 'ausente';
    return { online: true, estado };
  }
  const f = filas.get(usuarioId);
  if (f && f.pollAte > Date.now()) return { online: true, estado: 'online' };
  return { online: false, estado: 'ausente' };
}

export function onlineAgora(): { usuarioId: number; estado: EstadoPresenca }[] {
  const ids = new Set<number>([...conexoes.keys(), ...[...filas.entries()].filter(([, f]) => f.pollAte > Date.now()).map(([id]) => id)]);
  return [...ids].map((usuarioId) => ({ usuarioId, ...estadoDe(usuarioId) })).filter((p) => p.online);
}

export function estaOnline(usuarioId: number) {
  return estadoDe(usuarioId).online;
}

/** Entrega um evento a um usuário (todas as abas) e guarda na fila para quem está no long polling. */
export function enviarPara(usuarioId: number, evento: Evento) {
  for (const c of sockets(usuarioId)) enviarSocket(c, evento);
  const f = fila(usuarioId);
  f.seq++;
  const item = { seq: f.seq, evento, em: Date.now() };
  f.eventos.push(item);
  if (f.eventos.length > FILA_MAX) f.eventos.splice(0, f.eventos.length - FILA_MAX);
  if (f.esperando.size) {
    const esperando = [...f.esperando];
    f.esperando.clear();
    for (const r of esperando) r([{ seq: item.seq, evento }]);
  }
}

export function enviarParaVarios(usuarioIds: Iterable<number>, evento: Evento, exceto?: number) {
  for (const id of new Set(usuarioIds)) if (id !== exceto) enviarPara(id, evento);
}

export function enviarParaTodos(evento: Evento, exceto?: number) {
  const ids = new Set<number>([...conexoes.keys(), ...filas.keys()]);
  for (const id of ids) if (id !== exceto) enviarPara(id, evento);
}

/**
 * Long polling: devolve os eventos depois de `desde` (seq); se não há nenhum, espera até `timeoutMs`.
 * Renova a presença de quem só usa esta via.
 */
export function esperarEventos(usuarioId: number, desde: number, timeoutMs: number): Promise<{ seq: number; eventos: { seq: number; evento: Evento }[] }> {
  const f = fila(usuarioId);
  const antes = f.pollAte > Date.now();
  f.pollAte = Date.now() + POLL_VIVO_MS;
  pollOnline.add(usuarioId);
  if (!antes && !sockets(usuarioId).length) avisarPresenca(usuarioId);
  const prontos = f.eventos.filter((e) => e.seq > desde).map((e) => ({ seq: e.seq, evento: e.evento }));
  // cliente novo (desde=0) não precisa receber o histórico da fila: só o que vier daqui para a frente
  if (desde === 0) return Promise.resolve({ seq: f.seq, eventos: [] });
  if (prontos.length) return Promise.resolve({ seq: f.seq, eventos: prontos });
  return new Promise((resolve) => {
    const r = (eventos: { seq: number; evento: Evento }[]) => {
      clearTimeout(t);
      resolve({ seq: f.seq, eventos });
    };
    const t = setTimeout(() => {
      f.esperando.delete(r);
      resolve({ seq: f.seq, eventos: [] });
    }, timeoutMs);
    f.esperando.add(r);
  });
}

export function registrarOuvintePresenca(fn: (usuarioId: number, online: boolean, estado: EstadoPresenca) => void) {
  ouvintesPresenca.add(fn);
}

function avisarPresenca(usuarioId: number) {
  const { online, estado } = estadoDe(usuarioId);
  enviarParaTodos({ tipo: 'presenca', usuarioId, online, estado });
  for (const fn of ouvintesPresenca) {
    try {
      fn(usuarioId, online, estado);
    } catch {
      /* ouvinte não derruba o hub */
    }
  }
}

/** Liga um WebSocket já autenticado ao usuário. Devolve a função que desliga. */
export function conectar(socket: WebSocket, usuarioId: number, nome: string): Conexao {
  const c: Conexao = { socket, usuarioId, nome, estado: 'online', vivo: true };
  let set = conexoes.get(usuarioId);
  if (!set) {
    set = new Set();
    conexoes.set(usuarioId, set);
  }
  const eraOnline = estadoDe(usuarioId).online;
  set.add(c);
  if (!eraOnline) avisarPresenca(usuarioId);
  return c;
}

export function desconectar(c: Conexao) {
  const set = conexoes.get(c.usuarioId);
  if (set) {
    set.delete(c);
    if (!set.size) conexoes.delete(c.usuarioId);
  }
  const d = digitando.get(c.usuarioId);
  if (d) d.clear();
  if (!estadoDe(c.usuarioId).online) avisarPresenca(c.usuarioId);
  else avisarPresenca(c.usuarioId); // outra aba continua: estado pode ter mudado
}

export function mudarEstado(c: Conexao, estado: EstadoPresenca) {
  if (c.estado === estado) return;
  c.estado = estado;
  avisarPresenca(c.usuarioId);
}

/** "Fulano está digitando" (vale por 6 s; só para os participantes da conversa). */
export function marcarDigitando(usuarioId: number, conversaId: number, participantes: number[], nome: string) {
  let d = digitando.get(usuarioId);
  if (!d) {
    d = new Map();
    digitando.set(usuarioId, d);
  }
  d.set(conversaId, Date.now() + 6000);
  enviarParaVarios(participantes, { tipo: 'digitando', conversaId, usuarioId, nome }, usuarioId);
}

/** Resumo para a tela "Saúde do sistema" e para testes. */
export function resumoHub() {
  return { conectados: [...conexoes.entries()].map(([usuarioId, s]) => ({ usuarioId, abas: s.size })), filas: filas.size };
}

/** Ping a cada 30 s: aba que não responde é desligada (senão fica "online" para sempre). */
export function iniciarPing() {
  setInterval(() => {
    for (const set of conexoes.values()) {
      for (const c of set) {
        if (!c.vivo) {
          try {
            c.socket.terminate();
          } catch {
            /* já caiu */
          }
          desconectar(c);
          continue;
        }
        c.vivo = false;
        try {
          c.socket.ping();
        } catch {
          desconectar(c);
        }
      }
    }
    // quem só usava o long polling e parou de renovar: avisa que saiu
    const agora = Date.now();
    for (const id of [...pollOnline]) {
      const f = filas.get(id);
      if (!f || f.pollAte < agora) {
        pollOnline.delete(id);
        if (!conexoes.has(id)) avisarPresenca(id);
      }
    }
    // limpa filas velhas
    for (const [id, f] of filas) {
      f.eventos = f.eventos.filter((e) => agora - e.em < FILA_TTL_MS);
      if (!f.eventos.length && !f.esperando.size && f.pollAte < agora - FILA_TTL_MS && !conexoes.has(id)) filas.delete(id);
    }
  }, 30_000).unref();
}
