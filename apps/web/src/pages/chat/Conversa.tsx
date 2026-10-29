/** Conversa aberta: cabeçalho (presença, chamadas, informações), mensagens por dia, "digitando…" e a caixa de escrever. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, ChevronDown, Info, Loader2, Phone, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import { mensagemErro } from '@/lib/api';
import { mesmoDia, rotuloDia, primeiroNome } from '@/lib/chat/formato';
import { navegadorSuportaChamada } from '@/lib/chat/webrtc';
import type { Mensagem } from '@/lib/chat/tipos';
import { AvatarUsuario, ROTULO_PRESENCA } from '@/components/chat/AvatarUsuario';
import { Balao } from './Balao';
import { Compositor } from './Compositor';
import { InfoConversa } from './InfoConversa';

export function Conversa({ conversaId }: { conversaId: number }) {
  const nav = useNavigate();
  const eu = useAuth((s) => s.usuario);
  const conversa = useChat((s) => s.conversas.find((c) => c.id === conversaId) ?? s.todas.find((c) => c.id === conversaId));
  const mensagens = useChat((s) => s.mensagens[conversaId]);
  const fim = useChat((s) => s.fimHistorico[conversaId]);
  const digitando = useChat((s) => s.digitando[conversaId]);
  const chamadaAtiva = useChat((s) => s.chamadaAtiva);
  const carregarConversa = useChat((s) => s.carregarConversa);
  const carregarMensagens = useChat((s) => s.carregarMensagens);
  const setConversaAberta = useChat((s) => s.setConversaAberta);
  const marcarLida = useChat((s) => s.marcarLida);
  const apagarMensagem = useChat((s) => s.apagarMensagem);
  const iniciarChamada = useChat((s) => s.iniciarChamada);
  const [carregando, setCarregando] = useState(!mensagens);
  const [erro, setErro] = useState<string | null>(null);
  const [maisAntigas, setMaisAntigas] = useState(false);
  const [respondendo, setRespondendo] = useState<Mensagem | null>(null);
  const [info, setInfo] = useState(false);
  const [noFim, setNoFim] = useState(true);
  const [, setTick] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const alturaAntes = useRef(0);

  // abre a conversa: carrega dados e histórico; marca como aberta (não avisa das mensagens dela)
  useEffect(() => {
    let vivo = true;
    setConversaAberta(conversaId);
    setErro(null);
    (async () => {
      try {
        await carregarConversa(conversaId);
        await carregarMensagens(conversaId);
        if (vivo) void marcarLida(conversaId);
      } catch (e) {
        if (vivo) setErro(mensagemErro(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
      setConversaAberta(null);
    };
  }, [conversaId, carregarConversa, carregarMensagens, marcarLida, setConversaAberta]);

  // voltou para a aba: marca lidas
  useEffect(() => {
    const h = () => document.visibilityState === 'visible' && void marcarLida(conversaId);
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, [conversaId, marcarLida]);

  // rola para o fim quando chega mensagem e eu já estava no fim
  const total = mensagens?.length ?? 0;
  const ultimaId = total ? mensagens![total - 1].id : 0;
  useEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    if (alturaAntes.current) {
      // carregou mensagens antigas: mantém a posição
      el.scrollTop += el.scrollHeight - alturaAntes.current;
      alturaAntes.current = 0;
      return;
    }
    if (noFim || mensagens?.[total - 1]?.autorId === eu?.id) fimRef.current?.scrollIntoView({ block: 'end' });
  }, [ultimaId, total, carregando]); // eslint-disable-line react-hooks/exhaustive-deps

  // "digitando…" some sozinho
  useEffect(() => {
    if (!digitando?.length) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [digitando]);

  const aoRolar = useCallback(async () => {
    const el = listaRef.current;
    if (!el) return;
    const distanciaFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNoFim(distanciaFim < 80);
    if (el.scrollTop < 60 && !fim && !maisAntigas && (mensagens?.length ?? 0) >= 50) {
      setMaisAntigas(true);
      alturaAntes.current = el.scrollHeight;
      try {
        await carregarMensagens(conversaId, true);
      } finally {
        setMaisAntigas(false);
      }
    }
  }, [conversaId, fim, maisAntigas, mensagens?.length, carregarMensagens]);

  const porId = useMemo(() => new Map((mensagens ?? []).map((m) => [m.id, m])), [mensagens]);
  const outros = conversa?.participantes.filter((p) => p.id !== eu?.id) ?? [];
  const outro = conversa?.tipo === 'DIRETA' ? outros[0] : null;
  const minLidaOutros = outros.length ? Math.min(...outros.map((p) => p.lidaAteId)) : 0;
  const agora = Date.now();
  const digitandoNomes = (digitando ?? []).filter((d) => d.ate > agora).map((d) => primeiroNome(d.nome));
  const podeFalar = !!conversa?.souParticipante;

  const ligar = async (tipo: 'VOZ' | 'VIDEO') => {
    if (!navegadorSuportaChamada()) return toast.error('Chamadas precisam de HTTPS e de um navegador com microfone (Chrome, Edge, Safari ou Firefox).');
    if (chamadaAtiva) return toast.error('Você já está numa chamada. Desligue antes de começar outra.');
    try {
      await iniciarChamada(conversaId, tipo);
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const apagar = async (m: Mensagem) => {
    if (!confirm('Apagar esta mensagem para todo mundo?')) return;
    try {
      await apagarMensagem(m.id);
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  const subtitulo = conversa
    ? conversa.tipo === 'DIRETA'
      ? outro
        ? outro.online
          ? ROTULO_PRESENCA[outro.estado]
          : 'Offline'
        : 'Conversa'
      : `${conversa.participantes.length} pessoas · ${conversa.participantes.filter((p) => p.online).length} online`
    : '';

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-col bg-slate-50/60">
      {/* cabeçalho */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 bg-white px-2 py-2 sm:px-3">
        <button type="button" onClick={() => nav('/chat')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 md:hidden" aria-label="Voltar">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => setInfo(true)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1 py-0.5 text-left hover:bg-slate-50">
          <AvatarUsuario id={conversa?.outroUsuarioId ?? conversaId} nome={conversa?.nome} sala={conversa?.tipo === 'SALA'} presenca={outro ? (outro.online ? outro.estado : null) : null} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900">{conversa?.nome ?? '…'}</span>
            <span className="block truncate text-[11px] text-slate-500">{digitandoNomes.length ? <span className="text-emerald-600">{digitandoNomes.join(', ')} {digitandoNomes.length > 1 ? 'estão' : 'está'} digitando…</span> : subtitulo}</span>
          </span>
        </button>
        {podeFalar && (
          <>
            <button type="button" onClick={() => void ligar('VOZ')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-emerald-50 hover:text-emerald-700" aria-label="Chamada de voz" title="Chamada de voz">
              <Phone className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => void ligar('VIDEO')} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-emerald-50 hover:text-emerald-700" aria-label="Chamada de vídeo" title="Chamada de vídeo">
              <Video className="h-5 w-5" />
            </button>
          </>
        )}
        <button type="button" onClick={() => setInfo(true)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="Informações da conversa" title="Informações">
          <Info className="h-5 w-5" />
        </button>
      </div>

      {/* mensagens */}
      <div ref={listaRef} onScroll={() => void aoRolar()} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-3 sm:px-2">
        {erro ? (
          <p className="px-4 py-6 text-center text-sm text-red-600">{erro}</p>
        ) : carregando ? (
          <div className="flex justify-center py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            {maisAntigas && (
              <div className="flex justify-center py-2 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {fim && total > 0 && <p className="py-2 text-center text-[11px] text-slate-400">Início da conversa</p>}
            {total === 0 && <p className="py-10 text-center text-sm text-slate-400">Nenhuma mensagem ainda. Diga oi 👋</p>}
            {(mensagens ?? []).map((m, i) => {
              const anterior = i > 0 ? mensagens![i - 1] : null;
              const novoDia = !anterior || !mesmoDia(anterior.criadoEm, m.criadoEm);
              const mesmoAutor = !!anterior && anterior.autorId === m.autorId && anterior.tipo !== 'SISTEMA' && anterior.tipo !== 'CHAMADA' && !novoDia;
              const minha = m.autorId === eu?.id;
              return (
                <div key={m.id} className={clsx(mesmoAutor ? 'mt-0.5' : 'mt-2.5')}>
                  {novoDia && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] font-medium text-slate-600">{rotuloDia(m.criadoEm)}</span>
                    </div>
                  )}
                  <Balao
                    m={m}
                    minha={minha}
                    mostrarAutor={conversa?.tipo === 'SALA' && !mesmoAutor}
                    lidaPorTodos={minha && m.id > 0 && minLidaOutros >= m.id}
                    respondida={m.respondeAId ? porId.get(m.respondeAId) ?? null : null}
                    onResponder={() => setRespondendo(m)}
                    onApagar={() => void apagar(m)}
                    podeApagar={minha || eu?.perfil === 'ADMIN'}
                  />
                </div>
              );
            })}
            <div ref={fimRef} />
          </>
        )}
      </div>
      {!noFim && total > 0 && (
        <button type="button" onClick={() => fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })} className="absolute bottom-20 right-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-pop hover:bg-slate-50" aria-label="Ir para o fim">
          <ChevronDown className="h-5 w-5" />
        </button>
      )}

      <Compositor conversaId={conversaId} respondendo={respondendo} onLimparResposta={() => setRespondendo(null)} desabilitado={!!conversa && !podeFalar} />

      {conversa && <InfoConversa aberto={info} onFechar={() => setInfo(false)} conversa={conversa} />}
    </div>
  );
}
