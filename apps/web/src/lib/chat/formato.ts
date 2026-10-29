/** Textos curtos do chat: resumo da mensagem na caixa de entrada/avisos, hora relativa, tamanho. */
import { differenceInCalendarDays, format, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { Mensagem } from './tipos';

export function resumoMensagem(m: Mensagem | null | undefined): string {
  if (!m) return '';
  if (m.apagadaEm) return 'Mensagem apagada';
  if (m.tipo === 'AUDIO') return `🎤 Áudio${m.duracaoSeg ? ` (${tempoCurto(m.duracaoSeg)})` : ''}`;
  if (m.tipo === 'ARQUIVO') return `📎 ${m.arquivoNome || 'Arquivo'}`;
  if (m.tipo === 'CHAMADA') return m.texto || '📞 Chamada';
  return (m.texto || '').replace(/\s+/g, ' ').slice(0, 140);
}

export function tempoCurto(seg: number) {
  const s = Math.max(0, Math.round(seg));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "14:05" hoje, "Ontem", "seg." nesta semana, "12/03" depois. */
export function horaRelativa(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Ontem';
  if (differenceInCalendarDays(new Date(), d) < 7) return format(d, 'EEE', { locale: ptBR });
  return format(d, 'dd/MM');
}

export function horaMensagem(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : format(d, 'HH:mm');
}

/** Separador de dia na conversa. */
export function rotuloDia(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Hoje';
  if (isYesterday(d)) return 'Ontem';
  return format(d, "EEEE, d 'de' MMMM", { locale: ptBR });
}

export function mesmoDia(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

/** Primeiro nome (e inicial do sobrenome quando há homônimos é por conta de quem chama). */
export function primeiroNome(nome: string | null | undefined) {
  return (nome || '').trim().split(/\s+/)[0] || '';
}
