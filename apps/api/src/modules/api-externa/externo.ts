/**
 * Rotas de conveniência para sistemas e agentes (qualquer chave válida; o conteúdo respeita as
 * permissões, porque cada parte é buscada na própria API com a MESMA credencial):
 *   GET /externo/buscar?q=     busca geral em clientes, produtos, vendas, OS e notas
 *   GET /externo/resumo?data=  resumo do dia (vendas, orçamentos, OS, financeiro, estoque baixo)
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { podeNivel } from './recursos.js';

/** Chama a própria API com a mesma credencial de quem pediu (chave ou login). */
export async function injetar(app: FastifyInstance, req: FastifyRequest, metodo: string, caminho: string, corpo?: unknown, origem?: string) {
  const headers: Record<string, string> = {};
  if (origem) headers['x-meubling-origem'] = origem;
  if (req.chaveApi) headers['x-api-key'] = req.chaveApi.bruta;
  else if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const r = await app.inject({ method: metodo as any, url: `/api/v1${caminho}`, headers, remoteAddress: req.ip, payload: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  let json: any = null;
  try {
    json = r.json();
  } catch {
    json = null;
  }
  return { status: r.statusCode, json, r };
}

/** Pode ler o recurso? (login sem chave: deixa a própria API decidir) */
const podeLer = (req: FastifyRequest, recurso: string) => !req.chaveApi || podeNivel(req.chaveApi.permissoes, recurso, 'LEITURA');

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const soma = (l: any[] | undefined, campo: string) => Math.round((l || []).reduce((s, x) => s + (Number(x?.[campo]) || 0), 0) * 100) / 100;

export function rotasExterno(app: FastifyInstance) {
  app.get('/api/v1/externo/buscar', async (req) => {
    const q = z.object({ q: z.string().trim().min(2, 'Mande pelo menos 2 letras em q'), limite: z.coerce.number().int().min(1).max(20).default(5) }).parse(req.query);
    const t = encodeURIComponent(q.q);
    const grupos: [string, string, string][] = [
      ['clientes', 'clientes', `/contatos?pesquisa=${t}&limite=${q.limite}`],
      ['produtos', 'produtos', `/produtos?pesquisa=${t}&ativo=true&ordem=pronta&limite=${q.limite}`],
      ['vendas', 'vendas', `/vendas?tipo=TODOS&pesquisa=${t}&limite=${q.limite}`],
      ['ordensServico', 'os', `/ordens-servico?pesquisa=${t}&limite=${q.limite}`],
      ['notasFiscais', 'fiscal', `/notas-fiscais?pesquisa=${t}&limite=${q.limite}`],
    ];
    const out: Record<string, unknown> = { q: q.q };
    await Promise.all(
      grupos.map(async ([nome, recurso, caminho]) => {
        if (!podeLer(req, recurso)) return;
        const r = await injetar(app, req, 'GET', caminho);
        if (r.status < 400) out[nome] = { total: r.json?.meta?.total ?? r.json?.data?.length ?? 0, itens: r.json?.data ?? [] };
      }),
    );
    return out;
  });

  app.get('/api/v1/externo/resumo', async (req) => {
    const q = z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data no formato AAAA-MM-DD').optional() }).parse(req.query);
    const dia = q.data || hojeSP();
    const out: Record<string, unknown> = { data: dia };
    const tarefas: Promise<void>[] = [];
    if (podeLer(req, 'vendas')) {
      tarefas.push(
        injetar(app, req, 'GET', `/vendas?dataInicial=${dia}&dataFinal=${dia}&limite=200`).then((r) => {
          if (r.status >= 400) return;
          const lista = (r.json?.data ?? []).filter((v: any) => !/cancel/i.test(v?.situacao?.nome || ''));
          out.vendas = { quantidade: lista.length, total: soma(lista, 'total'), ultimas: lista.slice(0, 10).map((v: any) => ({ id: v.id, numero: v.numero, cliente: v.contato?.nome, vendedor: v.vendedor?.nome, total: v.total, situacao: v.situacao?.nome })) };
        }),
        injetar(app, req, 'GET', `/vendas?tipo=ORCAMENTO&dataInicial=${dia}&dataFinal=${dia}&limite=200`).then((r) => {
          if (r.status < 400) out.orcamentos = { quantidade: r.json?.meta?.total ?? 0, total: soma(r.json?.data, 'total') };
        }),
      );
    }
    if (podeLer(req, 'os')) {
      tarefas.push(
        injetar(app, req, 'GET', '/ordens-servico/kanban?diasFinalizadas=0').then((r) => {
          if (r.status >= 400 || !Array.isArray(r.json)) return;
          const porSituacao = r.json.map((c: any) => ({ situacao: c.situacao?.nome, quantidade: c.ordens?.length ?? 0 }));
          const atrasadas = r.json.flatMap((c: any) => c.ordens || []).filter((o: any) => o.atrasada).map((o: any) => ({ id: o.id, numero: o.numero, cliente: o.contato?.nome, equipamento: o.equipamento, previsao: o.dataPrevista }));
          out.ordensServico = { emAberto: porSituacao.reduce((s: number, x: any) => s + x.quantidade, 0), porSituacao, atrasadas };
        }),
        injetar(app, req, 'GET', `/ordens-servico?dataInicial=${dia}&dataFinal=${dia}&limite=1`).then((r) => {
          if (r.status < 400) out.osAbertasNoDia = r.json?.meta?.total ?? 0;
        }),
      );
    }
    if (podeLer(req, 'financeiro')) {
      tarefas.push(
        injetar(app, req, 'GET', '/financeiro/resumo').then((r) => {
          if (r.status < 400) out.financeiro = r.json;
        }),
      );
    }
    if (podeLer(req, 'produtos')) {
      tarefas.push(
        injetar(app, req, 'GET', '/produtos?estoque=abaixoMinimo&ativo=true&limite=20').then((r) => {
          if (r.status < 400) out.estoqueBaixo = { quantidade: r.json?.meta?.total ?? 0, itens: (r.json?.data ?? []).map((p: any) => ({ id: p.id, nome: p.nome, estoque: p.estoqueTotal, minimo: p.estoqueMinimo })) };
        }),
      );
    }
    await Promise.all(tarefas);
    return out;
  });
}
