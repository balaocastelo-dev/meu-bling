/**
 * LINK DO MERCADO PAGO — sempre até 12x, juros do cliente.
 * Não chama o Mercado Pago e não gera cobrança: a preferência é montada aqui
 * e, na API de teste, a simulação (MERCADOPAGO_MOCK) devolve o JSON sem token.
 *   npx tsx testes/link-pagamento.ts http://localhost:3333
 */
import { montarCorpoPreferencia } from '../src/integracoes/mercadopago/link.js';
import { prisma } from '../src/lib/prisma.js';
import { encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

function semEscolha(pref: { payment_methods?: { installments?: number }; metadata?: unknown } | null | undefined) {
  return !!pref && pref.payment_methods?.installments === 12 && pref.metadata === undefined && !JSON.stringify(pref).includes('sem_juros');
}

async function main() {
  secao('O JSON do link é o de sempre: até 12x, juros do cliente');
  const pref = montarCorpoPreferencia({
    referencia: 'venda-1',
    titulo: 'Pedido nº 1 — Balão da Informática',
    valor: 1500,
    email: 'cliente@exemplo.com',
    nome: 'Cliente',
  });
  verifica(pref.payment_methods.installments === 12 && !('metadata' in pref) && pref.items[0].unit_price === 1500, 'até 12x e sem metadata', pref);
  verifica(pref.payer?.email === 'cliente@exemplo.com' && pref.statement_descriptor === 'BALAO INFO', 'pagador e descrição continuam iguais', pref.payer);
  verifica(!JSON.stringify(pref).includes('sem_juros'), 'o corpo não fala de parcelas sem juros');

  const adm = await entrar('admin@balao.info', 'admin123');
  const cli = await adm.post('/contatos', { nome: `Cliente Link ${SUF}`, tipoPessoa: 'F', celular: '19988887777' }, 201);
  const venda = async (extra: Record<string, unknown> = {}) =>
    adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: `Mouse teste ${SUF}`, quantidade: 1, valorUnitario: 200 }], parcelas: [], ...extra }, 201);

  secao('Sem token o link não sai e não cobra');
  const v0 = await venda();
  verifica(v0.linkPagamentoSemJuros === 0, 'venda nova nasce com a coluna antiga em 0, sem escolha', v0.linkPagamentoSemJuros);
  const semToken: any = await adm.post(`/vendas/${v0.id}/link-pagamento`, {}, 422);
  verifica(semToken.code === 'MERCADOPAGO_SEM_TOKEN', 'sem Mercado Pago configurado, avisa e não cobra', semToken);
  const depois: any = await adm.get(`/vendas/${v0.id}`);
  verifica(!depois.linkPagamentoUrl && depois.linkPagamentoSemJuros === 0, 'recusa não grava link', depois.linkPagamentoUrl);

  secao('Pedido de parcelas sem juros é ignorado; a simulação não chama o Mercado Pago');
  const pedido = await venda({ linkPagamentoSemJuros: 3 });
  verifica(pedido.id && pedido.linkPagamentoSemJuros === 0, 'a Nova venda ignora a escolha e fica em 0', pedido.linkPagamentoSemJuros);
  const solto = await venda({ linkPagamentoSemJuros: 9 });
  verifica(!!solto.id && solto.linkPagamentoSemJuros === 0, 'um número qualquer também é ignorado', solto.linkPagamentoSemJuros);

  const gerado: any = await adm.post(`/vendas/${pedido.id}/link-pagamento`, { parcelasSemJuros: 3, simulacao: true }, 200);
  verifica(String(gerado.url).startsWith('https://simulacao.local/mercadopago/') && gerado.valor === 200, 'simulação devolve o link sem cobrança', gerado.url);
  verifica(semEscolha(gerado.preferencia) && gerado.parcelasSemJuros === undefined && gerado.aviso === undefined && gerado.resumo === undefined, 'mesmo pedindo 3x, o JSON é até 12x com juros do cliente', gerado.preferencia);

  secao('Coluna antiga preenchida não muda o link');
  await prisma.venda.update({ where: { id: pedido.id }, data: { linkPagamentoSemJuros: 3 } });
  const antigo: any = await adm.get(`/vendas/${pedido.id}`);
  verifica(antigo.linkPagamentoSemJuros === 3 && antigo.linkPagamentoUrl === gerado.url, 'a coluna pode continuar com o valor velho', antigo.linkPagamentoSemJuros);
  const deNovo: any = await adm.post(`/vendas/${pedido.id}/link-pagamento`, { parcelasSemJuros: 2, valor: 180, simulacao: true }, 200);
  verifica(deNovo.valor === 180 && semEscolha(deNovo.preferencia), 'gerar de novo ignora a coluna e o corpo antigo', deNovo.preferencia);
  const lida: any = await adm.get(`/vendas/${pedido.id}`);
  verifica(lida.linkPagamentoSemJuros === 3 && lida.linkPagamentoValor === 180 && lida.linkPagamentoUrl === deNovo.url, 'o link novo não regrava a coluna sem uso', { semJuros: lida.linkPagamentoSemJuros, valor: lida.linkPagamentoValor });

  await adm.put(`/vendas/${pedido.id}`, { observacoes: 'Cliente busca à tarde' }, 200);
  const ainda: any = await adm.get(`/vendas/${pedido.id}`);
  verifica(ainda.observacoes === 'Cliente busca à tarde' && ainda.linkPagamentoSemJuros === 3 && ainda.linkPagamentoUrl === deNovo.url, 'editar a observação não mexe no link nem na coluna', ainda.linkPagamentoSemJuros);

  await prisma.$disconnect();
  encerrar('Link do Mercado Pago');
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
