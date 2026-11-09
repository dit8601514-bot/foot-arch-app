// 고정촬영판 E2E (test/e2e-self.js 복사본, dist/fixed 대상). 실행: node build.js && node fixed/e2e-self.js C  (영상은 README 방법으로 test/img에 생성)
// E2E: 음성 안내 자가 검사 + 체중부하 인지
//  시나리오 A(self.y4m): 앉음 0~14초 → 일어서는 중 14~16초(스티커 안 보임) → 선 자세 16초~(발활 하강) ⇒ "체중부하 확인했습니다. 촬영합니다."
//  시나리오 B(self_nochange.y4m): 같은 흐름이지만 선 자세에서 형태 변화 없음 ⇒ 재안내 후 "현재 자세로 체중부하 상태를 촬영합니다."
// node test/e2e-self.js [A|B]   (영상 생성법은 README 참고)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; if (u === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end('window.FOOTARCH_CONFIG={supabaseUrl:"",supabaseAnonKey:""};'); } const f = path.join(root, 'dist', 'fixed', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8767);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
fs.mkdirSync(path.join(__dirname, '..', 'test', 'shots'), { recursive: true });

async function scenario(tag, video, expectConfirmed, expectMm, opt) {
  opt = opt || {};
  expectMm = expectMm == null ? 7.14 : expectMm;
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, '..', 'test', 'img', video)] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  await ctx.addInitScript(d => { window.FOOTARCH_SHUTTER_DELAY = d.delay; window.FOOTARCH_POST_MODE = d.postMode; window.FOOTARCH_MMPX_SCALE = d.mmpxScale; if (d.posWait != null) window.FOOTARCH_POS_WAIT = d.posWait; window.FOOTARCH_STICKER_MM = 16; /* 합성 영상은 16 mm 스티커로 만들어짐 */ window.__workers = []; const OW = window.Worker; window.Worker = function (u, o) { const w = new OW(u, o); window.__workers.push(w); return w; }; window.__spoken = []; const sy = window.speechSynthesis; if (sy) { const orig = sy.speak.bind(sy); sy.speak = u => { if (u.text.trim()) window.__spoken.push(u.text); try { orig(u); } catch (e) {} }; } }, { delay: opt.delay == null ? 0 : opt.delay, postMode: opt.postMode || 'ai', mmpxScale: opt.mmpxScale || 0, posWait: opt.posWait });
  const pg = await ctx.newPage(); const errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = n => pg.screenshot({ path: path.join(__dirname, '..', 'test', 'shots', n + '.png'), fullPage: true });
  const U = 'http://localhost:8767/';
  await pg.goto(U + '#/r/calib'); await pg.fill('#p1', '1234'); await pg.fill('#p2', '1234'); await pg.click('#go');
  await pg.waitForSelector('#dia'); await pg.fill('#dia', '10'); await pg.click('#saveD'); await pg.waitForTimeout(300);
  await pg.setInputFiles('#vf', path.join(__dirname, '..', 'test', 'img', 'template.png')); await pg.waitForSelector('#vres .note');
  await pg.goto(U + '#/self'); await pg.waitForSelector('#feetSeg'); await pg.click('#feetSeg button[data-v="left"]');
  if (tag === 'A') await shot('s02-self-setup');
  const t0 = Date.now(); await pg.click('#go');
  { const bt = await pg.waitForFunction(() => { const b = document.querySelector('#distBadge'); return b && !b.classList.contains('hide') && b.textContent; }, null, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => '');
    log(`[${tag}] 촬영 거리 배지(25 cm 고정)`, /^거리 약 \d+ cm · 목표 25 cm/.test(bt), bt);
    await pg.waitForSelector('#distCal:not(.hide)', { timeout: 30000 }).catch(() => {});
    if (opt.mmpxScale) { // 멀리 둔 상황: 25 cm에 들어올 때까지 찍지 않아야 함 → 기기 거리 보정 후 진행
      await pg.waitForTimeout(9000);
      const held = await pg.evaluate(() => !window.__spoken.includes('촬영되었습니다.') && /25 cm에 맞춰/.test(document.querySelector('#status').textContent));
      log(`[${tag}] 거리 고정: 25 cm 밖이면 촬영 보류 + 안내`, held && (await pg.evaluate(() => window.__spoken.join(' '))).includes('25센티미터에 맞춰 주십시오'));
    }
    await pg.click('#distCal').catch(() => {}); await pg.waitForTimeout(400);
    log(`[${tag}] 거리 보정 버튼 → 이 휴대폰 계수 저장`, await pg.evaluate(() => S.settings.fovK > 0)); }
  if (opt.killAfterPre) { // 앉은 자세 촬영 직후 분석 워커가 응답 없이 죽는 상황(휴대폰 메모리 부족) 재현
    await pg.waitForFunction(() => window.__spoken.includes('촬영되었습니다.'), null, { timeout: 40000 });
    await pg.evaluate(() => window.__workers.forEach(w => w.terminate())); // onerror 없이 종료
  }
  await pg.waitForSelector('#vid'); await pg.waitForTimeout(4500); if (tag === 'A') await shot('s03-self-align'); if (tag === 'C') await shot('s03-std-align'); if (tag === 'R1') await shot('s03-rot-align');
  await pg.evaluate(() => { window.__cdSeen = false; const t = setInterval(() => { if (document.querySelector('.cdbig')) window.__cdSeen = true; if (location.hash.startsWith('#/result/')) clearInterval(t); }, 200); });
  // 체중부하 단계 화면(인지 카드) 캡처
  await pg.waitForFunction(() => document.querySelector('#lcMove') && document.querySelector('#lcMove').textContent === '확인', null, { timeout: 45000 }).catch(() => {});
  await pg.waitForTimeout(1500); if (tag === 'A') await shot('s04-self-load'); if (tag === 'C') await shot('s04-std-load');
  const ok = await pg.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const spoken = await pg.evaluate(() => window.__spoken), J = spoken.join(' ');
  log(`[${tag}] 손대지 않고 비체중부하·체중부하 자동 촬영 → 결과`, ok, secs + '초');
  log(`[${tag}] 시작: 타이머 없이 음성 "준비해 주세요"`, J.includes('준비해 주세요') && !J.includes('초 뒤에 시작합니다'));
  log(`[${tag}] 음성: 스티커 고정 안내`, spoken.some(s => s.includes('스티커 세 개를 찾았습니다')));
  log(`[${tag}] 음성: "앉은 자세를 촬영합니다"`, spoken.includes('앉은 자세를 촬영합니다.'));
  log(`[${tag}] 타이머 없음: 카운트다운 숫자·"초 뒤에" 안내 없음`, !(await pg.evaluate(() => window.__cdSeen)) && !/초 뒤에/.test(J));
  {
    log(`[${tag}] 음성: "체중부하 해주십시오"`, spoken.some(s => s.includes('체중부하 해주십시오')));
    log(`[${tag}] 음성: 일어서는 동작 인지`, spoken.some(s => s.includes('일어서는 동작을 확인했습니다')));
  }
  if (expectConfirmed) log(`[${tag}] 음성: "체중부하 확인했습니다. 촬영합니다."`, J.includes('체중부하 확인했습니다. 촬영합니다.'), spoken.join(' / '));
  else {
    log(`[${tag}] 형태 변화 없음 → 재안내`, J.includes('변화가 아직 작습니다. 양발에 체중을 똑같이 실어 주십시오'));
    log(`[${tag}] 확인 못 하면 "확인했습니다"라고 말하지 않음`, !J.includes('체중부하 확인했습니다') && spoken.includes('현재 자세로 체중부하 상태를 촬영합니다.'), spoken.join(' / '));
  }
  log(`[${tag}] 음성: "촬영되었습니다" 2회`, spoken.filter(s => s === '촬영되었습니다.').length === 2);
  if (ok) {
    await pg.waitForSelector('.result-big'); await shot(`s05-result-${tag}`);
    const big = (await pg.textContent('.result-big')).trim(), main = await pg.textContent('main');
    if (expectConfirmed) {
      log(`[${tag}] 결과: 앱 ${expectMm} mm + 기본 보정 3.7 = ${(expectMm + 3.7).toFixed(1)} mm · 중증`, big.includes('mm') && Math.abs(parseFloat(big) - (expectMm + 3.7)) <= 0.2 && main.includes('중증 평발 의심') && main.includes('보정 적용 · 앱 측정'), big);
      if (tag === 'C') {
        const ex = await pg.evaluate(async () => { const e = (await DB.all('exams'))[0]; return { line: e.comparison.lineChangeMm, floor: e.comparison.floor, pl: e.pre.measure.floor && e.pre.measure.floor.placement }; });
        log(`[${tag}] 바닥 기준 발배뼈 높이 ≈42→34mm, 하강 ≈8mm (표준 NDT 방식)`, ex.floor && Math.abs(ex.floor.preMm - 42) < 0.5 && Math.abs(ex.floor.postMm - 34) < 0.5 && Math.abs(ex.floor.dropMm - 8) < 0.4, JSON.stringify(ex.floor && { pre: ex.floor.preMm.toFixed(2), post: ex.floor.postMm.toFixed(2), drop: ex.floor.dropMm.toFixed(2) }));
        log(`[${tag}] P1·P3 부착 높이 표준(20mm) 점검 통과`, ex.pl && ex.pl.every(x => x.ok && Math.abs(x.mm - 20) < 0.6), JSON.stringify(ex.pl));
        await shot('d06-result'); await pg.click('#detailBtn'); await pg.waitForTimeout(200); await shot('d06b-result-detail');
        for (const [h, n] of [['#/home', 'd01-home'], ['#/records', 'd07-records'], ['#/exercises', 'd08-exercises']]) { await pg.goto(U + h); await pg.waitForTimeout(700); await shot(n); }
        await pg.goBack(); await pg.goBack(); await pg.goBack(); await pg.waitForSelector('.result-big');
        log(`[${tag}] 결과 화면에 두 측정값(기준선·바닥) 표시`, main.includes('P1–P3 기준선 하강') && main.includes('바닥 기준 발배뼈 높이') && !main.includes('바닥선 미확인'));
      }
      log(`[${tag}] 결과: 체중부하 인지 기록(일어섬·발활 하강)`, main.includes('일어섬 확인') && main.includes('발활 하강 확인'));
      log(`[${tag}] 유연성 평발 양상 안내`, main.includes('유연성 평발 양상'));
      { const ct = await pg.textContent('main');
        log(`[${tag}] 측정 결과에 AI 1:1 맞춤 창 없음 · 실측 입력만`, !ct.includes('AI 1:1 맞춤 케어') && !ct.includes('나만의 관리 계획') && await pg.isVisible('#refCard'));
        await pg.click('#refBtn'); await pg.fill('#rPre', '4.4'); await pg.fill('#rPost', '3.2'); await pg.click('.modal-bg:has(#rPre) [data-a="ok"]'); await pg.waitForTimeout(500);
        const ct2 = await pg.textContent('#careBox'); const refSaved = await pg.evaluate(async () => { const a = (await DB.all('exams')).filter(x => x.reference); return a[0] && a[0].reference; });
        log(`[${tag}] 실측 전·후 높이(cm) 입력 → 저장(오차 학습용)`, ct2.includes('실제 잰 값 수정') && refSaved && Math.abs(refSaved.preMm - 44) < 0.01 && Math.abs(refSaved.postMm - 32) < 0.01 && Math.abs(refSaved.ndtMm - 12) < 0.01, ct2.slice(0, 200)); }
      await pg.check('[data-sq="restFlat"]'); await pg.waitForTimeout(300);
      log(`[${tag}] 자가 확인 질문 → 전문가 상담 안내`, await pg.isVisible('text=전문가 상담을 권합니다'));
      await pg.reload(); await pg.waitForSelector('#flex'); log(`[${tag}] 자가 확인 응답 저장 유지`, await pg.isChecked('[data-sq="restFlat"]'));
      log(`[${tag}] 결과: 발 크기 정규화 지표·PDF 리포트 버튼`, await pg.isVisible('#normCard') && (await pg.textContent('#normCard')).includes('발 길이 대비 하강률') && await pg.isVisible('#printBtn'));
      await pg.locator('#normCard').screenshot({ path: path.join(__dirname, '..', 'test', 'shots', 's05b-norm.png') }).catch(() => {});
      await pg.goto(U + '#/manage'); await pg.waitForSelector('text=최근 하강'); await shot('s06-manage'); log(`[${tag}] 관리 현황`, true);
      await pg.click('#progStart'); await pg.waitForSelector('#progCard .badge'); log(`[${tag}] 6주 숏풋 프로그램 시작 → 주차 표시`, (await pg.textContent('#progCard')).includes('1/6주'));
      await pg.locator('#progCard').screenshot({ path: path.join(__dirname, '..', 'test', 'shots', 's06b-program.png') }).catch(() => {});
    } else {
      log(`[${tag}] 결과: 변화량 ≈0 · 정상 범위`, parseFloat(big) <= 4.6 && main.includes('정상 범위'), big);
      log(`[${tag}] 결과: "형태 변화 작음"으로 정직하게 기록`, main.includes('형태 변화 작음'));
    }
  }
  log(`[${tag}] 페이지 스크립트 오류 없음`, errors.length === 0, errors.join(' | '));
  await b.close();
}
(async () => {
  const which = process.argv[2];
  if (!which || which === 'A') await scenario('A', 'self.y4m', true);
  if (!which || which === 'B') await scenario('B', 'self_nochange.y4m', false);
  if (!which || which === 'C') await scenario('C', 'self_std.y4m', true, 8.0);
  // 휴대폰을 가로로 눕혔는데 화면은 세로로 고정된 경우(영상이 세로로 들어옴) — 양쪽 방향 모두
  // 일어선 뒤 발이 목표 원에서 조금 벗어난 경우(실사용) — 그래도 선 자세가 찍혀야 한다
  if (!which || which === 'S') await scenario('S', 'self_std_shift.y4m', true, 8.0);
  // 예전 설정(시작 타이머 10초)이 남아 있어도 시작 타이머 없이 "준비해 주세요" 후 진행
  if (!which || which === 'T') await scenario('T', 'self_std_long.y4m', true, 8.0, { delay: 10 });
  // 휴대폰이 계속 미세하게 흔들림(±5px·±0.4°) — 발은 가만히 있으므로 정상 촬영되어야 함
  // 예전 설정(선 자세 타이머)이 남아 있어도 타이머 없이 AI 인지로 진행
  if (!which || which === 'M') await scenario('M', 'self_std.y4m', true, 8.0, { postMode: 'timer' });
  if (!which || which === 'D') await scenario('D', 'self_std.y4m', true, 8.0, { mmpxScale: 3 }); // 멀리 둔 상황(해상도 3배 거칠게) 재현
  // 회전 영상은 발이 화면 가운데에서 벗어나 있음(합성 영상 — 발을 옮길 수 없음): 앞뒤 안내 대기 시간 짧게
  if (!which || which === 'MR') await scenario('MR', 'self_std_rot90.y4m', true, 8.0, { posWait: 4000 });
  if (!which || which === 'H') await scenario('H', 'self_std_shake.y4m', true, 8.0);
  if (!which || which === 'K') await scenario('K', 'self_std.y4m', true, 8.0, { killAfterPre: true });
  if (!which || which === 'R1') await scenario('R1', 'self_std_rot90.y4m', true, 8.0, { posWait: 4000 });
  if (!which || which === 'R2') await scenario('R2', 'self_std_rot270.y4m', true, 8.0, { posWait: 4000 });
  srv.close();
  fs.writeFileSync(path.join(__dirname, '..', 'test', 'e2e-fixed-results.json'), JSON.stringify(R, null, 1));
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
