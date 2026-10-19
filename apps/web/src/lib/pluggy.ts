/**
 * Carregamento dinâmico do widget Pluggy Connect (Open Finance).
 *
 * Script oficial (pacote `pluggy-connect-sdk`): https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js
 * Atenção: as URLs versionadas (ex.: /v2.9.1/) do CDN respondem 404 — só o caminho `latest` é publicado.
 * O bundle registra o construtor em `window.PluggyConnect`.
 */

const SCRIPT_URL = 'https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js';

export interface PluggyItem {
  id: string;
  connector?: { name?: string; imageUrl?: string };
  status?: string;
}

interface PluggyConnectOpcoes {
  connectToken: string;
  includeSandbox?: boolean;
  countries?: string[];
  language?: string;
  /** Pré-preenche CPF/CNPJ nos conectores Open Finance */
  openFinanceParameters?: { cpf?: string; cnpj?: string };
  onSuccess?: (data: { item: PluggyItem }) => void;
  onError?: (err: { message?: string; data?: { item?: PluggyItem } } | Error) => void;
  onClose?: () => void;
}

interface PluggyConnectInstancia {
  init: () => Promise<void> | void;
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
      s.remove();
      reject(new Error('Não foi possível carregar o widget do Open Finance (Pluggy). Verifique a internet ou um bloqueador de anúncios.'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

/** Abre o widget e devolve o item conectado (ou null se o usuário fechar sem concluir) */
export async function abrirPluggyConnect(connectToken: string, opcoes?: { cnpj?: string; includeSandbox?: boolean }): Promise<PluggyItem | null> {
  await carregarPluggy();
  if (!window.PluggyConnect) throw new Error('Widget Pluggy indisponível.');
  return new Promise((resolve, reject) => {
    let concluido = false;
    const inst = new window.PluggyConnect!({
      connectToken,
      language: 'pt',
      countries: ['BR'],
      includeSandbox: opcoes?.includeSandbox ?? false,
      openFinanceParameters: opcoes?.cnpj ? { cnpj: opcoes.cnpj.replace(/\D/g, '') } : undefined,
      onSuccess: ({ item }) => {
        concluido = true;
        resolve(item);
      },
      onError: (err) => {
        concluido = true;
        const msg = err instanceof Error ? err.message : err?.message;
        reject(new Error(msg || 'Erro no widget Pluggy.'));
      },
      onClose: () => {
        if (!concluido) resolve(null);
      },
    });
    inst.init();
  });
}
