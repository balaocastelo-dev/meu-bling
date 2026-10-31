/** Tipos do chat da equipe (espelham a API em modules/chat). */
import type { Perfil } from '@/types';

export type EstadoPresenca = 'online' | 'ausente' | 'ocupado';
export type TipoConversa = 'DIRETA' | 'SALA';
export type TipoMensagem = 'TEXTO' | 'AUDIO' | 'ARQUIVO' | 'SISTEMA' | 'CHAMADA';
export type TipoChamada = 'VOZ' | 'VIDEO';

export interface Colega {
  id: number;
  nome: string;
  perfil: Perfil;
  eu: boolean;
  online: boolean;
  estado: EstadoPresenca;
  ultimoLogin?: string | null;
}

export interface Participante {
  id: number;
  nome: string;
  perfil: Perfil;
  lidaAteId: number;
  online: boolean;
  estado: EstadoPresenca;
}

export interface Mensagem {
  id: number;
  conversaId: number;
  autorId: number | null;
  autor: { id: number; nome: string; perfil: Perfil } | null;
  tipo: TipoMensagem;
  texto: string | null;
  arquivo: string | null;
  arquivoNome: string | null;
  arquivoTamanho: number | null;
  arquivoMime: string | null;
  duracaoSeg: number | null;
  respondeAId: number | null;
  chamadaId: number | null;
  editadaEm: string | null;
  apagadaEm: string | null;
  criadoEm: string;
  /** só na tela: mensagem ainda sendo enviada */
  enviando?: boolean;
  erro?: string;
}

export interface Conversa {
  id: number;
  tipo: TipoConversa;
  nome: string;
  criadoPorId: number | null;
  ultimaMensagemEm: string | null;
  criadoEm: string;
  outroUsuarioId: number | null;
  participantes: Participante[];
  souParticipante: boolean;
  silenciadaAte: string | null;
  lidaAteId: number;
  ultimaMensagem: Mensagem | null;
  naoLidas: number;
  criadoPor?: { id: number; nome: string; perfil: Perfil } | null;
}

export interface Chamada {
  id: number;
  conversaId: number;
  tipo: TipoChamada;
  iniciadoPorId: number;
  iniciadoPor: { id: number; nome: string; perfil: Perfil } | null;
  situacao: 'ATIVA' | 'ENCERRADA' | 'PERDIDA' | 'RECUSADA';
  participantes: number[];
  iniciadaEm: string;
  atendidaEm: string | null;
  encerradaEm: string | null;
}

export interface ConfigChat {
  realtimeUrl: string | null;
  pollingMs: number;
  iceServers: RTCIceServer[];
  turn: boolean;
  pushPublicKey: string | null;
  chamadaSemRespostaSeg: number;
}

/** Evento vindo do servidor (WebSocket ou long polling). */
export type EventoChat =
  | { tipo: 'pronto'; usuarioId: number; online: { usuarioId: number; estado: EstadoPresenca }[]; chamadas: Chamada[]; naoLidas: number }
  | { tipo: 'presenca'; usuarioId: number; online: boolean; estado: EstadoPresenca }
  | { tipo: 'digitando'; conversaId: number; usuarioId: number; nome: string }
  | { tipo: 'mensagem'; conversaId: number; mensagem: Mensagem }
  | { tipo: 'mensagem.apagada'; conversaId: number; mensagemId: number }
  | { tipo: 'lida'; conversaId: number; usuarioId: number; ateId: number }
  | { tipo: 'conversa'; conversa: Conversa }
  | { tipo: 'conversa.saiu'; conversaId: number }
  | { tipo: 'chamada'; acao: 'convite' | 'entrou' | 'saiu' | 'recusou' | 'encerrada' | 'perdida'; chamada: Chamada; usuarioId?: number }
  | { tipo: 'rtc'; chamadaId: number; de: number; dados: SinalRtc }
  | { tipo: 'atencao'; conversaId: number; de: { id: number; nome: string }; mensagemId: number }
  | { tipo: 'pong'; em: number };

export type SituacaoWhatsappAtencao = 'enviado' | 'sem_telefone' | 'telefone_invalido' | 'aguardando' | 'desconectado' | 'erro';

export interface RespostaAtencao {
  ok: boolean;
  mensagem: Mensagem;
  destinatarios: { usuarioId: number; nome: string; whatsapp: SituacaoWhatsappAtencao }[];
}

export type SinalRtc = { sdp: RTCSessionDescriptionInit } | { ice: RTCIceCandidateInit | null } | { video: boolean } | { ola: true };
