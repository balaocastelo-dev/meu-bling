/**
 * DIAGNÓSTICO DOS DADOS ("Saúde do sistema")
 * Confere, só lendo, se os dados reais estão coerentes e se há algo que vai dar problema na operação.
 * Cada verificação diz o que está errado, quantos registros, exemplos com link e como resolver.
 * Roda: na tela Configurações → Saúde do sistema (ADMIN), toda madrugada (alerta no dashboard) e
 * no fim dos testes automáticos (o banco de teste tem que sair "limpo" das verificações de erro).
 */
import { differenceInCalendarDays, startOfMonth } from 'date-fns';
import { prisma } from '../../lib/prisma.js';
import { arredondar, competenciaDe } from '../../lib/util.js';

export type Nivel = 'erro' | 'aviso' | 'info';
export interface Achado {
  id: string;
  nivel: Nivel;
  area: string;
  titulo: string;
  qtd: number;
  explicacao: string;
  comoResolver: string;
  link?: string;
  exemplos: { rotulo: string; link?: string }[];
}

const MAX_EX = 8;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export async function diagnosticar(): Promise<{ geradoEm: Date; achados: Achado[]; verificacoes: number; resumo: Record<Nivel, number> }> {
  const achados: Achado[] = [];
  let verificacoes = 0;
  const add = (a: Omit<Achado, 'qtd' | 'exemplos'> & { itens: { rotulo: string; link?: string }[]; qtd?: number }) => {
    verificacoes++;
    const qtd = a.qtd ?? a.itens.length;
    if (qtd > 0) achados.push({ ...a, qtd, exemplos: a.itens.slice(0, MAX_EX) });
  };

  const sitVenda = await prisma.situacao.findMany({ where: { modulo: 'VENDA' } });
  const cancelVenda = sitVenda.filter((s) => s.cancelamento).map((s) => s.id);
  const finalVenda = sitVenda.filter((s) => s.final && !s.cancelamento).map((s) => s.id);
  const agora = new Date();

  // ================================================================== pessoas
  const vendSemCadastro = await prisma.usuario.findMany({ where: { perfil: 'VENDEDOR', ativo: true, vendedorId: null }, select: { id: true, nome: true } });
  add({
    id: 'usuario-vendedor-sem-cadastro', nivel: 'erro', area: 'Vendedores',
    titulo: 'Vendedor com login mas sem cadastro de vendedor',
    explicacao: 'As vendas que ele faz ficam sem vendedor (não entram no painel, na meta, no ranking nem na comissão).',
    comoResolver: 'Basta o vendedor entrar no sistema de novo: o cadastro é criado sozinho. Ou vincule em Configurações → Usuários.',
    link: '/configuracoes/usuarios',
    itens: vendSemCadastro.map((u) => ({ rotulo: u.nome, link: '/configuracoes/usuarios' })),
  });

  const comp = competenciaDe(agora);
  const vendAtivos = await prisma.vendedor.findMany({ where: { ativo: true, usuario: { isNot: null } }, select: { id: true, nome: true, metaMensal: true, metas: { where: { competencia: comp } } } });
  add({
    id: 'vendedor-sem-meta', nivel: 'info', area: 'Vendedores',
    titulo: 'Vendedor sem meta neste mês',
    explicacao: 'O painel dele mostra "Meta ainda não definida".',
    comoResolver: 'Defina em Metas e desafios → Metas do mês.',
    link: '/metas-desafios?aba=metas',
    itens: vendAtivos.filter((v) => !v.metaMensal && !v.metas.length).map((v) => ({ rotulo: v.nome, link: '/metas-desafios?aba=metas' })),
  });

  // ================================================================== vendas
  const iniMes = startOfMonth(agora);
  const semVendedorMes = await prisma.venda.findMany({ where: { tipo: 'PEDIDO', vendedorId: null, data: { gte: iniMes }, situacaoId: { notIn: cancelVenda } }, select: { id: true, numero: true, total: true, blingId: true }, orderBy: { numero: 'desc' } });
  add({
    id: 'venda-sem-vendedor-mes', nivel: 'aviso', area: 'Vendas',
    titulo: 'Venda deste mês sem vendedor',
    explicacao: 'Não conta para ninguém no painel, no ranking, nas metas e nas comissões.',
    comoResolver: 'Abra a venda → Mais ações → Transferir para vendedor.',
    link: '/vendas',
    itens: semVendedorMes.map((v) => ({ rotulo: `Venda nº ${v.numero} · ${brl(v.total)}${v.blingId ? ' (veio do Bling)' : ''}`, link: `/vendas/${v.id}` })),
  });
  const semVendedorTotal = await prisma.venda.count({ where: { tipo: 'PEDIDO', vendedorId: null, situacaoId: { notIn: cancelVenda }, data: { lt: iniMes } } });
  add({
    id: 'venda-sem-vendedor-antiga', nivel: 'info', area: 'Vendas',
    titulo: 'Vendas de meses anteriores sem vendedor',
    explicacao: 'Afetam os cards "Últimos 30 dias" e "Sempre" do painel e os relatórios por vendedor (em geral, vendas migradas do Bling).',
    comoResolver: 'Podem ser atribuídas em lote a partir do vendedor que estava no Bling.',
    qtd: semVendedorTotal,
    itens: [],
  });

  const naoLancadas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', blingId: null, situacaoId: { in: finalVenda }, OR: [{ contasLancadas: false }, { estoqueLancado: false }] },
    select: { id: true, numero: true, contasLancadas: true, estoqueLancado: true },
    take: 200,
  });
  add({
    id: 'venda-final-sem-lancamento', nivel: 'erro', area: 'Vendas',
    titulo: 'Venda fechada sem contas ou estoque lançados',
    explicacao: 'A situação diz que a venda foi concluída, mas o financeiro ou o estoque não foram movimentados.',
    comoResolver: 'Abra a venda → Mais ações → Lançar contas / Lançar estoque.',
    itens: naoLancadas.map((v) => ({ rotulo: `Venda nº ${v.numero}: ${[!v.contasLancadas && 'sem contas', !v.estoqueLancado && 'sem estoque'].filter(Boolean).join(' e ')}`, link: `/vendas/${v.id}` })),
  });

  const canceladasLancadas = await prisma.venda.findMany({ where: { tipo: 'PEDIDO', situacaoId: { in: cancelVenda }, OR: [{ contasLancadas: true }, { estoqueLancado: true }] }, select: { id: true, numero: true }, take: 200 });
  add({
    id: 'venda-cancelada-lancada', nivel: 'erro', area: 'Vendas',
    titulo: 'Venda cancelada com estoque ou contas ainda lançados',
    explicacao: 'O cancelamento não estornou tudo: o estoque/financeiro estão contando uma venda que não existe.',
    comoResolver: 'Abra a venda → Mais ações → Estornar estoque / Estornar contas.',
    itens: canceladasLancadas.map((v) => ({ rotulo: `Venda nº ${v.numero}`, link: `/vendas/${v.id}` })),
  });

  const comParcelas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', situacaoId: { notIn: cancelVenda }, data: { gte: new Date(agora.getTime() - 120 * 86400000) }, parcelas: { some: {} } },
    select: { id: true, numero: true, total: true, parcelas: { select: { valor: true } } },
  });
  const divergentes = comParcelas.filter((v) => Math.abs(v.parcelas.reduce((s, p) => s + p.valor, 0) - v.total) > 0.05);
  add({
    id: 'venda-parcelas-diferentes', nivel: 'aviso', area: 'Vendas',
    titulo: 'Soma das parcelas diferente do total da venda',
    explicacao: 'O contas a receber vai ficar diferente do valor vendido.',
    comoResolver: 'Abra a venda e ajuste as parcelas (botão "Gerar parcelas").',
    itens: divergentes.map((v) => ({ rotulo: `Venda nº ${v.numero}: total ${brl(v.total)}, parcelas ${brl(arredondar(v.parcelas.reduce((s, p) => s + p.valor, 0)))}`, link: `/vendas/${v.id}` })),
  });

  const vendasAbertasAntigas = await prisma.venda.findMany({
    where: { tipo: 'PEDIDO', situacaoId: { notIn: [...cancelVenda, ...finalVenda] }, data: { lt: new Date(agora.getTime() - 7 * 86400000) } },
    select: { id: true, numero: true, data: true },
    orderBy: { data: 'asc' },
  });
  add({
    id: 'venda-aberta-antiga', nivel: 'aviso', area: 'Vendas',
    titulo: 'Venda parada em aberto há mais de 7 dias',
    explicacao: 'Conta no painel do vendedor, mas o estoque e o financeiro ainda não foram lançados.',
    comoResolver: 'Feche (Fechada / NF emitida) ou cancele a venda.',
    itens: vendasAbertasAntigas.map((v) => ({ rotulo: `Venda nº ${v.numero} de ${v.data.toLocaleDateString('pt-BR')}`, link: `/vendas/${v.id}` })),
  });

  // ================================================================== comissões
  const comissoesOrfas = await prisma.comissao.findMany({
    where: { status: { in: ['PENDENTE', 'APROVADA'] }, origemTipo: 'VENDA', venda: { situacaoId: { in: cancelVenda } } },
    select: { id: true, valor: true, venda: { select: { id: true, numero: true } } },
  });
  add({
    id: 'comissao-venda-cancelada', nivel: 'erro', area: 'Comissões',
    titulo: 'Comissão a pagar de venda cancelada',
    explicacao: 'Se for paga, o vendedor recebe por uma venda que não aconteceu.',
    comoResolver: 'Em Comissões, selecione e cancele (ou estorne as contas da venda).',
    link: '/comissoes',
    itens: comissoesOrfas.map((c) => ({ rotulo: `${brl(c.valor)} — venda nº ${c.venda?.numero}`, link: `/vendas/${c.venda?.id}` })),
  });

  // ================================================================== financeiro
  const contasDeCanceladas = await prisma.contaReceber.findMany({
    where: { origemTipo: 'VENDA', situacao: { in: ['ABERTO', 'ATRASADO', 'PARCIAL'] } },
    select: { id: true, origemId: true, valor: true, descricao: true },
  });
  const idsVendasCanc = new Set((await prisma.venda.findMany({ where: { id: { in: contasDeCanceladas.map((c) => c.origemId!).filter(Boolean) }, situacaoId: { in: cancelVenda } }, select: { id: true } })).map((v) => v.id));
  add({
    id: 'receber-de-venda-cancelada', nivel: 'erro', area: 'Financeiro',
    titulo: 'Conta a receber em aberto de venda cancelada',
    explicacao: 'O fluxo de caixa está esperando um dinheiro que não vai entrar.',
    comoResolver: 'Cancele a conta em Financeiro → Contas a receber (ou estorne as contas na venda).',
    link: '/financeiro/receber',
    itens: contasDeCanceladas.filter((c) => c.origemId && idsVendasCanc.has(c.origemId)).map((c) => ({ rotulo: `${c.descricao} · ${brl(c.valor)}`, link: `/vendas/${c.origemId}` })),
  });

  const contas = await prisma.contaFinanceira.findMany({ where: { ativo: true }, select: { id: true, nome: true, saldoInicial: true, saldoAtual: true } });
  const somas = await prisma.movimentoFinanceiro.groupBy({ by: ['contaFinanceiraId', 'tipo'], _sum: { valor: true } });
  const saldoCalc = (id: number) => somas.filter((s) => s.contaFinanceiraId === id).reduce((t, s) => t + (s.tipo === 'ENTRADA' ? 1 : -1) * (s._sum.valor || 0), 0);
  add({
    id: 'saldo-conta-divergente', nivel: 'erro', area: 'Financeiro',
    titulo: 'Saldo da conta não bate com os movimentos',
    explicacao: 'O saldo mostrado é diferente de saldo inicial + entradas − saídas registradas.',
    comoResolver: 'Confira os últimos movimentos da conta; se precisar, lance um ajuste em Financeiro → Fluxo de caixa.',
    link: '/financeiro/bancos',
    itens: contas
      .map((c) => ({ c, esperado: arredondar(c.saldoInicial + saldoCalc(c.id)) }))
      .filter(({ c, esperado }) => Math.abs(esperado - c.saldoAtual) > 0.05)
      .map(({ c, esperado }) => ({ rotulo: `${c.nome}: mostra ${brl(c.saldoAtual)}, movimentos somam ${brl(esperado)}`, link: '/financeiro/bancos' })),
  });

  const receberVencido = await prisma.contaReceber.aggregate({ where: { situacao: { in: ['ABERTO', 'ATRASADO', 'PARCIAL'] }, vencimento: { lt: new Date(agora.getTime() - 30 * 86400000) } }, _count: { _all: true }, _sum: { valor: true } });
  add({
    id: 'receber-vencido-30', nivel: 'info', area: 'Financeiro',
    titulo: `Contas a receber vencidas há mais de 30 dias (${brl(receberVencido._sum.valor || 0)})`,
    explicacao: 'Dinheiro que ficou para trás ou conta que já foi recebida e não teve baixa.',
    comoResolver: 'Cobre o cliente ou dê baixa se já recebeu.',
    link: '/financeiro/receber?situacao=ATRASADO',
    qtd: receberVencido._count._all,
    itens: [],
  });

  // ================================================================== estoque
  const saldos = await prisma.estoqueSaldo.findMany({ where: { deposito: { desconsiderarSaldo: false } }, select: { produtoId: true, depositoId: true, saldo: true, produto: { select: { nome: true, controlaEstoque: true, tipo: true } }, deposito: { select: { nome: true } } } });
  add({
    id: 'estoque-negativo', nivel: 'aviso', area: 'Estoque',
    titulo: 'Produto com estoque negativo',
    explicacao: 'Saiu mais do que entrou: falta lançar uma compra/entrada ou houve venda em duplicidade.',
    comoResolver: 'Faça o ajuste de estoque ou lance a compra que faltou.',
    link: '/estoque',
    itens: saldos.filter((s) => s.saldo < -0.0001 && s.produto.controlaEstoque && s.produto.tipo === 'P').map((s) => ({ rotulo: `${s.produto.nome} — ${s.deposito.nome}: ${s.saldo}`, link: `/produtos/${s.produtoId}` })),
  });

  const ultimos = await prisma.$queryRawUnsafe<{ produtoId: number; depositoId: number; saldoPosterior: number }[]>(
    `SELECT m.produtoId, m.depositoId, m.saldoPosterior FROM MovimentoEstoque m
     JOIN (SELECT produtoId, depositoId, MAX(id) mx FROM MovimentoEstoque GROUP BY produtoId, depositoId) u ON u.mx = m.id`,
  );
  const mapaSaldo = new Map(saldos.map((s) => [`${s.produtoId}:${s.depositoId}`, s]));
  add({
    id: 'estoque-saldo-divergente', nivel: 'erro', area: 'Estoque',
    titulo: 'Saldo de estoque diferente do último movimento',
    explicacao: 'O saldo foi alterado sem registrar movimento (ou o contrário): a contagem não é confiável.',
    comoResolver: 'Confira a contagem física e faça um ajuste de estoque — o ajuste realinha saldo e histórico.',
    itens: ultimos
      .filter((u) => {
        const s = mapaSaldo.get(`${u.produtoId}:${u.depositoId}`);
        return s && Math.abs(Number(s.saldo) - Number(u.saldoPosterior)) > 0.0001;
      })
      .map((u) => {
        const s = mapaSaldo.get(`${u.produtoId}:${u.depositoId}`)!;
        return { rotulo: `${s.produto.nome} — ${s.deposito.nome}: saldo ${s.saldo}, último movimento ${u.saldoPosterior}`, link: `/produtos/${u.produtoId}` };
      }),
  });

  // ================================================================== fiscal
  const notasProblema = await prisma.notaFiscal.findMany({ where: { situacao: { in: ['REJEITADA', 'ERRO'] } }, select: { id: true, numero: true, motivo: true }, orderBy: { id: 'desc' } });
  add({
    id: 'nota-rejeitada', nivel: 'erro', area: 'Fiscal',
    titulo: 'Nota fiscal rejeitada ou com erro',
    explicacao: 'A nota não foi autorizada pela SEFAZ: o cliente ficou sem nota.',
    comoResolver: 'Abra a nota, corrija o que o motivo diz e transmita de novo.',
    link: '/notas-fiscais?situacao=REJEITADA',
    itens: notasProblema.map((n) => ({ rotulo: `NF ${n.numero}: ${(n.motivo || 'sem motivo').slice(0, 90)}`, link: `/notas-fiscais/${n.id}` })),
  });
  const notasParadas = await prisma.notaFiscal.findMany({ where: { situacao: { in: ['PENDENTE', 'PROCESSANDO'] }, criadoEm: { lt: new Date(agora.getTime() - 24 * 3600000) } }, select: { id: true, numero: true } });
  add({
    id: 'nota-parada', nivel: 'aviso', area: 'Fiscal',
    titulo: 'Nota fiscal pendente há mais de 1 dia',
    explicacao: 'Foi gerada e não foi transmitida (ou ficou sem resposta da SEFAZ).',
    comoResolver: 'Abra a nota e clique em Transmitir / Consultar.',
    itens: notasParadas.map((n) => ({ rotulo: `NF ${n.numero}`, link: `/notas-fiscais/${n.id}` })),
  });
  const semNcm = await prisma.produto.findMany({
    where: { ativo: true, tipo: 'P', OR: [{ ncm: null }, { ncm: '' }], vendaItens: { some: { venda: { data: { gte: new Date(agora.getTime() - 60 * 86400000) }, tipo: 'PEDIDO' } } } },
    select: { id: true, nome: true },
    take: 200,
  });
  add({
    id: 'produto-sem-ncm', nivel: 'aviso', area: 'Fiscal',
    titulo: 'Produto vendido recentemente sem NCM',
    explicacao: 'A NF-e de uma venda com esse produto vai ser recusada.',
    comoResolver: 'Abra o produto e preencha o NCM (aba Fiscal).',
    itens: semNcm.map((p) => ({ rotulo: p.nome, link: `/produtos/${p.id}/editar` })),
  });
  const empresa = await prisma.empresa.findUnique({ where: { id: 1 }, select: { certificadoValidade: true } });
  const diasCert = empresa?.certificadoValidade ? differenceInCalendarDays(empresa.certificadoValidade, agora) : null;
  add({
    id: 'certificado', nivel: diasCert === null || diasCert < 0 ? 'erro' : 'aviso', area: 'Fiscal',
    titulo: diasCert === null ? 'Certificado digital A1 não instalado' : diasCert < 0 ? 'Certificado digital A1 vencido' : `Certificado digital vence em ${diasCert} dias`,
    explicacao: 'Sem certificado válido não sai NF-e.',
    comoResolver: 'Envie o certificado novo em Configurações → Fiscal.',
    link: '/configuracoes/fiscal',
    qtd: diasCert === null || diasCert <= 30 ? 1 : 0,
    itens: [],
  });

  // ================================================================== OS
  const sitOs = await prisma.situacao.findMany({ where: { modulo: 'OS', OR: [{ final: true }, { cancelamento: true }] }, select: { id: true } });
  const osAtrasadas = await prisma.ordemServico.findMany({ where: { dataPrevista: { lt: agora }, situacaoId: { notIn: sitOs.map((s) => s.id) } }, select: { id: true, numero: true, dataPrevista: true }, orderBy: { dataPrevista: 'asc' } });
  add({
    id: 'os-atrasada', nivel: 'aviso', area: 'Assistência',
    titulo: 'Ordem de serviço com previsão vencida',
    explicacao: 'O cliente está esperando além do prazo combinado.',
    comoResolver: 'Atualize a situação ou a nova previsão e avise o cliente.',
    link: '/ordens-servico?atrasadas=true',
    itens: osAtrasadas.map((o) => ({ rotulo: `OS nº ${o.numero} (previsão ${o.dataPrevista?.toLocaleDateString('pt-BR')})`, link: `/ordens-servico/${o.id}` })),
  });

  const ordem: Record<Nivel, number> = { erro: 0, aviso: 1, info: 2 };
  achados.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || b.qtd - a.qtd);
  const resumo = { erro: 0, aviso: 0, info: 0 } as Record<Nivel, number>;
  for (const a of achados) resumo[a.nivel]++;
  return { geradoEm: agora, achados, verificacoes, resumo };
}
