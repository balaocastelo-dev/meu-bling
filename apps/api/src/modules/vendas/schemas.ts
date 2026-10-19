import { z } from 'zod';
import { dataSchema, paginacaoSchema } from '../../lib/util.js';
import { boolQuery, idsQuery } from '../comum/zod.js';

export const ORIGENS = ['BALCAO', 'WHATSAPP', 'LOJA_VIRTUAL', 'TELEFONE', 'MARKETPLACE', 'OUTRO'] as const;

const texto = z.string().trim().nullable().optional();

export const itemSchema = z.object({
  produtoId: z.coerce.number().int().positive().nullable().optional(),
  codigo: texto,
  descricao: z.string().trim().optional(),
  unidade: z.string().trim().max(6).optional(),
  quantidade: z.coerce.number().positive('Quantidade deve ser maior que zero').default(1),
  valorUnitario: z.coerce.number().min(0).default(0),
  desconto: z.coerce.number().min(0).default(0),
  comissaoPct: z.coerce.number().min(0).max(100).nullable().optional(),
});

export const parcelaSchema = z.object({
  dataVencimento: dataSchema,
  valor: z.coerce.number().min(0),
  formaPagamentoId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: texto,
});

export const vendaSchema = z.object({
  contatoId: z.coerce.number().int().positive(),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
  data: dataSchema,
  dataPrevista: dataSchema,
  dataSaida: dataSchema,
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
  transportadoraId: z.coerce.number().int().positive().nullable().optional(),
  fretePorConta: z.coerce.number().int().default(9),
  quantidadeVolumes: z.coerce.number().int().min(0).default(0),
  pesoBruto: z.coerce.number().min(0).default(0),
  itens: z.array(itemSchema).min(1, 'Informe ao menos um item'),
  parcelas: z.array(parcelaSchema).default([]),
});

/** Campos que podem ser editados mesmo com estoque/contas lançados. */
export const CAMPOS_LIVRES = ['observacoes', 'observacoesInternas', 'transportadoraId', 'fretePorConta', 'quantidadeVolumes', 'pesoBruto', 'numeroPedidoLoja', 'dataPrevista', 'dataSaida'] as const;

export const listaQuery = paginacaoSchema.extend({
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
