/**
 * Importa lançamentos que JÁ foram registrados pelo caminho normal (conta a pagar/receber
 * ou transferência) e só entram na fila de revisão, ligados ao que já existe.
 * Não cria movimento e não altera saldo. O mesmo emailOrigemId não duplica.
 *
 * Formato do arquivo (lancamentos-futrico.json):
 *   TRANSFERENCIA — origemContaId, destinoContaId, movimentoSaidaId, movimentoEntradaId
 *   PAGAR         — sistemaId = conta a pagar; contaFinanceiraId pode ser null se ainda está aberta
 *   RECEBER       — sistemaId = conta a receber
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar, toDate } from '../../lib/util.js';
import { chaveContraparte } from './service.js';

export interface ItemArquivo {
  emailOrigemId: string;
  sistemaId?: number | null;
  movimentoSaidaId?: number | null;
  movimentoEntradaId?: number | null;
  contaPagarCanceladaId?: number | null;
  tipo: string;
  valor: number;
  data: string;
  contraparte: string;
  origemContaId?: number | null;
  destinoContaId?: number | null;
  contaFinanceiraId?: number | null;
  categoriaId?: number | null;
  emailOrigemUrl?: string | null;
  descricao?: string | null;
  situacao?: string;
  status?: string;
}

export interface LinhaImportacao {
  emailOrigemId: string;
  tipo: 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA';
  data: Date;
  valor: number;
  contraparte: string;
  contraparteChave: string;
  contaFinanceiraId: number | null;
  contaDestinoId: number | null;
  categoriaId: number | null;
  emailOrigemUrl: string | null;
  descricao: string | null;
  movimentoId: number | null;
  movimentoEntradaId: number | null;
  contaPagarId: number | null;
  contaReceberId: number | null;
  contaPagarCanceladaId: number | null;
}

/** Traduz um item do arquivo para o que será gravado. Não consulta o banco. */
export function interpretarItem(bruto: ItemArquivo): LinhaImportacao {
  const emailOrigemId = String(bruto.emailOrigemId || '').trim();
  if (!emailOrigemId) throw new AppError('Item sem ID do e-mail.', 422, 'EMAIL_OBRIGATORIO');
  const contraparte = String(bruto.contraparte || '').trim();
  const contraparteChave = chaveContraparte(contraparte);
  if (contraparteChave.length < 2) throw new AppError('Item sem quem pagou ou recebeu.', 422, 'CONTRAPARTE_OBRIGATORIA');
  const data = toDate(bruto.data);
  if (!data) throw new AppError('Data inválida.', 422, 'DATA_INVALIDA');
  const valor = arredondar(Number(bruto.valor));
  if (!(valor > 0)) throw new AppError('Valor deve ser maior que zero.', 422, 'VALOR_INVALIDO');
  const tipoBruto = String(bruto.tipo || '').toUpperCase();
  const base = {
    emailOrigemId,
    data,
    valor,
    contraparte,
    contraparteChave,
    emailOrigemUrl: bruto.emailOrigemUrl?.trim() || null,
    descricao: bruto.descricao?.trim() || null,
    contaPagarCanceladaId: bruto.contaPagarCanceladaId ?? null,
  };
  if (tipoBruto === 'TRANSFERENCIA') {
    if (!bruto.origemContaId || !bruto.destinoContaId) throw new AppError('Transferência sem conta de origem ou destino.', 422, 'CONTAS_OBRIGATORIAS');
    if (!bruto.movimentoSaidaId || !bruto.movimentoEntradaId) throw new AppError('Transferência sem os dois movimentos já lançados.', 422, 'MOVIMENTOS_OBRIGATORIOS');
    return {
      ...base,
      tipo: 'TRANSFERENCIA',
      contaFinanceiraId: bruto.origemContaId,
      contaDestinoId: bruto.destinoContaId,
      categoriaId: null,
      movimentoId: bruto.movimentoSaidaId,
      movimentoEntradaId: bruto.movimentoEntradaId,
      contaPagarId: null,
      contaReceberId: null,
    };
  }
  if (tipoBruto === 'PAGAR' || tipoBruto === 'SAIDA') {
    if (!bruto.sistemaId && tipoBruto === 'PAGAR') throw new AppError('Conta a pagar sem sistemaId.', 422, 'TITULO_OBRIGATORIO');
    return {
      ...base,
      tipo: 'SAIDA',
      contaFinanceiraId: bruto.contaFinanceiraId ?? null,
      contaDestinoId: null,
      categoriaId: bruto.categoriaId ?? null,
      movimentoId: null,
      movimentoEntradaId: null,
      contaPagarId: bruto.sistemaId ?? null,
      contaReceberId: null,
    };
  }
  if (tipoBruto === 'RECEBER' || tipoBruto === 'ENTRADA') {
    if (!bruto.sistemaId && tipoBruto === 'RECEBER') throw new AppError('Conta a receber sem sistemaId.', 422, 'TITULO_OBRIGATORIO');
    return {
      ...base,
      tipo: 'ENTRADA',
      contaFinanceiraId: bruto.contaFinanceiraId ?? null,
      contaDestinoId: null,
      categoriaId: bruto.categoriaId ?? null,
      movimentoId: null,
      movimentoEntradaId: null,
      contaPagarId: null,
      contaReceberId: bruto.sistemaId ?? null,
    };
  }
  throw new AppError(`Tipo desconhecido: ${bruto.tipo}`, 422, 'TIPO_INVALIDO');
}

async function conferirExistente(l: LinhaImportacao) {
  if (l.contaFinanceiraId) {
    const c = await prisma.contaFinanceira.findUnique({ where: { id: l.contaFinanceiraId }, select: { id: true } });
    if (!c) throw new AppError(`Conta financeira #${l.contaFinanceiraId} não existe neste banco.`, 422, 'CONTA_INEXISTENTE');
  }
  if (l.contaDestinoId) {
    const c = await prisma.contaFinanceira.findUnique({ where: { id: l.contaDestinoId }, select: { id: true } });
    if (!c) throw new AppError(`Conta de destino #${l.contaDestinoId} não existe neste banco.`, 422, 'CONTA_INEXISTENTE');
  }
  if (l.categoriaId) {
    const c = await prisma.categoriaFinanceira.findUnique({ where: { id: l.categoriaId }, select: { id: true } });
    if (!c) throw new AppError(`Categoria #${l.categoriaId} não existe neste banco.`, 422, 'CATEGORIA_INEXISTENTE');
  }
  if (l.contaPagarId) {
    const c = await prisma.contaPagar.findUnique({ where: { id: l.contaPagarId }, select: { id: true, valor: true } });
    if (!c) throw new AppError(`Conta a pagar #${l.contaPagarId} não existe neste banco.`, 422, 'TITULO_INEXISTENTE');
    if (Math.abs(c.valor - l.valor) > 0.02) throw new AppError(`Conta a pagar #${l.contaPagarId} tem valor diferente do e-mail.`, 422, 'VALOR_DIVERGENTE');
  }
  if (l.contaReceberId) {
    const c = await prisma.contaReceber.findUnique({ where: { id: l.contaReceberId }, select: { id: true, valor: true } });
    if (!c) throw new AppError(`Conta a receber #${l.contaReceberId} não existe neste banco.`, 422, 'TITULO_INEXISTENTE');
    if (Math.abs(c.valor - l.valor) > 0.02) throw new AppError(`Conta a receber #${l.contaReceberId} tem valor diferente do e-mail.`, 422, 'VALOR_DIVERGENTE');
  }
  if (l.movimentoId) {
    const m = await prisma.movimentoFinanceiro.findUnique({ where: { id: l.movimentoId }, select: { id: true, tipo: true, valor: true, contaFinanceiraId: true, categoriaId: true } });
    if (!m) throw new AppError(`Movimento #${l.movimentoId} não existe neste banco.`, 422, 'MOVIMENTO_INEXISTENTE');
    if (m.tipo !== 'SAIDA') throw new AppError(`Movimento #${l.movimentoId} não é uma saída.`, 422, 'MOVIMENTO_TIPO');
    if (l.contaFinanceiraId && m.contaFinanceiraId !== l.contaFinanceiraId) throw new AppError(`Movimento #${l.movimentoId} não está na conta de origem.`, 422, 'MOVIMENTO_CONTA');
    if (Math.abs(m.valor - l.valor) > 0.02) throw new AppError(`Movimento #${l.movimentoId} tem valor diferente do e-mail.`, 422, 'VALOR_DIVERGENTE');
  }
  if (l.movimentoEntradaId) {
    const m = await prisma.movimentoFinanceiro.findUnique({ where: { id: l.movimentoEntradaId }, select: { id: true, tipo: true, valor: true, contaFinanceiraId: true } });
    if (!m) throw new AppError(`Movimento #${l.movimentoEntradaId} não existe neste banco.`, 422, 'MOVIMENTO_INEXISTENTE');
    if (m.tipo !== 'ENTRADA') throw new AppError(`Movimento #${l.movimentoEntradaId} não é uma entrada.`, 422, 'MOVIMENTO_TIPO');
    if (l.contaDestinoId && m.contaFinanceiraId !== l.contaDestinoId) throw new AppError(`Movimento #${l.movimentoEntradaId} não está na conta de destino.`, 422, 'MOVIMENTO_CONTA');
    if (Math.abs(m.valor - l.valor) > 0.02) throw new AppError(`Movimento #${l.movimentoEntradaId} tem valor diferente do e-mail.`, 422, 'VALOR_DIVERGENTE');
  }
}

export interface ResultadoImportacao {
  criados: number;
  idempotentes: number;
  erros: { emailOrigemId: string; erro: string; code: string }[];
}

/**
 * Grava a fila apontando para os registros que já existem. Cada e-mail é independente:
 * um id que não está neste banco vira erro da linha e os outros seguem. Repetir não duplica.
 */
export async function importarJaLancados(
  itens: ItemArquivo[],
  origem: { botNome: string; chaveApiId?: number | null },
): Promise<ResultadoImportacao> {
  const out: ResultadoImportacao = { criados: 0, idempotentes: 0, erros: [] };
  for (const bruto of itens) {
    const email = String(bruto?.emailOrigemId || '').trim() || '(sem id)';
    try {
      const l = interpretarItem(bruto);
      const ja = await prisma.lancamentoAutomatico.findUnique({ where: { emailOrigemId: l.emailOrigemId }, select: { id: true } });
      if (ja) {
        out.idempotentes += 1;
        continue;
      }
      await conferirExistente(l);
      await prisma.lancamentoAutomatico.create({
        data: {
          tipo: l.tipo,
          data: l.data,
          valor: l.valor,
          contaFinanceiraId: l.contaFinanceiraId,
          contaDestinoId: l.contaDestinoId,
          contraparte: l.contraparte,
          contraparteChave: l.contraparteChave,
          categoriaId: l.categoriaId,
          emailOrigemId: l.emailOrigemId,
          emailOrigemUrl: l.emailOrigemUrl,
          descricao: l.descricao,
          botNome: origem.botNome,
          chaveApiId: origem.chaveApiId ?? null,
          status: 'PENDENTE',
          jaLancado: true,
          movimentoId: l.movimentoId,
          movimentoEntradaId: l.movimentoEntradaId,
          contaPagarId: l.contaPagarId,
          contaReceberId: l.contaReceberId,
          contaPagarCanceladaId: l.contaPagarCanceladaId,
        },
      });
      out.criados += 1;
    } catch (e) {
      let code = e instanceof AppError ? e.code : 'ERRO';
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const alvo = JSON.stringify(e.meta?.target ?? '');
        if (alvo.includes('emailOrigemId')) {
          out.idempotentes += 1;
          continue;
        }
        code = 'DUPLICADO';
      }
      out.erros.push({ emailOrigemId: email, erro: e instanceof Error ? e.message : String(e), code });
    }
  }
  return out;
}
