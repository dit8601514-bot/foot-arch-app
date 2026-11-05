// E2E: 관리자 앱(/admin)과 사용자 앱 분리 + AI 오차 보정 학습·배포·적용 (모의 Supabase)
// node test/e2e-admin.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const { createMock } = require('./mock-supabase');
const C = require('../src/core.js');
const root = path.join(__dirname, '..'), ANON = 'test-anon-key', API = 'http://localhost:8793';
const mock = createMock(ANON); mock.srv.listen(8793);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const app = http.createServer((q, s) => {
  let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
  if (u === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(`window.FOOTARCH_CONFIG={supabaseUrl:'${API}',supabaseAnonKey:'${ANON}',emailDomain:'users.footarch.app'};`); }
  const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f));
}).listen(8792);
const U = 'http://localhost:8792/';
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
const shot = (pg, n) => pg.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
const api = async (p, { method = 'GET', body, token } = {}) => { const r = await fetch(API + p, { method, headers: Object.assign({ apikey: ANON, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body == null ? undefined : JSON.stringify(body) }); const t = await r.text(); return { status: r.status, json: t ? JSON.parse(t) : null }; };
async function signup(un, research) {
  const now = new Date().toISOString();
  const r = await api('/auth/v1/signup', { method: 'POST', body: { email: un + '@users.footarch.app', password: 'footarch2026', data: { username: un, name: '참여자' + un.slice(-2), phone: '010-1111-' + String(1000 + un.length).slice(-4), consent_privacy_at: now, consent_sensitive_at: now, consent_research: research } } });
  return r.json;
}
// 체계적 오차가 있는 합성 측정(앱이 실제보다 15% 크게 + 발 기울기만큼 더 크게 잰다고 가정)
let seed = 9; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
function synthExam(id, foot) {
  const ref = 4 + 10 * rnd(), tilt = 6 * rnd(), ai = ref * 1.15 + 0.3 * tilt - 0.6 + 0.35 * gauss();
  const data = { id, createdAt: Date.now() - Math.floor(rnd() * 1e8), foot, comparison: { status: '측정 가능', changeMm: ai, floor: { dropMm: ai * 0.98 + 0.3 * gauss(), preMm: 40 + 2 * gauss() }, archAngle: { change: 8 + 2 * gauss() } }, category: C.classify(ai), pre: { measure: { axisAngleDeg: tilt }, quality: { diameterPx: 26 + 4 * gauss(), sizeCv: 0.02 } }, loadRecognition: { final: { spanGain: 0.01 } } };
  return { row: { id, created_at: new Date(data.createdAt).toISOString(), foot, data }, ref };
}
(async () => {
  // ── 서버 준비: 연구 동의자 12명(각 2건), 미동의자 1명, 관리자 1명 ──
  const refs = [];
  for (let i = 0; i < 12; i++) {
    const s = await signup('research' + String(i).padStart(2, '0'), true);
    const rows = ['left', 'right'].map((f, k) => synthExam(`ex-${i}-${k}`, f));
    await api('/rest/v1/exams?on_conflict=id', { method: 'POST', token: s.access_token, body: rows.map(r => r.row) });
    rows.forEach(r => refs.push({ exam_id: r.row.id, user_id: s.user.id, clinical_mm: Number(r.ref.toFixed(1)) }));
  }
  const priv = await signup('private01', false);
  await api('/rest/v1/exams?on_conflict=id', { method: 'POST', token: priv.access_token, body: [synthExam('ex-private', 'left').row] });
  const adm = await signup('admin01', false); mock.makeAdmin('admin01');
  const adminToken = (await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: 'admin01@users.footarch.app', password: 'footarch2026' } })).json.access_token;

  // 서버 규칙 직접 확인
  const asUser = await api('/rest/v1/exams?select=id', { token: (await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: 'research00@users.footarch.app', password: 'footarch2026' } })).json.access_token });
  log('[서버] 일반 사용자는 자기 기록만 읽음', asUser.json.length === 2 && asUser.json.every(r => r.id.startsWith('ex-0-')), asUser.json.map(r => r.id).join(','));
  const asAdmin = await api('/rest/v1/exams?select=id', { token: adminToken });
  log('[서버] 관리자는 연구 동의자 기록만 읽음(미동의자 기록 제외)', asAdmin.json.length === 24 && !asAdmin.json.some(r => r.id === 'ex-private'), String(asAdmin.json.length));
  const badRef = await api('/rest/v1/reference_ndt', { method: 'POST', token: adminToken, body: [{ exam_id: 'ex-private', user_id: priv.user.id, clinical_mm: 5 }] });
  log('[서버] 미동의자 기록에는 기준값을 넣을 수 없음', badRef.status === 403, String(badRef.status));
  const userWrite = await api('/rest/v1/calibration_models', { method: 'POST', token: priv.access_token, body: [{ id: 'hack', version: 99, data: { method: 'bias', bias: 50 }, active: true }] });
  log('[서버] 일반 사용자는 AI 모델을 올릴 수 없음', userWrite.status === 403, String(userWrite.status));

  const b = await chromium.launch(); const errors = [];
  // ── 관리자 앱: 일반 계정 거부 ──
  const AC = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pa = await AC.newPage(); pa.on('pageerror', e => errors.push('admin: ' + e.message));
  await pa.goto(U + 'admin/'); await pa.waitForSelector('#u');
  await pa.fill('#u', 'research00'); await pa.fill('#p', 'footarch2026'); await pa.click('#go');
  await pa.waitForSelector('.note.bad', { timeout: 5000 }).catch(() => {});
  log('[관리자 앱] 관리자가 아닌 계정은 들어갈 수 없음', (await pa.textContent('#view')).includes('관리자 권한이 없습니다'));
  await pa.fill('#u', 'admin01'); await pa.fill('#p', 'footarch2026'); await pa.click('#go');
  await pa.waitForSelector('text=전체 가입자', { timeout: 8000 }); await pa.waitForTimeout(300); await shot(pa, 'm01-admin-dash');
  const dash = await pa.textContent('#view');
  log('[관리자 앱] 대시보드: 전체 14명·동의 12명·측정 25건(미동의자는 숫자로만)', /14\s*전체 가입자/.test(dash) && /12\s*연구 활용 동의자/.test(dash) && /25\s*전체 측정 건수/.test(dash) && /24\s*동의자 측정 건수/.test(dash), dash.replace(/\s+/g, ' ').slice(0, 200));
  await pa.click('text=사용자·측정'); await pa.waitForSelector('table'); await shot(pa, 'm02-admin-users');
  const ul = await pa.textContent('#view');
  log('[관리자 앱] 사용자 목록: 동의자만, 전화번호 가림', ul.includes('@research00') && !ul.includes('private01') && !ul.includes('admin01') && ul.includes('010-****-'), ul.replace(/\s+/g, ' ').slice(0, 300));
  // 첫 사용자의 두 측정에 임상 NDT를 화면에서 입력
  await pa.click('tr:has-text("@research00") a'); await pa.waitForSelector('input.num');
  const mine = refs.filter(r => r.exam_id.startsWith('ex-0-'));
  for (const r of mine) { const tr = pa.locator(`tr[data-id="${r.exam_id}"]`); await tr.locator('input.num').fill(String(r.clinical_mm)); await tr.locator('input.who').fill('KJ'); await tr.locator('button.save').click(); await pa.waitForTimeout(300); }
  await shot(pa, 'm03-admin-user-detail');
  log('[관리자 앱] 측정별 임상 NDT 입력·저장', mine.every(r => mock.tables.reference_ndt.get(r.exam_id) && Math.abs(mock.tables.reference_ndt.get(r.exam_id).clinical_mm - r.clinical_mm) < 1e-9 && mock.tables.reference_ndt.get(r.exam_id).measured_by === 'KJ'));
  // 나머지 기준값은 서버에 바로 넣음(관리자 권한)
  const rest = await api('/rest/v1/reference_ndt?on_conflict=exam_id', { method: 'POST', token: adminToken, body: refs.filter(r => !r.exam_id.startsWith('ex-0-')) });
  log('[서버] 관리자 기준값 일괄 입력', rest.status === 201 && mock.tables.reference_ndt.size === 24, String(mock.tables.reference_ndt.size));
  // 오차 분석
  await pa.goto(U + 'admin/#/errors'); await pa.waitForSelector('svg.chart'); await shot(pa, 'm04-admin-errors');
  { const t = await pa.textContent('#view'); const m = t.match(/타당도: 앱 vs 임상 NDT\d+([\d.]+)/); log('[관리자] 신뢰도 리포트(ICC·SEM·MDC·논문 문장)', t.includes('신뢰도 리포트') && !!m && t.includes('논문 문장 초안'), m ? 'ICC ' + m[1] : ''); await pa.evaluate(() => { const h = [...document.querySelectorAll('h2')].find(x => x.textContent.includes('신뢰도 리포트')); if (h) { const w = document.createElement('div'); w.id = 'relWrap'; h.before(w); let n = h; const list = []; while (n) { list.push(n); n = n.nextElementSibling; } list.forEach(x => w.appendChild(x)); } }); await pa.locator('#relWrap').screenshot({ path: path.join(__dirname, 'shots', 'm04b-admin-reliability.png') }).catch(() => {}); }
  log('[관리자 앱] 오차 분석: 지표 표 + Bland–Altman', (await pa.textContent('#view')).includes('평균 절대 오차') && await pa.locator('svg.chart circle').count() === 24);
  // AI 학습·배포
  await pa.click('text=AI 보정 모델'); await pa.waitForSelector('#train'); await pa.click('#train'); await pa.waitForSelector('#res .note', { timeout: 30000 });
  const res = await pa.textContent('#res'); await shot(pa, 'm05-admin-ai');
  log('[관리자 앱] AI 학습: 교차검증으로 오차 감소 확인 → 배포 가능', res.includes('줄었습니다') && await pa.isEnabled('#deploy'), res.replace(/\s+/g, ' ').slice(0, 160));
  await pa.click('#deploy'); await pa.waitForSelector('text=배포 중', { timeout: 8000 });
  const act = [...mock.tables.calibration_models.values()].filter(m => m.active);
  log('[관리자 앱] 모델 v1 배포(활성 모델 1개)', act.length === 1 && act[0].version === 1 && act[0].data.method !== 'identity', act[0] && act[0].data.method);
  const anonModel = await api('/rest/v1/calibration_models?select=id,version,data&active=eq.true&limit=1');
  log('[서버] 배포된 모델은 로그인 없이도 읽기 가능(사용자 앱용)', anonModel.status === 200 && anonModel.json.length === 1);

  // ── 사용자 앱(분리된 세션): 동의자가 카메라로 측정 → 결과에 AI 보정 표시 ──
  const b2 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img', 'self_std.y4m')] });
  const UC = await b2.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  await UC.addInitScript(() => { window.FOOTARCH_SHUTTER_DELAY = 0; window.FOOTARCH_POST_MODE = 'ai'; });
  const pu = await UC.newPage(); pu.on('pageerror', e => errors.push('user: ' + e.message));
  await pu.goto(U + '#/auth/login'); await pu.waitForSelector('#un'); await pu.fill('#un', 'research00'); await pu.fill('#pw', 'footarch2026'); await pu.click('#go');
  await pu.waitForFunction(() => location.hash === '#/home', null, { timeout: 8000 }).catch(() => {});
  log('[사용자 앱] 관리자 앱과 로그인 정보가 분리됨(관리자 세션 없음)', await pu.evaluate(() => !localStorage.getItem('footarch.admin.session') && !!localStorage.getItem('footarch.session')));
  await pu.evaluate(() => Account.sync()); await pu.waitForTimeout(400);
  log('[사용자 앱] 동기화로 본인 기록만 내려받음', await pu.evaluate(async () => { const a = await DB.all('exams'); return a.length === 2 && a.every(e => e.id.startsWith('ex-0-')); }));
  await pu.goto(U + '#/self'); await pu.waitForSelector('#feetSeg'); await pu.click('#feetSeg button[data-v="left"]'); await pu.click('#go'); await pu.waitForSelector('#distCal:not(.hide)', { timeout: 40000 }).catch(() => {}); await pu.click('#distCal').catch(() => {}); // 25 cm 거리 보정
  const okRes = await pu.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 90000 }).then(() => true).catch(() => false);
  if (okRes) { await pu.waitForSelector('.result-big'); await shot(pu, 'm06-user-result-ai'); }
  const main = okRes ? await pu.textContent('main') : '';
  const ai = await pu.evaluate(async () => { const a = (await DB.all('exams')).filter(e => !e.id.startsWith('ex-')); return a[0] && a[0].aiCorrection; });
  log('[사용자 앱] 측정 결과에 "AI 보정 (임상 NDT 추정)" 표시', okRes && main.includes('AI 보정 (임상 NDT 추정)') && main.includes('모델 v1') && ai && isFinite(ai.mm), ai ? `${ai.mm.toFixed(2)} mm ±${ai.piMm.toFixed(2)}` : 'none');
  const own = await pu.evaluate(async () => { const a = (await DB.all('exams')).filter(e => !e.id.startsWith('ex-')); return a[0] && { mm: a[0].comparison.changeMm, cat: a[0].category && a[0].category.label }; });
  log('[사용자 앱] 앱 측정값·분류는 바뀌지 않고 AI 보정은 별도 값으로 표시', own && main.includes(own.mm.toFixed(1) + ' mm') && main.includes(own.cat) && Math.abs(ai.mm - own.mm) > 0.05, own && `앱 ${own.mm.toFixed(2)} mm(${own.cat}) / AI ${ai && ai.mm.toFixed(2)} mm`);
  // 배포 중지 → 사용자 앱에서 모델 없음
  await pa.goto(U + 'admin/#/ai'); await pa.waitForSelector('#deact'); await pa.click('#deact'); await pa.waitForTimeout(600);
  const after = await pu.evaluate(() => Account.fetchAiModel());
  log('[관리자 앱] 배포 중지하면 사용자 앱은 보정 없이 앱 값만 사용', after === null);
  // ── 운동(중재) 영상: 관리자가 올리면 사용자 앱에 반영 ──
  pa.on('dialog', d => d.accept());
  await pa.goto(U + 'admin/#/content'); await pa.waitForSelector('#seed'); await shot(pa, 'm07-admin-content-empty');
  await pa.click('#seed'); await pa.waitForFunction(() => document.querySelectorAll('a[href^="#/content/"]').length >= 4, null, { timeout: 6000 }).catch(() => {});
  const rowsN = [...mock.tables.exercise_content.values()].length;
  log('[관리자 앱] 운동 영상: 기본 운동 3개 불러오기', rowsN === 3, 'rows=' + rowsN);
  const first = [...mock.tables.exercise_content.values()].sort((a, b) => a.sort - b.sort)[0];
  await pa.goto(U + 'admin/#/content/' + first.id); await pa.waitForSelector('#vf', { state: 'attached' });
  await pa.setInputFiles('#vf', path.join(__dirname, 'img/ex.mp4')); await pa.fill('#re', '10'); await pa.fill('#se', '3');
  await pa.waitForSelector('#pv video'); await shot(pa, 'm08-admin-content-edit');
  await pa.click('#save'); await pa.waitForFunction(() => location.hash === '#/content', null, { timeout: 10000 }).catch(() => {});
  const up = mock.tables.exercise_content.get(first.id);
  log('[관리자 앱] 영상 파일 올리기 → 저장소에 저장·운동에 연결', up && up.video_path && mock.files.has('exercise-videos/' + up.video_path) && up.reps === '10', up && up.video_path);
  await pa.goto(U + 'admin/#/content/new'); await pa.waitForSelector('#nm'); await pa.fill('#nm', '발가락 벌리기'); await pa.fill('#vu', 'https://youtu.be/dQw4w9WgXcQ');
  await pa.check('[data-cat="mild"]'); await pa.click('#save'); await pa.waitForFunction(() => location.hash === '#/content', null, { timeout: 8000 }).catch(() => {});
  const ytRow = [...mock.tables.exercise_content.values()].find(r => r.name === '발가락 벌리기');
  log('[관리자 앱] 유튜브 링크로 운동 추가', ytRow && ytRow.video_url === 'https://youtu.be/dQw4w9WgXcQ' && ytRow.categories.includes('mild'));
  await pa.waitForSelector('table'); await shot(pa, 'm09-admin-content-list');
  const userTok = (await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: 'research01@users.footarch.app', password: 'footarch2026' } })).json.access_token;
  const hack = await api('/rest/v1/exercise_content', { method: 'POST', token: userTok, body: { id: 'x', name: '해킹', published: true } });
  const hackUp = await fetch(API + '/storage/v1/object/exercise-videos/x/evil.mp4', { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + userTok, 'Content-Type': 'video/mp4' }, body: Buffer.from('x') });
  log('[서버] 일반 사용자는 운동·영상을 올릴 수 없음', hack.status === 403 && hackUp.status === 403, hack.status + '/' + hackUp.status);
  await pu.goto(U + '#/exercises'); await pu.waitForSelector('.vcard'); await pu.waitForTimeout(800);
  const ex = await pu.evaluate(async () => (await DB.all('exercises')).filter(x => x.server).map(x => ({ id: x.id, name: x.name, url: x.videoUrl, cats: x.categories })));
  const exTxt = await pu.textContent('main'); await shot(pu, 'm10-user-exercises');
  log('[사용자 앱] 관리자가 올린 운동 4개가 발활 재활영상에 표시', ex.length === 4 && exTxt.includes('발가락 벌리기'), ex.map(x => x.name).join(', '));
  const vx = ex.find(x => x.id === 'srv-' + first.id);
  await pu.goto(U + '#/exercise/' + vx.id); await pu.waitForSelector('#vid');
  const vok = await pu.evaluate(() => new Promise(r => { const v = document.querySelector('#vid'); if (v.readyState >= 1) return r(true); v.addEventListener('loadedmetadata', () => r(true)); v.addEventListener('error', () => r(false)); setTimeout(() => r(v.readyState >= 1), 5000); }));
  await shot(pu, 'm11-user-exercise-video');
  log('[사용자 앱] 올린 영상이 운동 화면에서 재생됨', vok && (await pu.getAttribute('#vid', 'src')).includes('/storage/v1/object/public/exercise-videos/'));
  const ytx = ex.find(x => x.name === '발가락 벌리기');
  await pu.goto(U + '#/exercise/' + ytx.id); await pu.waitForSelector('.ex.yt iframe');
  log('[사용자 앱] 유튜브 링크는 영상 플레이어로 표시', (await pu.getAttribute('.ex.yt iframe', 'src')).includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  log('[사용자 앱] 분류 연결: 정상 범위 결과에 관리자 지정 운동', await pu.evaluate(id => (S.settings.mapping.normal || []).includes(id), 'srv-' + first.id));
  await pa.goto(U + 'admin/#/content/' + ytRow.id); await pa.waitForSelector('#del'); await pa.click('#del'); await pa.waitForFunction(() => location.hash === '#/content', null, { timeout: 6000 }).catch(() => {});
  await pu.evaluate(() => Account.syncContent(true));
  log('[관리자 앱] 운동 삭제 → 사용자 앱에서도 사라짐', !mock.tables.exercise_content.has(ytRow.id) && await pu.evaluate(async () => !(await DB.all('exercises')).some(x => x.name === '발가락 벌리기')));
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); await b2.close(); mock.srv.close(); app.close();
  const pass = R.filter(r => r[1] === 'PASS').length; console.log(`\n${pass}/${R.length} 통과`);
  fs.writeFileSync(path.join(__dirname, 'e2e-admin-results.json'), JSON.stringify(R, null, 1));
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
