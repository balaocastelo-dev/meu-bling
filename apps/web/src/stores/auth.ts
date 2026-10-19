/**
 * Store de autenticação (zustand, persistido em localStorage).
 * Guarda o token JWT e o usuário logado; usado pelo api.ts para o header Bearer.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Perfil, Usuario } from '@/types';

interface AuthState {
  token: string | null;
  usuario: Usuario | null;
  login: (token: string, usuario: Usuario) => void;
  logout: () => void;
  /** Verifica se o usuário tem um dos perfis informados (ADMIN sempre tem) */
  temPerfil: (...perfis: Perfil[]) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      usuario: null,
      login: (token, usuario) => set({ token, usuario }),
      logout: () => set({ token: null, usuario: null }),
      temPerfil: (...perfis) => {
        const u = get().usuario;
        if (!u) return false;
        if (u.perfil === 'ADMIN') return true;
        return perfis.includes(u.perfil);
      },
    }),
    { name: 'meu-bling-auth' },
  ),
);
