/**
 * PRODUTOS DO SITE → MEU BLING.
 *
 * Pedido do Thiago (22/10/2026): os produtos do sistema são os do site
 * www.balao.info, com foto e o selo de "pronta entrega" quando for o caso.
 *
 * A fonte é o espelho do catálogo que o CRM já mantém nesta mesma VPS
 * (`/api/crm/catalogo`), e não o MySQL da Hostinger: o banco do site tem cota
 * de conexões por hora e a sincronização não pode derrubar a loja.
 *
 * O que vem do site (e é sobrescrito a cada volta): nome, preço à vista (Pix),
 * preço no cartão, custo, foto, marca, categoria, fornecedor e disponibilidade.
 * O que é do sistema e nunca é tocado: dados fiscais (NCM, CSOSN, CFOP…),
 * controle de estoque, saldos, mínimo e garantia.
 *
 * Produto que saiu do site fica inativo (não aparece na busca da venda), mas
 * continua nas vendas antigas. Se o espelho vier pequeno demais (falha do CRM),
 * nada é desativado.
 */
import { prisma } from '../../lib/prisma.js';
import { arredondar } from '../../lib/util.js';

export const URL_CATALOGO = (process.env.SITE_CATALOGO_URL || 'https://srv1963897.hstgr.cloud/api/crm/catalogo').trim();
/** Abaixo disso o espelho veio incompleto: sincroniza, mas não desativa ninguém. */
const MINIMO_PARA_DESATIVAR = 1000;
const INTERVALO_MS = 30 * 60 * 1000;
const PREFIXO_CODIGO = 'SITE-';

export interface ProdutoDoSite {
  id: string;
  name: string;
  price?: string | number;
  price_card?: string | number;
  cost?: number | string;
  image?: string;
  image_urls?: string[];
  category?: string;
  brand?: string;
  slug?: string;
  availability?: string;
  supplier?: string;
  description?: string;
}

export interface ResultadoSincronizacao {
  inicio: string;
  fim: string;
  recebidos: number;
  validos: number;
  criados: number;
  atualizados: number;
  iguais: number;
  desativados: number;
  reativados: number;
  prontaEntrega: number;
  erros: string[];
}

/** "1.234,56" | "R$ 1.234,56" | "10x de R$ 1,00" (ignora) | 12.5 → número. */
export function lerPreco(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? arredondar(v) : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const limpo = s.replace(/[^\d,.-]/g, '');
  if (!limpo) return 0;
  // formato brasileiro: ponto de milhar, vírgula decimal
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo);
  return Number.isFinite(n) && n > 0 ? arredondar(n) : 0;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function ehProntaEntrega(disponibilidade: string | null | undefined): boolean {
  return semAcento(disponibilidade || '') === 'pronta entrega';
}

export function codigoDoSite(siteId: string): string {
  return `${PREFIXO_CODIGO}${siteId}`.slice(0, 60);
}

/** Campos do produto do sistema que vêm do site. */
export function camposDoSite(p: ProdutoDoSite) {
  const foto = String(p.image || p.image_urls?.[0] || '').trim();
  const preco = lerPreco(p.price);
  const cartao = lerPreco(p.price_card);
  const custo = lerPreco(p.cost);
  const disponibilidade = String(p.availability || '').trim() || null;
  return {
    nome: String(p.name || '').trim().slice(0, 250),
    preco,
    precoCartao: cartao > 0 ? cartao : null,
    custo,
    imagemUrl: /^https?:\/\//i.test(foto) ? foto.slice(0, 1000) : null,
    marca: p.brand ? String(p.brand).trim().slice(0, 80) || null : null,
    siteSlug: p.slug ? String(p.slug).trim().slice(0, 250) : null,
    disponibilidade,
    prontaEntrega: ehProntaEntrega(disponibilidade),
    fornecedor: p.supplier ? String(p.supplier).trim().slice(0, 120) || null : null,
    categoria: String(p.category || '').trim(),
  };
}

// ---------------------------------------------------------------- leitura do espelho

export async function lerCatalogoDoSite(url = URL_CATALOGO): Promise<ProdutoDoSite[]> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`O catálogo do site respondeu ${r.status} em ${url}`);
  const j = (await r.json()) as { produtos?: unknown };
  const lista = Array.isArray(j?.produtos) ? (j.produtos as ProdutoDoSite[]) : [];
  return lista.filter((p) => p && typeof p.id === 'string' && p.id.trim() && typeof p.name === 'string');
}

// ---------------------------------------------------------------- categorias "A/B/C"

async function categoriaPorCaminho(caminho: string, cache: Map<string, number>): Promise<number | null> {
  const partes = caminho.split('/').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  if (!partes.length) return null;
  let paiId: number | null = null;
  let chave = '';
  for (const nome of partes) {
    chave = chave ? `${chave}/${nome}` : nome;
    const emCache = cache.get(chave);
    if (emCache) {
      paiId = emCache;
      continue;
    }
    const achada: { id: number } | null = await prisma.categoriaProduto.findFirst({ where: { nome, paiId }, select: { id: true } });
    const id: number = achada ? achada.id : (await prisma.categoriaProduto.create({ data: { nome, paiId } })).id;
    cache.set(chave, id);
    paiId = id;
  }
  return paiId;
}

// ---------------------------------------------------------------- sincronização

let rodando: Promise<ResultadoSincronizacao> | null = null;
let ultimo: ResultadoSincronizacao | null = null;
let ultimoErro: { em: string; mensagem: string } | null = null;

export function estadoDaSincronizacao() {
  return { rodando: Boolean(rodando), ultimo, ultimoErro, url: URL_CATALOGO, intervaloMinutos: INTERVALO_MS / 60_000 };
}

/** Uma volta por vez; quem chamar durante a volta recebe o mesmo resultado. */
export function sincronizarCatalogo(opcoes: { produtos?: ProdutoDoSite[] } = {}): Promise<ResultadoSincronizacao> {
  if (rodando) return rodando;
  rodando = executar(opcoes)
    .then(async (r) => {
      ultimo = r;
      ultimoErro = null;
      await prisma.configuracao
        .upsert({ where: { chave: 'site.ultimaSincronizacao' }, create: { chave: 'site.ultimaSincronizacao', valor: JSON.stringify(r) }, update: { valor: JSON.stringify(r) } })
        .catch(() => undefined);
      return r;
    })
    .catch((e) => {
      ultimoErro = { em: new Date().toISOString(), mensagem: String((e as Error)?.message || e) };
      throw e;
    })
    .finally(() => {
      rodando = null;
    });
  return rodando;
}

export async function ultimaSincronizacaoGravada(): Promise<ResultadoSincronizacao | null> {
  if (ultimo) return ultimo;
  const c = await prisma.configuracao.findUnique({ where: { chave: 'site.ultimaSincronizacao' } }).catch(() => null);
  try {
    return c?.valor ? (JSON.parse(c.valor) as ResultadoSincronizacao) : null;
  } catch {
    return null;
  }
}

async function executar(opcoes: { produtos?: ProdutoDoSite[] }): Promise<ResultadoSincronizacao> {
  const inicio = new Date();
  const recebidos = opcoes.produtos ?? (await lerCatalogoDoSite());
  const r: ResultadoSincronizacao = {
    inicio: inicio.toISOString(),
    fim: '',
    recebidos: recebidos.length,
    validos: 0,
    criados: 0,
    atualizados: 0,
    iguais: 0,
    desativados: 0,
    reativados: 0,
    prontaEntrega: 0,
    erros: [],
  };

  // um id do site aparece uma vez só (o último vence)
  const porId = new Map<string, ProdutoDoSite>();
  for (const p of recebidos) porId.set(p.id.trim(), p);

  const existentes = await prisma.produto.findMany({
    where: { OR: [{ siteId: { not: null } }, { codigo: { startsWith: PREFIXO_CODIGO } }] },
    select: {
      id: true, siteId: true, codigo: true, nome: true, preco: true, precoCartao: true, precoCusto: true, imagemUrl: true, marca: true,
      siteSlug: true, disponibilidade: true, prontaEntrega: true, fornecedor: true, categoriaId: true, ativo: true,
    },
  });
  const porSiteId = new Map(existentes.filter((e) => e.siteId).map((e) => [e.siteId!, e]));
  const porCodigo = new Map(existentes.filter((e) => e.codigo).map((e) => [e.codigo!, e]));
  const cacheCategorias = new Map<string, number>();
  const vistos = new Set<number>();

  // Gravação em lotes curtos: produto novo entra por createMany (uma instrução por
  // lote) e alteração vai uma a uma, com pausa entre os lotes. As telas usam
  // transações com prazo de 5 s; um commit longo da sincronização fazia as vendas
  // feitas nesse meio-tempo darem "Socket timeout".
  type Op = { siteId: string; tipo: 'criar' | 'atualizar'; id?: number; data: Record<string, unknown> };
  let lote: Op[] = [];
  const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const anotarErro = (siteId: string, e: unknown) => {
    if (r.erros.length < 20) r.erros.push(`${siteId}: ${String((e as Error)?.message || e).replace(/\s+/g, ' ').slice(-200)}`);
  };
  const gravarLote = async () => {
    if (!lote.length) return;
    const ops = lote;
    lote = [];
    const novos = ops.filter((o) => o.tipo === 'criar');
    if (novos.length) {
      try {
        await prisma.produto.createMany({ data: novos.map((o) => o.data as any) });
      } catch {
        for (const o of novos) await prisma.produto.create({ data: o.data as any }).catch((e) => anotarErro(o.siteId, e));
      }
      const criados = await prisma.produto.findMany({ where: { siteId: { in: novos.map((o) => o.siteId) } }, select: { id: true } });
      criados.forEach((c) => vistos.add(c.id));
      r.criados += criados.length;
    }
    for (const o of ops.filter((x) => x.tipo === 'atualizar')) {
      try {
        await prisma.produto.update({ where: { id: o.id! }, data: o.data as any, select: { id: true } });
        r.atualizados++;
      } catch (e) {
        anotarErro(o.siteId, e);
      }
    }
    await pausa(120); // deixa as vendas passarem entre um lote e outro
  };

  for (const [siteId, p] of porId) {
    const c = camposDoSite(p);
    if (!c.nome || c.preco <= 0) continue; // sem preço o site também não vende
    r.validos++;
    if (c.prontaEntrega) r.prontaEntrega++;
    let categoriaId: number | null = null;
    try {
      categoriaId = c.categoria ? await categoriaPorCaminho(c.categoria, cacheCategorias) : null;
    } catch {
      categoriaId = null;
    }
    const dados = {
      siteId,
      nome: c.nome,
      preco: c.preco,
      precoCartao: c.precoCartao,
      imagemUrl: c.imagemUrl,
      marca: c.marca,
      siteSlug: c.siteSlug,
      disponibilidade: c.disponibilidade,
      prontaEntrega: c.prontaEntrega,
      fornecedor: c.fornecedor,
      categoriaId,
      ativo: true,
      ...(c.custo > 0 ? { precoCusto: c.custo } : {}),
    };
    const atual = porSiteId.get(siteId) ?? porCodigo.get(codigoDoSite(siteId));
    if (atual) {
      vistos.add(atual.id);
      const mudou =
        atual.siteId !== siteId ||
        atual.nome !== dados.nome ||
        atual.preco !== dados.preco ||
        (atual.precoCartao ?? null) !== dados.precoCartao ||
        (c.custo > 0 && atual.precoCusto !== c.custo) ||
        (atual.imagemUrl ?? null) !== dados.imagemUrl ||
        (atual.marca ?? null) !== dados.marca ||
        (atual.siteSlug ?? null) !== dados.siteSlug ||
        (atual.disponibilidade ?? null) !== dados.disponibilidade ||
        atual.prontaEntrega !== dados.prontaEntrega ||
        (atual.fornecedor ?? null) !== dados.fornecedor ||
        (atual.categoriaId ?? null) !== categoriaId ||
        !atual.ativo;
      if (!mudou) {
        r.iguais++;
        continue;
      }
      if (!atual.ativo) r.reativados++;
      lote.push({ siteId, tipo: 'atualizar', id: atual.id, data: { ...dados, siteSincronizadoEm: inicio } });
    } else {
      // todo produto com código SITE-… já está em `existentes`: o código está livre
      lote.push({ siteId, tipo: 'criar', data: { ...dados, tipo: 'P', unidade: 'UN', codigo: codigoDoSite(siteId), siteSincronizadoEm: inicio } });
    }
    if (lote.length >= 100 || lote.filter((o) => o.tipo === 'atualizar').length >= 20) await gravarLote();
  }
  await gravarLote();

  // saiu do site → inativo (só com um espelho completo nas mãos)
  if (r.validos >= MINIMO_PARA_DESATIVAR) {
    const sumiram = existentes.filter((e) => e.siteId && e.ativo && !vistos.has(e.id)).map((e) => e.id);
    for (let i = 0; i < sumiram.length; i += 500) {
      const lote = sumiram.slice(i, i + 500);
      const u = await prisma.produto.updateMany({ where: { id: { in: lote } }, data: { ativo: false, prontaEntrega: false, siteSincronizadoEm: inicio } });
      r.desativados += u.count;
    }
  } else if (porId.size > 0) {
    r.erros.push(`O catálogo veio com só ${r.validos} produtos válidos: nenhum produto foi desativado nesta volta.`);
  }

  r.fim = new Date().toISOString();
  return r;
}

/** Produtos que não são do site (vieram do Bling ou foram cadastrados à mão) e ainda estão ativos. */
export async function produtosForaDoSite() {
  const where = { siteId: null, ativo: true, tipo: 'P' };
  const [total, exemplos] = await Promise.all([
    prisma.produto.count({ where }),
    prisma.produto.findMany({ where, select: { id: true, nome: true, codigo: true }, orderBy: { nome: 'asc' }, take: 10 }),
  ]);
  return { total, exemplos };
}

/** Desativa os produtos que não são do site (serviços ficam). Reversível: basta reativar o produto. */
export async function desativarForaDoSite() {
  const u = await prisma.produto.updateMany({ where: { siteId: null, ativo: true, tipo: 'P' }, data: { ativo: false } });
  return { desativados: u.count };
}

export const INTERVALO_SINCRONIZACAO_MS = INTERVALO_MS;
