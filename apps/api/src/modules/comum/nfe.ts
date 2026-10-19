/**
 * Geração de NotaFiscal PENDENTE a partir de uma venda ou OS (apenas peças).
 * Não transmite: a transmissão fica no módulo fiscal (integracoes/fiscal).
 */
import { prisma, type Tx } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { arredondar } from '../../lib/util.js';

export type Db = Tx | typeof prisma;

export interface ItemNfe {
  produtoId: number | null;
  codigo?: string | null;
  descricao: string;
  unidade?: string | null;
  quantidade: number;
  valorUnitario: number;
  desconto: number;
  total: number;
}

export interface GerarNfeParams {
  modelo: 55 | 65;
  contatoId: number;
  itens: ItemNfe[];
  valorFrete?: number;
  valorOutras?: number;
  /** desconto "de rodapé" (fora dos itens) */
  descontoGeral?: number;
  formaPagamentoFiscal?: string | null;
  fretePorConta?: number;
  informacoesComplementares?: string | null;
  naturezaOperacao?: string | null;
}

/**
 * Cria a NotaFiscal (tipo 1 saída) + itens, incrementando a numeração da empresa
 * atomicamente dentro da transação recebida. Devolve a nota criada.
 */
export async function criarNotaPendente(tx: Db, p: GerarNfeParams) {
  const empresa = await tx.empresa.findUnique({ where: { id: 1 } });
  if (!empresa) throw new AppError('Dados da empresa não configurados.', 422, 'EMPRESA');
  const contato = await tx.contato.findUnique({ where: { id: p.contatoId } });
  if (!contato) throw new AppError('Cliente da nota não encontrado.', 422, 'CONTATO');

  const itensProduto = p.itens.filter((i) => i.produtoId);
  if (!itensProduto.length) throw new AppError('Não há itens de produto para gerar a nota fiscal.', 422, 'SEM_ITENS');

  const produtos = await tx.produto.findMany({ where: { id: { in: itensProduto.map((i) => i.produtoId!) } } });
  const mapaProd = new Map(produtos.map((pr) => [pr.id, pr]));
  const itensValidos = itensProduto.filter((i) => mapaProd.get(i.produtoId!)?.tipo === 'P');
  if (!itensValidos.length) throw new AppError('Nenhum item é produto (tipo P); serviços não entram na NF-e de produto.', 422, 'SEM_ITENS');

  // numeração atômica
  const serie = p.modelo === 65 ? empresa.serieNfce : empresa.serieNfe;
  const atualizado = await tx.empresa.update({
    where: { id: 1 },
    data: p.modelo === 65 ? { proximoNumeroNfce: { increment: 1 } } : { proximoNumeroNfe: { increment: 1 } },
  });
  const numero = p.modelo === 65 ? atualizado.proximoNumeroNfce - 1 : atualizado.proximoNumeroNfe - 1;

  const dentroUf = !contato.uf || !empresa.uf || contato.uf.toUpperCase() === empresa.uf.toUpperCase();
  const valorProdutos = arredondar(itensValidos.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0));
  const descontoItens = arredondar(itensValidos.reduce((s, i) => s + (i.desconto || 0), 0));
  const valorDesconto = arredondar(descontoItens + (p.descontoGeral || 0));
  const valorFrete = arredondar(p.valorFrete || 0);
  const valorOutras = arredondar(p.valorOutras || 0);
  const valorTotal = arredondar(valorProdutos - valorDesconto + valorFrete + valorOutras);

  const nota = await tx.notaFiscal.create({
    data: {
      tipo: 1,
      modelo: p.modelo,
      serie,
      numero,
      situacao: 'PENDENTE',
      ambiente: empresa.ambienteFiscal,
      contatoId: contato.id,
      naturezaOperacao: p.naturezaOperacao || empresa.naturezaOperacaoPadrao,
      finalidade: 1,
      consumidorFinal: p.modelo === 65 || contato.tipoPessoa === 'F' ? 1 : 0,
      indicadorPresenca: 1,
      valorProdutos,
      valorFrete,
      valorDesconto,
      valorOutras,
      valorTotal,
      formaPagamentoFiscal: p.formaPagamentoFiscal || '99',
      informacoesComplementares: p.informacoesComplementares || null,
      fretePorConta: p.fretePorConta ?? 9,
      itens: {
        create: itensValidos.map((i, idx) => {
          const pr = mapaProd.get(i.produtoId!)!;
          return {
            numeroItem: idx + 1,
            produtoId: pr.id,
            codigo: pr.codigo || String(pr.id),
            gtin: pr.gtin || null,
            descricao: i.descricao || pr.nome,
            ncm: pr.ncm || '00000000',
            cest: pr.cest || null,
            cfop: pr.cfopPadrao || (dentroUf ? empresa.cfopPadraoDentroUf : empresa.cfopPadraoForaUf),
            unidade: i.unidade || pr.unidade || 'UN',
            quantidade: i.quantidade,
            valorUnitario: i.valorUnitario,
            valorTotal: arredondar(i.quantidade * i.valorUnitario),
            desconto: arredondar(i.desconto || 0),
            origem: pr.origem,
            csosn: pr.csosn || empresa.csosnPadrao,
            cst: pr.cst || null,
            icmsAliquota: pr.icmsAliquota,
            pisCst: pr.pisCst,
            cofinsCst: pr.cofinsCst,
            ipiCst: pr.ipiCst || null,
          };
        }),
      },
    },
  });
  return nota;
}
