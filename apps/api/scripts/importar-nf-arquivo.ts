/**
 * Importa NF-e do Bling a partir de arquivos (JSONL compacto, ver lotes-nf/INSTRUCOES.md), nota a nota.
 * Uso: npx tsx scripts/importar-nf-arquivo.ts <nf.jsonl> [--listagem <json>] [--saida <json>] [--simular] [--sem-vinculo]
 *
 * - grava NotaFiscal + itens (upsert por blingId); XML não é baixado (guarda o link do DANFE);
 * - cria/reaproveita o contato (blingId → documento → nome);
 * - vincula cada NF de saída autorizada à venda correspondente (mesmo total, data até 3 dias antes da NF e
 *   mesmo cliente — só quando o par é único) e move a venda para "NF emitida" SEM executar ações da situação
 *   (nada de estoque/contas/NF nova);
 * - ajusta a numeração da série.
 */
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, formatarMoeda, somenteDigitos } from '../src/lib/util.js';

const args = process.argv.slice(2);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const usados = new Set(['--listagem', '--saida'].map(opt).filter(Boolean));
const arquivo = args.find((a) => !a.startsWith('--') && !usados.has(a));
const simular = args.includes('--simular');
if (!arquivo) throw new Error('Uso: importar-nf-arquivo.ts <nf.jsonl> [--listagem json] [--saida json] [--simular]');

const SIT: Record<number, string> = { 0: 'PENDENTE', 1: 'PENDENTE', 2: 'CANCELADA', 3: 'PROCESSANDO', 4: 'REJEITADA', 5: 'AUTORIZADA', 6: 'AUTORIZADA', 7: 'AUTORIZADA', 8: 'PROCESSANDO', 9: 'DENEGADA', 10: 'PROCESSANDO', 11: 'ERRO' };
const dh = (s?: string) => (!s || s.startsWith('0000') ? null : new Date(`${s.replace(' ', 'T')}-03:00`));
const dia = (d: Date) => d.toISOString().slice(0, 10);

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

async function contatoDe(c: any) {
  if (!c?.id) return null;
  const blingId = String(c.id);
  let ct = await prisma.contato.findUnique({ where: { blingId } });
  if (ct) return ct;
  const doc = somenteDigitos(c.doc || '');
  if (doc) ct = await prisma.contato.findFirst({ where: { documento: doc } });
  if (!ct && c.nome) ct = await prisma.contato.findFirst({ where: { nome: String(c.nome).replace(/\s+/g, ' ').trim() } });
  if (ct) return ct.blingId ? ct : prisma.contato.update({ where: { id: ct.id }, data: { blingId } });
  if (!c.nome) return null;
  const e = c.end || {};
  return prisma.contato.create({
    data: {
      blingId,
      nome: String(c.nome).replace(/\s+/g, ' ').trim(),
      documento: doc || null,
      tipoPessoa: doc.length === 14 ? 'J' : 'F',
      ie: c.ie && c.ie !== 'ISENTO' ? c.ie : null,
      ieIsento: c.ie === 'ISENTO',
      email: c.email || null,
      telefone: c.tel || null,
      logradouro: e.logr || null,
      numero: e.num || null,
      complemento: e.comp || null,
      bairro: e.bairro || null,
      cep: e.cep ? somenteDigitos(e.cep) : null,
      municipio: e.mun || null,
      uf: e.uf || null,
    },
  });
}

async function main() {
  const brutos = lerJsonl(arquivo!);
  const porId = new Map<string, any>();
  for (const n of brutos) if (n?.id) porId.set(String(n.id), n);
  const notas = [...porId.values()];
  console.log(`Arquivo ${arquivo}: ${brutos.length} registros, ${notas.length} notas distintas`);
  const listagem = new Map<string, any>();
  if (opt('--listagem')) for (const l of JSON.parse(fs.readFileSync(opt('--listagem')!, 'utf8'))) listagem.set(String(l.id), l);
  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { ambienteFiscal: true, serieNfe: true, proximoNumeroNfe: true } });

  const rel: any = { gravadas: 0, novas: 0, atualizadas: 0, divergentes: [] as any[], erros: [] as any[], total: 0, porSituacao: {} as any, porMes: {} as any, vinculadas: 0, vendasNfEmitida: 0, semVenda: [] as any[], ambiguas: [] as any[] };
  const sitNfEmitida = await prisma.situacao.findFirst({ where: { modulo: 'VENDA', nome: 'NF emitida' } });
  const vendas = simular || args.includes('--sem-vinculo') ? [] : await prisma.venda.findMany({ where: { blingId: { not: null }, notaId: null, situacao: { cancelamento: false } }, select: { id: true, numero: true, data: true, total: true, situacaoId: true, contato: { select: { documento: true, nome: true, blingId: true } } } });
  const usadas = new Set<number>();

  for (const n of notas) {
    const id = String(n.id);
    try {
      const problemas: string[] = [];
      if (typeof n.ni === 'number' && (n.itens || []).length !== n.ni) problemas.push(`itens ${(n.itens || []).length} ≠ ni ${n.ni}`);
      const ref = listagem.get(id);
      if (listagem.size && !ref) problemas.push('id não está na listagem');
      if (ref) {
        if (Number(ref.numero) !== Number(n.numero)) problemas.push(`número ${n.numero} ≠ listagem ${ref.numero}`);
        if (ref.situacao !== undefined && Number(ref.situacao) !== Number(n.sit)) problemas.push(`situação ${n.sit} ≠ listagem ${ref.situacao}`);
        if (ref.data && String(n.data).slice(0, 10) !== String(ref.data)) problemas.push(`data ${n.data} ≠ listagem ${ref.data}`);
      }
      const soma = arredondar((n.itens || []).reduce((s: number, i: any) => s + Number(i.tot || 0), 0));
      if ((n.itens || []).length && Math.abs(soma + Number(n.frete || 0) - Number(n.valor)) > 1.0 && Math.abs(soma - Number(n.valor)) > 1.0) problemas.push(`itens ${soma} (+frete ${n.frete || 0}) ≠ valor ${n.valor}`);
      if (problemas.length) {
        rel.divergentes.push({ id, numero: n.numero, problemas });
        console.log(`  ! NF ${n.numero} (${id}) NÃO gravada: ${problemas.join('; ')}`);
        continue;
      }
      const situacao = SIT[Number(n.sit)] || 'PENDENTE';
      const valor = arredondar(Number(n.valor));
      rel.gravadas += 1;
      rel.total = arredondar(rel.total + valor);
      const pS = (rel.porSituacao[situacao] ||= { q: 0, t: 0 });
      pS.q += 1; pS.t = arredondar(pS.t + valor);
      const mes = String(n.data).slice(0, 7);
      const pM = (rel.porMes[mes] ||= { q: 0, t: 0 });
      pM.q += 1; pM.t = arredondar(pM.t + valor);
      if (simular) continue;

      const contato = await contatoDe(n.cli);
      const chave = n.chave ? somenteDigitos(n.chave) : '';
      const emissao = dh(n.data) || new Date();
      const dados = {
        tipo: Number(n.tipo ?? 1),
        modelo: 55,
        serie: Number(n.serie || 1),
        numero: Number(n.numero),
        chave: chave.length === 44 ? chave : null,
        situacao,
        ambiente: empresa?.ambienteFiscal ?? 1,
        dataEmissao: emissao,
        dataSaida: dh(n.op),
        dataAutorizacao: situacao === 'AUTORIZADA' ? emissao : null,
        contatoId: contato?.id ?? null,
        naturezaOperacao: Number(n.tipo ?? 1) === 1 ? 'Venda de mercadoria' : 'Entrada de mercadoria',
        valorProdutos: soma || valor,
        valorFrete: Number(n.frete || 0),
        valorTotal: valor,
        fretePorConta: Number(n.fc ?? 9),
        informacoesComplementares: n.obs || null,
        urlChave: n.link || null,
        motivo: 'Importada do Bling (XML não baixado)',
      };
      const itens = (n.itens || []).map((it: any, k: number) => ({
        numeroItem: k + 1,
        codigo: it.cod || String(k + 1),
        gtin: it.gtin || null,
        descricao: it.desc || 'Item',
        ncm: String(it.ncm || '').replace(/\D/g, '') || '00000000',
        cest: it.cest || null,
        cfop: String(it.cfop || '5102'),
        unidade: it.un || 'UN',
        quantidade: Number(it.qtd ?? 1),
        valorUnitario: Number(it.vlr || 0),
        valorTotal: Number(it.tot ?? Number(it.qtd ?? 1) * Number(it.vlr || 0)),
        origem: Number(it.orig || 0),
        icmsAliquota: Number(it.icmsAliq || 0),
        icmsValor: Number(it.icms || 0),
        valorTributosAprox: Number(it.trib || 0),
        informacoesAdicionais: it.info || null,
      }));
      const blingId = String(n.id);
      const existente = (await prisma.notaFiscal.findUnique({ where: { blingId } })) || (dados.chave ? await prisma.notaFiscal.findUnique({ where: { chave: dados.chave } }) : null) || (await prisma.notaFiscal.findUnique({ where: { modelo_serie_numero: { modelo: 55, serie: dados.serie, numero: dados.numero } } }));
      let notaId: number;
      if (existente) {
        await prisma.$transaction(async (tx) => {
          await tx.notaFiscalItem.deleteMany({ where: { notaId: existente.id } });
          await tx.notaFiscal.update({ where: { id: existente.id }, data: { ...dados, blingId, itens: { create: itens } } });
        });
        notaId = existente.id;
        rel.atualizadas += 1;
      } else {
        notaId = (await prisma.notaFiscal.create({ data: { ...dados, blingId, itens: { create: itens } } })).id;
        rel.novas += 1;
      }

      // vínculo com a venda
      if (dados.tipo === 1 && situacao === 'AUTORIZADA' && valor > 0 && vendas.length) {
        const docNf = somenteDigitos(n.cli?.doc || '');
        const nomeNf = String(n.cli?.nome || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const cands = vendas.filter((v) => {
          if (usadas.has(v.id) || Math.abs(v.total - valor) > 0.005) return false;
          const dd = (emissao.getTime() - v.data.getTime()) / 86400000;
          if (dd < -1 || dd > 3.5) return false;
          const docV = somenteDigitos(v.contato?.documento || '');
          if (docNf && docV) return docNf === docV;
          return String(v.contato?.nome || '').toLowerCase().replace(/\s+/g, ' ').trim() === nomeNf || (!!n.cli?.id && String(n.cli.id) === v.contato?.blingId);
        });
        if (cands.length === 1) {
          const v = cands[0];
          usadas.add(v.id);
          await prisma.venda.update({ where: { id: v.id }, data: { notaId, ...(sitNfEmitida && v.situacaoId !== sitNfEmitida.id ? { situacaoId: sitNfEmitida.id } : {}) } });
          if (sitNfEmitida && v.situacaoId !== sitNfEmitida.id) {
            await prisma.historicoSituacao.create({ data: { entidadeTipo: 'VENDA', entidadeId: v.id, deSituacaoId: v.situacaoId, paraSituacaoId: sitNfEmitida.id, paraSituacao: sitNfEmitida.nome, observacao: `NF-e nº ${dados.numero} emitida (migração do Bling)` } });
            rel.vendasNfEmitida += 1;
          }
          rel.vinculadas += 1;
        } else if (cands.length > 1) rel.ambiguas.push({ nota: dados.numero, valor, vendas: cands.map((c) => c.numero) });
        else rel.semVenda.push({ nota: dados.numero, valor, cliente: n.cli?.nome, data: String(n.data).slice(0, 10) });
      }
    } catch (e: any) {
      rel.erros.push({ id, numero: n?.numero, erro: e.message });
      console.log(`  ! NF ${n?.numero} (${id}): ${e.message}`);
    }
  }
  if (!simular) {
    const ultima = await prisma.notaFiscal.findFirst({ where: { modelo: 55, tipo: 1 }, orderBy: [{ serie: 'desc' }, { numero: 'desc' }] });
    if (ultima && empresa && ultima.serie === empresa.serieNfe && ultima.numero >= empresa.proximoNumeroNfe) await prisma.empresa.update({ where: { id: 1 }, data: { proximoNumeroNfe: ultima.numero + 1 } });
  }
  console.log(`RESUMO NF-e: ${rel.gravadas} notas, total ${formatarMoeda(rel.total)} (novas ${rel.novas}, atualizadas ${rel.atualizadas})`);
  for (const [s, m] of Object.entries<any>(rel.porSituacao)) console.log(`  ${s}: ${m.q} notas, ${formatarMoeda(m.t)}`);
  for (const [m, v] of Object.entries<any>(rel.porMes).sort()) console.log(`  ${m}: ${v.q} notas, ${formatarMoeda(v.t)}`);
  console.log(`  Vinculadas a vendas: ${rel.vinculadas} (vendas movidas p/ NF emitida: ${rel.vendasNfEmitida}) | sem venda: ${rel.semVenda.length} | ambíguas: ${rel.ambiguas.length}`);
  console.log(JSON.stringify({ notas: notas.length, gravadas: rel.gravadas, divergentes: rel.divergentes.length, erros: rel.erros.length }));
  if (listagem.size) {
    const faltam = [...listagem.keys()].filter((k) => !porId.has(k));
    console.log(`Notas da listagem que não estão no arquivo: ${faltam.length}${faltam.length ? ' → ' + faltam.slice(0, 20).join(', ') : ''}`);
  }
  if (opt('--saida')) fs.writeFileSync(opt('--saida')!, JSON.stringify(rel, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
