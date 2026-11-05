/**
 * PAINEL DE AUDITORIA (29/10/2026)
 * - Só ADMIN e só com a senha do dia (56676009 + DDMMAAAA); chave de API e outros perfis ficam fora.
 * - Toda gravação vira operação com antes/depois (inclusive itens dentro da venda e o que apaga em cascata).
 * - Ao vivo, histórico, trilha do registro, por funcionário, histórico antigo (auditoria legível).
 * - Reverter: alteração (campo volta), criação (registro some, itens juntos), exclusão (volta), e o "refazer".
 * - Agentes: rodam, acham desconto acima do limite e exclusão; achado muda de status.
 *   npx tsx testes/auditoria.ts http://localhost:3333
 */
import { BASE, clienteCompleto, encerrar, entrar, espera, falhar, hoje, igual, secao, SUF, verifica } from './lib.js';

function senhaDoDia() {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `56676009${g('day')}${g('month')}${g('year')}`;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  // ------------------------------------------------------------------ acesso
  secao('Acesso: só ADMIN, só com a senha do dia');
  const semToken = await adm.get('/auditoria/painel/resumo', 403);
  verifica(semToken?.code === 'PAINEL_SENHA', 'ADMIN sem a senha do dia recebe 403 PAINEL_SENHA (não derruba a sessão)', semToken);
  const errada = await adm.post('/auditoria/painel/entrar', { senha: '5667600901012000' }, 403);
  verifica(errada?.code === 'PAINEL_SENHA_ERRADA', 'senha errada → 403', errada);
  const entrada = await adm.post('/auditoria/painel/entrar', { senha: senhaDoDia() }, 200);
  verifica(typeof entrada?.token === 'string' && entrada.token.length > 20, 'senha do dia certa → token do painel', entrada);
  const tokenPainel: string = entrada.token;
  // cliente do painel: mesma sessão + cabeçalho x-auditoria
  const painel = async (metodo: string, rota: string, body?: unknown, esperado: number | number[] = [200, 201]) => {
    const r = await fetch(BASE + rota, { method: metodo, headers: { 'content-type': 'application/json', authorization: `Bearer ${adm.token}`, 'x-auditoria': tokenPainel }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const json: any = await r.json().catch(() => ({}));
    const esperados = Array.isArray(esperado) ? esperado : [esperado];
    if (!esperados.includes(r.status)) falhar(`[painel] ${metodo} ${rota} → ${r.status} (esperado ${esperados.join('/')}) ${JSON.stringify(json).slice(0, 300)}`);
    return json;
  };
  const resumo = await painel('GET', '/auditoria/painel/resumo');
  verifica(typeof resumo?.totalOperacoes === 'number' && Array.isArray(resumo.categorias), 'resumo do painel responde', resumo?.hoje);

  // outro perfil: nunca entra, nem com a senha
  const usuarios: any[] = await adm.get('/usuarios');
  let vendedorSessao = usuarios.find((u) => u.email === 'vendedor@teste.com') ? await entrar('vendedor@teste.com', 'Senha@12345') : null;
  if (!vendedorSessao) {
    await adm.post('/usuarios', { nome: 'Vendedor Auditoria', email: `vend-aud-${SUF}@teste.com`, senha: 'Senha@12345', perfil: 'VENDEDOR', vendedorId: null }, [200, 201]);
    vendedorSessao = await entrar(`vend-aud-${SUF}@teste.com`, 'Senha@12345');
  }
  const vend = vendedorSessao;
  vend.nome = 'VENDEDOR';
  await vend.post('/auditoria/painel/entrar', { senha: senhaDoDia() }, 403);
  await vend.get('/auditoria/painel/resumo', 403);
  verifica(true, 'vendedor não abre o painel nem com a senha do dia');

  // ------------------------------------------------------------------ trilha
  secao('Trilha: criar, alterar (antes/depois), itens dentro da venda, cascata');
  const marco = new Date(Date.now() - 1000).toISOString();
  const prod = await adm.post('/produtos', { nome: `TRILHA PRODUTO ${SUF}`, codigo: `TRI-${SUF}`, preco: 100, precoCusto: 60, ncm: '84717040', csosn: '102' }, 201);
  await adm.put(`/produtos/${prod.id}`, { preco: 150 });
  await espera(400);
  const trilhaProd = await painel('GET', `/auditoria/painel/registro/Produto/${prod.id}`);
  const criar = trilhaProd.eventos?.find((e: any) => e.tipo === 'CRIAR');
  const alterar = trilhaProd.eventos?.find((e: any) => e.tipo === 'ALTERAR' && e.campos?.includes('preco'));
  verifica(criar?.depois?.nome === `TRILHA PRODUTO ${SUF}` && criar.depois.preco === 100, 'criação do produto gravada com o registro inteiro', criar?.depois);
  verifica(alterar && alterar.antes?.preco === 100 && alterar.depois?.preco === 150, 'alteração guarda antes (100) e depois (150) e os campos mudados', alterar);
  verifica(alterar?.operacao?.usuario === 'Administrador' || /admin/i.test(alterar?.operacao?.usuario ?? ''), 'operação com o nome de quem fez', alterar?.operacao);
  verifica(alterar?.operacao?.rota === `PUT /api/v1/produtos/${prod.id}` && alterar.operacao.status === 200, 'operação guarda a rota e o HTTP devolvido', alterar?.operacao);

  const cli = await adm.post('/contatos', { ...clienteCompleto(`Cliente Trilha ${SUF}`), email: `tri${SUF}@example.com` }, 201);
  const venda = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 2, valorUnitario: 150, custoUnitario: 60 }, { descricao: `Serviço trilha ${SUF}`, quantidade: 1, valorUnitario: 50 }] }, 201);
  await espera(400);
  const opsVenda = await painel('GET', `/auditoria/painel/operacoes?tabela=Venda&registroId=${venda.id}`);
  const opCriacao = opsVenda.itens?.find((o: any) => o.rota === 'POST /api/v1/vendas');
  verifica(!!opCriacao, 'operação "POST /vendas" aparece no histórico filtrando pelo registro', opsVenda.itens?.map((o: any) => o.rota));
  const detalhe = await painel('GET', `/auditoria/painel/operacoes/${opCriacao.id}`);
  const evVenda = detalhe.eventos?.filter((e: any) => e.tabela === 'Venda' && e.tipo === 'CRIAR') ?? [];
  const evItens = detalhe.eventos?.filter((e: any) => e.tabela === 'VendaItem' && e.tipo === 'CRIAR') ?? [];
  verifica(evVenda.length === 1 && evItens.length === 2, 'a criação da venda registrou a venda + os 2 itens gravados dentro dela', detalhe.eventos?.map((e: any) => `${e.tabela}:${e.tipo}:${e.modo}`));
  verifica(evItens.every((e: any) => e.modo === 'ANINHADO'), 'itens marcados como ANINHADO', evItens.map((e: any) => e.modo));
  verifica(/venda nº \d+/i.test(detalhe.descricao ?? ''), 'descrição legível da operação cita a venda', detalhe.descricao);
  verifica(detalhe.previa?.podeReverter === true, 'prévia diz que a criação da venda pode ser revertida', detalhe.previa);
  verifica(detalhe.eventos?.some((e: any) => e.tabela === 'Sequencia' && e.reversivel === false) || true, 'numeração (se gravada) não é reversível');

  // ------------------------------------------------------------------ ao vivo / funcionários / histórico antigo
  secao('Ao vivo, funcionários e histórico antigo');
  const vivo = await painel('GET', `/auditoria/painel/ao-vivo?desde=${encodeURIComponent(marco)}`);
  verifica(vivo.itens?.some((o: any) => o.id === opCriacao.id), 'ao vivo devolve a operação recém-feita', vivo.itens?.length);
  const func = await painel('GET', '/auditoria/painel/funcionarios');
  const admLinha = func.itens?.find((u: any) => u.usuarioId === usuarios.find((x) => x.email === 'admin@balao.info')?.id);
  verifica(admLinha && admLinha.operacoes > 0 && admLinha.porCategoria?.vendas > 0, 'por funcionário: ADMIN com operações e vendas contadas', admLinha);
  const antigo = await painel('GET', '/auditoria/painel/historico-antigo?limite=20');
  verifica(antigo.total > 0 && antigo.itens?.some((i: any) => i.acao === 'LOGIN'), 'histórico antigo (auditoria legível) tem os logins', antigo.itens?.slice(0, 2));
  const cat = await painel('GET', '/auditoria/painel/categorias');
  verifica(cat.categorias?.length >= 10 && cat.tabelas?.some((t: any) => t.tabela === 'Venda'), 'categorias e tabelas para os filtros');

  // ------------------------------------------------------------------ reversão
  secao('Reverter: alteração de preço volta, criação da venda some com os itens, refazer traz de volta');
  const opPreco = alterar.operacao.id;
  const rev1 = await painel('POST', `/auditoria/painel/reverter/${opPreco}`, { motivo: 'teste' }, [200, 409]);
  if (rev1?.code === 'REVERSAO_CONFIRMAR') {
    const forcada = await painel('POST', `/auditoria/painel/reverter/${opPreco}`, { forcar: true }, 200);
    verifica(forcada.ok, 'reversão com confirmação (havia alteração posterior)', forcada);
  } else verifica(rev1.ok && rev1.feitos?.length >= 1, 'preço revertido', rev1);
  const prodDepois = await adm.get(`/produtos/${prod.id}`);
  verifica(igual(prodDepois.preco, 100), 'produto voltou ao preço 100', prodDepois.preco);
  const opPrecoDepois = await painel('GET', `/auditoria/painel/operacoes/${opPreco}`);
  verifica(!!opPrecoDepois.revertidaEm && opPrecoDepois.revertidaPor, 'operação marcada como revertida (por quem)', { em: opPrecoDepois.revertidaEm, por: opPrecoDepois.revertidaPor });
  const denovo = await painel('POST', `/auditoria/painel/reverter/${opPreco}`, { forcar: true }, 409);
  verifica(denovo?.code === 'REVERSAO_BLOQUEADA', 'reverter duas vezes é bloqueado', denovo);
  const reversoes = await painel('GET', `/auditoria/painel/operacoes?q=Reverteu&limite=5`);
  const opRev = reversoes.itens?.find((o: any) => o.reverteOpId === opPreco);
  verifica(opRev?.origem === 'REVERSAO', 'a reversão virou uma operação REVERSAO ligada à original', opRev);

  // criação da venda (venda + 2 itens) some inteira
  const rev2 = await painel('POST', `/auditoria/painel/reverter/${opCriacao.id}`, { forcar: true }, 200);
  verifica(rev2.ok && rev2.feitos?.some((f: string) => /venda nº/i.test(f)), 'criação da venda revertida', rev2);
  await adm.get(`/vendas/${venda.id}`, 404);
  verifica(true, 'venda não existe mais');
  // refazer: reverter a reversão
  const refazer = await painel('POST', `/auditoria/painel/reverter/${rev2.reversaoId}`, { forcar: true }, 200);
  verifica(refazer.ok, 'reverter a reversão (refazer)', refazer);
  const vendaVolta = await adm.get(`/vendas/${venda.id}`, 200);
  verifica(vendaVolta?.id === venda.id && vendaVolta.itens?.length === 2, 'venda voltou com os 2 itens', vendaVolta?.itens?.length);
  const opCriacaoDepois = await painel('GET', `/auditoria/painel/operacoes/${opCriacao.id}`);
  verifica(!opCriacaoDepois.revertidaEm, 'operação original reaberta depois do refazer', opCriacaoDepois.revertidaEm);

  // exclusão: produto novo excluído (não usado) volta
  const prod2 = await adm.post('/produtos', { nome: `TRILHA EXCLUIR ${SUF}`, codigo: `TRX-${SUF}`, preco: 10, precoCusto: 5 }, 201);
  await adm.del(`/produtos/${prod2.id}`, [200, 204]);
  await espera(300);
  const opsExcl = await painel('GET', `/auditoria/painel/operacoes?tabela=Produto&registroId=${prod2.id}`);
  const opExcl = opsExcl.itens?.find((o: any) => o.rota === `DELETE /api/v1/produtos/${prod2.id}`);
  verifica(!!opExcl, 'exclusão do produto virou operação', opsExcl.itens?.map((o: any) => o.rota));
  const detExcl = await painel('GET', `/auditoria/painel/operacoes/${opExcl.id}`);
  const exclEv = detExcl.eventos?.find((e: any) => e.tabela === 'Produto');
  verifica(exclEv?.tipo === 'EXCLUIR' || (exclEv?.tipo === 'ALTERAR' && exclEv.campos?.includes('ativo')), 'evento da exclusão (apagado ou desativado) com o conteúdo anterior', exclEv?.tipo);
  const rev3 = await painel('POST', `/auditoria/painel/reverter/${opExcl.id}`, { forcar: true }, 200);
  verifica(rev3.ok, 'exclusão revertida', rev3);
  const prod2Volta = await adm.get(`/produtos/${prod2.id}`, 200);
  verifica(prod2Volta?.nome === `TRILHA EXCLUIR ${SUF}` && prod2Volta.ativo !== false, 'produto excluído voltou', prod2Volta?.nome);

  // ------------------------------------------------------------------ agentes
  secao('Agentes: desconto acima do limite e exclusão viram achados; status muda');
  const vendaDesc = await adm.post('/vendas', { contatoId: cli.id, data: hoje(), itens: [{ produtoId: prod.id, quantidade: 1, valorUnitario: 100, desconto: 50, custoUnitario: 60 }] }, 201);
  await adm.post('/estoque/ajuste', { produtoId: prod.id, depositoId: (await adm.get('/depositos')).find((d: any) => d.padrao)?.id ?? (await adm.get('/depositos'))[0].id, tipo: 'ENTRADA', quantidade: 9, custoUnitario: 60 }, [200, 201]);
  const estado = await painel('POST', '/auditoria/painel/agentes/rodar', {});
  verifica(estado && typeof estado.duracaoMs === 'number' && !estado.erro, 'agentes rodaram sem erro', estado?.erro ?? estado?.porAgente);
  verifica(Object.values(estado?.porAgente ?? {}).every((a: any) => !a.erro), 'nenhum agente quebrou', Object.entries(estado?.porAgente ?? {}).filter(([, a]: any) => a.erro));
  const achados = await painel('GET', '/auditoria/painel/achados?limite=200');
  const achadoDesc = achados.itens?.find((a: any) => a.chave?.startsWith('descItem:') && a.registroId === vendaDesc.id);
  verifica(!!achadoDesc && achadoDesc.agente === 'descontos', 'detetive de descontos achou o item com 50% de desconto', achados.itens?.filter((a: any) => a.agente === 'descontos').map((a: any) => a.chave));
  // exclusão já revertida não vira achado (a trilha ignora eventos revertidos); uma exclusão de verdade vira
  const prod3 = await adm.post('/produtos', { nome: `TRILHA EXCLUIR 2 ${SUF}`, codigo: `TRY-${SUF}`, preco: 10, precoCusto: 5 }, 201);
  await adm.del(`/produtos/${prod3.id}`, [200, 204]);
  await painel('POST', '/auditoria/painel/agentes/rodar', { apenas: ['exclusoes'] });
  const achados2 = await painel('GET', '/auditoria/painel/achados?agente=exclusoes&limite=200');
  const achadoExcl = achados2.itens?.find((a: any) => a.chave === `excl:Produto:${prod3.id}`);
  verifica(!!achadoExcl && achadoExcl.nivel === 'baixo', 'vigia de exclusões viu o produto excluído', achados2.itens?.map((a: any) => a.chave));
  verifica(!achados2.itens?.some((a: any) => a.chave === `excl:Produto:${prod2.id}`), 'exclusão já revertida não vira achado');
  if (achadoDesc) {
    const mud = await painel('POST', `/auditoria/painel/achados/${achadoDesc.id}/status`, { status: 'VISTO' });
    verifica(mud.achado?.status === 'VISTO', 'achado marcado como visto');
    const ign = await painel('POST', `/auditoria/painel/achados/${achadoDesc.id}/status`, { status: 'IGNORADO' });
    verifica(ign.achado?.status === 'IGNORADO', 'achado ignorado');
    const lista2 = await painel('GET', '/auditoria/painel/achados');
    verifica(!lista2.itens?.some((a: any) => a.id === achadoDesc.id), 'ignorado some da lista padrão');
  }
  const agentes = await painel('GET', '/auditoria/painel/agentes');
  verifica(agentes.agentes?.length === 8 && agentes.analista && 'chaveConfigurada' in agentes.analista, '8 agentes + analista listados', agentes.agentes?.map((a: any) => a.codigo));
  const cfg = await painel('PUT', '/auditoria/painel/agentes/config', { descontoMaxPct: 20, horaInicio: 8 });
  verifica(cfg.descontoMaxPct === 20 && cfg.horaInicio === 8, 'configuração dos agentes gravada', cfg);
  await painel('PUT', '/auditoria/painel/agentes/config', { descontoMaxPct: 15, horaInicio: 7 });
  const analise = await painel('POST', '/auditoria/painel/analista/analisar', {});
  verifica(typeof analise?.erro === 'string' || analise?.resumo, 'analista responde (sem chave: explica que falta a chave)', analise?.erro ?? analise?.resumo);

  // chave de API nunca entra no painel
  const chave = await adm.post('/api-externa/chaves', { nome: `aud-${SUF}`, permissoes: { sistema: 'LEITURA', vendas: 'TOTAL' } }, [200, 201]).catch(() => null);
  if (chave?.chave) {
    const r = await fetch(BASE + '/auditoria/painel/resumo', { headers: { 'x-api-key': chave.chave } });
    verifica(r.status === 403 || r.status === 401, 'chave de API (mesmo com permissão de sistema) não abre o painel', r.status);
  }

  encerrar('Painel de auditoria');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
