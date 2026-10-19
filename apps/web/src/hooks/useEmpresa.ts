import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Empresa, WhatsappStatus } from '@/types';
import { useAuth } from '@/stores/auth';

/** Dados da empresa (cacheados; usados no cabeçalho e em configurações) */
export function useEmpresa() {
  const token = useAuth((s) => s.token);
  return useQuery({
    queryKey: ['empresa'],
    queryFn: () => api.get<Empresa>('/empresa'),
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });
}

/** Status do WhatsApp com polling (mais rápido enquanto aguarda QR) */
export function useWhatsappStatus(polling = true) {
  const token = useAuth((s) => s.token);
  return useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get<WhatsappStatus>('/whatsapp/status'),
    enabled: !!token,
    retry: 0,
    refetchInterval: (q) => {
      if (!polling) return false;
      const s = q.state.data?.status;
      if (s === 'AGUARDANDO_QR' || s === 'CONECTANDO') return 3000;
      return 30000;
    },
  });
}
