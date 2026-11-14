/**
 * Fechar a venda não pode varrer o caixa inteiro.
 *
 * Produção tem milhares de movimentos. O teste cria 6.000 movimentos e 500 contas
 * de imposto que não são desta venda, limpa o cache da configuração (é isso que
 * travava a única conexão do SQLite) e fecha a venda. A transação tem de terminar
 * rápido e toda leitura de MovimentoFinanceiro precisa filtrar por conta.
 *
 * Banco temporário. Não usa a API nas portas 8787/8791 nem o banco da loja.
 *   npx tsx testes/transacao-venda.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encerrar, igual, secao, verifica } from './lib.js';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'meu-bling-tx-'));
const arquivo = path.join(pasta, 'teste.db');
const urlBanco = `file:${arquivo}`;

if (!arquivo.startsWith(os.tmpdir()) || /meubling|\/data\//i.test(arquivo)) {
  console.error('Recusa: o banco do teste não é temporário.');
  process.exit(1);
}

process.env.DATABASE_URL = urlBanco;
process.env.TRILHA_AUDITORIA = 'off';
process.env.REGISTRAR_QUERIES = '1';
process.env.STORAGE_DIR = path.join(pasta, 'storage');
process.env.TZ = 'America/Sao_Paulo';
process.env.JWT_SECRET = 'teste-jwt-secret-com-mais-de-trinta-e-dois-caracteres-ok';
process.env.APP_SECRET = 'teste-app-secret-com-mais-de-trinta-e-dois-caracteres-ok';

const VOLUME_MOVIMENTOS = 6000;
const CONTAS_IMPOSTO = 500;

const push = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  cwd: API,
  env: { ...process.env, DATABASE_URL: urlBanco },
  stdio: 'inherit',
});
if (push.status !== 0) process.exit(push.status || 1);

const { prisma, consultasRegistradas, limparConsultas } = await import('../src/lib/prisma.js');
const { NotFound } = await import('../src/lib/errors.js');
const { registrarAcao, registrarModulo, mudarSituacao } = await import('../src/core/situacoes.js');
const { acaoEstornarContas, acaoLancarContas, acaoLancarEstoque, receberVendaPagaNaHora } = await import('../src/modules/vendas/service.js');
const { limparCacheCfgCustos } = await import('../src/modules/comum/custos-venda.js');
const { TRANSACAO_VENDA } = await import('../src/lib/transacao-venda.js');
const { competenciaDe } = await import('../src/lib/util.js');

if (process.env.DATABASE_URL !== urlBanco) {
  console.error('O Prisma não usou o banco temporário.');
  process.exit(1);
}

registrarModulo('VENDA', {
  obterSituacaoId: async (id: number, tx) => {
    const v = await tx.venda.findUnique({ where: { id }, select: { situacaoId: true } });
    if (!v) throw new NotFound('Venda');
    return v.situacaoId;
  },
  gravarSituacao: async (id: number, situacaoId: number, tx) => {
    await tx.venda.update({ where: { id }, data: { situacaoId } });
  },
});
registrarAcao('VENDA', 'lancarEstoque', acaoLancarEstoque);
registrarAcao('VENDA', 'lancarContas', acaoLancarContas);
registrarAcao('VENDA', 'estornarContas', acaoEstornarContas);

const CHAVES = ['id', 'contaReceberId', 'contaPagarId', 'contaFinanceiraId'];

function filtradoPorConta(where: unknown): boolean {
  if (!where || typeof where !== 'object' || Array.isArray(where)) return false;
  const w = where as Record<string, unknown>;
  if (CHAVES.some((k) => w[k] != null)) return true;
  if (Array.isArray(w.AND) && w.AND.length > 0 && w.AND.every((p) => filtradoPorConta(p))) return true;
  if (Array.isArray(w.OR) && w.OR.length > 0 && w.OR.every((p) => filtradoPorConta(p))) return true;
  return false;
}

type Consulta = { model: string; operation: string; where: unknown };

function movimentosSemFiltro(consultas: Consulta[]) {
  return consultas.filter((c) => c.model === 'MovimentoFinanceiro' && (c.operation === 'findMany' || c.operation === 'groupBy') && !filtradoPorConta(c.where));
}

function resumo(consultas: Consulta[]) {
  return consultas
    .filter((c) => c.model === 'MovimentoFinanceiro')
    .map((c) => `${c.operation} ${JSON.stringify(c.where)}`)
    .join(' | ') || '(nenhuma leitura de movimento)';
}

const meioDia = new Date();
meioDia.setHours(12, 0, 0, 0);
const competencia = competenciaDe(meioDia);

await prisma.empresa.create({
  data: { id: 1, razaoSocial: 'Balão Teste', cnpj: '00000000000191', aliquotaSimplesPct: 10 },
});
await prisma.deposito.create({ data: { nome: 'Loja', padrao: true } });
const caixa = await prisma.contaFinanceira.create({
  data: { nome: 'Caixa da venda', tipo: 'BANCO', saldoInicial: 10000, saldoAtual: 10000, padrao: true, ativo: true },
});
const volume = await prisma.contaFinanceira.create({
  data: { nome: 'Conta do volume', tipo: 'BANCO', saldoInicial: 0, saldoAtual: 0, padrao: false, ativo: true },
});
const pix = await prisma.formaPagamento.create({
  data: { nome: 'PIX', tipo: 'PIX', codigoFiscal: '17', contaFinanceiraId: caixa.id },
});
const aberto = await prisma.situacao.create({
  data: { modulo: 'VENDA', nome: 'Em aberto', cor: '#3b82f6', ordem: 1, inicial: true, acoes: '["reservarEstoque"]' },
});
const fechada = await prisma.situacao.create({
  data: { modulo: 'VENDA', nome: 'Fechada', cor: '#22c55e', ordem: 2, final: true, acoes: '["lancarEstoque","lancarContas"]' },
});
const contato = await prisma.contato.create({ data: { nome: 'Consumidor Final', tipo: 'CLIENTE' } });
const vendedor = await prisma.vendedor.create({ data: { nome: 'Vendedor teste' } });
const produto = await prisma.produto.create({ data: { nome: 'SSD teste', preco: 1000, precoCusto: 400, controlaEstoque: true } });
const catDas = await prisma.categoriaFinanceira.create({ data: { nome: 'DAS', tipo: 'DESPESA', grupoDre: 'DEDUCAO' } });

secao(`Volume parecido com a loja: ${VOLUME_MOVIMENTOS} movimentos e ${CONTAS_IMPOSTO} contas de imposto que não são desta venda`);
const tVolume = Date.now();
for (let i = 0; i < VOLUME_MOVIMENTOS; i += 1000) {
  const n = Math.min(1000, VOLUME_MOVIMENTOS - i);
  await prisma.movimentoFinanceiro.createMany({
    data: Array.from({ length: n }, (_, k) => ({
      contaFinanceiraId: volume.id,
      data: meioDia,
      tipo: (i + k) % 2 === 0 ? 'SAIDA' : 'ENTRADA',
      valor: 3.5,
      descricao: `movimento antigo ${i + k}`,
      observacoes: 'VOLUME_TESTE',
    })),
  });
}
await prisma.contaPagar.createMany({
  data: Array.from({ length: CONTAS_IMPOSTO }, (_, k) => ({
    descricao: `guia antiga ${k}`,
    vencimento: meioDia,
    competencia,
    valor: 0.01,
    situacao: 'ABERTO',
    categoriaId: catDas.id,
    origemTipo: 'MANUAL',
  })),
});
verifica((await prisma.movimentoFinanceiro.count()) === VOLUME_MOVIMENTOS, `${VOLUME_MOVIMENTOS} movimentos gravados antes de fechar`, await prisma.movimentoFinanceiro.count());
console.log(`  volume gravado em ${Date.now() - tVolume} ms`);

const indices = (await prisma.$queryRawUnsafe<{ name: string }[]>(
  `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('MovimentoFinanceiro', 'ContaPagar')`,
)).map((r) => r.name);
verifica(
  ['MovimentoFinanceiro_contaReceberId_idx', 'MovimentoFinanceiro_contaPagarId_idx', 'ContaPagar_origemTipo_origemId_idx', 'ContaPagar_competencia_idx'].every((n) => indices.includes(n)),
  'índices de conta a receber, conta a pagar, origem da venda e competência existem',
  indices,
);

async function criarPedido(numero: number) {
  return prisma.venda.create({
    data: {
      tipo: 'PEDIDO',
      numero,
      data: meioDia,
      contatoId: contato.id,
      vendedorId: vendedor.id,
      situacaoId: aberto.id,
      totalProdutos: 1000,
      total: 1000,
      custoTotal: 400,
      custoLogistica: 25,
      itens: { create: [{ produtoId: produto.id, descricao: 'SSD teste', quantidade: 1, valorUnitario: 1000, total: 1000, custoUnitario: 400, custoInformado: true }] },
      parcelas: { create: [{ numero: 1, dataVencimento: meioDia, valor: 1000, formaPagamentoId: pix.id }] },
    },
  });
}

secao('Fechar a venda (mudar para Fechada) com o cache de custo frio');
const venda = await criarPedido(1);
limparConsultas();
limparCacheCfgCustos();
const tFechar = Date.now();
let erroFechar: string | null = null;
try {
  await mudarSituacao({ modulo: 'VENDA', entidadeId: venda.id, situacaoDestinoId: fechada.id, usuarioId: null, forcar: true, observacao: 'teste' });
} catch (e) {
  erroFechar = (e as Error).message;
}
const msFechar = Date.now() - tFechar;
const consultasFechar = consultasRegistradas().slice();
const semFiltroFechar = movimentosSemFiltro(consultasFechar);
console.log(`  fechou em ${msFechar} ms`);
console.log(`  leituras: ${resumo(consultasFechar)}`);
verifica(!erroFechar, 'fechar a venda não estoura a transação', erroFechar);
verifica(msFechar < 4000, 'fechar fica abaixo de 4 s mesmo com 6.000 movimentos (o limite antigo era 5 s)', msFechar);
verifica(semFiltroFechar.length === 0, 'nenhum findMany/groupBy de movimentos sem filtro de conta', semFiltroFechar);
verifica(
  consultasFechar.some((c) => c.model === 'MovimentoFinanceiro' && c.operation === 'groupBy' && filtradoPorConta(c.where)),
  'o recebimento é somado com groupBy filtrado pela conta a receber, sem carregar a tabela',
  resumo(consultasFechar),
);

const saidas = await prisma.contaPagar.findMany({ where: { origemTipo: 'VENDA', origemId: venda.id, situacao: { not: 'CANCELADO' } } });
const cmv = saidas.find((c) => c.observacoes === 'CMV_VENDA');
const frete = saidas.find((c) => c.observacoes === 'FRETE_VENDA');
const taxa = saidas.find((c) => c.observacoes === 'TAXA_VENDA');
verifica(!!cmv && igual(cmv.valor, 400) && cmv.situacao === 'PAGO', 'saiu o custo real de 400, não a estimativa', cmv && { valor: cmv.valor, situacao: cmv.situacao });
verifica(!!frete && igual(frete.valor, 25) && frete.situacao === 'PAGO', 'saiu o frete informado de 25', frete && frete.valor);
verifica(!taxa, 'ainda não entrou dinheiro: não lança taxa', taxa && taxa.valor);
const saldoDepoisFechar = (await prisma.contaFinanceira.findUnique({ where: { id: caixa.id } }))!.saldoAtual;
verifica(igual(saldoDepoisFechar, 10000 - 400 - 25), 'o caixa só baixou custo e frete desta venda', saldoDepoisFechar);
const das = await prisma.contaPagar.findFirst({ where: { origemTipo: 'IMPOSTO', competencia, observacoes: { contains: 'PREVISAO_DAS' } } });
verifica(!!das && igual(das.valor, 95) && das.situacao === 'ABERTO', 'previsão de DAS é 100 de imposto menos 5 já lançados nas guias, sem somar venda antiga', das && das.valor);

secao('Salvar venda paga na hora (a transação que a tela dispara ao gravar)');
const venda2 = await criarPedido(2);
limparConsultas();
limparCacheCfgCustos();
const tSalvar = Date.now();
let erroSalvar: string | null = null;
let baixadas = 0;
try {
  baixadas = await prisma.$transaction((tx) => receberVendaPagaNaHora(tx, venda2.id, null), TRANSACAO_VENDA);
} catch (e) {
  erroSalvar = (e as Error).message;
}
const msSalvar = Date.now() - tSalvar;
const consultasSalvar = consultasRegistradas().slice();
console.log(`  salvou em ${msSalvar} ms, parcelas baixadas: ${baixadas}`);
console.log(`  leituras: ${resumo(consultasSalvar)}`);
verifica(!erroSalvar, 'receber na hora não estoura a transação', erroSalvar);
verifica(msSalvar < 4000, 'receber na hora fica abaixo de 4 s', msSalvar);
verifica(movimentosSemFiltro(consultasSalvar).length === 0, 'receber na hora também não faz findMany sem filtro', movimentosSemFiltro(consultasSalvar));
verifica(baixadas === 1, 'a parcela do PIX entrou no caixa', baixadas);
const saldoFinal = (await prisma.contaFinanceira.findUnique({ where: { id: caixa.id } }))!.saldoAtual;
verifica(igual(saldoFinal, saldoDepoisFechar + 1000 - 400 - 25), 'entrou 1.000 e saíram custo e frete, uma vez só', saldoFinal);
const cmv2 = await prisma.contaPagar.findFirst({ where: { origemTipo: 'VENDA', origemId: venda2.id, observacoes: 'CMV_VENDA', situacao: { not: 'CANCELADO' } } });
verifica(!!cmv2 && igual(cmv2.valor, 400), 'a segunda venda também lançou o custo uma vez', cmv2 && cmv2.valor);

secao('Estornar as contas da venda fechada');
limparConsultas();
const tEstorno = Date.now();
let erroEstorno: string | null = null;
try {
  await prisma.$transaction(
    (tx) => acaoEstornarContas({ modulo: 'VENDA', entidadeId: venda.id, tx, usuarioId: null, situacaoOrigemId: fechada.id, situacaoDestinoId: aberto.id }),
    TRANSACAO_VENDA,
  );
} catch (e) {
  erroEstorno = (e as Error).message;
}
const msEstorno = Date.now() - tEstorno;
const consultasEstorno = consultasRegistradas().slice();
console.log(`  estornou em ${msEstorno} ms`);
console.log(`  leituras: ${resumo(consultasEstorno)}`);
verifica(!erroEstorno, 'estornar as contas não estoura a transação', erroEstorno);
verifica(msEstorno < 4000, 'estornar fica abaixo de 4 s', msEstorno);
verifica(movimentosSemFiltro(consultasEstorno).length === 0, 'estornar não faz findMany sem filtro', movimentosSemFiltro(consultasEstorno));
const cmvCancelado = await prisma.contaPagar.findFirst({ where: { origemTipo: 'VENDA', origemId: venda.id, observacoes: 'CMV_VENDA' } });
verifica(cmvCancelado?.situacao === 'CANCELADO', 'o custo da venda estornada foi cancelado', cmvCancelado?.situacao);
const saldoEstorno = (await prisma.contaFinanceira.findUnique({ where: { id: caixa.id } }))!.saldoAtual;
verifica(igual(saldoEstorno, saldoFinal + 400 + 25), 'custo e frete voltaram para o caixa', saldoEstorno);

await prisma.$disconnect();
encerrar('Transação de fechar venda');
