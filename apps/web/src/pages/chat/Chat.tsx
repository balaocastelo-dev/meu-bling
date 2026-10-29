/**
 * CHAT DA EQUIPE (29/10/2026) — caixa de entrada + conversa, no estilo WhatsApp Web.
 *   /chat         caixa de entrada (no celular, só a lista)
 *   /chat/:id     conversa aberta (no celular, só a conversa, com botão de voltar)
 * Qualquer funcionário fala com qualquer outro; todo mundo cria sala de reunião privada; o ADMIN
 * pode abrir e ler qualquer conversa (aba "Todas").
 */
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useChat } from '@/stores/chat';
import { ListaConversas } from './ListaConversas';
import { Conversa } from './Conversa';
import { MessagesSquare } from 'lucide-react';
import { EmptyState } from '@/components/ui';

export default function Chat() {
  const { id } = useParams();
  const conversaId = id ? Number(id) : null;
  const carregarColegas = useChat((s) => s.carregarColegas);
  const carregarConversas = useChat((s) => s.carregarConversas);
  const carregadas = useChat((s) => s.conversasCarregadas);

  useEffect(() => {
    void carregarColegas().catch(() => undefined);
    if (!carregadas) void carregarConversas().catch(() => undefined);
  }, [carregarColegas, carregarConversas, carregadas]);

  return (
    <div className="chat-altura flex min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card" data-motion>
      {/* lista: sempre no computador; no celular só quando não há conversa aberta */}
      <aside className={clsx('w-full min-w-0 shrink-0 flex-col border-slate-200 md:flex md:w-80 md:border-r lg:w-[22rem]', conversaId ? 'hidden' : 'flex')}>
        <ListaConversas conversaAtiva={conversaId} />
      </aside>
      <section className={clsx('min-w-0 flex-1 flex-col md:flex', conversaId ? 'flex' : 'hidden')}>
        {conversaId ? (
          <Conversa key={conversaId} conversaId={conversaId} />
        ) : (
          <div className="flex h-full items-center justify-center bg-slate-50/60 p-6">
            <EmptyState icone={<MessagesSquare className="h-5 w-5" />} titulo="Escolha uma conversa" descricao="Mande mensagem para alguém da equipe, grave um áudio ou abra uma sala de reunião com as pessoas que quiser. Chamadas de voz e vídeo saem daqui mesmo, só pelo navegador." />
          </div>
        )}
      </section>
    </div>
  );
}
