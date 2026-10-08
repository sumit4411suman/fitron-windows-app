// FITRON AI Trainer service worker: shows push reminders and opens the app when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'FITRON', {
    body: d.body || '',
    icon: '/trainer/assets/brand/fitron-mark-new.png',
    badge: '/trainer/assets/brand/fitron-mark-new.png',
    tag: d.tag || 'fitron',
    renotify: false,
    data: { url: d.url || '/trainer' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/trainer';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.indexOf('/trainer') !== -1 && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
