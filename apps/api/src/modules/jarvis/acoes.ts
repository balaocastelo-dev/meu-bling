/**
 * JARVIS — as ações de 1 clique.
 *
 * Aceitar uma sugestão não é só marcar "aceita": é o JARVIS fazer o trabalho.
 *   COBRAR_WHATSAPP  → enfileira a cobrança de cada conta vencida (mesma fila do resto do sistema)
 *   AVISAR_PRONTO    → avisa cada cliente que o conserto está pronto para retirar
 *   DESCONTO_LOTE    → baixa o preço dos produtos parados e cria o desafio para os vendedores
 *   CRIAR_CAIXINHA / ABRIR_TELA / NENHUMA → não executam nada, só levam o gestor para a tela certa
 *
 * Tudo é idempotente e auditado; nada aqui move dinheiro sozinho.
 */
import { prisma } from '../../lib/prisma.js';
import { renderTemplate } from '../../lib/util.js';
import { enfileirar, montarVariaveis, type Canal } from '../notificacoes/service.js';
import { status as statusWhatsapp } from '../../integracoes/whatsapp/provedor.js';

export type ResultadoAcao = { ok: boolean; mensagem: string; detalhes?: Record<string, unknown> };

const reais = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const arred = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ cobrança
// variáveis do evento CONTA (ver VARIAVEIS_POR_EVENTO em notificacoes/service.ts):
// descricao, total (saldo em aberto), vencimento, numero, cliente.*, empresa.*
const TEXTO_COBRANCA =
  'Olá {{cliente.primeiroNome}}, tudo bem? Aqui é da {{empresa.nome}}.\n' +
  'Consta em aberto: {{descricao}} — {{total}}, que venceu em {{vencimento}}.\n' +
  'Se já pagou, pode desconsiderar esta mensagem. Se precisar, é só responder por aqui que a gente combina do seu jeito.';

/**
 * Enfileira a cobrança das contas vencidas da sugestão. Usa o template de cobrança da loja
 * quando existir (evento COBRANCA ou CONTA_VENCENDO); senão, usa o texto padrão acima.
 * Não cobra a mesma conta duas vezes no mesmo dia.
 */
export async function cobrarPorWhatsapp(dados: any): Promise<ResultadoAcao> {
  const contas: { id: number }[] = Array.isArray(dados?.contas) ? dados.contas : [];
  if (contas.length === 0) return { ok: false, mensagem: 'Nenhuma conta nessa sugestão para cobrar.' };

  const wpp = await statusWhatsapp();
  const templates = await prisma.templateNotificacao.findMany({
    where: { ativo: true, evento: { in: ['COBRANCA', 'CONTA_VENCENDO'] }, canal: 'WHATSAPP' },
    orderBy: { evento: 'asc' },
  });
  const template = templates.find((t) => t.evento === 'COBRANCA') ?? templates[0] ?? null;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  let enfileiradas = 0;
  let semCelular = 0;
  let repetidas = 0;

  for (const ref of contas.slice(0, 100)) {
    const conta = await prisma.contaReceber.findUnique({
      where: { id: ref.id },
      select: {
        id: true,
        situacao: true,
        contatoId: true,
        contato: { select: { celular: true } },
      },
    });
    if (!conta || !['ABERTO', 'PARCIAL'].includes(conta.situacao)) continue; // já foi paga

    const celular = conta.contato?.celular?.trim();
    if (!celular) {
      semCelular++;
      continue;
    }

    const jaHoje = await prisma.notificacao.findFirst({
      where: { origemTipo: 'CONTA', origemId: conta.id, canal: 'WHATSAPP', criadoEm: { gte: inicioDoDia } },
      select: { id: true },
    });
    if (jaHoje) {
      repetidas++;
      continue;
    }

    const m = await montarVariaveis('CONTA', conta.id);
    const corpo = renderTemplate(template?.corpo ?? TEXTO_COBRANCA, { ...m.vars, itens: '' });

    await enfileirar({
      canal: 'WHATSAPP' as Canal,
      destinatario: celular,
      corpo,
      contatoId: conta.contatoId,
      origemTipo: 'CONTA',
      origemId: conta.id,
    });
    enfileiradas++;
  }

  const partes = enfileiradas > 0 ? [`${enfileiradas} cobrança(s) na fila do WhatsApp`] : [];
  if (repetidas) partes.push(`${repetidas} já tinham sido cobradas hoje`);
  if (semCelular) partes.push(`${semCelular} sem celular cadastrado`);
  if (enfileiradas > 0 && wpp.status !== 'CONECTADO')
    partes.push('o WhatsApp está desconectado — as mensagens saem assim que ele voltar (Comunicação → WhatsApp)');

  // "já cobrei todo mundo hoje" não é erro: a sugestão pode ser aceita do mesmo jeito.
  // Só é falha quando não havia ninguém a quem mandar.
  const fezAlgo = enfileiradas > 0 || repetidas > 0;

  return {
    ok: fezAlgo,
    mensagem: partes.length
      ? partes.join('; ') + '.'
      : 'Nenhum desses clientes tem celular cadastrado — não deu para cobrar por aqui.',
    detalhes: { enfileiradas, repetidas, semCelular, whatsapp: wpp.status, template: template?.nome ?? 'texto padrão' },
  };
}

// ------------------------------------------------------------------ avisar que está pronto
// variáveis do evento OS (ver VARIAVEIS_POR_EVENTO): numero, equipamento, total, link,
// cliente.*, empresa.* — o link leva à página pública de acompanhamento da OS.
// É um LEMBRETE, não o anúncio: a loja já avisa "ficou pronto" na hora em que a
// situação muda. Esta mensagem vai dias depois, para quem foi avisado e não voltou —
// por isso o texto não repete a novidade, lembra que o aparelho continua esperando.
const TEXTO_PRONTO =
  'Olá {{cliente.primeiroNome}}, tudo bem? Aqui é da {{empresa.nome}}.\n' +
  'Passando para lembrar que seu {{equipamento}} já está pronto e continua aqui, esperando a retirada. OS nº {{numero}} — {{total}}.\n' +
  'Estamos em {{empresa.endereco}}. Se precisar combinar um horário, é só responder por aqui.';

/**
 * Avisa pelo WhatsApp cada cliente com conserto pronto na prateleira.
 *
 * Três cuidados, porque isso fala com cliente de verdade:
 * 1. relê cada OS antes de mandar — se o cliente já retirou entre a sugestão e o clique,
 *    ninguém recebe "venha buscar" depois de ter buscado;
 * 2. não avisa a mesma OS duas vezes no mesmo dia;
 * 3. usa um template da loja só quando existe um feito para LEMBRETE (nome fala de
 *    lembrete); o template de "ficou pronto" é o anúncio da hora — repetido dias
 *    depois soaria como se o conserto tivesse acabado agora.
 */
export async function avisarProntoWhatsapp(dados: any): Promise<ResultadoAcao> {
  const ordens: { id: number }[] = Array.isArray(dados?.ordens) ? dados.ordens : [];
  if (ordens.length === 0) return { ok: false, mensagem: 'Nenhuma ordem de serviço nessa sugestão para avisar.' };

  const wpp = await statusWhatsapp();
  const candidatos = await prisma.templateNotificacao.findMany({
    where: { ativo: true, canal: 'WHATSAPP', evento: 'OS_SITUACAO' },
    orderBy: { id: 'asc' },
  });
  const template = candidatos.find((t) => /lembr/i.test(t.nome)) ?? null;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  let enfileiradas = 0;
  let semCelular = 0;
  let repetidas = 0;
  let jaRetiradas = 0;

  for (const ref of ordens.slice(0, 100)) {
    const os = await prisma.ordemServico.findUnique({
      where: { id: ref.id },
      select: {
        id: true,
        contatoId: true,
        dataSaida: true,
        contato: { select: { celular: true } },
        situacao: { select: { nome: true, cancelamento: true } },
      },
    });
    if (!os) continue;
    // retirada ou cancelada entre a sugestão e o clique: não manda "venha buscar"
    if (os.dataSaida || os.situacao.cancelamento || /entreg/i.test(os.situacao.nome)) {
      jaRetiradas++;
      continue;
    }

    const celular = os.contato?.celular?.trim();
    if (!celular) {
      semCelular++;
      continue;
    }

    const jaHoje = await prisma.notificacao.findFirst({
      where: { origemTipo: 'OS', origemId: os.id, canal: 'WHATSAPP', criadoEm: { gte: inicioDoDia } },
      select: { id: true },
    });
    if (jaHoje) {
      repetidas++;
      continue;
    }

    const m = await montarVariaveis('OS', os.id);
    const corpo = renderTemplate(template?.corpo ?? TEXTO_PRONTO, { ...m.vars, itens: '' });

    await enfileirar({
      canal: 'WHATSAPP' as Canal,
      destinatario: celular,
      corpo,
      contatoId: os.contatoId,
      origemTipo: 'OS',
      origemId: os.id,
    });
    enfileiradas++;
  }

  const partes = enfileiradas > 0 ? [`${enfileiradas} aviso(s) de "pronto para retirar" na fila do WhatsApp`] : [];
  if (repetidas) partes.push(`${repetidas} já tinham sido avisados hoje`);
  if (jaRetiradas) partes.push(`${jaRetiradas} já foram retirados`);
  if (semCelular) partes.push(`${semCelular} sem celular cadastrado`);
  if (enfileiradas > 0 && wpp.status !== 'CONECTADO')
    partes.push('o WhatsApp está desconectado — as mensagens saem assim que ele voltar (Comunicação → WhatsApp)');

  // "todo mundo já foi avisado hoje" não é erro: a sugestão pode ser aceita do mesmo jeito.
  const fezAlgo = enfileiradas > 0 || repetidas > 0 || jaRetiradas > 0;

  return {
    ok: fezAlgo,
    mensagem: partes.length
      ? partes.join('; ') + '.'
      : 'Nenhum desses clientes tem celular cadastrado — não deu para avisar por aqui.',
    detalhes: { enfileiradas, repetidas, jaRetiradas, semCelular, whatsapp: wpp.status, template: template?.nome ?? 'texto padrão' },
  };
}

// ------------------------------------------------------------------ desconto em lote
/**
 * Baixa o preço dos produtos parados. Nunca vende abaixo do custo e nunca mexe em produto
 * que vem do site (o catálogo do site sobrescreve o preço a cada 30 min — esses precisam
 * ser alterados lá). Guarda o preço anterior para dar para voltar atrás.
 */
export async function aplicarDescontoLote(dados: any, percentual: number): Promise<ResultadoAcao> {
  const lista: { produtoId: number }[] = Array.isArray(dados?.produtos) ? dados.produtos : [];
  if (lista.length === 0) return { ok: false, mensagem: 'Nenhum produto nessa sugestão.' };

  const pct = Math.min(60, Math.max(1, Math.round(percentual || 10)));
  const ids = lista.map((p) => p.produtoId).filter(Boolean);

  const produtos = await prisma.produto.findMany({
    where: { id: { in: ids }, ativo: true },
    select: { id: true, nome: true, preco: true, precoCartao: true, precoCusto: true, siteId: true },
  });

  const alterados: { id: number; nome: string; de: number; para: number }[] = [];
  const doSite: string[] = [];
  const noCusto: string[] = [];

  for (const p of produtos) {
    if (p.siteId) {
      doSite.push(p.nome);
      continue;
    }
    const novo = arred(p.preco * (1 - pct / 100));
    const piso = arred((p.precoCusto || 0) * 1.05); // nunca abaixo do custo + 5%
    if (p.precoCusto > 0 && novo < piso) {
      noCusto.push(p.nome);
      continue;
    }
    await prisma.produto.update({
      where: { id: p.id },
      data: {
        preco: novo,
        precoCartao: p.precoCartao ? arred(p.precoCartao * (1 - pct / 100)) : p.precoCartao,
      },
    });
    alterados.push({ id: p.id, nome: p.nome, de: arred(p.preco), para: novo });
  }

  const partes: string[] = [];
  if (alterados.length) partes.push(`${alterados.length} produto(s) com ${pct}% de desconto`);
  if (doSite.length)
    partes.push(`${doSite.length} vêm do site e precisam do desconto lá (o catálogo sobrescreve o preço aqui a cada 30 min)`);
  if (noCusto.length) partes.push(`${noCusto.length} ficariam abaixo do custo e foram deixados como estavam`);

  return {
    ok: alterados.length > 0,
    mensagem: partes.length ? partes.join('; ') + '.' : 'Nenhum preço foi alterado.',
    detalhes: { percentual: pct, alterados, doSite, noCusto },
  };
}

/** Executa a ação da sugestão. Devolve sempre uma frase para o gestor ler. */
export async function executarAcao(
  acao: string,
  dados: any,
  opcoes: { percentual?: number } = {},
): Promise<ResultadoAcao> {
  switch (acao) {
    case 'COBRAR_WHATSAPP':
      return cobrarPorWhatsapp(dados);
    case 'AVISAR_PRONTO':
      return avisarProntoWhatsapp(dados);
    case 'DESCONTO_LOTE':
      return aplicarDescontoLote(dados, opcoes.percentual ?? 10);
    default:
      return { ok: true, mensagem: 'Anotado.' };
  }
}

export { reais };
