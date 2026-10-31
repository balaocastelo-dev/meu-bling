/**
 * Store do chat da equipe (zustand, em memória): caixa de entrada, mensagens por conversa, presença,
 * quem está digitando, chamada recebida/ativa e o total de não lidas (sino do topo e Meu Dashboard).
 * Os eventos chegam por lib/chat/realtime.ts (WebSocket, ou long polling quando o WebSocket não passa).
 */
import { create } from 'zustand';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import type { Chamada, Colega, ConfigChat, Conversa, EstadoPresenca, EventoChat, Mensagem, RespostaAtencao, TipoChamada } from '@/lib/chat/tipos';

export type Ligacao = 'desligado' | 'ligando' | 'websocket' | 'polling';

interface ChatState {
  config: ConfigChat | null;
  ligacao: Ligacao;
  presenca: Record<number, EstadoPresenca>;
  colegas: Colega[];
  conversas: Conversa[];
  conversasCarregadas: boolean;
  /** ADMIN: lista de todas as conversas do sistema (modo "ler qualquer conversa") */
  todas: Conversa[];
  naoLidas: number;
  mensagens: Record<number, Mensagem[]>;
  /** conversa com histórico completo carregado (sem mais mensagens antigas) */
  fimHistorico: Record<number, boolean>;
  digitando: Record<number, { usuarioId: number; nome: string; ate: number }[]>;
  /** conversa aberta na tela (não avisa de mensagem dela) */
  conversaAberta: number | null;
  /** convite de chamada tocando */
  chamadaRecebida: Chamada | null;
  /** chamada em que estou (a tela de chamada fica aberta) */
  chamadaAtiva: Chamada | null;
  /** último evento para a tela reagir (toast, som, notificação) */
  ultimoEvento: EventoChat | null;

  setConfig: (c: ConfigChat | null) => void;
  setLigacao: (l: Ligacao) => void;
  setConversaAberta: (id: number | null) => void;
  carregarColegas: () => Promise<Colega[]>;
  carregarConversas: () => Promise<Conversa[]>;
  carregarTodas: () => Promise<Conversa[]>;
  carregarConversa: (id: number) => Promise<Conversa>;
  carregarMensagens: (conversaId: number, maisAntigas?: boolean) => Promise<Mensagem[]>;
  abrirDireta: (usuarioId: number) => Promise<Conversa>;
  criarSala: (nome: string, usuarioIds: number[]) => Promise<Conversa>;
  enviarTexto: (conversaId: number, texto: string, respondeAId?: number | null) => Promise<Mensagem>;
  enviarArquivo: (conversaId: number, arquivo: Blob, nome: string, opcoes?: { audio?: boolean; duracaoSeg?: number; respondeAId?: number | null }) => Promise<Mensagem>;
  marcarLida: (conversaId: number) => Promise<void>;
  apagarMensagem: (mensagemId: number) => Promise<void>;
  chamarAtencao: (conversaId: number) => Promise<RespostaAtencao>;
  iniciarChamada: (conversaId: number, tipo: TipoChamada) => Promise<Chamada>;
  atenderChamada: (chamadaId: number) => Promise<Chamada>;
  recusarChamada: (chamadaId: number) => Promise<void>;
  sairChamada: (chamadaId: number) => Promise<void>;
  setChamadaAtiva: (c: Chamada | null) => void;
  setChamadaRecebida: (c: Chamada | null) => void;
  aplicarEvento: (e: EventoChat) => void;
  limpar: () => void;
}

const ordenar = (lista: Conversa[]) => [...lista].sort((a, b) => (b.ultimaMensagemEm || b.criadoEm).localeCompare(a.ultimaMensagemEm || a.criadoEm));

function mesclarConversa(lista: Conversa[], c: Conversa): Conversa[] {
  const i = lista.findIndex((x) => x.id === c.id);
  if (i < 0) return ordenar([...lista, c]);
  const atual = lista[i];
  // o evento "conversa" não traz última mensagem/não lidas: mantém as que a tela já tem
  const nova = { ...atual, ...c, ultimaMensagem: c.ultimaMensagem ?? atual.ultimaMensagem, naoLidas: c.naoLidas ?? atual.naoLidas };
  const copia = [...lista];
  copia[i] = nova;
  return ordenar(copia);
}

export const useChat = create<ChatState>()((set, get) => ({
  config: null,
  ligacao: 'desligado',
  presenca: {},
  colegas: [],
  conversas: [],
  conversasCarregadas: false,
  todas: [],
  naoLidas: 0,
  mensagens: {},
  fimHistorico: {},
  digitando: {},
  conversaAberta: null,
  chamadaRecebida: null,
  chamadaAtiva: null,
  ultimoEvento: null,

  setConfig: (config) => set({ config }),
  setLigacao: (ligacao) => set({ ligacao }),
  setConversaAberta: (conversaAberta) => set({ conversaAberta }),

  carregarColegas: async () => {
    const colegas = await api.get<Colega[]>('/chat/usuarios');
    const presenca = { ...get().presenca };
    for (const c of colegas) {
      if (c.online) presenca[c.id] = c.estado;
      else delete presenca[c.id];
    }
    set({ colegas, presenca });
    return colegas;
  },

  carregarConversas: async () => {
    const conversas = await api.get<Conversa[]>('/chat/conversas');
    const naoLidas = conversas.reduce((s, c) => s + (c.naoLidas || 0), 0);
    set({ conversas: ordenar(conversas), conversasCarregadas: true, naoLidas });
    return conversas;
  },

  carregarTodas: async () => {
    const todas = await api.get<Conversa[]>('/chat/conversas', { todas: 1 });
    set({ todas: ordenar(todas) });
    return todas;
  },

  carregarConversa: async (id) => {
    const c = await api.get<Conversa>(`/chat/conversas/${id}`);
    set((s) => ({ conversas: c.souParticipante ? mesclarConversa(s.conversas, c) : s.conversas, todas: s.todas.length ? mesclarConversa(s.todas, c) : s.todas }));
    return c;
  },

  carregarMensagens: async (conversaId, maisAntigas) => {
    const atuais = get().mensagens[conversaId] ?? [];
    const antesDe = maisAntigas && atuais.length ? atuais[0].id : undefined;
    if (maisAntigas && get().fimHistorico[conversaId]) return atuais;
    const lista = await api.get<Mensagem[]>(`/chat/conversas/${conversaId}/mensagens`, { antesDe, limite: 50 });
    set((s) => {
      const existentes = s.mensagens[conversaId] ?? [];
      const ids = new Set(lista.map((m) => m.id));
      const juntas = maisAntigas ? [...lista, ...existentes.filter((m) => !ids.has(m.id))] : [...lista, ...existentes.filter((m) => !ids.has(m.id) && m.id > (lista[lista.length - 1]?.id ?? 0))];
      juntas.sort((a, b) => a.id - b.id);
      return { mensagens: { ...s.mensagens, [conversaId]: juntas }, fimHistorico: { ...s.fimHistorico, [conversaId]: lista.length < 50 } };
    });
    return get().mensagens[conversaId] ?? [];
  },

  abrirDireta: async (usuarioId) => {
    const c = await api.post<Conversa>('/chat/conversas', { tipo: 'DIRETA', usuarioId });
    set((s) => ({ conversas: mesclarConversa(s.conversas, c) }));
    return c;
  },

  criarSala: async (nome, usuarioIds) => {
    const c = await api.post<Conversa>('/chat/conversas', { tipo: 'SALA', nome, usuarioIds });
    set((s) => ({ conversas: mesclarConversa(s.conversas, c) }));
    return c;
  },

  enviarTexto: async (conversaId, texto, respondeAId) => {
    const eu = useAuth.getState().usuario;
    const provisoria: Mensagem = {
      id: -Date.now(),
      conversaId,
      autorId: eu?.id ?? null,
      autor: eu ? { id: eu.id, nome: eu.nome, perfil: eu.perfil } : null,
      tipo: 'TEXTO',
      texto,
      arquivo: null,
      arquivoNome: null,
      arquivoTamanho: null,
      arquivoMime: null,
      duracaoSeg: null,
      respondeAId: respondeAId ?? null,
      chamadaId: null,
      editadaEm: null,
      apagadaEm: null,
      criadoEm: new Date().toISOString(),
      enviando: true,
    };
    set((s) => ({ mensagens: { ...s.mensagens, [conversaId]: [...(s.mensagens[conversaId] ?? []), provisoria] } }));
    try {
      const m = await api.post<Mensagem>(`/chat/conversas/${conversaId}/mensagens`, { texto, respondeAId: respondeAId ?? null });
      set((s) => ({ mensagens: { ...s.mensagens, [conversaId]: (s.mensagens[conversaId] ?? []).filter((x) => x.id !== provisoria.id && x.id !== m.id).concat(m).sort((a, b) => a.id - b.id) } }));
      get().aplicarEvento({ tipo: 'mensagem', conversaId, mensagem: m });
      return m;
    } catch (e) {
      set((s) => ({ mensagens: { ...s.mensagens, [conversaId]: (s.mensagens[conversaId] ?? []).map((x) => (x.id === provisoria.id ? { ...x, enviando: false, erro: (e as Error).message } : x)) } }));
      throw e;
    }
  },

  enviarArquivo: async (conversaId, arquivo, nome, opcoes) => {
    const form = new FormData();
    form.append('arquivo', arquivo, nome);
    if (opcoes?.duracaoSeg !== undefined) form.append('duracaoSeg', String(opcoes.duracaoSeg));
    if (opcoes?.respondeAId) form.append('respondeAId', String(opcoes.respondeAId));
    form.append('mime', arquivo.type || '');
    const m = await api.upload<Mensagem>(`/chat/conversas/${conversaId}/${opcoes?.audio ? 'audio' : 'arquivo'}`, form);
    get().aplicarEvento({ tipo: 'mensagem', conversaId, mensagem: m });
    return m;
  },

  marcarLida: async (conversaId) => {
    const s = get();
    const c = s.conversas.find((x) => x.id === conversaId);
    const lista = s.mensagens[conversaId] ?? [];
    const ultima = lista.length ? lista[lista.length - 1].id : null;
    if (c && c.naoLidas === 0 && (!ultima || ultima <= c.lidaAteId)) return;
    // zera na hora na tela; o servidor confirma
    set((st) => {
      const conversas = st.conversas.map((x) => (x.id === conversaId ? { ...x, naoLidas: 0, lidaAteId: Math.max(x.lidaAteId, ultima ?? 0) } : x));
      return { conversas, naoLidas: conversas.reduce((t, x) => t + (x.naoLidas || 0), 0) };
    });
    await api.post(`/chat/conversas/${conversaId}/lida`, ultima && ultima > 0 ? { ateId: ultima } : {}).catch(() => undefined);
  },

  apagarMensagem: async (mensagemId) => {
    await api.del(`/chat/mensagens/${mensagemId}`);
  },

  chamarAtencao: async (conversaId) => {
    const r = await api.post<RespostaAtencao>(`/chat/conversas/${conversaId}/atencao`, {});
    get().aplicarEvento({ tipo: 'mensagem', conversaId, mensagem: r.mensagem });
    return r;
  },

  iniciarChamada: async (conversaId, tipo) => {
    const c = await api.post<Chamada>(`/chat/conversas/${conversaId}/chamadas`, { tipo });
    set({ chamadaAtiva: c, chamadaRecebida: null });
    return c;
  },

  atenderChamada: async (chamadaId) => {
    const c = await api.post<Chamada>(`/chat/chamadas/${chamadaId}/entrar`, {});
    set({ chamadaAtiva: c, chamadaRecebida: null });
    return c;
  },

  recusarChamada: async (chamadaId) => {
    set({ chamadaRecebida: null });
    await api.post(`/chat/chamadas/${chamadaId}/recusar`, {}).catch(() => undefined);
  },

  sairChamada: async (chamadaId) => {
    set((s) => ({ chamadaAtiva: s.chamadaAtiva?.id === chamadaId ? null : s.chamadaAtiva, chamadaRecebida: s.chamadaRecebida?.id === chamadaId ? null : s.chamadaRecebida }));
    await api.post(`/chat/chamadas/${chamadaId}/sair`, {}).catch(() => undefined);
  },

  setChamadaAtiva: (chamadaAtiva) => set({ chamadaAtiva }),
  setChamadaRecebida: (chamadaRecebida) => set({ chamadaRecebida }),

  aplicarEvento: (e) => {
    const eu = useAuth.getState().usuario?.id ?? 0;
    switch (e.tipo) {
      case 'pronto': {
        const presenca: Record<number, EstadoPresenca> = {};
        for (const p of e.online) presenca[p.usuarioId] = p.estado;
        const pendentes = e.chamadas.filter((c) => c.situacao === 'ATIVA');
        const ativa = get().chamadaAtiva;
        set({
          presenca,
          naoLidas: e.naoLidas,
          // chamada tocando para mim que ainda não atendi (ex.: abri o sistema com alguém chamando)
          chamadaRecebida: get().chamadaRecebida ?? pendentes.find((c) => !c.participantes.includes(eu) && c.id !== ativa?.id) ?? null,
        });
        // se eu estava numa chamada e caí: ela continua no servidor? atualiza
        if (ativa && !pendentes.some((c) => c.id === ativa.id)) set({ chamadaAtiva: null });
        break;
      }
      case 'presenca':
        set((s) => {
          const presenca = { ...s.presenca };
          if (e.online) presenca[e.usuarioId] = e.estado;
          else delete presenca[e.usuarioId];
          const colegas = s.colegas.map((c) => (c.id === e.usuarioId ? { ...c, online: e.online, estado: e.estado } : c));
          const conversas = s.conversas.map((c) => ({ ...c, participantes: c.participantes.map((p) => (p.id === e.usuarioId ? { ...p, online: e.online, estado: e.estado } : p)) }));
          return { presenca, colegas, conversas };
        });
        break;
      case 'digitando':
        if (e.usuarioId === eu) break;
        set((s) => {
          const lista = (s.digitando[e.conversaId] ?? []).filter((d) => d.usuarioId !== e.usuarioId);
          lista.push({ usuarioId: e.usuarioId, nome: e.nome, ate: Date.now() + 5000 });
          return { digitando: { ...s.digitando, [e.conversaId]: lista } };
        });
        break;
      case 'mensagem': {
        const m = e.mensagem;
        set((s) => {
          const lista = s.mensagens[e.conversaId];
          const mensagens = lista ? { ...s.mensagens, [e.conversaId]: lista.some((x) => x.id === m.id) ? lista.map((x) => (x.id === m.id ? m : x)) : [...lista, m].sort((a, b) => a.id - b.id) } : s.mensagens;
          const minha = m.autorId === eu;
          const aberta = s.conversaAberta === e.conversaId && typeof document !== 'undefined' && document.visibilityState === 'visible';
          const contaNaoLida = !minha && m.tipo !== 'SISTEMA' && !aberta;
          let achou = false;
          let conversas = s.conversas.map((c) => {
            if (c.id !== e.conversaId) return c;
            achou = true;
            return { ...c, ultimaMensagem: m, ultimaMensagemEm: m.criadoEm, naoLidas: contaNaoLida ? (c.naoLidas || 0) + 1 : c.naoLidas, lidaAteId: minha ? Math.max(c.lidaAteId, m.id) : c.lidaAteId };
          });
          conversas = ordenar(conversas);
          const digitando = { ...s.digitando, [e.conversaId]: (s.digitando[e.conversaId] ?? []).filter((d) => d.usuarioId !== m.autorId) };
          const naoLidas = conversas.reduce((t, c) => t + (c.naoLidas || 0), 0);
          if (!achou) void get().carregarConversas();
          return { mensagens, conversas, digitando, naoLidas };
        });
        // conversa aberta e visível: já marca como lida
        if (get().conversaAberta === e.conversaId && m.autorId !== eu && typeof document !== 'undefined' && document.visibilityState === 'visible') void get().marcarLida(e.conversaId);
        break;
      }
      case 'mensagem.apagada':
        set((s) => {
          const lista = s.mensagens[e.conversaId];
          if (!lista) return {};
          return { mensagens: { ...s.mensagens, [e.conversaId]: lista.map((m) => (m.id === e.mensagemId ? { ...m, apagadaEm: new Date().toISOString(), texto: null, arquivo: null } : m)) } };
        });
        break;
      case 'lida':
        set((s) => ({
          conversas: s.conversas.map((c) => (c.id === e.conversaId ? { ...c, participantes: c.participantes.map((p) => (p.id === e.usuarioId ? { ...p, lidaAteId: Math.max(p.lidaAteId, e.ateId) } : p)), ...(e.usuarioId === eu ? { lidaAteId: Math.max(c.lidaAteId, e.ateId), naoLidas: 0 } : {}) } : c)),
          naoLidas: e.usuarioId === eu ? s.conversas.filter((c) => c.id !== e.conversaId).reduce((t, c) => t + (c.naoLidas || 0), 0) : s.naoLidas,
        }));
        break;
      case 'conversa':
        set((s) => ({ conversas: e.conversa.souParticipante ? mesclarConversa(s.conversas, e.conversa) : s.conversas.filter((c) => c.id !== e.conversa.id), todas: s.todas.length ? mesclarConversa(s.todas, e.conversa) : s.todas }));
        break;
      case 'conversa.saiu':
        set((s) => {
          const conversas = s.conversas.filter((c) => c.id !== e.conversaId);
          return { conversas, naoLidas: conversas.reduce((t, c) => t + (c.naoLidas || 0), 0) };
        });
        break;
      case 'chamada': {
        const c = e.chamada;
        set((s) => {
          const patch: Partial<ChatState> = {};
          if (e.acao === 'convite') {
            if (c.iniciadoPorId !== eu && !s.chamadaAtiva) patch.chamadaRecebida = c;
          } else if (e.acao === 'encerrada' || e.acao === 'perdida') {
            if (s.chamadaRecebida?.id === c.id) patch.chamadaRecebida = null;
            if (s.chamadaAtiva?.id === c.id) patch.chamadaAtiva = null;
          } else {
            if (s.chamadaAtiva?.id === c.id) patch.chamadaAtiva = c;
            if (s.chamadaRecebida?.id === c.id) patch.chamadaRecebida = c.participantes.includes(eu) ? null : c;
          }
          return patch;
        });
        break;
      }
      default:
        break;
    }
    set({ ultimoEvento: e });
  },

  limpar: () => set({ ligacao: 'desligado', presenca: {}, colegas: [], conversas: [], conversasCarregadas: false, todas: [], naoLidas: 0, mensagens: {}, fimHistorico: {}, digitando: {}, conversaAberta: null, chamadaRecebida: null, chamadaAtiva: null, ultimoEvento: null }),
}));
