/**
 * CATÁLOGO DA API EXTERNA — o que uma chave de API pode ler e gravar.
 *
 * Pedido do Thiago (24/10/2026): conectar outros sistemas e agentes de IA ao MEU BLING, com uma tela
 * só do ADMIN onde ele libera, por chave, leitura e gravação de cada área do sistema.
 *
 * A chave usa as MESMAS rotas /api/v1 da tela (nada duplicado): este arquivo diz a que "recurso" cada
 * rota pertence e qual nível a chamada exige:
 *   GET/HEAD            → LEITURA
 *   POST/PUT/PATCH      → GRAVACAO   (inclui leitura)
 *   DELETE              → TOTAL      (gravação + exclusão)
 * Rota que não pertence a nenhum recurso fica FECHADA para chaves (padrão seguro), e as rotas de
 * administração (usuários, chaves, certificado, SMTP, Bling, configurações…) nunca abrem para chave.
 */

export type Nivel = 'LEITURA' | 'GRAVACAO' | 'TOTAL';
export const NIVEIS: Nivel[] = ['LEITURA', 'GRAVACAO', 'TOTAL'];
const PESO: Record<Nivel, number> = { LEITURA: 1, GRAVACAO: 2, TOTAL: 3 };

export interface Recurso {
  chave: string;
  nome: string;
  descricao: string;
  /** rotas (sem /api/v1) que pertencem ao recurso */
  rotas: RegExp[];
  /** nível máximo que faz sentido oferecer */
  maximo?: Nivel;
}

export const RECURSOS: Recurso[] = [
  { chave: 'clientes', nome: 'Clientes e fornecedores', descricao: 'Cadastro de contatos (clientes, fornecedores, transportadoras), histórico do cliente e CEP.', rotas: [/^\/contatos(\/|$)/] },
  { chave: 'produtos', nome: 'Produtos e estoque', descricao: 'Produtos, preços, saldos por depósito, movimentos, ajustes e transferências de estoque, categorias.', rotas: [/^\/produtos(\/|$)/, /^\/estoque(\/|$)/, /^\/categorias-produto(\/|$)/] },
  { chave: 'vendas', nome: 'Pedidos de venda e orçamentos', descricao: 'Criar, editar, mudar situação, aprovar/converter orçamento, PDF, enviar ao cliente.', rotas: [/^\/vendas(\/|$)/] },
  { chave: 'compras', nome: 'Pedidos de compra', descricao: 'Pedidos de compra, entrada de estoque, importação de XML.', rotas: [/^\/compras(\/|$)/] },
  { chave: 'os', nome: 'Ordens de serviço', descricao: 'Assistência técnica: OS, kanban, peças, orçamento, situação, impressão.', rotas: [/^\/ordens-servico(\/|$)/] },
  { chave: 'financeiro', nome: 'Financeiro', descricao: 'Contas a receber e a pagar, baixas, caixa e bancos, extrato, conciliação, categorias e contas financeiras.', rotas: [/^\/contas-receber(\/|$)/, /^\/contas-pagar(\/|$)/, /^\/financeiro(\/|$)/, /^\/bancos(\/|$)/, /^\/contas-financeiras(\/|$)/, /^\/categorias-financeiras(\/|$)/] },
  { chave: 'fiscal', nome: 'Notas fiscais', descricao: 'NF-e/NFC-e: listar, gerar, transmitir, consultar, cancelar, XML e DANFE.', rotas: [/^\/notas-fiscais(\/|$)/, /^\/fiscal(\/|$)/] },
  { chave: 'comissoes', nome: 'Comissões, metas e desafios', descricao: 'Comissões de vendedores e técnicos, metas do mês, desafios e painel do vendedor.', rotas: [/^\/comissoes(\/|$)/, /^\/metas(\/|$)/, /^\/desafios(\/|$)/, /^\/painel-vendedor(\/|$)/] },
  { chave: 'relatorios', nome: 'Relatórios e dashboards', descricao: 'Dashboards, DRE, vendas por período, produtos mais vendidos, contas, estoque.', rotas: [/^\/relatorios(\/|$)/, /^\/dashboard(\/|$)/], maximo: 'LEITURA' },
  { chave: 'comunicacao', nome: 'Mensagens (WhatsApp e e-mail)', descricao: 'Fila de mensagens, enviar WhatsApp/e-mail a clientes, modelos de mensagem, status do WhatsApp.', rotas: [/^\/notificacoes(\/|$)/, /^\/templates-notificacao(\/|$)/, /^\/whatsapp\/(status|enviar-teste)$/] },
  { chave: 'cadastros', nome: 'Cadastros auxiliares', descricao: 'Vendedores, técnicos, depósitos, formas de pagamento, situações (consulta) e dados da empresa (consulta).', rotas: [/^\/vendedores(\/|$)/, /^\/tecnicos(\/|$)/, /^\/depositos(\/|$)/, /^\/formas-pagamento(\/|$)/, /^\/situacoes(\/|$)/, /^\/empresa$/] },
];

/** Nunca abrem para chave de API, qualquer que seja a permissão. */
const BLOQUEADAS: { teste: RegExp; metodos?: string[] }[] = [
  { teste: /^\/usuarios(\/|$)/ },
  { teste: /^\/auth(\/|$)/ },
  { teste: /^\/api-externa(\/|$)/ },
  { teste: /^\/empresa\/(certificado|smtp|logo)/ },
  { teste: /^\/empresa$/, metodos: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { teste: /^\/situacoes(\/|$)/, metodos: ['POST', 'PUT', 'PATCH', 'DELETE'] },
  { teste: /^\/configuracoes(\/|$)/ },
  { teste: /^\/bling(\/|$)/ },
  { teste: /^\/diagnostico(\/|$)/ },
  { teste: /^\/auditoria(\/|$)/ },
  { teste: /^\/open-finance(\/|$)/ },
  { teste: /^\/whatsapp\/(conectar|desconectar|reconectar|eventos)/ },
  { teste: /^\/site\/catalogo/ },
  { teste: /^\/notas-fiscais\/inutilizar/ },
];

/** Rotas da própria API externa que qualquer chave válida usa (quem sou eu, documentação, MCP). */
const SEMPRE_LIBERADAS = [/^\/externo(\/|$)/, /^\/mcp(\/|$)/];

export function nivelExigido(metodo: string): Nivel {
  const m = metodo.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return 'LEITURA';
  if (m === 'DELETE') return 'TOTAL';
  return 'GRAVACAO';
}

export function recursoDaRota(rota: string): Recurso | null {
  return RECURSOS.find((r) => r.rotas.some((t) => t.test(rota))) ?? null;
}

export type Permissoes = Record<string, Nivel>;

/** Lê o JSON gravado, descartando recursos/níveis desconhecidos. */
export function lerPermissoes(json: string | null | undefined): Permissoes {
  let bruto: unknown = {};
  try {
    bruto = JSON.parse(json || '{}');
  } catch {
    bruto = {};
  }
  return limparPermissoes(bruto);
}

export function limparPermissoes(bruto: unknown): Permissoes {
  const out: Permissoes = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    const rec = RECURSOS.find((r) => r.chave === k);
    if (!rec || !NIVEIS.includes(v as Nivel)) continue;
    let nivel = v as Nivel;
    if (rec.maximo && PESO[nivel] > PESO[rec.maximo]) nivel = rec.maximo;
    out[k] = nivel;
  }
  return out;
}

export interface Decisao {
  ok: boolean;
  motivo?: string;
  recurso?: string;
  exigido?: Nivel;
}

/** A chave com estas permissões pode chamar método+rota (rota sem /api/v1)? */
export function chavePode(perm: Permissoes, metodo: string, rota: string): Decisao {
  const m = metodo.toUpperCase();
  if (SEMPRE_LIBERADAS.some((t) => t.test(rota))) return { ok: true };
  if (BLOQUEADAS.some((b) => b.teste.test(rota) && (!b.metodos || b.metodos.includes(m)))) {
    return { ok: false, motivo: 'Esta função é de administração do sistema e não fica disponível para chaves de API.' };
  }
  const rec = recursoDaRota(rota);
  if (!rec) return { ok: false, motivo: 'Esta rota não está liberada para chaves de API.' };
  const exigido = nivelExigido(m);
  const tem = perm[rec.chave];
  if (!tem || PESO[tem] < PESO[exigido]) {
    const palavra = exigido === 'LEITURA' ? 'leitura' : exigido === 'GRAVACAO' ? 'gravação' : 'exclusão (nível total)';
    return {
      ok: false,
      recurso: rec.chave,
      exigido,
      motivo: `A chave não tem permissão de ${palavra} em "${rec.nome}". O administrador libera em Configurações → API e integrações.`,
    };
  }
  return { ok: true, recurso: rec.chave, exigido };
}

export function podeNivel(perm: Permissoes, recurso: string, nivel: Nivel): boolean {
  const tem = perm[recurso];
  return !!tem && PESO[tem] >= PESO[nivel];
}

// ---------------------------------------------------------------------------------------------
// Endpoints documentados (tela "Documentação", OpenAPI e ferramentas do MCP).
// Não é a lista completa — é o que um sistema/agente mais usa, com o formato do corpo.
// ---------------------------------------------------------------------------------------------
export interface Endpoint {
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE';
  caminho: string;
  recurso: string;
  resumo: string;
  /** parâmetros de consulta aceitos (?a=&b=) */
  filtros?: string[];
  /** exemplo do corpo JSON */
  corpo?: unknown;
}

const PAG = ['pagina', 'limite'];

export const ENDPOINTS: Endpoint[] = [
  // clientes
  { metodo: 'GET', caminho: '/contatos', recurso: 'clientes', resumo: 'Lista/busca contatos (nome, documento, e-mail, telefone).', filtros: ['pesquisa', 'tipo (CLIENTE|FORNECEDOR|TRANSPORTADORA)', 'ativo', ...PAG] },
  { metodo: 'GET', caminho: '/contatos/{id}', recurso: 'clientes', resumo: 'Um contato com resumo (total comprado, OS, em aberto).' },
  { metodo: 'GET', caminho: '/contatos/{id}/historico', recurso: 'clientes', resumo: 'Histórico do cliente: vendas, OS, contas, mensagens e linha do tempo.' },
  { metodo: 'POST', caminho: '/contatos', recurso: 'clientes', resumo: 'Cadastra contato.', corpo: { tipo: 'CLIENTE', tipoPessoa: 'F', nome: 'Maria Souza', documento: '12345678909', email: 'maria@email.com', celular: '19999990000', cep: '13025000', logradouro: 'Av. Anchieta', numero: '789', bairro: 'Cambuí', municipio: 'Campinas', uf: 'SP' } },
  { metodo: 'PUT', caminho: '/contatos/{id}', recurso: 'clientes', resumo: 'Altera contato (mesmo corpo do cadastro).' },
  { metodo: 'GET', caminho: '/contatos/cep/{cep}', recurso: 'clientes', resumo: 'Endereço pelo CEP (ViaCEP).' },
  // produtos
  { metodo: 'GET', caminho: '/produtos', recurso: 'produtos', resumo: 'Lista/busca produtos com estoque total e reservado.', filtros: ['pesquisa', 'tipo (P|S)', 'categoriaId', 'ativo', 'estoque (zerado|positivo|negativo|abaixoMinimo)', 'prontaEntrega', 'marca', ...PAG] },
  { metodo: 'GET', caminho: '/produtos/{id}', recurso: 'produtos', resumo: 'Um produto com saldos por depósito.' },
  { metodo: 'GET', caminho: '/estoque/saldos', recurso: 'produtos', resumo: 'Saldos por produto e depósito.', filtros: ['depositoId', 'pesquisa', 'abaixoMinimo'] },
  { metodo: 'GET', caminho: '/estoque/movimentos', recurso: 'produtos', resumo: 'Movimentos de estoque.', filtros: ['produtoId', 'depositoId', 'dataInicial', 'dataFinal', ...PAG] },
  { metodo: 'POST', caminho: '/produtos', recurso: 'produtos', resumo: 'Cadastra produto.', corpo: { nome: 'Mouse sem fio', codigo: 'MOU-001', tipo: 'P', preco: 89.9, precoCusto: 40, unidade: 'UN', ncm: '84716053', controlaEstoque: true } },
  { metodo: 'PUT', caminho: '/produtos/{id}', recurso: 'produtos', resumo: 'Altera produto (preço, dados fiscais, estoque mínimo…).' },
  { metodo: 'POST', caminho: '/estoque/ajuste', recurso: 'produtos', resumo: 'Ajuste de estoque (entrada, saída ou balanço).', corpo: { produtoId: 1, depositoId: 1, tipo: 'ENTRADA', quantidade: 5, observacao: 'Chegada do fornecedor' } },
  // vendas
  { metodo: 'GET', caminho: '/vendas', recurso: 'vendas', resumo: 'Lista pedidos (ou orçamentos com tipo=ORCAMENTO).', filtros: ['tipo (PEDIDO|ORCAMENTO|TODOS)', 'pesquisa', 'situacaoId', 'contatoId', 'vendedorId', 'dataInicial', 'dataFinal', 'origem', ...PAG] },
  { metodo: 'GET', caminho: '/vendas/{id}', recurso: 'vendas', resumo: 'Pedido completo: itens, parcelas, situação, nota, comissões, histórico e situações permitidas.' },
  {
    metodo: 'POST', caminho: '/vendas', recurso: 'vendas', resumo: 'Cria pedido ou orçamento (tipo ORCAMENTO). Totais recalculados no servidor; item sem valor usa o preço do produto.',
    corpo: { tipo: 'PEDIDO', contatoId: 1, vendedorId: 1, data: '2026-10-24', origem: 'BALCAO', observacoes: '', itens: [{ produtoId: 1, quantidade: 1, valorUnitario: 100, desconto: 0 }], parcelas: [{ dataVencimento: '2026-10-24', valor: 100, formaPagamentoId: 1 }] },
  },
  { metodo: 'PUT', caminho: '/vendas/{id}', recurso: 'vendas', resumo: 'Altera pedido (bloqueado depois de lançar estoque/contas, exceto observações).' },
  { metodo: 'POST', caminho: '/vendas/{id}/situacao', recurso: 'vendas', resumo: 'Muda a situação (ex.: Fechada lança estoque e contas; Cancelada estorna).', corpo: { situacaoId: 3, observacao: 'Pago no Pix' } },
  { metodo: 'POST', caminho: '/vendas/{id}/converter', recurso: 'vendas', resumo: 'Converte orçamento em pedido.' },
  { metodo: 'POST', caminho: '/vendas/{id}/aprovar', recurso: 'vendas', resumo: 'Marca orçamento como aprovado.', corpo: { aprovadoPor: 'Cliente pelo WhatsApp' } },
  { metodo: 'POST', caminho: '/vendas/{id}/notificar', recurso: 'vendas', resumo: 'Envia o pedido/orçamento ao cliente (WhatsApp ou e-mail), com PDF.', corpo: { canal: 'WHATSAPP', anexarPdf: true } },
  { metodo: 'GET', caminho: '/vendas/{id}/pdf', recurso: 'vendas', resumo: 'PDF do pedido/orçamento.' },
  // compras
  { metodo: 'GET', caminho: '/compras', recurso: 'compras', resumo: 'Lista pedidos de compra.', filtros: ['pesquisa', 'situacaoId', 'fornecedorId', 'dataInicial', 'dataFinal', ...PAG] },
  { metodo: 'GET', caminho: '/compras/{id}', recurso: 'compras', resumo: 'Pedido de compra completo.' },
  { metodo: 'POST', caminho: '/compras', recurso: 'compras', resumo: 'Cria pedido de compra.', corpo: { fornecedorId: 2, data: '2026-10-24', itens: [{ produtoId: 1, quantidade: 10, valorUnitario: 40 }], parcelas: [{ dataVencimento: '2026-11-24', valor: 400 }] } },
  { metodo: 'POST', caminho: '/compras/{id}/situacao', recurso: 'compras', resumo: 'Muda a situação do pedido de compra.', corpo: { situacaoId: 2 } },
  // OS
  { metodo: 'GET', caminho: '/ordens-servico', recurso: 'os', resumo: 'Lista ordens de serviço.', filtros: ['pesquisa', 'situacaoId', 'contatoId', 'tecnicoId', 'prioridade', 'dataInicial', 'dataFinal', ...PAG] },
  { metodo: 'GET', caminho: '/ordens-servico/kanban', recurso: 'os', resumo: 'OS agrupadas por situação.' },
  { metodo: 'GET', caminho: '/ordens-servico/{id}', recurso: 'os', resumo: 'OS completa: itens (peças/serviços), parcelas, anexos, histórico.' },
  {
    metodo: 'POST', caminho: '/ordens-servico', recurso: 'os', resumo: 'Abre OS.',
    corpo: { contatoId: 1, tecnicoId: 1, equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron 15', defeitoRelatado: 'Não liga', acessorios: 'Carregador', prioridade: 'NORMAL', orcar: true, itens: [{ tipo: 'SERVICO', descricao: 'Diagnóstico', quantidade: 1, valorUnitario: 80 }] },
  },
  { metodo: 'PUT', caminho: '/ordens-servico/{id}', recurso: 'os', resumo: 'Altera OS (diagnóstico, serviço executado, itens…).' },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/situacao', recurso: 'os', resumo: 'Muda a situação da OS.', corpo: { situacaoId: 5, observacao: '' } },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/aprovar-orcamento', recurso: 'os', resumo: 'Marca o orçamento da OS como aprovado.', corpo: { aprovadoPor: 'Cliente' } },
  // financeiro
  { metodo: 'GET', caminho: '/financeiro/resumo', recurso: 'financeiro', resumo: 'Saldos das contas, a receber/pagar hoje, na semana e atrasado.' },
  { metodo: 'GET', caminho: '/contas-receber', recurso: 'financeiro', resumo: 'Contas a receber com totais.', filtros: ['situacao (ABERTO|RECEBIDO|PARCIAL|CANCELADO|ATRASADO)', 'contatoId', 'dataInicial', 'dataFinal', 'tipoData (V|E|R)', 'pesquisa', ...PAG] },
  { metodo: 'POST', caminho: '/contas-receber/{id}/baixar', recurso: 'financeiro', resumo: 'Recebe (baixa) uma conta.', corpo: { valor: 100, data: '2026-10-24', contaFinanceiraId: 1 } },
  { metodo: 'GET', caminho: '/contas-pagar', recurso: 'financeiro', resumo: 'Contas a pagar com totais.', filtros: ['situacao', 'contatoId', 'dataInicial', 'dataFinal', 'pesquisa', ...PAG] },
  { metodo: 'POST', caminho: '/contas-pagar', recurso: 'financeiro', resumo: 'Lança conta a pagar.', corpo: { descricao: 'Aluguel', valor: 3500, vencimento: '2026-11-05', categoriaId: 1 } },
  { metodo: 'GET', caminho: '/financeiro/fluxo-caixa', recurso: 'financeiro', resumo: 'Fluxo de caixa realizado e previsto.', filtros: ['dataInicial', 'dataFinal', 'contaFinanceiraId', 'agrupar (dia|semana|mes)'] },
  { metodo: 'GET', caminho: '/contas-financeiras', recurso: 'financeiro', resumo: 'Caixa e bancos com saldo atual.' },
  // fiscal
  { metodo: 'GET', caminho: '/notas-fiscais', recurso: 'fiscal', resumo: 'Lista notas fiscais.', filtros: ['modelo', 'situacao', 'pesquisa', 'dataInicial', 'dataFinal', ...PAG] },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}', recurso: 'fiscal', resumo: 'Nota com itens e eventos.' },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}/danfe', recurso: 'fiscal', resumo: 'PDF do DANFE.' },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}/xml', recurso: 'fiscal', resumo: 'XML da nota.' },
  // comissões
  { metodo: 'GET', caminho: '/comissoes', recurso: 'comissoes', resumo: 'Comissões por competência.', filtros: ['competencia (AAAA-MM)', 'tipo (VENDEDOR|TECNICO)', 'vendedorId', 'status', ...PAG] },
  { metodo: 'GET', caminho: '/painel-vendedor', recurso: 'comissoes', resumo: 'Painel do vendedor: períodos, meta, ranking e desafios.', filtros: ['vendedorId'] },
  // relatórios
  { metodo: 'GET', caminho: '/dashboard/vendas', recurso: 'relatorios', resumo: 'Faturamento, ticket, por vendedor, forma de pagamento, top produtos e clientes.', filtros: ['dataInicial', 'dataFinal', 'vendedorId', 'agrupar (dia|semana|mes)'] },
  { metodo: 'GET', caminho: '/relatorios/dre', recurso: 'relatorios', resumo: 'DRE por competência ou caixa.', filtros: ['dataInicial', 'dataFinal', 'regime (competencia|caixa)'] },
  { metodo: 'GET', caminho: '/relatorios/produtos-mais-vendidos', recurso: 'relatorios', resumo: 'Ranking de produtos.', filtros: ['dataInicial', 'dataFinal'] },
  // comunicação
  { metodo: 'POST', caminho: '/notificacoes', recurso: 'comunicacao', resumo: 'Envia WhatsApp ou e-mail (entra na fila).', corpo: { canal: 'WHATSAPP', destinatario: '5519999990000', corpo: 'Olá! Seu notebook está pronto.', contatoId: 1 } },
  { metodo: 'GET', caminho: '/notificacoes', recurso: 'comunicacao', resumo: 'Fila de mensagens enviadas.', filtros: ['status', 'canal', 'contatoId', ...PAG] },
  { metodo: 'GET', caminho: '/whatsapp/status', recurso: 'comunicacao', resumo: 'WhatsApp da loja conectado?' },
  // cadastros
  { metodo: 'GET', caminho: '/situacoes', recurso: 'cadastros', resumo: 'Situações de cada módulo (para usar o situacaoId certo).', filtros: ['modulo (VENDA|ORCAMENTO|COMPRA|OS)'] },
  { metodo: 'GET', caminho: '/vendedores', recurso: 'cadastros', resumo: 'Vendedores.', filtros: ['ativo'] },
  { metodo: 'GET', caminho: '/tecnicos', recurso: 'cadastros', resumo: 'Técnicos.', filtros: ['ativo'] },
  { metodo: 'GET', caminho: '/formas-pagamento', recurso: 'cadastros', resumo: 'Formas de pagamento.', filtros: ['ativo'] },
  { metodo: 'GET', caminho: '/depositos', recurso: 'cadastros', resumo: 'Depósitos de estoque.' },
  { metodo: 'GET', caminho: '/empresa', recurso: 'cadastros', resumo: 'Dados da empresa (sem segredos).' },
];

/** Eventos que podem ser enviados por webhook. */
export const EVENTOS_WEBHOOK: { chave: string; nome: string }[] = [
  { chave: 'venda.criada', nome: 'Pedido de venda ou orçamento criado' },
  { chave: 'venda.alterada', nome: 'Venda alterada (editada, transferida, excluída, PDV)' },
  { chave: 'situacao.alterada', nome: 'Mudança de situação (venda, orçamento, compra ou OS)' },
  { chave: 'compra.criada', nome: 'Pedido de compra criado' },
  { chave: 'os.criada', nome: 'Ordem de serviço aberta' },
  { chave: 'os.orcamento', nome: 'Orçamento de OS aprovado' },
  { chave: 'nfe.autorizada', nome: 'Nota fiscal autorizada' },
  { chave: 'nfe.cancelada', nome: 'Nota fiscal cancelada' },
  { chave: 'conta.recebida', nome: 'Conta a receber baixada (dinheiro entrou)' },
  { chave: 'conta.paga', nome: 'Conta a pagar baixada (dinheiro saiu)' },
];
