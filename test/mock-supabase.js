// 테스트용 모의 Supabase 서버: 앱이 쓰는 Auth·REST 엔드포인트만 구현하고, RLS처럼 본인 행만 접근하게 한다.
'use strict';
const http = require('http'), crypto = require('crypto');
function createMock(anonKey) {
  const users = new Map(), tokens = new Map(), refresh = new Map(), tables = { exams: new Map(), exercise_logs: new Map() };
  const issue = u => { const at = 'at_' + crypto.randomUUID(), rt = 'rt_' + crypto.randomUUID(); tokens.set(at, u.id); refresh.set(rt, u.id); return { access_token: at, refresh_token: rt, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: u.id, email: u.email, user_metadata: u.meta } }; };
  const log = [];
  const srv = http.createServer((req, res) => {
    const H = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Content-Type': 'application/json' };
    const send = (code, obj) => { res.writeHead(code, H); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') return send(204);
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const url = new URL(req.url, 'http://x'), j = body ? JSON.parse(body) : null;
      log.push(req.method + ' ' + url.pathname);
      if (req.headers.apikey !== anonKey) return send(401, { message: 'Invalid API key' });
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, ''), uid = tokens.get(bearer);
      if (url.pathname === '/auth/v1/signup') {
        if ([...users.values()].some(u => u.email === j.email)) return send(422, { msg: 'User already registered' });
        if (!j.password || j.password.length < 6) return send(422, { msg: 'Password should be at least 6 characters' });
        const u = { id: crypto.randomUUID(), email: j.email, password: j.password, meta: j.data || {} }; users.set(u.id, u); return send(200, issue(u));
      }
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password') { const u = [...users.values()].find(x => x.email === j.email && x.password === j.password); return u ? send(200, issue(u)) : send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); }
        const id = refresh.get(j.refresh_token); if (!id || !users.has(id)) return send(400, { error: 'invalid_grant' }); refresh.delete(j.refresh_token); return send(200, issue(users.get(id)));
      }
      if (url.pathname === '/auth/v1/logout') { tokens.delete(bearer); return send(204); }
      if (!uid || !users.has(uid)) return send(401, { message: 'JWT expired or invalid' });
      if (url.pathname === '/rest/v1/rpc/delete_user') { users.delete(uid); for (const t of Object.values(tables)) for (const [k, r] of t) if (r.user_id === uid) t.delete(k); return send(204); }
      const m = url.pathname.match(/^\/rest\/v1\/(exams|exercise_logs)$/); if (!m) return send(404, { message: 'not found' });
      const t = tables[m[1]];
      if (req.method === 'GET') return send(200, [...t.values()].filter(r => r.user_id === uid).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(r => ({ id: r.id, data: r.data })));
      if (req.method === 'POST') {
        for (const row of [].concat(j)) { const ex = t.get(row.id); if (ex && ex.user_id !== uid) return send(403, { message: 'new row violates row-level security policy' }); t.set(row.id, Object.assign({}, row, { user_id: uid })); }
        return send(201);
      }
      if (req.method === 'DELETE') {
        const f = url.searchParams.get('id') || '';
        for (const [k, r] of t) if (r.user_id === uid && (f === 'not.is.null' || f === 'eq.' + k)) t.delete(k);
        return send(204);
      }
      send(405, { message: 'method' });
    });
  });
  return { srv, users, tables, log };
}
module.exports = { createMock };
