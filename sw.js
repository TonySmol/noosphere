/**
 * Service Worker для PWA-приложения NOOmium.
 * Версия передаётся через URL-параметр ?v=<app-version> для cache-busting.
 *
 * @file sw.js
 * @version 1.0.2
 */

const APP_VERSION = '1.3.12'; // Обязательно должно совпадать с meta-тегом в index.html
const CACHE_NAME = 'noomium-v' + new URL(self.location).searchParams.get('v');

const CDN_HOSTS = ['cdn.jsdelivr.net', 'huggingface.co'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

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

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  if (
    url.protocol === 'ws:' ||
    url.protocol === 'wss:' ||
    CDN_HOSTS.includes(url.hostname)
  ) {
    return;
  }

  // Навигационные запросы: cache-first с fallback на офлайн-страницу
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        return cached || fetch(e.request).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          }
          return res;
        }).catch(() => {
          // Fallback при полном отсутствии сети и кэша
          return new Response(
            '<!DOCTYPE html>' +
            '<html lang="en">' +
            '<head>' +
              '<meta charset="UTF-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<title>Offline - NOOmium</title>' +
              '<style>' +
                'body{font-family:ui-sans-serif,-apple-system,sans-serif;display:flex;align-items:center;' +
                'justify-content:center;height:100vh;margin:0;background:#0b0b10;color:#ececf1;text-align:center;padding:20px;}' +
                'h1{font-size:24px;margin-bottom:12px;font-weight:600;}' +
                'p{color:#a0a0ae;font-size:15px;line-height:1.5;max-width:320px;margin:0 auto;}' +
              '</style>' +
            '</head>' +
            '<body>' +
              '<div>' +
                '<h1>No connection</h1>' +
                '<p>NOOmium requires an internet connection for the initial load. Please check your network and reload.</p>' +
              '</div>' +
            '</body>' +
            '</html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        });
      })
    );
    return;
  }

  // Локальные ассеты: cache-first с network-fallback
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        if (e.request.destination === 'document') {
          return caches.match('/');
        }
        return new Response('', { status: 408, statusText: 'Offline' });
      });
    })
  );
});
