/**
 * De onde sai o WhatsApp da loja.
 *
 *   EVOLUTION  → a sessão fica no servidor Evolution API (um QR Code só para CRM, mensagens
 *                automáticas, orçamentos e a cobrança do JARVIS). É o padrão quando configurado.
 *   BAILEYS    → a sessão é do próprio MEU BLING (como era antes). Fica como volta atrás:
 *                basta desligar a Evolution em Configurações → WhatsApp, sem mexer em código.
 *
 * Todo o resto do sistema (fila de notificações, orçamentos, carnê) chama estas funções e
 * não precisa saber qual motor está no ar.
 */
import type { EstadoWhatsApp } from './servico.js';
import * as baileys from './servico.js';
import * as evolution from './evolution.js';

export type Provedor = 'EVOLUTION' | 'BAILEYS';

export async function provedorAtual(): Promise<Provedor> {
  return (await evolution.evolutionAtiva()) ? 'EVOLUTION' : 'BAILEYS';
}

export async function status(): Promise<EstadoWhatsApp & { provedor: Provedor }> {
  const p = await provedorAtual();
  const e = p === 'EVOLUTION' ? await evolution.status() : baileys.status();
  return { ...e, provedor: p };
}

export async function conectar(): Promise<EstadoWhatsApp> {
  return (await provedorAtual()) === 'EVOLUTION' ? evolution.conectar() : baileys.conectar();
}

export async function desconectar(): Promise<EstadoWhatsApp> {
  return (await provedorAtual()) === 'EVOLUTION' ? evolution.desconectar() : baileys.desconectar();
}

export async function enviarTexto(numero: string, texto: string) {
  return (await provedorAtual()) === 'EVOLUTION' ? evolution.enviarTexto(numero, texto) : baileys.enviarTexto(numero, texto);
}

export async function enviarDocumento(numero: string, caminho: string, nomeArquivo?: string, legenda?: string) {
  return (await provedorAtual()) === 'EVOLUTION'
    ? evolution.enviarDocumento(numero, caminho, nomeArquivo, legenda)
    : baileys.enviarDocumento(numero, caminho, nomeArquivo, legenda);
}

/** Usado pela fila de notificações: só manda quando dá para mandar. */
export async function conectado(): Promise<boolean> {
  return (await status()).status === 'CONECTADO';
}
