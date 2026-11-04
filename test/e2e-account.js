// E2E: 실제 서버 계정 흐름(모의 Supabase) — 회원가입·검증·로그인·동기화·다른 기기·사용자 분리·탈퇴
// node test/e2e-account.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const { createMock } = require('./mock-supabase');
const root = path.join(__dirname, '..'), ANON = 'test-anon-key', API = 'http://localhost:8791';
const mock = createMock(ANON); mock.srv.listen(8791);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const app = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  if (u === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(`window.FOOTARCH_CONFIG={supabaseUrl:'${API}',supabaseAnonKey:'${ANON}',emailDomain:'users.footarch.app'};`); }
  const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
}).listen(8790);
const U = 'http://localhost:8790/';
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const shot = (pg, n) => pg.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
async function toastText(pg) { const t = await pg.waitForSelector('.toast', { timeout: 4000 }).catch(() => null); return t ? (await t.textContent()) : ''; }
async function signup(pg, { name, phone, un, pw, research }) {
  await pg.goto(U + '#/auth/signup'); await pg.waitForSelector('#nm');
  await pg.fill('#nm', name); await pg.fill('#ph', phone); await pg.fill('#un', un); await pg.fill('#pw', pw);
  await pg.check('#c1'); await pg.check('#c2'); if (research) await pg.check('#c3');
  await pg.click('#go');
}
(async () => {
  const b = await chromium.launch(); const errors = [];
  // ── 기기 A ──
  const A = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const pa = await A.newPage();
  pa.on('pageerror', e => errors.push(e.message));
  await pa.goto(U + '#/home'); await pa.waitForTimeout(800);
  log('서버 설정 시 로그인 전에는 로그인/회원가입 화면으로', (await pa.evaluate(() => location.hash)) === '#/auth' && await pa.isVisible('text=AI 발활 분석 서비스'));
  await shot(pa, 'a01-auth');
  await pa.click('text=회원가입'); await pa.waitForSelector('#nm'); await shot(pa, 'a02-signup');
  // 입력값 검증
  await pa.fill('#nm', '홍길동'); await pa.fill('#ph', '0101234'); await pa.fill('#un', 'ab'); await pa.fill('#pw', 'short'); await pa.click('#go');
  const v1 = await toastText(pa);
  log('회원가입 입력 검증(전화번호·아이디·비밀번호·필수 동의)', v1.includes('전화번호') && v1.includes('아이디') && v1.includes('비밀번호') && v1.includes('필수 동의'), v1);
  log('전화번호 자동 하이픈', (await pa.inputValue('#ph')) === '010-1234', await pa.inputValue('#ph'));
  await signup(pa, { name: '홍길동', phone: '010-1234-5678', un: 'gildong01', pw: 'footarch2026', research: true });
  await pa.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 }).catch(() => {});
  await pa.waitForTimeout(400); await shot(pa, 'a03-home-loggedin');
  log('가입 후 홈: 이름 인사', await pa.isVisible('text=홍길동님, 안녕하세요!'));
  const u0 = [...mock.users.values()][0];
  log('서버에 계정 생성(아이디→내부 주소, 동의 기록)', u0 && u0.email === 'gildong01@users.footarch.app' && u0.meta.name === '홍길동' && u0.meta.phone === '010-1234-5678' && !!u0.meta.consent_privacy_at && !!u0.meta.consent_sensitive_at && u0.meta.consent_research === true, JSON.stringify(u0 && u0.meta));
  // 측정 기록 1건 + 운동 기록 1건 저장 → 동기화
  await pa.evaluate(async () => {
    const now = Date.now();
    await DB.put('exams', { id: 'exam-test-1', createdAt: now, foot: 'left', participantId: '', pre: { measure: {}, quality: {}, mode: 'voice' }, post: { measure: {}, quality: {}, mode: 'voice' }, comparison: { status: '측정 가능', changeMm: 8, lineChangeMm: 8, archAngle: { pre: 145, post: 158, change: 13 } }, category: C.classify(8), measurementConfidence: 0.9, algorithmVersion: C.ALGORITHM_VERSION, isTest: false, selfReport: {} });
    await DB.put('logs', { id: 'log-test-1', date: now, exerciseId: 'x', exerciseName: '짧은 발 운동', completed: true, watchedSec: 30 });
    return Account.sync();
  });
  log('동기화: 측정·운동 기록이 서버에 본인 소유로 저장', mock.tables.exams.get('exam-test-1')?.user_id === u0.id && mock.tables.exercise_logs.get('log-test-1')?.user_id === u0.id);
  log('서버로 사진을 올리지 않음(기록 객체에 이미지 데이터 없음)', !JSON.stringify(mock.tables.exams.get('exam-test-1').data).includes('blob'));
  await pa.goto(U + '#/settings'); await pa.waitForSelector('text=서버 연결'); await shot(pa, 'a04-settings');
  log('설정: 계정 카드(이름·아이디·동기화 상태)', await pa.isVisible('text=@gildong01') && (await pa.textContent('main')).includes('올리지 않은 기록'));
  // ── 기기 B: 같은 계정 로그인 → 기록 내려받기 ──
  const B = await b.newContext({ viewport: { width: 390, height: 844 } }); const pb = await B.newPage(); pb.on('pageerror', e => errors.push(e.message));
  await pb.goto(U + '#/auth/login'); await pb.waitForSelector('#un');
  await pb.fill('#un', 'gildong01'); await pb.fill('#pw', 'wrongpass1'); await pb.click('#go');
  const t2 = await toastText(pb); log('잘못된 비밀번호 거부', t2.includes('올바르지 않습니다'), t2);
  await pb.waitForTimeout(500); await pb.fill('#pw', 'footarch2026'); await pb.click('#go');
  await pb.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 }).catch(() => {});
  await pb.goto(U + '#/records'); await pb.waitForTimeout(600); await shot(pb, 'a05-deviceB-records');
  log('다른 기기에서 로그인하면 서버 기록을 내려받음(달력·측정 내역)', (await pb.textContent('main')).includes('발배뼈 하강 8.0 mm'));
  // ── 다른 사용자 C: 남의 기록이 보이지 않아야 함 ──
  const Cc = await b.newContext({ viewport: { width: 390, height: 844 } }); const pc = await Cc.newPage(); pc.on('pageerror', e => errors.push(e.message));
  await signup(pc, { name: '김영희', phone: '010-9876-5432', un: 'gildong01', pw: 'another2026' });
  const t3 = await toastText(pc); log('이미 쓰는 아이디 거부', t3.includes('이미 사용 중인 아이디'), t3);
  await pc.waitForTimeout(400); await pc.fill('#un', 'younghee'); await pc.click('#go');
  await pc.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 }).catch(() => {});
  await pc.goto(U + '#/records'); await pc.waitForTimeout(600);
  const leak = (await pc.textContent('main')).includes('발배뼈 하강 8.0 mm');
  const direct = await pc.evaluate(async () => { const r = await fetch(window.FOOTARCH_CONFIG.supabaseUrl + '/rest/v1/exams?select=id', { headers: { apikey: window.FOOTARCH_CONFIG.supabaseAnonKey, Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('footarch.session')).access_token } }); return r.json(); });
  log('사용자 분리: 다른 계정은 남의 기록을 볼 수 없음', !leak && direct.length === 0, JSON.stringify(direct));
  // ── 로그인 없이 둘러보기 ──
  const D = await b.newContext({ viewport: { width: 390, height: 844 } }); const pd = await D.newPage();
  await pd.goto(U + '#/auth'); await pd.click('#guest'); await pd.waitForTimeout(400);
  log('로그인 없이 둘러보기(기기 저장 모드)', (await pd.evaluate(() => location.hash)) === '#/home' && await pd.isVisible('text=측정하기'));
  // ── 로그아웃 → 탈퇴 ──
  await pb.goto(U + '#/settings'); await pb.waitForSelector('#logout'); await pb.click('#logout'); await pb.click('.modal [data-a="ok"]');
  await pb.waitForFunction(() => location.hash === '#/auth', null, { timeout: 5000 }).catch(() => {});
  log('로그아웃 → 로그인 화면', (await pb.evaluate(() => location.hash)) === '#/auth');
  await pa.goto(U + '#/settings'); await pa.waitForSelector('#delAcc'); await pa.click('#delAcc'); await pa.click('.modal [data-a="ok"]');
  await pa.waitForFunction(() => location.hash === '#/auth', null, { timeout: 5000 }).catch(() => {});
  log('회원 탈퇴: 서버 계정·기록 삭제', !mock.users.has(u0.id) && !mock.tables.exams.has('exam-test-1') && !mock.tables.exercise_logs.has('log-test-1'));
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); app.close(); mock.srv.close();
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); app.close(); mock.srv.close(); process.exit(1); });
