/**
 * BAIXA PARCIAL DO JEITO QUE A LOJA USA (14/11/2026)
 * - Conta importada do Bling (PARCIAL, valorPago = valor, zero movimentos) não ganha saldo inventado.
 *   A conferência lista; a loja informa quanto falta; aí a baixa passa a funcionar.
 * - Pagar R$ 300 de R$ 1.000 deixa a conta em "Em aberto" com saldo R$ 700; segundo pagamento; estorno de um só.
 * - Conciliação: extrato menor que o saldo oferece pagar/receber esse valor; 1% ainda quita.
 * - Conta a receber: saldo da lista e baixa padrão com juros; estorno de um recebimento; juros que quitam.
 *   DATABASE_URL=file:... npx tsx testes/baixa-parcial-loja.ts http://localhost:3333
 */
import { spawnSync } from 'node:child_process';
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';
import { prisma } from '../src/lib/prisma.js';

function ofx(fitid: string, valor: string, memo: string) {
  const data = hoje().replace(/-/g, '');
  return `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>${valor.startsWith('-') ? 'DEBIT' : 'CREDIT'}<DTPOSTED>${data}120000<TRNAMT>${valor}<FITID>${fitid}<MEMO>${memo}</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const contas: any[] = await adm.get('/contas-financeiras');
  const cf = contas.find((c) => c.padrao) ?? contas[0];

  secao('Conta PARCIAL importada com valor pago = valor e zero movimentos');
  const importada = await prisma.contaPagar.create({
    data: {
      descricao: `Bling sem saldo ${SUF}`,
      vencimento: new Date(`${hoje()}T12:00:00`),
      valor: 1000,
      valorPago: 1000,
      situacao: 'PARCIAL',
      blingId: `teste-sem-saldo-${SUF}`,
      origemTipo: 'MANUAL',
    },
  });
  const pagaDeVerdade = await prisma.contaPagar.create({
    data: {
      descricao: `Bling paga de verdade ${SUF}`,
      vencimento: new Date(`${hoje()}T12:00:00`),
      valor: 400,
      valorPago: 400,
      situacao: 'PAGO',
      blingId: `teste-paga-${SUF}`,
      origemTipo: 'MANUAL',
    },
  });
  await prisma.movimentoFinanceiro.create({
    data: { contaFinanceiraId: cf.id, data: new Date(), tipo: 'SAIDA', valor: 400, descricao: `pagamento já lançado ${SUF}`, contaPagarId: pagaDeVerdade.id },
  });

  const conf = await adm.get('/contas-pagar/conferencia');
  const achada = conf.contas.find((c: any) => c.id === importada.id);
  verifica(!!achada, 'a conferência lista a conta importada sem movimento', conf.total);
  verifica(achada && igual(achada.saldo, 0) && igual(achada.valorPago, 1000) && achada.saldoNaoInformado === true, 'saldo gravado é 0 — não inventamos o que falta', achada);
  verifica(!conf.contas.some((c: any) => c.id === pagaDeVerdade.id), 'conta com movimento não entra na conferência');
  const det0 = await adm.get(`/contas-pagar/${importada.id}`);
  verifica(det0.saldoNaoInformado === true && igual(det0.saldo, 0), 'o detalhe marca saldo não informado', det0.saldo);

  const script = spawnSync('npx', ['tsx', 'scripts/conferir-contas-pagar-importadas.ts'], { encoding: 'utf8', env: process.env });
  verifica(script.status === 0 && script.stdout.includes(`#${importada.id}`) && script.stdout.includes('saldo gravado'), 'o script de conferência lista a mesma conta', script.stderr?.slice(0, 300) || script.stdout?.slice(0, 200));

  await adm.post(`/contas-pagar/${importada.id}/baixar`, { valor: 10, data: hoje(), contaFinanceiraId: cf.id }, 422);
  await adm.post(`/contas-pagar/${pagaDeVerdade.id}/informar-restante`, { restante: 100 }, 422);

  const informado = await adm.post(`/contas-pagar/${importada.id}/informar-restante`, { restante: 1000 });
  verifica(informado.conta.situacao === 'ABERTO' && igual(informado.conta.valorPago, 0) && igual(informado.saldo, 1000), 'informar que falta tudo zera o pago e abre a conta', informado.conta);
  const conf2 = await adm.get('/contas-pagar/conferencia');
  verifica(!conf2.contas.some((c: any) => c.id === importada.id), 'depois de informar, sai da conferência');

  secao('Pagar R$ 300 de R$ 1.000 e a conta continua em Em aberto');
  const r1 = await adm.post(`/contas-pagar/${importada.id}/baixar`, { valor: 300, data: hoje(), contaFinanceiraId: cf.id });
  verifica(r1.conta.situacao === 'PARCIAL' && igual(r1.conta.valorPago, 300), 'primeiro pagamento deixa PARCIAL com 300 pagos', r1.conta);
  let lista = await adm.get(`/contas-pagar?situacao=ABERTO&pesquisa=${encodeURIComponent(`sem saldo ${SUF}`)}`);
  let item = lista.data.find((c: any) => c.id === importada.id);
  verifica(item && item.situacao === 'PARCIAL' && igual(item.saldo, 700) && item.saldoNaoInformado === false, 'filtro Em aberto mostra a parcial com saldo 700', item);

  secao('Segundo pagamento');
  const r2 = await adm.post(`/contas-pagar/${importada.id}/baixar`, { valor: 200, data: hoje(), contaFinanceiraId: cf.id });
  verifica(r2.conta.situacao === 'PARCIAL' && igual(r2.conta.valorPago, 500), 'segundo pagamento mantém PARCIAL', r2.conta);
  lista = await adm.get(`/contas-pagar?situacao=ABERTO&pesquisa=${encodeURIComponent(`sem saldo ${SUF}`)}`);
  item = lista.data.find((c: any) => c.id === importada.id);
  verifica(item && igual(item.saldo, 500), 'continua em Em aberto com saldo 500', item);
  const soParcial = await adm.get(`/contas-pagar?situacao=PARCIAL&pesquisa=${encodeURIComponent(`sem saldo ${SUF}`)}`);
  verifica(soParcial.data.some((c: any) => c.id === importada.id), 'o filtro Parciais continua existindo');

  secao('Estorno de um só pagamento');
  let d = await adm.get(`/contas-pagar/${importada.id}`);
  const primeiro = d.lancamentos[0].id;
  const est = await adm.post(`/contas-pagar/${importada.id}/pagamentos/${primeiro}/estornar`);
  verifica(est.conta.situacao === 'PARCIAL' && igual(est.conta.valorPago, 200), 'estorna só o de 300 e fica o de 200', est.conta);
  d = await adm.get(`/contas-pagar/${importada.id}`);
  verifica(d.lancamentos.length === 1 && igual(d.saldo, 800), 'histórico com um pagamento e saldo 800', d);

  secao('Conciliação: extrato menor que o saldo oferece pagar/receber esse valor');
  const titulo = await adm.post('/contas-pagar', { descricao: `Aluguel loja ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  const receber = await adm.post('/contas-receber', { descricao: `Cliente Pix ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  const quase = await adm.post('/contas-pagar', { descricao: `Tarifa ${SUF}`, vencimento: hoje(), valor: 100 }, 201);
  await adm.post('/bancos/importar-ofx', { contaFinanceiraId: cf.id, conteudo: ofx(`PARC-P-${SUF}`, '-300.00', `Aluguel loja ${SUF}`) }, [200, 201]);
  await adm.post('/bancos/importar-ofx', { contaFinanceiraId: cf.id, conteudo: ofx(`PARC-R-${SUF}`, '400.00', `Cliente Pix ${SUF}`) }, [200, 201]);
  await adm.post('/bancos/importar-ofx', { contaFinanceiraId: cf.id, conteudo: ofx(`QUIT-${SUF}`, '-99.00', `Tarifa ${SUF}`) }, [200, 201]);

  const trans = await adm.get(`/bancos/transacoes?conciliado=false&pesquisa=${encodeURIComponent(SUF)}&sugestoes=true&limite=20`);
  const deb = trans.data.find((t: any) => String(t.descricao).includes(`Aluguel loja ${SUF}`));
  const cred = trans.data.find((t: any) => String(t.descricao).includes(`Cliente Pix ${SUF}`));
  const quit = trans.data.find((t: any) => String(t.descricao).includes(`Tarifa ${SUF}`));
  const sugPagar = deb?.sugestoes?.find((s: any) => s.tipo === 'PAGAR' && s.id === titulo.id);
  const sugReceber = cred?.sugestoes?.find((s: any) => s.tipo === 'RECEBER' && s.id === receber.id);
  const sugQuitar = quit?.sugestoes?.find((s: any) => s.tipo === 'PAGAR' && s.id === quase.id);
  verifica(sugPagar?.parcial === true && igual(sugPagar.valor, 300) && igual(sugPagar.saldo, 1000), 'oferece pagar R$ 300 desta conta', sugPagar);
  verifica(sugReceber?.parcial === true && igual(sugReceber.valor, 400) && igual(sugReceber.saldo, 1000), 'oferece receber R$ 400 desta conta', sugReceber);
  verifica(sugQuitar && sugQuitar.parcial === false && sugQuitar.score >= 0.8, 'diferença de 1% continua sugestão de quitação', sugQuitar);

  await adm.post(`/bancos/transacoes/${deb.id}/conciliar`, { tipo: 'PAGAR', id: titulo.id });
  const tituloDepois = await adm.get(`/contas-pagar/${titulo.id}`);
  verifica(tituloDepois.situacao === 'PARCIAL' && igual(tituloDepois.valorPago, 300) && igual(tituloDepois.saldo, 700), 'conciliar o débito paga 300 e deixa saldo 700', tituloDepois);
  const abertaBanco = await adm.get(`/contas-pagar?situacao=ABERTO&pesquisa=${encodeURIComponent(`Aluguel loja ${SUF}`)}`);
  verifica(abertaBanco.data.some((c: any) => c.id === titulo.id && igual(c.saldo, 700)), 'título conciliado em parte segue em Em aberto');

  await adm.post(`/bancos/transacoes/${cred.id}/conciliar`, { tipo: 'RECEBER', id: receber.id });
  const receberDepois = await adm.get(`/contas-receber/${receber.id}`);
  verifica(receberDepois.situacao === 'PARCIAL' && igual(receberDepois.valorRecebido, 400) && igual(receberDepois.saldo, 600), 'conciliar o crédito recebe 400', receberDepois);

  await adm.post(`/bancos/transacoes/${quit.id}/conciliar`, { tipo: 'PAGAR', id: quase.id });
  const quaseDepois = await adm.get(`/contas-pagar/${quase.id}`);
  verifica(quaseDepois.situacao === 'PAGO' && igual(quaseDepois.saldo, 0), 'tolerância de 1% quita a conta de 100 com débito de 99', quaseDepois);

  secao('Conta a receber: saldo com juros, estorno de um e quitação');
  const cr = await adm.post('/contas-receber', { descricao: `Receber juros ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  await adm.post(`/contas-receber/${cr.id}/baixar`, { valor: 200, juros: 50, data: hoje(), contaFinanceiraId: cf.id });
  let lr = await adm.get(`/contas-receber?situacao=ABERTO&pesquisa=${encodeURIComponent(`juros ${SUF}`)}`);
  let ir = lr.data.find((c: any) => c.id === cr.id);
  verifica(ir && ir.situacao === 'PARCIAL' && igual(ir.saldo, 850), 'lista em Em aberto com saldo 850 (1000 + 50 de juros − 200)', ir);
  const semValor = await adm.post(`/contas-receber/${cr.id}/baixar`, { data: hoje(), contaFinanceiraId: cf.id });
  verifica(semValor.conta.situacao === 'RECEBIDO' && igual(semValor.movimento.valor, 850), 'baixa sem valor usa o saldo com juros e quita', semValor);

  const cr2 = await adm.post('/contas-receber', { descricao: `Dois recebimentos ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  await adm.post(`/contas-receber/${cr2.id}/baixar`, { valor: 300, data: hoje(), contaFinanceiraId: cf.id });
  await adm.post(`/contas-receber/${cr2.id}/baixar`, { valor: 250, juros: 50, data: hoje(), contaFinanceiraId: cf.id });
  let dr = await adm.get(`/contas-receber/${cr2.id}`);
  verifica(igual(dr.saldo, 500) && dr.lancamentos.length === 2, 'dois recebimentos: saldo 500 já com os juros', dr.saldo);
  const movRecebido = dr.lancamentos[0].id;
  const estR = await adm.post(`/contas-receber/${cr2.id}/pagamentos/${movRecebido}/estornar`);
  verifica(estR.conta.situacao === 'PARCIAL' && igual(estR.conta.valorRecebido, 250) && igual(estR.conta.juros, 50), 'estorna só o primeiro recebimento', estR.conta);
  dr = await adm.get(`/contas-receber/${cr2.id}`);
  verifica(dr.lancamentos.length === 1 && igual(dr.saldo, 800), 'fica um recebimento e saldo 800', dr);

  secao('Recebimento com juros que quita');
  const cr3 = await adm.post('/contas-receber', { descricao: `Quita com juros ${SUF}`, vencimento: hoje(), valor: 1000 }, 201);
  const quitou = await adm.post(`/contas-receber/${cr3.id}/baixar`, { valor: 1100, juros: 100, data: hoje(), contaFinanceiraId: cf.id });
  verifica(quitou.conta.situacao === 'RECEBIDO' && igual(quitou.conta.juros, 100) && igual(quitou.conta.valorRecebido, 1100), '1100 com 100 de juros quita a conta de 1000', quitou.conta);
  const d3 = await adm.get(`/contas-receber/${cr3.id}`);
  verifica(igual(d3.saldo, 0), 'saldo da conta quitada é zero', d3.saldo);

  await prisma.$disconnect();
  encerrar('Baixa parcial na loja');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
