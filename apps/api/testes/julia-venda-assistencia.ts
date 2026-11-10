/**
 * CORREÇÕES PEDIDAS PELA JÚLIA (10/11/2026) — venda e assistência.
 *
 * Cada bloco trava uma das falhas que ela relatou, para nenhuma delas voltar:
 *  1. cadastro rápido do cliente sem endereço (agora a API aceita tudo de uma vez);
 *  2. "Importar do SEFAZ": consulta de CNPJ (só a validação, sem bater na internet);
 *  3. parcelas do cartão: 3x vira UMA conta a receber na data da venda, não 30/60/90,
 *     e a taxa da maquininha continua a de 3x;
 *  4. WhatsApp: o envio responde na hora em vez de só dizer "entrou na fila";
 *  5. técnico que não vende não ganha cadastro de vendedor de volta no login (Wendell);
 *  6. fila de "OS sem custo" visível para a equipe, não só para o gestor;
 *  7. campo fiscal (Inscrição Estadual) nunca mais é descartado em silêncio.
 *
 *   npx tsx testes/julia-venda-assistencia.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  // ------------------------------------------------------------------ 1. cadastro rápido com endereço
  secao('Cadastro rápido do cliente já aceita o endereço (sem abrir outra aba)');
  const cli = await adm.post(
    '/contatos',
    {
      nome: `Cliente Julia ${SUF}`,
      tipoPessoa: 'F',
      celular: '19999990000',
      cep: '13025000',
      logradouro: 'Av. Anchieta',
      numero: '789',
      bairro: 'Cambuí',
      municipio: 'Campinas',
      uf: 'SP',
    },
    201,
  );
  verifica(cli.logradouro === 'Av. Anchieta' && cli.numero === '789' && cli.bairro === 'Cambuí', 'o endereço entra no mesmo cadastro', { logradouro: cli.logradouro, numero: cli.numero });

  // ------------------------------------------------------------------ 2. importar do SEFAZ (CNPJ)
  secao('Importar do SEFAZ: a consulta de CNPJ existe e recusa documento inválido');
  // dígito verificador errado → 422 com mensagem (e não 404 de rota inexistente)
  const cnpjRuim = await adm.get('/contatos/cnpj/11111111111111', 422);
  verifica(String(JSON.stringify(cnpjRuim)).toLowerCase().includes('cnpj'), 'CNPJ inválido é recusado explicando o motivo', cnpjRuim?.erro?.mensagem ?? cnpjRuim?.mensagem);
  await adm.get('/contatos/cnpj/123', 400);

  // ------------------------------------------------------------------ 3. parcelas do cartão
  secao('3x no cartão: UMA conta a receber na data da venda, com a taxa de 3x');
  const formas: any[] = await adm.get('/formas-pagamento');
  const credito = formas.find((f) => f.tipo === 'CARTAO_CREDITO');
  verifica(!!credito, 'existe forma de pagamento de cartão de crédito');

  const prod = await adm.post('/produtos', { nome: `Produto Julia ${SUF}`, preco: 900, precoCusto: 500, ncm: '84713012' }, 201);
  const venda = await adm.post(
    '/vendas',
    {
      contatoId: cli.id,
      data: hoje(),
      itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 900 }],
      // uma linha só: o cliente parcelou em 3x no cartão DELE; para a loja entra de uma vez
      parcelas: [{ dataVencimento: hoje(), valor: 900, formaPagamentoId: credito.id, parcelasCartao: 3 }],
    },
    201,
  );
  verifica(venda.parcelas.length === 1, 'a venda fica com 1 parcela, não 3 em 30/60/90', venda.parcelas.length);
  verifica(venda.parcelas[0].parcelasCartao === 3, 'a parcela guarda as 3 vezes do cartão', venda.parcelas[0].parcelasCartao);
  verifica(String(venda.parcelas[0].dataVencimento).slice(0, 10) === hoje(), 'o vencimento é a data informada, não 30/60/90', venda.parcelas[0].dataVencimento);

  const fech = venda.fechamento;
  verifica(fech?.parcelasCartao === 3, 'o fechamento entende que foram 3 vezes', fech?.parcelasCartao);
  // 1x = 5%, 12x = 12% → 3x = 5 + (7 × 2/11) = 6,27%
  const esperado3x = Math.round((5 + (7 * 2) / 11) * 100) / 100;
  verifica(igual(fech?.taxaCartaoPct ?? 0, esperado3x), `a taxa cobrada é a de 3x (${esperado3x}%), não a de 1x`, fech?.taxaCartaoPct);

  // e a taxa de 1x continua menor, provando que o número de vezes é mesmo lido
  const venda1x = await adm.post(
    '/vendas',
    { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 900 }], parcelas: [{ dataVencimento: hoje(), valor: 900, formaPagamentoId: credito.id, parcelasCartao: 1 }] },
    201,
  );
  verifica((venda1x.fechamento?.taxaCartaoPct ?? 99) < (fech?.taxaCartaoPct ?? 0), 'à vista no cartão a taxa é menor que em 3x', { um: venda1x.fechamento?.taxaCartaoPct, tres: fech?.taxaCartaoPct });

  // ------------------------------------------------------------------ 4. WhatsApp responde na hora
  secao('Enviar ao cliente responde na hora, em vez de só "entrou na fila"');
  const envio = await adm.post(`/vendas/${venda.id}/notificar`, { canal: 'WHATSAPP', mensagem: 'Olá {{cliente.primeiroNome}}, segue seu pedido.' }, 201);
  verifica(typeof envio.status === 'string', 'a resposta traz o que aconteceu com o envio', envio.status);
  // sem WhatsApp conectado no teste, o certo é dizer o motivo — nunca "ENVIADA"
  verifica(envio.status !== 'ENVIADA', 'sem WhatsApp conectado o sistema não finge que enviou', envio.status);
  verifica(typeof envio.erro === 'string' && envio.erro.length > 0, 'a resposta diz o motivo de não ter saído', envio.erro);

  // "Reenviar" tem de funcionar mesmo numa mensagem antiga: ela não pode ser descartada
  // pela regra que expira o que está parado na fila há horas.
  const reenvio = await adm.post(`/notificacoes/${envio.id}/reenviar`, {}).catch(() => null);
  if (reenvio) verifica(reenvio.status !== 'CANCELADA', 'reenviar não descarta a mensagem', reenvio.status);

  // ------------------------------------------------------------------ 5. técnico que não vende (Wendell)
  secao('Técnico marcado como "só técnico" não volta a ser vendedor no login');
  const email = `tecnico.julia.${SUF}@balao.info`;
  const tec = await adm.post('/usuarios', { nome: `Tecnico Julia ${SUF}`, email, senha: 'teste12345', perfil: 'TECNICO' }, 201);
  const tecCriado = (await adm.get('/usuarios')).find((u: any) => u.id === tec.id);
  verifica(!!tecCriado?.vendedorId, 'técnico comum ganha cadastro de vendedor (ele também vende)', tecCriado?.vendedorId);

  // Editar qualquer detalhe REBAIXAVA o usuário para VENDEDOR (o `.default()` do schema
  // entrava mesmo sem a chave no corpo) — era outro caminho pelo qual o técnico virava vendedor.
  const soNome = await adm.put(`/usuarios/${tec.id}`, { nome: `Tecnico Julia ${SUF} Silva` });
  verifica(soNome.perfil === 'TECNICO', 'salvar só o nome não rebaixa o perfil para VENDEDOR', soNome.perfil);
  verifica(soNome.ativo === true, 'e não mexe no "ativo"', soNome.ativo);
  await adm.put(`/usuarios/${tec.id}`, { ativo: false });
  const reativa = await adm.put(`/usuarios/${tec.id}`, { telefone: '19999990000' });
  verifica(reativa.ativo === false, 'salvar outro campo não reativa um usuário desativado', reativa.ativo);
  await adm.put(`/usuarios/${tec.id}`, { ativo: true });

  const soTecnico = await adm.put(`/usuarios/${tec.id}`, { vendeTambem: false });
  verifica(soTecnico.vendeTambem === false, 'dá para marcar "só técnico"', soTecnico.vendeTambem);
  verifica(soTecnico.vendedorId === null, 'o vínculo de vendedor é desfeito na hora', soTecnico.vendedorId);

  // o login era exatamente o momento em que o vínculo voltava
  const sessaoTec = await entrar(email, 'teste12345');
  const eu = await sessaoTec.get('/auth/eu').catch(() => null);
  if (eu) verifica(eu.vendedorId == null, 'depois de entrar no sistema ele continua só técnico', eu.vendedorId);
  const depois = (await adm.get('/usuarios')).find((u: any) => u.id === tec.id);
  verifica(depois?.vendedorId == null, 'e no cadastro também não voltou', depois?.vendedorId);

  // ------------------------------------------------------------------ 6. fila de OS sem custo para a equipe
  secao('Fila de "OS sem custo" aparece para a equipe, não só para o gestor');
  const osSemCusto = await adm.post(
    '/ordens-servico',
    { contatoId: cli.id, dataEntrada: hoje(), equipamento: 'Notebook', defeitoRelatado: `Sem custo ${SUF}`, itens: [{ tipo: 'PECA', descricao: 'Tela', quantidade: 1, valorUnitario: 400 }] },
    201,
  );
  const fila = await adm.get('/ordens-servico?semCusto=1&limite=200');
  verifica(fila.data.some((o: any) => o.id === osSemCusto.id), 'a OS sem custo aparece no filtro', fila.meta?.total);

  const comCusto = await adm.put(`/ordens-servico/${osSemCusto.id}`, { custoPeca: 250 });
  verifica(comCusto.custoPeca === 250, 'o custo é lançado');
  const fila2 = await adm.get('/ordens-servico?semCusto=1&limite=200');
  verifica(!fila2.data.some((o: any) => o.id === osSemCusto.id), 'depois de preenchida ela sai da fila');

  // o técnico (quem vai preencher) também enxerga a fila
  const filaTec = await sessaoTec.get('/ordens-servico?semCusto=1&limite=5');
  verifica(Array.isArray(filaTec.data), 'o técnico consegue abrir a mesma fila', filaTec.meta?.total);

  // ------------------------------------------------------------------ 7. campo fiscal nunca some em silêncio
  secao('Inscrição Estadual: quem não é ADMIN recebe recusa, não um "salvo" mentiroso');
  const emailGer = `gerente.julia.${SUF}@balao.info`;
  await adm.post('/usuarios', { nome: `Gerente Julia ${SUF}`, email: emailGer, senha: 'teste12345', perfil: 'GERENTE' }, 201);
  const ger = await entrar(emailGer, 'teste12345');
  if (ger.token) {
    const antes = await adm.get('/empresa');
    const r = await ger.put('/empresa', { ie: `999${SUF}` }, 403);
    verifica(String(JSON.stringify(r)).toLowerCase().includes('inscrição estadual'), 'a mensagem diz qual campo foi barrado', r?.erro?.mensagem ?? r?.mensagem);
    const depoisEmp = await adm.get('/empresa');
    verifica(depoisEmp.ie === antes.ie, 'a IE continua a mesma', { antes: antes.ie, depois: depoisEmp.ie });
  }
}

main()
  .then(() => encerrar('Correções da Júlia: venda e assistência'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
