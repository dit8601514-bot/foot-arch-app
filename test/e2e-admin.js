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
  await pu.goto(U + '#/self'); await pu.waitForSelector('#feetSeg'); await pu.click('#feetSeg button[data-v="left"]'); await pu.click('#go');
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
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); await b2.close(); mock.srv.close(); app.close();
  const pass = R.filter(r => r[1] === 'PASS').length; console.log(`\n${pass}/${R.length} 통과`);
  fs.writeFileSync(path.join(__dirname, 'e2e-admin-results.json'), JSON.stringify(R, null, 1));
  process.exit(pass === R.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
