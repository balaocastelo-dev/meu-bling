/**
 * AGENTES DE AUDITORIA — "detetives" que rodam 24h sobre a trilha (antes/depois) e os dados do
 * sistema e apontam padrões, inconsistências e coisas suspeitas. Cada agente devolve achados com
 * uma chave estável (não repete enquanto estiver aberto) e evidências com link.
 *
 *   exclusoes    exclusões e cancelamentos (venda/OS/compra/conta/lançamento apagados, venda criada e cancelada…)
 *   descontos    preços e descontos (abaixo do custo, desconto acima do limite, valor mexido em venda fechada)
 *   dinheiro     caixa e bancos (saída manual, valor de conta reduzido, estorno, ajuste de saldo inicial)
 *   estoque      ajustes manuais de estoque, saldo negativo, produto excluído com estoque
 *   horarios     fora do horário, acessos estranhos, senha errada no painel, usuário alterado
 *   comissoes    venda transferida de vendedor, comissão mexida por quem recebe, meta/percentual alterado
 *   consistencia operação que gravou e deu erro, venda com total diferente dos itens, duplicada, conta recebida sem dinheiro
 *   padroes      fora do padrão da equipe (30 dias): cancelamentos, descontos, horário, ajustes, saídas manuais
 *
 * O "analista" (Claude, chave opcional) fica em analista.ts.
 */
import { prisma } from '../../lib/prisma.js';
import { clienteSemTrilha } from './trilha.js';
import { lerJson, linkRegistro, rotuloRegistro } from './operacoes.js';

export type Nivel = 'alto' | 'medio' | 'baixo';
export interface Evidencia {
  rotulo: string;
  link?: string | null;
  operacaoId?: string | null;
}
export interface AchadoNovo {
  chave: string;
  nivel: Nivel;
  categoria: string;
  titulo: string;
  explicacao: string;
  evidencias?: Evidencia[];
  usuarioId?: number | null;
  usuario?: string | null;
  operacaoId?: string | null;
  tabela?: string | null;
  registroId?: number | null;
  /** achado de "estado" (some sozinho quando a situação é corrigida) */
  transitorio?: boolean;
}
export interface ConfigAgentes {
  ligado: boolean;
  /** horário normal da loja (fora disso, ação vira achado) */
  horaInicio: number;
  horaFim: number;
  /** desconto acima disto (%) vira achado */
  descontoMaxPct: number;
  /** saída manual de caixa/banco a partir deste valor vira achado alto */
  saidaManualAlerta: number;
  /** modelo do analista (Claude) */
  modeloIa: string;
  /** agentes desligados */
  desligados: string[];
}
export const CONFIG_PADRAO: ConfigAgentes = { ligado: true, horaInicio: 7, horaFim: 22, descontoMaxPct: 15, saidaManualAlerta: 500, modeloIa: 'claude-sonnet-5-5', desligados: [] };
const CHAVE_CONFIG = 'auditoria.config';
export const INTERVALO_MS = 5 * 60 * 1000;

export interface Agente {
  codigo: string;
  nome: string;
  descricao: string;
  /** janela de dados que o agente olha */
  janelaDias: number;
  rodar(ctx: Contexto): Promise<AchadoNovo[]>;
}
interface Contexto {
  desde: Date;
  ate: Date;
  cfg: ConfigAgentes;
  situacoes: Map<number, { nome: string; final: boolean; cancelamento: boolean; modulo: string }>;
}

const db = () => clienteSemTrilha();
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmt.format(v) : 'R$ ?');
const SP = 'America/Sao_Paulo';
function horaSP(d: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: SP, hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(d);
  const hora = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24;
  const dia = p.find((x) => x.type === 'weekday')?.value ?? '';
  return { hora, domingo: dia === 'Sun' };
}
function diaSP(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
const quando = (d: Date) => d.toLocaleString('pt-BR', { timeZone: SP, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const camposDe = (s: string | null): string[] => {
  try {
    return s ? (JSON.parse(s) as string[]) : [];
  } catch {
    return [];
  }
};

export async function lerConfig(): Promise<ConfigAgentes> {
  const c = await db().configuracao.findUnique({ where: { chave: CHAVE_CONFIG } }).catch(() => null);
  if (!c) return { ...CONFIG_PADRAO };
  try {
    return { ...CONFIG_PADRAO, ...(JSON.parse(c.valor) as Partial<ConfigAgentes>) };
  } catch {
    return { ...CONFIG_PADRAO };
  }
}
export async function gravarConfig(p: Partial<ConfigAgentes>) {
  const atual = await lerConfig();
  const nova = { ...atual, ...p };
  const valor = JSON.stringify(nova);
  await prisma.configuracao.upsert({ where: { chave: CHAVE_CONFIG }, create: { chave: CHAVE_CONFIG, valor }, update: { valor } });
  return nova;
}

/** eventos da trilha (fora de reversões e de serviços de fundo) de certas tabelas na janela */
async function eventosDe(ctx: Contexto, tabelas: string[], tipos?: string[]) {
  return db().auditoriaEvento.findMany({
    where: { tabela: { in: tabelas }, quando: { gte: ctx.desde, lte: ctx.ate }, revertidoEm: null, ...(tipos ? { tipo: { in: tipos } } : {}), operacao: { origem: { notIn: ['REVERSAO', 'SERVICO', 'SISTEMA'] } } },
    orderBy: { id: 'asc' },
    take: 5000,
    include: { operacao: { select: { id: true, usuarioId: true, usuario: true, inicio: true, descricao: true, origem: true } } },
  });
}
type Evento = Awaited<ReturnType<typeof eventosDe>>[number];
const evid = (e: Evento, texto?: string): Evidencia => ({ rotulo: texto ?? `${quando(e.quando)} · ${e.operacao.usuario}${e.operacao.descricao ? ` · ${e.operacao.descricao.slice(0, 100)}` : ''}`, link: linkRegistro(e.tabela, e.registroId, lerJson(e.depois) ?? lerJson(e.antes)), operacaoId: e.operacaoId });

// -------------------------------------------------------------------------------------------------
// 1. exclusões e cancelamentos
// -------------------------------------------------------------------------------------------------
const exclusoes: Agente = {
  codigo: 'exclusoes',
  nome: 'Vigia de exclusões e cancelamentos',
  descricao: 'Venda, OS, compra, conta, lançamento de caixa, contato ou produto excluídos; venda ou OS canceladas (pior: já com pagamento, ou criada e cancelada na hora).',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const TAB = ['Venda', 'OrdemServico', 'Compra', 'ContaReceber', 'ContaPagar', 'MovimentoFinanceiro', 'Contato', 'Produto', 'Consignacao', 'Emprestimo', 'Carne'];
    const excl = (await eventosDe(ctx, TAB, ['EXCLUIR'])).filter((e) => e.modo === 'DIRETO');
    for (const e of excl) {
      const snap = lerJson(e.antes);
      const total = Number(snap?.total ?? snap?.valor ?? 0);
      const dinheiro = ['Venda', 'OrdemServico', 'Compra', 'MovimentoFinanceiro', 'ContaReceber', 'ContaPagar'].includes(e.tabela);
      out.push({
        chave: `excl:${e.tabela}:${e.registroId ?? e.id}`,
        nivel: dinheiro && total >= 1000 ? 'alto' : dinheiro ? 'medio' : 'baixo',
        categoria: e.tabela === 'Produto' ? 'estoque' : e.tabela === 'Contato' ? 'cadastros' : ['ContaReceber', 'ContaPagar', 'MovimentoFinanceiro'].includes(e.tabela) ? 'financeiro' : e.tabela === 'OrdemServico' ? 'os' : e.tabela === 'Compra' ? 'compras' : 'vendas',
        titulo: `${rotuloRegistro(e.tabela, e.registroId, e.registroChave, snap)} excluíd${/^(Venda|OrdemServico|ContaReceber|ContaPagar|Consignacao)$/.test(e.tabela) ? 'a' : 'o'} por ${e.operacao.usuario}`,
        explicacao: `Excluir apaga o registro de vez (o painel guarda o conteúdo e permite reverter). ${dinheiro ? 'Confira se havia dinheiro ou estoque envolvido e se a exclusão foi combinada.' : 'Confira se foi de propósito.'}`,
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: e.tabela,
        registroId: e.registroId,
      });
    }
    // cancelamentos de venda/OS
    const alt = await eventosDe(ctx, ['Venda', 'OrdemServico'], ['ALTERAR']);
    for (const e of alt) {
      if (!camposDe(e.campos).includes('situacaoId')) continue;
      const depois = lerJson(e.depois);
      const sit = ctx.situacoes.get(Number(depois?.situacaoId));
      if (!sit?.cancelamento) continue;
      const criadaHa = depois?.criadoEm ? (e.quando.getTime() - new Date(String(depois.criadoEm)).getTime()) / 60000 : null;
      const rapida = criadaHa !== null && criadaHa >= 0 && criadaHa <= 60;
      let recebeu = 0;
      if (e.tabela === 'Venda' && e.registroId) {
        const mov = await db().movimentoFinanceiro.aggregate({ _sum: { valor: true }, where: { tipo: 'ENTRADA', contaReceber: { origemTipo: 'VENDA', origemId: e.registroId } } });
        recebeu = mov._sum.valor ?? 0;
      }
      out.push({
        chave: `cancel:${e.tabela}:${e.registroId}`,
        nivel: recebeu > 0 ? 'alto' : rapida ? 'medio' : 'baixo',
        categoria: e.tabela === 'Venda' ? 'vendas' : 'os',
        titulo: `${rotuloRegistro(e.tabela, e.registroId, null, depois)} cancelad${e.tabela === 'Venda' ? 'a' : 'a'} por ${e.operacao.usuario}${rapida ? ` ${Math.round(criadaHa!)} min depois de criada` : ''}${recebeu > 0 ? ` — já tinha ${moeda(recebeu)} recebido` : ''}`,
        explicacao: recebeu > 0 ? 'Cancelou depois de receber dinheiro: confira se o valor foi devolvido ao cliente ou se o lançamento ficou no caixa.' : rapida ? 'Criar e cancelar em seguida pode ser teste, erro de digitação ou algo a esconder. Vale uma olhada.' : 'Cancelamento registrado. Confira o motivo com quem fez.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: e.tabela,
        registroId: e.registroId,
      });
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 2. preços e descontos
// -------------------------------------------------------------------------------------------------
const descontos: Agente = {
  codigo: 'descontos',
  nome: 'Detetive de preços e descontos',
  descricao: 'Item vendido abaixo do custo, desconto acima do limite, valores mexidos em venda já fechada, preço de produto baixado e subido de novo.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const itens = await eventosDe(ctx, ['VendaItem'], ['CRIAR', 'ALTERAR']);
    const vendasIds = [...new Set(itens.map((e) => Number((lerJson(e.depois) ?? {}).vendaId)).filter(Boolean))];
    const vendas = vendasIds.length ? await db().venda.findMany({ where: { id: { in: vendasIds } }, select: { id: true, numero: true, tipo: true, total: true, situacaoId: true, vendedorId: true, criadoEm: true } }) : [];
    const mapaVenda = new Map(vendas.map((v) => [v.id, v]));
    for (const e of itens) {
      const d = lerJson(e.depois);
      if (!d || d.vendaId === undefined) continue;
      const v = mapaVenda.get(Number(d.vendaId));
      if (!v || v.tipo === 'ORCAMENTO') continue;
      const preco = Number(d.valorUnitario ?? 0);
      const custo = Number(d.custoUnitario ?? 0);
      const link = `/vendas/${v.id}`;
      if (custo > 0 && preco > 0 && preco < custo * 0.98) {
        out.push({
          chave: `abaixoCusto:VendaItem:${e.registroId}`,
          nivel: 'alto',
          categoria: 'vendas',
          titulo: `Venda nº ${v.numero}: "${String(d.descricao ?? '').slice(0, 50)}" vendido por ${moeda(preco)} com custo ${moeda(custo)} (${e.operacao.usuario})`,
          explicacao: 'Preço abaixo do custo informado: ou o custo está errado, ou a venda deu prejuízo. Confira o custo no produto e o motivo do preço.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'Venda',
          registroId: v.id,
        });
      }
      const bruto = preco * Number(d.quantidade ?? 1);
      const desc = Number(d.desconto ?? 0);
      if (bruto > 0 && desc / bruto > ctx.cfg.descontoMaxPct / 100 && desc >= 20) {
        out.push({
          chave: `descItem:VendaItem:${e.registroId}`,
          nivel: desc / bruto > 0.4 ? 'alto' : 'medio',
          categoria: 'vendas',
          titulo: `Venda nº ${v.numero}: desconto de ${Math.round((desc / bruto) * 100)}% (${moeda(desc)}) em "${String(d.descricao ?? '').slice(0, 40)}" por ${e.operacao.usuario}`,
          explicacao: `Acima do limite de ${ctx.cfg.descontoMaxPct}% configurado no painel. Confira se foi autorizado.`,
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'Venda',
          registroId: v.id,
        });
      }
      // valor mexido em venda já fechada (a situação atual é final e a alteração veio depois do fechamento)
      if (e.tipo === 'ALTERAR') {
        const campos = camposDe(e.campos);
        const mexeu = campos.some((c) => ['valorUnitario', 'desconto', 'total', 'quantidade'].includes(c));
        const sit = ctx.situacoes.get(v.situacaoId);
        if (mexeu && sit?.final && !sit.cancelamento) {
          const fechamento = await db().historicoSituacao.findFirst({ where: { entidadeTipo: 'VENDA', entidadeId: v.id, paraSituacaoId: v.situacaoId }, orderBy: { id: 'desc' }, select: { data: true } });
          if (fechamento && e.quando.getTime() > fechamento.data.getTime() + 60_000) {
            const a = lerJson(e.antes);
            out.push({
              chave: `editFechada:VendaItem:${e.registroId}:${e.operacaoId}`,
              nivel: 'alto',
              categoria: 'vendas',
              titulo: `Venda nº ${v.numero} (já ${sit.nome.toLowerCase()}) teve valores alterados por ${e.operacao.usuario}: ${campos.filter((c) => ['valorUnitario', 'desconto', 'total', 'quantidade'].includes(c)).map((c) => `${c} ${a?.[c]} → ${d[c]}`).join(', ')}`,
              explicacao: 'Mexer em valor depois de fechar a venda muda o que foi cobrado, a comissão e o DRE. Se não foi combinado, reverta a operação.',
              evidencias: [evid(e)],
              usuarioId: e.operacao.usuarioId,
              usuario: e.operacao.usuario,
              operacaoId: e.operacaoId,
              tabela: 'Venda',
              registroId: v.id,
            });
          }
        }
      }
      void link;
    }
    // desconto geral da venda
    const vendasEv = await eventosDe(ctx, ['Venda'], ['CRIAR', 'ALTERAR']);
    const vistos = new Set<number>();
    for (const e of vendasEv) {
      const d = lerJson(e.depois);
      if (!d || d.tipo === 'ORCAMENTO' || !e.registroId || vistos.has(e.registroId)) continue;
      const bruto = Number(d.totalProdutos ?? 0);
      const desc = d.descontoTipo === 'PERCENTUAL' ? (bruto * Number(d.descontoValor ?? 0)) / 100 : Number(d.descontoValor ?? 0);
      if (bruto > 0 && desc / bruto > ctx.cfg.descontoMaxPct / 100 && desc >= 20) {
        vistos.add(e.registroId);
        out.push({
          chave: `descVenda:Venda:${e.registroId}`,
          nivel: desc / bruto > 0.4 ? 'alto' : 'medio',
          categoria: 'vendas',
          titulo: `Venda nº ${d.numero}: desconto geral de ${Math.round((desc / bruto) * 100)}% (${moeda(desc)}) por ${e.operacao.usuario}`,
          explicacao: `Acima do limite de ${ctx.cfg.descontoMaxPct}% configurado no painel. Confira se foi autorizado.`,
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'Venda',
          registroId: e.registroId,
        });
      }
    }
    // preço do produto baixado e depois subido (dentro da janela)
    const precos = (await eventosDe(ctx, ['Produto'], ['ALTERAR'])).filter((e) => camposDe(e.campos).includes('preco'));
    const porProduto = new Map<number, Evento[]>();
    for (const e of precos) if (e.registroId) porProduto.set(e.registroId, [...(porProduto.get(e.registroId) ?? []), e]);
    for (const [produtoId, lista] of porProduto) {
      for (let i = 0; i < lista.length - 1; i++) {
        const a = lerJson(lista[i].antes), d = lerJson(lista[i].depois);
        const d2 = lerJson(lista[i + 1].depois);
        const p0 = Number(a?.preco), p1 = Number(d?.preco), p2 = Number(d2?.preco);
        if (p0 > 0 && p1 < p0 * 0.7 && p2 >= p0 * 0.95 && lista[i + 1].quando.getTime() - lista[i].quando.getTime() < 48 * 3600_000) {
          out.push({
            chave: `precoVaiVolta:Produto:${produtoId}:${lista[i].id}`,
            nivel: 'medio',
            categoria: 'estoque',
            titulo: `Produto "${String(d?.nome ?? '').slice(0, 40)}": preço de ${moeda(p0)} baixado para ${moeda(p1)} e voltado para ${moeda(p2)} (${lista[i].operacao.usuario})`,
            explicacao: 'Baixar o preço, vender e subir de novo é um jeito de dar desconto sem aparecer como desconto. Confira as vendas desse produto nesse intervalo.',
            evidencias: [evid(lista[i]), evid(lista[i + 1])],
            usuarioId: lista[i].operacao.usuarioId,
            usuario: lista[i].operacao.usuario,
            operacaoId: lista[i].operacaoId,
            tabela: 'Produto',
            registroId: produtoId,
          });
        }
      }
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 3. caixa e bancos
// -------------------------------------------------------------------------------------------------
const dinheiro: Agente = {
  codigo: 'dinheiro',
  nome: 'Guardião do caixa',
  descricao: 'Saída manual de caixa/banco, valor de conta a receber reduzido, recebimento estornado, saldo inicial ajustado, entrada e saída iguais em minutos.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const movs = await eventosDe(ctx, ['MovimentoFinanceiro'], ['CRIAR']);
    const porConta = new Map<number, Evento[]>();
    for (const e of movs) {
      const d = lerJson(e.depois);
      if (!d) continue;
      porConta.set(Number(d.contaFinanceiraId), [...(porConta.get(Number(d.contaFinanceiraId)) ?? []), e]);
      if (d.tipo === 'SAIDA' && !d.contaPagarId && !d.caixinhaId && !d.transacaoId && e.operacao.origem !== 'SERVICO') {
        const valor = Number(d.valor ?? 0);
        out.push({
          chave: `saidaManual:MovimentoFinanceiro:${e.registroId}`,
          nivel: valor >= ctx.cfg.saidaManualAlerta ? 'alto' : valor >= ctx.cfg.saidaManualAlerta / 5 ? 'medio' : 'baixo',
          categoria: 'financeiro',
          titulo: `Saída manual de ${moeda(valor)} "${String(d.descricao ?? '').slice(0, 50)}" lançada por ${e.operacao.usuario}`,
          explicacao: 'Dinheiro saindo sem conta a pagar nem caixinha por trás. Confira o comprovante e o motivo.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'MovimentoFinanceiro',
          registroId: e.registroId,
        });
      }
    }
    // entrada e saída do mesmo valor na mesma conta em até 30 min
    for (const [, lista] of porConta) {
      for (const a of lista) {
        const da = lerJson(a.depois);
        if (da?.tipo !== 'ENTRADA') continue;
        const par = lista.find((b) => {
          const dbb = lerJson(b.depois);
          return dbb?.tipo === 'SAIDA' && Math.abs(Number(dbb.valor) - Number(da.valor)) < 0.01 && Math.abs(b.quando.getTime() - a.quando.getTime()) < 30 * 60_000 && Number(da.valor) >= 100;
        });
        if (par) {
          out.push({
            chave: `vaiVem:MovimentoFinanceiro:${a.registroId}:${par.registroId}`,
            nivel: 'baixo',
            categoria: 'financeiro',
            titulo: `${moeda(Number(da.valor))} entrou e saiu da mesma conta em menos de 30 min (${a.operacao.usuario})`,
            explicacao: 'Pode ser estorno legítimo, troco ou correção — ou dinheiro passando pelo caixa sem ficar. Vale conferir as duas descrições.',
            evidencias: [evid(a), evid(par)],
            usuarioId: a.operacao.usuarioId,
            usuario: a.operacao.usuario,
            operacaoId: a.operacaoId,
            tabela: 'MovimentoFinanceiro',
            registroId: a.registroId,
          });
        }
      }
    }
    const contas = await eventosDe(ctx, ['ContaReceber', 'ContaPagar'], ['ALTERAR']);
    for (const e of contas) {
      const a = lerJson(e.antes), d = lerJson(e.depois);
      if (!a || !d) continue;
      const campos = camposDe(e.campos);
      if (campos.includes('valor') && Number(d.valor) < Number(a.valor) - 0.01) {
        out.push({
          chave: `reduz:${e.tabela}:${e.registroId}:${e.operacaoId}`,
          nivel: Number(a.valor) - Number(d.valor) >= 200 ? 'medio' : 'baixo',
          categoria: 'financeiro',
          titulo: `${rotuloRegistro(e.tabela, e.registroId, null, d)} teve o valor reduzido de ${moeda(Number(a.valor))} para ${moeda(Number(d.valor))} por ${e.operacao.usuario}`,
          explicacao: 'Reduzir o valor de uma conta muda o que o cliente deve (ou o que a loja paga). Confira a justificativa.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: e.tabela,
          registroId: e.registroId,
        });
      }
      if (campos.includes('situacao') && /RECEBID|PAG/i.test(String(a.situacao)) && /ABERT|PEND|ATRAS/i.test(String(d.situacao)) && e.operacao.origem !== 'SERVICO') {
        out.push({
          chave: `estorno:${e.tabela}:${e.registroId}:${e.operacaoId}`,
          nivel: 'medio',
          categoria: 'financeiro',
          titulo: `${rotuloRegistro(e.tabela, e.registroId, null, d)} estornada (${a.situacao} → ${d.situacao}) por ${e.operacao.usuario}`,
          explicacao: 'Um estorno tira dinheiro do caixa/banco. Confira se o dinheiro realmente voltou ou se foi só correção de lançamento.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: e.tabela,
          registroId: e.registroId,
        });
      }
    }
    const saldos = (await eventosDe(ctx, ['ContaFinanceira'], ['ALTERAR'])).filter((e) => camposDe(e.campos).includes('saldoInicial'));
    for (const e of saldos) {
      const a = lerJson(e.antes), d = lerJson(e.depois);
      out.push({
        chave: `saldoInicial:ContaFinanceira:${e.registroId}:${e.operacaoId}`,
        nivel: 'medio',
        categoria: 'financeiro',
        titulo: `Saldo inicial da conta ${d?.nome ?? ''} ajustado de ${moeda(Number(a?.saldoInicial))} para ${moeda(Number(d?.saldoInicial))} por ${e.operacao.usuario}`,
        explicacao: 'Ajustar o saldo inicial muda o saldo de todas as datas sem lançamento. É legítimo para "bater" o saldo, mas também esconde diferenças. Confira com o extrato.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: 'ContaFinanceira',
        registroId: e.registroId,
      });
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 4. estoque
// -------------------------------------------------------------------------------------------------
const estoque: Agente = {
  codigo: 'estoque',
  nome: 'Fiscal de estoque',
  descricao: 'Ajustes manuais de estoque (muitos no dia, ou grandes), saldo negativo, produto excluído com saldo.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const ajustes = (await eventosDe(ctx, ['MovimentoEstoque'], ['CRIAR'])).filter((e) => /AJUSTE|BALANCO|MANUAL/i.test(String(lerJson(e.depois)?.tipo ?? '')) || /AJUSTE|MANUAL/i.test(String(lerJson(e.depois)?.origemTipo ?? '')));
    const porDia = new Map<string, Evento[]>();
    const idsProd = [...new Set(ajustes.map((e) => Number(lerJson(e.depois)?.produtoId)).filter(Boolean))];
    const nomes = new Map((idsProd.length ? await db().produto.findMany({ where: { id: { in: idsProd } }, select: { id: true, nome: true } }) : []).map((p) => [p.id, p.nome]));
    for (const e of ajustes) {
      const d = lerJson(e.depois)!;
      const k = `${e.operacao.usuarioId ?? e.operacao.usuario}:${diaSP(e.quando)}`;
      porDia.set(k, [...(porDia.get(k) ?? []), e]);
      const valor = Math.abs(Number(d.quantidade ?? 0)) * Number(d.custoUnitario ?? 0);
      if (Math.abs(Number(d.quantidade ?? 0)) >= 5 || valor >= 1000) {
        out.push({
          chave: `ajusteGrande:MovimentoEstoque:${e.registroId}`,
          nivel: valor >= 3000 ? 'alto' : 'medio',
          categoria: 'estoque',
          titulo: `Ajuste de estoque de ${d.quantidade} un. (${moeda(valor)}) em "${(nomes.get(Number(d.produtoId)) ?? '#' + d.produtoId).slice(0, 40)}" por ${e.operacao.usuario}`,
          explicacao: 'Ajuste manual grande: estoque entrando ou saindo sem compra nem venda. Confira a contagem física.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'Produto',
          registroId: Number(d.produtoId) || null,
        });
      }
    }
    for (const [k, lista] of porDia) {
      if (lista.length < 4) continue;
      out.push({
        chave: `muitosAjustes:${k}`,
        nivel: 'medio',
        categoria: 'estoque',
        titulo: `${lista[0].operacao.usuario} fez ${lista.length} ajustes manuais de estoque em ${diaSP(lista[0].quando).split('-').reverse().join('/')}`,
        explicacao: 'Muitos ajustes no mesmo dia: pode ser balanço, ou estoque sendo "acertado" na mão com frequência.',
        evidencias: lista.slice(0, 6).map((e) => evid(e)),
        usuarioId: lista[0].operacao.usuarioId,
        usuario: lista[0].operacao.usuario,
      });
    }
    const negativos = await db().estoqueSaldo.findMany({ where: { saldo: { lt: 0 } }, include: { produto: { select: { nome: true } } }, take: 50 });
    for (const s of negativos) {
      out.push({
        chave: `negativo:EstoqueSaldo:${s.id}`,
        nivel: 'baixo',
        categoria: 'estoque',
        titulo: `Estoque negativo (${s.saldo}) em "${s.produto?.nome ?? '#' + s.produtoId}"`,
        explicacao: 'Vendeu mais do que tinha no sistema: ou faltou dar entrada na compra, ou saiu produto sem registro.',
        evidencias: [{ rotulo: 'Abrir produto', link: `/produtos/${s.produtoId}` }],
        tabela: 'Produto',
        registroId: s.produtoId,
        transitorio: true,
      });
    }
    const prodExcl = (await eventosDe(ctx, ['Produto'], ['EXCLUIR'])).filter((e) => e.modo === 'DIRETO');
    for (const e of prodExcl) {
      const saldos = await db().auditoriaEvento.findMany({ where: { operacaoId: e.operacaoId, tabela: 'EstoqueSaldo', tipo: 'EXCLUIR' }, select: { antes: true } });
      const total = saldos.reduce((s, x) => s + Number(lerJson(x.antes)?.saldo ?? 0), 0);
      if (total > 0) {
        out.push({
          chave: `prodExclComEstoque:Produto:${e.registroId}`,
          nivel: 'alto',
          categoria: 'estoque',
          titulo: `Produto "${String(lerJson(e.antes)?.nome ?? '').slice(0, 40)}" excluído com ${total} un. em estoque por ${e.operacao.usuario}`,
          explicacao: 'O saldo sumiu junto com o produto. Se foi engano, reverta a operação — o produto e o estoque voltam.',
          evidencias: [evid(e)],
          usuarioId: e.operacao.usuarioId,
          usuario: e.operacao.usuario,
          operacaoId: e.operacaoId,
          tabela: 'Produto',
          registroId: e.registroId,
        });
      }
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 5. horários e acessos
// -------------------------------------------------------------------------------------------------
const horarios: Agente = {
  codigo: 'horarios',
  nome: 'Sentinela de horários e acessos',
  descricao: 'Gravações fora do horário da loja ou no domingo, logins de vários IPs, senha errada no painel, perfil/senha de usuário alterados.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const ops = await db().auditoriaOperacao.findMany({
      where: { inicio: { gte: ctx.desde, lte: ctx.ate }, origem: 'TELA', usuarioId: { not: null }, eventos: { some: {} } },
      select: { id: true, inicio: true, usuarioId: true, usuario: true, categoria: true, descricao: true },
      take: 10000,
    });
    const fora = new Map<string, typeof ops>();
    for (const o of ops) {
      const { hora, domingo } = horaSP(o.inicio);
      if (domingo || hora < ctx.cfg.horaInicio || hora >= ctx.cfg.horaFim) {
        const k = `${o.usuarioId}:${diaSP(o.inicio)}`;
        fora.set(k, [...(fora.get(k) ?? []), o]);
      }
    }
    for (const [k, lista] of fora) {
      const grave = lista.some((o) => ['financeiro', 'vendas', 'fiscal', 'estoque'].includes(o.categoria));
      out.push({
        chave: `foraHora:${k}`,
        nivel: grave ? 'medio' : 'baixo',
        categoria: 'acessos',
        titulo: `${lista[0].usuario} gravou ${lista.length} operação(ões) fora do horário (${diaSP(lista[0].inicio).split('-').reverse().join('/')}, ${horaSP(lista[0].inicio).domingo ? 'domingo' : `${horaSP(lista[0].inicio).hora}h`})`,
        explicacao: `Horário da loja configurado: ${ctx.cfg.horaInicio}h às ${ctx.cfg.horaFim}h, segunda a sábado. Fora disso pode ser trabalho de casa — ou acesso que não deveria existir.`,
        evidencias: lista.slice(0, 6).map((o) => ({ rotulo: `${quando(o.inicio)} · ${o.descricao?.slice(0, 100) ?? o.categoria}`, operacaoId: o.id })),
        usuarioId: lista[0].usuarioId,
        usuario: lista[0].usuario,
      });
    }
    const logins = await db().auditoria.findMany({ where: { acao: 'LOGIN', data: { gte: ctx.desde, lte: ctx.ate } }, select: { usuarioId: true, ip: true, data: true, usuario: { select: { nome: true } } }, take: 5000 });
    const porUsuarioDia = new Map<string, { nome: string; ips: Set<string>; n: number; usuarioId: number | null }>();
    for (const l of logins) {
      const k = `${l.usuarioId}:${diaSP(l.data)}`;
      const r = porUsuarioDia.get(k) ?? { nome: l.usuario?.nome ?? '?', ips: new Set<string>(), n: 0, usuarioId: l.usuarioId };
      if (l.ip) r.ips.add(l.ip);
      r.n++;
      porUsuarioDia.set(k, r);
    }
    for (const [k, r] of porUsuarioDia) {
      if (r.ips.size >= 3 || r.n >= 12) {
        out.push({
          chave: `logins:${k}`,
          nivel: r.ips.size >= 3 ? 'medio' : 'baixo',
          categoria: 'acessos',
          titulo: `${r.nome}: ${r.n} logins de ${r.ips.size} endereço(s) diferente(s) em ${k.split(':')[1].split('-').reverse().join('/')}`,
          explicacao: 'Vários lugares no mesmo dia pode ser celular + loja + casa — ou a senha sendo usada por mais de uma pessoa.',
          evidencias: [{ rotulo: `IPs: ${[...r.ips].join(', ')}` }],
          usuarioId: r.usuarioId,
          usuario: r.nome,
        });
      }
    }
    const tentativas = await db().auditoria.findMany({ where: { entidade: 'PainelAuditoria', acao: 'ACAO', data: { gte: ctx.desde, lte: ctx.ate } }, select: { detalhes: true, data: true, ip: true, usuarioId: true, usuario: { select: { nome: true } } } });
    const erradas = tentativas.filter((t) => lerJson(t.detalhes)?.ok === false);
    const porDia = new Map<string, typeof erradas>();
    for (const t of erradas) porDia.set(`${t.usuarioId}:${diaSP(t.data)}`, [...(porDia.get(`${t.usuarioId}:${diaSP(t.data)}`) ?? []), t]);
    for (const [k, lista] of porDia) {
      if (lista.length < 3) continue;
      out.push({
        chave: `painelSenha:${k}`,
        nivel: 'alto',
        categoria: 'acessos',
        titulo: `${lista[0].usuario?.nome ?? 'Alguém'} errou a senha do Painel de auditoria ${lista.length} vezes em ${k.split(':')[1].split('-').reverse().join('/')}`,
        explicacao: 'Tentativas repetidas de abrir o painel. Se não foi você, troque o prefixo da senha nas configurações do painel.',
        evidencias: lista.slice(0, 5).map((t) => ({ rotulo: `${quando(t.data)} · IP ${t.ip ?? '?'}` })),
        usuarioId: lista[0].usuarioId,
        usuario: lista[0].usuario?.nome,
      });
    }
    const usuarios = await eventosDe(ctx, ['Usuario'], ['ALTERAR', 'CRIAR', 'EXCLUIR']);
    for (const e of usuarios) {
      const campos = camposDe(e.campos);
      const sensivel = e.tipo !== 'ALTERAR' || campos.some((c) => ['perfil', 'senhaHash', 'ativo', 'email'].includes(c));
      if (!sensivel) continue;
      const d = lerJson(e.depois) ?? lerJson(e.antes);
      const proprio = e.registroId === e.operacao.usuarioId && campos.includes('perfil');
      out.push({
        chave: `usuario:${e.tabela}:${e.registroId}:${e.operacaoId}`,
        nivel: proprio ? 'alto' : 'medio',
        categoria: 'acessos',
        titulo: `${e.operacao.usuario} ${e.tipo === 'CRIAR' ? 'criou' : e.tipo === 'EXCLUIR' ? 'excluiu' : 'alterou'} o usuário ${d?.nome ?? '#' + e.registroId}${e.tipo === 'ALTERAR' ? ` (${campos.filter((c) => c !== 'atualizadoEm').map((c) => (c === 'senhaHash' ? 'senha' : c)).join(', ')})` : ''}${proprio ? ' — o próprio perfil' : ''}`,
        explicacao: 'Mudança em acesso ao sistema. Só o ADMIN pode fazer isso; confira se foi você.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: 'Usuario',
        registroId: e.registroId,
      });
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 6. comissões e metas
// -------------------------------------------------------------------------------------------------
const comissoes: Agente = {
  codigo: 'comissoes',
  nome: 'Auditor de comissões e metas',
  descricao: 'Venda transferida de vendedor (pior: para si mesmo ou no fim do mês), comissão mexida por quem a recebe, percentual ou meta alterados.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const usuarios = await db().usuario.findMany({ select: { id: true, vendedorId: true, tecnicoId: true, nome: true } });
    const vendedorDoUsuario = new Map(usuarios.map((u) => [u.id, u.vendedorId]));
    const transf = (await eventosDe(ctx, ['Venda'], ['ALTERAR'])).filter((e) => camposDe(e.campos).includes('vendedorId') && lerJson(e.antes)?.vendedorId);
    for (const e of transf) {
      const a = lerJson(e.antes)!, d = lerJson(e.depois)!;
      const paraSi = e.operacao.usuarioId !== null && vendedorDoUsuario.get(e.operacao.usuarioId!) === Number(d.vendedorId);
      const dia = Number(diaSP(e.quando).slice(-2));
      const fimMes = dia >= 27;
      out.push({
        chave: `transfVendedor:Venda:${e.registroId}:${e.operacaoId}`,
        nivel: paraSi ? 'alto' : fimMes ? 'medio' : 'baixo',
        categoria: 'comissoes',
        titulo: `Venda nº ${d.numero} transferida do vendedor #${a.vendedorId} para #${d.vendedorId} por ${e.operacao.usuario}${paraSi ? ' — para si mesmo' : ''}${fimMes ? ' (fim do mês)' : ''}`,
        explicacao: 'Transferir venda muda comissão, meta e ranking. Para si mesmo ou perto do fechamento do mês merece conferência.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: 'Venda',
        registroId: e.registroId,
      });
    }
    const com = (await eventosDe(ctx, ['Comissao'], ['ALTERAR', 'EXCLUIR'])).filter((e) => e.modo === 'DIRETO');
    for (const e of com) {
      const a = lerJson(e.antes) ?? {}, d = lerJson(e.depois) ?? a;
      const campos = camposDe(e.campos);
      if (e.tipo === 'ALTERAR' && !campos.some((c) => ['valor', 'pct', 'base', 'status', 'vendedorId', 'tecnicoId'].includes(c))) continue;
      const propria = e.operacao.usuarioId !== null && (vendedorDoUsuario.get(e.operacao.usuarioId!) === Number(d.vendedorId) || usuarios.find((u) => u.id === e.operacao.usuarioId)?.tecnicoId === Number(d.tecnicoId));
      out.push({
        chave: `comissao:Comissao:${e.registroId}:${e.operacaoId}`,
        nivel: propria ? 'alto' : 'medio',
        categoria: 'comissoes',
        titulo: `Comissão ${e.tipo === 'EXCLUIR' ? 'excluída' : `alterada (${campos.join(', ')})`} por ${e.operacao.usuario}${propria ? ' — a própria comissão' : ''}: ${moeda(Number(a.valor))}${e.tipo === 'ALTERAR' && campos.includes('valor') ? ` → ${moeda(Number(d.valor))}` : ''}`,
        explicacao: 'Comissão é dinheiro do funcionário: alteração manual deve ter motivo claro. Se foi a própria pessoa, é grave.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: 'Comissao',
        registroId: e.registroId,
      });
    }
    const metas = await eventosDe(ctx, ['Vendedor', 'MetaVendedor', 'MetaTecnico', 'Desafio'], ['ALTERAR', 'CRIAR', 'EXCLUIR']);
    for (const e of metas) {
      const campos = camposDe(e.campos);
      if (e.tipo === 'ALTERAR' && !campos.some((c) => /comissao|meta|valor|premio|alvo|pct/i.test(c))) continue;
      // cadastrar/excluir um vendedor é rotina do ADMIN; o que interessa é mexer em comissão/meta
      if (e.tabela === 'Vendedor' && e.tipo !== 'ALTERAR') continue;
      const d = lerJson(e.depois) ?? lerJson(e.antes) ?? {};
      out.push({
        chave: `meta:${e.tabela}:${e.registroId}:${e.operacaoId}`,
        nivel: 'baixo',
        categoria: 'comissoes',
        titulo: `${e.operacao.usuario} ${e.tipo === 'CRIAR' ? 'criou' : e.tipo === 'EXCLUIR' ? 'excluiu' : 'alterou'} ${rotuloRegistro(e.tabela, e.registroId, null, d)}${e.tipo === 'ALTERAR' ? ` (${campos.filter((c) => c !== 'atualizadoEm').join(', ')})` : ''}`,
        explicacao: 'Metas, percentuais de comissão e prêmios de desafio mudam o que a equipe recebe. Registrado para conferência.',
        evidencias: [evid(e)],
        usuarioId: e.operacao.usuarioId,
        usuario: e.operacao.usuario,
        operacaoId: e.operacaoId,
        tabela: e.tabela,
        registroId: e.registroId,
      });
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 7. inconsistências
// -------------------------------------------------------------------------------------------------
const consistencia: Agente = {
  codigo: 'consistencia',
  nome: 'Caçador de inconsistências',
  descricao: 'Operação que gravou e terminou em erro, venda com total diferente dos itens, venda duplicada, conta recebida sem dinheiro no caixa, registro mexido muitas vezes no dia.',
  janelaDias: 7,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const comErro = await db().auditoriaOperacao.findMany({ where: { inicio: { gte: ctx.desde, lte: ctx.ate }, status: { gte: 500 }, eventos: { some: {} } }, select: { id: true, inicio: true, usuario: true, usuarioId: true, descricao: true, rota: true }, take: 200 });
    for (const o of comErro) {
      out.push({
        chave: `erro:${o.id}`,
        nivel: 'medio',
        categoria: 'sistema',
        titulo: `Operação de ${o.usuario} gravou dados e terminou com erro (${o.rota ?? '?'})`,
        explicacao: 'Parte da gravação pode ter ficado pela metade (ex.: venda salva sem contas). Abra a operação, confira o que foi gravado e reverta se for lixo.',
        evidencias: [{ rotulo: `${quando(o.inicio)} · ${o.descricao?.slice(0, 120) ?? ''}`, operacaoId: o.id }],
        usuarioId: o.usuarioId,
        usuario: o.usuario,
        operacaoId: o.id,
      });
    }
    // total ≠ itens (vendas dos últimos 30 dias)
    const d30 = new Date(ctx.ate.getTime() - 30 * 86400_000);
    const vendas = await db().venda.findMany({ where: { tipo: 'PEDIDO', data: { gte: d30 } }, select: { id: true, numero: true, total: true, totalProdutos: true, descontoTipo: true, descontoValor: true, frete: true, outrasDespesas: true, contatoId: true, criadoEm: true, situacaoId: true, itens: { select: { total: true } } }, take: 3000 });
    for (const v of vendas) {
      const itens = v.itens.reduce((s, i) => s + i.total, 0);
      const desconto = v.descontoTipo === 'PERCENTUAL' ? (itens * v.descontoValor) / 100 : v.descontoValor;
      const esperado = itens - desconto + v.frete + v.outrasDespesas;
      if (Math.abs(esperado - v.total) > 0.05 && v.itens.length) {
        out.push({
          chave: `totalDiferente:Venda:${v.id}`,
          nivel: Math.abs(esperado - v.total) >= 50 ? 'alto' : 'medio',
          categoria: 'vendas',
          titulo: `Venda nº ${v.numero}: total ${moeda(v.total)} não bate com os itens (${moeda(esperado)})`,
          explicacao: 'Total gravado diferente da soma dos itens − desconto + frete + outras despesas. Abra a venda e salve de novo, ou veja na trilha quem alterou o total.',
          evidencias: [{ rotulo: 'Abrir venda', link: `/vendas/${v.id}` }],
          tabela: 'Venda',
          registroId: v.id,
          transitorio: true,
        });
      }
    }
    // duplicadas: mesmo cliente, mesmo total, até 10 min
    const ordenadas = [...vendas].sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime());
    for (let i = 0; i < ordenadas.length; i++) {
      for (let j = i + 1; j < ordenadas.length; j++) {
        const a = ordenadas[i], b = ordenadas[j];
        if (b.criadoEm.getTime() - a.criadoEm.getTime() > 10 * 60_000) break;
        const sitB = ctx.situacoes.get(b.situacaoId);
        if (a.contatoId === b.contatoId && Math.abs(a.total - b.total) < 0.01 && a.total > 0 && !sitB?.cancelamento) {
          out.push({
            chave: `duplicada:Venda:${a.id}:${b.id}`,
            nivel: 'medio',
            categoria: 'vendas',
            titulo: `Vendas nº ${a.numero} e nº ${b.numero}: mesmo cliente, mesmo valor (${moeda(a.total)}), ${Math.round((b.criadoEm.getTime() - a.criadoEm.getTime()) / 60000)} min de diferença`,
            explicacao: 'Parece venda duplicada (clique duplo, PDV + sistema). Se uma delas sobra, cancele ou reverta a criação.',
            evidencias: [{ rotulo: `Venda nº ${a.numero}`, link: `/vendas/${a.id}` }, { rotulo: `Venda nº ${b.numero}`, link: `/vendas/${b.id}` }],
            tabela: 'Venda',
            registroId: b.id,
            transitorio: true,
          });
        }
      }
    }
    // recebida sem dinheiro no caixa
    const recebidas = await db().contaReceber.findMany({ where: { situacao: { in: ['RECEBIDO', 'PARCIAL'] }, valorRecebido: { gt: 0 }, dataRecebimento: { gte: d30 }, lancamentos: { none: {} } }, select: { id: true, descricao: true, valorRecebido: true }, take: 100 }).catch(() => [] as { id: number; descricao: string; valorRecebido: number }[]);
    for (const c of recebidas) {
      out.push({
        chave: `recebidaSemCaixa:ContaReceber:${c.id}`,
        nivel: 'medio',
        categoria: 'financeiro',
        titulo: `Conta "${c.descricao.slice(0, 50)}" consta como recebida (${moeda(c.valorRecebido)}) sem lançamento em caixa/banco`,
        explicacao: 'O dinheiro foi marcado como recebido, mas não entrou em nenhuma conta. Ou foi baixa sem conta, ou o lançamento foi apagado.',
        evidencias: [{ rotulo: 'Contas a receber', link: '/financeiro/receber' }],
        tabela: 'ContaReceber',
        registroId: c.id,
        transitorio: true,
      });
    }
    // registro mexido muitas vezes no dia pela mesma pessoa
    const mexidos = await db().auditoriaEvento.groupBy({
      by: ['tabela', 'registroId'],
      where: { quando: { gte: ctx.desde, lte: ctx.ate }, tabela: { in: ['Venda', 'OrdemServico', 'ContaReceber', 'ContaPagar'] }, modo: 'DIRETO', operacao: { origem: 'TELA' } },
      _count: { _all: true },
      having: { registroId: { _count: { gte: 8 } } },
      orderBy: { registroId: 'asc' },
      take: 50,
    });
    for (const m of mexidos) {
      if (!m.registroId) continue;
      const ult = await db().auditoriaEvento.findFirst({ where: { tabela: m.tabela, registroId: m.registroId, quando: { gte: ctx.desde } }, orderBy: { id: 'desc' }, include: { operacao: { select: { usuario: true, usuarioId: true } } } });
      const snap = lerJson(ult?.depois ?? null) ?? lerJson(ult?.antes ?? null);
      out.push({
        chave: `churn:${m.tabela}:${m.registroId}:${diaSP(ctx.ate)}`,
        nivel: 'baixo',
        categoria: 'sistema',
        titulo: `${rotuloRegistro(m.tabela, m.registroId, null, snap)} foi alterad${/^(Venda|OrdemServico|ContaReceber|ContaPagar)$/.test(m.tabela) ? 'a' : 'o'} ${m._count._all} vezes em 7 dias (última: ${ult?.operacao.usuario ?? '?'})`,
        explicacao: 'Muitas idas e vindas no mesmo registro. Pode ser normal (OS longa) ou alguém "ajustando" valores aos poucos.',
        evidencias: [{ rotulo: 'Ver trilha do registro', link: linkRegistro(m.tabela, m.registroId, snap) }],
        tabela: m.tabela,
        registroId: m.registroId,
        usuarioId: ult?.operacao.usuarioId,
        usuario: ult?.operacao.usuario,
      });
    }
    return out;
  },
};

// -------------------------------------------------------------------------------------------------
// 8. padrões por funcionário (30 dias, comparado com a equipe)
// -------------------------------------------------------------------------------------------------
const padroes: Agente = {
  codigo: 'padroes',
  nome: 'Analista de padrões da equipe',
  descricao: 'Compara cada funcionário com a média da equipe nos últimos 30 dias: cancelamentos, exclusões, descontos, fora do horário, ajustes de estoque e saídas manuais.',
  janelaDias: 30,
  async rodar(ctx) {
    const out: AchadoNovo[] = [];
    const ops = await db().auditoriaOperacao.findMany({ where: { inicio: { gte: ctx.desde, lte: ctx.ate }, origem: 'TELA', usuarioId: { not: null } }, select: { id: true, usuarioId: true, usuario: true, inicio: true, categoria: true }, take: 50000 });
    if (!ops.length) return out;
    const eventos = await db().auditoriaEvento.findMany({
      where: { quando: { gte: ctx.desde, lte: ctx.ate }, operacao: { origem: 'TELA', usuarioId: { not: null } }, OR: [{ tabela: 'Venda' }, { tabela: 'VendaItem', tipo: 'CRIAR' }, { tabela: 'MovimentoEstoque', tipo: 'CRIAR' }, { tabela: 'MovimentoFinanceiro', tipo: 'CRIAR' }, { tipo: 'EXCLUIR', modo: 'DIRETO' }] },
      select: { tabela: true, tipo: true, campos: true, depois: true, antes: true, operacao: { select: { usuarioId: true } } },
      take: 50000,
    });
    type M = { nome: string; ops: number; vendas: number; cancel: number; excl: number; descItens: number; itens: number; fora: number; ajustes: number; saidas: number };
    const metricas = new Map<number, M>();
    const m = (id: number, nome: string) => {
      let r = metricas.get(id);
      if (!r) metricas.set(id, (r = { nome, ops: 0, vendas: 0, cancel: 0, excl: 0, descItens: 0, itens: 0, fora: 0, ajustes: 0, saidas: 0 }));
      return r;
    };
    for (const o of ops) {
      const r = m(o.usuarioId!, o.usuario);
      r.ops++;
      const { hora, domingo } = horaSP(o.inicio);
      if (domingo || hora < ctx.cfg.horaInicio || hora >= ctx.cfg.horaFim) r.fora++;
    }
    for (const e of eventos) {
      const uid = e.operacao.usuarioId!;
      const r = metricas.get(uid);
      if (!r) continue;
      const d = lerJson(e.depois);
      if (e.tabela === 'Venda' && e.tipo === 'CRIAR' && d?.tipo !== 'ORCAMENTO') r.vendas++;
      if (e.tabela === 'Venda' && e.tipo === 'ALTERAR' && camposDe(e.campos).includes('situacaoId') && ctx.situacoes.get(Number(d?.situacaoId))?.cancelamento) r.cancel++;
      if (e.tipo === 'EXCLUIR') r.excl++;
      if (e.tabela === 'VendaItem') {
        r.itens++;
        const bruto = Number(d?.valorUnitario ?? 0) * Number(d?.quantidade ?? 1);
        if (bruto > 0 && Number(d?.desconto ?? 0) / bruto > ctx.cfg.descontoMaxPct / 100) r.descItens++;
      }
      if (e.tabela === 'MovimentoEstoque' && /AJUSTE|MANUAL/i.test(String(d?.tipo ?? '') + String(d?.origemTipo ?? ''))) r.ajustes++;
      if (e.tabela === 'MovimentoFinanceiro' && d?.tipo === 'SAIDA' && !d.contaPagarId && !d.caixinhaId && !d.transacaoId) r.saidas++;
    }
    const lista = [...metricas.entries()].filter(([, r]) => r.ops >= 5);
    if (lista.length < 2) return out;
    const indicadores: { chave: keyof M; rotulo: string; minimo: number; nivel: Nivel; explicacao: string }[] = [
      { chave: 'cancel', rotulo: 'cancelamentos de venda', minimo: 3, nivel: 'medio', explicacao: 'Cancela muito mais que os colegas.' },
      { chave: 'excl', rotulo: 'exclusões', minimo: 3, nivel: 'medio', explicacao: 'Exclui registros muito mais que os colegas.' },
      { chave: 'descItens', rotulo: 'itens com desconto acima do limite', minimo: 3, nivel: 'medio', explicacao: 'Dá desconto acima do limite com muito mais frequência que os colegas.' },
      { chave: 'fora', rotulo: 'operações fora do horário', minimo: 3, nivel: 'baixo', explicacao: 'Trabalha no sistema fora do horário muito mais que os colegas.' },
      { chave: 'ajustes', rotulo: 'ajustes manuais de estoque', minimo: 3, nivel: 'medio', explicacao: 'Ajusta estoque na mão muito mais que os colegas.' },
      { chave: 'saidas', rotulo: 'saídas manuais de caixa', minimo: 2, nivel: 'alto', explicacao: 'Lança saídas manuais de dinheiro muito mais que os colegas.' },
    ];
    const mes = diaSP(ctx.ate).slice(0, 7);
    for (const ind of indicadores) {
      const valores = lista.map(([, r]) => Number(r[ind.chave]));
      const media = valores.reduce((s, v) => s + v, 0) / valores.length;
      const dp = Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / valores.length);
      for (const [uid, r] of lista) {
        const v = Number(r[ind.chave]);
        if (v < ind.minimo) continue;
        const z = dp > 0 ? (v - media) / dp : v > media ? 3 : 0;
        if (z < 2 && v < media * 2.5) continue;
        out.push({
          chave: `padrao:${ind.chave}:${uid}:${mes}`,
          nivel: ind.nivel,
          categoria: 'padroes',
          titulo: `${r.nome} está fora do padrão da equipe: ${v} ${ind.rotulo} em 30 dias (média da equipe ${media.toFixed(1)})`,
          explicacao: `${ind.explicacao} Não é prova de nada — é um sinal para olhar a trilha dessa pessoa.`,
          evidencias: [{ rotulo: `Ver trilha de ${r.nome}` }],
          usuarioId: uid,
          usuario: r.nome,
          transitorio: true,
        });
      }
    }
    return out;
  },
};

export const AGENTES: Agente[] = [exclusoes, descontos, dinheiro, estoque, horarios, comissoes, consistencia, padroes];

// -------------------------------------------------------------------------------------------------
// rodada
// -------------------------------------------------------------------------------------------------
let rodando = false;
export interface EstadoAgentes {
  ultimaVez: string | null;
  duracaoMs: number;
  novos: number;
  confirmados: number;
  resolvidosSozinhos: number;
  erro: string | null;
  porAgente: Record<string, { achados: number; ms: number; erro?: string }>;
}
const CHAVE_ESTADO = 'auditoria.agentes.estado';
export async function lerEstado(): Promise<EstadoAgentes | null> {
  const c = await db().configuracao.findUnique({ where: { chave: CHAVE_ESTADO } }).catch(() => null);
  if (!c) return null;
  try {
    return JSON.parse(c.valor) as EstadoAgentes;
  } catch {
    return null;
  }
}

export async function rodarAgentes(motivo: string, opts: { apenas?: string[]; forcar?: boolean } = {}): Promise<EstadoAgentes | null> {
  if (rodando) return lerEstado();
  const cfg = await lerConfig();
  if (!cfg.ligado && !opts.forcar) return lerEstado();
  rodando = true;
  const inicio = Date.now();
  const estado: EstadoAgentes = { ultimaVez: new Date().toISOString(), duracaoMs: 0, novos: 0, confirmados: 0, resolvidosSozinhos: 0, erro: null, porAgente: {} };
  try {
    const situacoes = new Map((await db().situacao.findMany({ select: { id: true, nome: true, final: true, cancelamento: true, modulo: true } })).map((s) => [s.id, { nome: s.nome, final: s.final, cancelamento: s.cancelamento, modulo: s.modulo }]));
    const ate = new Date();
    for (const ag of AGENTES) {
      if (opts.apenas && !opts.apenas.includes(ag.codigo)) continue;
      if (cfg.desligados.includes(ag.codigo) && !opts.apenas) continue;
      const t = Date.now();
      try {
        const achados = await ag.rodar({ desde: new Date(ate.getTime() - ag.janelaDias * 86400_000), ate, cfg, situacoes });
        const chaves = new Set<string>();
        for (const a of achados) {
          if (chaves.has(a.chave)) continue;
          chaves.add(a.chave);
          const existente = await db().auditoriaAchado.findUnique({ where: { chave: a.chave } });
          const dados = {
            agente: ag.codigo,
            nivel: a.nivel,
            categoria: a.categoria,
            titulo: a.titulo.slice(0, 300),
            explicacao: a.explicacao.slice(0, 1000),
            evidencias: JSON.stringify((a.evidencias ?? []).slice(0, 10)),
            usuarioId: a.usuarioId ?? null,
            usuario: a.usuario ?? null,
            operacaoId: a.operacaoId ?? null,
            tabela: a.tabela ?? null,
            registroId: a.registroId ?? null,
          };
          if (!existente) {
            await db().auditoriaAchado.create({ data: { ...dados, chave: a.chave } });
            estado.novos++;
          } else if (existente.status === 'IGNORADO') {
            /* o ADMIN pediu para não incomodar */
          } else {
            await db().auditoriaAchado.update({ where: { chave: a.chave }, data: { ...dados, status: existente.status === 'RESOLVIDO' ? 'ABERTO' : existente.status, vezes: { increment: 1 } } });
            estado.confirmados++;
          }
        }
        // achados de estado deste agente que sumiram: resolvem sozinhos
        const abertos = await db().auditoriaAchado.findMany({ where: { agente: ag.codigo, status: { in: ['ABERTO', 'VISTO'] } }, select: { id: true, chave: true } });
        const transitorias = new Set(achados.filter((a) => a.transitorio).map((a) => a.chave));
        const prefixosTransitorios = ['negativo:', 'totalDiferente:', 'duplicada:', 'recebidaSemCaixa:', 'padrao:'];
        for (const ab of abertos) {
          const ehTransitorio = prefixosTransitorios.some((p) => ab.chave.startsWith(p)) || transitorias.has(ab.chave);
          if (ehTransitorio && !chaves.has(ab.chave)) {
            await db().auditoriaAchado.update({ where: { id: ab.id }, data: { status: 'RESOLVIDO', vistoPor: 'agente', vistoEm: new Date() } });
            estado.resolvidosSozinhos++;
          }
        }
        estado.porAgente[ag.codigo] = { achados: achados.length, ms: Date.now() - t };
      } catch (e) {
        estado.porAgente[ag.codigo] = { achados: 0, ms: Date.now() - t, erro: (e as Error)?.message ?? String(e) };
      }
    }
  } catch (e) {
    estado.erro = (e as Error)?.message ?? String(e);
  } finally {
    rodando = false;
  }
  estado.duracaoMs = Date.now() - inicio;
  const valor = JSON.stringify({ ...estado, motivo });
  await db().configuracao.upsert({ where: { chave: CHAVE_ESTADO }, create: { chave: CHAVE_ESTADO, valor }, update: { valor } }).catch(() => undefined);
  return estado;
}
