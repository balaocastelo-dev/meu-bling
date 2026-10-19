import { useQuery } from '@tanstack/react-query';
import { Bell, Mail, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, EmptyState, Skeleton, tomPorStatus } from '@/components/ui';
import { dataHora, rotulo, truncar } from '@/lib/format';
import type { Notificacao, Paginado } from '@/types';

/** Lista de notificações vinculadas a uma entidade (aba "Notificações" de venda/OS) */
export function NotificacoesLista({ origemTipo, origemId }: { origemTipo: string; origemId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['notificacoes', origemTipo, origemId],
    queryFn: () => api.get<Paginado<Notificacao>>('/notificacoes', { origemTipo, origemId, limite: 50 }).catch(() => ({ data: [] as Notificacao[], meta: { total: 0, pagina: 1, limite: 50, totalPaginas: 0 } })),
  });
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data?.data.length) return <EmptyState compacto icone={<Bell className="h-5 w-5" />} titulo="Nenhuma notificação enviada" descricao="Use o botão “Enviar WhatsApp/E-mail” para notificar o cliente." />;
  return (
    <ul className="divide-y divide-slate-100">
      {data.data.map((n) => (
        <li key={n.id} className="flex items-start gap-3 py-2.5">
          <span className="mt-0.5 text-slate-400">{n.canal === 'WHATSAPP' ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-800">{n.destinatario}</span>
              <Badge tom={tomPorStatus(n.status)}>{rotulo(n.status)}</Badge>
              <span className="text-xs text-slate-400">{dataHora(n.enviadaEm || n.criadoEm)}</span>
            </div>
            {n.assunto && <p className="text-xs text-slate-600">{n.assunto}</p>}
            <p className="mt-0.5 whitespace-pre-line text-xs text-slate-500">{truncar(n.corpo, 220)}</p>
            {n.erro && <p className="mt-0.5 text-xs text-red-600">{n.erro}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
