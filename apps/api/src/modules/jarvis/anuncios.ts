/**
 * CENTRAL DE ANÚNCIOS (docs/JARVIS.md §9)
 *
 * Um anúncio é montado uma vez (pela IA, quando há chave) e publicado por canal.
 * Cada canal cai num de dois mundos:
 *
 *   - Tem API oficial  → o sistema publica sozinho (Mercado Livre, site, blog, Meta).
 *   - Não tem API      → vira KIT PRONTO: texto adaptado, fotos e link, para alguém
 *                        publicar em um minuto e marcar "publiquei".
 *
 * OLX e Google Meu Negócio são kit de propósito (§13): a OLX não tem API pública e
 * automatizar o site logado por navegador viola os termos e pode derrubar a conta da loja.
 * Google exige aprovação do projeto. Fingir que publica seria pior do que dizer a verdade.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError, NotFound } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';
import { perguntarIa } from './ia.js';
import { publicarItem } from './mercadolivre.js';

export const CANAIS = ['MERCADO_LIVRE', 'SITE', 'BLOG', 'FACEBOOK', 'INSTAGRAM', 'GOOGLE_MEU_NEGOCIO', 'OLX'] as const;
export type Canal = (typeof CANAIS)[number];

export interface InfoCanal {
  canal: Canal;
  rotulo: string;
  /** 'api' = publica sozinho quando configurado; 'kit' = sempre precisa de uma pessoa */
  modo: 'api' | 'kit';
  /** por que é kit, ou o que falta configurar — aparece na tela */
  observacao: string;
  /** para onde o kit manda a pessoa */
  link?: string;
  /** limite de caracteres do título no canal */
  limiteTitulo?: number;
}

export const INFO_CANAIS: Record<Canal, InfoCanal> = {
  MERCADO_LIVRE: { canal: 'MERCADO_LIVRE', rotulo: 'Mercado Livre', modo: 'api', observacao: 'Publica sozinho depois de conectar a conta em Configurações → JARVIS.', limiteTitulo: 60 },
  SITE: { canal: 'SITE', rotulo: 'Site da loja', modo: 'api', observacao: 'Publica sozinho pelo endpoint do site (balao2026).' },
  BLOG: { canal: 'BLOG', rotulo: 'Blog', modo: 'api', observacao: 'Publica sozinho pelo mesmo endpoint do site, como post.' },
  FACEBOOK: { canal: 'FACEBOOK', rotulo: 'Facebook', modo: 'api', observacao: 'Precisa conectar o app da Meta e passar pela revisão deles.', link: 'https://business.facebook.com/' },
  INSTAGRAM: { canal: 'INSTAGRAM', rotulo: 'Instagram', modo: 'api', observacao: 'Conta comercial ligada à Página, e o app da Meta aprovado.', link: 'https://business.facebook.com/' },
  GOOGLE_MEU_NEGOCIO: { canal: 'GOOGLE_MEU_NEGOCIO', rotulo: 'Google Meu Negócio', modo: 'kit', observacao: 'O Google exige aprovação do projeto para publicar pela API. Até lá, kit pronto.', link: 'https://business.google.com/posts' },
  OLX: { canal: 'OLX', rotulo: 'OLX', modo: 'kit', observacao: 'A OLX não tem API pública de anúncio. Automatizar o site logado viola os termos e arrisca a conta — por isso é kit.', link: 'https://www.olx.com.br/incluir', limiteTitulo: 90 },
};

const SISTEMA_ANUNCIO = `Você escreve anúncios de produtos para uma loja de informática e eletrônicos de Campinas (Balão da Informática).
Escreva em português do Brasil, direto e honesto, sem exagero e sem promessa que a loja não pode cumprir.
Nunca invente especificação técnica que não esteja nos dados recebidos.
Responda SOMENTE um JSON válido, sem comentários, no formato:
{"titulo":"...","descricao":"...","porCanal":{"MERCADO_LIVRE":"...","OLX":"...","FACEBOOK":"...","INSTAGRAM":"...","SITE":"...","BLOG":"...","GOOGLE_MEU_NEGOCIO":"..."}}
Regras: título do Mercado Livre no máximo 60 caracteres; título da OLX no máximo 90; Instagram curto com até 5 hashtags no fim; Google Meu Negócio no máximo 1500 caracteres.
O campo "descricao" é a descrição longa, usada como base. Cada item de "porCanal" é o texto pronto daquele canal.`;

export interface RascunhoAnuncio {
  titulo: string;
  descricao: string;
  porCanal: Partial<Record<Canal, string>>;
  geradoPorIa: boolean;
}

/** Texto padrão, usado quando não há chave de IA — o sistema funciona sem ela, só menos caprichado. */
function rascunhoPadrao(p: { nome: string; descricaoCurta?: string | null; descricaoDetalhada?: string | null; marca?: string | null; preco: number; condicao: string }): RascunhoAnuncio {
  const garantia = p.condicao === 'usado' ? '3 meses de garantia' : '1 ano de garantia';
  const base = [
    p.descricaoDetalhada?.trim() || p.descricaoCurta?.trim() || '',
    `${p.marca ? `Marca: ${p.marca}. ` : ''}Produto ${p.condicao === 'usado' ? 'seminovo, testado' : 'novo, lacrado'}, com ${garantia}.`,
    'Balão da Informática — Av. Anchieta 789, Cambuí, Campinas. Retirada na loja ou entrega combinada.',
  ].filter(Boolean).join('\n\n');
  return {
    titulo: p.nome.slice(0, 60),
    descricao: base,
    porCanal: Object.fromEntries(CANAIS.map((c) => [c, base])) as Partial<Record<Canal, string>>,
    geradoPorIa: false,
  };
}

/** Monta o anúncio a partir do produto. Usa a IA quando há chave; senão, o texto padrão. */
export async function montarRascunho(produtoId: number, condicao: 'novo' | 'usado' = 'novo'): Promise<RascunhoAnuncio & { preco: number; fotos: string[]; produtoId: number }> {
  const p = await prisma.produto.findUnique({ where: { id: produtoId } });
  if (!p) throw new NotFound('Produto');

  const padrao = rascunhoPadrao({ ...p, condicao });
  const fotos = p.imagemUrl ? [p.imagemUrl] : [];

  const dados = {
    nome: p.nome, marca: p.marca, codigo: p.codigo,
    descricaoCurta: p.descricaoCurta, descricaoDetalhada: p.descricaoDetalhada,
    preco: p.preco, condicao,
    garantia: condicao === 'usado' ? '3 meses' : '1 ano',
    loja: 'Balão da Informática, Campinas-SP',
  };

  const resposta = await perguntarIa(SISTEMA_ANUNCIO, JSON.stringify(dados), { maxTokens: 1500 }).catch(() => null);
  if (!resposta?.texto) return { ...padrao, preco: p.preco, fotos, produtoId };

  try {
    const bruto = resposta.texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const j = JSON.parse(bruto);
    if (!j.titulo || !j.descricao) throw new Error('resposta sem título ou descrição');
    const porCanal: Partial<Record<Canal, string>> = {};
    for (const c of CANAIS) porCanal[c] = typeof j.porCanal?.[c] === 'string' ? j.porCanal[c] : j.descricao;
    return { titulo: String(j.titulo).slice(0, 90), descricao: String(j.descricao), porCanal, geradoPorIa: true, preco: p.preco, fotos, produtoId };
  } catch {
    // IA devolveu algo que não dá para usar: cai no texto padrão em vez de quebrar
    return { ...padrao, preco: p.preco, fotos, produtoId };
  }
}

/** Cria o anúncio com uma linha por canal escolhido. */
export async function criarAnuncio(p: {
  produtoId?: number | null; titulo: string; descricao: string; preco: number;
  condicao: string; fotos: string[]; canais: Canal[]; porCanal?: Partial<Record<Canal, string>>; geradoPorIa?: boolean;
}) {
  if (!p.canais.length) throw new AppError('Escolha pelo menos um canal.', 422, 'SEM_CANAL');
  return prisma.jarvisAnuncio.create({
    data: {
      produtoId: p.produtoId ?? null,
      titulo: p.titulo,
      descricao: p.descricao,
      preco: arredondar(p.preco),
      condicao: p.condicao,
      fotos: JSON.stringify(p.fotos ?? []),
      geradoPorIa: p.geradoPorIa ?? false,
      canais: {
        create: p.canais.map((c) => ({
          canal: c,
          // kit nasce pronto para alguém publicar; canal de API nasce pendente
          situacao: INFO_CANAIS[c].modo === 'kit' ? 'KIT_PRONTO' : 'PENDENTE',
          texto: (p.porCanal?.[c] ?? p.descricao).slice(0, 8000),
        })),
      },
    },
    include: { canais: true },
  });
}

/**
 * Publica num canal de API. Hoje nenhum provedor está ligado, então o canal volta
 * como PRECISA_CONFIGURAR com o motivo — nunca como "publicado" mentiroso.
 */
export async function publicarCanal(anuncioId: number, canal: Canal) {
  const linha = await prisma.jarvisAnuncioCanal.findUnique({ where: { anuncioId_canal: { anuncioId, canal } } });
  if (!linha) throw new NotFound('Canal do anúncio');
  if (linha.situacao === 'PUBLICADO') throw new AppError('Esse canal já está publicado.', 422, 'JA_PUBLICADO');

  const info = INFO_CANAIS[canal];
  if (info.modo === 'kit') {
    throw new AppError(`${info.rotulo} não publica sozinho. ${info.observacao}`, 422, 'CANAL_KIT');
  }

  if (canal === 'MERCADO_LIVRE') {
    const anuncio = await prisma.jarvisAnuncio.findUnique({ where: { id: anuncioId } });
    if (!anuncio) throw new NotFound('Anúncio');
    const fotos: string[] = anuncio.fotos ? JSON.parse(anuncio.fotos) : [];
    try {
      const r = await publicarItem({
        titulo: anuncio.titulo,
        descricao: linha.texto || anuncio.descricao,
        preco: anuncio.preco,
        condicao: anuncio.condicao === 'usado' ? 'usado' : 'novo',
        fotos,
      });
      return prisma.jarvisAnuncioCanal.update({
        where: { id: linha.id },
        data: { situacao: 'PUBLICADO', idExterno: r.id, url: r.permalink, publicadoEm: new Date(), erro: null },
      });
    } catch (e: any) {
      // o erro do ML diz o que falta (foto, categoria, atributo): vai inteiro para a tela
      const msg = String(e?.message || e).slice(0, 400);
      const faltaLigar = /ML_NAO_CONECTADO|SEM_CREDENCIAL/.test(String(e?.code ?? ''));
      return prisma.jarvisAnuncioCanal.update({
        where: { id: linha.id },
        data: { situacao: faltaLigar ? 'PRECISA_CONFIGURAR' : 'ERRO', erro: msg },
      });
    }
  }

  // Site, blog e Meta entram nas próximas etapas do docs/JARVIS.md. Até lá, dizemos o que falta.
  const motivo = `${info.rotulo}: ainda não conectado. ${info.observacao}`;
  return prisma.jarvisAnuncioCanal.update({
    where: { id: linha.id },
    data: { situacao: 'PRECISA_CONFIGURAR', erro: motivo },
  });
}

/** A pessoa publicou o kit à mão e está registrando onde ficou. */
export async function marcarPublicado(anuncioId: number, canal: Canal, url: string | null, quem: string | null) {
  const linha = await prisma.jarvisAnuncioCanal.findUnique({ where: { anuncioId_canal: { anuncioId, canal } } });
  if (!linha) throw new NotFound('Canal do anúncio');
  return prisma.jarvisAnuncioCanal.update({
    where: { id: linha.id },
    data: { situacao: 'PUBLICADO', url: url || null, publicadoEm: new Date(), publicadoPor: quem, erro: null },
  });
}

export async function listarAnuncios(limite = 50) {
  const itens = await prisma.jarvisAnuncio.findMany({
    orderBy: { criadoEm: 'desc' },
    take: limite,
    include: { canais: true, produto: { select: { id: true, nome: true, imagemUrl: true } } },
  });
  return itens.map((a) => ({ ...a, fotos: a.fotos ? (JSON.parse(a.fotos) as string[]) : [] }));
}
