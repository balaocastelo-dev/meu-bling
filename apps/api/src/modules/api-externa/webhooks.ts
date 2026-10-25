/**
 * WEBHOOKS DE SAÍDA — o MEU BLING avisa outros sistemas / agentes quando algo acontece.
 *
 * Cada acontecimento do barramento interno (core/eventos.ts) vira um POST JSON para os endereços
 * cadastrados em Configurações → API e integrações → Webhooks, com:
 *   X-MeuBling-Evento:     nome do evento (ex.: venda.criada)
 *   X-MeuBling-Entrega:    número da entrega (para não processar duas vezes)
 *   X-MeuBling-Assinatura: sha256=<HMAC-SHA256 do corpo com o segredo do webhook>
 * Resposta 2xx = entregue. Senão, nova tentativa em 1 min, 5 min, 30 min e 2 h (5 tentativas no total).
 */
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { decrypt, encrypt } from '../../lib/crypto.js';
import { eventos, type EventosSistema } from '../../core/eventos.js';
import { registrarServico } from '../../core/servicos.js';
import { env } from '../../lib/env.js';
import { EVENTOS_WEBHOOK } from './recursos.js';

const ESPERAS_MIN = [1, 5, 30, 120];
const MAX_TENTATIVAS = ESPERAS_MIN.length + 1;
const TIMEOUT_MS = 10_000;

export function gerarSegredo(): string {
  return 'whsec_' + crypto.randomBytes(24).toString('hex');
}
export const cifrarSegredo = (s: string) => encrypt(s) as string;
export const lerSegredo = (s: string) => decrypt(s) || '';

export function assinar(segredo: string, corpo: string): string {
  return 'sha256=' + crypto.createHmac('sha256', segredo).update(corpo).digest('hex');
}

export function lerEventos(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function limparEventos(lista: unknown): string[] {
  if (!Array.isArray(lista)) return ['*'];
  if (lista.includes('*')) return ['*'];
  const validos = new Set(EVENTOS_WEBHOOK.map((e) => e.chave));
  const out = [...new Set(lista.filter((x): x is string => typeof x === 'string' && validos.has(x)))];
  return out.length ? out : ['*'];
}

// ---------------------------------------------------------------- conteúdo de cada evento
/** Junta ao evento um resumo legível (número, cliente, total, situação) e o caminho para buscar o resto na API. */
async function montarDados(evento: string, d: any): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = { ...d };
  try {
    if (evento === 'venda.criada' || evento === 'venda.alterada') {
      const v = await prisma.venda.findUnique({ where: { id: d.vendaId }, select: { id: true, tipo: true, numero: true, data: true, total: true, origem: true, contato: { select: { id: true, nome: true } }, vendedor: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true } } } });
      return { ...base, venda: v, recurso: `/vendas/${d.vendaId}`, excluida: !v };
    }
    if (evento === 'compra.criada') {
      const c = await prisma.compra.findUnique({ where: { id: d.compraId }, select: { id: true, numero: true, data: true, total: true, fornecedor: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true } } } });
      return { ...base, compra: c, recurso: `/compras/${d.compraId}` };
    }
    if (evento === 'os.criada' || evento === 'os.orcamento') {
      const o = await prisma.ordemServico.findUnique({ where: { id: d.osId }, select: { id: true, numero: true, dataEntrada: true, equipamento: true, total: true, contato: { select: { id: true, nome: true } }, situacao: { select: { id: true, nome: true } } } });
      return { ...base, os: o, recurso: `/ordens-servico/${d.osId}` };
    }
    if (evento === 'situacao.alterada') {
      const ids = [d.deSituacaoId, d.paraSituacaoId].filter(Boolean) as number[];
      const sits = await prisma.situacao.findMany({ where: { id: { in: ids } }, select: { id: true, nome: true } });
      const nome = (id: number | null) => sits.find((s) => s.id === id)?.nome ?? null;
      const caminho = d.modulo === 'COMPRA' ? 'compras' : d.modulo === 'OS' ? 'ordens-servico' : 'vendas';
      return { ...base, de: nome(d.deSituacaoId), para: nome(d.paraSituacaoId), recurso: `/${caminho}/${d.entidadeId}` };
    }
    if (evento === 'nfe.autorizada' || evento === 'nfe.cancelada') {
      const n = await prisma.notaFiscal.findUnique({ where: { id: d.notaId }, select: { id: true, modelo: true, serie: true, numero: true, chave: true, valorTotal: true, situacao: true, venda: { select: { id: true, numero: true } } } });
      return { ...base, nota: n, recurso: `/notas-fiscais/${d.notaId}` };
    }
    if (evento === 'conta.recebida') {
      const c = await prisma.contaReceber.findUnique({ where: { id: d.contaReceberId }, select: { id: true, descricao: true, valor: true, valorRecebido: true, situacao: true, contato: { select: { id: true, nome: true } } } });
      return { ...base, conta: c, recurso: `/contas-receber/${d.contaReceberId}` };
    }
    if (evento === 'conta.paga') {
      const c = await prisma.contaPagar.findUnique({ where: { id: d.contaPagarId }, select: { id: true, descricao: true, valor: true, valorPago: true, situacao: true, contato: { select: { id: true, nome: true } } } });
      return { ...base, conta: c, recurso: `/contas-pagar/${d.contaPagarId}` };
    }
  } catch {
    /* o resumo é cortesia: se falhar, vai só o evento */
  }
  return base;
}

/** Cria uma entrega para cada webhook ativo interessado no evento. */
export async function enfileirarEvento(evento: string, dados: unknown) {
  const hooks = await prisma.webhookSaida.findMany({ where: { ativo: true } });
  const interessados = hooks.filter((h) => {
    const ev = lerEventos(h.eventos);
    return ev.includes('*') || ev.includes(evento);
  });
  if (!interessados.length) return 0;
  const corpo = { evento, quando: new Date().toISOString(), sistema: 'MEU BLING', origem: env.APP_URL, dados: await montarDados(evento, dados) };
  const payload = JSON.stringify(corpo);
  for (const h of interessados) await prisma.entregaWebhook.create({ data: { webhookId: h.id, evento, payload } });
  void processarFila();
  return interessados.length;
}

// ---------------------------------------------------------------- entrega
export async function postar(url: string, segredo: string, evento: string, entregaId: number, payload: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const inicio = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'MEU-BLING-Webhook/1.0',
        'x-meubling-evento': evento,
        'x-meubling-entrega': String(entregaId),
        'x-meubling-assinatura': assinar(segredo, payload),
      },
      body: payload,
    });
    const texto = (await r.text().catch(() => '')).slice(0, 1000);
    return { ok: r.ok, status: r.status, resposta: texto, ms: Date.now() - inicio };
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? `sem resposta em ${TIMEOUT_MS / 1000} s` : String(e?.cause?.code || e?.message || e);
    return { ok: false, status: 0, resposta: `Falha de conexão: ${msg}`, ms: Date.now() - inicio };
  } finally {
    clearTimeout(t);
  }
}

let processando = false;

/** Envia as entregas pendentes que já estão na hora (uma de cada vez, em ordem). */
export async function processarFila() {
  if (processando) return;
  processando = true;
  try {
    for (let volta = 0; volta < 20; volta++) {
      const lote = await prisma.entregaWebhook.findMany({
        where: { status: 'PENDENTE', proximaTentativa: { lte: new Date() } },
        orderBy: { id: 'asc' },
        take: 20,
        include: { webhook: true },
      });
      if (!lote.length) break;
      for (const e of lote) {
        if (!e.webhook.ativo) {
          await prisma.entregaWebhook.update({ where: { id: e.id }, data: { status: 'FALHOU', resposta: 'Webhook desativado antes do envio.' } });
          continue;
        }
        const r = await postar(e.webhook.url, lerSegredo(e.webhook.segredo), e.evento, e.id, e.payload);
        const tentativas = e.tentativas + 1;
        const desistir = !r.ok && tentativas >= MAX_TENTATIVAS;
        await prisma.entregaWebhook.update({
          where: { id: e.id },
          data: {
            tentativas,
            respostaStatus: r.status,
            resposta: r.resposta,
            status: r.ok ? 'ENTREGUE' : desistir ? 'FALHOU' : 'PENDENTE',
            entregueEm: r.ok ? new Date() : null,
            proximaTentativa: r.ok || desistir ? e.proximaTentativa : new Date(Date.now() + ESPERAS_MIN[tentativas - 1] * 60_000),
          },
        });
        await prisma.webhookSaida.update({
          where: { id: e.webhookId },
          data: { ultimoEnvioEm: new Date(), ultimoStatus: r.status, falhasSeguidas: r.ok ? 0 : { increment: 1 } },
        });
      }
    }
  } catch (e) {
    console.error('[webhooks] erro ao processar a fila', e);
  } finally {
    processando = false;
  }
}

// ---------------------------------------------------------------- ligação com o barramento
let ligado = false;
export function ligarWebhooks() {
  if (ligado) return;
  ligado = true;
  for (const { chave } of EVENTOS_WEBHOOK) {
    eventos.ouvir(chave as keyof EventosSistema, (d) => enfileirarEvento(chave, d).then(() => undefined));
  }
}

registrarServico('webhooks-de-saida', () => {
  ligarWebhooks();
  setInterval(() => void processarFila(), 30_000).unref();
  // entregas antigas: guarda 30 dias
  setInterval(() => void prisma.entregaWebhook.deleteMany({ where: { criadoEm: { lt: new Date(Date.now() - 30 * 86_400_000) } } }).catch(() => undefined), 6 * 3_600_000).unref();
});
