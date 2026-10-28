/**
 * DIAS ÚTEIS da consignação: as diárias só caem de segunda a sexta, fora dos feriados.
 *
 * Feriados considerados: nacionais (fixos e móveis: Carnaval, Sexta-feira Santa, Corpus Christi),
 * o estadual de SP (9 de julho) e o municipal de Campinas (8 de dezembro).
 * Outros dias sem expediente entram pela configuração da consignação (feriadosExtras: "AAAA-MM-DD").
 */
import { addDays } from 'date-fns';

const FIXOS = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '07-09', // Revolução Constitucionalista (SP)
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (nacional desde 2024)
  '12-08', // Nossa Senhora da Conceição (Campinas)
  '12-25', // Natal
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
export function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12, 0, 0, 0);
}

/** "AAAA-MM-DD" no horário local. */
export function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const cache = new Map<number, Set<string>>();

export function feriadosDoAno(ano: number): Set<string> {
  const ja = cache.get(ano);
  if (ja) return ja;
  const s = new Set(FIXOS.map((f) => `${ano}-${f}`));
  const p = pascoa(ano);
  for (const delta of [-48, -47, -2, 60]) s.add(chaveDia(addDays(p, delta)));
  cache.set(ano, s);
  return s;
}

export function ehFeriado(d: Date, extras: string[] = []): boolean {
  const k = chaveDia(d);
  return feriadosDoAno(d.getFullYear()).has(k) || extras.includes(k);
}

export function ehDiaUtil(d: Date, extras: string[] = []): boolean {
  const dia = d.getDay();
  return dia !== 0 && dia !== 6 && !ehFeriado(d, extras);
}

/** Primeiro dia útil DEPOIS de `d` (meio-dia, para não escorregar de dia com fuso). */
export function proximoDiaUtil(d: Date, extras: string[] = []): Date {
  let r = meioDia(addDays(d, 1));
  while (!ehDiaUtil(r, extras)) r = addDays(r, 1);
  return r;
}

/** `n` dias úteis a partir do primeiro dia útil depois de `d`. */
export function diasUteisDepois(d: Date, n: number, extras: string[] = []): Date[] {
  const lista: Date[] = [];
  let atual = d;
  for (let i = 0; i < n; i++) {
    atual = proximoDiaUtil(atual, extras);
    lista.push(atual);
  }
  return lista;
}

export function meioDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(12, 0, 0, 0);
  return r;
}

export function inicioDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Dias corridos entre duas datas (pelo calendário, ignorando o horário). */
export function diasEntre(de: Date, ate: Date): number {
  return Math.round((inicioDoDia(ate).getTime() - inicioDoDia(de).getTime()) / 86400000);
}
