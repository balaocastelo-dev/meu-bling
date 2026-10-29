/**
 * ROBÔ DE NF (28/10/2026)
 * - O robô confere a venda, preenche sozinho o NCM do produto (pelo tipo → "sugerido") e o cadastro do cliente.
 * - NCM sugerido trava a NF até alguém da gestão confirmar (um clique); vendedor não confirma.
 * - Tudo certo → status PRONTA (selo "Pronto pra NF" na lista) → botão Emitir gera a NF-e 55 e transmite.
 * - Produto sem NCM que o robô não sabe classificar → pendência com o link do produto.
 * - Cliente de outro estado (pessoa física) → CFOP 6108; dentro de SP → 5102.
 * - Regras de NCM e de CFOP (funções puras).
 *   npx tsx testes/robo-nf.ts http://localhost:3333
 */
import { cfopDoItem } from '../src/modules/comum/nfe.js';
import { ncmPorRegra } from '../src/modules/robo-nf/ncm.js';
import { clienteCompleto, cpfTeste, encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

async function main() {
  secao('Regras puras: NCM pelo nome e CFOP');
  const casos: [string, string | null][] = [
    ['Notebook Dell Inspiron 15 i5 8GB SSD 256GB', '84713012'],
    ['SSD Kingston 480GB para notebook', '84717040'],
    ['Notebook Lenovo IdeaPad 15,6 pol i5', '84713019'],
    ['Monitor LG 24 polegadas', '85285200'],
    ['Capinha iPhone 13 transparente', '39269090'],
    ['Cabo carregador USB-C 1m', '85444200'],
    ['Apple iPhone 15 128GB', '85171300'],
    ['Tela Frontal iPhone 11', '85249100'],
    ['Suporte para notebook', null],
    ['Produto misterioso xyz', null],
  ];
  for (const [nome, esperado] of casos) verifica((ncmPorRegra(nome)?.ncm ?? null) === esperado, `NCM de "${nome}" = ${esperado ?? 'sem regra'}`, ncmPorRegra(nome));
  verifica(cfopDoItem(null, true, true, '5102', '6102') === '5102', 'CFOP dentro de SP: 5102');
  verifica(cfopDoItem(null, false, true, '5102', '6102') === '6108', 'CFOP fora de SP, não contribuinte: 6108');
  verifica(cfopDoItem(null, false, false, '5102', '6102') === '6102', 'CFOP fora de SP, contribuinte: 6102');
  verifica(cfopDoItem('5102', false, false, '5102', '6102') === '6102', 'CFOP do produto 5102 vira 6102 fora do estado');
  verifica(cfopDoItem('5405', false, false, '5102', '6102') === '6404', 'CFOP 5405 (ST) vira 6404 fora do estado');
  verifica(cfopDoItem('6102', true, true, '5102', '6102') === '5102', 'CFOP 6xxx do produto vira 5xxx dentro do estado');

  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const vend = (await adm.get('/vendedores')) as any[];
  const senha = 'senha-robo-123';
  const vendRobo = await adm.post('/vendedores', { nome: `Vend Robo ${SUF}` }, 201);
  await adm.post('/usuarios', { nome: `Vendedor Robo ${SUF}`, email: `robo${SUF}@teste.com`, senha, perfil: 'VENDEDOR', vendedorId: vendRobo.id }, 201);
  const V = await entrar(`robo${SUF}@teste.com`, senha);
  V.nome = 'VENDEDOR';
  void vend;

  // a NF exige a IE da empresa (os dados de exemplo podem vir sem)
  const emp = await adm.get('/empresa');
  if (!emp.ie) await adm.put('/empresa', { ie: '244123456119' }, 200);
  const formas: any[] = await adm.get('/formas-pagamento');
  const pix = formas.find((f) => f.tipo === 'PIX') ?? formas[0];

  secao('Venda com produto sem NCM: o robô sugere e trava até confirmar');
  const prod = await adm.post('/produtos', { nome: `Notebook Robo Teste ${SUF}`, codigo: `ROBO-${SUF}`, preco: 3000, precoCusto: 2000, controlaEstoque: false }, 201);
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Robo ${SUF}`), 201);
  // venda no nome do vendedor: ele só emite NF das próprias vendas (29/10/2026)
  const venda = await adm.post('/vendas', { contatoId: cli.id, vendedorId: vendRobo.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 3000 }], parcelas: [{ dataVencimento: hoje(), valor: 3000, formaPagamentoId: pix.id }] }, 201);
  let e = await adm.post(`/vendas/${venda.id}/robo-nf/conferir`);
  const p1 = await adm.get(`/produtos/${prod.id}`);
  verifica(p1.ncm === '84713012' && p1.ncmOrigem === 'SUGERIDO', 'robô preencheu o NCM 8471.30.12 como SUGERIDO', { ncm: p1.ncm, origem: p1.ncmOrigem });
  verifica(e.status === 'PENDENTE', 'venda fica PENDENTE (falta confirmar o NCM)', e);
  const pend = (e.pendencias as any[]).find((x) => x.codigo === 'PRODUTO_NCM_SUGERIDO');
  verifica(pend?.confirmarNcm?.produtoId === prod.id, 'pendência traz o botão "Confirmar NCM" do produto', e.pendencias);
  verifica((e.preenchido as string[]).some((t) => t.includes('8471.30.12')), 'lista "o robô preencheu sozinho" mostra o NCM', e.preenchido);
  await adm.post(`/vendas/${venda.id}/emitir-nf`, {}, 422);

  secao('Vendedor não confirma NCM; a gestão confirma e a venda fica PRONTA');
  await V.post(`/produtos/${prod.id}/confirmar-ncm`, {}, 403);
  const conf = await adm.post(`/produtos/${prod.id}/confirmar-ncm`, {}, 200);
  verifica(conf.ncm === '84713012', 'NCM confirmado', conf);
  e = await adm.post(`/vendas/${venda.id}/robo-nf/conferir`);
  verifica(e.status === 'PRONTA' && e.erros === 0, 'venda PRONTA pra NF (botão verde)', e);
  const lista = await adm.get(`/vendas?pesquisa=${venda.numero}`);
  const naLista = (lista.data as any[]).find((v) => v.id === venda.id);
  verifica(naLista?.roboNf?.status === 'PRONTA', 'lista de vendas traz o selo do robô (PRONTA)', naLista?.roboNf);
  const painel = await adm.get('/robo-nf/painel');
  verifica(painel.prontas >= 1, 'painel do robô conta as vendas prontas', painel);

  secao('Botão Emitir: gera a NF-e 55 e transmite');
  const r = await V.post(`/vendas/${venda.id}/emitir-nf`, { informacoesComplementares: 'Garantia 12 meses' }, 200);
  verifica(r.situacao === 'AUTORIZADA' && r.numero > 0, 'NF-e autorizada (provedor simulado)', r);
  const nota = await adm.get(`/notas-fiscais/${r.notaId}`);
  verifica(nota.modelo === 55 && nota.itens?.[0]?.cfop === '5102' && nota.itens?.[0]?.ncm === '84713012', 'NF-e modelo 55, CFOP 5102 e NCM certo', { modelo: nota.modelo, item: nota.itens?.[0] });
  e = await adm.get(`/vendas/${venda.id}/robo-nf`);
  verifica(e.status === 'EMITIDA', 'robô marca a venda como EMITIDA', e);
  await adm.post(`/vendas/${venda.id}/emitir-nf`, {}, 422);

  secao('Produto que o robô não sabe classificar: pendência com o link do produto');
  const prod2 = await adm.post('/produtos', { nome: `Item misterioso robo ${SUF}`, codigo: `ROBO2-${SUF}`, preco: 50, controlaEstoque: false }, 201);
  const v2 = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod2.id, descricao: prod2.nome, quantidade: 1, valorUnitario: 50 }], parcelas: [{ dataVencimento: hoje(), valor: 50, formaPagamentoId: pix.id }] }, 201);
  const e2 = await adm.post(`/vendas/${v2.id}/robo-nf/conferir`);
  const semNcm = (e2.pendencias as any[]).find((x) => x.codigo === 'PRODUTO_SEM_NCM');
  verifica(e2.status === 'PENDENTE' && semNcm?.acoes?.[0]?.rota === `/produtos/${prod2.id}/editar`, 'sem NCM: pendência com o link para editar o produto', e2);

  secao('Cliente de outro estado (pessoa física): CFOP 6108');
  const sufRj = String((Number(SUF) + 1) % 1000000).padStart(6, '0');
  const cliRj = await adm.post('/contatos', { ...clienteCompleto(`Cliente RJ Robo ${SUF}`, sufRj), documento: cpfTeste(sufRj), municipio: 'Rio de Janeiro', codigoMunicipio: '3304557', uf: 'RJ', cep: '20040002', logradouro: 'Av. Rio Branco', bairro: 'Centro' }, 201);
  const v3 = await adm.post('/vendas', { contatoId: cliRj.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 3000 }], parcelas: [{ dataVencimento: hoje(), valor: 3000, formaPagamentoId: pix.id }] }, 201);
  const e3 = await adm.post(`/vendas/${v3.id}/robo-nf/conferir`);
  verifica(e3.status === 'PRONTA', 'venda para o RJ pronta', e3);
  const r3 = await adm.post(`/vendas/${v3.id}/emitir-nf`, {}, 200);
  const nota3 = await adm.get(`/notas-fiscais/${r3.notaId}`);
  verifica(nota3.itens?.[0]?.cfop === '6108', 'NF para pessoa física de outro estado sai com CFOP 6108', nota3.itens?.[0]);

  secao('NCM extinto (SH 2022): checklist aponta e o robô sugere o novo');
  const prodX = await adm.post('/produtos', { nome: `Monitor antigo robo ${SUF}`, codigo: `ROBOX-${SUF}`, preco: 700, ncm: '85285220', controlaEstoque: false }, 201);
  const vX = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prodX.id, descricao: prodX.nome, quantidade: 1, valorUnitario: 700 }], parcelas: [{ dataVencimento: hoje(), valor: 700, formaPagamentoId: pix.id }] }, 201);
  const chk = await adm.get(`/vendas/${vX.id}/nfe/verificar`);
  verifica((chk.pendencias as any[]).some((x) => x.codigo === 'PRODUTO_NCM_EXTINTO'), 'checklist da NF aponta NCM 8528.52.20 extinto', chk.pendencias);
  await adm.post(`/vendas/${vX.id}/robo-nf/conferir`);
  const pX = await adm.get(`/produtos/${prodX.id}`);
  verifica(pX.ncm === '85285200' && pX.ncmOrigem === 'SUGERIDO', 'robô sugere 8528.52.00 (falta confirmar)', { ncm: pX.ncm, origem: pX.ncmOrigem });

  secao('Orçamento não entra no robô');
  const orc = await adm.post('/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 3000 }] }, 201);
  const eo = await adm.get(`/vendas/${orc.id}/robo-nf`);
  verifica(eo.status === 'IGNORADA', 'orçamento fica IGNORADA', eo);

  encerrar('Robô de NF');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
