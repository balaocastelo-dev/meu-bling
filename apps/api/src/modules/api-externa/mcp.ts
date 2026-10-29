/**
 * SERVIDOR MCP (Model Context Protocol) — para agentes de IA (Claude, ChatGPT, n8n, agentes locais)
 * usarem o MEU BLING como ferramenta.
 *
 *   POST /api/v1/mcp            com X-API-Key: mb_...   (Claude Code, Claude Desktop, n8n, agentes próprios)
 *   POST /api/v1/mcp/mb_...     chave na URL (só se a chave permitir; para conectores sem cabeçalho)
 *
 * Transporte "Streamable HTTP" sem sessão: cada POST traz uma mensagem JSON-RPC (ou um lote) e a resposta
 * volta em JSON. Toda ferramenta chama a própria API (/api/v1) com a MESMA chave, então as permissões,
 * o limite por minuto e o registro de chamadas valem igualzinho.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { RECURSOS, podeNivel, type Nivel, type Permissoes } from './recursos.js';
import { endpointsPermitidos } from './openapi.js';

const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_TEXTO = 60_000;

export interface Ferramenta {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** recurso e nível exigidos ("*" = qualquer chave) */
  recurso: string;
  nivel: Nivel;
  executar: (a: Record<string, any>) => { metodo: string; caminho: string; corpo?: unknown } | { direto: unknown };
}

const q = (params: Record<string, unknown>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};
const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });

export function ferramentas(perm: Permissoes | null): Ferramenta[] {
  const todas: Ferramenta[] = [
    {
      name: 'listar_endpoints', title: 'Listar o que posso fazer', recurso: '*', nivel: 'LEITURA',
      description: 'Lista as rotas da API do MEU BLING que esta chave pode usar, com filtros e exemplo de corpo. Use antes de "consultar"/"gravar" para descobrir caminhos e formatos.',
      inputSchema: obj({ recurso: str(`Opcional: ${RECURSOS.map((r) => r.chave).join(', ')}`) }),
      executar: (a) => ({ direto: endpointsPermitidos(perm).filter((e) => !a.recurso || e.recurso === a.recurso) }),
    },
    {
      name: 'consultar', title: 'Consultar (GET)', recurso: '*', nivel: 'LEITURA',
      description: 'Faz um GET em qualquer rota liberada da API (sem /api/v1). Ex.: "/vendas?dataInicial=2026-10-01&dataFinal=2026-10-24", "/produtos/12", "/contas-receber?situacao=ATRASADO". Datas AAAA-MM-DD; listas aceitam pagina e limite.',
      inputSchema: obj({ caminho: str('Caminho começando com /, com a query string') }, ['caminho']),
      executar: (a) => ({ metodo: 'GET', caminho: a.caminho }),
    },
    {
      name: 'gravar', title: 'Gravar (POST/PUT)', recurso: '*', nivel: 'GRAVACAO',
      description: 'Cria ou altera registros: POST para criar/ações (ex.: "/vendas", "/vendas/10/situacao"), PUT para alterar ("/contatos/5"). Veja o formato do corpo em listar_endpoints. Confirme com o usuário antes de gravar.',
      inputSchema: obj({ metodo: { type: 'string', enum: ['POST', 'PUT'] }, caminho: str('Caminho começando com /'), corpo: { type: 'object', description: 'Corpo JSON' } }, ['metodo', 'caminho']),
      executar: (a) => ({ metodo: a.metodo === 'PUT' ? 'PUT' : 'POST', caminho: a.caminho, corpo: a.corpo ?? {} }),
    },
    {
      name: 'excluir', title: 'Excluir (DELETE)', recurso: '*', nivel: 'TOTAL',
      description: 'Exclui um registro (ex.: "/contatos/5"). Só funciona se a chave tiver nível total no recurso. Peça confirmação ao usuário antes.',
      inputSchema: obj({ caminho: str('Caminho começando com /') }, ['caminho']),
      executar: (a) => ({ metodo: 'DELETE', caminho: a.caminho }),
    },
    {
      name: 'buscar_clientes', title: 'Buscar clientes', recurso: 'clientes', nivel: 'LEITURA',
      description: 'Procura clientes/fornecedores por nome, CPF/CNPJ, e-mail ou telefone.',
      inputSchema: obj({ pesquisa: str('Texto a procurar'), tipo: { type: 'string', enum: ['CLIENTE', 'FORNECEDOR', 'TRANSPORTADORA'] }, limite: int('Máximo de resultados (padrão 20)') }, ['pesquisa']),
      executar: (a) => ({ metodo: 'GET', caminho: `/contatos${q({ pesquisa: a.pesquisa, tipo: a.tipo, limite: a.limite ?? 20 })}` }),
    },
    {
      name: 'historico_do_cliente', title: 'Histórico do cliente', recurso: 'clientes', nivel: 'LEITURA',
      description: 'Tudo de um cliente: vendas, ordens de serviço, contas e mensagens, em linha do tempo.',
      inputSchema: obj({ id: int('Código do cliente') }, ['id']),
      executar: (a) => ({ metodo: 'GET', caminho: `/contatos/${Number(a.id)}/historico` }),
    },
    {
      name: 'buscar_produtos', title: 'Buscar produtos', recurso: 'produtos', nivel: 'LEITURA',
      description: 'Procura produtos por nome, código, GTIN ou marca, com preço e estoque.',
      inputSchema: obj({ pesquisa: str('Texto a procurar'), comEstoque: { type: 'boolean', description: 'Só os que têm estoque' }, limite: int('Máximo (padrão 20)') }, ['pesquisa']),
      executar: (a) => ({ metodo: 'GET', caminho: `/produtos${q({ pesquisa: a.pesquisa, estoque: a.comEstoque ? 'positivo' : undefined, ativo: true, ordem: 'pronta', limite: a.limite ?? 20 })}` }),
    },
    {
      name: 'listar_vendas', title: 'Listar vendas', recurso: 'vendas', nivel: 'LEITURA',
      description: 'Pedidos de venda (ou orçamentos) por período, cliente, vendedor ou texto.',
      inputSchema: obj({ dataInicial: str('AAAA-MM-DD'), dataFinal: str('AAAA-MM-DD'), pesquisa: str('Texto'), tipo: { type: 'string', enum: ['PEDIDO', 'ORCAMENTO', 'TODOS'] }, vendedorId: int('Vendedor'), contatoId: int('Cliente'), limite: int('Máximo (padrão 50)') }),
      executar: (a) => ({ metodo: 'GET', caminho: `/vendas${q({ dataInicial: a.dataInicial, dataFinal: a.dataFinal, pesquisa: a.pesquisa, tipo: a.tipo, vendedorId: a.vendedorId, contatoId: a.contatoId, limite: a.limite ?? 50 })}` }),
    },
    {
      name: 'ver_venda', title: 'Ver venda', recurso: 'vendas', nivel: 'LEITURA',
      description: 'Pedido ou orçamento completo: itens, parcelas, situação, nota e situações para onde pode ir.',
      inputSchema: obj({ id: int('Código interno da venda (não o número)') }, ['id']),
      executar: (a) => ({ metodo: 'GET', caminho: `/vendas/${Number(a.id)}` }),
    },
    {
      name: 'listar_ordens_servico', title: 'Listar ordens de serviço', recurso: 'os', nivel: 'LEITURA',
      description: 'Ordens de serviço da assistência por texto, situação, técnico ou período.',
      inputSchema: obj({ pesquisa: str('Texto (cliente, equipamento, número)'), situacaoId: int('Situação'), tecnicoId: int('Técnico'), dataInicial: str('AAAA-MM-DD'), dataFinal: str('AAAA-MM-DD'), limite: int('Máximo (padrão 50)') }),
      executar: (a) => ({ metodo: 'GET', caminho: `/ordens-servico${q({ pesquisa: a.pesquisa, situacaoId: a.situacaoId, tecnicoId: a.tecnicoId, dataInicial: a.dataInicial, dataFinal: a.dataFinal, limite: a.limite ?? 50 })}` }),
    },
    {
      name: 'ver_ordem_servico', title: 'Ver ordem de serviço', recurso: 'os', nivel: 'LEITURA',
      description: 'OS completa: equipamento, defeito, diagnóstico, peças e serviços, situação e histórico.',
      inputSchema: obj({ id: int('Código interno da OS') }, ['id']),
      executar: (a) => ({ metodo: 'GET', caminho: `/ordens-servico/${Number(a.id)}` }),
    },
    {
      name: 'resumo_financeiro', title: 'Resumo financeiro', recurso: 'financeiro', nivel: 'LEITURA',
      description: 'Saldo das contas e o que há a receber e a pagar hoje, na semana e atrasado.',
      inputSchema: obj({}),
      executar: () => ({ metodo: 'GET', caminho: '/financeiro/resumo' }),
    },
    {
      name: 'situacoes', title: 'Situações', recurso: 'cadastros', nivel: 'LEITURA',
      description: 'Situações (status) de um módulo, para usar o situacaoId certo ao mudar a situação.',
      inputSchema: obj({ modulo: { type: 'string', enum: ['VENDA', 'ORCAMENTO', 'COMPRA', 'OS'] } }, ['modulo']),
      executar: (a) => ({ metodo: 'GET', caminho: `/situacoes${q({ modulo: a.modulo })}` }),
    },
    {
      name: 'buscar', title: 'Busca geral', recurso: '*', nivel: 'LEITURA',
      description: 'Procura de uma vez em clientes, produtos, vendas, OS e notas (nome, CPF/CNPJ, telefone, número do pedido/OS/nota). Bom primeiro passo para achar o id de algo.',
      inputSchema: obj({ q: str('Texto a procurar'), limite: int('Por grupo (padrão 5)') }, ['q']),
      executar: (a) => ({ metodo: 'GET', caminho: `/externo/buscar${q({ q: a.q, limite: a.limite })}` }),
    },
    {
      name: 'resumo_do_dia', title: 'Resumo do dia', recurso: '*', nivel: 'LEITURA',
      description: 'Vendas e orçamentos do dia, OS em aberto e atrasadas, a receber/pagar e estoque baixo.',
      inputSchema: obj({ data: str('AAAA-MM-DD (padrão hoje)') }),
      executar: (a) => ({ metodo: 'GET', caminho: `/externo/resumo${q({ data: a.data })}` }),
    },
    {
      name: 'criar_cliente', title: 'Cadastrar cliente', recurso: 'clientes', nivel: 'GRAVACAO',
      description: 'Cadastra cliente. Antes, use buscar_clientes para não duplicar.',
      inputSchema: obj({ nome: str('Nome completo'), documento: str('CPF/CNPJ (opcional)'), celular: str('Celular com DDD'), email: str('E-mail'), cep: str('CEP'), numero: str('Número do endereço') }, ['nome']),
      executar: (a) => ({ metodo: 'POST', caminho: '/contatos', corpo: { tipo: 'CLIENTE', tipoPessoa: String(a.documento || '').replace(/\D/g, '').length === 14 ? 'J' : 'F', ...a } }),
    },
    {
      name: 'estoque_do_produto', title: 'Estoque do produto', recurso: 'produtos', nivel: 'LEITURA',
      description: 'Produto com preço e saldo em cada depósito (loja Castelo, Centro, distribuidores).',
      inputSchema: obj({ id: int('Código interno do produto') }, ['id']),
      executar: (a) => ({ metodo: 'GET', caminho: `/produtos/${Number(a.id)}` }),
    },
    {
      name: 'criar_venda', title: 'Criar pedido ou orçamento', recurso: 'vendas', nivel: 'GRAVACAO',
      description: 'Cria pedido de venda (ou orçamento com tipo=ORCAMENTO). Item sem valor usa o preço do produto; sem parcelas cria 1 à vista. Confirme itens e valores com o usuário antes.',
      inputSchema: obj({
        tipo: { type: 'string', enum: ['PEDIDO', 'ORCAMENTO'] },
        contatoId: int('Cliente'),
        vendedorId: int('Vendedor (opcional)'),
        itens: { type: 'array', items: { type: 'object', properties: { produtoId: { type: 'integer' }, descricao: { type: 'string' }, quantidade: { type: 'number' }, valorUnitario: { type: 'number' }, desconto: { type: 'number' } }, required: ['quantidade'] } },
        parcelas: { type: 'array', items: { type: 'object', properties: { dataVencimento: { type: 'string' }, valor: { type: 'number' }, formaPagamentoId: { type: 'integer' } } } },
        origem: { type: 'string', enum: ['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'], description: 'Por onde o cliente comprou (padrão OUTRO)' },
        observacoes: str('Observações'),
      }, ['contatoId', 'itens']),
      executar: (a) => ({ metodo: 'POST', caminho: '/vendas', corpo: { origem: 'OUTRO', ...a } }),
    },
    {
      name: 'mudar_situacao', title: 'Mudar situação', recurso: '*', nivel: 'GRAVACAO',
      description: 'Muda a situação de uma venda, orçamento, compra ou OS (ex.: fechar venda lança estoque e contas; cancelar estorna). Use a ferramenta situacoes para achar o situacaoId.',
      inputSchema: obj({ modulo: { type: 'string', enum: ['VENDA', 'COMPRA', 'OS'] }, id: int('Código interno do registro'), situacaoId: int('Nova situação'), observacao: str('Motivo (opcional)') }, ['modulo', 'id', 'situacaoId']),
      executar: (a) => ({ metodo: 'POST', caminho: `/${a.modulo === 'COMPRA' ? 'compras' : a.modulo === 'OS' ? 'ordens-servico' : 'vendas'}/${Number(a.id)}/situacao`, corpo: { situacaoId: a.situacaoId, observacao: a.observacao ?? null } }),
    },
    {
      name: 'abrir_ordem_servico', title: 'Abrir OS', recurso: 'os', nivel: 'GRAVACAO',
      description: 'Abre ordem de serviço na assistência técnica.',
      inputSchema: obj({ contatoId: int('Cliente'), equipamento: str('Ex.: Notebook'), marca: str('Marca'), modelo: str('Modelo'), defeitoRelatado: str('Defeito que o cliente relatou'), acessorios: str('Acessórios deixados'), tecnicoId: int('Técnico (opcional)'), orcar: { type: 'boolean', description: 'Precisa de orçamento antes' } }, ['contatoId', 'equipamento', 'defeitoRelatado']),
      executar: (a) => ({ metodo: 'POST', caminho: '/ordens-servico', corpo: a }),
    },
    {
      name: 'contas_a_receber', title: 'Contas a receber', recurso: 'financeiro', nivel: 'LEITURA',
      description: 'Contas a receber (com totais). Use situacao=ATRASADO para cobranças.',
      inputSchema: obj({ situacao: { type: 'string', enum: ['ABERTO', 'RECEBIDO', 'PARCIAL', 'CANCELADO', 'ATRASADO'] }, contatoId: int('Cliente'), dataInicial: str('Vencimento a partir de'), dataFinal: str('Vencimento até'), pesquisa: str('Texto'), limite: int('Máximo (padrão 50)') }),
      executar: (a) => ({ metodo: 'GET', caminho: `/contas-receber${q({ ...a, limite: a.limite ?? 50 })}` }),
    },
    {
      name: 'contas_a_pagar', title: 'Contas a pagar', recurso: 'financeiro', nivel: 'LEITURA',
      description: 'Contas a pagar (com totais).',
      inputSchema: obj({ situacao: { type: 'string', enum: ['ABERTO', 'PAGO', 'PARCIAL', 'CANCELADO', 'ATRASADO'] }, contatoId: int('Fornecedor'), dataInicial: str('Vencimento a partir de'), dataFinal: str('Vencimento até'), pesquisa: str('Texto'), limite: int('Máximo (padrão 50)') }),
      executar: (a) => ({ metodo: 'GET', caminho: `/contas-pagar${q({ ...a, limite: a.limite ?? 50 })}` }),
    },
    {
      name: 'contas_financeiras', title: 'Caixa e bancos', recurso: 'financeiro', nivel: 'LEITURA',
      description: 'Contas financeiras (caixa, bancos, cartões) com saldo — o contaFinanceiraId usado nas baixas.',
      inputSchema: obj({}),
      executar: () => ({ metodo: 'GET', caminho: '/contas-financeiras?ativo=true' }),
    },
    {
      name: 'baixar_conta', title: 'Receber ou pagar uma conta', recurso: 'financeiro', nivel: 'GRAVACAO',
      description: 'Dá baixa numa conta a receber (RECEBER) ou a pagar (PAGAR): total, ou parcial informando o valor. Confirme com o usuário antes.',
      inputSchema: obj({ tipo: { type: 'string', enum: ['RECEBER', 'PAGAR'] }, id: int('Código da conta'), contaFinanceiraId: int('Caixa/banco onde entrou ou saiu o dinheiro'), data: str('AAAA-MM-DD (padrão hoje)'), valor: { type: 'number', description: 'Opcional: valor parcial' }, formaPagamentoId: int('Opcional'), juros: { type: 'number' }, desconto: { type: 'number' }, observacoes: str('Opcional') }, ['tipo', 'id', 'contaFinanceiraId']),
      executar: (a) => {
        const { tipo, id, ...corpo } = a;
        return { metodo: 'POST', caminho: `/contas-${tipo === 'PAGAR' ? 'pagar' : 'receber'}/${Number(id)}/baixar`, corpo: { data: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), ...corpo } };
      },
    },
    {
      name: 'formas_pagamento', title: 'Formas de pagamento', recurso: 'cadastros', nivel: 'LEITURA',
      description: 'Formas de pagamento (Pix, dinheiro, cartão…) com o id para parcelas e baixas.',
      inputSchema: obj({}),
      executar: () => ({ metodo: 'GET', caminho: '/formas-pagamento?ativo=true' }),
    },
    {
      name: 'vendedores_e_tecnicos', title: 'Vendedores e técnicos', recurso: 'cadastros', nivel: 'LEITURA',
      description: 'Lista vendedores ou técnicos ativos com o id.',
      inputSchema: obj({ quem: { type: 'string', enum: ['vendedores', 'tecnicos'] } }, ['quem']),
      executar: (a) => ({ metodo: 'GET', caminho: `/${a.quem === 'tecnicos' ? 'tecnicos' : 'vendedores'}?ativo=true` }),
    },
    {
      name: 'enviar_whatsapp', title: 'Enviar WhatsApp', recurso: 'comunicacao', nivel: 'GRAVACAO',
      description: 'Envia uma mensagem de WhatsApp pelo número da loja (entra na fila). Confirme o texto com o usuário antes.',
      inputSchema: obj({ numero: str('Celular com DDD, ex.: 19999990000'), mensagem: str('Texto'), contatoId: int('Opcional: cliente') }, ['numero', 'mensagem']),
      executar: (a) => ({ metodo: 'POST', caminho: '/notificacoes', corpo: { canal: 'WHATSAPP', destinatario: String(a.numero), corpo: String(a.mensagem), contatoId: a.contatoId ?? null } }),
    },
  ];
  if (!perm) return todas;
  const algum = (nivel: Nivel) => RECURSOS.some((r) => podeNivel(perm, r.chave, nivel));
  return todas.filter((f) => (f.recurso === '*' ? algum(f.nivel) : podeNivel(perm, f.recurso, f.nivel)));
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const erroRpc = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export function caminhoValido(c: unknown): c is string {
  return typeof c === 'string' && c.startsWith('/') && !c.startsWith('//') && !c.includes('..') && !/^\/(mcp|api\/)/.test(c) && c.length < 2000;
}

export async function chamarApi(app: FastifyInstance, req: FastifyRequest, metodo: string, caminho: string, corpo?: unknown) {
  const headers: Record<string, string> = { 'x-meubling-origem': 'mcp' };
  if (req.chaveApi) headers['x-api-key'] = req.chaveApi.bruta;
  else if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
  if (corpo !== undefined) headers['content-type'] = 'application/json';
  const r = await app.inject({ method: metodo as any, url: `/api/v1${caminho}`, headers, remoteAddress: req.ip, payload: corpo !== undefined ? JSON.stringify(corpo) : undefined });
  const tipo = String(r.headers['content-type'] || '');
  let texto: string;
  if (tipo.includes('application/json')) {
    try {
      texto = JSON.stringify(r.json(), null, 1);
    } catch {
      texto = r.body;
    }
  } else if (tipo.startsWith('text/')) texto = r.body;
  else texto = `Arquivo (${tipo || 'binário'}, ${r.rawPayload.length} bytes). Baixe direto pela API: GET /api/v1${caminho} com a chave.`;
  if (texto.length > MAX_TEXTO) texto = texto.slice(0, MAX_TEXTO) + `\n… (resposta cortada em ${MAX_TEXTO} caracteres; use filtros, pagina e limite)`;
  return { status: r.statusCode, texto };
}

async function chamarFerramenta(app: FastifyInstance, req: FastifyRequest, perm: Permissoes | null, params: any) {
  const nome = params?.name;
  const f = ferramentas(perm).find((x) => x.name === nome);
  if (!f) return { content: [{ type: 'text', text: `Ferramenta "${String(nome)}" não existe ou não está liberada para esta chave.` }], isError: true };
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  const plano = f.executar(args);
  if ('direto' in plano) return { content: [{ type: 'text', text: JSON.stringify(plano.direto, null, 1) }] };
  if (!caminhoValido(plano.caminho)) return { content: [{ type: 'text', text: 'Caminho inválido: comece com "/" e não inclua /api/v1 (ex.: "/vendas?limite=10").' }], isError: true };
  const r = await chamarApi(app, req, plano.metodo, plano.caminho, plano.corpo);
  const ok = r.status < 400;
  return { content: [{ type: 'text', text: ok ? r.texto : `Erro ${r.status}: ${r.texto}` }], isError: !ok };
}

async function responder(app: FastifyInstance, req: FastifyRequest, m: Rpc): Promise<object | null> {
  if (!m || typeof m !== 'object' || typeof m.method !== 'string') return erroRpc(m?.id, -32600, 'Mensagem JSON-RPC inválida');
  const ehNotificacao = m.id === undefined || m.id === null;
  const perm = req.chaveApi ? req.chaveApi.permissoes : null;
  try {
    let result: unknown;
    switch (m.method) {
      case 'initialize': {
        const pedida = typeof m.params?.protocolVersion === 'string' ? m.params.protocolVersion : VERSOES[0];
        result = {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'meu-bling', title: 'MEU BLING — Balão da Informática', version: '1.0.0' },
          instructions:
            'ERP do Balão da Informática (loja de informática e assistência técnica em Campinas). Use listar_endpoints para ver o que pode fazer, ' +
            'as ferramentas de busca para achar códigos (ids) e "consultar"/"gravar" para o resto. Valores em reais, datas AAAA-MM-DD. ' +
            'Antes de gravar, excluir ou enviar mensagem a cliente, confirme com o usuário.',
        };
        break;
      }
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: ferramentas(perm).map(({ name, title, description, inputSchema, nivel }) => ({ name, title, description, inputSchema, annotations: { readOnlyHint: nivel === 'LEITURA', destructiveHint: nivel === 'TOTAL' } })) };
        break;
      case 'tools/call':
        result = await chamarFerramenta(app, req, perm, m.params);
        break;
      case 'resources/list':
        result = { resources: [] };
        break;
      case 'resources/templates/list':
        result = { resourceTemplates: [] };
        break;
      case 'prompts/list':
        result = { prompts: [] };
        break;
      default:
        if (m.method.startsWith('notifications/')) return null;
        return ehNotificacao ? null : erroRpc(m.id, -32601, `Método não suportado: ${m.method}`);
    }
    return ehNotificacao ? null : { jsonrpc: '2.0', id: m.id, result };
  } catch (e: any) {
    req.log.warn({ e }, 'mcp: erro ao responder');
    return ehNotificacao ? null : erroRpc(m.id, -32603, 'Erro interno ao executar: ' + String(e?.message || e));
  }
}

/** Trata um POST no /mcp: devolve a resposta JSON-RPC (ou null quando só vieram notificações → 202). */
export async function tratarMcp(app: FastifyInstance, req: FastifyRequest): Promise<object | object[] | null> {
  const corpo = req.body as unknown;
  if (Array.isArray(corpo)) {
    if (!corpo.length) return erroRpc(null, -32600, 'Lote vazio');
    const respostas = (await Promise.all(corpo.slice(0, 50).map((m) => responder(app, req, m as Rpc)))).filter(Boolean) as object[];
    return respostas.length ? respostas : null;
  }
  if (!corpo || typeof corpo !== 'object') return erroRpc(null, -32700, 'Corpo JSON-RPC ausente ou inválido');
  return responder(app, req, corpo as Rpc);
}

export { ferramentas as ferramentasMcp };
