/**
 * Importa o "Relatório de Contas a Pagar" do Bling (linhas já extraídas para JSON) no MEU BLING.
 * Entrada: JSON array [{forn,hist,doc,venc:"DD/MM/AAAA",sit,valor}].
 *  - cria/reutiliza o fornecedor (Contato) pelo nome;
 *  - cria a ContaPagar (idempotente via blingId "RELCP:<hash>#<n>");
 *  - "Paga" → baixa pela conta Caixa na data do vencimento, já conciliada;
 *  - demais situações ficam ABERTAS (atrasada é calculada pelo vencimento).
 * Uso: npx tsx scripts/importar-contas-pagar.ts <linhas.json> [--simular] [--saida relatorio.json]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, competenciaDe, formatarMoeda } from '../src/lib/util.js';
import { baixarContaPagar } from '../src/modules/financeiro/service.js';

const args = process.argv.slice(2);
const iSaida = args.indexOf('--saida');
const saida = iSaida >= 0 ? args[iSaida + 1] : undefined;
const arquivo = args.find((a, i) => !a.startsWith('--') && i !== iSaida + 1);
const simular = args.includes('--simular');
if (!arquivo) throw new Error('Informe o JSON com as linhas.');

const data = (br: string) => {
  const [d, m, a] = br.split('/');
  return new Date(`${a}-${m}-${d}T12:00:00-03:00`);
};
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

async function main() {
  const linhas: any[] = JSON.parse(fs.readFileSync(arquivo!, 'utf8'));
  const caixa = (await prisma.contaFinanceira.findFirst({ where: { tipo: 'CAIXA', ativo: true }, orderBy: { id: 'asc' } })) || (await prisma.contaFinanceira.findFirst({ where: { nome: 'Caixa' } }));
  if (!caixa) throw new Error('Conta financeira "Caixa" não encontrada.');
  const forn = new Map<string, number>();
  const cont = new Map<string, number>();
  const rel: any = { criadas: 0, existentes: 0, pagas: 0, abertas: 0, fornecedoresNovos: 0, totalLinhas: linhas.length, totalValor: 0, pagoValor: 0, abertoValor: 0, parciais: [], erros: [] as any[] };
  for (const l of linhas) {
    try {
      const nome = norm(l.forn);
      const chave = nome.toLowerCase();
      let contatoId = forn.get(chave);
      if (!contatoId) {
        const ex = await prisma.contato.findFirst({ where: { nome } });
        if (ex) {
          contatoId = ex.id;
          if (ex.tipo === 'CLIENTE') await prisma.contato.update({ where: { id: ex.id }, data: { tipo: 'AMBOS' } });
        } else if (!simular) {
          contatoId = (await prisma.contato.create({ data: { tipo: 'FORNECEDOR', tipoPessoa: 'J', nome } })).id;
          rel.fornecedoresNovos += 1;
        } else rel.fornecedoresNovos += 1;
        if (contatoId) forn.set(chave, contatoId);
      }
      const h = crypto.createHash('sha1').update([nome, l.hist, l.doc, l.venc, l.valor].join('|')).digest('hex').slice(0, 12);
      const n = (cont.get(h) || 0) + 1;
      cont.set(h, n);
      const blingId = `RELCP:${h}#${n}`;
      const valor = arredondar(Number(l.valor));
      rel.totalValor = arredondar(rel.totalValor + valor);
      const paga = l.sit === 'Paga';
      if (paga) rel.pagoValor = arredondar(rel.pagoValor + valor);
      else rel.abertoValor = arredondar(rel.abertoValor + valor);
      if (simular) {
        rel[paga ? 'pagas' : 'abertas'] += 1;
        continue;
      }
      const ja = await prisma.contaPagar.findUnique({ where: { blingId } });
      if (ja) {
        rel.existentes += 1;
        continue;
      }
      const venc = data(l.venc);
      const parcial = l.sit === 'Parcialmente atrasada';
      const obs = [
        l.doc ? `Documento: ${l.doc}` : '',
        `Importado do relatório de contas a pagar do Bling (situação lá: ${l.sit || 'Em aberto'}).`,
        parcial ? 'ATENÇÃO: no Bling esta conta está "Parcialmente atrasada" (pagamento parcial); o relatório não informa o valor já pago — conferir.' : '',
      ].filter(Boolean).join('\n');
      const conta = await prisma.contaPagar.create({
        data: {
          contatoId: contatoId!,
          descricao: norm(l.hist) || nome,
          dataEmissao: venc,
          vencimento: venc,
          competencia: competenciaDe(venc),
          valor,
          situacao: 'ABERTO',
          origemTipo: 'MANUAL',
          parcela: l.doc && /\/\d+$/.test(l.doc) ? l.doc.split('/').pop() : null,
          observacoes: obs,
          blingId,
        },
      });
      rel.criadas += 1;
      if (parcial) rel.parciais.push({ id: conta.id, forn: nome, venc: l.venc, valor });
      if (paga) {
        const r = await baixarContaPagar({ id: conta.id, valor, data: venc, contaFinanceiraId: caixa.id, observacoes: 'Baixa na migração do Bling (conta paga)' });
        await prisma.movimentoFinanceiro.update({ where: { id: r.movimento.id }, data: { conciliado: true } });
        rel.pagas += 1;
      } else rel.abertas += 1;
    } catch (e: any) {
      rel.erros.push({ forn: l.forn, venc: l.venc, valor: l.valor, erro: e.message });
    }
  }
  console.log(JSON.stringify({ ...rel, parciais: rel.parciais.length, erros: rel.erros.length }));
  console.log(`Total ${formatarMoeda(rel.totalValor)} | pago ${formatarMoeda(rel.pagoValor)} | em aberto ${formatarMoeda(rel.abertoValor)}`);
  if (rel.erros.length) console.log(JSON.stringify(rel.erros.slice(0, 10)));
  if (saida) fs.writeFileSync(saida, JSON.stringify(rel, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
