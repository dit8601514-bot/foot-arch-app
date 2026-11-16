// 고정촬영판 회원가입→회차 저장→관리자 측정 시트 시험(가짜 Supabase 서버 포함). 실행: node build.js && node fixed/e2e-sheet.js
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = '/home/claude/foot-arch-app/dist';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
// ── 가짜 Supabase ──
const users = {}, profiles = {}, rounds = {}, reminders = {}, pushSubs = {}, pushTests = []; const VAPID = require('crypto').createECDH('prime256v1').generateKeys().toString('base64url'); let nid = 1; const admins = new Set();
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
    if (u.pathname === '/rest/v1/reminders') { if (q.method === 'POST') { if (!me || b.user_id !== me) return J(s, 403, { message: 'RLS' }, cors); reminders[me] = Object.assign({}, reminders[me] || {}, b); return J(s, 201, undefined, cors); } return J(s, 200, Object.values(reminders).filter(r => r.user_id === me), cors); }
    if (u.pathname === '/rest/v1/push_subscriptions') { if (q.method === 'POST') { if (!me) return J(s, 401, { message: 'auth' }, cors); pushSubs[b.endpoint] = b; return J(s, 201, undefined, cors); } if (q.method === 'DELETE') { for (const k in pushSubs) if (pushSubs[k].user_id === me) delete pushSubs[k]; return J(s, 204, undefined, cors); } return J(s, 200, Object.values(pushSubs).filter(x => x.user_id === me), cors); }
    if (u.pathname === '/functions/v1/send-reminders') { if (u.searchParams.has('vapid')) return J(s, 200, { publicKey: VAPID }, cors); if (b.test) { pushTests.push(me); return J(s, 200, { ok: Object.values(pushSubs).filter(x => x.user_id === me).length, total: 1 }, cors); } return J(s, 200, { ok: true }, cors); }
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
  // 중재 운동 영상 3개: 결과 화면 연결 → 운동 목록 → 각 영상 실제 재생
  { const rt = await pg.textContent('main'); ok('결과 화면 운동 중재에 영상 3개 연결', ['짧은 발 운동', '수건 당기기', '발가락 벌리기'].every(n => rt.includes(n)) && !rt.includes('영상 등록 필요'), (rt.match(/운동 중재[\s\S]{0,200}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160));
    await pg.goto(base + '#/exercises'); await pg.waitForTimeout(3200);
    const names = await pg.$$eval('a.vcard b', b => b.map(x => x.textContent)); ok('운동 목록: 중재 영상 3개만(초안 없음)', names.length === 3 && names[0].startsWith('짧은 발 운동') && names[1].startsWith('수건 당기기') && names[2].startsWith('발가락 벌리기'), JSON.stringify(names));
    for (const [id, dur] of [['iv-short-foot', 307.8], ['iv-towel-curl', 270.5], ['iv-toe-spread', 316.4]]) {
      await pg.goto(base + '#/exercise/' + id); await pg.waitForSelector('#vid');
      await pg.click('#play'); await pg.waitForTimeout(2500);
      const vs = await pg.evaluate(() => { const v = document.getElementById('vid'); return { d: v.duration, t: v.currentTime, err: v.error && v.error.code, w: v.videoWidth, errShown: !document.getElementById('vErr').classList.contains('hide'), txt: document.querySelector('main').textContent }; });
      ok(`영상 재생 ${id}`, Math.abs(vs.d - dur) < 1 && vs.t > 0.5 && !vs.err && vs.w === 1280 && !vs.errShown && vs.txt.includes('10 회') && vs.txt.includes('3 세트') && vs.txt.includes('30 초') && !vs.txt.includes('미입력'), JSON.stringify({ d: vs.d, t: vs.t, err: vs.err, w: vs.w }));
    }
    await pg.screenshot({ path: '/tmp/ex-detail.png' });
    await pg.goto(base + '#/exercises'); await pg.waitForTimeout(3500); await pg.screenshot({ path: '/tmp/ex-list.png' }); }
  // 갤럭시 음성: 가짜 음성 엔진으로 안드로이드 Chrome·삼성 인터넷·소리 안 나는 엔진 흉내
  for (const [mode, ua] of [['android', 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'], ['dead', 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'], ['samsung', 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36']]) {
    const c2 = await B.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', userAgent: ua }); const p2 = await c2.newPage(); const e2 = []; p2.on('pageerror', e => e2.push(e.message));
    await c2.addInitScript(m => { const log = []; window.__tts = log; const fake = { speaking: false, pending: false, paused: false, onvoiceschanged: null,
      getVoices: () => [{ name: 'Google 한국의', lang: 'ko-KR', localService: false }, { name: 'Samsung 한국어', lang: 'ko-KR', localService: true }],
      speak(u) { log.push({ text: u.text, voice: !!u.voice, lang: u.lang }); if (m === 'dead') return; this.speaking = true; setTimeout(() => { u.onstart && u.onstart({}); setTimeout(() => { this.speaking = false; u.onend && u.onend({}); }, 300); }, 50); },
      cancel() { this.speaking = false; }, resume() {}, pause() {} };
      Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true }); window.SpeechSynthesisUtterance = function (t) { this.text = t; }; }, mode);
    await p2.goto(base + '#/auth/signup'); await p2.waitForTimeout(600);
    await p2.fill('#nm', '음성' + mode); await p2.click('#gd button[data-v="여"]'); await p2.fill('#un', 'voice' + mode); await p2.fill('#pw', 'test1234'); await p2.check('#cAll'); await p2.click('#go'); await p2.waitForTimeout(1200);
    await p2.goto(base + '#/self'); await p2.waitForSelector('#vTest');
    if (mode === 'samsung') { const h = await p2.textContent('#vHelp'); const href = await p2.getAttribute('#vHelp a.btn', 'href'); ok('삼성 인터넷: Chrome으로 열기 안내', h.includes('삼성 인터넷') && /^intent:\/\/.*package=com\.android\.chrome/.test(href || ''), href); }
    else {
      await p2.click('#vTest'); await p2.waitForTimeout(mode === 'dead' ? 6800 : 900);
      const log = await p2.evaluate(() => window.__tts), h = await p2.textContent('#vHelp');
      if (mode === 'android') {
        ok('안드로이드: 목소리 직접 지정 안 함(기본 엔진·한국어)', log.length >= 1 && log.every(x => !x.voice && x.lang === 'ko-KR'), JSON.stringify(log));
        ok('소리 확인 → 들렸나요?', h.includes('소리가 들렸나요'));
        await p2.click('#vHelp [data-ans="no"]'); const h2 = await p2.textContent('#vHelp'); ok('안 들린다 → 갤럭시 해결 방법(미디어 음량·Chrome·TTS 설정)', h2.includes('미디어 음량') && h2.includes('텍스트 음성 변환') && h2.includes('Chrome'));
      } else ok('엔진이 말을 시작 못 함 → 바로 해결 방법 표시', h.includes('미디어 음량') && h.includes('텍스트 음성 변환'), h.slice(0, 80));
    }
    ok(`음성(${mode}) 화면 오류 없음`, e2.length === 0, e2.join(' / ')); await c2.close();
  }
  for (const k of Object.keys(profiles)) if (String(profiles[k].name).startsWith('음성')) delete profiles[k]; // 시트 시험에 섞이지 않게
  // 변화 추이(유연성 평발 관리): 오른발만, 6주 프로그램 없음 / 운동 화면: 숏풋 좋은 점·근거
  { await pg.goto(base + '#/manage'); await pg.waitForTimeout(1200); const mt = await pg.textContent('main');
    ok('변화 추이: 왼발 없음·6주 프로그램 없음·오른발 표시', !mt.includes('왼발') && !mt.includes('6주') && !mt.includes('숏풋 운동 프로그램') && mt.includes('오른발'), mt.replace(/\s+/g, ' ').slice(0, 120));
    await pg.goto(base + '#/exercises'); await pg.waitForTimeout(3000); const et = await pg.textContent('main'), links = await pg.$$eval('details a[target=_blank]', a => a.map(x => x.href));
    ok('운동 화면: 숏풋 좋은 점·근거 출처 5개', et.includes('짧은 발(숏풋) 운동의 좋은 점과 근거') && links.length === 5 && links.every(h => /^https:\/\/(doi\.org|pmc\.ncbi\.nlm\.nih\.gov|journals\.sagepub\.com)\//.test(h)), JSON.stringify(links));
    await pg.goto(base + '#/exercise/iv-short-foot'); await pg.waitForTimeout(800);
    ok('짧은 발 운동 상세: 근거 펼쳐 표시', await pg.$eval('details', d => d.open && d.textContent.includes('Unver')));
    await pg.screenshot({ path: '/tmp/sf-evidence.png', fullPage: true }); }
  // 스티커 안내: 오른발만, 인쇄용 부착 자 없음, 발가락 방향 선택 없음
  { await pg.goto(base + '#/stickers-info'); await pg.waitForTimeout(800); const t1 = await pg.textContent('main');
    ok('스티커 부착 위치: 오른발만·부착 자 내려받기 없음', !t1.includes('왼발') && t1.includes('오른발') && !t1.includes('부착 자') && !(await pg.$('#rulerBtn')) && !(await pg.$('#fs')), t1.replace(/\s+/g, ' ').slice(0, 80));
    await pg.goto(base + '#/guide'); await pg.waitForTimeout(600); await pg.evaluate(() => { S.exam = S.exam || { foot: 'right', toeDirection: 'left' }; });
    await pg.goto(base + '#/posture'); await pg.waitForTimeout(800); const t2 = await pg.textContent('main');
    ok('촬영 자세: 발가락 방향 선택 없음(오른발 기준 왼쪽 고정)', !(await pg.$('#toeSeg')) && t2.includes('발가락이 왼쪽') && !!(await pg.$('#svgBox svg')), t2.replace(/\s+/g, ' ').slice(0, 60)); }
  // 왼발 화면 정리: 중재 전·후 비교·검사 이력에 왼발 없음
  { await pg.goto(base + '#/compare'); await pg.waitForTimeout(800); const c1 = await pg.textContent('main');
    ok('중재 전·후 비교: 왼발 선택 없음', !c1.includes('왼발') && !(await pg.$('#fseg')) && c1.includes('오른발'), c1.replace(/\s+/g, ' ').slice(0, 80));
    await pg.goto(base + '#/history'); await pg.waitForTimeout(800); const h1 = await pg.textContent('main');
    ok('검사 이력: 왼발·좌우 비교 없음', !h1.includes('왼발') && !h1.includes('좌우') && !(await pg.$('#fseg')), h1.replace(/\s+/g, ' ').slice(0, 80)); }
  // 촬영 방법 영상: 측정 탭·검사 안내에서 재생
  for (const r of ['#/self', '#/guide']) { await pg.goto(base + r); await pg.waitForSelector('video.howto');
    const vs = await pg.evaluate(async () => { const v = document.querySelector('video.howto'); v.muted = true; await v.play(); await new Promise(z => setTimeout(z, 1500)); return { d: v.duration, t: v.currentTime, err: v.error && v.error.code, w: v.videoWidth }; });
    ok(`촬영 방법 영상 재생(${r})`, Math.abs(vs.d - 83.5) < 1 && vs.t > 0.5 && !vs.err && vs.w === 1280, JSON.stringify(vs)); }
  // 운동 알람: 요일·시간 저장 → 서버 reminders, 캘린더(.ics), 푸시 켜기(가짜 구독)·시험·끄기
  { await pg.goto(base + '#/exercises'); await pg.waitForTimeout(2800); ok('운동 화면에 알람 카드', !!(await pg.$('a[href="#/reminder"]')));
    await pg.addInitScript(() => { const fake = { endpoint: 'https://push.example/abc', toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'x', auth: 'y' } }; }, unsubscribe: async () => { window.__unsub = true; return true; } };
      let cur = null; window.Notification = { permission: 'default', requestPermission: async () => (window.Notification.permission = 'granted') };
      window.PushManager = function () {}; const pm = { getSubscription: async () => cur, subscribe: async o => { window.__subOpt = !!(o && o.applicationServerKey && o.applicationServerKey.length === 65); cur = fake; return fake; } };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: pm }), getRegistration: async () => ({ pushManager: pm }), register: async () => ({}), addEventListener() {}, controller: null } }); });
    await pg.goto(base + '#/reminder'); await pg.waitForSelector('#days'); await pg.reload(); await pg.waitForSelector('#days');
    await pg.click('[data-preset="wk"]'); await pg.click('#days button[data-d="6"]'); await pg.fill('.tm', '07:30'); await pg.click('#addT'); await pg.fill('.tm >> nth=1', '21:00'); await pg.click('#save'); await pg.waitForTimeout(800);
    const rem = Object.values(reminders)[0]; ok('알람 저장 → 서버 reminders(평일+토, 07:30·21:00)', rem && JSON.stringify([...rem.days].sort()) === '[1,2,3,4,5,6]' && rem.times.join(',') === '07:30,21:00' && rem.enabled === true && !!rem.tz, JSON.stringify(rem));
    ok('캘린더 알람 없음(사용자 요청으로 뺌)', !(await pg.$('#ics')) && !(await pg.textContent('main')).includes('캘린더'));
    await pg.click('#pushOn'); await pg.waitForTimeout(1200);
    ok('알림 켜기 → 공개 키로 구독 + 서버 저장', await pg.evaluate(() => window.__subOpt) && Object.keys(pushSubs).length === 1 && Object.values(pushSubs)[0].sub.endpoint === 'https://push.example/abc' && (await pg.textContent('main')).includes('켜짐'));
    await pg.click('#pushTest'); await pg.waitForTimeout(700); ok('시험 알림 요청', pushTests.length === 1 && (await pg.textContent('#pmsg')).includes('시험 알림을 보냈습니다'));
    await pg.click('#pushOff'); await pg.waitForTimeout(800); ok('알림 끄기 → 구독 해제·서버 삭제', await pg.evaluate(() => window.__unsub) && Object.keys(pushSubs).length === 0);
    await pg.screenshot({ path: '/tmp/reminder.png', fullPage: true }); }
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
  // 환자별 그래프: 김주희 회차 기록을 더 넣고(기본 측정 9.6 → 4회차 6.8) 이름을 눌러 그래프 확인
  { const u1 = Object.keys(profiles).find(k => profiles[k].name === '김주희'), d0 = Date.parse('2026-09-01');
    [[0, 9.6], [2, 8.4], [3, 7.6], [4, 6.8]].forEach(([k, v], i) => { rounds[u1 + ':' + k] = Object.assign({}, rounds[u1 + ':' + k] || {}, { user_id: u1, round: k, rt_mm: v, measured_at: new Date(d0 + k * 14 * 864e5).toISOString() }); });
    await ap.click('#rf'); await ap.waitForTimeout(500); await ap.click('table.sheet td.nm a >> text=김주희'); await ap.waitForSelector('.trend svg');
    const tv = await ap.evaluate(() => ({ dots: document.querySelectorAll('.trend section svg circle').length, red: [...document.querySelectorAll('.trend section svg circle')].filter(c => c.getAttribute('fill') === '#C0281B').length, txt: document.querySelector('.trend section').textContent, hash: location.hash }));
    ok('환자별 그래프: 이름 클릭 → 회차 4개 점(빨강 2·초록 2)', /#\/trend\//.test(tv.hash) && tv.dots === 4 && tv.red === 2, JSON.stringify({ dots: tv.dots, red: tv.red }));
    ok('환자별 그래프: 최근 판정·변화량·판정 변화 표시', tv.txt.includes('4회차') && tv.txt.includes('−2.8 mm') && tv.txt.includes('유연성 평발 → 정상') && tv.txt.includes('8 mm 이상 = 유연성 평발 구간'), tv.txt.slice(0, 160));
    await ap.setViewportSize({ width: 1280, height: 900 }); await ap.waitForTimeout(200); await ap.screenshot({ path: '/tmp/trend.png', fullPage: true }); }
  ok('오류 없음', errs.length === 0, errs.slice(0, 3).join(' / '));
  console.log(`\n${pass}/${pass + fail} 통과`); await B.close(); process.exit(fail ? 1 : 0);
})();
