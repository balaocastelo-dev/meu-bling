/**
 * Junta tudo o que os documentos de venda precisam: venda, cliente, itens com produto completo,
 * garantia de cada item, empresa, QR do site e o versículo sorteado.
 */
import QRCode from 'qrcode';
import { prisma } from '../../lib/prisma.js';
import { dadosEmpresa } from '../comum/html.js';
import { carregarVenda } from '../vendas/service.js';
import { ehSeminovo, garantiaDoItem, tipoCertificado, type Garantia, type TipoCertificado } from './classificar.js';
import { sortearVersiculo, type Versiculo } from './versiculos.js';

export interface ItemDoc {
  idx: number;
  descricao: string;
  codigo: string | null;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  desconto: number;
  total: number;
  numeroSerie: string | null;
  imagemUrl: string | null;
  marca: string | null;
  categoria: string | null;
  /** texto técnico do produto (descrição curta/detalhada sem HTML) */
  especificacoes: string[];
  tipo: TipoCertificado | null;
  seminovo: boolean;
  servico: boolean;
  garantia: Garantia;
}

export type ContextoDoc = Awaited<ReturnType<typeof carregarContexto>>;

const semHtml = (t: string | null | undefined) =>
  (t || '')
    .replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ');

/** "DESKTOP I5 / 16GB DDR4 / SSD 240GB" → ["I5", "16GB DDR4", "SSD 240GB"] + linhas da descrição */
function especificacoes(nome: string, curta?: string | null, detalhada?: string | null): string[] {
  const doNome = nome.split(/\s[\/|+]\s|\s-\s/).slice(1).map((s) => s.trim()).filter((s) => s.length > 1);
  const daDescricao = semHtml(curta || detalhada)
    .split(/\n|;|•/)
    .map((s) => s.trim().replace(/^[-–*]\s*/, ''))
    .filter((s) => s.length > 2 && s.length < 140);
  const vistos = new Set<string>();
  return [...doNome, ...daDescricao].filter((s) => {
    const k = s.toLowerCase();
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).slice(0, 10);
}

export async function carregarContexto(vendaId: number) {
  const v = await carregarVenda(prisma, vendaId);
  const emp = await dadosEmpresa();
  const ids = v.itens.map((i) => i.produtoId).filter((x): x is number => !!x);
  const produtos = ids.length
    ? await prisma.produto.findMany({
        where: { id: { in: ids } },
        select: { id: true, tipo: true, marca: true, garantiaDias: true, descricaoCurta: true, descricaoDetalhada: true, imagemUrl: true, categoria: { select: { nome: true } } },
      })
    : [];
  const mapa = new Map(produtos.map((p) => [p.id, p]));
  const itens: ItemDoc[] = v.itens.map((i, idx) => {
    const p = i.produtoId ? mapa.get(i.produtoId) : undefined;
    const servico = p?.tipo === 'S';
    const categoria = p?.categoria?.nome ?? null;
    const tipo = servico ? null : tipoCertificado(i.descricao, categoria);
    const seminovo = !servico && ehSeminovo(i.descricao, categoria);
    return {
      idx: idx + 1,
      descricao: i.descricao,
      codigo: i.codigo || i.produto?.codigo || null,
      quantidade: i.quantidade,
      unidade: i.unidade,
      valorUnitario: i.valorUnitario,
      desconto: i.desconto,
      total: i.total,
      numeroSerie: (i as { numeroSerie?: string | null }).numeroSerie || null,
      imagemUrl: p?.imagemUrl || i.produto?.imagemUrl || null,
      marca: p?.marca || null,
      categoria,
      especificacoes: especificacoes(i.descricao, p?.descricaoCurta, p?.descricaoDetalhada),
      tipo,
      seminovo,
      servico,
      garantia: garantiaDoItem(v.data, tipo, seminovo, servico ? 90 : p?.garantiaDias),
    };
  });
  const site = emp.site || 'www.balao.info';
  const urlSite = /^https?:\/\//.test(site) ? site : `https://${site}`;
  const qrSite = await QRCode.toDataURL(urlSite, { margin: 0, width: 220, color: { dark: '#111111', light: '#ffffff' } });
  const celular = (emp.telefone || '').replace(/\D/g, '');
  const qrWhats = celular.length >= 10 ? await QRCode.toDataURL(`https://wa.me/55${celular}`, { margin: 0, width: 220 }) : null;

  return {
    venda: v,
    emp,
    itens,
    certificados: itens.filter((i) => i.tipo),
    /** folha de licenças: sai quando a venda tem PC, PC Gamer ou Notebook */
    temLicenca: itens.some((i) => i.tipo === 'PC' || i.tipo === 'PC_GAMER' || i.tipo === 'NOTEBOOK'),
    temGarantia: itens.some((i) => !i.servico && i.garantia.dias > 0),
    site,
    urlSite,
    qrSite,
    qrWhats,
    versiculo: sortearVersiculo() as Versiculo,
    emitidoEm: new Date(),
  };
}
