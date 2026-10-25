/** Rotas do sistema lidas do apps/web/src/routes.tsx (usado pelos testes de telas e de layout). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROTAS_TSX = path.resolve(AQUI, '../../web/src/routes.tsx');

export type Perfil = 'ADMIN' | 'GERENTE' | 'VENDEDOR' | 'TECNICO' | 'FINANCEIRO';

/** Lê as rotas do routes.tsx e o embrulho de permissão de cada uma (ADMIN(…), GESTAO(…), FIN(…), Somente). */
export function lerRotas() {
  const src = fs.readFileSync(ROTAS_TSX, 'utf8');
  const rotas: { caminho: string; perfis: Perfil[] | 'TODOS' }[] = [];
  const re = /\{\s*path:\s*'([^']+)',\s*element:\s*([^\n]+?)\s*\},?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, caminho, el] = m;
    if (caminho === '*' || el.includes('Navigate') || caminho.startsWith('/p/') || caminho === '/login' || caminho.includes('callback')) continue;
    let perfis: Perfil[] | 'TODOS' = 'TODOS';
    if (/^ADMIN\(/.test(el)) perfis = ['ADMIN'];
    else if (/^GESTAO\(/.test(el)) perfis = ['ADMIN', 'GERENTE'];
    else if (/^FIN\(/.test(el)) perfis = ['ADMIN', 'GERENTE', 'FINANCEIRO'];
    else {
      const s = /perfis=\{\[([^\]]+)\]\}/.exec(el);
      if (s) perfis = s[1].split(',').map((x) => x.trim().replace(/'/g, '')) as Perfil[];
    }
    rotas.push({ caminho: caminho.startsWith('/') ? caminho : '/' + caminho, perfis });
  }
  return rotas;
}

