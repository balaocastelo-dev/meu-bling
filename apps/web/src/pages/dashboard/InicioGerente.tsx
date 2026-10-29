/**
 * Tela inicial da gerente — no estilo Power BI: saldo do banco e o que entra/sai hoje no topo,
 * depois os avisos mais importantes (caixinhas, contas, OS) e os atalhos do dia a dia.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Banknote, Clock, Landmark, PiggyBank, ShoppingCart, TriangleAlert, Wallet, Wrench } from 'lucide-react';
import { AvisosImportantes } from '@/components/compartilhados/AvisosImportantes';
import { Aparecer, FaixaKpis, KpiV18, PaginaV18, SaldosContas, SecaoDetalhes } from '@/components/dashboard/v18';
import { api } from '@/lib/api';
import { moeda } from '@/lib/format';
import type { ResumoFinanceiro } from '@/types';

const ATALHOS = [
  { para: '/vendas', rotulo: 'Pedidos de venda', icone: ShoppingCart },
  { para: '/ordens-servico', rotulo: 'Ordens de serviço', icone: Wrench },
  { para: '/financeiro/pagar', rotulo: 'Contas a pagar', icone: Banknote },
  { para: '/financeiro/receber', rotulo: 'Contas a receber', icone: Wallet },
  { para: '/financeiro/caixinhas', rotulo: 'Caixinhas', icone: PiggyBank },
];

export default function InicioGerente() {
  const nav = useNavigate();
  const { data: f, isLoading } = useQuery({
    queryKey: ['financeiro-resumo'],
    queryFn: () => api.get<ResumoFinanceiro>('/financeiro/resumo'),
    refetchInterval: 60_000,
    retry: 0,
  });

  return (
    <PaginaV18 className="space-y-4 pb-6 sm:space-y-5">
      <Aparecer>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Início</h1>
        <p className="text-sm text-slate-500">O que precisa de atenção hoje.</p>
      </Aparecer>

      {/* topo: saldo e o que vence hoje */}
      <FaixaKpis colunas={4}>
        <KpiV18
          destaque
          className="col-span-2"
          rotulo="Saldo em bancos + caixa"
          valor={f?.saldoTotal}
          formato={moeda}
          icone={<Landmark className="h-4 w-4" />}
          tom="verde"
          carregando={isLoading}
          sub="agora, somando todas as contas"
          onClick={() => nav('/financeiro/bancos')}
        />
        <KpiV18 rotulo="A receber hoje" valor={f?.receberHoje} formato={moeda} icone={<Clock className="h-4 w-4" />} tom="azul" carregando={isLoading} sub={f ? `na semana ${moeda(f.receberSemana)}` : undefined} onClick={() => nav('/financeiro/receber')} />
        <KpiV18 rotulo="A pagar hoje" valor={f?.pagarHoje} formato={moeda} icone={<Banknote className="h-4 w-4" />} tom="amarelo" carregando={isLoading} sub={f ? `na semana ${moeda(f.pagarSemana)}` : undefined} onClick={() => nav('/financeiro/pagar')} />
      </FaixaKpis>

      <SaldosContas contas={f?.saldoContas} carregando={isLoading} formato={moeda} onClick={() => nav('/financeiro/bancos')} />

      <FaixaKpis colunas={4}>
        <KpiV18 rotulo="Receber atrasado" valor={f?.receberAtrasado} formato={moeda} icone={<TriangleAlert className="h-4 w-4" />} tom={f && f.receberAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/receber?situacao=ATRASADO')} />
        <KpiV18 rotulo="Pagar atrasado" valor={f?.pagarAtrasado} formato={moeda} icone={<Wallet className="h-4 w-4" />} tom={f && f.pagarAtrasado > 0 ? 'vermelho' : 'neutro'} carregando={isLoading} onClick={() => nav('/financeiro/pagar')} />
      </FaixaKpis>

      <Aparecer>
        <AvisosImportantes />
      </Aparecer>

      <SecaoDetalhes titulo="Atalhos" />
      <Aparecer className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 lg:grid-cols-5">
        {ATALHOS.map((a) => (
          <Link key={a.para} to={a.para} className="v18-card v18-hover flex min-h-[52px] items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 text-sm font-medium text-slate-800 shadow-card sm:p-4">
            <a.icone className="h-5 w-5 shrink-0 text-brand-600" /> <span className="min-w-0 truncate">{a.rotulo}</span>
          </Link>
        ))}
      </Aparecer>
    </PaginaV18>
  );
}
