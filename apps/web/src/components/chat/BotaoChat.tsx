/** Ícone do chat no topo do sistema: contador de mensagens não lidas e estado da ligação em tempo real. */
import { Link, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { MessagesSquare } from 'lucide-react';
import { useChat } from '@/stores/chat';

export function BotaoChat() {
  const naoLidas = useChat((s) => s.naoLidas);
  const ligacao = useChat((s) => s.ligacao);
  const loc = useLocation();
  const ativo = loc.pathname.startsWith('/chat');
  const titulo = naoLidas ? `${naoLidas} ${naoLidas === 1 ? 'mensagem não lida' : 'mensagens não lidas'}` : 'Chat da equipe';
  return (
    <Link
      to="/chat"
      title={ligacao === 'polling' ? `${titulo} (ligação de reserva)` : titulo}
      aria-label={titulo}
      className={clsx('relative inline-flex h-10 w-10 items-center justify-center rounded-md transition hover:bg-slate-100 sm:h-9 sm:w-9', ativo ? 'text-brand-600' : 'text-slate-500')}
    >
      <MessagesSquare className="h-5 w-5" />
      {naoLidas > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">{naoLidas > 99 ? '99+' : naoLidas}</span>
      )}
      {ligacao === 'ligando' && <span className="absolute bottom-1 right-1.5 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />}
    </Link>
  );
}
