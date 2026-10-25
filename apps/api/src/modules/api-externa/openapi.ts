/**
 * Documentação OpenAPI 3.1 da API externa — montada a partir do catálogo (recursos.ts), só com o que a
 * chave que pede pode usar. Serve para importar no Postman/Insomnia, n8n, Make, ou para um agente de IA
 * (GPTs, Claude, LangChain…) entender as rotas sozinho.
 */
import { env } from '../../lib/env.js';
import { ENDPOINTS, RECURSOS, nivelExigido, podeNivel, type Endpoint, type Permissoes } from './recursos.js';

export function urlBaseApi(): string {
  return `${env.APP_URL.replace(/\/$/, '')}/api/v1`;
}

/** Endpoints que as permissões alcançam (null = sem restrição, usuário ADMIN logado). */
export function endpointsPermitidos(perm: Permissoes | null): Endpoint[] {
  if (!perm) return ENDPOINTS;
  return ENDPOINTS.filter((e) => podeNivel(perm, e.recurso, nivelExigido(e.metodo)));
}

export function montarOpenApi(perm: Permissoes | null) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpointsPermitidos(perm)) {
    const rec = RECURSOS.find((r) => r.chave === e.recurso);
    const parametros: unknown[] = [];
    for (const m of e.caminho.matchAll(/\{(\w+)\}/g)) {
      parametros.push({ name: m[1], in: 'path', required: true, schema: { type: m[1] === 'cep' ? 'string' : 'integer' } });
    }
    for (const f of e.filtros || []) {
      const [nome, ...resto] = f.split(' ');
      parametros.push({ name: nome, in: 'query', required: false, schema: { type: 'string' }, description: resto.join(' ').replace(/[()]/g, '') || undefined });
    }
    const op: Record<string, unknown> = {
      tags: [rec?.nome || e.recurso],
      summary: e.resumo,
      operationId: `${e.metodo.toLowerCase()}_${e.caminho.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      parameters: parametros.length ? parametros : undefined,
      responses: {
        '200': { description: 'OK (listas: { data: [...], meta: { total, pagina, limite, totalPaginas } })', content: { 'application/json': { schema: { type: 'object' } } } },
        '4XX': { description: 'Erro: { erro: "mensagem em português", code, detalhes? }', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
      },
    };
    if (e.corpo !== undefined || e.metodo === 'POST' || e.metodo === 'PUT') {
      op.requestBody = { required: e.metodo !== 'POST' || e.corpo !== undefined, content: { 'application/json': { schema: { type: 'object' }, example: e.corpo ?? {} } } };
    }
    (paths[e.caminho] ??= {})[e.metodo.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'MEU BLING — API do Balão da Informática',
      version: '1.0.0',
      description:
        'ERP do Balão da Informática. Autentique com o cabeçalho X-API-Key (ou Authorization: Bearer mb_...). ' +
        'Datas em AAAA-MM-DD, valores em reais (número), listas paginadas com ?pagina=&limite=. ' +
        'Esta documentação mostra só o que a sua chave pode usar; outras rotas de /api/v1 dos mesmos recursos também funcionam.',
    },
    servers: [{ url: urlBaseApi() }],
    security: [{ chave: [] }, { bearer: [] }],
    tags: RECURSOS.map((r) => ({ name: r.nome, description: r.descricao })),
    paths,
    components: {
      securitySchemes: {
        chave: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Erro: { type: 'object', properties: { erro: { type: 'string' }, code: { type: 'string' }, detalhes: {} }, required: ['erro'] },
      },
    },
  };
}
