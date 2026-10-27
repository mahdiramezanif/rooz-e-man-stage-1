/* فایل‌های ثابت برنامه برای اجرای آفلاین ذخیره می‌شوند؛ داده‌های خصوصی فقط در IndexedDB هستند. */
const CACHE_NAME = 'rooz-e-man-static-v3';
const FILES = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(FILES))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('rooz-e-man-static-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // در حالت آنلاین آخرین فایل‌ها دریافت می‌شوند؛ در حالت آفلاین نسخهٔ محلی اجرا می‌شود.
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        const toStore = event.request.mode === 'navigate' ? './index.html' : event.request;
        event.waitUntil(cache.put(toStore, response.clone()));
      }
      return response;
    } catch {
      return (await caches.match(event.request)) ||
        (event.request.mode === 'navigate' ? (await caches.match('./index.html')) : undefined) ||
        Response.error();
    }
  })());
});
