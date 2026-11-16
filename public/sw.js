// Rinori Studio service worker.
// Keeps the Rinori "Opening the Studio" page on the visitor's device, so a returning visitor
// sees it (instead of Render's own "waking up" screen) while the free Render server wakes up.
// The page then waits for /healthz and loads what they asked for. It only handles page
// loads and the waking page's own logo: API calls, product images, health checks and
// everything else go straight to the network.
const CACHE = 'rinori-waking-v3';
const WAKING = '/waking.html';
const PRECACHE = [WAKING, '/assets/RINORI%20STUDIO%20logo.png'];
// A real page normally arrives well within this; longer usually means the server is asleep.
const WAIT_MS = 8000;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function wakingPage() {
  const cached = await caches.match(WAKING);
  return cached || new Response('<p>Opening the studio… please refresh in a moment.</p>', { headers: { 'Content-Type': 'text/html' } });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The logo on the waking page: from the device, so it shows while the server sleeps.
  if (req.mode !== 'navigate') {
    if (PRECACHE.includes(url.pathname)) event.respondWith(caches.match(url.pathname).then(hit => hit || fetch(req)));
    return;
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === WAKING) return;

  event.respondWith((async () => {
    // Cancel the request if it takes too long: a request left hanging makes the browser
    // hold every later load of the same page behind it (a reload loop).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), WAIT_MS);
    try {
      // redirect: 'manual' lets the browser follow any redirect itself, as for a normal page load.
      const res = await fetch(req.url, { signal: ctrl.signal, credentials: 'same-origin', redirect: 'manual', cache: 'no-store' });
      // Render's own "waking up" page is marked with this header: show ours instead.
      if (res.headers.has('x-render-routing')) return wakingPage();
      return res;
    } catch {
      return wakingPage(); // asleep (no answer in time) or offline
    } finally {
      clearTimeout(timer);
    }
  })());
});
