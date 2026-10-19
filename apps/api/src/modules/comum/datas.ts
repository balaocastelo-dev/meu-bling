import { addDays } from 'date-fns';

export function inicioDia(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function fimDia(d: Date) {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function hojeMeioDia() {
  const r = new Date();
  r.setHours(12, 0, 0, 0);
  return r;
}

/** Filtro Prisma `{ gte, lte }` para um intervalo de datas (ambos opcionais). */
export function intervalo(dataInicial?: Date | null, dataFinal?: Date | null) {
  if (!dataInicial && !dataFinal) return undefined;
  const r: { gte?: Date; lte?: Date } = {};
  if (dataInicial) r.gte = inicioDia(dataInicial);
  if (dataFinal) r.lte = fimDia(dataFinal);
  return r;
}

export { addDays };
