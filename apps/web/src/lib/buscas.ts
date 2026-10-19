/**
 * Funções de busca assíncrona usadas pelo SearchSelect (clientes, fornecedores, produtos...).
 */
import { api } from '@/lib/api';
import { documento, moeda } from '@/lib/format';
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

export async function buscarProdutos(texto: string, tipo?: 'P' | 'S'): Promise<OpcaoBusca[]> {
  const r = await api.get<Paginado<Produto>>('/produtos', { pesquisa: texto, tipo, ativo: true, limite: 15 });
  return r.data.map((p) => ({
    id: p.id,
    rotulo: p.nome,
    sub: [p.codigo, p.marca, p.tipo === 'S' ? 'Serviço' : `estoque ${p.estoqueTotal ?? 0}`].filter(Boolean).join(' · '),
    direita: moeda(p.preco),
    dados: p,
  }));
}
