/**
 * CAIXINHAS (Nubank) + AVISOS DO GESTOR/GERENTE (28/10/2026)
 * - Caixinha com valor, para que é e dia de uso → falta, por dia e sugestão de hoje.
 * - Guardar/retirar = transferência (fora do DRE), marcada na caixinha.
 * - Avisos (ADMIN e GERENTE) trazem a sugestão de hoje; vendedor não vê.
 *   npx tsx testes/caixinhas.ts http://localhost:3333
 */
import { encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const daqui = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function main() {
  const adm = await entrar('admin@balao.info', 'admin123');
  adm.nome = 'ADMIN';
  const nubank = await adm.post('/contas-financeiras', { nome: `Nubank ${SUF}`, tipo: 'BANCO', banco: 'NUBANK', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);
  const origem = await adm.post('/contas-financeiras', { nome: `Banco Origem ${SUF}`, tipo: 'BANCO', saldoInicial: 0, padrao: false, ativo: true }, [200, 201]);

  secao('Criar caixinha: 1.000 em 10 dias = 100 por dia');
  const c = await adm.post('/caixinhas', { nome: `13º ${SUF}`, valorMeta: 1000, dataUso: daqui(10), contaFinanceiraId: nubank.id }, 201);
  verifica(igual(c.porDia, 100) && igual(c.sugestaoHoje, 100) && c.situacao === 'EM_DIA', 'por dia 100, sugestão de hoje 100, em dia', c);

  secao('Guardar 100 hoje: sugestão zera, Nubank recebe');
  const g = await adm.post(`/caixinhas/${c.id}/guardar`, { valor: 100, origemId: origem.id, data: hoje() }, 201);
  verifica(igual(g.saldo, 100) && igual(g.falta, 900) && igual(g.sugestaoHoje, 0), 'saldo 100, falta 900, nada mais para hoje', g);
  const contas: any = await adm.get('/contas-financeiras?ativo=true');
  const lista = (Array.isArray(contas) ? contas : contas.data) as any[];
  verifica(igual(lista.find((x) => x.id === nubank.id).saldoAtual, 100) && igual(lista.find((x) => x.id === origem.id).saldoAtual, -100), 'transferência: Nubank +100, origem −100', lista.filter((x) => [nubank.id, origem.id].includes(x.id)));

  secao('Retirar não passa do saldo');
  await adm.post(`/caixinhas/${c.id}/retirar`, { valor: 500, destinoId: origem.id, data: hoje() }, 422);
  const r = await adm.post(`/caixinhas/${c.id}/retirar`, { valor: 40, destinoId: origem.id, data: hoje() }, 201);
  verifica(igual(r.saldo, 60), 'retirou 40, ficou 60', r);

  secao('Avisos do gestor');
  const c2 = await adm.post('/caixinhas', { nome: `IPTU ${SUF}`, valorMeta: 300, dataUso: daqui(3), contaFinanceiraId: nubank.id }, 201);
  const av: any = await adm.get('/avisos');
  verifica(av.avisos.some((a: any) => a.mensagem.includes(`IPTU ${SUF}`)), 'aviso da caixinha IPTU aparece', av.avisos);
  verifica(av.sugestaoHojeTotal >= 100, 'sugestão de hoje somada', av.sugestaoHojeTotal);

  secao('Não entra no DRE');
  const dre: any = await adm.get(`/relatorios/dre?dataInicial=${hoje()}&dataFinal=${hoje()}&regime=caixa`);
  verifica(!JSON.stringify(dre.linhas).includes('Caixinha'), 'DRE (caixa) sem as transferências da caixinha', dre.linhas);

  secao('Excluir só sem movimento; marcar usada');
  await adm.del(`/caixinhas/${c.id}`, 422);
  await adm.del(`/caixinhas/${c2.id}`, 200);
  const u = await adm.put(`/caixinhas/${c.id}`, { ativo: false }, 200);
  verifica(u.situacao === 'USADA', 'caixinha marcada como usada', u);

  encerrar('Caixinhas e avisos');
}

main();
