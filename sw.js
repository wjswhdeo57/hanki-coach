// 앱 화면을 폰에 저장해 오프라인에서도 열리게 함 (AI 모델은 transformers.js가 별도로 캐시)
const V = 'hk-v2';
const SHELL = ['./', 'index.html', 'app.js', 'recognizer.js', 'foods.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== LIB && k.startsWith('hk-')).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const LIB = 'hk-lib-v1';
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // AI 엔진(transformers.js·wasm)은 버전 고정 URL이라 캐시 우선 → 오프라인에서도 인식 가능
  if (u.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(LIB).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))));
    return;
  }
  if (u.origin !== location.origin) return;
  // 네트워크 우선, 실패 시 캐시 (업데이트가 바로 반영되도록)
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); if (r.ok) caches.open(V).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
