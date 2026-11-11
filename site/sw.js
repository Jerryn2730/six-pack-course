// Service worker for offline use (Task 5). No third-party code.
// Page: network first, falling back to the saved copy. Narration: saved copy first, then network (and keep it).
const PAGE = "spp-page-v1", AUDIO = "spp-audio-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGE).then((c) => c.addAll(["./", "manifest.webmanifest", "icon.svg"]).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/audio/")) {
    if (req.headers.has("range")) return; // let the browser handle partial requests itself
    e.respondWith(caches.open(AUDIO).then(async (c) => {
      const hit = await c.match(url.pathname.replace(/^.*\/audio\//, "audio/")) || await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(PAGE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match("./"))));
});
