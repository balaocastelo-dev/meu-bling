/**
 * Rotas da aplicação. Páginas carregadas sob demanda (lazy) para manter o bundle leve.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { useAuth } from '@/stores/auth';
import type { Perfil } from '@/types';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import ErroPagina from '@/components/layout/ErroPagina';
import { BASE_PATH } from '@/lib/api';
import { AppShell } from '@/components/layout/AppShell';
import { PaginaSkeleton } from '@/components/ui/Skeleton';

const Login = lazy(() => import('@/pages/auth/Login'));
const Perfil = lazy(() => import('@/pages/auth/Perfil'));
const DashboardGeral = lazy(() => import('@/pages/dashboard/DashboardGeral'));
const DashboardVendas = lazy(() => import('@/pages/dashboard/DashboardVendas'));
const DashboardAssistencia = lazy(() => import('@/pages/dashboard/DashboardAssistencia'));
const PainelVendedor = lazy(() => import('@/pages/vendedor/PainelVendedor'));
const MetasDesafios = lazy(() => import('@/pages/vendedor/MetasDesafios'));

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
const ExtratoConta = lazy(() => import('@/pages/financeiro/ExtratoConta'));
const FluxoCaixa = lazy(() => import('@/pages/financeiro/FluxoCaixa'));
const Caixinhas = lazy(() => import('@/pages/financeiro/Caixinhas'));
const InicioGerente = lazy(() => import('@/pages/dashboard/InicioGerente'));
const Comissoes = lazy(() => import('@/pages/financeiro/Comissoes'));
const Emprestimos = lazy(() => import('@/pages/financeiro/Emprestimos'));
const ConsignacoesLista = lazy(() => import('@/pages/consignacoes/ConsignacoesLista'));
const ConsignacaoForm = lazy(() => import('@/pages/consignacoes/ConsignacaoForm'));
const ConsignacaoDetalhe = lazy(() => import('@/pages/consignacoes/ConsignacaoDetalhe'));

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
const ConfigMercadoPago = lazy(() => import('@/pages/configuracoes/MercadoPago'));
const ConfigOpenFinance = lazy(() => import('@/pages/configuracoes/OpenFinance'));
const ConfigBling = lazy(() => import('@/pages/configuracoes/Bling'));
const ConfigSaude = lazy(() => import('@/pages/configuracoes/Saude'));
const ConfigApi = lazy(() => import('@/pages/configuracoes/ApiIntegracoes'));
const BlingCallback = lazy(() => import('@/pages/configuracoes/BlingCallback'));

const OsPublica = lazy(() => import('@/pages/publico/OsPublica'));
const VendaPublica = lazy(() => import('@/pages/publico/VendaPublica'));
const ConsignacaoPublica = lazy(() => import('@/pages/publico/ConsignacaoPublica'));
const NotFound = lazy(() => import('@/pages/NotFound'));

const S = (el: ReactNode) => <Suspense fallback={<PaginaSkeleton />}>{el}</Suspense>;

/** Protege uma rota por perfil (a API também valida; aqui só evitamos telas vazias). */
function Somente({ perfis, children }: { perfis: Perfil[]; children: ReactNode }) {
  const temPerfil = useAuth((s) => s.temPerfil);
  if (!temPerfil(...perfis)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <p className="text-base font-semibold text-amber-800">Sem permissão</p>
        <p className="mt-1 text-sm text-amber-700">Seu perfil não tem acesso a esta área. Fale com o administrador.</p>
      </div>
    );
  }
  return <>{children}</>;
}
/** Tela inicial: ADMIN vê o dashboard; o vendedor cai no painel dele; os demais na sua área de trabalho. */
function Inicio() {
  const perfil = useAuth((s) => s.usuario?.perfil);
  if (perfil === 'ADMIN') return S(<DashboardGeral />);
  if (perfil === 'TECNICO') return <Navigate to="/ordens-servico" replace />;
  if (perfil === 'FINANCEIRO') return <Navigate to="/financeiro/receber" replace />;
  if (perfil === 'VENDEDOR') return <Navigate to="/meu-painel" replace />;
  if (perfil === 'GERENTE') return S(<InicioGerente />);
  return <Navigate to="/vendas" replace />;
}
const ADMIN = (el: ReactNode) => S(<Somente perfis={['ADMIN']}>{el}</Somente>);
const GESTAO = (el: ReactNode) => S(<Somente perfis={['ADMIN', 'GERENTE']}>{el}</Somente>);
const FIN = (el: ReactNode) => S(<Somente perfis={['ADMIN', 'GERENTE', 'FINANCEIRO']}>{el}</Somente>);

export const router = createBrowserRouter(
  [
  { path: '/login', element: S(<Login />) },
  { path: '/p/os/:token', element: S(<OsPublica />) },
  { path: '/p/venda/:token', element: S(<VendaPublica />) },
  { path: '/p/consignacao/:token', element: S(<ConsignacaoPublica />) },
  {
    path: '/',
    element: <AppShell />,
    errorElement: <ErroPagina />,
    children: [
      { index: true, element: <Inicio /> },
      { path: 'dashboard/vendas', element: ADMIN(<DashboardVendas />) },
      { path: 'dashboard/assistencia', element: ADMIN(<DashboardAssistencia />) },
      { path: 'perfil', element: S(<Perfil />) },
      { path: 'meu-painel', element: S(<Somente perfis={['ADMIN', 'GERENTE', 'VENDEDOR']}><PainelVendedor /></Somente>) },
      { path: 'metas-desafios', element: GESTAO(<MetasDesafios />) },

      { path: 'vendas', element: S(<VendasLista />) },
      { path: 'vendas/nova', element: S(<VendaForm />) },
      { path: 'vendas/:id', element: S(<VendaDetalhe />) },
      { path: 'vendas/:id/editar', element: S(<VendaForm />) },
      { path: 'orcamentos', element: S(<VendasLista tipo="ORCAMENTO" />) },
      { path: 'orcamentos/novo', element: S(<VendaForm tipo="ORCAMENTO" />) },
      { path: 'orcamentos/:id', element: S(<VendaDetalhe />) },
      { path: 'orcamentos/:id/editar', element: S(<VendaForm tipo="ORCAMENTO" />) },

      { path: 'compras', element: S(<ComprasLista />) },
      { path: 'compras/nova', element: S(<CompraForm />) },
      { path: 'compras/:id', element: S(<CompraDetalhe />) },
      { path: 'compras/:id/editar', element: S(<CompraForm />) },

      { path: 'consignacoes', element: S(<ConsignacoesLista />) },
      { path: 'consignacoes/nova', element: S(<ConsignacaoForm />) },
      { path: 'consignacoes/:id', element: S(<ConsignacaoDetalhe />) },

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
      { path: 'financeiro/receber', element: FIN(<ContasReceber />) },
      { path: 'financeiro/pagar', element: FIN(<ContasPagar />) },
      { path: 'financeiro/bancos', element: FIN(<Bancos />) },
      { path: 'financeiro/bancos/:id', element: FIN(<ExtratoConta />) },
      { path: 'financeiro/fluxo-caixa', element: FIN(<FluxoCaixa />) },
      { path: 'financeiro/caixinhas', element: FIN(<Caixinhas />) },
      { path: 'financeiro/emprestimos', element: FIN(<Emprestimos />) },
      { path: 'comissoes', element: S(<Comissoes />) },

      { path: 'notas-fiscais', element: S(<NotasLista />) },
      { path: 'notas-fiscais/nova', element: S(<NotaForm />) },
      { path: 'notas-fiscais/:id', element: S(<NotaDetalhe />) },

      { path: 'relatorios', element: FIN(<Relatorios />) },
      { path: 'relatorios/dre', element: FIN(<Dre />) },

      { path: 'comunicacao', element: <Navigate to="/comunicacao/notificacoes" replace /> },
      { path: 'comunicacao/notificacoes', element: S(<Notificacoes />) },
      { path: 'comunicacao/whatsapp', element: S(<Whatsapp />) },
      { path: 'comunicacao/templates', element: S(<Templates />) },

      { path: 'configuracoes', element: GESTAO(<ConfigIndex />) },
      { path: 'configuracoes/empresa', element: GESTAO(<ConfigEmpresa />) },
      { path: 'configuracoes/fiscal', element: ADMIN(<ConfigFiscal />) },
      { path: 'configuracoes/usuarios', element: ADMIN(<ConfigUsuarios />) },
      { path: 'configuracoes/vendedores', element: GESTAO(<ConfigVendedores />) },
      { path: 'configuracoes/tecnicos', element: GESTAO(<ConfigTecnicos />) },
      { path: 'configuracoes/situacoes', element: ADMIN(<ConfigSituacoes />) },
      { path: 'configuracoes/formas-pagamento', element: GESTAO(<ConfigFormasPagamento />) },
      { path: 'configuracoes/categorias-financeiras', element: GESTAO(<ConfigCategoriasFinanceiras />) },
      { path: 'configuracoes/depositos', element: GESTAO(<ConfigDepositos />) },
      { path: 'configuracoes/contas-financeiras', element: GESTAO(<ConfigContasFinanceiras />) },
      { path: 'configuracoes/smtp', element: ADMIN(<ConfigSmtp />) },
      { path: 'configuracoes/mercado-pago', element: ADMIN(<ConfigMercadoPago />) },
      { path: 'configuracoes/open-finance', element: ADMIN(<ConfigOpenFinance />) },
      { path: 'configuracoes/bling', element: ADMIN(<ConfigBling />) },
      { path: 'configuracoes/saude', element: ADMIN(<ConfigSaude />) },
      { path: 'configuracoes/api', element: ADMIN(<ConfigApi />) },
      { path: 'configuracoes/bling/callback', element: ADMIN(<BlingCallback />) },

      { path: '*', element: S(<NotFound />) },
    ],
  },
],
  { basename: BASE_PATH || undefined },
);
