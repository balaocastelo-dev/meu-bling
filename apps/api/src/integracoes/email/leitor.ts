/**
 * LEITURA DAS CAIXAS DE E-MAIL
 *
 * Duas formas de ler, mesma saída:
 *   - IMAP   → caixas do domínio próprio (DreamHost e afins)
 *   - GMAIL  → contas Google, pela API, com refresh token
 *
 * O que sai daqui é só leitura. Nada é marcado, movido ou apagado na caixa
 * do Thiago — o robô lê e vai embora.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface MensagemEmail {
  /** Message-ID do cabeçalho: único no mundo, é o que evita processar duas vezes */
  messageId: string;
  de: string;
  assunto: string;
  data: Date;
  /** corpo em texto (o HTML é convertido quando não há parte de texto) */
  texto: string;
  /**
   * O e-mail passou na verificação de origem do provedor (DKIM/SPF)?
   * null = o provedor não informou. Quem decide o que fazer com isso é o serviço.
   */
  autenticado: boolean | null;
  /** nomes dos anexos, para saber quando o dado está num PDF */
  anexos: string[];
}

export interface CaixaConfig {
  tipo: string;
  endereco: string;
  host?: string | null;
  porta?: number | null;
  usuario?: string | null;
  /** senha de IMAP ou refresh token do Gmail, já descriptografado */
  segredo: string;
  pasta?: string | null;
}

/**
 * Lê o cabeçalho Authentication-Results e diz se o provedor validou a origem.
 * É isso que separa um aviso de verdade da SumUp de um phishing imitando a SumUp.
 */
export function conferirAutenticacao(cabecalho: string | undefined | null): boolean | null {
  if (!cabecalho) return null;
  const h = cabecalho.toLowerCase();
  if (/dkim=pass/.test(h)) return true;
  if (/dkim=fail|dkim=none/.test(h) && !/spf=pass/.test(h)) return false;
  if (/spf=pass/.test(h)) return true;
  if (/spf=fail|spf=softfail/.test(h)) return false;
  return null;
}

function texto(parsed: Awaited<ReturnType<typeof simpleParser>>): string {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lê uma caixa IMAP a partir de uma data. Somente leitura. */
export async function lerImap(cfg: CaixaConfig, desde: Date, limite = 200): Promise<MensagemEmail[]> {
  if (!cfg.host) throw new Error('Caixa IMAP sem host configurado.');
  const cliente = new ImapFlow({
    host: cfg.host,
    port: cfg.porta || 993,
    secure: true,
    auth: { user: cfg.usuario || cfg.endereco, pass: cfg.segredo },
    logger: false,
  });
  const out: MensagemEmail[] = [];
  await cliente.connect();
  try {
    // readOnly: a caixa do usuário não é alterada (nada é marcado como lido)
    const trava = await cliente.getMailboxLock(cfg.pasta || 'INBOX', { readOnly: true });
    try {
      for await (const msg of cliente.fetch({ since: desde }, { source: true, envelope: true })) {
        if (out.length >= limite) break;
        if (!msg.source) continue;
        const p = await simpleParser(msg.source);
        const messageId = p.messageId || `imap:${cfg.endereco}:${msg.uid}`;
        out.push({
          messageId,
          de: p.from?.value?.[0]?.address || p.from?.text || '',
          assunto: p.subject || '',
          data: p.date ? new Date(p.date) : msg.envelope?.date ? new Date(msg.envelope.date) : new Date(),
          texto: texto(p),
          autenticado: conferirAutenticacao(p.headers.get('authentication-results') as string | undefined),
          anexos: (p.attachments || []).map((a) => a.filename || 'anexo'),
        });
      }
    } finally {
      trava.release();
    }
  } finally {
    await cliente.logout().catch(() => {});
  }
  return out;
}

// --------------------------------------------------------------------------
// Gmail pela API (refresh token de um app OAuth do Google Cloud)
// --------------------------------------------------------------------------

async function tokenGmail(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados no servidor.');
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Google recusou o refresh token (${r.status}).`);
  const j: any = await r.json();
  if (!j.access_token) throw new Error('Google não devolveu access_token.');
  return j.access_token as string;
}

function cabecalho(headers: any[], nome: string): string {
  const h = headers?.find((x) => String(x.name).toLowerCase() === nome.toLowerCase());
  return h?.value ?? '';
}

function corpoGmail(payload: any): { texto: string; anexos: string[] } {
  const anexos: string[] = [];
  let txt = '';
  let html = '';
  const andar = (p: any) => {
    if (!p) return;
    if (p.filename) anexos.push(p.filename);
    const dados = p.body?.data;
    if (dados) {
      const conteudo = Buffer.from(dados.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (p.mimeType === 'text/plain') txt += conteudo + '\n';
      else if (p.mimeType === 'text/html') html += conteudo + '\n';
    }
    (p.parts || []).forEach(andar);
  };
  andar(payload);
  if (!txt.trim() && html) {
    txt = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');
  }
  return { texto: txt.trim(), anexos };
}

/** Lê uma caixa do Gmail a partir de uma data. Somente leitura. */
export async function lerGmail(cfg: CaixaConfig, desde: Date, limite = 200): Promise<MensagemEmail[]> {
  const token = await tokenGmail(cfg.segredo);
  const auth = { authorization: `Bearer ${token}` };
  const after = Math.floor(desde.getTime() / 1000);
  const lista = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limite}&q=${encodeURIComponent(`after:${after}`)}`,
    { headers: auth },
  );
  if (!lista.ok) throw new Error(`Gmail recusou a listagem (${lista.status}).`);
  const j: any = await lista.json();
  const ids: string[] = (j.messages || []).map((m: any) => m.id);
  const out: MensagemEmail[] = [];
  for (const id of ids) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: auth });
    if (!r.ok) continue;
    const m: any = await r.json();
    const headers = m.payload?.headers || [];
    const { texto: corpo, anexos } = corpoGmail(m.payload);
    out.push({
      messageId: cabecalho(headers, 'Message-ID') || `gmail:${cfg.endereco}:${id}`,
      de: cabecalho(headers, 'From'),
      assunto: cabecalho(headers, 'Subject'),
      data: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
      texto: corpo,
      autenticado: conferirAutenticacao(cabecalho(headers, 'Authentication-Results')),
      anexos,
    });
  }
  return out;
}

export async function lerCaixa(cfg: CaixaConfig, desde: Date, limite = 200): Promise<MensagemEmail[]> {
  if (cfg.tipo === 'GMAIL') return lerGmail(cfg, desde, limite);
  return lerImap(cfg, desde, limite);
}
