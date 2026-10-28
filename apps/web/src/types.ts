/**
 * Tipos espelhando o contrato da API (docs/API.md) e o schema Prisma.
 * Mantidos aqui para o frontend inteiro compartilhar as mesmas definições.
 */

// ---------------------------------------------------------------------
// Genéricos
// ---------------------------------------------------------------------

export interface Paginado<T> {
  data: T[];
  meta: { total: number; pagina: number; limite: number; totalPaginas: number };
}

export interface ErroApi {
  erro: string;
  code?: string;
  detalhes?: unknown;
}

export type Perfil = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'TECNICO' | 'FINANCEIRO';
export type Modulo = 'VENDA' | 'COMPRA' | 'OS' | 'ORCAMENTO';

export interface Ref {
  id: number;
  nome: string;
}

// ---------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  vendedorId: number | null;
  tecnicoId: number | null;
  ativo?: boolean;
  ultimoLogin?: string | null;
  criadoEm?: string;
}

export interface LoginResposta {
  token: string;
  usuario: Usuario;
  senhaFraca?: boolean;
}

// ---------------------------------------------------------------------
// Situações (motor de status)
// ---------------------------------------------------------------------

export interface SituacaoRef {
  id: number;
  nome: string;
  cor: string;
  ordem?: number;
}

export interface Situacao extends SituacaoRef {
  modulo: Modulo;
  ordem: number;
  sistema: boolean;
  inicial: boolean;
  final: boolean;
  cancelamento: boolean;
  acoes: string[];
  ativo: boolean;
}

export interface SituacaoTransicao {
  id?: number;
  origemId: number;
  destinoId: number;
  ativo: boolean;
  acoes: string[];
}

export interface AcaoSituacao {
  nome: string;
  descricao: string;
  modulos: Modulo[];
}

export interface HistoricoSituacao {
  id: number;
  entidadeTipo: Modulo;
  entidadeId: number;
  deSituacaoId: number | null;
  deSituacao: string | null;
  paraSituacaoId: number;
  paraSituacao: string;
  observacao: string | null;
  usuario?: Ref | null;
  usuarioId?: number | null;
  data: string;
}

// ---------------------------------------------------------------------
// Cadastros auxiliares
// ---------------------------------------------------------------------

export interface Vendedor {
  id: number;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  comissaoPadraoPct: number;
  /** meta de vendas padrão (R$/mês) */
  metaMensal?: number;
  ativo: boolean;
}

export interface Tecnico {
  id: number;
  nome: string;
  email?: string | null;
  telefone?: string | null;
  especialidade?: string | null;
  comissaoPadraoPct: number;
  ativo: boolean;
}

export interface Deposito {
  id: number;
  nome: string;
  padrao: boolean;
  ativo: boolean;
  desconsiderarSaldo: boolean;
}

export type TipoFormaPagamento =
  | 'DINHEIRO'
  | 'PIX'
  | 'CARTAO_CREDITO'
  | 'CARTAO_DEBITO'
  | 'BOLETO'
  | 'TRANSFERENCIA'
  | 'CREDIARIO'
  | 'CREDITO_BANCARIO'
  | 'CARNE'
  | 'OUTRO';

export interface FormaPagamento {
  id: number;
  nome: string;
  tipo: TipoFormaPagamento;
  codigoFiscal: string;
  taxaPct: number;
  diasRecebimento: number;
  maxParcelas: number;
  /** banco/conta onde o dinheiro desta forma cai */
  contaFinanceiraId?: number | null;
  /** bancos que podem receber esta forma */
  contasPermitidas?: number[];
  /** CREDITO_BANCARIO: quem empresta (ex.: Lumicred) */
  credorId?: number | null;
  ativo: boolean;
}

export type GrupoDre =
  | 'RECEITA_BRUTA'
  | 'DEDUCAO'
  | 'CMV'
  | 'DESPESA_OPERACIONAL'
  | 'DESPESA_PESSOAL'
  | 'DESPESA_FINANCEIRA'
  | 'RECEITA_FINANCEIRA'
  | 'OUTRAS';

export interface CategoriaFinanceira {
  id: number;
  nome: string;
  tipo: 'RECEITA' | 'DESPESA';
  grupoDre: GrupoDre;
  paiId: number | null;
  ativo: boolean;
}

export interface CategoriaProduto {
  id: number;
  nome: string;
  paiId: number | null;
}

export interface ContaFinanceira {
  id: number;
  nome: string;
  tipo: 'CAIXA' | 'BANCO' | 'CARTAO' | 'INVESTIMENTO' | 'OUTRO' | 'COMPENSACAO';
  banco?: string | null;
  agencia?: string | null;
  conta?: string | null;
  saldoInicial: number;
  saldoAtual: number;
  saldoBanco?: number | null;
  saldoBancoEm?: string | null;
  padrao: boolean;
  ativo: boolean;
  cor?: string | null;
  openFinanceItemId?: string | null;
  openFinanceStatus?: string | null;
  ultimaSincronizacao?: string | null;
}

// ---------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------

export type TipoContato = 'CLIENTE' | 'FORNECEDOR' | 'TRANSPORTADORA' | 'AMBOS';

export interface Contato {
  id: number;
  tipo: TipoContato;
  tipoPessoa: 'F' | 'J' | 'E';
  nome: string;
  fantasia?: string | null;
  documento?: string | null;
  ie?: string | null;
  ieIsento: boolean;
  rg?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigoMunicipio?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  observacoes?: string | null;
  limiteCredito: number;
  indicadorIe: number;
  ativo: boolean;
  vendedorId?: number | null;
  vendedor?: Ref | null;
  criadoEm?: string;
  resumo?: {
    totalVendas: number;
    qtdVendas: number;
    qtdOs: number;
    emAberto: number;
    ultimaCompra: string | null;
  };
}

export interface HistoricoContato {
  vendas: { id: number; tipo?: TipoVenda; numero: number; data: string; total: number; situacao: SituacaoRef }[];
  ordens: { id: number; numero: number; dataEntrada: string; equipamento: string | null; total: number; situacao: SituacaoRef }[];
  contasReceber: ContaReceber[];
  notificacoes: Notificacao[];
  timeline: {
    data: string;
    tipo: string;
    titulo: string;
    descricao?: string | null;
    referencia?: { tipo: string; id: number } | null;
  }[];
}

// ---------------------------------------------------------------------
// Produtos / estoque
// ---------------------------------------------------------------------

export interface Produto {
  id: number;
  tipo: 'P' | 'S';
  nome: string;
  codigo?: string | null;
  gtin?: string | null;
  unidade: string;
  preco: number;
  precoCusto: number;
  descricaoCurta?: string | null;
  descricaoDetalhada?: string | null;
  imagemUrl?: string | null;
  marca?: string | null;
  peso?: number | null;
  estoqueMinimo: number;
  controlaEstoque: boolean;
  garantiaDias: number;
  ativo: boolean;
  ncm?: string | null;
  cest?: string | null;
  cfopPadrao?: string | null;
  origem: number;
  csosn?: string | null;
  cst?: string | null;
  icmsAliquota: number;
  pisCst: string;
  cofinsCst: string;
  ipiCst?: string | null;
  codigoServico?: string | null;
  issAliquota: number;
  categoriaId?: number | null;
  categoria?: Ref | null;
  estoqueTotal?: number;
  estoqueReservado?: number;
  saldos?: { depositoId: number; deposito: string; saldo: number; reservado: number }[];
  // ---- vindos do site www.balao.info (sincronização)
  siteId?: string | null;
  siteSlug?: string | null;
  prontaEntrega?: boolean;
  disponibilidade?: string | null;
  precoCartao?: number | null;
  fornecedor?: string | null;
  siteSincronizadoEm?: string | null;
}

export interface SaldoEstoque {
  produtoId: number;
  nome: string;
  codigo?: string | null;
  deposito: string;
  depositoId?: number;
  saldo: number;
  reservado: number;
  estoqueMinimo: number;
  precoCusto: number;
}

export interface MovimentoEstoque {
  id: number;
  produtoId: number;
  produto?: Ref | null;
  depositoId: number;
  deposito?: Ref | null;
  tipo: 'ENTRADA' | 'SAIDA' | 'AJUSTE' | 'TRANSFERENCIA';
  quantidade: number;
  custoUnitario: number;
  saldoAnterior: number;
  saldoPosterior: number;
  origemTipo: string;
  origemId?: number | null;
  observacao?: string | null;
  usuario?: Ref | null;
  data: string;
}

// ---------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------

export type OrigemVenda = 'BALCAO' | 'WHATSAPP' | 'LOJA_VIRTUAL' | 'TELEFONE' | 'MARKETPLACE' | 'OUTRO';

export interface VendaItem {
  id?: number;
  produtoId: number | null;
  codigo?: string | null;
  descricao: string;
  unidade?: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total?: number;
  /** custo interno (nunca vai para o cliente) */
  custoUnitario?: number | null;
  /** true = custo digitado pelo vendedor; false = custo do cadastro do produto */
  custoInformado?: boolean;
  comissaoPct?: number;
  comissaoValor?: number;
  /** nº de série / IMEI (sai no certificado de garantia) */
  numeroSerie?: string | null;
  /** vindo da API (GET /vendas/:id) */
  produto?: { id: number; nome: string; imagemUrl?: string | null; prontaEntrega?: boolean } | null;
  /** só na tela do formulário (não vai para a API) */
  imagemUrl?: string | null;
  prontaEntrega?: boolean;
}

export interface Parcela {
  id?: number;
  numero?: number;
  dataVencimento: string;
  valor: number;
  formaPagamentoId: number | null;
  formaPagamento?: Ref | null;
  observacoes?: string | null;
  /** forma "Crédito bancário": quem paga o credor */
  creditoPagador?: 'CLIENTE' | 'LOJA' | null;
  contaReceber?: { id: number; situacao: string; valorRecebido: number } | null;
  contaPagar?: { id: number; situacao: string; valorPago: number } | null;
}

export interface NotaRef {
  id: number;
  numero: number;
  situacao: string;
  chave?: string | null;
}

/** PEDIDO = venda; ORCAMENTO = proposta (não movimenta estoque/financeiro; vira venda ao converter) */
export type TipoVenda = 'PEDIDO' | 'ORCAMENTO';

export interface VendaResumo {
  id: number;
  tipo: TipoVenda;
  numero: number;
  validade?: string | null;
  aprovadoEm?: string | null;
  aprovadoPor?: string | null;
  vendedorId?: number | null;
  orcamento?: { id: number; numero: number } | null;
  vendaGerada?: { id: number; numero: number } | null;
  data: string;
  dataPrevista?: string | null;
  contato: Ref;
  vendedor?: Ref | null;
  situacao: SituacaoRef;
  total: number;
  totalProdutos: number;
  notaId?: number | null;
  nota?: NotaRef | null;
  /** robô de NF: PRONTA acende o selo "Pronto pra NF" */
  roboNf?: { status: 'PRONTA' | 'PENDENTE' | 'EMITIDA' | 'IGNORADA'; erros: number } | null;
  estoqueLancado: boolean;
  contasLancadas: boolean;
  origem?: OrigemVenda;
  criadoEm?: string;
  atualizadoEm?: string;
}

export interface Comissao {
  id: number;
  tipo: 'VENDEDOR' | 'TECNICO';
  vendedorId?: number | null;
  vendedor?: Ref | null;
  tecnicoId?: number | null;
  tecnico?: Ref | null;
  origemTipo: 'VENDA' | 'OS' | 'DESAFIO';
  vendaId?: number | null;
  osId?: number | null;
  desafioId?: number | null;
  venda?: { id: number; numero: number } | null;
  os?: { id: number; numero: number } | null;
  desafio?: { id: number; titulo: string } | null;
  descricao?: string | null;
  base: number;
  pct: number;
  valor: number;
  status: 'PENDENTE' | 'APROVADA' | 'PAGA' | 'CANCELADA';
  competencia: string;
  pagoEm?: string | null;
  criadoEm?: string;
}

export interface Venda extends VendaResumo {
  contatoId: number;
  vendedorId: number | null;
  depositoId: number | null;
  deposito?: Ref | null;
  categoriaFinanceiraId: number | null;
  categoriaFinanceira?: Ref | null;
  origem: OrigemVenda;
  numeroPedidoLoja?: string | null;
  linkPagamentoUrl?: string | null;
  linkPagamentoValor?: number | null;
  linkPagamentoEm?: string | null;
  descontoTipo: 'REAL' | 'PERCENTUAL';
  descontoValor: number;
  frete: number;
  outrasDespesas: number;
  custoTotal?: number;
  custoLogistica?: number;
  /** lucro/margem — só ADMIN/GERENTE (null para os demais) */
  fechamento?: FechamentoVenda | null;
  observacoes?: string | null;
  observacoesInternas?: string | null;
  transportadoraId?: number | null;
  transportadora?: Ref | null;
  fretePorConta: number;
  quantidadeVolumes: number;
  pesoBruto: number;
  itens: VendaItem[];
  parcelas: Parcela[];
  comissoes: Comissao[];
  historico: HistoricoSituacao[];
  situacoesPermitidas: SituacaoRef[];
  /** o que falta para finalizar a venda (vazio = pode finalizar) */
  finalizacao?: { podeFinalizar: boolean; pendencias: PendenciaFinalizacao[] };
  contato: Contato | Ref;
  linkPublico?: string;
  tokenPublico?: string;
}

export interface FechamentoVenda {
  custoProdutos: number;
  custoProdutoEstimado?: boolean;
  custoProdutoPct?: number;
  imposto?: number;
  impostoPct?: number;
  taxaCartao?: number;
  taxaCartaoPct?: number;
  parcelasCartao?: number;
  frete?: number;
  custoLogistica: number;
  custoTotal: number;
  lucro: number;
  margemPct: number;
  itensSemCusto: number;
  itensCustoInformado: number;
}

export interface VendaPayload {
  tipo?: TipoVenda;
  validade?: string | null;
  contatoId: number | null;
  vendedorId: number | null;
  data: string;
  dataPrevista: string | null;
  depositoId: number | null;
  situacaoId: number | null;
  origem: OrigemVenda;
  categoriaFinanceiraId: number | null;
  observacoes: string;
  observacoesInternas: string;
  descontoTipo: 'REAL' | 'PERCENTUAL';
  descontoValor: number;
  frete: number;
  outrasDespesas: number;
  custoLogistica: number;
  transportadoraId: number | null;
  fretePorConta: number;
  quantidadeVolumes: number;
  pesoBruto: number;
  itens: VendaItem[];
  parcelas: Parcela[];
}

// ---------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------

export interface CompraItem {
  id?: number;
  produtoId: number | null;
  descricao: string;
  codigoFornecedor?: string | null;
  unidade?: string;
  quantidade: number;
  valorUnitario: number;
  ipiPct: number;
  total?: number;
}

export interface CompraResumo {
  id: number;
  numero: number;
  data: string;
  dataPrevista?: string | null;
  fornecedor: Ref;
  situacao: SituacaoRef;
  total: number;
  totalProdutos: number;
  estoqueLancado: boolean;
  contasLancadas: boolean;
  nfeNumero?: string | null;
}

export interface Compra extends CompraResumo {
  fornecedorId: number;
  depositoId: number | null;
  deposito?: Ref | null;
  categoriaFinanceiraId: number | null;
  ordemCompra?: string | null;
  nfeChave?: string | null;
  descontoValor: number;
  frete: number;
  outrasDespesas: number;
  observacoes?: string | null;
  observacoesInternas?: string | null;
  itens: CompraItem[];
  parcelas: Parcela[];
  historico: HistoricoSituacao[];
  situacoesPermitidas: SituacaoRef[];
  fornecedor: Contato | Ref;
}

export interface CompraPayload {
  fornecedorId: number | null;
  data: string;
  dataPrevista: string | null;
  depositoId: number | null;
  situacaoId: number | null;
  categoriaFinanceiraId: number | null;
  ordemCompra: string;
  nfeChave: string;
  nfeNumero: string;
  descontoValor: number;
  frete: number;
  outrasDespesas: number;
  observacoes: string;
  observacoesInternas: string;
  itens: CompraItem[];
  parcelas: Parcela[];
}

// ---------------------------------------------------------------------
// Ordens de serviço
// ---------------------------------------------------------------------

export type Prioridade = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE';

export interface OsItem {
  id?: number;
  tipo: 'PECA' | 'SERVICO';
  produtoId: number | null;
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total?: number;
  custoUnitario?: number;
  comissaoVendedorPct: number;
  comissaoTecnicoPct: number;
  depositoId: number | null;
  estoqueBaixado?: boolean;
}

export interface OsAnexo {
  id: number;
  nome: string;
  caminho?: string;
  url?: string;
  mime?: string | null;
  tamanho?: number | null;
  criadoEm?: string;
}

export interface OsResumo {
  id: number;
  numero: number;
  dataEntrada: string;
  dataPrevista?: string | null;
  contato: Ref;
  tecnico?: Ref | null;
  vendedor?: Ref | null;
  situacao: SituacaoRef;
  equipamento?: string | null;
  marca?: string | null;
  modelo?: string | null;
  defeitoRelatado?: string | null;
  total: number;
  prioridade: Prioridade;
  orcar: boolean;
  orcamentoAprovado: boolean;
  atrasada?: boolean;
}

export interface OrdemServico extends OsResumo {
  contatoId: number;
  vendedorId: number | null;
  tecnicoId: number | null;
  depositoId: number | null;
  deposito?: Ref | null;
  categoriaFinanceiraId: number | null;
  categoriaFinanceira?: Ref | null;
  dataConclusao?: string | null;
  dataSaida?: string | null;
  numeroSerie?: string | null;
  acessorios?: string | null;
  senhaEquipamento?: string | null;
  estadoFisico?: string | null;
  diagnostico?: string | null;
  servicoExecutado?: string | null;
  observacoes?: string | null;
  observacoesInternas?: string | null;
  orcamentoAprovadoEm?: string | null;
  orcamentoAprovadoPor?: string | null;
  totalServicos: number;
  totalPecas: number;
  descontoValor: number;
  custoTotal?: number;
  /** custos internos do fechamento (não vão para o cliente) */
  custoPeca: number;
  custoLogistica: number;
  custoMaoObraTerceiro: number;
  /** lucro/margem — só ADMIN/GERENTE (null para os demais) */
  fechamento?: FechamentoOs | null;
  garantiaDias: number;
  estoqueLancado: boolean;
  contasLancadas: boolean;
  nota?: NotaRef | null;
  itens: OsItem[];
  parcelas: Parcela[];
  anexos: OsAnexo[];
  comissoes: Comissao[];
  historico: HistoricoSituacao[];
  situacoesPermitidas: SituacaoRef[];
  contato: Contato | Ref;
  /** token/link público de acompanhamento (se a API devolver) */
  token?: string | null;
  linkPublico?: string | null;
}

export interface OsPayload {
  contatoId: number | null;
  vendedorId: number | null;
  tecnicoId: number | null;
  depositoId: number | null;
  categoriaFinanceiraId: number | null;
  situacaoId: number | null;
  dataEntrada: string;
  dataPrevista: string | null;
  prioridade: Prioridade;
  equipamento: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  acessorios: string;
  senhaEquipamento: string;
  estadoFisico: string;
  defeitoRelatado: string;
  diagnostico: string;
  servicoExecutado: string;
  observacoes: string;
  observacoesInternas: string;
  orcar: boolean;
  garantiaDias: number;
  descontoValor: number;
  custoPeca: number;
  custoLogistica: number;
  custoMaoObraTerceiro: number;
  itens: OsItem[];
  parcelas: Parcela[];
}

export interface FechamentoOs {
  custoPecas: number;
  custoPecasOrigem: 'INFORMADO' | 'CADASTRO';
  custoLogistica: number;
  custoMaoObraTerceiro: number;
  custoTotal: number;
  lucro: number;
  margemPct: number;
}

export interface TotaisAssistencia {
  qtd: number;
  valorEntrada: number;
  maoDeObra: number;
  pecas: number;
  descontos: number;
  custoPecas: number;
  custoLogistica: number;
  custoTerceiros: number;
  custoTotal: number;
  lucro: number;
  ticketMedio: number;
  margemPct: number;
  lucroMaoDeObra: number;
  lucroPecas: number;
}

export interface DashboardAssistencia {
  periodo: { dataInicial: string; dataFinal: string; agrupar: string; base: 'entrada' | 'conclusao' };
  resumo: TotaisAssistencia & {
    entradas: number;
    concluidas: number;
    emAndamento: number;
    canceladas: number;
    semCusto: number;
    realizado: TotaisAssistencia;
    previsto: TotaisAssistencia;
    comparativo: TotaisAssistencia;
  };
  series: { periodo: string; valorEntrada: number; custo: number; lucro: number; qtd: number }[];
  porTecnico: { id: number | null; nome: string; qtd: number; valorEntrada: number; maoDeObra: number; pecas: number; custo: number; lucro: number }[];
  porEquipamento: { nome: string; qtd: number; valorEntrada: number; lucro: number }[];
  porSituacao: { id: number; nome: string; cor: string; qtd: number; valor: number }[];
  ordens: (FechamentoOs & {
    id: number;
    numero: number;
    dataEntrada: string;
    dataConclusao: string | null;
    cliente: string;
    contatoId: number;
    equipamento: string;
    tecnico: string | null;
    situacao: { id: number; nome: string; cor: string };
    cancelada: boolean;
    concluida: boolean;
    valorEntrada: number;
    maoDeObra: number;
    pecas: number;
    desconto: number;
  })[];
}

export interface KanbanColuna {
  situacao: SituacaoRef & { ordem: number };
  ordens: OsResumo[];
}

// ---------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------

export type SituacaoConta = 'ABERTO' | 'RECEBIDO' | 'PAGO' | 'PARCIAL' | 'CANCELADO';

export interface ContaBase {
  id: number;
  contatoId?: number | null;
  contato?: Ref | null;
  descricao: string;
  dataEmissao: string;
  vencimento: string;
  competencia?: string | null;
  valor: number;
  juros: number;
  desconto: number;
  situacao: SituacaoConta;
  formaPagamentoId?: number | null;
  formaPagamento?: Ref | null;
  contaFinanceiraId?: number | null;
  contaFinanceira?: Ref | null;
  categoriaId?: number | null;
  categoria?: Ref | null;
  origemTipo: string;
  origemId?: number | null;
  origem?: { tipo: string; id: number; numero?: number } | null;
  parcela?: string | null;
  observacoes?: string | null;
  atrasada?: boolean;
  /** saldo em aberto calculado pela API (valor + juros - pago - desconto) */
  saldo?: number;
  /** pagamentos/recebimentos (baixas) — só no detalhe */
  lancamentos?: MovimentoFinanceiro[];
}

export interface ContaReceber extends ContaBase {
  valorRecebido: number;
  dataRecebimento?: string | null;
  vendedorId?: number | null;
  vendedor?: Ref | null;
}

export interface ContaPagar extends ContaBase {
  valorPago: number;
  dataPagamento?: string | null;
  recorrente: boolean;
}

export interface ContasResposta<T> extends Paginado<T> {
  totais: { aberto: number; recebido?: number; pago?: number; atrasado: number };
}

export interface ResumoFinanceiro {
  saldoContas: { id: number; nome: string; tipo: string; saldoAtual: number; saldoBanco?: number | null; cor?: string | null }[];
  saldoTotal: number;
  receberHoje: number;
  receberSemana: number;
  receberAtrasado: number;
  pagarHoje: number;
  pagarSemana: number;
  pagarAtrasado: number;
}

export interface FluxoCaixa {
  saldoInicial: number;
  series: { periodo: string; entradas: number; saidas: number; saldo: number }[];
  realizado?: { entradas: number; saidas: number; saldo: number };
  previsto: { periodo: string; receber: number; pagar: number }[];
}

export interface MovimentoFinanceiro {
  id: number;
  contaFinanceiraId: number;
  contaFinanceira?: Ref | null;
  data: string;
  tipo: 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA';
  valor: number;
  juros?: number;
  desconto?: number;
  descricao: string;
  categoria?: Ref | null;
  conciliado: boolean;
  observacoes?: string | null;
}

export interface TransacaoBancaria {
  id: number;
  contaFinanceiraId: number;
  contaFinanceira?: Ref | null;
  externalId: string;
  data: string;
  descricao: string;
  valor: number;
  tipo: 'CREDITO' | 'DEBITO';
  categoriaSugerida?: string | null;
  conciliado: boolean;
  fonte: string;
  sugestoes?: { tipo: 'RECEBER' | 'PAGAR'; id: number; descricao: string; valor: number; vencimento: string; score: number }[];
}

export interface ComissoesResposta extends Paginado<Comissao> {
  totais: { pendente: number; aprovada: number; paga: number };
}

export interface ComissaoResumo {
  tipo: 'VENDEDOR' | 'TECNICO';
  pessoaId: number;
  nome: string;
  qtd: number;
  base: number;
  valor: number;
  pendente: number;
  paga: number;
}

// ---------------------------------------------------------------------
// Fiscal
// ---------------------------------------------------------------------

export type SituacaoNota =
  | 'PENDENTE'
  | 'PROCESSANDO'
  | 'AUTORIZADA'
  | 'REJEITADA'
  | 'CANCELADA'
  | 'DENEGADA'
  | 'INUTILIZADA'
  | 'ERRO';

export interface NotaFiscalItem {
  id?: number;
  numeroItem?: number;
  produtoId: number | null;
  codigo: string;
  gtin?: string | null;
  descricao: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal?: number;
  desconto: number;
  origem?: number;
  csosn?: string | null;
  cst?: string | null;
  icmsAliquota?: number;
  icmsValor?: number;
}

export interface NotaFiscalEvento {
  id: number;
  tipo: 'CANCELAMENTO' | 'CARTA_CORRECAO' | 'INUTILIZACAO';
  sequencia: number;
  justificativa?: string | null;
  protocolo?: string | null;
  cStat?: string | null;
  motivo?: string | null;
  status: 'PENDENTE' | 'AUTORIZADO' | 'REJEITADO' | 'ERRO';
  data: string;
}

export interface NotaFiscalResumo {
  id: number;
  tipo: 0 | 1;
  modelo: 55 | 65;
  serie: number;
  numero: number;
  chave?: string | null;
  situacao: SituacaoNota;
  dataEmissao: string;
  contato?: { id?: number; nome: string } | null;
  valorTotal: number;
  venda?: { id: number; numero: number } | null;
  os?: { id: number; numero: number } | null;
  motivo?: string | null;
}

export interface NotaFiscal extends NotaFiscalResumo {
  ambiente: number;
  naturezaOperacao: string;
  finalidade: number;
  consumidorFinal: number;
  valorProdutos: number;
  valorFrete: number;
  valorDesconto: number;
  valorOutras: number;
  valorIcms: number;
  formaPagamentoFiscal: string;
  informacoesComplementares?: string | null;
  protocolo?: string | null;
  cStat?: string | null;
  dataAutorizacao?: string | null;
  itens: NotaFiscalItem[];
  eventos: NotaFiscalEvento[];
  contato?: Contato | null;
}

export interface StatusSefaz {
  online: boolean;
  cStat?: string;
  motivo?: string;
  ambiente?: number;
}

// ---------------------------------------------------------------------
// Comunicação
// ---------------------------------------------------------------------

export type CanalNotificacao = 'EMAIL' | 'WHATSAPP';

export interface Notificacao {
  id: number;
  canal: CanalNotificacao;
  destinatario: string;
  assunto?: string | null;
  corpo: string;
  status: 'PENDENTE' | 'ENVIANDO' | 'ENVIADA' | 'ERRO' | 'CANCELADA';
  erro?: string | null;
  tentativas: number;
  origemTipo?: string | null;
  origemId?: number | null;
  contato?: Ref | null;
  agendadaPara: string;
  enviadaEm?: string | null;
  criadoEm: string;
}

export interface TemplateNotificacao {
  id: number;
  nome: string;
  evento: string;
  canal: CanalNotificacao;
  situacaoId: number | null;
  situacao?: SituacaoRef | null;
  assunto?: string | null;
  corpo: string;
  anexarPdf: boolean;
  ativo: boolean;
}

export interface WhatsappStatus {
  status: 'DESCONECTADO' | 'AGUARDANDO_QR' | 'CONECTANDO' | 'CONECTADO';
  qrDataUrl?: string;
  numero?: string;
  nome?: string;
  desde?: string;
}

// ---------------------------------------------------------------------
// Dashboards / relatórios
// ---------------------------------------------------------------------

/** Último movimento no dashboard: pode ser de estoque ou financeiro (a API devolve financeiro) */
export interface MovimentoDashboard {
  id: number;
  data: string;
  tipo: string;
  valor?: number;
  descricao?: string;
  quantidade?: number;
  saldoPosterior?: number;
  origemTipo?: string;
  origemId?: number | null;
  produtoId?: number;
  produto?: Ref | null;
  contaFinanceira?: Ref | null;
  categoria?: Ref | null;
}

export interface TotaisPanorama {
  faturamento: number;
  custo: number;
  lucro: number;
  margemPct: number;
  qtd: number;
  ticketMedio: number;
  vendas: { valor: number; qtd: number; custo: number; lucro: number; margemPct: number; ticketMedio: number };
  assistencia: { valor: number; qtd: number; maoDeObra: number; pecas: number; custoPecas: number; custoLogistica: number; custoTerceiros: number; custo: number; lucro: number; margemPct: number; ticketMedio: number };
  caixa: { entradas: number; saidas: number; saldo: number };
}

export interface DashboardPanorama {
  periodo: { dataInicial: string; dataFinal: string; agrupar: 'dia' | 'semana' | 'mes'; base: 'entrada' | 'conclusao' };
  resumo: TotaisPanorama & { comparativo: TotaisPanorama; osSemCusto: number; melhorPeriodo: { periodo: string; valor: number } | null };
  series: { periodo: string; vendas: number; assistencia: number; lucro: number; entradas: number; saidas: number }[];
  porVendedor: { id: number | null; nome: string; valor: number; qtd: number; lucro: number }[];
  porTecnico: { id: number | null; nome: string; valor: number; qtd: number; lucro: number }[];
}

export interface DashboardGeral {
  hoje: { vendas: number; valorVendas: number; osAbertas: number; osConcluidasHoje: number };
  financeiro: { saldoTotal: number; receberHoje: number; receberAtrasado: number; pagarHoje: number; pagarAtrasado: number; saldoContas?: ResumoFinanceiro['saldoContas'] } | null;
  os: { porSituacao: (SituacaoRef & { qtd: number })[]; atrasadas: number };
  vendas: { porSituacao: (SituacaoRef & { qtd: number; valor?: number })[] };
  estoque: { abaixoMinimo: { produtoId: number; nome: string; codigo?: string | null; saldo: number; estoqueMinimo: number }[]; qtdAbaixoMinimo: number };
  fiscal: { pendentes: number; rejeitadas: number; ambiente?: string };
  comissoes: { pendentes: number; valorPendente?: number } | null;
  whatsapp: { status: WhatsappStatus['status']; numero?: string | null };
  ultimosMovimentos: MovimentoDashboard[];
  alertas: { tipo: string; mensagem: string; link?: string }[];
}

export interface DashboardVendas {
  resumo: {
    faturamento: number;
    qtdVendas: number;
    ticketMedio: number;
    itensVendidos: number;
    lucroBruto: number;
    margemPct: number;
    semCusto?: number;
    comparativo?: { faturamento: number; qtdVendas: number; ticketMedio: number } | null;
  };
  series: { periodo: string; faturamento: number; qtd: number; lucro: number }[];
  porVendedor: { id: number; nome: string; faturamento: number; qtd: number; comissao: number }[];
  porFormaPagamento: { nome: string; valor: number; qtd: number }[];
  porOrigem: { nome: string; valor: number; qtd: number }[];
  topProdutos: { produtoId: number; nome: string; qtd: number; valor: number; imagemUrl?: string | null }[];
  topClientes: { contatoId: number; nome: string; valor: number; qtd: number }[];
  porSituacao: (SituacaoRef & { qtd: number; valor?: number })[];
  porCategoria: { nome: string; valor: number; qtd: number }[];
}

export interface DreLinha {
  codigo: string;
  nome: string;
  valor: number;
  nivel?: number;
  total?: boolean;
  pct?: number;
  itens?: { nome: string; valor: number }[];
}

export interface Dre {
  periodo: { dataInicial: string; dataFinal: string };
  regime: 'competencia' | 'caixa';
  linhas: DreLinha[];
  mensal: { competencia: string; receita: number; cmv: number; despesas: number; resultado: number }[];
  comparativo?: { linhas: DreLinha[] } | null;
  /** contas lançadas que já estão cobertas pelo custo de cada venda (fora do resultado, só para conferência) */
  informativo?: { nome: string; valor: number; categoriaId?: number | null }[];
}

// ---------------------------------------------------------------------
// Empresa / integrações
// ---------------------------------------------------------------------

export interface Empresa {
  id: number;
  razaoSocial: string;
  nomeFantasia?: string | null;
  cnpj: string;
  ie?: string | null;
  im?: string | null;
  crt: number;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  codigoMunicipio?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | null;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  logoPath?: string | null;
  ambienteFiscal: number;
  serieNfe: number;
  proximoNumeroNfe: number;
  serieNfce: number;
  proximoNumeroNfce: number;
  cscId?: string | null;
  cscToken?: string | null;
  naturezaOperacaoPadrao: string;
  cfopPadraoDentroUf: string;
  cfopPadraoForaUf: string;
  csosnPadrao: string;
  aliquotaSimplesPct: number;
  taxaCartao1xPct?: number;
  taxaCartao12xPct?: number;
  freteVendaPadrao?: number;
  custoProdutoMinPct?: number;
  custoProdutoMaxPct?: number;
  provedorFiscal: 'mock' | 'sefaz';
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure: boolean;
  smtpUser?: string | null;
  smtpFrom?: string | null;
  smtpAtivo: boolean;
  certificado?: { nome?: string | null; validade?: string | null; temCertificado: boolean };
  smtp?: { temSenha: boolean };
  whatsapp?: { ativo: boolean };
  openFinance?: { ativo: boolean; clientId?: string | null; temSecret: boolean };
  bling?: { temToken: boolean; expira?: string | null; clientId?: string | null; temSecret?: boolean };
  mercadoPago?: { temToken: boolean };
  blingClientId?: string | null;
  temCscToken?: boolean;
}

export interface BlingStatus {
  conectado: boolean;
  configurado?: boolean;
  expira?: string | null;
  ultimaImportacao?: string | null;
  callbackUrl?: string;
}

export interface BlingImportStatus {
  emAndamento: boolean;
  progresso?: { entidade: string; feitos: number; total: number } | null;
  log: string[];
}

export interface OpenFinanceStatus {
  ativo: boolean;
  provedor?: string;
  configurado: boolean;
}

// ---------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------

export interface EmpresaPublica {
  nome: string;
  telefone?: string | null;
  email?: string | null;
  site?: string | null;
  endereco?: string | null;
  logoPath?: string | null;
}

export interface OsPublica {
  numero: number;
  /** primeiro nome do cliente */
  cliente?: string | null;
  dataEntrada: string;
  dataPrevista?: string | null;
  dataConclusao?: string | null;
  situacao: SituacaoRef;
  equipamento?: string | null;
  numeroSerie?: string | null;
  defeitoRelatado?: string | null;
  diagnostico?: string | null;
  servicoExecutado?: string | null;
  tecnico?: string | null;
  atrasada?: boolean;
  orcar: boolean;
  orcamentoAprovado: boolean;
  orcamentoAprovadoEm?: string | null;
  podeAprovar?: boolean;
  itens: { tipo?: string; descricao: string; quantidade: number; valorUnitario: number; desconto?: number; total: number }[];
  totalServicos?: number;
  totalPecas?: number;
  descontoValor?: number;
  total: number;
  garantiaDias?: number;
  parcelas?: { numero: number; dataVencimento: string; valor: number; formaPagamento?: string | null; situacao?: string | null }[];
  observacoes?: string | null;
  historico?: { data: string; paraSituacao: string }[];
}

/** Resposta de GET /publico/os/:token */
export interface OsPublicaResposta {
  empresa: EmpresaPublica;
  os: OsPublica;
}

export interface VendaPublica {
  tipo?: TipoVenda;
  validade?: string | null;
  aprovadoEm?: string | null;
  expirado?: boolean;
  podeAprovar?: boolean;
  numero: number;
  cliente?: string | null;
  data: string;
  dataPrevista?: string | null;
  vendedor?: string | null;
  situacao: SituacaoRef;
  itens: { descricao: string; quantidade: number; unidade?: string; valorUnitario: number; desconto?: number; total: number }[];
  totalProdutos?: number;
  desconto?: number;
  frete?: number;
  outrasDespesas?: number;
  total: number;
  parcelas?: { numero: number; dataVencimento: string; valor: number; formaPagamento?: string | null; situacao?: string | null }[];
  observacoes?: string | null;
}

/** Resposta de GET /publico/venda/:token */
export interface VendaPublicaResposta {
  empresa: EmpresaPublica;
  venda: VendaPublica;
}

// ---------------------------------------------------------------- metas, desafios e painel do vendedor
export type TipoDesafio = 'VALOR' | 'QTD_VENDAS' | 'QTD_ITENS';
export type StatusDesafioCard = 'EM_ANDAMENTO' | 'AGENDADO' | 'CONQUISTADO' | 'GANHO_POR_OUTRO' | 'ENCERRADO';

export interface PeriodoPainel {
  chave: 'hoje' | 'semana' | 'ultimos7' | 'mes' | 'ultimos30' | 'sempre';
  rotulo: string;
  inicio: string | null;
  fim: string | null;
  faturamento: number;
  qtd: number;
  ticketMedio: number;
  comissao: number;
}

export interface MetaPainel {
  competencia: string;
  valor: number;
  origem: 'MES' | 'PADRAO';
  vendido: number;
  pct: number;
  falta: number;
  diasRestantes: number;
  porDia: number;
  esperadoAteHoje: number;
  ritmo: 'sem-meta' | 'batida' | 'ok' | 'atencao' | 'atrasado';
  bonusDesafios: number;
}

export interface DesafioCard {
  id: number;
  titulo: string;
  descricao?: string | null;
  tipo: TipoDesafio;
  alvo: number;
  premio: number;
  regra: 'TODOS' | 'PRIMEIRO';
  inicio: string;
  fim: string;
  produto?: { id: number; nome: string; codigo?: string | null } | null;
  categoria?: Ref | null;
  atingido: number;
  pct: number;
  falta: number;
  status: StatusDesafioCard;
  conquistadoEm?: string | null;
  premioStatus?: Comissao['status'] | null;
  ganhador?: string | null;
  diasRestantes: number;
}

export interface PainelVendedor {
  vendedor: Ref;
  periodos: PeriodoPainel[];
  meta: MetaPainel;
  ranking: {
    competencia: string;
    posicao: number;
    total: number;
    lista: { posicao: number; vendedorId: number; nome: string; eu: boolean; faturamento: number | null }[];
    paraPassar: { nome: string; falta: number } | null;
  };
  desafios: DesafioCard[];
  ultimasVendas: { id: number; numero: number; data: string; total: number; contato: Ref; situacao: { id: number; nome: string; cor: string } }[];
}

export interface MetaLinha {
  vendedorId: number;
  nome: string;
  metaPadrao: number;
  metaMes: number | null;
  meta: number;
  vendido: number;
  qtdVendas: number;
  pct: number;
}

export interface Desafio {
  id: number;
  titulo: string;
  descricao?: string | null;
  tipo: TipoDesafio;
  alvo: number;
  produtoId?: number | null;
  produto?: { id: number; nome: string; codigo?: string | null } | null;
  categoriaId?: number | null;
  categoria?: Ref | null;
  inicio: string;
  fim: string;
  premio: number;
  regra: 'TODOS' | 'PRIMEIRO';
  todosVendedores: boolean;
  vendedoresIds: number[];
  ativo: boolean;
  situacao: 'EM_ANDAMENTO' | 'AGENDADO' | 'FINALIZADO' | 'ENCERRADO';
  participantes: { vendedorId: number; nome: string; atingido: number; pct: number; conquistou: boolean; conquistadoEm?: string | null; premioStatus?: Comissao['status'] | null }[];
  totalPremios: number;
}

/** Item que falta para finalizar uma venda (regra: cliente completo ou consumidor final, produto, custo, pagamento, vendedor). */
export interface PendenciaFinalizacao {
  campo: string;
  mensagem: string;
  onde: 'venda' | 'cliente';
}
