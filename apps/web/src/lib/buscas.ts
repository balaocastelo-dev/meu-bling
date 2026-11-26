/**
 * Funções de busca assíncrona usadas pelo SearchSelect (clientes, fornecedores, produtos...).
 */
import { createElement } from 'react';
import { api } from '@/lib/api';
import { FotoProduto, SeloProntaEntrega } from '@/components/compartilhados/ProdutoSite';
import { Badge } from '@/components/ui/Badge';
import { documento, moeda } from '@/lib/format';
import { rotuloPapel } from '@/lib/papel-contato';
import type { OpcaoBusca } from '@/components/ui/SearchSelect';
import type { Contato, Paginado, Produto, TipoContato } from '@/types';

export async function buscarContatos(texto: string, tipo?: TipoContato): Promise<OpcaoBusca[]> {
  const r = await api.get<Paginado<Contato>>('/contatos', { pesquisa: texto, tipo, ativo: true, limite: 15 });
  return r.data.map((c) => ({
    id: c.id,
    rotulo: c.nome,
    sub: [c.fantasia, documento(c.documento), c.celular || c.telefone].filter(Boolean).join(' · '),
    dados: c,
  }));
}

/**
 * Busca de cliente ou fornecedor nas telas de compra, venda, OS e financeiro.
 * Lista qualquer contato comercial ativo (cliente, fornecedor ou os dois), com a tag do papel atual.
 * Não inclui quem é só transportadora. O filtro ?tipo= da lista de cadastros continua separado.
 */
export async function buscarContatosComPapel(texto: string): Promise<OpcaoBusca[]> {
  const r = await api.get<Paginado<Contato>>('/contatos', { pesquisa: texto, comercial: true, ativo: true, limite: 15 });
  return r.data.map((c) => ({
    id: c.id,
    rotulo: c.nome,
    sub: [c.fantasia, documento(c.documento), c.celular || c.telefone].filter(Boolean).join(' · '),
    selo: createElement(Badge, { tom: c.tipo === 'CLIENTE' ? 'azul' : c.tipo === 'FORNECEDOR' ? 'laranja' : 'verde', children: rotuloPapel(c.tipo) }),
    dados: c,
  }));
}

/** Produtos para a busca da venda/OS: com foto, selo de pronta entrega (primeiro) e preço à vista. */
export async function buscarProdutos(texto: string, tipo?: 'P' | 'S'): Promise<OpcaoBusca[]> {
  const r = await api.get<Paginado<Produto>>('/produtos', { pesquisa: texto, tipo, ativo: true, limite: 15, ordem: 'pronta' });
  return r.data.map((p) => ({
    id: p.id,
    rotulo: p.nome,
    sub: [
      p.codigo,
      p.marca,
      p.tipo === 'S' ? 'Serviço' : p.controlaEstoque ? `estoque ${p.estoqueTotal ?? 0}` : null,
      p.precoCartao && p.precoCartao !== p.preco ? `cartão ${moeda(p.precoCartao)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    direita: moeda(p.preco),
    imagem: p.tipo === 'S' ? undefined : createElement(FotoProduto, { url: p.imagemUrl, tamanho: 'sm' }),
    selo: p.prontaEntrega ? createElement(SeloProntaEntrega, { compacto: true }) : undefined,
    dados: p,
  }));
}
