/** Tela inicial da gerente: avisos mais importantes (caixinhas, contas, OS) e atalhos do dia a dia. */
import { Link } from 'react-router-dom';
import { Banknote, PiggyBank, ShoppingCart, Wallet, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { AvisosImportantes } from '@/components/compartilhados/AvisosImportantes';

const ATALHOS = [
  { para: '/vendas', rotulo: 'Pedidos de venda', icone: ShoppingCart },
  { para: '/ordens-servico', rotulo: 'Ordens de serviço', icone: Wrench },
  { para: '/financeiro/pagar', rotulo: 'Contas a pagar', icone: Banknote },
  { para: '/financeiro/receber', rotulo: 'Contas a receber', icone: Wallet },
  { para: '/financeiro/caixinhas', rotulo: 'Caixinhas', icone: PiggyBank },
];

export default function InicioGerente() {
  return (
    <div className="pb-6">
      <PageHeader titulo="Início" descricao="O que precisa de atenção hoje." />
      <AvisosImportantes className="mb-4" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ATALHOS.map((a) => (
          <Link key={a.para} to={a.para} className="v18-card v18-hover flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-sm font-medium text-slate-800 shadow-card">
            <a.icone className="h-5 w-5 text-brand-600" /> {a.rotulo}
          </Link>
        ))}
      </div>
    </div>
  );
}
