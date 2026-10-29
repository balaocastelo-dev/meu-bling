/**
 * WHATSAPP pela EVOLUTION API — um QR Code só para toda a loja.
 *
 * O WhatsApp aceita uma sessão por número. Enquanto o MEU BLING abria a própria sessão
 * (Baileys), ele brigava pelo número com o CRM dos vendedores — daí a necessidade de dois
 * QR Codes. A Evolution API segura a sessão e todos os sistemas falam com ela por HTTP:
 * CRM, mensagens automáticas por situação, orçamentos e a cobrança do JARVIS saem do mesmo
 * número, com o histórico junto.
 *
 * A configuração (endereço, chave e instância) fica em Configurações → WhatsApp, com a
 * chave criptografada. Sem configuração, o sistema continua no Baileys — ver provedor.ts.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { encrypt, decrypt } from '../../lib/crypto.js';
import { somenteDigitos } from '../../lib/util.js';
import type { EstadoWhatsApp } from './servico.js';

const CHAVE_CONFIG = 'whatsapp.evolution';

export type ConfigEvolution = {
  ligado: boolean;
  url: string;
  instancia: string;
  /// criptografada no banco; nunca sai nas rotas
  apiKey: string | null;
};

const VAZIA: ConfigEvolution = { ligado: false, url: '', instancia: '', apiKey: null };

export async function lerConfig(): Promise<ConfigEvolution> {
  const linha = await prisma.configuracao.findUnique({ where: { chave: CHAVE_CONFIG } });
  if (!linha?.valor) return { ...VAZIA };
  try {
    const j = JSON.parse(linha.valor) as ConfigEvolution;
    return { ...VAZIA, ...j, apiKey: decrypt(j.apiKey) };
  } catch {
    return { ...VAZIA };
  }
}

export async function gravarConfig(p: Partial<ConfigEvolution>): Promise<ConfigEvolution> {
  const atual = await lerConfig();
  const nova: ConfigEvolution = {
    ligado: p.ligado ?? atual.ligado,
    url: (p.url ?? atual.url).replace(/\/+$/, ''),
    instancia: p.instancia ?? atual.instancia,
    // chave vazia ou mascarada = mantém a que já existe
    apiKey: p.apiKey && !/^[*•]+/.test(p.apiKey) ? p.apiKey : atual.apiKey,
  };
  const guardar = { ...nova, apiKey: encrypt(nova.apiKey) };
  await prisma.configuracao.upsert({
    where: { chave: CHAVE_CONFIG },
    create: { chave: CHAVE_CONFIG, valor: JSON.stringify(guardar) },
    update: { valor: JSON.stringify(guardar) },
  });
  return nova;
}

/** true quando a Evolution está configurada e ligada (é ela quem manda as mensagens). */
export async function evolutionAtiva(): Promise<boolean> {
  const c = await lerConfig();
  return !!(c.ligado && c.url && c.instancia && c.apiKey);
}

async function chamar(caminho: string, opcoes: { metodo?: string; corpo?: unknown; timeoutMs?: number } = {}) {
  const c = await lerConfig();
  if (!c.url || !c.apiKey) throw new AppError('Evolution API não configurada.', 422, 'EVOLUTION_SEM_CONFIG');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opcoes.timeoutMs ?? 20_000);
  try {
    const r = await fetch(`${c.url}${caminho}`, {
      method: opcoes.metodo ?? 'GET',
      signal: ctrl.signal,
      headers: { apikey: c.apiKey, ...(opcoes.corpo ? { 'content-type': 'application/json' } : {}) },
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    });
    const texto = await r.text();
    let json: any = texto;
    try {
      json = JSON.parse(texto);
    } catch {
      /* resposta em texto */
    }
    if (!r.ok) {
      const msg = typeof json === 'object' ? json?.message || json?.error || texto : texto;
      throw new AppError(`Evolution respondeu ${r.status}: ${String(msg).slice(0, 200)}`, 502, 'EVOLUTION_ERRO');
    }
    return json;
  } catch (e: any) {
    if (e instanceof AppError) throw e;
    if (e?.name === 'AbortError') throw new AppError('A Evolution API não respondeu a tempo.', 504, 'EVOLUTION_TIMEOUT');
    throw new AppError('Não consegui falar com a Evolution API: ' + (e?.message || e), 502, 'EVOLUTION_OFFLINE');
  } finally {
    clearTimeout(t);
  }
}

const MAPA_ESTADO: Record<string, EstadoWhatsApp['status']> = {
  open: 'CONECTADO',
  connecting: 'CONECTANDO',
  close: 'DESCONECTADO',
  closed: 'DESCONECTADO',
};

/** Estado da instância, no mesmo formato que o resto do sistema já entende. */
export async function status(): Promise<EstadoWhatsApp> {
  const c = await lerConfig();
  try {
    const r = await chamar(`/instance/connectionState/${encodeURIComponent(c.instancia)}`, { timeoutMs: 8000 });
    const estado = r?.instance?.state || r?.state || 'close';
    return {
      status: MAPA_ESTADO[String(estado)] ?? 'DESCONECTADO',
      numero: r?.instance?.owner ? somenteDigitos(String(r.instance.owner)) : null,
      nome: c.instancia,
      qrDataUrl: null,
      desde: null,
      ultimoErro: null,
    };
  } catch (e: any) {
    return { status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: c.instancia, desde: null, ultimoErro: e?.message ?? null };
  }
}

/** Pede o QR Code da instância (cria a instância se ainda não existir). */
export async function conectar(): Promise<EstadoWhatsApp> {
  const c = await lerConfig();
  const atual = await status();
  if (atual.status === 'CONECTADO') return atual;

  let qr: string | null = null;
  try {
    const r = await chamar(`/instance/connect/${encodeURIComponent(c.instancia)}`, { timeoutMs: 15_000 });
    qr = r?.base64 ?? r?.qrcode?.base64 ?? null;
  } catch {
    // instância ainda não existe: cria e já pede o QR
    const r = await chamar('/instance/create', {
      metodo: 'POST',
      corpo: { instanceName: c.instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS' },
      timeoutMs: 25_000,
    });
    qr = r?.qrcode?.base64 ?? null;
  }

  return {
    status: qr ? 'AGUARDANDO_QR' : 'CONECTANDO',
    qrDataUrl: qr && !qr.startsWith('data:') ? `data:image/png;base64,${qr}` : qr,
    numero: null,
    nome: c.instancia,
    desde: null,
    ultimoErro: null,
  };
}

/** Desconecta o aparelho (a instância continua existindo para reconectar com novo QR). */
export async function desconectar(): Promise<EstadoWhatsApp> {
  const c = await lerConfig();
  await chamar(`/instance/logout/${encodeURIComponent(c.instancia)}`, { metodo: 'DELETE' }).catch(() => null);
  return { status: 'DESCONECTADO', qrDataUrl: null, numero: null, nome: c.instancia, desde: null, ultimoErro: null };
}

const numeroEvolution = (numero: string) => {
  const d = somenteDigitos(numero);
  return d.length <= 11 ? `55${d}` : d;
};

export async function enviarTexto(numero: string, texto: string): Promise<{ id: string | null; jid: string }> {
  const c = await lerConfig();
  const destino = numeroEvolution(numero);
  const r = await chamar(`/message/sendText/${encodeURIComponent(c.instancia)}`, {
    metodo: 'POST',
    corpo: { number: destino, text: texto },
    timeoutMs: 30_000,
  });
  return { id: r?.key?.id ?? null, jid: r?.key?.remoteJid ?? `${destino}@s.whatsapp.net` };
}

export async function enviarDocumento(
  numero: string,
  caminho: string,
  nomeArquivo?: string,
  legenda?: string,
): Promise<{ id: string | null; jid: string }> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const c = await lerConfig();
  const destino = numeroEvolution(numero);
  const base64 = fs.readFileSync(caminho).toString('base64');

  const r = await chamar(`/message/sendMedia/${encodeURIComponent(c.instancia)}`, {
    metodo: 'POST',
    corpo: {
      number: destino,
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: base64,
      fileName: nomeArquivo || path.basename(caminho),
      caption: legenda || undefined,
    },
    timeoutMs: 60_000,
  });
  return { id: r?.key?.id ?? null, jid: r?.key?.remoteJid ?? `${destino}@s.whatsapp.net` };
}

/** Lista as instâncias do servidor — ajuda o ADMIN a escolher a certa na tela. */
export async function listarInstancias(): Promise<{ nome: string; estado: string; numero: string | null }[]> {
  const r = await chamar('/instance/fetchInstances', { timeoutMs: 10_000 });
  const lista = Array.isArray(r) ? r : r?.instance ? [r.instance] : [];
  return lista.map((i: any) => {
    const x = i?.instance ?? i;
    return {
      nome: x?.instanceName ?? x?.name ?? '?',
      estado: String(x?.connectionStatus ?? x?.state ?? x?.status ?? '?'),
      numero: x?.owner ? somenteDigitos(String(x.owner)) : null,
    };
  });
}

/** Testa a configuração sem gravar nada: usado pelo botão "Testar" da tela. */
export async function testar(p: { url: string; apiKey: string; instancia: string }) {
  const url = p.url.replace(/\/+$/, '');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(`${url}/instance/fetchInstances`, { headers: { apikey: p.apiKey }, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, mensagem: `O servidor respondeu ${r.status}. Confira o endereço e a chave.` };

    const j: any = await r.json();
    const lista = Array.isArray(j) ? j : j?.instance ? [j.instance] : [];
    const nomes = lista.map((i: any) => (i?.instance ?? i)?.instanceName ?? (i?.instance ?? i)?.name).filter(Boolean);
    const achou = nomes.includes(p.instancia);
    return {
      ok: achou,
      mensagem: achou
        ? `Conectado ao servidor. A instância "${p.instancia}" existe e está pronta.`
        : `O servidor respondeu, mas não tem a instância "${p.instancia}". Disponíveis: ${nomes.join(', ') || 'nenhuma'}.`,
      instancias: nomes,
    };
  } catch (e: any) {
    return { ok: false, mensagem: `Não consegui falar com o servidor: ${String(e?.message || e).slice(0, 180)}` };
  }
}
