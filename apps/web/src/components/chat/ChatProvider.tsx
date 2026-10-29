/**
 * Liga o chat da equipe assim que há usuário logado (fica montado na casca do sistema):
 *   - conecta o tempo real (WebSocket / long polling);
 *   - mensagem nova fora da conversa aberta: som + toast (clicável) e, com a aba em segundo plano,
 *     notificação do navegador;
 *   - chamada recebida: toca e abre a janela de atender/recusar em qualquer tela;
 *   - chamada em andamento: janela flutuante com os controles, em qualquer tela do sistema.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { useChat } from '@/stores/chat';
import { desligarChat, ligarChat, ouvirChat } from '@/lib/chat/realtime';
import { registrarServiceWorker, notificarNavegador } from '@/lib/chat/pwa';
import { somMensagem } from '@/lib/chat/som';
import { resumoMensagem } from '@/lib/chat/formato';
import { ChamadaRecebida } from './ChamadaRecebida';
import { JanelaChamada } from './JanelaChamada';

export function ChatProvider() {
  const token = useAuth((s) => s.token);
  const usuarioId = useAuth((s) => s.usuario?.id);
  const nav = useNavigate();
  const navRef = useRef(nav);
  navRef.current = nav;

  useEffect(() => {
    if (!token) {
      desligarChat();
      return;
    }
    void ligarChat();
    void registrarServiceWorker();
    return () => desligarChat();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    return ouvirChat((e) => {
      if (e.tipo !== 'mensagem') return;
      const m = e.mensagem;
      if (m.autorId === usuarioId || m.tipo === 'SISTEMA') return;
      const st = useChat.getState();
      const conversa = st.conversas.find((c) => c.id === e.conversaId);
      if (conversa?.silenciadaAte && new Date(conversa.silenciadaAte) > new Date()) return;
      const aberta = st.conversaAberta === e.conversaId && document.visibilityState === 'visible';
      if (aberta) return;
      const quem = m.autor?.nome ?? 'Alguém';
      const titulo = conversa && conversa.tipo === 'SALA' ? `${quem} · ${conversa.nome}` : quem;
      const corpo = resumoMensagem(m);
      somMensagem();
      if (document.visibilityState === 'visible') {
        toast(titulo, {
          description: corpo,
          duration: 6000,
          action: { label: 'Abrir', onClick: () => navRef.current(`/chat/${e.conversaId}`) },
        });
      } else {
        void notificarNavegador(titulo, corpo, `/chat/${e.conversaId}`, `conversa-${e.conversaId}`);
      }
    });
  }, [token, usuarioId]);

  if (!token) return null;
  return (
    <>
      <ChamadaRecebida />
      <JanelaChamada />
    </>
  );
}
