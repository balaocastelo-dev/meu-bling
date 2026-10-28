/** Avisos mais importantes do gestor e da gerente: caixinhas no prazo, contas vencidas, OS atrasadas. */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, ChevronRight, Info, PiggyBank } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui';
import { moeda } from '@/lib/format';

interface Avisos {
  avisos: { tipo: 'erro' | 'aviso' | 'info'; mensagem: string; link: string }[];
  sugestaoHojeTotal: number;
  caixinhas: { id: number; nome: string; situacao: string }[];
}

export function AvisosImportantes({ className }: { className?: string }) {
  const { data } = useQuery({ queryKey: ['avisos'], queryFn: () => api.get<Avisos>('/avisos'), refetchInterval: 120_000 });
  if (!data || (!data.avisos.length && !data.caixinhas.length)) return null;
  const icone = (t: string) => (t === 'erro' ? <AlertOctagon className="h-4 w-4 text-red-600" /> : t === 'aviso' ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <Info className="h-4 w-4 text-sky-600" />);
  return (
    <Card
      className={clsx('border-amber-200', className)}
      titulo="Avisos importantes"
      descricao={data.sugestaoHojeTotal > 0 ? `Hoje: guardar ${moeda(data.sugestaoHojeTotal)} nas caixinhas` : 'O que precisa de atenção hoje'}
      acoes={
        <Link to="/financeiro/caixinhas" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          <PiggyBank className="h-3.5 w-3.5" /> Caixinhas
        </Link>
      }
      semPadding
    >
      {data.avisos.length ? (
        <ul className="divide-y divide-slate-100">
          {data.avisos.map((a, i) => (
            <li key={i}>
              <Link to={a.link} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50">
                {icone(a.tipo)}
                <span className={clsx('flex-1', a.tipo === 'erro' ? 'font-medium text-red-800' : 'text-slate-700')}>{a.mensagem}</span>
                <ChevronRight className="h-4 w-4 text-slate-300" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-emerald-700">Tudo em dia. Caixinhas no prazo e nenhuma conta vencida.</p>
      )}
    </Card>
  );
}
