/** Tela inicial da gerente: avisos mais importantes (caixinhas, contas, OS) e atalhos do dia a dia — no padrão dos dashboards. */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Banknote, ChevronRight, PiggyBank, ShoppingCart, Wallet, Wrench } from 'lucide-react';
import { AvisosImportantes } from '@/components/compartilhados/AvisosImportantes';
import { Aparecer, CabecalhoV18, Grupo, PaginaV18, SecaoV18, TONS, type Tom } from '@/components/dashboard/v18';
import clsx from 'clsx';

const ATALHOS: { para: string; rotulo: string; icone: typeof Wallet; tom: Tom }[] = [
  { para: '/vendas', rotulo: 'Pedidos de venda', icone: ShoppingCart, tom: 'azul' },
  { para: '/ordens-servico', rotulo: 'Ordens de serviço', icone: Wrench, tom: 'vermelho' },
  { para: '/financeiro/pagar', rotulo: 'Contas a pagar', icone: Banknote, tom: 'amarelo' },
  { para: '/financeiro/receber', rotulo: 'Contas a receber', icone: Wallet, tom: 'verde' },
  { para: '/financeiro/caixinhas', rotulo: 'Caixinhas', icone: PiggyBank, tom: 'neutro' },
];

export default function InicioGerente() {
  const hojeExtenso = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <PaginaV18 className="space-y-4 pb-6">
      <CabecalhoV18 sobre={hojeExtenso.charAt(0).toUpperCase() + hojeExtenso.slice(1)} titulo="Início" descricao="O que precisa de atenção hoje." />
      <Aparecer>
        <AvisosImportantes />
      </Aparecer>
      <SecaoV18 titulo="Atalhos" />
      <Grupo className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {ATALHOS.map((a) => (
          <motion.div key={a.para} variants={{ oculto: { opacity: 0, y: 14 }, visivel: { opacity: 1, y: 0 } }} whileHover={{ y: -4 }} className="min-w-0">
            <Link to={a.para} className="relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 text-sm font-medium text-slate-800 shadow-card sm:p-4">
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: TONS[a.tom].barra, opacity: 0.85 }} />
              <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', TONS[a.tom].chip)}>
                <a.icone className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">{a.rotulo}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          </motion.div>
        ))}
      </Grupo>
    </PaginaV18>
  );
}
