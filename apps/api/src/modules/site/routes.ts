/**
 * PORTA DO SITE (www.balao.info) → MEU BLING.
 *
 * Pedido do Thiago (22/10/2026): o PDV do site (/pdv) manda as vendas para o
 * /sistema e não mais para o Bling; e os produtos do sistema são os do site.
 *
 * Quem chama é o servidor do site (Vercel), nunca o navegador: todas as rotas
 * /api/v1/integracoes/site/* exigem `Authorization: Bearer <SITE_CHAVE_INTEGRACAO>`
 * (variável de ambiente da VPS, a mesma cadastrada como MEU_BLING_CHAVE na Vercel).
 *
 *   GET  /integracoes/site/status                 a ligação está de pé? (+ última sincronização)
 *   GET  /integracoes/site/vendedores             vendedores ativos
 *   GET  /integracoes/site/clientes?documento=    cliente pelo CPF/CNPJ
 *   POST /integracoes/site/vendas                 nova venda do balcão (idempotente pelo id do PDV)
 *   GET  /integracoes/site/vendas?dia=AAAA-MM-DD  vendas do dia (todas as origens)
 *   GET  /integracoes/site/vendas/:id             uma venda (comprovante)
 *   POST /integracoes/site/vendas/:id/nfe         gera e transmite a NF-e (modelo 55)
 *   POST /integracoes/site/notas/:id/consultar    confere a nota na SEFAZ
 *   GET  /integracoes/site/notas/:id/danfe        PDF do DANFE
 *
 * E, para a tela (usuário logado, ADMIN/GERENTE):
 *   GET  /site/catalogo                           estado da sincronização dos produtos
 *   POST /site/catalogo/sincronizar               sincroniza agora
 *   POST /site/catalogo/desativar-fora-do-site    desativa os produtos que não são do site
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar, somenteDigitos } from '../../lib/util.js';
import { mudarSituacao } from '../../core/situacoes.js';
import { registrarServico } from '../../core/servicos.js';
import { criarVenda, gerarNfeDaVenda } from '../vendas/service.js';
import type { VendaInput } from '../vendas/schemas.js';
import * as fiscal from '../../integracoes/fiscal/service.js';
import { mensagemPendencias } from '../comum/nfe-checagem.js';
import {
  INTERVALO_SINCRONIZACAO_MS,
  camposDoSite,
  codigoDoSite,
  desativarForaDoSite,
  estadoDaSincronizacao,
  produtosForaDoSite,
  sincronizarCatalogo,
  ultimaSincronizacaoGravada,
} from './catalogo.js';

// ---------------------------------------------------------------- chave

export function chaveDoSite(): string {
  return (process.env.SITE_CHAVE_INTEGRACAO || '').trim();
}

export function chaveConfere(recebida: string | null | undefined, esperada = chaveDoSite()): boolean {
  if (!esperada || esperada.length < 24 || !recebida) return false;
  const a = crypto.createHash('sha256').update(recebida).digest();
  const b = crypto.createHash('sha256').update(esperada).digest();
  return crypto.timingSafeEqual(a, b);
}

async function exigirChave(req: FastifyRequest, reply: FastifyReply) {
  if (!chaveDoSite()) {
    return reply.code(503).send({
      erro: 'A ligação com o site ainda não foi configurada: falta SITE_CHAVE_INTEGRACAO no /etc/meu-bling.env da VPS (rode o deploy de novo, ele cria a chave).',
      code: 'SITE_SEM_CHAVE',
    });
  }
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!chaveConfere(m?.[1]?.trim())) {
    return reply.code(401).send({ erro: 'Chave do site inválida: confira MEU_BLING_CHAVE na Vercel (tem de ser igual a SITE_CHAVE_INTEGRACAO da VPS).', code: 'SITE_CHAVE_INVALIDA' });
  }
}

// ---------------------------------------------------------------- formatos

const FORMAS = ['pix', 'dinheiro', 'credito', 'debito', 'boleto', 'outro'] as const;
type FormaDoPdv = (typeof FORMAS)[number];
const TIPO_DA_FORMA: Record<FormaDoPdv, string[]> = {
  pix: ['PIX'],
  dinheiro: ['DINHEIRO'],
  credito: ['CARTAO_CREDITO'],
  debito: ['CARTAO_DEBITO'],
  boleto: ['BOLETO'],
  outro: ['OUTRO', 'TRANSFERENCIA'],
};

const texto = (max: number) => z.string().trim().max(max).optional().default('');

const clienteSchema = z.object({
  nome: texto(120),
  documento: texto(20),
  email: texto(120),
  telefone: texto(20),
  cep: texto(10),
  endereco: texto(120),
  numero: texto(20),
  complemento: texto(60),
  bairro: texto(60),
  cidade: texto(60),
  uf: texto(2),
  /** id do contato no sistema, quando o balcão já achou o cliente */
  sistemaId: z.coerce.number().int().positive().nullable().optional(),
});
type ClienteDoPdv = z.infer<typeof clienteSchema>;

const novaVendaSchema = z.object({
  /** id da venda no PDV (PDV-AAMMDD-XXXX): torna a chamada idempotente */
  pdvId: z.string().trim().min(6).max(40),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  operador: texto(60),
  vendedorId: z.coerce.number().int().positive().nullable().optional(),
  cliente: clienteSchema,
  itens: z
    .array(
      z.object({
        /** id do produto no site; vazio = item avulso digitado no balcão */
        siteId: z.string().trim().max(80).nullable().optional(),
        nome: z.string().trim().min(1).max(250),
        foto: z.string().trim().max(1000).nullable().optional(),
        quantidade: z.coerce.number().positive(),
        valor: z.coerce.number().positive(),
      }),
    )
    .min(1)
    .max(80),
  descontoEmReais: z.coerce.number().min(0).default(0),
  pagamentos: z
    .array(z.object({ forma: z.enum(FORMAS), valor: z.coerce.number().positive(), parcelas: z.coerce.number().int().min(1).max(24).nullable().optional() }))
    .min(1)
    .max(6),
  observacoes: texto(1000),
  observacoesInternas: texto(1000),
});
type NovaVenda = z.infer<typeof novaVendaSchema>;

/** O dia "AAAA-MM-DD" ao meio-dia no relógio da loja (o container roda em America/Sao_Paulo). */
function meioDiaDe(dia: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(a, m - 1, d, 12, 0, 0, 0);
}
function limitesDoDia(dia: string) {
  const [a, m, d] = dia.split('-').map(Number);
  return { gte: new Date(a, m - 1, d, 0, 0, 0, 0), lte: new Date(a, m - 1, d, 23, 59, 59, 999) };
}

type NotaResumo = { id: number; numero: number; serie: number; modelo: number; situacao: string; chave: string | null; motivo: string | null; cStat: string | null; autorizadaEm: string | null };

function resumoDaNota(n: { id: number; numero: number; serie: number; modelo: number; situacao: string; chave: string | null; motivo?: string | null; cStat?: string | null; dataAutorizacao?: Date | null } | null | undefined): NotaResumo | null {
  if (!n) return null;
  return {
    id: n.id,
    numero: n.numero,
    serie: n.serie,
    modelo: n.modelo,
    situacao: n.situacao,
    chave: n.chave,
    motivo: n.motivo ?? null,
    cStat: n.cStat ?? null,
    autorizadaEm: n.dataAutorizacao ? n.dataAutorizacao.toISOString() : null,
  };
}

const includeVenda = {
  contato: true,
  vendedor: { select: { id: true, nome: true } },
  situacao: { select: { id: true, nome: true, final: true, cancelamento: true } },
  nota: { select: { id: true, numero: true, serie: true, modelo: true, situacao: true, chave: true, motivo: true, cStat: true, dataAutorizacao: true } },
  itens: { orderBy: { ordem: 'asc' as const }, include: { produto: { select: { id: true, siteId: true, imagemUrl: true, prontaEntrega: true } } } },
  parcelas: { orderBy: { numero: 'asc' as const }, include: { formaPagamento: { select: { id: true, nome: true, tipo: true } } } },
} as const;

async function vendaParaSite(id: number) {
  const v = await prisma.venda.findUnique({ where: { id }, include: includeVenda });
  if (!v || v.tipo !== 'PEDIDO') throw new NotFound('Venda');
  const desconto = v.descontoTipo === 'PERCENTUAL' ? arredondar(v.totalProdutos * (v.descontoValor / 100)) : v.descontoValor;
  return {
    id: v.id,
    numero: v.numero,
    data: v.data.toISOString(),
    criadaEm: v.criadoEm.toISOString(),
    origem: v.origem,
    pdvId: v.numeroPedidoLoja,
    situacao: v.situacao,
    cancelada: v.situacao.cancelamento,
    vendedor: v.vendedor,
    cliente: clienteDoContato(v.contato),
    itens: v.itens.map((i) => ({
      nome: i.descricao,
      codigo: i.codigo,
      quantidade: i.quantidade,
      valor: i.valorUnitario,
      total: i.total,
      siteId: i.produto?.siteId ?? null,
      foto: i.produto?.imagemUrl ?? null,
    })),
    totalProdutos: v.totalProdutos,
    desconto,
    total: v.total,
    pagamentos: v.parcelas.map((p) => ({ forma: p.formaPagamento?.nome ?? 'Pagamento', tipo: p.formaPagamento?.tipo ?? null, valor: p.valor, observacao: p.observacoes })),
    observacoes: v.observacoes,
    nota: resumoDaNota(v.nota),
  };
}

// ---------------------------------------------------------------- clientes

function clienteDoContato(c: {
  id: number; nome: string; documento: string | null; email: string | null; celular: string | null; telefone: string | null; cep: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; municipio: string | null; uf: string | null;
}) {
  return {
    sistemaId: c.id,
    nome: c.nome,
    documento: somenteDigitos(c.documento),
    email: c.email || '',
    telefone: somenteDigitos(c.celular || c.telefone),
    cep: somenteDigitos(c.cep),
    endereco: c.logradouro || '',
    numero: c.numero || '',
    complemento: c.complemento || '',
    bairro: c.bairro || '',
    cidade: c.municipio || '',
    uf: (c.uf || '').toUpperCase(),
  };
}

/** Contato pelo documento — ativo primeiro; aceita o documento gravado com ou sem máscara. */
async function contatoPorDocumento(doc: string) {
  if (doc.length !== 11 && doc.length !== 14) return null;
  const mascarado = doc.length === 11 ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  const achados = await prisma.contato.findMany({ where: { documento: { in: [doc, mascarado] } }, orderBy: [{ ativo: 'desc' }, { id: 'asc' }], take: 5 });
  return achados.find((c) => c.ativo) ?? achados[0] ?? null;
}

function dadosDoContato(c: ClienteDoPdv) {
  const doc = somenteDigitos(c.documento);
  const tel = somenteDigitos(c.telefone);
  const celular = tel ? (tel.length <= 11 ? `55${tel}` : tel) : null;
  const d: Record<string, unknown> = {
    nome: c.nome || 'Consumidor final',
    tipoPessoa: doc.length === 14 ? 'J' : 'F',
    ativo: true,
  };
  if (doc) d.documento = doc;
  if (c.email) d.email = c.email;
  if (celular) d.celular = celular;
  if (c.cep || c.endereco) {
    Object.assign(d, {
      cep: somenteDigitos(c.cep) || null,
      logradouro: c.endereco || null,
      numero: c.numero || null,
      complemento: c.complemento || null,
      bairro: c.bairro || null,
      municipio: c.cidade || null,
      uf: c.uf ? c.uf.toUpperCase() : null,
    });
  }
  return d;
}

/** Código IBGE (e o que faltar do endereço) pelo CEP, no ViaCEP — a NF-e exige o código da cidade. */
async function ibgePeloCep(cep: string): Promise<{ codigoMunicipio: string; municipio: string; uf: string; bairro: string; logradouro: string } | null> {
  const c = somenteDigitos(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${c}/json/`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = (await r.json()) as Record<string, string | boolean>;
    if (j.erro || !j.ibge) return null;
    return { codigoMunicipio: String(j.ibge), municipio: String(j.localidade || ''), uf: String(j.uf || ''), bairro: String(j.bairro || ''), logradouro: String(j.logradouro || '') };
  } catch {
    return null;
  }
}

/** Preenche o código IBGE do contato pelo CEP quando falta (ou quando o CEP mudou). */
async function completarIbge(contatoId: number) {
  const c = await prisma.contato.findUnique({ where: { id: contatoId }, select: { cep: true, codigoMunicipio: true, municipio: true, uf: true, bairro: true, logradouro: true } });
  if (!c?.cep || somenteDigitos(c.codigoMunicipio).length === 7) return;
  const v = await ibgePeloCep(c.cep);
  if (!v) return;
  await prisma.contato.update({
    where: { id: contatoId },
    data: { codigoMunicipio: v.codigoMunicipio, municipio: c.municipio || v.municipio, uf: c.uf || v.uf, bairro: c.bairro || v.bairro || null, logradouro: c.logradouro || v.logradouro || null },
  });
}

/** O contato do cliente: acha pelo documento (ou id), cria se não existir e completa o endereço. */
async function contatoParaVenda(c: ClienteDoPdv): Promise<number> {
  const id = await acharOuCriarContato(c);
  if (somenteDigitos(c.cep)) await completarIbge(id).catch(() => undefined);
  return id;
}

async function acharOuCriarContato(c: ClienteDoPdv): Promise<number> {
  const doc = somenteDigitos(c.documento);
  if (doc) {
    const existente = (c.sistemaId ? await prisma.contato.findUnique({ where: { id: c.sistemaId } }) : null) ?? (await contatoPorDocumento(doc));
    if (existente && somenteDigitos(existente.documento) === doc) {
      const d = dadosDoContato({ ...c, nome: c.nome || existente.nome });
      if (d.cep && d.cep !== somenteDigitos(existente.cep)) d.codigoMunicipio = null; // CEP novo: o código IBGE é refeito
      // o balcão só completa/atualiza: nunca apaga o que o cadastro já tem
      for (const k of Object.keys(d)) if ((d[k] === null || d[k] === '') && k !== 'codigoMunicipio') delete d[k];
      await prisma.contato.update({ where: { id: existente.id }, data: d });
      return existente.id;
    }
    const novo = await prisma.contato.create({ data: { ...(dadosDoContato(c) as any), tipo: 'CLIENTE' } });
    return novo.id;
  }
  // sem documento, com nome e telefone: acha ou cria pelo celular
  const tel = somenteDigitos(c.telefone);
  if (c.nome && tel.length >= 10) {
    const celular = tel.length <= 11 ? `55${tel}` : tel;
    const achado = await prisma.contato.findFirst({ where: { OR: [{ celular }, { celular: tel }, { telefone: tel }], ativo: true }, orderBy: { id: 'asc' } });
    if (achado) return achado.id;
    const novo = await prisma.contato.create({ data: { ...(dadosDoContato(c) as any), tipo: 'CLIENTE' } });
    return novo.id;
  }
  return consumidorFinal();
}

async function consumidorFinal(): Promise<number> {
  const achado = await prisma.contato.findFirst({ where: { nome: { in: ['Consumidor Final', 'Consumidor final', 'CONSUMIDOR FINAL'] }, OR: [{ documento: null }, { documento: '' }] }, orderBy: { id: 'asc' } });
  if (achado) {
    if (!achado.ativo) await prisma.contato.update({ where: { id: achado.id }, data: { ativo: true } });
    return achado.id;
  }
  return (await prisma.contato.create({ data: { nome: 'Consumidor Final', tipoPessoa: 'F', tipo: 'CLIENTE' } })).id;
}

// ---------------------------------------------------------------- itens e pagamentos

/** Produto do sistema para o item do site; se a sincronização ainda não trouxe, cria com o que o balcão mandou. */
async function produtoDoItem(i: NovaVenda['itens'][number]): Promise<number | null> {
  const siteId = (i.siteId || '').trim();
  if (!siteId || siteId.startsWith('avulso')) return null;
  const achado = await prisma.produto.findFirst({ where: { OR: [{ siteId }, { codigo: codigoDoSite(siteId) }] }, select: { id: true, siteId: true } });
  if (achado) {
    if (!achado.siteId) await prisma.produto.update({ where: { id: achado.id }, data: { siteId } }).catch(() => undefined);
    return achado.id;
  }
  const c = camposDoSite({ id: siteId, name: i.nome, price: i.valor, image: i.foto || undefined });
  const ocupado = await prisma.produto.findUnique({ where: { codigo: codigoDoSite(siteId) }, select: { id: true } });
  const novo = await prisma.produto.create({
    data: { tipo: 'P', nome: c.nome, preco: c.preco, imagemUrl: c.imagemUrl, siteId, codigo: ocupado ? null : codigoDoSite(siteId), siteSincronizadoEm: new Date() },
    select: { id: true },
  });
  return novo.id;
}

async function formaPagamentoId(forma: FormaDoPdv): Promise<number | null> {
  const ativas = await prisma.formaPagamento.findMany({ where: { ativo: true }, orderBy: { id: 'asc' } });
  const alvo = TIPO_DA_FORMA[forma];
  return (ativas.find((f) => alvo.includes(f.tipo)) ?? ativas.find((f) => f.tipo === 'OUTRO') ?? ativas[0])?.id ?? null;
}

async function situacaoFechada() {
  const lista = await prisma.situacao.findMany({ where: { modulo: 'VENDA', ativo: true }, orderBy: { ordem: 'asc' } });
  return lista.find((s) => s.nome === 'Fechada') ?? lista.find((s) => s.final && !s.cancelamento && /atendid|fechad/i.test(s.nome)) ?? lista.find((s) => s.final && !s.cancelamento) ?? null;
}

// ---------------------------------------------------------------- criar a venda

const emAndamento = new Map<string, Promise<number>>();

export async function registrarVendaDoPdv(entrada: NovaVenda): Promise<{ id: number; criada: boolean }> {
  const ja = await prisma.venda.findFirst({ where: { tipo: 'PEDIDO', numeroPedidoLoja: entrada.pdvId }, select: { id: true } });
  if (ja) return { id: ja.id, criada: false };
  // duas chamadas iguais ao mesmo tempo (o balcão e a volta automática): a segunda espera a primeira
  const correndo = emAndamento.get(entrada.pdvId);
  if (correndo) return { id: await correndo, criada: false };
  const trabalho = criarDoPdv(entrada);
  emAndamento.set(entrada.pdvId, trabalho);
  try {
    return { id: await trabalho, criada: true };
  } finally {
    emAndamento.delete(entrada.pdvId);
  }
}

async function criarDoPdv(e: NovaVenda): Promise<number> {
  if (e.vendedorId) {
    const vend = await prisma.vendedor.findUnique({ where: { id: e.vendedorId } });
    if (!vend) throw new AppError(`O vendedor escolhido no PDV (${e.vendedorId}) não existe no sistema. Atualize a tela do PDV e escolha de novo.`, 422, 'VENDEDOR');
  }
  const contatoId = await contatoParaVenda(e.cliente);
  const itens = [];
  for (const i of e.itens) {
    itens.push({
      produtoId: await produtoDoItem(i),
      descricao: i.nome,
      quantidade: i.quantidade,
      valorUnitario: arredondar(i.valor),
      desconto: 0,
    });
  }
  const data = meioDiaDe(e.data);
  const parcelas = [];
  for (const p of e.pagamentos) {
    parcelas.push({
      dataVencimento: data,
      valor: arredondar(p.valor),
      formaPagamentoId: await formaPagamentoId(p.forma),
      observacoes: p.forma === 'credito' && p.parcelas && p.parcelas > 1 ? `${p.parcelas}x no cartão` : null,
    });
  }
  const body: VendaInput = {
    tipo: 'PEDIDO',
    contatoId,
    vendedorId: e.vendedorId ?? null,
    data,
    dataSaida: data,
    origem: 'BALCAO',
    numeroPedidoLoja: e.pdvId,
    observacoes: e.observacoes || null,
    observacoesInternas: [e.observacoesInternas, e.operador ? `Operador do PDV: ${e.operador}` : ''].filter(Boolean).join('\n') || null,
    descontoTipo: 'REAL',
    descontoValor: arredondar(e.descontoEmReais),
    frete: 0,
    outrasDespesas: 0,
    fretePorConta: 9,
    quantidadeVolumes: 0,
    pesoBruto: 0,
    itens: itens as VendaInput['itens'],
    parcelas: parcelas as VendaInput['parcelas'],
  } as VendaInput;

  const venda = await criarVenda(body, null, `Venda do PDV do site (${e.pdvId})`);
  // venda de balcão é paga na hora: entra "Fechada" (lança estoque e contas, como o "Atendido" do Bling)
  const fechada = await situacaoFechada();
  if (fechada && fechada.id !== venda.situacaoId) {
    try {
      await mudarSituacao({ modulo: 'VENDA', entidadeId: venda.id, situacaoDestinoId: fechada.id, usuarioId: null, observacao: 'PDV do site: venda paga no balcão', forcar: true });
    } catch (err) {
      // a venda existe; a situação pode ser ajustada na tela. Não perde a venda por isso.
      console.error('[site:pdv] venda criada mas não fechou:', (err as Error).message);
    }
  }
  return venda.id;
}

// ---------------------------------------------------------------- nota

/** Troca o cliente da venda (e das contas a receber dela) — só enquanto não há nota autorizada. */
async function trocarClienteDaVenda(vendaId: number, cliente: ClienteDoPdv) {
  const venda = await prisma.venda.findUnique({ where: { id: vendaId }, include: { nota: { select: { situacao: true } } } });
  if (!venda || venda.tipo !== 'PEDIDO') throw new NotFound('Venda');
  if (venda.nota && ['AUTORIZADA', 'PROCESSANDO'].includes(venda.nota.situacao)) return;
  const contatoId = await contatoParaVenda(cliente);
  if (contatoId === venda.contatoId) return;
  if (venda.notaId) {
    // a nota já criada calculou CFOP e consumidor final pelo cliente antigo: só troca se isso não muda
    const [antigo, novo] = await Promise.all([
      prisma.contato.findUnique({ where: { id: venda.contatoId }, select: { uf: true, tipoPessoa: true } }),
      prisma.contato.findUnique({ where: { id: contatoId }, select: { uf: true, tipoPessoa: true } }),
    ]);
    if ((antigo?.uf || '').toUpperCase() !== (novo?.uf || '').toUpperCase() || antigo?.tipoPessoa !== novo?.tipoPessoa) {
      throw new AppError(
        `A venda nº ${venda.numero} já tem uma nota criada para outro cliente (estado ou tipo de pessoa diferente). Abra a venda no /sistema, exclua a nota não autorizada e emita de novo.`,
        422,
        'NFE_OUTRO_CLIENTE',
      );
    }
  }
  await prisma.$transaction([
    prisma.venda.update({ where: { id: vendaId }, data: { contatoId } }),
    prisma.contaReceber.updateMany({ where: { origemTipo: 'VENDA', origemId: vendaId }, data: { contatoId } }),
    // nota ainda não transmitida (pendente/rejeitada/erro) sai com o cliente novo
    ...(venda.notaId ? [prisma.notaFiscal.update({ where: { id: venda.notaId }, data: { contatoId } })] : []),
  ]);
}

export async function emitirNotaDaVenda(vendaId: number) {
  let venda = await prisma.venda.findUnique({ where: { id: vendaId }, include: { nota: true } });
  if (!venda || venda.tipo !== 'PEDIDO') throw new NotFound('Venda');
  let nota = venda.nota && !['CANCELADA', 'INUTILIZADA', 'DENEGADA'].includes(venda.nota.situacao) ? venda.nota : null;
  if (!nota) {
    try {
      nota = await prisma.$transaction((tx) => gerarNfeDaVenda(tx, vendaId, 55, null));
    } catch (e) {
      if (e instanceof AppError && e.code === 'NFE_PENDENCIAS') {
        // o balcão precisa ler o que falta, em português
        throw new AppError(mensagemPendencias(e.detalhes as any), 422, 'NFE_PENDENCIAS', e.detalhes);
      }
      throw e;
    }
  }
  if (['PENDENTE', 'REJEITADA', 'ERRO'].includes(nota.situacao)) {
    try {
      await fiscal.transmitir(nota.id);
    } catch (e) {
      // a nota fica gravada com o motivo; o balcão mostra e pode tentar de novo
      console.error('[site:pdv] falha ao transmitir NF-e:', (e as Error).message);
    }
  }
  venda = await prisma.venda.findUnique({ where: { id: vendaId }, include: { nota: true } });
  return resumoDaNota(venda?.nota);
}

// ---------------------------------------------------------------- rotas

export default async function siteRoutes(app: FastifyInstance) {
  const comChave = { preHandler: exigirChave, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };

  app.get('/api/v1/integracoes/site/status', comChave, async () => {
    const [empresa, vendedores, produtosDoSite, ultima] = await Promise.all([
      prisma.empresa.findUnique({ where: { id: 1 }, select: { razaoSocial: true, nomeFantasia: true, cnpj: true } }).catch(() => null),
      prisma.vendedor.count({ where: { ativo: true } }),
      prisma.produto.count({ where: { siteId: { not: null }, ativo: true } }),
      ultimaSincronizacaoGravada(),
    ]);
    return { ok: true, hora: new Date().toISOString(), empresa, vendedores, produtosDoSite, ultimaSincronizacao: ultima?.fim ?? null };
  });

  app.get('/api/v1/integracoes/site/vendedores', comChave, async () => {
    const lista = await prisma.vendedor.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: 'asc' } });
    return { vendedores: lista };
  });

  app.get('/api/v1/integracoes/site/clientes', comChave, async (req) => {
    const doc = somenteDigitos(z.object({ documento: z.string().default('') }).parse(req.query).documento);
    if (doc.length !== 11 && doc.length !== 14) throw new AppError('CPF/CNPJ inválido.', 400, 'DOCUMENTO');
    const c = await contatoPorDocumento(doc);
    return { cliente: c ? clienteDoContato(c) : null };
  });

  app.post('/api/v1/integracoes/site/vendas', comChave, async (req, reply) => {
    const entrada = novaVendaSchema.parse(req.body);
    const { id, criada } = await registrarVendaDoPdv(entrada);
    if (criada) await auditar(req, 'Venda', id, 'CRIAR', { origem: 'PDV do site', pdvId: entrada.pdvId, operador: entrada.operador });
    return reply.code(criada ? 201 : 200).send({ venda: await vendaParaSite(id), criada });
  });

  app.get('/api/v1/integracoes/site/vendas', comChave, async (req) => {
    const q = z.object({ dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    const vendas = await prisma.venda.findMany({
      where: { tipo: 'PEDIDO', data: limitesDoDia(q.dia) },
      orderBy: { numero: 'desc' },
      take: 500,
      include: {
        contato: { select: { nome: true } },
        vendedor: { select: { id: true, nome: true } },
        situacao: { select: { id: true, nome: true, final: true, cancelamento: true } },
        nota: { select: { id: true, numero: true, serie: true, modelo: true, situacao: true, chave: true, motivo: true, cStat: true, dataAutorizacao: true } },
      },
    });
    return {
      dia: q.dia,
      vendas: vendas.map((v) => ({
        id: v.id,
        numero: v.numero,
        criadaEm: v.criadoEm.toISOString(),
        origem: v.origem,
        pdvId: v.numeroPedidoLoja,
        cliente: v.contato.nome,
        vendedor: v.vendedor,
        total: v.total,
        situacao: v.situacao,
        cancelada: v.situacao.cancelamento,
        nota: resumoDaNota(v.nota),
      })),
    };
  });

  app.get('/api/v1/integracoes/site/vendas/:id', comChave, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Venda inválida.', 400);
    return { venda: await vendaParaSite(id) };
  });

  app.post('/api/v1/integracoes/site/vendas/:id/nfe', comChave, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Venda inválida.', 400);
    // nota pedida depois da venda: o balcão manda o cliente (CPF/CNPJ e endereço) e ele passa a ser o da venda
    const corpo = z.object({ cliente: clienteSchema.optional() }).parse(req.body ?? {});
    if (corpo.cliente && somenteDigitos(corpo.cliente.documento)) await trocarClienteDaVenda(id, corpo.cliente);
    const nota = await emitirNotaDaVenda(id);
    await auditar(req, 'Venda', id, 'ACAO', { acao: 'gerarNfe', origem: 'PDV do site', notaId: nota?.id, situacao: nota?.situacao });
    return { nota };
  });

  app.post('/api/v1/integracoes/site/notas/:id/consultar', comChave, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const n = await prisma.notaFiscal.findUnique({ where: { id } });
    if (!n) throw new NotFound('Nota fiscal');
    if (n.situacao === 'PROCESSANDO' && n.chave) await fiscal.consultar(id).catch(() => undefined);
    if (['PENDENTE', 'ERRO'].includes(n.situacao) && !n.chave) await fiscal.transmitir(id).catch(() => undefined);
    return { nota: resumoDaNota(await prisma.notaFiscal.findUnique({ where: { id } })) };
  });

  app.get('/api/v1/integracoes/site/notas/:id/danfe', comChave, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const n = await prisma.notaFiscal.findUnique({ where: { id }, select: { id: true, situacao: true, numero: true } });
    if (!n) throw new NotFound('Nota fiscal');
    const { buffer } = await fiscal.gerarPdfDanfe(id);
    reply.header('Content-Disposition', `inline; filename="DANFE-${n.numero}.pdf"`);
    return reply.type('application/pdf').send(buffer);
  });

  // ---------------------------------------------------------------- tela: catálogo do site
  const gestao = { preHandler: app.exigirPerfil('ADMIN', 'GERENTE') };

  app.get('/api/v1/site/catalogo', async () => {
    const [estado, ultima, doSite, prontaEntrega, fora] = await Promise.all([
      Promise.resolve(estadoDaSincronizacao()),
      ultimaSincronizacaoGravada(),
      prisma.produto.count({ where: { siteId: { not: null }, ativo: true } }),
      prisma.produto.count({ where: { siteId: { not: null }, ativo: true, prontaEntrega: true } }),
      produtosForaDoSite(),
    ]);
    return { ...estado, ultimo: ultima, produtosDoSite: doSite, prontaEntrega, foraDoSite: fora, ligacaoPdv: Boolean(chaveDoSite()) };
  });

  app.post('/api/v1/site/catalogo/sincronizar', gestao, async (req) => {
    const r = await sincronizarCatalogo();
    await auditar(req, 'Produto', null, 'ACAO', { acao: 'site.sincronizar', criados: r.criados, atualizados: r.atualizados, desativados: r.desativados });
    return r;
  });

  app.post('/api/v1/site/catalogo/desativar-fora-do-site', { preHandler: app.exigirPerfil('ADMIN') }, async (req) => {
    const r = await desativarForaDoSite();
    await auditar(req, 'Produto', null, 'ACAO', { acao: 'site.desativarForaDoSite', ...r });
    return r;
  });
}

// sincroniza os produtos do site a cada 30 min (e 1 min depois de subir)
registrarServico('catalogo-do-site', (app) => {
  if (process.env.SITE_SINCRONIZAR === '0') return;
  const rodar = async () => {
    try {
      const r = await sincronizarCatalogo();
      app.log.info({ criados: r.criados, atualizados: r.atualizados, desativados: r.desativados, erros: r.erros.length }, '[site] catálogo sincronizado');
    } catch (e) {
      app.log.warn({ e: String((e as Error)?.message || e) }, '[site] falha ao sincronizar o catálogo');
    }
  };
  setTimeout(rodar, 60_000).unref();
  setInterval(rodar, INTERVALO_SINCRONIZACAO_MS).unref();
});
