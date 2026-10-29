/**
 * JARVIS — agente do gestor (29/10/2026, docs/JARVIS.md)
 * - Caixa livre = bancos + caixa − a pagar 30 dias − caixinhas − empréstimos.
 * - Rodada cria sugestões; aceitar/adiar/recusar mudam a situação e não repetem.
 * - Feed por perfil: vendedor vê só o que é dele e nunca vê valor em R$; o painel é só do ADMIN.
 *   npx tsx testes/jarvis.ts http://localhost:3333
 */
import { encerrar, entrar, igual, secao, SUF, verifica } from './lib.js';

const daqui = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  secao('Configuração: meta de R$ 1.000.000 e as regras de usado do Thiago');
  const cfg = await adm.get('/jarvis/config');
  verifica(igual(cfg.metaCaixa, 1_000_000), 'meta começa em R$ 1.000.000', cfg.metaCaixa);
  verifica(
    cfg.percCompraRegular === 30 && cfg.percCompraBom === 50 && cfg.percCompraLacrado === 75 && cfg.percVendaUsado === 70,
    'usado: compra 30/50/75% do novo e venda a 70%',
    cfg,
  );
  verifica(cfg.temChave === false && !('chaveAnthropic' in cfg), 'a chave da IA nunca sai do servidor', Object.keys(cfg));

  secao('A chave da IA é guardada criptografada e só volta mascarada');
  const salvo = await adm.put('/jarvis/config', { chaveAnthropic: 'sk-ant-teste-1234567890-chave-falsa' });
  verifica(salvo.temChave === true && !!salvo.chaveMascarada && !salvo.chaveMascarada.includes('1234567890'), 'volta só a máscara', salvo.chaveMascarada);
  const cfg2 = await adm.get('/jarvis/config');
  verifica(cfg2.temChave === true, 'chave continua cadastrada', cfg2.temChave);
  // string vazia não apaga a chave que já existe
  await adm.put('/jarvis/config', { chaveAnthropic: '' });
  const cfg3 = await adm.get('/jarvis/config');
  verifica(cfg3.temChave === true, 'campo vazio não apaga a chave cadastrada', cfg3.temChave);

  secao('Caixa livre: bancos + caixa − a pagar 30 dias − caixinhas − empréstimos');
  const banco = await adm.post('/contas-financeiras', { nome: `JARVIS Banco ${SUF}`, tipo: 'BANCO', saldoInicial: 50_000, padrao: false, ativo: true }, [200, 201]);
  const antes = await adm.get('/jarvis/painel');

  // uma conta a pagar que vence em 10 dias tira do caixa livre
  await adm.post('/contas-pagar', { descricao: `Fornecedor JARVIS ${SUF}`, valor: 5_000, vencimento: daqui(10) }, [200, 201]);
  const depois = await adm.get('/jarvis/painel');
  verifica(
    igual(depois.aPagar30d - antes.aPagar30d, 5_000) && igual(antes.caixaLivre - depois.caixaLivre, 5_000),
    'conta a pagar de 5.000 em 10 dias baixa o caixa livre em 5.000',
    { antes: antes.caixaLivre, depois: depois.caixaLivre, aPagar: depois.aPagar30d },
  );

  // conta que vence daqui a 90 dias não entra na conta
  await adm.post('/contas-pagar', { descricao: `Longe ${SUF}`, valor: 9_999, vencimento: daqui(90) }, [200, 201]);
  const longe = await adm.get('/jarvis/painel');
  verifica(igual(longe.aPagar30d, depois.aPagar30d), 'conta para daqui a 90 dias fica de fora dos 30 dias', longe.aPagar30d);

  // caixinha nova e em dia NÃO tira do caixa livre (só o que já deveria estar guardado entra)
  await adm.post('/caixinhas', { nome: `JARVIS 13º ${SUF}`, valorMeta: 3_000, dataUso: daqui(20), contaFinanceiraId: banco.id }, 201);
  const comCaixinha = await adm.get('/jarvis/painel');
  verifica(
    igual(comCaixinha.caixaLivre, longe.caixaLivre),
    'caixinha nova, dentro do ritmo, não mexe no caixa livre de hoje',
    { antes: longe.caixaLivre, depois: comCaixinha.caixaLivre, atrasadas: comCaixinha.caixinhasDevidas },
  );
  verifica(
    igual(comCaixinha.caixinhasFuturas - longe.caixinhasFuturas, 3_000),
    'mas os 3.000 aparecem como compromisso para depois',
    { futuras: comCaixinha.caixinhasFuturas },
  );
  verifica(
    igual(longe.compromissosTotais - comCaixinha.compromissosTotais, 3_000),
    'e entram nos compromissos totais',
    { antes: longe.compromissosTotais, depois: comCaixinha.compromissosTotais },
  );

  // caixinha vencendo amanhã e sem nada guardado está atrasada: essa sim sai do caixa livre
  const antesAtrasada = await adm.get('/jarvis/painel');
  await adm.post('/caixinhas', { nome: `JARVIS IPTU ${SUF}`, valorMeta: 1_000, dataUso: daqui(1), contaFinanceiraId: banco.id }, 201);
  const comAtrasada = await adm.get('/jarvis/painel');
  verifica(
    comAtrasada.caixaLivre < antesAtrasada.caixaLivre,
    'caixinha que vence amanhã e está vazia baixa o caixa livre',
    { antes: antesAtrasada.caixaLivre, depois: comAtrasada.caixaLivre, atrasadas: comAtrasada.caixinhasDevidas },
  );

  secao('Mapa do milhão: falta e ritmo por dia útil');
  verifica(
    igual(comCaixinha.falta, Math.max(0, comCaixinha.meta - comCaixinha.caixaLivre)) && comCaixinha.diasUteis > 0 && comCaixinha.porDiaUtil > 0,
    'falta e ritmo por dia útil calculados',
    { falta: comCaixinha.falta, diasUteis: comCaixinha.diasUteis, porDiaUtil: comCaixinha.porDiaUtil },
  );

  secao('Rodada: o JARVIS olha a loja e abre sugestões');
  const r = await adm.post('/jarvis/rodar', {});
  verifica(typeof r.caixaLivre === 'number' && typeof r.novas === 'number', 'rodada devolve o caixa livre e quantas sugestões abriu', r);

  const painel = await adm.get('/jarvis/painel');
  verifica(Array.isArray(painel.sugestoes) && painel.sugestoes.length > 0, 'o painel tem sugestões abertas', painel.sugestoes?.length);
  const mapa = painel.sugestoes.find((s: any) => s.regra === 'MAPA_MILHAO');
  verifica(!!mapa, 'o mapa do milhão aparece todo dia', mapa?.titulo);

  secao('Caixa livre: curto prazo e compromissos totais são leituras diferentes');
  verifica(
    typeof comCaixinha.compromissosTotais === 'number' && comCaixinha.compromissosTotais <= comCaixinha.caixaLivre,
    'compromissos totais nunca passam do caixa livre (eles descontam o que vem depois)',
    { caixaLivre: comCaixinha.caixaLivre, totais: comCaixinha.compromissosTotais },
  );

  secao('Cobrar por WhatsApp: aceitar a sugestão enfileira a cobrança de verdade');
  const painelC = await adm.get('/jarvis/painel');
  const cobranca = painelC.sugestoes.find((x: any) => x.acao === 'COBRAR_WHATSAPP');
  if (cobranca) {
    const antesFila = await adm.get('/notificacoes?limite=1');
    const r2 = await adm.post(`/jarvis/sugestoes/${cobranca.id}/aceitar`, {});
    verifica(typeof r2.feito === 'string' && r2.feito.length > 0, 'o JARVIS conta o que fez ao aceitar', r2.feito);
    const depoisFila = await adm.get('/notificacoes?limite=50&canal=WHATSAPP');
    const lista = depoisFila?.data ?? depoisFila;
    verifica(Array.isArray(lista) && lista.length > 0, 'há cobrança na fila de notificações', Array.isArray(lista) ? lista.length : lista);
    void antesFila;
  }

  secao('Rodar de novo não duplica a mesma sugestão');
  const quantasAntes = painel.sugestoes.length;
  await adm.post('/jarvis/rodar', {});
  const painel2 = await adm.get('/jarvis/painel');
  verifica(painel2.sugestoes.length === quantasAntes, 'a segunda rodada não repete o que já está aberto', {
    antes: quantasAntes,
    depois: painel2.sugestoes.length,
  });

  secao('Aceitar, adiar e recusar');
  // pega sugestões sem ação executável, para testar só a mudança de situação
  const semAcao = painel2.sugestoes.filter((x: any) => !x.acao || x.acao === 'NENHUMA' || x.acao === 'ABRIR_TELA');
  const alvo = semAcao[0] ?? painel2.sugestoes[0];
  const aceita = await adm.post(`/jarvis/sugestoes/${alvo.id}/aceitar`, {});
  verifica(aceita.situacao === 'ACEITA', 'sugestão aceita', aceita.situacao);
  await adm.post(`/jarvis/sugestoes/${alvo.id}/aceitar`, {}, 422); // não decide duas vezes

  const outra = semAcao[1] ?? painel2.sugestoes[1];
  if (outra) {
    const adiada = await adm.post(`/jarvis/sugestoes/${outra.id}/adiar`, { dias: 5 });
    verifica(adiada.situacao === 'ADIADA' && !!adiada.adiadaAte, 'sugestão adiada por 5 dias', adiada.adiadaAte);
    const painel3 = await adm.get('/jarvis/painel');
    verifica(!painel3.sugestoes.some((s: any) => s.id === outra.id), 'adiada some do painel', painel3.sugestoes.length);
  }

  const terceira = semAcao[2] ?? painel2.sugestoes[2];
  if (terceira) {
    const recusada = await adm.post(`/jarvis/sugestoes/${terceira.id}/recusar`, { motivo: 'não quero agora' });
    verifica(recusada.situacao === 'RECUSADA', 'sugestão recusada', recusada.situacao);
    await adm.post('/jarvis/rodar', {});
    const painel4 = await adm.get('/jarvis/painel');
    verifica(!painel4.sugestoes.some((s: any) => s.chave === terceira.chave), 'recusada não volta na rodada seguinte', terceira.chave);
  }

  secao('Placar do JARVIS');
  const placar = await adm.get('/jarvis/placar');
  verifica(placar.aceitas >= 1 && typeof placar.estimado === 'number', 'o placar conta as aceitas', placar);

  secao('Modo pergunta sem chave boa responde com erro claro, não com 500');
  await adm.post('/jarvis/perguntar', { pergunta: 'O que faço com o dinheiro de hoje?' }, 422);
  await adm.post('/jarvis/perguntar', { pergunta: 'oi' }, 400); // pergunta curta demais

  secao('Perfis: o painel é só do ADMIN; o feed é de todo mundo');
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend JARVIS ${SUF}`, email: `vjarvis${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  const vend = await entrar(`vjarvis${SUF}@teste.com`, senha).catch(() => null);
  if (vend) {
    vend.nome = 'VENDEDOR';
    await vend.get('/jarvis/painel', 403);
    await vend.get('/jarvis/config', 403);
    await vend.post('/jarvis/rodar', {}, 403);
    const feed = await vend.get('/jarvis/feed');
    verifica(Array.isArray(feed.data), 'o vendedor recebe o próprio feed', feed.data?.length);
    verifica(
      (feed.data ?? []).every((s: any) => s.impactoEstimado === null),
      'o vendedor nunca vê valor em R$ nas sugestões',
      feed.data,
    );
  }

  const admFeed = await adm.get('/jarvis/feed');
  verifica(Array.isArray(admFeed.data), 'o ADMIN também tem feed', admFeed.data?.length);

  secao('Evolução do caixa livre');
  const evo = await adm.get('/jarvis/evolucao');
  verifica(Array.isArray(evo.serie) && evo.serie.length > 0, 'a série do gráfico tem pelo menos a medição de hoje', evo.serie?.length);

  encerrar('JARVIS');
}

main();
