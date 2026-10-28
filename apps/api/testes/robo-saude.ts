/**
 * ROBÔ DA SAÚDE (28/10/2026)
 * - Estraga dados de propósito (direto no banco de teste) e confere que o robô:
 *   corrige sozinho (venda "Fechada" sem contas/estoque → lança e dá baixa do PIX; histórico do estoque fora do saldo),
 *   deixa sugestão com botão de 1 clique (saldo do banco ≠ lançamentos → recalcular; venda sem vendedor → atribuir
 *   a quem lançou) e o botão resolve; sugestão ignorada não volta; problema resolvido some sozinho.
 * - Só o ADMIN vê o robô (vendedor e gerente recebem 403).
 *   DATABASE_URL=file:... npx tsx testes/robo-saude.ts http://localhost:3333
 */
import { PrismaClient } from '@prisma/client';
import { clienteCompleto, encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

const db = new PrismaClient();

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  secao('Só o ADMIN acessa o robô');
  const senha = 'senha-robo-saude-1';
  const vend = await adm.post('/vendedores', { nome: `Vend Saude ${SUF}` }, 201);
  await adm.post('/usuarios', { nome: `Vend Saude ${SUF}`, email: `saude${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vend.id }, 201);
  await adm.post('/usuarios', { nome: `Gerente Saude ${SUF}`, email: `gsaude${SUF}@teste.com`, senha, perfil: 'GERENTE' }, 201);
  const V = await entrar(`saude${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  const G = await entrar(`gsaude${SUF}@teste.com`, senha);
  G.nome = 'GERENTE';
  await V.get('/robo-saude', 403);
  await G.get('/robo-saude', 403);
  await G.post('/robo-saude/rodar', {}, 403);
  const p0 = await adm.get('/robo-saude');
  verifica(p0.config?.ligado === true && p0.config?.autoCorrigir === true, 'robô vem ligado e corrigindo sozinho', p0.config);

  // ---------------------------------------------------------------- dados
  const formas: any[] = await adm.get('/formas-pagamento');
  const pix = formas.find((f) => f.tipo === 'PIX') ?? formas[0];
  const prod = await adm.post('/produtos', { nome: `Mouse Saude ${SUF}`, codigo: `SAUDE-${SUF}`, preco: 100, precoCusto: 40, controlaEstoque: true, tipo: 'P', ncm: '84716053', estoqueInicial: 10 }, 201);
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Saude ${SUF}`), 201);

  secao('Venda "Fechada" sem contas e estoque: o robô lança sozinho (e dá baixa do PIX)');
  const venda = await V.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 100 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: pix.id }] }, 201);
  await new Promise((r) => setTimeout(r, 800)); // o "pago na hora" roda depois de salvar
  const fechada = await db.situacao.findFirst({ where: { modulo: 'VENDA', final: true, cancelamento: false, ativo: true } });
  // simula o bug: alguém (ou uma importação) marcou como Fechada sem rodar as ações
  await db.contaReceber.deleteMany({ where: { origemTipo: 'VENDA', origemId: venda.id } }).catch(() => undefined);
  await db.movimentoFinanceiro.deleteMany({ where: { observacoes: { contains: 'pago na hora' }, contaReceberId: null } }).catch(() => undefined);
  await db.vendaParcela.updateMany({ where: { vendaId: venda.id }, data: { contaReceberId: null } });
  await db.venda.update({ where: { id: venda.id }, data: { situacaoId: fechada!.id, contasLancadas: false, estoqueLancado: false } });
  // o saldo do banco pode ter ficado com o PIX que apagamos: realinha para o teste começar limpo
  for (const c of await db.contaFinanceira.findMany()) {
    const somas = await db.movimentoFinanceiro.groupBy({ by: ['tipo'], where: { contaFinanceiraId: c.id }, _sum: { valor: true } });
    const movs = somas.reduce((t, s) => t + (s.tipo === 'ENTRADA' ? 1 : -1) * (s._sum.valor || 0), 0);
    await db.contaFinanceira.update({ where: { id: c.id }, data: { saldoAtual: Math.round((c.saldoInicial + movs) * 100) / 100 } });
  }

  let p = await adm.post('/robo-saude/rodar');
  const v1 = await db.venda.findUnique({ where: { id: venda.id } });
  verifica(v1?.contasLancadas && v1?.estoqueLancado, 'robô lançou contas e estoque da venda fechada', { contas: v1?.contasLancadas, estoque: v1?.estoqueLancado });
  const crs = await db.contaReceber.findMany({ where: { origemTipo: 'VENDA', origemId: venda.id, situacao: { not: 'CANCELADO' } } });
  verifica(crs.length === 1 && crs[0].situacao === 'RECEBIDO', 'PIX entrou no banco (conta a receber já recebida)', crs.map((c) => c.situacao));
  const corr = (p.correcoes as any[]).find((c) => c.chave === `venda-final-sem-lancamento:venda:${venda.id}`);
  verifica(!!corr && /lancei|baixei/.test(corr.mensagem), 'correção registrada no histórico do robô', corr?.mensagem);
  verifica(p.naoLidas >= 1, 'correção aparece como "nova" (notificação)', p.naoLidas);
  const cont = await adm.get('/robo-saude/contagem');
  verifica(cont.naoLidas >= 1, 'contagem do sino traz as novas correções', cont);
  await adm.post('/robo-saude/marcar-lidas');
  verifica((await adm.get('/robo-saude/contagem')).naoLidas === 0, 'marcar como lidas zera o "novo"');

  secao('Histórico do estoque fora do saldo: realinha sem mudar a quantidade');
  const saldo = await db.estoqueSaldo.findFirst({ where: { produtoId: prod.id } });
  await db.estoqueSaldo.update({ where: { id: saldo!.id }, data: { saldo: saldo!.saldo + 5 } });
  p = await adm.post('/robo-saude/rodar');
  const ult = await db.movimentoEstoque.findFirst({ where: { produtoId: prod.id, depositoId: saldo!.depositoId }, orderBy: { id: 'desc' } });
  const s2 = await db.estoqueSaldo.findUnique({ where: { id: saldo!.id } });
  verifica(ult && Math.abs(ult.saldoPosterior - s2!.saldo) < 0.0001 && s2!.saldo === saldo!.saldo + 5, 'último movimento = saldo (quantidade mantida)', { mov: ult?.saldoPosterior, saldo: s2?.saldo });

  secao('Saldo do banco ≠ lançamentos: sugestão com botão "Usar os lançamentos"');
  const conta = await db.contaFinanceira.findFirst({ where: { ativo: true }, orderBy: { id: 'asc' } });
  await db.contaFinanceira.update({ where: { id: conta!.id }, data: { saldoAtual: conta!.saldoAtual + 123.45 } });
  p = await adm.post('/robo-saude/rodar');
  const sug = (p.abertas as any[]).find((a) => a.chave === `saldo-conta-divergente:conta-financeira:${conta!.id}`);
  verifica(sug && sug.tipo === 'SUGESTAO' && sug.acoes.some((a: any) => a.codigo === 'recalcular'), 'sugestão aberta com o botão', sug);
  const c2 = await db.contaFinanceira.findUnique({ where: { id: conta!.id } });
  verifica(Math.abs(c2!.saldoAtual - (conta!.saldoAtual + 123.45)) < 0.01, 'robô NÃO mexe no saldo sozinho (dinheiro: decide quem confere o extrato)');
  if (sug) {
    await adm.post(`/robo-saude/avisos/${sug.id}/executar`, { acao: 'inventada' }, 422);
    const r = await adm.post(`/robo-saude/avisos/${sug.id}/executar`, { acao: 'recalcular' });
    verifica(/recalculado/.test(r.texto), 'um clique recalcula', r.texto);
    const c3 = await db.contaFinanceira.findUnique({ where: { id: conta!.id } });
    verifica(Math.abs(c3!.saldoAtual - conta!.saldoAtual) < 0.01, 'saldo voltou a bater com os lançamentos', { antes: conta!.saldoAtual, depois: c3!.saldoAtual });
    await adm.post(`/robo-saude/avisos/${sug.id}/executar`, { acao: 'recalcular' }, 409);
  }

  secao('Venda do mês sem vendedor: "Atribuir a quem lançou" com um clique (e Resolver tudo)');
  const v2 = await V.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 100 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: pix.id }] }, 201);
  await db.venda.update({ where: { id: v2.id }, data: { vendedorId: null } });
  p = await adm.post('/robo-saude/rodar');
  const sv = (p.abertas as any[]).find((a) => a.chave === `venda-sem-vendedor-mes:venda:${v2.id}`);
  const atribuir = sv?.acoes?.find((a: any) => a.codigo === 'atribuir');
  verifica(atribuir && atribuir.lote, 'sugere atribuir ao vendedor que lançou (entra no "Resolver tudo")', sv);
  verifica(p.sugestoesEmLote >= 1, 'painel conta as sugestões em lote', p.sugestoesEmLote);
  const rt = await adm.post('/robo-saude/resolver-tudo');
  verifica(rt.resolvidas >= 1, '"Resolver tudo" resolveu', rt);
  const v2b = await db.venda.findUnique({ where: { id: v2.id } });
  verifica(v2b?.vendedorId === vend.id, 'venda voltou para o vendedor', v2b?.vendedorId);

  secao('Ignorar: não volta a incomodar; problema resolvido na tela some sozinho');
  const v3 = await V.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 100 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: pix.id }] }, 201);
  const v4 = await V.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 100 }], parcelas: [{ dataVencimento: hoje(), valor: 100, formaPagamentoId: pix.id }] }, 201);
  await db.venda.updateMany({ where: { id: { in: [v3.id, v4.id] } }, data: { vendedorId: null } });
  p = await adm.post('/robo-saude/rodar');
  const s3 = (p.abertas as any[]).find((a) => a.chave === `venda-sem-vendedor-mes:venda:${v3.id}`);
  const s4 = (p.abertas as any[]).find((a) => a.chave === `venda-sem-vendedor-mes:venda:${v4.id}`);
  verifica(s3 && s4, 'duas sugestões abertas');
  if (s3) await adm.post(`/robo-saude/avisos/${s3.id}/ignorar`);
  await db.venda.update({ where: { id: v4.id }, data: { vendedorId: vend.id } }); // alguém resolveu direto na venda
  p = await adm.post('/robo-saude/rodar');
  verifica(!(p.abertas as any[]).some((a) => a.chave === `venda-sem-vendedor-mes:venda:${v3.id}`), 'ignorada não volta');
  const fechadaSozinha = await db.roboSaudeAviso.findUnique({ where: { id: s4!.id } });
  verifica(fechadaSozinha?.status === 'RESOLVIDA', 'resolvida fora do robô some da lista', fechadaSozinha?.status);
  await db.venda.update({ where: { id: v3.id }, data: { vendedorId: vend.id } }); // deixa o banco limpo para a integridade

  secao('Desligar e religar');
  await adm.put('/robo-saude/config', { autoCorrigir: false });
  verifica((await adm.get('/robo-saude')).config.autoCorrigir === false, 'auto-correção desligada');
  await adm.put('/robo-saude/config', { lixo: 1 }, [400, 422]);
  await adm.put('/robo-saude/config', { autoCorrigir: true, ligado: true });
  p = await adm.post('/robo-saude/rodar');
  verifica(typeof p.estado?.saudePct === 'number' && p.estado.saudePct >= 0 && p.estado.saudePct <= 100, `% de saúde calculada (${p.estado?.saudePct}%)`);

  const dash = await adm.get('/dashboard/geral');
  verifica(Array.isArray(dash.alertas), 'dashboard continua respondendo com os alertas do robô');

  await db.$disconnect();
  encerrar('Robô da Saúde');
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
