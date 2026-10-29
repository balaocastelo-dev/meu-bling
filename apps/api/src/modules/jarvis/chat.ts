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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditar } from '../../lib/auditoria.js';
import { calcularCaixaLivre } from './caixa-livre.js';
import { conversarComFerramentas, SISTEMA_CHAT, type Mensagem as MensagemIa } from './ia.js';
import { executarFerramenta, ferramentasParaIa } from './ferramentas.js';
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
  /** o que ele fez de fato nesta volta (ferramentas que mexeram no sistema) */
  fez: string[];
  /** o que ele quer fazer mas precisa da sua confirmação */
  pendentes: { nome: string; descricao: string; argumentos: Record<string, unknown> }[];
};

/** Até quantas voltas de ferramenta numa resposta só (evita laço infinito e gasto). */
const MAX_VOLTAS = 6;

/**
 * Manda uma mensagem na conversa (criando-a se `conversaId` vier nulo) e devolve a resposta.
 * O JARVIS pode consultar o sistema e criar coisas reversíveis sozinho; o que mexe em
 * dinheiro ou fala com cliente volta como pendente, para o gestor confirmar.
 */
export async function conversar(p: {
  conversaId: number | null;
  pergunta: string;
  usuarioId: number | null;
  usuarioNome?: string | null;
  app?: FastifyInstance;
  req?: FastifyRequest;
  /** true quando o gestor apertou "pode fazer" para uma ação pendente */
  permitirTudo?: boolean;
}): Promise<RespostaChat> {
  let conversa = p.conversaId
    ? await prisma.jarvisConversa.findUnique({ where: { id: p.conversaId } })
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

  const abertura =
    `Números da loja agora:\n${JSON.stringify(contexto, null, 1).slice(0, 14_000)}\n\n` +
    (historico ? `Conversa até aqui:\n${historico}\n\n` : '') +
    `${p.usuarioNome || 'Gestor'}: ${p.pergunta}`;

  const podeFerramentas = !!(p.app && p.req);
  const mensagens: MensagemIa[] = [{ role: 'user', content: abertura }];
  const fez: string[] = [];
  const pendentes: RespostaChat['pendentes'] = [];
  let texto = '';
  let tokens = 0;
  let semIa = false;

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    const r = await conversarComFerramentas({
      sistema: SISTEMA_CHAT,
      mensagens,
      ferramentas: podeFerramentas ? ferramentasParaIa() : [],
      maxTokens: 3000,
    });

    if (!r) {
      semIa = true;
      break;
    }
    tokens += r.tokens;
    if (r.texto) texto = r.texto;
    if (r.usos.length === 0) break;

    // a IA pediu ferramentas: executa e devolve os resultados
    mensagens.push({ role: 'assistant', content: r.conteudo });
    const resultados: any[] = [];

    for (const uso of r.usos) {
      const res = await executarFerramenta(p.app!, p.req!, uso.nome, uso.argumentos, {
        permitirTudo: p.permitirTudo,
      });
      if (res.pendente) pendentes.push(res.pendente);
      else if (res.risco !== 'LIVRE' && res.ok) fez.push(`${uso.nome}: ${res.texto.slice(0, 160)}`);

      if (res.risco !== 'LIVRE') {
        await auditar(p.req ?? null, 'JarvisFerramenta', conversa.id, 'ACAO', {
          ferramenta: uso.nome,
          risco: res.risco,
          executada: !res.pendente,
          ok: res.ok,
        });
      }

      resultados.push({
        type: 'tool_result',
        tool_use_id: uso.id,
        is_error: !res.ok,
        content: res.texto.slice(0, 20_000),
      });
    }
    mensagens.push({ role: 'user', content: resultados });
  }

  if (!texto) {
    texto = semIa
      ? 'A IA não está respondendo agora. Confira a chave da Anthropic em Configurações → JARVIS — ' +
        'enquanto isso, as sugestões do painel continuam sendo calculadas normalmente.'
      : 'Fiz o que dava, mas não consegui montar uma resposta. Tente perguntar de outro jeito.';
  }

  await prisma.jarvisMensagem.create({
    data: {
      conversaId: conversa.id,
      papel: 'jarvis',
      texto,
      contexto: JSON.stringify({ caixaLivre: contexto.caixaLivre, tokens, semIa, fez, pendentes: pendentes.length }),
    },
  });
  await prisma.jarvisConversa.update({ where: { id: conversa.id }, data: { atualizadaEm: new Date() } });

  return { conversaId: conversa.id, titulo: conversa.titulo, resposta: texto, tokens, em: new Date(), fez, pendentes };
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
