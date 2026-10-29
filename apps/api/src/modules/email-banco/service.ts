/**
 * ROBÔ DE E-MAIL DOS BANCOS
 *
 * Lê as caixas da loja, transforma aviso de banco em TransacaoBancaria (fonte EMAIL)
 * e, quando o casamento é certo, deixa a conciliação existente dar a baixa.
 *
 * As três travas que mantêm isso seguro:
 *   1. Só remetente que está na lista de regras vira lançamento.
 *   2. E-mail reprovado no DKIM/SPF nunca vira lançamento — vira pendência.
 *      Phishing imitando SumUp e Cora é comum, e um robô ingênuo seria a porta.
 *   3. Baixa automática só no casamento 1:1. Qualquer dúvida vira pendência
 *      na tela de conciliação, para uma pessoa decidir.
 */
import { subDays } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { arredondar } from '../../lib/util.js';
import { lerCaixa, type MensagemEmail } from '../../integracoes/email/index.js';
import { gravarTransacoes, sugerirConciliacao, conciliar } from '../bancos/service.js';
import { aplicarParser, normalizarRemetente, type NomeParser, type EventoBancario } from './parsers.js';

export interface ResultadoRodada {
  caixasLidas: number;
  mensagensVistas: number;
  importadas: number;
  baixasAutomaticas: number;
  pendentes: number;
  erros: { caixa: string; erro: string }[];
}

export async function obterConfig() {
  const existente = await prisma.emailBancoConfig.findUnique({ where: { id: 1 } });
  if (existente) return existente;
  return prisma.emailBancoConfig.create({ data: { id: 1 } });
}

/** Acha a regra que vale para este remetente (endereço exato ganha do domínio). */
export async function regraPara(de: string) {
  const { endereco, dominio } = normalizarRemetente(de);
  const regras = await prisma.emailBancoRegra.findMany({
    where: { ativo: true },
    orderBy: [{ ordem: 'asc' }, { id: 'asc' }],
  });
  const exata = regras.find((r) => r.remetente.toLowerCase() === endereco);
  if (exata) return exata;
  return regras.find((r) => r.remetente.toLowerCase() === dominio) ?? null;
}

/**
 * Tenta casar o evento com uma conta em aberto e dar a baixa.
 * Devolve true só quando deu baixa de verdade.
 *
 * Caminho 1 — o aviso cita o pedido (caso do Asaas): casa direto, sem adivinhar.
 * Caminho 2 — valor bate exatamente com UMA única conta em aberto.
 * Em qualquer outro caso devolve false e a transação fica pendente.
 */
export async function tentarBaixa(transacaoId: number, evento: EventoBancario): Promise<boolean> {
  // Caminho 1: referência explícita a um pedido
  const numeroPedido = evento.referencia ? /Pedido\s+(\d+)/i.exec(evento.referencia)?.[1] : null;
  if (numeroPedido) {
    const venda = await prisma.venda.findFirst({
      where: { tipo: 'PEDIDO', numero: Number(numeroPedido) },
      select: { id: true },
    });
    if (venda) {
      const contas = await prisma.contaReceber.findMany({
        where: { origemTipo: 'VENDA', origemId: venda.id, situacao: { in: ['ABERTO', 'PARCIAL'] } },
      });
      const alvo = Math.abs(evento.valor);
      const casadas = contas.filter((c) => {
        const resto = arredondar(c.valor - c.valorRecebido - c.desconto);
        return Math.abs(resto - alvo) < 0.01;
      });
      if (casadas.length === 1) {
        await conciliar(transacaoId, { tipo: 'RECEBER', id: casadas[0].id });
        return true;
      }
    }
  }

  // Caminho 2: uma única conta em aberto com o valor exato
  const sugestoes = await sugerirConciliacao({ valor: evento.valor, data: evento.data, tipo: evento.tipo });
  const exatas = sugestoes.filter((s) => s.score >= 1.0);
  if (exatas.length === 1) {
    await conciliar(transacaoId, { tipo: exatas[0].tipo, id: exatas[0].id });
    return true;
  }

  return false;
}

/** Processa uma mensagem já lida. Devolve o que aconteceu com ela. */
export async function processarMensagem(
  msg: MensagemEmail,
  caixaId: number,
  opcoes: { baixaAutomatica: boolean },
): Promise<'IMPORTADO' | 'BAIXADO' | 'SEM_REGRA' | 'SEM_DADOS' | 'REMETENTE_SUSPEITO' | 'JA_VISTO' | 'ERRO'> {
  // o Message-ID é único no mundo: o mesmo aviso caindo em duas caixas entra uma vez só
  const jaVisto = await prisma.emailBancoMensagem.findUnique({ where: { messageId: msg.messageId } });
  if (jaVisto) return 'JA_VISTO';

  const registrar = (situacao: string, motivo?: string | null, transacaoId?: number | null, valor?: number | null) =>
    prisma.emailBancoMensagem.create({
      data: {
        caixaId,
        messageId: msg.messageId,
        remetente: normalizarRemetente(msg.de).endereco,
        assunto: msg.assunto.slice(0, 300),
        recebidoEm: msg.data,
        situacao,
        motivo: motivo?.slice(0, 300) ?? null,
        transacaoId: transacaoId ?? null,
        valor: valor ?? null,
      },
    });

  const regra = await regraPara(msg.de);
  if (!regra) {
    await registrar('SEM_REGRA', 'Remetente não está na lista de bancos.');
    return 'SEM_REGRA';
  }

  // trava contra phishing: aviso que não passou na verificação de origem não vira dinheiro
  if (msg.autenticado === false) {
    await registrar('REMETENTE_SUSPEITO', 'Reprovado no DKIM/SPF — pode ser falsificado.');
    return 'REMETENTE_SUSPEITO';
  }

  let evento: EventoBancario | null = null;
  try {
    evento = aplicarParser(regra.parser as NomeParser, msg.texto, msg.messageId, msg.assunto);
  } catch (e: any) {
    await registrar('ERRO', String(e?.message || e));
    return 'ERRO';
  }

  if (!evento) {
    const temAnexo = msg.anexos.length > 0;
    await registrar(
      'SEM_DADOS',
      temAnexo ? `Dados devem estar no anexo (${msg.anexos.join(', ')}).` : 'Não é um aviso de movimento.',
    );
    return 'SEM_DADOS';
  }

  if (!regra.contaFinanceiraId) {
    await registrar('SEM_DADOS', 'Regra sem conta financeira definida.', null, evento.valor);
    return 'SEM_DADOS';
  }

  await gravarTransacoes(
    regra.contaFinanceiraId,
    [
      {
        externalId: evento.externalId,
        data: evento.data,
        descricao: evento.descricao,
        valor: evento.valor,
        tipo: evento.tipo,
        bruto: { ...(evento.bruto as object), contraparte: evento.contraparte, referencia: evento.referencia, messageId: msg.messageId },
      },
    ],
    'EMAIL',
  );

  const transacao = await prisma.transacaoBancaria.findUnique({
    where: { contaFinanceiraId_externalId: { contaFinanceiraId: regra.contaFinanceiraId, externalId: evento.externalId } },
  });
  if (!transacao) {
    await registrar('ERRO', 'Transação não encontrada após gravar.', null, evento.valor);
    return 'ERRO';
  }

  let baixou = false;
  if (opcoes.baixaAutomatica && !transacao.conciliado) {
    try {
      baixou = await tentarBaixa(transacao.id, evento);
    } catch {
      baixou = false; // baixa é oportunista: falhou, fica pendente para alguém olhar
    }
  }

  await registrar(
    'IMPORTADO',
    baixou ? 'Baixa automática (casamento exato).' : 'Aguardando conciliação.',
    transacao.id,
    evento.valor,
  );
  return baixou ? 'BAIXADO' : 'IMPORTADO';
}

/** Uma rodada completa: todas as caixas ativas. */
export async function rodarRobo(): Promise<ResultadoRodada> {
  const cfg = await obterConfig();
  const out: ResultadoRodada = { caixasLidas: 0, mensagensVistas: 0, importadas: 0, baixasAutomaticas: 0, pendentes: 0, erros: [] };
  if (!cfg.ligado) return out;

  const caixas = await prisma.emailBancoCaixa.findMany({ where: { ativo: true } });
  for (const caixa of caixas) {
    const segredo = decrypt(caixa.segredo);
    if (!segredo) {
      out.erros.push({ caixa: caixa.endereco, erro: 'Sem senha/token configurado.' });
      continue;
    }
    // relê 2 dias para trás: e-mail às vezes demora a chegar
    const desde = caixa.ultimaLeituraEm ? subDays(caixa.ultimaLeituraEm, 2) : subDays(new Date(), cfg.diasIniciais);
    try {
      const mensagens = await lerCaixa(
        { tipo: caixa.tipo, endereco: caixa.endereco, host: caixa.host, porta: caixa.porta, usuario: caixa.usuario, segredo, pasta: caixa.pasta },
        desde,
      );
      out.caixasLidas += 1;
      out.mensagensVistas += mensagens.length;
      for (const msg of mensagens) {
        const r = await processarMensagem(msg, caixa.id, { baixaAutomatica: cfg.baixaAutomatica });
        if (r === 'IMPORTADO') { out.importadas += 1; out.pendentes += 1; }
        if (r === 'BAIXADO') { out.importadas += 1; out.baixasAutomaticas += 1; }
      }
      await prisma.emailBancoCaixa.update({ where: { id: caixa.id }, data: { ultimaLeituraEm: new Date(), ultimoErro: null } });
    } catch (e: any) {
      const erro = String(e?.message || e).slice(0, 280);
      out.erros.push({ caixa: caixa.endereco, erro });
      await prisma.emailBancoCaixa.update({ where: { id: caixa.id }, data: { ultimoErro: erro } });
    }
  }

  await prisma.emailBancoConfig.update({
    where: { id: 1 },
    data: { ultimaRodadaEm: new Date(), ultimoErro: out.erros.length ? out.erros.map((e) => `${e.caixa}: ${e.erro}`).join(' | ').slice(0, 500) : null },
  });
  return out;
}
