/**
 * Service Worker для «Кора» (PWA Wave 2).
 *
 * Стратегии кэширования:
 *  - cache-first   : /_next/static/*  (immutable build-assets с хэшами)
 *  - cache-first   : /icons/*         (PWA-иконки)
 *  - network-first : /api/*           (always fresh, fallback на cache при offline)
 *  - stale-while-revalidate : images  (jpg/png/svg/webp вне _next/static)
 *  - network-first : всё остальное (HTML/RSC)
 *
 * Web Push:
 *  - push           : показывает уведомление с title/body/url из payload
 *  - notificationclick : фокус существующего таба или открытие data.url
 *
 * Версионируем кэши через CACHE_VERSION — при изменении бампаем и старые
 * кэши удаляются в activate.
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `kora-static-${CACHE_VERSION}`;
const API_CACHE = `kora-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `kora-images-${CACHE_VERSION}`;
const RUNTIME_CACHE = `kora-runtime-${CACHE_VERSION}`;

const ALL_CACHES = [STATIC_CACHE, API_CACHE, IMAGE_CACHE, RUNTIME_CACHE];

self.addEventListener('install', (event) => {
  // Без precache — на MVP всё кэшируем on-demand через стратегии.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('kora-') && !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Кэшируем только GET, кросс-origin не трогаем
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Next.js HMR / dev — пропускаем
  if (url.pathname.startsWith('/_next/webpack-hmr')) return;

  // 1) Build-assets — cache-first (immutable)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 2) PWA icons — cache-first
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 3) API — network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // 4) Images — stale-while-revalidate
  if (/\.(?:png|jpe?g|webp|svg|gif|ico)$/i.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // 5) Всё остальное (HTML/RSC) — network-first с runtime-кэшем для offline
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || networkPromise;
}

// =========================
// Web Push
// =========================

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Кора', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Кора';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.svg',
    badge: payload.badge || '/icons/icon-192.svg',
    tag: payload.tag,
    data: {
      url: payload.url || '/',
      ...(payload.data || {}),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      // Если уже открыта вкладка приложения — сфокусировать её и перейти
      const sameOriginClient = allClients.find((c) =>
        c.url.startsWith(self.location.origin),
      );
      if (sameOriginClient) {
        await sameOriginClient.focus();
        if ('navigate' in sameOriginClient) {
          try {
            await sameOriginClient.navigate(targetUrl);
          } catch {
            // navigate() может отказать при cross-origin redirect — игнорируем
          }
        }
        return;
      }

      // Иначе — открыть новое окно
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
