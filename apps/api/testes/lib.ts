/**
 * Utilitários dos testes: cliente HTTP com contagem de acertos/falhas e verificações legíveis.
 * Cada suíte recebe a URL da API como 1º argumento (o rodar.ts passa a da API de teste).
 */
export const BASE = (process.argv[2] || 'http://localhost:3333') + '/api/v1';

export const placar = { ok: 0, falhas: 0, lista: [] as string[] };

export class Sessao {
  constructor(public token = '', public nome = 'anônimo') {}

  async req(metodo: string, rota: string, body?: unknown, esperado: number | number[] = [200, 201]): Promise<any> {
    const esperados = Array.isArray(esperado) ? esperado : [esperado];
    const r = await fetch(BASE + rota, {
      method: metodo,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const texto = await r.text();
    let json: any = texto;
    try {
      json = JSON.parse(texto);
    } catch {
      /* texto puro */
    }
    if (esperados.includes(r.status)) placar.ok++;
    else falhar(`[${this.nome}] ${metodo} ${rota} → ${r.status} (esperado ${esperados.join('/')}) ${typeof json === 'object' ? JSON.stringify(json).slice(0, 300) : String(json).slice(0, 200)}`);
    return json;
  }
  get = (rota: string, esperado?: number | number[]) => this.req('GET', rota, undefined, esperado);
  post = (rota: string, body?: unknown, esperado?: number | number[]) => this.req('POST', rota, body ?? {}, esperado);
  put = (rota: string, body?: unknown, esperado?: number | number[]) => this.req('PUT', rota, body ?? {}, esperado);
  del = (rota: string, esperado?: number | number[]) => this.req('DELETE', rota, undefined, esperado);
}

export function falhar(msg: string) {
  placar.falhas++;
  placar.lista.push(msg);
  console.log('  ✖ ' + msg);
}

/** Verificação com mensagem: o que se esperava e o que veio. */
export function verifica(cond: unknown, oQueDeveria: string, veio?: unknown) {
  if (cond) {
    placar.ok++;
    console.log('  ✔ ' + oQueDeveria);
  } else falhar(`${oQueDeveria}${veio !== undefined ? ` — veio: ${typeof veio === 'object' ? JSON.stringify(veio).slice(0, 300) : veio}` : ''}`);
}

export function igual(a: number, b: number, casas = 2) {
  return Math.abs(a - b) < Math.pow(10, -casas) / 2 + 1e-9;
}

export async function entrar(email: string, senha: string): Promise<Sessao> {
  const s = new Sessao('', email);
  // o login tem limite de 20/min por IP: com muitas etapas seguidas, espera a janela e tenta de novo
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
    if (r.status === 429) {
      const espera = Number(r.headers.get('retry-after')) || 30;
      await new Promise((ok) => setTimeout(ok, (Math.min(espera, 61) + 1) * 1000));
      continue;
    }
    const corpo: any = await r.json().catch(() => ({}));
    if (r.status === 200) {
      placar.ok++;
      s.token = corpo?.token || '';
    } else falhar(`[${email}] POST /auth/login → ${r.status} (esperado 200) ${JSON.stringify(corpo).slice(0, 200)}`);
    return s;
  }
  falhar(`[${email}] POST /auth/login → 429 depois de esperar o limite`);
  return s;
}

export const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera uma condição assíncrona (eventos de fundo) até `ms`. */
export async function aguardar<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 4000): Promise<T> {
  const fim = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < fim) {
    await espera(200);
    v = await fn();
  }
  return v;
}

export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const SUF = String(Date.now()).slice(-6);

export function secao(t: string) {
  console.log(`\n== ${t}`);
}

export function encerrar(nome: string) {
  console.log(`\n${nome}: ${placar.ok} ok, ${placar.falhas} falhas`);
  // process.exit imediato dispara um assert do libuv no Windows (Node 24 + tsx) quando ainda há
  // handles fechando ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") e derruba suíte
  // que passou — um respiro para o event loop fechar os handles antes de sair resolve
  setTimeout(() => process.exit(placar.falhas ? 1 : 0), 300);
}

/** CPF válido (dígitos verificadores corretos) a partir de um sufixo. */
export function cpfTeste(suf: string): string {
  const base = `987${suf}`.replace(/\D/g, '').padEnd(9, '0').slice(0, 9);
  const dv = (s: string, n: number) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += Number(s[i]) * (n + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base, 9);
  return base + d1 + dv(base + d1, 10);
}

/** Dados de cliente completos (o que a venda exige para ser finalizada). */
export const clienteCompleto = (nome: string, suf = SUF) => ({
  nome,
  tipoPessoa: 'F',
  documento: cpfTeste(suf),
  celular: '19999990000',
  email: `cli${suf}@example.com`,
  logradouro: 'Av. Anchieta',
  numero: '789',
  bairro: 'Cambuí',
  municipio: 'Campinas',
  codigoMunicipio: '3509502',
  uf: 'SP',
  cep: '13025000',
});
