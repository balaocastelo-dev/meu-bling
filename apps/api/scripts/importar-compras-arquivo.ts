/**
 * Importa pedidos de COMPRA do Bling a partir de arquivos (JSONL compacto), pedido a pedido.
 *
 * Uso: npx tsx scripts/importar-compras-arquivo.ts <compras.jsonl> --fornecedores <fornecedores.json>
 *        [--listagem <listagem.json>] [--saida <relatorio.json>] [--simular]
 *
 * Formato compacto por linha (ver lotes-compra/INSTRUCOES.md):
 *  {"id","numero","data","prev","sit":0|1|2|3,"forn":<id Bling>,"cat","oc","totProd","total","desc","descUn","frete","outras",
 *   "obs","obsInt","ni","itens":[{"prod","cod","cf","desc","un","qtd","vlr","ipi"}],"parc":[{"venc","vlr","fp","obs"}]}
 * fornecedores.json: { "<idBling>": {"nome":"..","doc":"..","tp":"F|J"} }
 *
 * Regras: situação do Bling 0→Em aberto, 1→Fechado, 2→Cancelado, 3→Em aberto. NÃO lança estoque nem cria contas:
 * as parcelas são ligadas às contas a pagar já importadas do relatório do Bling (origem "Ref. ao pedido de compra nº N",
 * documento NNNNNN/PP) e as que não tiverem conta ficam listadas no relatório.
 */
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, competenciaDe, formatarMoeda, somenteDigitos } from '../src/lib/util.js';

const args = process.argv.slice(2);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const usados = new Set(['--fornecedores', '--listagem', '--saida'].map((f) => opt(f)).filter(Boolean));
const arquivo = args.find((a) => !a.startsWith('--') && !usados.has(a));
const simular = args.includes('--simular');
if (!arquivo || !opt('--fornecedores')) throw new Error('Uso: importar-compras-arquivo.ts <compras.jsonl> --fornecedores <json> [--listagem <json>] [--saida <json>] [--simular]');

const NOME_SIT: Record<number, string> = { 0: 'Em aberto', 1: 'Fechado', 2: 'Cancelado', 3: 'Em aberto' };
const dia = (s?: string) => (!s || s.startsWith('0000') ? null : new Date(`${s}T12:00:00-03:00`));
const pad = (n: number, t: number) => String(n).padStart(t, '0');

function lerJsonl(caminho: string): any[] {
  const out: any[] = [];
  fs.readFileSync(caminho, 'utf8').split(/\r?\n/).forEach((l, i) => {
    const s = l.trim();
    if (!s) return;
    try {
      out.push(JSON.parse(s));
    } catch (e: any) {
      console.error(`linha ${i + 1} inválida: ${e.message}`);
    }
  });
  return out;
}


/**
 * Liga cada parcela de compra à conta a pagar importada do relatório do Bling ("Ref. ao pedido de compra nº N").
 * Critérios, nesta ordem: número do documento NNNNNN/PP (que aparece nas observações); valor igual; primeira livre.
 */
async function religar(rel: any) {
  const compras = await prisma.compra.findMany({ where: { blingId: { not: null }, situacao: { cancelamento: false } }, include: { parcelas: { orderBy: { numero: 'asc' } }, situacao: true } });
  const contas = await prisma.contaPagar.findMany({ where: { blingId: { startsWith: 'RELCP:' }, descricao: { contains: 'pedido de compra' } } });
  const porNumero = new Map<number, typeof contas>();
  for (const ct of contas) {
    const m = ct.descricao.match(/pedido de compra n[º°o]?\s*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    (porNumero.get(n) || porNumero.set(n, []).get(n)!).push(ct);
  }
  rel.parcelasLigadas = 0;
  rel.parcelasSemConta = 0;
  rel.semConta = [];
  const usadas = new Set<number>();
  for (const cp of await prisma.compraParcela.findMany({ where: { contaPagarId: { not: null } }, select: { contaPagarId: true } })) usadas.add(cp.contaPagarId!);
  for (const c of compras) {
    const candidatas = (porNumero.get(c.numero) || []).filter((x) => !usadas.has(x.id));
    for (const p of c.parcelas) {
      if (p.contaPagarId) continue;
      const doc = `${pad(c.numero, 6)}/${pad(p.numero, 2)}`;
      let conta = candidatas.find((x) => !usadas.has(x.id) && (x.observacoes || '').includes(doc));
      if (!conta) conta = candidatas.find((x) => !usadas.has(x.id) && Math.abs(x.valor - p.valor) < 0.005);
      if (!conta && c.parcelas.length === 1) conta = candidatas.find((x) => !usadas.has(x.id));
      if (!conta) {
        rel.parcelasSemConta += 1;
        rel.semConta.push({ numero: c.numero, parcela: p.numero, venc: p.dataVencimento.toISOString().slice(0, 10), valor: p.valor, situacao: c.situacao.nome });
        continue;
      }
      usadas.add(conta.id);
      await prisma.compraParcela.update({ where: { id: p.id }, data: { contaPagarId: conta.id } });
      await prisma.contaPagar.update({ where: { id: conta.id }, data: { origemTipo: 'COMPRA', origemId: c.id, parcela: `${p.numero}/${c.parcelas.length}` } });
      rel.parcelasLigadas += 1;
    }
  }
}

async function main() {
  const brutos = lerJsonl(arquivo!);
  const porId = new Map<string, any>();
  for (const p of brutos) if (p?.id) porId.set(String(p.id), p);
  const pedidos = [...porId.values()];
  console.log(`Arquivo ${arquivo}: ${brutos.length} registros, ${pedidos.length} pedidos distintos`);
  const fornecedoresBling: Record<string, { nome: string; doc?: string; tp?: string }> = JSON.parse(fs.readFileSync(opt('--fornecedores')!, 'utf8'));
  const listagem = new Map<string, any>();
  if (opt('--listagem')) for (const l of JSON.parse(fs.readFileSync(opt('--listagem')!, 'utf8'))) listagem.set(String(l.id), l);

  const sits = new Map((await prisma.situacao.findMany({ where: { modulo: 'COMPRA' } })).map((s) => [s.nome, s]));
  for (const n of ['Em aberto', 'Fechado', 'Cancelado']) if (!sits.has(n)) throw new Error(`Situação de compra "${n}" não existe (rode o seed).`);
  const depPadrao = await prisma.deposito.findFirst({ where: { padrao: true } });
  const catCmv = await prisma.categoriaFinanceira.findFirst({ where: { grupoDre: 'CMV' } });

  const rel: any = { gravadas: 0, novas: 0, atualizadas: 0, divergentes: [] as any[], erros: [] as any[], semConta: [] as any[], parcelasLigadas: 0, parcelasSemConta: 0, fornecedoresNovos: 0, porSituacao: {} as any, porMes: {} as any, total: 0, maiorNumero: 0 };
  const cacheForn = new Map<string, number>();

  async function fornecedor(idBling: string): Promise<number> {
    if (cacheForn.has(idBling)) return cacheForn.get(idBling)!;
    let c = await prisma.contato.findUnique({ where: { blingId: idBling } });
    const info = fornecedoresBling[idBling];
    if (!c && info?.nome) {
      const nome = info.nome.replace(/\s+/g, ' ').trim();
      const porNome = await prisma.contato.findFirst({ where: { nome } });
      if (porNome) {
        c = porNome.blingId ? porNome : await prisma.contato.update({ where: { id: porNome.id }, data: { blingId: idBling, tipo: porNome.tipo === 'CLIENTE' ? 'AMBOS' : porNome.tipo } });
      } else {
        const doc = somenteDigitos(info.doc || '');
        c = await prisma.contato.create({ data: { tipo: 'FORNECEDOR', tipoPessoa: info.tp || (doc.length === 14 ? 'J' : doc.length === 11 ? 'F' : 'J'), nome, documento: doc || null, blingId: idBling } });
        rel.fornecedoresNovos += 1;
      }
    }
    if (!c) throw new Error(`fornecedor ${idBling} sem nome no arquivo de fornecedores`);
    if (c.tipo === 'CLIENTE') await prisma.contato.update({ where: { id: c.id }, data: { tipo: 'AMBOS' } });
    cacheForn.set(idBling, c.id);
    return c.id;
  }

  let i = 0;
  for (const c of pedidos) {
    i += 1;
    const id = String(c.id);
    try {
      const problemas: string[] = [];
      if (typeof c.ni === 'number' && (c.itens || []).length !== c.ni) problemas.push(`itens ${(c.itens || []).length} ≠ ni ${c.ni}`);
      const somaParc = arredondar((c.parc || []).reduce((s: number, p: any) => s + Number(p.vlr || 0), 0));
      if ((c.parc || []).length && Math.abs(somaParc - Number(c.total)) > 0.05) problemas.push(`parcelas ${somaParc} ≠ total ${c.total}`);
      const ref = listagem.get(id);
      if (listagem.size && !ref) problemas.push('id não está na listagem');
      if (ref) {
        if (Math.abs(Number(ref.total) - Number(c.total)) > 0.005) problemas.push(`total ${c.total} ≠ listagem ${ref.total}`);
        if (Number(ref.numero) !== Number(c.numero)) problemas.push(`número ${c.numero} ≠ listagem ${ref.numero}`);
        if (ref.data && String(ref.data) !== String(c.data)) problemas.push(`data ${c.data} ≠ listagem ${ref.data}`);
        if (ref.situacao !== undefined && Number(ref.situacao) !== Number(c.sit)) problemas.push(`situação ${c.sit} ≠ listagem ${ref.situacao}`);
      }
      if (problemas.length) {
        rel.divergentes.push({ id, numero: c.numero, problemas });
        console.log(`  ! compra ${c.numero} (${id}) NÃO gravada: ${problemas.join('; ')}`);
        continue;
      }
      const sit = sits.get(NOME_SIT[Number(c.sit)] || 'Em aberto')!;
      const total = arredondar(Number(c.total));
      rel.gravadas += 1;
      rel.total = arredondar(rel.total + total);
      const pS = (rel.porSituacao[sit.nome] ||= { q: 0, t: 0 });
      pS.q += 1; pS.t = arredondar(pS.t + total);
      const mes = String(c.data).slice(0, 7);
      const pM = (rel.porMes[mes] ||= { q: 0, t: 0 });
      pM.q += 1; pM.t = arredondar(pM.t + total);
      rel.maiorNumero = Math.max(rel.maiorNumero, Number(c.numero));
      if (simular) continue;

      const fornecedorId = await fornecedor(String(c.forn));
      let ordem = 0;
      const itens = (c.itens || []).map((it: any) => ({
        codigoFornecedor: it.cf || it.cod || null,
        descricao: it.desc || 'Item',
        unidade: it.un || 'UN',
        quantidade: Number(it.qtd ?? 1),
        valorUnitario: Number(it.vlr || 0),
        ipiPct: Number(it.ipi || 0),
        total: arredondar(Number(it.qtd ?? 1) * Number(it.vlr || 0)),
        ordem: ordem++,
      }));
      const totalProdutos = arredondar(itens.reduce((s: number, x: any) => s + x.total, 0));
      const final = sit.final && !sit.cancelamento;
      const dados = {
        numero: Number(c.numero),
        data: dia(c.data) || new Date(),
        dataPrevista: dia(c.prev),
        fornecedorId,
        situacaoId: sit.id,
        depositoId: depPadrao?.id ?? null,
        categoriaFinanceiraId: catCmv?.id ?? null,
        ordemCompra: c.oc || null,
        totalProdutos: Number(c.totProd ?? totalProdutos),
        descontoValor: Number(c.desc || 0),
        frete: Number(c.frete || 0),
        outrasDespesas: Number(c.outras || 0),
        total,
        observacoes: c.obs || null,
        observacoesInternas: c.obsInt || null,
        estoqueLancado: final, // marca como já lançado: o estoque atual vem do Bling, não relançar
        contasLancadas: final,
      };
      const blingId = String(c.id);
      const existente = await prisma.compra.findUnique({ where: { blingId } });
      const conflito = await prisma.compra.findUnique({ where: { numero: dados.numero } });
      if (conflito && conflito.blingId !== blingId) throw new Error(`número ${dados.numero} já existe no sistema (compra id ${conflito.id})`);
      let compraId: number;
      if (existente) {
        await prisma.$transaction(async (tx) => {
          await tx.compraItem.deleteMany({ where: { compraId: existente.id } });
          await tx.compra.update({ where: { id: existente.id }, data: { ...dados, itens: { create: itens } } });
        });
        compraId = existente.id;
        rel.atualizadas += 1;
      } else {
        const nova = await prisma.compra.create({ data: { ...dados, blingId, itens: { create: itens } } });
        await prisma.historicoSituacao.create({ data: { entidadeTipo: 'COMPRA', entidadeId: nova.id, paraSituacaoId: sit.id, paraSituacao: sit.nome, observacao: 'Importada do Bling', data: dados.data } });
        compraId = nova.id;
        rel.novas += 1;
      }
      // parcelas (a ligação com as contas a pagar é feita depois, em religar())
      let np = 0;
      for (const p of c.parc || []) {
        np += 1;
        const parcela = await prisma.compraParcela.findFirst({ where: { compraId, numero: np } });
        if (!parcela) await prisma.compraParcela.create({ data: { compraId, numero: np, dataVencimento: dia(p.venc) || dados.data, valor: arredondar(Number(p.vlr)), observacoes: p.obs || null } });
      }
      if (i % 100 === 0) console.log(`  ${i}/${pedidos.length}`);
    } catch (e: any) {
      rel.erros.push({ id, numero: c?.numero, erro: e.message });
      console.log(`  ! compra ${c?.numero} (${id}): ${e.message}`);
    }
  }
  if (!simular) await religar(rel);
  if (!simular && rel.maiorNumero) {
    const seq = await prisma.sequencia.findUnique({ where: { nome: 'COMPRA' } });
    if (!seq || seq.valor < rel.maiorNumero) await prisma.sequencia.upsert({ where: { nome: 'COMPRA' }, create: { nome: 'COMPRA', valor: rel.maiorNumero }, update: { valor: rel.maiorNumero } });
  }
  console.log(`RESUMO compras: ${rel.gravadas} pedidos, total ${formatarMoeda(rel.total)} (novas ${rel.novas}, atualizadas ${rel.atualizadas}, fornecedores novos ${rel.fornecedoresNovos})`);
  for (const [s, m] of Object.entries<any>(rel.porSituacao)) console.log(`  ${s}: ${m.q} pedidos, ${formatarMoeda(m.t)}`);
  for (const [m, v] of Object.entries<any>(rel.porMes).sort()) console.log(`  ${m}: ${v.q} pedidos, ${formatarMoeda(v.t)}`);
  console.log(`  Parcelas ligadas a contas a pagar: ${rel.parcelasLigadas} | sem conta no relatório: ${rel.parcelasSemConta}`);
  console.log(JSON.stringify({ pedidos: pedidos.length, gravadas: rel.gravadas, divergentes: rel.divergentes.length, erros: rel.erros.length }));
  if (listagem.size) {
    const faltam = [...listagem.keys()].filter((k) => !porId.has(k));
    console.log(`Pedidos da listagem que não estão no arquivo: ${faltam.length}${faltam.length ? ' → ' + faltam.slice(0, 20).join(', ') : ''}`);
  }
  if (opt('--saida')) fs.writeFileSync(opt('--saida')!, JSON.stringify(rel, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
