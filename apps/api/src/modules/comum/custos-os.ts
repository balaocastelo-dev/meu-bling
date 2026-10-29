/**
 * Custo completo de cada ORDEM DE SERVIÇO — a mesma regra da venda (custos-venda.ts), para o DRE, o
 * dashboard de assistência, o panorama, o "Pagar técnico" e a própria OS mostrarem sempre o mesmo número.
 *
 *   custo da OS = peças + imposto + taxa de cartão + logística + mão de obra de terceiro
 *
 * - Peças: custo de cada peça (digitado pelo técnico ou vindo do cadastro do produto). Se a OS tiver o
 *   "custo total das peças" informado no fechamento (custoPeca), ele vale no lugar da soma.
 *   Peça sem custo nenhum NÃO é estimada: vira PENDÊNCIA (o Robô da Saúde lembra o técnico de preencher).
 * - Imposto: aliquotaSimplesPct do total (Configurações > Fiscal), igual à venda.
 * - Taxa de cartão: pela forma de pagamento das parcelas (crédito 1x..12x, débito), igual à venda.
 *   Parcela sem forma de pagamento = 0 (não se chuta cartão numa OS).
 * - Logística: o que foi lançado na OS (frete, motoboy, envio). Vazio = 0 (o equipamento costuma vir pelo cliente).
 * - Mão de obra de terceiro: técnico ou laboratório de fora, lançado na OS.
 */
import { arredondar } from '../../lib/util.js';
import { CFG_CUSTOS_PADRAO, carregarCfgCustos, taxaCartaoPct, type CfgCustos } from './custos-venda.js';

export interface PendenciaCusto {
  campo: string;
  mensagem: string;
}

export interface OsParaCusto {
  total: number;
  totalPecas?: number;
  custoTotal?: number | null;
  custoPeca?: number | null;
  custoLogistica?: number | null;
  custoMaoObraTerceiro?: number | null;
  itens?: { tipo: string; descricao?: string; custoUnitario: number; quantidade: number }[];
  parcelas?: { valor: number; formaPagamento?: { tipo: string } | null; contaReceber?: { formaPagamento?: { tipo: string } | null } | null }[];
}

export interface CustosOs {
  pecas: number;
  /** INFORMADO = custo total digitado no fechamento; ITENS = soma do custo de cada peça (técnico ou cadastro) */
  pecasOrigem: 'INFORMADO' | 'ITENS';
  pecasSemCusto: number;
  imposto: number;
  impostoPct: number;
  taxaCartao: number;
  taxaCartaoPct: number;
  parcelasCartao: number;
  logistica: number;
  terceiros: number;
  total: number;
  lucro: number;
  margemPct: number;
  pendencias: PendenciaCusto[];
}

/** Última configuração carregada (o dashboard chama carregarCfgCustos() antes; se nunca carregou, usa o padrão). */
let ultimaCfg: CfgCustos | null = null;
export async function cfgCustosOs(): Promise<CfgCustos> {
  ultimaCfg = await carregarCfgCustos();
  return ultimaCfg;
}
export function cfgCustosAtual(): CfgCustos {
  return ultimaCfg ?? CFG_CUSTOS_PADRAO;
}

/** Peças da OS que estão sem custo nenhum (nem digitado, nem do cadastro) — o que o técnico precisa preencher. */
export function pecasSemCustoOs(o: Pick<OsParaCusto, 'custoPeca' | 'itens'>) {
  if ((o.custoPeca || 0) > 0) return [];
  return (o.itens || []).map((i, idx) => ({ i, idx })).filter(({ i }) => i.tipo === 'PECA' && !(i.custoUnitario > 0));
}

export function pendenciasCustoOs(o: Pick<OsParaCusto, 'custoPeca' | 'itens'>): PendenciaCusto[] {
  const sem = pecasSemCustoOs(o);
  if (!sem.length) return [];
  const nomes = sem
    .slice(0, 3)
    .map(({ i, idx }) => `${idx + 1}. ${i.descricao || 'peça'}`)
    .join('; ');
  return [{ campo: 'pecas.custo', mensagem: `${sem.length === 1 ? 'Peça sem custo' : `${sem.length} peças sem custo`}: ${nomes}${sem.length > 3 ? '…' : ''}.` }];
}

export function custosOs(o: OsParaCusto, cfg: CfgCustos = cfgCustosAtual()): CustosOs {
  const total = o.total || 0;
  // peças
  const somaItens = (o.itens || []).filter((i) => i.tipo === 'PECA').reduce((s, i) => s + (i.custoUnitario || 0) * i.quantidade, 0);
  const informado = (o.custoPeca || 0) > 0;
  const pecas = informado ? o.custoPeca! : o.itens ? somaItens : o.custoTotal || 0;
  // imposto
  const imposto = total * (cfg.impostoPct / 100);
  // cartão: pela forma da parcela (ou da conta a receber, quando já foi recebida com outra forma)
  let taxaCartao = 0;
  let taxaPct = 0;
  let nCartao = 0;
  const parcelas = (o.parcelas || []).map((p) => ({ valor: p.valor, tipo: p.contaReceber?.formaPagamento?.tipo || p.formaPagamento?.tipo || null }));
  const credito = parcelas.filter((p) => p.tipo === 'CARTAO_CREDITO');
  const debito = parcelas.filter((p) => p.tipo === 'CARTAO_DEBITO');
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
  const logistica = o.custoLogistica || 0;
  const terceiros = o.custoMaoObraTerceiro || 0;
  const custo = pecas + imposto + taxaCartao + logistica + terceiros;
  const lucro = total - custo;
  return {
    pecas: arredondar(pecas),
    pecasOrigem: informado ? 'INFORMADO' : 'ITENS',
    pecasSemCusto: pecasSemCustoOs(o).length,
    imposto: arredondar(imposto),
    impostoPct: cfg.impostoPct,
    taxaCartao: arredondar(taxaCartao),
    taxaCartaoPct: taxaPct,
    parcelasCartao: nCartao,
    logistica: arredondar(logistica),
    terceiros: arredondar(terceiros),
    total: arredondar(custo),
    lucro: arredondar(lucro),
    margemPct: total > 0 ? arredondar((lucro / total) * 100, 1) : 0,
    pendencias: pendenciasCustoOs(o),
  };
}

/** Campos que as consultas precisam selecionar para calcular o custo completo da OS. */
export const SELECT_CUSTO_OS = {
  total: true,
  totalPecas: true,
  custoTotal: true,
  custoPeca: true,
  custoLogistica: true,
  custoMaoObraTerceiro: true,
  itens: { select: { tipo: true, descricao: true, custoUnitario: true, quantidade: true } },
  parcelas: { select: { valor: true, formaPagamento: { select: { tipo: true } }, contaReceber: { select: { formaPagamento: { select: { tipo: true } } } } } },
} as const;
