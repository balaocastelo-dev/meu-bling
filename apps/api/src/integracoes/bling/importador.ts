/**
 * IMPORTADOR BLING (API v3) — migração idempotente (upsert por blingId).
 * Roda em background; estado em memória (consultável) + log em STORAGE_DIR/importacao/bling-<data>.log.
 */
import fs from 'node:fs';
import path from 'node:path';
import { format } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { somenteDigitos, competenciaDe, arredondar, formatarMoeda } from '../../lib/util.js';
import { baixarContaReceber } from '../../modules/financeiro/service.js';
import { blingGet, blingPaginar } from './cliente.js';

export type EntidadeBling = 'contatos' | 'produtos' | 'estoque' | 'vendas' | 'compras' | 'contasReceber' | 'contasPagar' | 'notas';
export const ENTIDADES: EntidadeBling[] = ['contatos', 'produtos', 'estoque', 'vendas', 'compras', 'contasReceber', 'contasPagar', 'notas'];

export interface OpcoesImportacao {
  /** produtos: busca o detalhe de cada produto (NCM, custo, imagem). false = só a listagem (muito mais rápido) */
  detalhesProdutos?: boolean;
  /** vendas: pedidos "Em aberto", "Em andamento" e "Verificado" no Bling entram como "Atendido" (fechados) */
  fecharEmAberto?: boolean;
  /** vendas: lança o valor das vendas fechadas (situação final) como recebido no Caixa, na data da venda */
  baixarNoCaixa?: boolean;
  /** vendas/compras/financeiro: data final do período (padrão: hoje) */
  dataFinal?: string;
}

/** Totais apurados na importação de vendas (para conferência com o Bling) */
export interface ResumoVendas {
  quantidade: number;
  total: number;
  fechadasNaMigracao: number;
  caixaQuantidade: number;
  caixaValor: number;
  porSituacao: Record<string, { quantidade: number; total: number }>;
  porMes: Record<string, { quantidade: number; total: number }>;
}

export interface EstadoImportacao {
  emAndamento: boolean;
  iniciadoEm: Date | null;
  finalizadoEm: Date | null;
  entidades: EntidadeBling[];
  progresso: { entidade: EntidadeBling | null; feitos: number; total: number | null };
  resultado: Partial<Record<EntidadeBling, { importados: number; atualizados: number; erros: number; ignorados?: number; resumo?: ResumoVendas }>>;
  opcoes: OpcoesImportacao;
  dataInicial: string | null;
  log: string[];
  erro: string | null;
  arquivoLog: string | null;
}

const estado: EstadoImportacao = {
  emAndamento: false,
  iniciadoEm: null,
  finalizadoEm: null,
  entidades: [],
  progresso: { entidade: null, feitos: 0, total: null },
  resultado: {},
  opcoes: {},
  dataInicial: null,
  log: [],
  erro: null,
  arquivoLog: null,
};

export function estadoImportacao() {
  return { ...estado, log: estado.log.slice(-200) };
}

function log(msg: string) {
  const linha = `[${format(new Date(), 'HH:mm:ss')}] ${msg}`;
  estado.log.push(linha);
  if (estado.log.length > 2000) estado.log.splice(0, estado.log.length - 2000);
  if (estado.arquivoLog) {
    try {
      fs.appendFileSync(estado.arquivoLog, linha + '\n');
    } catch {
      /* ignora */
    }
  }
}

const bid = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown, d = 0) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const dataDe = (v: unknown): Date | null => {
  if (!v || typeof v !== 'string' || v.startsWith('0000')) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T12:00:00') : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// ---------------------------------------------------------------------
// Auxiliares de cadastro (mapas por blingId)
// ---------------------------------------------------------------------
async function contatoPorBling(blingId: string | null, fallback?: { nome?: string; numeroDocumento?: string; tipoPessoa?: string }) {
  if (!blingId) return null;
  const c = await prisma.contato.findUnique({ where: { blingId } });
  if (c) return c;
  if (!fallback?.nome) return null;
  // contato ainda não importado: cria básico para não perder o vínculo
  const doc = somenteDigitos(fallback.numeroDocumento);
  const existente = doc ? await prisma.contato.findFirst({ where: { documento: doc } }) : null;
  if (existente) {
    if (!existente.blingId) await prisma.contato.update({ where: { id: existente.id }, data: { blingId } });
    return existente;
  }
  return prisma.contato.create({ data: { blingId, nome: fallback.nome, documento: doc || null, tipoPessoa: fallback.tipoPessoa === 'J' || doc.length === 14 ? 'J' : 'F' } });
}

async function produtoPorBling(blingId: string | null) {
  if (!blingId) return null;
  return prisma.produto.findUnique({ where: { blingId } });
}

async function formaPagamentoPorBling(blingId: string | null) {
  if (!blingId) return null;
  return prisma.formaPagamento.findUnique({ where: { blingId } });
}

async function categoriaFinPorBling(blingId: string | null) {
  if (!blingId) return null;
  return prisma.categoriaFinanceira.findUnique({ where: { blingId } });
}

/** Situação por nome dentro do módulo; cria se não existir. */
async function situacaoPorNome(modulo: 'VENDA' | 'COMPRA' | 'OS', nome: string, blingId?: string | null, cor?: string | null) {
  const n = nome.trim();
  let s = await prisma.situacao.findUnique({ where: { modulo_nome: { modulo, nome: n } } });
  if (!s) {
    const ultimo = await prisma.situacao.findFirst({ where: { modulo }, orderBy: { ordem: 'desc' } });
    s = await prisma.situacao.create({ data: { modulo, nome: n, cor: cor || '#64748b', ordem: (ultimo?.ordem ?? 0) + 1, blingId: blingId || null } });
    log(`  + situação "${n}" criada no módulo ${modulo}`);
  } else if (blingId && s.blingId !== blingId) {
    await prisma.situacao.update({ where: { id: s.id }, data: { blingId } });
  }
  return s;
}

const SITUACOES_COMPRA: Record<number, string> = { 0: 'Em aberto', 1: 'Atendido', 2: 'Cancelado', 3: 'Em andamento' };

/** Mapeia id de situação de venda do Bling → nome (via /situacoes/modulos). */
async function carregarSituacoesVendaBling(): Promise<Map<string, { nome: string; cor: string | null }>> {
  const mapa = new Map<string, { nome: string; cor: string | null }>();
  try {
    const modulos = await blingGet<{ data: any[] }>('/situacoes/modulos');
    const mod = (modulos.data || []).find((m) => /venda/i.test(m.nome || m.descricao || ''));
    if (!mod) return mapa;
    const sits = await blingGet<{ data: any[] }>(`/situacoes/modulos/${mod.id}`);
    for (const s of sits.data || []) {
      mapa.set(String(s.id), { nome: s.nome, cor: s.cor || null });
      await situacaoPorNome('VENDA', s.nome, String(s.id), s.cor);
    }
    log(`Situações de venda do Bling: ${mapa.size}`);
  } catch (e: any) {
    log(`Aviso: não foi possível ler as situações do Bling (${e.message}); vendas usarão o nome da situação do pedido.`);
  }
  return mapa;
}

// ---------------------------------------------------------------------
// Cadastros auxiliares (depósitos, formas de pagamento, categorias, vendedores)
// ---------------------------------------------------------------------
async function importarAuxiliares() {
  try {
    const dep = await blingGet<{ data: any[] }>('/depositos');
    for (const d of dep.data || []) {
      const blingId = bid(d.id)!;
      const ex = (await prisma.deposito.findUnique({ where: { blingId } })) || (await prisma.deposito.findFirst({ where: { nome: d.descricao } }));
      if (ex) await prisma.deposito.update({ where: { id: ex.id }, data: { blingId, desconsiderarSaldo: !!d.desconsiderarSaldo, ativo: d.situacao !== 0 && d.situacao !== 'I' } });
      else await prisma.deposito.create({ data: { blingId, nome: d.descricao || `Depósito ${blingId}`, padrao: !!d.padrao, desconsiderarSaldo: !!d.desconsiderarSaldo } });
    }
    log(`Depósitos: ${dep.data?.length || 0}`);
  } catch (e: any) {
    log(`Aviso: depósitos não importados (${e.message})`);
  }
  try {
    const fp = await blingGet<{ data: any[] }>('/formas-pagamentos');
    const tipoDe = (t: number) => ({ 1: 'DINHEIRO', 2: 'OUTRO', 3: 'CARTAO_CREDITO', 4: 'CARTAO_DEBITO', 5: 'CREDIARIO', 10: 'OUTRO', 11: 'OUTRO', 12: 'OUTRO', 13: 'OUTRO', 14: 'OUTRO', 15: 'BOLETO', 16: 'TRANSFERENCIA', 17: 'PIX', 18: 'TRANSFERENCIA', 19: 'OUTRO', 90: 'OUTRO', 99: 'OUTRO' } as Record<number, string>)[t] || 'OUTRO';
    for (const f of fp.data || []) {
      const blingId = bid(f.id)!;
      const ex = (await prisma.formaPagamento.findUnique({ where: { blingId } })) || (await prisma.formaPagamento.findFirst({ where: { nome: f.descricao } }));
      const tipoPag = num(f.tipoPagamento, 99);
      if (ex) await prisma.formaPagamento.update({ where: { id: ex.id }, data: { blingId, ativo: f.situacao !== 0 } });
      else await prisma.formaPagamento.create({ data: { blingId, nome: f.descricao || `Forma ${blingId}`, tipo: tipoDe(tipoPag), codigoFiscal: String(tipoPag).padStart(2, '0'), ativo: f.situacao !== 0 } });
    }
    log(`Formas de pagamento: ${fp.data?.length || 0}`);
  } catch (e: any) {
    log(`Aviso: formas de pagamento não importadas (${e.message})`);
  }
  try {
    const cats = await blingGet<{ data: any[] }>('/categorias/produtos');
    const lista: any[] = cats.data || [];
    for (const c of lista) {
      const blingId = bid(c.id)!;
      const ex = (await prisma.categoriaProduto.findUnique({ where: { blingId } })) || (await prisma.categoriaProduto.findFirst({ where: { nome: c.descricao } }));
      if (ex) await prisma.categoriaProduto.update({ where: { id: ex.id }, data: { blingId } });
      else await prisma.categoriaProduto.create({ data: { blingId, nome: c.descricao || `Categoria ${blingId}` } });
    }
    for (const c of lista) {
      if (!c.idCategoriaPai) continue;
      const filha = await prisma.categoriaProduto.findUnique({ where: { blingId: bid(c.id)! } });
      const pai = await prisma.categoriaProduto.findUnique({ where: { blingId: bid(c.idCategoriaPai)! } });
      if (filha && pai && filha.paiId !== pai.id) await prisma.categoriaProduto.update({ where: { id: filha.id }, data: { paiId: pai.id } });
    }
    log(`Categorias de produto: ${lista.length}`);
  } catch (e: any) {
    log(`Aviso: categorias de produto não importadas (${e.message})`);
  }
  try {
    const cats = await blingGet<{ data: any[] }>('/categorias/receitas-despesas');
    for (const c of cats.data || []) {
      const blingId = bid(c.id)!;
      const ex = (await prisma.categoriaFinanceira.findUnique({ where: { blingId } })) || (await prisma.categoriaFinanceira.findFirst({ where: { nome: c.descricao } }));
      if (ex) await prisma.categoriaFinanceira.update({ where: { id: ex.id }, data: { blingId } });
      else await prisma.categoriaFinanceira.create({ data: { blingId, nome: c.descricao || `Categoria ${blingId}`, tipo: num(c.tipo) === 1 ? 'RECEITA' : 'DESPESA', grupoDre: num(c.tipo) === 1 ? 'OUTRAS' : 'DESPESA_OPERACIONAL' } });
    }
    log(`Categorias financeiras: ${cats.data?.length || 0}`);
  } catch (e: any) {
    log(`Aviso: categorias financeiras não importadas (${e.message})`);
  }
  try {
    const vend = await blingGet<{ data: any[] }>('/vendedores');
    for (const v of vend.data || []) {
      const blingId = bid(v.id)!;
      const nome = v.funcionario?.nome || v.nome || `Vendedor ${blingId}`;
      const ex = (await prisma.vendedor.findUnique({ where: { blingId } })) || (await prisma.vendedor.findFirst({ where: { nome } }));
      if (ex) await prisma.vendedor.update({ where: { id: ex.id }, data: { blingId } });
      else await prisma.vendedor.create({ data: { blingId, nome, email: v.funcionario?.email || null, ativo: v.funcionario?.situacao !== 'I' } });
    }
    log(`Vendedores: ${vend.data?.length || 0}`);
  } catch (e: any) {
    log(`Aviso: vendedores não importados (${e.message})`);
  }
}

// ---------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------
async function importarContatos(r: { importados: number; atualizados: number; erros: number }) {
  for await (const pagina of blingPaginar<any>('/contatos')) {
    for (const c of pagina) {
      estado.progresso.feitos += 1;
      try {
        let d: any = c;
        try {
          d = (await blingGet<{ data: any }>(`/contatos/${c.id}`)).data || c;
        } catch {
          /* usa o resumo da listagem */
        }
        const blingId = bid(d.id)!;
        const doc = somenteDigitos(d.numeroDocumento);
        const tipos: string[] = (d.tiposContato || []).map((t: any) => String(t.descricao || '').toLowerCase());
        const ehFornecedor = tipos.some((t) => t.includes('fornecedor'));
        const ehCliente = tipos.some((t) => t.includes('cliente')) || !tipos.length;
        const ehTransportadora = tipos.some((t) => t.includes('transportador'));
        const tipo = ehTransportadora && !ehCliente ? 'TRANSPORTADORA' : ehFornecedor && ehCliente ? 'AMBOS' : ehFornecedor ? 'FORNECEDOR' : 'CLIENTE';
        const end = d.endereco?.geral || d.endereco || {};
        const vendedor = d.vendedor?.id ? await prisma.vendedor.findUnique({ where: { blingId: bid(d.vendedor.id)! } }) : null;
        const dados = {
          nome: d.nome || `Contato ${blingId}`,
          fantasia: d.fantasia || null,
          tipo,
          tipoPessoa: d.tipo === 'J' ? 'J' : d.tipo === 'E' ? 'E' : doc.length === 14 ? 'J' : 'F',
          documento: doc || null,
          ie: d.ie || null,
          ieIsento: num(d.indicadorIe) === 2,
          indicadorIe: num(d.indicadorIe, 9),
          rg: d.rg || null,
          email: d.email || null,
          telefone: d.telefone || null,
          celular: somenteDigitos(d.celular) || null,
          logradouro: end.endereco || null,
          numero: end.numero || null,
          complemento: end.complemento || null,
          bairro: end.bairro || null,
          municipio: end.municipio || null,
          uf: end.uf || null,
          cep: somenteDigitos(end.cep) || null,
          observacoes: d.observacoes || d.dadosAdicionais?.observacoes || null,
          limiteCredito: num(d.financeiro?.limiteCredito),
          ativo: d.situacao !== 'I' && d.situacao !== 'E',
          vendedorId: vendedor?.id ?? null,
        };
        const existente = (await prisma.contato.findUnique({ where: { blingId } })) || (doc ? await prisma.contato.findFirst({ where: { documento: doc, blingId: null } }) : null);
        if (existente) {
          await prisma.contato.update({ where: { id: existente.id }, data: { ...dados, blingId } });
          r.atualizados += 1;
        } else {
          await prisma.contato.create({ data: { ...dados, blingId } });
          r.importados += 1;
        }
      } catch (e: any) {
        r.erros += 1;
        log(`  ! contato ${c.id} (${c.nome}): ${e.message}`);
      }
    }
    log(`Contatos processados: ${estado.progresso.feitos}`);
  }
}

// ---------------------------------------------------------------------
// Produtos
// ---------------------------------------------------------------------
async function importarProdutos(r: { importados: number; atualizados: number; erros: number }, detalhes = true) {
  for await (const pagina of blingPaginar<any>('/produtos', { tipo: 'T' })) {
    for (const p of pagina) {
      estado.progresso.feitos += 1;
      try {
        let d: any = p;
        if (detalhes) {
          try {
            d = (await blingGet<{ data: any }>(`/produtos/${p.id}`)).data || p;
          } catch {
            /* usa resumo */
          }
        }
        const blingId = bid(d.id)!;
        const categoria = d.categoria?.id ? await prisma.categoriaProduto.findUnique({ where: { blingId: bid(d.categoria.id)! } }) : null;
        const trib = d.tributacao || {};
        const tipo = d.tipo === 'S' ? 'S' : 'P';
        const codigo = d.codigo ? String(d.codigo).trim() : null;
        const dados = {
          tipo,
          nome: d.nome || `Produto ${blingId}`,
          gtin: d.gtin ? String(d.gtin) : null,
          unidade: d.unidade || 'UN',
          preco: num(d.preco),
          precoCusto: num(d.fornecedor?.precoCusto ?? d.precoCusto ?? d.custo ?? d.fornecedor?.precoCompra),
          descricaoCurta: d.descricaoCurta || null,
          descricaoDetalhada: d.descricaoComplementar || null,
          imagemUrl: d.midia?.imagens?.imagensURL?.[0]?.link || d.midia?.imagens?.imagensExternas?.[0]?.link || d.imagemURL || null,
          marca: d.marca || null,
          peso: num(d.pesoBruto ?? d.pesoLiquido) || null,
          estoqueMinimo: num(d.estoque?.minimo),
          controlaEstoque: tipo === 'P',
          ativo: d.situacao !== 'I' && d.situacao !== 'E',
          ncm: trib.ncm ? somenteDigitos(trib.ncm) : null,
          cest: trib.cest ? somenteDigitos(trib.cest) : null,
          origem: num(trib.origem),
          codigoServico: trib.codigoListaServicos || null,
          categoriaId: categoria?.id ?? null,
        };
        let existente = await prisma.produto.findUnique({ where: { blingId } });
        if (!existente && codigo) existente = await prisma.produto.findUnique({ where: { codigo } });
        if (existente) {
          await prisma.produto.update({ where: { id: existente.id }, data: { ...dados, blingId, codigo: codigo && codigo !== existente.codigo ? await codigoLivre(codigo, existente.id) : existente.codigo } });
          r.atualizados += 1;
        } else {
          await prisma.produto.create({ data: { ...dados, blingId, codigo: codigo ? await codigoLivre(codigo) : null } });
          r.importados += 1;
        }
      } catch (e: any) {
        r.erros += 1;
        log(`  ! produto ${p.id} (${p.nome}): ${e.message}`);
      }
    }
    log(`Produtos processados: ${estado.progresso.feitos}`);
  }
}

async function codigoLivre(codigo: string, ignorarId?: number) {
  const ex = await prisma.produto.findUnique({ where: { codigo } });
  if (!ex || ex.id === ignorarId) return codigo;
  return `${codigo}-${Date.now().toString(36).slice(-4)}`;
}

// ---------------------------------------------------------------------
// Estoque (saldos por depósito)
// ---------------------------------------------------------------------
async function importarEstoque(r: { importados: number; atualizados: number; erros: number }) {
  const produtos = await prisma.produto.findMany({ where: { blingId: { not: null }, tipo: 'P', controlaEstoque: true }, select: { id: true, blingId: true, precoCusto: true } });
  estado.progresso.total = produtos.length;
  const depositos = await prisma.deposito.findMany({ where: { blingId: { not: null } } });
  const depPadrao = (await prisma.deposito.findFirst({ where: { padrao: true } })) || depositos[0];
  const mapaDep = new Map(depositos.map((d) => [d.blingId!, d]));
  for (let i = 0; i < produtos.length; i += 50) {
    const lote = produtos.slice(i, i + 50);
    try {
      const params: Record<string, string> = {};
      lote.forEach((p, k) => (params[`idsProdutos[${k}]`] = p.blingId!));
      const saldos = await blingGet<{ data: any[] }>('/estoques/saldos', params);
      for (const s of saldos.data || []) {
        const prod = lote.find((p) => p.blingId === bid(s.produto?.id));
        if (!prod) continue;
        const porDeposito: { depositoId: number; saldo: number }[] = [];
        for (const d of s.depositos || []) {
          const dep = mapaDep.get(bid(d.id)!) || null;
          if (dep) porDeposito.push({ depositoId: dep.id, saldo: num(d.saldoFisico ?? d.saldoVirtual) });
        }
        if (!porDeposito.length && depPadrao) porDeposito.push({ depositoId: depPadrao.id, saldo: num(s.saldoFisicoTotal ?? s.saldoVirtualTotal) });
        for (const pd of porDeposito) {
          const atual = await prisma.estoqueSaldo.findUnique({ where: { produtoId_depositoId: { produtoId: prod.id, depositoId: pd.depositoId } } });
          const anterior = atual?.saldo ?? 0;
          if (Math.abs(anterior - pd.saldo) < 0.0001 && atual) continue;
          await prisma.estoqueSaldo.upsert({
            where: { produtoId_depositoId: { produtoId: prod.id, depositoId: pd.depositoId } },
            create: { produtoId: prod.id, depositoId: pd.depositoId, saldo: pd.saldo },
            update: { saldo: pd.saldo },
          });
          await prisma.movimentoEstoque.create({
            data: { produtoId: prod.id, depositoId: pd.depositoId, tipo: 'AJUSTE', quantidade: arredondar(pd.saldo - anterior, 4), custoUnitario: prod.precoCusto, saldoAnterior: anterior, saldoPosterior: pd.saldo, origemTipo: 'IMPORTACAO', observacao: 'Saldo importado do Bling' },
          });
          r.importados += 1;
        }
      }
    } catch (e: any) {
      r.erros += 1;
      log(`  ! estoque lote ${i / 50 + 1}: ${e.message}`);
    }
    estado.progresso.feitos = Math.min(produtos.length, i + 50);
    log(`Estoque processado: ${estado.progresso.feitos}/${produtos.length}`);
  }
}

// ---------------------------------------------------------------------
// Vendas
// ---------------------------------------------------------------------

/** Situações do Bling consideradas "em aberto" (pedido ainda não concluído) — ids padrão + nome como reserva. */
const SIT_VENDA_ABERTA_IDS = new Set(['6', '15', '24']); // Em aberto, Em andamento, Verificado
const SIT_VENDA_ABERTA_NOMES = /^(em aberto|em andamento|verificado)$/i;

/**
 * Lança as parcelas de uma venda fechada como RECEBIDAS no Caixa, na data da venda.
 * Idempotente: parcelas já ligadas a uma conta recebida não são tocadas; sem parcelas, cria uma com o total.
 */
export async function lancarVendaNoCaixa(vendaId: number, caixaId: number, catVendaId: number | null) {
  return prisma.$transaction(async (tx) => {
    const venda = await tx.venda.findUnique({ where: { id: vendaId }, include: { parcelas: { orderBy: { numero: 'asc' } } } });
    if (!venda) return { lancado: 0, contas: 0 };
    const categoriaId = venda.categoriaFinanceiraId ?? catVendaId;
    const competencia = competenciaDe(venda.data);
    let lancado = 0;
    let contas = 0;
    const parcelas = [...venda.parcelas];
    if (!parcelas.length && venda.total > 0) {
      parcelas.push(await tx.vendaParcela.create({ data: { vendaId, numero: 1, dataVencimento: venda.data, valor: arredondar(venda.total) } }));
    }
    const n = parcelas.length;
    for (const p of parcelas) {
      let conta = p.contaReceberId ? await tx.contaReceber.findUnique({ where: { id: p.contaReceberId } }) : null;
      if (!conta) {
        if (p.valor <= 0) continue;
        conta = await tx.contaReceber.create({
          data: {
            contatoId: venda.contatoId,
            vendedorId: venda.vendedorId,
            descricao: `Venda nº ${venda.numero} (${p.numero}/${n})`,
            dataEmissao: venda.data,
            vencimento: p.dataVencimento,
            competencia,
            valor: arredondar(p.valor),
            situacao: 'ABERTO',
            formaPagamentoId: p.formaPagamentoId,
            categoriaId,
            origemTipo: 'VENDA',
            origemId: venda.id,
            parcela: `${p.numero}/${n}`,
            observacoes: p.observacoes,
          },
        });
        await tx.vendaParcela.update({ where: { id: p.id }, data: { contaReceberId: conta.id } });
        contas += 1;
      }
      if (conta.situacao === 'ABERTO' || conta.situacao === 'PARCIAL') {
        const valor = arredondar(conta.valor - conta.valorRecebido - conta.desconto);
        if (valor > 0) {
          await baixarContaReceber({ id: conta.id, valor, data: venda.data, contaFinanceiraId: caixaId, formaPagamentoId: conta.formaPagamentoId, observacoes: 'Recebimento lançado na migração do Bling' }, tx);
          lancado = arredondar(lancado + valor);
        }
      }
    }
    if (!venda.contasLancadas) await tx.venda.update({ where: { id: vendaId }, data: { contasLancadas: true } });
    return { lancado, contas };
  });
}

async function importarVendas(r: { importados: number; atualizados: number; erros: number; resumo?: ResumoVendas }, dataInicial?: string, op: OpcoesImportacao = {}) {
  const sitBling = await carregarSituacoesVendaBling();
  const depPadrao = await prisma.deposito.findFirst({ where: { padrao: true } });
  const catVenda = await prisma.categoriaFinanceira.findFirst({ where: { grupoDre: 'RECEITA_BRUTA', nome: { contains: 'produto' } } });
  const sitAtendido = op.fecharEmAberto ? await situacaoPorNome('VENDA', 'Atendido') : null;
  const caixa = op.baixarNoCaixa ? (await prisma.contaFinanceira.findFirst({ where: { tipo: 'CAIXA', ativo: true }, orderBy: [{ padrao: 'desc' }, { id: 'asc' }] })) || (await prisma.contaFinanceira.findFirst({ where: { padrao: true } })) : null;
  if (op.baixarNoCaixa && !caixa) throw new Error('Nenhuma conta financeira do tipo Caixa encontrada para lançar os recebimentos.');
  if (op.fecharEmAberto) log('Opção: vendas "Em aberto", "Em andamento" e "Verificado" serão gravadas como "Atendido".');
  if (caixa) log(`Opção: vendas fechadas serão lançadas como recebidas na conta "${caixa.nome}" na data da venda.`);
  const totais: ResumoVendas = { quantidade: 0, total: 0, fechadasNaMigracao: 0, caixaQuantidade: 0, caixaValor: 0, porSituacao: {}, porMes: {} };
  r.resumo = totais;
  const soma = (mapa: Record<string, { quantidade: number; total: number }>, chave: string, valor: number) => {
    const m = (mapa[chave] ||= { quantidade: 0, total: 0 });
    m.quantidade += 1;
    m.total = arredondar(m.total + valor);
  };
  let maiorNumero = 0;
  for await (const pagina of blingPaginar<any>('/pedidos/vendas', { dataInicial, dataFinal: op.dataFinal || (dataInicial ? format(new Date(), 'yyyy-MM-dd') : undefined) })) {
    for (const resumo of pagina) {
      estado.progresso.feitos += 1;
      try {
        const v: any = (await blingGet<{ data: any }>(`/pedidos/vendas/${resumo.id}`)).data || resumo;
        const blingId = bid(v.id)!;
        const nomeSitBling = String(sitBling.get(bid(v.situacao?.id) || '')?.nome || v.situacao?.valor || v.situacao?.nome || 'Em aberto').trim();
        const estavaAberta = SIT_VENDA_ABERTA_IDS.has(bid(v.situacao?.id) || '') || SIT_VENDA_ABERTA_NOMES.test(nomeSitBling);
        const fecharAgora = !!(sitAtendido && estavaAberta);
        const situacao = fecharAgora ? sitAtendido! : await situacaoPorNome('VENDA', nomeSitBling, bid(v.situacao?.id));
        const contato = await contatoPorBling(bid(v.contato?.id), { nome: v.contato?.nome, numeroDocumento: v.contato?.numeroDocumento, tipoPessoa: v.contato?.tipoPessoa });
        if (!contato) throw new Error('venda sem contato');
        const vendedor = v.vendedor?.id ? await prisma.vendedor.findUnique({ where: { blingId: bid(v.vendedor.id)! } }) : null;
        const itens: any[] = [];
        let ordem = 0;
        for (const it of v.itens || []) {
          const prod = await produtoPorBling(bid(it.produto?.id));
          const qtd = num(it.quantidade, 1);
          const unit = num(it.valor);
          const desc = num(it.desconto);
          const total = arredondar(qtd * unit - (desc <= 100 && it.desconto && String(it.desconto).includes('%') ? (qtd * unit * desc) / 100 : desc));
          itens.push({
            produtoId: prod?.id ?? null,
            codigo: it.codigo || prod?.codigo || null,
            descricao: it.descricao || prod?.nome || 'Item',
            unidade: it.unidade || 'UN',
            quantidade: qtd,
            valorUnitario: unit,
            desconto: desc,
            total,
            custoUnitario: prod?.precoCusto ?? 0,
            comissaoPct: num(it.comissao?.aliquota),
            comissaoValor: num(it.comissao?.valor),
            ordem: ordem++,
          });
        }
        const totalProdutos = arredondar(itens.reduce((s, i) => s + i.total, 0));
        const descontoTipo = v.desconto?.unidade === 'PERCENTUAL' ? 'PERCENTUAL' : 'REAL';
        const descontoValor = num(v.desconto?.valor);
        const frete = num(v.transporte?.frete);
        const outras = num(v.outrasDespesas);
        const total = num(v.total) || arredondar(totalProdutos - (descontoTipo === 'PERCENTUAL' ? (totalProdutos * descontoValor) / 100 : descontoValor) + frete + outras);
        const final = situacao.final && !situacao.cancelamento;
        const transportadora = v.transporte?.contato?.id ? await contatoPorBling(bid(v.transporte.contato.id), { nome: v.transporte.contato.nome }) : null;
        const dados = {
          numero: num(v.numero),
          data: dataDe(v.data) || new Date(),
          dataPrevista: dataDe(v.dataPrevista),
          dataSaida: dataDe(v.dataSaida),
          contatoId: contato.id,
          vendedorId: vendedor?.id ?? null,
          situacaoId: situacao.id,
          depositoId: depPadrao?.id ?? null,
          categoriaFinanceiraId: (v.categoria?.id ? (await categoriaFinPorBling(bid(v.categoria.id)))?.id : null) ?? catVenda?.id ?? null,
          origem: v.loja?.id ? 'LOJA_VIRTUAL' : 'BALCAO',
          numeroPedidoLoja: v.numeroLoja || null,
          totalProdutos,
          descontoTipo,
          descontoValor,
          frete,
          outrasDespesas: outras,
          total,
          custoTotal: arredondar(itens.reduce((s, i) => s + i.custoUnitario * i.quantidade, 0)),
          observacoes: v.observacoes || null,
          observacoesInternas: fecharAgora
            ? [v.observacoesInternas, `[Migração do Bling] Estava "${nomeSitBling}" no Bling em ${format(new Date(), 'dd/MM/yyyy')}; considerada fechada (Atendido).`].filter(Boolean).join('\n')
            : v.observacoesInternas || null,
          transportadoraId: transportadora?.id ?? null,
          fretePorConta: num(v.transporte?.fretePorConta, 9),
          quantidadeVolumes: num(v.transporte?.quantidadeVolumes),
          pesoBruto: num(v.transporte?.pesoBruto),
          // vendas finais entram com estoque/contas "já lançados": o saldo de estoque vem do Bling (snapshot)
          // e as contas são criadas pela opção baixarNoCaixa ou pela importação de contas a receber
          estoqueLancado: final,
          contasLancadas: final && !caixa ? true : false,
        };
        const parcelas: any[] = [];
        let np = 0;
        for (const p of v.parcelas || []) {
          const fp = await formaPagamentoPorBling(bid(p.formaPagamento?.id));
          parcelas.push({ numero: ++np, dataVencimento: dataDe(p.dataVencimento) || dados.data, valor: num(p.valor), formaPagamentoId: fp?.id ?? null, observacoes: p.observacoes || null });
        }
        const existente = await prisma.venda.findUnique({ where: { blingId } });
        const conflitoNumero = await prisma.venda.findUnique({ where: { numero: dados.numero } });
        if (conflitoNumero && conflitoNumero.blingId !== blingId) throw new Error(`número ${dados.numero} já existe (venda id ${conflitoNumero.id})`);
        let vendaId: number;
        if (existente) {
          // contas já lançadas/recebidas não são desfeitas numa reimportação
          const contasLancadas = existente.contasLancadas || dados.contasLancadas;
          await prisma.$transaction(async (tx) => {
            await tx.vendaItem.deleteMany({ where: { vendaId: existente.id } });
            await tx.vendaParcela.deleteMany({ where: { vendaId: existente.id, contaReceberId: null } });
            await tx.venda.update({ where: { id: existente.id }, data: { ...dados, contasLancadas, itens: { create: itens }, parcelas: (await tx.vendaParcela.count({ where: { vendaId: existente.id } })) ? undefined : { create: parcelas } } });
          });
          if (existente.situacaoId !== situacao.id) {
            const de = await prisma.situacao.findUnique({ where: { id: existente.situacaoId } });
            await prisma.historicoSituacao.create({ data: { entidadeTipo: 'VENDA', entidadeId: existente.id, deSituacaoId: existente.situacaoId, deSituacao: de?.nome, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, observacao: fecharAgora ? `Fechada na migração (no Bling: "${nomeSitBling}")` : 'Atualizada pela importação do Bling', data: new Date() } });
          }
          vendaId = existente.id;
          r.atualizados += 1;
        } else {
          const nova = await prisma.venda.create({ data: { ...dados, blingId, itens: { create: itens }, parcelas: { create: parcelas } } });
          await prisma.historicoSituacao.create({ data: { entidadeTipo: 'VENDA', entidadeId: nova.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, observacao: fecharAgora ? `Importada do Bling (lá estava "${nomeSitBling}"; fechada na migração)` : 'Importada do Bling', data: dados.data } });
          vendaId = nova.id;
          r.importados += 1;
        }
        // ---- resumo para conferência
        totais.quantidade += 1;
        totais.total = arredondar(totais.total + total);
        if (fecharAgora) totais.fechadasNaMigracao += 1;
        soma(totais.porSituacao, fecharAgora ? `Atendido (era ${nomeSitBling})` : situacao.nome, total);
        soma(totais.porMes, competenciaDe(dados.data), total);
        // ---- caixa
        if (caixa && final && total > 0) {
          const lc = await lancarVendaNoCaixa(vendaId, caixa.id, catVenda?.id ?? null);
          if (lc.lancado > 0) {
            totais.caixaQuantidade += 1;
            totais.caixaValor = arredondar(totais.caixaValor + lc.lancado);
          }
        }
        maiorNumero = Math.max(maiorNumero, dados.numero);
      } catch (e: any) {
        r.erros += 1;
        log(`  ! venda ${resumo.numero ?? resumo.id}: ${e.message}`);
      }
    }
    log(`Vendas processadas: ${estado.progresso.feitos} (${totais.quantidade} gravadas, ${formatarMoeda(totais.total)})`);
  }
  if (maiorNumero) {
    const seq = await prisma.sequencia.findUnique({ where: { nome: 'VENDA' } });
    if (!seq || seq.valor < maiorNumero) await prisma.sequencia.upsert({ where: { nome: 'VENDA' }, create: { nome: 'VENDA', valor: maiorNumero }, update: { valor: maiorNumero } });
  }
  // ---- resumo final (conferência com o Bling)
  log(`RESUMO vendas${dataInicial ? ` desde ${dataInicial}` : ''}: ${totais.quantidade} pedidos, total ${formatarMoeda(totais.total)}`);
  for (const [sit, m] of Object.entries(totais.porSituacao).sort((a, b) => b[1].total - a[1].total)) log(`  ${sit}: ${m.quantidade} pedidos, ${formatarMoeda(m.total)}`);
  for (const [mes, m] of Object.entries(totais.porMes).sort()) log(`  ${mes}: ${m.quantidade} pedidos, ${formatarMoeda(m.total)}`);
  if (sitAtendido) log(`  Fechadas na migração (estavam em aberto no Bling): ${totais.fechadasNaMigracao}`);
  if (caixa) log(`  Lançado no caixa "${caixa.nome}": ${totais.caixaQuantidade} vendas, ${formatarMoeda(totais.caixaValor)}`);
}

// ---------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------
async function importarCompras(r: { importados: number; atualizados: number; erros: number }, dataInicial?: string, dataFinal?: string) {
  const depPadrao = await prisma.deposito.findFirst({ where: { padrao: true } });
  const catCmv = await prisma.categoriaFinanceira.findFirst({ where: { grupoDre: 'CMV' } });
  let maiorNumero = 0;
  for await (const pagina of blingPaginar<any>('/pedidos/compras', { dataInicial, dataFinal: dataFinal || (dataInicial ? format(new Date(), 'yyyy-MM-dd') : undefined) })) {
    for (const resumo of pagina) {
      estado.progresso.feitos += 1;
      try {
        const c: any = (await blingGet<{ data: any }>(`/pedidos/compras/${resumo.id}`)).data || resumo;
        const blingId = bid(c.id)!;
        const nomeSit = SITUACOES_COMPRA[num(c.situacao?.valor, 0)] || 'Em aberto';
        const situacao = await situacaoPorNome('COMPRA', nomeSit);
        const fornecedor = await contatoPorBling(bid(c.fornecedor?.id), { nome: c.fornecedor?.nome, numeroDocumento: c.fornecedor?.numeroDocumento });
        if (!fornecedor) throw new Error('compra sem fornecedor');
        const itens: any[] = [];
        let ordem = 0;
        for (const it of c.itens || []) {
          const prod = await produtoPorBling(bid(it.produto?.id));
          const qtd = num(it.quantidade, 1);
          const unit = num(it.valor);
          itens.push({ produtoId: prod?.id ?? null, codigoFornecedor: it.codigoFornecedor || null, descricao: it.descricao || prod?.nome || 'Item', unidade: it.unidade || 'UN', quantidade: qtd, valorUnitario: unit, ipiPct: num(it.aliquotaIPI), total: arredondar(qtd * unit), ordem: ordem++ });
        }
        const totalProdutos = arredondar(itens.reduce((s, i) => s + i.total, 0));
        const final = situacao.final && !situacao.cancelamento;
        const dados = {
          numero: num(c.numero),
          data: dataDe(c.data) || new Date(),
          dataPrevista: dataDe(c.dataPrevista),
          fornecedorId: fornecedor.id,
          situacaoId: situacao.id,
          depositoId: depPadrao?.id ?? null,
          categoriaFinanceiraId: (c.categoria?.id ? (await categoriaFinPorBling(bid(c.categoria.id)))?.id : null) ?? catCmv?.id ?? null,
          ordemCompra: c.ordemCompra || null,
          totalProdutos,
          descontoValor: num(c.desconto?.valor),
          frete: num(c.transporte?.frete),
          outrasDespesas: num(c.outrasDespesas),
          total: num(c.total) || totalProdutos,
          observacoes: c.observacoes || null,
          observacoesInternas: c.observacoesInternas || null,
          estoqueLancado: final,
          contasLancadas: final,
        };
        const parcelas: any[] = [];
        let np = 0;
        for (const p of c.parcelas || []) {
          const fp = await formaPagamentoPorBling(bid(p.formaPagamento?.id));
          parcelas.push({ numero: ++np, dataVencimento: dataDe(p.dataVencimento) || dados.data, valor: num(p.valor), formaPagamentoId: fp?.id ?? null, observacoes: p.observacao || p.observacoes || null });
        }
        const existente = await prisma.compra.findUnique({ where: { blingId } });
        const conflito = await prisma.compra.findUnique({ where: { numero: dados.numero } });
        if (conflito && conflito.blingId !== blingId) dados.numero = (await prisma.compra.findFirst({ orderBy: { numero: 'desc' } }))!.numero + 1;
        if (existente) {
          await prisma.$transaction(async (tx) => {
            await tx.compraItem.deleteMany({ where: { compraId: existente.id } });
            await tx.compraParcela.deleteMany({ where: { compraId: existente.id, contaPagarId: null } });
            await tx.compra.update({ where: { id: existente.id }, data: { ...dados, numero: existente.numero, itens: { create: itens }, parcelas: (await tx.compraParcela.count({ where: { compraId: existente.id } })) ? undefined : { create: parcelas } } });
          });
          r.atualizados += 1;
        } else {
          const nova = await prisma.compra.create({ data: { ...dados, blingId, itens: { create: itens }, parcelas: { create: parcelas } } });
          await prisma.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: nova.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, observacao: 'Importada do Bling', data: dados.data } });
          r.importados += 1;
        }
        maiorNumero = Math.max(maiorNumero, dados.numero);
      } catch (e: any) {
        r.erros += 1;
        log(`  ! compra ${resumo.numero ?? resumo.id}: ${e.message}`);
      }
    }
    log(`Compras processadas: ${estado.progresso.feitos}`);
  }
  if (maiorNumero) {
    const seq = await prisma.sequencia.findUnique({ where: { nome: 'COMPRA' } });
    if (!seq || seq.valor < maiorNumero) await prisma.sequencia.upsert({ where: { nome: 'COMPRA' }, create: { nome: 'COMPRA', valor: maiorNumero }, update: { valor: maiorNumero } });
  }
}

// ---------------------------------------------------------------------
// Contas a receber / pagar
// ---------------------------------------------------------------------
const SIT_CONTA: Record<number, string> = { 1: 'ABERTO', 2: 'RECEBIDO', 3: 'PARCIAL', 4: 'CANCELADO', 5: 'CANCELADO' };

async function importarContas(tipo: 'receber' | 'pagar', r: { importados: number; atualizados: number; erros: number; ignorados?: number }, dataInicial?: string, dataFinal?: string) {
  const caminho = tipo === 'receber' ? '/contas/receber' : '/contas/pagar';
  const params: Record<string, string | undefined> = dataInicial ? { dataEmissaoInicial: dataInicial, dataEmissaoFinal: dataFinal || format(new Date(), 'yyyy-MM-dd') } : {};
  for await (const pagina of blingPaginar<any>(caminho, params)) {
    for (const c of pagina) {
      estado.progresso.feitos += 1;
      try {
        const blingId = bid(c.id)!;
        const contato = await contatoPorBling(bid(c.contato?.id), { nome: c.contato?.nome, numeroDocumento: c.contato?.numeroDocumento });
        const fp = await formaPagamentoPorBling(bid(c.formaPagamento?.id));
        const cat = await categoriaFinPorBling(bid(c.categoria?.id));
        const sit = SIT_CONTA[num(c.situacao, 1)] || 'ABERTO';
        const valor = num(c.valor);
        const saldo = c.saldo !== undefined ? num(c.saldo) : sit === 'ABERTO' ? valor : 0;
        const baixado = arredondar(Math.max(0, valor - saldo));
        const vencimento = dataDe(c.vencimento) || dataDe(c.vencimentoOriginal) || new Date();
        const origemNumero = c.origem?.numero || c.numeroDocumento;
        const origemTipo = c.origem?.tipoOrigem ? String(c.origem.tipoOrigem).toUpperCase() : 'MANUAL';
        let origemId: number | null = null;
        if (/VENDA|PEDIDO/.test(origemTipo) && c.origem?.id) origemId = (await prisma.venda.findUnique({ where: { blingId: bid(c.origem.id)! } }))?.id ?? null;
        if (/COMPRA/.test(origemTipo) && c.origem?.id) origemId = (await prisma.compra.findUnique({ where: { blingId: bid(c.origem.id)! } }))?.id ?? null;
        // venda cujas contas já foram geradas/baixadas pela importação de vendas (opção "lançar no caixa"): não duplica
        if (tipo === 'receber' && origemId && !(await prisma.contaReceber.findUnique({ where: { blingId } })) && (await prisma.contaReceber.count({ where: { origemTipo: 'VENDA', origemId } }))) {
          r.ignorados = (r.ignorados || 0) + 1;
          continue;
        }
        const descricao = c.historico || (origemNumero ? `${tipo === 'receber' ? 'Venda' : 'Compra'} nº ${origemNumero}` : `${tipo === 'receber' ? 'Conta a receber' : 'Conta a pagar'} Bling ${blingId}`);
        const comum = {
          contatoId: contato?.id ?? null,
          descricao: String(descricao).slice(0, 250),
          dataEmissao: dataDe(c.dataEmissao) || vencimento,
          vencimento,
          competencia: c.competencia ? String(c.competencia).slice(0, 7) : competenciaDe(vencimento),
          valor,
          situacao: sit === 'RECEBIDO' && tipo === 'pagar' ? 'PAGO' : sit,
          formaPagamentoId: fp?.id ?? null,
          categoriaId: cat?.id ?? null,
          origemTipo: origemId ? (tipo === 'receber' ? 'VENDA' : 'COMPRA') : 'MANUAL',
          origemId,
          observacoes: c.numeroDocumento ? `Documento: ${c.numeroDocumento}` : null,
        };
        if (tipo === 'receber') {
          const vendedor = c.vendedor?.id ? await prisma.vendedor.findUnique({ where: { blingId: bid(c.vendedor.id)! } }) : null;
          const dados = { ...comum, vendedorId: vendedor?.id ?? null, valorRecebido: sit === 'CANCELADO' ? 0 : baixado, dataRecebimento: sit === 'RECEBIDO' ? dataDe(c.dataRecebimento) || vencimento : null };
          const ex = await prisma.contaReceber.findUnique({ where: { blingId } });
          if (ex) {
            if (!(await prisma.movimentoFinanceiro.count({ where: { contaReceberId: ex.id } }))) await prisma.contaReceber.update({ where: { id: ex.id }, data: dados });
            r.atualizados += 1;
          } else {
            await prisma.contaReceber.create({ data: { ...dados, blingId } });
            r.importados += 1;
          }
        } else {
          const dados = { ...comum, valorPago: sit === 'CANCELADO' ? 0 : baixado, dataPagamento: sit === 'RECEBIDO' ? dataDe(c.dataPagamento) || vencimento : null };
          const ex = await prisma.contaPagar.findUnique({ where: { blingId } });
          if (ex) {
            if (!(await prisma.movimentoFinanceiro.count({ where: { contaPagarId: ex.id } }))) await prisma.contaPagar.update({ where: { id: ex.id }, data: dados });
            r.atualizados += 1;
          } else {
            await prisma.contaPagar.create({ data: { ...dados, blingId } });
            r.importados += 1;
          }
        }
      } catch (e: any) {
        r.erros += 1;
        log(`  ! conta ${tipo} ${c.id}: ${e.message}`);
      }
    }
    log(`Contas a ${tipo} processadas: ${estado.progresso.feitos}`);
  }
  if (r.ignorados) log(`Contas a ${tipo} ignoradas por já existirem na venda (geradas pela importação de vendas): ${r.ignorados}`);
}

// ---------------------------------------------------------------------
// Notas fiscais (metadados + link; XML não é baixado)
// ---------------------------------------------------------------------
const SIT_NFE: Record<number, string> = { 1: 'PENDENTE', 2: 'CANCELADA', 3: 'PROCESSANDO', 4: 'REJEITADA', 5: 'AUTORIZADA', 6: 'AUTORIZADA', 7: 'AUTORIZADA', 8: 'PROCESSANGO', 9: 'DENEGADA', 10: 'PROCESSANDO', 11: 'ERRO' };

async function importarNotas(r: { importados: number; atualizados: number; erros: number }, dataInicial?: string, dataFinal?: string) {
  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { ambienteFiscal: true } });
  const params: Record<string, string | undefined> = dataInicial ? { dataEmissaoInicial: dataInicial, dataEmissaoFinal: dataFinal || format(new Date(), 'yyyy-MM-dd') } : {};
  for await (const pagina of blingPaginar<any>('/nfe', params)) {
    for (const n of pagina) {
      estado.progresso.feitos += 1;
      try {
        const blingId = bid(n.id)!;
        const contato = await contatoPorBling(bid(n.contato?.id), { nome: n.contato?.nome, numeroDocumento: n.contato?.numeroDocumento });
        const sit = SIT_NFE[num(n.situacao, 1)] || 'PENDENTE';
        const chave = n.chaveAcesso ? somenteDigitos(n.chaveAcesso) : null;
        const dados = {
          tipo: num(n.tipo, 1),
          modelo: 55,
          serie: num(n.serie, 1),
          numero: num(n.numero),
          chave: chave && chave.length === 44 ? chave : null,
          situacao: sit === 'PROCESSANGO' ? 'PROCESSANDO' : sit,
          ambiente: empresa?.ambienteFiscal ?? 2,
          dataEmissao: dataDe(n.dataEmissao) || new Date(),
          dataSaida: dataDe(n.dataOperacao),
          dataAutorizacao: sit === 'AUTORIZADA' ? dataDe(n.dataEmissao) : null,
          contatoId: contato?.id ?? null,
          naturezaOperacao: n.naturezaOperacao?.descricao || n.naturezaOperacao?.nome || 'Venda de mercadoria',
          valorTotal: num(n.valorNota),
          valorProdutos: num(n.valorNota),
          urlChave: n.linkDanfe || n.linkPDF || null,
          motivo: 'Importada do Bling (XML não baixado)' + (n.xml ? ` — XML: ${n.xml}` : ''),
        };
        const existente = (await prisma.notaFiscal.findUnique({ where: { blingId } })) || (dados.chave ? await prisma.notaFiscal.findUnique({ where: { chave: dados.chave } }) : null) || (await prisma.notaFiscal.findUnique({ where: { modelo_serie_numero: { modelo: 55, serie: dados.serie, numero: dados.numero } } }));
        if (existente) {
          if (existente.blingId && existente.blingId !== blingId) throw new Error(`nota ${dados.serie}/${dados.numero} já vinculada a outro id Bling`);
          await prisma.notaFiscal.update({ where: { id: existente.id }, data: { ...dados, blingId } });
          r.atualizados += 1;
        } else {
          await prisma.notaFiscal.create({ data: { ...dados, blingId } });
          r.importados += 1;
        }
        // vincula à venda importada (notaFiscal.id no pedido) quando possível
        const vendaBlingId = n.pedido?.id ? bid(n.pedido.id) : null;
        if (vendaBlingId) {
          const venda = await prisma.venda.findUnique({ where: { blingId: vendaBlingId } });
          const nota = await prisma.notaFiscal.findUnique({ where: { blingId } });
          if (venda && nota && !venda.notaId) await prisma.venda.update({ where: { id: venda.id }, data: { notaId: nota.id } }).catch(() => undefined);
        }
      } catch (e: any) {
        r.erros += 1;
        log(`  ! NF-e ${n.numero ?? n.id}: ${e.message}`);
      }
    }
    log(`Notas processadas: ${estado.progresso.feitos}`);
  }
  // ajusta numeração da série
  const ultima = await prisma.notaFiscal.findFirst({ where: { modelo: 55, tipo: 1 }, orderBy: [{ serie: 'desc' }, { numero: 'desc' }] });
  if (ultima) {
    const e = await prisma.empresa.findUnique({ where: { id: 1 }, select: { serieNfe: true, proximoNumeroNfe: true } });
    if (e && ultima.serie === e.serieNfe && ultima.numero >= e.proximoNumeroNfe) await prisma.empresa.update({ where: { id: 1 }, data: { proximoNumeroNfe: ultima.numero + 1 } });
  }
}

// ---------------------------------------------------------------------
// Orquestração (background)
// ---------------------------------------------------------------------
export async function iniciarImportacao(entidades: EntidadeBling[], dataInicial?: string, opcoes: OpcoesImportacao = {}) {
  if (estado.emAndamento) throw new Error('Já existe uma importação em andamento.');
  const ordem = ENTIDADES.filter((e) => entidades.includes(e)); // respeita dependências
  estado.emAndamento = true;
  estado.iniciadoEm = new Date();
  estado.finalizadoEm = null;
  estado.entidades = ordem;
  estado.progresso = { entidade: null, feitos: 0, total: null };
  estado.resultado = {};
  estado.opcoes = { ...opcoes };
  estado.dataInicial = dataInicial || null;
  estado.log = [];
  estado.erro = null;
  const pasta = path.join(env.STORAGE_DIR, 'importacao');
  fs.mkdirSync(pasta, { recursive: true });
  estado.arquivoLog = path.join(pasta, `bling-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.log`);
  log(`Importação iniciada: ${ordem.join(', ')}${dataInicial ? ` (de ${dataInicial} até ${opcoes.dataFinal || 'hoje'})` : ''}`);

  setImmediate(async () => {
    try {
      log('Cadastros auxiliares (depósitos, formas de pagamento, categorias, vendedores)...');
      await importarAuxiliares();
      for (const ent of ordem) {
        estado.progresso = { entidade: ent, feitos: 0, total: null };
        const r: { importados: number; atualizados: number; erros: number; ignorados?: number; resumo?: ResumoVendas } = { importados: 0, atualizados: 0, erros: 0 };
        estado.resultado[ent] = r;
        log(`== ${ent} ==`);
        try {
          if (ent === 'contatos') await importarContatos(r);
          else if (ent === 'produtos') await importarProdutos(r, opcoes.detalhesProdutos !== false);
          else if (ent === 'estoque') await importarEstoque(r);
          else if (ent === 'vendas') await importarVendas(r, dataInicial, opcoes);
          else if (ent === 'compras') await importarCompras(r, dataInicial, opcoes.dataFinal);
          else if (ent === 'contasReceber') await importarContas('receber', r, dataInicial, opcoes.dataFinal);
          else if (ent === 'contasPagar') await importarContas('pagar', r, dataInicial, opcoes.dataFinal);
          else if (ent === 'notas') await importarNotas(r, dataInicial, opcoes.dataFinal);
        } catch (e: any) {
          r.erros += 1;
          log(`!! ${ent}: ${e.message}`);
        }
        log(`${ent}: ${r.importados} novos, ${r.atualizados} atualizados, ${r.erros} erros${r.ignorados ? `, ${r.ignorados} ignorados` : ''}`);
      }
      await prisma.configuracao.upsert({ where: { chave: 'bling.ultimaImportacao' }, create: { chave: 'bling.ultimaImportacao', valor: new Date().toISOString() }, update: { valor: new Date().toISOString() } });
      log('Importação concluída.');
    } catch (e: any) {
      estado.erro = e?.message || String(e);
      log(`!! Falha geral: ${estado.erro}`);
    } finally {
      estado.emAndamento = false;
      estado.finalizadoEm = new Date();
      estado.progresso.entidade = null;
    }
  });
  return estadoImportacao();
}

// ---------------------------------------------------------------------
// Importação por CSV (exportação do Bling)
// ---------------------------------------------------------------------
function normalizarCabecalho(h: string) {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCsv(conteudo: string): { cabecalho: string[]; linhas: string[][] } {
  const texto = conteudo.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const primeira = texto.split('\n')[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n') {
      linha.push(campo);
      if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += ch;
  }
  linha.push(campo);
  if (linha.some((c) => c.trim() !== '')) linhas.push(linha);
  const cabecalho = (linhas.shift() || []).map(normalizarCabecalho);
  return { cabecalho, linhas };
}

function indexador(cabecalho: string[]) {
  return (...padroes: (string | RegExp)[]) => {
    for (const p of padroes) {
      const idx = cabecalho.findIndex((h) => (typeof p === 'string' ? h === p : p.test(h)));
      if (idx >= 0) return idx;
    }
    return -1;
  };
}

const numBr = (v: string | undefined) => {
  if (!v) return 0;
  const s = v.trim().replace(/R\$\s?/i, '');
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

export async function importarCsv(entidade: 'contatos' | 'produtos', conteudo: string) {
  const { cabecalho, linhas } = parseCsv(conteudo);
  const col = indexador(cabecalho);
  const r = { importados: 0, atualizados: 0, erros: 0, ignorados: 0, detalhes: [] as string[] };
  if (entidade === 'contatos') {
    const iNome = col('nome', /^nome/, /razao/);
    const iFant = col(/fantasia/);
    const iDoc = col(/cpf ?\/? ?cnpj/, /cnpj/, /cpf/, /documento/);
    const iEmail = col(/e ?mail/);
    const iCel = col(/celular/, /whats/);
    const iTel = col(/^telefone/, /^fone/);
    const iEnd = col(/^endereco/, /logradouro/);
    const iNum = col(/^numero$/, /^n[o°]?$/);
    const iComp = col(/complemento/);
    const iBairro = col(/bairro/);
    const iCep = col(/cep/);
    const iCid = col(/cidade/, /municipio/);
    const iUf = col(/^uf$/, /estado/);
    const iIe = col(/inscricao estadual/, /^ie$/);
    const iTipo = col(/tipo pessoa/, /^tipo$/);
    const iCod = col(/^codigo$/, /^id$/);
    const iObs = col(/observac/);
    const iTipoCont = col(/tipo de contato/, /tipos de contato/, /contribuinte/);
    if (iNome < 0) throw new Error('Cabeçalho "Nome" não encontrado no CSV.');
    for (const l of linhas) {
      const nome = (l[iNome] || '').trim();
      if (!nome) {
        r.ignorados += 1;
        continue;
      }
      try {
        const doc = somenteDigitos(l[iDoc]);
        const tipoCont = (iTipoCont >= 0 ? l[iTipoCont] : '').toLowerCase();
        const dados = {
          nome,
          fantasia: iFant >= 0 ? l[iFant]?.trim() || null : null,
          documento: doc || null,
          tipoPessoa: iTipo >= 0 && /j/i.test(l[iTipo] || '') ? 'J' : doc.length === 14 ? 'J' : 'F',
          tipo: /fornecedor/.test(tipoCont) ? (/cliente/.test(tipoCont) ? 'AMBOS' : 'FORNECEDOR') : 'CLIENTE',
          email: iEmail >= 0 ? l[iEmail]?.trim() || null : null,
          celular: iCel >= 0 ? somenteDigitos(l[iCel]) || null : null,
          telefone: iTel >= 0 ? l[iTel]?.trim() || null : null,
          logradouro: iEnd >= 0 ? l[iEnd]?.trim() || null : null,
          numero: iNum >= 0 ? l[iNum]?.trim() || null : null,
          complemento: iComp >= 0 ? l[iComp]?.trim() || null : null,
          bairro: iBairro >= 0 ? l[iBairro]?.trim() || null : null,
          cep: iCep >= 0 ? somenteDigitos(l[iCep]) || null : null,
          municipio: iCid >= 0 ? l[iCid]?.trim() || null : null,
          uf: iUf >= 0 ? l[iUf]?.trim().toUpperCase().slice(0, 2) || null : null,
          ie: iIe >= 0 ? l[iIe]?.trim() || null : null,
          observacoes: iObs >= 0 ? l[iObs]?.trim() || null : null,
        };
        const blingId = iCod >= 0 && l[iCod]?.trim() ? `csv:${l[iCod].trim()}` : null;
        const existente = (blingId ? await prisma.contato.findUnique({ where: { blingId } }) : null) || (doc ? await prisma.contato.findFirst({ where: { documento: doc } }) : null) || (!doc ? await prisma.contato.findFirst({ where: { nome, documento: null } }) : null);
        if (existente) {
          await prisma.contato.update({ where: { id: existente.id }, data: { ...dados, blingId: existente.blingId || blingId } });
          r.atualizados += 1;
        } else {
          await prisma.contato.create({ data: { ...dados, blingId } });
          r.importados += 1;
        }
      } catch (e: any) {
        r.erros += 1;
        if (r.detalhes.length < 50) r.detalhes.push(`${nome}: ${e.message}`);
      }
    }
    return r;
  }

  // produtos
  const iDesc = col(/^descricao$/, /^nome$/, /^descricao do produto$/, /^produto$/);
  const iCod = col(/^codigo$/, /^sku$/, /^codigo \(sku\)$/);
  const iPreco = col(/^preco$/, /preco de venda/, /^valor$/);
  const iCusto = col(/preco de custo/, /^custo$/, /preco de compra/);
  const iNcm = col(/^ncm$/);
  const iCest = col(/^cest$/);
  const iGtin = col(/^gtin ?\/? ?ean$/, /^gtin$/, /^ean$/, /codigo de barras/);
  const iUn = col(/^unidade$/, /^un$/);
  const iEst = col(/^estoque$/, /estoque atual/, /saldo/);
  const iMin = col(/estoque minimo/);
  const iMarca = col(/^marca$/);
  const iCat = col(/categoria/);
  const iTipo = col(/^tipo$/, /tipo do produto/);
  const iSit = col(/^situacao$/);
  const iOrig = col(/^origem$/);
  const iPeso = col(/peso bruto/, /^peso$/);
  const iCurta = col(/descricao curta/);
  const iLonga = col(/descricao complementar/, /descricao detalhada/);
  const iId = col(/^id$/, /^id bling$/);
  if (iDesc < 0) throw new Error('Cabeçalho "Descrição" (ou "Nome") não encontrado no CSV.');
  const depPadrao = await prisma.deposito.findFirst({ where: { padrao: true } });
  for (const l of linhas) {
    const nome = (l[iDesc] || '').trim();
    if (!nome) {
      r.ignorados += 1;
      continue;
    }
    try {
      const codigo = iCod >= 0 ? l[iCod]?.trim() || null : null;
      const tipo = iTipo >= 0 && /^s/i.test(l[iTipo] || '') ? 'S' : 'P';
      let categoriaId: number | null = null;
      if (iCat >= 0 && l[iCat]?.trim()) {
        const nomeCat = l[iCat].trim().split('>').pop()!.trim();
        const cat = (await prisma.categoriaProduto.findFirst({ where: { nome: nomeCat } })) || (await prisma.categoriaProduto.create({ data: { nome: nomeCat } }));
        categoriaId = cat.id;
      }
      const dados = {
        nome,
        tipo,
        preco: numBr(l[iPreco]),
        precoCusto: iCusto >= 0 ? numBr(l[iCusto]) : 0,
        ncm: iNcm >= 0 ? somenteDigitos(l[iNcm]) || null : null,
        cest: iCest >= 0 ? somenteDigitos(l[iCest]) || null : null,
        gtin: iGtin >= 0 ? somenteDigitos(l[iGtin]) || null : null,
        unidade: iUn >= 0 ? l[iUn]?.trim().toUpperCase() || 'UN' : 'UN',
        estoqueMinimo: iMin >= 0 ? numBr(l[iMin]) : 0,
        marca: iMarca >= 0 ? l[iMarca]?.trim() || null : null,
        categoriaId,
        ativo: iSit >= 0 ? !/^i/i.test(l[iSit] || '') : true,
        origem: iOrig >= 0 ? Number(somenteDigitos(l[iOrig]).slice(0, 1) || 0) : 0,
        peso: iPeso >= 0 ? numBr(l[iPeso]) || null : null,
        descricaoCurta: iCurta >= 0 ? l[iCurta]?.trim() || null : null,
        descricaoDetalhada: iLonga >= 0 ? l[iLonga]?.trim() || null : null,
        controlaEstoque: tipo === 'P',
      };
      const blingId = iId >= 0 && l[iId]?.trim() ? l[iId].trim() : null;
      let existente = blingId ? await prisma.produto.findUnique({ where: { blingId } }) : null;
      if (!existente && codigo) existente = await prisma.produto.findUnique({ where: { codigo } });
      let prod;
      if (existente) {
        prod = await prisma.produto.update({ where: { id: existente.id }, data: { ...dados, blingId: existente.blingId || blingId, codigo: existente.codigo || codigo } });
        r.atualizados += 1;
      } else {
        prod = await prisma.produto.create({ data: { ...dados, blingId, codigo } });
        r.importados += 1;
      }
      if (iEst >= 0 && tipo === 'P' && depPadrao && l[iEst]?.trim()) {
        const saldo = numBr(l[iEst]);
        const atual = await prisma.estoqueSaldo.findUnique({ where: { produtoId_depositoId: { produtoId: prod.id, depositoId: depPadrao.id } } });
        const anterior = atual?.saldo ?? 0;
        if (!atual || Math.abs(anterior - saldo) > 0.0001) {
          await prisma.estoqueSaldo.upsert({ where: { produtoId_depositoId: { produtoId: prod.id, depositoId: depPadrao.id } }, create: { produtoId: prod.id, depositoId: depPadrao.id, saldo }, update: { saldo } });
          await prisma.movimentoEstoque.create({ data: { produtoId: prod.id, depositoId: depPadrao.id, tipo: 'AJUSTE', quantidade: arredondar(saldo - anterior, 4), custoUnitario: dados.precoCusto, saldoAnterior: anterior, saldoPosterior: saldo, origemTipo: 'IMPORTACAO', observacao: 'Saldo importado de CSV (Bling)' } });
        }
      }
    } catch (e: any) {
      r.erros += 1;
      if (r.detalhes.length < 50) r.detalhes.push(`${nome}: ${e.message}`);
    }
  }
  return r;
}
