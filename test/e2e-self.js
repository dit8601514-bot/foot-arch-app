// E2E: 음성 안내 자가 검사 + 체중부하 인지
//  시나리오 A(self.y4m): 앉음 0~14초 → 일어서는 중 14~16초(스티커 안 보임) → 선 자세 16초~(아치 하강) ⇒ "체중부하 확인했습니다. 촬영합니다."
//  시나리오 B(self_nochange.y4m): 같은 흐름이지만 선 자세에서 형태 변화 없음 ⇒ 재안내 후 "현재 자세로 체중부하 상태를 촬영합니다."
// node test/e2e-self.js [A|B]   (영상 생성법은 README 참고)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; if (u === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end('window.FOOTARCH_CONFIG={supabaseUrl:"",supabaseAnonKey:""};'); } const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8767);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

async function scenario(tag, video, expectConfirmed, expectMm, opt) {
  opt = opt || {};
  expectMm = expectMm == null ? 7.14 : expectMm;
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img', video)] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  await ctx.addInitScript(d => { window.FOOTARCH_SHUTTER_DELAY = d.delay; window.FOOTARCH_POST_MODE = d.postMode; window.FOOTARCH_STICKER_MM = 16; /* 합성 영상은 16 mm 스티커로 만들어짐 */ window.__workers = []; const OW = window.Worker; window.Worker = function (u, o) { const w = new OW(u, o); window.__workers.push(w); return w; }; window.__spoken = []; const sy = window.speechSynthesis; if (sy) { const orig = sy.speak.bind(sy); sy.speak = u => { if (u.text.trim()) window.__spoken.push(u.text); try { orig(u); } catch (e) {} }; } }, { delay: opt.delay == null ? 0 : opt.delay, postMode: opt.postMode || 'ai' });
  const pg = await ctx.newPage(); const errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = n => pg.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
  const U = 'http://localhost:8767/';
  await pg.goto(U + '#/r/calib'); await pg.fill('#p1', '1234'); await pg.fill('#p2', '1234'); await pg.click('#go');
  await pg.waitForSelector('#dia'); await pg.fill('#dia', '10'); await pg.click('#saveD'); await pg.waitForTimeout(300);
  await pg.setInputFiles('#vf', path.join(__dirname, 'img/template.png')); await pg.waitForSelector('#vres .note');
  await pg.goto(U + '#/self'); await pg.waitForSelector('#feetSeg'); await pg.click('#feetSeg button[data-v="left"]');
  if (tag === 'A') await shot('s02-self-setup');
  const t0 = Date.now(); await pg.click('#go');
  if (opt.killAfterPre) { // 앉은 자세 촬영 직후 분석 워커가 응답 없이 죽는 상황(휴대폰 메모리 부족) 재현
    await pg.waitForFunction(() => window.__spoken.includes('촬영되었습니다.'), null, { timeout: 40000 });
    await pg.evaluate(() => window.__workers.forEach(w => w.terminate())); // onerror 없이 종료
  }
  await pg.waitForSelector('#vid'); await pg.waitForTimeout(4500); if (tag === 'A') await shot('s03-self-align'); if (tag === 'C') await shot('s03-std-align'); if (tag === 'R1') await shot('s03-rot-align');
  let window_cd_seen = false;
  if (opt.postMode === 'timer') { window_cd_seen = await pg.waitForFunction(() => window.__spoken.includes('촬영되었습니다.') && document.querySelector('.cdbig'), null, { timeout: 45000 }).then(() => true).catch(() => false); if (tag === 'M') await shot('s04-timer-countdown'); }
  // 체중부하 단계 화면(인지 카드) 캡처
  if (opt.postMode !== 'timer') await pg.waitForFunction(() => document.querySelector('#lcMove') && document.querySelector('#lcMove').textContent === '확인', null, { timeout: 45000 }).catch(() => {});
  await pg.waitForTimeout(1500); if (tag === 'A') await shot('s04-self-load'); if (tag === 'C') await shot('s04-std-load');
  const ok = await pg.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const spoken = await pg.evaluate(() => window.__spoken), J = spoken.join(' ');
  log(`[${tag}] 손대지 않고 비체중부하·체중부하 자동 촬영 → 결과`, ok, secs + '초');
  if (opt.delay) log(`[${tag}] 시작 타이머 안내(${opt.delay}초)`, J.includes(`${opt.delay}초 뒤에 시작합니다`));
  log(`[${tag}] 음성: 정확한 정렬 안내`, spoken.some(s => s.includes('정확히 들어왔습니다')));
  log(`[${tag}] 음성: "앉은 자세를 촬영합니다"`, spoken.includes('앉은 자세를 촬영합니다.'));
  const timerMode = opt.postMode === 'timer';
  if (timerMode) {
    log(`[${tag}] 음성: "그대로 일어서서… 10초 뒤에 체중부하 사진을 찍습니다"`, J.includes('이제 그대로 일어서서') && J.includes('10초 뒤에 체중부하 사진을 찍습니다'));
    log(`[${tag}] 선 자세 타이머 표시(10→1)`, !!window_cd_seen);
  } else {
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
      log(`[${tag}] 결과: 변화량 ≈${expectMm}mm · 경증`, Math.abs(parseFloat(big) - expectMm) <= 0.2 && main.includes('경증 평발 의심'), big);
      if (tag === 'C') {
        const ex = await pg.evaluate(async () => { const e = (await DB.all('exams'))[0]; return { line: e.comparison.lineChangeMm, floor: e.comparison.floor, pl: e.pre.measure.floor && e.pre.measure.floor.placement }; });
        log(`[${tag}] 바닥 기준 발배뼈 높이 ≈42→34mm, 하강 ≈8mm (표준 NDT 방식)`, ex.floor && Math.abs(ex.floor.preMm - 42) < 0.5 && Math.abs(ex.floor.postMm - 34) < 0.5 && Math.abs(ex.floor.dropMm - 8) < 0.4, JSON.stringify(ex.floor && { pre: ex.floor.preMm.toFixed(2), post: ex.floor.postMm.toFixed(2), drop: ex.floor.dropMm.toFixed(2) }));
        log(`[${tag}] P1·P3 부착 높이 표준(20mm) 점검 통과`, ex.pl && ex.pl.every(x => x.ok && Math.abs(x.mm - 20) < 0.6), JSON.stringify(ex.pl));
        await shot('d06-result'); await pg.click('#detailBtn'); await pg.waitForTimeout(200); await shot('d06b-result-detail');
        for (const [h, n] of [['#/home', 'd01-home'], ['#/records', 'd07-records'], ['#/exercises', 'd08-exercises']]) { await pg.goto(U + h); await pg.waitForTimeout(700); await shot(n); }
        await pg.goBack(); await pg.goBack(); await pg.goBack(); await pg.waitForSelector('.result-big');
        log(`[${tag}] 결과 화면에 두 측정값(기준선·바닥) 표시`, main.includes('P1–P3 기준선 하강') && main.includes('바닥 기준 발배뼈 높이') && !main.includes('바닥선 미확인'));
      }
      if (!timerMode) log(`[${tag}] 결과: 체중부하 인지 기록(일어섬·아치 하강)`, main.includes('일어섬 확인') && main.includes('아치 하강 확인'));
      else log(`[${tag}] 결과: 아치 하강 확인 기록`, main.includes('아치 하강 확인'));
      log(`[${tag}] 유연성 평발 양상 안내`, main.includes('유연성 평발 양상'));
      { await pg.waitForSelector('.care-card', { timeout: 5000 }).catch(() => {}); const ct = await pg.textContent('#careBox').catch(() => '');
        log(`[${tag}] AI 1:1 맞춤 케어: 개인 추정·관리 계획·전문가 값 입력`, ct.includes('AI 1:1 맞춤 케어') && ct.includes('개인 맞춤 추정') && ct.includes('나만의 관리 계획') && ct.includes('전문가 측정값'), ct.slice(0, 120));
        await pg.click('#refBtn'); await pg.fill('#refIn', '9.5'); await pg.click('[data-a="ok"]'); await pg.waitForTimeout(500);
        const ct2 = await pg.textContent('#careBox'); log(`[${tag}] 전문가 값 입력 → 내 오차 보정 학습`, ct2.includes('내 오차 보정') && ct2.includes('전문가 값 1회 학습'), ct2.slice(0, 160)); }
      await pg.check('[data-sq="restFlat"]'); await pg.waitForTimeout(300);
      log(`[${tag}] 자가 확인 질문 → 전문가 상담 안내`, await pg.isVisible('text=전문가 상담을 권합니다'));
      await pg.reload(); await pg.waitForSelector('#flex'); log(`[${tag}] 자가 확인 응답 저장 유지`, await pg.isChecked('[data-sq="restFlat"]'));
      await pg.goto(U + '#/manage'); await pg.waitForSelector('text=최근 하강'); await shot('s06-manage'); log(`[${tag}] 관리 현황`, true);
    } else {
      log(`[${tag}] 결과: 변화량 ≈0 · 정상 범위`, parseFloat(big) <= 0.3 && main.includes('정상 범위'), big);
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
  // 시작 타이머 10초(실사용 기본값): 카운트다운 안내 후 정상 진행
  if (!which || which === 'T') await scenario('T', 'self_std_long.y4m', true, 8.0, { delay: 10 });
  // 휴대폰이 계속 미세하게 흔들림(±5px·±0.4°) — 발은 가만히 있으므로 정상 촬영되어야 함
  // 기본 방식: 가이드에 맞으면 앉은 자세 → 일어서기 → 10초 타이머 후 선 자세
  if (!which || which === 'M') await scenario('M', 'self_std.y4m', true, 8.0, { postMode: 'timer' });
  if (!which || which === 'MR') await scenario('MR', 'self_std_rot90.y4m', true, 8.0, { postMode: 'timer' });
  if (!which || which === 'H') await scenario('H', 'self_std_shake.y4m', true, 8.0);
  if (!which || which === 'K') await scenario('K', 'self_std.y4m', true, 8.0, { killAfterPre: true });
  if (!which || which === 'R1') await scenario('R1', 'self_std_rot90.y4m', true, 8.0);
  if (!which || which === 'R2') await scenario('R2', 'self_std_rot270.y4m', true, 8.0);
  srv.close();
  fs.writeFileSync(path.join(__dirname, 'e2e-self-results.json'), JSON.stringify(R, null, 1));
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
