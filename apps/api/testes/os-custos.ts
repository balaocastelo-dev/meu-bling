/**
 * CUSTOS INTERNOS DA OS + DASHBOARD DE ASSISTÊNCIA TÉCNICA (26/10/2026)
 * Custo da peça, logística e mão de obra de terceiro: gravam na OS, podem ser lançados depois de concluída,
 * NÃO aparecem na impressão nem no link do cliente, e alimentam o dashboard de assistência (só ADMIN).
 *   npx tsx testes/os-custos.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const sitO: any[] = await adm.get('/situacoes?modulo=OS');
  const sit = (nome: string) => sitO.find((s) => s.nome === nome)?.id;

  const cli = await adm.post('/contatos', { nome: `Cliente Custos OS ${SUF}`, tipoPessoa: 'F', celular: '19999990000' }, 201);

  secao('Cadastrar OS com os 3 custos internos');
  const os = await adm.post(
    '/ordens-servico',
    {
      contatoId: cli.id,
      dataEntrada: hoje(),
      equipamento: 'Notebook',
      defeitoRelatado: 'Tela quebrada',
      itens: [
        { tipo: 'SERVICO', descricao: 'Troca de tela', quantidade: 1, valorUnitario: 200 },
        { tipo: 'PECA', descricao: 'Tela 15.6 (linha livre)', quantidade: 1, valorUnitario: 450 },
      ],
      custoPeca: 280,
      custoLogistica: 25,
      custoMaoObraTerceiro: 40,
    },
    201,
  );
  verifica(igual(os.total, 650), 'total da OS = 650 (200 serviço + 450 peça)', os.total);
  verifica(igual(os.custoPeca, 280) && igual(os.custoLogistica, 25) && igual(os.custoMaoObraTerceiro, 40), 'custos gravados na OS', os);
  verifica(os.fechamento && igual(os.fechamento.custoTotal, 345) && igual(os.fechamento.lucro, 305), 'fechamento: custo 345, lucro 305', os.fechamento);

  secao('Custos não vão para o cliente');
  for (const via of ['cliente', 'tecnico', 'etiqueta']) {
    const html: string = await adm.get(`/ordens-servico/${os.id}/imprimir?via=${via}`);
    const vazou = /280,00|35,00|40,00|custo da pe[çc]a|log[ií]stica|m[ãa]o de obra de terceiro|lucro/i.test(String(html));
    verifica(!vazou, `impressão "${via}" não mostra os custos internos`);
  }
  const pub = await adm.get(`/publico/os/${os.tokenPublico}`);
  const txt = JSON.stringify(pub);
  verifica(!/custoPeca|custoLogistica|custoMaoObraTerceiro|fechamento|lucro/.test(txt), 'link público do cliente não traz custo nem lucro', txt.slice(0, 200));

  secao('Lançar/ajustar custo depois de concluída (estoque/contas já lançados)');
  for (const nome of ['Em andamento', 'Concluída', 'Entregue']) if (sit(nome)) await adm.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: sit(nome) });
  const os2 = await adm.put(`/ordens-servico/${os.id}`, { custoLogistica: 35 });
  verifica(igual(os2.custoLogistica, 35), 'logística alterada para 35 com a OS concluída', os2.custoLogistica);
  verifica(igual(os2.fechamento.lucro, 295), 'lucro recalculado = 295', os2.fechamento?.lucro);

  secao('Dashboard de assistência técnica');
  const d = await adm.get(`/dashboard/assistencia?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  const linha = d.ordens?.find((o: any) => o.id === os.id);
  verifica(linha && igual(linha.valorEntrada, 650) && igual(linha.maoDeObra, 200) && igual(linha.pecas, 450), 'a OS aparece com valor de entrada, mão de obra e peças', linha);
  verifica(linha && igual(linha.custoPecas, 280) && igual(linha.lucro, 295), 'a OS aparece com custo da peça e lucro', linha);
  verifica(d.resumo && d.resumo.valorEntrada >= 650 && d.resumo.lucro >= 295 - 0.01, 'resumo soma a OS', d.resumo);
  verifica(igual(d.resumo.valorEntrada, d.resumo.maoDeObra + d.resumo.pecas - d.resumo.descontos), 'valor de entrada = mão de obra + peças - descontos', d.resumo);
  verifica(igual(d.resumo.lucro, d.resumo.valorEntrada - d.resumo.custoTotal), 'lucro = entrada - custos', d.resumo);
  const dc = await adm.get(`/dashboard/assistencia?base=conclusao&dataInicial=${hoje()}&dataFinal=${hoje()}`);
  verifica(dc.ordens?.some((o: any) => o.id === os.id), 'por data de conclusão também aparece (fechamento do mês)');

  secao('Sem custo informado: usa o custo da peça cadastrada');
  const os3 = await adm.post('/ordens-servico', { contatoId: cli.id, dataEntrada: hoje(), equipamento: 'Desktop', defeitoRelatado: 'Não liga', itens: [{ tipo: 'SERVICO', descricao: 'Diagnóstico', quantidade: 1, valorUnitario: 80 }] }, 201);
  verifica(os3.fechamento?.custoPecasOrigem === 'CADASTRO' && igual(os3.fechamento.lucro, 80), 'OS só de serviço sem custo: lucro = 80', os3.fechamento);

  secao('Pagar técnico: % do lucro vira conta a pagar');
  const tecPg = await adm.post('/tecnicos', { nome: `Técnico Pago ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const dash = await adm.get(`/dashboard/assistencia?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  const lucroConcluidas = dash.resumo.realizado.lucro as number;
  const corpoPg = { dataInicial: hoje(), dataFinal: hoje(), base: 'entrada', tecnicoId: tecPg.id, percentual: 10, escopo: 'SOMENTE_CONCLUIDAS' };
  const prev = await adm.post('/dashboard/assistencia/pagar-tecnico', { ...corpoPg, simular: true }, 200);
  verifica(igual(prev.lucro, lucroConcluidas) && igual(prev.valor, lucroConcluidas * 0.1), 'prévia = 10% do lucro das OS concluídas', { prev, lucroConcluidas });
  const pg = await adm.post('/dashboard/assistencia/pagar-tecnico', corpoPg, 201);
  verifica(pg.contaPagar?.id && igual(pg.contaPagar.valor, prev.valor), 'lançou no contas a pagar com o valor da prévia', pg);
  const cp = await adm.get(`/contas-pagar/${pg.contaPagar.id}`);
  verifica(cp.situacao === 'ABERTO' && String(cp.descricao).includes(tecPg.nome), 'conta a pagar em aberto, com o nome do técnico', cp.descricao);
  await adm.post('/dashboard/assistencia/pagar-tecnico', corpoPg, 409);
  const pg2 = await adm.post('/dashboard/assistencia/pagar-tecnico', { ...corpoPg, confirmarDuplicado: true }, 201);
  verifica(pg2.contaPagar?.id && pg2.contaPagar.id !== pg.contaPagar.id, 'confirmando, lança o segundo pagamento');
  const hist = await adm.get('/dashboard/assistencia/pagamentos-tecnico');
  verifica(hist.some((h: any) => h.id === pg.contaPagar.id), 'aparece nos últimos pagamentos de técnico');
  await adm.post('/dashboard/assistencia/pagar-tecnico', { ...corpoPg, dataInicial: '2001-01-01', dataFinal: '2001-01-31' }, 422);
  await adm.post('/dashboard/assistencia/pagar-tecnico', { ...corpoPg, percentual: 0 }, [400, 422]);

  secao('Dashboard principal (panorama): vendas + assistência no período');
  const pano = await adm.get(`/dashboard/panorama?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  const dv = await adm.get(`/dashboard/vendas?dataInicial=${hoje()}&dataFinal=${hoje()}&comparar=false`);
  const da = await adm.get(`/dashboard/assistencia?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  const rp = pano.resumo;
  verifica(igual(rp.vendas.valor, dv.resumo.faturamento) && rp.vendas.qtd === dv.resumo.qtdVendas, 'vendas do panorama = dashboard de vendas', { p: rp.vendas, v: dv.resumo });
  verifica(igual(rp.vendas.lucro, dv.resumo.lucroBruto), 'lucro das vendas = lucro bruto do dashboard de vendas', { p: rp.vendas.lucro, v: dv.resumo.lucroBruto });
  verifica(igual(rp.assistencia.valor, da.resumo.valorEntrada) && igual(rp.assistencia.lucro, da.resumo.lucro), 'assistência do panorama = dashboard de assistência', { p: rp.assistencia, a: da.resumo });
  verifica(igual(rp.faturamento, rp.vendas.valor + rp.assistencia.valor), 'faturamento = vendas + assistência', rp);
  verifica(igual(rp.lucro, rp.vendas.lucro + rp.assistencia.lucro) && igual(rp.lucro, rp.faturamento - rp.custo), 'lucro = lucro vendas + lucro assistência = faturamento - custos', rp);
  verifica(igual(rp.caixa.saldo, rp.caixa.entradas - rp.caixa.saidas), 'caixa: saldo = entrou - saiu', rp.caixa);
  const somaSerie = pano.series.reduce((s: number, x: any) => s + x.vendas + x.assistencia, 0);
  verifica(igual(somaSerie, rp.faturamento), 'gráfico soma o mesmo faturamento', { somaSerie, fat: rp.faturamento });
  verifica(rp.comparativo && typeof rp.comparativo.faturamento === 'number', 'traz o período anterior para comparar');
  // transferência entre contas não mexe no caixa do período
  const contasFin: any[] = await adm.get('/contas-financeiras');
  if (contasFin.length >= 2) {
    await adm.post('/financeiro/transferencia', { origemId: contasFin[0].id, destinoId: contasFin[1].id, valor: 123.45, data: hoje() }, [200, 201]);
    const pano2 = await adm.get(`/dashboard/panorama?dataInicial=${hoje()}&dataFinal=${hoje()}`);
    verifica(igual(pano2.resumo.caixa.entradas, rp.caixa.entradas) && igual(pano2.resumo.caixa.saidas, rp.caixa.saidas), 'transferência entre contas não entra no caixa do período', pano2.resumo.caixa);
  }
  const vazio = await adm.get('/dashboard/panorama?dataInicial=2001-01-01&dataFinal=2001-01-07');
  verifica(vazio.resumo.faturamento === 0 && vazio.series.length === 7, 'período sem movimento: zero e 7 dias no gráfico', vazio.resumo.faturamento);

  secao('Permissões');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Tecnico custos ${SUF}`, email: `tc${SUF}@teste.com`, senha, perfil: 'TECNICO' }, 201);
  const tec = await entrar(`tc${SUF}@teste.com`, senha);
  tec.nome = 'TECNICO';
  await tec.get(`/dashboard/assistencia`, 403);
  await tec.get(`/dashboard/panorama`, 403);
  await tec.post('/dashboard/assistencia/pagar-tecnico', { tecnicoId: 1, percentual: 10 }, 403);
  const vistaTec = await tec.get(`/ordens-servico/${os.id}`);
  verifica(vistaTec.fechamento === null && igual(vistaTec.custoPeca, 280), 'técnico vê/lança os custos, mas não o lucro', vistaTec.fechamento);

  encerrar('Custos internos da OS e dashboard de assistência');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
