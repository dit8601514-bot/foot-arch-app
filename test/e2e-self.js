// E2E: 음성 안내 자가 검사 — 앉음(0~8초) → 일어서는 중(8~10초, 스티커 안 보임) → 선 자세(10초~) 가상 카메라
// node test/e2e-self.js  (test/img/self.y4m 필요, README 참고)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8767);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img/self.y4m'), '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  // 음성 출력 기록: speechSynthesis.speak 호출 문장을 수집
  await ctx.addInitScript(() => { window.__spoken = []; const orig = window.speechSynthesis && window.speechSynthesis.speak.bind(window.speechSynthesis); if (orig) window.speechSynthesis.speak = u => { if (u.text.trim()) window.__spoken.push({ t: performance.now(), text: u.text }); try { orig(u); } catch (e) {} }; });
  const pg = await ctx.newPage(); const errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = n => pg.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const U = 'http://localhost:8767/';
  // 사전 준비: 스티커 지름·환산 검증
  await pg.goto(U + '#/r/calib'); await pg.fill('#p1', '1234'); await pg.fill('#p2', '1234'); await pg.click('#go');
  await pg.waitForSelector('#dia'); await pg.fill('#dia', '10'); await pg.click('#saveD'); await pg.waitForTimeout(300);
  await pg.setInputFiles('#vf', path.join(__dirname, 'img/template.png')); await pg.waitForSelector('#vres .note');
  await pg.goto(U + '#/home'); await pg.waitForSelector('text=음성 안내 자가 검사'); await shot('s01-home');
  await pg.click('text=음성 안내 자가 검사'); await pg.waitForSelector('#feetSeg');
  await pg.click('#feetSeg button[data-v="left"]'); await shot('s02-self-setup');
  const t0 = Date.now(); await pg.click('#go');
  await pg.waitForSelector('#vid'); await pg.waitForTimeout(2500); await shot('s03-self-run');
  const ok = await pg.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log('손대지 않고 앉은 자세·선 자세 자동 촬영 → 결과 화면', ok, secs + '초');
  const spoken = await pg.evaluate(() => window.__spoken.map(s => s.text));
  log('음성: “찍습니다” 2회(앉음·섬)', spoken.filter(s => s === '찍습니다').length === 2, spoken.join(' / '));
  log('음성: 일어서기 안내', spoken.some(s => s.includes('일어서서')));
  log('음성: 종료 안내', spoken.some(s => s.includes('검사가 끝났습니다')));
  if (ok) {
    await pg.waitForSelector('.result-big'); await shot('s04-result');
    const big = (await pg.textContent('.result-big')).trim();
    log('결과: 변화량 ≈7.14mm · 경증', Math.abs(parseFloat(big) - 7.14) <= 0.15 && await pg.isVisible('text=경증 평발 의심'), big);
    log('유연성 평발 자가 확인: 양상 안내', await pg.isVisible('text=유연성 평발 양상'));
    log('촬영 방식 기록: 음성 자동', await pg.isVisible('text=음성 자동 / 음성 자동'));
    await pg.check('[data-sq="restFlat"]'); await pg.waitForTimeout(300);
    log('자가 확인 질문 체크 → 전문가 상담 안내', await pg.isVisible('text=전문가 상담을 권합니다'));
    await pg.reload(); await pg.waitForSelector('#flex');
    log('자가 확인 응답 저장 유지', await pg.isChecked('[data-sq="restFlat"]')); await shot('s05-flex');
    await pg.goto(U + '#/manage'); await pg.waitForSelector('text=유연성 평발 관리'); await pg.waitForTimeout(300); await shot('s06-manage');
    log('관리 현황 화면', await pg.isVisible('text=최근 하강'));
    await pg.goto(U + '#/home'); await pg.waitForSelector('text=유연성 평발 관리 중'); log('홈: 관리 중 카드', true);
  }
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'e2e-self-results.json'), JSON.stringify(R, null, 1));
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
