'use strict';
/* ═════════════ AI Footarch 관리자 앱 (/admin) ═════════════
 * 사용자 앱과 주소·로그인 정보(세션)가 분리된 별도 앱이다. 권한은 서버(supabase/admin.sql의 RLS·함수)가 판단한다.
 * 관리자는 [선택] 연구 활용 동의자의 기록만 볼 수 있고, 동의하지 않은 사용자는 통계(인원·건수)에만 포함된다.
 */
const C = window.FootCore;
const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f1 = v => v == null || !isFinite(v) ? '—' : Number(v).toFixed(1), f2 = v => v == null || !isFinite(v) ? '—' : Number(v).toFixed(2);
const fmtDate = t => { const d = new Date(t); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const maskPhone = p => p ? String(p).replace(/^(\d{2,3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3') : '—';
const FOOT = { left: '왼발', right: '오른발' };
let toastT = null;
function toast(msg, err) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.toggle('err', !!err); t.style.display = ''; clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', 3500); }

// ───── 서버 호출(관리자 전용 세션) ─────
const Api = (() => {
  const LS = 'footarch.admin.session';
  let session = null; try { session = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { session = null; }
  const cfg = () => { const c = Object.assign({ emailDomain: 'users.footarch.app' }, window.FOOTARCH_CONFIG || {}); c.supabaseUrl = (c.supabaseUrl || '').replace(/\/+$/, ''); return c; };
  const configured = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);
  const save = s => { session = s; try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch (e) {} };
  async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const c = cfg(); if (!c.supabaseUrl) throw new Error('서버가 설정되지 않았습니다(config.js).');
    if (auth && session && Date.now() / 1000 > session.expires_at - 60) await refresh();
    let res;
    try { res = await fetch(c.supabaseUrl + path, { method, headers: Object.assign({ apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' }, auth && session ? { Authorization: 'Bearer ' + session.access_token } : {}, headers), body: body == null ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new Error('서버에 연결할 수 없습니다.'); }
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { message: txt }; }
    if (!res.ok) { const m = (j && (j.message || j.msg || j.error_description || j.error)) || `서버 오류(${res.status})`; const er = new Error(/invalid login|invalid_grant/i.test(m) ? '아이디 또는 비밀번호가 올바르지 않습니다.' : /not admin/i.test(m) ? '관리자 권한이 없습니다.' : m); er.status = res.status; throw er; }
    return j;
  }
  async function refresh() {
    const c = cfg(); const res = await fetch(c.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) }).catch(() => null);
    if (!res || !res.ok) { save(null); throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
    const j = await res.json(); save({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Date.now() / 1000 + (j.expires_in || 3600), user: j.user });
  }
  async function signIn(username, password) {
    const j = await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: `${username.toLowerCase()}@${cfg().emailDomain}`, password } });
    save({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Date.now() / 1000 + (j.expires_in || 3600), user: j.user });
    // 관리자 여부는 서버가 판단한다(앱에서 바꿀 수 없음)
    const ok = await call('/rest/v1/rpc/is_admin', { method: 'POST', body: {} }).catch(() => false);
    if (ok !== true) { await signOut(); throw new Error('이 계정은 관리자 권한이 없습니다. 관리자는 서버(SQL)에서만 지정할 수 있습니다.'); }
  }
  async function signOut() { try { await call('/auth/v1/logout', { method: 'POST' }); } catch (e) {} save(null); }
  const rpc = (fn, body) => call('/rest/v1/rpc/' + fn, { method: 'POST', body: body || {} });
  // 영상 파일 올리기(Supabase Storage): 진행률을 알 수 있게 XHR 사용
  function upload(bucket, path, file, onProgress) {
    return new Promise(async (resolve, reject) => {
      try { if (session && Date.now() / 1000 > session.expires_at - 60) await refresh(); } catch (e) { return reject(e); }
      const c = cfg(), x = new XMLHttpRequest();
      x.open('POST', `${c.supabaseUrl}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`);
      x.setRequestHeader('apikey', c.supabaseAnonKey); x.setRequestHeader('Authorization', 'Bearer ' + session.access_token);
      x.setRequestHeader('Content-Type', file.type || 'video/mp4'); x.setRequestHeader('x-upsert', 'true'); x.setRequestHeader('cache-control', '3600');
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      x.onload = () => { if (x.status >= 200 && x.status < 300) return resolve(); let m = ''; try { const j = JSON.parse(x.responseText); m = j.message || j.error || ''; } catch (e) { m = x.responseText; }
        reject(new Error(x.status === 413 || /exceeded|too large|size/i.test(m) ? '파일이 너무 큽니다(최대 50 MB). 영상을 줄여서 올려 주세요.' : /bucket not found/i.test(m) ? '영상 저장소가 없습니다. supabase/content.sql을 먼저 실행해 주세요.' : /mime|type/i.test(m) ? '지원하지 않는 파일 형식입니다(mp4·mov·webm).' : /row-level|unauthorized|403/i.test(m + x.status) ? '영상을 올릴 권한이 없습니다(관리자 계정·content.sql 확인).' : `올리기 실패(${x.status}) ${m}`)); };
      x.onerror = () => reject(new Error('서버에 연결할 수 없습니다.'));
      x.send(file);
    });
  }
  const publicUrl = (bucket, path) => `${cfg().supabaseUrl}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const removeFiles = (bucket, paths) => call(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: paths } });
  return { cfg, configured, call, rpc, signIn, signOut, upload, publicUrl, removeFiles, get loggedIn() { return !!session; }, get user() { return session && session.user; } };
})();

// ───── 데이터(연구 동의자 범위) ─────
const D = { profiles: [], exams: [], refs: [], models: [], stats: null, loaded: false };
async function loadAll(force) {
  if (D.loaded && !force) return;
  const [stats, profiles, exams, refs, models] = await Promise.all([
    Api.rpc('admin_stats'),
    Api.call('/rest/v1/profiles?select=id,username,name,phone,created_at,consent_research&order=created_at.desc'),
    Api.call('/rest/v1/exams?select=id,user_id,created_at,foot,data&order=created_at.desc&limit=5000'),
    Api.call('/rest/v1/reference_ndt?select=*'),
    Api.call('/rest/v1/calibration_models?select=id,version,active,created_at,data&order=version.desc')
  ]);
  // 서버 규칙상 본인 프로필도 읽히므로, 목록에는 연구 동의자만 남긴다
  Object.assign(D, { stats, profiles: (profiles || []).filter(p => p.consent_research), exams: exams || [], refs: refs || [], models: models || [], loaded: true });
}
// 기준값: 관리자가 입력한 임상 NDT가 우선, 없으면 사용자가 앱에서 직접 입력한 실측값(연구 동의자 기록에 포함)
const refOf = examId => D.refs.find(r => r.exam_id === examId) || (() => { const e = D.exams.find(x => x.id === examId), r = e && e.data && e.data.reference; return r && isFinite(r.ndtMm) ? { exam_id: examId, user_id: e.user_id, clinical_mm: r.ndtMm, source: 'user' } : null; })();
const userOf = id => D.profiles.find(p => p.id === id);
// 참여자 코드: 사용자 ID에서 만든 가명(내보내기·학습에 이름 대신 사용)
const pcode = id => 'P-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
function trainingRows() {
  const userRefs = D.exams.filter(e => !D.refs.some(r => r.exam_id === e.id)).map(e => refOf(e.id)).filter(Boolean); // 사용자가 직접 넣은 실측값도 학습에 포함
  return D.refs.concat(userRefs).map(r => { const e = D.exams.find(x => x.id === r.exam_id); const f = e && C.errorFeatures(e.data); return f ? { participantId: e.user_id, examId: e.id, f, ref: Number(r.clinical_mm) } : null; }).filter(Boolean);
}

// ───── 화면 ─────
const routes = {};
const route = (p, title, fn) => { routes[p] = { title, fn }; };
function topbar(cur) {
  $('#top').innerHTML = `<span class="logo">AI Footarch</span><span class="tag">관리자</span>
    ${Api.loggedIn ? `<nav>${[['dash', '대시보드'], ['users', '사용자·측정'], ['content', '운동 영상'], ['errors', '오차·신뢰도'], ['ai', 'AI 보정 모델'], ['export', '데이터 내보내기']].map(([k, l]) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}">${l}</a>`).join('')}</nav><button id="logout">로그아웃</button>` : ''}`;
  const lo = $('#logout'); if (lo) lo.onclick = async () => { await Api.signOut(); Object.assign(D, { loaded: false }); location.hash = '#/login'; };
}
async function render() {
  const h = location.hash.replace(/^#\/?/, '') || 'dash', [name, arg] = h.split('/');
  if (!Api.configured()) { topbar(); $('#view').innerHTML = '<div class="note warn">서버가 설정되지 않았습니다. 저장소의 public/config.js에 Supabase 주소와 공개 키를 넣어 주세요(supabase/README.md).</div>'; return; }
  if (!Api.loggedIn && name !== 'login') { location.hash = '#/login'; return; }
  const r = routes[name] || routes.dash; topbar(name); document.title = 'AI Footarch 관리자 · ' + r.title;
  const v = $('#view'); v.innerHTML = '<p class="muted">불러오는 중…</p>';
  try { await r.fn(v, arg); } catch (e) { v.innerHTML = `<div class="note bad">${esc(e.message)}</div>`; if (e.status === 401 || /만료/.test(e.message)) { await Api.signOut(); location.hash = '#/login'; } }
}
window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);

route('login', '로그인', async (v) => {
  v.innerHTML = `<div class="login"><div class="card"><h1>관리자 로그인</h1>
    <p class="small muted">사용자 앱과 별도의 관리자 화면입니다. 서버에서 관리자로 지정된 계정만 들어올 수 있습니다.</p>
    <label for="u">아이디</label><input id="u" autocomplete="username"><label for="p">비밀번호</label><input id="p" type="password" autocomplete="current-password">
    <button class="btn primary" id="go" style="width:100%">로그인</button><div id="msg"></div></div></div>`;
  const go = async () => { try { $('#go').disabled = true; await Api.signIn($('#u').value.trim(), $('#p').value); D.loaded = false; location.hash = '#/dash'; } catch (e) { $('#msg').innerHTML = `<div class="note bad">${esc(e.message)}</div>`; } finally { $('#go').disabled = false; } };
  $('#go').onclick = go; $('#p').onkeydown = e => { if (e.key === 'Enter') go(); };
});

route('dash', '대시보드', async (v) => {
  await loadAll(true);
  const s = D.stats || {}, cats = { normal: 0, mild: 0, moderate: 0, severe: 0 };
  for (const e of D.exams) { const k = e.data && e.data.category && e.data.category.key; if (k in cats) cats[k]++; }
  const tot = Object.values(cats).reduce((a, b) => a + b, 0) || 1, CL = { normal: '정상', mild: '경증', moderate: '중등도', severe: '중증' };
  const active = D.models.find(m => m.active), pairs = trainingRows();
  v.innerHTML = `<h1>대시보드</h1>
    <div class="grid">
      <div class="stat"><b>${s.users ?? '—'}</b><span>전체 가입자</span></div>
      <div class="stat"><b>${s.research_users ?? '—'}</b><span>연구 활용 동의자 (열람 가능)</span></div>
      <div class="stat"><b>${s.exams ?? '—'}</b><span>전체 측정 건수</span></div>
      <div class="stat"><b>${s.research_exams ?? '—'}</b><span>동의자 측정 건수</span></div>
      <div class="stat"><b>${s.references ?? '—'}</b><span>임상 NDT 기준값 입력</span></div>
      <div class="stat"><b>${active ? 'v' + active.version : '없음'}</b><span>배포 중인 AI 보정 모델</span></div>
    </div>
    <div class="card"><b>분류 분포 (동의자 측정)</b>
      ${Object.keys(cats).map(k => `<div class="row" style="margin-top:8px"><span style="width:60px">${CL[k]}</span><div class="grow"><div class="bar" style="width:${(cats[k] / tot * 100).toFixed(1)}%"></div></div><span style="width:70px;text-align:right">${cats[k]}건</span></div>`).join('')}
    </div>
    <div class="card"><b>AI 학습 준비</b><p class="small">임상 NDT 기준값이 있는 짝 자료 <b>${pairs.length}건</b>, 참여자 <b>${new Set(pairs.map(r => r.participantId)).size}명</b> (학습 최소 16건·8명).</p>
      <p class="small muted">기준값은 같은 사람·같은 발을 같은 날 전문가가 표준 NDT(자로 측정)로 잰 값입니다. "사용자·측정"에서 측정마다 입력합니다.</p></div>`;
});

route('users', '사용자·측정', async (v, arg) => {
  await loadAll(true);
  if (arg) return userDetail(v, arg);
  const cnt = id => D.exams.filter(e => e.user_id === id).length, rc = id => D.refs.filter(r => r.user_id === id).length;
  v.innerHTML = `<h1>사용자·측정</h1><p class="small muted">연구 활용에 동의한 사용자만 표시됩니다(${D.profiles.length}명). 동의하지 않은 사용자의 기록은 서버가 관리자에게 보내지 않습니다.</p>
    <div class="card scroll"><table><thead><tr><th>참여자 코드</th><th>아이디</th><th>이름</th><th>전화번호</th><th>가입일</th><th>측정</th><th>기준값</th><th></th></tr></thead><tbody>
    ${D.profiles.map(p => `<tr><td>${pcode(p.id)}</td><td>@${esc(p.username)}</td><td>${esc(p.name)}</td><td>${esc(maskPhone(p.phone))}</td><td>${fmtDate(p.created_at)}</td><td>${cnt(p.id)}</td><td>${rc(p.id)}</td><td><a class="btn sm" href="#/users/${p.id}">측정 보기</a></td></tr>`).join('') || '<tr><td colspan="8" class="muted">연구 동의자가 아직 없습니다.</td></tr>'}
    </tbody></table></div>`;
});
function userDetail(v, id) {
  const p = userOf(id); if (!p) { v.innerHTML = '<div class="note bad">사용자를 찾을 수 없거나 열람 권한이 없습니다.</div>'; return; }
  const ex = D.exams.filter(e => e.user_id === id);
  v.innerHTML = `<p><a href="#/users">← 사용자 목록</a></p><h1>${esc(p.name)} <span class="muted small">@${esc(p.username)} · ${pcode(p.id)}</span></h1>
    <div class="note small">임상 NDT: 같은 날 전문가가 표준 방법(앉은 자세와 선 자세에서 발배뼈거친면 높이를 자로 측정한 차이)으로 잰 값을 mm로 입력하세요. AI 오차 보정 학습의 정답으로 쓰입니다.</div>
    <div class="card scroll"><table><thead><tr><th>측정 시각</th><th>발</th><th>앱 NDT</th><th>바닥 기준 하강</th><th>분류</th><th>AI 보정</th><th>임상 NDT (mm)</th><th>측정자</th><th></th></tr></thead><tbody>
    ${ex.map(e => { const d = e.data || {}, c = d.comparison || {}, r = refOf(e.id); return `<tr data-id="${esc(e.id)}"><td>${fmtDate(e.created_at)}</td><td>${FOOT[e.foot] || '—'}</td><td>${f1(c.changeMm)} mm</td><td>${f1(c.floor && c.floor.dropMm)}</td><td>${d.category ? esc(d.category.label) : '—'}</td><td>${d.aiCorrection ? f1(d.aiCorrection.mm) + ' (v' + d.aiCorrection.version + ')' : '—'}</td>
      <td><input class="num" type="number" step="0.1" min="-5" max="40" value="${r ? esc(r.clinical_mm) : ''}" aria-label="임상 NDT mm"></td><td><input class="who" value="${r ? esc(r.measured_by || '') : ''}" aria-label="측정자" placeholder="이니셜"></td><td><button class="btn sm save">${r ? '수정' : '저장'}</button></td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">측정 기록이 없습니다.</td></tr>'}
    </tbody></table></div>`;
  $$('button.save', v).forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), examId = tr.dataset.id, val = parseFloat($('input.num', tr).value);
    if (!isFinite(val) || val < -5 || val > 40) return toast('임상 NDT를 -5~40 mm 사이 숫자로 입력해 주세요.', true);
    try {
      const row = { exam_id: examId, user_id: id, clinical_mm: val, measured_by: $('input.who', tr).value.trim() || null, measured_at: new Date().toISOString() };
      await Api.call('/rest/v1/reference_ndt?on_conflict=exam_id', { method: 'POST', body: [row], headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      const i = D.refs.findIndex(r => r.exam_id === examId); if (i >= 0) D.refs[i] = Object.assign(D.refs[i], row); else D.refs.push(row);
      b.textContent = '수정'; toast('임상 NDT 기준값을 저장했습니다.');
    } catch (e) { toast(e.message, true); }
  });
}

// Bland–Altman 그림(차이 vs 평균) — 점마다 실제 자료
function blandAltmanSvg(pairs, m) {
  if (!pairs.length) return '';
  const W = 640, H = 300, P = 44, mx = pairs.map(p => (p.ai + p.ref) / 2), dy = pairs.map(p => p.ai - p.ref);
  const x0 = Math.min(...mx) - 1, x1 = Math.max(...mx) + 1, lim = Math.max(2, ...dy.map(Math.abs), Math.abs(m.loaLow || 0), Math.abs(m.loaHigh || 0)) * 1.15;
  const X = x => P + (x - x0) / (x1 - x0) * (W - P - 16), Y = y => H / 2 - y / lim * (H / 2 - 24);
  const hl = (y, c, t) => `<line x1="${P}" x2="${W - 16}" y1="${Y(y)}" y2="${Y(y)}" stroke="${c}" stroke-dasharray="5 4"/><text x="${W - 18}" y="${Y(y) - 4}" font-size="11" text-anchor="end" fill="${c}">${t}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bland–Altman: 앱과 임상 NDT의 차이">
    <line x1="${P}" x2="${W - 16}" y1="${Y(0)}" y2="${Y(0)}" stroke="#C5D3EA"/>
    ${hl(m.me, '#1F5FE0', '평균 차이 ' + f2(m.me))}${m.loaLow != null ? hl(m.loaLow, '#B45309', '하한 ' + f2(m.loaLow)) + hl(m.loaHigh, '#B45309', '상한 ' + f2(m.loaHigh)) : ''}
    ${pairs.map((p, i) => `<circle cx="${X(mx[i]).toFixed(1)}" cy="${Y(dy[i]).toFixed(1)}" r="4" fill="#1F5FE0" fill-opacity=".7"/>`).join('')}
    <text x="${W / 2}" y="${H - 6}" font-size="12" text-anchor="middle" fill="#4F5F7E">두 측정의 평균 (mm)</text>
    <text x="12" y="${H / 2}" font-size="12" fill="#4F5F7E" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">앱 − 임상 (mm)</text></svg>`;
}
const metricsRow = (name, m) => `<tr><td>${name}</td><td>${m.n || 0}</td><td>${f2(m.me)}</td><td><b>${f2(m.mae)}</b></td><td>${f2(m.rmse)}</td><td>${m.loaLow != null ? f2(m.loaLow) + ' ~ ' + f2(m.loaHigh) : '—'}</td></tr>`;
const metricsHead = '<thead><tr><th>방법</th><th>n</th><th>평균 차이(ME)</th><th>평균 절대 오차(MAE)</th><th>RMSE</th><th>95% 일치 한계</th></tr></thead>';

route('errors', '오차 분석', async (v) => {
  await loadAll(true);
  const rows = trainingRows(), pairs = rows.map(r => ({ ai: r.f.ai, ref: r.ref })), m = C.errorMetrics(pairs);
  const am = D.models.find(x => x.active), corr = am ? rows.map(r => ({ ai: C.applyErrorModel(am.data, r.f), ref: r.ref })) : null;
  v.innerHTML = `<h1>오차 분석: 앱 NDT vs 임상 NDT</h1>
    ${pairs.length ? '' : '<div class="note warn">임상 NDT 기준값이 입력된 측정이 없습니다. "사용자·측정"에서 입력해 주세요.</div>'}
    <div class="card scroll"><table>${metricsHead}<tbody>${metricsRow('앱 측정값 그대로', m)}${corr ? metricsRow(`AI 보정 v${am.version} 적용(학습에 쓴 자료 포함 — 참고용)`, C.errorMetrics(corr)) : ''}</tbody></table>
      <p class="small muted">학습에 쓴 자료로 잰 보정 후 오차는 실제보다 좋게 나옵니다. 모델 성능은 "AI 보정 모델"의 교차검증 값을 보세요.</p></div>
    ${pairs.length ? `<div class="card"><b>Bland–Altman</b>${blandAltmanSvg(pairs, m)}</div>` : ''}
    ${reliabilityHtml(pairs)}`;
  bindReliability(v);
});

// ───── 논문용 신뢰도 리포트: 타당도(앱 vs 임상) + 검사-재검사(같은 사람·발·24시간 안) ─────
let REL = null;
function reliabilityHtml(pairs) {
  const val = C.reliabilityStats(pairs.map(p => ({ a: p.ref, b: p.ai })));
  const ex = D.exams.map(r => Object.assign({}, r.data || {}, { id: r.id, userId: r.user_id, foot: r.foot, createdAt: r.data && r.data.createdAt || Date.parse(r.created_at) }));
  const rp = C.retestPairs(ex, 24), rt = C.reliabilityStats(rp);
  REL = { val, rt, rp };
  const row = (name, r) => `<tr><td>${name}</td><td>${r.n}</td><td><b>${f2(r.icc)}</b> <span class="small muted">${r.level || ''}</span></td><td>${f2(r.bias)}</td><td>${r.loaLow != null ? f2(r.loaLow) + ' ~ ' + f2(r.loaHigh) : '—'}</td><td>${f2(r.sem)}</td><td>${f2(r.mdc95)}</td><td>${f2(r.r)}</td></tr>`;
  const sent = rt.n >= 2 ? `앱의 검사-재검사 신뢰도는 ICC(2,1) = ${f2(rt.icc)}(${rt.n}쌍)였고, 측정의 표준오차(SEM)는 ${f2(rt.sem)} mm, 최소 탐지 변화량(MDC95)은 ${f2(rt.mdc95)} mm였다.` : '';
  const sent2 = val.n >= 2 ? ` 임상 NDT와의 일치도는 ICC(2,1) = ${f2(val.icc)}, 평균 차이 ${f2(val.bias)} mm(95% 일치 한계 ${f2(val.loaLow)} ~ ${f2(val.loaHigh)} mm, n = ${val.n})였다.` : '';
  return `<h2>신뢰도 리포트 (논문용) <span class="badge b-info">NEW</span></h2>
    <div class="card scroll"><table><thead><tr><th>구분</th><th>n</th><th>ICC(2,1)</th><th>평균 차이</th><th>95% 일치 한계</th><th>SEM</th><th>MDC95</th><th>r</th></tr></thead><tbody>
      ${val.n >= 2 ? row('타당도: 앱 vs 임상 NDT', val) : '<tr><td>타당도: 앱 vs 임상 NDT</td><td colspan="7" class="muted">짝 2건 이상 필요</td></tr>'}
      ${rt.n >= 2 ? row('검사-재검사(24시간 안)', rt) : '<tr><td>검사-재검사(24시간 안)</td><td colspan="7" class="muted">같은 사람·같은 발을 하루 안에 두 번 잰 기록이 2쌍 이상 필요</td></tr>'}
    </tbody></table>
    <p class="small muted">ICC(2,1): 이원 무선효과·절대 일치·단일 측정. 해석(Koo & Li 2016): 0.5 미만 낮음 · 0.5–0.75 보통 · 0.75–0.9 좋음 · 0.9 초과 매우 좋음. SEM = 차이의 표준편차/√2, MDC95 = 1.96×√2×SEM. 단위 mm.</p>
    ${sent || sent2 ? `<p class="small"><b>논문 문장 초안</b><br><span id="relSent">${esc(sent + sent2)}</span></p>` : ''}
    <div class="row"><button class="btn" id="relCsv" ${val.n >= 2 || rt.n >= 2 ? '' : 'disabled'}>신뢰도 표 CSV 내려받기</button>${sent || sent2 ? '<button class="btn" id="relCopy">문장 복사</button>' : ''}</div></div>
    ${rt.n >= 2 ? `<div class="card"><b>검사-재검사 Bland–Altman</b>${blandAltmanSvg(rp.map(p => ({ ai: p.b, ref: p.a })), C.errorMetrics(rp.map(p => ({ ai: p.b, ref: p.a }))))}</div>` : ''}`;
}
function bindReliability(v) {
  const b = $('#relCsv', v); if (b) b.onclick = () => {
    const H = ['구분', 'n', 'ICC(2,1)', '해석', '평균차이_mm', 'LoA하한_mm', 'LoA상한_mm', 'SEM_mm', 'MDC95_mm', 'r'];
    const line = (k, r) => [k, r.n, r.icc, r.level, r.bias, r.loaLow, r.loaHigh, r.sem, r.mdc95, r.r].map(x => typeof x === 'number' ? x.toFixed(3) : x == null ? '' : x).join(',');
    const csv = '\ufeff' + [H.join(','), REL.val.n >= 2 ? line('타당도(앱vs임상)', REL.val) : '', REL.rt.n >= 2 ? line('검사-재검사(24h)', REL.rt) : ''].filter(Boolean).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'footarch-reliability.csv'; a.click();
  };
  const c = $('#relCopy', v); if (c) c.onclick = () => { navigator.clipboard.writeText($('#relSent', v).textContent).then(() => toast('복사했습니다.'), () => toast('복사하지 못했습니다.', true)); };
}

route('ai', 'AI 보정 모델', async (v) => {
  await loadAll(true);
  const rows = trainingRows(), nP = new Set(rows.map(r => r.participantId)).size;
  v.innerHTML = `<h1>AI 오차 보정 모델</h1>
    <div class="card small"><b>어떻게 동작하나요?</b>
      <p>앱이 재는 값 9가지(앱 NDT, 바닥 기준 하강, 앉은 자세 높이, 발활 각도 변화, 발 길이 변화, 촬영 거리, 발 기울기, 원근 왜곡, 스티커 부착 높이 오차)로 <b>임상 NDT를 예측</b>하는 모델을 학습합니다. 후보: 보정 없음 · 평균 차이 보정 · 선형 보정 · 다변량 릿지 회귀.</p>
      <p>성능은 <b>참여자 한 명씩 빼고 학습해 그 사람을 예측</b>하는 교차검증(LOPO)으로만 판단합니다. 보정 없음보다 평균 오차가 10% 이상 줄고, 참여자 재표집(2,000회) 95% 기준으로도 개선이 유지될 때만 배포를 권합니다.</p></div>
    <div class="card"><div class="row"><span class="grow">학습 자료: 짝 <b>${rows.length}건</b> · 참여자 <b>${nP}명</b> (최소 16건 · 8명)</span><button class="btn primary" id="train" ${rows.length ? '' : 'disabled'}>학습하기</button></div><div id="res"></div></div>
    <h2>모델 버전</h2>
    <div class="card scroll"><table><thead><tr><th>버전</th><th>방법</th><th>학습 자료</th><th>교차검증 MAE (보정 없음 → 보정)</th><th>예측 구간</th><th>상태</th><th></th></tr></thead><tbody>
    ${D.models.map(m => `<tr><td>v${m.version}</td><td>${esc(m.data.method)}</td><td>${m.data.n}건 · ${m.data.participants}명</td><td>${f2(m.data.baseMae)} → <b>${f2(m.data.cvMae)}</b> mm</td><td>±${f1(m.data.piMm)} mm</td><td>${m.active ? '<span class="badge b-good">배포 중</span>' : '<span class="badge">보관</span>'}</td><td>${m.active ? '<button class="btn sm danger" id="deact">배포 중지</button>' : `<button class="btn sm act" data-id="${esc(m.id)}">다시 배포</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">아직 모델이 없습니다.</td></tr>'}
    </tbody></table></div>`;
  $('#train', v).onclick = () => {
    const r = C.trainErrorModel(rows), out = $('#res', v);
    if (!r.ok) { out.innerHTML = `<div class="note warn">${esc(r.reason)}</div>`; return; }
    const NAME = { identity: '보정 없음', bias: '평균 차이 보정', linear: '선형 보정', ridge: '다변량 릿지 회귀' };
    out.innerHTML = `<div class="note ${r.improved ? 'good' : 'warn'}">${esc(r.recommendation)}</div>
      <div class="scroll"><table>${metricsHead}<tbody>${Object.entries(r.cv).map(([k, m]) => metricsRow(NAME[k] + (k === r.chosen ? ' ✓' : ''), m)).join('')}</tbody></table></div>
      ${r.gainCi ? `<p class="small">참여자 재표집 오차 감소: 평균 ${f2(r.gainCi.mean)} mm (95% 하한 ${f2(r.gainCi.low)} mm)</p>` : ''}
      ${r.weights.length ? `<p class="small"><b>영향이 큰 특징</b> (표준화 계수)</p>${r.weights.map(w => `<div class="row small"><span style="width:240px">${esc(w.label)}</span><div class="grow"><div class="bar" style="width:${Math.min(100, Math.abs(w.coef) / Math.abs(r.weights[0].coef || 1) * 100).toFixed(0)}%;background:${w.coef >= 0 ? '#1F5FE0' : '#B45309'}"></div></div><span style="width:60px;text-align:right">${w.coef >= 0 ? '+' : ''}${f2(w.coef)}</span></div>`).join('')}` : ''}
      <div class="row" style="margin-top:12px"><button class="btn primary" id="deploy" ${r.improved ? '' : 'disabled'}>이 모델 배포</button><span class="small muted">${r.improved ? '배포하면 사용자 앱 결과에 "AI 보정(임상 NDT 추정)"이 함께 표시됩니다.' : '개선이 확인되지 않아 배포할 수 없습니다.'}</span></div>`;
    const dep = $('#deploy', out); if (dep) dep.onclick = async () => {
      try {
        const version = (D.models.reduce((a, m) => Math.max(a, m.version), 0)) + 1, id = 'ndt-v' + version + '-' + Date.now().toString(36);
        await Api.call('/rest/v1/calibration_models', { method: 'POST', body: [{ id, version, data: r.model, active: false }], headers: { Prefer: 'return=minimal' } });
        await Api.rpc('activate_model', { model_id: id });
        toast(`AI 보정 모델 v${version}을 배포했습니다.`); D.loaded = false; render();
      } catch (e) { toast(e.message, true); }
    };
  };
  const de = $('#deact', v); if (de) de.onclick = async () => { try { await Api.rpc('deactivate_models'); toast('배포를 중지했습니다. 사용자 앱은 앱 측정값만 표시합니다.'); D.loaded = false; render(); } catch (e) { toast(e.message, true); } };
  $$('button.act', v).forEach(b => b.onclick = async () => { try { await Api.rpc('activate_model', { model_id: b.dataset.id }); toast('다시 배포했습니다.'); D.loaded = false; render(); } catch (e) { toast(e.message, true); } });
});

// ───── 운동(중재) 영상 관리 ─────
const CATS = C.EXERCISE_CATEGORIES, BUCKET = 'exercise-videos', MAXMB = 50;
const vidSrc = x => x.video_path ? Api.publicUrl(BUCKET, x.video_path) : (x.video_url || '');
const notReady = e => /exercise_content|relation .* does not exist|schema cache/i.test(e.message);
const SETUP = `<div class="note warn"><b>처음 한 번 서버 준비가 필요합니다.</b><br>Supabase → SQL Editor에서 저장소의 <code>supabase/content.sql</code> 내용을 붙여 넣고 Run 하세요(운동 표 + 영상 저장소가 만들어집니다).</div>`;
route('content', '운동 영상', async (v, arg) => {
  let rows;
  try { rows = await Api.call('/rest/v1/exercise_content?select=*&order=sort.asc,created_at.asc'); }
  catch (e) { if (notReady(e)) { v.innerHTML = `<h1>운동 영상</h1>${SETUP}`; return; } throw e; }
  rows = (rows || []).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
  if (arg) return contentEdit(v, arg === 'new' ? null : rows.find(r => r.id === arg), rows);
  const catLabel = k => (CATS.find(c => c[0] === k) || [k, k])[1];
  v.innerHTML = `<div class="row"><h1 class="grow">운동 영상 <span class="muted small">(중재 콘텐츠)</span></h1><a class="btn primary" href="#/content/new">+ 운동 추가</a></div>
    <p class="small muted">여기서 올린 운동과 영상은 <b>모든 사용자 앱</b>의 ‘발활 재활영상’과, 연결한 분류의 <b>측정 결과 화면</b>에 바로 나타납니다.</p>
    ${rows.length ? '' : `<div class="card"><b>아직 등록된 운동이 없습니다.</b><p class="small">기본 운동(짧은 발 운동·수건 당기기·발꿈치 들기)을 불러온 뒤 영상만 올려도 됩니다.</p><button class="btn" id="seed">기본 운동 3개 불러오기</button></div>`}
    <div class="card scroll"><table><tr><th>순서</th><th>운동</th><th>연결 분류</th><th>영상</th><th>공개</th><th></th></tr>
    ${rows.map(r => `<tr><td>${r.sort}</td><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.purpose || '')}</div></td>
      <td>${(r.categories || []).map(k => `<span class="badge">${esc(catLabel(k))}</span>`).join(' ') || '<span class="badge b-warn">연결 없음</span>'}</td>
      <td>${r.video_path ? '<span class="badge b-good">파일</span>' : r.video_url ? `<span class="badge b-good">${C.youtubeId(r.video_url) ? '유튜브' : '주소'}</span>` : '<span class="badge b-warn">영상 없음</span>'}</td>
      <td>${r.published ? '<span class="badge b-good">공개</span>' : '<span class="badge">숨김</span>'}</td>
      <td><a class="btn sm" href="#/content/${r.id}">편집</a></td></tr>`).join('')}</table></div>`;
  const sb = $('#seed'); if (sb) sb.onclick = async () => {
    sb.disabled = true;
    try {
      const body = C.EXERCISE_DRAFTS.map((d, i) => ({ id: crypto.randomUUID(), name: d.name, purpose: d.purpose || '', posture: d.posture || '', steps: d.steps || [], cautions: d.cautions || [], categories: i === 0 ? ['normal', 'mild', 'moderate', 'severe'] : i === 1 ? ['mild', 'moderate', 'severe'] : ['moderate', 'severe'], sort: (i + 1) * 10, published: true }));
      await Api.call('/rest/v1/exercise_content', { method: 'POST', body, headers: { Prefer: 'return=minimal' } }); toast('기본 운동을 불러왔습니다. 이제 영상을 올려 주세요.'); render();
    } catch (e) { toast(e.message, true); sb.disabled = false; }
  };
});
function contentEdit(v, x0, rows) {
  const isNew = !x0, x = Object.assign({ id: crypto.randomUUID(), name: '', purpose: '', posture: '', steps: [], cautions: [], reps: '', sets: '', hold_sec: '', per_week: '', source: '', categories: [], video_path: null, video_url: '', sort: ((rows.length ? Math.max(...rows.map(r => r.sort || 0)) : 0) + 10), published: true }, x0 || {});
  let file = null, removeVideo = false;
  const ta = (id, label, arr, ph) => `<label for="${id}">${label}</label><textarea id="${id}" rows="4" placeholder="${ph}" style="width:100%;font:inherit;padding:9px 11px;border:1.5px solid var(--line);border-radius:10px">${esc((arr || []).join('\n'))}</textarea>`;
  const inp = (id, label, val, ph, w) => `<div${w ? ` style="flex:${w}"` : ''}><label for="${id}">${label}</label><input id="${id}" value="${esc(val || '')}" placeholder="${ph || ''}" style="width:100%"></div>`;
  v.innerHTML = `<div class="row"><a class="btn sm" href="#/content">‹ 목록</a><h1 class="grow" style="margin:0">${isNew ? '운동 추가' : '운동 편집'}</h1></div>
    <div class="card"><h2 style="margin-top:0">1. 영상</h2>
      <div id="pv"></div>
      <div class="row" style="margin-top:10px"><label class="btn primary" for="vf" style="cursor:pointer">영상 파일 선택(mp4·mov)</label><input type="file" id="vf" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,.mp4,.mov,.m4v,.webm" style="display:none"><span class="small muted" id="fi">최대 ${MAXMB} MB · 가로 영상 권장</span></div>
      <div style="margin-top:12px"><label for="vu">또는 영상 주소(유튜브 링크 또는 mp4 주소)</label><input id="vu" style="width:100%" value="${esc(x.video_path ? '' : x.video_url || '')}" placeholder="https://youtu.be/… 또는 https://…/video.mp4"></div>
      <div id="prog" style="display:none;margin-top:10px"><div style="background:var(--line);border-radius:5px"><div class="bar" id="pb" style="width:0"></div></div><div class="small muted" id="pt"></div></div>
      ${x.video_path || x.video_url ? '<button class="btn sm" id="rmv" style="margin-top:10px">영상 빼기</button>' : ''}
    </div>
    <div class="card"><h2 style="margin-top:0">2. 운동 정보</h2>
      ${inp('nm', '운동 이름 *', x.name, '예: 짧은 발 운동(Short Foot Exercise)')}
      <div style="margin-top:10px">${inp('pu', '운동 목적', x.purpose, '예: 발바닥 내재근을 활성화하여 발활을 지지')}</div>
      <div style="margin-top:10px">${inp('po', '올바른 자세', x.posture, '예: 의자에 앉아 발바닥 전체를 바닥에 붙인다')}</div>
      <div style="margin-top:10px">${ta('st', '수행 방법(한 줄에 하나씩)', x.steps, '1단계\n2단계')}</div>
      <div style="margin-top:10px">${ta('ca', '주의사항(한 줄에 하나씩)', x.cautions, '통증이 있으면 중단한다')}</div>
      <div class="row" style="margin-top:10px">${inp('re', '반복 횟수(회)', x.reps, '10', 1)}${inp('se', '세트 수', x.sets, '3', 1)}${inp('ho', '유지 시간(초)', x.hold_sec, '5', 1)}${inp('pw', '주당 빈도(회/주)', x.per_week, '5', 1)}</div>
      <div style="margin-top:10px">${inp('so', '근거(논문·프로토콜)', x.source, '예: 연구 프로토콜 v1')}</div>
    </div>
    <div class="card"><h2 style="margin-top:0">3. 누구에게 보여 줄까요?</h2>
      <p class="small muted">측정 결과가 이 분류인 사용자의 결과 화면에 ‘운동 중재’로 나타납니다.</p>
      <div class="row">${CATS.map(([k, l]) => `<label style="font-size:15px;display:flex;gap:6px;align-items:center"><input type="checkbox" data-cat="${k}" ${x.categories.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="row" style="margin-top:12px"><div><label for="so2">표시 순서(작을수록 위)</label><input id="so2" class="num" type="number" value="${x.sort}"></div>
        <label style="font-size:15px;display:flex;gap:6px;align-items:center;margin-top:18px"><input type="checkbox" id="pub" ${x.published ? 'checked' : ''}> 사용자 앱에 공개</label></div>
    </div>
    <div class="row"><button class="btn primary" id="save" style="min-width:160px">저장</button><span class="grow"></span>${isNew ? '' : '<button class="btn" id="del" style="border-color:var(--bad);color:var(--bad)">삭제</button>'}</div>`;
  const paintPreview = () => {
    const u = file ? URL.createObjectURL(file) : removeVideo ? '' : ($('#vu').value.trim() || vidSrc(x)), yt = C.youtubeId(u);
    $('#pv').innerHTML = !u ? '<div class="note warn small">영상이 아직 없습니다. 파일을 고르거나 주소를 넣어 주세요.</div>'
      : yt ? `<div style="position:relative;aspect-ratio:16/9;max-width:560px"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px" allowfullscreen></iframe></div>`
      : `<video src="${esc(u)}" controls playsinline preload="metadata" style="width:100%;max-width:560px;border-radius:12px;background:#000"></video>`;
  };
  paintPreview();
  $('#vf').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > MAXMB * 1048576) { toast(`파일이 ${(f.size / 1048576).toFixed(0)} MB로 너무 큽니다(최대 ${MAXMB} MB). 휴대폰 사진 앱의 ‘편집 → 해상도 낮추기’나 압축 앱으로 줄여 주세요.`, true); e.target.value = ''; return; }
    file = f; removeVideo = false; $('#vu').value = ''; $('#fi').textContent = `${f.name} · ${(f.size / 1048576).toFixed(1)} MB (저장하면 올라갑니다)`; paintPreview();
  };
  $('#vu').oninput = () => { if ($('#vu').value.trim()) { file = null; $('#vf').value = ''; removeVideo = false; } paintPreview(); };
  const rmv = $('#rmv'); if (rmv) rmv.onclick = () => { removeVideo = true; file = null; $('#vu').value = ''; paintPreview(); };
  $('#save').onclick = async () => {
    const name = $('#nm').value.trim(); if (!name) return toast('운동 이름을 입력해 주세요.', true);
    const url = $('#vu').value.trim(); if (url && !/^https:\/\//i.test(url)) return toast('영상 주소는 https:// 로 시작해야 합니다.', true);
    const lines = id => $(id).value.split('\n').map(s2 => s2.trim()).filter(Boolean);
    const btn = $('#save'); btn.disabled = true;
    try {
      const oldPath = x.video_path; let video_path = removeVideo || url ? null : x.video_path, video_url = url || (removeVideo ? null : (x.video_path ? null : x.video_url || null));
      if (file) {
        const ext = (file.name.match(/\.(\w{2,4})$/) || [, 'mp4'])[1].toLowerCase();
        const path = `${x.id}/${Date.now()}.${ext}`;
        $('#prog').style.display = ''; $('#pt').textContent = '영상 올리는 중… 0%';
        await Api.upload(BUCKET, path, file, p => { $('#pb').style.width = Math.round(p * 100) + '%'; $('#pt').textContent = `영상 올리는 중… ${Math.round(p * 100)}%`; });
        $('#pt').textContent = '영상 올리기 완료'; video_path = path; video_url = null;
      }
      const row = { id: x.id, name, purpose: $('#pu').value.trim(), posture: $('#po').value.trim(), steps: lines('#st'), cautions: lines('#ca'), reps: $('#re').value.trim(), sets: $('#se').value.trim(), hold_sec: $('#ho').value.trim(), per_week: $('#pw').value.trim(), source: $('#so').value.trim(),
        categories: $$('[data-cat]').filter(c => c.checked).map(c => c.dataset.cat), sort: parseInt($('#so2').value, 10) || 100, published: $('#pub').checked, video_path, video_url, updated_at: new Date().toISOString() };
      await Api.call('/rest/v1/exercise_content?on_conflict=id', { method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      if (oldPath && oldPath !== video_path) await Api.removeFiles(BUCKET, [oldPath]).catch(() => {}); // 바뀐 영상의 옛 파일 정리
      toast('저장했습니다. 사용자 앱에 바로 반영됩니다.'); location.hash = '#/content';
    } catch (e) { toast(notReady(e) ? 'supabase/content.sql을 먼저 실행해 주세요.' : e.message, true); btn.disabled = false; }
  };
  const del = $('#del'); if (del) del.onclick = async () => {
    if (!confirm(`‘${x.name}’ 운동과 영상을 삭제할까요? 사용자 앱에서도 사라집니다.`)) return;
    try { await Api.call(`/rest/v1/exercise_content?id=eq.${x.id}`, { method: 'DELETE' }); if (x.video_path) await Api.removeFiles(BUCKET, [x.video_path]).catch(() => {}); toast('삭제했습니다.'); location.hash = '#/content'; }
    catch (e) { toast(e.message, true); }
  };
}

route('export', '데이터 내보내기', async (v) => {
  await loadAll(true);
  v.innerHTML = `<h1>데이터 내보내기</h1><div class="card"><p class="small">연구 동의자의 측정값을 <b>가명(참여자 코드)</b>으로 내보냅니다. 이름·아이디·전화번호는 포함하지 않습니다.</p>
    <button class="btn primary" id="csv">CSV 내려받기 (${D.exams.length}건)</button></div>`;
  $('#csv', v).onclick = () => {
    const keys = C.AI_FEATURES.map(f => f.key);
    const head = ['participant', 'exam_id', 'measured_at', 'foot', 'category', ...keys, 'clinical_ndt_mm', 'ai_corrected_mm', 'ai_model_version'];
    const lines = [head.join(',')].concat(D.exams.map(e => { const f = C.errorFeatures(e.data) || {}, r = refOf(e.id), d = e.data || {}; return [pcode(e.user_id), e.id, e.created_at, e.foot || '', d.category ? d.category.key : '', ...keys.map(k => f[k] == null ? '' : Number(f[k]).toFixed(3)), r ? r.clinical_mm : '', d.aiCorrection ? Number(d.aiCorrection.mm).toFixed(2) : '', d.aiCorrection ? d.aiCorrection.version : ''].map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(','); }));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = `footarch-research-${Date.now()}.csv`; a.click();
  };
});
