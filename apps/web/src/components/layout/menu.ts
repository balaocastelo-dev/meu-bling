/**
 * Definição do menu lateral (grupos e itens) com perfis permitidos.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  Bell,
  Boxes,
  Building2,
  ChartLine,
  ChartPie,
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
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
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
      { rotulo: 'Dashboard', para: '/', icone: LayoutDashboard },
      { rotulo: 'Dashboard de vendas', para: '/dashboard/vendas', icone: TrendingUp, perfis: [...GESTAO, 'VENDEDOR', 'FINANCEIRO'] },
    ],
  },
  {
    titulo: 'Vendas',
    itens: [
      { rotulo: 'Pedidos de venda', para: '/vendas', icone: ShoppingCart, perfis: [...GESTAO, 'VENDEDOR', 'FINANCEIRO'] },
      { rotulo: 'Clientes', para: '/contatos', icone: Users, alias: ['/contatos'] },
    ],
  },
  {
    titulo: 'Compras',
    itens: [
      { rotulo: 'Pedidos de compra', para: '/compras', icone: ShoppingBag, perfis: [...GESTAO, 'FINANCEIRO'] },
      { rotulo: 'Fornecedores', para: '/contatos?tipo=FORNECEDOR', icone: Truck, perfis: [...GESTAO, 'FINANCEIRO'] },
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
      { rotulo: 'Fluxo de caixa', para: '/financeiro/fluxo-caixa', icone: ChartLine, perfis: FIN },
      { rotulo: 'Comissões', para: '/comissoes', icone: Percent, perfis: FIN },
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
      { rotulo: 'Notificações', para: '/comunicacao/notificacoes', icone: Bell },
      { rotulo: 'WhatsApp', para: '/comunicacao/whatsapp', icone: MessageCircle, perfis: GESTAO },
      { rotulo: 'Templates', para: '/comunicacao/templates', icone: FileCode2, perfis: GESTAO },
    ],
  },
  {
    titulo: 'Configurações',
    itens: [
      { rotulo: 'Empresa', para: '/configuracoes/empresa', icone: Building2, perfis: GESTAO },
      { rotulo: 'Todas as configurações', para: '/configuracoes', icone: Settings, perfis: GESTAO },
    ],
  },
];

/** Submenu da área de configurações */
export const CONFIG_ITENS: { rotulo: string; para: string; descricao: string; perfis?: Perfil[] }[] = [
  { rotulo: 'Empresa', para: '/configuracoes/empresa', descricao: 'Razão social, CNPJ, endereço, logo' },
  { rotulo: 'Fiscal / Certificado', para: '/configuracoes/fiscal', descricao: 'Ambiente, séries, CSC, certificado A1, SEFAZ' },
  { rotulo: 'Usuários', para: '/configuracoes/usuarios', descricao: 'Acessos e perfis', perfis: ['ADMIN'] },
  { rotulo: 'Vendedores', para: '/configuracoes/vendedores', descricao: 'Comissão padrão por vendedor' },
  { rotulo: 'Técnicos', para: '/configuracoes/tecnicos', descricao: 'Técnicos da assistência' },
  { rotulo: 'Situações', para: '/configuracoes/situacoes', descricao: 'Status, ações automáticas e transições' },
  { rotulo: 'Formas de pagamento', para: '/configuracoes/formas-pagamento', descricao: 'Taxas, prazos e código fiscal' },
  { rotulo: 'Categorias financeiras', para: '/configuracoes/categorias-financeiras', descricao: 'Receitas/despesas e grupo do DRE' },
  { rotulo: 'Depósitos', para: '/configuracoes/depositos', descricao: 'Locais de estoque e distribuidores' },
  { rotulo: 'Contas financeiras', para: '/configuracoes/contas-financeiras', descricao: 'Caixa, bancos e cartões' },
  { rotulo: 'E-mail (SMTP)', para: '/configuracoes/smtp', descricao: 'Servidor de envio e teste' },
  { rotulo: 'Open Finance', para: '/configuracoes/open-finance', descricao: 'Credenciais Pluggy' },
  { rotulo: 'Migração do Bling', para: '/configuracoes/bling', descricao: 'Conectar e importar dados' },
];

export function podeVer(perfil: Perfil | undefined, perfis?: Perfil[]): boolean {
  if (!perfis || perfis.length === 0) return true;
  if (!perfil) return false;
  if (perfil === 'ADMIN') return true;
  return perfis.includes(perfil);
}
