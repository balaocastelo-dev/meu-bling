/**
 * Custo completo de cada venda — uma regra só para DRE, dashboards, relatórios e a própria venda.
 *
 *   custo da venda = produto + imposto + taxa de cartão + frete
 *
 * - Produto: custo dos itens (informado pelo vendedor ou do cadastro). Venda sem custo recebe uma
 *   estimativa fixa entre custoProdutoMinPct e custoProdutoMaxPct do total (o percentual é sorteado
 *   pelo id da venda, então é sempre o mesmo para a mesma venda).
 * - Imposto: aliquotaSimplesPct do total.
 * - Taxa de cartão: crédito em 1x = taxaCartao1xPct, sobe em linha reta até taxaCartao12xPct em 12x;
 *   débito/link = taxa de 1x; dinheiro, PIX, boleto, transferência e crediário = 0.
 *   Venda sem forma de pagamento (histórico do Bling) = cartão em 1x.
 * - Frete: custoLogistica da venda; se zerado, freteVendaPadrao.
 * Os percentuais ficam em Configurações > Empresa.
 */
import { prisma } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';

export interface CfgCustos {
  impostoPct: number;
  cartao1xPct: number;
  cartao12xPct: number;
  frete: number;
  custoMinPct: number;
  custoMaxPct: number;
}

export const CFG_CUSTOS_PADRAO: CfgCustos = { impostoPct: 10, cartao1xPct: 5, cartao12xPct: 12, frete: 10, custoMinPct: 40, custoMaxPct: 70 };

let cache: { em: number; cfg: CfgCustos } | null = null;

export async function carregarCfgCustos(forcar = false): Promise<CfgCustos> {
  if (!forcar && cache && Date.now() - cache.em < 30_000) return cache.cfg;
  const e = await prisma.empresa.findUnique({
    where: { id: 1 },
    select: { aliquotaSimplesPct: true, taxaCartao1xPct: true, taxaCartao12xPct: true, freteVendaPadrao: true, custoProdutoMinPct: true, custoProdutoMaxPct: true },
  });
  const cfg: CfgCustos = e
    ? { impostoPct: e.aliquotaSimplesPct, cartao1xPct: e.taxaCartao1xPct, cartao12xPct: e.taxaCartao12xPct, frete: e.freteVendaPadrao, custoMinPct: e.custoProdutoMinPct, custoMaxPct: e.custoProdutoMaxPct }
    : CFG_CUSTOS_PADRAO;
  cache = { em: Date.now(), cfg };
  return cfg;
}

export function limparCacheCfgCustos() {
  cache = null;
}

/** Percentual de custo estimado, fixo para cada venda (entre o mínimo e o máximo configurados). */
export function pctCustoEstimado(vendaId: number, cfg: CfgCustos): number {
  const h = (Math.imul(vendaId || 1, 2654435761) >>> 0) % 1000 / 999;
  return arredondar(cfg.custoMinPct + (cfg.custoMaxPct - cfg.custoMinPct) * h, 1);
}

/** Taxa do cartão de crédito por número de parcelas: 1x = mínimo, 12x = máximo, linear no meio. */
export function taxaCartaoPct(parcelas: number, cfg: CfgCustos): number {
  const n = Math.min(12, Math.max(1, Math.round(parcelas || 1)));
  return arredondar(cfg.cartao1xPct + ((cfg.cartao12xPct - cfg.cartao1xPct) * (n - 1)) / 11, 2);
}

const TIPOS_CARTAO = ['CARTAO_CREDITO', 'CARTAO_DEBITO'];

export interface VendaParaCusto {
  id: number;
  total: number;
  custoTotal?: number | null;
  custoLogistica?: number | null;
  itens?: { custoUnitario: number; quantidade: number }[];
  parcelas?: { valor: number; formaPagamento?: { tipo: string } | null }[];
}

export interface CustosVenda {
  produto: number;
  produtoEstimado: boolean;
  produtoPct: number;
  imposto: number;
  impostoPct: number;
  taxaCartao: number;
  taxaCartaoPct: number;
  parcelasCartao: number;
  frete: number;
  total: number;
  lucro: number;
  margemPct: number;
}

export function custosVenda(v: VendaParaCusto, cfg: CfgCustos): CustosVenda {
  const total = v.total || 0;
  // produto
  let produto = v.custoTotal || (v.itens || []).reduce((s, i) => s + i.custoUnitario * i.quantidade, 0);
  let produtoEstimado = false;
  if (!(produto > 0) && total > 0) {
    produto = total * (pctCustoEstimado(v.id, cfg) / 100);
    produtoEstimado = true;
  }
  // imposto
  const imposto = total * (cfg.impostoPct / 100);
  // cartão
  const parcelas = v.parcelas || [];
  let taxaCartao = 0;
  let taxaPct = 0;
  let nCartao = 0;
  const semForma = !parcelas.length || parcelas.every((p) => !p.formaPagamento);
  if (semForma) {
    nCartao = 1;
    taxaPct = taxaCartaoPct(1, cfg);
    taxaCartao = total * (taxaPct / 100);
  } else {
    const credito = parcelas.filter((p) => p.formaPagamento?.tipo === 'CARTAO_CREDITO');
    const debito = parcelas.filter((p) => p.formaPagamento?.tipo === 'CARTAO_DEBITO');
    if (credito.length) {
      const pc = taxaCartaoPct(credito.length, cfg);
      taxaCartao += credito.reduce((s, p) => s + p.valor, 0) * (pc / 100);
      nCartao = credito.length;
      taxaPct = pc;
    }
    if (debito.length) {
      const pd = taxaCartaoPct(1, cfg);
      taxaCartao += debito.reduce((s, p) => s + p.valor, 0) * (pd / 100);
      if (!credito.length) {
        nCartao = 1;
        taxaPct = pd;
      }
    }
  }
  // frete
  const frete = (v.custoLogistica || 0) > 0 ? v.custoLogistica! : total > 0 ? cfg.frete : 0;
  const custo = produto + imposto + taxaCartao + frete;
  const lucro = total - custo;
  return {
    produto: arredondar(produto),
    produtoEstimado,
    produtoPct: total > 0 ? arredondar((produto / total) * 100, 1) : 0,
    imposto: arredondar(imposto),
    impostoPct: cfg.impostoPct,
    taxaCartao: arredondar(taxaCartao),
    taxaCartaoPct: taxaPct,
    parcelasCartao: nCartao,
    frete: arredondar(frete),
    total: arredondar(custo),
    lucro: arredondar(lucro),
    margemPct: total > 0 ? arredondar((lucro / total) * 100, 1) : 0,
  };
}

/** Campos que as consultas precisam selecionar para calcular o custo completo. */
export const SELECT_CUSTO_VENDA = {
  id: true,
  total: true,
  custoTotal: true,
  custoLogistica: true,
  itens: { select: { custoUnitario: true, quantidade: true } },
  parcelas: { select: { valor: true, formaPagamento: { select: { tipo: true } } } },
} as const;

export { TIPOS_CARTAO };
