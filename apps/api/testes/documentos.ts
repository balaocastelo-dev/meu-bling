/**
 * DOCUMENTOS DA VENDA (28/10/2026)
 * - Recibo 80mm, recibo A4 + kit, só kit; versículo com citação em cada folha.
 * - Certificado para PC, PC Gamer, Notebook, iPhone e Games; acessório não ganha certificado.
 * - Garantia: 12 meses novo, 3 meses seminovo; folha de licenças só com PC/Notebook.
 *   npx tsx testes/documentos.ts http://localhost:3333
 */
import { ehSeminovo, garantiaDoItem, tipoCertificado } from '../src/modules/documentos/classificar.js';
import { BASE, clienteCompleto, encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

async function html(token: string, rota: string) {
  const r = await fetch(BASE + rota, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, tipo: r.headers.get('content-type') || '', texto: await r.text() };
}

async function main() {
  secao('Classificação dos aparelhos');
  const casos: [string, string | null][] = [
    ['PC Gamer Ryzen 5 / RTX 4060 / 16GB', 'PC_GAMER'],
    ['Computador Intel i5 16GB SSD 480GB', 'PC'],
    ['Notebook Lenovo IdeaPad 3', 'NOTEBOOK'],
    ['Apple iPhone 13 128GB Seminovo', 'IPHONE'],
    ['Console PlayStation 5 Slim', 'GAMES'],
    ['Capinha iPhone 15', null],
    ['Fonte para notebook Dell', null],
    ['Gabinete Gamer RGB', null],
    ['Controle PS5 DualSense', null],
  ];
  for (const [n, t] of casos) verifica(tipoCertificado(n) === t, `"${n}" → ${t ?? 'sem certificado'}`, tipoCertificado(n));
  verifica(ehSeminovo('iPhone 12 seminovo') && !ehSeminovo('iPhone 15 novo'), 'seminovo reconhecido pelo nome');
  const d = new Date('2026-10-28T12:00:00-03:00');
  verifica(garantiaDoItem(d, 'NOTEBOOK', false, 90).meses === 12, 'notebook novo: 12 meses');
  verifica(garantiaDoItem(d, 'IPHONE', true, 90).meses === 3, 'iPhone seminovo: 3 meses');
  verifica(garantiaDoItem(d, null, false, 90).texto === '3 meses', 'acessório: prazo do cadastro (90 dias = 3 meses)');

  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const formas: any[] = await adm.get('/formas-pagamento');
  const cli = await adm.post('/contatos', clienteCompleto(`Cliente Docs ${SUF}`, String((Number(SUF) + 7) % 1000000).padStart(6, '0')), 201);
  const nb = await adm.post('/produtos', { nome: `Notebook Docs Teste ${SUF}`, codigo: `DOC-NB-${SUF}`, preco: 4000, controlaEstoque: false }, 201);
  const cabo = await adm.post('/produtos', { nome: `Cabo HDMI Docs ${SUF}`, codigo: `DOC-CB-${SUF}`, preco: 50, controlaEstoque: false }, 201);
  const venda = await adm.post('/vendas', {
    contatoId: cli.id, data: hoje(),
    itens: [{ produtoId: nb.id, descricao: nb.nome, quantidade: 1, valorUnitario: 4000, numeroSerie: `SN-${SUF}` }, { produtoId: cabo.id, descricao: cabo.nome, quantidade: 1, valorUnitario: 50 }],
    parcelas: [{ dataVencimento: hoje(), valor: 4050, formaPagamentoId: formas[0].id }],
  }, 201);
  const soCabo = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: cabo.id, descricao: cabo.nome, quantidade: 1, valorUnitario: 50 }], parcelas: [{ dataVencimento: hoje(), valor: 50, formaPagamentoId: formas[0].id }] }, 201);

  secao('Resumo e documentos');
  const r = await adm.get(`/vendas/${venda.id}/documentos/resumo`);
  verifica(r.temKit && r.temLicenca && r.certificados.length === 1 && r.certificados[0].tipo === 'NOTEBOOK', 'resumo: 1 certificado de notebook + licenças', r);
  const a4 = await html(adm.token, `/vendas/${venda.id}/documentos?formato=a4`);
  verifica(a4.status === 200 && a4.tipo.includes('text/html'), 'recibo A4 em HTML');
  verifica(a4.texto.includes('Certificado de Garantia') && a4.texto.includes(`SN-${SUF}`) && a4.texto.includes('12 meses'), 'A4 traz certificado com nº de série e 12 meses');
  verifica(a4.texto.includes('R$ 999,00') && a4.texto.includes('Windows 11 Pro'), 'A4 traz a folha de licenças por R$ 999');
  verifica(a4.texto.includes('O que a garantia não cobre'), 'A4 traz o termo de garantia');
  const versos = a4.texto.match(/class="versiculo"/g)?.length || 0;
  verifica(versos >= 4, `um versículo em cada folha (${versos})`);
  const cupom = await html(adm.token, `/vendas/${venda.id}/documentos?formato=cupom`);
  verifica(cupom.texto.includes('size: 80mm') && cupom.texto.includes('RECIBO DE VENDA') && cupom.texto.includes('class="versiculo"'), 'recibo 80mm com versículo');
  const kit = await html(adm.token, `/vendas/${venda.id}/documentos?formato=garantia`);
  verifica(kit.texto.includes('Certificado de Garantia') && !kit.texto.includes('Itens da compra'), 'só garantia: kit sem o recibo');
  const rc = await adm.get(`/vendas/${soCabo.id}/documentos/resumo`);
  verifica(!rc.temKit && !rc.temLicenca, 'venda só de acessório: sem certificado nem licenças', rc);
  await adm.get(`/vendas/${venda.id}/documentos?formato=xyz`, 400);

  secao('Nº de série gravado no item');
  const v = await adm.get(`/vendas/${venda.id}`);
  verifica(v.itens?.[0]?.numeroSerie === `SN-${SUF}`, 'numeroSerie salvo na venda', v.itens?.[0]);

  encerrar('Documentos da venda');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
