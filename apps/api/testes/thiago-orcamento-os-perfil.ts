/**
 * Pedidos do Thiago: orçamento que muda para "Convertido em venda" cria o pedido de verdade;
 * kanban da OS cria/renomeia/remove coluna e pula etapa; cadastro do cliente aceita CPF/CNPJ
 * com máscara; vendedor troca o próprio perfil para técnico (e o admin também muda pela tela).
 *   npx tsx testes/thiago-orcamento-os-perfil.ts http://127.0.0.1:3333
 */
import { encerrar, entrar, hoje, secao, Sessao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  secao('Orçamento: mudar para "Convertido em venda" cria o pedido');
  const sits: any[] = await adm.get('/situacoes?modulo=ORCAMENTO');
  const convertido = sits.find((s) => s.nome === 'Convertido em venda');
  verifica(!!convertido?.id, 'existe a situação Convertido em venda');
  const cli = await adm.post('/contatos', { nome: `Cliente Orçamento ${SUF}`, tipoPessoa: 'F', celular: '19988880000', email: `orc${SUF}@example.com` }, 201);
  const orc = await adm.post('/vendas', {
    tipo: 'ORCAMENTO',
    contatoId: cli.id,
    itens: [{ descricao: `SSD ${SUF}`, quantidade: 2, valorUnitario: 180, desconto: 10 }],
  }, 201);
  verifica(orc.total === 350 && orc.itens?.length === 1, 'orçamento com total 350 e 1 item', orc.total);
  const mudou = await adm.post(`/vendas/${orc.id}/situacao`, { situacaoId: convertido.id, observacao: 'cliente fechou' }, 200);
  verifica(!!mudou.venda?.id && !!mudou.venda?.numero, 'a situação devolve a venda criada', mudou);
  const venda = await adm.get(`/vendas/${mudou.venda.id}`);
  verifica(venda.tipo === 'PEDIDO' && venda.contatoId === cli.id && venda.total === 350, 'venda tem o cliente e o total do orçamento', { tipo: venda.tipo, contato: venda.contatoId, total: venda.total });
  verifica(venda.itens?.[0]?.descricao === `SSD ${SUF}` && venda.itens[0].quantidade === 2 && venda.itens[0].valorUnitario === 180, 'venda leva os itens', venda.itens?.[0]);
  verifica(venda.orcamento?.id === orc.id, 'venda aponta o orçamento de origem', venda.orcamento);
  const orcDepois = await adm.get(`/vendas/${orc.id}`);
  verifica(orcDepois.situacao?.nome === 'Convertido em venda' && orcDepois.vendaGerada?.id === venda.id, 'orçamento fica convertido e ligado à venda', { sit: orcDepois.situacao?.nome, gerada: orcDepois.vendaGerada });
  const deNovo = await adm.post(`/vendas/${orc.id}/situacao`, { situacaoId: convertido.id }, 200);
  verifica(deNovo.venda?.id === venda.id, 'marcar de novo não cria uma segunda venda', deNovo.venda);

  secao('Kanban: coluna nova, renomear, remover vazia e pular etapa');
  const nome = `Bancada ${SUF}`;
  const col = await adm.post('/ordens-servico/colunas', { nome }, 201);
  verifica(col.nome === nome && col.id, 'cria a etapa com o nome pedido', col.nome);
  const ren = await adm.put(`/ordens-servico/colunas/${col.id}`, { nome: `Bancada pronta ${SUF}` });
  verifica(ren.nome === `Bancada pronta ${SUF}`, 'renomeia a etapa', ren.nome);
  const quadro: any[] = await adm.get('/ordens-servico/kanban');
  verifica(quadro.some((c) => c.situacao?.id === col.id && c.situacao?.nome === ren.nome), 'a coluna nova aparece no kanban');
  await adm.del(`/ordens-servico/colunas/${col.id}`);
  const quadro2: any[] = await adm.get('/ordens-servico/kanban');
  verifica(!quadro2.some((c) => c.situacao?.id === col.id), 'etapa vazia some do quadro');
  const inicial = quadro2.find((c) => c.situacao?.inicial) ?? quadro2[0];
  if (inicial) await adm.del(`/ordens-servico/colunas/${inicial.situacao.id}`, 422);

  const os = await adm.post('/ordens-servico', {
    contatoId: cli.id,
    dataEntrada: hoje(),
    equipamento: 'PC',
    defeitoRelatado: 'Não liga',
    itens: [{ tipo: 'SERVICO', descricao: 'Formatação', quantidade: 1, valorUnitario: 80 }],
  }, 201);
  const sitOs: any[] = await adm.get('/situacoes?modulo=OS');
  const entregue = sitOs.find((s) => s.nome === 'Entregue');
  const aberta = sitOs.find((s) => s.inicial) ?? sitOs.find((s) => s.nome === 'Aberta');
  const detalhe0 = await adm.get(`/ordens-servico/${os.id}`);
  verifica(detalhe0.situacao?.id === aberta?.id, 'OS nasce na etapa inicial', detalhe0.situacao?.nome);
  await adm.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: entregue.id }, 200);
  const detalhe = await adm.get(`/ordens-servico/${os.id}`);
  verifica(detalhe.situacao?.id === entregue.id, 'OS vai direto da entrada para Entregue', detalhe.situacao?.nome);
  verifica((detalhe.historico ?? []).some((h: any) => h.paraSituacao === 'Entregue' && h.deSituacao), 'histórico registra de onde saiu e para onde foi', detalhe.historico?.[0]);
  await adm.del(`/ordens-servico/colunas/${entregue.id}`, 422);

  secao('Cliente: CPF/CNPJ com máscara e dígito frouxo');
  const masc = await adm.put(`/contatos/${cli.id}`, { nome: `Cliente corrigido ${SUF}`, documento: '111.111.111-11', tipoPessoa: 'F', email: `novo${SUF}@example.com`, logradouro: 'Rua das Flores', numero: '12', municipio: 'Campinas', uf: 'SP' });
  verifica(masc.nome === `Cliente corrigido ${SUF}` && masc.documento === '11111111111' && masc.logradouro === 'Rua das Flores', 'salva nome, endereço e CPF só com dígitos', { doc: masc.documento, aviso: masc.avisoDocumento });
  verifica(typeof masc.avisoDocumento === 'string' && masc.avisoDocumento.length > 0, 'CPF com dígito repetido avisa e não bloqueia', masc.avisoDocumento);
  const cnpj = await adm.put(`/contatos/${cli.id}`, { tipoPessoa: 'F', documento: '11.222.333/0001-81' });
  verifica(cnpj.tipoPessoa === 'J' && cnpj.documento === '11222333000181', 'CNPJ mascarado vira pessoa jurídica', { tipo: cnpj.tipoPessoa, doc: cnpj.documento });
  const curto = await adm.put(`/contatos/${cli.id}`, { documento: '12345', nome: `Cliente corrigido ${SUF}` });
  verifica(curto.documento === '12345' && curto.avisoDocumento, 'documento curto salva com aviso', curto.avisoDocumento);

  secao('Perfil: o próprio vendedor vira técnico, e o admin também muda');
  const senha = 'Senha@Teste123';
  const u = await adm.post('/usuarios', { nome: `Vendedor Loja ${SUF}`, email: `vendloja${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, 201);
  verifica(u.perfil === 'VENDEDOR', 'usuário nasce vendedor');
  const sessao = await entrar(`vendloja${SUF}@teste.com`, senha);
  const trocou = await sessao.post('/auth/trocar-perfil', { perfil: 'TECNICO' });
  verifica(trocou.usuario?.perfil === 'TECNICO' && !!trocou.usuario?.tecnicoId && !!trocou.usuario?.vendedorId && !!trocou.token, 'troca o próprio perfil, ganha técnico e continua vendedor', { perfil: trocou.usuario?.perfil, tec: trocou.usuario?.tecnicoId, vend: trocou.usuario?.vendedorId });
  const nova = new Sessao(trocou.token, 'tecnico');
  const eu = await nova.get('/auth/eu');
  verifica(eu.perfil === 'TECNICO' && eu.tecnicoId === trocou.usuario.tecnicoId, 'o token novo já entra como técnico', eu.perfil);
  const dash = await nova.get(`/meu-dashboard?dataInicial=${hoje()}&dataFinal=${hoje()}`);
  verifica(dash.usuario?.perfil === 'TECNICO' && dash.assistencia, 'Meu Dashboard de técnico abre com a assistência', dash.usuario);
  await sessao.post('/auth/trocar-perfil', { perfil: 'ADMIN' }, 400);

  const u2 = await adm.post('/usuarios', { nome: `Outro Vend ${SUF}`, email: `outrov${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, 201);
  const alt = await adm.put(`/usuarios/${u2.id}`, { perfil: 'TECNICO', vendeTambem: true });
  verifica(alt.perfil === 'TECNICO' && !!alt.tecnicoId && !!alt.vendedorId, 'administrador muda vendedor para técnico que também vende', { perfil: alt.perfil, tec: alt.tecnicoId, vend: alt.vendedorId });

  encerrar('Orçamento, kanban, cliente e perfil');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
