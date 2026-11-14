/**
 * Sincronização de contas a pagar com JSON fixo.
 * Não chama a API do Bling e não abre o banco da loja: o SQLite nasce numa pasta temporária.
 *
 * A listagem do arquivo não tem saldo. O detalhe tem. O valor pago sai do detalhe.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encerrar, igual, secao, verifica } from './lib.js';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-bling-cp-'));
const arquivo = path.join(pasta, 'teste.db');
const urlBanco = `file:${arquivo}`;

if (!arquivo.startsWith(os.tmpdir()) || /meubling|\/data\//i.test(arquivo)) {
  console.error('Recusa: o banco do teste não é temporário.');
  process.exit(1);
}

process.env.DATABASE_URL = urlBanco;
process.env.TRILHA_AUDITORIA = 'off';
process.env.STORAGE_DIR = path.join(pasta, 'storage');
process.env.TZ = 'America/Sao_Paulo';

const fixture = JSON.parse(fs.readFileSync(path.join(API, 'testes/fixtures/contas-pagar-bling.json'), 'utf8'));

type Params = Record<string, string | number | undefined>;
function semSaldo(itens: any[], onde: string) {
  for (const item of itens) {
    if (item && Object.prototype.hasOwnProperty.call(item, 'saldo')) throw new Error(`${onde} não pode trazer saldo (id ${item.id})`);
  }
}
function cliente(opts: {
  listas?: Record<string, any[]>;
  detalhes?: Record<string, any>;
  periodo?: { emissao: any[]; vencimento: any[]; pagamento: any[] };
  repetir?: boolean;
  falharPagina?: number;
}) {
  const chamadas: { caminho: string; params: Params }[] = [];
  return {
    chamadas,
    async get(caminho: string, params: Params = {}) {
      chamadas.push({ caminho, params: { ...params } });
      if (caminho.startsWith('/contas/pagar/')) {
        const id = caminho.slice('/contas/pagar/'.length);
        const d = opts.detalhes?.[id];
        if (!d) throw new Error(`sem detalhe ${id}`);
        return { data: d };
      }
      const limite = Number(params.limite || 100);
      const pagina = Number(params.pagina || 1);
      if (opts.falharPagina && pagina === opts.falharPagina) throw new Error('timeout na página');
      let lista: any[] = [];
      if (params.dataEmissaoInicial) lista = opts.periodo?.emissao || [];
      else if (params.dataVencimentoInicial) lista = opts.periodo?.vencimento || [];
      else if (params.dataPagamentoInicial) lista = opts.periodo?.pagamento || [];
      else if (params.situacao != null) lista = opts.listas?.[String(params.situacao)] || [];
      const inicio = opts.repetir ? 0 : (pagina - 1) * limite;
      return { data: lista.slice(inicio, inicio + limite) };
    },
  };
}

const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  cwd: API,
  env: { ...process.env, DATABASE_URL: urlBanco, TRILHA_AUDITORIA: 'off' },
  stdio: 'inherit',
});
if (push.status !== 0) process.exit(push.status || 1);

const { sincronizarContasPagar, leitorPadraoContasPagar, mapearSituacaoBling } = await import('../src/integracoes/bling/contas-pagar.js');
const { blingGet, paginaJaVista } = await import('../src/integracoes/bling/cliente.js');
const { prisma } = await import('../src/lib/prisma.js');

if (process.env.DATABASE_URL !== urlBanco) {
  console.error('Recusa: DATABASE_URL não é o banco temporário.');
  process.exit(1);
}

const dia = (iso: string) => new Date(`${iso}T12:00:00`);
const linha = (rel: any, tabela: 'porSituacaoBling' | 'porSituacaoMeuBling', situacao: string) => rel[tabela].find((l: any) => l.situacao === situacao);

const originalFetch = globalThis.fetch;
let rede = 0;
globalThis.fetch = async (input: any, init?: any) => {
  const alvo = String(input);
  if (/bling\.com\.br/i.test(alvo)) {
    rede += 1;
    throw new Error(`teste bloqueou a API do Bling: ${alvo}`);
  }
  return originalFetch(input, init);
};

try {
  secao('Mapa da situação e paginação');
  verifica(mapearSituacaoBling(4).situacao === 'DEVOLVIDO', 'situação 4 é devolvido, não cancelado');
  verifica(mapearSituacaoBling(3).situacao === 'PARCIAL', 'situação 3 é parcial');
  verifica(mapearSituacaoBling(6).situacao === 'NAO_MAPEADA' && !!mapearSituacaoBling(6).registrar, 'situação 6 fica registrada, sem cair em aberto');
  verifica(mapearSituacaoBling(7).situacao === 'NAO_MAPEADA' && !!mapearSituacaoBling(7).registrar, 'situação 7 fica registrada, sem cair em aberto');
  verifica(paginaJaVista(['1', '2'], new Set(['1', '2'])), 'página cujos ids já foram vistos é repetida');
  verifica(!paginaJaVista(['1', '3'], new Set(['1', '2'])), 'página com título novo não é repetida');
  verifica(!paginaJaVista([], new Set(['1'])), 'página vazia não é página repetida');
  verifica(leitorPadraoContasPagar === blingGet, 'a sincronização usa o cliente do Bling, com o limite de 3 req/s');
  const src = fs.readFileSync(path.join(API, 'src/integracoes/bling/contas-pagar.ts'), 'utf8');
  verifica(!/\bfetch\s*\(/.test(src), 'o módulo não chama a rede por conta própria');

  for (const [sit, itens] of Object.entries(fixture.listagem as Record<string, any[]>)) semSaldo(itens, `listagem ${sit}`);
  semSaldo(fixture.periodo.emissao, 'emissão');
  semSaldo(fixture.periodo.vencimento, 'vencimento');
  semSaldo(fixture.periodo.pagamento, 'pagamento');
  semSaldo(fixture.paginaRepetida, 'página repetida');
  for (const [id, d] of Object.entries(fixture.detalhes as Record<string, any>)) {
    if (id === '113') verifica(!('saldo' in d), 'o detalhe 113 propositalmente não traz saldo');
    else verifica('saldo' in d, `detalhe ${id} traz saldo`);
  }
  verifica(!('saldo' in fixture.listagem['3'][0]) && fixture.detalhes['101'].saldo === 80, 'listagem 101 sem saldo e detalhe com saldo 80');

  if ((await prisma.contato.count()) !== 0) throw new Error('O banco temporário não está vazio. Não vou continuar.');

  secao('Base local');
  const fornecedor = await prisma.contato.create({ data: { nome: 'Fornecedor Alfa', tipo: 'FORNECEDOR', tipoPessoa: 'J', blingId: '900' } });
  const banco = await prisma.contaFinanceira.create({ data: { nome: 'Banco Alfa', tipo: 'BANCO', blingId: '77' } });
  await prisma.contaPagar.create({
    data: { contatoId: fornecedor.id, descricao: 'Compra nº 10 (1/1)', dataEmissao: dia('2026-03-01'), vencimento: dia('2026-03-15'), valor: 150, situacao: 'ABERTO', origemTipo: 'COMPRA', origemId: 42 },
  });
  await prisma.contaPagar.create({
    data: { blingId: '102', contatoId: fornecedor.id, descricao: 'Internet antiga', dataEmissao: dia('2026-02-01'), vencimento: dia('2026-02-10'), valor: 50, valorPago: 0, situacao: 'ABERTO', origemTipo: 'MANUAL' },
  });
  const energia = await prisma.contaPagar.create({
    data: { blingId: '110', contatoId: fornecedor.id, descricao: 'Energia antiga', dataEmissao: dia('2026-01-05'), vencimento: dia('2026-01-15'), valor: 90, valorPago: 40, situacao: 'PARCIAL', origemTipo: 'MANUAL', observacoes: 'nota da loja' },
  });
  await prisma.movimentoFinanceiro.create({
    data: { contaFinanceiraId: banco.id, tipo: 'SAIDA', valor: 40, descricao: 'Pagamento no meu-bling', contaPagarId: energia.id, data: dia('2026-01-10') },
  });
  await prisma.contaPagar.create({
    data: { contatoId: fornecedor.id, descricao: 'Compra A', dataEmissao: dia('2026-03-20'), vencimento: dia('2026-04-01'), valor: 40, situacao: 'ABERTO', origemTipo: 'COMPRA', origemId: 7 },
  });
  await prisma.contaPagar.create({
    data: { contatoId: fornecedor.id, descricao: 'Compra B', dataEmissao: dia('2026-03-20'), vencimento: dia('2026-04-01'), valor: 40, situacao: 'ABERTO', origemTipo: 'COMPRA', origemId: 8 },
  });
  await prisma.contaPagar.create({
    data: { blingId: '999', descricao: 'Só no meu-bling', dataEmissao: dia('2026-08-01'), vencimento: dia('2026-08-01'), valor: 5, situacao: 'ABERTO', origemTipo: 'MANUAL' },
  });
  await prisma.contaPagar.create({
    data: { contatoId: fornecedor.id, descricao: 'Compra solta', dataEmissao: dia('2026-05-01'), vencimento: dia('2026-05-01'), valor: 7, situacao: 'ABERTO', origemTipo: 'COMPRA', origemId: 9 },
  });
  const antes = await prisma.contaPagar.count();
  const movimentosAntes = await prisma.movimentoFinanceiro.count();

  const opcoesBase = { leitor: cliente({ listas: fixture.listagem, detalhes: fixture.detalhes }), limitePagina: 2, tentativasPagina: 3, esperaRetryMs: 0 };

  secao('Prévia não grava');
  const previa = await sincronizarContasPagar({ ...opcoesBase, modo: 'previa' });
  verifica(!previa.gravado && previa.modo === 'previa', 'prévia não grava', previa.gravado);
  verifica(previa.lidos === 14 && previa.detalhes === 12, '14 títulos na listagem e 12 detalhes', { lidos: previa.lidos, detalhes: previa.detalhes });
  verifica(previa.consultas.length === 7 && previa.consultas[0] === 'situação 1' && previa.consultas[6] === 'situação 7', 'sem período, varre as situações 1 a 7', previa.consultas);
  verifica(previa.criados === 8 && previa.atualizados === 2 && previa.vinculados === 1 && previa.preservados === 1, '8 a criar, 2 a atualizar, 1 compra a vincular, 1 pagamento local preservado', previa);
  verifica(previa.erros.length === 2 && previa.erros.some((e: any) => e.blingId === '111') && previa.erros.some((e: any) => e.blingId === '113' && /saldo/.test(e.motivo)), 'erro por título: sem detalhe e detalhe sem saldo', previa.erros);
  verifica(previa.faltantes.some((f: any) => f.blingId === '101' && f.acao === 'criar') && previa.faltantes.some((f: any) => f.blingId === '112' && f.acao === 'ambiguo'), 'faltante parcial seria criado; duplicata ambígua não', previa.faltantes);
  verifica(previa.duplicatasProvaveis.length === 1 && previa.duplicatasProvaveis[0].contasLocais.length === 2, 'duas compras iguais ficam como duplicata provável', previa.duplicatasProvaveis);
  verifica(previa.sobrando.length === 2, 'sobram o título 999 e a compra solta', previa.sobrando);
  verifica(previa.situacoesRegistradas.some((s: any) => s.situacaoBling === 4) && previa.situacoesRegistradas.some((s: any) => s.situacaoBling === 6) && previa.situacoesRegistradas.some((s: any) => s.situacaoBling === 7), '4, 6 e 7 entram no log');
  verifica(previa.cadastrosMinimos.some((c: any) => c.tipo === 'fornecedor' && c.blingId === '901' && !c.criado), 'prévia avisa o fornecedor que seria criado, sem criar');
  verifica(previa.portadoresSemConta.some((p: any) => p.blingId === '109' && p.portadorBlingId === '78'), 'portador sem conta local entra no relatório');
  const parcial = linha(previa, 'porSituacaoBling', '3');
  verifica(parcial.quantidade === 1 && igual(parcial.soma, 200) && igual(parcial.saldo, 80), 'no Bling, o parcial soma 200 e o saldo é 80, não zero', parcial);
  verifica((await prisma.contaPagar.count()) === antes && (await prisma.contato.count({ where: { blingId: '901' } })) === 0, 'a prévia não criou conta nem fornecedor');
  verifica((await prisma.contaPagar.findFirst({ where: { valor: 150 } }))?.blingId == null, 'a compra de 150 continua sem id do Bling');

  secao('Período: união de emissão, vencimento e pagamento');
  const porPeriodo = cliente({ detalhes: fixture.detalhes, periodo: fixture.periodo });
  const periodo = await sincronizarContasPagar({ modo: 'previa', dataInicial: '2020-01-01', dataFinal: '2020-01-31', leitor: porPeriodo, limitePagina: 100, esperaRetryMs: 0 });
  const listagens = porPeriodo.chamadas.filter((c) => c.caminho === '/contas/pagar');
  verifica(listagens.length === 3 && listagens.every((c) => c.params.situacao == null), 'com período não filtra situação; são três janelas', listagens.map((c) => c.params));
  verifica(periodo.lidos === 4 && periodo.criados === 4 && !periodo.gravado, 'a união deduplica o título que aparece em mais de uma janela', { lidos: periodo.lidos, criados: periodo.criados });
  const detalhesPeriodo = porPeriodo.chamadas.filter((c) => c.caminho.startsWith('/contas/pagar/')).map((c) => c.caminho);
  verifica(new Set(detalhesPeriodo).size === 4 && detalhesPeriodo.length === 4, 'cada id do período gera um detalhe', detalhesPeriodo);
  verifica(periodo.sobrando.length === 0, 'títulos de 2026 não aparecem como sobra num período de 2020', periodo.sobrando);

  secao('Página repetida e página que falha');
  const repetida = cliente({ listas: { '1': fixture.paginaRepetida }, detalhes: fixture.detalhes, repetir: true });
  const rep = await sincronizarContasPagar({ modo: 'aplicar', leitor: repetida, limitePagina: 2, tentativasPagina: 3, esperaRetryMs: 0 });
  verifica(!!rep.interrompido && /repetiu/.test(rep.interrompido.motivo) && rep.interrompido.pagina === 2 && rep.interrompido.titulosLidos === 2, 'página repetida é erro explícito e informa até onde leu', rep.interrompido);
  verifica(!rep.gravado && rep.criados === 0 && (await prisma.contaPagar.count()) === antes, 'página repetida não grava');

  const quebrada = cliente({ listas: fixture.listagem, detalhes: fixture.detalhes, falharPagina: 2 });
  const quebra = await sincronizarContasPagar({ modo: 'aplicar', leitor: quebrada, limitePagina: 2, tentativasPagina: 3, esperaRetryMs: 0 });
  const paginas2 = quebrada.chamadas.filter((c) => c.caminho === '/contas/pagar' && Number(c.params.pagina) === 2);
  verifica(paginas2.length === 3, 'a página que falha é tentada de novo', paginas2.length);
  verifica(!!quebra.interrompido && quebra.interrompido.pagina === 2 && quebra.interrompido.titulosLidos === 2 && /3 tentativas/.test(quebra.interrompido.motivo), 'se a página continua falhando, para e diz até onde foi', quebra.interrompido);
  verifica(quebrada.chamadas.every((c) => c.params.situacao == null || c.params.situacao === '1'), 'não segue para a situação seguinte');
  verifica(!quebra.gravado && (await prisma.contaPagar.count()) === antes && (await prisma.movimentoFinanceiro.count()) === movimentosAntes, 'falha de página não grava e não cria movimento');

  secao('Aplicar');
  const aplicado = await sincronizarContasPagar({ ...opcoesBase, leitor: cliente({ listas: fixture.listagem, detalhes: fixture.detalhes }), modo: 'aplicar' });
  verifica(aplicado.gravado && aplicado.criados === 8 && aplicado.vinculados === 1 && aplicado.preservados === 1, 'aplicar grava os mesmos números da prévia', aplicado);
  verifica(aplicado.cadastrosMinimos.filter((c: any) => c.criado).length >= 3, 'cria fornecedor, categoria e forma que faltavam', aplicado.cadastrosMinimos);

  const c101 = await prisma.contaPagar.findUnique({ where: { blingId: '101' } });
  verifica(!!c101 && c101.situacao === 'PARCIAL' && igual(c101.valorPago, 120) && igual(c101.valor, 200) && c101.situacaoBling === 3, 'parcial usa o saldo do detalhe: pago 120, não o valor inteiro', c101 && { s: c101.situacao, pago: c101.valorPago, sit: c101.situacaoBling });
  verifica(c101?.contaFinanceiraId === banco.id, 'portador 77 vira a conta financeira do mesmo id do Bling');

  const c103 = await prisma.contaPagar.findUnique({ where: { blingId: '103' } });
  verifica(c103?.situacao === 'DEVOLVIDO' && c103.situacaoBling === 4 && c103.situacao !== 'CANCELADO', 'devolvido não vira cancelado', c103?.situacao);

  const c105 = await prisma.contaPagar.findUnique({ where: { blingId: '105' } });
  const c106 = await prisma.contaPagar.findUnique({ where: { blingId: '106' } });
  verifica(c105?.situacao === 'NAO_MAPEADA' && c105.situacaoBling === 6 && c105.situacao !== 'ABERTO', 'situação 6 não cai em aberto', c105?.situacao);
  verifica(c106?.situacao === 'NAO_MAPEADA' && c106.situacaoBling === 7 && igual(c106.valorPago, 8), 'situação 7 guarda o saldo do detalhe (pago 8 de 12)', c106 && { s: c106.situacao, pago: c106.valorPago });

  const c102 = await prisma.contaPagar.findUnique({ where: { blingId: '102' } });
  verifica(c102?.situacao === 'PAGO' && igual(c102.valorPago, 50) && c102.dataPagamento != null, 'pago no Bling atualiza valor pago, sem movimento de caixa', c102?.situacao);
  verifica((await prisma.movimentoFinanceiro.count({ where: { contaPagarId: c102?.id } })) === 0, 'pagamento antigo do Bling não gera saída no caixa');

  const c107 = await prisma.contaPagar.findFirst({ where: { valor: 150 } });
  const qtd150 = await prisma.contaPagar.count({ where: { valor: 150 } });
  verifica(qtd150 === 1 && c107?.blingId === '107' && c107.origemTipo === 'COMPRA' && c107.origemId === 42 && c107.descricao === 'Compra de monitores', 'compra sem id do Bling é vinculada, não duplicada', c107 && { id: c107.blingId, origem: c107.origemTipo, n: qtd150 });

  const novo = await prisma.contato.findUnique({ where: { blingId: '901' } });
  const c108 = await prisma.contaPagar.findUnique({ where: { blingId: '108' } });
  verifica(novo?.nome === 'Fornecedor Novo' && novo.tipo === 'FORNECEDOR' && c108?.contatoId === novo.id, 'fornecedor que falta nasce com o nome da listagem');
  const cat = await prisma.categoriaFinanceira.findUnique({ where: { blingId: '55' } });
  const forma = await prisma.formaPagamento.findUnique({ where: { blingId: '66' } });
  verifica(cat?.nome === 'Peças e acessórios' && cat.tipo === 'DESPESA' && forma?.nome === 'Boleto', 'categoria e forma nascem pelo id do Bling');

  const c109 = await prisma.contaPagar.findUnique({ where: { blingId: '109' } });
  verifica(!!c109?.recorrente && c109.descricao === 'Aluguel da loja' && /Competência: 2026-02/.test(c109.observacoes || '') && /Documento: NF-9/.test(c109.observacoes || '') && c109.contaFinanceiraId == null, 'recorrente, histórico na descrição, competência e documento nas observações', c109?.observacoes);

  const c110 = await prisma.contaPagar.findUnique({ where: { blingId: '110' } });
  verifica(c110?.situacao === 'PARCIAL' && igual(c110.valorPago, 40) && c110.descricao === 'Energia' && /nota da loja/.test(c110.observacoes || ''), 'com movimento local, não sobrescreve valor pago nem situação, mas atualiza a descrição', c110 && { s: c110.situacao, pago: c110.valorPago, d: c110.descricao });
  verifica(aplicado.divergencias.some((d: any) => d.blingId === '110' && d.campo === 'situacao' && d.preservado) && aplicado.divergencias.some((d: any) => d.blingId === '110' && d.campo === 'saldo' && d.preservado), 'a divergência do pagamento local fica no relatório', aplicado.divergencias.filter((d: any) => d.blingId === '110'));

  const compras40 = await prisma.contaPagar.findMany({ where: { valor: 40 } });
  verifica(compras40.length === 2 && compras40.every((c) => !c.blingId), 'duplicata ambígua não ganha outra conta nem um id do Bling', compras40.map((c) => c.blingId));
  verifica((await prisma.contaPagar.findUnique({ where: { blingId: '999' } }))?.descricao === 'Só no meu-bling', 'título que só existe aqui continua');
  verifica((await prisma.movimentoFinanceiro.count()) === movimentosAntes, 'nenhum movimento de caixa foi criado');
  verifica(!!c101?.sincronizadoEm && !!c103?.sincronizadoEm, 'sincronizadoEm é preenchido ao aplicar');

  const aberto = linha(aplicado, 'porSituacaoMeuBling', 'ABERTO');
  const parcLocal = linha(aplicado, 'porSituacaoMeuBling', 'PARCIAL');
  verifica(aberto.quantidade === 8 && igual(aberto.soma, 1337), 'aberto no meu-bling: as compras, o novo e o que sobrou', aberto);
  verifica(parcLocal.quantidade === 2 && igual(parcLocal.soma, 290) && igual(parcLocal.saldo, 130), 'parcial local junta o saldo do Bling com o pagamento feito aqui', parcLocal);

  secao('Segunda aplicação não duplica');
  const deNovo = await sincronizarContasPagar({ ...opcoesBase, leitor: cliente({ listas: fixture.listagem, detalhes: fixture.detalhes }), modo: 'aplicar' });
  verifica(deNovo.criados === 0 && deNovo.vinculados === 0 && deNovo.atualizados === 11 && (await prisma.contaPagar.count({ where: { blingId: '101' } })) === 1, 'rodar de novo atualiza pelo id e não cria outra', { criados: deNovo.criados, atualizados: deNovo.atualizados });
  verifica(!deNovo.divergencias.some((d: any) => d.blingId === '102'), 'depois de aplicar, o pago deixa de divergir');
  verifica(deNovo.divergencias.some((d: any) => d.blingId === '110' && d.preservado), 'o pagamento feito aqui continua preservado');
  verifica((await prisma.contaPagar.findUnique({ where: { blingId: '110' } }))?.valorPago === 40, 'o valor pago local segue 40');
  verifica((await prisma.movimentoFinanceiro.count()) === 1, 'continua sem movimento retroativo');
  verifica(rede === 0, 'nenhuma chamada foi para a API do Bling');
} finally {
  globalThis.fetch = originalFetch;
  await prisma.$disconnect().catch(() => undefined);
}

encerrar('Sincronização de contas a pagar');
