/**
 * OPERAÇÕES DA TRILHA — cabeçalho, fechamento e a frase legível de cada operação.
 *
 * Uma operação = uma requisição (tela/API/PDV) ou uma rajada de um serviço de fundo. O cabeçalho
 * (AuditoriaOperacao) nasce no primeiro evento da trilha (trilha.ts) ou na primeira ação da
 * auditoria legível (lib/auditoria.ts → garantirCabecalho). Ao responder a requisição, o app.ts
 * chama fecharOperacao, que guarda o HTTP devolvido e monta a descrição.
 */
import type { ContextoOperacao } from './contexto.js';
import { autorDoContexto, rotacionarSeRajada } from './contexto.js';
import { clienteSemTrilha } from './trilha.js';
import { descreverAuditorias } from '../dashboard/atividades.js';

const db = () => clienteSemTrilha();

export async function garantirCabecalho(ctx: ContextoOperacao, categoria = 'sistema') {
  rotacionarSeRajada(ctx);
  if (ctx.cabecalhoGravado) return;
  const autor = autorDoContexto(ctx);
  await db()
    .auditoriaOperacao.upsert({
      where: { id: ctx.operacaoId },
      create: { id: ctx.operacaoId, usuarioId: autor.id, usuario: autor.nome, origem: ctx.reverteOpId ? 'REVERSAO' : autor.origem, rota: autor.rota, ip: autor.ip, categoria, reverteOpId: ctx.reverteOpId ?? null },
      update: {},
    })
    .catch(() => undefined);
  ctx.cabecalhoGravado = true;
}

/** Fecha a operação da requisição: HTTP devolvido, hora do fim e a descrição legível. */
export async function fecharOperacao(ctx: ContextoOperacao, status: number) {
  if (!ctx.cabecalhoGravado) return;
  try {
    const descricao = await descreverOperacao(ctx.operacaoId);
    await db().auditoriaOperacao.update({ where: { id: ctx.operacaoId }, data: { fim: new Date(), status, descricao: descricao.slice(0, 500) } });
  } catch {
    /* nunca derruba a resposta */
  }
}

// -------------------------------------------------------------------------------------------------
// descrição legível
// -------------------------------------------------------------------------------------------------
export const NOME_TABELA: Record<string, [string, string]> = {
  Venda: ['venda', 'vendas'],
  VendaItem: ['item da venda', 'itens da venda'],
  VendaParcela: ['parcela da venda', 'parcelas da venda'],
  VendaRoboNf: ['checklist de NF da venda', 'checklists de NF'],
  AlocacaoCompra: ['vínculo venda × compra', 'vínculos venda × compra'],
  OrdemServico: ['OS', 'OS'],
  OrdemServicoItem: ['item da OS', 'itens da OS'],
  OrdemServicoParcela: ['parcela da OS', 'parcelas da OS'],
  OrdemServicoAnexo: ['anexo da OS', 'anexos da OS'],
  Compra: ['pedido de compra', 'pedidos de compra'],
  CompraItem: ['item da compra', 'itens da compra'],
  CompraParcela: ['parcela da compra', 'parcelas da compra'],
  Produto: ['produto', 'produtos'],
  EstoqueSaldo: ['saldo de estoque', 'saldos de estoque'],
  MovimentoEstoque: ['movimento de estoque', 'movimentos de estoque'],
  CategoriaProduto: ['categoria de produto', 'categorias de produto'],
  Deposito: ['depósito', 'depósitos'],
  ContaReceber: ['conta a receber', 'contas a receber'],
  ContaPagar: ['conta a pagar', 'contas a pagar'],
  MovimentoFinanceiro: ['lançamento de caixa/banco', 'lançamentos de caixa/banco'],
  ContaFinanceira: ['conta financeira', 'contas financeiras'],
  TransacaoBancaria: ['transação bancária', 'transações bancárias'],
  FormaPagamento: ['forma de pagamento', 'formas de pagamento'],
  CategoriaFinanceira: ['categoria financeira', 'categorias financeiras'],
  Caixinha: ['caixinha', 'caixinhas'],
  Emprestimo: ['empréstimo', 'empréstimos'],
  Carne: ['carnê', 'carnês'],
  NotaFiscal: ['nota fiscal', 'notas fiscais'],
  NotaFiscalItem: ['item da nota', 'itens da nota'],
  NotaFiscalEvento: ['evento da nota', 'eventos da nota'],
  Consignacao: ['consignação', 'consignações'],
  ConsignacaoDesconto: ['desconto de consignação', 'descontos de consignação'],
  ConsignacaoEvento: ['evento de consignação', 'eventos de consignação'],
  Contato: ['contato', 'contatos'],
  Notificacao: ['mensagem', 'mensagens'],
  TemplateNotificacao: ['modelo de mensagem', 'modelos de mensagem'],
  Usuario: ['usuário', 'usuários'],
  ChaveApi: ['chave de API', 'chaves de API'],
  Empresa: ['dados da empresa', 'dados da empresa'],
  Configuracao: ['configuração', 'configurações'],
  Situacao: ['situação', 'situações'],
  SituacaoTransicao: ['transição de situação', 'transições de situação'],
  Sequencia: ['numeração', 'numerações'],
  WebhookSaida: ['webhook', 'webhooks'],
  RoboSaudeAviso: ['aviso do Robô da Saúde', 'avisos do Robô da Saúde'],
  Lembrete: ['lembrete', 'lembretes'],
  HistoricoSituacao: ['histórico de situação', 'históricos de situação'],
  Comissao: ['comissão', 'comissões'],
  Desafio: ['desafio', 'desafios'],
  DesafioConquista: ['conquista de desafio', 'conquistas de desafio'],
  MetaVendedor: ['meta do vendedor', 'metas de vendedor'],
  MetaTecnico: ['meta do técnico', 'metas de técnico'],
  Vendedor: ['vendedor', 'vendedores'],
  Tecnico: ['técnico', 'técnicos'],
};
export const nomeTabela = (t: string, plural = false) => NOME_TABELA[t]?.[plural ? 1 : 0] ?? t;

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? fmt.format(v) : null);

/** "venda nº 24891 (R$ 1.200,00)" a partir do próprio snapshot — sem consultar o banco */
export function rotuloRegistro(tabela: string, registroId: number | null, registroChave: string | null, snap: Record<string, any> | null): string {
  const s = snap ?? {};
  const id = registroId ?? registroChave ?? '?';
  const com = (base: string, valor?: unknown) => (moeda(valor) ? `${base} (${moeda(valor)})` : base);
  switch (tabela) {
    case 'Venda':
      return com(`${s.tipo === 'ORCAMENTO' ? 'orçamento' : 'venda'} nº ${s.numero ?? id}`, s.total);
    case 'OrdemServico':
      return com(`OS nº ${s.numero ?? id}`, s.total);
    case 'Compra':
      return com(`pedido de compra nº ${s.numero ?? id}`, s.total);
    case 'NotaFiscal':
      return com(`${s.modelo === 65 ? 'NFC-e' : 'NF-e'} nº ${s.numero ?? id}`, s.valorTotal);
    case 'Produto':
      return `produto ${s.nome ?? '#' + id}`;
    case 'Contato':
      return `contato ${s.nome ?? '#' + id}`;
    case 'Usuario':
      return `usuário ${s.nome ?? '#' + id}`;
    case 'Vendedor':
    case 'Tecnico':
      return `${nomeTabela(tabela)} ${s.nome ?? '#' + id}`;
    case 'ContaReceber':
    case 'ContaPagar':
      return com(`${nomeTabela(tabela)} "${s.descricao ?? '#' + id}"`, s.valor);
    case 'MovimentoFinanceiro':
      return com(`${s.tipo === 'SAIDA' ? 'saída' : s.tipo === 'TRANSFERENCIA' ? 'transferência' : 'entrada'} "${s.descricao ?? '#' + id}"`, s.valor);
    case 'ContaFinanceira':
      return `conta ${s.nome ?? '#' + id}`;
    case 'EstoqueSaldo':
      return `saldo de estoque do produto #${s.produtoId ?? '?'} (saldo ${s.saldo ?? '?'})`;
    case 'MovimentoEstoque':
      return `movimento de estoque ${s.tipo ?? ''} produto #${s.produtoId ?? '?'} (${s.quantidade ?? '?'})`.trim();
    case 'VendaItem':
    case 'OrdemServicoItem':
    case 'CompraItem':
    case 'NotaFiscalItem':
      return com(`${nomeTabela(tabela)} "${s.descricao ?? '#' + id}"`, s.total);
    case 'Comissao':
      return com(`comissão ${s.descricao ? `"${s.descricao}"` : '#' + id}`, s.valor);
    case 'Caixinha':
      return com(`caixinha "${s.nome ?? '#' + id}"`, s.valorAlvo ?? s.valor);
    case 'Consignacao':
      return com(`consignação nº ${s.numero ?? id}`, s.valorConsignante ?? s.valor);
    case 'Configuracao':
      return `configuração ${registroChave ?? id}`;
    case 'Sequencia':
      return `numeração ${registroChave ?? id}`;
    case 'Notificacao':
      return `mensagem por ${s.canal === 'WHATSAPP' ? 'WhatsApp' : s.canal === 'EMAIL' ? 'e-mail' : s.canal ?? ''} para ${s.destinatario ?? '?'}`;
    case 'Situacao':
      return `situação "${s.nome ?? '#' + id}"`;
    case 'Lembrete':
      return `lembrete "${String(s.texto ?? '').slice(0, 40) || '#' + id}"`;
    case 'RoboSaudeAviso':
      return `aviso "${String(s.titulo ?? '').slice(0, 50) || '#' + id}"`;
    default:
      return `${nomeTabela(tabela)} #${id}`;
  }
}

/** Link da tela do registro (quando existe) */
export function linkRegistro(tabela: string, registroId: number | null, snap: Record<string, any> | null): string | null {
  if (!registroId) return null;
  switch (tabela) {
    case 'Venda':
      return `/${snap?.tipo === 'ORCAMENTO' ? 'orcamentos' : 'vendas'}/${registroId}`;
    case 'VendaItem':
    case 'VendaParcela':
    case 'VendaRoboNf':
      return snap?.vendaId ? `/vendas/${snap.vendaId}` : null;
    case 'OrdemServico':
      return `/ordens-servico/${registroId}`;
    case 'OrdemServicoItem':
    case 'OrdemServicoParcela':
    case 'OrdemServicoAnexo':
      return snap?.osId ? `/ordens-servico/${snap.osId}` : null;
    case 'Compra':
      return `/compras/${registroId}`;
    case 'CompraItem':
    case 'CompraParcela':
      return snap?.compraId ? `/compras/${snap.compraId}` : null;
    case 'NotaFiscal':
      return `/notas-fiscais/${registroId}`;
    case 'NotaFiscalItem':
    case 'NotaFiscalEvento':
      return snap?.notaId ? `/notas-fiscais/${snap.notaId}` : null;
    case 'Produto':
      return `/produtos/${registroId}`;
    case 'Contato':
      return `/contatos/${registroId}`;
    case 'ContaReceber':
      return '/financeiro/receber';
    case 'ContaPagar':
      return '/financeiro/pagar';
    case 'MovimentoFinanceiro':
    case 'TransacaoBancaria':
    case 'ContaFinanceira':
      return '/financeiro/bancos';
    case 'Caixinha':
      return '/financeiro/caixinhas';
    case 'Emprestimo':
      return '/financeiro/emprestimos';
    case 'Carne':
      return '/financeiro/carnes';
    case 'Comissao':
      return '/comissoes';
    case 'Consignacao':
      return `/consignacoes/${registroId}`;
    case 'ConsignacaoDesconto':
    case 'ConsignacaoEvento':
      return snap?.consignacaoId ? `/consignacoes/${snap.consignacaoId}` : null;
    case 'Usuario':
      return '/configuracoes/usuarios';
    case 'Notificacao':
      return '/comunicacao/notificacoes';
    case 'Desafio':
    case 'MetaVendedor':
    case 'MetaTecnico':
      return '/metas-desafios';
    case 'EstoqueSaldo':
    case 'MovimentoEstoque':
      return snap?.produtoId ? `/produtos/${snap.produtoId}` : '/estoque';
    default:
      return null;
  }
}

/** rótulo da rota ("POST /api/v1/vendas/12/finalizar" → "Finalizar venda") */
const ROTULOS_ROTA: [RegExp, string][] = [
  [/^POST \/api\/v1\/auth\/login$/, 'Entrou no sistema'],
  [/^POST \/api\/v1\/vendas\/\d+\/finalizar/, 'Finalizar venda'],
  [/^POST \/api\/v1\/vendas\/\d+\/situacao/, 'Mudar situação da venda'],
  [/^POST \/api\/v1\/vendas\/\d+\/converter/, 'Converter orçamento em venda'],
  [/^POST \/api\/v1\/vendas\/\d+\/emitir-nf/, 'Emitir NF da venda'],
  [/^POST \/api\/v1\/vendas\/\d+\/link-pagamento/, 'Gerar link de pagamento'],
  [/^POST \/api\/v1\/vendas$/, 'Criar venda/orçamento'],
  [/^PUT \/api\/v1\/vendas\/\d+$/, 'Editar venda'],
  [/^DELETE \/api\/v1\/vendas\/\d+$/, 'Excluir venda'],
  [/^POST \/api\/v1\/ordens-servico$/, 'Abrir OS'],
  [/^PUT \/api\/v1\/ordens-servico\/\d+$/, 'Editar OS'],
  [/^POST \/api\/v1\/ordens-servico\/\d+\/situacao/, 'Mudar situação da OS'],
  [/^DELETE \/api\/v1\/ordens-servico\/\d+$/, 'Excluir OS'],
  [/^POST \/api\/v1\/compras$/, 'Criar pedido de compra'],
  [/^PUT \/api\/v1\/compras\/\d+$/, 'Editar pedido de compra'],
  [/^POST \/api\/v1\/compras\/\d+\/situacao/, 'Mudar situação da compra'],
  [/^DELETE \/api\/v1\/compras\/\d+$/, 'Excluir pedido de compra'],
  [/^POST \/api\/v1\/contas-receber\/\d+\/(baixar|receber)/, 'Receber conta'],
  [/^POST \/api\/v1\/contas-receber\/\d+\/estornar/, 'Estornar recebimento'],
  [/^POST \/api\/v1\/contas-pagar\/\d+\/(baixar|pagar)/, 'Pagar conta'],
  [/^POST \/api\/v1\/contas-pagar\/\d+\/estornar/, 'Estornar pagamento'],
  [/^POST \/api\/v1\/contas-(receber|pagar)$/, 'Lançar conta'],
  [/^POST \/api\/v1\/financeiro\/movimentos/, 'Lançar no caixa/banco'],
  [/^POST \/api\/v1\/financeiro\/transferencia/, 'Transferir entre contas'],
  [/^POST \/api\/v1\/estoque\/ajuste/, 'Ajustar estoque'],
  [/^POST \/api\/v1\/estoque\/transferencia/, 'Transferir estoque'],
  [/^POST \/api\/v1\/produtos$/, 'Cadastrar produto'],
  [/^PUT \/api\/v1\/produtos\/\d+$/, 'Editar produto'],
  [/^DELETE \/api\/v1\/produtos\/\d+$/, 'Excluir produto'],
  [/^POST \/api\/v1\/contatos$/, 'Cadastrar contato'],
  [/^PUT \/api\/v1\/contatos\/\d+$/, 'Editar contato'],
  [/^DELETE \/api\/v1\/contatos\/\d+$/, 'Excluir contato'],
  [/^POST \/api\/v1\/notas-fiscais\/\d+\/transmitir/, 'Transmitir NF à SEFAZ'],
  [/^POST \/api\/v1\/notas-fiscais\/\d+\/cancelar/, 'Cancelar NF'],
  [/^POST \/api\/v1\/usuarios$/, 'Criar usuário'],
  [/^PUT \/api\/v1\/usuarios\/\d+$/, 'Editar usuário'],
  [/^DELETE \/api\/v1\/usuarios\/\d+$/, 'Desativar usuário'],
  [/^POST \/api\/v1\/comissoes\/(aprovar|pagar|cancelar|recalcular)/, 'Comissões'],
  [/^POST \/api\/v1\/integracoes\/site\//, 'PDV do site'],
  [/^POST \/api\/v1\/auditoria\/painel\/reverter/, 'Reversão pelo Painel de auditoria'],
  [/^POST \/api\/v1\/auditoria\/painel\/entrar/, 'Entrada no Painel de auditoria'],
];
export function rotuloRota(rota: string | null | undefined): string | null {
  if (!rota) return null;
  for (const [re, r] of ROTULOS_ROTA) if (re.test(rota)) return r;
  const [metodo, url] = rota.split(' ');
  const partes = (url ?? '').replace(/^\/api\/v1\//, '').split('/').filter(Boolean);
  const recurso = partes[0]?.replace(/-/g, ' ') ?? '';
  const acao = partes.filter((p) => !/^\d+$/.test(p)).slice(1).join(' ').replace(/-/g, ' ');
  if (metodo === 'GET' || metodo === 'HEAD') return `Consulta: ${[recurso, acao].filter(Boolean).join(' ')}`.trim();
  const verbo = metodo === 'POST' ? (acao ? '' : 'Criar') : metodo === 'PUT' || metodo === 'PATCH' ? 'Alterar' : metodo === 'DELETE' ? 'Excluir' : '';
  return [verbo, acao || null, recurso].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || rota;
}

/** Monta a frase da operação: ações legíveis (auditoria) + resumo dos registros gravados. */
export async function descreverOperacao(operacaoId: string): Promise<string> {
  const base = db();
  const [op, auditorias, eventos] = await Promise.all([
    base.auditoriaOperacao.findUnique({ where: { id: operacaoId }, select: { rota: true, origem: true, reverteOpId: true } }),
    base.auditoria.findMany({ where: { operacaoId }, orderBy: { id: 'asc' }, select: { id: true, entidade: true, entidadeId: true, acao: true, detalhes: true } }),
    base.auditoriaEvento.findMany({ where: { operacaoId }, orderBy: { sequencia: 'asc' }, select: { tabela: true, tipo: true, registroId: true, registroChave: true, antes: true, depois: true, modo: true } }),
  ]);
  const frases = (await descreverAuditorias(auditorias)).map((d) => d.texto).filter((t) => t && !/^entrou no sistema$/.test(t) || auditorias.length === 1);
  if (op?.reverteOpId) return `Reverteu a operação ${op.reverteOpId.slice(0, 8)}: ${resumoEventos(eventos)}`;
  const titulo = rotuloRota(op?.rota);
  const partes: string[] = [];
  if (frases.length) partes.push([...new Set(frases)].slice(0, 3).join('; '));
  else if (titulo) partes.push(titulo);
  if (eventos.length) partes.push(resumoEventos(eventos, frases.length > 0));
  return partes.join(' — ') || titulo || 'Operação';
}

const FEMININAS = new Set(['Venda', 'VendaParcela', 'OrdemServico', 'OrdemServicoParcela', 'NotaFiscal', 'ContaReceber', 'ContaPagar', 'Consignacao', 'Caixinha', 'ContaFinanceira', 'Comissao', 'Configuracao', 'Situacao', 'SituacaoTransicao', 'Sequencia', 'Notificacao', 'MetaVendedor', 'MetaTecnico', 'TransacaoBancaria', 'CompraParcela', 'CategoriaProduto', 'CategoriaFinanceira', 'FormaPagamento', 'ChaveApi', 'ConsignacaoDesconto', 'DesafioConquista', 'OrdemServicoAnexo']);
const VERBO: Record<string, string> = { CRIAR: 'criad', ALTERAR: 'alterad', EXCLUIR: 'excluíd' };
const conjuga = (tabela: string, tipo: string, plural: boolean) => `${VERBO[tipo] ?? tipo.toLowerCase()}${FEMININAS.has(tabela) ? 'a' : 'o'}${plural ? 's' : ''}`;

/** "venda nº 24891 alterada (total, situacaoId); 3 itens da venda criados; 1 conta a receber criada" */
export function resumoEventos(eventos: { tabela: string; tipo: string; registroId: number | null; registroChave: string | null; antes: string | null; depois: string | null; modo: string }[], soContagens = false): string {
  const principais: string[] = [];
  const contagem = new Map<string, number>();
  for (const e of eventos) {
    const snap = lerJson(e.depois) ?? lerJson(e.antes);
    const destaque = !soContagens && ['Venda', 'OrdemServico', 'Compra', 'NotaFiscal', 'Contato', 'Produto', 'ContaReceber', 'ContaPagar', 'MovimentoFinanceiro', 'Consignacao', 'Usuario', 'Caixinha', 'Emprestimo', 'Carne', 'ContaFinanceira'].includes(e.tabela);
    if (destaque && e.modo === 'DIRETO' && principais.length < 3 && !snap?.__resumo) {
      principais.push(`${rotuloRegistro(e.tabela, e.registroId, e.registroChave, snap)} ${conjuga(e.tabela, e.tipo, false)}`);
    } else {
      const k = `${e.tabela}|${e.tipo}`;
      contagem.set(k, (contagem.get(k) ?? 0) + 1);
    }
  }
  const resto = [...contagem.entries()].slice(0, 6).map(([k, n]) => {
    const [tabela, tipo] = k.split('|');
    return `${n} ${nomeTabela(tabela, n > 1)} ${conjuga(tabela, tipo, n > 1)}`;
  });
  return [...principais, ...resto].join('; ');
}

export function lerJson(s: string | null): Record<string, any> | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}
