/**
 * Sincronização de contas a pagar do Bling, separada da importação geral.
 *
 * A listagem (GET /contas/pagar) não traz saldo. O saldo, o histórico, a categoria,
 * o portador, a competência e a ocorrência só existem no detalhe (GET /contas/pagar/{id}).
 * Prévia e aplicar usam esta mesma função: a prévia não grava.
 *
 * Não cria movimento de caixa para pagamento antigo do Bling. Quem já baixou o título
 * no meu-bling (tem movimento) não perde valorPago nem situação; a diferença fica no relatório.
 *
 * As chamadas passam por blingGet, que já limita a 3 requisições por segundo.
 */
import { prisma as prismaApp } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar, competenciaDe } from '../../lib/util.js';
import { blingGet, paginaJaVista } from './cliente.js';

export type ModoSincronia = 'previa' | 'aplicar';

/** O mesmo cliente da importação (rate limit de 3 req/s e retry de 429). */
export const leitorPadraoContasPagar = blingGet;

export interface LeitorBling {
  get<T = any>(caminho: string, params?: Record<string, string | number | undefined>): Promise<T>;
}

export interface OpcoesSincronizarContasPagar {
  modo: ModoSincronia;
  dataInicial?: string;
  dataFinal?: string;
  leitor?: LeitorBling;
  limitePagina?: number;
  tentativasPagina?: number;
  esperaRetryMs?: number;
  onProgresso?: (p: ProgressoSync) => void;
}

export interface ProgressoSync {
  fase: string;
  feitos: number;
  total: number | null;
}

export interface LinhaSituacao {
  situacao: string;
  rotulo: string;
  quantidade: number;
  soma: number;
  saldo: number;
}

export interface RelatorioContasPagar {
  modo: ModoSincronia;
  gravado: boolean;
  periodo: { dataInicial: string | null; dataFinal: string | null };
  consultas: string[];
  lidos: number;
  detalhes: number;
  criados: number;
  atualizados: number;
  vinculados: number;
  preservados: number;
  porSituacaoBling: LinhaSituacao[];
  porSituacaoMeuBling: LinhaSituacao[];
  faltantes: { blingId: string; valor: number; vencimento: string | null; fornecedor: string | null; situacaoBling: number; acao: 'criar' | 'ambiguo' }[];
  sobrando: { id: number; blingId: string | null; descricao: string; valor: number; vencimento: string; situacao: string }[];
  divergencias: { blingId: string; contaId: number; campo: 'valor' | 'saldo' | 'vencimento' | 'fornecedor' | 'situacao'; bling: string; local: string; preservado: boolean }[];
  duplicatasProvaveis: { blingId: string; motivo: string; contasLocais: { id: number; descricao: string; blingId: string | null }[] }[];
  erros: { blingId: string | null; motivo: string }[];
  situacoesRegistradas: { blingId: string; situacaoBling: number; motivo: string }[];
  portadoresSemConta: { blingId: string; portadorBlingId: string }[];
  cadastrosMinimos: { tipo: 'fornecedor' | 'categoria' | 'forma'; blingId: string; nome: string; criado: boolean }[];
  interrompido: null | { consulta: string; pagina: number; titulosLidos: number; motivo: string };
  log: string[];
}

type Banco = typeof prismaApp;

interface Titulo {
  blingId: string;
  situacaoBling: number;
  situacaoLocal: string;
  registrar: string | null;
  valor: number;
  saldo: number;
  valorPago: number;
  vencimento: Date;
  vencimentoDia: string;
  dataEmissao: Date;
  dataPagamento: Date | null;
  competencia: string;
  documento: string | null;
  historico: string;
  contatoBlingId: string | null;
  contatoNome: string | null;
  categoriaBlingId: string | null;
  categoriaNome: string | null;
  formaBlingId: string | null;
  formaNome: string | null;
  portadorBlingId: string | null;
  /** null = o detalhe não trouxe ocorrência; não mexe no que já está gravado */
  recorrente: boolean | null;
  origemCompraBlingId: string | null;
  lista: any;
}

interface ContaLocal {
  id: number;
  blingId: string | null;
  contatoId: number | null;
  descricao: string;
  dataEmissao: Date;
  vencimento: Date;
  competencia: string | null;
  valor: number;
  valorPago: number;
  situacao: string;
  dataPagamento: Date | null;
  formaPagamentoId: number | null;
  contaFinanceiraId: number | null;
  categoriaId: number | null;
  origemTipo: string;
  origemId: number | null;
  observacoes: string | null;
  recorrente: boolean;
  contato: { id: number; nome: string; blingId: string | null } | null;
}

interface ContatoRes {
  id: number;
  nome: string;
  blingId: string | null;
}

type Acao = 'criar' | 'atualizar' | 'vincular' | 'ambiguo';

interface Plano {
  titulo: Titulo;
  local: ContaLocal | null;
  acao: Acao;
  preservar: boolean;
  duplicatas: ContaLocal[];
  motivoDuplicata: string | null;
}

interface Pendente {
  tipo: 'fornecedor' | 'categoria' | 'forma';
  blingId: string;
  nome: string;
  criado: boolean;
}

const ROTULO_BLING: Record<number, string> = {
  1: 'Em aberto',
  2: 'Pago',
  3: 'Parcial',
  4: 'Devolvido',
  5: 'Cancelado',
  6: 'Situação 6',
  7: 'Situação 7',
};

const ROTULO_LOCAL: Record<string, string> = {
  ABERTO: 'Em aberto',
  PAGO: 'Pago',
  PARCIAL: 'Parcial',
  CANCELADO: 'Cancelado',
  DEVOLVIDO: 'Devolvido',
  NAO_MAPEADA: 'Bling 6/7',
};

const SITUACOES_LOCAIS = ['ABERTO', 'PAGO', 'PARCIAL', 'DEVOLVIDO', 'CANCELADO', 'NAO_MAPEADA'] as const;

/** 1 aberto, 2 pago, 3 parcial, 4 devolvido (não é cancelado), 5 cancelado. 6 e 7 ficam no log. */
export function mapearSituacaoBling(codigo: number): { situacao: string; registrar: string | null } {
  switch (codigo) {
    case 1:
      return { situacao: 'ABERTO', registrar: null };
    case 2:
      return { situacao: 'PAGO', registrar: null };
    case 3:
      return { situacao: 'PARCIAL', registrar: null };
    case 4:
      return { situacao: 'DEVOLVIDO', registrar: 'Situação 4 do Bling é devolvido, não cancelado.' };
    case 5:
      return { situacao: 'CANCELADO', registrar: null };
    case 6:
      return { situacao: 'NAO_MAPEADA', registrar: 'Situação 6 do Bling não entra como em aberto; ficou registrada no log.' };
    case 7:
      return { situacao: 'NAO_MAPEADA', registrar: 'Situação 7 do Bling não entra como em aberto; ficou registrada no log.' };
    default:
      return { situacao: 'NAO_MAPEADA', registrar: `Situação ${codigo} do Bling não é conhecida; ficou registrada no log.` };
  }
}

/** valorPago = valor − saldo. Saldo ausente não vira zero. */
export function valorPagoDoSaldo(valor: number, saldo: number): number {
  return arredondar(Math.max(0, valor - saldo));
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const idDe = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dataDe(v: unknown): Date | null {
  if (!v || typeof v !== 'string' || v.startsWith('0000')) return null;
  const d = /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v.slice(0, 10) + 'T12:00:00') : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function diaISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function competenciaTxt(v: unknown, vencimento: Date): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}/.test(v)) return v.slice(0, 7);
  return competenciaDe(vencimento);
}

function nomeDe(...fontes: any[]): string | null {
  for (const f of fontes) {
    const n = f?.nome || f?.descricao || f?.fantasia;
    if (n) return String(n).slice(0, 120);
  }
  return null;
}

/** Tipos 1 única e 2 parcelada. De 3 em diante (mensal, semanal…) o título é recorrente. */
export function ocorrenciaRecorrente(ocorrencia: any): boolean {
  const tipo = Number(ocorrencia?.tipo);
  return Number.isFinite(tipo) && tipo >= 3;
}

function descreverConsulta(params: Record<string, string>): string {
  if (params.situacao) return `situação ${params.situacao}`;
  if (params.dataEmissaoInicial) return `emissão ${params.dataEmissaoInicial} a ${params.dataEmissaoFinal}`;
  if (params.dataVencimentoInicial) return `vencimento ${params.dataVencimentoInicial} a ${params.dataVencimentoFinal}`;
  if (params.dataPagamentoInicial) return `pagamento ${params.dataPagamentoInicial} a ${params.dataPagamentoFinal}`;
  return 'listagem';
}

function consultasDe(dataInicial?: string, dataFinal?: string): Record<string, string>[] {
  if ((dataInicial && !dataFinal) || (!dataInicial && dataFinal)) {
    throw new AppError('Informe as duas datas do período, ou deixe as duas em branco para varrer todas as situações.', 422, 'PERIODO');
  }
  if (!dataInicial || !dataFinal) return [1, 2, 3, 4, 5, 6, 7].map((s) => ({ situacao: String(s) }));
  return [
    { dataEmissaoInicial: dataInicial, dataEmissaoFinal: dataFinal },
    { dataVencimentoInicial: dataInicial, dataVencimentoFinal: dataFinal },
    { dataPagamentoInicial: dataInicial, dataPagamentoFinal: dataFinal },
  ];
}

function normalizar(lista: any, detalhe: any): Titulo {
  if (detalhe?.saldo === undefined || detalhe?.saldo === null || detalhe?.saldo === '') {
    throw new Error('O detalhe não trouxe o saldo.');
  }
  const valorBruto = num(detalhe?.valor);
  if (valorBruto === null) throw new Error('O detalhe não trouxe o valor.');
  const saldoBruto = num(detalhe.saldo);
  if (saldoBruto === null) throw new Error('O detalhe não trouxe o saldo.');
  const codigo = Number(detalhe?.situacao);
  if (!Number.isInteger(codigo)) throw new Error('O detalhe não trouxe a situação.');
  const mapa = mapearSituacaoBling(codigo);
  const valor = arredondar(valorBruto);
  const saldo = arredondar(saldoBruto);
  const vencimento = dataDe(detalhe.vencimento) || dataDe(detalhe.vencimentoOriginal) || dataDe(lista?.vencimento) || new Date();
  const origem = detalhe.origem || lista?.origem;
  const tipoOrigem = String(origem?.tipoOrigem || origem?.tipo || '');
  return {
    blingId: String(detalhe.id ?? lista?.id),
    situacaoBling: codigo,
    situacaoLocal: mapa.situacao,
    registrar: mapa.registrar,
    valor,
    saldo,
    valorPago: valorPagoDoSaldo(valor, saldo),
    vencimento,
    vencimentoDia: diaISO(vencimento),
    dataEmissao: dataDe(detalhe.dataEmissao) || dataDe(lista?.dataEmissao) || vencimento,
    dataPagamento: dataDe(detalhe.dataPagamento) || dataDe(detalhe.dataBaixa),
    competencia: competenciaTxt(detalhe.competencia, vencimento),
    documento: detalhe.numeroDocumento ? String(detalhe.numeroDocumento).slice(0, 60) : null,
    historico: String(detalhe.historico || lista?.historico || '').trim(),
    contatoBlingId: idDe(detalhe.contato?.id ?? lista?.contato?.id),
    contatoNome: nomeDe(detalhe.contato, lista?.contato),
    categoriaBlingId: idDe(detalhe.categoria?.id ?? lista?.categoria?.id),
    categoriaNome: nomeDe(detalhe.categoria, lista?.categoria),
    formaBlingId: idDe(detalhe.formaPagamento?.id ?? lista?.formaPagamento?.id),
    formaNome: nomeDe(detalhe.formaPagamento, lista?.formaPagamento),
    portadorBlingId: idDe(detalhe.portador?.id ?? lista?.portador?.id),
    recorrente: detalhe.ocorrencia || lista?.ocorrencia ? ocorrenciaRecorrente(detalhe.ocorrencia ?? lista?.ocorrencia) : null,
    origemCompraBlingId: /COMPRA/i.test(tipoOrigem) ? idDe(origem?.id) : null,
    lista,
  };
}

function observacoesDe(anterior: string | null | undefined, titulo: Titulo): string {
  const base = (anterior || '')
    .split('\n')
    .filter((l) => l.trim() && !/^(Competência:|Documento:|Situação Bling:)/.test(l.trim()))
    .join('\n');
  const linhas = [`Competência: ${titulo.competencia}`, titulo.documento ? `Documento: ${titulo.documento}` : '', `Situação Bling: ${titulo.situacaoBling}`].filter(Boolean);
  return [base, ...linhas].filter(Boolean).join('\n');
}

function mesmoValor(a: number, b: number) {
  return Math.abs(arredondar(a) - arredondar(b)) < 0.001;
}

function mesmoFornecedor(conta: ContaLocal, titulo: Titulo, contato: ContatoRes | null): boolean {
  if (titulo.contatoBlingId && conta.contato?.blingId === titulo.contatoBlingId) return true;
  if (contato && conta.contatoId === contato.id) return true;
  const nome = titulo.contatoNome?.trim();
  if (nome && conta.contato?.nome && !conta.contato.blingId && norm(conta.contato.nome) === norm(nome)) return true;
  if (!titulo.contatoBlingId && !conta.contatoId) return true;
  return false;
}

function mesmaChave(conta: ContaLocal, titulo: Titulo, contato: ContatoRes | null) {
  return !conta.blingId && conta.origemTipo === 'COMPRA' && mesmoValor(conta.valor, titulo.valor) && diaISO(conta.vencimento) === titulo.vencimentoDia && mesmoFornecedor(conta, titulo, contato);
}

async function lerPagina(leitor: LeitorBling, params: Record<string, string | number>, tentativas: number, esperaMs: number): Promise<{ dados: any[] } | { motivo: string }> {
  let motivo = 'falha ao ler a página';
  for (let t = 1; t <= tentativas; t++) {
    try {
      const r = await leitor.get<{ data?: any[] }>('/contas/pagar', params);
      return { dados: Array.isArray(r?.data) ? r.data : [] };
    } catch (e) {
      motivo = mensagem(e);
      if (t < tentativas) await esperar(esperaMs);
    }
  }
  return { motivo };
}

async function coletar(
  leitor: LeitorBling,
  consultas: Record<string, string>[],
  limite: number,
  tentativas: number,
  esperaMs: number,
  onProgresso?: (p: ProgressoSync) => void,
): Promise<{ itens: any[]; consultas: string[]; interrompido: RelatorioContasPagar['interrompido'] }> {
  const itens: any[] = [];
  const jaLidos = new Set<string>();
  const nomes: string[] = [];
  for (const consulta of consultas) {
    const nome = descreverConsulta(consulta);
    nomes.push(nome);
    const vistosNestaConsulta = new Set<string>();
    let pagina = 1;
    for (;;) {
      onProgresso?.({ fase: `Listando ${nome}, página ${pagina}`, feitos: itens.length, total: null });
      const lido = await lerPagina(leitor, { ...consulta, pagina, limite }, tentativas, esperaMs);
      if ('motivo' in lido) {
        return {
          itens,
          consultas: nomes,
          interrompido: {
            consulta: nome,
            pagina,
            titulosLidos: itens.length,
            motivo: `A página ${pagina} (${nome}) falhou depois de ${tentativas} tentativas: ${lido.motivo}. Parei com ${itens.length} títulos lidos.`,
          },
        };
      }
      const dados = lido.dados;
      if (!dados.length) break;
      const ids = dados.map((d) => (d?.id != null ? String(d.id) : '')).filter(Boolean);
      if (!ids.length) {
        return {
          itens,
          consultas: nomes,
          interrompido: { consulta: nome, pagina, titulosLidos: itens.length, motivo: `A página ${pagina} (${nome}) veio sem ids.` },
        };
      }
      if (paginaJaVista(ids, vistosNestaConsulta)) {
        return {
          itens,
          consultas: nomes,
          interrompido: {
            consulta: nome,
            pagina,
            titulosLidos: itens.length,
            motivo: `A página ${pagina} (${nome}) repetiu títulos já lidos (${ids.slice(0, 5).join(', ')}). A paginação do Bling não avançou.`,
          },
        };
      }
      for (const item of dados) {
        const id = item?.id != null ? String(item.id) : '';
        if (!id) continue;
        vistosNestaConsulta.add(id);
        if (jaLidos.has(id)) continue;
        jaLidos.add(id);
        itens.push(item);
      }
      if (dados.length < limite) break;
      pagina += 1;
      if (pagina > 500) {
        return {
          itens,
          consultas: nomes,
          interrompido: { consulta: nome, pagina, titulosLidos: itens.length, motivo: `Passei de 500 páginas em ${nome} e parei para não seguir sem fim. ${itens.length} títulos lidos.` },
        };
      }
    }
  }
  return { itens, consultas: nomes, interrompido: null };
}

function noPeriodo(conta: ContaLocal, ini: string, fim: string) {
  const dias = [conta.dataEmissao, conta.vencimento, conta.dataPagamento].filter((d): d is Date => !!d).map(diaISO);
  return dias.some((d) => d >= ini && d <= fim);
}

function somar(linhas: { situacao: string; valor: number; saldo: number }[], rotulos: Record<string, string>, ordem: string[]): LinhaSituacao[] {
  const mapa = new Map<string, { quantidade: number; soma: number; saldo: number }>();
  for (const s of ordem) mapa.set(s, { quantidade: 0, soma: 0, saldo: 0 });
  for (const l of linhas) {
    const atual = mapa.get(l.situacao) || { quantidade: 0, soma: 0, saldo: 0 };
    atual.quantidade += 1;
    atual.soma = arredondar(atual.soma + l.valor);
    atual.saldo = arredondar(atual.saldo + l.saldo);
    mapa.set(l.situacao, atual);
  }
  return [...mapa.entries()].map(([situacao, v]) => ({ situacao, rotulo: rotulos[situacao] || situacao, ...v }));
}

function relatorioVazio(opcoes: OpcoesSincronizarContasPagar, consultas: string[], interrompido: RelatorioContasPagar['interrompido']): RelatorioContasPagar {
  return {
    modo: opcoes.modo,
    gravado: false,
    periodo: { dataInicial: opcoes.dataInicial || null, dataFinal: opcoes.dataFinal || null },
    consultas,
    lidos: interrompido?.titulosLidos ?? 0,
    detalhes: 0,
    criados: 0,
    atualizados: 0,
    vinculados: 0,
    preservados: 0,
    porSituacaoBling: somar([], ROTULO_BLING, ['1', '2', '3', '4', '5', '6', '7']),
    porSituacaoMeuBling: somar([], ROTULO_LOCAL, [...SITUACOES_LOCAIS]),
    faltantes: [],
    sobrando: [],
    divergencias: [],
    duplicatasProvaveis: [],
    erros: interrompido ? [{ blingId: null, motivo: interrompido.motivo }] : [],
    situacoesRegistradas: [],
    portadoresSemConta: [],
    cadastrosMinimos: [],
    interrompido,
    log: interrompido ? [interrompido.motivo] : [],
  };
}

export async function sincronizarContasPagar(opcoes: OpcoesSincronizarContasPagar, banco: Banco = prismaApp): Promise<RelatorioContasPagar> {
  const leitor = opcoes.leitor ?? { get: leitorPadraoContasPagar };
  const limite = opcoes.limitePagina ?? 100;
  const tentativas = opcoes.tentativasPagina ?? 3;
  const esperaMs = opcoes.esperaRetryMs ?? 400;
  const aplicar = opcoes.modo === 'aplicar';
  const consultas = consultasDe(opcoes.dataInicial, opcoes.dataFinal);

  const lista = await coletar(leitor, consultas, limite, tentativas, esperaMs, opcoes.onProgresso);
  if (lista.interrompido) return relatorioVazio(opcoes, lista.consultas, lista.interrompido);

  const titulos: Titulo[] = [];
  const erros: RelatorioContasPagar['erros'] = [];
  let feitos = 0;
  for (const item of lista.itens) {
    feitos += 1;
    const blingId = item?.id != null ? String(item.id) : null;
    opcoes.onProgresso?.({ fase: 'Lendo o detalhe de cada título', feitos, total: lista.itens.length });
    try {
      if (!blingId) throw new Error('Título da listagem sem id.');
      const r = await leitor.get<{ data?: any }>(`/contas/pagar/${blingId}`);
      const detalhe = r?.data;
      if (!detalhe || detalhe.id == null) throw new Error('O detalhe veio vazio.');
      titulos.push(normalizar(item, detalhe));
    } catch (e) {
      erros.push({ blingId, motivo: mensagem(e) });
    }
  }

  const locais = (await banco.contaPagar.findMany({
    where: { OR: [{ blingId: { not: null } }, { origemTipo: 'COMPRA' }] },
    select: {
      id: true,
      blingId: true,
      contatoId: true,
      descricao: true,
      dataEmissao: true,
      vencimento: true,
      competencia: true,
      valor: true,
      valorPago: true,
      situacao: true,
      dataPagamento: true,
      formaPagamentoId: true,
      contaFinanceiraId: true,
      categoriaId: true,
      origemTipo: true,
      origemId: true,
      observacoes: true,
      recorrente: true,
      contato: { select: { id: true, nome: true, blingId: true } },
    },
  })) as ContaLocal[];

  const idsLocais = locais.map((c) => c.id);
  const comMovimento = new Set<number>();
  if (idsLocais.length) {
    const movs = await banco.movimentoFinanceiro.findMany({ where: { contaPagarId: { in: idsLocais } }, select: { contaPagarId: true } });
    for (const m of movs) if (m.contaPagarId) comMovimento.add(m.contaPagarId);
  }

  const idsContato = [...new Set(titulos.map((t) => t.contatoBlingId).filter((x): x is string => !!x))];
  const idsCategoria = [...new Set(titulos.map((t) => t.categoriaBlingId).filter((x): x is string => !!x))];
  const idsForma = [...new Set(titulos.map((t) => t.formaBlingId).filter((x): x is string => !!x))];
  const idsPortador = [...new Set(titulos.map((t) => t.portadorBlingId).filter((x): x is string => !!x))];
  const [contatos, categorias, formas, portadores] = await Promise.all([
    idsContato.length ? banco.contato.findMany({ where: { blingId: { in: idsContato } }, select: { id: true, nome: true, blingId: true } }) : [],
    idsCategoria.length ? banco.categoriaFinanceira.findMany({ where: { blingId: { in: idsCategoria } }, select: { id: true, blingId: true } }) : [],
    idsForma.length ? banco.formaPagamento.findMany({ where: { blingId: { in: idsForma } }, select: { id: true, blingId: true } }) : [],
    idsPortador.length ? banco.contaFinanceira.findMany({ where: { blingId: { in: idsPortador } }, select: { id: true, blingId: true } }) : [],
  ]);
  const porContato = new Map<string, ContatoRes>();
  for (const c of contatos) if (c.blingId) porContato.set(c.blingId, c);
  const porCategoria = new Map<string, number>();
  for (const c of categorias) if (c.blingId) porCategoria.set(c.blingId, c.id);
  const porForma = new Map<string, number>();
  for (const f of formas) if (f.blingId) porForma.set(f.blingId, f.id);
  const porPortador = new Map<string, number>();
  for (const p of portadores) if (p.blingId) porPortador.set(p.blingId, p.id);

  const porBlingLocal = new Map<string, ContaLocal>();
  for (const c of locais) if (c.blingId) porBlingLocal.set(c.blingId, c);

  const usados = new Set<number>();
  const planos: Plano[] = [];
  const carimbos: { id: number; blingId: string }[] = [];
  for (const titulo of titulos) {
    let contato = titulo.contatoBlingId ? porContato.get(titulo.contatoBlingId) ?? null : null;
    const porId = porBlingLocal.get(titulo.blingId) ?? null;
    const compras = locais.filter((c) => mesmaChave(c, titulo, contato));
    if (!contato && titulo.contatoBlingId && compras.length === 1 && compras[0].contato && !compras[0].contato.blingId) {
      contato = compras[0].contato;
      porContato.set(titulo.contatoBlingId, contato);
      if (!carimbos.some((c) => c.id === contato!.id)) carimbos.push({ id: contato.id, blingId: titulo.contatoBlingId });
    }
    if (porId) {
      usados.add(porId.id);
      const extras = locais.filter((c) => c.id !== porId.id && mesmaChave(c, titulo, contato));
      planos.push({ titulo, local: porId, acao: 'atualizar', preservar: comMovimento.has(porId.id), duplicatas: extras, motivoDuplicata: extras.length ? 'Já existe o título do Bling e também um título de compra sem id, com o mesmo fornecedor, valor e vencimento.' : null });
      continue;
    }
    const livres = compras.filter((c) => !usados.has(c.id));
    const ocupados = compras.filter((c) => usados.has(c.id));
    if (livres.length === 1) {
      usados.add(livres[0].id);
      planos.push({ titulo, local: livres[0], acao: 'vincular', preservar: comMovimento.has(livres[0].id), duplicatas: [], motivoDuplicata: null });
    } else if (livres.length > 1) {
      planos.push({ titulo, local: null, acao: 'ambiguo', preservar: false, duplicatas: livres, motivoDuplicata: 'Mais de um título de compra sem id do Bling, com o mesmo fornecedor, valor e vencimento. Não vinculei nem criei outro.' });
    } else if (ocupados.length) {
      planos.push({ titulo, local: null, acao: 'ambiguo', preservar: false, duplicatas: ocupados, motivoDuplicata: 'O título de compra correspondente já foi vinculado a outra conta do Bling. Não criei duplicata.' });
    } else {
      planos.push({ titulo, local: null, acao: 'criar', preservar: false, duplicatas: [], motivoDuplicata: null });
    }
  }

  const pendentes: Pendente[] = [];
  const precisa = (tipo: Pendente['tipo'], blingId: string | null, jaTem: boolean, nome: string | null, reserva: string) => {
    if (!blingId || jaTem || pendentes.some((p) => p.tipo === tipo && p.blingId === blingId)) return;
    pendentes.push({ tipo, blingId, nome: nome || reserva, criado: false });
  };
  for (const plano of planos) {
    if (plano.acao === 'ambiguo') continue;
    const t = plano.titulo;
    precisa('fornecedor', t.contatoBlingId, !!(t.contatoBlingId && porContato.get(t.contatoBlingId)), t.contatoNome, `Fornecedor Bling ${t.contatoBlingId}`);
    precisa('categoria', t.categoriaBlingId, !!(t.categoriaBlingId && porCategoria.has(t.categoriaBlingId)), t.categoriaNome, `Categoria Bling ${t.categoriaBlingId}`);
    precisa('forma', t.formaBlingId, !!(t.formaBlingId && porForma.has(t.formaBlingId)), t.formaNome, `Forma Bling ${t.formaBlingId}`);
  }

  const falhou = new Set<string>();
  if (aplicar) {
    for (const c of carimbos) {
      try {
        await banco.contato.update({ where: { id: c.id }, data: { blingId: c.blingId } });
      } catch (e) {
        erros.push({ blingId: null, motivo: `Não consegui gravar o id Bling ${c.blingId} no fornecedor ${c.id}: ${mensagem(e)}` });
      }
    }
    for (const p of pendentes) {
      try {
        if (p.tipo === 'fornecedor') {
          const novo = await banco.contato.create({ data: { blingId: p.blingId, nome: p.nome, tipo: 'FORNECEDOR', tipoPessoa: 'J' } });
          porContato.set(p.blingId, { id: novo.id, nome: novo.nome, blingId: p.blingId });
        } else if (p.tipo === 'categoria') {
          const novo = await banco.categoriaFinanceira.create({ data: { blingId: p.blingId, nome: p.nome, tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL' } });
          porCategoria.set(p.blingId, novo.id);
        } else {
          const novo = await banco.formaPagamento.create({ data: { blingId: p.blingId, nome: p.nome, tipo: 'OUTRO', codigoFiscal: '99' } });
          porForma.set(p.blingId, novo.id);
        }
        p.criado = true;
      } catch (e) {
        const existente =
          p.tipo === 'fornecedor'
            ? await banco.contato.findUnique({ where: { blingId: p.blingId }, select: { id: true, nome: true, blingId: true } })
            : null;
        if (p.tipo === 'fornecedor' && existente?.blingId) porContato.set(p.blingId, existente);
        else if (p.tipo === 'categoria') {
          const cat = await banco.categoriaFinanceira.findUnique({ where: { blingId: p.blingId }, select: { id: true } });
          if (cat) porCategoria.set(p.blingId, cat.id);
        } else if (p.tipo === 'forma') {
          const forma = await banco.formaPagamento.findUnique({ where: { blingId: p.blingId }, select: { id: true } });
          if (forma) porForma.set(p.blingId, forma.id);
        }
        if ((p.tipo === 'fornecedor' && porContato.has(p.blingId)) || (p.tipo === 'categoria' && porCategoria.has(p.blingId)) || (p.tipo === 'forma' && porForma.has(p.blingId))) {
          continue;
        }
        erros.push({ blingId: null, motivo: `Cadastro mínimo de ${p.tipo} ${p.blingId}: ${mensagem(e)}` });
      }
    }
  }

  const agora = new Date();
  const comprasOrigem = new Map<string, number>();
  if (aplicar) {
    const idsOrigem = [...new Set(planos.map((p) => p.titulo.origemCompraBlingId).filter((x): x is string => !!x))];
    if (idsOrigem.length) {
      const compras = await banco.compra.findMany({ where: { blingId: { in: idsOrigem } }, select: { id: true, blingId: true } });
      for (const c of compras) if (c.blingId) comprasOrigem.set(c.blingId, c.id);
    }
  }

  for (const plano of planos) {
    if (plano.acao === 'ambiguo') continue;
    const t = plano.titulo;
    const local = plano.local;
    let origemTipo = 'MANUAL';
    let origemId: number | null = null;
    if (local && local.origemTipo && local.origemTipo !== 'MANUAL') {
      origemTipo = local.origemTipo;
      origemId = local.origemId;
    } else if (t.origemCompraBlingId && comprasOrigem.has(t.origemCompraBlingId)) {
      origemTipo = 'COMPRA';
      origemId = comprasOrigem.get(t.origemCompraBlingId) ?? null;
    }
    let contaFinanceiraId = local?.contaFinanceiraId ?? null;
    if (t.portadorBlingId && porPortador.has(t.portadorBlingId)) contaFinanceiraId = porPortador.get(t.portadorBlingId) ?? null;
    const contatoId = (t.contatoBlingId && porContato.get(t.contatoBlingId)?.id) || local?.contatoId || null;
    const categoriaId = (t.categoriaBlingId && porCategoria.get(t.categoriaBlingId)) || local?.categoriaId || null;
    const formaPagamentoId = (t.formaBlingId && porForma.get(t.formaBlingId)) || local?.formaPagamentoId || null;
    const data: Record<string, unknown> = {
      blingId: t.blingId,
      contatoId,
      descricao: (t.historico || `Conta a pagar Bling ${t.blingId}`).slice(0, 250),
      dataEmissao: t.dataEmissao,
      vencimento: t.vencimento,
      competencia: t.competencia,
      valor: t.valor,
      formaPagamentoId,
      contaFinanceiraId,
      categoriaId,
      origemTipo,
      origemId,
      observacoes: observacoesDe(local?.observacoes, t),
      recorrente: t.recorrente === null ? local?.recorrente ?? false : t.recorrente,
      situacaoBling: t.situacaoBling,
      sincronizadoEm: agora,
    };
    if (!plano.preservar) {
      data.valorPago = t.valorPago;
      data.situacao = t.situacaoLocal;
      data.dataPagamento = t.situacaoLocal === 'ABERTO' || t.situacaoLocal === 'CANCELADO' ? null : t.dataPagamento;
    }
    if (!aplicar) continue;
    try {
      if (local) await banco.contaPagar.update({ where: { id: local.id }, data });
      else await banco.contaPagar.create({ data: data as any });
    } catch (e) {
      falhou.add(t.blingId);
      erros.push({ blingId: t.blingId, motivo: mensagem(e) });
    }
  }

  const idsListados = new Set(lista.itens.map((i) => (i?.id != null ? String(i.id) : '')).filter(Boolean));
  const ini = opcoes.dataInicial;
  const fim = opcoes.dataFinal;
  const escolhidos = new Set(planos.filter((p) => p.local && p.acao !== 'ambiguo' && !falhou.has(p.titulo.blingId)).map((p) => p.local!.id));
  const ambiguos = new Set(planos.filter((p) => p.acao === 'ambiguo').flatMap((p) => p.duplicatas.map((c) => c.id)));
  const emEscopo = (c: ContaLocal) => {
    if (escolhidos.has(c.id)) return true;
    if (ini && fim) return idsListados.has(c.blingId || '') || noPeriodo(c, ini, fim);
    return true;
  };

  const projetado: { situacao: string; valor: number; saldo: number }[] = [];
  const locaisEscopo = new Set(locais.filter(emEscopo).map((c) => c.id));
  for (const conta of locais) {
    if (!locaisEscopo.has(conta.id)) continue;
    const plano = planos.find((p) => p.local?.id === conta.id && p.acao !== 'ambiguo' && !falhou.has(p.titulo.blingId));
    if (!plano) {
      projetado.push({ situacao: conta.situacao, valor: conta.valor, saldo: arredondar(Math.max(0, conta.valor - conta.valorPago)) });
      continue;
    }
    const situacao = plano.preservar ? conta.situacao : plano.titulo.situacaoLocal;
    const valorPago = plano.preservar ? conta.valorPago : plano.titulo.valorPago;
    projetado.push({ situacao, valor: plano.titulo.valor, saldo: arredondar(Math.max(0, plano.titulo.valor - valorPago)) });
  }
  for (const plano of planos) {
    if (plano.acao !== 'criar' || falhou.has(plano.titulo.blingId)) continue;
    projetado.push({ situacao: plano.titulo.situacaoLocal, valor: plano.titulo.valor, saldo: arredondar(Math.max(0, plano.titulo.valor - plano.titulo.valorPago)) });
  }

  const divergencias: RelatorioContasPagar['divergencias'] = [];
  const situacoesRegistradas: RelatorioContasPagar['situacoesRegistradas'] = [];
  const portadoresSemConta: RelatorioContasPagar['portadoresSemConta'] = [];
  for (const plano of planos) {
    if (plano.acao === 'ambiguo' || falhou.has(plano.titulo.blingId)) continue;
    const t = plano.titulo;
    if (t.registrar) situacoesRegistradas.push({ blingId: t.blingId, situacaoBling: t.situacaoBling, motivo: t.registrar });
    if (t.portadorBlingId && !porPortador.has(t.portadorBlingId)) portadoresSemConta.push({ blingId: t.blingId, portadorBlingId: t.portadorBlingId });
    const local = plano.local;
    if (!local) continue;
    const add = (campo: RelatorioContasPagar['divergencias'][number]['campo'], bling: string, valorLocal: string, preservado: boolean) => {
      if (bling !== valorLocal) divergencias.push({ blingId: t.blingId, contaId: local.id, campo, bling, local: valorLocal, preservado });
    };
    add('valor', t.valor.toFixed(2), arredondar(local.valor).toFixed(2), false);
    add('saldo', t.saldo.toFixed(2), arredondar(Math.max(0, local.valor - local.valorPago)).toFixed(2), plano.preservar);
    add('vencimento', t.vencimentoDia, diaISO(local.vencimento), false);
    const fornecedorBling = t.contatoBlingId || '';
    const fornecedorLocal = local.contato?.blingId || (t.contatoBlingId && local.contatoId && porContato.get(t.contatoBlingId)?.id === local.contatoId ? t.contatoBlingId : '');
    add('fornecedor', fornecedorBling, fornecedorLocal, false);
    add('situacao', t.situacaoLocal, local.situacao, plano.preservar);
  }

  const sobrando = locais
    .filter((c) => emEscopo(c) && !escolhidos.has(c.id) && !ambiguos.has(c.id) && !(c.blingId && idsListados.has(c.blingId)))
    .map((c) => ({ id: c.id, blingId: c.blingId, descricao: c.descricao, valor: c.valor, vencimento: diaISO(c.vencimento), situacao: c.situacao }));

  const faltantes = planos
    .filter((p) => (p.acao === 'criar' || p.acao === 'ambiguo') && !falhou.has(p.titulo.blingId))
    .map((p) => ({
      blingId: p.titulo.blingId,
      valor: p.titulo.valor,
      vencimento: p.titulo.vencimentoDia,
      fornecedor: p.titulo.contatoNome,
      situacaoBling: p.titulo.situacaoBling,
      acao: p.acao === 'ambiguo' ? ('ambiguo' as const) : ('criar' as const),
    }));

  const duplicatasProvaveis = planos
    .filter((p) => p.motivoDuplicata && p.duplicatas.length)
    .map((p) => ({
      blingId: p.titulo.blingId,
      motivo: p.motivoDuplicata!,
      contasLocais: p.duplicatas.map((c) => ({ id: c.id, descricao: c.descricao, blingId: c.blingId })),
    }));

  const criados = planos.filter((p) => p.acao === 'criar' && !falhou.has(p.titulo.blingId)).length;
  const atualizados = planos.filter((p) => p.acao === 'atualizar' && !falhou.has(p.titulo.blingId)).length;
  const vinculados = planos.filter((p) => p.acao === 'vincular' && !falhou.has(p.titulo.blingId)).length;
  const preservados = planos.filter((p) => p.preservar && p.acao !== 'ambiguo' && !falhou.has(p.titulo.blingId)).length;
  const log = [
    aplicar ? 'Sincronização aplicada.' : 'Prévia: nada foi gravado.',
    `${lista.itens.length} títulos na listagem, ${titulos.length} detalhes lidos.`,
    aplicar
      ? `${criados} criados, ${atualizados} atualizados, ${vinculados} títulos de compra vinculados, ${preservados} com pagamento feito no meu-bling (valor pago e situação preservados).`
      : `${criados} seriam criados, ${atualizados} seriam atualizados, ${vinculados} títulos de compra seriam vinculados, ${preservados} ficariam com o pagamento feito no meu-bling.`,
    ...situacoesRegistradas.map((s) => `Bling ${s.blingId}: ${s.motivo}`),
    ...erros.map((e) => `Erro${e.blingId ? ` ${e.blingId}` : ''}: ${e.motivo}`),
  ];

  return {
    modo: opcoes.modo,
    gravado: aplicar,
    periodo: { dataInicial: opcoes.dataInicial || null, dataFinal: opcoes.dataFinal || null },
    consultas: lista.consultas,
    lidos: lista.itens.length,
    detalhes: titulos.length,
    criados,
    atualizados,
    vinculados,
    preservados,
    porSituacaoBling: somar(
      titulos.map((t) => ({ situacao: String(t.situacaoBling), valor: t.valor, saldo: t.saldo })),
      ROTULO_BLING,
      ['1', '2', '3', '4', '5', '6', '7'],
    ),
    porSituacaoMeuBling: somar(projetado, ROTULO_LOCAL, [...SITUACOES_LOCAIS]),
    faltantes,
    sobrando,
    divergencias,
    duplicatasProvaveis,
    erros,
    situacoesRegistradas,
    portadoresSemConta,
    cadastrosMinimos: pendentes,
    interrompido: null,
    log,
  };
}

const estadoSync: {
  emAndamento: boolean;
  modo: ModoSincronia | null;
  relatorio: RelatorioContasPagar | null;
  erro: string | null;
  iniciadoEm: string | null;
  finalizadoEm: string | null;
  progresso: ProgressoSync | null;
} = {
  emAndamento: false,
  modo: null,
  relatorio: null,
  erro: null,
  iniciadoEm: null,
  finalizadoEm: null,
  progresso: null,
};

export function estadoSincronizacaoContasPagar() {
  return {
    emAndamento: estadoSync.emAndamento,
    modo: estadoSync.modo,
    relatorio: estadoSync.relatorio,
    erro: estadoSync.erro,
    iniciadoEm: estadoSync.iniciadoEm,
    finalizadoEm: estadoSync.finalizadoEm,
    progresso: estadoSync.progresso,
  };
}

export function sincronizacaoContasPagarEmAndamento() {
  return estadoSync.emAndamento;
}

/** Dispara a mesma função em segundo plano. A prévia não grava; aplicar grava. */
export function iniciarSincronizacaoContasPagar(opcoes: OpcoesSincronizarContasPagar) {
  if (estadoSync.emAndamento) throw new AppError('Já existe uma sincronização de contas a pagar em andamento.', 409, 'SINCRONIZACAO_EM_ANDAMENTO');
  estadoSync.emAndamento = true;
  estadoSync.modo = opcoes.modo;
  estadoSync.relatorio = null;
  estadoSync.erro = null;
  estadoSync.iniciadoEm = new Date().toISOString();
  estadoSync.finalizadoEm = null;
  estadoSync.progresso = { fase: 'Começando', feitos: 0, total: null };
  setImmediate(async () => {
    try {
      estadoSync.relatorio = await sincronizarContasPagar({
        ...opcoes,
        onProgresso: (p) => {
          estadoSync.progresso = p;
          opcoes.onProgresso?.(p);
        },
      });
    } catch (e) {
      estadoSync.erro = mensagem(e);
    } finally {
      estadoSync.emAndamento = false;
      estadoSync.finalizadoEm = new Date().toISOString();
    }
  });
  return estadoSincronizacaoContasPagar();
}
