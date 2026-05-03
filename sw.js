const CACHE_NAME = 'apsny-guide-v7';

const PRECACHE_URLS = ['./index.html', './admin.html', './media-store.js', './manifest.json', './sw.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Не кешируем auth-эндпоинты с персональными данными.
  if (url.pathname.startsWith('/api/auth/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503 })),
    );
    return;
  }

  // Данные каталога: сеть -> кеш, офлайн -> кеш.
  if (url.pathname === '/api/tours' || url.pathname === '/api/hotels' || url.pathname === '/api/health') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const net = await fetch(req);
        if (net && net.ok) await cache.put(req, net.clone());
        return net;
      } catch (_) {
        const cached = await cache.match(req);
        return cached || new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
      }
    })());
    return;
  }

  // Медиа: сначала кеш, если нет — загрузить и сохранить.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const net = await fetch(req);
        if (net && net.ok) await cache.put(req, net.clone());
        return net;
      } catch (_) {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Статика: кеш-first + фоновое обновление.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const networkPromise = fetch(req)
      .then((res) => {
        if (sameOrigin && res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);

    if (cached) return cached;
    const net = await networkPromise;
    return net || new Response('offline', { status: 503 });
  })());
});
