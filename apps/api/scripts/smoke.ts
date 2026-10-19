/**
 * Teste de fumaça da API (ponta a ponta) — roda contra uma API no ar.
 *   npx tsx scripts/smoke.ts [http://localhost:3333]
 * Exercita: login, cadastros, venda (situações/estoque/contas/comissão/NF-e mock), compra, OS (kanban→entregue),
 * financeiro (baixa/estorno/fluxo), bancos (mock + OFX + conciliação), notificações, dashboards, DRE, relatórios, fiscal.
 */
const BASE = (process.argv[2] || 'http://localhost:3333') + '/api/v1';
let token = '';
let falhas = 0;
let ok = 0;

async function req(metodo: string, rota: string, body?: any, esperado: number | number[] = 200, raw = false) {
  const esperados = Array.isArray(esperado) ? esperado : [esperado];
  const r = await fetch(BASE + rota, {
    method: metodo,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { json = texto; }
  const passou = esperados.includes(r.status);
  if (passou) ok++; else { falhas++; console.log(`  ✖ ${metodo} ${rota} → ${r.status} (esperado ${esperados.join('/')}) ${typeof json === 'object' ? JSON.stringify(json).slice(0, 300) : String(json).slice(0, 200)}`); }
  if (!raw && passou) console.log(`  ✔ ${metodo} ${rota} → ${r.status}`);
  return json;
}
const hoje = new Date().toISOString().slice(0, 10);
const SUF = String(Date.now()).slice(-6); // torna o teste repetível no mesmo banco

async function main() {
  console.log('== Auth');
  const login = await req('POST', '/auth/login', { email: 'admin@balao.info', senha: 'admin123' });
  token = login.token;
  await req('GET', '/auth/eu');
  await req('GET', '/saude');

  console.log('== Cadastros');
  await req('GET', '/empresa');
  await req('PUT', '/empresa', { telefone: '(19) 3233-0000' });
  const vendedores = await req('GET', '/vendedores');
  const tecnicos = await req('GET', '/tecnicos');
  const depositos = await req('GET', '/depositos');
  const formas = await req('GET', '/formas-pagamento');
  await req('GET', '/categorias-financeiras');
  await req('GET', '/contas-financeiras');
  const sitV = await req('GET', '/situacoes?modulo=VENDA');
  const sitO = await req('GET', '/situacoes?modulo=OS');
  const sitC = await req('GET', '/situacoes?modulo=COMPRA');
  await req('GET', '/situacoes/transicoes?modulo=VENDA');
  await req('GET', '/situacoes/acoes');
  const s = (lista: any[], nome: string) => lista.find((x) => x.nome === nome)?.id;

  console.log('== Contatos');
  const cli = await req('POST', '/contatos', { nome: `Cliente Smoke ${SUF}`, tipoPessoa: 'F', documento: `98765${SUF}`, celular: '19999998888', email: 'smoke@example.com', logradouro: 'Rua A', numero: '1', bairro: 'Centro', municipio: 'Campinas', codigoMunicipio: '3509502', uf: 'SP', cep: '13010000' }, 201);
  await req('GET', `/contatos/${cli.id}`);
  await req('GET', '/contatos?pesquisa=smoke');
  const forn = await req('POST', '/contatos', { nome: `Fornecedor Smoke ${SUF}`, tipo: 'FORNECEDOR', tipoPessoa: 'J', documento: `11222333${SUF}` }, 201);

  console.log('== Produtos / estoque');
  const prod = await req('POST', '/produtos', { nome: `PRODUTO SMOKE SSD ${SUF}`, codigo: `SMK-${SUF}`, preco: 300, precoCusto: 200, ncm: '84717012', csosn: '102', estoqueMinimo: 1 }, 201);
  const dep = depositos.find((d: any) => d.padrao)?.id ?? depositos[0].id;
  await req('POST', '/estoque/ajuste', { produtoId: prod.id, depositoId: dep, tipo: 'ENTRADA', quantidade: 10, custoUnitario: 200, observacao: 'smoke' }, [200, 201]);
  const p = await req('GET', `/produtos/${prod.id}`);
  if ((p.estoqueTotal ?? p.saldos?.[0]?.saldo) !== 10) { falhas++; console.log('  ✖ estoque esperado 10, veio', p.estoqueTotal, JSON.stringify(p.saldos)); }
  await req('GET', '/estoque/saldos?abaixoMinimo=true');
  await req('GET', `/produtos/${prod.id}/movimentos`);

  console.log('== Venda');
  const venda = await req('POST', '/vendas', {
    contatoId: cli.id, vendedorId: vendedores[0].id, data: hoje, depositoId: dep,
    itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 2, valorUnitario: 300, desconto: 0, comissaoPct: 5 }],
    parcelas: [{ dataVencimento: hoje, valor: 300, formaPagamentoId: formas[0].id }, { dataVencimento: hoje, valor: 300, formaPagamentoId: formas[1].id }],
  }, 201);
  await req('GET', `/vendas/${venda.id}`);
  await req('GET', '/vendas?pesquisa=smoke');
  await req('POST', `/vendas/${venda.id}/situacao`, { situacaoId: s(sitV, 'Em aberto') });
  const atendida = await req('POST', `/vendas/${venda.id}/situacao`, { situacaoId: s(sitV, 'Fechada') });
  const v2 = await req('GET', `/vendas/${venda.id}`);
  if (!v2.estoqueLancado || !v2.contasLancadas) { falhas++; console.log('  ✖ venda deveria ter estoque/contas lançados', atendida); }
  const p2 = await req('GET', `/produtos/${prod.id}`);
  if ((p2.estoqueTotal ?? 0) !== 8) { falhas++; console.log('  ✖ estoque após venda esperado 8, veio', p2.estoqueTotal); }
  // situação de outro módulo (orçamento) não vale para a venda
  const sitOrc = await req('GET', '/situacoes?modulo=ORCAMENTO', undefined, 200, true);
  await req('POST', `/vendas/${venda.id}/situacao`, { situacaoId: s(sitOrc, 'Enviado') }, [404, 422]);
  await req('GET', `/vendas/${venda.id}/imprimir`, undefined, 200, true);
  const nf = await req('POST', `/vendas/${venda.id}/gerar-nfe`, { modelo: 55 }, [200, 201]);
  await req('POST', `/vendas/${venda.id}/notificar`, { canal: 'WHATSAPP', mensagem: 'Teste smoke {{numero}}' }, [200, 201]);
  await req('POST', `/vendas/${venda.id}/duplicar`, undefined, [200, 201]);

  console.log('== Fiscal (provedor mock)');
  await req('GET', '/fiscal/status-sefaz');
  await req('GET', `/notas-fiscais/${nf.notaId}`);
  const tr = await req('POST', `/notas-fiscais/${nf.notaId}/transmitir`);
  if (tr.situacao !== 'AUTORIZADA') { falhas++; console.log('  ✖ NF-e mock deveria autorizar', tr); }
  await req('GET', `/notas-fiscais/${nf.notaId}/xml`, undefined, 200, true);
  await req('GET', `/notas-fiscais/${nf.notaId}/danfe`, undefined, 200, true);
  await req('POST', `/notas-fiscais/${nf.notaId}/consultar`);
  await req('POST', `/notas-fiscais/${nf.notaId}/carta-correcao`, { texto: 'Correcao de teste do smoke test com mais de quinze caracteres' });
  await req('GET', '/notas-fiscais?situacao=AUTORIZADA');
  await req('POST', `/notas-fiscais/${nf.notaId}/cancelar`, { justificativa: 'Cancelamento de teste automatizado do sistema' });

  console.log('== Compra');
  const compra = await req('POST', '/compras', {
    fornecedorId: forn.id, data: hoje, depositoId: dep,
    itens: [{ produtoId: prod.id, descricao: prod.nome, quantidade: 5, valorUnitario: 190 }],
    parcelas: [{ dataVencimento: hoje, valor: 950, formaPagamentoId: formas[0].id }],
  }, 201);
  await req('POST', `/compras/${compra.id}/situacao`, { situacaoId: s(sitC, 'Fechado') });
  const p3 = await req('GET', `/produtos/${prod.id}`);
  if ((p3.estoqueTotal ?? 0) !== 13) { falhas++; console.log('  ✖ estoque após compra esperado 13, veio', p3.estoqueTotal); }
  await req('GET', `/compras/${compra.id}/imprimir`, undefined, 200, true);

  console.log('== Ordem de serviço');
  const os = await req('POST', '/ordens-servico', {
    contatoId: cli.id, tecnicoId: tecnicos[0]?.id, vendedorId: vendedores[0].id, equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron', numeroSerie: 'SMK001', defeitoRelatado: 'Não liga', orcar: true, depositoId: dep,
    itens: [{ tipo: 'PECA', produtoId: prod.id, descricao: prod.nome, quantidade: 1, valorUnitario: 300, comissaoTecnicoPct: 0 }, { tipo: 'SERVICO', descricao: 'Mão de obra', quantidade: 1, valorUnitario: 150, comissaoTecnicoPct: 10 }],
    parcelas: [{ dataVencimento: hoje, valor: 450, formaPagamentoId: formas[1].id }],
  }, 201);
  await req('GET', `/ordens-servico/${os.id}`);
  await req('GET', '/ordens-servico/kanban');
  await req('POST', `/ordens-servico/${os.id}/situacao`, { situacaoId: s(sitO, 'Em orçamento') });
  await req('POST', `/ordens-servico/${os.id}/situacao`, { situacaoId: s(sitO, 'Aguardando aprovação') });
  await req('POST', `/ordens-servico/${os.id}/aprovar-orcamento`, { aprovadoPor: 'smoke' });
  await req('POST', `/ordens-servico/${os.id}/situacao`, { situacaoId: s(sitO, 'Em andamento') });
  await req('POST', `/ordens-servico/${os.id}/situacao`, { situacaoId: s(sitO, 'Concluída') });
  await req('POST', `/ordens-servico/${os.id}/situacao`, { situacaoId: s(sitO, 'Entregue') });
  const os2 = await req('GET', `/ordens-servico/${os.id}`);
  if (!os2.contasLancadas || !os2.estoqueLancado) { falhas++; console.log('  ✖ OS entregue deveria ter contas/estoque lançados'); }
  const p4 = await req('GET', `/produtos/${prod.id}`);
  if ((p4.estoqueTotal ?? 0) !== 12) { falhas++; console.log('  ✖ estoque após OS esperado 12, veio', p4.estoqueTotal); }
  for (const via of ['cliente', 'tecnico', 'etiqueta']) await req('GET', `/ordens-servico/${os.id}/imprimir?via=${via}`, undefined, 200, true);
  await req('GET', `/contatos/${cli.id}/historico`);

  console.log('== Comissões');
  const com = await req('GET', `/comissoes?competencia=${hoje.slice(0, 7)}`);
  await req('GET', `/comissoes/resumo?competencia=${hoje.slice(0, 7)}`);
  const ids = (com.data || []).filter((c: any) => c.status === 'PENDENTE').map((c: any) => c.id).slice(0, 2);
  if (ids.length) { await req('POST', '/comissoes/aprovar', { ids }); await req('POST', '/comissoes/pagar', { ids, contaFinanceiraId: 1, data: hoje }); }

  console.log('== Financeiro');
  const cr = await req('GET', '/contas-receber?situacao=ABERTO');
  const conta = (cr.data || []).find((c: any) => c.contato?.id === cli.id || c.contatoId === cli.id) || cr.data?.[0];
  if (conta) {
    await req('POST', `/contas-receber/${conta.id}/baixar`, { valor: conta.valor, data: hoje, contaFinanceiraId: 1 });
    await req('POST', `/contas-receber/${conta.id}/estornar`);
    await req('POST', `/contas-receber/${conta.id}/baixar`, { data: hoje, contaFinanceiraId: 1 });
  }
  await req('GET', '/contas-pagar?situacao=ATRASADO');
  await req('POST', '/contas-pagar', { descricao: 'Despesa smoke', vencimento: hoje, valor: 99.9, categoriaId: 10 }, 201);
  await req('GET', '/financeiro/resumo');
  await req('GET', `/financeiro/fluxo-caixa?dataInicial=${hoje.slice(0, 8)}01&dataFinal=${hoje}&agrupar=dia`);
  await req('GET', '/financeiro/movimentos?contaFinanceiraId=1');
  await req('POST', '/financeiro/transferencia', { origemId: 1, destinoId: 2, valor: 10, data: hoje, descricao: 'transf smoke' }, [200, 201]);

  console.log('== Bancos / Open Finance (mock) / conciliação');
  await req('GET', '/open-finance/status');
  await req('POST', '/open-finance/connect-token', undefined, [200, 201]);
  const vinc = await req('POST', '/open-finance/vincular', { itemId: 'mock-smoke' }, [200, 201]);
  const contaOf = Array.isArray(vinc) ? vinc[0]?.contaFinanceiraId : vinc?.[0]?.contaFinanceiraId ?? vinc?.contas?.[0]?.contaFinanceiraId;
  if (contaOf) await req('POST', `/open-finance/sincronizar/${contaOf}`);
  const trans = await req('GET', '/bancos/transacoes?conciliado=false');
  const t0 = trans.data?.[0];
  if (t0) await req('POST', `/bancos/transacoes/${t0.id}/conciliar`, { tipo: 'LANCAMENTO', descricao: 'conciliado smoke' }, [200, 201]);
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${hoje.replace(/-/g, '')}120000<TRNAMT>150.00<FITID>SMK-1<MEMO>PIX RECEBIDO SMOKE</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${hoje.replace(/-/g, '')}120000<TRNAMT>-45.50<FITID>SMK-2<MEMO>TARIFA</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  await req('POST', '/bancos/importar-ofx', { contaFinanceiraId: 2, conteudo: ofx }, [200, 201]);

  console.log('== Notificações / WhatsApp / templates');
  await req('GET', '/notificacoes');
  await req('GET', '/templates-notificacao');
  await req('GET', '/templates-notificacao/variaveis');
  const tpl = await req('GET', '/templates-notificacao?evento=OS_SITUACAO&canal=WHATSAPP');
  const t1 = (tpl.data || tpl)[0];
  if (t1) await req('POST', `/templates-notificacao/${t1.id}/preview`, { origemTipo: 'OS', origemId: os.id });
  await req('GET', '/whatsapp/status');
  await req('POST', '/empresa/smtp/testar', { para: 'x@y.com' }, [422, 200, 500]);

  console.log('== Dashboards / relatórios');
  await req('GET', '/dashboard/geral');
  await req('GET', `/dashboard/vendas?dataInicial=${hoje.slice(0, 8)}01&dataFinal=${hoje}&comparar=true`);
  await req('GET', '/dashboard/os');
  await req('GET', `/relatorios/dre?dataInicial=${hoje.slice(0, 8)}01&dataFinal=${hoje}&regime=competencia&comparar=true`);
  await req('GET', `/relatorios/dre?dataInicial=${hoje.slice(0, 8)}01&dataFinal=${hoje}&regime=caixa`);
  await req('GET', '/relatorios/produtos-mais-vendidos?formato=csv', undefined, 200, true);
  await req('GET', '/relatorios/estoque');
  await req('GET', '/bling/status');
  await req('GET', '/auditoria?limite=5');

  console.log('== Público');
  await req('GET', `/publico/os/${os2.tokenPublico || 'invalido'}`, undefined, [200, 404], true);

  console.log('== Orçamento (proposta → envio com PDF → aprovação → venda) e ações do menu');
  const verifica = (cond: boolean, msg: string) => { if (cond) ok++; else { falhas++; console.log('  ✖ ' + msg); } };
  const orc = await req('POST', '/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, itens: [{ produtoId: prod.id, quantidade: 1 }] }, 201);
  verifica(orc.tipo === 'ORCAMENTO' && !!orc.validade && orc.total === 300, `orçamento com validade e preço do produto (veio ${orc.tipo} ${orc.validade} ${orc.total})`);
  const saldoAntes = (await req('GET', `/produtos/${prod.id}`, undefined, 200, true)).estoqueTotal;
  await req('POST', `/vendas/${orc.id}/acoes`, { acoes: ['lancarEstoque'] }, 422);
  await req('POST', `/vendas/${orc.id}/gerar-nfe`, {}, 422);
  const listaOrc = await req('GET', '/vendas?tipo=ORCAMENTO&limite=200', undefined, 200, true);
  verifica(listaOrc.data.some((v: any) => v.id === orc.id), 'orçamento aparece em ?tipo=ORCAMENTO');
  const listaPed = await req('GET', '/vendas?limite=200', undefined, 200, true);
  verifica(!listaPed.data.some((v: any) => v.id === orc.id), 'orçamento não aparece na lista de pedidos');
  const pdf = await fetch(`${BASE}/vendas/${orc.id}/pdf`, { headers: { authorization: `Bearer ${token}` } });
  verifica(pdf.status === 200 && (pdf.headers.get('content-type') || '').includes('pdf'), 'PDF do orçamento');
  const notif = await req('POST', `/vendas/${orc.id}/notificar`, { canal: 'EMAIL', mensagem: 'Orçamento {{numero}} até {{validade}}', anexarPdf: true }, 201);
  verifica(!!notif.anexoPath && /Orcamento-/.test(notif.anexoPath), 'notificação com PDF anexo');
  verifica((await req('GET', `/vendas/${orc.id}`, undefined, 200, true)).situacao.nome === 'Enviado', 'orçamento enviado vai para "Enviado"');
  await req('POST', `/vendas/${orc.id}/aprovar`, {});
  const vendaOrc = await req('POST', `/vendas/${orc.id}/converter`, {}, 201);
  verifica(vendaOrc.tipo === 'PEDIDO' && vendaOrc.orcamento?.id === orc.id && vendaOrc.total === 300, 'venda gerada do orçamento');
  await req('POST', `/vendas/${orc.id}/converter`, {}, 422);
  verifica((await req('GET', `/vendas/${orc.id}`, undefined, 200, true)).situacao.nome === 'Convertido em venda', 'orçamento fica "Convertido em venda"');
  verifica((await req('GET', `/produtos/${prod.id}`, undefined, 200, true)).estoqueTotal === saldoAntes, 'orçamento não mexeu no estoque');
  const clone = await req('POST', `/vendas/${vendaOrc.id}/duplicar`, undefined, 201);
  verifica(clone.tipo === 'PEDIDO' && clone.numero !== vendaOrc.numero, 'clonar venda');
  const outroVend = vendedores.find((v: any) => v.id !== vendaOrc.vendedorId) ?? vendedores[0];
  const transf = await req('POST', `/vendas/${clone.id}/transferir-vendedor`, { vendedorId: outroVend.id });
  verifica(transf.venda.vendedorId === outroVend.id, 'transferir para vendedor');
  await req('POST', `/vendas/${clone.id}/situacao`, { situacaoId: sitV.find((x: any) => x.cancelamento)?.id });
  const orcPub = await req('POST', '/vendas', { tipo: 'ORCAMENTO', contatoId: cli.id, itens: [{ produtoId: prod.id, quantidade: 1 }] }, 201);
  const salvo = token; token = '';
  await req('POST', `/publico/venda/${orcPub.tokenPublico}/aprovar`, { nome: 'Cliente Smoke' });
  token = salvo;
  verifica(!!(await req('GET', `/vendas/${orcPub.id}`, undefined, 200, true)).aprovadoEm, 'aprovação pelo link público');

  console.log(`\nResultado: ${ok} ok, ${falhas} falhas`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
