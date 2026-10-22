/**
 * Versão nova publicada com a tela aberta: a aba antiga não conhece as páginas novas ("Página não encontrada")
 * e os pedaços antigos do código somem do servidor ("Failed to fetch dynamically imported module").
 * Aqui a aba confere se há versão nova (compara o script principal do index.html do servidor com o carregado)
 * e recarrega sozinha — no máximo uma vez a cada 30 s para nunca entrar em loop.
 */
import { BASE_PATH } from './api';

const CHAVE = 'meubling.recarregadoEm';

function scriptAtual(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.src, location.href).pathname : null;
}

export async function haVersaoNova(): Promise<boolean> {
  try {
    const html = await fetch(`${BASE_PATH}/index.html?v=${Date.now()}`, { cache: 'no-store' }).then((r) => r.text());
    const m = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html);
    const atual = scriptAtual();
    return !!(m && atual && new URL(m[1], location.href).pathname !== atual);
  } catch {
    return false;
  }
}

export function recarregarUmaVez(): boolean {
  let ultimo = 0;
  try {
    ultimo = Number(sessionStorage.getItem(CHAVE) || 0);
  } catch {
    /* sem sessionStorage */
  }
  if (Date.now() - ultimo < 30_000) return false;
  try {
    sessionStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    /* ignora */
  }
  location.reload();
  return true;
}

/** Erro típico de aba com versão antiga depois de um deploy */
export function ehErroDeVersaoAntiga(msg: string | undefined) {
  return !!msg && /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(msg);
}
