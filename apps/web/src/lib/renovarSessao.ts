/**
 * Renova o JWT enquanto o sistema está em uso e grava o token novo no localStorage
 * (store meu-bling-auth). O cookie mb_token vem no Set-Cookie da resposta.
 */
import { useEffect } from 'react';
import { api, BASE_PATH } from '@/lib/api';
import { deveRenovarSessao, type GatilhoRenovacao } from '@/lib/sessao';
import { useAuth } from '@/stores/auth';
import type { Usuario } from '@/types';

let ultimaRenovacaoMs = 0;
let emCurso: Promise<void> | null = null;

export async function renovarSessaoSePrecisa(gatilho: GatilhoRenovacao) {
  const token = useAuth.getState().token;
  if (
    !deveRenovarSessao({
      token,
      pathname: location.pathname,
      basePath: BASE_PATH,
      agoraMs: Date.now(),
      ultimaRenovacaoMs,
      visivel: document.visibilityState === 'visible',
      gatilho,
    })
  ) {
    return;
  }
  if (emCurso) return emCurso;
  emCurso = (async () => {
    try {
      const r = await api.post<{ token: string; usuario: Usuario }>('/auth/renovar');
      useAuth.getState().login(r.token, r.usuario);
      ultimaRenovacaoMs = Date.now();
    } catch {
      // 401: api.ts desloga e manda para o login quando o token venceu de verdade
    } finally {
      emCurso = null;
    }
  })();
  return emCurso;
}

/** Liga a renovação na casca autenticada: ao abrir, ao voltar a aba e antes de vencer. */
export function useRenovacaoSessao(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    void renovarSessaoSePrecisa('abertura');
    const aoVisivel = () => {
      if (document.visibilityState === 'visible') void renovarSessaoSePrecisa('visivel');
    };
    const aoFoco = () => void renovarSessaoSePrecisa('foco');
    document.addEventListener('visibilitychange', aoVisivel);
    window.addEventListener('focus', aoFoco);
    // conferência curta: o setTimeout de 29 dias estoura o limite de 32 bits e dispararia na hora
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void renovarSessaoSePrecisa('periodo');
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', aoVisivel);
      window.removeEventListener('focus', aoFoco);
      window.clearInterval(id);
    };
  }, [ativo]);
}
