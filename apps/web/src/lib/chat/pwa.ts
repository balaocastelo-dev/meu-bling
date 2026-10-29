/**
 * Aviso no celular com o sistema fechado (Web Push) + "adicionar à tela inicial".
 * O service worker (public/sw.js) recebe o push e mostra a notificação; ao tocar, abre a conversa.
 * No iPhone só funciona depois de adicionar o MEU BLING à tela inicial (Compartilhar → Adicionar à Tela de Início).
 */
import { api, BASE_PATH } from '@/lib/api';

export type EstadoPush = 'indisponivel' | 'negado' | 'ativo' | 'inativo';

let registro: ServiceWorkerRegistration | null = null;

export function suportaPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone/iPad no Safari (fora da tela inicial): precisa instalar primeiro. */
export function ehIosNoNavegador(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = (window.matchMedia?.('(display-mode: standalone)').matches ?? false) || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !instalado;
}

export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  if (registro) return registro;
  try {
    registro = await navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` });
    return registro;
  } catch (e) {
    console.warn('[pwa] service worker não registrou', e);
    return null;
  }
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!suportaPush()) return 'indisponivel';
  if (Notification.permission === 'denied') return 'negado';
  const reg = await registrarServiceWorker();
  if (!reg) return 'indisponivel';
  try {
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'ativo' : 'inativo';
  } catch {
    return 'indisponivel';
  }
}

function base64ParaBytes(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Pede permissão, inscreve este navegador e guarda no servidor. */
export async function ativarPush(chavePublica: string): Promise<EstadoPush> {
  if (!suportaPush()) return 'indisponivel';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'negado' : 'inativo';
  const reg = await registrarServiceWorker();
  if (!reg) return 'indisponivel';
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ParaBytes(chavePublica) as BufferSource });
  await api.post('/chat/push/assinar', { subscription: sub.toJSON() });
  return 'ativo';
}

export async function desativarPush(): Promise<void> {
  const reg = await registrarServiceWorker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/chat/push/cancelar', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** Notificação do próprio navegador (aba em segundo plano, sistema aberto). */
export async function notificarNavegador(titulo: string, corpo: string, link: string, tag?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const url = `${BASE_PATH}${link}`;
  try {
    const reg = await registrarServiceWorker();
    if (reg) {
      await reg.showNotification(titulo, { body: corpo, tag, data: { link: url }, icon: `${BASE_PATH}/icone-192.png`, badge: `${BASE_PATH}/icone-192.png` });
      return;
    }
  } catch {
    /* cai para a Notification simples */
  }
  try {
    const n = new Notification(titulo, { body: corpo, tag, icon: `${BASE_PATH}/icone-192.png` });
    n.onclick = () => {
      window.focus();
      location.href = url;
      n.close();
    };
  } catch {
    /* navegador sem suporte */
  }
}
