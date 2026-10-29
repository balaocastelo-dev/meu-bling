/**
 * Áudios, imagens e arquivos do chat ficam em /uploads/chat/* e exigem login. Aqui o arquivo é baixado com o
 * token (Authorization) e vira um objeto local — assim o player e a imagem funcionam em qualquer navegador,
 * sem depender de cookie, e o arquivo fica em cache durante a sessão.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Download, FileText, Loader2, Pause, Play } from 'lucide-react';
import { urlUpload } from '@/lib/api';
import { useAuth } from '@/stores/auth';

const cache = new Map<string, Promise<string>>();

/** Baixa um arquivo protegido do storage com o token da sessão. */
export async function baixarProtegido(caminho: string): Promise<Blob> {
  const token = useAuth.getState().token ?? '';
  const r = await fetch(urlUpload(caminho), { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Arquivo indisponível (${r.status})`);
  return r.blob();
}

export function usarArquivoProtegido(caminho: string | null | undefined, ativo = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!caminho || !ativo) return;
    let vivo = true;
    let p = cache.get(caminho);
    if (!p) {
      p = baixarProtegido(caminho).then((b) => URL.createObjectURL(b));
      cache.set(caminho, p);
      p.catch(() => cache.delete(caminho));
    }
    p.then((u) => vivo && setUrl(u)).catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [caminho, ativo]);
  return { url, erro };
}

function tempo(seg: number) {
  const s = Math.max(0, Math.round(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Player de áudio no estilo mensagem de voz: tocar/pausar, barra e tempo. */
export function PlayerAudio({ caminho, duracaoSeg, escuro }: { caminho: string; duracaoSeg?: number | null; escuro?: boolean }) {
  const [quero, setQuero] = useState(false);
  const { url, erro } = usarArquivoProtegido(caminho, quero);
  const ref = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(duracaoSeg ?? 0);

  useEffect(() => {
    if (url && quero && ref.current) void ref.current.play().catch(() => undefined);
  }, [url, quero]);

  const alternar = () => {
    if (!quero) {
      setQuero(true);
      return;
    }
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => undefined);
    else a.pause();
  };
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const cor = escuro ? 'text-white' : 'text-slate-700';
  return (
    <div className={clsx('flex w-56 max-w-full items-center gap-2', cor)}>
      <button type="button" onClick={alternar} aria-label={tocando ? 'Pausar' : 'Tocar áudio'} className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', escuro ? 'bg-white/20 hover:bg-white/30' : 'bg-slate-200 hover:bg-slate-300')}>
        {quero && !url && !erro ? <Loader2 className="h-4 w-4 animate-spin" /> : tocando ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div
          className={clsx('relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full', escuro ? 'bg-white/25' : 'bg-slate-200')}
          onClick={(e) => {
            const a = ref.current;
            if (!a || !dur) return;
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            a.currentTime = ((e.clientX - r.left) / r.width) * dur;
          }}
        >
          <div className={clsx('absolute inset-y-0 left-0 rounded-full', escuro ? 'bg-white' : 'bg-brand-600')} style={{ width: `${pct}%` }} />
        </div>
        <p className={clsx('mt-1 text-[11px] num', escuro ? 'text-white/80' : 'text-slate-500')}>{erro ? 'Áudio indisponível' : `${tempo(tocando || pos > 0 ? pos : 0)} / ${tempo(dur)}`}</p>
      </div>
      {url && (
        <audio
          ref={ref}
          src={url}
          preload="metadata"
          onPlay={() => setTocando(true)}
          onPause={() => setTocando(false)}
          onEnded={() => {
            setTocando(false);
            setPos(0);
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDur(e.currentTarget.duration)}
        />
      )}
    </div>
  );
}

/** Imagem do chat (abre em tamanho maior ao clicar). */
export function ImagemChat({ caminho, nome }: { caminho: string; nome?: string | null }) {
  const { url, erro } = usarArquivoProtegido(caminho);
  if (erro) return <p className="text-xs text-red-200">Imagem indisponível</p>;
  if (!url) return <div className="skeleton h-40 w-56 max-w-full rounded-lg" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt={nome || 'Imagem'} className="max-h-72 max-w-full rounded-lg object-contain" />
    </a>
  );
}

/** Arquivo (PDF e outros): nome + botão de baixar. */
export function ArquivoChat({ caminho, nome, tamanho, escuro }: { caminho: string; nome?: string | null; tamanho?: number | null; escuro?: boolean }) {
  const [baixando, setBaixando] = useState(false);
  const baixar = async () => {
    setBaixando(true);
    try {
      const b = await baixarProtegido(caminho);
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u;
      a.download = nome || 'arquivo';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 10_000);
    } catch {
      /* arquivo indisponível: nada a fazer além de não travar */
    } finally {
      setBaixando(false);
    }
  };
  const kb = tamanho ? (tamanho > 1024 * 1024 ? `${(tamanho / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(tamanho / 1024))} KB`) : '';
  return (
    <button type="button" onClick={baixar} className={clsx('flex max-w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm', escuro ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
      <FileText className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{nome || 'Arquivo'}</span>
        {kb && <span className={clsx('block text-[11px]', escuro ? 'text-white/70' : 'text-slate-500')}>{kb}</span>}
      </span>
      {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 shrink-0 opacity-70" />}
    </button>
  );
}
