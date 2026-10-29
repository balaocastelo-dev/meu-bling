/**
 * MEU DASHBOARD — a tela inicial de todo mundo (29/10/2026).
 * Cada perfil abre a sua versão: vendedor, técnico, gerente/financeiro e gestor (ADMIN = o dashboard completo).
 * O gestor e a gerente podem "ver como" alguém da equipe (?como=<usuarioId>) — abre exatamente o que a pessoa vê.
 * Filtro de período completo, abrindo sempre em "Hoje".
 */
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { api, mensagemErro } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { Button, EmptyState } from '@/components/ui';
import { FiltroPeriodo, usePeriodoDashboard } from '@/components/dashboard/periodo';
import type { MeuDashboard as Dados, Perfil } from '@/types';
import DashboardGeral from '@/pages/dashboard/DashboardGeral';
import DashboardVendedor from './DashboardVendedor';
import DashboardTecnico from './DashboardTecnico';
import DashboardGerente from './DashboardGerente';
import { VerComo } from './partes';

export default function MeuDashboard() {
  const usuario = useAuth((s) => s.usuario);
  const gestor = useAuth((s) => s.temPerfil('ADMIN', 'GERENTE'));
  const [params, setParams] = useSearchParams();
  const como = gestor && params.get('como') ? Number(params.get('como')) : null;
  const { periodo, setPeriodo, custom, setCustom, dataInicial, dataFinal, faixa } = usePeriodoDashboard();

  // o gestor sem "ver como" usa o dashboard completo (Dashboard de sempre, renomeado) — não precisa desta rota
  const proprioAdmin = usuario?.perfil === 'ADMIN' && !como;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['meu-dashboard', dataInicial, dataFinal, como],
    queryFn: () => api.get<Dados>('/meu-dashboard', { dataInicial, dataFinal, usuarioId: como ?? undefined }),
    enabled: !proprioAdmin,
    // números ao vivo: atualiza a cada 30 s, ao voltar para a aba e depois de qualquer gravação
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 0,
  });

  const mudarComo = (id: number | null) => setParams(id ? { como: String(id) } : {});
  const verComo = <VerComo atual={como} onMudar={mudarComo} verComo={data?.verComo ? data.usuario : null} />;

  if (proprioAdmin) return <DashboardGeral acoesExtras={verComo} />;

  if (error) {
    return (
      <div className="mx-auto mt-10 max-w-lg">
        <EmptyState
          icone={<AlertCircle className="h-5 w-5" />}
          titulo="Não foi possível abrir o Meu Dashboard"
          descricao={mensagemErro(error)}
          acao={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variante="secundario" onClick={() => refetch()}>Tentar de novo</Button>
              {como && <Button variante="fantasma" onClick={() => mudarComo(null)}>Voltar ao meu dashboard</Button>}
            </div>
          }
        />
      </div>
    );
  }

  const filtros = <FiltroPeriodo id="periodo-meu-dashboard" periodo={periodo} onPeriodo={setPeriodo} custom={custom} onCustom={setCustom} />;
  const perfil: Perfil = data?.usuario.perfil ?? usuario?.perfil ?? 'VENDEDOR';
  const props = { dados: data, carregando: isLoading, faixa, filtros, verComo };

  // o gestor vendo como ele mesmo (ou a gerente vendo o gestor) cai no completo
  if (perfil === 'ADMIN') return <DashboardGeral acoesExtras={verComo} />;
  if (perfil === 'VENDEDOR') return <DashboardVendedor {...props} />;
  if (perfil === 'TECNICO') return <DashboardTecnico {...props} />;
  return <DashboardGerente {...props} />;
}
