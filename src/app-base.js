'use strict';
/* ═════════════ 기본: 저장소 · 상태 · 유틸 · 라우터 ═════════════ */
const C = window.FootCore;
const APP_VERSION = '2.6.1';
const STORES = ['settings', 'exams', 'exercises', 'logs', 'errors', 'models', 'blobs', 'validations'];

const DB = (() => {
  let dbp = null, memory = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('이 브라우저는 IndexedDB를 지원하지 않습니다.'));
      let req;
      try { req = indexedDB.open('foot-arch-app', 1); } catch (e) { return rej(e); }
      req.onupgradeneeded = () => { const d = req.result; for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('저장소를 열 수 없습니다.'));
    }).catch(e => { memory = Object.fromEntries(STORES.map(s => [s, new Map()])); DB.persistentFailed = e.message; return null; });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    if (!d) { return fn(null, memory[store]); }
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), st = t.objectStore(store);
      let out; const r = fn(st);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error || new Error('저장 실패'));
      t.onabort = () => rej(t.error || new Error('저장이 중단되었습니다(저장 공간 부족 가능).'));
    });
  }
  const api = {
    persistentFailed: null,
    get: (s, k) => tx(s, 'readonly', (st, m) => st ? st.get(k) : m.get(k)),
    all: (s) => tx(s, 'readonly', (st, m) => st ? st.getAll() : [...m.values()]).then(r => r || []),
    put: (s, v) => tx(s, 'readwrite', (st, m) => st ? st.put(v) : m.set(v.id, v)),
    del: (s, k) => tx(s, 'readwrite', (st, m) => st ? st.delete(k) : m.delete(k)),
    clear: (s) => tx(s, 'readwrite', (st, m) => st ? st.clear() : m.clear()),
    ready: open
  };
  return api;
})();

// 저장 실패를 사용자에게 알리는 래퍼
async function save(store, obj) {
  try { await DB.put(store, obj); return true; }
  catch (e) { toast('데이터 저장 실패: ' + (e.message || e) + ' — 저장 공간을 확인하고 다시 시도해 주세요.', true); return false; }
}

const DEFAULT_SETTINGS = {
  id: 'app', participantId: '', savePhotos: false, privacyAck: false, shutterDelay: 10, postMode: 'timer',
  stickerDiameterMm: 16, diameterSource: 'spec', validation: null, researcherPinHash: null, // 실제 스티커 지름 16 mm(사용 스티커 규격)
  activeModelId: null, mapping: { normal: [], mild: [], moderate: [], severe: [] }, seeded: false
};
const S = { settings: null, exam: null, researcherUnlocked: false, stream: null, loopTimer: null };

async function loadSettings() {
  let s = null;
  try { s = await DB.get('settings', 'app'); } catch (e) { /* 메모리 폴백 */ }
  S.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
  // 이전 버전에서 지름이 비어 있던 기기: 사용 스티커 규격(16 mm)으로 채운다
  if (!(S.settings.stickerDiameterMm > 0)) { S.settings.stickerDiameterMm = 16; S.settings.diameterSource = 'spec'; }
  S.settings.mapping = Object.assign({ normal: [], mild: [], moderate: [], severe: [] }, S.settings.mapping);
  if (!S.settings.seeded) await seedContent();
}
async function saveSettings() { return save('settings', S.settings); }

// 초기 운동 콘텐츠: 이름·일반 설명만 초안으로 제공, 처방 수치·영상은 비워둔다(연구 프로토콜 입력 필요)
async function seedContent() {
  const drafts = [
    { name: '짧은 발 운동(Short Foot Exercise)', purpose: '발바닥 내재근을 활성화하여 내측 종아치 지지를 돕는 운동', posture: '의자에 앉아 발바닥 전체를 바닥에 붙이고 발가락은 편안하게 둔다.', steps: ['발가락을 구부리지 않은 채 엄지발가락 뿌리(제1중족골두)를 발꿈치 쪽으로 끌어당기듯 힘을 준다.', '아치가 살짝 높아지는 것을 확인하고 그 상태를 유지한다.', '천천히 힘을 풀고 처음 자세로 돌아온다.'], cautions: ['발가락을 말아 쥐지 않는다.', '통증이 생기면 즉시 중단한다.'] },
    { name: '수건 당기기(Towel Curl)', purpose: '발가락 굽힘근 사용을 연습하는 운동', posture: '의자에 앉아 발 아래 수건을 펼쳐 둔다.', steps: ['발꿈치를 바닥에 고정한다.', '발가락으로 수건을 움켜쥐어 몸쪽으로 끌어당긴다.', '수건을 다시 펴고 반복한다.'], cautions: ['미끄러운 바닥에서는 시행하지 않는다.', '발가락 경련이 생기면 쉬었다가 진행한다.'] },
    { name: '발꿈치 들기(Heel Raise)', purpose: '종아리 근육과 발목 주변 근육을 강화하는 운동', posture: '벽이나 의자를 잡고 양발을 골반 너비로 벌려 선다.', steps: ['체중을 엄지발가락 쪽에 고르게 싣고 발꿈치를 천천히 들어 올린다.', '꼭대기에서 잠시 멈춘다.', '천천히 발꿈치를 내린다.'], cautions: ['균형이 불안하면 반드시 지지물을 잡는다.', '발목이 바깥으로 꺾이지 않게 한다.'] }
  ];
  for (const d of drafts) await save('exercises', Object.assign({ id: uid(), reps: '', sets: '', holdSec: '', perWeek: '', source: '', reviewed: false, videoBlobId: null, videoUrl: '', draft: true, createdAt: Date.now() }, d));
  S.settings.seeded = true; await saveSettings();
}

// ───── 유틸 ─────
function uid() { return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
function fmtDate(ts, withTime) { const d = new Date(ts); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}` + (withTime === false ? '' : ` ${p(d.getHours())}:${p(d.getMinutes())}`); }
function mm(v, d) { return v == null || !isFinite(v) ? '—' : C.roundMm(v).toFixed(d == null ? 1 : d) + ' mm'; }
function px(v) { return v == null || !isFinite(v) ? '—' : v.toFixed(1) + ' px'; }
function pct(v) { return v == null || !isFinite(v) ? '—' : Math.round(v * 100) + '%'; }
const FOOT = { left: '왼발', right: '오른발' };
const PHASE = { pre: '체중부하 전', post: '체중부하 후' };
function catBadge(cat) {
  if (!cat) return '<span class="badge">분류 없음</span>';
  const cls = { normal: 'b-good', mild: 'b-warn', moderate: 'b-bad', severe: 'b-bad' }[cat.key];
  return `<span class="badge ${cls}">${esc(cat.label)}</span>`;
}
function statusBadge(st) {
  const cls = { '측정 가능': 'b-good', '보정 필요': 'b-warn', '재촬영 필요': 'b-warn', '측정 불가': 'b-bad' }[st] || '';
  return `<span class="badge ${cls}">${esc(st)}</span>`;
}
let toastTimer = null;
function toast(msg, err) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg; el.setAttribute('role', 'status');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), err ? 6000 : 2600);
}
function confirmModal(msg, okLabel, danger) {
  return new Promise(res => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p style="font-weight:600">${esc(msg)}</p><div class="grid2" style="margin-top:12px"><button class="btn" data-a="no">취소</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okLabel || '확인')}</button></div></div>`;
    bg.addEventListener('click', e => { const a = e.target.dataset.a; if (a || e.target === bg) { bg.remove(); res(a === 'ok'); } });
    document.body.appendChild(bg);
  });
}
function download(name, text, type) {
  const blob = text instanceof Blob ? text : new Blob([text], { type: type || 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function sha256(text) {
  if (crypto.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  let h = 5381; for (const ch of text) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return 'weak-' + h; // 보안 컨텍스트가 아닐 때의 약한 대체
}
function num(v) { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : NaN; }

// ───── 아이콘·일러스트 (인라인 SVG, 외부 리소스 없음) ─────
const ICON = (() => {
  const o = (d, extra) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra || ''}>${d}</svg>`;
  return {
    scan: o('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="10" r="2.5"/><path d="M8 16.5c.8-1.8 2.2-2.7 4-2.7s3.2.9 4 2.7"/>'),
    list: o('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 9h1M11 9h6M7 12h1M11 12h6M7 15h1M11 15h6"/>'),
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5z"/></svg>',
    playBox: o('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9v6l5-3z" fill="currentColor"/>'),
    bell: o('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
    gear: o('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
    chev: o('<path d="M9 5l7 7-7 7"/>'),
    user: o('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6"/>'),
    userPlus: o('<circle cx="10" cy="8" r="4"/><path d="M2 21c1.2-4 4.3-6 8-6 1.6 0 3 .4 4.2 1.1"/><path d="M19 14v6M16 17h6"/>'),
    phone: o('<path d="M5 3h3l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>'),
    idcard: o('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M6 16c.5-1.3 1.4-2 2.5-2s2 .7 2.5 2M14 10h4M14 13h4"/>'),
    lock: o('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>'),
    eye: o('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
    drop: o('<path d="M4 6h6M7 6v12M4 18h6"/><path d="M14 8c2 1.5 3 3.5 3 6"/><path d="M17 14l-2.5-1.5M17 14l1.5-2.5"/>'),
    height: o('<path d="M3 20h18"/><path d="M12 4v13M9 7l3-3 3 3M9 14l3 3 3-3"/>'),
    angle: o('<path d="M4 18h16"/><path d="M4 18 14 6"/><path d="M9 18a5 5 0 0 0-1.6-3.7"/>'),
    check: o('<path d="M20 6 9 17l-5-5"/>'),
    chart: o('<path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>'),
    calendar: o('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    logout: o('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>'),
    cloud: o('<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>'),
    mic: o('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    camera: o('<path d="M4 8h3l1.6-2.4A1.5 1.5 0 0 1 9.8 5h4.4a1.5 1.5 0 0 1 1.2.6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>'),
    rotate: o('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>'),
    stop: o('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    vol: o('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
    volOff: o('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M17 9l5 6M22 9l-5 6"/>'),
    listFill: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="3.5" fill="currentColor"/><path d="M7 9h1.2M10.5 9H17M7 12h1.2M10.5 12H17M7 15h1.2M10.5 15H17" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    playFill: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="3.5" fill="currentColor"/><path d="M10 8.6v6.8a.6.6 0 0 0 .9.5l5.4-3.4a.6.6 0 0 0 0-1L10.9 8.1a.6.6 0 0 0-.9.5z" fill="#fff"/></svg>'
  };
})();
// 두 발자국(시안의 파란 발 일러스트) — 그라데이션 채움
function footprintsSvg(id) {
  const g = 'fpg' + (id || '');
  const foot = (tx, flip) => `<g transform="translate(${tx},0) ${flip ? 'scale(-1,1)' : ''}">
    <path d="M18 34c-6 0-9 8-9 18 0 12 3 22 9 22s9-7 9-15c0-6-3-8-3-13 0-7 3-12-6-12z" fill="url(#${g})"/>
    <ellipse cx="24" cy="24" rx="4.2" ry="5" fill="url(#${g})"/><ellipse cx="15" cy="21" rx="3.2" ry="3.8" fill="url(#${g})"/>
    <ellipse cx="8.5" cy="23" rx="2.6" ry="3.2" fill="url(#${g})"/><ellipse cx="3.8" cy="27" rx="2.1" ry="2.6" fill="url(#${g})"/><ellipse cx="1" cy="32" rx="1.8" ry="2.2" fill="url(#${g})"/></g>`;
  return `<svg viewBox="-8 14 84 64" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb2ff"/><stop offset="1" stop-color="#2f74ec"/></linearGradient></defs>${foot(6, false)}${foot(62, true)}</svg>`;
}
function logoHtml(blue) { return `<span class="logo${blue ? ' blue' : ''}">AI Footarch<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="12" cy="15" rx="4.5" ry="7"/><circle cx="17.5" cy="5" r="2"/><circle cx="13" cy="3.2" r="1.6"/><circle cx="9" cy="3.8" r="1.4"/><circle cx="6" cy="6" r="1.2"/></svg></span>`; }

// ───── 라우터 ─────
const routes = {};
function route(pattern, title, fn, opts) { routes[pattern] = { title, fn, opts: opts || {} }; }
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
async function render() {
  if (!S.booted) return; // 초기화(저장소·설정) 전에 들어온 주소 변경은 무시 — 초기화 후 현재 주소로 그린다
  stopCamera();
  const h = location.hash.replace(/^#/, '') || '/home';
  const [path, query] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  let match = null, params = {};
  for (const pat of Object.keys(routes)) {
    const pp = pat.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const pr = {}; let ok = true;
    pp.forEach((seg, i) => { if (seg.startsWith(':')) pr[seg.slice(1)] = decodeURIComponent(parts[i]); else if (seg !== parts[i]) ok = false; });
    if (ok) { match = routes[pat]; params = pr; break; }
  }
  if (!match) { match = routes['/home']; }
  params.q = Object.fromEntries(new URLSearchParams(query || ''));
  if (match.opts.researcher && !S.researcherUnlocked) { location.hash = '#/r/login?next=' + encodeURIComponent(h); return; }
  // 서버가 설정되어 있으면 로그인(또는 '로그인 없이 둘러보기' 선택) 후 이용
  if (typeof Account !== 'undefined' && Account.configured() && !Account.loggedIn && !Account.isGuest() && parts[0] !== 'auth' && parts[0] !== 'r') { location.hash = '#/auth'; return; }
  document.body.dataset.route = parts[0] === 'self' && parts[1] === 'run' ? 'self-run' : (parts[0] || 'home');
  $('#title').textContent = match.title;
  // 화면마다 새 컨테이너를 쓴다: 늦게 끝난 이전 화면 그리기는 떨어져 나간 컨테이너에만 쓰므로 현재 화면을 덮지 않는다
  const main = $('#view'); main.innerHTML = ''; const view = document.createElement('div'); main.appendChild(view);
  view.innerHTML = '<p class="muted">불러오는 중…</p>';
  const tabOf = { guide: 'self', stickers: 'self', 'stickers-info': 'self', posture: 'self', capture: 'self', analyze: 'self', result: 'records', pair: 'records', exercise: 'exercises', logs: 'exercises', history: 'records', compare: 'records', manage: 'records' };
  $$('#tabs a').forEach(a => a.classList.toggle('on', (tabOf[parts[0]] || parts[0]) === a.dataset.tab));
  const noTabs = parts[0] === 'r' || parts[0] === 'capture' || (parts[0] === 'self' && parts[1] === 'run') || parts[0] === 'auth';
  $('#tabs').classList.toggle('hide', noTabs);
  // 홈·로그인은 상단 막대 없이 자체 머리 영역(시안 ①②)을 쓴다
  $('#topbar').classList.toggle('hide', !!match.opts.bare);
  try { await match.fn(view, params); } catch (e) { if (!view.isConnected) return; console.error(e); view.innerHTML = `<div class="note bad">화면을 표시하는 중 오류가 발생했습니다: ${esc(e.message)}</div><a class="btn block" href="#/home">홈으로</a>`; }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', async () => {
  $('#backBtn').onclick = () => history.length > 1 ? history.back() : go('#/home');
  $('#homeBtn').onclick = () => go('#/settings');
  await DB.ready(); await loadSettings(); S.booted = true;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSW();
  render();
});

// 홈 화면 설치·오프라인용 서비스 워커 (HTTPS 배포 주소에서만; 미리보기 등 샌드박스에서는 조용히 건너뜀)
function registerSW() {
  try {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
    let had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdateBar(); had = true; });
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (e) { /* 지원 안 함 */ }
}
function showUpdateBar() {
  if ($('#updBar')) return;
  const b = document.createElement('div'); b.id = 'updBar'; b.className = 'toast'; b.style.bottom = '140px';
  b.innerHTML = '새 버전이 설치되었습니다. <button class="btn sm" style="margin-left:8px">새로고침</button>';
  b.querySelector('button').onclick = () => location.reload(); document.body.appendChild(b);
}
// 설치 안내: 안드로이드 Chrome은 설치 버튼, iOS는 공유 → 홈 화면에 추가
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (location.hash.startsWith('#/home') || !location.hash) render(); });
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }

/* ═════════════ 차트 (실제 저장 데이터만 사용) ═════════════ */
function setupCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w: r.width, h: r.height };
}
function niceRange(lo, hi) { if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.1; return [lo - pad, hi + pad]; }
function attachTip(cv, hits) {
  let tip = null;
  const move = e => {
    const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    let best = null, bd = 24;
    for (const h of hits) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
    if (!best) { tip && tip.remove(); tip = null; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; document.body.appendChild(tip); }
    tip.textContent = best.label; tip.style.left = Math.min(window.innerWidth - 200, r.left + best.x + 10) + 'px'; tip.style.top = (r.top + best.y - 34) + 'px';
  };
  cv.addEventListener('mousemove', move); cv.addEventListener('touchstart', move, { passive: true });
  cv.addEventListener('mouseleave', () => { tip && tip.remove(); tip = null; });
}
// series: [{name,color,points:[{x(ts),y,label}]}]
function lineChart(cv, series, opts) {
  const { g, w, h } = setupCanvas(cv); const o = Object.assign({ yLabel: '' }, opts);
  const all = series.flatMap(s => s.points); if (!all.length) return;
  const L = 44, R = 12, T = 12, B = 30;
  let [x0, x1] = [Math.min(...all.map(p => p.x)), Math.max(...all.map(p => p.x))]; if (x0 === x1) { x0 -= 86400000; x1 += 86400000; }
  let [y0, y1] = niceRange(Math.min(0, ...all.map(p => p.y)), Math.max(...all.map(p => p.y)));
  if (o.yMin != null) y0 = o.yMin;
  const X = v => L + (v - x0) / (x1 - x0) * (w - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
  g.font = '11px system-ui'; g.fillStyle = '#738385'; g.strokeStyle = '#e6eaeb'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(v.toFixed(1), 4, y + 4); }
  (o.bands || []).forEach(b => { if (b.y >= y0 && b.y <= y1) { g.setLineDash([4, 4]); g.strokeStyle = '#b8c2c4'; g.beginPath(); g.moveTo(L, Y(b.y)); g.lineTo(w - R, Y(b.y)); g.stroke(); g.setLineDash([]); g.fillText(b.label, w - R - g.measureText(b.label).width, Y(b.y) - 3); } });
  g.fillText(fmtDate(x0, false), L, h - 8); const e = fmtDate(x1, false); g.fillText(e, w - R - g.measureText(e).width, h - 8);
  const hits = [];
  for (const s of series) {
    const pts = s.points.slice().sort((a, b) => a.x - b.x);
    g.strokeStyle = s.color; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.stroke();
    for (const p of pts) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p.x), Y(p.y), 5.5, 0, 7); g.fill(); g.fillStyle = s.color; g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, 7); g.fill(); hits.push({ x: X(p.x), y: Y(p.y), label: `${s.name} · ${p.label}` }); }
  }
  attachTip(cv, hits);
}
function scatterChart(cv, pts, opts) {
  const { g, w, h } = setupCanvas(cv); const o = Object.assign({}, opts); if (!pts.length) return;
  const L = 44, R = 12, T = 12, B = 32;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let [x0, x1] = niceRange(Math.min(...xs, o.identity ? Math.min(...ys) : Infinity), Math.max(...xs, o.identity ? Math.max(...ys) : -Infinity));
  let [y0, y1] = o.identity ? [x0, x1] : niceRange(Math.min(...ys, ...(o.hlines || []).map(l => l.y)), Math.max(...ys, ...(o.hlines || []).map(l => l.y)));
  const X = v => L + (v - x0) / (x1 - x0) * (w - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (h - T - B);
  g.font = '11px system-ui'; g.fillStyle = '#738385'; g.strokeStyle = '#e6eaeb';
  for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(w - R, Y(v)); g.stroke(); g.fillText(v.toFixed(1), 4, Y(v) + 4); const xv = x0 + (x1 - x0) * i / 4; g.fillText(xv.toFixed(1), Math.min(w - 30, X(xv) - 10), h - 16); }
  g.fillText(o.xLabel || '', L, h - 2); g.save(); g.translate(10, T + 60); g.restore();
  if (o.identity) { g.strokeStyle = '#9aa7a9'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(x0), Y(x0)); g.lineTo(X(x1), Y(x1)); g.stroke(); g.setLineDash([]); }
  (o.hlines || []).forEach(l => { g.strokeStyle = l.color || '#9aa7a9'; g.setLineDash(l.dash ? [5, 4] : []); g.beginPath(); g.moveTo(L, Y(l.y)); g.lineTo(w - R, Y(l.y)); g.stroke(); g.setLineDash([]); g.fillStyle = '#4a5a5c'; g.fillText(l.label, w - R - g.measureText(l.label).width, Y(l.y) - 3); });
  const hits = [];
  for (const p of pts) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(p.x), Y(p.y), 5.5, 0, 7); g.fill(); g.fillStyle = p.color || '#2a78d6'; g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, 7); g.fill(); hits.push({ x: X(p.x), y: Y(p.y), label: p.label }); }
  attachTip(cv, hits);
}

/* ═════════════ 검출 실행기: Web Worker(가능 시) / 메인 스레드 폴백 ═════════════ */
const Detector = (() => {
  let w = null, ready = false, seq = 0, initP = null;
  const pending = new Map();
  const local = (img, opts, prev) => (prev && C.detectInRoi(img, prev, opts)) || C.detectStickers(img, opts);
  const main = 'self.onmessage=function(e){var m=e.data;if(m.ping){self.postMessage({id:m.id,pong:true});return;}try{var d=(m.prev&&FootCore.detectInRoi(m.img,m.prev,m.opts))||FootCore.detectStickers(m.img,m.opts);self.postMessage({id:m.id,det:d});}catch(err){self.postMessage({id:m.id,error:String(err&&err.message||err)});}};';
  function init() {
    if (initP) return initP;
    initP = new Promise(res => {
      try {
        const src = document.getElementById('core-script').textContent + '\n' + main;
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        w.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data.pong || e.data.det); };
        w.onerror = () => { ready = false; w = null; for (const p of pending.values()) p.rej(new Error('worker')); pending.clear(); res(false); };
        const t = setTimeout(() => { ready = false; res(false); }, 1500);
        pending.set(0, { res: () => { clearTimeout(t); ready = true; res(true); }, rej: () => res(false) }); w.postMessage({ id: 0, ping: true });
      } catch (e) { w = null; res(false); }
    });
    return initP;
  }
  // 워커가 응답 없이 죽는 경우(휴대폰 메모리 부족 등) 대비: 요청마다 제한 시간, 넘으면 워커를 새로 띄운다.
  // (응답이 영영 오지 않으면 추적 루프가 멈춰 촬영·음성 안내가 모두 끊긴다)
  function restart() {
    try { if (w) w.terminate(); } catch (e) {}
    w = null; ready = false; initP = null;
    for (const p of pending.values()) p.rej(new Error('worker restart')); pending.clear();
    init();
  }
  function run(img, opts, prev, timeoutMs) {
    if (!w || !ready) return Promise.resolve(local(img, opts, prev));
    return new Promise((res, rej) => {
      const id = ++seq;
      const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('검출 시간 초과')); restart(); } }, timeoutMs || 6000);
      pending.set(id, { res: v => { clearTimeout(t); res(v); }, rej: e => { clearTimeout(t); rej(e); } });
      try { w.postMessage({ id, img, opts, prev: prev ? slim(prev) : null }, [img.data.buffer]); }
      catch (e) { pending.delete(id); clearTimeout(t); res(local(img, opts, prev)); }
    });
  }
  const slim = d => ({ ok: d.ok, landmarks: d.landmarks, quality: { diameterPx: d.quality.diameterPx } });
  return { init, run, restart, _kill() { try { w.onmessage = null; w.terminate(); } catch (e) {} }, get usingWorker() { return ready; } }; // _kill: 시험용(응답 없이 죽는 워커 재현)
})();

/* ═════════════ 이미지 · 오버레이 ═════════════ */
// rot: 0 | 90 | 270 — 화면이 세로로 고정된 채 휴대폰을 가로로 눕혔을 때, 영상을 실제(가로) 방향으로 돌려서 분석한다.
//   90: 원본 (x,y) → (H−y, x) (시계 방향), 270: 원본 (x,y) → (y, W−x) (반시계 방향)
function imageDataFromSource(src, maxSide, rot) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  const k = Math.min(1, (maxSide || 1920) / Math.max(sw, sh));
  const w = Math.round(sw * k), h = Math.round(sh * k), turn = rot === 90 || rot === 270;
  const cv = document.createElement('canvas'); cv.width = turn ? h : w; cv.height = turn ? w : h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  if (rot === 90) { g.translate(h, 0); g.rotate(Math.PI / 2); } else if (rot === 180) { g.translate(w, h); g.rotate(Math.PI); } else if (rot === 270) { g.translate(0, w); g.rotate(-Math.PI / 2); }
  g.drawImage(src, 0, 0, w, h); g.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas: cv, img: g.getImageData(0, 0, cv.width, cv.height) };
}
// 검출 결과를 실제 이미지 위에 표시 (임의 위치 표시 없음 — 검출 좌표만 사용)
function drawOverlay(g, det, sx, sy, ox, oy) {
  sx = sx || 1; sy = sy || sx; ox = ox || 0; oy = oy || 0;
  const T = p => [ox + p.x * sx, oy + p.y * sy];
  g.lineWidth = 2;
  for (const c of det.stickers || []) { g.strokeStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.ellipse(ox + c.cx * sx, oy + c.cy * sy, c.major / 2 * sx + 3, c.major / 2 * sy + 3, 0, 0, 7); g.stroke(); }
  for (const c of det.rejected || []) if (c.area > 30) { g.strokeStyle = 'rgba(255,170,0,.95)'; g.setLineDash([4, 3]); g.strokeRect(ox + c.bbox[0] * sx, oy + c.bbox[1] * sy, c.bbox[2] * sx, c.bbox[3] * sy); g.setLineDash([]); }
  const lm = det.landmarks; if (!lm) return;
  const [a1, b1] = T(lm.P1), [a3, b3] = T(lm.P3), [a2, b2] = T(lm.P2);
  g.strokeStyle = '#ffd400'; g.lineWidth = 2; g.beginPath(); g.moveTo(a1, b1); g.lineTo(a3, b3); g.stroke();
  // 수선의 발
  const t = C.projectionT(lm.P2, lm.P1, lm.P3); const fx = lm.P1.x + (lm.P3.x - lm.P1.x) * t, fy = lm.P1.y + (lm.P3.y - lm.P1.y) * t;
  const [ff, fg] = T({ x: fx, y: fy });
  g.strokeStyle = '#00e5ff'; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(a2, b2); g.lineTo(ff, fg); g.stroke(); g.setLineDash([]);
  const labels = [['P1', a1, b1], ['P2', a2, b2], ['P3', a3, b3]];
  g.font = 'bold 15px system-ui';
  for (const [n, x, y] of labels) {
    g.fillStyle = '#ff2d55'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
    g.strokeStyle = '#ff2d55'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 9, y); g.lineTo(x + 9, y); g.moveTo(x, y - 9); g.lineTo(x, y + 9); g.stroke();
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x + 8, y - 26, 30, 19); g.fillStyle = '#fff'; g.fillText(n, x + 12, y - 11);
  }
}
async function blobFromCanvas(cv, q) { return new Promise(r => cv.toBlob(b => r(b), 'image/jpeg', q || 0.85)); }
