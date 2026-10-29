/**
 * Helpers de formatação pt-BR: moeda, datas, documentos, telefone, números.
 */
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const fmtMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtInteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function moeda(v: number | null | undefined): string {
  return fmtMoeda.format(Number(v) || 0);
}

/** Formata número com até 2 casas, ex.: 1.234,5 */
export function numero(v: number | null | undefined, casas = 2): string {
  if (casas === 2) return fmtNumero.format(Number(v) || 0);
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas }).format(Number(v) || 0);
}

export function inteiro(v: number | null | undefined): string {
  return fmtInteiro.format(Number(v) || 0);
}

export function percentual(v: number | null | undefined, casas = 1): string {
  return `${numero(v, casas)}%`;
}

function paraData(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return isValid(d) ? d : null;
  // Datas "YYYY-MM-DD" puras devem ser interpretadas no fuso local (não UTC)
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? parseISO(d + 'T00:00:00') : parseISO(d);
  return isValid(dt) ? dt : null;
}

export function data(d: string | Date | null | undefined): string {
  const dt = paraData(d);
  return dt ? format(dt, 'dd/MM/yyyy') : '—';
}

export function dataHora(d: string | Date | null | undefined): string {
  const dt = paraData(d);
  return dt ? format(dt, 'dd/MM/yyyy HH:mm') : '—';
}

export function dataExtenso(d: string | Date | null | undefined): string {
  const dt = paraData(d);
  return dt ? format(dt, "d 'de' MMMM 'de' yyyy", { locale: ptBR }) : '—';
}

/** Data no formato YYYY-MM-DD para inputs type=date e para enviar à API */
export function dataIso(d: string | Date | null | undefined): string {
  const dt = paraData(d);
  return dt ? format(dt, 'yyyy-MM-dd') : '';
}

export function hoje(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** Competência AAAA-MM do mês atual */
export function competenciaAtual(): string {
  return format(new Date(), 'yyyy-MM');
}

export function competenciaLabel(c: string): string {
  const dt = paraData(c + '-01');
  return dt ? format(dt, 'MMM/yyyy', { locale: ptBR }) : c;
}

/** Dias de atraso em relação a hoje (positivo = atrasado) */
export function diasAtraso(vencimento: string | null | undefined): number {
  const dt = paraData(vencimento);
  if (!dt) return 0;
  return differenceInCalendarDays(new Date(), dt);
}

export function somenteDigitos(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

/** CPF 000.000.000-00 / CNPJ 00.000.000/0000-00 */
export function documento(v: string | null | undefined): string {
  const d = somenteDigitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
}

/** Telefone (11) 99999-9999 ou (19) 3333-4444; aceita DDI 55 */
export function telefone(v: string | null | undefined): string {
  let d = somenteDigitos(v);
  if (!d) return '';
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v || '';
}

export function cep(v: string | null | undefined): string {
  const d = somenteDigitos(v);
  if (d.length === 8) return d.replace(/(\d{5})(\d{3})/, '$1-$2');
  return v || '';
}

/** Chave da NF-e em grupos de 4 */
export function chaveNfe(v: string | null | undefined): string {
  const d = somenteDigitos(v);
  return d.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Iniciais para avatar */
export function iniciais(nome: string | null | undefined): string {
  if (!nome) return '?';
  const p = nome.trim().split(/\s+/);
  return (p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '');
}

/** Trunca texto com reticências */
export function truncar(t: string | null | undefined, n = 40): string {
  if (!t) return '';
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Converte string de input numérico pt-BR ("1.234,56") em número */
export function parseNumeroBr(v: string): number {
  if (!v) return 0;
  const limpo = v.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

/** Arredonda para 2 casas evitando erro de ponto flutuante */
export function arred(v: number, casas = 2): number {
  const f = Math.pow(10, casas);
  return Math.round((v + Number.EPSILON) * f) / f;
}

export function tamanhoArquivo(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Rótulos amigáveis para enums */
export const ROTULOS: Record<string, string> = {
  BALCAO: 'Balcão',
  WHATSAPP: 'WhatsApp',
  LOJA_VIRTUAL: 'Loja virtual',
  TELEFONE: 'Telefone',
  MARKETPLACE: 'Marketplace',
  OUTRO: 'Outro',
  BAIXA: 'Baixa',
  NORMAL: 'Normal',
  ALTA: 'Alta',
  URGENTE: 'Urgente',
  PECA: 'Peça',
  SERVICO: 'Serviço',
  ABERTO: 'Em aberto',
  RECEBIDO: 'Recebido',
  PAGO: 'Pago',
  PARCIAL: 'Parcial',
  CANCELADO: 'Cancelado',
  ATRASADO: 'Atrasado',
  PENDENTE: 'Pendente',
  APROVADA: 'Aprovada',
  DESAFIO: 'Desafio',
  QTD_VENDAS: 'Nº de vendas',
  QTD_ITENS: 'Unidades vendidas',
  PAGA: 'Paga',
  CANCELADA: 'Cancelada',
  ENVIANDO: 'Enviando',
  ENVIADA: 'Enviada',
  ERRO: 'Erro',
  PROCESSANDO: 'Processando',
  AUTORIZADA: 'Autorizada',
  REJEITADA: 'Rejeitada',
  DENEGADA: 'Denegada',
  INUTILIZADA: 'Inutilizada',
  EMAIL: 'E-mail',
  ENTRADA: 'Entrada',
  SAIDA: 'Saída',
  AJUSTE: 'Ajuste',
  TRANSFERENCIA: 'Transferência',
  BALANCO: 'Balanço',
  VENDA: 'Venda',
  COMPRA: 'Compra',
  OS: 'Ordem de serviço',
  NFE: 'NF-e',
  IMPORTACAO: 'Importação',
  MANUAL: 'Manual',
  COMISSAO: 'Comissão',
  IMPOSTO: 'Imposto',
  CONTA: 'Conta',
  CLIENTE: 'Cliente',
  FORNECEDOR: 'Fornecedor',
  TRANSPORTADORA: 'Transportadora',
  AMBOS: 'Cliente e fornecedor',
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  VENDEDOR: 'Vendedor',
  TECNICO: 'Técnico',
  FINANCEIRO: 'Financeiro',
  RECEITA: 'Receita',
  DESPESA: 'Despesa',
  CAIXA: 'Caixa',
  BANCO: 'Banco',
  CARTAO: 'Cartão',
  INVESTIMENTO: 'Investimento',
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  BOLETO: 'Boleto',
  CREDIARIO: 'Crediário',
  CREDITO_BANCARIO: 'Crédito bancário',
  CARNE: 'Carnê',
  RECEITA_BRUTA: 'Receita bruta',
  DEDUCAO: 'Dedução',
  CMV: 'CMV / Custo',
  DESPESA_OPERACIONAL: 'Despesa operacional',
  DESPESA_PESSOAL: 'Despesa com pessoal',
  DESPESA_FINANCEIRA: 'Despesa financeira',
  RECEITA_FINANCEIRA: 'Receita financeira',
  OUTRAS: 'Outras',
  CONECTADO: 'Conectado',
  DESCONECTADO: 'Desconectado',
  AGUARDANDO_QR: 'Aguardando QR Code',
  CONECTANDO: 'Conectando',
  VENDA_SITUACAO: 'Venda: mudança de situação',
  COMPRA_SITUACAO: 'Compra: mudança de situação',
  OS_SITUACAO: 'OS: mudança de situação',
  VENDA_CRIADA: 'Venda criada',
  OS_CRIADA: 'OS criada',
  NFE_AUTORIZADA: 'NF-e autorizada',
  CONTA_VENCENDO: 'Conta vencendo',
  ORCAMENTO_OS: 'Orçamento de OS',
  CANCELAMENTO: 'Cancelamento',
  CARTA_CORRECAO: 'Carta de correção',
  INUTILIZACAO: 'Inutilização',
  AUTORIZADO: 'Autorizado',
  REJEITADO: 'Rejeitado',
  CREDITO: 'Crédito',
  DEBITO: 'Débito',
  OPEN_FINANCE: 'Open Finance',
  OFX: 'OFX',
};

export function rotulo(v: string | null | undefined): string {
  if (!v) return '—';
  return ROTULOS[v] ?? v;
}
