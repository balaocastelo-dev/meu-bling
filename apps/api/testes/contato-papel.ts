/**
 * Um CPF = um contato. Cliente pode ser usado como fornecedor (e o inverso) e vira AMBOS.
 * A lista de Cadastros (?tipo=) continua separada: tipo=FORNECEDOR não traz quem é só CLIENTE.
 *   npx tsx testes/contato-papel.ts http://127.0.0.1:3333
 */
import { papelComercial } from '../src/modules/comum/papel-contato.js';
import { cpfTeste, encerrar, entrar, hoje, secao, SUF, verifica } from './lib.js';

const doc = (n: number) => cpfTeste(String((Number(SUF) + n) % 1_000_000).padStart(6, '0'));
const ids = (r: any) => (Array.isArray(r) ? r : r?.data ?? []) as { id: number; tipo: string; nome: string }[];
const tem = (r: any, id: number) => ids(r).some((c) => c.id === id);

async function main() {
  secao('Helper de papel');
  verifica(papelComercial('CLIENTE', 'FORNECEDOR') === 'AMBOS', 'cliente usado como fornecedor vira AMBOS');
  verifica(papelComercial('FORNECEDOR', 'CLIENTE') === 'AMBOS', 'fornecedor usado como cliente vira AMBOS');
  verifica(papelComercial('CLIENTE', 'CLIENTE') === 'CLIENTE', 'quem já é cliente não muda');
  verifica(papelComercial('FORNECEDOR', 'FORNECEDOR') === 'FORNECEDOR', 'quem já é fornecedor não muda');
  verifica(papelComercial('AMBOS', 'CLIENTE') === 'AMBOS' && papelComercial('AMBOS', 'FORNECEDOR') === 'AMBOS', 'AMBOS permanece AMBOS');

  const adm = await entrar('admin@balao.info', 'admin123');
  const cpfCli = doc(11);
  const cpfForn = doc(22);
  const cpfOs = doc(33);
  const cpfPagar = doc(44);
  const cpfReceber = doc(55);
  const cpfInativo = doc(66);

  secao('POST com documento repetido responde 409 DOCUMENTO_DUPLICADO e contatoId');
  const cli = await adm.post('/contatos', { nome: `Cliente Papel ${SUF}`, tipo: 'CLIENTE', tipoPessoa: 'F', documento: cpfCli, celular: '19911110001' }, 201);
  const dup = await adm.req('POST', '/contatos', { nome: `Outro Papel ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfCli }, 409);
  verifica(dup.code === 'DOCUMENTO_DUPLICADO', 'código DOCUMENTO_DUPLICADO', dup.code);
  verifica(dup.detalhes?.contatoId === cli.id, 'detalhes.contatoId aponta o cadastro existente', dup.detalhes);
  verifica(dup.detalhes?.nome === cli.nome && dup.detalhes?.tipo === 'CLIENTE' && dup.detalhes?.ativo === true, 'detalhes traz nome, tipo e ativo', dup.detalhes);
  const listaDoc = await adm.get(`/contatos?pesquisa=${cpfCli}&limite=15`);
  const comEsteCpf = (listaDoc.data ?? []).filter((c: { documento?: string }) => c.documento === cpfCli);
  verifica(comEsteCpf.length === 1 && comEsteCpf[0].id === cli.id, 'não criou um segundo contato com o mesmo CPF', comEsteCpf.map((c: { id: number }) => c.id));

  const semDocA = await adm.post('/contatos', { nome: `Sem doc A ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F' }, 201);
  const semDocB = await adm.post('/contatos', { nome: `Sem doc B ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F' }, 201);
  verifica(semDocA.id !== semDocB.id && !semDocA.documento && !semDocB.documento, 'contato sem documento continua permitido');

  secao('PUT também bloqueia documento de outro contato, sem fundir');
  const outro = await adm.post('/contatos', { nome: `Fornecedor solto ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F' }, 201);
  const putDup = await adm.req('PUT', `/contatos/${outro.id}`, { documento: cpfCli }, 409);
  verifica(putDup.code === 'DOCUMENTO_DUPLICADO' && putDup.detalhes?.contatoId === cli.id, 'PUT com CPF já usado → 409 com o outro id', putDup);
  const outroDepois = await adm.get(`/contatos/${outro.id}`);
  verifica(!outroDepois.documento, 'o PUT não gravou o documento repetido', outroDepois.documento);

  secao('Contato inativo com o mesmo documento continua 409 e informa ativo=false');
  const inativo = await adm.post('/contatos', { nome: `Inativo Papel ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfInativo }, 201);
  await adm.put(`/contatos/${inativo.id}`, { ativo: false });
  const dupInativo = await adm.req('POST', '/contatos', { nome: `Novo em cima do inativo ${SUF}`, tipo: 'CLIENTE', tipoPessoa: 'F', documento: cpfInativo }, 409);
  verifica(dupInativo.code === 'DOCUMENTO_DUPLICADO' && dupInativo.detalhes?.contatoId === inativo.id && dupInativo.detalhes?.ativo === false, '409 do inativo traz contatoId e ativo false', dupInativo.detalhes);

  secao('GET ?tipo=FORNECEDOR continua excluindo quem é só CLIENTE');
  const forn = await adm.post('/contatos', { nome: `Fornecedor Papel ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfForn }, 201);
  const ambos = await adm.post('/contatos', { nome: `Ambos Papel ${SUF}`, tipo: 'AMBOS', tipoPessoa: 'F' }, 201);
  const transp = await adm.post('/contatos', { nome: `Transp Papel ${SUF}`, tipo: 'TRANSPORTADORA', tipoPessoa: 'J' }, 201);
  const soForn = await adm.get(`/contatos?tipo=FORNECEDOR&pesquisa=${encodeURIComponent(`Papel ${SUF}`)}&limite=50`);
  verifica(!tem(soForn, cli.id), 'tipo=FORNECEDOR não lista CLIENTE');
  verifica(tem(soForn, forn.id) && tem(soForn, ambos.id), 'tipo=FORNECEDOR lista FORNECEDOR e AMBOS');
  verifica(!tem(soForn, transp.id), 'tipo=FORNECEDOR não lista transportadora');
  const soCli = await adm.get(`/contatos?tipo=CLIENTE&pesquisa=${encodeURIComponent(`Papel ${SUF}`)}&limite=50`);
  verifica(tem(soCli, cli.id) && tem(soCli, ambos.id) && !tem(soCli, forn.id), 'tipo=CLIENTE lista cliente e AMBOS, não o fornecedor puro');
  const comercial = await adm.get(`/contatos?comercial=true&pesquisa=${encodeURIComponent(`Papel ${SUF}`)}&ativo=true&limite=50`);
  verifica(tem(comercial, cli.id) && tem(comercial, forn.id) && tem(comercial, ambos.id) && !tem(comercial, transp.id), 'comercial=true traz cliente, fornecedor e AMBOS, sem transportadora');
  const soTransp = await adm.get(`/contatos?tipo=TRANSPORTADORA&pesquisa=${encodeURIComponent(`Transp Papel ${SUF}`)}&limite=15`);
  verifica(tem(soTransp, transp.id) && !tem(soTransp, cli.id), 'busca de transportadora não mudou');

  secao('Salvar compra com um CLIENTE promove para AMBOS');
  const compra = await adm.post('/compras', { fornecedorId: cli.id, data: hoje(), itens: [{ descricao: `Item papel ${SUF}`, quantidade: 1, valorUnitario: 10 }] }, 201);
  verifica(compra.fornecedorId === cli.id, 'a compra aceita o id do cliente', compra.fornecedorId);
  const cliDepois = await adm.get(`/contatos/${cli.id}`);
  verifica(cliDepois.tipo === 'AMBOS', 'o cliente passou a AMBOS', cliDepois.tipo);
  const deNovo = await adm.get(`/contatos?tipo=FORNECEDOR&pesquisa=${encodeURIComponent(cli.nome)}&limite=15`);
  verifica(tem(deNovo, cli.id), 'depois da promoção, tipo=FORNECEDOR passa a listar o contato');

  secao('Compra não converte transportadora');
  await adm.post('/compras', { fornecedorId: transp.id, data: hoje(), itens: [{ descricao: `Frete papel ${SUF}`, quantidade: 1, valorUnitario: 5 }] }, 201);
  const transpDepois = await adm.get(`/contatos/${transp.id}`);
  verifica(transpDepois.tipo === 'TRANSPORTADORA', 'transportadora continua transportadora', transpDepois.tipo);

  secao('Venda, OS e contas promovem o papel que faltava');
  await adm.post('/vendas', { contatoId: forn.id, data: hoje(), itens: [{ descricao: `Venda papel ${SUF}`, quantidade: 1, valorUnitario: 20 }] }, 201);
  const fornDepois = await adm.get(`/contatos/${forn.id}`);
  verifica(fornDepois.tipo === 'AMBOS', 'venda com fornecedor promove para AMBOS', fornDepois.tipo);

  const fornOs = await adm.post('/contatos', { nome: `Fornecedor OS ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfOs }, 201);
  await adm.post('/ordens-servico', { contatoId: fornOs.id, dataEntrada: hoje(), equipamento: 'Notebook', defeitoRelatado: 'Teste', itens: [] }, 201);
  verifica((await adm.get(`/contatos/${fornOs.id}`)).tipo === 'AMBOS', 'OS com fornecedor promove para AMBOS');

  const cliPagar = await adm.post('/contatos', { nome: `Cliente pagar ${SUF}`, tipo: 'CLIENTE', tipoPessoa: 'F', documento: cpfPagar }, 201);
  await adm.post('/contas-pagar', { descricao: `Pagar papel ${SUF}`, vencimento: hoje(), valor: 15, contatoId: cliPagar.id }, 201);
  verifica((await adm.get(`/contatos/${cliPagar.id}`)).tipo === 'AMBOS', 'conta a pagar com cliente promove para AMBOS');

  const fornReceber = await adm.post('/contatos', { nome: `Fornecedor receber ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'F', documento: cpfReceber }, 201);
  await adm.post('/contas-receber', { descricao: `Receber papel ${SUF}`, vencimento: hoje(), valor: 15, contatoId: fornReceber.id }, 201);
  verifica((await adm.get(`/contatos/${fornReceber.id}`)).tipo === 'AMBOS', 'conta a receber com fornecedor promove para AMBOS');

  const jaAmbos = await adm.post('/compras', { fornecedorId: forn.id, data: hoje(), itens: [{ descricao: `Item ja ambos ${SUF}`, quantidade: 1, valorUnitario: 1 }] }, 201);
  verifica(jaAmbos.fornecedorId === forn.id && (await adm.get(`/contatos/${forn.id}`)).tipo === 'AMBOS', 'quem já é AMBOS permanece AMBOS ao salvar outra compra');

  encerrar('Contato com dois papéis');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
