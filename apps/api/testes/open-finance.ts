/**
 * OPEN FINANCE POR CONTA FINANCEIRA
 * - o token do widget sai do servidor e a resposta não traz o client secret
 * - vincular grava o item na conta que já existe (não cria outra) e a sincronização preenche status e data
 * - a mesma conta do banco não pode ir para duas contas financeiras
 * - reconectar só aceita um item que já está numa conta da loja
 * - desconectar limpa o vínculo
 * - vendedor não abre o widget; financeiro sincroniza, mas não desconecta
 *   npx tsx testes/open-finance.ts http://localhost:3333
 */
import { encerrar, entrar, secao, SUF, verifica } from './lib.js';

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const senha = 'Senha@Of123';
  const emailVend = `of-vend-${SUF}@teste.com`;
  const emailFin = `of-fin-${SUF}@teste.com`;
  await adm.post('/usuarios', { nome: `Vend OF ${SUF}`, email: emailVend, senha, perfil: 'VENDEDOR' }, 201);
  await adm.post('/usuarios', { nome: `Fin OF ${SUF}`, email: emailFin, senha, perfil: 'FINANCEIRO' }, 201);
  const vend = await entrar(emailVend, senha);
  const fin = await entrar(emailFin, senha);

  secao('Token do widget não devolve segredo');
  const segredo = `segredo-of-${SUF}`;
  const clientId = `client-of-${SUF}`;
  await adm.put('/empresa', { openFinanceClientId: clientId, openFinanceClientSecret: segredo, openFinanceAtivo: false }, 200);
  const statusAntes: any = await adm.get('/open-finance/status');
  verifica(statusAntes.configurado === true && statusAntes.ativo === false, 'credencial gravada, integração ainda inativa (não chama a Pluggy)', { configurado: statusAntes.configurado, ativo: statusAntes.ativo });
  verifica(!JSON.stringify(statusAntes).includes(segredo), 'o status não devolve o client secret');
  const tok: any = await adm.post('/open-finance/connect-token', {});
  verifica(typeof tok.accessToken === 'string' && tok.accessToken.length > 0 && tok.provedor === 'mock', 'connect-token devolve só o access token do provedor simulado', { provedor: tok.provedor, temToken: !!tok.accessToken });
  verifica(!JSON.stringify(tok).includes(segredo) && !('clientSecret' in tok) && !('openFinanceClientSecret' in tok), 'a resposta do token não contém o client secret');
  await adm.post('/open-finance/connect-token', { itemId: `item-inexistente-${SUF}` }, 404);

  secao('Vincular a conta que já existe, sincronizar e impedir duplicidade');
  const nubank = await adm.post('/contas-financeiras', { nome: `Nubank OF ${SUF}`, tipo: 'BANCO', banco: 'Nubank', saldoInicial: 0, ativo: true }, [200, 201]);
  const cora = await adm.post('/contas-financeiras', { nome: `Cora OF ${SUF}`, tipo: 'BANCO', banco: 'Cora', saldoInicial: 0, ativo: true }, [200, 201]);
  const itemId = `item-of-${SUF}`;
  const contasItem: any[] = await adm.get(`/open-finance/itens/${itemId}/contas`);
  verifica(contasItem.length >= 2 && contasItem.every((c) => c.id && typeof c.saldo === 'number'), 'a conexão lista as contas do banco sem gravar vínculo', contasItem.map((c) => c.id));
  const alvo = contasItem[0];
  const vinc: any[] = await adm.post('/open-finance/vincular', { itemId, contaFinanceiraId: nubank.id, accountId: alvo.id }, 200);
  verifica(vinc.length === 1 && vinc[0].contaFinanceiraId === nubank.id && vinc[0].nova === false, 'o vínculo fica na conta Nubank já cadastrada, sem criar outra', vinc);
  const lista: any[] = await adm.get('/contas-financeiras?ativo=true');
  const gravada = (Array.isArray(lista) ? lista : []).find((c) => c.id === nubank.id);
  verifica(gravada?.openFinanceItemId === itemId && gravada?.openFinanceAccountId === alvo.id && gravada?.openFinanceStatus === 'VINCULADA', 'openFinanceItemId gravado na conta', { item: gravada?.openFinanceItemId, status: gravada?.openFinanceStatus });
  const statusMeio: any = await adm.get('/open-finance/status');
  verifica((statusMeio.contasVinculadas || []).some((c: any) => c.id === nubank.id), 'status lista a conta em contasVinculadas');
  await adm.post('/open-finance/vincular', { itemId, contaFinanceiraId: cora.id, accountId: alvo.id }, 409);

  const sync: any = await adm.post(`/open-finance/sincronizar/${nubank.id}`, {}, 200);
  verifica(typeof sync.saldo === 'number' && typeof sync.novasTransacoes === 'number' && sync.novasTransacoes > 0, 'sincronizar traz saldo e transações', { saldo: sync.saldo, novas: sync.novasTransacoes });
  const depois: any[] = await adm.get('/contas-financeiras?ativo=true');
  const sinc = depois.find((c) => c.id === nubank.id);
  verifica(sinc?.openFinanceStatus === 'UPDATED' && !!sinc?.ultimaSincronizacao, 'status conectado e última sincronização preenchida', { status: sinc?.openFinanceStatus, sync: !!sinc?.ultimaSincronizacao });

  secao('Reconectar a mesma conexão e desconectar');
  const tok2: any = await adm.post('/open-finance/connect-token', { itemId }, 200);
  verifica(typeof tok2.accessToken === 'string' && !JSON.stringify(tok2).includes(segredo), 'reconectar devolve outro token, ainda sem o segredo');
  await fin.post(`/open-finance/sincronizar/${nubank.id}`, {}, 200);
  await fin.del(`/open-finance/desvincular/${nubank.id}`, 403);
  await vend.post('/open-finance/connect-token', {}, 403);
  await vend.get(`/open-finance/itens/${itemId}/contas`, 403);
  await adm.del(`/open-finance/desvincular/${nubank.id}`, 200);
  const limpa: any[] = await adm.get('/contas-financeiras?ativo=true');
  const solta = limpa.find((c) => c.id === nubank.id);
  verifica(!solta?.openFinanceItemId && !solta?.openFinanceAccountId && !solta?.openFinanceStatus, 'desconectar apaga item, conta do banco e status', { item: solta?.openFinanceItemId, status: solta?.openFinanceStatus });
  const statusFim: any = await adm.get('/open-finance/status');
  verifica(!(statusFim.contasVinculadas || []).some((c: any) => c.id === nubank.id), 'contasVinculadas fica sem essa conta');

  await adm.put('/empresa', { openFinanceClientId: null, openFinanceAtivo: false }, 200);
  encerrar('Open Finance por conta');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
