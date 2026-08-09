// Service worker: tekee pelistä asennettavan ja pelattavan ilman verkkoa.
//
// Sivupyynnöt haetaan ensisijaisesti verkosta, jotta uusi julkaisu näkyy heti;
// muut tiedostot tarjoillaan välimuistista ja päivitetään taustalla.

const VERSION = 'monogolf-v2';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'src/main.js',
  'src/game.js',
  'src/physics.js',
  'src/world.js',
  'src/courses.js',
  'src/render.js',
  'src/sensors.js',
  'src/audio.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Sivu haetaan verkosta ensin, jotta päivitys ei jää välimuistiin jumiin.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
