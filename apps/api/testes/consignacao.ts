/**
 * CONSIGNAÇÃO — 28/10/2026
 * - Regras: 80% do consignante, 10 dias corridos, 5% por dia útil (mín. R$ 100, máx. R$ 1.000), taxa de retirada R$ 100.
 * - Vendedor cria contrato (consignante novo na hora): produto CONS-N com estoque 1, compra "Consignado", WhatsApp com o link.
 * - Link do consignante: assinar pelo celular (CPF confere), autorizar desconto de 5%, escolher retirar.
 * - Vendeu no prazo → pagar na hora (uma conta vencendo hoje), sem compra duplicada; estorno da venda volta ao prazo.
 * - Passou do prazo → diárias em dias úteis; vendeu nas diárias → painel sugere quitar; quitar paga o saldo.
 * - Pagou todas as diárias → QUITADO e vira estoque próprio (compra "Fechado").
 * - Retirada antes do prazo cobra R$ 100; depois do prazo, sem taxa. Vitrine do site e contrato em HTML.
 *   npx tsx testes/consignacao.ts http://localhost:3333
 */
import sharp from 'sharp';
import { BASE, clienteCompleto, cpfTeste, diasAtras, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';
import { planoDiarias } from '../src/modules/consignacoes/nucleo.js';
import { diasUteisDepois, ehDiaUtil, pascoa, proximoDiaUtil } from '../src/modules/consignacoes/calendario.js';

const RAIZ = BASE.replace(/\/api\/v1$/, '');

async function main() {
  secao('Contas: diária de 5% com mínimo e máximo; dias úteis e feriados');
  const r = { diariaPct: 5, diariaMinima: 100, diariaMaxima: 1000 };
  const p1 = planoDiarias(3000, r);
  verifica(p1.diaria === 150 && p1.quantidade === 20, 'R$ 3.000 → 20 diárias de R$ 150', p1);
  const p2 = planoDiarias(800, r);
  verifica(p2.diaria === 100 && p2.quantidade === 8, 'R$ 800 → mínimo de R$ 100 (8 diárias)', p2);
  const p3 = planoDiarias(32000, r);
  verifica(p3.diaria === 1000 && p3.quantidade === 32, 'R$ 32.000 → máximo de R$ 1.000 por dia (32 diárias)', p3);
  const p4 = planoDiarias(3010, r);
  verifica(p4.quantidade === 20 && igual(p4.parcelas.reduce((s, x) => s + x, 0), 3010), 'última diária fecha a conta certinho', p4);
  verifica(pascoa(2026).getMonth() === 3 && pascoa(2026).getDate() === 5, 'Páscoa 2026 = 5 de abril');
  verifica(!ehDiaUtil(new Date(2026, 10, 2, 12)) && !ehDiaUtil(new Date(2026, 10, 20, 12)) && ehDiaUtil(new Date(2026, 10, 3, 12)), 'Finados e Consciência Negra não são dias úteis');
  const sexta = new Date(2026, 9, 30, 12);
  verifica(proximoDiaUtil(sexta).getDate() === 3 && proximoDiaUtil(sexta).getMonth() === 10, 'depois da sexta 30/10/2026 o próximo dia útil é terça 03/11 (pula fim de semana e Finados)', proximoDiaUtil(sexta));
  verifica(diasUteisDepois(new Date(2026, 11, 23, 12), 3).map((d) => d.getDate()).join(',') === '24,28,29', 'Natal fora: 24, 28 e 29/12', diasUteisDepois(new Date(2026, 11, 23, 12), 3));

  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'Senha@Teste123';
  await adm.post('/usuarios', { nome: `Vendedor Consig ${SUF}`, email: `vcons${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [200, 201]);
  const vend = await entrar(`vcons${SUF}@teste.com`, senha);
  vend.nome = 'VENDEDOR';
  const contasFin: any = await adm.get('/contas-financeiras?ativo=true');
  const banco = ((Array.isArray(contasFin) ? contasFin : contasFin.data) as any[]).find((c) => c.tipo !== 'COMPENSACAO');
  const sitV: any[] = await adm.get('/situacoes?modulo=VENDA');
  const cancelada = sitV.find((s) => s.cancelamento)?.id;
  const formas: any[] = await adm.get('/formas-pagamento');
  const pix = formas.find((f) => f.tipo === 'PIX') ?? formas[0];
  const cliente = await adm.post('/contatos', clienteCompleto(`Comprador Consig ${SUF}`, String(Number(SUF) + 7).slice(-6)), 201);

  secao('Regras padrão e simulação');
  const regras = await adm.get('/consignacoes/regras');
  verifica(regras.regras.percentualConsignante === 80 && regras.regras.prazoDias === 10 && regras.regras.taxaRetirada === 100, 'padrão: 80% / 10 dias / taxa R$ 100', regras.regras);
  const sim = await vend.get('/consignacoes/simular?precoVenda=3750');
  verifica(igual(sim.valorConsignante, 3000) && sim.diaria === 150 && sim.quantidadeDiarias === 20 && igual(sim.lucroLoja, 750), 'R$ 3.750 → consignante R$ 3.000, loja R$ 750, 20 × R$ 150', sim);

  secao('Vendedor cria o contrato com o consignante novo na hora');
  const docCons = cpfTeste(String(Number(SUF) + 3).slice(-6));
  const c1 = await vend.post(
    '/consignacoes',
    { consignante: { nome: `Fulano Consignante ${SUF}`, documento: docCons, celular: '19988887777', email: `cons${SUF}@example.com`, municipio: 'Campinas', uf: 'SP' }, tipoEquipamento: 'NOTEBOOK', descricao: `MacBook Air M1 ${SUF}`, marca: 'Apple', numeroSerie: `SN${SUF}`, estado: 'Seminovo, sem marcas', precoVenda: 3750, declaracaoOrigem: true },
    201,
  );
  verifica(c1.status === 'NO_PRAZO' && igual(c1.valorConsignante, 3000) && c1.prazoDias === 10, 'contrato no prazo, consignante recebe R$ 3.000', { s: c1.status, v: c1.valorConsignante });
  verifica(c1.produto?.codigo === `CONS-${c1.numero}` && c1.estoque === 1, 'produto CONS-N criado com 1 no estoque', { p: c1.produto, e: c1.estoque });
  verifica(c1.compra?.situacao?.nome === 'Consignado', 'pedido de compra em "Consignado"', c1.compra);
  verifica(/\/p\/consignacao\/[0-9a-f]{24}$/.test(c1.link) && !c1.assinadoEm, 'link do consignante gerado, falta assinar', c1.link);
  const notifs = await adm.get(`/notificacoes?origemTipo=CONSIGNACAO&origemId=${c1.id}`);
  const lst = (notifs.data ?? notifs) as any[];
  verifica(lst.length >= 1 && lst[0].canal === 'WHATSAPP' && lst[0].corpo.includes(c1.link) && lst[0].destinatario === '5519988887777', 'WhatsApp ao consignante com o link (número com 55)', lst[0]);
  await vend.post('/consignacoes', { consignante: { nome: 'Sem Celular', documento: cpfTeste('111222') }, descricao: 'Teste sem celular', precoVenda: 500 }, 422);
  await vend.post('/consignacoes', { consignanteId: c1.consignanteId, descricao: 'Retroativo', precoVenda: 500, dataEntrada: diasAtras(5) }, 403);
  await vend.get('/consignacoes/painel', 403);
  await vend.post(`/consignacoes/${c1.id}/pagar`, { contaFinanceiraId: banco.id }, 403);
  const lista = await vend.get('/consignacoes?ativas=true');
  verifica(lista.data.some((x: any) => x.id === c1.id), 'vendedor vê a lista de consignações');

  secao('Fotos (vão para o site)');
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#e52421' } }).png().toBuffer();
  const fd = new FormData();
  fd.append('arquivo', new Blob([png], { type: 'image/png' }), 'foto.png');
  const up = await fetch(`${BASE}/consignacoes/${c1.id}/fotos`, { method: 'POST', headers: { authorization: `Bearer ${vend.token}` }, body: fd });
  const upJ: any = await up.json();
  verifica(up.status === 201 && upJ.fotos?.length === 1, 'foto enviada e convertida', upJ);
  const fotoUrl = upJ.fotos?.[0]?.url;
  const foto = fotoUrl ? await fetch(`${RAIZ}${fotoUrl}`) : null;
  verifica(foto?.status === 200 && (foto?.headers.get('content-type') || '').includes('jpeg'), 'foto pública (sem login) para o site', foto?.status);

  secao('Link do consignante: assinar pelo celular');
  const token = c1.link.split('/').pop();
  const pub = await adm.get(`/publico/consignacao/${token}`);
  verifica(pub.consignacao?.numero === c1.numero && igual(pub.consignacao.valorConsignante, 3000) && !('precoCusto' in pub.consignacao) && pub.consignacao.consignante === 'Fulano', 'link mostra o contrato (só o primeiro nome, sem custos internos)', pub.consignacao);
  const assinaturaPng = 'data:image/png;base64,' + (await sharp({ create: { width: 300, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  await adm.post(`/publico/consignacao/${token}/assinar`, { nome: `Fulano Consignante ${SUF}`, documento: '11111111111', aceite: true, assinatura: assinaturaPng }, 422);
  const ass = await adm.post(`/publico/consignacao/${token}/assinar`, { nome: `Fulano Consignante ${SUF}`, documento: docCons, aceite: true, assinatura: assinaturaPng }, 200);
  verifica(ass.consignacao?.assinado && ass.consignacao.noSite, 'assinado e já aparece no site', ass.consignacao);
  const contrato = await fetch(`${BASE}/publico/consignacao/${token}/contrato`).then((x) => x.text());
  verifica(contrato.includes('CONTRATO DE CONSIGNAÇÃO') && contrato.includes('R$ 3.000,00') && contrato.includes('Assinado eletronicamente') && contrato.includes('versiculo'), 'contrato em HTML com valor, assinatura eletrônica e versículo');
  const vit = await adm.get('/publico/consignados');
  const item = vit.data.find((x: any) => x.numero === c1.numero);
  verifica(item && igual(item.preco, 3750) && item.fotos.length === 1 && /^https?:\/\//.test(item.fotos[0]) && !('valorConsignante' in item), 'vitrine do site: preço, foto com endereço completo, sem o valor do consignante', item);

  secao('Desconto: a loja pede 5%, o consignante autoriza pelo link');
  await adm.put(`/consignacoes/${c1.id}`, { precoVenda: 2900 }, 422); // abaixo do valor travado
  const ped = await vend.post(`/consignacoes/${c1.id}/desconto`, {}, 200);
  verifica(ped.descontoPendente && igual(ped.descontoPendente.precoPara, 3562.5) && igual(ped.descontoPendente.valorPara, 2850), 'pedido: R$ 3.750 → R$ 3.562,50 (consignante R$ 2.850)', ped.descontoPendente);
  const resp = await adm.post(`/publico/consignacao/${token}/desconto/${ped.descontoPendente.id}`, { autorizar: true }, 200);
  verifica(resp.status === 'AUTORIZADO' && igual(resp.consignacao.precoVenda, 3562.5) && igual(resp.consignacao.valorConsignante, 2850), 'autorizado: preço e valor do consignante baixaram 5%', resp.consignacao);
  const prod1 = await adm.get(`/produtos/${c1.produto.id}`);
  verifica(igual(prod1.preco, 3562.5) && igual(prod1.precoCusto, 2850), 'produto acompanha (preço e custo)', { p: prod1.preco, c: prod1.precoCusto });

  secao('Vendeu no prazo → pagar o consignante na hora');
  const v1 = await adm.post('/vendas', { contatoId: cliente.id, data: hoje(), itens: [{ produtoId: c1.produto.id, quantidade: 1, valorUnitario: 3562.5 }], parcelas: [{ dataVencimento: hoje(), valor: 3562.5, formaPagamentoId: pix.id }] }, 201);
  const fz = await adm.get(`/vendas/${v1.id}/finalizacao`);
  verifica(fz.consignados?.some((x: any) => x.numero === c1.numero) && igual(fz.custoProdutos, 0), 'finalizar: reconhece o consignado e não pergunta da compra', { c: fz.consignados, custo: fz.custoProdutos });
  await adm.post(`/vendas/${v1.id}/finalizar`, { compra: { paga: true, contaFinanceiraId: banco.id }, recebimentos: [{ parcelaId: fz.parcelas[0].id, recebido: false }] }, 200);
  const c1v = await adm.get(`/consignacoes/${c1.id}`);
  const contaVenda = c1v.contasPagar.find((x: any) => x.parcela === 'VENDA');
  verifica(c1v.status === 'VENDIDO' && contaVenda && igual(contaVenda.valor, 2850) && contaVenda.vencimento.slice(0, 10) === hoje() && c1v.alerta?.tom === 'vermelho', 'VENDIDO: conta de R$ 2.850 vencendo hoje e alerta "pague agora"', { s: c1v.status, conta: contaVenda, alerta: c1v.alerta });
  const compra1 = await adm.get(`/compras/${c1.compra.id}`);
  verifica(compra1.situacao?.nome === 'Vendido' && !compra1.parcelas.some((p: any) => p.contaPagar), 'compra "Vendido" sem conta a pagar duplicada', compra1.parcelas);
  const cpCompra = await adm.get(`/contas-pagar?origemTipo=COMPRA&origemId=${c1.compra.id}`);
  verifica(((cpCompra.data ?? cpCompra) as any[]).filter((x) => x.situacao !== 'CANCELADO').length === 0, 'nenhuma conta a pagar da compra (o pagamento é da consignação)');
  const avisos = await adm.get('/avisos');
  verifica(avisos.avisos.some((a: any) => /Consignado vendido/.test(a.mensagem)), 'avisos do gestor: consignado vendido para pagar', avisos.avisos);
  const pg = await adm.post(`/consignacoes/${c1.id}/pagar`, { contaFinanceiraId: banco.id, data: hoje() }, 200);
  verifica(igual(pg.saldo, 0) && igual(pg.pago, 2850) && pg.quitadoEm, 'pagou R$ 2.850: consignante quitado', { s: pg.saldo, p: pg.pago, q: pg.quitadoEm });
  const v2Vit = await adm.get('/publico/consignados');
  verifica(!v2Vit.data.some((x: any) => x.numero === c1.numero), 'vendido sai da vitrine do site');

  secao('Venda estornada antes de pagar → volta para o prazo');
  const c2 = await adm.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'CELULAR', descricao: `iPhone 13 ${SUF}`, imei: `35${SUF}11`, precoVenda: 2500, assinadoNaLoja: true }, 201);
  const v2 = await adm.post('/vendas', { contatoId: cliente.id, data: hoje(), itens: [{ produtoId: c2.produto.id, quantidade: 1, valorUnitario: 2500 }], parcelas: [{ dataVencimento: hoje(), valor: 2500, formaPagamentoId: pix.id }] }, 201);
  const fz2 = await adm.get(`/vendas/${v2.id}/finalizacao`);
  await adm.post(`/vendas/${v2.id}/finalizar`, { recebimentos: [{ parcelaId: fz2.parcelas[0].id, recebido: false }] }, 200);
  verifica((await adm.get(`/consignacoes/${c2.id}`)).status === 'VENDIDO', 'vendido');
  const crs = await adm.get(`/contas-receber?origemTipo=VENDA&origemId=${v2.id}`);
  for (const cr of (crs.data ?? crs) as any[]) if (cr.situacao === 'RECEBIDO') await adm.post(`/contas-receber/${cr.id}/estornar`, {}, [200, 201]);
  await adm.post(`/vendas/${v2.id}/situacao`, { situacaoId: cancelada }, 200);
  const c2b = await adm.get(`/consignacoes/${c2.id}`);
  verifica(c2b.status === 'NO_PRAZO' && c2b.estoque === 1 && !c2b.contasPagar.some((x: any) => x.situacao !== 'CANCELADO'), 'estorno: voltou para o prazo, estoque 1 e a conta do consignante cancelada', { s: c2b.status, e: c2b.estoque, c: c2b.contasPagar });

  secao('Passou do prazo → diárias de 5% em dias úteis');
  const c3 = await adm.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'PC_GAMER', descricao: `PC Gamer RTX ${SUF}`, precoVenda: 5000, dataEntrada: diasAtras(13), assinadoNaLoja: true }, 201);
  const robo = await adm.post('/consignacoes/robo', {}, 200);
  verifica(robo.diariasIniciadas >= 1, 'robô iniciou as diárias', robo);
  const c3d = await adm.get(`/consignacoes/${c3.id}`);
  const diarias = c3d.contasPagar.filter((x: any) => x.parcela?.includes('/'));
  const primeira = proximoDiaUtil(new Date(c3d.dataLimite));
  verifica(c3d.status === 'EM_DIARIAS' && diarias.length === 20 && diarias.every((x: any) => igual(x.valor, 200)), 'EM_DIARIAS: 20 diárias de R$ 200 (5% de R$ 4.000)', { s: c3d.status, n: diarias.length, v: diarias[0]?.valor });
  verifica(new Date(diarias[0].vencimento).toDateString() === primeira.toDateString() && diarias.every((x: any) => ehDiaUtil(new Date(x.vencimento))), 'começam no 1º dia útil depois do prazo e só caem em dia útil', { primeira: diarias[0].vencimento, esperado: primeira });
  const msgPrazo = ((await adm.get(`/notificacoes?origemTipo=CONSIGNACAO&origemId=${c3.id}`)).data as any[]).find((n) => /prazo de 10 dias/.test(n.corpo));
  verifica(msgPrazo && /R\$ 200,00 por dia útil/.test(msgPrazo.corpo) && /retirar/.test(msgPrazo.corpo), 'WhatsApp do fim do prazo com a diária e a opção de retirar', msgPrazo?.corpo);
  const painel = await adm.get('/consignacoes/painel');
  verifica(painel.pagarAgora.some((x: any) => x.id === c3.id && x.valor >= 200), 'painel: diária(s) para pagar hoje', painel.pagarAgora);
  const pg3 = await adm.post(`/consignacoes/${c3.id}/pagar`, { contaFinanceiraId: banco.id, data: hoje() }, 200);
  verifica(pg3.pago >= 200 && igual(pg3.atrasado, 0) && igual(pg3.devidoHoje, 0), 'pagou o que vencia até hoje', { p: pg3.pago, a: pg3.atrasado });

  secao('Vendeu durante as diárias → painel sugere quitar o saldo');
  const v3 = await adm.post('/vendas', { contatoId: cliente.id, data: hoje(), itens: [{ produtoId: c3.produto.id, quantidade: 1, valorUnitario: 5000 }], parcelas: [{ dataVencimento: hoje(), valor: 5000, formaPagamentoId: pix.id }] }, 201);
  const fz3 = await adm.get(`/vendas/${v3.id}/finalizacao`);
  await adm.post(`/vendas/${v3.id}/finalizar`, { recebimentos: [{ parcelaId: fz3.parcelas[0].id, recebido: false }] }, 200);
  const c3v = await adm.get(`/consignacoes/${c3.id}`);
  verifica(c3v.status === 'VENDIDO' && c3v.vendidoEmDiarias && c3v.alerta?.texto.includes('quitar'), 'VENDIDO nas diárias, alerta sugere quitar', { s: c3v.status, d: c3v.vendidoEmDiarias, a: c3v.alerta });
  const painel2 = await adm.get('/consignacoes/painel');
  verifica(painel2.sugestoesQuitar.some((x: any) => x.id === c3.id && igual(x.saldo, c3v.saldo)), 'painel: sugestão de quitar com o saldo', painel2.sugestoesQuitar);
  const q3 = await adm.post(`/consignacoes/${c3.id}/quitar`, { contaFinanceiraId: banco.id, data: hoje() }, 200);
  verifica(igual(q3.saldo, 0) && igual(q3.pago, 4000) && q3.quitadoEm, 'quitou: R$ 4.000 pagos no total', { s: q3.saldo, p: q3.pago });

  secao('Pagou todas as diárias sem vender → QUITADO, vira estoque próprio');
  const c4 = await adm.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'GAMES', descricao: `PS5 ${SUF}`, precoVenda: 1000, dataEntrada: diasAtras(11), assinadoNaLoja: true }, 201);
  await adm.post('/consignacoes/robo', {}, 200);
  const c4d = await adm.get(`/consignacoes/${c4.id}`);
  verifica(c4d.status === 'EM_DIARIAS' && c4d.diariasTotal === 8, 'R$ 800 → 8 diárias de R$ 100 (mínimo)', { s: c4d.status, n: c4d.diariasTotal });
  const q4 = await adm.post(`/consignacoes/${c4.id}/pagar`, { contaFinanceiraId: banco.id, data: hoje(), tudo: true }, 200);
  verifica(q4.status === 'QUITADO' && igual(q4.pago, 800) && q4.estoque === 1, 'QUITADO: R$ 800 pagos e o PS5 fica no estoque', { s: q4.status, p: q4.pago, e: q4.estoque });
  verifica((await adm.get(`/compras/${c4.compra.id}`)).situacao?.nome === 'Fechado', 'compra passa para "Fechado" (estoque próprio)');
  verifica(!(await adm.get('/publico/consignados')).data.some((x: any) => x.numero === c4.numero), 'quitado sai da vitrine de consignados');

  secao('Retirada: antes do prazo paga R$ 100; depois do prazo, sem taxa');
  const c5 = await vend.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'TABLET', descricao: `iPad 9 ${SUF}`, precoVenda: 1500 }, 201);
  await vend.post(`/consignacoes/${c5.id}/retirada`, { isentarTaxa: true }, 403);
  const r5 = await vend.post(`/consignacoes/${c5.id}/retirada`, { recebido: true, contaFinanceiraId: banco.id }, 200);
  verifica(r5.status === 'RETIRADO' && r5.estoque === 0 && r5.contasReceber.some((x: any) => igual(x.valor, 100) && x.situacao === 'RECEBIDO'), 'retirada antes do prazo: taxa de R$ 100 recebida, estoque zerado', { s: r5.status, e: r5.estoque, cr: r5.contasReceber });
  const c6 = await adm.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'MONITOR', descricao: `Monitor 27 ${SUF}`, precoVenda: 1200, dataEntrada: diasAtras(12) }, 201);
  await adm.post('/consignacoes/robo', {}, 200);
  const tok6 = (await adm.get(`/consignacoes/${c6.id}`)).link.split('/').pop();
  const esc = await adm.post(`/publico/consignacao/${tok6}/escolha`, { escolha: 'RETIRAR' }, 200);
  verifica(esc.consignacao.status === 'AGUARDANDO_RETIRADA', 'consignante escolheu retirar pelo link', esc.consignacao.status);
  const c6d = await adm.get(`/consignacoes/${c6.id}`);
  verifica(c6d.contasPagar.every((x: any) => x.situacao === 'CANCELADO'), 'as diárias sem pagamento foram canceladas', c6d.contasPagar.map((x: any) => x.situacao));
  const r6 = await adm.post(`/consignacoes/${c6.id}/retirada`, {}, 200);
  verifica(r6.status === 'RETIRADO' && !r6.contasReceber.length, 'retirada depois do prazo: sem taxa', r6.contasReceber);
  const p6 = await adm.get(`/produtos/${c6.produto.id}`);
  verifica(p6.ativo === false, 'produto do consignado retirado fica inativo');

  secao('Robô pede desconto nos primeiros dias (enquanto não vende)');
  const c7 = await adm.post('/consignacoes', { consignanteId: c1.consignanteId, tipoEquipamento: 'NOTEBOOK', descricao: `Dell Inspiron ${SUF}`, precoVenda: 2000, dataEntrada: diasAtras(4), assinadoNaLoja: true }, 201);
  await adm.post('/consignacoes/robo', {}, 200);
  const c7d = await adm.get(`/consignacoes/${c7.id}`);
  verifica(c7d.descontoPendente && c7d.descontoPendente.origem === 'ROBO' && igual(c7d.descontoPendente.pct, 5), 'pedido de 5% feito pelo robô', c7d.descontoPendente);
  await adm.post('/consignacoes/robo', {}, 200);
  verifica((await adm.get(`/consignacoes/${c7.id}`)).descontos.length === 1, 'não repete o pedido na volta seguinte');
  const tok7 = c7d.link.split('/').pop();
  const rec = await adm.post(`/publico/consignacao/${tok7}/desconto/${c7d.descontoPendente.id}`, { autorizar: false }, 200);
  verifica(rec.status === 'RECUSADO' && igual(rec.consignacao.precoVenda, 2000), 'recusado: preço continua o mesmo', rec.consignacao.precoVenda);

  secao('Cancelar (lançado por engano) e contrato na loja');
  await vend.post(`/consignacoes/${c7.id}/cancelar`, {}, 403);
  const cc = await adm.post(`/consignacoes/${c7.id}/cancelar`, {}, 200);
  verifica(cc.status === 'CANCELADO' && cc.estoque === 0, 'cancelada: estoque estornado', { s: cc.status, e: cc.estoque });
  const html = await fetch(`${BASE}/consignacoes/${c2.id}/contrato`, { headers: { authorization: `Bearer ${vend.token}` } }).then((x) => x.text());
  verifica(html.includes(`nº ${c2.numero}`) && html.includes('Assinado na loja'), 'contrato impresso na loja');
  await adm.get('/publico/consignacao/000000000000000000000000', 404);
  await adm.get('/publico/consignacao/nao-e-token', 400);

  secao('Dashboard de consignação');
  const dash: any = await adm.get('/consignacoes/dashboard');
  verifica(dash && dash.estoque && dash.vendas && dash.total && Array.isArray(dash.serie) && dash.serie.length === 12, 'dashboard responde com estoque, vendas, totais e 12 meses', dash && Object.keys(dash));
  verifica(igual(dash.estoque.lucroPotencial, dash.estoque.valorVenda - dash.estoque.custo), 'lucro possível = valor em estoque − custo dos consignantes', dash.estoque);
  verifica(dash.total.contratos >= 1, 'conta os contratos criados no teste', dash.total);

  encerrar('Consignação');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
