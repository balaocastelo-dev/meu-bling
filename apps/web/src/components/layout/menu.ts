/**
 * Definição do menu lateral (grupos e itens) com perfis permitidos.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  PiggyBank,
  FileSignature,
  Banknote,
  Bell,
  Boxes,
  Building2,
  Gauge,
  ChartLine,
  ChartPie,
  Cable,
  ClipboardList,
  FileCode2,
  FileText,
  HardHat,
  Landmark,
  LayoutDashboard,
  MessageCircle,
  Package,
  Percent,
  Settings,
  Stethoscope,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Trophy,
  Truck,
  Users,
  Wallet,
  Wrench,
  HandCoins,
  BookOpen,
  Handshake,
  MessagesSquare,
  ShieldCheck,
} from 'lucide-react';
import type { Perfil } from '@/types';

export interface ItemMenu {
  rotulo: string;
  para: string;
  icone: LucideIcon;
  perfis?: Perfil[];
  /** rotas que também marcam este item como ativo */
  alias?: string[];
}

export interface GrupoMenu {
  titulo: string;
  itens: ItemMenu[];
}

const GESTAO: Perfil[] = ['ADMIN', 'GERENTE'];
const FIN: Perfil[] = ['ADMIN', 'GERENTE', 'FINANCEIRO'];

export const MENU: GrupoMenu[] = [
  {
    titulo: 'Início',
    itens: [
      // JARVIS: o agente do gestor (caminho até R$ 1 milhão livres no caixa) — primeiro item do menu
      { rotulo: 'JARVIS', para: '/jarvis', icone: Bot, perfis: ['ADMIN'] },
      // Meu Dashboard: todo mundo tem o seu (vendedor, técnico, gerente; o gestor vê o completo com lucro)
      { rotulo: 'Meu Dashboard', para: '/', icone: LayoutDashboard, alias: ['/meu-dashboard'] },
      // os outros dashboards (com lucro): só o dono (ADMIN)
      { rotulo: 'Dashboard de vendas', para: '/dashboard/vendas', icone: TrendingUp, perfis: ['ADMIN'] },
      { rotulo: 'Dashboard de assistência', para: '/dashboard/assistencia', icone: Stethoscope, perfis: ['ADMIN'] },
      { rotulo: 'Dashboard de consignação', para: '/dashboard/consignacao', icone: Handshake, perfis: ['ADMIN', 'GERENTE'] },
    ],
  },
  {
    titulo: 'Vendas',
    itens: [
      { rotulo: 'Painel do vendedor', para: '/meu-painel', icone: Gauge, perfis: GESTAO },
      { rotulo: 'Pedidos de venda', para: '/vendas', icone: ShoppingCart },
      { rotulo: 'Orçamentos', para: '/orcamentos', icone: FileSignature },
      { rotulo: 'Clientes', para: '/contatos', icone: Users, alias: ['/contatos'] },
      { rotulo: 'Metas e desafios', para: '/metas-desafios', icone: Trophy, perfis: GESTAO },
    ],
  },
  {
    titulo: 'Compras',
    itens: [
      { rotulo: 'Pedidos de compra', para: '/compras', icone: ShoppingBag },
      { rotulo: 'Consignação', para: '/consignacoes', icone: Handshake },
      { rotulo: 'Fornecedores', para: '/contatos?tipo=FORNECEDOR', icone: Truck },
    ],
  },
  {
    titulo: 'Assistência técnica',
    itens: [
      { rotulo: 'Ordens de serviço', para: '/ordens-servico', icone: Wrench },
      { rotulo: 'Técnicos', para: '/configuracoes/tecnicos', icone: HardHat, perfis: GESTAO },
    ],
  },
  {
    titulo: 'Estoque',
    itens: [
      { rotulo: 'Produtos', para: '/produtos', icone: Package },
      { rotulo: 'Saldos e movimentos', para: '/estoque', icone: Boxes, perfis: [...GESTAO, 'VENDEDOR', 'TECNICO'] },
    ],
  },
  {
    titulo: 'Financeiro',
    itens: [
      { rotulo: 'Contas a receber', para: '/financeiro/receber', icone: Wallet, perfis: FIN },
      { rotulo: 'Contas a pagar', para: '/financeiro/pagar', icone: Banknote, perfis: FIN },
      { rotulo: 'Bancos & conciliação', para: '/financeiro/bancos', icone: Landmark, perfis: FIN },
      { rotulo: 'Empréstimos', para: '/financeiro/emprestimos', icone: HandCoins, perfis: FIN },
      { rotulo: 'Carnês', para: '/financeiro/carnes', icone: BookOpen, perfis: FIN },
      { rotulo: 'Fluxo de caixa', para: '/financeiro/fluxo-caixa', icone: ChartLine, perfis: FIN },
      { rotulo: 'Caixinhas', para: '/financeiro/caixinhas', icone: PiggyBank, perfis: FIN },
      { rotulo: 'Comissões', para: '/comissoes', icone: Percent, perfis: [...FIN, 'VENDEDOR', 'TECNICO'] },
    ],
  },
  {
    titulo: 'Fiscal',
    itens: [{ rotulo: 'Notas fiscais', para: '/notas-fiscais', icone: FileText, perfis: [...FIN, 'VENDEDOR'] }],
  },
  {
    titulo: 'Relatórios',
    itens: [
      { rotulo: 'DRE', para: '/relatorios/dre', icone: ChartPie, perfis: FIN },
      { rotulo: 'Relatórios', para: '/relatorios', icone: ClipboardList, perfis: FIN },
    ],
  },
  {
    titulo: 'Comunicação',
    itens: [
      // chat da equipe: todo funcionário fala com todo mundo, salas de reunião, voz e vídeo (29/10/2026)
      { rotulo: 'Chat da equipe', para: '/chat', icone: MessagesSquare },
      { rotulo: 'Notificações', para: '/comunicacao/notificacoes', icone: Bell },
      { rotulo: 'WhatsApp', para: '/comunicacao/whatsapp', icone: MessageCircle, perfis: GESTAO },
      { rotulo: 'Templates', para: '/comunicacao/templates', icone: FileCode2, perfis: GESTAO },
    ],
  },
  {
    titulo: 'Configurações',
    itens: [
      { rotulo: 'Empresa', para: '/configuracoes/empresa', icone: Building2, perfis: GESTAO },
      { rotulo: 'Saúde do sistema', para: '/configuracoes/saude', icone: Stethoscope, perfis: ['ADMIN'] },
      { rotulo: 'Painel de auditoria', para: '/auditoria', icone: ShieldCheck, perfis: ['ADMIN'] },
      { rotulo: 'API e integrações', para: '/configuracoes/api', icone: Cable, perfis: ['ADMIN'] },
      { rotulo: 'Todas as configurações', para: '/configuracoes', icone: Settings, perfis: GESTAO },
    ],
  },
];

/** Submenu da área de configurações */
export const CONFIG_ITENS: { rotulo: string; para: string; descricao: string; perfis?: Perfil[] }[] = [
  { rotulo: 'Empresa', para: '/configuracoes/empresa', descricao: 'Razão social, CNPJ, endereço, logo' },
  { rotulo: 'Fiscal / Certificado', para: '/configuracoes/fiscal', descricao: 'Ambiente, séries, CSC, certificado A1, SEFAZ', perfis: ['ADMIN'] },
  { rotulo: 'Usuários', para: '/configuracoes/usuarios', descricao: 'Acessos e perfis', perfis: ['ADMIN'] },
  { rotulo: 'Vendedores', para: '/configuracoes/vendedores', descricao: 'Comissão padrão por vendedor' },
  { rotulo: 'Técnicos', para: '/configuracoes/tecnicos', descricao: 'Técnicos da assistência' },
  { rotulo: 'Situações', para: '/configuracoes/situacoes', descricao: 'Status, ações automáticas e transições', perfis: ['ADMIN'] },
  { rotulo: 'Formas de pagamento', para: '/configuracoes/formas-pagamento', descricao: 'Taxas, prazos e código fiscal' },
  { rotulo: 'Categorias financeiras', para: '/configuracoes/categorias-financeiras', descricao: 'Receitas/despesas e grupo do DRE' },
  { rotulo: 'Depósitos', para: '/configuracoes/depositos', descricao: 'Locais de estoque e distribuidores' },
  { rotulo: 'Contas financeiras', para: '/configuracoes/contas-financeiras', descricao: 'Caixa, bancos e cartões' },
  { rotulo: 'E-mail (SMTP)', para: '/configuracoes/smtp', descricao: 'Servidor de envio e teste', perfis: ['ADMIN'] },
  { rotulo: 'JARVIS', para: '/configuracoes/jarvis', descricao: 'Meta de caixa, chave da IA e regras de preço de usado', perfis: ['ADMIN'] },
  { rotulo: 'WhatsApp', para: '/configuracoes/whatsapp', descricao: 'O QR Code principal da loja — um número para o sistema inteiro', perfis: ['ADMIN'] },
  { rotulo: 'Mercado Pago', para: '/configuracoes/mercado-pago', descricao: 'Link de pagamento nos pedidos', perfis: ['ADMIN'] },
  { rotulo: 'Open Finance', para: '/configuracoes/open-finance', descricao: 'Credenciais Pluggy', perfis: ['ADMIN'] },
  { rotulo: 'Robô de e-mail', para: '/configuracoes/robo-email', descricao: 'Lê os avisos dos bancos por e-mail e lança no financeiro', perfis: ['ADMIN'] },
  { rotulo: 'API e integrações', para: '/configuracoes/api', descricao: 'Chaves para outros sistemas e agentes de IA, webhooks, MCP', perfis: ['ADMIN'] },
  { rotulo: 'Saúde do sistema', para: '/configuracoes/saude', descricao: 'Confere os dados e aponta o que corrigir', perfis: ['ADMIN'] },
  { rotulo: 'Painel de auditoria', para: '/auditoria', descricao: 'Tudo que acontece no sistema, ao vivo e desde o início; reverter; agentes de IA (senha do dia)', perfis: ['ADMIN'] },
  { rotulo: 'Migração do Bling', para: '/configuracoes/bling', descricao: 'Conectar e importar dados', perfis: ['ADMIN'] },
];

export function podeVer(perfil: Perfil | undefined, perfis?: Perfil[]): boolean {
  if (!perfis || perfis.length === 0) return true;
  if (!perfil) return false;
  if (perfil === 'ADMIN') return true;
  return perfis.includes(perfil);
}
