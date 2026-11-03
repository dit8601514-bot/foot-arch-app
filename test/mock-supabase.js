// 테스트용 모의 Supabase 서버: 앱·관리자 앱이 쓰는 Auth·REST·RPC만 구현하고,
// supabase/schema.sql + admin.sql 의 행 수준 보안(RLS)과 같은 규칙으로 접근을 막는다.
'use strict';
const http = require('http'), crypto = require('crypto');
function createMock(anonKey) {
  const users = new Map(), tokens = new Map(), refresh = new Map(), admins = new Set();
  const tables = { exams: new Map(), exercise_logs: new Map(), profiles: new Map(), reference_ndt: new Map(), calibration_models: new Map(), exercise_content: new Map() };
  const files = new Map(); // 저장소(Storage): 'bucket/path' → { type, buf }
  const KEY = { reference_ndt: 'exam_id' };
  const issue = u => { const at = 'at_' + crypto.randomUUID(), rt = 'rt_' + crypto.randomUUID(); tokens.set(at, u.id); refresh.set(rt, u.id); return { access_token: at, refresh_token: rt, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: u.id, email: u.email, user_metadata: u.meta } }; };
  const log = [];
  const isAdmin = uid => !!uid && admins.has(uid);
  const researchOk = uid => { const p = tables.profiles.get(uid); return !!(p && p.consent_research); };
  // 표 별 읽기 규칙(RLS select)
  const canRead = (t, r, uid) => {
    if (t === 'profiles') return r.id === uid || (isAdmin(uid) && r.consent_research);
    if (t === 'exams' || t === 'exercise_logs') return r.user_id === uid || (isAdmin(uid) && researchOk(r.user_id));
    if (t === 'reference_ndt') return r.user_id === uid || (isAdmin(uid) && researchOk(r.user_id));
    if (t === 'calibration_models') return r.active || isAdmin(uid);
    if (t === 'exercise_content') return r.published !== false || isAdmin(uid);
    return false;
  };
  // PostgREST 필터: col=eq.v / col=not.is.null (select·order·limit·on_conflict는 무시)
  const filters = url => [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k));
  const match = (r, fs) => fs.every(([k, v]) => v === 'not.is.null' ? r[k] != null : v.startsWith('eq.') ? String(r[k]) === decodeURIComponent(v.slice(3)) : true);
  const srv = http.createServer((req, res) => {
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, x-upsert, cache-control', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Content-Type': 'application/json' };
    const send = (code, obj) => { res.writeHead(code, H); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') return send(204);
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const url = new URL(req.url, 'http://x'), raw = Buffer.concat(chunks), isStore = url.pathname.startsWith('/storage/v1/object/') && req.method === 'POST', body = isStore ? '' : raw.toString('utf8'), j = body ? JSON.parse(body) : null;
      // 공개 저장소 읽기(공개 버킷은 키 없이도 읽힘)
      const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([\w-]+)\/(.+)$/);
      if (pub && req.method === 'GET') { const f = files.get(pub[1] + '/' + decodeURIComponent(pub[2])); if (!f) return send(404, { message: 'Object not found' }); res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': f.type, 'Content-Length': f.buf.length, 'Accept-Ranges': 'none' }); return res.end(f.buf); }
      log.push(req.method + ' ' + url.pathname + url.search);
      if (req.headers.apikey !== anonKey) return send(401, { message: 'Invalid API key' });
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, ''), uid = tokens.get(bearer) || null;
      if (req.headers.authorization && !uid && !url.pathname.startsWith('/auth/v1/token') && url.pathname !== '/auth/v1/logout') return send(401, { message: 'Invalid JWT' }); // 새 공개 키(sb_publishable_)는 JWT가 아님
      if (url.pathname === '/auth/v1/signup') {
        if ([...users.values()].some(u => u.email === j.email)) return send(422, { msg: 'User already registered' });
        if (!j.password || j.password.length < 6) return send(422, { msg: 'Password should be at least 6 characters' });
        const u = { id: crypto.randomUUID(), email: j.email, password: j.password, meta: j.data || {} }; users.set(u.id, u);
        const m = u.meta; tables.profiles.set(u.id, { id: u.id, username: m.username, name: m.name, phone: m.phone, consent_privacy_at: m.consent_privacy_at, consent_sensitive_at: m.consent_sensitive_at, consent_research: !!m.consent_research, created_at: new Date().toISOString() });
        return send(200, issue(u));
      }
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') { const u = [...users.values()].find(x => x.email === j.email && x.password === j.password); return u ? send(200, issue(u)) : send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); }
        const id = refresh.get(j.refresh_token); if (!id || !users.has(id)) return send(400, { error: 'invalid_grant' }); refresh.delete(j.refresh_token); return send(200, issue(users.get(id)));
      }
      if (url.pathname === '/auth/v1/logout') { tokens.delete(bearer); return send(204); }
      // 저장소 올리기·지우기: 관리자만(content.sql 정책)
      const so = url.pathname.match(/^\/storage\/v1\/object\/([\w-]+)(?:\/(.+))?$/);
      if (so && !url.pathname.includes('/public/')) {
        if (!isAdmin(uid)) return send(403, { message: 'new row violates row-level security policy', statusCode: '403' });
        if (req.method === 'POST' && so[2]) { if (raw.length > 50 * 1048576) return send(413, { message: 'The object exceeded the maximum allowed size' }); files.set(so[1] + '/' + decodeURIComponent(so[2]), { type: req.headers['content-type'] || 'application/octet-stream', buf: raw }); return send(200, { Key: so[1] + '/' + so[2] }); }
        if (req.method === 'DELETE') { for (const pth of (j && j.prefixes) || []) files.delete(so[1] + '/' + pth); return send(200, []); }
        return send(405, { message: 'method' });
      }
      const tm = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
      // 활성 모델·공개 운동 읽기는 로그인 없이도 가능(공개 키)
      if (!uid && !(tm && (tm[1] === 'calibration_models' || tm[1] === 'exercise_content') && req.method === 'GET')) return send(401, { message: 'JWT expired or invalid' });
      // ── RPC ──
      const rp = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
      if (rp) {
        const fn = rp[1];
        if (fn === 'delete_user') { users.delete(uid); tables.profiles.delete(uid); for (const t of ['exams', 'exercise_logs', 'reference_ndt']) for (const [k, r] of tables[t]) if (r.user_id === uid) tables[t].delete(k); return send(204); }
        if (fn === 'is_admin') return send(200, isAdmin(uid));
        if (!isAdmin(uid)) return send(400, { message: 'not admin' });
        if (fn === 'admin_stats') { const P = [...tables.profiles.values()]; return send(200, { users: P.length, research_users: P.filter(p => p.consent_research).length, exams: tables.exams.size, research_exams: [...tables.exams.values()].filter(e => researchOk(e.user_id)).length, references: tables.reference_ndt.size, exercise_logs: tables.exercise_logs.size }); }
        if (fn === 'activate_model') { for (const m of tables.calibration_models.values()) m.active = m.id === j.model_id; return send(204); }
        if (fn === 'deactivate_models') { for (const m of tables.calibration_models.values()) m.active = false; return send(204); }
        return send(404, { message: 'no function' });
      }
      if (!tm || !tables[tm[1]]) return send(404, { message: 'not found' });
      const tn = tm[1], t = tables[tn], key = KEY[tn] || 'id', fs = filters(url);
      if (req.method === 'GET') return send(200, [...t.values()].filter(r => canRead(tn, r, uid) && match(r, fs)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))));
      if (req.method === 'POST') {
        for (const row0 of [].concat(j)) {
          const row = Object.assign({}, row0), ex = t.get(row[key]);
          if (tn === 'exams' || tn === 'exercise_logs') { if (ex && ex.user_id !== uid) return send(403, { message: 'new row violates row-level security policy' }); row.user_id = uid; }
          else if (tn === 'reference_ndt') { const e = tables.exams.get(row.exam_id); if (!isAdmin(uid) || !researchOk(row.user_id) || !e || e.user_id !== row.user_id) return send(403, { message: 'new row violates row-level security policy' }); row.created_by = uid; }
          else if (tn === 'exercise_content') { if (!isAdmin(uid)) return send(403, { message: 'new row violates row-level security policy' }); row.created_at = (ex && ex.created_at) || new Date().toISOString(); }
          else if (tn === 'calibration_models') { if (!isAdmin(uid)) return send(403, { message: 'new row violates row-level security policy' }); row.created_by = uid; row.created_at = row.created_at || new Date().toISOString(); }
          else return send(403, { message: 'new row violates row-level security policy' });
          t.set(row[key], Object.assign({}, ex || {}, row));
        }
        return send(201);
      }
      if (req.method === 'DELETE') {
        if (tn === 'exercise_content') { if (!isAdmin(uid)) return send(403, { message: 'permission denied' }); for (const [k, r] of t) if (match(r, fs)) t.delete(k); return send(204); }
        if (tn !== 'exams' && tn !== 'exercise_logs') return send(403, { message: 'permission denied' });
        for (const [k, r] of t) if (r.user_id === uid && match(r, fs)) t.delete(k);
        return send(204);
      }
      send(405, { message: 'method' });
    });
  });
  // 시험용: 관리자 지정(실제 서버에서는 SQL Editor에서만 가능)
  const makeAdmin = username => { const u = [...users.values()].find(x => x.meta.username === username); if (u) admins.add(u.id); return !!u; };
  return { srv, users, tables, log, admins, makeAdmin, files };
}
module.exports = { createMock };
