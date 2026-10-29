/**
 * Janela da chamada em andamento (voz ou vídeo). Fica flutuando no canto em qualquer tela; pode ser
 * expandida para tela cheia. Mostra cada pessoa (vídeo ou avatar), a sua prévia, tempo de chamada e os
 * controles: microfone, câmera, expandir e desligar.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Maximize2, Mic, MicOff, Minimize2, PhoneOff, Video, VideoOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import { ouvirChat } from '@/lib/chat/realtime';
import { GerenciadorChamada, type EstadoChamada, type Par } from '@/lib/chat/webrtc';
import { iniciarChamando, pararChamando } from '@/lib/chat/som';
import { tempoCurto } from '@/lib/chat/formato';
import { AvatarUsuario } from './AvatarUsuario';

/** instância da chamada em andamento (uma por vez); o estado React abaixo acompanha para a tela redesenhar */
let gerenciador: GerenciadorChamada | null = null;

function Video_({ stream, mudo, espelhar, className }: { stream: MediaStream | null; mudo?: boolean; espelhar?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={mudo} className={clsx('h-full w-full object-cover', espelhar && '-scale-x-100', className)} />;
}

function Tile({ par, nome, grande }: { par: Par; nome: string; grande: boolean }) {
  const conectando = par.estado === 'novo' || par.estado === 'connecting';
  return (
    <div className={clsx('relative min-w-0 overflow-hidden rounded-xl bg-slate-800', grande ? 'min-h-40' : 'h-24')}>
      {par.comVideo ? (
        <Video_ stream={par.stream} />
      ) : (
        <>
          {/* sem vídeo: o áudio toca por este elemento escondido */}
          <Video_ stream={par.stream} className="absolute h-px w-px opacity-0" />
          <div className="flex h-full w-full items-center justify-center">
            <AvatarUsuario id={par.usuarioId} nome={nome} tamanho={grande ? 'xl' : 'lg'} />
          </div>
        </>
      )}
      <span className="absolute bottom-1.5 left-2 max-w-[calc(100%-1rem)] truncate rounded bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">
        {nome}
        {conectando && ' · conectando…'}
        {par.estado === 'failed' && ' · sem conexão'}
      </span>
    </div>
  );
}

export function JanelaChamada() {
  const chamada = useChat((s) => s.chamadaAtiva);
  const config = useChat((s) => s.config);
  const conversas = useChat((s) => s.conversas);
  const colegas = useChat((s) => s.colegas);
  const sair = useChat((s) => s.sairChamada);
  const eu = useAuth((s) => s.usuario?.id ?? 0);
  const [expandida, setExpandida] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [g, setG] = useState<GerenciadorChamada | null>(null);

  // cria/encerra o gerenciador quando a chamada ativa muda
  useEffect(() => {
    if (!chamada) {
      gerenciador?.encerrar();
      gerenciador = null;
      setG(null);
      pararChamando();
      return;
    }
    if (gerenciador && gerenciador.chamada.id === chamada.id) {
      gerenciador.sincronizarParticipantes(chamada);
      return;
    }
    gerenciador?.encerrar();
    const g = new GerenciadorChamada(chamada, eu, config?.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }]);
    gerenciador = g;
    setG(g);
    setExpandida(chamada.tipo === 'VIDEO');
    void g.iniciar(chamada.tipo === 'VIDEO').then(() => {
      const err = g.estado().erro;
      if (err && !g.estado().local) {
        toast.error(err);
        void sair(chamada.id);
      } else if (err) toast.warning(err);
    });
    return () => {
      /* encerra quando chamadaAtiva vira null (acima) */
    };
  }, [chamada, eu, config, sair]);

  // sinalização e entradas/saídas chegam pelo tempo real
  useEffect(() => {
    return ouvirChat((e) => {
      const g = gerenciador;
      if (!g) return;
      if (e.tipo === 'rtc' && e.chamadaId === g.chamada.id) void g.tratarSinal(e.de, e.dados);
      if (e.tipo === 'chamada' && e.chamada.id === g.chamada.id && (e.acao === 'entrou' || e.acao === 'saiu')) g.sincronizarParticipantes(e.chamada);
    });
  }, []);

  const estado = useSyncExternalStore(
    (fn) => (g ? g.ouvir(fn) : () => undefined),
    () => (g ? g.estado() : null),
  ) as EstadoChamada | null;

  // tom de "chamando" enquanto ninguém entrou; cronômetro depois
  const sozinho = !!chamada && chamada.participantes.filter((id) => id !== eu).length === 0;
  useEffect(() => {
    if (chamada && sozinho) iniciarChamando();
    else pararChamando();
    return () => pararChamando();
  }, [chamada, sozinho]);
  useEffect(() => {
    if (!chamada) return;
    const inicio = chamada.atendidaEm ? new Date(chamada.atendidaEm).getTime() : Date.now();
    const t = setInterval(() => setSegundos(Math.max(0, Math.round((Date.now() - inicio) / 1000))), 1000);
    return () => clearInterval(t);
  }, [chamada?.id, chamada?.atendidaEm]); // eslint-disable-line react-hooks/exhaustive-deps

  const nomes = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of colegas) m.set(c.id, c.nome);
    for (const c of conversas) for (const p of c.participantes) m.set(p.id, p.nome);
    return m;
  }, [colegas, conversas]);

  if (!chamada || !estado) return null;
  const conversa = conversas.find((c) => c.id === chamada.conversaId);
  const titulo = conversa ? (conversa.tipo === 'SALA' ? conversa.nome : conversa.nome) : 'Chamada';
  const pares = estado.pares;
  const nomeDe = (id: number) => nomes.get(id) || `Usuário ${id}`;

  return createPortal(
    <div
      className={clsx(
        'fixed z-[65] flex flex-col overflow-hidden bg-slate-900 text-white shadow-pop',
        expandida ? 'inset-0' : 'bottom-3 right-3 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-700',
      )}
      style={expandida ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' } : undefined}
      role="dialog"
      aria-label="Chamada em andamento"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{titulo}</p>
          <p className="text-[11px] text-slate-300 num">{sozinho ? 'Chamando…' : `${chamada.tipo === 'VIDEO' ? 'Vídeo' : 'Voz'} · ${tempoCurto(segundos)}${pares.length > 1 ? ` · ${pares.length + 1} pessoas` : ''}`}</p>
        </div>
        <button type="button" onClick={() => setExpandida((v) => !v)} className="rounded-md p-1.5 text-slate-300 hover:bg-white/10" aria-label={expandida ? 'Reduzir' : 'Expandir'}>
          {expandida ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div className={clsx('relative min-h-0 flex-1 px-3', expandida ? 'pb-2' : 'pb-1')}>
        {pares.length === 0 ? (
          <div className={clsx('flex items-center justify-center rounded-xl bg-slate-800', expandida ? 'h-full' : 'h-28')}>
            <div className="text-center">
              <span className="relative inline-block">
                <AvatarUsuario sala={conversa?.tipo === 'SALA'} id={conversa?.outroUsuarioId} nome={titulo} tamanho={expandida ? 'xl' : 'lg'} />
                <span className="absolute -inset-1 -z-10 animate-ping rounded-full bg-emerald-400/30" />
              </span>
              <p className="mt-2 text-xs text-slate-300">Esperando atender…</p>
            </div>
          </div>
        ) : (
          <div className={clsx('grid gap-2', expandida ? 'h-full' : '', pares.length === 1 ? 'grid-cols-1' : pares.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')} style={expandida ? { gridAutoRows: '1fr' } : undefined}>
            {pares.map((p) => (
              <Tile key={p.usuarioId} par={p} nome={nomeDe(p.usuarioId)} grande={expandida} />
            ))}
          </div>
        )}
        {estado.local && estado.cameraLigada && (
          <div className={clsx('absolute overflow-hidden rounded-lg border border-slate-600 bg-black shadow', expandida ? 'bottom-4 right-5 h-28 w-20 sm:h-36 sm:w-28' : 'bottom-2 right-4 h-16 w-12')}>
            <Video_ stream={estado.local} mudo espelhar />
          </div>
        )}
      </div>

      {estado.erro && <p className="px-3 pb-1 text-[11px] text-amber-300">{estado.erro}</p>}

      <div className="flex items-center justify-center gap-3 px-3 py-2.5">
        <button type="button" onClick={() => gerenciador?.alternarMudo()} className={clsx('flex h-11 w-11 items-center justify-center rounded-full', estado.mudo ? 'bg-white text-slate-900' : 'bg-white/15 hover:bg-white/25')} aria-label={estado.mudo ? 'Ativar microfone' : 'Silenciar microfone'} title={estado.mudo ? 'Microfone desligado' : 'Microfone ligado'}>
          {estado.mudo ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => void gerenciador?.alternarCamera()} className={clsx('flex h-11 w-11 items-center justify-center rounded-full', estado.cameraLigada ? 'bg-white text-slate-900' : 'bg-white/15 hover:bg-white/25')} aria-label={estado.cameraLigada ? 'Desligar câmera' : 'Ligar câmera'} title={estado.cameraLigada ? 'Câmera ligada' : 'Câmera desligada'}>
          {estado.cameraLigada ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        <button type="button" onClick={() => void sair(chamada.id)} className="flex h-11 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-700" aria-label="Desligar" title="Desligar">
          <PhoneOff className="h-5 w-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
