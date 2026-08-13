/* eslint-env serviceworker */
/**
 * Ingleezy service worker.
 *
 * Hand-rolled rather than generated, because what this app actually needs is
 * narrow and the rules matter more than the coverage:
 *
 *   - Never cache Supabase. Auth, the decks, and every AI call must hit the
 *     network or the learner sees another account's data or stale schedules.
 *     This is also what keeps the hermetic Playwright suite working, which
 *     answers every request from fixtures.
 *   - Hashed build assets are immutable, so cache-first is safe and makes a
 *     repeat visit instant.
 *   - Navigations are network-first with a cached shell fallback, so a new
 *     deploy is picked up immediately but the app still opens offline.
 *   - Audio is cache-first and capped. It's the heaviest thing the app fetches
 *     and the same clips are replayed constantly during review.
 *
 * Offline review already half-works without any of this: src/lib/reviewQueue.ts
 * queues ratings in localStorage and flushes on reconnect. Caching the shell and
 * the audio is what makes the rest of the session usable.
 */

const VERSION = 'v1';
const SHELL_CACHE = `ingleezy-shell-${VERSION}`;
const ASSET_CACHE = `ingleezy-assets-${VERSION}`;
const AUDIO_CACHE = `ingleezy-audio-${VERSION}`;

const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, AUDIO_CACHE];

/** Cached so the app opens offline. Everything else is filled in at runtime. */
const SHELL_URLS = ['/', '/manifest.webmanifest', '/favicon.png'];

/** Keep the audio cache from growing without bound on a long review streak. */
const MAX_AUDIO_ENTRIES = 300;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll rejects atomically, so one missing URL would leave no shell at
      // all. Add individually and tolerate misses.
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Anything that must never be served from cache. */
function isBypassed(url) {
  return (
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/storage/v1/object/sign') ||
    url.hostname.endsWith('.supabase.co') ||
    url.hostname.endsWith('.supabase.in') ||
    // Analytics and third-party embeds have their own caching and consent rules.
    url.hostname.includes('posthog') ||
    url.hostname.includes('youtube') ||
    url.hostname.includes('tiktok')
  );
}

/** Content-hashed build output: safe to serve from cache indefinitely. */
function isHashedAsset(url) {
  return url.origin === self.location.origin && /\/assets\/.+-[A-Za-z0-9_-]{8,}\.\w+$/.test(url.pathname);
}

function isAudio(request, url) {
  return (
    request.destination === 'audio' ||
    /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(url.pathname)
  );
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Oldest-first: caches preserve insertion order.
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

async function cacheFirst(request, cacheName, { trim } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Opaque responses (no-cors, e.g. cross-origin audio) have status 0; they're
  // still worth caching, but a real error page is not.
  if (response && (response.ok || response.type === 'opaque')) {
    await cache.put(request, response.clone());
    if (trim) void trimCache(cacheName, trim);
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      // The SPA serves the same shell for every route, so cache it under '/'
      // rather than per-path — otherwise every visited route stores a copy.
      await cache.put('/', response.clone());
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const cached = (await cache.match('/')) || (await cache.match(request));
    if (cached) return cached;
    throw new Error('offline and no cached shell');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isBypassed(url)) return;

  // Video is never served from Cache Storage. <video> playback relies on byte-
  // range requests and cache.match() answers with the whole file as a 200,
  // which Safari refuses to play. Let the HTTP cache handle it instead.
  if (request.destination === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isAudio(request, url)) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE, { trim: MAX_AUDIO_ENTRIES }));
  }
});

// ── Web push ────────────────────────────────────────────────────────────────
// Sent by the notify-due-reviews function. The payload is JSON; a push with no
// body still shows something rather than the browser's generic placeholder.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Ingleezy';
  const options = {
    body: payload.body || 'You have cards waiting.',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || 'ingleezy-reminder',
    // Replace rather than stack: three reminders in a tray is how an app gets
    // its notifications switched off.
    renotify: false,
    data: { url: payload.url || '/review' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/review';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab rather than opening a duplicate.
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
