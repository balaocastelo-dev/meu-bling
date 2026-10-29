/**
 * ALERTAS DO MEU DASHBOARD — pendências com botão "Corrija" (29/10/2026)
 *
 * Cada alerta diz o que está faltando, quantos registros e leva direto para onde se corrige
 * (regra do Thiago: o sistema ajuda a concluir, não só mostra o erro).
 *   - vendedor: só as vendas DELE (sem custo informado, sem forma de pagamento, cliente incompleto,
 *     parada em aberto, orçamento sem resposta, "Pronto pra NF" esperando o botão)
 *   - técnico: as OS dele + OS sem técnico (para ele assumir) + as vendas dele (o técnico também vende)
 *   - gerente/gestor: a loja inteira, consolidado
 * Nunca traz custo, lucro ou margem — só aponta o que falta preencher.
 */
import { startOfDay, subDays } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ehConsumidorFinal } from '../vendas/service.js';

export type NivelAlerta = 'erro' | 'aviso' | 'info';

export interface Alerta {
  id: string;
  nivel: NivelAlerta;
  /** Vendas | Orçamentos | Assistência | Fiscal | Compras | Clientes */
  area: string;
  titulo: string;
  /** o que falta e por que importa */
  mensagem: string;
  qtd: number;
  /** tela da lista (ou do único registro) */
  link: string;
  /** texto do botão: Corrija (abre para preencher) · Resolver · Ver */
  botao: 'Corrija' | 'Resolver' | 'Ver';
  /** até 6 registros com link direto para corrigir */
  itens: { rotulo: string; link: string }[];
}

const MAX = 6;
const brl = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function situacoesVenda() {
  const s = await prisma.situacao.findMany({ where: { modulo: 'VENDA' }, select: { id: true, final: true, cancelamento: true } });
  return { cancel: s.filter((x) => x.cancelamento).map((x) => x.id), final: s.filter((x) => x.final && !x.cancelamento).map((x) => x.id) };
}
async function situacoesOs() {
  const s = await prisma.situacao.findMany({ where: { modulo: 'OS' }, select: { id: true, nome: true, final: true, cancelamento: true, inicial: true } });
  return {
    cancel: s.filter((x) => x.cancelamento).map((x) => x.id),
    final: s.filter((x) => x.final && !x.cancelamento).map((x) => x.id),
    fechadas: s.filter((x) => x.final || x.cancelamento).map((x) => x.id),
    iniciais: s.filter((x) => x.inicial).map((x) => x.id),
  };
}

const sel = { id: true, numero: true, total: true, data: true } as const;
const linkVenda = (v: { id: number }, editar = false) => (editar ? `/vendas/${v.id}/editar` : `/vendas/${v.id}`);
const rotuloVenda = (v: { numero: number; total: number }) => `Venda nº ${v.numero} · ${brl(v.total)}`;
const linkOs = (o: { id: number }, editar = false) => (editar ? `/ordens-servico/${o.id}/editar` : `/ordens-servico/${o.id}`);
const rotuloOs = (o: { numero: number; equipamento: string | null; contato?: { nome: string } | null }) => `OS nº ${o.numero}${o.equipamento ? ` · ${o.equipamento}` : ''}${o.contato ? ` · ${o.contato.nome}` : ''}`;

type Filtro = { vendedorId?: number; tecnicoId?: number };

// ======================================================================= vendas
/** Pendências das vendas (de um vendedor, ou da loja toda quando sem vendedorId) */
export async function alertasVendas(f: Filtro & { nf?: boolean } = {}): Promise<Alerta[]> {
  const out: Alerta[] = [];
  const { cancel, final } = await situacoesVenda();
  const agora = new Date();
  const base: Prisma.VendaWhereInput = { tipo: 'PEDIDO', situacaoId: { notIn: cancel }, ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}) };
  const recentes: Prisma.VendaWhereInput = { ...base, data: { gte: subDays(agora, 45) } };
  const listaVendas = (link: string) => (f.vendedorId ? `/vendas?vendedorId=${f.vendedorId}` : link);

  // ---- venda com produto sem custo informado (o custo é obrigatório para fechar e para o DRE)
  const semCusto = await prisma.venda.findMany({
    where: { ...recentes, itens: { some: { custoUnitario: { lte: 0 } } } },
    select: sel,
    orderBy: { numero: 'desc' },
    take: 50,
  });
  if (semCusto.length)
    out.push({
      id: 'venda-sem-custo',
      nivel: 'erro',
      area: 'Vendas',
      titulo: semCusto.length === 1 ? 'Venda com produto sem custo' : `${semCusto.length} vendas com produto sem custo`,
      mensagem: 'Toda venda precisa do custo de cada produto (fica escondido do cliente). Sem ele a venda não fecha e o DRE sai errado.',
      qtd: semCusto.length,
      link: semCusto.length === 1 ? linkVenda(semCusto[0], true) : listaVendas('/vendas'),
      botao: 'Corrija',
      itens: semCusto.slice(0, MAX).map((v) => ({ rotulo: rotuloVenda(v), link: linkVenda(v, true) })),
    });

  // ---- venda sem forma de pagamento (sem parcela ou parcela sem forma)
  const semPagamento = await prisma.venda.findMany({
    where: { ...recentes, OR: [{ parcelas: { none: {} } }, { parcelas: { some: { formaPagamentoId: null } } }] },
    select: sel,
    orderBy: { numero: 'desc' },
    take: 50,
  });
  if (semPagamento.length)
    out.push({
      id: 'venda-sem-pagamento',
      nivel: 'erro',
      area: 'Vendas',
      titulo: semPagamento.length === 1 ? 'Venda sem forma de pagamento' : `${semPagamento.length} vendas sem forma de pagamento`,
      mensagem: 'Escolha como o cliente pagou (e onde o dinheiro entrou) para a venda poder ser finalizada.',
      qtd: semPagamento.length,
      link: semPagamento.length === 1 ? linkVenda(semPagamento[0], true) : listaVendas('/vendas'),
      botao: 'Corrija',
      itens: semPagamento.slice(0, MAX).map((v) => ({ rotulo: rotuloVenda(v), link: linkVenda(v, true) })),
    });

  // ---- cliente incompleto (CPF, telefone, e-mail, endereço) — só nas vendas abertas (as fechadas já passaram)
  const abertas = await prisma.venda.findMany({
    where: { ...recentes, situacaoId: { notIn: [...cancel, ...final] } },
    select: { ...sel, contato: { select: { id: true, nome: true, documento: true, telefone: true, celular: true, email: true, logradouro: true, numero: true, bairro: true, municipio: true, uf: true, cep: true } } },
    orderBy: { numero: 'desc' },
    take: 80,
  });
  const vazio = (x: string | null | undefined) => !x || !String(x).trim();
  const clienteIncompleto = abertas.filter((v) => {
    const c = v.contato;
    if (!c || ehConsumidorFinal(c)) return false;
    const doc = (c.documento || '').replace(/\D/g, '');
    return (doc.length !== 11 && doc.length !== 14) || (vazio(c.celular) && vazio(c.telefone)) || vazio(c.email) || vazio(c.logradouro) || vazio(c.municipio) || vazio(c.cep);
  });
  if (clienteIncompleto.length)
    out.push({
      id: 'venda-cliente-incompleto',
      nivel: 'aviso',
      area: 'Clientes',
      titulo: clienteIncompleto.length === 1 ? 'Venda em aberto com cadastro do cliente incompleto' : `${clienteIncompleto.length} vendas em aberto com cliente incompleto`,
      mensagem: 'Nome, CPF, telefone, e-mail e endereço são obrigatórios para finalizar (ou use "Consumidor final").',
      qtd: clienteIncompleto.length,
      link: clienteIncompleto.length === 1 ? `/contatos/${clienteIncompleto[0].contato!.id}/editar` : listaVendas('/vendas'),
      botao: 'Corrija',
      itens: clienteIncompleto.slice(0, MAX).map((v) => ({ rotulo: `${rotuloVenda(v)} · ${v.contato!.nome}`, link: `/contatos/${v.contato!.id}/editar` })),
    });

  // ---- venda parada em aberto há mais de 7 dias
  const paradas = await prisma.venda.findMany({
    where: { ...base, situacaoId: { notIn: [...cancel, ...final] }, data: { lt: subDays(agora, 7) } },
    select: sel,
    orderBy: { data: 'asc' },
    take: 50,
  });
  if (paradas.length)
    out.push({
      id: 'venda-parada',
      nivel: 'aviso',
      area: 'Vendas',
      titulo: paradas.length === 1 ? 'Venda parada em aberto há mais de 7 dias' : `${paradas.length} vendas paradas em aberto há mais de 7 dias`,
      mensagem: 'Finalize (se o cliente já pagou/levou) ou cancele. Venda parada não entra no caixa nem no fechamento.',
      qtd: paradas.length,
      link: paradas.length === 1 ? linkVenda(paradas[0]) : listaVendas('/vendas'),
      botao: 'Resolver',
      itens: paradas.slice(0, MAX).map((v) => ({ rotulo: rotuloVenda(v), link: linkVenda(v) })),
    });

  // ---- orçamento sem resposta há mais de 3 dias
  const sitOrc = await prisma.situacao.findMany({ where: { modulo: 'ORCAMENTO', OR: [{ final: true }, { cancelamento: true }] }, select: { id: true } });
  const orcamentos = await prisma.venda.findMany({
    where: { tipo: 'ORCAMENTO', ...(f.vendedorId ? { vendedorId: f.vendedorId } : {}), aprovadoEm: null, vendaGerada: { is: null }, situacaoId: { notIn: sitOrc.map((s) => s.id) }, data: { lt: subDays(agora, 3), gte: subDays(agora, 60) } },
    select: { ...sel, contato: { select: { nome: true } } },
    orderBy: { data: 'asc' },
    take: 50,
  });
  if (orcamentos.length)
    out.push({
      id: 'orcamento-sem-resposta',
      nivel: 'info',
      area: 'Orçamentos',
      titulo: orcamentos.length === 1 ? 'Orçamento sem resposta há mais de 3 dias' : `${orcamentos.length} orçamentos sem resposta há mais de 3 dias`,
      mensagem: 'Dê um retorno ao cliente (WhatsApp) — orçamento esquecido é venda perdida.',
      qtd: orcamentos.length,
      link: orcamentos.length === 1 ? `/orcamentos/${orcamentos[0].id}` : f.vendedorId ? `/orcamentos?vendedorId=${f.vendedorId}` : '/orcamentos',
      botao: 'Ver',
      itens: orcamentos.slice(0, MAX).map((v) => ({ rotulo: `Orçamento nº ${v.numero} · ${v.contato?.nome ?? ''} · ${brl(v.total)}`, link: `/orcamentos/${v.id}` })),
    });

  // ---- "Pronto pra NF": o robô já conferiu; falta alguém apertar o botão (técnico não emite NF)
  if (f.nf !== false) {
    const prontas = await prisma.venda.findMany({
      where: { ...base, notaId: null, roboNf: { is: { status: 'PRONTA' } } },
      select: sel,
      orderBy: { numero: 'desc' },
      take: 50,
    });
    if (prontas.length)
      out.push({
        id: 'venda-pronta-nf',
        nivel: 'info',
        area: 'Fiscal',
        titulo: prontas.length === 1 ? 'Venda pronta para emitir a NF' : `${prontas.length} vendas prontas para emitir a NF`,
        mensagem: 'O robô já conferiu e preencheu o que faltava. É só abrir a venda e apertar "Emitir NF".',
        qtd: prontas.length,
        link: prontas.length === 1 ? linkVenda(prontas[0]) : listaVendas('/vendas'),
        botao: 'Resolver',
        itens: prontas.slice(0, MAX).map((v) => ({ rotulo: rotuloVenda(v), link: linkVenda(v) })),
      });
  }

  return out;
}

// ======================================================================= assistência técnica
/** Pendências das OS (de um técnico, ou da loja toda quando sem tecnicoId) */
export async function alertasOs(f: Filtro = {}): Promise<Alerta[]> {
  const out: Alerta[] = [];
  const { fechadas, iniciais, cancel } = await situacoesOs();
  const agora = new Date();
  const hoje = startOfDay(agora);
  const selOs = { id: true, numero: true, equipamento: true, dataEntrada: true, contato: { select: { nome: true } } } as const;
  const minhas: Prisma.OrdemServicoWhereInput = { situacaoId: { notIn: fechadas }, ...(f.tecnicoId ? { tecnicoId: f.tecnicoId } : {}) };
  const listaOs = (q: string) => (f.tecnicoId ? `/ordens-servico?tecnicoId=${f.tecnicoId}${q ? '&' + q : ''}` : `/ordens-servico${q ? '?' + q : ''}`);

  // ---- OS sem técnico (aberta): qualquer técnico pode assumir; a gestão distribui
  const semTecnico = await prisma.ordemServico.findMany({ where: { situacaoId: { notIn: fechadas }, tecnicoId: null }, select: selOs, orderBy: { dataEntrada: 'asc' }, take: 50 });
  if (semTecnico.length)
    out.push({
      id: 'os-sem-tecnico',
      nivel: 'erro',
      area: 'Assistência',
      titulo: semTecnico.length === 1 ? 'OS aberta sem técnico' : `${semTecnico.length} OS abertas sem técnico`,
      mensagem: f.tecnicoId ? 'Ninguém está cuidando destas OS. Abra e coloque seu nome em "Técnico" para assumir.' : 'Ninguém está cuidando destas OS. Abra e escolha o técnico responsável.',
      qtd: semTecnico.length,
      link: semTecnico.length === 1 ? linkOs(semTecnico[0], true) : '/ordens-servico?abertas=true',
      botao: 'Corrija',
      itens: semTecnico.slice(0, MAX).map((o) => ({ rotulo: rotuloOs(o), link: linkOs(o, true) })),
    });

  // ---- OS com peça sem custo (fechamento sai errado): mesma regra do Robô da Saúde (comum/custos-os.ts) —
  //      custo total das peças não informado E alguma peça com custo zero; só OS do MEU BLING (as do Bling não têm custo por peça)
  const semCusto = await prisma.ordemServico.findMany({
    where: {
      ...(f.tecnicoId ? { tecnicoId: f.tecnicoId } : {}),
      blingId: null,
      situacaoId: { notIn: cancel },
      custoPeca: { lte: 0 },
      itens: { some: { tipo: 'PECA', custoUnitario: { lte: 0 } } },
      OR: [{ situacaoId: { notIn: fechadas } }, { dataConclusao: { gte: subDays(agora, 30) } }],
    },
    select: selOs,
    orderBy: { numero: 'desc' },
    take: 50,
  });
  if (semCusto.length)
    out.push({
      id: 'os-sem-custo-peca',
      nivel: 'erro',
      area: 'Assistência',
      titulo: semCusto.length === 1 ? 'OS com peça sem custo informado' : `${semCusto.length} OS com peça sem custo informado`,
      mensagem: 'Informe quanto a peça custou (fica só no fechamento, o cliente não vê). Sem isso o fechamento da assistência sai errado.',
      qtd: semCusto.length,
      link: semCusto.length === 1 ? linkOs(semCusto[0], true) : listaOs(''),
      botao: 'Corrija',
      itens: semCusto.slice(0, MAX).map((o) => ({ rotulo: rotuloOs(o), link: linkOs(o, true) })),
    });

  // ---- OS aberta há mais de 2 dias sem diagnóstico (ainda na situação inicial ou sem laudo)
  const semDiagnostico = await prisma.ordemServico.findMany({
    where: { ...minhas, OR: [{ diagnostico: null }, { diagnostico: '' }], dataEntrada: { lt: subDays(agora, 2) }, ...(iniciais.length ? {} : {}) },
    select: selOs,
    orderBy: { dataEntrada: 'asc' },
    take: 50,
  });
  if (semDiagnostico.length)
    out.push({
      id: 'os-sem-diagnostico',
      nivel: 'aviso',
      area: 'Assistência',
      titulo: semDiagnostico.length === 1 ? 'OS há mais de 2 dias sem diagnóstico' : `${semDiagnostico.length} OS há mais de 2 dias sem diagnóstico`,
      mensagem: 'Escreva o diagnóstico (o que tem o equipamento) para o cliente aprovar o orçamento.',
      qtd: semDiagnostico.length,
      link: semDiagnostico.length === 1 ? linkOs(semDiagnostico[0], true) : listaOs('abertas=true'),
      botao: 'Corrija',
      itens: semDiagnostico.slice(0, MAX).map((o) => ({ rotulo: rotuloOs(o), link: linkOs(o, true) })),
    });

  // ---- orçamento da OS aguardando aprovação do cliente há mais de 3 dias
  const aguardando = await prisma.ordemServico.findMany({
    where: { ...minhas, orcar: true, orcamentoAprovado: false, atualizadoEm: { lt: subDays(agora, 3) } },
    select: selOs,
    orderBy: { atualizadoEm: 'asc' },
    take: 50,
  });
  if (aguardando.length)
    out.push({
      id: 'os-aguardando-aprovacao',
      nivel: 'aviso',
      area: 'Assistência',
      titulo: aguardando.length === 1 ? 'OS aguardando aprovação do cliente há mais de 3 dias' : `${aguardando.length} OS aguardando aprovação do cliente há mais de 3 dias`,
      mensagem: 'Cobre uma resposta do cliente pelo WhatsApp (botão "Notificar" na OS).',
      qtd: aguardando.length,
      link: aguardando.length === 1 ? linkOs(aguardando[0]) : listaOs('abertas=true'),
      botao: 'Resolver',
      itens: aguardando.slice(0, MAX).map((o) => ({ rotulo: rotuloOs(o), link: linkOs(o) })),
    });

  // ---- prazo vencido
  const vencidas = await prisma.ordemServico.findMany({ where: { ...minhas, dataPrevista: { lt: hoje } }, select: { ...selOs, dataPrevista: true }, orderBy: { dataPrevista: 'asc' }, take: 50 });
  if (vencidas.length)
    out.push({
      id: 'os-prazo-vencido',
      nivel: 'erro',
      area: 'Assistência',
      titulo: vencidas.length === 1 ? 'OS com prazo vencido' : `${vencidas.length} OS com prazo vencido`,
      mensagem: 'A data prevista já passou. Conclua, avise o cliente ou ajuste a previsão.',
      qtd: vencidas.length,
      link: vencidas.length === 1 ? linkOs(vencidas[0]) : listaOs('atrasadas=true'),
      botao: 'Resolver',
      itens: vencidas.slice(0, MAX).map((o) => ({ rotulo: `${rotuloOs(o)} · prev. ${o.dataPrevista!.toLocaleDateString('pt-BR')}`, link: linkOs(o) })),
    });

  // ---- OS parada (sem mexer) há mais de 5 dias
  const paradas = await prisma.ordemServico.findMany({
    where: { ...minhas, atualizadoEm: { lt: subDays(agora, 5) }, OR: [{ dataPrevista: null }, { dataPrevista: { gte: hoje } }] },
    select: selOs,
    orderBy: { atualizadoEm: 'asc' },
    take: 50,
  });
  if (paradas.length)
    out.push({
      id: 'os-parada',
      nivel: 'aviso',
      area: 'Assistência',
      titulo: paradas.length === 1 ? 'OS parada há mais de 5 dias' : `${paradas.length} OS paradas há mais de 5 dias`,
      mensagem: 'Nada mudou nestas OS nos últimos 5 dias. Atualize a situação ou avise o cliente do andamento.',
      qtd: paradas.length,
      link: paradas.length === 1 ? linkOs(paradas[0]) : listaOs('abertas=true'),
      botao: 'Resolver',
      itens: paradas.slice(0, MAX).map((o) => ({ rotulo: rotuloOs(o), link: linkOs(o) })),
    });

  return out;
}

// ======================================================================= loja inteira (gerente/gestor)
export async function alertasLoja(): Promise<Alerta[]> {
  const out: Alerta[] = [];
  const { cancel } = await situacoesVenda();
  const agora = new Date();
  const iniMes = startOfDay(new Date(agora.getFullYear(), agora.getMonth(), 1));

  // ---- venda deste mês sem vendedor (não conta meta/ranking/comissão)
  const semVendedor = await prisma.venda.findMany({ where: { tipo: 'PEDIDO', vendedorId: null, data: { gte: iniMes }, situacaoId: { notIn: cancel } }, select: sel, orderBy: { numero: 'desc' }, take: 50 });
  if (semVendedor.length)
    out.push({
      id: 'venda-sem-vendedor',
      nivel: 'aviso',
      area: 'Vendas',
      titulo: semVendedor.length === 1 ? 'Venda deste mês sem vendedor' : `${semVendedor.length} vendas deste mês sem vendedor`,
      mensagem: 'Não conta para ninguém na meta, no ranking nem na comissão. Abra a venda → Mais ações → Transferir para vendedor.',
      qtd: semVendedor.length,
      link: semVendedor.length === 1 ? linkVenda(semVendedor[0]) : '/vendas',
      botao: 'Corrija',
      itens: semVendedor.slice(0, MAX).map((v) => ({ rotulo: rotuloVenda(v), link: linkVenda(v) })),
    });

  // ---- NF rejeitada / com erro
  const nfErro = await prisma.notaFiscal.findMany({ where: { situacao: { in: ['REJEITADA', 'ERRO'] } }, select: { id: true, numero: true }, orderBy: { id: 'desc' }, take: 50 });
  if (nfErro.length)
    out.push({
      id: 'nf-rejeitada',
      nivel: 'erro',
      area: 'Fiscal',
      titulo: nfErro.length === 1 ? 'Nota fiscal rejeitada' : `${nfErro.length} notas fiscais rejeitadas`,
      mensagem: 'A SEFAZ recusou. Abra a nota, veja o motivo e corrija.',
      qtd: nfErro.length,
      link: nfErro.length === 1 ? `/notas-fiscais/${nfErro[0].id}` : '/notas-fiscais?situacao=REJEITADA',
      botao: 'Corrija',
      itens: nfErro.slice(0, MAX).map((n) => ({ rotulo: `NF ${n.numero ?? n.id}`, link: `/notas-fiscais/${n.id}` })),
    });

  // ---- compras em aberto há mais de 15 dias
  const sitCompra = await prisma.situacao.findMany({ where: { modulo: 'COMPRA', OR: [{ final: true }, { cancelamento: true }] }, select: { id: true } });
  const compras = await prisma.compra.findMany({ where: { situacaoId: { notIn: sitCompra.map((s) => s.id) }, data: { lt: subDays(agora, 15) } }, select: { id: true, numero: true, total: true }, orderBy: { data: 'asc' }, take: 50 });
  if (compras.length)
    out.push({
      id: 'compra-em-aberto',
      nivel: 'info',
      area: 'Compras',
      titulo: compras.length === 1 ? 'Pedido de compra em aberto há mais de 15 dias' : `${compras.length} pedidos de compra em aberto há mais de 15 dias`,
      mensagem: 'A mercadoria chegou? Feche o pedido para o estoque e o contas a pagar entrarem.',
      qtd: compras.length,
      link: compras.length === 1 ? `/compras/${compras[0].id}` : '/compras',
      botao: 'Resolver',
      itens: compras.slice(0, MAX).map((c) => ({ rotulo: `Compra nº ${c.numero} · ${brl(c.total)}`, link: `/compras/${c.id}` })),
    });

  const [vendas, os] = await Promise.all([alertasVendas(), alertasOs()]);
  return ordenar([...out, ...vendas, ...os]);
}

const PESO: Record<NivelAlerta, number> = { erro: 0, aviso: 1, info: 2 };
export function ordenar(lista: Alerta[]) {
  return lista.sort((a, b) => PESO[a.nivel] - PESO[b.nivel] || b.qtd - a.qtd);
}
