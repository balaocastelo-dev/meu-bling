import { create } from 'zustand';

/**
 * MODO APRESENTAÇÃO — a tela que o cliente acompanha na segunda tela.
 *
 * Esconde o menu da esquerda e a barra de cima, tira a margem máxima e põe o
 * navegador em tela cheia. Serve para montar o orçamento com o cliente vendo:
 * antes sobrava uma borda grande e o nosso menu aparecia do lado dele.
 *
 * O estado vive aqui (e não na página) porque quem esconde o menu é a casca
 * do aplicativo (AppShell), enquanto o botão fica dentro da tela de venda.
 */
interface EstadoApresentacao {
  ativo: boolean;
  alternar: () => void;
  sair: () => void;
}

/** Entra em tela cheia de verdade; se o navegador recusar, o modo continua valendo. */
async function telaCheia(ligar: boolean) {
  try {
    if (ligar && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    if (!ligar && document.fullscreenElement) await document.exitFullscreen?.();
  } catch {
    /* alguns navegadores só liberam com gesto do usuário — o modo segue mesmo assim */
  }
}

export const useApresentacao = create<EstadoApresentacao>((set, get) => ({
  ativo: false,
  alternar: () => {
    const novo = !get().ativo;
    set({ ativo: novo });
    document.documentElement.classList.toggle('modo-apresentacao', novo);
    void telaCheia(novo);
  },
  sair: () => {
    if (!get().ativo) return;
    set({ ativo: false });
    document.documentElement.classList.remove('modo-apresentacao');
    void telaCheia(false);
  },
}));
