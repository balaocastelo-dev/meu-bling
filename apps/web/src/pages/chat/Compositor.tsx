/**
 * Caixa de escrever: texto (Enter envia, Shift+Enter quebra linha), anexar imagem/PDF, gravar áudio
 * (toca no microfone para começar, de novo para enviar; X cancela) e responder a uma mensagem.
 */
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Mic, Paperclip, Send, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChat } from '@/stores/chat';
import { avisarDigitando } from '@/lib/chat/realtime';
import { mensagemErro } from '@/lib/api';
import { somEnviado } from '@/lib/chat/som';
import type { Mensagem } from '@/lib/chat/tipos';
import { primeiroNome, resumoMensagem, tempoCurto } from '@/lib/chat/formato';

function formatoGravacao(): { mime: string; ext: string } {
  const opcoes = [
    { mime: 'audio/webm;codecs=opus', ext: 'webm' },
    { mime: 'audio/webm', ext: 'webm' },
    { mime: 'audio/mp4', ext: 'm4a' },
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  ];
  for (const o of opcoes) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(o.mime)) return o;
  return { mime: '', ext: 'webm' };
}

export function Compositor({ conversaId, respondendo, onLimparResposta, desabilitado }: { conversaId: number; respondendo: Mensagem | null; onLimparResposta: () => void; desabilitado?: boolean }) {
  const enviarTexto = useChat((s) => s.enviarTexto);
  const enviarArquivo = useChat((s) => s.enviarArquivo);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelarRef = useRef(false);
  const ultimoDigitando = useRef(0);
  const inicioGravacao = useRef(0);

  // altura do campo acompanha o texto (até ~6 linhas)
  useEffect(() => {
    const a = areaRef.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(a.scrollHeight, 160)}px`;
  }, [texto]);

  useEffect(() => {
    if (respondendo) areaRef.current?.focus();
  }, [respondendo]);

  const enviar = async () => {
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto('');
    const resp = respondendo?.id ?? null;
    onLimparResposta();
    try {
      await enviarTexto(conversaId, t, resp);
      somEnviado();
    } catch (e) {
      toast.error(mensagemErro(e));
    }
    areaRef.current?.focus();
  };

  const aoDigitar = (v: string) => {
    setTexto(v);
    const agora = Date.now();
    if (v && agora - ultimoDigitando.current > 2500) {
      ultimoDigitando.current = agora;
      avisarDigitando(conversaId);
    }
  };

  const escolherArquivo = async (lista: FileList | null) => {
    const f = lista?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast.error('Arquivo acima de 25 MB.');
    setEnviando(true);
    try {
      await enviarArquivo(conversaId, f, f.name, { respondeAId: respondendo?.id ?? null });
      onLimparResposta();
      somEnviado();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  };

  // ---------------------------------------------------------------- áudio
  const comecarGravacao = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast.error('Este navegador não grava áudio.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const { mime } = formatoGravacao();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48_000 } : undefined);
      pedacosRef.current = [];
      cancelarRef.current = false;
      rec.ondataavailable = (e) => e.data.size && pedacosRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const dur = Math.max(1, Math.round((Date.now() - inicioGravacao.current) / 1000));
        setGravando(false);
        if (cancelarRef.current || !pedacosRef.current.length) return;
        const tipo = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(pedacosRef.current, { type: tipo });
        if (blob.size < 500) return toast.error('O áudio ficou vazio. Tente de novo.');
        const ext = /mp4/.test(tipo) ? 'm4a' : /ogg/.test(tipo) ? 'ogg' : 'webm';
        setEnviando(true);
        void enviarArquivo(conversaId, blob, `audio.${ext}`, { audio: true, duracaoSeg: dur, respondeAId: respondendo?.id ?? null })
          .then(() => {
            onLimparResposta();
            somEnviado();
          })
          .catch((e) => toast.error(mensagemErro(e)))
          .finally(() => setEnviando(false));
      };
      rec.start(250);
      gravadorRef.current = rec;
      inicioGravacao.current = Date.now();
      setSegundos(0);
      setGravando(true);
    } catch (e) {
      const nome = (e as { name?: string })?.name;
      toast.error(nome === 'NotAllowedError' ? 'Libere o microfone no cadeado da barra de endereço.' : 'Não foi possível usar o microfone.');
    }
  };

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => {
      const s = Math.round((Date.now() - inicioGravacao.current) / 1000);
      setSegundos(s);
      if (s >= 300) pararGravacao(false); // máximo 5 min
    }, 500);
    return () => clearInterval(t);
  }, [gravando]); // eslint-disable-line react-hooks/exhaustive-deps

  const pararGravacao = (cancelar: boolean) => {
    cancelarRef.current = cancelar;
    const rec = gravadorRef.current;
    gravadorRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setGravando(false);
    }
  };

  useEffect(() => () => {
    // saiu da conversa no meio da gravação: descarta
    if (gravadorRef.current) {
      cancelarRef.current = true;
      gravadorRef.current.stop();
    }
  }, []);

  if (desabilitado) {
    return <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-center text-xs text-slate-500">Você não participa mais desta conversa.</div>;
  }

  return (
    <div className="border-t border-slate-100 bg-white px-2 pb-2 pt-2 sm:px-3" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
      {respondendo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-2 border-brand-500 bg-slate-50 px-3 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-slate-700">Respondendo a {respondendo.autor ? primeiroNome(respondendo.autor.nome) : 'mensagem'}</span>
            <span className="line-clamp-1 text-slate-500">{resumoMensagem(respondendo)}</span>
          </span>
          <button type="button" onClick={onLimparResposta} className="rounded p-0.5 text-slate-400 hover:bg-slate-200" aria-label="Cancelar resposta">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {gravando ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => pararGravacao(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Cancelar gravação" title="Cancelar">
            <X className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-red-50 px-3 py-2 text-sm text-red-700">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
            <span className="num font-semibold">{tempoCurto(segundos)}</span>
            <span className="truncate text-xs text-red-600/80">Gravando… toque em enviar quando terminar</span>
          </div>
          <button type="button" onClick={() => pararGravacao(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700" aria-label="Parar e enviar áudio" title="Enviar áudio">
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <input ref={arquivoRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void escolherArquivo(e.target.files)} />
          <button type="button" onClick={() => arquivoRef.current?.click()} disabled={enviando} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label="Anexar imagem ou PDF" title="Anexar imagem ou PDF">
            <Paperclip className="h-5 w-5" />
          </button>
          <textarea
            ref={areaRef}
            value={texto}
            onChange={(e) => aoDigitar(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            placeholder="Escreva uma mensagem"
            aria-label="Mensagem"
            className="input-base min-h-10 max-h-40 flex-1 resize-none rounded-2xl py-2.5 text-sm leading-5"
          />
          {texto.trim() ? (
            <button type="button" onClick={() => void enviar()} disabled={enviando} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50" aria-label="Enviar" title="Enviar (Enter)">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          ) : (
            <button type="button" onClick={() => void comecarGravacao()} disabled={enviando} className={clsx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-50', 'bg-brand-600 hover:bg-brand-700')} aria-label="Gravar áudio" title="Gravar áudio">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-5 w-5" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
