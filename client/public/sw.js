/**
 * BIS Platform Service Worker v1.0
 * Provides offline capability for LEX field agents with low bandwidth
 * Features: Cache-first for static assets, network-first for API, IndexedDB queue for mutations
 */

const CACHE_VERSION = 'bis-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const OFFLINE_QUEUE_DB = 'bis-offline-queue';
const OFFLINE_QUEUE_STORE = 'pending-submissions';

// Static assets to pre-cache
const PRECACHE_URLS = [
  '/',
  '/lex/submit',
  '/quickcheck',
  '/manifest.json',
];

// API routes to cache with network-first strategy
const API_CACHE_ROUTES = [
  '/api/trpc/lex.nigerianStates',
  '/api/trpc/lex.listAgencies',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache failed for some URLs:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ─── Activate ────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('bis-') && name !== STATIC_CACHE && name !== API_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET for API — queue mutations instead
  if (request.method !== 'GET' && url.pathname.startsWith('/api/trpc')) {
    event.respondWith(handleOfflineMutation(request));
    return;
  }

  // API routes: network-first with cache fallback
  if (url.pathname.startsWith('/api/trpc')) {
    event.respondWith(networkFirstWithCache(request, API_CACHE, 5000));
    return;
  }

  // Static assets: cache-first
  if (
    url.pathname.match(/\.(js|css|woff2?|png|jpg|svg|ico)$/) ||
    url.pathname === '/'
  ) {
    event.respondWith(cacheFirstWithNetwork(request, STATIC_CACHE));
    return;
  }

  // HTML navigation: network-first, fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    );
    return;
  }

  event.respondWith(fetch(request));
});

// ─── Background Sync ─────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'bis-offline-sync') {
    event.waitUntil(flushOfflineQueue());
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    if (event.data) payload = event.data.json();
  } catch {
    payload = { title: 'BIS Alert', body: event.data ? event.data.text() : 'New notification' };
  }

  const title = payload.title || 'BIS Platform';
  const isCritical = payload.tag === 'critical-alert';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon.ico',
    badge: '/favicon.ico',
    tag: payload.tag || 'bis-notification',
    data: { url: payload.url || '/', timestamp: Date.now() },
    vibrate: [200, 100, 200],
    requireInteraction: isCritical,
    actions: isCritical
      ? [{ action: 'view', title: 'View Alert' }, { action: 'dismiss', title: 'Dismiss' }]
      : [],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ─── Push Subscription Change ─────────────────────────────────────────────────
// Fired when the browser rotates the push subscription (key refresh).
// Re-registers the new subscription with the BIS server.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      })
      .then((subscription) => {
        const p256dhArray = new Uint8Array(subscription.getKey('p256dh'));
        const authArray = new Uint8Array(subscription.getKey('auth'));
        return fetch('/api/trpc/push.registerToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            json: {
              token: JSON.stringify(subscription),
              platform: 'webpush',
              p256dh: btoa(String.fromCharCode(...p256dhArray)),
              auth: btoa(String.fromCharCode(...authArray)),
              deviceLabel: 'Browser (auto-renewed)',
            },
          }),
        });
      })
  );
});

// ─── Message Handler ──────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_QUEUE_COUNT') {
    getOfflineQueueCount().then((count) => {
      event.ports[0].postMessage({ count });
    });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    clearTimeout(timeout);
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleOfflineMutation(request) {
  try {
    return await fetch(request.clone());
  } catch {
    // Network failed — queue the mutation
    const body = await request.clone().text();
    await queueOfflineMutation({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now(),
      id: crypto.randomUUID(),
    });
    // Register background sync
    try {
      await self.registration.sync.register('bis-offline-sync');
    } catch {
      // Background sync not supported
    }
    return new Response(
      JSON.stringify({ queued: true, message: 'Submission queued for sync when online' }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_QUEUE_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function queueOfflineMutation(mutation) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_QUEUE_STORE).put(mutation);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getOfflineQueueCount() {
  const db = await openOfflineDB();
  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_QUEUE_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(0);
  });
}

async function flushOfflineQueue() {
  const db = await openOfflineDB();
  const mutations = await new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
    const req = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });

  for (const mutation of mutations) {
    try {
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body,
      });
      if (response.ok || response.status < 500) {
        // Remove from queue on success or client error (4xx)
        await new Promise((resolve) => {
          const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
          tx.objectStore(OFFLINE_QUEUE_STORE).delete(mutation.id);
          tx.oncomplete = resolve;
        });
      }
    } catch {
      // Keep in queue — will retry on next sync
    }
  }

  // Notify all clients of sync completion
  const allClients = await clients.matchAll({ type: 'window' });
  allClients.forEach((client) => {
    client.postMessage({ type: 'SYNC_COMPLETE', synced: mutations.length });
  });
}
