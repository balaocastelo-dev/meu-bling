import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { router } from './routes';
import './index.css';

// Cliente de cache: listagens não refazem fetch ao focar a janela; erros não repetem em cascata
// qualquer gravação (venda salva, situação trocada, desafio lançado…) atualiza os números do painel do vendedor
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      for (const k of ['painel-vendedor', 'desafios', 'metas']) queryClient.invalidateQueries({ queryKey: [k] });
    },
  }),
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30 * 1000 },
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
