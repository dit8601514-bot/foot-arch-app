// 고정촬영판 회원가입→회차 저장→관리자 측정 시트 시험(가짜 Supabase 서버 포함). 실행: node build.js && node fixed/e2e-sheet.js
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/foot-arch-app/dist';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
// ── 가짜 Supabase ──
const users = {}, profiles = {}, rounds = {}; let nid = 1; const admins = new Set();
const tok = id => 'tok-' + id, uidOf = q => { const a = (q.headers.authorization || '').replace('Bearer tok-', ''); return users[a] ? a : null; };
const J = (s, code, o, cors) => { s.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors)); s.end(o === undefined ? '' : JSON.stringify(o)); };
http.createServer((q, s) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  let body = ''; q.on('data', d => body += d); q.on('end', () => {
    if (q.method === 'OPTIONS') { s.writeHead(204, cors); return s.end(); }
    const u = new URL(q.url, 'http://x'), b = body ? JSON.parse(body) : {};
    const sess = id => ({ access_token: tok(id), refresh_token: 'r', expires_in: 3600, user: { id, email: users[id].email, user_metadata: users[id].meta } });
    if (u.pathname === '/auth/v1/signup') { const id = 'u' + (nid++) + '-0000-0000'; users[id] = { email: b.email, pw: b.password, meta: b.data }; const m = b.data || {}; profiles[id] = { id, username: m.username, name: m.name, grade: m.grade || null, gender: m.gender || null, created_at: new Date().toISOString() }; return J(s, 200, sess(id), cors); }
    if (u.pathname === '/auth/v1/token') { const id = Object.keys(users).find(k => users[k].email === b.email && users[k].pw === b.password); return id ? J(s, 200, sess(id), cors) : J(s, 400, { error_description: 'Invalid login credentials' }, cors); }
    if (u.pathname === '/auth/v1/logout') return J(s, 204, undefined, cors);
    const me = uidOf(q);
    if (u.pathname === '/rest/v1/rpc/is_admin') return J(s, 200, admins.has(me), cors);
    if (u.pathname === '/rest/v1/rpc/admin_stats') return J(s, 200, {}, cors);
    if (u.pathname === '/rest/v1/profiles') return J(s, 200, admins.has(me) ? Object.values(profiles) : Object.values(profiles).filter(p => p.id === me), cors);
    if (u.pathname === '/rest/v1/rounds') {
      if (q.method === 'POST') { if (!me || (b.user_id !== me && !admins.has(me))) return J(s, 403, { message: 'RLS' }, cors); const k = b.user_id + ':' + b.round; rounds[k] = Object.assign({}, rounds[k] || {}, b); return J(s, 201, undefined, cors); }
      let list = Object.values(rounds); if (!admins.has(me)) list = list.filter(r => r.user_id === me); const ue = u.searchParams.get('user_id'); if (ue) list = list.filter(r => 'eq.' + r.user_id === ue); return J(s, 200, list, cors);
    }
    return J(s, q.method === 'GET' ? 200 : 201, q.method === 'GET' ? [] : undefined, cors);
  });
}).listen(8811);
http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]).replace(/^\/foot-arch-app/, ''); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, u);
  if (u === '/fixed/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end("window.FOOTARCH_CONFIG={supabaseUrl:'http://localhost:8811',supabaseAnonKey:'sb_publishable_test'};"); }
  if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8810);
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${x != null ? ' — ' + x : ''}`); };
(async () => {
  const B = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const ctx = await B.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true }); const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const base = 'http://localhost:8810/foot-arch-app/fixed/';
  await pg.goto(base); await pg.waitForTimeout(1200);
  ok('처음 열면 로그인 화면', /#\/auth/.test(pg.url()) && !!(await pg.$('a[href="#/auth/signup"]')) && !(await pg.$('#guest')));
  // 회원가입 2명
  for (const [nm, gd, un] of [['김주희', '여', 'juhee1'], ['마형빈', '남', 'hyungbin']]) {
    await pg.goto(base + '#/auth/signup'); await pg.waitForTimeout(600);
    await pg.fill('#nm', nm); await pg.click(`#gd button[data-v="${gd}"]`); await pg.fill('#un', un); await pg.fill('#pw', 'test1234'); await pg.check('#cAll');
    await pg.click('#go'); await pg.waitForTimeout(1200);
    if (un === 'juhee1') { ok('회원가입 → 홈', /#\/home/.test(pg.url()), pg.url().split('#')[1]); }
    if (un !== 'hyungbin') { await pg.evaluate(() => localStorage.removeItem('footarchFixed.session')); }
  }
  const p0 = Object.values(profiles); ok('서버 프로필에 이름·성별(학년 없음)', p0.length === 2 && !p0[0].grade && p0[0].gender === '여' && p0[1].gender === '남', JSON.stringify(p0.map(p => [p.name, p.gender])));
  await pg.goto(base + '#/auth/signup'); await pg.waitForTimeout(500); ok('회원가입 화면에 학년 없음', !(await pg.$('#gr')) && !(await pg.textContent('#view')).includes('학년'));
  // 마형빈(로그인 상태)으로 측정 기록 하나 넣고 결과 화면에서 1회차 저장
  const eid = await pg.evaluate(async () => { const e = { id: 'ex' + Date.now(), foot: 'right', createdAt: Date.now(), algorithmVersion: C.ALGORITHM_VERSION, participantId: '', pre: { mode: 'ai', detectionConfidence: 0.9, quality: { sharp: true, edgeWidthPx: 1.2 }, measure: { heightMm: 30, floor: { ok: false } } }, post: { mode: 'ai', detectionConfidence: 0.9, quality: { sharp: true, edgeWidthPx: 1.2 }, measure: { heightMm: 26, floor: { ok: false } } }, comparison: { status: '측정 가능', preMm: 30, postMm: 26, changeMm: 6.4, lineChangeMm: 4.0, primary: 'p2', p2: { dropMm: 5.2, p3MoveMm: 0.3, flags: [] }, calib: { method: 'p2', rawMm: 5.2, label: '+1.2 mm', n: 11 }, notes: [], flags: [] } }; e.category = C.classify(6.4); await save('exams', e); return e.id; });
  await pg.goto(base + '#/result/' + eid); await pg.waitForTimeout(1500);
  ok('결과 화면에 회차 저장 카드', !!(await pg.$('#roundCard')) && (await pg.textContent('#roundCard')).includes('4회차'));
  await pg.click('#rSeg button[data-v="1"]'); await pg.fill('#yb', '95.5'); await pg.click('#rSave'); await pg.waitForTimeout(1200);
  const r1 = Object.values(rounds)[0]; ok('1회차 저장 → 서버 rounds', r1 && r1.round === 1 && Math.abs(r1.rt_mm - 6.4) < 1e-9 && r1.y_balance === 95.5, JSON.stringify(r1));
  ok('저장 표시', (await pg.textContent('#roundCard')).includes('1회차에 저장됨'));
  // 같은 기록을 기본 측정에도
  await pg.click('#rSeg button[data-v="0"]'); await pg.click('#rSave'); await pg.waitForTimeout(1000);
  ok('기본 측정에도 저장', Object.keys(rounds).length === 2);
  // 측정 화면은 오른발 고정
  await pg.goto(base + '#/self'); await pg.waitForTimeout(800); const st = await pg.textContent('#view');
  ok('측정 화면 오른발 고정(왼발 선택 없음)', st.includes('측정하는 발: 오른발') && !(await pg.$('#feetSeg button')));
  // ── 관리자 ──
  // 관리자 계정 만들기
  await pg.evaluate(async () => { await fetch('http://localhost:8811/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: 'teacher@users.footarch.app', password: 'admin1234', data: { username: 'teacher', name: '선생님' } }) }); });
  admins.add(Object.keys(users).find(k => users[k].email === 'teacher@users.footarch.app'));
  const ap = await ctx.newPage(); ap.on('pageerror', e => errs.push('admin: ' + e.message)); await ap.setViewportSize({ width: 1400, height: 900 });
  await ap.goto('http://localhost:8810/foot-arch-app/fixed/admin/'); await ap.waitForTimeout(800);
  await ap.fill('#u', 'teacher'); await ap.fill('#p', 'admin1234'); await ap.click('#go'); await ap.waitForTimeout(1500);
  ok('관리자 로그인 → 측정 시트', /#\/sheet/.test(ap.url()) && !!(await ap.$('table.sheet')));
  const rows = await ap.$$eval('table.sheet tbody tr:not(.empty)', trs => trs.map(tr => [...tr.children].map(td => (td.querySelector('input') ? td.querySelector('input').value : td.textContent).trim())));
  console.log('  시트:', JSON.stringify(rows));
  ok('시트: 여·남 → 이름 순, 이름·성별(학년 칸 없음)', rows.length === 2 && rows[0][1] === '김주희' && rows[0][2] === '여' && rows[1][1] === '마형빈' && rows[1][2] === '남' && !(await ap.textContent('table.sheet thead')).includes('학년'));
  ok('시트: 마형빈 기본 측정·1회차 RT 6.4, 1회차 Y 95.5', rows[1][4] === '6.4' && rows[1][7] === '6.4' && rows[1][8] === '95.5' && rows[1][3] !== '', JSON.stringify(rows[1].slice(3, 9)));
  ok('시트: 빈 줄 포함 30줄', (await ap.$$('table.sheet tbody tr')).length === 30);
  const heads = await ap.$$eval('table.sheet thead tr:first-child th.grp', t => t.map(x => x.textContent)); ok('시트 머리글 기본 측정·1~4회차', heads.join(',') === '기본 측정,1회차,2회차,3회차,4회차', heads.join(','));
  // 관리자가 김주희 2회차 Y-balance 입력
  const inp = (await ap.$$('table.sheet tbody tr:first-child input.ybi'))[2]; await inp.fill('88'); await inp.press('Tab'); await ap.waitForTimeout(800);
  const rz = Object.values(rounds).find(r => r.round === 2); ok('관리자 Y-balance 입력 → 서버 저장', rz && rz.y_balance === 88 && rz.user_id.startsWith('u1'), JSON.stringify(rz));
  // CSV
  const [dl] = await Promise.all([ap.waitForEvent('download'), ap.click('#csv')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok('CSV: 두 줄 머리글 + 회원 줄', csv.split('\r\n')[1].startsWith('번호,이름,성별,측정날짜,RT,Y-balance') && csv.includes('마형빈,남') && csv.includes(',6.4,95.5'), csv.split('\r\n').slice(0, 4).join(' | ').slice(0, 200));
  await ap.screenshot({ path: '/tmp/sheet.png', fullPage: false });
  ok('오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(`\n${pass}/${pass + fail} 통과`); await B.close(); process.exit(fail ? 1 : 0);
})();
