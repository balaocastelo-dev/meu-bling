/**
 * EDIÇÃO DE CONTA A PAGAR
 * ABERTO edita tudo e o saldo acompanha o valor.
 * PARCIAL: valor sobe (continua parcial), desce (continua parcial) e desce até o
 * principal já pago (valorPago − juros + desconto; saldo zero vira PAGO).
 * Abaixo disso, 422 pedindo estorno. Pagamentos antigos não mudam de conta nem de categoria.
 * PAGO: só textos; valor e vencimento bloqueados até estornar.
 *   npx tsx testes/editar-conta-pagar.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

function dia(v: string) {
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daqui(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const contasFin: any[] = await adm.get('/contas-financeiras');
  const usaveis = contasFin.filter((c) => c.tipo !== 'COMPENSACAO');
  const cfA = usaveis.find((c) => c.padrao) ?? usaveis[0];
  let cfB = usaveis.find((c) => c.id !== cfA.id);
  if (!cfB) {
    cfB = await adm.post('/contas-financeiras', { nome: `Banco edição ${SUF}`, tipo: 'BANCO', saldoInicial: 0 }, 201);
  }
  const cats: any[] = await adm.get('/categorias-financeiras');
  const despesas = cats.filter((c) => c.tipo === 'DESPESA');
  const catA = despesas[0] ?? (await adm.post('/categorias-financeiras', { nome: `Despesa edição A ${SUF}`, tipo: 'DESPESA' }, 201));
  const catB = despesas.find((c) => c.id !== catA.id) ?? (await adm.post('/categorias-financeiras', { nome: `Despesa edição B ${SUF}`, tipo: 'DESPESA' }, 201));
  const formas: any[] = await adm.get('/formas-pagamento');
  const forma = formas[0];
  const forn = await adm.post('/contatos', { nome: `Fornecedor edição ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'J' }, 201);

  secao('ABERTO: edita tudo e o saldo acompanha o valor');
  const aberto = await adm.post('/contas-pagar', { descricao: `Aberto ${SUF}`, vencimento: hoje(), valor: 1000, categoriaId: catA?.id, contaFinanceiraId: cfA.id }, 201);
  const vencAberto = daqui(15);
  const editado = await adm.put(`/contas-pagar/${aberto.id}`, {
    descricao: `Aberto editado ${SUF}`,
    valor: 1250,
    vencimento: vencAberto,
    observacoes: 'nota da edição',
    contatoId: forn.id,
    categoriaId: catB.id,
    competencia: '2026-04',
    formaPagamentoId: forma?.id ?? null,
    contaFinanceiraId: cfB.id,
    recorrente: true,
  });
  verifica(editado.situacao === 'ABERTO' && igual(editado.valor, 1250), 'conta aberta aceita o novo valor e continua aberta', editado.situacao);
  const detAberto = await adm.get(`/contas-pagar/${aberto.id}`);
  verifica(igual(detAberto.saldo, 1250), 'saldo em aberto acompanha o novo valor (1250)', detAberto.saldo);
  verifica(detAberto.descricao === `Aberto editado ${SUF}` && detAberto.observacoes === 'nota da edição', 'descrição e observação gravadas');
  verifica(detAberto.contatoId === forn.id && detAberto.categoriaId === catB.id, 'fornecedor e categoria do título atualizados');
  verifica(dia(detAberto.vencimento) === vencAberto && detAberto.competencia === '2026-04', 'vencimento e competência atualizados', detAberto.vencimento);
  verifica(detAberto.contaFinanceiraId === cfB.id && detAberto.recorrente === true, 'conta financeira padrão e recorrência atualizadas');
  const aud = await adm.get(`/auditoria?entidade=ContaPagar&entidadeId=${aberto.id}`);
  verifica(Array.isArray(aud) && aud.some((a: any) => a.acao === 'ALTERAR' && String(a.detalhes).includes(`Aberto editado ${SUF}`)), 'auditoria registra ALTERAR', aud?.[0]);

  secao('PARCIAL: valor sobe e os pagamentos antigos ficam onde saíram');
  const parcial = await adm.post('/contas-pagar', { descricao: `Parcial ${SUF}`, vencimento: hoje(), valor: 1000, categoriaId: catA.id, contaFinanceiraId: cfA.id }, 201);
  await adm.post(`/contas-pagar/${parcial.id}/baixar`, { valor: 210, juros: 10, data: hoje(), contaFinanceiraId: cfA.id });
  const vencParcial = daqui(25);
  const subiu = await adm.put(`/contas-pagar/${parcial.id}`, {
    descricao: `Parcial editado ${SUF}`,
    valor: 1500,
    vencimento: vencParcial,
    observacoes: 'subiu o valor',
    contatoId: forn.id,
    categoriaId: catB.id,
    competencia: '2026-05',
    formaPagamentoId: forma?.id ?? null,
    contaFinanceiraId: cfB.id,
    recorrente: true,
  });
  verifica(subiu.situacao === 'PARCIAL' && igual(subiu.valor, 1500), 'valor maior continua PARCIAL', subiu.situacao);
  let det = await adm.get(`/contas-pagar/${parcial.id}`);
  verifica(igual(det.saldo, 1300), 'saldo = 1500 + 10 de juros − 210 pagos', det.saldo);
  verifica(det.descricao.startsWith('Parcial editado') && det.contatoId === forn.id && det.categoriaId === catB.id && det.competencia === '2026-05', 'textos, fornecedor, categoria e competência mudam');
  verifica(dia(det.vencimento) === vencParcial && det.contaFinanceiraId === cfB.id && det.recorrente === true, 'vencimento, conta padrão e recorrência mudam');
  const mov = det.lancamentos?.[0];
  verifica(mov && mov.contaFinanceiraId === cfA.id && mov.categoriaId === catA.id, 'pagamento antigo permanece na conta e na categoria de onde saiu', mov);

  secao('PARCIAL: valor desce e continua parcial');
  const desceu = await adm.put(`/contas-pagar/${parcial.id}`, { valor: 500 });
  verifica(desceu.situacao === 'PARCIAL' && igual(desceu.valor, 500), 'valor menor que o título e maior que o principal pago continua PARCIAL', desceu);
  det = await adm.get(`/contas-pagar/${parcial.id}`);
  verifica(igual(det.saldo, 300), 'saldo desce para 300 (500 + 10 − 210)', det.saldo);
  verifica(det.lancamentos?.length === 1 && det.lancamentos[0].contaFinanceiraId === cfA.id, 'a baixa antiga não foi refeita');

  secao('PARCIAL: descer até o principal já pago quita');
  const quita = await adm.post('/contas-pagar', { descricao: `Quita ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  await adm.post(`/contas-pagar/${quita.id}/baixar`, { valor: 210, juros: 10, data: hoje(), contaFinanceiraId: cfA.id });
  const zerou = await adm.put(`/contas-pagar/${quita.id}`, { valor: 200 });
  verifica(zerou.situacao === 'PAGO' && igual(zerou.valor, 200), 'valor igual ao principal já pago (210 − 10) vira PAGO', zerou);
  const detQuita = await adm.get(`/contas-pagar/${quita.id}`);
  verifica(igual(detQuita.saldo, 0), 'saldo zerou', detQuita.saldo);

  secao('PARCIAL: descer abaixo do principal já pago pede estorno');
  const demais = await adm.post('/contas-pagar', { descricao: `Demais ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  await adm.post(`/contas-pagar/${demais.id}/baixar`, { valor: 210, juros: 10, data: hoje(), contaFinanceiraId: cfA.id });
  const ruim = await adm.put(`/contas-pagar/${demais.id}`, { valor: 199 }, 422);
  verifica(ruim.code === 'VALOR_ABAIXO_DO_PAGO' && /estorne a baixa excedente/i.test(ruim.erro), '422 pede estorno da baixa excedente', ruim);
  const detDemais = await adm.get(`/contas-pagar/${demais.id}`);
  verifica(detDemais.situacao === 'PARCIAL' && igual(detDemais.valor, 1000) && igual(detDemais.saldo, 800), 'o título não mudou depois do 422', detDemais);

  secao('PAGO: só textos; valor e vencimento bloqueados');
  const pago = await adm.post('/contas-pagar', { descricao: `Pago ${SUF}`, vencimento: hoje(), valor: 80, categoriaId: catA.id }, 201);
  await adm.post(`/contas-pagar/${pago.id}/baixar`, { valor: 80, data: hoje(), contaFinanceiraId: cfA.id });
  const antesPago = await adm.get(`/contas-pagar/${pago.id}`);
  const texto = await adm.put(`/contas-pagar/${pago.id}`, { descricao: `Pago editado ${SUF}`, observacoes: 'corrigido', contatoId: forn.id, categoriaId: catB.id, valor: antesPago.valor, vencimento: dia(antesPago.vencimento) });
  verifica(texto.situacao === 'PAGO' && texto.descricao === `Pago editado ${SUF}` && texto.observacoes === 'corrigido', 'descrição e observação de conta paga são alteradas');
  verifica(texto.contatoId === forn.id && texto.categoriaId === catB.id && igual(texto.valor, 80), 'fornecedor e categoria do título mudam; o valor igual não bloqueia');
  const bloqueioValor = await adm.put(`/contas-pagar/${pago.id}`, { valor: 90 }, 422);
  verifica(bloqueioValor.code === 'JA_BAIXADA' && /estornar/i.test(bloqueioValor.erro), 'valor diferente fica bloqueado até estornar', bloqueioValor);
  const bloqueioVenc = await adm.put(`/contas-pagar/${pago.id}`, { vencimento: daqui(9) }, 422);
  verifica(bloqueioVenc.code === 'JA_BAIXADA', 'vencimento fica bloqueado até estornar', bloqueioVenc);
  const bloqueioForma = await adm.put(`/contas-pagar/${pago.id}`, { recorrente: true }, 422);
  verifica(bloqueioForma.code === 'SITUACAO_INVALIDA', 'conta paga não muda recorrência', bloqueioForma);
  const detPago = await adm.get(`/contas-pagar/${pago.id}`);
  verifica(igual(detPago.valor, 80) && dia(detPago.vencimento) === hoje() && detPago.recorrente === false, 'valor, vencimento e recorrência seguem iguais', detPago);

  secao('CANCELADO não edita; compra, comissão e empréstimo travam valor e vencimento');
  const cancelada = await adm.post('/contas-pagar', { descricao: `Cancelar ${SUF}`, vencimento: hoje(), valor: 15 }, 201);
  await adm.del(`/contas-pagar/${cancelada.id}`);
  const nao = await adm.put(`/contas-pagar/${cancelada.id}`, { descricao: 'não pode' }, 422);
  verifica(nao.code === 'SITUACAO_INVALIDA', 'conta cancelada não pode ser alterada', nao);

  for (const origem of ['COMPRA', 'COMISSAO', 'EMPRESTIMO'] as const) {
    const titulo = await adm.post('/contas-pagar', { descricao: `${origem} ${SUF}`, vencimento: hoje(), valor: 400, origemTipo: origem, origemId: 1 }, 201);
    const v = await adm.put(`/contas-pagar/${titulo.id}`, { valor: 410 }, 422);
    const dv = await adm.put(`/contas-pagar/${titulo.id}`, { vencimento: daqui(4) }, 422);
    const ok = await adm.put(`/contas-pagar/${titulo.id}`, { descricao: `${origem} texto ${SUF}`, observacoes: 'ok' });
    verifica(v.code === 'ORIGEM_DOCUMENTO' && dv.code === 'ORIGEM_DOCUMENTO', `${origem}: valor e vencimento se editam no documento de origem`, v);
    verifica(ok.descricao === `${origem} texto ${SUF}` && igual(ok.valor, 400), `${origem}: texto muda e o valor permanece`, ok);
  }

  encerrar('Edição de conta a pagar');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
