// Offline support. App files: network first (so updates arrive), cache as fallback.
// The large model + WebAssembly files: cache first (they never change for a given version).

const VERSION = 'v11';
const SHELL = `crux-shell-${VERSION}`;
const HEAVY = `crux-heavy-${VERSION}`;
const SHELL_FILES = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js', 'js/metrics.js', 'js/camera.js', 'js/refine.js', 'js/outcome.js', 'js/falladvice.js', 'js/fallview.js', 'js/labels.js', 'js/timeline.js', 'js/coach.js', 'js/pose.js', 'js/player.js',
  'js/report.js', 'js/progress.js', 'js/charts.js', 'js/storage.js', 'js/grades.js',
  'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== HEAVY).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (/\/(vendor|models)\//.test(url.pathname)) {
    e.respondWith(caches.open(HEAVY).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
