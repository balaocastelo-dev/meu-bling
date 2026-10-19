/**
 * Carregamento dinâmico do widget Pluggy Connect (Open Finance).
 * Script: https://cdn.pluggy.ai/pluggy-connect/v2.9.1/pluggy-connect.js
 */

const SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/v2.9.1/pluggy-connect.js';

export interface PluggyItem {
  id: string;
  connector?: { name?: string; imageUrl?: string };
  status?: string;
}

interface PluggyConnectOpcoes {
  connectToken: string;
  includeSandbox?: boolean;
  onSuccess?: (data: { item: PluggyItem }) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
  language?: string;
}

interface PluggyConnectInstancia {
  init: () => void;
}

declare global {
  interface Window {
    PluggyConnect?: new (opcoes: PluggyConnectOpcoes) => PluggyConnectInstancia;
  }
}

let carregando: Promise<void> | null = null;

/** Garante que o script do widget está carregado (uma vez só) */
export function carregarPluggy(): Promise<void> {
  if (window.PluggyConnect) return Promise.resolve();
  if (carregando) return carregando;
  carregando = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      carregando = null;
      reject(new Error('Não foi possível carregar o widget do Open Finance (Pluggy).'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

/** Abre o widget e devolve o item conectado (ou null se o usuário fechar) */
export async function abrirPluggyConnect(connectToken: string): Promise<PluggyItem | null> {
  await carregarPluggy();
  if (!window.PluggyConnect) throw new Error('Widget Pluggy indisponível.');
  return new Promise((resolve, reject) => {
    const inst = new window.PluggyConnect!({
      connectToken,
      language: 'pt',
      onSuccess: ({ item }) => resolve(item),
      onError: (err) => reject(err instanceof Error ? err : new Error('Erro no widget Pluggy.')),
      onClose: () => resolve(null),
    });
    inst.init();
  });
}
