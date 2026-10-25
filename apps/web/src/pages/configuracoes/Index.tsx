import { Link } from 'react-router-dom';
import { ChevronRight, Settings } from 'lucide-react';
import { CONFIG_ITENS, podeVer } from '@/components/layout/menu';
import { useAuth } from '@/stores/auth';
import { PageHeader } from '@/components/ui';

/** Índice das configurações */
export default function ConfigIndex() {
  const perfil = useAuth((s) => s.usuario?.perfil);
  return (
    <div>
      <PageHeader titulo="Configurações" descricao="Empresa, fiscal, usuários, situações, integrações e migração." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CONFIG_ITENS.filter((i) => podeVer(perfil, i.perfis)).map((i) => (
          <Link key={i.para} to={i.para} className="group flex items-center gap-3 v18-card v18-hover rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500 group-hover:bg-brand-50 group-hover:text-brand-600"><Settings className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-800">{i.rotulo}</span>
              <span className="block truncate text-xs text-slate-400">{i.descricao}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500" />
          </Link>
        ))}
      </div>
    </div>
  );
}
