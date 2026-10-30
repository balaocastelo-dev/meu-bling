/**
 * Cliente da API do Painel de auditoria: a sessão normal (Bearer) + o token do painel (x-auditoria),
 * que o ADMIN ganha ao digitar a senha do dia. Guardado na aba (sessionStorage) por 4 h.
 */
import { API_BASE, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/stores/auth';

const CHAVE = 'meu-bling.painel-auditoria';

export function tokenPainel(): string | null {
  try {
    const raw = sessionStorage.getItem(CHAVE);
    if (!raw) return null;
    const { token, expiraEm } = JSON.parse(raw) as { token: string; expiraEm: string };
    if (!token || new Date(expiraEm).getTime() < Date.now()) {
      sessionStorage.removeItem(CHAVE);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}
export function guardarTokenPainel(token: string, expiraEm: string) {
  sessionStorage.setItem(CHAVE, JSON.stringify({ token, expiraEm }));
}
export function sairDoPainel() {
  sessionStorage.removeItem(CHAVE);
}

/** 403 com code PAINEL_SENHA: o token do painel venceu — a tela volta para o cofre */
export class SenhaDoPainelError extends ApiError {}

type Query = Record<string, string | number | boolean | null | undefined>;

async function chamar<T>(metodo: string, caminho: string, body?: unknown, params?: Query): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  const token = useAuth.getState().token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const tp = tokenPainel();
  if (tp) headers.set('x-auditoria', tp);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${caminho}${qs(params)}`, { method: metodo, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar à API.', 'REDE');
  }
  const corpo: any = await res.json().catch(() => ({}));
  if (res.status === 401) {
    useAuth.getState().logout();
    location.reload();
    throw new ApiError(401, 'Sessão expirada.', 'NAO_AUTENTICADO');
  }
  if (!res.ok) {
    if (corpo?.code === 'PAINEL_SENHA') {
      sairDoPainel();
      throw new SenhaDoPainelError(403, corpo.erro, corpo.code);
    }
    throw new ApiError(res.status, corpo?.erro || `Erro ${res.status}`, corpo?.code, corpo?.detalhes);
  }
  return corpo as T;
}

export const painel = {
  get: <T>(caminho: string, params?: Query) => chamar<T>('GET', `/auditoria/painel${caminho}`, undefined, params),
  post: <T>(caminho: string, body?: unknown) => chamar<T>('POST', `/auditoria/painel${caminho}`, body ?? {}),
  put: <T>(caminho: string, body?: unknown) => chamar<T>('PUT', `/auditoria/painel${caminho}`, body ?? {}),
};

// ---------------------------------------------------------------- tipos
export type Tom = 'verde' | 'vermelho' | 'azul' | 'amarelo' | 'neutro';
export interface Operacao {
  id: string;
  inicio: string;
  fim: string | null;
  usuarioId: number | null;
  usuario: string;
  origem: 'TELA' | 'API' | 'MCP' | 'SITE' | 'SERVICO' | 'REVERSAO' | 'SISTEMA';
  rota: string | null;
  rotulo: string | null;
  ip: string | null;
  status: number | null;
  categoria: string;
  descricao: string | null;
  eventos: number;
  revertidaEm: string | null;
  revertidaPor: string | null;
  revertidaOpId: string | null;
  reverteOpId: string | null;
}
export interface Evento {
  id: number;
  sequencia: number;
  quando: string;
  tabela: string;
  tabelaNome: string;
  categoria: string;
  registroId: number | null;
  registroChave: string | null;
  tipo: 'CRIAR' | 'ALTERAR' | 'EXCLUIR';
  modo: 'DIRETO' | 'ANINHADO' | 'CASCATA';
  reversivel: boolean;
  revertidoEm: string | null;
  rotulo: string;
  link: string | null;
  campos: string[];
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
}
export interface Passo {
  acao: 'EXCLUIR' | 'RECRIAR' | 'RESTAURAR' | 'PULAR';
  rotulo: string;
  campos: string[];
  motivo: string | null;
  link: string | null;
}
export interface OperacaoDetalhe extends Omit<Operacao, 'eventos'> {
  acoes: { id: number; texto: string; tom: Tom; link: string | null; categoria: string; quando: string | null }[];
  eventos: Evento[];
  previa: { bloqueios: string[]; avisos: { texto: string; operacaoId?: string; link?: string | null }[]; podeReverter: boolean; precisaConfirmar: boolean; passos: Passo[] } | null;
  reversao: { id: string; inicio: string; usuario: string; descricao: string | null } | null;
  original: { id: string; inicio: string; usuario: string; descricao: string | null } | null;
}
export interface Achado {
  id: number;
  agente: string;
  agenteNome: string;
  chave: string;
  nivel: 'alto' | 'medio' | 'baixo';
  categoria: string;
  titulo: string;
  explicacao: string;
  evidencias: { rotulo: string; link?: string | null; operacaoId?: string | null }[];
  usuarioId: number | null;
  usuario: string | null;
  operacaoId: string | null;
  tabela: string | null;
  registroId: number | null;
  status: 'ABERTO' | 'VISTO' | 'IGNORADO' | 'RESOLVIDO';
  vistoPor: string | null;
  vistoEm: string | null;
  vezes: number;
  criadoEm: string;
  atualizadoEm: string;
  link: string | null;
}
export interface Resumo {
  agora: string;
  hoje: { operacoes: number; porCategoria: { categoria: string; n: number }[]; usuarios: { usuario: string; n: number; ultima: string | null }[] };
  achados: Record<'alto' | 'medio' | 'baixo', number>;
  totalOperacoes: number;
  historicoDesde: string | null;
  ultimaOperacao: string | null;
  agentes: { ligado: boolean; ultimaVez: string | null; erro: string | null };
  categorias: { chave: string; rotulo: string }[];
}
export interface Funcionario {
  usuarioId: number;
  nome: string;
  perfil: string;
  ativo: boolean;
  ultimoLogin: string | null;
  operacoes: number;
  porCategoria: Record<string, number>;
  criados: number;
  alterados: number;
  excluidos: number;
  foraHorario: number;
  revertidas: number;
  comErro: number;
  ultima: string | null;
  logins: number;
  achados: Record<string, number>;
  apis: number;
}
export interface ConfigAgentes {
  ligado: boolean;
  horaInicio: number;
  horaFim: number;
  descontoMaxPct: number;
  saidaManualAlerta: number;
  modeloIa: string;
  desligados: string[];
}
export interface AgentesResposta {
  config: ConfigAgentes;
  estado: { ultimaVez: string | null; duracaoMs: number; novos: number; confirmados: number; resolvidosSozinhos: number; erro: string | null; porAgente: Record<string, { achados: number; ms: number; erro?: string }> } | null;
  intervaloMin: number;
  agentes: { codigo: string; nome: string; descricao: string; janelaDias: number; ligado: boolean; abertos: number; ultima: { achados: number; ms: number; erro?: string } | null }[];
  analista: { chaveConfigurada: boolean; modelo: string; abertos: number; ultimo: { geradoEm: string; modelo: string; resumo: string; pontos: { nivel: string; titulo: string; explicacao: string; usuario?: string | null }[]; perguntas: string[]; erro?: string | null } | null };
}

export const ROTULO_CATEGORIA: Record<string, string> = {
  vendas: 'Vendas',
  os: 'Assistência',
  compras: 'Compras',
  financeiro: 'Financeiro',
  estoque: 'Estoque',
  fiscal: 'Fiscal',
  consignacao: 'Consignação',
  comissoes: 'Comissões',
  cadastros: 'Cadastros',
  comunicacao: 'Mensagens',
  acessos: 'Acessos',
  configuracoes: 'Configurações',
  sistema: 'Sistema',
  padroes: 'Padrões',
  analista: 'Analista IA',
};
export const TOM_CATEGORIA: Record<string, 'verde' | 'vermelho' | 'azul' | 'amarelo' | 'neutro' | 'roxo' | 'laranja' | 'cinza'> = {
  vendas: 'verde',
  os: 'azul',
  compras: 'laranja',
  financeiro: 'vermelho',
  estoque: 'amarelo',
  fiscal: 'roxo',
  consignacao: 'roxo',
  comissoes: 'laranja',
  cadastros: 'neutro',
  comunicacao: 'azul',
  acessos: 'vermelho',
  configuracoes: 'cinza',
  sistema: 'cinza',
  padroes: 'amarelo',
  analista: 'roxo',
};
export const ROTULO_ORIGEM: Record<string, string> = { TELA: 'Tela', API: 'API', MCP: 'Agente IA (MCP)', SITE: 'Site/PDV', SERVICO: 'Robô', REVERSAO: 'Reversão', SISTEMA: 'Sistema' };
