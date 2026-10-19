/**
 * Importa pedidos de venda do Bling a partir de um ARQUIVO (JSONL ou JSON), pedido a pedido,
 * sem precisar conectar a API/OAuth do Bling. Usa as mesmas regras da importação pela API
 * (upsert por id do Bling, situações, contas a receber e lançamento no Caixa).
 *
 * Uso (dentro do container ou em apps/api):
 *   npx tsx scripts/importar-vendas-arquivo.ts <arquivo.jsonl|.json> [--fechar-em-aberto] [--baixar-no-caixa]
 *        [--listagem <bling-vendas.json>] [--saida <relatorio.json>] [--simular]
 *
 * Formatos aceitos por linha/elemento:
 *   a) o objeto `data` de GET /pedidos/vendas/{id} da API v3 do Bling (formato bruto);
 *   b) o formato COMPACTO abaixo (gerado pedido a pedido):
 *      {"id":..,"numero":..,"data":"AAAA-MM-DD","saida":"AAAA-MM-DD","sit":6,
 *       "cli":{"id":..,"nome":"..","doc":"..","tp":"F"},"vend":..,"cat":..,"loja":0,"nloja":"",
 *       "totProd":..,"total":..,"desc":0,"descUn":"REAL","frete":0,"freteConta":0,"outras":0,
 *       "obs":"[PADRAO]"|"texto","obsInt":"..","ni":2,
 *       "itens":[{"prod":..,"cod":"","desc":"..","qtd":1,"vlr":..,"dsc":0,"comPct":0,"comVlr":0}],
 *       "parc":[{"venc":"AAAA-MM-DD","vlr":..,"fp":..,"obs":".."}],"transp":{"id":0,"nome":".."}}
 *
 * --listagem: JSON (array) com {id,numero,data,total,situacao} vindo da listagem do Bling; cada pedido do
 *             arquivo é conferido contra ela (total/número/data) e, se divergir, NÃO é gravado (vai para o relatório).
 */
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, formatarMoeda } from '../src/lib/util.js';
import { prepararContextoVendas, gravarPedidoVendaBling, finalizarVendas } from '../src/integracoes/bling/importador.js';

const OBS_PADRAO =
  'Balão da Informática, a maior REDE de lojas de informática do país.\n\n* Presente em mais de 50 cidades\n* Mais de 500 funcionários pelo Brasil\n* Estoque nos principais pólos Logísticos do País\n* Parceria com as melhores empresas de Logísticas do país - Sedex, Jadlog, Melhor envio, Mercado Envios';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const arquivo = args.find((a) => !a.startsWith('--') && a !== opt('--listagem') && a !== opt('--saida'));
if (!arquivo) {
  console.error('Informe o arquivo (.jsonl ou .json).');
  process.exit(2);
}

/** Converte o formato compacto para o formato bruto da API v3. */
function expandir(c: any): any {
  if (!('cli' in c)) return c; // já está no formato bruto
  return {
    id: c.id,
    numero: c.numero,
    data: c.data,
    dataSaida: c.saida || undefined,
    dataPrevista: c.prev || undefined,
    situacao: { id: c.sit },
    contato: { id: c.cli?.id, nome: c.cli?.nome, numeroDocumento: c.cli?.doc || '', tipoPessoa: c.cli?.tp || '' },
    vendedor: c.vend ? { id: c.vend } : undefined,
    categoria: c.cat ? { id: c.cat } : undefined,
    loja: { id: c.loja || 0 },
    numeroLoja: c.nloja || '',
    totalProdutos: c.totProd,
    total: c.total,
    desconto: { unidade: c.descUn || 'REAL', valor: c.desc || 0 },
    outrasDespesas: c.outras || 0,
    observacoes: c.obs === '[PADRAO]' ? OBS_PADRAO : c.obs || '',
    observacoesInternas: c.obsInt || '',
    transporte: { frete: c.frete || 0, fretePorConta: c.freteConta ?? 9, contato: c.transp?.id ? { id: c.transp.id, nome: c.transp.nome } : undefined },
    itens: (c.itens || []).map((i: any) => ({
      produto: i.prod ? { id: i.prod } : undefined,
      codigo: i.cod || '',
      descricao: i.desc,
      unidade: i.un || '',
      quantidade: i.qtd,
      valor: i.vlr,
      desconto: i.dsc || 0,
      comissao: { aliquota: i.comPct || 0, valor: i.comVlr || 0 },
    })),
    parcelas: (c.parc || []).map((p: any) => ({ dataVencimento: p.venc, valor: p.vlr, formaPagamento: p.fp ? { id: p.fp } : undefined, observacoes: p.obs || '' })),
  };
}

function lerPedidos(caminho: string): any[] {
  const texto = fs.readFileSync(caminho, 'utf8');
  if (caminho.endsWith('.json')) {
    const j = JSON.parse(texto);
    return Array.isArray(j) ? j : j.data || [];
  }
  const out: any[] = [];
  texto.split(/\r?\n/).forEach((l, i) => {
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

async function main() {
  const simular = flag('--simular');
  const pedidosBrutos = lerPedidos(arquivo!);
  // dedup por id (mantém a última ocorrência)
  const porId = new Map<string, any>();
  for (const p of pedidosBrutos) if (p?.id) porId.set(String(p.id), p);
  const pedidos = [...porId.values()];
  console.log(`Arquivo ${arquivo}: ${pedidosBrutos.length} registros, ${pedidos.length} pedidos distintos`);

  const listagemPath = opt('--listagem');
  const listagem = new Map<string, any>();
  if (listagemPath) {
    for (const l of lerPedidos(listagemPath)) listagem.set(String(l.id), l);
    console.log(`Listagem de conferência: ${listagem.size} pedidos`);
  }

  const ctx = await prepararContextoVendas({ fecharEmAberto: flag('--fechar-em-aberto'), baixarNoCaixa: flag('--baixar-no-caixa') }, (m) => console.log(m));
  const relatorio: any = { gravados: [], divergentes: [], erros: [], inicio: new Date().toISOString() };
  let i = 0;
  for (const c of pedidos) {
    i += 1;
    const v = expandir(c);
    const id = String(v.id);
    try {
      // conferências de consistência (transcrição pedido a pedido)
      const problemas: string[] = [];
      if ('cli' in c && typeof c.ni === 'number' && (c.itens || []).length !== c.ni) problemas.push(`itens: ${(c.itens || []).length} ≠ ni ${c.ni}`);
      const somaParc = arredondar((v.parcelas || []).reduce((s: number, p: any) => s + Number(p.valor || 0), 0));
      if ((v.parcelas || []).length && Math.abs(somaParc - Number(v.total)) > 0.05) problemas.push(`parcelas ${somaParc} ≠ total ${v.total}`);
      const ref = listagem.get(id);
      if (listagemPath && !ref) problemas.push('id não está na listagem do Bling');
      if (ref) {
        if (Math.abs(Number(ref.total) - Number(v.total)) > 0.005) problemas.push(`total ${v.total} ≠ listagem ${ref.total}`);
        if (Number(ref.numero) !== Number(v.numero)) problemas.push(`número ${v.numero} ≠ listagem ${ref.numero}`);
        if (ref.data && v.data && String(ref.data) !== String(v.data)) problemas.push(`data ${v.data} ≠ listagem ${ref.data}`);
        if (ref.situacao !== undefined && v.situacao?.id !== undefined && Number(ref.situacao) !== Number(v.situacao.id)) problemas.push(`situação ${v.situacao.id} ≠ listagem ${ref.situacao}`);
      }
      if (problemas.length) {
        relatorio.divergentes.push({ id, numero: v.numero, problemas });
        console.log(`  ! pedido ${v.numero} (${id}) NÃO gravado: ${problemas.join('; ')}`);
        continue;
      }
      if (simular) {
        relatorio.gravados.push({ id, numero: v.numero, total: v.total, simulado: true });
        continue;
      }
      const g = await gravarPedidoVendaBling(v, ctx);
      relatorio.gravados.push({ id, numero: g.numero, total: g.total, novo: g.novo, fechada: g.fechada, caixa: g.caixa });
      if (i % 50 === 0) console.log(`  ${i}/${pedidos.length} — ${ctx.totais.quantidade} gravadas, ${formatarMoeda(ctx.totais.total)}`);
    } catch (e: any) {
      relatorio.erros.push({ id, numero: v?.numero, erro: e.message });
      console.log(`  ! pedido ${v?.numero} (${id}): ${e.message}`);
    }
  }
  if (!simular) await finalizarVendas(ctx, ` (arquivo ${path.basename(arquivo!)})`);
  relatorio.fim = new Date().toISOString();
  relatorio.totais = ctx.totais;
  relatorio.resumo = { pedidos: pedidos.length, gravados: relatorio.gravados.length, divergentes: relatorio.divergentes.length, erros: relatorio.erros.length };
  const saida = opt('--saida');
  if (saida) fs.writeFileSync(saida, JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio.resumo));
  if (listagemPath) {
    const faltam = [...listagem.keys()].filter((k) => !porId.has(k));
    console.log(`Pedidos da listagem que não estão no arquivo: ${faltam.length}${faltam.length ? ' → ' + faltam.slice(0, 20).join(', ') + (faltam.length > 20 ? ' …' : '') : ''}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
