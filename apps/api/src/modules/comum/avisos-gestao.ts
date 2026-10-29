/**
 * Avisos mais importantes para o gestor (ADMIN) e a gerente: caixinhas primeiro (completar no prazo é
 * prioridade — Thiago, 28/10/2026), depois contas vencidas/de hoje, OS atrasadas e a consignação.
 * Usado por GET /avisos e pelo Meu Dashboard do gestor/gerente.
 */
import { startOfDay } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { avisosCaixinhas } from '../caixinhas/service.js';
import { resumoFinanceiro } from '../financeiro/service.js';
import { avisosConsignacao } from '../consignacoes/service.js';

export type AvisoGestao = { tipo: 'erro' | 'aviso' | 'info'; prioridade: number; mensagem: string; link: string };

const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function avisosGestao() {
  const { caixinhas, avisos } = await avisosCaixinhas();
  const fin = await resumoFinanceiro();
  if (fin.pagarAtrasado > 0) avisos.push({ tipo: 'erro', prioridade: 1, mensagem: `Contas a pagar vencidas: ${brl(fin.pagarAtrasado)}`, link: '/financeiro/pagar?situacao=ATRASADO' });
  if (fin.pagarHoje > 0) avisos.push({ tipo: 'aviso', prioridade: 2, mensagem: `Contas a pagar hoje: ${brl(fin.pagarHoje)}`, link: '/financeiro/pagar?situacao=ABERTO' });
  if (fin.receberAtrasado > 0) avisos.push({ tipo: 'aviso', prioridade: 3, mensagem: `Contas a receber vencidas: ${brl(fin.receberAtrasado)}`, link: '/financeiro/receber?situacao=ATRASADO' });
  const osAtrasadas = await prisma.ordemServico.count({ where: { dataPrevista: { lt: startOfDay(new Date()) }, situacao: { final: false, cancelamento: false } } }).catch(() => 0);
  if (osAtrasadas) avisos.push({ tipo: 'aviso', prioridade: 3, mensagem: `${osAtrasadas} OS atrasada${osAtrasadas > 1 ? 's' : ''} (previsão vencida)`, link: '/ordens-servico?atrasadas=true' });
  for (const a of await avisosConsignacao().catch(() => [] as AvisoGestao[])) avisos.push(a);
  avisos.sort((a, b) => a.prioridade - b.prioridade);
  const sugestaoHojeTotal = caixinhas.reduce((s, c) => s + c.sugestaoHoje, 0);
  return { avisos: avisos as AvisoGestao[], caixinhas, sugestaoHojeTotal: Math.round(sugestaoHojeTotal * 100) / 100, saldoTotal: fin.saldoTotal, financeiro: fin };
}
