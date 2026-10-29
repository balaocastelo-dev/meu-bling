/**
 * Card "Mensagens da equipe" do Meu Dashboard: as conversas com mensagem nova para você, com quem mandou,
 * o resumo e a hora. Some quando não há nada não lido (o sino do topo continua contando).
 */
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronRight, MessagesSquare } from 'lucide-react';
import { Card } from '@/components/ui';
import { useChat } from '@/stores/chat';
import { horaRelativa, resumoMensagem, primeiroNome } from '@/lib/chat/formato';
import { AvatarUsuario } from './AvatarUsuario';

export function MensagensCard({ className }: { className?: string }) {
  const conversas = useChat((s) => s.conversas);
  const pendentes = conversas.filter((c) => c.naoLidas > 0).slice(0, 8);
  if (!pendentes.length) return null;
  const total = conversas.reduce((t, c) => t + (c.naoLidas || 0), 0);
  return (
    <Card
      className={clsx('border-brand-100', className)}
      titulo={
        <span className="flex items-center gap-2">
          <MessagesSquare className="h-4 w-4 text-brand-600" /> Mensagens da equipe
        </span>
      }
      descricao={`${total} ${total === 1 ? 'mensagem nova' : 'mensagens novas'} para você`}
      acoes={
        <Link to="/chat" className="text-xs font-medium text-brand-700 hover:underline">
          Abrir chat
        </Link>
      }
      semPadding
    >
      <ul className="divide-y divide-slate-100">
        {pendentes.map((c) => {
          const m = c.ultimaMensagem;
          const quem = c.tipo === 'SALA' && m?.autor ? `${primeiroNome(m.autor.nome)}: ` : '';
          return (
            <li key={c.id}>
              <Link to={`/chat/${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <AvatarUsuario id={c.outroUsuarioId ?? c.id} nome={c.nome} sala={c.tipo === 'SALA'} presenca={c.tipo === 'DIRETA' ? c.participantes.find((p) => p.id === c.outroUsuarioId)?.estado ?? null : null} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{c.nome}</span>
                    <span className="shrink-0 text-[11px] text-slate-400 num">{horaRelativa(c.ultimaMensagemEm)}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {quem}
                    {resumoMensagem(m)}
                  </span>
                </span>
                <span className="min-w-[20px] rounded-full bg-brand-600 px-1.5 text-center text-[11px] font-bold leading-5 text-white">{c.naoLidas}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
