/**
 * JARVIS — duas regras que buscam caixa já ganho (30/10/2026, docs/JARVIS.md)
 *
 * OS_PRONTA_PARADA: conserto concluído e não retirado. O serviço já foi feito e a
 * peça já foi paga — é o dinheiro mais barato de buscar na loja. Aqui está o ponto
 * que quase passou batido: nesta loja "Aguardando retirada" NÃO é situação final,
 * então quem diz que o conserto acabou é a situação, não a data de conclusão.
 * ORCAMENTO_PARADO: orçamento que ninguém retomou. Não é caixa certo, é pipeline,
 * e o teste confere que a sugestão não finge que é.
 *   npx tsx testes/jarvis-caixa-parado.ts http://localhost:3333
 */
import { encerrar, entrar, igual, secao, SUF, verifica } from './lib.js';

const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

/** A sugestão da regra, como ela aparece no painel do gestor. */
async function sugestao(adm: any, regra: string) {
  const painel = await adm.get('/jarvis/painel');
  return painel.sugestoes.find((s: any) => s.regra === regra) ?? null;
}

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';

  const cliente = await adm.post('/contatos', { nome: `Cliente Caixa Parado ${SUF}`, celular: '19999990000', tipo: 'CLIENTE' }, [200, 201]);

  secao('"Aguardando retirada" não é situação final — e mesmo assim a OS tem que entrar na conta');
  const situacoes: any[] = await adm.get('/situacoes?modulo=OS');
  const retirada = situacoes.find((x) => /retirad/i.test(x.nome));
  verifica(!!retirada, 'a loja tem a situação "Aguardando retirada"', retirada?.nome);
  verifica(retirada?.final === false, 'e ela NÃO é final: por isso o sistema não grava data de conclusão sozinho', retirada?.final);

  secao('Conserto pronto e não retirado vira sugestão com o valor que falta entrar');
  const os = await adm.post(
    '/ordens-servico',
    {
      contatoId: cliente.id,
      dataEntrada: diasAtras(12),
      dataConclusao: diasAtras(6),
      equipamento: 'Notebook',
      marca: 'Dell',
      modelo: 'Inspiron 15',
      defeitoRelatado: 'Não liga',
      itens: [{ tipo: 'SERVICO', descricao: `Troca de placa ${SUF}`, quantidade: 1, valorUnitario: 820 }],
    },
    201,
  );
  verifica(os.total > 0, 'OS criada com valor', os.total);
  if (retirada) await adm.post(`/ordens-servico/${os.id}/situacao`, { situacaoId: retirada.id, forcar: true, confirmarCusto: true }, [200, 422]);

  await adm.post('/jarvis/rodar', {});
  const pronta = await sugestao(adm, 'OS_PRONTA_PARADA');
  verifica(!!pronta, 'a regra abriu a sugestão', pronta?.titulo);
  verifica((pronta?.impactoEstimado ?? 0) >= os.total, 'o impacto inclui o valor desta OS', { impacto: pronta?.impactoEstimado, os: os.total });
  const naLista = (pronta?.dados?.ordens ?? []).find((o: any) => o.id === os.id);
  verifica(!!naLista, 'a OS aparece na lista da sugestão', naLista?.numero);
  verifica(naLista?.diasParada >= 5, 'conta há quantos dias está parada', naLista?.diasParada);
  verifica(naLista?.cliente?.includes('Caixa Parado'), 'leva o nome do cliente para avisar', naLista?.cliente);
  verifica(/retirad/i.test(naLista?.situacao ?? ''), 'entra pela SITUAÇÃO da OS, não por ela ser final', naLista?.situacao);

  secao('Conserto que ficou pronto hoje não vira cobrança (ninguém atrasou nada)');
  const osHoje = await adm.post(
    '/ordens-servico',
    { contatoId: cliente.id, equipamento: 'Tablet', defeitoRelatado: 'Tela', itens: [{ tipo: 'SERVICO', descricao: `Troca de tela ${SUF}`, quantidade: 1, valorUnitario: 400 }] },
    201,
  );
  if (retirada) await adm.post(`/ordens-servico/${osHoje.id}/situacao`, { situacaoId: retirada.id, forcar: true, confirmarCusto: true }, [200, 422]);
  await adm.post('/jarvis/rodar', {});
  const comHoje = await sugestao(adm, 'OS_PRONTA_PARADA');
  const recente = (comHoje?.dados?.ordens ?? []).find((o: any) => o.id === osHoje.id);
  verifica(!recente, 'a que ficou pronta hoje fica de fora', comHoje?.dados?.quantidade);
  // o impacto aqui é dinheiro já ganho: nada de estimativa com desconto
  verifica(pronta?.acao === 'ABRIR_TELA' && pronta?.link === '/ordens-servico', 'leva o gestor para a lista de OS', { acao: pronta?.acao, link: pronta?.link });

  secao('OS entregue sai da conta (o dinheiro entrou)');
  await adm.put(`/ordens-servico/${os.id}`, {
    contatoId: cliente.id,
    dataEntrada: diasAtras(12),
    dataConclusao: diasAtras(6),
    dataSaida: diasAtras(1),
    equipamento: 'Notebook',
    itens: [{ tipo: 'SERVICO', descricao: `Troca de placa ${SUF}`, quantidade: 1, valorUnitario: 820 }],
  });
  await adm.post('/jarvis/rodar', {});
  const depois = await sugestao(adm, 'OS_PRONTA_PARADA');
  const aindaNaLista = (depois?.dados?.ordens ?? []).find((o: any) => o.id === os.id);
  // só vale como prova se a sugestão existia antes com esta OS dentro
  verifica(!!naLista && !aindaNaLista, 'depois de entregue, a OS sai da sugestão', { antes: !!naLista, depois: depois?.dados?.quantidade ?? 0 });

  secao('Orçamento parado: pipeline, e a sugestão diz que é pipeline');
  const orc = await adm.post(
    '/vendas',
    { tipo: 'ORCAMENTO', contatoId: cliente.id, data: diasAtras(9), itens: [{ descricao: `Upgrade de memória ${SUF}`, quantidade: 1, valorUnitario: 2000 }] },
    201,
  );
  await adm.post('/jarvis/rodar', {});
  const parado = await sugestao(adm, 'ORCAMENTO_PARADO');
  verifica(!!parado, 'a regra abriu a sugestão', parado?.titulo);
  const orcNaLista = (parado?.dados?.orcamentos ?? []).find((v: any) => v.id === orc.id);
  verifica(!!orcNaLista, 'o orçamento aparece na lista', orcNaLista?.numero);
  verifica(orcNaLista?.diasParado >= 8, 'conta há quantos dias está parado', orcNaLista?.diasParado);
  // 30% é conversão conservadora: o impacto NUNCA pode ser o total, senão vira venda fantasma no caixa
  verifica(
    (parado?.impactoEstimado ?? 0) < (parado?.dados?.total ?? 0),
    'o impacto é menor que o total: orçamento não é venda fechada',
    { impacto: parado?.impactoEstimado, total: parado?.dados?.total },
  );
  verifica(igual(parado?.impactoEstimado, Math.round((parado?.dados?.total ?? 0) * 0.3 * 100) / 100), 'usa os 30% combinados', parado?.impactoEstimado);
  verifica(/pipeline/i.test(parado?.texto ?? ''), 'o texto avisa em voz alta que é pipeline', parado?.texto?.slice(0, 80));

  secao('Nenhuma das duas vaza para quem não é gestor');
  for (const [nome, s] of [['OS_PRONTA_PARADA', pronta], ['ORCAMENTO_PARADO', parado]] as const) {
    verifica(!!s && !String(s.perfis ?? '').includes('VENDEDOR'), `${nome} é só de ADMIN/GERENTE`, s?.perfis);
  }
  const senha = 'Senha@12345';
  await adm.post('/usuarios', { nome: `Vend CP ${SUF}`, email: `vcp${SUF}@teste.com`, senha, perfil: 'VENDEDOR' }, [201, 409]);
  const vend = await entrar(`vcp${SUF}@teste.com`, senha).catch(() => null);
  if (vend) {
    vend.nome = 'VENDEDOR';
    const feed = await vend.get('/jarvis/feed');
    const lista = feed?.data ?? feed ?? [];
    const vazou = (Array.isArray(lista) ? lista : []).filter((s: any) => ['OS_PRONTA_PARADA', 'ORCAMENTO_PARADO'].includes(s.regra));
    verifica(vazou.length === 0, 'o vendedor não vê essas sugestões', vazou.map((s: any) => s.regra));
  }

  encerrar('JARVIS: conserto pronto parado e orçamento parado');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
