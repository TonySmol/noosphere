// Service Worker for NOOmium PWA
// Version is passed via URL parameter ?v=<app-version> for cache-busting
const CACHE_NAME = 'noomium-v' + new URL(self.location).searchParams.get('v');

// Домены, которые НЕ должны перехватываться SW.
// Transformers.js и Nostr-tools сами управляют своим кэшем и CORS.
const CDN_HOSTS = ['cdn.jsdelivr.net', 'huggingface.co'];

// Install: immediately activate
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

// Activate: clean up old caches and take control
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Listen for skip-waiting message from main thread (App.Boot logic)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // 1. Pass-through для WebSocket и CDN.
  // SW не должен вмешиваться в загрузку ML-моделей и ESM-библиотек.
  if (
    url.protocol === 'ws:' || 
    url.protocol === 'wss:' || 
    CDN_HOSTS.includes(url.hostname)
  ) {
    return; // Network-only
  }

  // 2. Navigation (index.html): Cache-First.
  // Обеспечивает мгновенный старт приложения в offline.
  // Обновление происходит за счет смены CACHE_NAME при деплое.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        return cached || fetch(e.request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // 3. Local Assets (CSS, JS, fonts): Cache-First with Network fallback.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((res) => {
        // Кэшируем только same-origin успешные ответы (type === 'basic')
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Fallback на корень ТОЛЬКО для документов, не для ассетов
        if (e.request.destination === 'document') {
          return caches.match('/');
        }
        // Для картинок/шрифтов просто отдаем ошибку, чтобы браузер не сломался на HTML
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});
