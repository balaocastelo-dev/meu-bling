/**
 * Dashboard do ADMIN — "Últimos lançamentos" e "Últimos acontecimentos".
 *
 * Lançamentos: contas a receber, contas a pagar e movimentos de caixa/banco, pela ordem em que
 * foram GRAVADOS (criadoEm), não pela data de vencimento — assim um lançamento com data futura
 * não fica preso no topo e o que acabou de acontecer aparece primeiro.
 *
 * Acontecimentos: a trilha de auditoria (quem fez o quê) traduzida para frases. Ficam de fora os
 * lançamentos automáticos de estoque/contas disparados por uma mudança de situação (a própria
 * mudança já aparece) e, a menos que se peça a categoria "acessos", os logins.
 */
import { prisma } from '../../lib/prisma.js';

export type Tom = 'verde' | 'vermelho' | 'azul' | 'amarelo' | 'neutro';
export type CategoriaAcontecimento = 'vendas' | 'os' | 'compras' | 'fiscal' | 'financeiro' | 'cadastros' | 'sistema' | 'acessos';

export interface Lancamento {
  id: string;
  /** RECEBER/PAGAR = conta lançada; ENTRADA/SAIDA = dinheiro que entrou/saiu de uma conta */
  tipo: 'RECEBER' | 'PAGAR' | 'ENTRADA' | 'SAIDA' | 'TRANSFERENCIA';
  descricao: string;
  valor: number;
  /** quando foi gravado no sistema */
  quando: Date;
  /** vencimento (contas) ou data do movimento */
  dataRef: Date;
  situacao: string | null;
  contato: string | null;
  conta: string | null;
  link: string;
}

export interface Acontecimento {
  /** a = auditoria, h = mudança de situação, m = dinheiro que entrou/saiu */
  id: string;
  quando: Date;
  usuario: string;
  categoria: CategoriaAcontecimento;
  texto: string;
  tom: Tom;
  link: string | null;
}

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmt.format(v) : null);

function lerJson(s: string | null): Record<string, any> {
  if (!s) return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Lançamentos
// ---------------------------------------------------------------------------
export async function ultimosLancamentos(limite: number): Promise<Lancamento[]> {
  const [receber, pagar, movimentos] = await Promise.all([
    prisma.contaReceber.findMany({
      orderBy: { criadoEm: 'desc' },
      take: limite,
      select: { id: true, descricao: true, valor: true, criadoEm: true, vencimento: true, situacao: true, origemTipo: true, origemId: true, contato: { select: { nome: true } }, contaFinanceira: { select: { nome: true } } },
    }),
    prisma.contaPagar.findMany({
      orderBy: { criadoEm: 'desc' },
      take: limite,
      select: { id: true, descricao: true, valor: true, criadoEm: true, vencimento: true, situacao: true, origemTipo: true, origemId: true, contato: { select: { nome: true } }, contaFinanceira: { select: { nome: true } } },
    }),
    prisma.movimentoFinanceiro.findMany({
      orderBy: { criadoEm: 'desc' },
      take: limite,
      select: { id: true, descricao: true, valor: true, criadoEm: true, data: true, tipo: true, contaFinanceira: { select: { nome: true } }, categoria: { select: { nome: true } } },
    }),
  ]);

  const linkOrigem = (origemTipo: string, origemId: number | null, padrao: string) => {
    if (!origemId) return padrao;
    if (origemTipo === 'VENDA') return `/vendas/${origemId}`;
    if (origemTipo === 'COMPRA') return `/compras/${origemId}`;
    if (origemTipo === 'OS') return `/ordens-servico/${origemId}`;
    return padrao;
  };

  const itens: Lancamento[] = [
    ...receber.map((c) => ({
      id: `cr-${c.id}`,
      tipo: 'RECEBER' as const,
      descricao: c.descricao,
      valor: c.valor,
      quando: c.criadoEm,
      dataRef: c.vencimento,
      situacao: c.situacao,
      contato: c.contato?.nome ?? null,
      conta: c.contaFinanceira?.nome ?? null,
      link: linkOrigem(c.origemTipo, c.origemId, '/financeiro/receber'),
    })),
    ...pagar.map((c) => ({
      id: `cp-${c.id}`,
      tipo: 'PAGAR' as const,
      descricao: c.descricao,
      valor: c.valor,
      quando: c.criadoEm,
      dataRef: c.vencimento,
      situacao: c.situacao,
      contato: c.contato?.nome ?? null,
      conta: c.contaFinanceira?.nome ?? null,
      link: linkOrigem(c.origemTipo, c.origemId, '/financeiro/pagar'),
    })),
    ...movimentos.map((m) => ({
      id: `mf-${m.id}`,
      tipo: (m.tipo === 'SAIDA' ? 'SAIDA' : m.tipo === 'TRANSFERENCIA' ? 'TRANSFERENCIA' : 'ENTRADA') as Lancamento['tipo'],
      descricao: m.descricao,
      valor: m.valor,
      quando: m.criadoEm,
      dataRef: m.data,
      situacao: null,
      contato: null,
      conta: m.contaFinanceira?.nome ?? m.categoria?.nome ?? null,
      link: '/financeiro/bancos?aba=extrato',
    })),
  ];
  return itens.sort((a, b) => b.quando.getTime() - a.quando.getTime()).slice(0, limite);
}

// ---------------------------------------------------------------------------
// Acontecimentos
// ---------------------------------------------------------------------------
const CATEGORIA_POR_ENTIDADE: Record<string, CategoriaAcontecimento> = {
  Venda: 'vendas',
  Orcamento: 'vendas',
  Comissao: 'vendas',
  Desafio: 'vendas',
  MetaVendedor: 'vendas',
  OrdemServico: 'os',
  Compra: 'compras',
  NotaFiscal: 'fiscal',
  ContaReceber: 'financeiro',
  ContaPagar: 'financeiro',
  MovimentoFinanceiro: 'financeiro',
  ContaFinanceira: 'financeiro',
  TransacaoBancaria: 'financeiro',
  Contato: 'cadastros',
  Produto: 'cadastros',
  Vendedor: 'cadastros',
};

function categoriaDe(entidade: string, acao: string): CategoriaAcontecimento {
  if (acao === 'LOGIN') return 'acessos';
  return CATEGORIA_POR_ENTIDADE[entidade] ?? 'sistema';
}

/** Entidades de cada categoria (para filtrar já no banco) */
function filtroCategoria(cat: CategoriaAcontecimento | undefined) {
  if (!cat) return { acao: { not: 'LOGIN' } };
  if (cat === 'acessos') return { acao: 'LOGIN' };
  const conhecidas = Object.keys(CATEGORIA_POR_ENTIDADE);
  if (cat === 'sistema') return { acao: { not: 'LOGIN' }, entidade: { notIn: conhecidas } };
  return { acao: { not: 'LOGIN' }, entidade: { in: conhecidas.filter((e) => CATEGORIA_POR_ENTIDADE[e] === cat) } };
}

/** Lançamento automático disparado por mudança de situação (ex.: {"acoes":["lancarEstoque"]}) — a mudança já aparece */
function ehRuidoAutomatico(acao: string, d: Record<string, any>) {
  return acao === 'ACAO' && Array.isArray(d.acoes) && !d.acao;
}

const NOME_ENTIDADE: Record<string, string> = {
  Venda: 'a venda',
  Orcamento: 'o orçamento',
  OrdemServico: 'a OS',
  Compra: 'o pedido de compra',
  NotaFiscal: 'a nota fiscal',
  Contato: 'o contato',
  Produto: 'o produto',
  ContaReceber: 'a conta a receber',
  ContaPagar: 'a conta a pagar',
  MovimentoFinanceiro: 'o lançamento de caixa',
  ContaFinanceira: 'a conta financeira',
  TransacaoBancaria: 'a transação bancária',
  Usuario: 'o usuário',
  Vendedor: 'o vendedor',
  Desafio: 'o desafio',
  MetaVendedor: 'a meta do vendedor',
  Comissao: 'a comissão',
  Situacao: 'a situação',
  SituacaoTransicao: 'a transição de situação',
  TemplateNotificacao: 'o modelo de mensagem',
  Notificacao: 'a mensagem',
  Empresa: 'os dados da empresa',
  Configuracao: 'as configurações',
};

const CANAL: Record<string, string> = { WHATSAPP: 'WhatsApp', EMAIL: 'e-mail' };

interface Ref {
  rotulo: string;
  link: string | null;
  total?: number;
  cliente?: string;
}

/** Busca número/nome dos registros citados, em poucas consultas */
async function carregarReferencias(regs: { entidade: string; entidadeId: number | null }[]) {
  const ids = (ent: string[]) => [...new Set(regs.filter((r) => ent.includes(r.entidade) && r.entidadeId).map((r) => r.entidadeId!))];
  const [vendas, os, compras, notas, contatos, produtos, usuarios] = await Promise.all([
    prisma.venda.findMany({ where: { id: { in: ids(['Venda', 'Orcamento']) } }, select: { id: true, numero: true, tipo: true, total: true, contato: { select: { nome: true } } } }),
    prisma.ordemServico.findMany({ where: { id: { in: ids(['OrdemServico']) } }, select: { id: true, numero: true, total: true, contato: { select: { nome: true } } } }),
    prisma.compra.findMany({ where: { id: { in: ids(['Compra']) } }, select: { id: true, numero: true, total: true } }),
    prisma.notaFiscal.findMany({ where: { id: { in: ids(['NotaFiscal']) } }, select: { id: true, numero: true, serie: true, modelo: true, valorTotal: true, contato: { select: { nome: true } } } }),
    prisma.contato.findMany({ where: { id: { in: ids(['Contato']) } }, select: { id: true, nome: true } }),
    prisma.produto.findMany({ where: { id: { in: ids(['Produto']) } }, select: { id: true, nome: true } }),
    prisma.usuario.findMany({ where: { id: { in: ids(['Usuario']) } }, select: { id: true, nome: true } }),
  ]);
  const mapa = new Map<string, Ref>();
  for (const v of vendas) {
    const orc = v.tipo === 'ORCAMENTO';
    const ref = { rotulo: `${orc ? 'o orçamento' : 'a venda'} nº ${v.numero}`, link: `/${orc ? 'orcamentos' : 'vendas'}/${v.id}`, total: v.total, cliente: v.contato?.nome };
    mapa.set(`Venda:${v.id}`, ref);
    mapa.set(`Orcamento:${v.id}`, ref);
  }
  for (const o of os) mapa.set(`OrdemServico:${o.id}`, { rotulo: `a OS nº ${o.numero}`, link: `/ordens-servico/${o.id}`, total: o.total, cliente: o.contato?.nome });
  for (const c of compras) mapa.set(`Compra:${c.id}`, { rotulo: `o pedido de compra nº ${c.numero}`, link: `/compras/${c.id}`, total: c.total });
  for (const n of notas) mapa.set(`NotaFiscal:${n.id}`, { rotulo: `a ${n.modelo === 65 ? 'NFC-e' : 'NF-e'} nº ${n.numero}`, link: `/notas-fiscais/${n.id}`, total: n.valorTotal, cliente: n.contato?.nome ?? undefined });
  for (const c of contatos) mapa.set(`Contato:${c.id}`, { rotulo: `o contato ${c.nome}`, link: `/contatos/${c.id}` });
  for (const p of produtos) mapa.set(`Produto:${p.id}`, { rotulo: `o produto ${p.nome}`, link: `/produtos/${p.id}` });
  for (const u of usuarios) mapa.set(`Usuario:${u.id}`, { rotulo: `o usuário ${u.nome}`, link: '/configuracoes/usuarios' });
  return mapa;
}

/** Monta a frase do acontecimento ("Julia criou a venda nº 24891 — R$ 119,00 · cliente X") */
function descrever(entidade: string, acao: string, entidadeId: number | null, d: Record<string, any>, ref: Ref | undefined): { texto: string; tom: Tom; link: string | null } {
  const alvo = ref?.rotulo ?? (entidadeId && ['Venda', 'Orcamento', 'OrdemServico', 'Compra', 'NotaFiscal'].includes(entidade) ? `${NOME_ENTIDADE[entidade] ?? entidade} #${entidadeId}` : NOME_ENTIDADE[entidade] ?? entidade);
  const total = moeda(d.total) ?? moeda(ref?.total);
  const extra = [total, ref?.cliente ? `cliente ${ref.cliente}` : null].filter(Boolean).join(' · ');
  const comExtra = (t: string) => (extra ? `${t} — ${extra}` : t);
  const link = ref?.link ?? null;

  switch (acao) {
    case 'LOGIN':
      return { texto: 'entrou no sistema', tom: 'neutro', link: null };
    case 'CRIAR': {
      if (entidade === 'Contato') return { texto: `cadastrou o contato ${d.nome ?? ref?.rotulo?.replace('o contato ', '') ?? ''}`.trim(), tom: 'azul', link };
      if (entidade === 'Produto') return { texto: `cadastrou o produto ${d.nome ?? ''}`.trim(), tom: 'azul', link };
      if (entidade === 'ContaPagar' || entidade === 'ContaReceber' || entidade === 'MovimentoFinanceiro')
        return { texto: `lançou ${NOME_ENTIDADE[entidade]}${d.descricao ? ` "${d.descricao}"` : ''}${moeda(d.valor) ? ` — ${moeda(d.valor)}` : ''}`, tom: entidade === 'ContaPagar' ? 'vermelho' : 'verde', link };
      const pdv = d.origem === 'PDV do site' ? ' pelo PDV do site' : '';
      const verbo = entidade === 'OrdemServico' ? 'abriu' : 'criou';
      const nome = ref ? alvo : `${NOME_ENTIDADE[entidade] ?? entidade}${d.numero ? ` nº ${d.numero}` : ''}`;
      return { texto: comExtra(`${verbo} ${nome}${pdv}`), tom: entidade === 'Venda' ? 'verde' : 'azul', link };
    }
    case 'SITUACAO': {
      const para = d.para ?? d.paraSituacao ?? '?';
      const ruim = /cancel|reprov|estorn|devol/i.test(para);
      const bom = /fechad|atendid|conclu|entreg|aprovad|emitid|recebid|vendido/i.test(para);
      return { texto: comExtra(`mudou ${alvo} para "${para}"`), tom: ruim ? 'vermelho' : bom ? 'verde' : 'azul', link };
    }
    case 'EXCLUIR':
      return { texto: `${d.desativado ? 'desativou' : 'excluiu'} ${alvo}`, tom: 'vermelho', link: d.desativado ? link : null };
    case 'ALTERAR':
      return { texto: `alterou ${alvo}`, tom: 'neutro', link };
    case 'ACAO': {
      const a = String(d.acao ?? '');
      if (a === 'notificar') return { texto: `enviou ${alvo} por ${CANAL[d.canal] ?? d.canal ?? 'mensagem'}${d.anexo ? ' (com PDF)' : ''}`, tom: 'azul', link };
      if (a === 'converter') return { texto: `converteu ${alvo} na venda nº ${d.numeroVenda ?? '?'}`, tom: 'verde', link: d.vendaId ? `/vendas/${d.vendaId}` : link };
      if (a === 'aprovarOrcamentoOnline') return { texto: `— cliente aprovou ${alvo} pelo link${d.nome ? ` (${d.nome})` : ''}`, tom: 'verde', link };
      if (a === 'aprovarOrcamento') return { texto: `aprovou o orçamento d${alvo}${d.aprovadoPor ? ` (por ${d.aprovadoPor})` : ''}`, tom: 'verde', link };
      if (a === 'transferirVendedor') return { texto: `transferiu ${alvo} para outro vendedor`, tom: 'neutro', link };
      if (a === 'transmitir') return { texto: comExtra(`transmitiu ${alvo} para a SEFAZ${d.situacao ? ` (${String(d.situacao).toLowerCase()})` : ''}`), tom: d.situacao === 'AUTORIZADA' ? 'verde' : d.situacao === 'REJEITADA' ? 'vermelho' : 'azul', link };
      if (a === 'cancelar') return { texto: `cancelou ${alvo}${d.justificativa ? `: ${d.justificativa}` : ''}`, tom: 'vermelho', link };
      if (a === 'carta-correcao') return { texto: `emitiu carta de correção para ${alvo}`, tom: 'amarelo', link };
      if (a === 'inutilizar') return { texto: `inutilizou a numeração ${d.numeroInicial}–${d.numeroFinal} da série ${d.serie}`, tom: 'amarelo', link: '/notas-fiscais' };
      if (a === 'ajusteEstoque') return { texto: `ajustou o estoque d${alvo}`, tom: 'amarelo', link };
      if (a === 'transferenciaEstoque') return { texto: `transferiu estoque d${alvo} entre depósitos`, tom: 'neutro', link };
      if (a === 'conciliar') return { texto: 'conciliou uma transação bancária', tom: 'verde', link: '/financeiro/bancos' };
      if (a === 'reenviar') return { texto: `reenviou uma mensagem ao cliente`, tom: 'azul', link: '/comunicacao/notificacoes' };
      if (a.startsWith('open-finance')) return { texto: `Open Finance: ${a.replace('open-finance.', '')}`, tom: 'neutro', link: '/financeiro/bancos' };
      if (a.startsWith('whatsapp.')) return { texto: `WhatsApp: ${a.replace('whatsapp.', '').replace(/-/g, ' ')}`, tom: a.includes('desconectar') ? 'amarelo' : 'neutro', link: '/comunicacao/whatsapp' };
      const VERBO: Record<string, [string, Tom]> = {
        baixar: ['deu baixa n', 'verde'],
        receber: ['deu baixa n', 'verde'],
        pagar: ['pagou ', 'vermelho'],
        estornar: ['estornou ', 'amarelo'],
        aprovar: ['aprovou ', 'verde'],
        cancelar: ['cancelou ', 'vermelho'],
        recalcular: ['recalculou ', 'neutro'],
        gerarNfe: ['gerou a nota fiscal d', 'azul'],
        gerarNfce: ['gerou a NFC-e d', 'azul'],
        'importar-ofx': ['importou extrato OFX n', 'neutro'],
      };
      const v = VERBO[a];
      if (v) return { texto: `${v[0]}${alvo}${entidade === 'ContaReceber' || entidade === 'ContaPagar' ? (moeda(d.valor) ? ` — ${moeda(d.valor)}` : '') : ''}`, tom: v[1], link };
      return { texto: `${a ? a.replace(/[-_.]/g, ' ') : 'ação'} — ${alvo}`, tom: 'neutro', link };
    }
    default:
      return { texto: `${acao.toLowerCase()} ${alvo}`, tom: 'neutro', link };
  }
}

/** Auditoria que outra fonte já mostra melhor: mudança de situação (vem do histórico, que pega também as
 *  automáticas) e baixa/pagamento de conta (vem do movimento de caixa, que pega também os automáticos). */
function duplicadoDeOutraFonte(entidade: string, acao: string, d: Record<string, any>) {
  if (acao === 'SITUACAO') return true;
  if ((entidade === 'ContaReceber' || entidade === 'ContaPagar') && acao === 'ACAO' && ['baixar', 'receber', 'pagar'].includes(String(d.acao))) return true;
  if (entidade === 'MovimentoFinanceiro' && acao === 'CRIAR') return true;
  return false;
}

const MODULO_ENTIDADE: Record<string, string> = { VENDA: 'Venda', ORCAMENTO: 'Orcamento', OS: 'OrdemServico', COMPRA: 'Compra' };
const CATEGORIA_MODULO: Record<string, CategoriaAcontecimento> = { VENDA: 'vendas', ORCAMENTO: 'vendas', OS: 'os', COMPRA: 'compras' };

/** Quem fez uma mudança de situação sem usuário logado (PDV, cliente pelo link/WhatsApp, automática) */
function autorAutomatico(obs: string | null) {
  const o = obs ?? '';
  if (/PDV/i.test(o)) return 'PDV do site';
  if (/WhatsApp/i.test(o) && /cliente/i.test(o)) return 'Cliente (WhatsApp)';
  if (/online|link/i.test(o)) return 'Cliente (link)';
  return 'Sistema';
}

export async function ultimosAcontecimentos(limite: number, categoria?: CategoriaAcontecimento): Promise<Acontecimento[]> {
  const quer = (c: CategoriaAcontecimento) => !categoria || categoria === c;
  const modulos = Object.keys(CATEGORIA_MODULO).filter((m) => quer(CATEGORIA_MODULO[m]));

  const [regs, historico, movimentos] = await Promise.all([
    // busca um pouco a mais para compensar o que é filtrado em memória
    prisma.auditoria.findMany({
      where: filtroCategoria(categoria),
      orderBy: { id: 'desc' },
      take: Math.min(limite * 3, 600),
      select: { id: true, data: true, entidade: true, entidadeId: true, acao: true, detalhes: true, usuario: { select: { nome: true } } },
    }),
    modulos.length && categoria !== 'acessos'
      ? prisma.historicoSituacao.findMany({
          // a situação inicial (deSituacao vazio) é a própria criação, que já vem da auditoria
          where: { entidadeTipo: { in: modulos }, deSituacao: { not: null } },
          orderBy: { id: 'desc' },
          take: limite,
          select: { id: true, data: true, entidadeTipo: true, entidadeId: true, deSituacao: true, paraSituacao: true, observacao: true, usuario: { select: { nome: true } } },
        })
      : Promise.resolve([]),
    quer('financeiro') && categoria !== 'acessos'
      ? prisma.movimentoFinanceiro.findMany({
          orderBy: { criadoEm: 'desc' },
          take: limite,
          select: {
            id: true,
            criadoEm: true,
            tipo: true,
            valor: true,
            descricao: true,
            contaFinanceira: { select: { nome: true } },
            contaReceber: { select: { origemTipo: true, origemId: true, contato: { select: { nome: true } }, formaPagamento: { select: { nome: true } } } },
            contaPagar: { select: { origemTipo: true, origemId: true, contato: { select: { nome: true } }, formaPagamento: { select: { nome: true } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  const auditoria = regs
    .map((r) => ({ ...r, d: lerJson(r.detalhes) }))
    .filter((r) => !ehRuidoAutomatico(r.acao, r.d) && !duplicadoDeOutraFonte(r.entidade, r.acao, r.d));
  const refs = await carregarReferencias([
    ...auditoria,
    ...historico.map((h) => ({ entidade: MODULO_ENTIDADE[h.entidadeTipo] ?? h.entidadeTipo, entidadeId: h.entidadeId })),
  ]);

  const itens: Acontecimento[] = [];

  for (const r of auditoria) {
    const ref = r.entidadeId ? refs.get(`${r.entidade}:${r.entidadeId}`) : undefined;
    const { texto, tom, link } = descrever(r.entidade, r.acao, r.entidadeId, r.d, ref);
    const usuario = (typeof r.d.viaApi === 'string' && r.d.viaApi) || r.usuario?.nome?.trim() || (r.d.origem === 'PDV do site' ? `PDV${r.d.operador ? ` (${r.d.operador})` : ''}` : 'Sistema');
    itens.push({ id: `a${r.id}`, quando: r.data, usuario, categoria: categoriaDe(r.entidade, r.acao), texto, tom, link });
  }

  for (const h of historico) {
    const entidade = MODULO_ENTIDADE[h.entidadeTipo] ?? h.entidadeTipo;
    const ref = refs.get(`${entidade}:${h.entidadeId}`);
    const { texto, tom, link } = descrever(entidade, 'SITUACAO', h.entidadeId, { para: h.paraSituacao }, ref);
    const de = h.deSituacao ? texto.replace(`para "${h.paraSituacao}"`, `de "${h.deSituacao}" para "${h.paraSituacao}"`) : texto;
    const obs = h.observacao && !/^Orçamento aprovado por /.test(h.observacao) ? ` (${h.observacao.slice(0, 120)})` : '';
    itens.push({
      id: `h${h.id}`,
      quando: h.data,
      usuario: h.usuario?.nome?.trim() || autorAutomatico(h.observacao),
      categoria: CATEGORIA_MODULO[h.entidadeTipo] ?? 'sistema',
      texto: de + obs,
      tom,
      link,
    });
  }

  for (const m of movimentos) {
    const conta = m.contaReceber ?? m.contaPagar;
    const origem = conta?.origemId && conta.origemTipo === 'VENDA' ? `/vendas/${conta.origemId}` : conta?.origemId && conta.origemTipo === 'COMPRA' ? `/compras/${conta.origemId}` : conta?.origemId && conta.origemTipo === 'OS' ? `/ordens-servico/${conta.origemId}` : null;
    const valor = moeda(m.valor);
    const onde = [m.contaFinanceira?.nome, conta?.formaPagamento?.nome].filter(Boolean).join(' · ');
    const quem = conta?.contato?.nome ? ` de ${conta.contato.nome}` : '';
    const texto =
      m.tipo === 'SAIDA'
        ? `pagamento feito: ${valor} — ${m.descricao}${onde ? ` (${onde})` : ''}`
        : m.tipo === 'TRANSFERENCIA'
          ? `transferência de ${valor} — ${m.descricao}`
          : `pagamento recebido${quem}: ${valor} — ${m.descricao}${onde ? ` (${onde})` : ''}`;
    itens.push({
      id: `m${m.id}`,
      quando: m.criadoEm,
      usuario: '',
      categoria: 'financeiro',
      texto,
      tom: m.tipo === 'SAIDA' ? 'vermelho' : m.tipo === 'TRANSFERENCIA' ? 'neutro' : 'verde',
      link: origem ?? '/financeiro/bancos?aba=extrato',
    });
  }

  return itens.sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime()).slice(0, limite);
}
