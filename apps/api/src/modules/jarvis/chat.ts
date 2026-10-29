/**
 * JARVIS — o chat do gestor.
 *
 * Diferente da pergunta solta: a conversa tem fio. Cada mensagem vai para a IA junto com
 * as anteriores e com os números da loja do momento, então dá para ir pedindo as coisas
 * em sequência ("e desse jeito?", "então faz assim") sem repetir o contexto.
 *
 * O JARVIS responde com o que sabe do sistema. Quando a pergunta pede um dado que ele não
 * tem na mão, ele diz qual falta em vez de inventar.
 */
import { prisma } from '../../lib/prisma.js';
import { calcularCaixaLivre } from './caixa-livre.js';
import { perguntarIa, SISTEMA_PERGUNTA } from './ia.js';
import { obterConfig } from './worker.js';

/** Até onde o fio da conversa volta (mensagens, não pares). */
const MEMORIA_MENSAGENS = 20;

const tituloDe = (texto: string) => {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length <= 60 ? limpo : limpo.slice(0, 57) + '…';
};

/** Os números da loja que vão com toda pergunta. */
export async function contextoDaLoja() {
  const cfg = await obterConfig();
  const [caixa, abertas, ultimasDecisoes] = await Promise.all([
    calcularCaixaLivre(),
    prisma.jarvisSugestao.findMany({
      where: { situacao: 'ABERTA' },
      orderBy: { prioridade: 'asc' },
      take: 25,
      select: { id: true, regra: true, titulo: true, texto: true, impactoEstimado: true, prioridade: true },
    }),
    prisma.jarvisSugestao.findMany({
      where: { situacao: { in: ['ACEITA', 'RECUSADA'] } },
      orderBy: { decididaEm: 'desc' },
      take: 10,
      select: { titulo: true, situacao: true, motivo: true, decididaEm: true },
    }),
  ]);

  return {
    hoje: new Date().toISOString().slice(0, 10),
    caixaLivre: caixa.caixaLivre,
    compromissosTotais: caixa.compromissosTotais,
    meta: cfg.metaCaixa,
    faltaParaMeta: Math.max(0, cfg.metaCaixa - caixa.caixaLivre),
    saldoBancos: caixa.saldoBancos,
    saldoCaixa: caixa.saldoCaixa,
    aPagarProximos30Dias: caixa.aPagar30d,
    caixinhasAtrasadas: caixa.caixinhasDevidas,
    caixinhasAGuardarDepois: caixa.caixinhasFuturas,
    emprestimosVencendoEm30Dias: caixa.emprestimos30d,
    emprestimosDepois: caixa.emprestimosDepois,
    contas: caixa.detalhes.contas,
    sugestoesAbertas: abertas,
    ultimasDecisoes,
  };
}

/** Abre uma conversa nova com a primeira pergunta. */
export async function abrirConversa(usuarioId: number | null, pergunta: string) {
  return prisma.jarvisConversa.create({
    data: {
      usuarioId,
      titulo: tituloDe(pergunta),
      mensagens: { create: { papel: 'usuario', texto: pergunta } },
    },
    include: { mensagens: true },
  });
}

export type RespostaChat = {
  conversaId: number;
  titulo: string;
  resposta: string;
  tokens: number;
  em: Date;
};

/**
 * Manda uma mensagem na conversa (criando-a se `conversaId` vier nulo) e devolve a resposta.
 * Lança erro de negócio quando a IA não está configurada — quem chama transforma em 422.
 */
export async function conversar(p: {
  conversaId: number | null;
  pergunta: string;
  usuarioId: number | null;
  usuarioNome?: string | null;
}): Promise<RespostaChat> {
  let conversa = p.conversaId
    ? await prisma.jarvisConversa.findUnique({
        where: { id: p.conversaId },
        include: { mensagens: { orderBy: { em: 'asc' }, take: MEMORIA_MENSAGENS } },
      })
    : null;

  if (!conversa) {
    conversa = await abrirConversa(p.usuarioId, p.pergunta);
  } else {
    await prisma.jarvisMensagem.create({ data: { conversaId: conversa.id, papel: 'usuario', texto: p.pergunta } });
  }

  // o fio da conversa, do mais antigo para o mais novo
  const anteriores = await prisma.jarvisMensagem.findMany({
    where: { conversaId: conversa.id },
    orderBy: { em: 'desc' },
    take: MEMORIA_MENSAGENS,
    select: { papel: true, texto: true },
  });
  anteriores.reverse();

  const contexto = await contextoDaLoja();

  const historico = anteriores
    .slice(0, -1) // a última é a pergunta de agora
    .map((m) => `${m.papel === 'usuario' ? (p.usuarioNome || 'Gestor') : 'JARVIS'}: ${m.texto}`)
    .join('\n');

  const prompt =
    `Números da loja agora:\n${JSON.stringify(contexto, null, 1).slice(0, 18_000)}\n\n` +
    (historico ? `Conversa até aqui:\n${historico}\n\n` : '') +
    `${p.usuarioNome || 'Gestor'}: ${p.pergunta}`;

  const r = await perguntarIa(SISTEMA_PERGUNTA, prompt, { maxTokens: 1500 });

  const texto =
    r?.texto ??
    'A IA não está respondendo agora. Confira a chave da Anthropic em Configurações → JARVIS — ' +
      'enquanto isso, as sugestões do painel continuam sendo calculadas normalmente.';

  await prisma.jarvisMensagem.create({
    data: {
      conversaId: conversa.id,
      papel: 'jarvis',
      texto,
      contexto: JSON.stringify({ caixaLivre: contexto.caixaLivre, tokens: r?.tokens ?? 0, semIa: !r }),
    },
  });
  await prisma.jarvisConversa.update({ where: { id: conversa.id }, data: { atualizadaEm: new Date() } });

  return {
    conversaId: conversa.id,
    titulo: conversa.titulo,
    resposta: texto,
    tokens: r?.tokens ?? 0,
    em: new Date(),
  };
}

/** Lista as conversas do gestor, mais recentes primeiro. */
export async function listarConversas(usuarioId: number | null, limite = 20) {
  const conversas = await prisma.jarvisConversa.findMany({
    where: { arquivada: false, ...(usuarioId ? { usuarioId } : {}) },
    orderBy: { atualizadaEm: 'desc' },
    take: limite,
    select: {
      id: true,
      titulo: true,
      em: true,
      atualizadaEm: true,
      _count: { select: { mensagens: true } },
    },
  });
  return conversas.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    em: c.em,
    atualizadaEm: c.atualizadaEm,
    mensagens: c._count.mensagens,
  }));
}

/** Abre uma conversa inteira para a tela. */
export async function lerConversa(id: number) {
  return prisma.jarvisConversa.findUnique({
    where: { id },
    include: { mensagens: { orderBy: { em: 'asc' }, select: { id: true, papel: true, texto: true, em: true } } },
  });
}
