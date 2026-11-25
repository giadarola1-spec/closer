self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Closer';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tag = typeof payload.tag === 'string' ? payload.tag : 'closer-notification';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : { channel: 'feed' };

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/padlock-192.png',
      badge: '/padlock-192.png',
      renotify: true,
      data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const channel = data.channel === 'messages' ? 'messages' : 'feed';
  const senderUid = typeof data.senderUid === 'string' ? data.senderUid : '';
  const targetSearch =
    channel === 'messages' && senderUid
      ? `?channel=messages&dm=${encodeURIComponent(senderUid)}`
      : `?channel=${encodeURIComponent(channel)}`;
  const targetUrl = new URL(`/${targetSearch}`, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            client.postMessage({
              type: 'NOTIFICATION_CLICK',
              payload: { channel, senderUid, postId: data.postId || null },
            });
            if ('focus' in client) {
              return client.focus();
            }
          }
        } catch {
          // Ignore malformed client URLs
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
