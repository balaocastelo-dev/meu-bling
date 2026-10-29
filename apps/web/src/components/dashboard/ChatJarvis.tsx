/**
 * Chat do JARVIS — a conversa com fio.
 * O gestor vai pedindo as coisas em sequência e o JARVIS lembra do que já foi dito,
 * com os números da loja na mão a cada resposta. Dá para ter várias conversas e retomar.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Bot, MessageSquarePlus, Send, Trash2, User } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, EmptyState, Skeleton } from '@/components/ui';
import { CardV18 } from '@/components/dashboard/v18';
import { dataHora } from '@/lib/format';

interface Mensagem {
  id: number;
  papel: 'usuario' | 'jarvis' | string;
  texto: string;
  em: string;
}
interface ResumoConversa {
  id: number;
  titulo: string;
  atualizadaEm: string;
  mensagens: number;
}

const EXEMPLOS = [
  'O que faço com o dinheiro que entrou hoje?',
  'Vale a pena quitar os empréstimos agora?',
  'Onde estou perdendo margem?',
];

export default function ChatJarvis() {
  const qc = useQueryClient();
  const [conversaId, setConversaId] = useState<number | null>(null);
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);

  const { data: conversas } = useQuery({
    queryKey: ['jarvis-conversas'],
    queryFn: () => api.get<{ data: ResumoConversa[] }>('/jarvis/conversas'),
    retry: 0,
  });

  const { data: conversa, isLoading } = useQuery({
    queryKey: ['jarvis-conversa', conversaId],
    queryFn: () => api.get<{ id: number; titulo: string; mensagens: Mensagem[] }>(`/jarvis/conversas/${conversaId}`),
    enabled: !!conversaId,
    retry: 0,
  });

  const mensagens = conversa?.mensagens ?? [];

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [mensagens.length]);

  const enviar = useMutation({
    mutationFn: (pergunta: string) =>
      api.post<{ conversaId: number; resposta: string }>('/jarvis/perguntar', { pergunta, conversaId }),
    onSuccess: (r) => {
      setTexto('');
      setConversaId(r.conversaId);
      qc.invalidateQueries({ queryKey: ['jarvis-conversa', r.conversaId] });
      qc.invalidateQueries({ queryKey: ['jarvis-conversas'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: (id: number) => api.del(`/jarvis/conversas/${id}`),
    onSuccess: () => {
      setConversaId(null);
      qc.invalidateQueries({ queryKey: ['jarvis-conversas'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const mandar = () => {
    const p = texto.trim();
    if (p.length < 3 || enviar.isPending) return;
    enviar.mutate(p);
  };

  return (
    <CardV18
      titulo="Conversar com o JARVIS"
      descricao="Ele responde com os números da loja e lembra do que já foi dito"
      icone={<Bot className="h-4 w-4" />}
      tom="azul"
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          {(conversas?.data?.length ?? 0) > 0 && (
            <select
              className="h-8 max-w-[14rem] rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-700"
              value={conversaId ?? ''}
              onChange={(e) => setConversaId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Conversa nova</option>
              {conversas!.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.titulo}
                </option>
              ))}
            </select>
          )}
          {conversaId && (
            <>
              <Button variante="secundario" tamanho="sm" icone={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setConversaId(null)}>
                Nova
              </Button>
              <Button
                variante="secundario"
                tamanho="sm"
                icone={<Trash2 className="h-4 w-4" />}
                carregando={apagar.isPending}
                onClick={() => apagar.mutate(conversaId)}
              >
                Apagar
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="flex max-h-[26rem] min-h-[12rem] flex-col gap-3 overflow-y-auto pr-1">
        {isLoading && conversaId ? (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        ) : mensagens.length === 0 ? (
          <EmptyState
            compacto
            titulo="Pergunte o que quiser sobre a loja"
            descricao="Ele enxerga caixa, contas, estoque, consignados e empréstimos — e responde com os números."
          />
        ) : (
          mensagens.map((m) => <Balao key={m.id} m={m} />)
        )}
        {enviar.isPending && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Bot className="h-4 w-4 animate-pulse" /> JARVIS está pensando…
          </div>
        )}
        <div ref={fim} />
      </div>

      {mensagens.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXEMPLOS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => enviar.mutate(e)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          className="min-h-[2.5rem] max-h-32 min-w-0 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              mandar();
            }
          }}
          placeholder="Pergunte alguma coisa… (Enter manda, Shift+Enter pula linha)"
        />
        <Button
          variante="primario"
          icone={<Send className="h-4 w-4" />}
          carregando={enviar.isPending}
          disabled={texto.trim().length < 3}
          onClick={mandar}
        >
          Mandar
        </Button>
      </div>
    </CardV18>
  );
}

function Balao({ m }: { m: Mensagem }) {
  const meu = m.papel === 'usuario';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2 ${meu ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          meu ? 'bg-slate-200 text-slate-600' : 'bg-brand-100 text-brand-700'
        }`}
      >
        {meu ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`min-w-0 max-w-[85%] ${meu ? 'text-right' : ''}`}>
        <div
          className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${
            meu ? 'bg-brand-600 text-white' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
          }`}
        >
          {m.texto}
        </div>
        <p className="mt-0.5 text-[11px] text-slate-400">{dataHora(m.em)}</p>
      </div>
    </motion.div>
  );
}
