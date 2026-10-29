/**
 * ROBÔ DA SAÚDE (28/10/2026)
 *
 * Fica ligado 24h conferindo a "Saúde do sistema" (Configurações → Saúde) para tudo ficar 100%:
 *   - roda a cada 5 minutos e ~45 s depois de qualquer venda, situação, recebimento, pagamento ou NF;
 *   - CORRIGE SOZINHO o que tem uma resposta certa e não muda dinheiro de lugar por conta própria
 *     (lançar o que a situação "Fechada" já mandou lançar, estornar o que a venda cancelada deixou para trás,
 *     cancelar comissão/conta de venda cancelada, NCM pelo tipo do produto, realinhar o histórico do estoque,
 *     vincular o vendedor ao login, consultar NF sem resposta da SEFAZ);
 *   - o que precisa de uma decisão vira SUGESTÃO com o botão pronto (1 clique): atribuir a venda ao vendedor
 *     que a lançou, acertar a parcela, recalcular o saldo do banco, transmitir a NF, cancelar venda parada, zerar
 *     estoque negativo;
 *   - o resto vira ALERTA com o link de onde resolver.
 * Tudo fica em RoboSaudeAviso e aparece no sino do topo e no dashboard do ADMIN.
 *
 * LEMBRETES PARA A EQUIPE (29/10/2026): o robô também monitora os custos das OS e das vendas. OS com peça sem
 * custo vira lembrete para o TÉCNICO dela; venda com produto sem custo vira lembrete para o VENDEDOR. O lembrete
 * tem destinatário (tecnicoId/vendedorId) e aparece no painel desse funcionário (GET /lembretes), além do painel
 * do ADMIN. Some sozinho assim que o custo é preenchido. O DRE e os dashboards precisam desse custo real.
 */
import { prisma } from '../../lib/prisma.js';
import { comContexto } from '../auditoria/contexto.js';
import { CHAVE_FALHAS_TRILHA, falhasDaTrilha, zerarFalhasDaTrilha } from '../auditoria/trilha.js';
import { AppError } from '../../lib/errors.js';
import { auditar } from '../../lib/auditoria.js';
import { arredondar } from '../../lib/util.js';
import { eventos } from '../../core/eventos.js';
import { executarAcoes, mudarSituacao } from '../../core/situacoes.js';
import { cancelarComissoes } from '../comum/financeiro.js';
import { movimentarEstoque } from '../comum/estoque.js';
import { vendedorDoUsuario } from '../comum/vendedores.js';
import { desfazerCompraDaVenda, marcaCompraDaVenda, receberVendaPagaNaHora, transferirVendedor } from '../vendas/service.js';
import { sugerirNcm } from '../robo-nf/ncm.js';
import { consultar, transmitir } from '../../integracoes/fiscal/service.js';
import { diagnosticar, type Achado, type Nivel } from '../diagnostico/service.js';
import { pecasSemCustoOs } from '../comum/custos-os.js';

// ------------------------------------------------------------------ tipos
export interface AcaoSugestao {
  codigo: string;
  rotulo: string;
  estilo?: 'primario' | 'sucesso' | 'secundario' | 'perigo';
  /** pergunta antes de executar */
  confirmar?: string;
  /** entra no "Resolver tudo" */
  lote?: boolean;
}

interface Alvo {
  /** parte final da chave (ex.: "venda:123") */
  alvo: string;
  nivel: Nivel;
  area: string;
  titulo: string;
  mensagem: string;
  link?: string;
  dados?: Record<string, unknown>;
  /** para quem é o lembrete: aparece no painel desse técnico/vendedor (além do ADMIN) */
  tecnicoId?: number | null;
  vendedorId?: number | null;
}

interface Corretor {
  id: string;
  buscar: () => Promise<Alvo[]>;
  /** corrige sozinho; devolve o texto do que fez (null = não corrigiu, vira sugestão). Lançar erro = vira sugestão com o motivo. */
  auto?: (a: Alvo) => Promise<string | null>;
  /** botões da sugestão */
  acoes?: (a: Alvo) => AcaoSugestao[];
  executar?: (codigo: string, dados: any, usuarioId: number | null) => Promise<string>;
}

export interface Config {
  ligado: boolean;
  autoCorrigir: boolean;
}

export interface Estado {
  ultimaVez: string | null;
  duracaoMs: number;
  saudePct: number;
  resumo: Record<Nivel, number>;
  verificacoes: number;
  corrigidasNaRodada: number;
  origem: string;
  erro?: string | null;
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 300);
const ROBO = 'Robô da Saúde';
/** Lembretes de custo: OS e vendas dos últimos N dias (as mais antigas não mudam mais o DRE do mês). */
const JANELA_CUSTO_DIAS = 120;

// ------------------------------------------------------------------ config/estado
const CHAVE_CONFIG = 'roboSaude.config';
const CHAVE_ESTADO = 'roboSaude.estado';

export async function lerConfig(): Promise<Config> {
  const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } }).catch(() => null);
  const padrao: Config = { ligado: true, autoCorrigir: true };
  if (!c) return padrao;
  try {
    return { ...padrao, ...JSON.parse(c.valor) };
  } catch {
    return padrao;
  }
}

export async function gravarConfig(p: Partial<Config>) {
  const valor = JSON.stringify({ ...(await lerConfig()), ...p });
  await prisma.configuracao.upsert({ where: { chave: CHAVE_CONFIG }, create: { chave: CHAVE_CONFIG, valor }, update: { valor } });
  return lerConfig();
}

export async function lerEstado(): Promise<Estado | null> {
  const c = await prisma.configuracao.findUnique({ where: { chave: CHAVE_ESTADO } }).catch(() => null);
  if (!c) return null;
  try {
    return JSON.parse(c.valor);
  } catch {
    return null;
  }
}

async function gravarEstado(e: Estado) {
  const valor = JSON.stringify(e);
  await prisma.configuracao.upsert({ where: { chave: CHAVE_ESTADO }, create: { chave: CHAVE_ESTADO, valor }, update: { valor } });
  // mantém o resumo que o dashboard antigo e os testes leem
  const resumo = JSON.stringify({ ...e.resumo, em: e.ultimaVez });
  await prisma.configuracao.upsert({ where: { chave: 'diagnostico.ultimo' }, create: { chave: 'diagnostico.ultimo', valor: resumo }, update: { valor: resumo } }).catch(() => undefined);
}

/** % de saúde: verificações sem erro nem aviso (erro pesa o dobro). Só "Para saber" não tira ponto. */
export function calcularSaude(verificacoes: number, achados: Pick<Achado, 'nivel'>[]) {
  if (!verificacoes) return 100;
  const peso = achados.reduce((s, a) => s + (a.nivel === 'erro' ? 2 : a.nivel === 'aviso' ? 1 : 0), 0);
  return Math.max(0, Math.round(100 * (1 - peso / (verificacoes * 2))));
}

// ------------------------------------------------------------------ situações
async function situacoesVenda() {
  const s = await prisma.situacao.findMany({ where: { modulo: 'VENDA' } });
  return {
    cancel: s.filter((x) => x.cancelamento).map((x) => x.id),
    final: s.filter((x) => x.final && !x.cancelamento).map((x) => x.id),
    destinoCancelar: s.find((x) => x.cancelamento && x.ativo) ?? s.find((x) => x.cancelamento) ?? null,
  };
}

/** Quem lançou a venda (1º registro do histórico / auditoria) e o vendedor ligado a esse login. */
async function vendedorDeQuemLancou(vendaId: number): Promise<{ id: number; nome: string } | null> {
  const h = await prisma.historicoSituacao.findFirst({ where: { entidadeTipo: 'VENDA', entidadeId: vendaId, usuarioId: { not: null } }, orderBy: { id: 'asc' }, select: { usuarioId: true } });
  const a = h ? null : await prisma.auditoria.findFirst({ where: { entidade: { in: ['Venda', 'VENDA', 'venda'] }, entidadeId: vendaId, acao: 'CRIAR', usuarioId: { not: null } }, orderBy: { id: 'asc' }, select: { usuarioId: true } });
  const usuarioId = h?.usuarioId ?? a?.usuarioId;
  if (!usuarioId) return null;
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { vendedor: { select: { id: true, nome: true, ativo: true } } } });
  return u?.vendedor?.ativo ? { id: u.vendedor.id, nome: u.vendedor.nome } : null;
}

// ------------------------------------------------------------------ CORRETORES
const corretores: Corretor[] = [
  // ---------------------------------------------------------------- vendedor com login sem cadastro
  {
    id: 'usuario-vendedor-sem-cadastro',
    buscar: async () =>
      (await prisma.usuario.findMany({ where: { perfil: 'VENDEDOR', ativo: true, vendedorId: null }, select: { id: true, nome: true } })).map((u) => ({
        alvo: `usuario:${u.id}`,
        nivel: 'erro',
        area: 'Vendedores',
        titulo: `${u.nome} tem login mas não tem cadastro de vendedor`,
        mensagem: 'As vendas dele ficam sem vendedor (fora do painel, da meta e da comissão).',
        link: '/configuracoes/usuarios',
        dados: { usuarioId: u.id, nome: u.nome },
      })),
    auto: async (a) => {
      const id = await vendedorDoUsuario(Number(a.dados!.usuarioId));
      return id ? `Criei/vinculei o cadastro de vendedor de ${a.dados!.nome}.` : null;
    },
  },

  // ---------------------------------------------------------------- venda fechada sem contas/estoque
  {
    id: 'venda-final-sem-lancamento',
    buscar: async () => {
      const { final } = await situacoesVenda();
      const vs = await prisma.venda.findMany({
        where: { tipo: 'PEDIDO', blingId: null, situacaoId: { in: final }, OR: [{ contasLancadas: false }, { estoqueLancado: false }] },
        select: { id: true, numero: true, contasLancadas: true, estoqueLancado: true, situacao: { select: { nome: true } } },
        take: 100,
      });
      return vs.map((v) => ({
        alvo: `venda:${v.id}`,
        nivel: 'erro',
        area: 'Vendas',
        titulo: `Venda nº ${v.numero} "${v.situacao.nome}" sem ${[!v.contasLancadas && 'financeiro', !v.estoqueLancado && 'baixa de estoque'].filter(Boolean).join(' e ')}`,
        mensagem: 'A situação diz que a venda foi concluída, mas o financeiro/estoque não foram movimentados.',
        link: `/vendas/${v.id}`,
        dados: { vendaId: v.id, numero: v.numero, contas: !v.contasLancadas, estoque: !v.estoqueLancado },
      }));
    },
    auto: async (a) => lancarVenda(a.dados as any),
    acoes: () => [{ codigo: 'lancar', rotulo: 'Lançar contas e estoque', estilo: 'primario', lote: true }],
    executar: async (_c, d) => (await lancarVenda(d)) ?? 'Nada a lançar: a venda já estava em dia.',
  },

  // ---------------------------------------------------------------- venda cancelada ainda lançada
  {
    id: 'venda-cancelada-lancada',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const vs = await prisma.venda.findMany({ where: { tipo: 'PEDIDO', situacaoId: { in: cancel }, OR: [{ contasLancadas: true }, { estoqueLancado: true }] }, select: { id: true, numero: true, contasLancadas: true, estoqueLancado: true }, take: 100 });
      return vs.map((v) => ({
        alvo: `venda:${v.id}`,
        nivel: 'erro',
        area: 'Vendas',
        titulo: `Venda nº ${v.numero} cancelada ainda com ${[v.contasLancadas && 'contas', v.estoqueLancado && 'estoque'].filter(Boolean).join(' e ')} lançados`,
        mensagem: 'O estoque/financeiro estão contando uma venda que não existe.',
        link: `/vendas/${v.id}`,
        dados: { vendaId: v.id, numero: v.numero, contas: v.contasLancadas, estoque: v.estoqueLancado },
      }));
    },
    auto: async (a) => estornarVenda(a.dados as any),
    acoes: () => [{ codigo: 'estornar', rotulo: 'Tentar estornar de novo', estilo: 'secundario' }],
    executar: async (_c, d) => (await estornarVenda(d)) ?? 'Nada a estornar: a venda já estava em dia.',
  },

  // ---------------------------------------------------------------- compra registrada ao finalizar uma venda cancelada/excluída
  {
    id: 'compra-de-venda-cancelada',
    buscar: async () => {
      const marca = marcaCompraDaVenda(0).replace(/ 0$/, ' ');
      const compras = await prisma.compra.findMany({
        where: { observacoesInternas: { contains: marca }, situacao: { cancelamento: false } },
        select: { id: true, numero: true, total: true, observacoesInternas: true, situacao: { select: { nome: true } } },
        take: 200,
      });
      const alvos: Alvo[] = [];
      for (const c of compras) {
        const m = new RegExp(marca.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)').exec(c.observacoesInternas || '');
        const numeroVenda = m ? Number(m[1]) : 0;
        if (!numeroVenda) continue;
        const venda = await prisma.venda.findFirst({ where: { tipo: 'PEDIDO', numero: numeroVenda }, select: { id: true, situacao: { select: { cancelamento: true, nome: true } } } });
        if (venda && !venda.situacao.cancelamento) continue;
        const pagas = await prisma.contaPagar.count({ where: { origemTipo: 'COMPRA', origemId: c.id, valorPago: { gt: 0 } } });
        alvos.push({
          alvo: `compra:${c.id}`,
          nivel: 'erro',
          area: 'Compras',
          titulo: `Compra nº ${c.numero} (${brl(c.total)}) é da venda nº ${numeroVenda}, que foi ${venda ? 'cancelada' : 'excluída'}`,
          mensagem: `A compra foi registrada ao finalizar essa venda e ficou "${c.situacao.nome}"${pagas ? ', com o pagamento saindo do banco' : ''}: a mercadoria e o dinheiro estão contando uma venda que não existe.`,
          link: `/compras/${c.id}`,
          dados: { compraId: c.id, numero: c.numero, vendaId: venda?.id ?? null, numeroVenda },
        });
      }
      return alvos;
    },
    auto: async (a) => {
      const d = a.dados as { compraId: number; numero: number; vendaId: number | null; numeroVenda: number };
      const r = await prisma.$transaction((tx) => desfazerCompraDaVenda(tx, { id: d.vendaId ?? 0, numero: d.numeroVenda }, null, d.vendaId ? 'cancelar' : 'excluir'));
      if (!r) return null;
      if (!r.desfeita) throw new AppError(`Não desfiz sozinho: ${r.motivo}. Confira a compra e cancele/estorne à mão se for o caso.`, 422, 'COMPRA_MANTIDA');
      const devolvido = r.devolvido.reduce((s, x) => s + x.valor, 0);
      return `Desfiz a compra nº ${d.numero} da venda nº ${d.numeroVenda} (${d.vendaId ? 'cancelada' : 'excluída'})${devolvido > 0 ? `: ${brl(devolvido)} voltaram para o banco` : ''}.`;
    },
  },

  // ---------------------------------------------------------------- comissão de venda cancelada
  {
    id: 'comissao-venda-cancelada',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const cs = await prisma.comissao.findMany({ where: { status: { in: ['PENDENTE', 'APROVADA'] }, origemTipo: 'VENDA', venda: { situacaoId: { in: cancel } } }, select: { vendaId: true, valor: true, venda: { select: { numero: true } } } });
      const porVenda = new Map<number, { numero: number; valor: number }>();
      for (const c of cs) {
        if (!c.vendaId) continue;
        const x = porVenda.get(c.vendaId) || { numero: c.venda?.numero ?? 0, valor: 0 };
        x.valor += c.valor;
        porVenda.set(c.vendaId, x);
      }
      return [...porVenda.entries()].map(([vendaId, x]) => ({
        alvo: `venda:${vendaId}`,
        nivel: 'erro',
        area: 'Comissões',
        titulo: `Comissão de ${brl(x.valor)} da venda cancelada nº ${x.numero}`,
        mensagem: 'Se for paga, o vendedor recebe por uma venda que não aconteceu.',
        link: '/comissoes',
        dados: { vendaId, numero: x.numero, valor: arredondar(x.valor) },
      }));
    },
    auto: async (a) => {
      await cancelarComissoes(prisma, { origemTipo: 'VENDA', vendaId: Number(a.dados!.vendaId) });
      return `Cancelei a comissão de ${brl(Number(a.dados!.valor))} da venda cancelada nº ${a.dados!.numero}.`;
    },
  },

  // ---------------------------------------------------------------- conta a receber de venda cancelada
  {
    id: 'receber-de-venda-cancelada',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const contas = await prisma.contaReceber.findMany({ where: { origemTipo: 'VENDA', situacao: { in: ['ABERTO', 'ATRASADO', 'PARCIAL'] } }, select: { id: true, origemId: true, valor: true, valorRecebido: true, descricao: true } });
      const canc = new Set((await prisma.venda.findMany({ where: { id: { in: contas.map((c) => c.origemId!).filter(Boolean) }, situacaoId: { in: cancel } }, select: { id: true } })).map((v) => v.id));
      return contas
        .filter((c) => c.origemId && canc.has(c.origemId))
        .map((c) => ({
          alvo: `conta:${c.id}`,
          nivel: 'erro',
          area: 'Financeiro',
          titulo: `Conta a receber em aberto de venda cancelada: ${c.descricao} (${brl(c.valor)})`,
          mensagem: c.valorRecebido > 0 ? `Já tem ${brl(c.valorRecebido)} recebido: estorne o recebimento (ou devolva ao cliente) antes de cancelar.` : 'O fluxo de caixa está esperando um dinheiro que não vai entrar.',
          link: `/vendas/${c.origemId}`,
          dados: { contaId: c.id, descricao: c.descricao, recebido: c.valorRecebido },
        }));
    },
    auto: async (a) => {
      if (Number(a.dados!.recebido) > 0) return null;
      await prisma.contaReceber.update({ where: { id: Number(a.dados!.contaId) }, data: { situacao: 'CANCELADO' } });
      return `Cancelei a conta a receber "${a.dados!.descricao}" da venda cancelada.`;
    },
  },

  // ---------------------------------------------------------------- produto vendido sem NCM
  {
    id: 'produto-sem-ncm',
    buscar: async () => {
      const ps = await prisma.produto.findMany({
        where: { ativo: true, tipo: 'P', OR: [{ ncm: null }, { ncm: '' }], vendaItens: { some: { venda: { data: { gte: new Date(Date.now() - 60 * 86400000) }, tipo: 'PEDIDO' } } } },
        select: { id: true, nome: true, categoria: { select: { nome: true } } },
        take: 100,
      });
      return ps.map((p) => ({
        alvo: `produto:${p.id}`,
        nivel: 'aviso',
        area: 'Fiscal',
        titulo: `Produto sem NCM: ${p.nome}`,
        mensagem: 'A NF-e de uma venda com esse produto vai ser recusada. O robô não reconheceu o tipo do produto: preencha o NCM na aba Fiscal.',
        link: `/produtos/${p.id}/editar`,
        dados: { produtoId: p.id, nome: p.nome, categoria: p.categoria?.nome ?? null },
      }));
    },
    auto: async (a) => {
      const d = a.dados as any;
      const s = await sugerirNcm(prisma, { id: d.produtoId, nome: d.nome, categoria: d.categoria ? { nome: d.categoria } : null });
      if (!s) return null;
      await prisma.produto.update({ where: { id: d.produtoId }, data: { ncm: s.ncm, ncmOrigem: s.origem } });
      return `Preenchi o NCM ${s.ncm} em "${d.nome}"${s.origem === 'SUGERIDO' ? ' (sugerido: a gestão confirma com um clique na venda)' : ''}.`;
    },
  },

  // ---------------------------------------------------------------- saldo do estoque x histórico
  {
    id: 'estoque-saldo-divergente',
    buscar: async () => {
      const ultimos = await prisma.$queryRawUnsafe<{ produtoId: number; depositoId: number; saldoPosterior: number }[]>(
        `SELECT m.produtoId, m.depositoId, m.saldoPosterior FROM MovimentoEstoque m
         JOIN (SELECT produtoId, depositoId, MAX(id) mx FROM MovimentoEstoque GROUP BY produtoId, depositoId) u ON u.mx = m.id`,
      );
      if (!ultimos.length) return [];
      const saldos = await prisma.estoqueSaldo.findMany({ where: { deposito: { desconsiderarSaldo: false } }, select: { produtoId: true, depositoId: true, saldo: true, produto: { select: { nome: true } }, deposito: { select: { nome: true } } } });
      const mapa = new Map(saldos.map((s) => [`${s.produtoId}:${s.depositoId}`, s]));
      const out: Alvo[] = [];
      for (const u of ultimos) {
        const s = mapa.get(`${Number(u.produtoId)}:${Number(u.depositoId)}`);
        if (!s || Math.abs(Number(s.saldo) - Number(u.saldoPosterior)) <= 0.0001) continue;
        out.push({
          alvo: `estoque:${s.produtoId}:${s.depositoId}`,
          nivel: 'erro',
          area: 'Estoque',
          titulo: `Histórico do estoque fora do saldo: ${s.produto.nome} (${s.deposito.nome})`,
          mensagem: `Saldo ${s.saldo}, último movimento ${Number(u.saldoPosterior)}.`,
          link: `/produtos/${s.produtoId}`,
          dados: { produtoId: s.produtoId, depositoId: s.depositoId, saldo: Number(s.saldo), historico: Number(u.saldoPosterior), nome: s.produto.nome, deposito: s.deposito.nome },
        });
      }
      return out.slice(0, 100);
    },
    // não muda a quantidade: só grava um ajuste que deixa o histórico igual ao saldo que todo mundo vê
    auto: async (a) => {
      const d = a.dados as any;
      await prisma.$transaction((tx) =>
        movimentarEstoque(tx, { produtoId: d.produtoId, depositoId: d.depositoId, tipo: 'AJUSTE', quantidade: 0, saldoNovo: d.saldo, origemTipo: 'AJUSTE', observacao: `${ROBO}: histórico realinhado com o saldo (estava ${d.historico}); a quantidade não mudou` }),
      );
      return `Realinhei o histórico do estoque de "${d.nome}" (${d.deposito}) com o saldo ${d.saldo} — sem mudar a quantidade. Se a contagem física for outra, faça um ajuste.`;
    },
  },

  // ---------------------------------------------------------------- saldo do banco x movimentos
  {
    id: 'saldo-conta-divergente',
    buscar: async () => {
      const contas = await prisma.contaFinanceira.findMany({ where: { ativo: true }, select: { id: true, nome: true, saldoInicial: true, saldoAtual: true } });
      const somas = await prisma.movimentoFinanceiro.groupBy({ by: ['contaFinanceiraId', 'tipo'], _sum: { valor: true } });
      const mov = (id: number) => somas.filter((s) => s.contaFinanceiraId === id).reduce((t, s) => t + (s.tipo === 'ENTRADA' ? 1 : -1) * (s._sum.valor || 0), 0);
      return contas
        .map((c) => ({ c, movs: arredondar(mov(c.id)) }))
        .filter(({ c, movs }) => Math.abs(arredondar(c.saldoInicial + movs) - c.saldoAtual) > 0.05)
        .map(({ c, movs }) => {
          const esperado = arredondar(c.saldoInicial + movs);
          return {
            alvo: `conta-financeira:${c.id}`,
            nivel: 'erro' as Nivel,
            area: 'Financeiro',
            titulo: `Saldo de ${c.nome} não bate com os lançamentos`,
            mensagem: `Mostra ${brl(c.saldoAtual)}, mas saldo inicial + entradas − saídas dá ${brl(esperado)} (diferença ${brl(arredondar(c.saldoAtual - esperado))}). Escolha qual está certo, conferindo o extrato do banco.`,
            link: '/financeiro/bancos',
            dados: { contaId: c.id, nome: c.nome, saldoAtual: c.saldoAtual, esperado, movs },
          };
        });
    },
    acoes: (a) => [
      { codigo: 'recalcular', rotulo: `Usar os lançamentos (${brl(Number(a.dados!.esperado))})`, estilo: 'primario', confirmar: `O saldo de ${a.dados!.nome} passa a ser ${brl(Number(a.dados!.esperado))}. Confirma?` },
      { codigo: 'manter', rotulo: `Manter ${brl(Number(a.dados!.saldoAtual))}`, estilo: 'secundario', confirmar: `O saldo mostrado (${brl(Number(a.dados!.saldoAtual))}) fica como certo e o saldo inicial é corrigido. Confirma?` },
    ],
    executar: async (codigo, d) => {
      const c = await prisma.contaFinanceira.findUnique({ where: { id: Number(d.contaId) } });
      if (!c) throw new AppError('Conta financeira não encontrada.', 404);
      const somas = await prisma.movimentoFinanceiro.groupBy({ by: ['tipo'], where: { contaFinanceiraId: c.id }, _sum: { valor: true } });
      const movs = arredondar(somas.reduce((t, s) => t + (s.tipo === 'ENTRADA' ? 1 : -1) * (s._sum.valor || 0), 0));
      if (codigo === 'recalcular') {
        const novo = arredondar(c.saldoInicial + movs);
        await prisma.contaFinanceira.update({ where: { id: c.id }, data: { saldoAtual: novo } });
        return `Saldo de ${c.nome} recalculado pelos lançamentos: ${brl(novo)}.`;
      }
      if (codigo === 'manter') {
        const ini = arredondar(c.saldoAtual - movs);
        await prisma.contaFinanceira.update({ where: { id: c.id }, data: { saldoInicial: ini } });
        return `Mantive o saldo de ${c.nome} em ${brl(c.saldoAtual)} (saldo inicial corrigido para ${brl(ini)}).`;
      }
      throw new AppError('Ação desconhecida.', 422);
    },
  },

  // ---------------------------------------------------------------- trilha de auditoria falhou
  {
    id: 'trilha-falhou',
    buscar: async () => {
      // memória desta instância + o que ficou gravado antes de um reinício
      const mem = falhasDaTrilha();
      const salvo = await prisma.configuracao.findUnique({ where: { chave: CHAVE_FALHAS_TRILHA } }).catch(() => null);
      let persistido = { total: 0, ultima: null as string | null, quando: null as string | null };
      try {
        if (salvo?.valor) persistido = { ...persistido, ...(JSON.parse(salvo.valor) as typeof persistido) };
      } catch {
        /* valor ilegível: fica no zero */
      }
      const total = Math.max(mem.total, persistido.total);
      if (!total) return [];
      const recente = (mem.quando ?? '') > (persistido.quando ?? '') ? mem : persistido;
      return [
        {
          alvo: `trilha:${recente.quando ?? 'sem-data'}`,
          nivel: 'erro',
          area: 'Auditoria',
          titulo: `Histórico não gravado em ${total} gravação${total > 1 ? 'ões' : ''}`,
          mensagem: `O sistema salvou normalmente, mas o Painel de auditoria não registrou — essas operações não aparecem no histórico e não podem ser revertidas. Última: ${recente.ultima ?? 'sem detalhe'}.`,
          link: '/auditoria',
          dados: { total, ultima: recente.ultima, quando: recente.quando },
        },
      ];
    },
    acoes: () => [{ codigo: 'marcar-visto', rotulo: 'Entendi, zerar o aviso', estilo: 'secundario' }],
    executar: async (codigo) => {
      if (codigo !== 'marcar-visto') throw new AppError('Ação desconhecida.', 422);
      zerarFalhasDaTrilha();
      await prisma.configuracao.deleteMany({ where: { chave: CHAVE_FALHAS_TRILHA } }).catch(() => undefined);
      return 'Aviso zerado. Se a trilha falhar de novo, eu aviso na hora.';
    },
  },

  // ---------------------------------------------------------------- NF parada
  {
    id: 'nota-parada',
    buscar: async () => {
      const ns = await prisma.notaFiscal.findMany({ where: { situacao: { in: ['PENDENTE', 'PROCESSANDO'] }, criadoEm: { lt: new Date(Date.now() - 2 * 3600_000) } }, select: { id: true, numero: true, situacao: true, chave: true } });
      return ns.map((n) => ({
        alvo: `nota:${n.id}`,
        nivel: 'aviso',
        area: 'Fiscal',
        titulo: n.situacao === 'PENDENTE' ? `NF ${n.numero} gerada e não transmitida` : `NF ${n.numero} sem resposta da SEFAZ`,
        mensagem: n.situacao === 'PENDENTE' ? 'O cliente ainda não tem a nota. Um clique envia para a SEFAZ.' : 'O robô consulta a SEFAZ sozinho; se continuar, abra a nota.',
        link: `/notas-fiscais/${n.id}`,
        dados: { notaId: n.id, numero: n.numero, situacao: n.situacao, chave: !!n.chave },
      }));
    },
    auto: async (a) => {
      const d = a.dados as any;
      if (d.situacao !== 'PROCESSANDO' || !d.chave) return null;
      const r = await consultar(d.notaId);
      if (r.situacao === 'AUTORIZADA') {
        eventos.emitir('nfe.autorizada', { notaId: d.notaId });
        return `Consultei a SEFAZ: a NF ${d.numero} estava autorizada e foi atualizada.`;
      }
      return null;
    },
    acoes: (a) => (a.dados!.situacao === 'PENDENTE' ? [{ codigo: 'transmitir', rotulo: 'Transmitir à SEFAZ', estilo: 'primario', confirmar: `Enviar a NF ${a.dados!.numero} para a SEFAZ agora?` }] : []),
    executar: async (codigo, d) => {
      if (codigo !== 'transmitir') throw new AppError('Ação desconhecida.', 422);
      const r: any = await transmitir(Number(d.notaId));
      const n = await prisma.notaFiscal.findUnique({ where: { id: Number(d.notaId) }, select: { situacao: true, motivo: true } });
      if (n?.situacao === 'AUTORIZADA') return `NF ${d.numero} autorizada pela SEFAZ.`;
      throw new AppError(`A SEFAZ respondeu: ${n?.motivo || r?.motivo || n?.situacao || 'sem resposta'}. Abra a nota para corrigir.`, 422);
    },
  },

  // ---------------------------------------------------------------- venda do mês sem vendedor
  {
    id: 'venda-sem-vendedor-mes',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const agora = new Date();
      const ini = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const vs = await prisma.venda.findMany({ where: { tipo: 'PEDIDO', vendedorId: null, data: { gte: ini }, situacaoId: { notIn: cancel } }, select: { id: true, numero: true, total: true }, orderBy: { numero: 'desc' }, take: 60 });
      const out: Alvo[] = [];
      for (const v of vs) {
        const sug = await vendedorDeQuemLancou(v.id);
        out.push({
          alvo: `venda:${v.id}`,
          nivel: 'aviso',
          area: 'Vendas',
          titulo: `Venda nº ${v.numero} (${brl(v.total)}) sem vendedor`,
          mensagem: sug ? `Quem lançou foi ${sug.nome}.` : 'Não conta para ninguém no painel, no ranking, nas metas e nas comissões.',
          link: `/vendas/${v.id}`,
          dados: { vendaId: v.id, numero: v.numero, vendedorId: sug?.id ?? null, vendedor: sug?.nome ?? null },
        });
      }
      return out;
    },
    acoes: (a) => (a.dados!.vendedorId ? [{ codigo: 'atribuir', rotulo: `Atribuir a ${a.dados!.vendedor}`, estilo: 'primario', lote: true }] : []),
    executar: async (codigo, d, usuarioId) => {
      if (codigo !== 'atribuir' || !d.vendedorId) throw new AppError('Escolha o vendedor na venda.', 422);
      await transferirVendedor(Number(d.vendaId), Number(d.vendedorId), usuarioId);
      return `Venda nº ${d.numero} atribuída a ${d.vendedor}.`;
    },
  },

  // ---------------------------------------------------------------- parcelas ≠ total
  {
    id: 'venda-parcelas-diferentes',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const vs = await prisma.venda.findMany({
        where: { tipo: 'PEDIDO', situacaoId: { notIn: cancel }, data: { gte: new Date(Date.now() - 120 * 86400000) }, parcelas: { some: {} } },
        select: { id: true, numero: true, total: true, contasLancadas: true, parcelas: { select: { id: true, numero: true, valor: true }, orderBy: { numero: 'asc' } } },
      });
      return vs
        .map((v) => ({ v, soma: arredondar(v.parcelas.reduce((s, p) => s + p.valor, 0)) }))
        .filter(({ v, soma }) => Math.abs(soma - v.total) > 0.05)
        .map(({ v, soma }) => {
          const ult = v.parcelas[v.parcelas.length - 1];
          const novo = arredondar(ult.valor + (v.total - soma));
          return {
            alvo: `venda:${v.id}`,
            nivel: 'aviso' as Nivel,
            area: 'Vendas',
            titulo: `Venda nº ${v.numero}: parcelas somam ${brl(soma)}, total ${brl(v.total)}`,
            mensagem: v.contasLancadas ? 'As contas já foram lançadas: ajuste na venda (estorne as contas, acerte as parcelas e lance de novo).' : `A última parcela passa de ${brl(ult.valor)} para ${brl(novo)}.`,
            link: `/vendas/${v.id}`,
            dados: { vendaId: v.id, numero: v.numero, parcelaId: ult.id, novo, lancadas: v.contasLancadas },
          };
        });
    },
    acoes: (a) => (!a.dados!.lancadas && Number(a.dados!.novo) > 0 ? [{ codigo: 'ajustar', rotulo: 'Acertar a última parcela', estilo: 'primario', lote: true }] : []),
    executar: async (_c, d) => {
      const v = await prisma.venda.findUnique({ where: { id: Number(d.vendaId) }, select: { contasLancadas: true } });
      if (v?.contasLancadas) throw new AppError('As contas já foram lançadas: ajuste pela venda.', 422);
      await prisma.vendaParcela.update({ where: { id: Number(d.parcelaId) }, data: { valor: Number(d.novo) } });
      return `Venda nº ${d.numero}: última parcela acertada para ${brl(Number(d.novo))}.`;
    },
  },

  // ---------------------------------------------------------------- venda parada em aberto
  {
    id: 'venda-aberta-antiga',
    buscar: async () => {
      const { cancel, final } = await situacoesVenda();
      const vs = await prisma.venda.findMany({
        where: { tipo: 'PEDIDO', situacaoId: { notIn: [...cancel, ...final] }, data: { lt: new Date(Date.now() - 7 * 86400000) } },
        select: { id: true, numero: true, data: true, total: true, blingId: true, situacao: { select: { nome: true } } },
        orderBy: { data: 'asc' },
        take: 300,
      });
      return vs.map((v) => ({
        alvo: `venda:${v.id}`,
        nivel: 'aviso',
        area: 'Vendas',
        titulo: `Venda nº ${v.numero} "${v.situacao.nome}" desde ${v.data.toLocaleDateString('pt-BR')} (${brl(v.total)})${v.blingId ? ' — veio do Bling' : ''}`,
        mensagem: v.blingId
          ? 'Pedido em aberto que veio do Bling: pela regra da migração conta como fechado. Um clique marca "Fechada" sem mexer no caixa nem no estoque (o dinheiro já entrou na data dele).'
          : 'Feche (abre a venda para finalizar) ou cancele com um clique.',
        link: `/vendas/${v.id}`,
        dados: { vendaId: v.id, numero: v.numero, bling: !!v.blingId },
      }));
    },
    acoes: (a) => [
      ...(a.dados!.bling ? [{ codigo: 'fechar-bling', rotulo: 'Marcar como Fechada', estilo: 'primario' as const, lote: true }] : []),
      { codigo: 'cancelar', rotulo: 'Cancelar venda', estilo: 'perigo', confirmar: `Cancelar a venda nº ${a.dados!.numero}? (estoque e contas são estornados)` },
    ],
    executar: async (codigo, d, usuarioId) => {
      if (codigo === 'fechar-bling') {
        // regra da migração: pedido em aberto do Bling = fechado. Só troca a situação (sem lançar contas/estoque:
        // o caixa da data já veio na importação) e registra no histórico da venda.
        const v = await prisma.venda.findUnique({ where: { id: Number(d.vendaId) }, include: { situacao: true } });
        if (!v?.blingId) throw new AppError('Só vale para pedido que veio do Bling.', 422);
        const fechada = await prisma.situacao.findFirst({ where: { modulo: 'VENDA', nome: 'Fechada', ativo: true } })
          ?? await prisma.situacao.findFirst({ where: { modulo: 'VENDA', final: true, cancelamento: false, ativo: true }, orderBy: { ordem: 'asc' } });
        if (!fechada) throw new AppError('Não há situação "Fechada" cadastrada.', 422);
        if (v.situacaoId === fechada.id) return `Venda nº ${d.numero} já estava Fechada.`;
        await prisma.$transaction(async (tx) => {
          await tx.venda.update({ where: { id: v.id }, data: { situacaoId: fechada.id } });
          await tx.historicoSituacao.create({ data: { entidadeTipo: 'VENDA', entidadeId: v.id, deSituacaoId: v.situacaoId, deSituacao: v.situacao.nome, paraSituacaoId: fechada.id, paraSituacao: fechada.nome, usuarioId, observacao: `${ROBO}: pedido em aberto do Bling marcado como Fechado (regra da migração; sem lançar caixa/estoque)` } });
        });
        // sem emitir 'venda.alterada': o "pago na hora" lançaria de novo um dinheiro que já entrou na importação
        return `Venda nº ${d.numero} (do Bling) marcada como Fechada.`;
      }
      if (codigo !== 'cancelar') throw new AppError('Ação desconhecida.', 422);
      const { destinoCancelar } = await situacoesVenda();
      if (!destinoCancelar) throw new AppError('Não há situação de cancelamento cadastrada.', 422);
      await mudarSituacao({ modulo: 'VENDA', entidadeId: Number(d.vendaId), situacaoDestinoId: destinoCancelar.id, usuarioId, forcar: true, observacao: `Cancelada pelo ${ROBO} (venda parada em aberto)` });
      return `Venda nº ${d.numero} cancelada.`;
    },
  },

  // ---------------------------------------------------------------- estoque negativo
  {
    id: 'estoque-negativo',
    buscar: async () => {
      const ss = await prisma.estoqueSaldo.findMany({ where: { saldo: { lt: -0.0001 }, deposito: { desconsiderarSaldo: false }, produto: { controlaEstoque: true, tipo: 'P' } }, select: { produtoId: true, depositoId: true, saldo: true, produto: { select: { nome: true } }, deposito: { select: { nome: true } } }, take: 100 });
      return ss.map((s) => ({
        alvo: `estoque:${s.produtoId}:${s.depositoId}`,
        nivel: 'aviso',
        area: 'Estoque',
        titulo: `Estoque negativo: ${s.produto.nome} (${s.deposito.nome}: ${s.saldo})`,
        mensagem: 'Saiu mais do que entrou: falta lançar a compra/entrada (abra o produto) ou zere com um clique.',
        link: `/produtos/${s.produtoId}`,
        dados: { produtoId: s.produtoId, depositoId: s.depositoId, nome: s.produto.nome, saldo: s.saldo },
      }));
    },
    acoes: (a) => [{ codigo: 'zerar', rotulo: 'Zerar estoque', estilo: 'secundario', confirmar: `Ajustar o estoque de "${a.dados!.nome}" de ${a.dados!.saldo} para 0?` }],
    executar: async (codigo, d, usuarioId) => {
      if (codigo !== 'zerar') throw new AppError('Ação desconhecida.', 422);
      await prisma.$transaction((tx) => movimentarEstoque(tx, { produtoId: Number(d.produtoId), depositoId: Number(d.depositoId), tipo: 'AJUSTE', quantidade: 0, saldoNovo: 0, origemTipo: 'AJUSTE', observacao: `${ROBO}: estoque negativo zerado`, usuarioId }));
      return `Estoque de "${d.nome}" zerado.`;
    },
  },

  // ---------------------------------------------------------------- OS com peça sem custo → lembrete para o técnico
  {
    id: 'os-sem-custo',
    buscar: async () => {
      const cancel = (await prisma.situacao.findMany({ where: { modulo: 'OS', cancelamento: true }, select: { id: true } })).map((s) => s.id);
      const ordens = await prisma.ordemServico.findMany({
        // OS lançadas no MEU BLING (as do Bling não têm custo por peça) e dos últimos meses
        where: { blingId: null, situacaoId: { notIn: cancel }, dataEntrada: { gte: new Date(Date.now() - JANELA_CUSTO_DIAS * 86400000) }, custoPeca: { lte: 0 }, itens: { some: { tipo: 'PECA', custoUnitario: { lte: 0 } } } },
        select: { id: true, numero: true, custoPeca: true, tecnicoId: true, tecnico: { select: { nome: true } }, situacao: { select: { nome: true, final: true } }, itens: { select: { tipo: true, descricao: true, custoUnitario: true, quantidade: true } } },
        orderBy: { numero: 'desc' },
        take: 200,
      });
      return ordens
        .map((o) => ({ o, sem: pecasSemCustoOs(o) }))
        .filter(({ sem }) => sem.length)
        .map(({ o, sem }) => ({
          alvo: `os:${o.id}`,
          nivel: 'aviso' as Nivel,
          area: 'Assistência',
          titulo: `OS nº ${o.numero}${o.situacao.final ? ` (${o.situacao.nome})` : ''}: ${sem.length === 1 ? '1 peça sem custo' : `${sem.length} peças sem custo`}`,
          mensagem: `${sem.slice(0, 3).map(({ i }) => i.descricao).join(', ')}${sem.length > 3 ? '…' : ''}. ${o.tecnico ? `${o.tecnico.nome.split(' ')[0]}, preencha` : 'Preencha'} o custo da peça na OS (coluna "Custo un.") para o lucro da assistência e o DRE ficarem certos.`,
          link: `/ordens-servico/${o.id}/editar`,
          dados: { osId: o.id, numero: o.numero, pecas: sem.length, tecnicoId: o.tecnicoId },
          tecnicoId: o.tecnicoId,
        }));
    },
  },

  // ---------------------------------------------------------------- venda com produto sem custo → lembrete para o vendedor
  {
    id: 'venda-sem-custo',
    buscar: async () => {
      const { cancel } = await situacoesVenda();
      const vendas = await prisma.venda.findMany({
        where: { tipo: 'PEDIDO', blingId: null, situacaoId: { notIn: cancel }, data: { gte: new Date(Date.now() - JANELA_CUSTO_DIAS * 86400000) }, itens: { some: { custoUnitario: { lte: 0 }, OR: [{ produtoId: null }, { produto: { tipo: { not: 'S' } } }] } } },
        select: { id: true, numero: true, total: true, vendedorId: true, vendedor: { select: { nome: true } }, situacao: { select: { nome: true, final: true } }, itens: { select: { descricao: true, custoUnitario: true, produto: { select: { tipo: true } } } } },
        orderBy: { numero: 'desc' },
        take: 200,
      });
      return vendas
        .map((v) => ({ v, sem: v.itens.filter((i) => !(i.custoUnitario > 0) && i.produto?.tipo !== 'S') }))
        .filter(({ sem }) => sem.length)
        .map(({ v, sem }) => ({
          alvo: `venda:${v.id}`,
          nivel: 'aviso' as Nivel,
          area: 'Vendas',
          titulo: `Venda nº ${v.numero} (${brl(v.total)}): ${sem.length === 1 ? '1 produto sem custo' : `${sem.length} produtos sem custo`}`,
          mensagem: `${sem.slice(0, 3).map((i) => i.descricao).join(', ')}${sem.length > 3 ? '…' : ''}. ${v.vendedor ? `${v.vendedor.nome.split(' ')[0]}, preencha` : 'Preencha'} o custo na venda (coluna "Custo un.") — sem ele o sistema usa uma estimativa e o DRE não fica real.`,
          link: `/vendas/${v.id}/editar`,
          dados: { vendaId: v.id, numero: v.numero, itens: sem.length, vendedorId: v.vendedorId },
          vendedorId: v.vendedorId,
        }));
    },
  },
];

const porId = new Map(corretores.map((c) => [c.id, c]));

// ------------------------------------------------------------------ correções reutilizadas
async function lancarVenda(d: { vendaId: number; numero: number }) {
  const v = await prisma.venda.findUnique({ where: { id: d.vendaId }, select: { contasLancadas: true, estoqueLancado: true, data: true, tipo: true } });
  if (!v) return null;
  const feito: string[] = [];
  let pagoNaHora = 0;
  if (!v.contasLancadas) {
    // dinheiro/PIX/cartão: lança e já dá baixa no banco da forma de pagamento, como na hora da venda
    pagoNaHora = await prisma.$transaction((tx) => receberVendaPagaNaHora(tx, d.vendaId));
    // crediário/boleto (ou sobra que não era "pago na hora"): contas a receber em aberto
    await executarAcoes('VENDA', d.vendaId, ['lancarContas'], null);
    feito.push(pagoNaHora ? `lancei o financeiro (com baixa de ${pagoNaHora} parcela${pagoNaHora > 1 ? 's' : ''} paga${pagoNaHora > 1 ? 's' : ''} na hora)` : 'lancei o contas a receber');
  }
  if (!v.estoqueLancado) {
    await executarAcoes('VENDA', d.vendaId, ['lancarEstoque'], null);
    feito.push('baixei o estoque');
  }
  if (!feito.length) return null;
  eventos.emitir('venda.alterada', { vendaId: d.vendaId, data: v.data, tipo: v.tipo });
  return `Venda nº ${d.numero} estava fechada sem movimentar: ${feito.join(' e ')}.`;
}

async function estornarVenda(d: { vendaId: number; numero: number }) {
  const v = await prisma.venda.findUnique({ where: { id: d.vendaId }, select: { contasLancadas: true, estoqueLancado: true, data: true, tipo: true } });
  if (!v) return null;
  if (!v.estoqueLancado && !v.contasLancadas) return null;
  // estoque primeiro e separado: se as contas tiverem recebimento manual, pelo menos o estoque volta
  const feito: string[] = [];
  if (v.estoqueLancado) {
    await executarAcoes('VENDA', d.vendaId, ['estornarEstoque'], null);
    feito.push('devolvi o estoque');
  }
  if (v.contasLancadas) {
    try {
      await executarAcoes('VENDA', d.vendaId, ['estornarContas'], null);
      feito.push('estornei as contas e comissões');
    } catch (e) {
      if (feito.length) eventos.emitir('venda.alterada', { vendaId: d.vendaId, data: v.data, tipo: v.tipo });
      throw new AppError(`${feito.length ? 'Estoque devolvido, mas as contas não: ' : ''}${msg(e)}`, 422);
    }
  }
  eventos.emitir('venda.alterada', { vendaId: d.vendaId, data: v.data, tipo: v.tipo });
  return `Venda nº ${d.numero} cancelada ainda contava: ${feito.join(' e ')}.`;
}

// ------------------------------------------------------------------ gravação dos avisos
const ORDEM_NIVEL: Record<string, number> = { erro: 0, aviso: 1, info: 2 };

async function registrarCorrecao(c: Corretor, a: Alvo, texto: string) {
  await prisma.roboSaudeAviso.create({
    data: { chave: `${c.id}:${a.alvo}`, tipo: 'CORRECAO', nivel: a.nivel, area: a.area, titulo: a.titulo, mensagem: texto, link: a.link ?? null, status: 'FEITA', resolvidoPor: ROBO, resolvidoEm: new Date() },
  });
  // fecha a sugestão aberta do mesmo alvo
  await prisma.roboSaudeAviso.updateMany({ where: { chave: `${c.id}:${a.alvo}`, status: 'ABERTA' }, data: { status: 'RESOLVIDA', resolvidoPor: ROBO, resolvidoEm: new Date() } });
  await auditar(null, 'RoboSaude', null, 'ACAO', { correcao: c.id, alvo: a.alvo, texto });
}

async function abrirOuAtualizar(chave: string, p: { tipo: 'SUGESTAO' | 'ALERTA'; nivel: string; area: string; titulo: string; mensagem: string; link?: string | null; acoes?: AcaoSugestao[]; dados?: unknown; tecnicoId?: number | null; vendedorId?: number | null }) {
  const aberta = await prisma.roboSaudeAviso.findFirst({ where: { chave, status: 'ABERTA' }, orderBy: { id: 'desc' } });
  const data = { tipo: p.tipo, nivel: p.nivel, area: p.area, titulo: p.titulo, mensagem: p.mensagem, link: p.link ?? null, acoes: p.acoes?.length ? JSON.stringify(p.acoes) : null, dados: p.dados ? JSON.stringify(p.dados) : null, tecnicoId: p.tecnicoId ?? null, vendedorId: p.vendedorId ?? null };
  if (aberta) {
    const mudou = aberta.titulo !== data.titulo || aberta.mensagem !== data.mensagem || aberta.acoes !== data.acoes || aberta.dados !== data.dados || aberta.nivel !== data.nivel || aberta.tecnicoId !== data.tecnicoId || aberta.vendedorId !== data.vendedorId;
    if (mudou) await prisma.roboSaudeAviso.update({ where: { id: aberta.id }, data });
    return false;
  }
  // ignorada há menos de 7 dias: não volta a incomodar
  const ignorada = await prisma.roboSaudeAviso.findFirst({ where: { chave, status: 'IGNORADA', resolvidoEm: { gte: new Date(Date.now() - 7 * 86400_000) } } });
  if (ignorada) return false;
  await prisma.roboSaudeAviso.create({ data: { chave, ...data, status: 'ABERTA' } });
  return true;
}

/** Fecha as sugestões/alertas abertos cujo problema sumiu (resolvido por alguém na tela, ou pelo robô). */
async function fecharSumidos(prefixo: string, vivas: Set<string>) {
  const abertas = await prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA', chave: { startsWith: prefixo } }, select: { id: true, chave: true } });
  const sumidas = abertas.filter((a) => !vivas.has(a.chave)).map((a) => a.id);
  if (sumidas.length) await prisma.roboSaudeAviso.updateMany({ where: { id: { in: sumidas } }, data: { status: 'RESOLVIDA', resolvidoPor: 'sistema', resolvidoEm: new Date() } });
}

// ------------------------------------------------------------------ a rodada
let rodando: Promise<Estado | null> | null = null;

export function estaRodando() {
  return !!rodando;
}

export async function rodarRobo(origem = 'agendado', opts: { forcar?: boolean } = {}): Promise<Estado | null> {
  if (rodando) return rodando;
  rodando = (async () => {
    const inicio = Date.now();
    const cfg = await lerConfig();
    if (!cfg.ligado && !opts.forcar) return lerEstado();
    let corrigidas = 0;
    for (const c of corretores) {
      const vivas = new Set<string>();
      let alvos: Alvo[] = [];
      try {
        alvos = await c.buscar();
      } catch (e) {
        console.error(`[robo-saude] falha ao conferir ${c.id}`, e);
        // não fecha nada se a conferência falhou
        for (const a of await prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA', chave: { startsWith: `${c.id}:` } }, select: { chave: true } })) vivas.add(a.chave);
      }
      for (const a of alvos) {
        const chave = `${c.id}:${a.alvo}`;
        let motivo: string | null = null;
        if (c.auto && cfg.autoCorrigir) {
          try {
            const feito = await c.auto(a);
            if (feito) {
              await registrarCorrecao(c, a, feito);
              corrigidas++;
              continue;
            }
          } catch (e) {
            motivo = msg(e);
          }
        }
        vivas.add(chave);
        const acoes = c.acoes?.(a) ?? [];
        await abrirOuAtualizar(chave, {
          tipo: acoes.length ? 'SUGESTAO' : 'ALERTA',
          nivel: a.nivel,
          area: a.area,
          titulo: a.titulo,
          mensagem: motivo ? `${a.mensagem} O robô tentou resolver e não conseguiu: ${motivo}` : a.mensagem,
          link: a.link,
          acoes,
          dados: a.dados,
          tecnicoId: a.tecnicoId,
          vendedorId: a.vendedorId,
        });
      }
      await fecharSumidos(`${c.id}:`, vivas);
    }

    // o resto da Saúde do sistema (sem correção automática) vira alerta com o link de onde resolver
    const d = await diagnosticar();
    const vivasAlerta = new Set<string>();
    for (const a of d.achados) {
      if (porId.has(a.id) || a.nivel === 'info') continue;
      const chave = `alerta:${a.id}`;
      vivasAlerta.add(chave);
      await abrirOuAtualizar(chave, {
        tipo: 'ALERTA',
        nivel: a.nivel,
        area: a.area,
        titulo: `${a.titulo} (${a.qtd})`,
        mensagem: `${a.explicacao} Como resolver: ${a.comoResolver}`,
        link: a.link ?? a.exemplos[0]?.link ?? '/configuracoes/saude',
      });
    }
    await fecharSumidos('alerta:', vivasAlerta);

    const estado: Estado = {
      ultimaVez: new Date().toISOString(),
      duracaoMs: Date.now() - inicio,
      saudePct: calcularSaude(d.verificacoes, d.achados),
      resumo: d.resumo,
      verificacoes: d.verificacoes,
      corrigidasNaRodada: corrigidas,
      origem,
      erro: null,
    };
    await gravarEstado(estado);
    return estado;
  })()
    .catch(async (e) => {
      console.error('[robo-saude] rodada falhou', e);
      const anterior = await lerEstado();
      const estado: Estado = { ...(anterior ?? { duracaoMs: 0, saudePct: 0, resumo: { erro: 0, aviso: 0, info: 0 }, verificacoes: 0, corrigidasNaRodada: 0 }), ultimaVez: new Date().toISOString(), origem, erro: msg(e) } as Estado;
      await gravarEstado(estado).catch(() => undefined);
      return estado;
    })
    .finally(() => {
      rodando = null;
    });
  return rodando;
}

// ------------------------------------------------------------------ ações vindas da tela (1 clique)
export async function executarSugestao(id: number, codigo: string, usuario: { id: number | null; nome: string }) {
  const s = await prisma.roboSaudeAviso.findUnique({ where: { id } });
  if (!s || s.tipo === 'CORRECAO') throw new AppError('Sugestão não encontrada.', 404, 'NAO_ENCONTRADO');
  if (s.status !== 'ABERTA') throw new AppError('Essa sugestão já foi resolvida.', 409, 'JA_RESOLVIDA');
  const c = porId.get(s.chave.split(':')[0]);
  const acoes: AcaoSugestao[] = s.acoes ? JSON.parse(s.acoes) : [];
  if (!c?.executar || !acoes.some((a) => a.codigo === codigo)) throw new AppError('Essa ação não está disponível para esta sugestão.', 422, 'ACAO_INVALIDA');
  const texto = await c.executar(codigo, s.dados ? JSON.parse(s.dados) : {}, usuario.id);
  await prisma.roboSaudeAviso.update({ where: { id }, data: { status: 'RESOLVIDA', resolvidoPor: usuario.nome, resolvidoEm: new Date(), lida: true, mensagem: texto } });
  await auditar(null, 'RoboSaude', id, 'ACAO', { sugestao: s.chave, acao: codigo, por: usuario.nome, texto });
  agendarRodada(5_000, 'depois de um clique');
  return texto;
}

/** "Resolver tudo": aperta o botão principal de todas as sugestões marcadas como seguras para lote. */
export async function resolverTudo(usuario: { id: number | null; nome: string }) {
  const abertas = await prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA', tipo: 'SUGESTAO' }, orderBy: { id: 'asc' } });
  const ok: string[] = [];
  const falhas: string[] = [];
  for (const s of abertas) {
    const acao = (s.acoes ? (JSON.parse(s.acoes) as AcaoSugestao[]) : []).find((a) => a.lote);
    if (!acao) continue;
    try {
      ok.push(await executarSugestao(s.id, acao.codigo, usuario));
    } catch (e) {
      falhas.push(`${s.titulo}: ${msg(e)}`);
    }
  }
  return { resolvidas: ok.length, falhas, textos: ok };
}

export async function ignorarSugestao(id: number, usuario: { nome: string }) {
  const s = await prisma.roboSaudeAviso.findUnique({ where: { id } });
  if (!s || s.tipo === 'CORRECAO') throw new AppError('Sugestão não encontrada.', 404, 'NAO_ENCONTRADO');
  await prisma.roboSaudeAviso.update({ where: { id }, data: { status: 'IGNORADA', resolvidoPor: usuario.nome, resolvidoEm: new Date(), lida: true } });
}

// ------------------------------------------------------------------ painel
export function formatarAviso(a: { id: number; chave: string; tipo: string; nivel: string; area: string; titulo: string; mensagem: string; link: string | null; acoes: string | null; status: string; lida: boolean; resolvidoPor: string | null; resolvidoEm: Date | null; criadoEm: Date; tecnicoId?: number | null; vendedorId?: number | null }) {
  return {
    id: a.id,
    chave: a.chave,
    tipo: a.tipo,
    nivel: a.nivel,
    area: a.area,
    titulo: a.titulo,
    mensagem: a.mensagem,
    link: a.link,
    acoes: a.acoes ? (JSON.parse(a.acoes) as AcaoSugestao[]) : [],
    status: a.status,
    lida: a.lida,
    resolvidoPor: a.resolvidoPor,
    resolvidoEm: a.resolvidoEm,
    criadoEm: a.criadoEm,
    tecnicoId: a.tecnicoId ?? null,
    vendedorId: a.vendedorId ?? null,
  };
}

// ------------------------------------------------------------------ lembretes da equipe (qualquer perfil)
/**
 * Lembretes do robô endereçados a uma pessoa: os avisos abertos cujo técnico/vendedor é o do login.
 * ADMIN e GERENTE recebem também "equipe": todos os lembretes com destinatário, com o nome de quem precisa agir.
 */
export async function lembretesDe(usuario: { perfil: string; tecnicoId?: number | null; vendedorId?: number | null }) {
  const ou: { tecnicoId?: number; vendedorId?: number }[] = [];
  if (usuario.tecnicoId) ou.push({ tecnicoId: usuario.tecnicoId });
  if (usuario.vendedorId) ou.push({ vendedorId: usuario.vendedorId });
  const meus = ou.length ? await prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA', OR: ou }, orderBy: [{ nivel: 'asc' }, { id: 'desc' }], take: 100 }) : [];
  const gestao = usuario.perfil === 'ADMIN' || usuario.perfil === 'GERENTE';
  const equipe = gestao ? await prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA', OR: [{ tecnicoId: { not: null } }, { vendedorId: { not: null } }] }, orderBy: [{ nivel: 'asc' }, { id: 'desc' }], take: 300 }) : [];
  // nomes de quem precisa agir (para a gerência cobrar a pessoa certa)
  const tecIds = [...new Set(equipe.map((a) => a.tecnicoId).filter((x): x is number => !!x))];
  const vendIds = [...new Set(equipe.map((a) => a.vendedorId).filter((x): x is number => !!x))];
  const [tecs, vends] = await Promise.all([
    tecIds.length ? prisma.tecnico.findMany({ where: { id: { in: tecIds } }, select: { id: true, nome: true } }) : [],
    vendIds.length ? prisma.vendedor.findMany({ where: { id: { in: vendIds } }, select: { id: true, nome: true } }) : [],
  ]);
  const nomeTec = new Map(tecs.map((t) => [t.id, t.nome]));
  const nomeVend = new Map(vends.map((v) => [v.id, v.nome]));
  const quem = (a: { tecnicoId: number | null; vendedorId: number | null }) => (a.tecnicoId ? nomeTec.get(a.tecnicoId) ?? 'Técnico' : a.vendedorId ? nomeVend.get(a.vendedorId) ?? 'Vendedor' : null);
  const semDono = gestao ? await prisma.roboSaudeAviso.count({ where: { status: 'ABERTA', chave: { startsWith: 'os-sem-custo:' }, tecnicoId: null } }) : 0;
  return {
    meus: meus.map(formatarAviso),
    equipe: equipe.map((a) => ({ ...formatarAviso(a), quem: quem(a) })),
    /** OS sem técnico com peça sem custo: ninguém recebe o lembrete — a gerência precisa atribuir o técnico */
    semDono,
  };
}

export async function painelRobo() {
  const [cfg, estado, abertas, correcoes, naoLidas, corrigidasHoje] = await Promise.all([
    lerConfig(),
    lerEstado(),
    prisma.roboSaudeAviso.findMany({ where: { status: 'ABERTA' }, orderBy: { id: 'desc' }, take: 300 }),
    prisma.roboSaudeAviso.findMany({ where: { tipo: { in: ['CORRECAO'] } }, orderBy: { id: 'desc' }, take: 40 }),
    prisma.roboSaudeAviso.count({ where: { tipo: 'CORRECAO', lida: false } }),
    prisma.roboSaudeAviso.count({ where: { tipo: 'CORRECAO', criadoEm: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
  ]);
  const resolvidasPorClique = await prisma.roboSaudeAviso.findMany({ where: { tipo: 'SUGESTAO', status: 'RESOLVIDA', resolvidoPor: { notIn: ['sistema', ROBO] } }, orderBy: { resolvidoEm: 'desc' }, take: 10 });
  abertas.sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'SUGESTAO' ? -1 : 1) || (ORDEM_NIVEL[a.nivel] ?? 9) - (ORDEM_NIVEL[b.nivel] ?? 9) || b.id - a.id);
  const sugestoes = abertas.filter((a) => a.tipo === 'SUGESTAO');
  return {
    config: cfg,
    estado,
    rodando: estaRodando(),
    intervaloMin: INTERVALO_MS / 60_000,
    pendentes: abertas.length,
    sugestoesEmLote: sugestoes.filter((s) => (s.acoes ? (JSON.parse(s.acoes) as AcaoSugestao[]) : []).some((x) => x.lote)).length,
    naoLidas,
    corrigidasHoje,
    abertas: abertas.map(formatarAviso),
    correcoes: correcoes.map(formatarAviso),
    resolvidasPorClique: resolvidasPorClique.map(formatarAviso),
  };
}

export async function marcarLidas() {
  await prisma.roboSaudeAviso.updateMany({ where: { lida: false }, data: { lida: true } });
}

// ------------------------------------------------------------------ agenda
export const INTERVALO_MS = 5 * 60_000;
let timer: NodeJS.Timeout | null = null;

/** "Conciliando na hora": depois de um movimento, roda de novo em alguns segundos (agrupa vários movimentos). */
export function agendarRodada(folgaMs = 45_000, origem = 'movimento no sistema') {
  if (process.env.ROBO_SAUDE === 'off') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    // a rodada é do robô, não da requisição que a agendou (trilha de auditoria)
    void comContexto({ origem: 'SERVICO', servico: 'robo-saude' }, () => rodarRobo(origem));
  }, folgaMs);
  timer.unref?.();
}
