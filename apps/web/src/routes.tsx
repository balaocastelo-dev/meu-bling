/**
 * Rotas da aplicação. Páginas carregadas sob demanda (lazy) para manter o bundle leve.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { PaginaSkeleton } from '@/components/ui/Skeleton';

const Login = lazy(() => import('@/pages/auth/Login'));
const Perfil = lazy(() => import('@/pages/auth/Perfil'));
const DashboardGeral = lazy(() => import('@/pages/dashboard/DashboardGeral'));
const DashboardVendas = lazy(() => import('@/pages/dashboard/DashboardVendas'));

const VendasLista = lazy(() => import('@/pages/vendas/VendasLista'));
const VendaForm = lazy(() => import('@/pages/vendas/VendaForm'));
const VendaDetalhe = lazy(() => import('@/pages/vendas/VendaDetalhe'));

const ComprasLista = lazy(() => import('@/pages/compras/ComprasLista'));
const CompraForm = lazy(() => import('@/pages/compras/CompraForm'));
const CompraDetalhe = lazy(() => import('@/pages/compras/CompraDetalhe'));

const OsLista = lazy(() => import('@/pages/os/OsLista'));
const OsForm = lazy(() => import('@/pages/os/OsForm'));
const OsDetalhe = lazy(() => import('@/pages/os/OsDetalhe'));

const ContatosLista = lazy(() => import('@/pages/contatos/ContatosLista'));
const ContatoForm = lazy(() => import('@/pages/contatos/ContatoForm'));
const ContatoDetalhe = lazy(() => import('@/pages/contatos/ContatoDetalhe'));

const ProdutosLista = lazy(() => import('@/pages/produtos/ProdutosLista'));
const ProdutoForm = lazy(() => import('@/pages/produtos/ProdutoForm'));
const ProdutoDetalhe = lazy(() => import('@/pages/produtos/ProdutoDetalhe'));
const Estoque = lazy(() => import('@/pages/estoque/Estoque'));

const ContasReceber = lazy(() => import('@/pages/financeiro/ContasReceber'));
const ContasPagar = lazy(() => import('@/pages/financeiro/ContasPagar'));
const Bancos = lazy(() => import('@/pages/financeiro/Bancos'));
const FluxoCaixa = lazy(() => import('@/pages/financeiro/FluxoCaixa'));
const Comissoes = lazy(() => import('@/pages/financeiro/Comissoes'));

const NotasLista = lazy(() => import('@/pages/fiscal/NotasLista'));
const NotaDetalhe = lazy(() => import('@/pages/fiscal/NotaDetalhe'));
const NotaForm = lazy(() => import('@/pages/fiscal/NotaForm'));

const Dre = lazy(() => import('@/pages/relatorios/Dre'));
const Relatorios = lazy(() => import('@/pages/relatorios/Relatorios'));

const Notificacoes = lazy(() => import('@/pages/comunicacao/Notificacoes'));
const Whatsapp = lazy(() => import('@/pages/comunicacao/Whatsapp'));
const Templates = lazy(() => import('@/pages/comunicacao/Templates'));

const ConfigIndex = lazy(() => import('@/pages/configuracoes/Index'));
const ConfigEmpresa = lazy(() => import('@/pages/configuracoes/Empresa'));
const ConfigFiscal = lazy(() => import('@/pages/configuracoes/Fiscal'));
const ConfigUsuarios = lazy(() => import('@/pages/configuracoes/Usuarios'));
const ConfigVendedores = lazy(() => import('@/pages/configuracoes/Vendedores'));
const ConfigTecnicos = lazy(() => import('@/pages/configuracoes/Tecnicos'));
const ConfigSituacoes = lazy(() => import('@/pages/configuracoes/Situacoes'));
const ConfigFormasPagamento = lazy(() => import('@/pages/configuracoes/FormasPagamento'));
const ConfigCategoriasFinanceiras = lazy(() => import('@/pages/configuracoes/CategoriasFinanceiras'));
const ConfigDepositos = lazy(() => import('@/pages/configuracoes/Depositos'));
const ConfigContasFinanceiras = lazy(() => import('@/pages/configuracoes/ContasFinanceiras'));
const ConfigSmtp = lazy(() => import('@/pages/configuracoes/Smtp'));
const ConfigOpenFinance = lazy(() => import('@/pages/configuracoes/OpenFinance'));
const ConfigBling = lazy(() => import('@/pages/configuracoes/Bling'));
const BlingCallback = lazy(() => import('@/pages/configuracoes/BlingCallback'));

const OsPublica = lazy(() => import('@/pages/publico/OsPublica'));
const VendaPublica = lazy(() => import('@/pages/publico/VendaPublica'));
const NotFound = lazy(() => import('@/pages/NotFound'));

const S = (el: ReactNode) => <Suspense fallback={<PaginaSkeleton />}>{el}</Suspense>;

export const router = createBrowserRouter([
  { path: '/login', element: S(<Login />) },
  { path: '/p/os/:token', element: S(<OsPublica />) },
  { path: '/p/venda/:token', element: S(<VendaPublica />) },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: S(<DashboardGeral />) },
      { path: 'dashboard/vendas', element: S(<DashboardVendas />) },
      { path: 'perfil', element: S(<Perfil />) },

      { path: 'vendas', element: S(<VendasLista />) },
      { path: 'vendas/nova', element: S(<VendaForm />) },
      { path: 'vendas/:id', element: S(<VendaDetalhe />) },
      { path: 'vendas/:id/editar', element: S(<VendaForm />) },

      { path: 'compras', element: S(<ComprasLista />) },
      { path: 'compras/nova', element: S(<CompraForm />) },
      { path: 'compras/:id', element: S(<CompraDetalhe />) },
      { path: 'compras/:id/editar', element: S(<CompraForm />) },

      { path: 'ordens-servico', element: S(<OsLista />) },
      { path: 'ordens-servico/nova', element: S(<OsForm />) },
      { path: 'ordens-servico/:id', element: S(<OsDetalhe />) },
      { path: 'ordens-servico/:id/editar', element: S(<OsForm />) },

      { path: 'contatos', element: S(<ContatosLista />) },
      { path: 'contatos/novo', element: S(<ContatoForm />) },
      { path: 'contatos/:id', element: S(<ContatoDetalhe />) },
      { path: 'contatos/:id/editar', element: S(<ContatoForm />) },

      { path: 'produtos', element: S(<ProdutosLista />) },
      { path: 'produtos/novo', element: S(<ProdutoForm />) },
      { path: 'produtos/:id', element: S(<ProdutoDetalhe />) },
      { path: 'produtos/:id/editar', element: S(<ProdutoForm />) },
      { path: 'estoque', element: S(<Estoque />) },

      { path: 'financeiro', element: <Navigate to="/financeiro/receber" replace /> },
      { path: 'financeiro/receber', element: S(<ContasReceber />) },
      { path: 'financeiro/pagar', element: S(<ContasPagar />) },
      { path: 'financeiro/bancos', element: S(<Bancos />) },
      { path: 'financeiro/fluxo-caixa', element: S(<FluxoCaixa />) },
      { path: 'comissoes', element: S(<Comissoes />) },

      { path: 'notas-fiscais', element: S(<NotasLista />) },
      { path: 'notas-fiscais/nova', element: S(<NotaForm />) },
      { path: 'notas-fiscais/:id', element: S(<NotaDetalhe />) },

      { path: 'relatorios', element: S(<Relatorios />) },
      { path: 'relatorios/dre', element: S(<Dre />) },

      { path: 'comunicacao', element: <Navigate to="/comunicacao/notificacoes" replace /> },
      { path: 'comunicacao/notificacoes', element: S(<Notificacoes />) },
      { path: 'comunicacao/whatsapp', element: S(<Whatsapp />) },
      { path: 'comunicacao/templates', element: S(<Templates />) },

      { path: 'configuracoes', element: S(<ConfigIndex />) },
      { path: 'configuracoes/empresa', element: S(<ConfigEmpresa />) },
      { path: 'configuracoes/fiscal', element: S(<ConfigFiscal />) },
      { path: 'configuracoes/usuarios', element: S(<ConfigUsuarios />) },
      { path: 'configuracoes/vendedores', element: S(<ConfigVendedores />) },
      { path: 'configuracoes/tecnicos', element: S(<ConfigTecnicos />) },
      { path: 'configuracoes/situacoes', element: S(<ConfigSituacoes />) },
      { path: 'configuracoes/formas-pagamento', element: S(<ConfigFormasPagamento />) },
      { path: 'configuracoes/categorias-financeiras', element: S(<ConfigCategoriasFinanceiras />) },
      { path: 'configuracoes/depositos', element: S(<ConfigDepositos />) },
      { path: 'configuracoes/contas-financeiras', element: S(<ConfigContasFinanceiras />) },
      { path: 'configuracoes/smtp', element: S(<ConfigSmtp />) },
      { path: 'configuracoes/open-finance', element: S(<ConfigOpenFinance />) },
      { path: 'configuracoes/bling', element: S(<ConfigBling />) },
      { path: 'configuracoes/bling/callback', element: S(<BlingCallback />) },

      { path: '*', element: S(<NotFound />) },
    ],
  },
]);
