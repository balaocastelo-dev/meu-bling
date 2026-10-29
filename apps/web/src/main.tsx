import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes';
import './index.css';

// Cliente de cache: listagens não refazem fetch ao focar a janela; erros não repetem em cascata
/** Erro HTTP 4xx da API (ApiError tem .status) */
const erro4xx = (e: unknown) => {
  const st = (e as { status?: number } | null)?.status ?? 0;
  return st >= 400 && st < 500;
};
// qualquer gravação (venda salva, situação trocada, desafio lançado…) atualiza os números do painel do vendedor
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      for (const k of ['painel-vendedor', 'desafios', 'metas']) queryClient.invalidateQueries({ queryKey: [k] });
    },
  }),
  defaultOptions: {
    // erro 4xx (sem permissão, não encontrado, venda de outro vendedor) não adianta repetir: mostra na hora
    queries: { refetchOnWindowFocus: false, retry: (falhas, e) => falhas < 1 && !erro4xx(e), staleTime: 30 * 1000 },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors closeButton toastOptions={{ style: { fontFamily: 'inherit' } }} />
    </QueryClientProvider>
  </StrictMode>,
);
