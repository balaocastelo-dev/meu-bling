/**
 * Importa os ORÇAMENTOS (propostas comerciais) do Bling a partir de arquivo, orçamento a orçamento,
 * mantendo o MESMO NÚMERO que tinham no Bling. Os orçamentos criados direto no MEU BLING (sem blingId)
 * que ocupem a faixa de números do Bling são renumerados para logo depois do maior número do Bling,
 * na ordem em que foram criados, e a sequência ORCAMENTO é ajustada.
 *
 * Uso (em apps/api ou no container):
 *   npx tsx scripts/importar-orcamentos-arquivo.ts <propostas.jsonl> --listagem <lista.tsv> [--contatos <contatos.json>]
 *        [--saida <relatorio.json>] [--simular]
 *
 * propostas.jsonl — uma linha por proposta (lida com getProposal), formato compacto:
 *   {"id":..,"numero":..,"data":"AAAA-MM-DD","sit":"Rascunho","cli":<id contato>,"vend":<id vendedor>,
 *    "desc":0,"outras":0,"frete":0,"totProd":..,"total":..,"intro":"..","obs":"..","obsInt":"..",
 *    "prazo":"..","garantia":0,"cuidados":"..",
 *    "itens":[{"cod":"","desc":"..","det":"..","un":"UN","qtd":1,"vlr":..,"dsc":0,"prod":0}],
 *    "parc":[{"venc":"AAAA-MM-DD","vlr":..,"fp":0,"obs":""}]}
 * lista.tsv — listagem do Bling (id numero data situacao total totalProdutos contato) usada na conferência:
 *   proposta que não bate (número, data, total, situação) NÃO é gravada e vai para o relatório.
 * contatos.json — {"<id contato Bling>": {"nome","doc","tp","fone","cel","email"}} para clientes que ainda
 *   não existem no MEU BLING (lidos com getContact).
 *
 * Números repetidos no Bling (o Bling guarda versões antigas da mesma proposta com o mesmo número,
 * normalmente como "Não aprovado"): a versão principal (a que não está "Não aprovado"; empate → a mais
 * recente) fica com o número; as demais versões são registradas nas observações internas dela
 * (situação, data, total e itens), para nada se perder.
 *
 * Idempotente: upsert por blingId ("PROP-<id>"). Não mexe em estoque, contas, comissão nem nota.
 */
import fs from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { arredondar, formatarMoeda, somenteDigitos } from '../src/lib/util.js';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const valoresDeOpcao = new Set(['--listagem', '--contatos', '--saida'].map(opt).filter(Boolean));
const arquivo = args.find((a) => !a.startsWith('--') && !valoresDeOpcao.has(a));
const simular = flag('--simular');
if (!arquivo || !opt('--listagem')) {
  console.error('uso: importar-orcamentos-arquivo.ts <propostas.jsonl> --listagem <lista.tsv> [--contatos c.json] [--saida r.json] [--simular]');
  process.exit(2);
}

/** Situação do Bling → situação de orçamento do MEU BLING. */
const MAPA_SITUACAO: Record<string, string> = {
  rascunho: 'Em aberto',
  pendente: 'Enviado',
  aguardando: 'Enviado',
  aprovado: 'Aprovado',
  'nao aprovado': 'Reprovado',
  concluido: 'Convertido em venda',
  modelo: 'Em aberto',
};
const norm = (s: string) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
const PREFIXO = 'PROP-';
const num = (v: any, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const dataBling = (s?: string | null) => (s && !s.startsWith('0000') ? new Date(`${s.slice(0, 10)}T15:00:00.000Z`) : null);

function lerJsonl(caminho: string): any[] {
  const out: any[] = [];
  fs.readFileSync(caminho, 'utf8')
    .split(/\r?\n/)
    .forEach((l, i) => {
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

function lerListagem(caminho: string) {
  const m = new Map<string, { id: string; numero: number; data: string; situacao: string; total: number; totalProdutos: number; contato: string }>();
  for (const l of fs.readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    const [id, numero, data, situacao, total, totalProdutos, contato] = l.split('\t');
    m.set(id.trim(), { id: id.trim(), numero: num(numero), data: (data || '').trim(), situacao: (situacao || '').trim(), total: num(total), totalProdutos: num(totalProdutos), contato: (contato || '').trim() });
  }
  return m;
}

function textoItens(p: any) {
  return (p.itens || []).map((i: any) => `  - ${num(i.qtd, 1)} × ${i.desc} (${formatarMoeda(num(i.vlr))})`).join('\n');
}

async function main() {
  const listagem = lerListagem(opt('--listagem')!);
  const contatosArq: Record<string, any> = {};
  if (opt('--contatos')) {
    const cam = opt('--contatos')!;
    if (cam.endsWith('.jsonl')) for (const c of lerJsonl(cam)) { if (c?.id && c.nome) contatosArq[String(c.id)] = c; }
    else Object.assign(contatosArq, JSON.parse(fs.readFileSync(cam, 'utf8')));
  }
  const brutos = lerJsonl(arquivo!);
  const porId = new Map<string, any>();
  for (const p of brutos) if (p?.id) porId.set(String(p.id), p);
  console.log(`Arquivo: ${brutos.length} linhas, ${porId.size} propostas distintas · listagem: ${listagem.size}`);

  const relatorio: any = { gravados: 0, atualizados: 0, versoesAnexadas: 0, divergentes: [], erros: [], avisos: [], porSituacao: {}, renumerados: [] };

  // ---- conferência contra a listagem
  const validas: any[] = [];
  for (const [id, p] of porId) {
    const ref = listagem.get(id);
    const problemas: string[] = [];
    if (!ref) problemas.push('id não está na listagem do Bling');
    else {
      if (ref.numero !== num(p.numero)) problemas.push(`número ${p.numero} ≠ listagem ${ref.numero}`);
      if (ref.data && ref.data !== String(p.data).slice(0, 10)) problemas.push(`data ${p.data} ≠ listagem ${ref.data}`);
      if (Math.abs(ref.total - num(p.total)) > 0.005) problemas.push(`total ${p.total} ≠ listagem ${ref.total}`);
      if (norm(ref.situacao) !== norm(p.sit)) problemas.push(`situação ${p.sit} ≠ listagem ${ref.situacao}`);
    }
    const soma = arredondar((p.itens || []).reduce((s: number, i: any) => s + num(i.qtd, 1) * num(i.vlr), 0));
    if (Math.abs(soma - num(p.totProd)) > 0.05) relatorio.avisos.push({ id, numero: p.numero, aviso: `Σ itens ${soma} ≠ totalProdutos ${p.totProd}` });
    if (problemas.length) relatorio.divergentes.push({ id, numero: p.numero, problemas });
    else validas.push(p);
  }
  const faltam = [...listagem.keys()].filter((k) => !porId.has(k));
  if (faltam.length) console.log(`! ${faltam.length} propostas da listagem não estão no arquivo: ${faltam.slice(0, 15).join(', ')}${faltam.length > 15 ? ' …' : ''}`);
  relatorio.faltamNoArquivo = faltam;

  // ---- agrupa por número (versões)
  const grupos = new Map<number, any[]>();
  for (const p of validas) grupos.set(num(p.numero), [...(grupos.get(num(p.numero)) || []), p]);
  const principais: { p: any; versoes: any[] }[] = [];
  for (const [, g] of grupos) {
    g.sort((a, b) => {
      const na = norm(a.sit) === 'nao aprovado' ? 1 : 0;
      const nb = norm(b.sit) === 'nao aprovado' ? 1 : 0;
      return na - nb || Number(BigInt(b.id) - BigInt(a.id) > 0n ? 1 : -1);
    });
    principais.push({ p: g[0], versoes: g.slice(1) });
  }
  /** data de proposta sem data no Bling ("0000-00-00"): a da proposta de número anterior mais próximo */
  const datasPorNumero = [...listagem.values()].filter((l) => l.data && !l.data.startsWith('0000')).sort((a, b) => a.numero - b.numero);
  const dataVizinha = (n: number) => {
    const ant = [...datasPorNumero].reverse().find((l) => l.numero <= n) || datasPorNumero[0];
    return dataBling(ant?.data) || new Date();
  };
  const maiorBling = Math.max(0, ...[...listagem.values()].map((l) => l.numero));
  console.log(`Números distintos: ${principais.length} · com versões repetidas: ${principais.filter((x) => x.versoes.length).length} · maior número do Bling: ${maiorBling}`);

  // ---- situações
  const sits = await prisma.situacao.findMany({ where: { modulo: 'ORCAMENTO' } });
  const sitPorNome = new Map(sits.map((s) => [norm(s.nome), s]));
  const sitInicial = sits.find((s) => s.inicial) || sitPorNome.get('em aberto');
  if (!sitInicial) throw new Error('Situações de orçamento não encontradas (rode o seed).');
  const vendedores = await prisma.vendedor.findMany({ where: { blingId: { not: null } } });
  const vendPorBling = new Map(vendedores.map((v) => [v.blingId!, v.id]));
  const catVenda = await prisma.categoriaFinanceira.findFirst({ where: { grupoDre: 'RECEITA_BRUTA', nome: { contains: 'produto' } } });

  // ---- 1) renumera os orçamentos feitos no MEU BLING que estão na faixa do Bling
  const nativos = await prisma.venda.findMany({ where: { tipo: 'ORCAMENTO', blingId: null }, orderBy: [{ criadoEm: 'asc' }, { id: 'asc' }] });
  const precisam = nativos.filter((n) => n.numero <= maiorBling);
  if (precisam.length) {
    let proximo = Math.max(maiorBling, ...nativos.filter((n) => n.numero > maiorBling).map((n) => n.numero)) + 1;
    const plano = precisam.map((n) => ({ id: n.id, de: n.numero, para: proximo++ }));
    relatorio.renumerados = plano;
    for (const r of plano) console.log(`  orçamento do MEU BLING nº ${r.de} → nº ${r.para}`);
    if (!simular) {
      await prisma.$transaction(async (tx) => {
        for (const r of plano) await tx.venda.update({ where: { id: r.id }, data: { numero: -r.id } });
        for (const r of plano) {
          const atual = await tx.venda.findUniqueOrThrow({ where: { id: r.id }, select: { observacoesInternas: true } });
          await tx.venda.update({
            where: { id: r.id },
            data: { numero: r.para, observacoesInternas: [atual.observacoesInternas, `[Importação do Bling] Renumerado de nº ${r.de} para nº ${r.para} para seguir a numeração do Bling.`].filter(Boolean).join('\n') },
          });
        }
      });
    }
  }

  // ---- 2) grava os orçamentos do Bling
  let i = 0;
  for (const { p, versoes } of principais.sort((a, b) => num(a.p.numero) - num(b.p.numero))) {
    i += 1;
    const blingId = PREFIXO + p.id;
    try {
      const nomeSit = MAPA_SITUACAO[norm(p.sit)] || 'Em aberto';
      const situacao = sitPorNome.get(norm(nomeSit)) || sitInicial;
      // cliente
      const cliBling = String(p.cli || '');
      let contato = cliBling && cliBling !== '0' ? await prisma.contato.findUnique({ where: { blingId: cliBling } }) : null;
      if (!contato) {
        const c = contatosArq[cliBling];
        const doc = somenteDigitos(c?.doc);
        if (doc) contato = await prisma.contato.findFirst({ where: { documento: doc } });
        if (contato && !contato.blingId && !simular) await prisma.contato.update({ where: { id: contato.id }, data: { blingId: cliBling } }).catch(() => undefined);
        if (!contato && c?.nome) {
          if (simular) contato = { id: -1 } as any;
          else
            contato = await prisma.contato.create({
              data: {
                blingId: cliBling,
                nome: String(c.nome).trim(),
                documento: doc || null,
                tipoPessoa: c.tp === 'J' || doc.length === 14 ? 'J' : 'F',
                telefone: c.fone || null,
                celular: somenteDigitos(c.cel) || null,
                email: c.email || null,
              },
            });
        }
      }
      if (!contato && (!cliBling || cliBling === '0')) {
        // proposta sem cliente no Bling
        contato = await prisma.contato.findFirst({ where: { nome: 'Cliente não informado (Bling)' } });
        if (!contato && !simular) contato = await prisma.contato.create({ data: { nome: 'Cliente não informado (Bling)', observacoes: 'Criado na importação dos orçamentos do Bling para propostas sem cliente.' } });
        if (!contato && simular) contato = { id: -1 } as any;
      }
      if (!contato) throw new Error(`cliente ${cliBling || '(sem cliente)'} não encontrado`);
      const vendedorId = p.vend && String(p.vend) !== '0' ? vendPorBling.get(String(p.vend)) ?? null : null;
      // itens
      const itens = (p.itens || []).map((it: any, k: number) => {
        const qtd = num(it.qtd, 1);
        const unit = num(it.vlr);
        return {
          codigo: it.cod || null,
          descricao: [it.desc || 'Item', it.det ? String(it.det).trim() : ''].filter(Boolean).join(' — ').slice(0, 2000),
          unidade: (it.un || 'UN').trim() || 'UN',
          quantidade: qtd,
          valorUnitario: unit,
          desconto: 0,
          total: arredondar(qtd * unit),
          ordem: k,
        };
      });
      const parcelas: any[] = [];
      let np = 0;
      for (const pa of p.parc || []) {
        const fp = pa.fp && String(pa.fp) !== '0' ? await prisma.formaPagamento.findUnique({ where: { blingId: String(pa.fp) } }) : null;
        parcelas.push({ numero: ++np, dataVencimento: dataBling(pa.venc) || dataBling(p.data) || new Date(), valor: num(pa.vlr), formaPagamentoId: fp?.id ?? null, observacoes: pa.obs || null });
      }
      const totalProdutos = arredondar(itens.reduce((s: number, it: any) => s + it.total, 0));
      const frete = num(p.frete);
      const outras = num(p.outras);
      const total = num(p.total);
      const descontoValor = arredondar(Math.max(0, totalProdutos + frete + outras - total));
      const extras = [
        p.intro ? `Introdução: ${p.intro}` : '',
        p.prazo ? `Prazo de entrega: ${p.prazo}` : '',
        num(p.garantia) ? `Garantia: ${p.garantia}` : '',
        p.cuidados ? `Aos cuidados de: ${p.cuidados}` : '',
      ].filter(Boolean);
      const notasVersoes = versoes.map(
        (v) => `Versão anterior no Bling (id ${v.id}, ${v.sit}, ${String(v.data).slice(0, 10)}, ${formatarMoeda(num(v.total))}):\n${textoItens(v)}`,
      );
      const dados = {
        tipo: 'ORCAMENTO',
        numero: num(p.numero),
        data: dataBling(p.data) || dataVizinha(num(p.numero)),
        validade: null,
        contatoId: contato.id,
        vendedorId,
        situacaoId: situacao.id,
        categoriaFinanceiraId: catVenda?.id ?? null,
        origem: 'BALCAO',
        totalProdutos,
        descontoTipo: 'REAL',
        descontoValor,
        frete,
        outrasDespesas: outras,
        total,
        custoTotal: 0,
        observacoes: [p.obs, ...extras].filter(Boolean).join('\n') || null,
        observacoesInternas:
          [p.obsInt, `[Importado do Bling] Proposta nº ${p.numero} (id ${p.id}), situação no Bling: "${p.sit}".`, ...notasVersoes].filter(Boolean).join('\n\n') || null,
        estoqueLancado: false,
        contasLancadas: false,
      };
      const t = (relatorio.porSituacao[`${nomeSit} (Bling: ${p.sit})`] ||= { quantidade: 0, total: 0 });
      t.quantidade += 1;
      t.total = arredondar(t.total + total);
      relatorio.versoesAnexadas += versoes.length;
      if (simular) continue;

      const existente = await prisma.venda.findUnique({ where: { blingId } });
      const conflito = await prisma.venda.findUnique({ where: { tipo_numero: { tipo: 'ORCAMENTO', numero: dados.numero } } });
      if (conflito && conflito.blingId !== blingId) {
        if (conflito.blingId?.startsWith(PREFIXO)) {
          // outra versão do mesmo número gravada numa rodada anterior: troca pela principal
          await prisma.venda.delete({ where: { id: conflito.id } });
        } else throw new Error(`número ${dados.numero} já usado pelo orçamento id ${conflito.id}`);
      }
      if (existente) {
        await prisma.$transaction(async (tx) => {
          await tx.vendaItem.deleteMany({ where: { vendaId: existente.id } });
          await tx.vendaParcela.deleteMany({ where: { vendaId: existente.id, contaReceberId: null } });
          await tx.venda.update({ where: { id: existente.id }, data: { ...dados, itens: { create: itens }, parcelas: { create: parcelas } } });
        });
        relatorio.atualizados += 1;
      } else {
        const nova = await prisma.venda.create({ data: { ...dados, blingId, itens: { create: itens }, parcelas: { create: parcelas } } as any });
        await prisma.historicoSituacao.create({
          data: { entidadeTipo: 'ORCAMENTO', entidadeId: nova.id, paraSituacaoId: situacao.id, paraSituacao: situacao.nome, observacao: `Importado do Bling (lá: "${p.sit}")`, data: dados.data },
        });
        relatorio.gravados += 1;
      }
      if (i % 250 === 0) console.log(`  ${i}/${principais.length}`);
    } catch (e: any) {
      relatorio.erros.push({ id: p.id, numero: p.numero, erro: e.message });
      console.log(`  ! proposta ${p.numero} (${p.id}): ${e.message}`);
    }
  }

  // ---- 3) sequência
  if (!simular) {
    const maior = await prisma.venda.aggregate({ where: { tipo: 'ORCAMENTO' }, _max: { numero: true } });
    const valor = maior._max.numero || 0;
    await prisma.sequencia.upsert({ where: { nome: 'ORCAMENTO' }, create: { nome: 'ORCAMENTO', valor }, update: { valor } });
    relatorio.sequencia = valor;
    relatorio.noSistema = await prisma.venda.count({ where: { tipo: 'ORCAMENTO', blingId: { startsWith: PREFIXO } } });
  }
  relatorio.resumo = {
    propostasNoArquivo: porId.size,
    numerosDistintos: principais.length,
    gravados: relatorio.gravados,
    atualizados: relatorio.atualizados,
    versoesAnexadas: relatorio.versoesAnexadas,
    divergentes: relatorio.divergentes.length,
    erros: relatorio.erros.length,
    avisos: relatorio.avisos.length,
    faltamNoArquivo: faltam.length,
    renumerados: relatorio.renumerados.length,
    sequencia: relatorio.sequencia,
  };
  if (opt('--saida')) fs.writeFileSync(opt('--saida')!, JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify(relatorio.resumo));
  for (const [s, m] of Object.entries(relatorio.porSituacao) as any) console.log(`  ${s}: ${m.quantidade} · ${formatarMoeda(m.total)}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERRO', e);
  process.exit(1);
});
