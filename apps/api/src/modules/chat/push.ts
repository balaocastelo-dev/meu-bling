/**
 * AVISO NO CELULAR COM O SISTEMA FECHADO (Web Push) — chat da equipe (29/10/2026)
 *
 * O navegador do funcionário (ou o MEU BLING "adicionado à tela inicial" no celular) se inscreve para
 * receber avisos; o sistema guarda a inscrição (PushAssinatura) e, quando chega mensagem ou chamada e a
 * pessoa está fora, manda o aviso pelo serviço de push do próprio navegador (Google/Apple/Mozilla).
 * Nada passa por servidor de terceiros nosso: só a chave VAPID da loja, criada uma vez e guardada
 * criptografada em Configuracao (chat.vapid).
 */
import webpush from 'web-push';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../lib/env.js';
import { decrypt, encrypt } from '../../lib/crypto.js';

const CHAVE_CFG = 'chat.vapid';
let chaves: { publicKey: string; privateKey: string } | null = null;
let pronto = false;

/** Garante o par de chaves VAPID (cria na primeira vez) e configura o web-push. */
export async function prepararPush(): Promise<{ publicKey: string } | null> {
  if (pronto && chaves) return { publicKey: chaves.publicKey };
  try {
    const cfg = await prisma.configuracao.findUnique({ where: { chave: CHAVE_CFG } });
    if (cfg) {
      const json = decrypt(cfg.valor);
      if (json) chaves = JSON.parse(json);
    }
    if (!chaves) {
      chaves = webpush.generateVAPIDKeys();
      const valor = encrypt(JSON.stringify(chaves)) as string;
      await prisma.configuracao.upsert({ where: { chave: CHAVE_CFG }, create: { chave: CHAVE_CFG, valor }, update: { valor } });
    }
    const contato = env.APP_URL.startsWith('https') ? env.APP_URL : 'mailto:contato@balao.info';
    webpush.setVapidDetails(contato, chaves.publicKey, chaves.privateKey);
    pronto = true;
    return { publicKey: chaves.publicKey };
  } catch (e) {
    console.error('[chat/push] não foi possível preparar o Web Push', e);
    return null;
  }
}

export function chavePublicaPush(): string | null {
  return chaves?.publicKey ?? null;
}

export interface AvisoPush {
  titulo: string;
  corpo: string;
  /** tela a abrir ao tocar (relativa ao app, ex.: /chat/12) */
  link?: string;
  /** agrupa avisos (ex.: "conversa-12": o novo substitui o anterior) */
  tag?: string;
  /** chamada: toca mais insistente e exige interação */
  urgente?: boolean;
  dados?: Record<string, unknown>;
}

/** Manda o aviso para todos os navegadores inscritos do usuário. Inscrição morta (410/404) é apagada. */
export async function enviarPush(usuarioId: number, aviso: AvisoPush): Promise<number> {
  if (!pronto) await prepararPush();
  if (!pronto) return 0;
  const assinaturas = await prisma.pushAssinatura.findMany({ where: { usuarioId } });
  if (!assinaturas.length) return 0;
  const payload = JSON.stringify({
    titulo: aviso.titulo,
    corpo: aviso.corpo,
    link: `${env.BASE_PATH}${aviso.link || '/chat'}`,
    tag: aviso.tag,
    urgente: !!aviso.urgente,
    dados: aviso.dados ?? {},
  });
  let enviados = 0;
  await Promise.all(
    assinaturas.map(async (a) => {
      try {
        await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, {
          TTL: aviso.urgente ? 60 : 24 * 3600,
          urgency: aviso.urgente ? 'high' : 'normal',
          topic: aviso.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
        });
        enviados++;
        void prisma.pushAssinatura.update({ where: { id: a.id }, data: { ultimoUsoEm: new Date() } }).catch(() => undefined);
      } catch (e: any) {
        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushAssinatura.delete({ where: { id: a.id } }).catch(() => undefined);
        } else {
          console.warn('[chat/push] falha ao enviar aviso', status, String(e?.body || e?.message || e).slice(0, 200));
        }
      }
    }),
  );
  return enviados;
}
