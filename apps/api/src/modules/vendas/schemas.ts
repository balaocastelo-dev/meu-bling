import { z } from 'zod';
import { dataSchema, paginacaoSchema } from '../../lib/util.js';
import { boolQuery, idsQuery } from '../comum/zod.js';

export const ORIGENS = ['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'] as const;
/** PEDIDO = venda; ORCAMENTO = proposta (mesma tabela, numeração e situações próprias, sem estoque/financeiro). */
export const TIPOS_VENDA = ['PEDIDO', 'ORCAMENTO'] as const;
export type TipoVenda = (typeof TIPOS_VENDA)[number];

const texto = z.string().trim().nullable().optional();

export const itemSchema = z.object({
  produtoId: z.coerce.number().int().positive().nullable().optional(),
  codigo: texto,
  descricao: z.string().trim().optional(),
  unidade: z.string().trim().max(6).optional(),
  quantidade: z.coerce.number().positive('Quantidade deve ser maior que zero').default(1),
  /** omitido = preço de venda do produto */
  valorUnitario: z.coerce.number().min(0).optional(),
  desconto: z.coerce.number().min(0).default(0),
  comissaoPct: z.coerce.number().min(0).max(100).nullable().optional(),
  /** custo interno informado pelo vendedor; omitido/null = custo do cadastro do produto */
  custoUnitario: z.coerce.number().min(0).nullable().optional(),
  /** nº de série / IMEI (certificado de garantia) */
  numeroSerie: z.string().trim().max(120).nullable().optional(),
  /** anúncio da vitrine da equipe de onde veio este item (docs/VITRINE-EQUIPE.md) */
  anuncioId: z.coerce.number().int().positive().nullable().optional(),
});

export const parcelaSchema = z.object({
  dataVencimento: dataSchema,
  valor: z.coerce.number().min(0),
  formaPagamentoId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: texto,
  /** forma "Crédito bancário": quem paga o credor (CLIENTE = direto; LOJA = cliente paga a loja e a loja repassa) */
  creditoPagador: z.enum(['CLIENTE', 'LOJA']).nullable().optional(),
});

export const vendaSchema = z.object({
  /** só é lido na criação; no PUT o tipo não muda (converter usa a rota própria) */
  tipo: z.enum(TIPOS_VENDA).default('PEDIDO'),
  contatoId: z.coerce.number().int().positive(),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
  /** anúncio da vitrine da equipe que trouxe este cliente */
  anuncioId: z.coerce.number().int().positive().nullable().optional(),
  data: dataSchema,
  dataPrevista: dataSchema,
  dataSaida: dataSchema,
  /** orçamento: válido até (default = data + 7 dias) */
  validade: dataSchema,
  depositoId: z.coerce.number().int().positive().nullable().optional(),
  situacaoId: z.coerce.number().int().positive().nullable().optional(),
  origem: z.enum(ORIGENS).default('BALCAO'),
  numeroPedidoLoja: texto,
  categoriaFinanceiraId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: texto,
  observacoesInternas: texto,
  descontoTipo: z.enum(['REAL', 'PERCENTUAL']).default('REAL'),
  descontoValor: z.coerce.number().min(0).default(0),
  frete: z.coerce.number().min(0).default(0),
  outrasDespesas: z.coerce.number().min(0).default(0),
  /** custo interno de logística (não sai para o cliente) */
  custoLogistica: z.coerce.number().min(0).default(0),
  transportadoraId: z.coerce.number().int().positive().nullable().optional(),
  fretePorConta: z.coerce.number().int().default(9),
  quantidadeVolumes: z.coerce.number().int().min(0).default(0),
  pesoBruto: z.coerce.number().min(0).default(0),
  itens: z.array(itemSchema).min(1, 'Informe ao menos um item'),
  parcelas: z.array(parcelaSchema).default([]),
});

/** Campos que podem ser editados mesmo com estoque/contas lançados. */
export const CAMPOS_LIVRES = ['observacoes', 'observacoesInternas', 'transportadoraId', 'fretePorConta', 'quantidadeVolumes', 'pesoBruto', 'numeroPedidoLoja', 'dataPrevista', 'dataSaida', 'validade', 'custoLogistica'] as const;

export const listaQuery = paginacaoSchema.extend({
  /** PEDIDO (padrão) | ORCAMENTO | TODOS */
  tipo: z.enum([...TIPOS_VENDA, 'TODOS']).default('PEDIDO'),
  pesquisa: z.string().trim().optional(),
  situacaoId: z.coerce.number().int().optional(),
  situacoes: idsQuery,
  contatoId: z.coerce.number().int().optional(),
  vendedorId: z.coerce.number().int().optional(),
  dataInicial: dataSchema,
  dataFinal: dataSchema,
  origem: z.enum(ORIGENS).optional(),
  comNota: boolQuery,
  ordem: z.enum(['data', 'numero', 'total']).default('data'),
  direcao: z.enum(['asc', 'desc']).default('desc'),
});

export const situacaoBody = z.object({
  situacaoId: z.coerce.number().int().positive(),
  observacao: z.string().trim().nullable().optional(),
  forcar: z.boolean().optional(),
});

export const acoesBody = z.object({
  acoes: z.array(z.enum(['lancarEstoque', 'estornarEstoque', 'lancarContas', 'estornarContas', 'reservarEstoque', 'liberarReserva', 'gerarNfe'])).min(1),
});

export const gerarNfeBody = z.object({
  modelo: z.coerce.number().int().refine((v) => v === 55 || v === 65, 'modelo deve ser 55 ou 65').default(55),
  informacoesComplementares: z.string().trim().nullable().optional(),
});

export const notificarBody = z.object({
  canal: z.enum(['EMAIL', 'WHATSAPP']),
  templateId: z.coerce.number().int().positive().nullable().optional(),
  mensagem: z.string().nullable().optional(),
  assunto: z.string().nullable().optional(),
  /** anexa o PDF do pedido/orçamento (e-mail: attachment; WhatsApp: documento após o texto) */
  anexarPdf: z.boolean().optional(),
});

export const transferirVendedorBody = z.object({
  vendedorId: z.coerce.number().int().positive().nullable(),
  observacao: z.string().trim().nullable().optional(),
});

export const aprovarBody = z.object({
  aprovadoPor: z.string().trim().max(120).nullable().optional(),
  observacao: z.string().trim().max(500).nullable().optional(),
});

export const converterBody = z.object({
  /** situação inicial da venda gerada (default: inicial do módulo VENDA) */
  situacaoId: z.coerce.number().int().positive().nullable().optional(),
});

export const gerarParcelasBody = z.object({
  quantidade: z.coerce.number().int().min(1).max(48),
  primeiroVencimento: dataSchema,
  formaPagamentoId: z.coerce.number().int().positive().nullable().optional(),
  intervaloDias: z.coerce.number().int().min(1).default(30),
  /** total a parcelar; se omitido usa o total da venda */
  total: z.coerce.number().min(0).optional(),
});

export type VendaInput = z.infer<typeof vendaSchema>;
export type ItemInput = z.infer<typeof itemSchema>;
export type ParcelaInput = z.infer<typeof parcelaSchema>;
