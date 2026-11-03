'use strict';
/* ═════════════ 계정·서버 동기화 (Supabase Auth + PostgREST, 외부 라이브러리 없이 fetch로 호출) ═════════════
 * 설정: config.js 의 window.FOOTARCH_CONFIG = { supabaseUrl, supabaseAnonKey, emailDomain }
 *       또는 연구자 모드에서 입력(이 기기에만 저장).
 * 아이디 로그인: Supabase는 이메일 기반이므로 "아이디@emailDomain" 형식의 내부 주소로 가입한다(메일은 보내지 않음, 이메일 확인 끔 필요).
 * 서버 테이블·보안 규칙: supabase/schema.sql
 */
const Account = (() => {
  const LS = 'footarch.session', GUEST = 'footarch.guest';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  let session = null; try { session = JSON.parse(ls.get(LS) || 'null'); } catch (e) { session = null; }
  function cfg() {
    const c = Object.assign({ emailDomain: 'users.footarch.app' }, window.FOOTARCH_CONFIG || {});
    if (S.settings && S.settings.serverUrl) { c.supabaseUrl = S.settings.serverUrl; c.supabaseAnonKey = S.settings.serverKey; }
    c.supabaseUrl = (c.supabaseUrl || '').replace(/\/+$/, '');
    return c;
  }
  const configured = () => { const c = cfg(); return !!(c.supabaseUrl && c.supabaseAnonKey); };
  const emailOf = u => `${u.toLowerCase()}@${cfg().emailDomain}`;
  function saveSession(sv) { session = sv; if (sv) ls.set(LS, JSON.stringify(sv)); else ls.del(LS); }
  function errMsg(j, status) {
    const m = (j && (j.msg || j.message || j.error_description || j.error)) || '';
    if (/already registered|already exists|duplicate/i.test(m)) return '이미 사용 중인 아이디입니다.';
    if (/invalid login|invalid_grant|Invalid login credentials/i.test(m)) return '아이디 또는 비밀번호가 올바르지 않습니다.';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return '비밀번호가 서버 기준보다 약합니다. 더 길게 입력해 주세요.';
    if (/email not confirmed/i.test(m)) return '서버에서 이메일 확인이 켜져 있습니다. 관리자가 Supabase에서 이메일 확인을 꺼야 합니다.';
    if (status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    return m || `서버 오류(${status})`;
  }
  async function call(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
    const c = cfg(); if (!c.supabaseUrl) throw new Error('서버가 설정되지 않았습니다.');
    if (auth && session && session.expires_at && Date.now() / 1000 > session.expires_at - 60) await refresh();
    let res;
    try {
      // 새 Supabase 공개 키(sb_publishable_…)는 JWT가 아니므로 Authorization에 넣으면 거부된다 → 로그인 토큰이 있을 때만 보낸다
      const hd = Object.assign({ apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' }, auth && session ? { Authorization: 'Bearer ' + session.access_token } : {}, headers);
      res = await fetch(c.supabaseUrl + path, { method, headers: hd, body: body == null ? undefined : JSON.stringify(body) });
    } catch (e) { const er = new Error('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.'); er.offline = true; throw er; }
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { message: txt }; }
    if (!res.ok) { const er = new Error(errMsg(j, res.status)); er.status = res.status; throw er; }
    return j;
  }
  function adopt(j) {
    if (!j || !j.access_token) throw new Error('로그인 세션을 받지 못했습니다. 서버의 이메일 확인 설정을 확인해 주세요.');
    saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user });
    ls.del(GUEST);
  }
  async function refresh() {
    if (!session || !session.refresh_token) return;
    const c = cfg();
    const res = await fetch(c.supabaseUrl + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) }).catch(() => null);
    if (!res) return; // 오프라인: 기존 토큰 유지(기기 안 기록은 계속 쓸 수 있음)
    if (!res.ok) { saveSession(null); throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.'); }
    adopt(await res.json());
  }
  // ───── 공개 API ─────
  async function signUp({ name, phone, username, password, consentPrivacy, consentSensitive, consentResearch }) {
    const now = new Date().toISOString();
    const j = await call('/auth/v1/signup', { method: 'POST', auth: false, body: { email: emailOf(username), password, data: { username: username.toLowerCase(), name, phone, consent_privacy_at: consentPrivacy ? now : null, consent_sensitive_at: consentSensitive ? now : null, consent_research: !!consentResearch } } });
    adopt(j.access_token ? j : (j.session || j));
    await clearOthers(user().id);
    return user();
  }
  async function signIn(username, password) {
    adopt(await call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: emailOf(username), password } }));
    await clearOthers(user().id);
    return user();
  }
  async function signOut() { try { await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* 오프라인이어도 기기에서는 로그아웃 */ } saveSession(null); }
  function user() {
    if (!session || !session.user) return null;
    const m = session.user.user_metadata || {};
    return { id: session.user.id, username: m.username || '', name: m.name || '', phone: m.phone || '', consentResearch: !!m.consent_research };
  }
  // ───── 동기화: 기기 → 서버 업로드(사진·영상 제외), 서버 → 기기 내려받기 ─────
  let syncing = null;
  async function sync(opts) {
    if (!configured() || !user()) return { skipped: true };
    if (syncing) return syncing;
    syncing = (async () => {
      const uid = user().id, out = { up: 0, down: 0 };
      for (const [store, table] of [['exams', 'exams'], ['logs', 'exercise_logs']]) {
        const all = await DB.all(store);
        const pending = all.filter(r => !r.isTest && (!r.ownerId || r.ownerId === uid) && (!r._syncedAt || (r.updatedAt || r.createdAt || r.date) > r._syncedAt));
        if (pending.length) {
          const rows = pending.map(r => { const d = Object.assign({}, r); delete d._syncedAt; return { id: r.id, created_at: new Date(r.createdAt || r.date).toISOString(), foot: r.foot || null, data: d }; });
          await call(`/rest/v1/${table}?on_conflict=id`, { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
          const t = Date.now(); for (const r of pending) { r.ownerId = uid; r._syncedAt = t; await DB.put(store, r); }
          out.up += pending.length;
        }
        const remote = await call(`/rest/v1/${table}?select=id,data&user_id=eq.${encodeURIComponent(uid)}&order=created_at.desc&limit=1000`);
        const have = new Set(all.map(r => r.id));
        for (const row of remote || []) if (!have.has(row.id)) { await DB.put(store, Object.assign({}, row.data, { ownerId: uid, _syncedAt: Date.now() })); out.down++; }
      }
      S.settings.lastSync = Date.now(); await saveSettings();
      return out;
    })().finally(() => { syncing = null; });
    return syncing;
  }
  // 저장 직후 백그라운드 동기화(실패해도 기기 안 기록은 그대로)
  function syncSoon() { if (configured() && user()) setTimeout(() => sync().catch(e => console.warn('sync', e.message)), 200); }
  async function deleteAccount() {
    await call('/rest/v1/exams?id=not.is.null', { method: 'DELETE' });
    await call('/rest/v1/exercise_logs?id=not.is.null', { method: 'DELETE' });
    await call('/rest/v1/rpc/delete_user', { method: 'POST', body: {} });
    saveSession(null);
  }
  async function removeRemote(store, id) { const table = store === 'logs' ? 'exercise_logs' : store; await call(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  // 다른 계정이 이 기기에서 올려 둔(이미 서버에 있는) 기록은 로그인 시 기기에서 치운다
  async function clearOthers(uid) { for (const st of ['exams', 'logs']) for (const r of await DB.all(st)) if (r.ownerId && r.ownerId !== uid && r._syncedAt) await DB.del(st, r.id); }
  async function pendingCount() { const u = user(); if (!u) return 0; let n = 0; for (const st of ['exams', 'logs']) n += (await DB.all(st)).filter(r => !r.isTest && !r._syncedAt).length; return n; }
  // ───── AI 오차 보정 모델: 관리자가 배포한(active) 모델 1개를 내려받아 이 기기에 보관 ─────
  const AIM = 'footarch.aimodel';
  function aiModel() { try { return JSON.parse(ls.get(AIM) || 'null'); } catch (e) { return null; } }
  async function fetchAiModel() {
    if (!configured()) return aiModel();
    try {
      const rows = await call('/rest/v1/calibration_models?select=id,version,data&active=eq.true&limit=1', { auth: !!user() });
      const m = rows && rows[0] ? { id: rows[0].id, version: rows[0].version, data: rows[0].data, fetchedAt: Date.now() } : null;
      if (m) ls.set(AIM, JSON.stringify(m)); else ls.del(AIM);
      return m;
    } catch (e) { return aiModel(); } // 오프라인: 마지막으로 받은 모델 사용
  }
  // ───── 운동(중재) 영상: 관리자가 서버에 올린 콘텐츠를 이 기기에 반영 ─────
  const videoPublicUrl = path => path ? cfg().supabaseUrl + '/storage/v1/object/public/exercise-videos/' + path.split('/').map(encodeURIComponent).join('/') : '';
  let contentAt = 0;
  async function syncContent(force) {
    if (!configured()) return { ok: false, reason: 'offline' };
    if (!force && Date.now() - contentAt < 20000) return { ok: true, cached: true };
    let rows;
    try { rows = await call('/rest/v1/exercise_content?select=*&published=eq.true&order=sort.asc,created_at.asc', { auth: !!user() }); }
    catch (e) { return { ok: false, reason: e.message }; } // 오프라인이면 마지막으로 받은 콘텐츠를 그대로 쓴다
    contentAt = Date.now();
    rows = (rows || []).filter(r => r.published !== false).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
    const local = await DB.all('exercises'), ids = new Set();
    for (const [i, r] of rows.entries()) {
      const id = 'srv-' + r.id; ids.add(id);
      const prev = local.find(x => x.id === id) || {};
      await save('exercises', Object.assign({}, prev, {
        id, server: true, serverId: r.id, order: i, name: r.name, purpose: r.purpose || '', posture: r.posture || '',
        steps: Array.isArray(r.steps) ? r.steps : [], cautions: Array.isArray(r.cautions) ? r.cautions : [],
        reps: r.reps || '', sets: r.sets || '', holdSec: r.hold_sec || '', perWeek: r.per_week || '', source: r.source || '',
        categories: r.categories || [], videoUrl: r.video_path ? videoPublicUrl(r.video_path) : (r.video_url || ''), videoBlobId: null,
        reviewed: true, draft: false, createdAt: prev.createdAt || Date.parse(r.created_at) || Date.now(), updatedAt: Date.parse(r.updated_at) || Date.now()
      }));
    }
    // 서버에서 지워졌거나 비공개로 바뀐 운동은 기기에서도 뺀다
    for (const x of local) if (x.server && !ids.has(x.id)) await DB.del('exercises', x.id);
    // 분류 연결: 관리자가 정한 분류를 그대로 반영(기기에서 만든 운동의 연결은 유지)
    const map = S.settings.mapping || {};
    for (const [k] of C.EXERCISE_CATEGORIES) map[k] = (map[k] || []).filter(id => !String(id).startsWith('srv-')).concat(rows.filter(r => (r.categories || []).includes(k)).map(r => 'srv-' + r.id));
    S.settings.mapping = map; S.settings.serverContent = rows.length > 0; await saveSettings();
    return { ok: true, n: rows.length };
  }
  return {
    aiModel, fetchAiModel, syncContent, videoPublicUrl,
    configured, user, signUp, signIn, signOut, sync, syncSoon, deleteAccount, pendingCount, cfg, removeRemote,
    isGuest: () => ls.get(GUEST) === '1', setGuest: v2 => v2 ? ls.set(GUEST, '1') : ls.del(GUEST),
    get loggedIn() { return !!user(); }
  };
})();

// ───── 화면: 로그인/회원가입 선택(시안 ②), 로그인, 회원가입(시안 ③) ─────
route('/auth', 'AI Footarch', async (v) => {
  v.innerHTML = `<div class="auth-hero">${logoHtml(true)}
    <p>건강한 발을 위한<br>AI 발 아치 분석 서비스</p><div class="feet">${footprintsSvg('h')}</div></div>
    ${Account.configured() ? '' : '<div class="note warn small">서버가 아직 연결되지 않아 로그인·회원가입을 쓸 수 없습니다. 관리자가 Supabase 주소를 설정해야 합니다. 그동안은 로그인 없이 이 기기에서만 쓸 수 있습니다.</div>'}
    <a class="btn primary block big" href="#/auth/login" ${Account.configured() ? '' : 'style="pointer-events:none;opacity:.45"'}>${ICON.user} 로그인</a>
    <a class="btn block big" href="#/auth/signup" ${Account.configured() ? '' : 'style="pointer-events:none;opacity:.45"'}>${ICON.userPlus} 회원가입</a>
    <button class="btn ghost block" id="guest">로그인 없이 둘러보기</button>
    <p class="tiny" style="text-align:center">로그인하지 않으면 기록이 이 기기에만 저장됩니다.</p>`;
  $('#guest', v).onclick = () => { Account.setGuest(true); go('#/home'); };
}, { bare: true });

const pwToggle = id => `<button type="button" class="trail" data-pw="${id}" aria-label="비밀번호 보기">${ICON.eye}</button>`;
function bindPw(root) { $$('[data-pw]', root).forEach(b => b.onclick = () => { const i = $('#' + b.dataset.pw, root); i.type = i.type === 'password' ? 'text' : 'password'; }); }
function busyBtn(b, on, label) { b.disabled = on; if (label) b.dataset.l = b.dataset.l || b.innerHTML; b.innerHTML = on ? '처리 중…' : (b.dataset.l || b.innerHTML); }

route('/auth/login', '로그인', async (v) => {
  v.innerHTML = `<form id="f" autocomplete="on">
    <div class="card">
      <div class="field">${ICON.idcard.replace('<svg', '<svg class="lead"')}<input id="un" placeholder="아이디를 입력해주세요" autocomplete="username" autocapitalize="none" inputmode="latin" required></div>
      <div class="field">${ICON.lock.replace('<svg', '<svg class="lead"')}<input id="pw" type="password" placeholder="비밀번호를 입력해주세요" autocomplete="current-password" required>${pwToggle('pw')}</div>
    </div>
    <button class="btn primary block big" id="go" type="submit">로그인</button></form>
    <a class="btn ghost block" href="#/auth/signup">아직 계정이 없나요? 회원가입</a>`;
  bindPw(v);
  $('#f', v).onsubmit = async ev => {
    ev.preventDefault(); const b = $('#go', v); busyBtn(b, true, 1);
    try { await Account.signIn($('#un', v).value.trim(), $('#pw', v).value); const r = await Account.sync().catch(e => ({ err: e.message })); toast(r && r.err ? '로그인했습니다. 동기화는 나중에 다시 시도합니다.' : `로그인했습니다${r && r.down ? ` · 기록 ${r.down}건을 불러왔습니다` : ''}.`); go('#/home'); }
    catch (e) { toast(e.message, true); busyBtn(b, false); }
  };
}, { bare: false });

route('/auth/signup', '회원가입', async (v) => {
  v.innerHTML = `<form id="f" autocomplete="on" novalidate>
    <div class="card">
      <div class="field">${ICON.user.replace('<svg', '<svg class="lead"')}<input id="nm" placeholder="이름을 입력해주세요" autocomplete="name" maxlength="20"></div>
      <div class="field">${ICON.phone.replace('<svg', '<svg class="lead"')}<input id="ph" placeholder="전화번호를 입력해주세요" autocomplete="tel" inputmode="tel" maxlength="13"></div>
      <div class="field">${ICON.idcard.replace('<svg', '<svg class="lead"')}<input id="un" placeholder="아이디를 입력해주세요" autocomplete="username" autocapitalize="none" maxlength="20"></div>
      <div class="field">${ICON.lock.replace('<svg', '<svg class="lead"')}<input id="pw" type="password" placeholder="비밀번호를 입력해주세요" autocomplete="new-password">${pwToggle('pw')}</div>
      <p class="tiny">아이디: 영문 소문자·숫자·밑줄 4~20자 · 비밀번호: 영문과 숫자를 포함해 8자 이상</p>
    </div>
    <div class="card small">
      <label class="chk"><input type="checkbox" id="cAll"><b>전체 동의</b></label>
      <label class="chk"><input type="checkbox" id="c1" class="cs"><span><b>[필수]</b> 개인정보 수집·이용 동의 — 이름·전화번호·아이디를 계정 관리와 본인 확인에 사용하고, 탈퇴 시 지체 없이 파기합니다.</span></label>
      <label class="chk"><input type="checkbox" id="c2" class="cs"><span><b>[필수]</b> 민감정보(건강 관련 정보) 처리 동의 — 발 측정값·분류 결과·운동 기록을 기록 보관과 기기 간 동기화에 사용합니다. 촬영 사진은 서버에 올리지 않습니다.</span></label>
      <label class="chk"><input type="checkbox" id="c3" class="cs"><span>[선택] 연구 활용 동의 — 측정값을 가명 처리하여 연구 분석에 활용할 수 있습니다. 동의하지 않아도 앱을 쓸 수 있습니다.</span></label>
    </div>
    <button class="btn primary block big" id="go" type="submit">회원가입</button></form>
    <a class="btn ghost block" href="#/auth/login">이미 계정이 있나요? 로그인</a>`;
  bindPw(v);
  $('#cAll', v).onchange = e => $$('.cs', v).forEach(c => { c.checked = e.target.checked; });
  $('#ph', v).oninput = e => { const d = e.target.value.replace(/\D/g, '').slice(0, 11); e.target.value = d.length > 7 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d; };
  $('#f', v).onsubmit = async ev => {
    ev.preventDefault();
    const name = $('#nm', v).value.trim(), phone = $('#ph', v).value.trim(), username = $('#un', v).value.trim().toLowerCase(), password = $('#pw', v).value;
    const errs = [];
    if (!name) errs.push('이름을 입력해 주세요');
    if (!/^01[016789]-?\d{3,4}-?\d{4}$/.test(phone)) errs.push('전화번호 형식을 확인해 주세요(예: 010-1234-5678)');
    if (!/^[a-z0-9_]{4,20}$/.test(username)) errs.push('아이디는 영문 소문자·숫자·밑줄 4~20자');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errs.push('비밀번호는 영문과 숫자를 포함해 8자 이상');
    if (!$('#c1', v).checked || !$('#c2', v).checked) errs.push('필수 동의 항목에 동의해 주세요');
    if (errs.length) return toast(errs.join(' / '), true);
    const b = $('#go', v); busyBtn(b, true, 1);
    try {
      await Account.signUp({ name, phone, username, password, consentPrivacy: true, consentSensitive: true, consentResearch: $('#c3', v).checked });
      await Account.sync().catch(() => {});
      toast(`${name}님, 가입을 환영합니다.`); go('#/home');
    } catch (e) { toast(e.message, true); busyBtn(b, false); }
  };
});

// 계정 카드(설정 화면에 삽입)
async function accountCardHtml() {
  if (!Account.configured()) return `<div class="card"><b>계정</b><p class="small muted">서버가 연결되지 않아 기록이 이 기기에만 저장됩니다. 연구자 모드 → 연구 데이터 관리에서 서버를 설정할 수 있습니다.</p></div>`;
  const u = Account.user();
  if (!u) return `<div class="card"><b>계정</b><p class="small muted">로그인하면 기록이 서버에 안전하게 보관되고 다른 기기에서도 볼 수 있습니다.</p><a class="btn primary block" href="#/auth/login">로그인</a><a class="btn block" href="#/auth/signup">회원가입</a></div>`;
  const pend = await Account.pendingCount();
  return `<div class="card"><div class="row"><span class="mi" style="color:var(--brand)">${ICON.user}</span><b class="grow">${esc(u.name)} <span class="tiny">@${esc(u.username)}</span></b><span class="badge b-good">${ICON.cloud.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} 서버 연결</span></div>
    <dl class="kv small" style="margin-top:8px"><dt>전화번호</dt><dd>${esc(u.phone)}</dd><dt>마지막 동기화</dt><dd>${S.settings.lastSync ? fmtDate(S.settings.lastSync) : '—'}</dd><dt>올리지 않은 기록</dt><dd>${pend}건</dd><dt>연구 활용 동의</dt><dd>${u.consentResearch ? '동의' : '미동의'}</dd></dl>
    <button class="btn block" id="syncNow">${ICON.cloud} 지금 동기화</button>
    <button class="btn ghost block" id="logout">${ICON.logout} 로그아웃</button>
    <button class="btn ghost block" id="delAcc" style="color:var(--bad)">회원 탈퇴(서버 기록 삭제)</button></div>`;
}
function bindAccountCard(v) {
  if ($('#syncNow', v)) $('#syncNow', v).onclick = async () => { try { const r = await Account.sync(); toast(`동기화 완료 · 올림 ${r.up}건, 받음 ${r.down}건`); render(); } catch (e) { toast(e.message, true); } };
  if ($('#logout', v)) $('#logout', v).onclick = async () => {
    if (!await confirmModal('로그아웃할까요? 이 기기에 저장된 기록은 남아 있습니다(삭제하려면 아래 "내 기록 모두 삭제").', '로그아웃')) return;
    await Account.signOut(); toast('로그아웃했습니다.'); go('#/auth');
  };
  if ($('#delAcc', v)) $('#delAcc', v).onclick = async () => {
    if (!await confirmModal('회원 탈퇴 시 서버의 계정과 모든 측정·운동 기록이 삭제되며 되돌릴 수 없습니다.', '탈퇴', true)) return;
    try { await Account.deleteAccount(); for (const e of await DB.all('exams')) await deleteExam(e); await DB.clear('logs'); toast('탈퇴 처리되었습니다.'); go('#/auth'); } catch (e) { toast(e.message, true); }
  };
}
