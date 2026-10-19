import { ArrowRight, History } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { dataHora } from '@/lib/format';
import type { HistoricoSituacao } from '@/types';

/** Timeline do histórico de situações de uma venda/OS/compra */
export function HistoricoSituacoes({ historico }: { historico?: HistoricoSituacao[] }) {
  if (!historico?.length) return <EmptyState compacto icone={<History className="h-5 w-5" />} titulo="Sem histórico" descricao="As mudanças de situação aparecerão aqui." />;
  const ordenado = [...historico].sort((a, b) => (a.data < b.data ? 1 : -1));
  return (
    <ol className="relative ml-2 border-l border-slate-200">
      {ordenado.map((h) => (
        <li key={h.id} className="mb-5 ml-5">
          <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {h.deSituacao ? (
              <>
                <span className="text-slate-500">{h.deSituacao}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              </>
            ) : null}
            <span className="font-medium text-slate-800">{h.paraSituacao}</span>
          </div>
          <p className="text-xs text-slate-400">
            {dataHora(h.data)}
            {h.usuario?.nome ? ` · ${h.usuario.nome}` : ''}
          </p>
          {h.observacao && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{h.observacao}</p>}
        </li>
      ))}
    </ol>
  );
}
