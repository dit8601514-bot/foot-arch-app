/* 오프라인 캐시: 앱 화면은 네트워크 우선(새 버전 반영), 아이콘 등은 캐시 우선 */
const CACHE = 'foot-arch-__BUILD__';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './config.js', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('foot-arch-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const u = new URL(req.url);
  // 관리자 앱은 사용자 앱 캐시에 넣지 않는다(항상 네트워크)
  if (u.pathname.includes('/admin/')) return;
  // 고정촬영판(/fixed/)은 별도 앱 — 자기 서비스 워커가 처리
  if (u.pathname.includes('/fixed/')) return;
  // 서버 설정(config.js)은 바뀌면 바로 반영되도록 네트워크 우선
  if (u.pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req)));
    return;
  }
  // 새 버전 확인 파일은 캐시하지 않는다
  if (u.pathname.endsWith('/version.json')) { e.respondWith(fetch(req.url, { cache: 'no-store' })); return; }
  if (req.mode === 'navigate') {
    // 화면은 항상 서버의 최신본(브라우저 HTTP 캐시도 건너뜀). 오프라인이면 저장본
    e.respondWith(fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
