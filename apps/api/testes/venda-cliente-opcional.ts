/**
 * Fechar a venda não exige CPF, telefone, e-mail nem endereço.
 *   - cliente só com o nome fecha e gera estoque e contas;
 *   - venda sem cliente usa "Consumidor final" e também fecha;
 *   - emitir NF-e de cliente incompleto devolve o que falta, com atalho para o cadastro.
 *   npx tsx testes/venda-cliente-opcional.ts http://127.0.0.1:PORTA
 */
import { BASE, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const CHAVE = process.env.SITE_CHAVE_INTEGRACAO || 'chave-de-teste-do-pdv-do-site-1234567890';

async function site(metodo: string, rota: string, corpo?: unknown) {
  const r = await fetch(`${BASE}/integracoes/site${rota}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${CHAVE}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* sem JSON */
  }
  return { status: r.status, json };
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const fechada = sitV.find((s) => s.nome === 'Fechada')?.id;
  const formas: any[] = await adm.get('/formas-pagamento');
  const depositos: any[] = await adm.get('/depositos');
  const dep = depositos.find((d) => d.padrao)?.id ?? depositos[0].id;
  const vend = await adm.post('/vendedores', { nome: `Vendedor Cadastro ${SUF}`, comissaoPadraoPct: 2, ativo: true }, [200, 201]);
  const prod = await adm.post('/produtos', { nome: `MOUSE CADASTRO ${SUF}`, codigo: `CAD-${SUF}`, preco: 80, precoCusto: 40 }, 201);
  await adm.post('/estoque/ajuste', { produtoId: prod.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 10, custoUnitario: 40 }, [200, 201]);
  const saldo = async () => (await adm.get(`/produtos/${prod.id}`)).estoqueTotal;

  const venda = (extra: Record<string, unknown>) => ({
    vendedorId: vend.id,
    data: hoje(),
    depositoId: dep,
    itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 80 }],
    parcelas: [{ dataVencimento: hoje(), valor: 80, formaPagamentoId: formas[0].id }],
    ...extra,
  });

  secao('Fechar venda de cliente só com o nome (estoque e contas saem)');
  const cli = await adm.post('/contatos', { nome: `Só Nome ${SUF}`, tipoPessoa: 'F' }, 201);
  verifica(!cli.documento && !cli.email && !cli.celular && !cli.cep, 'o cadastro aceita só o nome', cli);
  const ficha = await adm.get(`/contatos/${cli.id}`);
  verifica(ficha.cadastroIncompleto === true && (ficha.faltasCadastro as string[]).includes('CPF/CNPJ'), 'a ficha do cliente avisa cadastro incompleto', ficha.faltasCadastro);
  const s0 = await saldo();
  const v1 = await adm.post('/vendas', venda({ contatoId: cli.id }), 201);
  const chk = await adm.get(`/vendas/${v1.id}/finalizacao`);
  const campos = (chk.pendencias as any[]).map((p) => p.campo);
  verifica(chk.podeFinalizar === true && !campos.some((c: string) => c.startsWith('cliente')), 'pode finalizar sem CPF, telefone, e-mail e endereço', chk.pendencias);
  verifica(v1.cadastroIncompleto === true, 'a venda mostra cadastro incompleto', v1.faltasCadastro);
  const fin = await adm.post(`/vendas/${v1.id}/situacao`, { situacaoId: fechada });
  verifica(fin.situacao?.nome === 'Fechada', 'situação foi para Fechada', fin);
  verifica((await saldo()) === s0 - 1, 'fechar baixou o estoque', { antes: s0, agora: await saldo() });
  const contas = ((await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${v1.id}`)).data ?? []) as any[];
  verifica(contas.length >= 1 && igual(contas.reduce((s, c) => s + c.valor, 0), 80), 'gerou contas a receber do total', contas.map((c) => c.valor));

  secao('Emitir NF-e de cliente incompleto explica o que falta e aponta o cadastro');
  const nf = await adm.post(`/vendas/${v1.id}/gerar-nfe`, { modelo: 55 }, 422);
  verifica(nf.code === 'NFE_PENDENCIAS', 'a nota volta 422 de validação fiscal', nf);
  verifica(/CPF|CNPJ|endereço|CEP/i.test(String(nf.erro)), 'a mensagem diz o que falta no cliente', nf.erro);
  const doCliente = ((nf.detalhes?.pendencias ?? []) as any[]).filter((p) => p.grupo === 'CLIENTE' && p.nivel === 'erro');
  verifica(doCliente.length > 0, 'as pendências fiscais do cliente vêm na resposta', doCliente);
  verifica(
    doCliente.some((p) => (p.acoes ?? []).some((a: any) => String(a.rota).includes(`/contatos/${cli.id}/editar`))),
    'cada pendência do cliente tem atalho para completar o cadastro',
    doCliente,
  );
  verifica((await adm.get(`/vendas/${v1.id}`)).situacao.nome === 'Fechada', 'a nota recusada não desfaz o fechamento');

  secao('Fechar venda sem cliente (vira Consumidor final)');
  const s1 = await saldo();
  const v2 = await adm.post('/vendas', venda({ contatoId: null }), 201);
  verifica(/consumidor final/i.test(v2.contato?.nome || ''), 'sem cliente, grava Consumidor final', v2.contato);
  const fin2 = await adm.post(`/vendas/${v2.id}/finalizar`, {});
  verifica(fin2.situacao?.nome === 'Fechada' && fin2.alterado !== false, 'finaliza sem cliente', fin2.situacao);
  verifica((await saldo()) === s1 - 1, 'sem cliente também baixa o estoque', { antes: s1, agora: await saldo() });
  const contas2 = ((await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${v2.id}`)).data ?? []) as any[];
  verifica(contas2.length >= 1 && igual(contas2.reduce((s, c) => s + c.valor, 0), 80), 'sem cliente também gera contas a receber', contas2.map((c) => c.valor));

  secao('PDV: venda só com o nome fica nesse cliente e entra fechada');
  const nomePdv = `Balcão Só Nome ${SUF}`;
  const pdv = await site('POST', '/vendas', {
    pdvId: `PDV-N${SUF}`,
    data: hoje(),
    vendedorId: vend.id,
    cliente: { nome: nomePdv },
    itens: [{ nome: `Item balcão ${SUF}`, quantidade: 1, valor: 30 }],
    pagamentos: [{ forma: 'dinheiro', valor: 30 }],
  });
  verifica(pdv.status === 201 && pdv.json?.venda?.cliente?.nome === nomePdv, 'o PDV guarda o cliente só com o nome', pdv.json?.venda?.cliente);
  verifica(pdv.json?.venda?.situacao?.final === true && !pdv.json?.venda?.situacao?.cancelamento, 'o PDV fecha a venda sem CPF nem endereço', pdv.json?.venda?.situacao);
  const semNome = await site('POST', '/vendas', {
    pdvId: `PDV-V${SUF}`,
    data: hoje(),
    vendedorId: vend.id,
    cliente: {},
    itens: [{ nome: `Item sem cliente ${SUF}`, quantidade: 1, valor: 15 }],
    pagamentos: [{ forma: 'pix', valor: 15 }],
  });
  verifica(semNome.status === 201 && /consumidor final/i.test(semNome.json?.venda?.cliente?.nome || ''), 'PDV sem cliente usa Consumidor final', semNome.json?.venda?.cliente);
  verifica(semNome.json?.venda?.situacao?.final === true, 'e essa venda também entra fechada', semNome.json?.venda?.situacao);

  encerrar('Venda com cadastro opcional');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
