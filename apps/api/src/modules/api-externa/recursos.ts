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
  { chave: 'financeiro', nome: 'Financeiro', descricao: 'Contas a receber e a pagar, empréstimos (Lumicred), baixas e estornos, caixa e bancos, extrato, transferências, conciliação bancária, Open Finance (sincronizar), categorias e contas financeiras.', rotas: [/^\/contas-receber(\/|$)/, /^\/contas-pagar(\/|$)/, /^\/financeiro(\/|$)/, /^\/bancos(\/|$)/, /^\/contas-financeiras(\/|$)/, /^\/categorias-financeiras(\/|$)/, /^\/open-finance\/(status|sincronizar)/] },
  { chave: 'fiscal', nome: 'Notas fiscais', descricao: 'NF-e/NFC-e: listar, criar, transmitir, consultar, carta de correção, XML, DANFE, e-mail; cancelar e inutilizar exigem nível total.', rotas: [/^\/notas-fiscais(\/|$)/, /^\/fiscal(\/|$)/] },
  { chave: 'comissoes', nome: 'Comissões, metas e desafios', descricao: 'Comissões de vendedores e técnicos (aprovar, pagar, cancelar), metas do mês, desafios e painel do vendedor.', rotas: [/^\/comissoes(\/|$)/, /^\/metas(\/|$)/, /^\/desafios(\/|$)/, /^\/painel-vendedor(\/|$)/] },
  { chave: 'relatorios', nome: 'Relatórios e dashboards', descricao: 'Dashboards, últimos acontecimentos, DRE, vendas por período, produtos mais vendidos, contas, estoque, comissões.', rotas: [/^\/relatorios(\/|$)/, /^\/dashboard(\/|$)/], maximo: 'LEITURA' },
  { chave: 'comunicacao', nome: 'Mensagens (WhatsApp e e-mail)', descricao: 'Fila de mensagens, enviar WhatsApp/e-mail a clientes, reenviar, modelos de mensagem, status e reconexão do WhatsApp.', rotas: [/^\/notificacoes(\/|$)/, /^\/templates-notificacao(\/|$)/, /^\/whatsapp\/(status|enviar-teste|reconectar)$/] },
  { chave: 'cadastros', nome: 'Cadastros auxiliares', descricao: 'Vendedores, técnicos, depósitos, formas de pagamento, situações e transições (consulta) e dados da empresa (consulta).', rotas: [/^\/vendedores(\/|$)/, /^\/tecnicos(\/|$)/, /^\/depositos(\/|$)/, /^\/formas-pagamento(\/|$)/, /^\/situacoes(\/|$)/, /^\/empresa$/] },
  { chave: 'sistema', nome: 'Auditoria e saúde do sistema', descricao: 'Trilha de auditoria (quem fez o quê) e a conferência de Saúde do sistema.', rotas: [/^\/auditoria(\/|$)/, /^\/diagnostico(\/|$)/], maximo: 'LEITURA' },
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
  { teste: /^\/open-finance\/(connect-token|vincular|desvincular)/ },
  { teste: /^\/whatsapp\/(conectar|desconectar|eventos)/ },
  { teste: /^\/site\/catalogo/ },
];

/**
 * Ações sem volta que pedem nível TOTAL mesmo sendo POST (além de todo DELETE):
 * cancelar/inutilizar nota na SEFAZ e pagar comissões.
 */
const EXIGEM_TOTAL: { teste: RegExp; metodos?: string[] }[] = [
  { teste: /^\/notas-fiscais\/[^/]+\/cancelar$/ },
  { teste: /^\/notas-fiscais\/inutilizar$/ },
  { teste: /^\/comissoes\/pagar$/ },
  // emitir NF vai para a SEFAZ (documento fiscal de verdade): só chave com nível total
  { teste: /^\/vendas\/[^/]+\/emitir-nf$/ },
];

/** Rotas da própria API externa que qualquer chave válida usa (quem sou eu, documentação, busca, MCP). */
const SEMPRE_LIBERADAS = [/^\/externo(\/|$)/, /^\/mcp(\/|$)/];

/** Nível que a chamada exige. Com a rota, considera as ações sem volta (EXIGEM_TOTAL). */
export function nivelExigido(metodo: string, rota?: string): Nivel {
  const m = metodo.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return 'LEITURA';
  if (m === 'DELETE') return 'TOTAL';
  const r = rota?.split('?')[0];
  if (r && EXIGEM_TOTAL.some((e) => e.teste.test(r) && (!e.metodos || e.metodos.includes(m)))) return 'TOTAL';
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
  rota = rota.split('?')[0];
  if (SEMPRE_LIBERADAS.some((t) => t.test(rota))) return { ok: true };
  if (BLOQUEADAS.some((b) => b.teste.test(rota) && (!b.metodos || b.metodos.includes(m)))) {
    return { ok: false, motivo: 'Esta função é de administração do sistema e não fica disponível para chaves de API.' };
  }
  const rec = recursoDaRota(rota);
  if (!rec) return { ok: false, motivo: 'Esta rota não está liberada para chaves de API.' };
  const exigido = nivelExigido(m, rota);
  const tem = perm[rec.chave];
  if (!tem || PESO[tem] < PESO[exigido]) {
    const palavra = exigido === 'LEITURA' ? 'leitura' : exigido === 'GRAVACAO' ? 'gravação' : m === 'DELETE' ? 'exclusão (nível total)' : 'nível total (ação sem volta)';
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
  if (recurso === '*') return true;
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

const PAG = ['pagina', 'limite (até 200)'];
const PERIODO = ['dataInicial (AAAA-MM-DD)', 'dataFinal (AAAA-MM-DD)'];
const SITUACAO = { situacaoId: 3, observacao: 'Motivo/observação (opcional)', forcar: false };
const ACOES = (lista: string) => ({ acoes: lista.split(',') });
const PARCELA = { dataVencimento: '2026-10-24', valor: 100, formaPagamentoId: 1, observacoes: '' };
const CONTA = { descricao: 'Aluguel de novembro', valor: 3500, vencimento: '2026-11-05', dataEmissao: '2026-10-24', contatoId: null, categoriaId: 1, formaPagamentoId: null, contaFinanceiraId: null, competencia: '2026-11', observacoes: '', recorrente: false };
const BAIXA = { valor: 100, data: '2026-10-24', contaFinanceiraId: 1, formaPagamentoId: 1, juros: 0, desconto: 0, observacoes: 'Recebido no Pix' };
const CRUD = (recurso: string, caminho: string, nome: string, corpo: unknown, filtros: string[] = ['ativo']): Endpoint[] => [
  { metodo: 'GET', caminho, recurso, resumo: `Lista ${nome} (array simples, sem paginação).`, filtros },
  { metodo: 'GET', caminho: `${caminho}/{id}`, recurso, resumo: `Um registro de ${nome}.` },
  { metodo: 'POST', caminho, recurso, resumo: `Cadastra em ${nome}.`, corpo },
  { metodo: 'PUT', caminho: `${caminho}/{id}`, recurso, resumo: `Altera em ${nome} (mande só os campos que mudam).`, corpo },
  { metodo: 'DELETE', caminho: `${caminho}/{id}`, recurso, resumo: `Exclui de ${nome} (se estiver em uso, dá 409).` },
];

export const ENDPOINTS: Endpoint[] = [
  // ------------------------------------------------ da própria API externa (toda chave)
  { metodo: 'GET', caminho: '/externo/eu', recurso: '*', resumo: 'Quem sou eu: nome da chave, permissões por área e endereços.' },
  { metodo: 'GET', caminho: '/externo/openapi.json', recurso: '*', resumo: 'Esta documentação em OpenAPI 3.1, só com o que a chave pode.' },
  { metodo: 'GET', caminho: '/externo/buscar', recurso: '*', resumo: 'Busca geral: clientes, produtos, vendas, OS e notas de uma vez (só nas áreas liberadas). Aceita nome, documento, telefone, número do pedido/OS/nota.', filtros: ['q (texto, mínimo 2 letras)', 'limite (por grupo, padrão 5)'] },
  { metodo: 'GET', caminho: '/externo/resumo', recurso: '*', resumo: 'Resumo do dia: vendas, orçamentos, OS abertas/atrasadas, a receber e a pagar, estoque baixo (só as áreas liberadas).', filtros: ['data (AAAA-MM-DD, padrão hoje)'] },

  // ------------------------------------------------ clientes
  { metodo: 'GET', caminho: '/contatos', recurso: 'clientes', resumo: 'Lista/busca contatos (nome, fantasia, documento, e-mail, telefone).', filtros: ['pesquisa', 'tipo (CLIENTE|FORNECEDOR|TRANSPORTADORA)', 'ativo', 'vendedorId', 'uf', ...PAG] },
  { metodo: 'GET', caminho: '/contatos/{id}', recurso: 'clientes', resumo: 'Um contato com resumo (total comprado, qtd. de vendas e OS, em aberto, última compra).' },
  { metodo: 'GET', caminho: '/contatos/{id}/historico', recurso: 'clientes', resumo: 'Histórico do cliente: vendas, OS, contas a receber, mensagens e linha do tempo.', filtros: ['limite (até 500)'] },
  { metodo: 'GET', caminho: '/contatos/cep/{cep}', recurso: 'clientes', resumo: 'Endereço pelo CEP (ViaCEP): logradouro, bairro, município, UF e código IBGE.' },
  { metodo: 'POST', caminho: '/contatos', recurso: 'clientes', resumo: 'Cadastra contato.', corpo: { tipo: 'CLIENTE', tipoPessoa: 'F', nome: 'Maria Souza', documento: '12345678909', email: 'maria@email.com', celular: '19999990000', telefone: '', cep: '13025000', logradouro: 'Av. Anchieta', numero: '789', complemento: '', bairro: 'Cambuí', municipio: 'Campinas', uf: 'SP', observacoes: '', vendedorId: null } },
  { metodo: 'PUT', caminho: '/contatos/{id}', recurso: 'clientes', resumo: 'Altera contato (mande só os campos que mudam).', corpo: { celular: '19988887777', email: 'novo@email.com' } },
  { metodo: 'DELETE', caminho: '/contatos/{id}', recurso: 'clientes', resumo: 'Exclui contato (com movimento, só desativa).' },

  // ------------------------------------------------ produtos e estoque
  { metodo: 'GET', caminho: '/produtos', recurso: 'produtos', resumo: 'Lista/busca produtos com preço, estoque total e reservado, foto e pronta entrega.', filtros: ['pesquisa', 'tipo (P|S)', 'categoriaId', 'ativo', 'estoque (zerado|positivo|negativo|abaixoMinimo)', 'prontaEntrega', 'marca', 'origem (site|fora)', 'ordem (nome|pronta)', ...PAG] },
  { metodo: 'GET', caminho: '/produtos/{id}', recurso: 'produtos', resumo: 'Um produto com saldos por depósito e dados fiscais.' },
  { metodo: 'GET', caminho: '/produtos/{id}/movimentos', recurso: 'produtos', resumo: 'Movimentos de estoque do produto.', filtros: PAG },
  { metodo: 'POST', caminho: '/produtos', recurso: 'produtos', resumo: 'Cadastra produto.', corpo: { tipo: 'P', nome: 'Mouse sem fio', codigo: 'MOU-001', gtin: '', unidade: 'UN', preco: 89.9, precoCusto: 40, marca: 'Logitech', estoqueMinimo: 2, controlaEstoque: true, garantiaDias: 90, ncm: '84716053', csosn: '102', origem: 0, categoriaId: null, ativo: true } },
  { metodo: 'PUT', caminho: '/produtos/{id}', recurso: 'produtos', resumo: 'Altera produto (preço, custo, dados fiscais, estoque mínimo…).', corpo: { preco: 99.9, estoqueMinimo: 3 } },
  { metodo: 'POST', caminho: '/produtos/{id}/confirmar-ncm', recurso: 'produtos', resumo: 'Confirma o NCM sugerido pelo robô de NF (vale para todas as vendas do produto). Pode mandar outro NCM no corpo.', corpo: { ncm: '84713012' } },
  { metodo: 'DELETE', caminho: '/produtos/{id}', recurso: 'produtos', resumo: 'Exclui produto (com movimento, só desativa).' },
  { metodo: 'GET', caminho: '/estoque/saldos', recurso: 'produtos', resumo: 'Saldos por produto e depósito.', filtros: ['depositoId', 'pesquisa', 'abaixoMinimo (true)'] },
  { metodo: 'GET', caminho: '/estoque/movimentos', recurso: 'produtos', resumo: 'Movimentos de estoque (entradas, saídas, ajustes, transferências).', filtros: ['produtoId', 'depositoId', ...PERIODO, 'origemTipo', 'tipo', ...PAG] },
  { metodo: 'POST', caminho: '/estoque/ajuste', recurso: 'produtos', resumo: 'Ajuste de estoque: ENTRADA, SAIDA ou BALANCO (quantidade = saldo novo).', corpo: { produtoId: 1, depositoId: 1, tipo: 'ENTRADA', quantidade: 5, custoUnitario: 40, observacao: 'Chegada do fornecedor' } },
  { metodo: 'POST', caminho: '/estoque/transferencia', recurso: 'produtos', resumo: 'Transfere estoque entre depósitos.', corpo: { produtoId: 1, origemId: 1, destinoId: 2, quantidade: 2, observacao: 'Para a loja do Centro' } },
  ...CRUD('produtos', '/categorias-produto', 'categorias de produto', { nome: 'Periféricos', paiId: null }, []),

  // ------------------------------------------------ vendas e orçamentos
  { metodo: 'GET', caminho: '/vendas', recurso: 'vendas', resumo: 'Lista pedidos (tipo=ORCAMENTO para orçamentos, TODOS para os dois).', filtros: ['tipo (PEDIDO|ORCAMENTO|TODOS)', 'pesquisa', 'situacaoId', 'situacoes (ids separados por vírgula)', 'contatoId', 'vendedorId', ...PERIODO, 'origem', ...PAG] },
  { metodo: 'GET', caminho: '/vendas/{id}', recurso: 'vendas', resumo: 'Pedido completo: itens, parcelas (com a conta a receber), situação, nota, comissões, histórico e situações permitidas.' },
  {
    metodo: 'POST', caminho: '/vendas', recurso: 'vendas', resumo: 'Cria pedido ou orçamento (tipo ORCAMENTO). Totais recalculados no servidor; item sem valor usa o preço do produto; sem parcelas cria 1 à vista; sem situação usa a inicial.',
    corpo: { tipo: 'PEDIDO', contatoId: 1, vendedorId: 1, data: '2026-10-24', depositoId: null, situacaoId: null, origem: 'BALCAO', observacoes: '', observacoesInternas: '', descontoTipo: 'REAL', descontoValor: 0, frete: 0, itens: [{ produtoId: 1, descricao: 'Mouse sem fio', quantidade: 1, valorUnitario: 100, desconto: 0 }], parcelas: [PARCELA] },
  },
  { metodo: 'PUT', caminho: '/vendas/{id}', recurso: 'vendas', resumo: 'Altera pedido (bloqueado depois de lançar estoque/contas, exceto observações e transporte).', corpo: { observacoes: 'Entregar à tarde' } },
  { metodo: 'DELETE', caminho: '/vendas/{id}', recurso: 'vendas', resumo: 'Exclui pedido (só sem estoque/contas lançados e sem NF autorizada).' },
  { metodo: 'POST', caminho: '/vendas/{id}/situacao', recurso: 'vendas', resumo: 'Muda a situação (Fechada/NF emitida exigem a venda completa: 422 VENDA_INCOMPLETA). Fechada lança estoque, contas e comissão; Cancelada estorna. Erro 422 TRANSICAO_INVALIDA traz as permitidas.', corpo: SITUACAO },
  { metodo: 'GET', caminho: '/vendas/{id}/finalizacao', recurso: 'vendas', resumo: 'O que falta para finalizar a venda (cliente completo ou Consumidor final, produto, custo, forma de pagamento, vendedor).' },
  { metodo: 'POST', caminho: '/vendas/{id}/link-pagamento', recurso: 'vendas', resumo: 'Gera o link de pagamento do Mercado Pago para o pedido (padrão: total da venda).', corpo: { valor: 199.9 } },
  { metodo: 'POST', caminho: '/vendas/{id}/finalizar', recurso: 'vendas', resumo: 'Finaliza a venda (vai para Fechada) a partir de qualquer situação. Erro 422 VENDA_INCOMPLETA traz as pendências.', corpo: { observacao: 'Cliente retirou na loja' } },
  { metodo: 'GET', caminho: '/vendas/consumidor-final', recurso: 'vendas', resumo: 'Cliente "Consumidor final" (criado se não existir) para vendas sem cadastro do cliente.' },
  { metodo: 'POST', caminho: '/vendas/{id}/acoes', recurso: 'vendas', resumo: 'Executa ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas.', corpo: ACOES('lancarEstoque,lancarContas') },
  { metodo: 'POST', caminho: '/vendas/{id}/gerar-parcelas', recurso: 'vendas', resumo: 'Calcula parcelas para a venda (não grava; mande depois no PUT).', corpo: { quantidade: 3, primeiroVencimento: '2026-11-24', formaPagamentoId: 2, intervaloDias: 30 } },
  { metodo: 'POST', caminho: '/vendas/gerar-parcelas', recurso: 'vendas', resumo: 'Calcula parcelas de um total qualquer (não grava).', corpo: { total: 1200, quantidade: 3, primeiroVencimento: '2026-11-24', formaPagamentoId: 2, intervaloDias: 30 } },
  { metodo: 'GET', caminho: '/vendas/{id}/nfe/verificar', recurso: 'vendas', resumo: 'Confere se a venda tem tudo para emitir NF-e (diz o que falta).' },
  { metodo: 'POST', caminho: '/vendas/{id}/gerar-nfe', recurso: 'vendas', resumo: 'Cria a NF-e (55) ou NFC-e (65) da venda, pendente (transmita em /notas-fiscais/{id}/transmitir).', corpo: { modelo: 55, informacoesComplementares: '' } },
  { metodo: 'GET', caminho: '/vendas/{id}/documentos', recurso: 'vendas', resumo: 'Documentos da venda em HTML para imprimir/salvar PDF: ?formato=cupom (recibo 80mm), a4 (recibo A4 + certificados + termo de garantia + licenças) ou garantia (só o kit de garantia).' },
  { metodo: 'GET', caminho: '/vendas/{id}/documentos/resumo', recurso: 'vendas', resumo: 'O que a venda imprime: certificados de garantia (PC, PC Gamer, Notebook, iPhone, Games), termo de garantia, folha de licenças e a NF.' },
  { metodo: 'GET', caminho: '/vendas/{id}/robo-nf', recurso: 'vendas', resumo: 'Robô de NF: status da venda (PRONTA = "Pronto pra NF", PENDENTE com a lista do que falta e onde corrigir, EMITIDA, IGNORADA) e o que o robô preencheu sozinho.' },
  { metodo: 'POST', caminho: '/vendas/{id}/robo-nf/conferir', recurso: 'vendas', resumo: 'Robô de NF: confere a venda agora (completa cliente pelo CEP/CNPJ e NCM dos produtos) e devolve o status.' },
  { metodo: 'POST', caminho: '/vendas/{id}/emitir-nf', recurso: 'vendas', resumo: 'Emite a NF-e (modelo 55, DANFE A4) da venda e transmite à SEFAZ — só quando o robô diz PRONTA (senão 422 NFE_PENDENCIAS com a lista).', corpo: { informacoesComplementares: '' } },
  { metodo: 'POST', caminho: '/vendas/{id}/notificar', recurso: 'vendas', resumo: 'Envia o pedido/orçamento ao cliente por WhatsApp ou e-mail, com PDF.', corpo: { canal: 'WHATSAPP', templateId: null, mensagem: null, anexarPdf: true } },
  { metodo: 'GET', caminho: '/vendas/{id}/imprimir', recurso: 'vendas', resumo: 'HTML do pedido para impressão.' },
  { metodo: 'GET', caminho: '/vendas/{id}/pdf', recurso: 'vendas', resumo: 'PDF A4 do pedido/orçamento.', filtros: ['download (1)'] },
  { metodo: 'POST', caminho: '/vendas/{id}/aprovar', recurso: 'vendas', resumo: 'Marca orçamento como aprovado.', corpo: { aprovadoPor: 'Cliente pelo WhatsApp', observacao: '' } },
  { metodo: 'POST', caminho: '/vendas/{id}/converter', recurso: 'vendas', resumo: 'Converte orçamento em pedido (uma vez só).', corpo: { situacaoId: null } },
  { metodo: 'POST', caminho: '/vendas/{id}/transferir-vendedor', recurso: 'vendas', resumo: 'Troca o vendedor (refaz a comissão pendente).', corpo: { vendedorId: 2, observacao: '' } },
  { metodo: 'POST', caminho: '/vendas/{id}/duplicar', recurso: 'vendas', resumo: 'Clona o pedido/orçamento em situação inicial.' },

  // ------------------------------------------------ compras
  { metodo: 'GET', caminho: '/compras', recurso: 'compras', resumo: 'Lista pedidos de compra.', filtros: ['pesquisa', 'situacaoId', 'fornecedorId', ...PERIODO, ...PAG] },
  { metodo: 'GET', caminho: '/compras/{id}', recurso: 'compras', resumo: 'Pedido de compra completo: itens, parcelas (contas a pagar), fornecedor, histórico.' },
  { metodo: 'POST', caminho: '/compras', recurso: 'compras', resumo: 'Cria pedido de compra.', corpo: { fornecedorId: 2, data: '2026-10-24', depositoId: null, situacaoId: null, categoriaFinanceiraId: null, nfeNumero: '', descontoValor: 0, frete: 0, observacoes: '', itens: [{ produtoId: 1, descricao: 'Mouse sem fio', codigoFornecedor: 'ABC', quantidade: 10, valorUnitario: 40, ipiPct: 0 }], parcelas: [{ dataVencimento: '2026-11-24', valor: 400 }] } },
  { metodo: 'PUT', caminho: '/compras/{id}', recurso: 'compras', resumo: 'Altera pedido de compra.', corpo: { observacoes: 'Chega na terça' } },
  { metodo: 'DELETE', caminho: '/compras/{id}', recurso: 'compras', resumo: 'Exclui pedido de compra (sem lançamentos).' },
  { metodo: 'POST', caminho: '/compras/{id}/situacao', recurso: 'compras', resumo: 'Muda a situação (Fechado: entrada de estoque + contas a pagar; Consignado: só estoque).', corpo: SITUACAO },
  { metodo: 'POST', caminho: '/compras/{id}/acoes', recurso: 'compras', resumo: 'Ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas.', corpo: ACOES('lancarEstoque') },
  { metodo: 'POST', caminho: '/compras/importar-xml', recurso: 'compras', resumo: 'Cria compra a partir do XML da NF-e do fornecedor (casa itens por GTIN/código ou cria).', corpo: { xml: '<nfeProc>…</nfeProc>', depositoId: null, situacaoId: null } },
  { metodo: 'GET', caminho: '/compras/{id}/imprimir', recurso: 'compras', resumo: 'HTML do pedido de compra para impressão.' },

  // ------------------------------------------------ ordens de serviço
  { metodo: 'GET', caminho: '/ordens-servico', recurso: 'os', resumo: 'Lista ordens de serviço (com "atrasada").', filtros: ['pesquisa', 'situacaoId', 'situacoes', 'contatoId', 'tecnicoId', 'vendedorId', 'prioridade (BAIXA|NORMAL|ALTA|URGENTE)', ...PERIODO, ...PAG] },
  { metodo: 'GET', caminho: '/ordens-servico/kanban', recurso: 'os', resumo: 'OS agrupadas por situação (quadro). Com período: todas as OS que entraram nele.', filtros: ['tecnicoId', 'diasFinalizadas (padrão 7)', 'dataInicial', 'dataFinal'] },
  { metodo: 'GET', caminho: '/ordens-servico/{id}', recurso: 'os', resumo: 'OS completa: equipamento, defeito, diagnóstico, peças e serviços, parcelas, anexos, histórico.' },
  {
    metodo: 'POST', caminho: '/ordens-servico', recurso: 'os', resumo: 'Abre OS.',
    corpo: { contatoId: 1, tecnicoId: 1, vendedorId: null, dataEntrada: '2026-10-24', dataPrevista: '2026-10-28', equipamento: 'Notebook', marca: 'Dell', modelo: 'Inspiron 15', numeroSerie: '', acessorios: 'Carregador', senhaEquipamento: '', estadoFisico: 'Risco na tampa', defeitoRelatado: 'Não liga', prioridade: 'NORMAL', orcar: true, garantiaDias: 90, itens: [{ tipo: 'SERVICO', descricao: 'Diagnóstico', quantidade: 1, valorUnitario: 80 }, { tipo: 'PECA', produtoId: 1, quantidade: 1, valorUnitario: 150 }], parcelas: [] },
  },
  { metodo: 'PUT', caminho: '/ordens-servico/{id}', recurso: 'os', resumo: 'Altera OS (diagnóstico, serviço executado, itens, datas…). Mande só o que muda.', corpo: { diagnostico: 'Fonte queimada', servicoExecutado: 'Troca da fonte' } },
  { metodo: 'DELETE', caminho: '/ordens-servico/{id}', recurso: 'os', resumo: 'Exclui OS (sem lançamentos).' },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/situacao', recurso: 'os', resumo: 'Muda a situação da OS (avisa o cliente se configurado).', corpo: SITUACAO },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/acoes', recurso: 'os', resumo: 'Ações avulsas: lancarEstoque, estornarEstoque, lancarContas, estornarContas, reservarEstoque, liberarReserva, gerarNfe.', corpo: ACOES('lancarEstoque,lancarContas') },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/aprovar-orcamento', recurso: 'os', resumo: 'Marca o orçamento da OS como aprovado.', corpo: { aprovadoPor: 'Cliente', observacao: '' } },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/anexos', recurso: 'os', resumo: 'Anexa arquivo/foto (multipart/form-data, campo "arquivo").' },
  { metodo: 'DELETE', caminho: '/ordens-servico/{id}/anexos/{anexoId}', recurso: 'os', resumo: 'Remove um anexo.' },
  { metodo: 'GET', caminho: '/ordens-servico/{id}/imprimir', recurso: 'os', resumo: 'HTML da OS para impressão.', filtros: ['via (cliente|tecnico|etiqueta)'] },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/notificar', recurso: 'os', resumo: 'Envia a OS/orçamento ao cliente por WhatsApp ou e-mail.', corpo: { canal: 'WHATSAPP', templateId: null, mensagem: null } },
  { metodo: 'GET', caminho: '/ordens-servico/{id}/nfe/verificar', recurso: 'os', resumo: 'Confere se a OS tem tudo para a NF-e das peças.' },
  { metodo: 'POST', caminho: '/ordens-servico/{id}/gerar-nfe', recurso: 'os', resumo: 'Cria a NF-e das peças da OS (pendente).', corpo: { modelo: 55 } },

  // ------------------------------------------------ financeiro
  { metodo: 'GET', caminho: '/financeiro/resumo', recurso: 'financeiro', resumo: 'Saldos das contas e o que há a receber/pagar hoje, na semana e atrasado.' },
  { metodo: 'GET', caminho: '/financeiro/fluxo-caixa', recurso: 'financeiro', resumo: 'Fluxo de caixa realizado e previsto.', filtros: [...PERIODO, 'contaFinanceiraId', 'agrupar (dia|semana|mes)'] },
  { metodo: 'GET', caminho: '/financeiro/movimentos', recurso: 'financeiro', resumo: 'Extrato interno (entradas e saídas das contas).', filtros: ['contaFinanceiraId', ...PERIODO, 'tipo (ENTRADA|SAIDA)', 'conciliado', 'pesquisa', ...PAG] },
  { metodo: 'POST', caminho: '/financeiro/movimentos', recurso: 'financeiro', resumo: 'Lançamento avulso no caixa/banco.', corpo: { contaFinanceiraId: 1, data: '2026-10-24', tipo: 'SAIDA', valor: 45.5, descricao: 'Café e água', categoriaId: null, observacoes: '' } },
  { metodo: 'DELETE', caminho: '/financeiro/movimentos/{id}', recurso: 'financeiro', resumo: 'Exclui um lançamento avulso.' },
  { metodo: 'POST', caminho: '/contas-financeiras/{id}/ajustar-saldo', recurso: 'financeiro', resumo: 'Acerta o saldo da conta com o valor real; lança só a diferença, fora do DRE.', corpo: { saldoReal: 7500, data: '2026-10-28' } },
  { metodo: 'POST', caminho: '/financeiro/transferencia', recurso: 'financeiro', resumo: 'Transferência entre contas (ex.: caixa → banco).', corpo: { origemId: 1, destinoId: 2, valor: 500, data: '2026-10-24', descricao: 'Depósito do caixa' } },
  { metodo: 'GET', caminho: '/contas-receber', recurso: 'financeiro', resumo: 'Contas a receber com totais (aberto, recebido, atrasado).', filtros: ['situacao (ABERTO|RECEBIDO|PARCIAL|CANCELADO|ATRASADO)', 'contatoId', 'vendedorId', 'categoriaId', 'contaFinanceiraId', 'origemTipo', 'origemId', ...PERIODO, 'tipoData (V=vencimento|E=emissão|R=recebimento)', 'pesquisa', ...PAG] },
  { metodo: 'GET', caminho: '/contas-receber/{id}', recurso: 'financeiro', resumo: 'Uma conta a receber com as baixas.' },
  { metodo: 'POST', caminho: '/contas-receber', recurso: 'financeiro', resumo: 'Lança conta a receber avulsa.', corpo: { ...CONTA, descricao: 'Serviço avulso', contatoId: 1 } },
  { metodo: 'PUT', caminho: '/contas-receber/{id}', recurso: 'financeiro', resumo: 'Altera conta a receber (vencimento, valor, forma…).', corpo: { vencimento: '2026-11-10' } },
  { metodo: 'DELETE', caminho: '/contas-receber/{id}', recurso: 'financeiro', resumo: 'Cancela a conta a receber.' },
  { metodo: 'POST', caminho: '/contas-receber/{id}/baixar', recurso: 'financeiro', resumo: 'Recebe (baixa) a conta — total, ou parcial informando valor. Lança a entrada na conta financeira.', corpo: BAIXA },
  { metodo: 'POST', caminho: '/contas-receber/{id}/estornar', recurso: 'financeiro', resumo: 'Desfaz as baixas da conta a receber.' },
  { metodo: 'GET', caminho: '/contas-pagar', recurso: 'financeiro', resumo: 'Contas a pagar com totais.', filtros: ['situacao (ABERTO|PAGO|PARCIAL|CANCELADO|ATRASADO)', 'contatoId', 'categoriaId', 'contaFinanceiraId', 'origemTipo', 'origemId', ...PERIODO, 'tipoData (V|E|R)', 'pesquisa', 'recorrente', ...PAG] },
  { metodo: 'GET', caminho: '/contas-pagar/{id}', recurso: 'financeiro', resumo: 'Uma conta a pagar com as baixas.' },
  { metodo: 'POST', caminho: '/contas-pagar', recurso: 'financeiro', resumo: 'Lança conta a pagar (recorrente=true repete todo mês).', corpo: CONTA },
  { metodo: 'PUT', caminho: '/contas-pagar/{id}', recurso: 'financeiro', resumo: 'Altera conta a pagar.', corpo: { valor: 3600 } },
  { metodo: 'DELETE', caminho: '/contas-pagar/{id}', recurso: 'financeiro', resumo: 'Cancela a conta a pagar.' },
  { metodo: 'POST', caminho: '/contas-pagar/{id}/baixar', recurso: 'financeiro', resumo: 'Paga (baixa) a conta — total ou parcial. Lança a saída na conta financeira.', corpo: { ...BAIXA, observacoes: 'Pago pelo banco' } },
  { metodo: 'POST', caminho: '/contas-pagar/{id}/estornar', recurso: 'financeiro', resumo: 'Desfaz TODAS as baixas da conta a pagar.' },
  { metodo: 'POST', caminho: '/contas-pagar/{id}/pagamentos/{movimentoId}/estornar', recurso: 'financeiro', resumo: 'Estorna só um pagamento (baixa parcial) da conta, mantendo os outros. movimentoId vem de "lancamentos" no GET /contas-pagar/{id}.' },
  { metodo: 'POST', caminho: '/contas-pagar/{id}/gerar-proxima', recurso: 'financeiro', resumo: 'Gera a próxima ocorrência de uma conta recorrente.' },
  { metodo: 'GET', caminho: '/financeiro/emprestimos', recurso: 'financeiro', resumo: 'Empréstimos/antecipações (ex.: Lumicred) com saldo devedor, boleto do cliente, alerta do que fazer e totais (em aberto, vencido, a repassar).', filtros: ['status (ABERTO|VENCIDO|QUITADO|CANCELADO)', 'credorId', 'modalidade (REPASSE|DIRETO|CAPITAL_GIRO)', ...PERIODO, 'pesquisa'] },
  { metodo: 'GET', caminho: '/financeiro/emprestimos/{id}', recurso: 'financeiro', resumo: 'Uma operação de empréstimo com as parcelas a devolver e a entrada do dinheiro.' },
  { metodo: 'POST', caminho: '/financeiro/emprestimos', recurso: 'financeiro', resumo: 'Lança uma operação: o valor entra na conta informada e gera a devolução (valor + taxa) no contas a pagar. REPASSE = cliente paga o boleto à loja e a loja repassa; DIRETO = cliente paga direto ao credor; CAPITAL_GIRO = sem cliente.', corpo: { credorId: 276, modalidade: 'REPASSE', vendaId: 24938, valorRecebido: 1000, taxaPct: 6, prazoDias: 30, parcelas: 1, contaFinanceiraId: 2, dataOperacao: '2026-10-28', codigo: 'E-230' } },
  { metodo: 'PUT', caminho: '/financeiro/emprestimos/{id}', recurso: 'financeiro', resumo: 'Altera a operação. Sem pagamentos recalcula a devolução; com pagamentos só corrige o valor recebido (juros = devolvido − recebido).', corpo: { valorRecebido: 950, codigo: 'E-230' } },
  { metodo: 'POST', caminho: '/financeiro/emprestimos/{id}/cliente-pagou-direto', recurso: 'financeiro', resumo: 'O cliente pagou o boleto direto ao credor: baixa o boleto do cliente e abate o mesmo valor da dívida (encontro de contas, sem mexer no banco).', corpo: { valor: 1000, data: '2026-11-27' } },
  { metodo: 'POST', caminho: '/financeiro/emprestimos/{id}/pagar', recurso: 'financeiro', resumo: 'Paga o credor (total ou parcial) saindo da conta informada.', corpo: { valor: 1060, data: '2026-11-27', contaFinanceiraId: 2 } },
  { metodo: 'POST', caminho: '/financeiro/emprestimos/{id}/cancelar', recurso: 'financeiro', resumo: 'Cancela uma operação lançada por engano (sem pagamentos): tira a entrada do caixa e cancela a devolução.' },
  { metodo: 'GET', caminho: '/bancos/transacoes', recurso: 'financeiro', resumo: 'Transações do extrato bancário, com sugestões de conciliação.', filtros: ['contaFinanceiraId', 'conciliado (true|false)', 'tipo (CREDITO|DEBITO)', ...PERIODO, 'pesquisa', 'sugestoes (true|false)', ...PAG] },
  { metodo: 'POST', caminho: '/bancos/transacoes/{id}/conciliar', recurso: 'financeiro', resumo: 'Concilia a transação com uma conta (faz a baixa) ou lança avulso.', corpo: { tipo: 'RECEBER', id: 10, categoriaId: null, descricao: null } },
  { metodo: 'POST', caminho: '/bancos/transacoes/{id}/ignorar', recurso: 'financeiro', resumo: 'Ignora a transação na conciliação.' },
  { metodo: 'POST', caminho: '/bancos/transacoes/{id}/reabrir', recurso: 'financeiro', resumo: 'Volta a transação para "a conciliar".' },
  { metodo: 'POST', caminho: '/bancos/importar-ofx', recurso: 'financeiro', resumo: 'Importa extrato OFX (conteúdo do arquivo em texto).', corpo: { contaFinanceiraId: 2, conteudo: 'OFXHEADER:100…' } },
  { metodo: 'GET', caminho: '/open-finance/status', recurso: 'financeiro', resumo: 'Open Finance (Pluggy) configurado e ativo?' },
  { metodo: 'POST', caminho: '/open-finance/sincronizar/{contaFinanceiraId}', recurso: 'financeiro', resumo: 'Busca saldo e transações do banco agora.', filtros: ['dias (1–365, padrão 90)'] },
  { metodo: 'POST', caminho: '/open-finance/sincronizar-todas', recurso: 'financeiro', resumo: 'Sincroniza todas as contas ligadas ao Open Finance.' },
  ...CRUD('financeiro', '/contas-financeiras', 'contas financeiras (caixa, bancos, cartões; lista traz saldoAtual e saldoBanco)', { nome: 'Banco Inter', tipo: 'BANCO', banco: '077', agencia: '0001', conta: '12345-6', saldoInicial: 0, padrao: false, ativo: true, cor: '#ff7a00' }),
  ...CRUD('financeiro', '/categorias-financeiras', 'categorias financeiras (receitas/despesas, grupo do DRE)', { nome: 'Energia elétrica', tipo: 'DESPESA', grupoDre: 'DESPESA_OPERACIONAL', paiId: null, ativo: true }),

  // ------------------------------------------------ fiscal
  { metodo: 'GET', caminho: '/notas-fiscais', recurso: 'fiscal', resumo: 'Lista notas fiscais.', filtros: ['tipo (0=entrada|1=saída)', 'modelo (55|65)', 'situacao', 'pesquisa', 'contatoId', ...PERIODO, ...PAG] },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}', recurso: 'fiscal', resumo: 'Nota com itens, eventos e contato.' },
  { metodo: 'POST', caminho: '/notas-fiscais', recurso: 'fiscal', resumo: 'Cria nota manual (pendente).', corpo: { tipo: 1, modelo: 55, contatoId: 1, naturezaOperacao: 'Venda de mercadoria', finalidade: 1, informacoesComplementares: '', valorFrete: 0, valorDesconto: 0, itens: [{ produtoId: 1, descricao: 'Mouse sem fio', ncm: '84716053', cfop: '5102', unidade: 'UN', quantidade: 1, valorUnitario: 100 }] } },
  { metodo: 'PUT', caminho: '/notas-fiscais/{id}', recurso: 'fiscal', resumo: 'Altera nota pendente ou rejeitada.', corpo: { informacoesComplementares: 'Pedido 24850' } },
  { metodo: 'DELETE', caminho: '/notas-fiscais/{id}', recurso: 'fiscal', resumo: 'Exclui nota pendente.' },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/transmitir', recurso: 'fiscal', resumo: 'Assina com o certificado A1 e envia à SEFAZ.' },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/consultar', recurso: 'fiscal', resumo: 'Consulta a situação da nota na SEFAZ.' },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/renumerar', recurso: 'fiscal', resumo: 'Dá o próximo número a uma nota rejeitada por duplicidade.' },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/carta-correcao', recurso: 'fiscal', resumo: 'Carta de correção (texto com 15+ caracteres).', corpo: { texto: 'Correção do endereço do destinatário: Rua X, 100' } },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/cancelar', recurso: 'fiscal', resumo: 'Cancela a nota na SEFAZ (sem volta — exige nível TOTAL).', corpo: { justificativa: 'Venda cancelada a pedido do cliente' } },
  { metodo: 'POST', caminho: '/notas-fiscais/inutilizar', recurso: 'fiscal', resumo: 'Inutiliza numeração na SEFAZ (sem volta — exige nível TOTAL).', corpo: { modelo: 55, serie: 4, numeroInicial: 2300, numeroFinal: 2300, justificativa: 'Número pulado por falha no sistema' } },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}/xml', recurso: 'fiscal', resumo: 'XML da nota (procNFe se autorizada).' },
  { metodo: 'GET', caminho: '/notas-fiscais/{id}/danfe', recurso: 'fiscal', resumo: 'PDF do DANFE.', filtros: ['download (true)'] },
  { metodo: 'POST', caminho: '/notas-fiscais/{id}/enviar-email', recurso: 'fiscal', resumo: 'Envia XML + DANFE por e-mail (padrão: e-mail do cliente).', corpo: { para: 'cliente@email.com' } },
  { metodo: 'GET', caminho: '/fiscal/status-sefaz', recurso: 'fiscal', resumo: 'SEFAZ no ar? Ambiente (homologação/produção).' },

  // ------------------------------------------------ comissões, metas e desafios
  { metodo: 'GET', caminho: '/comissoes', recurso: 'comissoes', resumo: 'Comissões com totais (pendente, aprovada, paga).', filtros: ['competencia (AAAA-MM)', 'tipo (VENDEDOR|TECNICO)', 'vendedorId', 'tecnicoId', 'status (PENDENTE|APROVADA|PAGA|CANCELADA)', 'origemTipo (VENDA|OS|DESAFIO)', ...PAG] },
  { metodo: 'GET', caminho: '/comissoes/resumo', recurso: 'comissoes', resumo: 'Comissões por pessoa na competência.', filtros: ['competencia (AAAA-MM)', 'tipo (VENDEDOR|TECNICO)'] },
  { metodo: 'GET', caminho: '/comissoes/{id}', recurso: 'comissoes', resumo: 'Uma comissão.' },
  { metodo: 'POST', caminho: '/comissoes/aprovar', recurso: 'comissoes', resumo: 'Aprova comissões.', corpo: { ids: [1, 2] } },
  { metodo: 'POST', caminho: '/comissoes/cancelar', recurso: 'comissoes', resumo: 'Cancela comissões.', corpo: { ids: [3] } },
  { metodo: 'POST', caminho: '/comissoes/pagar', recurso: 'comissoes', resumo: 'Paga comissões (gera conta a pagar paga por pessoa — exige nível TOTAL).', corpo: { ids: [1, 2], contaFinanceiraId: 1, data: '2026-10-31', observacoes: '' } },
  { metodo: 'POST', caminho: '/comissoes/recalcular/{origemTipo}/{id}', recurso: 'comissoes', resumo: 'Recalcula as comissões de uma venda (VENDA) ou OS (OS) ainda não pagas.' },
  { metodo: 'GET', caminho: '/painel-vendedor', recurso: 'comissoes', resumo: 'Painel do vendedor: períodos, meta, ranking, desafios e últimas vendas.', filtros: ['vendedorId'] },
  { metodo: 'GET', caminho: '/metas', recurso: 'comissoes', resumo: 'Metas do mês por vendedor.', filtros: ['competencia (AAAA-MM)'] },
  { metodo: 'PUT', caminho: '/metas', recurso: 'comissoes', resumo: 'Grava as metas (padrão e só do mês).', corpo: { competencia: '2026-11', itens: [{ vendedorId: 1, metaPadrao: 50000, metaMes: null }] } },
  { metodo: 'GET', caminho: '/desafios', recurso: 'comissoes', resumo: 'Desafios de venda.', filtros: ['situacao (vigentes|todos)'] },
  { metodo: 'GET', caminho: '/desafios/{id}', recurso: 'comissoes', resumo: 'Um desafio com quem conquistou.' },
  { metodo: 'POST', caminho: '/desafios', recurso: 'comissoes', resumo: 'Cria desafio (prêmio vira comissão extra automática).', corpo: { titulo: 'Semana dos notebooks', descricao: '', tipo: 'VALOR (ou QTD_VENDAS, QTD_ITENS)', alvo: 10000, premio: 100, inicio: '2026-10-26', fim: '2026-11-01', regra: 'TODOS (ou PRIMEIRO)', produtoId: null, categoriaId: null, todosVendedores: true, vendedoresIds: [] } },
  { metodo: 'PUT', caminho: '/desafios/{id}', recurso: 'comissoes', resumo: 'Altera desafio.' },
  { metodo: 'POST', caminho: '/desafios/{id}/encerrar', recurso: 'comissoes', resumo: 'Encerra o desafio (ninguém mais ganha).' },
  { metodo: 'POST', caminho: '/desafios/{id}/reabrir', recurso: 'comissoes', resumo: 'Reabre o desafio.' },
  { metodo: 'DELETE', caminho: '/desafios/{id}', recurso: 'comissoes', resumo: 'Exclui desafio (só sem prêmio lançado).' },

  // ------------------------------------------------ relatórios e dashboards
  { metodo: 'GET', caminho: '/dashboard/geral', recurso: 'relatorios', resumo: 'Painel geral: hoje, financeiro, OS, vendas por situação, estoque baixo, fiscal, alertas.' },
  { metodo: 'GET', caminho: '/dashboard/vendas', recurso: 'relatorios', resumo: 'Faturamento, ticket, lucro, por vendedor/forma de pagamento/origem, top produtos e clientes.', filtros: [...PERIODO, 'vendedorId', 'agrupar (dia|semana|mes)', 'comparar (true|false)', 'todas (true|false)'] },
  { metodo: 'GET', caminho: '/dashboard/os', recurso: 'relatorios', resumo: 'OS: abertas, concluídas, faturamento, tempo médio, por técnico e equipamento.', filtros: [...PERIODO, 'tecnicoId', 'agrupar'] },
  { metodo: 'GET', caminho: '/dashboard/assistencia', recurso: 'relatorios', resumo: 'Assistência técnica: valor de entrada das OS, mão de obra x peças, custos (peças, logística, terceiros) e lucro por OS, técnico e período.', filtros: [...PERIODO, 'tecnicoId', 'base', 'agrupar'] },
  { metodo: 'POST', caminho: '/dashboard/assistencia/pagar-tecnico', recurso: 'financeiro', resumo: 'Pagar técnico: % do lucro da assistência no período vira uma conta a pagar (simular=true só calcula).', corpo: { dataInicial: '2026-10-20', dataFinal: '2026-10-26', base: 'entrada', tecnicoId: 1, percentual: 10, escopo: 'SOMENTE_CONCLUIDAS', simular: true } },
  { metodo: 'GET', caminho: '/dashboard/panorama', recurso: 'relatorios', resumo: 'Panorama da loja no período: vendas + assistência (faturamento, custos, lucro), caixa, série por dia e equipe, com comparação ao período anterior.', filtros: [...PERIODO, 'base (entrada|conclusao)', 'agrupar'] },
  { metodo: 'GET', caminho: '/dashboard/assistencia/pagamentos-tecnico', recurso: 'financeiro', resumo: 'Últimos pagamentos de técnico lançados no contas a pagar.' },
  { metodo: 'GET', caminho: '/dashboard/atividades', recurso: 'relatorios', resumo: 'Últimos lançamentos financeiros e acontecimentos do sistema.', filtros: ['limite (5–200)', 'categoria (vendas|os|compras|fiscal|financeiro|cadastros|sistema|acessos)', 'so (lancamentos|acontecimentos)'] },
  { metodo: 'GET', caminho: '/relatorios/dre', recurso: 'relatorios', resumo: 'DRE por competência ou caixa.', filtros: [...PERIODO, 'regime (competencia|caixa)', 'comparar'] },
  { metodo: 'GET', caminho: '/relatorios/vendas-por-periodo', recurso: 'relatorios', resumo: 'Vendas agrupadas por dia/semana/mês.', filtros: [...PERIODO, 'agrupar (dia|semana|mes)'] },
  { metodo: 'GET', caminho: '/relatorios/produtos-mais-vendidos', recurso: 'relatorios', resumo: 'Ranking de produtos.', filtros: [...PERIODO, 'limite'] },
  { metodo: 'GET', caminho: '/relatorios/estoque', recurso: 'relatorios', resumo: 'Posição de estoque com custo e valor.', filtros: ['depositoId', 'categoriaId'] },
  { metodo: 'GET', caminho: '/relatorios/comissoes', recurso: 'relatorios', resumo: 'Relatório de comissões da competência.', filtros: ['competencia (AAAA-MM)'] },
  { metodo: 'GET', caminho: '/relatorios/contas', recurso: 'relatorios', resumo: 'Relatório de contas a receber ou a pagar.', filtros: ['tipo (receber|pagar)', ...PERIODO] },

  // ------------------------------------------------ comunicação
  { metodo: 'GET', caminho: '/notificacoes', recurso: 'comunicacao', resumo: 'Fila de mensagens (enviadas, pendentes, com erro).', filtros: ['status (PENDENTE|ENVIANDO|ENVIADA|ERRO|CANCELADA)', 'canal (EMAIL|WHATSAPP)', 'origemTipo', 'origemId', 'contatoId', ...PERIODO, 'pesquisa', ...PAG] },
  { metodo: 'GET', caminho: '/notificacoes/{id}', recurso: 'comunicacao', resumo: 'Uma mensagem.' },
  { metodo: 'POST', caminho: '/notificacoes', recurso: 'comunicacao', resumo: 'Envia WhatsApp ou e-mail (entra na fila). Com origemTipo/origemId, as {{variáveis}} são preenchidas.', corpo: { canal: 'WHATSAPP', destinatario: '5519999990000', assunto: null, corpo: 'Olá {{cliente.primeiroNome}}! Seu notebook está pronto.', contatoId: 1, origemTipo: null, origemId: null, agendadaPara: null } },
  { metodo: 'POST', caminho: '/notificacoes/{id}/reenviar', recurso: 'comunicacao', resumo: 'Reenvia uma mensagem.' },
  { metodo: 'POST', caminho: '/notificacoes/{id}/cancelar', recurso: 'comunicacao', resumo: 'Cancela mensagem pendente.' },
  { metodo: 'POST', caminho: '/notificacoes/processar', recurso: 'comunicacao', resumo: 'Processa a fila agora.' },
  { metodo: 'POST', caminho: '/notificacoes/lembretes-contas', recurso: 'comunicacao', resumo: 'Dispara os lembretes de contas a vencer agora.' },
  { metodo: 'GET', caminho: '/templates-notificacao/variaveis', recurso: 'comunicacao', resumo: 'Variáveis disponíveis nos modelos ({{cliente.nome}}, {{total}}…).' },
  ...CRUD('comunicacao', '/templates-notificacao', 'modelos de mensagem', { nome: 'OS pronta', evento: 'OS_SITUACAO', canal: 'WHATSAPP', situacaoId: 5, assunto: null, corpo: 'Olá {{cliente.primeiroNome}}, sua OS {{numero}} está pronta!', anexarPdf: false, ativo: true }, ['evento', 'canal', 'ativo']),
  { metodo: 'POST', caminho: '/templates-notificacao/{id}/preview', recurso: 'comunicacao', resumo: 'Mostra o modelo preenchido com uma venda/OS.', corpo: { origemTipo: 'VENDA', origemId: 1 } },
  { metodo: 'GET', caminho: '/whatsapp/status', recurso: 'comunicacao', resumo: 'WhatsApp da loja conectado? (número, desde quando).' },
  { metodo: 'POST', caminho: '/whatsapp/enviar-teste', recurso: 'comunicacao', resumo: 'Envia uma mensagem direta (sem fila).', corpo: { numero: '19999990000', mensagem: 'Teste' } },
  { metodo: 'POST', caminho: '/whatsapp/reconectar', recurso: 'comunicacao', resumo: 'Reconecta a sessão do WhatsApp (sem precisar de novo QR).' },

  // ------------------------------------------------ cadastros auxiliares
  ...CRUD('cadastros', '/vendedores', 'vendedores', { nome: 'João', email: 'joao@balao.info', telefone: '', comissaoPadraoPct: 3, ativo: true }),
  ...CRUD('cadastros', '/tecnicos', 'técnicos', { nome: 'Carlos', email: '', telefone: '', especialidade: 'Notebooks', comissaoPadraoPct: 10, ativo: true }),
  ...CRUD('cadastros', '/depositos', 'depósitos de estoque', { nome: 'LOJA CASTELO', padrao: true, ativo: true, desconsiderarSaldo: false }),
  ...CRUD('cadastros', '/formas-pagamento', 'formas de pagamento', { nome: 'Pix', tipo: 'PIX', codigoFiscal: '17', taxaPct: 0, diasRecebimento: 0, maxParcelas: 1, ativo: true }),
  { metodo: 'GET', caminho: '/situacoes', recurso: 'cadastros', resumo: 'Situações de cada módulo (use o id certo ao mudar a situação).', filtros: ['modulo (VENDA|ORCAMENTO|COMPRA|OS)', 'ativo'] },
  { metodo: 'GET', caminho: '/situacoes/{id}', recurso: 'cadastros', resumo: 'Uma situação com as ações automáticas.' },
  { metodo: 'GET', caminho: '/situacoes/{id}/permitidas', recurso: 'cadastros', resumo: 'Para quais situações se pode ir a partir desta.' },
  { metodo: 'GET', caminho: '/situacoes/transicoes', recurso: 'cadastros', resumo: 'Transições permitidas de um módulo.', filtros: ['modulo'] },
  { metodo: 'GET', caminho: '/situacoes/acoes', recurso: 'cadastros', resumo: 'Ações automáticas disponíveis (lançar estoque, contas, NF-e, avisar cliente…).' },
  { metodo: 'GET', caminho: '/empresa', recurso: 'cadastros', resumo: 'Dados da empresa (sem segredos).' },

  // ------------------------------------------------ auditoria e saúde
  { metodo: 'GET', caminho: '/auditoria', recurso: 'sistema', resumo: 'Trilha de auditoria: quem fez o quê, quando.', filtros: ['entidade (Venda|OrdemServico|Contato|…)', 'entidadeId', 'limite'] },
  { metodo: 'GET', caminho: '/diagnostico', recurso: 'sistema', resumo: 'Saúde do sistema: inconsistências nos dados, com o que corrigir.' },
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
