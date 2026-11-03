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
  return { cfg, configured, call, rpc, signIn, signOut, get loggedIn() { return !!session; }, get user() { return session && session.user; } };
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
const refOf = examId => D.refs.find(r => r.exam_id === examId);
const userOf = id => D.profiles.find(p => p.id === id);
// 참여자 코드: 사용자 ID에서 만든 가명(내보내기·학습에 이름 대신 사용)
const pcode = id => 'P-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
function trainingRows() {
  return D.refs.map(r => { const e = D.exams.find(x => x.id === r.exam_id); const f = e && C.errorFeatures(e.data); return f ? { participantId: e.user_id, examId: e.id, f, ref: Number(r.clinical_mm) } : null; }).filter(Boolean);
}

// ───── 화면 ─────
const routes = {};
const route = (p, title, fn) => { routes[p] = { title, fn }; };
function topbar(cur) {
  $('#top').innerHTML = `<span class="logo">AI Footarch</span><span class="tag">관리자</span>
    ${Api.loggedIn ? `<nav>${[['dash', '대시보드'], ['users', '사용자·측정'], ['errors', '오차 분석'], ['ai', 'AI 보정 모델'], ['export', '데이터 내보내기']].map(([k, l]) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}">${l}</a>`).join('')}</nav><button id="logout">로그아웃</button>` : ''}`;
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
    <div class="note small">임상 NDT: 같은 날 전문가가 표준 방법(앉은 자세와 선 자세에서 발배뼈 결절 높이를 자로 측정한 차이)으로 잰 값을 mm로 입력하세요. AI 오차 보정 학습의 정답으로 쓰입니다.</div>
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
    ${pairs.length ? `<div class="card"><b>Bland–Altman</b>${blandAltmanSvg(pairs, m)}</div>` : ''}`;
});

route('ai', 'AI 보정 모델', async (v) => {
  await loadAll(true);
  const rows = trainingRows(), nP = new Set(rows.map(r => r.participantId)).size;
  v.innerHTML = `<h1>AI 오차 보정 모델</h1>
    <div class="card small"><b>어떻게 동작하나요?</b>
      <p>앱이 재는 값 9가지(앱 NDT, 바닥 기준 하강, 앉은 자세 높이, 아치 각도 변화, 발 길이 변화, 촬영 거리, 발 기울기, 원근 왜곡, 스티커 부착 높이 오차)로 <b>임상 NDT를 예측</b>하는 모델을 학습합니다. 후보: 보정 없음 · 평균 차이 보정 · 선형 보정 · 다변량 릿지 회귀.</p>
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
