/**
 * PORTA DO SITE (www.balao.info → MEU BLING) — 25/10/2026
 * O Bling saiu de vez: o PDV, a Arena, a JUL.IA e os relatórios do PC leem e gravam aqui pela porta do site.
 *   - venda do balcão (PDV) entra Fechada e não duplica;
 *   - orçamento e pedido da JUL.IA entram EM ABERTO e não duplicam;
 *   - vendas por dia e por período (Arena e relatórios);
 *   - sem a chave certa, nada entra.
 *   npx tsx testes/integracao-site.ts http://localhost:3333   (com SITE_CHAVE_INTEGRACAO na API de teste)
 */
import { BASE, encerrar, entrar, hoje, igual, secao, SUF, verifica } from './lib.js';

const CHAVE = process.env.SITE_CHAVE_INTEGRACAO || 'chave-de-teste-do-pdv-do-site-1234567890';

async function site(metodo: string, rota: string, corpo?: unknown, chave = CHAVE) {
  const r = await fetch(`${BASE}/integracoes/site${rota}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${chave}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    /* sem JSON */
  }
  return { status: r.status, json };
}

const cliente = (sufixo: string) => ({ nome: `Cliente Site ${sufixo}`, telefone: `1998${sufixo.padStart(7, '0').slice(-7)}` });

async function main() {
  secao('Sem a chave certa, nada entra');
  verifica((await site('GET', '/status', undefined, 'chave-errada-com-mais-de-24-caracteres')).status === 401, 'chave errada → 401');
  verifica((await site('GET', '/status')).status === 200, 'chave certa → status 200');

  const vend = (await site('GET', '/vendedores')).json?.vendedores ?? [];
  const vendedorId = vend[0]?.id ?? null;

  secao('PDV do balcão: venda entra Fechada e não duplica');
  const pdvId = `PDV-T${SUF}`;
  const corpoPdv = {
    pdvId,
    data: hoje(),
    operador: 'Teste',
    vendedorId,
    cliente: cliente(`1${SUF}`),
    itens: [{ siteId: null, nome: 'Cabo HDMI teste', quantidade: 2, valor: 25 }],
    descontoEmReais: 0,
    pagamentos: [{ forma: 'pix', valor: 50 }],
  };
  const v1 = await site('POST', '/vendas', corpoPdv);
  verifica(v1.status === 201 && v1.json?.criada === true, 'venda do PDV criada (201)', v1);
  const v2 = await site('POST', '/vendas', corpoPdv);
  verifica(v2.status === 200 && v2.json?.venda?.id === v1.json?.venda?.id, 'repetir o mesmo PDV devolve a mesma venda', v2.json?.venda?.id);
  verifica(igual(v1.json?.venda?.total, 50), 'total 50', v1.json?.venda?.total);
  verifica(v1.json?.venda?.situacao?.final === true && !v1.json?.venda?.situacao?.cancelamento, 'venda do balcão fica Fechada', v1.json?.venda?.situacao);

  secao('JUL.IA: orçamento entra no sistema e não duplica');
  const orc = {
    idExterno: `julia-orc-${SUF}`,
    tipo: 'ORCAMENTO',
    agente: 'JUL.IA',
    cliente: cliente(`2${SUF}`),
    itens: [{ siteId: null, nome: 'Mouse sem fio teste', quantidade: 1, valor: 89.9 }],
    observacoes: 'Orçamento pelo WhatsApp',
    observacoesInternas: 'conversa teste',
  };
  const o1 = await site('POST', '/agente/documentos', orc);
  verifica(o1.status === 201 && o1.json?.criada === true, 'orçamento criado (201)', o1);
  const o2 = await site('POST', '/agente/documentos', orc);
  verifica(o2.status === 200 && o2.json?.documento?.id === o1.json?.documento?.id, 'repetir o orçamento devolve o mesmo', o2.json?.documento?.id);
  verifica(igual(o1.json?.documento?.total, 89.9), 'total do orçamento 89,90', o1.json?.documento?.total);

  secao('JUL.IA: pedido entra EM ABERTO (vendedor confere pagamento e entrega)');
  const ped = { ...orc, idExterno: `julia-ped-${SUF}`, tipo: 'PEDIDO', vendedorId, cliente: cliente(`3${SUF}`) };
  const p1 = await site('POST', '/agente/documentos', ped);
  verifica(p1.status === 201 && p1.json?.criada === true, 'pedido criado (201)', p1);
  verifica(p1.json?.documento?.situacao && !p1.json.documento.situacao.final, 'pedido da JUL.IA não entra fechado', p1.json?.documento?.situacao);
  verifica(p1.json?.documento?.origem === 'WHATSAPP', 'origem WhatsApp', p1.json?.documento?.origem);
  const mesmoId = await site('POST', '/agente/documentos', { ...ped, tipo: 'ORCAMENTO' });
  verifica(mesmoId.status === 201 && mesmoId.json?.documento?.id !== p1.json?.documento?.id, 'mesmo id externo em tipo diferente é outro documento', mesmoId.status);
  const vendedorInexistente = await site('POST', '/agente/documentos', { ...ped, idExterno: `julia-pedx-${SUF}`, vendedorId: 999999 });
  verifica(vendedorInexistente.status === 201 && vendedorInexistente.json?.documento?.vendedor == null, 'vendedor que não existe não trava: pedido entra sem vendedor', vendedorInexistente.status);
  const ruim = await site('POST', '/agente/documentos', { ...ped, idExterno: 'x', itens: [] });
  verifica(ruim.status === 400 || ruim.status === 422, 'dados errados → recusa (não 500)', ruim.status);

  secao('Vendas do dia e de um período (Arena e relatórios)');
  const dia = await site('GET', `/vendas?dia=${hoje()}`);
  const ids = new Set((dia.json?.vendas ?? []).map((v: any) => v.id));
  verifica(ids.has(v1.json?.venda?.id) && ids.has(p1.json?.documento?.id), 'o dia traz a venda do PDV e o pedido da JUL.IA', [...ids].slice(0, 10));
  verifica(!ids.has(o1.json?.documento?.id), 'orçamento não aparece como venda', o1.json?.documento?.id);
  const linha = (dia.json?.vendas ?? []).find((v: any) => v.id === v1.json?.venda?.id);
  verifica(linha?.data === hoje(), 'cada venda vem com a data AAAA-MM-DD', linha?.data);
  const per = await site('GET', `/vendas?de=${hoje()}&ate=${hoje()}`);
  verifica(per.status === 200 && (per.json?.vendas ?? []).length === (dia.json?.vendas ?? []).length, 'período de um dia = o dia', [per.status, per.json?.vendas?.length, dia.json?.vendas?.length]);
  verifica((await site('GET', '/vendas?de=2026-01-01&ate=2026-12-31')).status === 400, 'período maior que 92 dias → 400');
  verifica((await site('GET', '/vendas')).status === 400, 'sem dia nem período → 400');

  secao('Tudo visível na tela do sistema');
  const adm = await entrar('admin@balao.info', 'admin123');
  const doSistema = await adm.get(`/vendas/${p1.json?.documento?.id}`);
  verifica(doSistema?.id === p1.json?.documento?.id, 'o pedido da JUL.IA abre na tela de vendas', doSistema?.id);

  encerrar('Porta do site (PDV, JUL.IA, Arena e relatórios)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
