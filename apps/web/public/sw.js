/* MEU BLING — service worker: avisos do chat da equipe com o sistema fechado (Web Push).
   Não guarda nada em cache: o sistema continua sendo carregado sempre da rede. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { titulo: 'MEU BLING', corpo: event.data ? event.data.text() : '' };
  }
  const base = new URL(self.registration.scope).pathname.replace(/\/$/, '');
  const titulo = dados.titulo || 'MEU BLING';
  const opcoes = {
    body: dados.corpo || '',
    tag: dados.tag || undefined,
    renotify: !!dados.tag,
    requireInteraction: !!dados.urgente,
    vibrate: dados.urgente ? [300, 150, 300, 150, 300] : [120],
    icon: base + '/icone-192.png',
    badge: base + '/icone-192.png',
    data: { link: dados.link || base + '/chat', ...(dados.dados || {}) },
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const alvo = new URL(link, self.location.origin).href;
      for (const c of lista) {
        if ('focus' in c) {
          c.focus();
          if ('navigate' in c) return c.navigate(alvo);
          return;
        }
      }
      return self.clients.openWindow(alvo);
    }),
  );
});
