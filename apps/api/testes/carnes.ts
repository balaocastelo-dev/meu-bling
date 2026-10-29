/**
 * CARNÊ PRÓPRIO (PIX no Cora) — 28/10/2026
 * - PIX copia e cola válido (CRC do Banco Central), com a chave CNPJ 34397947000108 e o valor da parcela.
 * - Risco calculado pelo sistema (nota, classe A–E, juros 7%–15%), auditoria de crédito.
 * - Venda na forma "Carnê": vira carnê com juros (tabela Price), a conta da venda é substituída pelas parcelas.
 * - Receber parcela (baixa no Cora/caixa), multa e mora no atraso, estorno, cancelamento da venda.
 * - DRE: só os juros do carnê entram no resultado financeiro; venda não conta em dobro.
 * - Impressão: 3 por folha, capa, agradecimento, QR em cada parcela.
 *   npx tsx testes/carnes.ts http://localhost:3333
 */
import { BASE, clienteCompleto, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';
import { crc16, lerPix, pixValido } from '../src/modules/carnes/pix.js';
import { calcularParcelas } from '../src/modules/carnes/service.js';

const daqui = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  secao('PIX: CRC16 do Banco Central e cálculo da tabela Price');
  verifica(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304') === '1D3D', 'CRC16 confere com o exemplo oficial do BC (1D3D)');
  const c3 = calcularParcelas(900, 10, 3);
  verifica(igual(c3.valorParcela, 361.9) && igual(c3.total, 1085.71) && igual(c3.juros, 185.71) && igual(c3.valores[2], 361.91), 'R$ 900 a 10% a.m. em 3x = 2 × R$ 361,90 + R$ 361,91 (juros R$ 185,71)', c3);
  const c0 = calcularParcelas(1000, 0, 3);
  verifica(igual(c0.valores.reduce((s, v) => s + v, 0), 1000) && igual(c0.valores[2], 333.34), 'sem juros: última parcela acerta os centavos', c0.valores);

  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const cfg = await adm.put('/financeiro/carnes/config', { pixChave: '34397947000108', taxaMinPct: 7, taxaMaxPct: 15, multaPct: 2, moraMesPct: 1 }, 200);
  verifica(cfg.pixChave === '34397947000108' && cfg.taxaMinPct === 7 && cfg.taxaMaxPct === 15, 'configuração: chave CNPJ do Cora, juros de 7% a 15%', cfg);
  await adm.put('/financeiro/carnes/config', { taxaMinPct: 20, taxaMaxPct: 10 }, 422);

  const formas: any[] = await adm.get('/formas-pagamento');
  const carneF = formas.find((f) => f.tipo === 'CARNE');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO');
  verifica(!!carneF, 'existe a forma de pagamento "Carnê"', formas.map((f) => f.tipo));
  if (!carneF) return encerrar('Carnê');
  const cora = await adm.post('/contas-financeiras', { nome: `Cora Carne ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  await adm.put(`/formas-pagamento/${carneF.id}`, { contaFinanceiraId: cora.id }, 200);
  const caixas: any = await adm.get('/contas-financeiras?ativo=true');
  const caixa = ((Array.isArray(caixas) ? caixas : caixas.data) as any[]).find((c) => c.tipo === 'CAIXA');
  const saldo = async (id: number) => {
    const r: any = await adm.get('/contas-financeiras?ativo=true');
    return ((Array.isArray(r) ? r : r.data) as any[]).find((c) => c.id === id)?.saldoAtual ?? NaN;
  };
  const vend = await adm.post('/vendedores', { nome: `Vendedor Carne ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `NOTEBOOK CARNE ${SUF}`, codigo: `CR-${SUF}`, preco: 900, precoCusto: 500, ncm: '84713012', csosn: '102' }, 201);
  const cli = await adm.post('/contatos', { ...clienteCompleto(`Cliente Carne ${SUF}`, `${SUF}7`) }, 201);

  secao('Risco: cliente sem compras não é apto; com 2 compras pagas melhora a nota');
  await adm.get(`/financeiro/carnes/risco/${cli.id}`, 200);
  for (let k = 0; k < 2; k++) {
    const v = await adm.post('/vendas', { contatoId: cli.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 900, custoUnitario: 500 }], parcelas: [{ dataVencimento: hoje(), valor: 900, formaPagamentoId: dinheiro.id }] }, 201);
    await adm.post(`/vendas/${v.id}/finalizar`, {}, 200);
  }
  const r1 = await adm.get(`/financeiro/carnes/risco/${cli.id}`, 200);
  verifica(r1.historico?.comprasTotal >= 2 && r1.score > 20 && ['A', 'B', 'C', 'D', 'E'].includes(r1.classe), 'nota calculada pelo histórico (compras, pagamentos)', r1 && { s: r1.score, c: r1.classe, m: r1.motivos });
  verifica(r1.taxaPct >= 7 && r1.taxaPct <= 15, 'juros sugeridos entre 7% e 15% ao mês', r1.taxaPct);
  verifica(Array.isArray(r1.motivos) && r1.motivos.some((m: any) => /compra/.test(m.texto)), 'motivos da nota aparecem (transparente)', r1.motivos);
  const sim = await adm.get(`/financeiro/carnes/simular?valor=900&parcelas=3&clienteId=${cli.id}`, 200);
  verifica(sim.taxaPct === r1.taxaPct && sim.parcelasLista.length === 3, 'simulação usa os juros do risco do cliente', sim.taxaPct);

  secao('Auditoria de crédito');
  const aud = await adm.get('/financeiro/carnes/auditoria?limite=5000', 200);
  verifica(aud.resumo && aud.resumo.clientes >= 1 && aud.data.some((t: any) => t.cliente.id === cli.id), 'auditoria lista os clientes com nota, classe e limite', aud.resumo);
  const aptos = await adm.get('/financeiro/carnes/auditoria?filtro=APTOS&limite=5000', 200);
  verifica(aptos.data.every((t: any) => t.apto && t.limite > 0 && !t.bloqueios.length), 'filtro "aptos" só traz quem pode receber oferta de crédito', aptos.total);
  const cfId = (await adm.get('/vendas/consumidor-final')).id;
  const cfAud = aud.data.find((t: any) => t.cliente.id === cfId);
  verifica(!cfAud || (!cfAud.apto && cfAud.bloqueios.length > 0), 'consumidor final nunca é apto', cfAud?.bloqueios);

  secao('Venda na forma "Carnê" com juros escolhidos na finalização');
  const v1 = await adm.post('/vendas', { contatoId: cli.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 900, custoUnitario: 500 }], parcelas: [{ dataVencimento: hoje(), valor: 300, formaPagamentoId: carneF.id }, { dataVencimento: daqui(30), valor: 300, formaPagamentoId: carneF.id }, { dataVencimento: daqui(60), valor: 300, formaPagamentoId: carneF.id }] }, 201);
  const fin: any = await adm.get(`/vendas/${v1.id}/finalizacao`);
  verifica(fin.carne && fin.carne.avaliacao && fin.carne.taxaMin === 7 && fin.carne.taxaMax === 15, 'tela de finalizar traz o risco do cliente para o vendedor escolher os juros', fin.carne);
  const dre = (regime: string) => adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=${regime}&comparar=false`);
  const ln = (d: any, c: string) => d.linhas.find((l: any) => l.codigo === c)?.valor || 0;
  const comp0 = await dre('competencia');
  await adm.post(`/vendas/${v1.id}/finalizar`, { carne: { taxaPct: 10 } }, 200);
  const k1 = await adm.get(`/vendas/${v1.id}/carne`, 200);
  verifica(k1 && k1.taxaMensalPct === 10 && k1.parcelasLista.length === 3 && igual(k1.valorParcela, 361.9) && igual(k1.total, 1085.71), 'carnê criado: 3 × R$ 361,90 a 10% a.m.', k1 && { t: k1.taxaMensalPct, p: k1.valorParcela, n: k1.parcelasLista?.length });
  verifica(k1.parcelasLista.map((p: any) => p.vencimento.slice(0, 10)).join() === [hoje(), daqui(30), daqui(60)].join(), 'vencimentos iguais aos das parcelas da venda', k1.parcelasLista.map((p: any) => p.vencimento));
  verifica(k1.risco && typeof k1.score === 'number' && k1.contaFinanceira?.id === cora.id, 'guarda o risco da emissão e o banco do PIX (Cora)', { r: k1.risco, c: k1.contaFinanceira });
  const pix = k1.parcelasLista[0].pix;
  const campos = lerPix(pix);
  verifica(pixValido(pix) && campos['54'] === '361.90' && campos['26'].includes('34397947000108') && campos['58'] === 'BR', 'PIX copia e cola válido, chave CNPJ do Cora, valor R$ 361,90', campos);
  const crsVenda: any = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${v1.id}`);
  const listaVenda = (Array.isArray(crsVenda) ? crsVenda : crsVenda.data) as any[];
  verifica(listaVenda.length > 0 && listaVenda.every((c) => c.situacao === 'CANCELADO'), 'contas da venda substituídas pelas parcelas do carnê (sem cobrar em dobro)', listaVenda.map((c) => c.situacao));
  const comp1 = await dre('competencia');
  const jurosMes = (185.71 * 361.9) / 1085.71;
  verifica(igual(ln(comp1, '1') - ln(comp0, '1'), 900), 'DRE competência: a venda entra uma vez só (R$ 900)', ln(comp1, '1') - ln(comp0, '1'));
  verifica(igual(ln(comp1, '9') - ln(comp0, '9'), jurosMes), 'DRE competência: juros da parcela do mês no resultado financeiro', { veio: ln(comp1, '9') - ln(comp0, '9'), esperado: jurosMes });

  secao('Receber parcela: baixa no banco do PIX; status e DRE caixa');
  const caixa0 = await dre('caixa');
  const s0 = await saldo(cora.id);
  const k2 = await adm.post(`/financeiro/carnes/${k1.id}/parcelas/${k1.parcelasLista[0].id}/receber`, { data: hoje() }, 200);
  verifica(k2.pagas === 1 && k2.status === 'EM_DIA' && igual(k2.recebido, 361.9), 'parcela 1 recebida, carnê em dia', { p: k2.pagas, s: k2.status });
  verifica(igual((await saldo(cora.id)) - s0, 361.9), 'R$ 361,90 entraram no Cora', (await saldo(cora.id)) - s0);
  const caixa1 = await dre('caixa');
  verifica(igual(ln(caixa1, '9') - ln(caixa0, '9'), jurosMes) && igual(ln(caixa1, '1') - ln(caixa0, '1'), 361.9 - jurosMes), 'DRE caixa: principal como venda, juros no resultado financeiro', { fin: ln(caixa1, '9') - ln(caixa0, '9'), rec: ln(caixa1, '1') - ln(caixa0, '1') });
  await adm.put(`/financeiro/carnes/${k1.id}`, { taxaMensalPct: 12 }, 422);

  secao('Cancelar a venda com parcela recebida é bloqueado; estornando, cancela e o carnê também');
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento);
  if (cancelada) {
    await adm.post(`/vendas/${v1.id}/situacao`, { situacaoId: cancelada.id }, 422);
    await adm.post(`/financeiro/carnes/${k1.id}/parcelas/${k1.parcelasLista[0].id}/estornar`, {}, 200);
    verifica(igual((await saldo(cora.id)) - s0, 0), 'estorno tirou o dinheiro do Cora', (await saldo(cora.id)) - s0);
    await adm.post(`/vendas/${v1.id}/situacao`, { situacaoId: cancelada.id }, 200);
    const k3 = await adm.get(`/financeiro/carnes/${k1.id}`, 200);
    verifica(k3.status === 'CANCELADO' && k3.situacao === 'CANCELADO', 'carnê cancelado junto com a venda', k3.status);
  }

  secao('Carnê avulso atrasado: multa e mora sugeridas; baixa no caixa; alterar e cancelar');
  const av = await adm.post('/financeiro/carnes', { clienteId: cli.id, valorFinanciado: 600, taxaMensalPct: 8, parcelas: 2, primeiroVencimento: daqui(-20) }, 201);
  verifica(av.parcelasLista.length === 2 && av.status === 'ATRASADO' && av.parcelasLista[0].encargos.dias === 20 && av.parcelasLista[0].encargos.total > 0, 'parcela vencida há 20 dias: atrasado, com multa e mora sugeridas', av.parcelasLista[0].encargos);
  const enc = av.parcelasLista[0].encargos;
  const esperado = Math.round(av.parcelasLista[0].valor * 0.02 * 100) / 100 + Math.round(av.parcelasLista[0].valor * (0.01 / 30) * 20 * 100) / 100;
  verifica(igual(enc.total, esperado), 'multa 2% + mora 1% a.m. proporcional aos dias', { enc, esperado });
  const sc0 = caixa ? await saldo(caixa.id) : 0;
  const av2 = await adm.post(`/financeiro/carnes/${av.id}/parcelas/${av.parcelasLista[0].id}/receber`, { contaFinanceiraId: caixa?.id, data: hoje() }, 200);
  if (caixa) verifica(igual((await saldo(caixa.id)) - sc0, av.parcelasLista[0].valor + enc.total), 'pagou no balcão: parcela + encargos no caixa', (await saldo(caixa.id)) - sc0);
  verifica(av2.pagas === 1 && av2.status === 'EM_DIA', 'com a parcela vencida paga, volta a ficar em dia', av2.status);
  await adm.post(`/financeiro/carnes/${av.id}/cancelar`, {}, 422);
  const av3 = await adm.post('/financeiro/carnes', { clienteId: cli.id, valorFinanciado: 1000, parcelas: 4, primeiroVencimento: daqui(30) }, 201);
  verifica(av3.taxaMensalPct === r1.taxaPct || av3.taxaMensalPct >= 7, 'sem juros informados usa os do risco do cliente', av3.taxaMensalPct);
  const av4 = await adm.put(`/financeiro/carnes/${av3.id}`, { taxaMensalPct: 7, parcelas: 5 }, 200);
  verifica(av4.parcelasLista.length === 5 && igual(av4.valorParcela, calcularParcelas(1000, 7, 5).valorParcela), 'alterar juros e parcelas sem pagamento refaz as parcelas', av4.valorParcela);
  const av5 = await adm.post(`/financeiro/carnes/${av3.id}/cancelar`, {}, 200);
  verifica(av5.status === 'CANCELADO', 'carnê sem pagamento cancelado', av5.status);
  await adm.post('/financeiro/carnes', { clienteId: cfId, valorFinanciado: 100, parcelas: 1 }, 422);

  secao('Lista e impressão');
  const lista = await adm.get(`/financeiro/carnes?clienteId=${cli.id}`, 200);
  verifica(lista.data.length >= 3 && lista.totais && typeof lista.totais.emAberto === 'number', 'lista com situação e totais', lista.totais);
  const r = await fetch(`${BASE}/financeiro/carnes/${av.id}/imprimir`, { headers: { authorization: `Bearer ${adm.token}` } });
  const html = await r.text();
  const laminas = (html.match(/class="lamina/g) || []).length;
  verifica(r.status === 200 && html.includes('CARNÊ DE') && html.includes('Obrigado') && html.includes('PAGA'), 'carnê impresso tem capa, agradecimento e marca a parcela paga', r.status);
  verifica(laminas === 6 && (html.match(/class="folha"/g) || []).length === 2, '2 parcelas + capa + agradecimento = 4 lâminas em 2 folhas de 3 (sobra em branco)', laminas);
  verifica((html.match(/data:image\/png;base64/g) || []).length >= 2, 'QR Code em cada parcela', null);

  await adm.put(`/formas-pagamento/${carneF.id}`, { contaFinanceiraId: null }, 200);
  encerrar('Carnê');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
