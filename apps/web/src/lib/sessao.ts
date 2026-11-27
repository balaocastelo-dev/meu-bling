/**
 * Regras puras da sessão (sem DOM e sem rede), para o cliente e para os testes.
 * O JWT e o cookie duram 30 dias. A tela renova sozinha enquanto está em uso.
 */

/** Mensagem só quando o token realmente venceu (code NAO_AUTENTICADO). */
export const MENSAGEM_SESSAO_EXPIRADA = 'Sessão expirada. Faça login novamente.';
/** Aviso guardado antes do redirect, lido pela tela de login. */
export const AVISO_SESSAO = 'meu-bling-sessao-aviso';

/** Renova quando falta menos de 1 hora para o exp. */
export const JANELA_RENOVACAO_SEG = 60 * 60;
/** Com a aba visível, no máximo uma renovação a cada 30 minutos (fora dessa janela). */
export const INTERVALO_USO_MS = 30 * 60 * 1000;

export type GatilhoRenovacao = 'abertura' | 'visivel' | 'foco' | 'periodo';

export interface Decisao401 {
  deslogar: boolean;
  redirecionar: boolean;
  mensagem: string;
}

/** `exp` do JWT em segundos, só decodificando o payload (sem conferir assinatura). */
export function expiracaoJwt(token: string): number | null {
  try {
    const parte = token.split('.')[1];
    if (!parte) return null;
    let b64 = parte.replace(/-/g, '+').replace(/_/g, '/');
    const resto = b64.length % 4;
    if (resto) b64 += '='.repeat(4 - resto);
    const json = JSON.parse(atob(b64)) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/** Login e páginas públicas (/p/) não renovam a sessão. */
export function caminhoSemRenovacao(pathname: string, basePath = ''): boolean {
  const base = basePath.replace(/\/$/, '');
  return pathname.startsWith(`${base}/login`) || pathname.startsWith(`${base}/p/`);
}

export function deveRenovarSessao(o: {
  token: string | null;
  pathname: string;
  basePath?: string;
  agoraMs: number;
  ultimaRenovacaoMs: number;
  visivel: boolean;
  gatilho: GatilhoRenovacao;
}): boolean {
  if (!o.token || !o.visivel) return false;
  if (caminhoSemRenovacao(o.pathname, o.basePath ?? '')) return false;
  const exp = expiracaoJwt(o.token);
  const faltaSeg = exp == null ? -1 : exp - Math.floor(o.agoraMs / 1000);
  const naJanela = faltaSeg <= JANELA_RENOVACAO_SEG;
  // foco: só antecipa se já está na última hora (a aba visível cuida do resto)
  if (o.gatilho === 'foco') return naJanela;
  if (naJanela) return true;
  // abrir o app ou voltar para a aba renova, no máximo a cada 30 min
  return o.agoraMs - o.ultimaRenovacaoMs >= INTERVALO_USO_MS;
}

/** 401 do POST /auth/login (ou já estando em /login) não é sessão vencida. */
export function decidir401(o: { caminho: string; pathname: string; basePath?: string; code?: string; erro?: string }): Decisao401 {
  const base = (o.basePath ?? '').replace(/\/$/, '');
  const caminho = o.caminho.split('?')[0];
  const naLogin = o.pathname.startsWith(`${base}/login`) || caminho === '/auth/login' || caminho.endsWith('/auth/login');
  if (naLogin) {
    return { deslogar: false, redirecionar: false, mensagem: o.erro || 'E-mail ou senha inválidos.' };
  }
  const sessaoVencida = !o.code || o.code === 'NAO_AUTENTICADO';
  const publica = o.pathname.startsWith(`${base}/p/`);
  return {
    deslogar: true,
    redirecionar: !publica,
    mensagem: sessaoVencida ? MENSAGEM_SESSAO_EXPIRADA : o.erro || MENSAGEM_SESSAO_EXPIRADA,
  };
}
