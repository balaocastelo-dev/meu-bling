/**
 * POLÍTICA CENTRAL DE ACESSO POR PERFIL (defesa em profundidade).
 *
 * Aplicada globalmente em todas as rotas /api/*, além das verificações
 * específicas de cada módulo. A primeira regra que casar decide.
 *
 *   ADMIN      → acesso completo (dono).
 *   GERENTE    → acesso administrativo operacional: tudo, exceto usuários,
 *                segredos/configuração fiscal e estrutural (certificado, SMTP,
 *                Open Finance, Bling, situações/transições, configurações).
 *   FINANCEIRO → financeiro, bancos, compras, comissões, relatórios, notas; leitura do resto.
 *   VENDEDOR   → vendas, clientes, OS, produtos/estoque (leitura), NF-e da venda,
 *                notificações; sem financeiro, compras, relatórios ou configurações.
 *   TECNICO    → ordens de serviço, clientes e produtos (leitura).
 */
import type { Perfil } from './auth.js';

type Regra = { metodos?: string[]; teste: RegExp; perfis: Perfil[] | 'TODOS' };

const M = (...m: string[]) => m;
const MUT = M('POST', 'PUT', 'PATCH', 'DELETE');
const GESTAO: Perfil[] = ['ADMIN', 'GERENTE'];
const FIN: Perfil[] = ['ADMIN', 'GERENTE', 'FINANCEIRO'];
const VENDAS: Perfil[] = ['ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR'];
const OPERACAO: Perfil[] = ['ADMIN', 'GERENTE', 'FINANCEIRO', 'VENDEDOR', 'TECNICO'];

/** Campos de PUT /empresa que só o ADMIN pode alterar. */
export const CAMPOS_EMPRESA_ADMIN = [
  'cnpj', 'ie', 'im', 'crt', 'ambienteFiscal', 'serieNfe', 'proximoNumeroNfe', 'serieNfce', 'proximoNumeroNfce', 'cscId', 'cscToken',
  'naturezaOperacaoPadrao', 'cfopPadraoDentroUf', 'cfopPadraoForaUf', 'csosnPadrao', 'aliquotaSimplesPct', 'provedorFiscal',
  'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'smtpFrom', 'smtpAtivo',
  'openFinanceProvedor', 'openFinanceClientId', 'openFinanceClientSecret', 'openFinanceAtivo',
  'blingClientId', 'blingClientSecret', 'blingAccessToken', 'blingRefreshToken',
];

const REGRAS: Regra[] = [
  // ---- somente ADMIN
  { teste: /^\/usuarios(\/|$)/, perfis: ['ADMIN'] },
  { teste: /^\/empresa\/certificado/, perfis: ['ADMIN'] },
  { teste: /^\/empresa\/smtp/, perfis: ['ADMIN'] },
  { metodos: MUT, teste: /^\/configuracoes(\/|$)/, perfis: ['ADMIN'] },
  { metodos: MUT, teste: /^\/situacoes(\/|$)/, perfis: ['ADMIN'] },
  { teste: /^\/bling(\/|$)/, perfis: ['ADMIN'] },
  { metodos: MUT, teste: /^\/open-finance\/(connect-token|vincular|desvincular)/, perfis: ['ADMIN'] },
  { teste: /^\/auditoria(\/|$)/, perfis: GESTAO },
  { teste: /^\/notas-fiscais\/inutilizar/, perfis: GESTAO },
  { teste: /^\/whatsapp\/(conectar|desconectar)/, perfis: GESTAO },
  { metodos: MUT, teste: /^\/templates-notificacao(\/|$)/, perfis: GESTAO },
  { metodos: MUT, teste: /^\/(vendedores|tecnicos|depositos|formas-pagamento|categorias-financeiras|categorias-produto|contas-financeiras)(\/|$)/, perfis: GESTAO },
  { metodos: MUT, teste: /^\/empresa(\/|$)/, perfis: GESTAO },
  { metodos: M('DELETE'), teste: /^\/(vendas|compras|ordens-servico|contatos|produtos|notas-fiscais)\/\d+$/, perfis: GESTAO },
  { metodos: MUT, teste: /^\/estoque\/(ajuste|transferencia)/, perfis: GESTAO },
  { metodos: MUT, teste: /^\/produtos(\/|$)/, perfis: GESTAO },
  // metas e desafios de vendas: só a gestão cria/vê o quadro geral (o vendedor vê o dele no painel)
  { teste: /^\/(metas|desafios)(\/|$)/, perfis: GESTAO },
  { teste: /^\/painel-vendedor(\/|$)/, perfis: ['ADMIN', 'GERENTE', 'VENDEDOR'] },

  // ---- financeiro
  { teste: /^\/(financeiro|contas-pagar|bancos|open-finance)(\/|$)/, perfis: FIN },
  { metodos: MUT, teste: /^\/contas-receber(\/|$)/, perfis: FIN },
  { teste: /^\/compras(\/|$)/, perfis: FIN },
  { metodos: MUT, teste: /^\/comissoes\/(aprovar|pagar|cancelar|recalcular)/, perfis: FIN },
  { teste: /^\/relatorios(\/|$)/, perfis: FIN },
  { teste: /^\/notas-fiscais\/\d+\/(cancelar|carta-correcao)/, perfis: FIN },
  { teste: /^\/webhooks\//, perfis: 'TODOS' },

  // ---- vendas
  { metodos: MUT, teste: /^\/(vendas|notas-fiscais)(\/|$)/, perfis: VENDAS },
  { metodos: MUT, teste: /^\/notificacoes(\/|$)/, perfis: VENDAS },
  // dashboards (geral, vendas, OS): só o dono
  { teste: /^\/dashboard(\/|$)/, perfis: ['ADMIN'] },

  // ---- operação (todos os perfis autenticados)
  { metodos: MUT, teste: /^\/(ordens-servico|contatos)(\/|$)/, perfis: OPERACAO },
  { teste: /.*/, perfis: 'TODOS' },
];

/** Devolve true se o perfil pode acessar método+rota (rota já sem /api/v1). */
export function permitido(perfil: Perfil | undefined, metodo: string, rota: string): boolean {
  if (perfil === 'ADMIN') return true;
  const m = metodo.toUpperCase();
  for (const r of REGRAS) {
    if (r.metodos && !r.metodos.includes(m)) continue;
    if (!r.teste.test(rota)) continue;
    if (r.perfis === 'TODOS') return !!perfil;
    return !!perfil && r.perfis.includes(perfil);
  }
  return !!perfil;
}

export const DESCRICAO_PERFIS: Record<Perfil, string> = {
  ADMIN: 'Acesso completo (dono): usuários, configurações, fiscal, integrações e tudo o mais.',
  GERENTE: 'Acesso administrativo: vendas, compras, OS, estoque, financeiro, fiscal, relatórios, cadastros e WhatsApp. Não altera usuários, certificado, SMTP, Open Finance, Bling, situações.',
  FINANCEIRO: 'Financeiro, bancos, compras, comissões, relatórios e notas fiscais; leitura do restante.',
  VENDEDOR: 'Vendas, clientes, ordens de serviço, consulta de produtos/estoque, NF-e da venda e mensagens ao cliente.',
  TECNICO: 'Ordens de serviço, clientes e consulta de produtos/estoque.',
};
