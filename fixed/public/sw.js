/* 오프라인 캐시: 앱 화면은 네트워크 우선(새 버전 반영), 아이콘 등은 캐시 우선 */
const CACHE = 'footfixed-__BUILD__'; // 기존 앱(foot-arch-…)과 캐시 이름 분리
const ASSETS = ['./', './index.html', './manifest.webmanifest', './config.js', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('footfixed-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 운동 알람 푸시(F2.8.0): 서버(send-reminders)가 보낸 알림을 띄우고, 누르면 운동 화면을 연다
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data && e.data.text() }; }
  const title = d.title || '발 운동 시간이에요';
  e.waitUntil(self.registration.showNotification(title, { body: d.body || '오늘의 중재 운동을 해 주세요.', icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: d.tag || 'footarch-exercise', renotify: true, data: { url: d.url || './#/exercises' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#/exercises', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => { for (const w of ws) if (w.url.startsWith(self.registration.scope) && 'focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); } return clients.openWindow(url); }));
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const u = new URL(req.url);
  if (!u.pathname.includes('/fixed/')) return; // 고정촬영판 주소 밖(기존 앱)은 건드리지 않음
  if (u.pathname.includes('/admin/')) return;
  if (u.pathname.includes('/videos/') || req.headers.has('range') || req.destination === 'video') return; // 운동 영상은 브라우저가 직접(부분 요청) 받음 — 캐시하면 재생 오류 // 관리자 앱은 캐시하지 않음(항상 네트워크)
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
