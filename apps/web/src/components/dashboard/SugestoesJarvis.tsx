/**
 * Bloco "Sugestões do JARVIS" — aparece no Meu Dashboard de cada perfil.
 * Vendedor e técnico nunca veem lucro nem caixa: a API já corta o impacto em R$ para eles.
 * No painel do gestor (/jarvis) a mesma lista aparece com os botões de decidir.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Bot, Check, ChevronRight, Clock, X } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { Button, Skeleton } from '@/components/ui';
import { CardV18, LinhaV18, listaVariants } from '@/components/dashboard/v18';
import { moeda } from '@/lib/format';

export interface SugestaoJarvis {
  id: number;
  regra: string;
  titulo: string;
  texto: string;
  prioridade: number;
  link?: string | null;
  impactoEstimado?: number | null;
  acao?: string | null;
  situacao?: string;
}

const CORES: Record<number, string> = {
  1: 'bg-rose-50 text-rose-700 ring-rose-200',
  2: 'bg-amber-50 text-amber-700 ring-amber-200',
  3: 'bg-sky-50 text-sky-700 ring-sky-200',
};
const URGENCIA: Record<number, string> = { 1: 'Agora', 2: 'Esta semana', 3: 'Quando der' };

export function CartaoSugestao({
  s,
  decidir,
  decidindo,
}: {
  s: SugestaoJarvis;
  decidir?: (id: number, o: 'aceitar' | 'adiar' | 'recusar') => void;
  decidindo?: boolean;
}) {
  const nav = useNavigate();
  const tom = CORES[s.prioridade] ?? CORES[3];
  return (
    <LinhaV18 bloco className="gap-2">
      <div className="flex w-full flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tom}`}>
              {URGENCIA[s.prioridade] ?? 'Quando der'}
            </span>
            <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{s.titulo}</p>
          </div>
          <p className="mt-1 break-words text-sm text-slate-600">{s.texto}</p>
        </div>
        {typeof s.impactoEstimado === 'number' && s.impactoEstimado > 0 && (
          <span className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-right text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
            {moeda(s.impactoEstimado)}
          </span>
        )}
      </div>

      <div className="flex w-full flex-wrap items-center gap-2">
        {s.link && (
          <Button variante="secundario" tamanho="sm" icone={<ChevronRight className="h-4 w-4" />} onClick={() => nav(s.link!)}>
            Abrir
          </Button>
        )}
        {decidir && (
          <>
            <Button
              variante="primario"
              tamanho="sm"
              icone={<Check className="h-4 w-4" />}
              carregando={decidindo}
              onClick={() => decidir(s.id, 'aceitar')}
            >
              {s.acao === 'COBRAR_WHATSAPP' ? 'Cobrar agora' : s.acao === 'AVISAR_PRONTO' ? 'Avisar que está pronto' : s.acao === 'DESCONTO_LOTE' ? 'Aplicar desconto' : 'Aceitar'}
            </Button>
            <Button variante="secundario" tamanho="sm" icone={<Clock className="h-4 w-4" />} onClick={() => decidir(s.id, 'adiar')}>
              Adiar
            </Button>
            <Button variante="secundario" tamanho="sm" icone={<X className="h-4 w-4" />} onClick={() => decidir(s.id, 'recusar')}>
              Recusar
            </Button>
          </>
        )}
      </div>
    </LinhaV18>
  );
}

/** Bloco para o Meu Dashboard de qualquer perfil (lê /jarvis/feed). */
export default function SugestoesJarvis({ titulo = 'Sugestões do JARVIS' }: { titulo?: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['jarvis-feed'],
    queryFn: () => api.get<{ data: SugestaoJarvis[] }>('/jarvis/feed'),
    refetchInterval: 60_000,
    retry: 0,
  });

  const decidir = useMutation({
    mutationFn: ({ id, o }: { id: number; o: 'aceitar' | 'adiar' | 'recusar' }) => api.post(`/jarvis/sugestoes/${id}/${o}`, {}),
    onSuccess: () => {
      toast.success('Anotado.');
      qc.invalidateQueries({ queryKey: ['jarvis-feed'] });
      qc.invalidateQueries({ queryKey: ['jarvis-painel'] });
    },
    onError: (e) => toast.error(mensagemErro(e)),
  });

  const lista = data?.data ?? [];
  if (!isLoading && lista.length === 0) return null; // sem sugestões, o bloco nem aparece

  return (
    <CardV18 titulo={titulo} descricao="O que mais aproxima a loja do objetivo agora" icone={<Bot className="h-4 w-4" />} tom="azul">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : (
        <motion.div variants={listaVariants} initial="oculto" animate="visivel" className="space-y-2">
          {lista.slice(0, 5).map((s) => (
            <CartaoSugestao key={s.id} s={s} />
          ))}
        </motion.div>
      )}
    </CardV18>
  );
}

