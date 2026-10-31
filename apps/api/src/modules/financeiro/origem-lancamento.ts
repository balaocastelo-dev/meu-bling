/**
 * DE ONDE VEIO CADA LANÇAMENTO
 * Um movimento financeiro nasce sempre de alguma coisa: uma venda, uma OS, uma compra,
 * uma consignação, um empréstimo, um carnê — ou é um título solto / lançamento avulso.
 * Aqui mora a tradução "título → natureza, rótulo e link", usada tanto pelo extrato da
 * conta quanto pela lista de lançamentos, para as duas telas nunca discordarem.
 */
import { prisma } from '../../lib/prisma.js';
import { mapaOrigens } from './service.js';

export type NaturezaLancamento =
  | 'VENDA' | 'OS' | 'COMPRA' | 'CONSIGNACAO' | 'EMPRESTIMO' | 'CARNE'
  | 'RECEBIMENTO' | 'PAGAMENTO' | 'TRANSFERENCIA' | 'CAIXINHA' | 'AJUSTE' | 'AVULSO';

/** O que o extrato precisa ler de uma conta a receber para saber de onde ela veio. */
export const selectTituloReceber = {
  id: true, descricao: true, origemTipo: true, origemId: true,
  consignacaoId: true, emprestimoId: true, carneId: true,
  contato: { select: { id: true, nome: true } },
} as const;

/** Idem para uma conta a pagar (a compra também pode chegar pela parcela). */
export const selectTituloPagar = {
  id: true, descricao: true, origemTipo: true, origemId: true,
  consignacaoId: true, emprestimoId: true,
  contato: { select: { id: true, nome: true } },
  compraParcela: { select: { compraId: true } },
} as const;

type Titulo = {
  id: number;
  descricao: string;
  origemTipo: string;
  origemId: number | null;
  consignacaoId?: number | null;
  emprestimoId?: number | null;
  carneId?: number | null;
  contato?: { id: number; nome: string } | null;
  compraParcela?: { compraId: number } | null;
};

export type OrigemLancamento = { natureza: NaturezaLancamento; rotulo: string; link: string | null };

const unicos = (v: (number | null | undefined)[]) => [...new Set(v.filter((x): x is number => !!x))];

/**
 * Monta de uma vez só os números de consignação/empréstimo/carnê/compra de um lote de títulos
 * e devolve a função que traduz cada título. Uma consulta por tipo, não uma por linha.
 */
export async function resolvedorDeOrigem(titulos: Titulo[]) {
  const porOrigem = await mapaOrigens(titulos);
  const [consignacoes, emprestimos, carnes, compras] = await Promise.all([
    unicos(titulos.map((t) => t.consignacaoId)).length
      ? prisma.consignacao.findMany({ where: { id: { in: unicos(titulos.map((t) => t.consignacaoId)) } }, select: { id: true, numero: true } })
      : [],
    unicos(titulos.map((t) => t.emprestimoId)).length
      ? prisma.emprestimo.findMany({ where: { id: { in: unicos(titulos.map((t) => t.emprestimoId)) } }, select: { id: true, numero: true } })
      : [],
    unicos(titulos.map((t) => t.carneId)).length
      ? prisma.carne.findMany({ where: { id: { in: unicos(titulos.map((t) => t.carneId)) } }, select: { id: true, numero: true } })
      : [],
    unicos(titulos.map((t) => t.compraParcela?.compraId)).length
      ? prisma.compra.findMany({ where: { id: { in: unicos(titulos.map((t) => t.compraParcela?.compraId)) } }, select: { id: true, numero: true } })
      : [],
  ]);
  const num = (lista: { id: number; numero: number }[], id?: number | null) => lista.find((x) => x.id === id)?.numero ?? id ?? null;

  return (titulo: Titulo, ehReceber: boolean): OrigemLancamento => {
    const pessoa = titulo.contato?.nome ? ` · ${titulo.contato.nome}` : '';
    const o = porOrigem(titulo);

    if (o.tipo === 'VENDA' && o.id) return { natureza: 'VENDA', rotulo: `Venda nº ${o.numero ?? o.id}${pessoa}`, link: `/vendas/${o.id}` };
    if (o.tipo === 'OS' && o.id) return { natureza: 'OS', rotulo: `OS nº ${o.numero ?? o.id}${pessoa}`, link: `/ordens-servico/${o.id}` };
    if (o.tipo === 'COMPRA' && o.id) return { natureza: 'COMPRA', rotulo: `Compra nº ${o.numero ?? o.id}${pessoa}`, link: `/compras/${o.id}` };

    // compra que chegou pela parcela, sem origemTipo preenchido
    const compraId = titulo.compraParcela?.compraId;
    if (compraId) return { natureza: 'COMPRA', rotulo: `Compra nº ${num(compras, compraId)}${pessoa}`, link: `/compras/${compraId}` };

    if (titulo.consignacaoId) return { natureza: 'CONSIGNACAO', rotulo: `Consignação nº ${num(consignacoes, titulo.consignacaoId)}${pessoa}`, link: `/consignacoes/${titulo.consignacaoId}` };
    if (titulo.emprestimoId) return { natureza: 'EMPRESTIMO', rotulo: `Empréstimo nº ${num(emprestimos, titulo.emprestimoId)}${pessoa}`, link: '/financeiro/emprestimos' };
    if (titulo.carneId) return { natureza: 'CARNE', rotulo: `Carnê nº ${num(carnes, titulo.carneId)}${pessoa}`, link: '/financeiro/carnes' };

    return {
      natureza: ehReceber ? 'RECEBIMENTO' : 'PAGAMENTO',
      rotulo: `${ehReceber ? 'Conta a receber' : 'Conta a pagar'}: ${titulo.descricao}${pessoa}`,
      link: `${ehReceber ? '/financeiro/receber' : '/financeiro/pagar'}?pesquisa=${encodeURIComponent(titulo.descricao)}`,
    };
  };
}
