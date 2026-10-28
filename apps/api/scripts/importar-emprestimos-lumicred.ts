/**
 * Traz o histórico da Lumicred para o módulo de empréstimos (28/10/2026).
 *
 * No Bling cada operação da Lumicred foi lançada como PEDIDO DE COMPRA (ex.: "Oper E-161 / OPERAÇÃO COMPRAS SP")
 * e os pagamentos diários como contas a pagar "Pagamento empréstimo - Lumicred". Este script:
 *  - cria uma operação por pedido de compra, com as contas a pagar dele como devolução;
 *  - liga a venda e o boleto do cliente quando o texto cita "Pedido de venda - 22751";
 *  - junta as contas a pagar avulsas (sem pedido de compra) por código de operação, ou numa operação "avulsos".
 * O valor que a Lumicred depositou não existe no histórico: fica estimado por valor ÷ (1 + taxa) e marcado
 * "juros estimados" para corrigir na tela. Nada de caixa é lançado (o dinheiro já entrou/saiu na época).
 * Roda de novo sem duplicar (ignora contas já ligadas a um empréstimo).
 *
 *   npx tsx scripts/importar-emprestimos-lumicred.ts [--aplicar] [--taxa=6] [--credor=276]
 */
import { differenceInCalendarDays } from 'date-fns';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, proximoNumero } from '../src/lib/util.js';
import { categoriaPadraoId } from '../src/modules/comum/financeiro.js';
import { CATEGORIA_EMPRESTIMOS } from '../src/modules/emprestimos/service.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const APLICAR = process.argv.includes('--aplicar');
const TAXA = Number(arg('taxa') || 6);

const codigoDe = (t: string) => {
  const m = /\bE\s*[-–]?\s*(\d{2,4})\b/i.exec(t) || /OPER(?:A[ÇC][ÃA]O)?\s*[-–]\s*(\d{2,4})\b/i.exec(t);
  return m ? `E-${m[1]}` : null;
};
const vendaDe = (t: string) => {
  const m = /Pedido de venda\s*[-–]?\s*(\d{4,6})/i.exec(t) || /\bPedido\s+(\d{5})\b/i.exec(t);
  return m ? Number(m[1]) : null;
};

type Plano = {
  origem: string;
  codigo: string | null;
  descricao: string;
  texto: string;
  dataOperacao: Date;
  contas: { id: number; valor: number; vencimento: Date; categoriaId: number | null }[];
  vendaNumero: number | null;
};

async function main() {
  const credor = arg('credor')
    ? await prisma.contato.findUnique({ where: { id: Number(arg('credor')) } })
    : await prisma.contato.findFirst({ where: { nome: { contains: 'Lumicred' } } });
  if (!credor) throw new Error('Credor Lumicred não encontrado (use --credor=ID).');
  console.log(`Credor: ${credor.nome} (#${credor.id}) · taxa estimada ${TAXA}%`);
  const planos: Plano[] = [];
  const usadas = new Set<number>();

  // 1) pedidos de compra da Lumicred
  const compras = await prisma.compra.findMany({ where: { fornecedorId: credor.id }, include: { itens: { select: { descricao: true } } }, orderBy: { data: 'asc' } });
  for (const c of compras) {
    const texto = [c.itens.map((i) => i.descricao).join(' / '), c.observacoes].filter(Boolean).join(' / ').replace(/\s+/g, ' ').trim();
    const contas = await prisma.contaPagar.findMany({
      where: {
        situacao: { not: 'CANCELADO' },
        emprestimoId: null,
        OR: [{ origemTipo: 'COMPRA', origemId: c.id }, { origemTipo: 'MANUAL', descricao: { contains: `pedido de compra nº ${c.numero},` } }],
      },
      select: { id: true, valor: true, vencimento: true, categoriaId: true },
      orderBy: { vencimento: 'asc' },
    });
    if (!contas.length) continue;
    contas.forEach((x) => usadas.add(x.id));
    planos.push({ origem: `pedido de compra nº ${c.numero}`, codigo: codigoDe(texto), descricao: (c.itens[0]?.descricao || `Pedido de compra nº ${c.numero}`).trim().slice(0, 140), texto, dataOperacao: c.data, contas, vendaNumero: vendaDe(texto) });
  }

  // 2) contas avulsas da Lumicred (sem pedido de compra)
  const avulsas = await prisma.contaPagar.findMany({
    where: { situacao: { not: 'CANCELADO' }, emprestimoId: null, origemTipo: { not: 'COMPRA' }, OR: [{ contatoId: credor.id }, { descricao: { contains: 'Lumicred' } }, { descricao: { contains: credor.documento || '§§' } }] },
    select: { id: true, valor: true, vencimento: true, categoriaId: true, descricao: true },
    orderBy: { vencimento: 'asc' },
  });
  const porCodigo = new Map<string, typeof avulsas>();
  for (const a of avulsas) {
    if (usadas.has(a.id)) continue;
    const k = codigoDe(a.descricao) ?? 'AVULSOS';
    porCodigo.set(k, [...(porCodigo.get(k) || []), a]);
  }
  for (const [k, l] of porCodigo) {
    planos.push({
      origem: k === 'AVULSOS' ? 'pagamentos avulsos' : `contas avulsas ${k}`,
      codigo: k === 'AVULSOS' ? null : k,
      descricao: k === 'AVULSOS' ? `Pagamentos avulsos ${credor.nome.split(' ')[0]} (histórico, sem operação registrada)` : l[0].descricao.slice(0, 140),
      texto: l.map((x) => x.descricao).join(' / '),
      dataOperacao: l[0].vencimento,
      contas: l,
      vendaNumero: vendaDe(l.map((x) => x.descricao).join(' ')),
    });
  }

  let total = 0;
  for (const p of planos) total += p.contas.reduce((s, c) => s + c.valor, 0);
  console.log(`${planos.length} operações · ${planos.reduce((s, p) => s + p.contas.length, 0)} contas a pagar · R$ ${total.toFixed(2)} devolvidos/a devolver`);
  for (const p of planos.slice(0, 8)) console.log(`  - ${p.codigo ?? '(sem código)'} ${p.descricao.slice(0, 60)} · ${p.contas.length} conta(s) · R$ ${p.contas.reduce((s, c) => s + c.valor, 0).toFixed(2)}${p.vendaNumero ? ` · venda ${p.vendaNumero}` : ''}`);
  if (!APLICAR) return console.log('Simulação: nada gravado (use --aplicar).');

  const categoriaId = await categoriaPadraoId(prisma, CATEGORIA_EMPRESTIMOS, 'DESPESA', 'DESPESA_FINANCEIRA');
  let criadas = 0;
  for (const p of planos) {
    const valorDevolver = arredondar(p.contas.reduce((s, c) => s + c.valor, 0));
    const valorRecebido = arredondar(valorDevolver / (1 + TAXA / 100));
    const venda = p.vendaNumero ? await prisma.venda.findFirst({ where: { tipo: 'PEDIDO', numero: p.vendaNumero }, select: { id: true, contatoId: true } }) : null;
    const boleto = venda ? await prisma.contaReceber.findFirst({ where: { origemTipo: 'VENDA', origemId: venda.id, situacao: { not: 'CANCELADO' } }, orderBy: { vencimento: 'asc' } }) : null;
    const modalidade = venda || /boleto/i.test(p.texto) ? 'REPASSE' : 'CAPITAL_GIRO';
    await prisma.$transaction(async (tx) => {
      const numero = await proximoNumero('EMPRESTIMO', tx);
      const e = await tx.emprestimo.create({
        data: {
          numero,
          codigo: p.codigo,
          descricao: p.descricao,
          credorId: credor.id,
          modalidade,
          clienteId: venda?.contatoId ?? null,
          vendaId: venda?.id ?? null,
          contaReceberClienteId: boleto?.id ?? null,
          dataOperacao: p.dataOperacao,
          valorRecebido,
          taxaPct: TAXA,
          juros: arredondar(valorDevolver - valorRecebido),
          valorDevolver,
          prazoDias: Math.max(0, differenceInCalendarDays(p.contas[0].vencimento, p.dataOperacao)),
          vencimento: p.contas[0].vencimento,
          parcelas: p.contas.length,
          importado: true,
          jurosEstimado: true,
          observacoes: `Importado do histórico (${p.origem}). ${p.texto}`.slice(0, 1000),
        },
      });
      for (const c of p.contas) {
        await tx.contaPagar.update({ where: { id: c.id }, data: { emprestimoId: e.id, contatoId: credor.id, ...(c.categoriaId === null || c.categoriaId !== categoriaId ? { categoriaId } : {}) } });
      }
    });
    criadas++;
  }
  console.log(`Gravado: ${criadas} operações.`);
}

main().finally(() => prisma.$disconnect());
