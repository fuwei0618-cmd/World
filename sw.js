// World 離線快取：改版時把版本號 +1
const CACHE = "world-v1";
const CORE = ["./", "index.html", "app.js", "app.css", "presets.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (/api\.github\.com|api\.openai\.com|nominatim|tile\.openstreetmap/.test(u.host)) return;
  // 網路優先：有網路拿最新，沒網路用快取（旅途中離線也能看行程）
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && (u.origin === location.origin || /cdnjs|fonts\.(googleapis|gstatic)/.test(u.host))) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: u.pathname.endsWith(".html") || u.pathname.endsWith("/") })));
});
