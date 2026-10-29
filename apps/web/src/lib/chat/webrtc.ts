/**
 * Chamadas de voz e vídeo pelo navegador (WebRTC) — chat da equipe.
 *
 * O áudio e o vídeo vão direto de um navegador para o outro (ponta a ponta); o servidor só repassa a
 * "apresentação" (oferta/resposta/candidatos ICE) pelo WebSocket. Em sala com várias pessoas cada uma
 * conecta com cada uma (malha) — serve bem para a reunião da loja (até ~5 pessoas em vídeo).
 *
 * Negociação "perfeita" (padrão do WebRTC): os dois lados podem iniciar; o lado "educado"
 * (id maior) recua quando as ofertas se cruzam. Assim nunca trava quando dois entram ao mesmo tempo.
 */
import { enviarRtc } from './realtime';
import type { Chamada, SinalRtc } from './tipos';

export interface Par {
  usuarioId: number;
  pc: RTCPeerConnection;
  stream: MediaStream;
  estado: RTCPeerConnectionState | 'novo';
  comVideo: boolean;
}

export interface EstadoChamada {
  chamada: Chamada;
  local: MediaStream | null;
  mudo: boolean;
  cameraLigada: boolean;
  temCamera: boolean;
  pares: Par[];
  erro: string | null;
  iniciadaEm: number;
}

type Ouvinte = () => void;

export class GerenciadorChamada {
  chamada: Chamada;
  private eu: number;
  private iceServers: RTCIceServer[];
  private local: MediaStream | null = null;
  private pares = new Map<number, Par & { polite: boolean; makingOffer: boolean; ignoreOffer: boolean; pendentes: RTCIceCandidateInit[] }>();
  private ouvintes = new Set<Ouvinte>();
  private mudo = false;
  private cameraLigada = false;
  private temCamera = false;
  private erro: string | null = null;
  private encerrada = false;
  private iniciadaEm = Date.now();
  private snapshot: EstadoChamada | null = null;

  constructor(chamada: Chamada, eu: number, iceServers: RTCIceServer[]) {
    this.chamada = chamada;
    this.eu = eu;
    this.iceServers = iceServers;
  }

  ouvir(fn: Ouvinte) {
    this.ouvintes.add(fn);
    return () => {
      this.ouvintes.delete(fn);
    };
  }

  private avisar() {
    this.snapshot = null;
    for (const fn of this.ouvintes) fn();
  }

  estado(): EstadoChamada {
    if (!this.snapshot) {
      this.snapshot = {
        chamada: this.chamada,
        local: this.local,
        mudo: this.mudo,
        cameraLigada: this.cameraLigada,
        temCamera: this.temCamera,
        pares: [...this.pares.values()].map((p) => ({ usuarioId: p.usuarioId, pc: p.pc, stream: p.stream, estado: p.estado, comVideo: p.comVideo })),
        erro: this.erro,
        iniciadaEm: this.iniciadaEm,
      };
    }
    return this.snapshot;
  }

  /** Pede microfone (e câmera, na chamada de vídeo) e conecta com quem já está na chamada. */
  async iniciar(video: boolean) {
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false });
      this.cameraLigada = video;
      this.temCamera = video;
    } catch (e) {
      if (video) {
        // sem câmera (ou negada): segue só com voz
        try {
          this.local = await navigator.mediaDevices.getUserMedia({ audio: true });
          this.cameraLigada = false;
          this.temCamera = false;
          this.erro = 'Câmera indisponível — a chamada segue só com voz.';
        } catch (e2) {
          this.erro = mensagemMidia(e2);
        }
      } else this.erro = mensagemMidia(e);
    }
    this.avisar();
    this.sincronizarParticipantes(this.chamada);
  }

  /** A chamada mudou (alguém entrou/saiu): conecta com os novos e descarta quem saiu. */
  sincronizarParticipantes(chamada: Chamada) {
    this.chamada = chamada;
    if (this.encerrada) return;
    const ids = new Set(chamada.participantes.filter((id) => id !== this.eu));
    for (const id of ids) if (!this.pares.has(id)) this.conectarCom(id);
    for (const [id, p] of this.pares) {
      if (!ids.has(id)) {
        p.pc.close();
        this.pares.delete(id);
      }
    }
    this.avisar();
  }

  private conectarCom(usuarioId: number) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 2 });
    const par = { usuarioId, pc, stream: new MediaStream(), estado: 'novo' as const, comVideo: false, polite: this.eu > usuarioId, makingOffer: false, ignoreOffer: false, pendentes: [] as RTCIceCandidateInit[] };
    this.pares.set(usuarioId, par);
    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    pc.ontrack = (ev) => {
      for (const s of ev.streams.length ? ev.streams : [new MediaStream([ev.track])]) {
        for (const t of s.getTracks()) if (!par.stream.getTracks().some((x) => x.id === t.id)) par.stream.addTrack(t);
      }
      if (ev.track.kind === 'video') {
        par.comVideo = true;
        ev.track.onmute = () => {
          par.comVideo = false;
          this.avisar();
        };
        ev.track.onunmute = () => {
          par.comVideo = true;
          this.avisar();
        };
        ev.track.onended = () => {
          par.comVideo = false;
          this.avisar();
        };
      }
      this.avisar();
    };
    pc.onicecandidate = (ev) => {
      enviarRtc(this.chamada.id, usuarioId, { ice: ev.candidate ? ev.candidate.toJSON() : null });
    };
    pc.onconnectionstatechange = () => {
      (par as Par).estado = pc.connectionState;
      if (pc.connectionState === 'failed') {
        // tenta reconectar o ICE uma vez
        try {
          pc.restartIce();
        } catch {
          /* navegador antigo */
        }
      }
      this.avisar();
    };
    pc.onnegotiationneeded = async () => {
      try {
        par.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) enviarRtc(this.chamada.id, usuarioId, { sdp: pc.localDescription.toJSON() });
      } catch (e) {
        console.warn('[chamada] falha ao negociar', e);
      } finally {
        par.makingOffer = false;
      }
    };
    // avisa que estou aqui (quem recebe e ainda não me tem, conecta)
    enviarRtc(this.chamada.id, usuarioId, { ola: true });
    this.avisar();
  }

  /** Sinal recebido do outro navegador (pelo servidor). */
  async tratarSinal(de: number, dados: SinalRtc) {
    if (this.encerrada) return;
    if (!this.chamada.participantes.includes(de)) this.chamada = { ...this.chamada, participantes: [...this.chamada.participantes, de] };
    let par = this.pares.get(de);
    if (!par) {
      this.conectarCom(de);
      par = this.pares.get(de)!;
    }
    const { pc } = par;
    try {
      if ('sdp' in dados) {
        const desc = dados.sdp;
        const colisao = desc.type === 'offer' && (par.makingOffer || pc.signalingState !== 'stable');
        par.ignoreOffer = !par.polite && colisao;
        if (par.ignoreOffer) return;
        await pc.setRemoteDescription(desc);
        for (const c of par.pendentes) await pc.addIceCandidate(c).catch(() => undefined);
        par.pendentes = [];
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          if (pc.localDescription) enviarRtc(this.chamada.id, de, { sdp: pc.localDescription.toJSON() });
        }
      } else if ('ice' in dados) {
        if (!pc.remoteDescription) {
          if (dados.ice) par.pendentes.push(dados.ice);
          return;
        }
        try {
          await pc.addIceCandidate(dados.ice ?? undefined);
        } catch (e) {
          if (!par.ignoreOffer) console.warn('[chamada] candidato ICE recusado', e);
        }
      }
      // 'ola' e 'video' só servem para criar o par / atualizar a tela
      if ('video' in dados) {
        par.comVideo = dados.video;
        this.avisar();
      }
    } catch (e) {
      console.warn('[chamada] erro na sinalização', e);
    }
  }

  alternarMudo() {
    this.mudo = !this.mudo;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = !this.mudo;
    this.avisar();
  }

  async alternarCamera() {
    if (!this.local) return;
    if (this.cameraLigada) {
      for (const t of this.local.getVideoTracks()) {
        t.stop();
        this.local.removeTrack(t);
        for (const p of this.pares.values()) {
          const s = p.pc.getSenders().find((x) => x.track === t);
          if (s) p.pc.removeTrack(s);
        }
      }
      this.cameraLigada = false;
      for (const p of this.pares.values()) enviarRtc(this.chamada.id, p.usuarioId, { video: false });
    } else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
        const t = cam.getVideoTracks()[0];
        this.local.addTrack(t);
        for (const p of this.pares.values()) p.pc.addTrack(t, this.local);
        this.cameraLigada = true;
        this.temCamera = true;
        this.erro = null;
        for (const p of this.pares.values()) enviarRtc(this.chamada.id, p.usuarioId, { video: true });
      } catch (e) {
        this.erro = mensagemMidia(e);
      }
    }
    this.avisar();
  }

  encerrar() {
    if (this.encerrada) return;
    this.encerrada = true;
    for (const p of this.pares.values()) {
      try {
        p.pc.close();
      } catch {
        /* nada */
      }
    }
    this.pares.clear();
    for (const t of this.local?.getTracks() ?? []) t.stop();
    this.local = null;
    this.avisar();
  }
}

function mensagemMidia(e: unknown): string {
  const nome = (e as { name?: string })?.name || '';
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'O navegador bloqueou o microfone/câmera. Libere o acesso no cadeado da barra de endereço e tente de novo.';
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Nenhum microfone/câmera encontrado neste aparelho.';
  if (nome === 'NotReadableError') return 'O microfone/câmera está em uso por outro programa.';
  return 'Não foi possível acessar o microfone/câmera.';
}

/** Chamadas só funcionam em contexto seguro (HTTPS ou localhost). */
export function navegadorSuportaChamada(): boolean {
  return typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia && (window.isSecureContext ?? true);
}
