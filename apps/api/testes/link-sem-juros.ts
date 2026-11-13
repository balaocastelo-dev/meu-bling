/**
 * LINK DO MERCADO PAGO — parcelas sem juros escolhidas na hora.
 * Não chama o Mercado Pago e não gera cobrança: a preferência é montada aqui
 * e, na API de teste, a simulação (MERCADOPAGO_MOCK) devolve o JSON sem token.
 *   npx tsx testes/link-sem-juros.ts http://localhost:3333
 */
import { avisoParcelasSemJuros, montarCorpoPreferencia, rotuloParcelasSemJuros } from '../src/integracoes/mercadopago/link.js';
import { encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

function corpo(parcelasSemJuros: number) {
  return montarCorpoPreferencia({
    referencia: 'venda-1',
    titulo: 'Pedido nº 1 — Balão da Informática',
    valor: 1500,
    email: 'cliente@exemplo.com',
    nome: 'Cliente',
    parcelasSemJuros,
  });
}

async function main() {
  secao('Corpo da preferência: 0 deixa o JSON de sempre; 2 e 3 não limitam as 12x');
  const zero = corpo(0);
  verifica(zero.payment_methods.installments === 12 && zero.metadata === undefined && zero.items[0].unit_price === 1500, 'nenhum sem juros: até 12x e sem metadata', zero);
  verifica(zero.payer?.email === 'cliente@exemplo.com' && zero.statement_descriptor === 'BALAO INFO', 'pagador e descrição continuam iguais', zero.payer);
  const dois = corpo(2);
  const tres = corpo(3);
  verifica(dois.payment_methods.installments === 12 && dois.metadata?.parcelas_sem_juros === 2 && dois.metadata.juros_ate_n === 'vendedor' && dois.metadata.demais_parcelas === 'cliente', 'até 2x sem juros não corta 4x, 5x…', dois.metadata);
  verifica(tres.payment_methods.installments === 12 && tres.metadata?.parcelas_sem_juros === 3, 'até 3x sem juros também segue até 12x', tres.payment_methods);
  verifica(rotuloParcelasSemJuros(0) === 'Nenhum (juros do cliente)' && rotuloParcelasSemJuros(2) === 'Até 2x sem juros' && avisoParcelasSemJuros(0) === null && !!avisoParcelasSemJuros(3), 'rótulos e aviso só quando há sem juros');

  const adm = await entrar('admin@balao.info', 'admin123');
  const cli = await adm.post('/contatos', { nome: `Cliente Link ${SUF}`, tipoPessoa: 'F', celular: '19988887777' }, 201);
  const venda = async (extra: Record<string, unknown> = {}) =>
    adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ descricao: `Mouse teste ${SUF}`, quantidade: 1, valorUnitario: 200 }], parcelas: [], ...extra }, 201);

  secao('Sem escolher nada, o link continua pedindo o token e não cobra');
  const v0 = await venda();
  verifica(v0.linkPagamentoSemJuros === 0, 'venda nova nasce com nenhum sem juros', v0.linkPagamentoSemJuros);
  const semToken: any = await adm.post(`/vendas/${v0.id}/link-pagamento`, {}, 422);
  verifica(semToken.code === 'MERCADOPAGO_SEM_TOKEN', 'padrão ainda avisa que falta o Mercado Pago', semToken);

  secao('Só aceita nenhum, 2x ou 3x');
  const ruim: any = await adm.post(`/vendas/${v0.id}/link-pagamento`, { parcelasSemJuros: 12 }, 422);
  verifica(ruim.code === 'PARCELAS_SEM_JUROS', '12x sem juros não é opção (não é para limitar o máximo)', ruim);
  const um: any = await adm.post(`/vendas/${v0.id}/link-pagamento`, { parcelasSemJuros: 1 }, 422);
  verifica(um.code === 'PARCELAS_SEM_JUROS', '1x também não entra na lista', um);
  const depois: any = await adm.get(`/vendas/${v0.id}`);
  verifica(!depois.linkPagamentoUrl && depois.linkPagamentoSemJuros === 0, 'recusa não grava link', depois.linkPagamentoUrl);

  secao('Simulação grava a escolha e o JSON, sem falar com o Mercado Pago');
  const gerado0: any = await adm.post(`/vendas/${v0.id}/link-pagamento`, { simulacao: true }, 200);
  verifica(String(gerado0.url).startsWith('https://simulacao.local/mercadopago/') && gerado0.parcelasSemJuros === 0 && gerado0.resumo === 'Nenhum (juros do cliente)' && gerado0.aviso === null, 'simulação no padrão: juros do cliente', gerado0);
  verifica(gerado0.preferencia?.payment_methods?.installments === 12 && gerado0.preferencia.metadata === undefined, 'JSON simulado do padrão não tem metadata', gerado0.preferencia);

  const v3 = await venda({ linkPagamentoSemJuros: 3 });
  verifica(v3.linkPagamentoSemJuros === 3, 'a Nova venda pode já deixar até 3x sem juros anotado', v3.linkPagamentoSemJuros);
  const gerado3: any = await adm.post(`/vendas/${v3.id}/link-pagamento`, { simulacao: true }, 200);
  verifica(gerado3.parcelasSemJuros === 3 && gerado3.resumo === 'Até 3x sem juros' && typeof gerado3.aviso === 'string' && gerado3.aviso.includes('não marca'), 'omitir a opção usa o que a venda já tinha', gerado3);
  verifica(gerado3.preferencia?.payment_methods?.installments === 12 && gerado3.preferencia.metadata?.parcelas_sem_juros === 3 && gerado3.preferencia.metadata.demais_parcelas === 'cliente', '3x sem juros não limita o parcelamento', gerado3.preferencia?.metadata);
  const lida: any = await adm.get(`/vendas/${v3.id}`);
  verifica(lida.linkPagamentoSemJuros === 3 && lida.linkPagamentoUrl === gerado3.url && lida.linkPagamentoValor === 200, 'resumo da venda mostra a opção usada', { semJuros: lida.linkPagamentoSemJuros, url: lida.linkPagamentoUrl });

  secao('Na hora de gerar dá para trocar, e um PUT de observação não apaga a escolha');
  const trocou: any = await adm.post(`/vendas/${v3.id}/link-pagamento`, { parcelasSemJuros: 2, valor: 180, simulacao: true }, 200);
  verifica(trocou.parcelasSemJuros === 2 && trocou.preferencia.payment_methods.installments === 12 && trocou.preferencia.metadata.parcelas_sem_juros === 2 && trocou.valor === 180, 'troca para até 2x sem juros no mesmo pedido', trocou.preferencia?.metadata);
  await adm.put(`/vendas/${v3.id}`, { observacoes: 'Cliente busca à tarde' }, 200);
  const ainda: any = await adm.get(`/vendas/${v3.id}`);
  verifica(ainda.linkPagamentoSemJuros === 2 && ainda.observacoes === 'Cliente busca à tarde', 'editar a observação não volta para juros do cliente', ainda.linkPagamentoSemJuros);

  const invalida: any = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), linkPagamentoSemJuros: 9, itens: [{ descricao: 'Cabo', quantidade: 1, valorUnitario: 10 }], parcelas: [] }, 400);
  verifica(!invalida?.id, 'a venda não aceita um número fora de 0, 2 e 3', invalida);

  encerrar('Link sem juros');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
