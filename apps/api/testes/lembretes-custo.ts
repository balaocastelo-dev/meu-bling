/**
 * LEMBRETES DE CUSTO (29/10/2026) — a OS tem os mesmos campos de despesa da venda e o Robô da Saúde
 * lembra técnicos e vendedores do que falta preencher.
 * - Peça da OS com custo por item (coluna "Custo un."), inclusive com a OS já baixada/lançada.
 * - OS com peça sem custo: `pendenciasCusto` na OS; fechar (situação final) devolve 422 OS_CUSTO_PENDENTE
 *   e só fecha com confirmarCusto (lembrete, não trava).
 * - Robô da Saúde: aviso "os-sem-custo" com tecnicoId → GET /lembretes do técnico traz; preencheu → some.
 * - Venda com produto sem custo: aviso "venda-sem-custo" com vendedorId → GET /lembretes do vendedor.
 * - Gerente vê os lembretes da equipe com o nome de quem precisa agir; técnico não vê os dos outros.
 * - DRE: taxa de cartão, logística e terceiro da OS entram nas despesas operacionais.
 *   DATABASE_URL=file:... npx tsx testes/lembretes-custo.ts http://localhost:3333
 */
import { PrismaClient } from '@prisma/client';
import { clienteCompleto, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const db = new PrismaClient();

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'senha-lembrete-1';

  secao('Cadastros: técnico, vendedor e gerente com login');
  const tecnico = await adm.post('/tecnicos', { nome: `Tec Lembrete ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  const outroTec = await adm.post('/tecnicos', { nome: `Tec Outro ${SUF}`, comissaoPadraoPct: 0, ativo: true }, [200, 201]);
  await adm.post('/usuarios', { nome: `Tec Lembrete ${SUF}`, email: `tecl${SUF}@teste.com`, senha, perfil: 'TECNICO', tecnicoId: tecnico.id }, 201);
  await adm.post('/usuarios', { nome: `Tec Outro ${SUF}`, email: `teco${SUF}@teste.com`, senha, perfil: 'TECNICO', tecnicoId: outroTec.id }, 201);
  const vend = await adm.post('/vendedores', { nome: `Vend Lembrete ${SUF}` }, 201);
  await adm.post('/usuarios', { nome: `Vend Lembrete ${SUF}`, email: `vendl${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  await adm.post('/usuarios', { nome: `Ger Lembrete ${SUF}`, email: `gerl${SUF}@teste.com`, senha, perfil: 'GERENTE' }, 201);
  const T = await entrar(`tecl${SUF}@teste.com`, senha);
  T.nome = 'TECNICO';
  const T2 = await entrar(`teco${SUF}@teste.com`, senha);
  T2.nome = 'TECNICO2';
  const V = await entrar(`vendl${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  const G = await entrar(`gerl${SUF}@teste.com`, senha);
  G.nome = 'GERENTE';
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Lembrete ${SUF}`), 201);
  const sitO: any[] = await adm.get('/situacoes?modulo=OS');
  const sit = (nome: string) => sitO.find((s) => s.nome === nome)?.id;
  const finalOs = sitO.find((s) => s.final && !s.cancelamento && s.ativo) ?? sitO.find((s) => s.final && !s.cancelamento);
  const emp = await adm.get('/empresa');
  const aliq = Number(emp.aliquotaSimplesPct ?? 10);

  secao('OS com peça sem custo: pendência na OS e custo por peça');
  const prodComCusto = await adm.post('/produtos', { nome: `SSD Lembrete ${SUF}`, codigo: `LEMB-${SUF}`, preco: 300, precoCusto: 180, controlaEstoque: true, tipo: 'P', ncm: '84717012', estoqueInicial: 5 }, 201);
  const os = await T.post(
    '/ordens-servico',
    {
      contatoId: cli.id,
      tecnicoId: tecnico.id,
      dataEntrada: hoje(),
      equipamento: 'Notebook',
      defeitoRelatado: 'Lento',
      itens: [
        { tipo: 'SERVICO', descricao: 'Formatação', quantidade: 1, valorUnitario: 100 },
        { tipo: 'PECA', produtoId: prodComCusto.id, quantidade: 1, valorUnitario: 300 },
        { tipo: 'PECA', descricao: 'Memória 8GB (linha livre)', quantidade: 1, valorUnitario: 200 },
      ],
    },
    201,
  );
  const pecaCad = os.itens.find((i: any) => i.produtoId === prodComCusto.id);
  const pecaLivre = os.itens.find((i: any) => /Mem/.test(i.descricao));
  verifica(igual(pecaCad.custoUnitario, 180) && pecaCad.custoInformado === false, 'peça do cadastro vem com o custo do produto (não informado)', pecaCad);
  verifica(igual(pecaLivre.custoUnitario, 0), 'linha livre começa sem custo', pecaLivre);
  verifica(Array.isArray(os.pendenciasCusto) && os.pendenciasCusto.length === 1 && /Mem/.test(os.pendenciasCusto[0].mensagem), 'OS avisa a peça sem custo (técnico também vê)', os.pendenciasCusto);
  verifica(os.fechamento === null, 'técnico não vê o lucro', os.fechamento);
  const lista = await T.get(`/ordens-servico?pesquisa=${os.numero}`);
  const linha = lista.data.find((o: any) => o.id === os.id);
  verifica(linha && linha.pecasSemCusto === 1 && linha.custoPeca === undefined && linha.itens === undefined, 'lista marca "1 peça sem custo" sem expor os custos', linha);

  secao('Fechar a OS com peça sem custo: lembrete (422) e fecha com confirmarCusto');
  for (const nome of ['Em andamento']) if (sit(nome)) await T.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: sit(nome) });
  const bloqueio = await adm.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: finalOs.id, forcar: true }, 422);
  verifica(bloqueio.code === 'OS_CUSTO_PENDENTE' && bloqueio.detalhes?.pendencias?.length === 1 && bloqueio.detalhes?.osId === os.id, 'situação final sem custo → 422 OS_CUSTO_PENDENTE com a lista', bloqueio);
  const fechou = await adm.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: finalOs.id, forcar: true, confirmarCusto: true }, 200);
  verifica(fechou.situacao?.id === finalOs.id, '"Fechar assim mesmo" (confirmarCusto) fecha a OS', fechou);
  const osF = await adm.get(`/ordens-servico/${os.id}`);
  verifica(osF.estoqueLancado || osF.contasLancadas, 'OS fechada lançou estoque/contas', { e: osF.estoqueLancado, c: osF.contasLancadas });

  secao('Robô da Saúde: lembrete para o técnico da OS');
  let p = await adm.post('/robo-saude/rodar');
  const avisoOs = (p.abertas as any[]).find((a) => a.chave === `os-sem-custo:os:${os.id}`);
  verifica(!!avisoOs && avisoOs.tecnicoId === tecnico.id && avisoOs.link === `/ordens-servico/${os.id}/editar`, 'robô abriu o aviso da OS com o técnico como destinatário', avisoOs);
  const lT = await T.get('/lembretes');
  verifica(lT.meus.some((l: any) => l.id === avisoOs?.id), 'GET /lembretes do técnico traz o lembrete dele', lT.meus.map((l: any) => l.chave));
  verifica(lT.equipe.length === 0, 'técnico não recebe a lista da equipe', lT.equipe.length);
  const lT2 = await T2.get('/lembretes');
  verifica(!lT2.meus.some((l: any) => l.id === avisoOs?.id), 'outro técnico não recebe o lembrete', lT2.meus.length);
  const lG = await G.get('/lembretes');
  const daEquipe = lG.equipe.find((l: any) => l.id === avisoOs?.id);
  verifica(daEquipe && daEquipe.quem === tecnico.nome, 'gerente vê o lembrete na equipe com o nome do técnico', daEquipe);
  await adm.get('/lembretes', 200);

  secao('Técnico preenche o custo da peça com a OS já lançada → lembrete some');
  const corpo = { itens: osF.itens.map((i: any) => ({ tipo: i.tipo, produtoId: i.produtoId, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto, custoUnitario: /Mem/.test(i.descricao) ? 120 : i.custoInformado ? i.custoUnitario : null, comissaoVendedorPct: i.comissaoVendedorPct, comissaoTecnicoPct: i.comissaoTecnicoPct, depositoId: i.depositoId })) };
  const osC = await T.put(`/ordens-servico/${os.id}`, corpo, 200);
  const pecaLivre2 = osC.itens.find((i: any) => /Mem/.test(i.descricao));
  verifica(igual(pecaLivre2.custoUnitario, 120) && pecaLivre2.custoInformado === true, 'custo da peça gravado com a OS lançada', pecaLivre2);
  verifica(igual(osC.custoTotal, 300), 'custo total das peças = 180 (cadastro) + 120 (informado)', osC.custoTotal);
  verifica(osC.pendenciasCusto.length === 0, 'sem pendência de custo', osC.pendenciasCusto);
  verifica(osC.estoqueLancado === osF.estoqueLancado && igual(osC.total, osF.total), 'total e lançamentos não mudam', osC.total);
  const osAdm = await adm.get(`/ordens-servico/${os.id}`);
  const f = osAdm.fechamento;
  const impostoOs = Math.round(600 * aliq) / 100;
  verifica(f && igual(f.custoPecas, 300) && igual(f.imposto, impostoOs) && igual(f.custoTotal, 300 + impostoOs) && igual(f.lucro, 600 - 300 - impostoOs), 'fechamento: peças 300 + imposto, lucro = 600 - custo', f);
  p = await adm.post('/robo-saude/rodar');
  verifica(!(p.abertas as any[]).some((a) => a.chave === `os-sem-custo:os:${os.id}`), 'lembrete da OS sumiu depois de preencher o custo', (p.abertas as any[]).filter((a) => a.chave.startsWith('os-sem-custo')).length);
  verifica(!(await T.get('/lembretes')).meus.some((l: any) => l.chave === `os-sem-custo:os:${os.id}`), 'painel do técnico sem o lembrete');
  // mexer em quantidade continua bloqueado
  await T.put(`/ordens-servico/${os.id}`, { itens: corpo.itens.map((i: any) => ({ ...i, quantidade: i.quantidade + 1 })) }, 422);

  secao('Fechar com todas as peças com custo: sem lembrete');
  const os2 = await T.post('/ordens-servico', { contatoId: cli.id, tecnicoId: tecnico.id, dataEntrada: hoje(), equipamento: 'Desktop', defeitoRelatado: 'Não liga', itens: [{ tipo: 'PECA', descricao: 'Fonte 500W', quantidade: 1, valorUnitario: 250, custoUnitario: 140 }] }, 201);
  verifica(os2.pendenciasCusto.length === 0 && os2.itens[0].custoInformado === true, 'peça com custo informado na abertura: sem pendência', os2.itens[0]);
  const ok2 = await adm.post(`/ordens-servico/${os2.id}/situacao`, { situacaoId: finalOs.id, forcar: true }, 200);
  verifica(ok2.situacao?.id === finalOs.id, 'fecha direto, sem pedir confirmação');

  secao('Venda com produto sem custo: lembrete para o vendedor');
  const formas: any[] = await adm.get('/formas-pagamento');
  const dinheiro = formas.find((f) => f.tipo === 'DINHEIRO') ?? formas[0];
  // produto sem custo no cadastro e sem custo informado
  const prodSem = await adm.post('/produtos', { nome: `Cabo Lembrete ${SUF}`, codigo: `LEMBC-${SUF}`, preco: 50, precoCusto: 0, controlaEstoque: false, tipo: 'P', ncm: '85444200' }, 201);
  const venda = await V.post('/vendas', { contatoId: cli.id, vendedorId: vend.id, data: hoje(), itens: [{ produtoId: prodSem.id, descricao: prodSem.nome, quantidade: 2, valorUnitario: 50 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: dinheiro.id }] }, 201);
  p = await adm.post('/robo-saude/rodar');
  const avisoV = (p.abertas as any[]).find((a) => a.chave === `venda-sem-custo:venda:${venda.id}`);
  verifica(!!avisoV && avisoV.vendedorId === vend.id && avisoV.link === `/vendas/${venda.id}/editar`, 'robô abriu o aviso da venda com o vendedor como destinatário', avisoV);
  const lV = await V.get('/lembretes');
  verifica(lV.meus.some((l: any) => l.id === avisoV?.id), 'GET /lembretes do vendedor traz o lembrete dele', lV.meus.map((l: any) => l.chave));
  verifica(!(await T.get('/lembretes')).meus.some((l: any) => l.id === avisoV?.id), 'técnico não recebe o lembrete do vendedor');
  const vCorr = await V.put(`/vendas/${venda.id}`, { itens: [{ produtoId: prodSem.id, descricao: prodSem.nome, quantidade: 2, valorUnitario: 50, custoUnitario: 20 }] }, 200);
  verifica(igual(vCorr.custoTotal, 40), 'vendedor preencheu o custo (2 × 20)', vCorr.custoTotal);
  p = await adm.post('/robo-saude/rodar');
  verifica(!(p.abertas as any[]).some((a) => a.chave === `venda-sem-custo:venda:${venda.id}`), 'lembrete da venda sumiu depois do custo', (p.abertas as any[]).filter((a) => a.chave.startsWith('venda-sem-custo')).length);

  secao('OS sem técnico com peça sem custo: a gerência vê que não tem dono');
  const osSemTec = await adm.post('/ordens-servico', { contatoId: cli.id, tecnicoId: null, dataEntrada: hoje(), equipamento: 'Impressora', defeitoRelatado: 'Não imprime', itens: [{ tipo: 'PECA', descricao: 'Cabeça de impressão', quantidade: 1, valorUnitario: 90 }] }, 201);
  p = await adm.post('/robo-saude/rodar');
  const avisoSem = (p.abertas as any[]).find((a) => a.chave === `os-sem-custo:os:${osSemTec.id}`);
  verifica(!!avisoSem && avisoSem.tecnicoId === null, 'aviso sem destinatário (OS sem técnico)', avisoSem);
  const lG2 = await G.get('/lembretes');
  verifica(lG2.semDono >= 1, 'gerente vê a contagem de OS sem dono', lG2.semDono);
  verifica(!(await T.get('/lembretes')).meus.some((l: any) => l.id === avisoSem?.id), 'ninguém recebe o lembrete da OS sem técnico');

  secao('DRE: cartão, logística e terceiro da OS entram nas despesas operacionais');
  const credito = formas.find((f) => f.tipo === 'CARTAO_CREDITO');
  const dre0 = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=competencia&comparar=false`);
  const osDre = await adm.post('/ordens-servico', { contatoId: cli.id, tecnicoId: tecnico.id, dataEntrada: hoje(), equipamento: 'Tablet', defeitoRelatado: 'Tela', itens: [{ tipo: 'PECA', descricao: 'Tela tablet', quantidade: 1, valorUnitario: 1000, custoUnitario: 400 }], custoLogistica: 30, custoMaoObraTerceiro: 70, parcelas: credito ? [{ dataVencimento: hoje(), valor: 1000, formaPagamentoId: credito.id }] : [] }, 201);
  await adm.post(`/ordens-servico/${osDre.id}/situacao`, { situacaoId: finalOs.id, forcar: true }, 200);
  const fD = (await adm.get(`/ordens-servico/${osDre.id}`)).fechamento;
  verifica(fD && igual(fD.custoLogistica, 30) && igual(fD.custoMaoObraTerceiro, 70) && (!credito || fD.taxaCartao > 0), 'fechamento da OS traz logística, terceiro e taxa do cartão', fD);
  const dre1 = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=competencia&comparar=false`);
  const linhaDre = (d: any, nome: string) => (d.linhas as any[]).flatMap((l) => l.itens ?? []).find((i: any) => i.nome === nome)?.valor ?? 0;
  verifica(igual(linhaDre(dre1, 'Logística das OS') - linhaDre(dre0, 'Logística das OS'), 30), 'DRE: +30 em "Logística das OS"', linhaDre(dre1, 'Logística das OS'));
  verifica(igual(linhaDre(dre1, 'Mão de obra de terceiros (OS)') - linhaDre(dre0, 'Mão de obra de terceiros (OS)'), 70), 'DRE: +70 em "Mão de obra de terceiros (OS)"', linhaDre(dre1, 'Mão de obra de terceiros (OS)'));
  if (credito) verifica(igual(linhaDre(dre1, 'Taxas de cartão (OS)') - linhaDre(dre0, 'Taxas de cartão (OS)'), fD.taxaCartao), 'DRE: taxa do cartão da OS', linhaDre(dre1, 'Taxas de cartão (OS)'));
  verifica(igual(linhaDre(dre1, 'Custo das peças (OS)') - linhaDre(dre0, 'Custo das peças (OS)'), 400), 'DRE: +400 em "Custo das peças (OS)" (CMV)', linhaDre(dre1, 'Custo das peças (OS)'));

  await db.$disconnect();
  encerrar('Lembretes de custo: OS com os campos da venda + Robô da Saúde avisando técnicos e vendedores');
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
