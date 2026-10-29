/** Chamada chegando: toca, vibra e mostra atender/recusar em qualquer tela do sistema. */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useChat } from '@/stores/chat';
import { iniciarToque, pararToque } from '@/lib/chat/som';
import { notificarNavegador } from '@/lib/chat/pwa';
import { mensagemErro } from '@/lib/api';
import { AvatarUsuario } from './AvatarUsuario';
import { navegadorSuportaChamada } from '@/lib/chat/webrtc';

export function ChamadaRecebida() {
  const chamada = useChat((s) => s.chamadaRecebida);
  const conversas = useChat((s) => s.conversas);
  const atender = useChat((s) => s.atenderChamada);
  const recusar = useChat((s) => s.recusarChamada);
  const conversa = chamada ? conversas.find((c) => c.id === chamada.conversaId) : null;
  const quem = chamada?.iniciadoPor?.nome ?? 'Alguém';
  const titulo = conversa?.tipo === 'SALA' ? `${quem} · ${conversa.nome}` : quem;

  useEffect(() => {
    if (!chamada) {
      pararToque();
      return;
    }
    iniciarToque();
    if (document.visibilityState !== 'visible') void notificarNavegador(`📞 ${chamada.tipo === 'VIDEO' ? 'Chamada de vídeo' : 'Chamada de voz'}`, `${titulo} está chamando você`, `/chat/${chamada.conversaId}`, `chamada-${chamada.id}`);
    return () => pararToque();
  }, [chamada, titulo]);

  const aoAtender = async () => {
    if (!chamada) return;
    if (!navegadorSuportaChamada()) {
      toast.error('Este navegador não suporta chamadas (precisa de HTTPS e microfone).');
      return;
    }
    try {
      await atender(chamada.id);
    } catch (e) {
      toast.error(mensagemErro(e));
    }
  };

  return createPortal(
    <AnimatePresence>
      {chamada && (
        <motion.div
          key={chamada.id}
          initial={{ opacity: 0, y: -24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          className="fixed inset-x-2 z-[70] mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-pop sm:inset-x-auto sm:right-4"
          style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}
          role="alertdialog"
          aria-label="Chamada recebida"
        >
          <div className="flex items-center gap-3">
            <span className="relative">
              <AvatarUsuario id={chamada.iniciadoPorId} nome={quem} tamanho="lg" />
              <span className="absolute -inset-1 -z-10 animate-ping rounded-full bg-emerald-400/40" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{titulo}</p>
              <p className="flex items-center gap-1 text-xs text-slate-500">
                {chamada.tipo === 'VIDEO' ? <Video className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
                {chamada.tipo === 'VIDEO' ? 'Chamada de vídeo' : 'Chamada de voz'} chegando…
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void recusar(chamada.id)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-700">
              <PhoneOff className="h-4 w-4" /> Recusar
            </button>
            <button type="button" onClick={aoAtender} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700">
              {chamada.tipo === 'VIDEO' ? <Video className="h-4 w-4" /> : <Phone className="h-4 w-4" />} Atender
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
