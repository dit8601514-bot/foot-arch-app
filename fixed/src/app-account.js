'use strict';
/* ═════════════ 계정·서버 동기화 (Supabase Auth + PostgREST, 외부 라이브러리 없이 fetch로 호출) ═════════════
 * 설정: config.js 의 window.FOOTARCH_CONFIG = { supabaseUrl, supabaseAnonKey, emailDomain }
 *       또는 연구자 모드에서 입력(이 기기에만 저장).
 * 고정촬영판(F1.7.0~): 로그인·회원가입 없음. 처음 한 번 동의하면 기기마다 이름 없는 익명 계정(Supabase anonymous sign-in)을 자동으로 만든다.
 *   서버 설정 필요: Authentication → Sign In / Providers → Allow anonymous sign-ins 켜기. 꺼져 있으면 이 기기에만 저장.
 * 서버 테이블·보안 규칙: supabase/schema.sql
 */
const Account = (() => {
  const LS = 'footarchFixed.session', GUEST = 'footarchFixed.guest', CONSENT = 'footarchFixed.consent';
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
    if (!res.ok) {
      const wasAnon = !!(session.user && session.user.is_anonymous); saveSession(null);
      if (wasAnon && ls.get(CONSENT)) { await signInAnon(JSON.parse(ls.get(CONSENT)).research); return; } // 익명 계정은 조용히 새로 만든다(기기 안 기록은 그대로)
      throw new Error('서버 연결이 끊겼습니다. 앱을 다시 열어 주세요.');
    }
    adopt(await res.json());
  }
  // ───── 공개 API ─────
  // 익명 계정: 이메일·비밀번호 없이 가입(서버에서 익명 가입을 켜야 함). profiles 표가 요구하는 값은 이름 없는 가명으로 채운다.
  async function signInAnon(research) {
    const now = new Date().toISOString(), rnd = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 12);
    let j;
    try { j = await call('/auth/v1/signup', { method: 'POST', auth: false, body: { data: { username: 'anon-' + rnd, name: '익명', phone: null, consent_privacy_at: now, consent_sensitive_at: now, consent_research: !!research } } }); }
    catch (e) { if (/anonymous/i.test(e.message) || e.status === 422) { const er = new Error('서버에서 익명 계정이 꺼져 있어 이 기기에만 저장합니다. (관리자: Supabase → Authentication → Sign In / Providers → Allow anonymous sign-ins 켜기)'); er.anonDisabled = true; throw er; } throw e; }
    adopt(j.access_token ? j : (j.session || j));
    ls.set(CONSENT, JSON.stringify({ at: now, research: !!research }));
    return user();
  }
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
    return { id: session.user.id, anonymous: !!session.user.is_anonymous, username: m.username || '', name: m.name || '', phone: m.phone || '', consentResearch: !!m.consent_research };
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
    saveSession(null); ls.del(CONSENT);
  }
  async function removeRemote(store, id) { const table = store === 'logs' ? 'exercise_logs' : store; await call(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  // 다른 계정이 이 기기에서 올려 둔(이미 서버에 있는) 기록은 로그인 시 기기에서 치운다
  async function clearOthers(uid) { for (const st of ['exams', 'logs']) for (const r of await DB.all(st)) if (r.ownerId && r.ownerId !== uid && r._syncedAt) await DB.del(st, r.id); }
  async function pendingCount() { const u = user(); if (!u) return 0; let n = 0; for (const st of ['exams', 'logs']) n += (await DB.all(st)).filter(r => !r.isTest && !r._syncedAt).length; return n; }
  // ───── AI 오차 보정 모델: 관리자가 배포한(active) 모델 1개를 내려받아 이 기기에 보관 ─────
  const AIM = 'footarchFixed.aimodel';
  // 고정촬영판(ALG-2.8.0~): 보정은 측정 알고리즘(core.js POP_CALIB, 모든 사용자 공통)에서 한다. 서버·개인 보정 모델은 쓰지 않음.
  const BUILTIN_MODEL = null;
  function aiModel() { try { return JSON.parse(ls.get(AIM) || 'null') || BUILTIN_MODEL; } catch (e) { return BUILTIN_MODEL; } } // BUILTIN_MODEL이 null(보정 없음)이면 앱 값 그대로
  async function fetchAiModel() {
    if (!configured()) return aiModel();
    try {
      const rows = await call('/rest/v1/calibration_models?select=id,version,data&active=eq.true&limit=1', { auth: !!user() });
      const m = rows && rows[0] ? { id: rows[0].id, version: rows[0].version, data: rows[0].data, fetchedAt: Date.now() } : null;
      if (m) ls.set(AIM, JSON.stringify(m)); else ls.del(AIM);
      return m || BUILTIN_MODEL;
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
    configured, user, signInAnon, signUp, signIn, signOut, sync, syncSoon, deleteAccount, pendingCount, cfg, removeRemote,
    isGuest: () => ls.get(GUEST) === '1', setGuest: v2 => v2 ? ls.set(GUEST, '1') : ls.del(GUEST),
    get loggedIn() { return !!user(); }
  };
})();

// ───── 화면: 처음 시작(동의) — 로그인·회원가입 없음(고정촬영판 F1.7.0) ─────
route('/auth', 'AI Footarch 고정촬영', async (v) => {
  const on = Account.configured();
  v.innerHTML = `<div class="auth-hero">${logoHtml(true)}
    <p>건강한 발을 위한<br>AI 발활 분석 서비스</p><div class="feet">${footprintsSvg('h')}</div></div>
    <div class="card small"><b>로그인 없이 바로 씁니다</b>
      <p>이름·아이디·전화번호를 받지 않습니다. ${on ? '이 휴대폰에 <b>이름 없는 계정</b>이 자동으로 만들어지고, 측정값(사진 제외)이 그 계정으로 서버에 저장됩니다.' : '기록은 이 기기에만 저장됩니다.'}</p>
      ${on ? `<label class="chk"><input type="checkbox" id="c1"><span><b>[필수]</b> 발 측정값(건강 관련 정보)을 이름 없는 계정으로 서버에 저장·처리하는 데 동의합니다.</span></label>
      <label class="chk"><input type="checkbox" id="c2"><span><b>[선택]</b> 측정값·실측값을 앱 오차 보정 연구(모든 사용자의 보정 학습)에 쓰는 데 동의합니다.</span></label>` : ''}</div>
    ${on ? `<button class="btn primary block big" id="go">${ICON.user} 동의하고 시작하기</button>` : ''}
    <button class="btn ghost block" id="guest">${on ? '서버 없이 이 기기에서만 쓰기' : '시작하기'}</button>
    <p class="tiny" style="text-align:center">서버 기록은 언제든 설정 → "서버 기록 삭제"로 지울 수 있습니다.</p>`;
  $('#guest', v).onclick = () => { Account.setGuest(true); go('#/home'); };
  const g = $('#go', v); if (g) g.onclick = async () => {
    if (!$('#c1', v).checked) return toast('[필수] 항목에 동의해야 서버에 저장할 수 있습니다. 동의하지 않으려면 "이 기기에서만 쓰기"를 눌러 주세요.', true);
    g.disabled = true; g.textContent = '시작하는 중…';
    try { await Account.signInAnon($('#c2', v).checked); Account.sync().catch(() => {}); toast('시작합니다. 기록은 이름 없는 계정으로 저장됩니다.'); go('#/home'); }
    catch (e) { toast(e.message, true); if (e.anonDisabled) { Account.setGuest(true); go('#/home'); } else { g.disabled = false; g.innerHTML = `${ICON.user} 동의하고 시작하기`; } }
  };
}, { bare: true });

// 계정 카드(설정 화면에 삽입)
async function accountCardHtml() {
  if (!Account.configured()) return `<div class="card"><b>저장 위치</b><p class="small muted">서버가 연결되지 않아 기록이 이 기기에만 저장됩니다.</p></div>`;
  const u = Account.user();
  if (!u) return `<div class="card"><b>저장 위치</b><p class="small muted">지금은 이 기기에만 저장됩니다. 서버에도 저장하면 휴대폰을 바꿔도 남고, 동의하면 모든 사용자의 오차 보정 학습에 쓰입니다.</p><button class="btn primary block" id="startSrv">${ICON.cloud} 서버에도 저장하기(이름 없는 계정)</button></div>`;
  const pend = await Account.pendingCount();
  return `<div class="card"><div class="row"><span class="mi" style="color:var(--brand)">${ICON.user}</span><b class="grow">${u.anonymous ? '이름 없는 계정' : esc(u.name)} <span class="tiny">${esc(String(u.id).slice(0, 8))}</span></b><span class="badge b-good">${ICON.cloud.replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} 서버 연결</span></div>
    <dl class="kv small" style="margin-top:8px"><dt>마지막 동기화</dt><dd>${S.settings.lastSync ? fmtDate(S.settings.lastSync) : '—'}</dd><dt>올리지 않은 기록</dt><dd>${pend}건</dd><dt>보정 연구 활용</dt><dd>${u.consentResearch ? '동의' : '미동의'}</dd></dl>
    <p class="tiny">로그인이 없어서 앱을 지우거나 브라우저 데이터를 지우면 이 계정으로 다시 들어갈 수 없습니다(서버 기록은 남지만 이 기기에서 다시 볼 수 없음).</p>
    <button class="btn block" id="syncNow">${ICON.cloud} 지금 동기화</button>
    <button class="btn ghost block" id="delAcc" style="color:var(--bad)">서버 기록 삭제(이름 없는 계정 삭제)</button></div>`;
}
function bindAccountCard(v) {
  if ($('#syncNow', v)) $('#syncNow', v).onclick = async () => { try { const r = await Account.sync(); toast(`동기화 완료 · 올림 ${r.up}건, 받음 ${r.down}건`); render(); } catch (e) { toast(e.message, true); } };
  if ($('#startSrv', v)) $('#startSrv', v).onclick = () => { Account.setGuest(false); go('#/auth'); };
  if ($('#delAcc', v)) $('#delAcc', v).onclick = async () => {
    if (!await confirmModal('서버의 이름 없는 계정과 그 계정의 모든 측정·운동 기록을 삭제합니다. 되돌릴 수 없습니다. (이 기기 기록도 함께 지웁니다)', '삭제', true)) return;
    try { await Account.deleteAccount(); for (const e of await DB.all('exams')) await deleteExam(e); await DB.clear('logs'); Account.setGuest(true); toast('서버 기록을 삭제했습니다. 이제 이 기기에만 저장됩니다.'); go('#/home'); } catch (e) { toast(e.message, true); }
  };
}
