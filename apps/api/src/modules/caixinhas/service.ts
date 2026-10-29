/**
 * CAIXINHAS — dinheiro guardado (no Nubank) para compromissos grandes.
 * Cada caixinha tem valor, para que é e o dia de uso. O sistema calcula quanto falta,
 * quanto guardar por dia para chegar no prazo e se está em dia ou atrasada.
 * Guardar/retirar = transferência entre contas (fora do DRE), marcada com a caixinha.
 */
import { differenceInCalendarDays, startOfDay, endOfDay } from 'date-fns';
import { prisma, type Tx } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';

type Db = Tx | typeof prisma;

export interface ResumoCaixinha {
  id: number;
  nome: string;
  valorMeta: number;
  dataUso: Date;
  dataInicio: Date;
  contaFinanceira: { id: number; nome: string };
  observacoes: string | null;
  ativo: boolean;
  usadaEm: Date | null;
  saldo: number;
  falta: number;
  pct: number;
  /** dias até o dia de uso (0 = é hoje) */
  diasRestantes: number;
  /** quanto guardar por dia daqui até o dia de uso */
  porDia: number;
  guardadoHoje: number;
  /** sugestão de hoje (por dia − já guardado hoje) */
  sugestaoHoje: number;
  /** quanto já deveria ter, guardando por igual desde o início */
  esperadoHoje: number;
  situacao: 'COMPLETA' | 'EM_DIA' | 'ATRASADA' | 'VENCIDA' | 'USADA';
}

export function resumir(c: { id: number; nome: string; valorMeta: number; dataUso: Date; dataInicio: Date; observacoes: string | null; ativo: boolean; usadaEm: Date | null; contaFinanceira: { id: number; nome: string } }, movs: { tipo: string; valor: number; data: Date }[], agora = new Date()): ResumoCaixinha {
  const hojeIni = startOfDay(agora);
  const hojeFim = endOfDay(agora);
  const sinal = (m: { tipo: string }) => (m.tipo === 'ENTRADA' ? 1 : -1);
  const saldo = arredondar(movs.reduce((s, m) => s + sinal(m) * m.valor, 0));
  const guardadoHoje = arredondar(movs.filter((m) => m.data >= hojeIni && m.data <= hojeFim).reduce((s, m) => s + sinal(m) * m.valor, 0));
  const falta = arredondar(Math.max(0, c.valorMeta - saldo));
  const diasRestantes = differenceInCalendarDays(c.dataUso, agora);
  // por dia: o que faltava no começo de hoje dividido pelos dias até o uso (hoje conta; o dia do uso não)
  const faltaInicioDia = Math.max(0, c.valorMeta - (saldo - guardadoHoje));
  const dias = Math.max(1, diasRestantes);
  const porDia = arredondar(faltaInicioDia / dias);
  const sugestaoHoje = falta <= 0 ? 0 : arredondar(Math.min(falta, Math.max(0, porDia - Math.max(0, guardadoHoje))));
  const total = Math.max(1, differenceInCalendarDays(c.dataUso, c.dataInicio));
  const decorridos = Math.min(total, Math.max(0, differenceInCalendarDays(agora, c.dataInicio)));
  const esperadoHoje = arredondar((c.valorMeta * decorridos) / total);
  let situacao: ResumoCaixinha['situacao'];
  if (!c.ativo) situacao = 'USADA';
  else if (falta <= 0.009) situacao = 'COMPLETA';
  else if (diasRestantes < 0) situacao = 'VENCIDA';
  else if (saldo + 0.01 < esperadoHoje) situacao = 'ATRASADA';
  else situacao = 'EM_DIA';
  return {
    id: c.id,
    nome: c.nome,
    valorMeta: c.valorMeta,
    dataUso: c.dataUso,
    dataInicio: c.dataInicio,
    contaFinanceira: c.contaFinanceira,
    observacoes: c.observacoes,
    ativo: c.ativo,
    usadaEm: c.usadaEm,
    saldo,
    falta,
    pct: c.valorMeta > 0 ? Math.min(100, arredondar((saldo / c.valorMeta) * 100, 1)) : 0,
    diasRestantes,
    porDia,
    guardadoHoje,
    sugestaoHoje,
    esperadoHoje,
    situacao,
  };
}

export async function listarCaixinhas(p: { ativas?: boolean } = {}, db: Db = prisma) {
  const lista = await db.caixinha.findMany({
    where: p.ativas === undefined ? {} : { ativo: p.ativas },
    orderBy: [{ ativo: 'desc' }, { dataUso: 'asc' }],
    include: { contaFinanceira: { select: { id: true, nome: true } }, movimentos: { select: { tipo: true, valor: true, data: true } } },
  });
  return lista.map((c) => resumir(c, c.movimentos));
}

export async function caixinha(id: number, db: Db = prisma) {
  const c = await db.caixinha.findUnique({ where: { id }, include: { contaFinanceira: { select: { id: true, nome: true } }, movimentos: { select: { id: true, tipo: true, valor: true, data: true, descricao: true }, orderBy: { data: 'desc' } } } });
  if (!c) return null;
  return { ...resumir(c, c.movimentos), movimentos: c.movimentos };
}

/** Conta padrão das caixinhas: a do Nubank (se houver), senão a primeira conta ativa. */
export async function contaCaixinhaPadraoId(db: Db = prisma) {
  const c =
    (await db.contaFinanceira.findFirst({ where: { ativo: true, OR: [{ banco: { contains: 'NUBANK' } }, { nome: { contains: 'Nubank' } }, { nome: { contains: 'NUBANK' } }] }, select: { id: true } })) ||
    (await db.contaFinanceira.findFirst({ where: { ativo: true }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }], select: { id: true } }));
  return c?.id ?? null;
}

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Avisos das caixinhas (para o painel do gestor e da gerente). */
export async function avisosCaixinhas(db: Db = prisma) {
  const lista = (await listarCaixinhas({ ativas: true }, db)).filter((c) => c.situacao !== 'COMPLETA');
  const avisos: { tipo: 'erro' | 'aviso' | 'info'; mensagem: string; link: string; prioridade: number }[] = [];
  for (const c of lista) {
    const prazo = c.diasRestantes === 0 ? 'é hoje' : c.diasRestantes === 1 ? 'é amanhã' : `em ${c.diasRestantes} dias`;
    if (c.situacao === 'VENCIDA') avisos.push({ tipo: 'erro', prioridade: 0, mensagem: `Caixinha "${c.nome}" passou do dia de uso e faltam ${brl(c.falta)}`, link: `/financeiro/caixinhas` });
    else if (c.situacao === 'ATRASADA') avisos.push({ tipo: 'erro', prioridade: 1, mensagem: `Caixinha "${c.nome}" atrasada: guarde ${brl(c.sugestaoHoje)} hoje (faltam ${brl(c.falta)}, uso ${prazo})`, link: `/financeiro/caixinhas` });
    else if (c.sugestaoHoje > 0) avisos.push({ tipo: 'aviso', prioridade: 2, mensagem: `Guardar hoje ${brl(c.sugestaoHoje)} na caixinha "${c.nome}" (faltam ${brl(c.falta)}, uso ${prazo})`, link: `/financeiro/caixinhas` });
  }
  return { caixinhas: lista, avisos };
}
