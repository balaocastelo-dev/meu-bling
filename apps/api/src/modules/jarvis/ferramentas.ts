/**
 * JARVIS — as mãos.
 *
 * O sistema já expõe ferramentas para agentes de IA (o servidor MCP em
 * modules/api-externa/mcp.ts). O JARVIS usa exatamente as mesmas, então tudo que ele faz
 * passa pela API de sempre, com as mesmas regras, a mesma validação e a mesma auditoria.
 *
 * O que muda aqui é o RISCO. Três faixas:
 *
 *   LIVRE      consultar qualquer coisa (vendas, estoque, caixa, cliente, OS, DRE).
 *              Ele faz na hora, sem perguntar.
 *   AVISA      cria coisa que dá para desfazer (orçamento, cliente, OS). Faz e conta o que fez.
 *   CONFIRMA   mexe em dinheiro ou fala com cliente (baixar conta, enviar WhatsApp, excluir).
 *              Ele NÃO faz: devolve o pedido para o gestor apertar o botão.
 *
 * A regra é por nome de ferramenta, não por adivinhação: ferramenta que não estiver na
 * lista das duas primeiras faixas cai em CONFIRMA por padrão.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { caminhoValido, chamarApi, ferramentas as ferramentasMcp, type Ferramenta } from '../api-externa/mcp.js';

export type Risco = 'LIVRE' | 'AVISA' | 'CONFIRMA';

/** Ferramentas que só leem: sempre liberadas. */
const LIVRES = new Set([
  'listar_endpoints',
  'consultar',
  'buscar',
  'buscar_clientes',
  'buscar_produtos',
  'historico_do_cliente',
  'listar_vendas',
  'ver_venda',
  'listar_ordens_servico',
  'ver_ordem_servico',
  'resumo_financeiro',
  'resumo_do_dia',
  'situacoes',
  'estoque_do_produto',
  'contas_a_receber',
  'contas_a_pagar',
  'contas_financeiras',
  'formas_pagamento',
  'vendedores_e_tecnicos',
]);

/** Cria coisas reversíveis: ele faz e avisa. */
const AVISAM = new Set(['criar_cliente', 'criar_venda', 'abrir_ordem_servico']);

export function riscoDe(nome: string): Risco {
  if (LIVRES.has(nome)) return 'LIVRE';
  if (AVISAM.has(nome)) return 'AVISA';
  return 'CONFIRMA';
}

/** Orçamento é reversível; pedido mexe em estoque e caixa, então pede confirmação. */
function riscoDaChamada(nome: string, args: Record<string, any>): Risco {
  if (nome === 'criar_venda') {
    const tipo = String(args?.tipo ?? '').toUpperCase();
    return tipo === 'ORCAMENTO' ? 'AVISA' : 'CONFIRMA';
  }
  return riscoDe(nome);
}

export type FerramentaIa = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const PREFIXO_RISCO: Record<Risco, string> = {
  LIVRE: '',
  AVISA: '[cria algo que dá para desfazer] ',
  CONFIRMA: '[precisa da confirmação do gestor — descreva o que pretende fazer antes de chamar] ',
};

/** A lista de ferramentas no formato que a API da Anthropic espera. */
export function ferramentasParaIa(): FerramentaIa[] {
  return ferramentasMcp(null).map((f) => ({
    name: f.name,
    description: `${PREFIXO_RISCO[riscoDe(f.name)]}${f.description}`,
    input_schema: f.inputSchema,
  }));
}

export type ResultadoFerramenta = {
  nome: string;
  risco: Risco;
  ok: boolean;
  texto: string;
  /** quando CONFIRMA: o que ele queria fazer, para o gestor aprovar */
  pendente?: { nome: string; argumentos: Record<string, unknown>; descricao: string };
};

function descrever(f: Ferramenta, args: Record<string, any>): string {
  const plano = (() => {
    try {
      return f.executar(args);
    } catch {
      return null;
    }
  })();
  if (!plano || 'direto' in plano) return f.title;
  return `${f.title} — ${plano.metodo} ${plano.caminho}`;
}

/**
 * Executa uma ferramenta pedida pela IA, respeitando a faixa de risco.
 * `permitirTudo` só é verdadeiro quando o gestor apertou o botão de confirmar.
 */
export async function executarFerramenta(
  app: FastifyInstance,
  req: FastifyRequest,
  nome: string,
  argumentos: Record<string, any>,
  opcoes: { permitirTudo?: boolean } = {},
): Promise<ResultadoFerramenta> {
  const f = ferramentasMcp(null).find((x) => x.name === nome);
  if (!f) return { nome, risco: 'CONFIRMA', ok: false, texto: `A ferramenta "${nome}" não existe.` };

  const risco = riscoDaChamada(nome, argumentos);

  if (risco === 'CONFIRMA' && !opcoes.permitirTudo) {
    return {
      nome,
      risco,
      ok: false,
      texto:
        'Isso mexe em dinheiro ou fala com cliente, então não faço sozinho. ' +
        'Descrevi o que pretendo fazer; o gestor confirma no painel para eu executar.',
      pendente: { nome, argumentos, descricao: descrever(f, argumentos) },
    };
  }

  const plano = f.executar(argumentos);
  if ('direto' in plano) return { nome, risco, ok: true, texto: JSON.stringify(plano.direto, null, 1) };
  if (!caminhoValido(plano.caminho)) return { nome, risco, ok: false, texto: 'Caminho inválido.' };

  const r = await chamarApi(app, req, plano.metodo, plano.caminho, plano.corpo);
  const ok = r.status < 400;
  return { nome, risco, ok, texto: ok ? r.texto : `Erro ${r.status}: ${r.texto}` };
}
