// Bump this on any change to this file's caching behavior. Vite fingerprints
// build assets by content hash, so a stale cached index.html pointing at
// filenames from a previous deploy is a white-screen bug, not a cache hit —
// this SW must never let that happen.
const CACHE = 'fantastats-v2'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Network-first for navigations, so a visitor always gets the current
// index.html (and therefore the current build's asset filenames) whenever
// they're online; the cached copy is only a fallback for offline use.
// Everything else (hashed JS/CSS/image assets) is left to the network/HTTP
// cache untouched — their filename already changes on every build, so
// there's nothing here worth caching, and doing so risks serving assets
// that don't match whichever index.html ends up active.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
