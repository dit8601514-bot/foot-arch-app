// E2E: 트래킹 강건성 — 0~4초 정상, 4초~ 파란 방해물(4번째 원) 등장, 8초~ 어둡고 노란 조명
// node test/e2e-track.js  (test/img/track.y4m 필요)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': u.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8768);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img/track.y4m')] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
  const pg = await ctx.newPage(); const errors = []; pg.on('pageerror', e => errors.push(e.message));
  const U = 'http://localhost:8768/';
  await pg.goto(U + '#/guide?foot=left'); await pg.waitForSelector('#ack'); await pg.check('#ack'); await pg.click('#next'); await pg.click('#next'); await pg.click('#next');
  await pg.waitForSelector('#autoSeg'); await pg.click('#autoSeg button[data-v="0"]'); // 수동 모드: 시점을 테스트가 정한다
  const t0 = Date.now(); const samples = [];
  while (Date.now() - t0 < 12500) {
    samples.push({ t: (Date.now() - t0) / 1000, hud: await pg.textContent('#hud'), ok: await pg.locator('#checks .ok').count(), status: await pg.textContent('#status') });
    await pg.waitForTimeout(500);
  }
  const phase = (a, b2) => samples.filter(s => s.t >= a && s.t < b2);
  const readyFrac = arr => arr.filter(s => s.ok === 4).length / Math.max(1, arr.length);
  log('정상 구간: 추적 모드·준비 완료', readyFrac(phase(2, 4)) >= 0.75 && phase(2, 4).some(s => s.hud.includes('추적')), JSON.stringify(phase(2, 4).map(s => s.ok)));
  log('방해물 등장 후에도 준비 유지(칼만 예측 기반 대응)', readyFrac(phase(5, 8)) >= 0.75, JSON.stringify(phase(5, 8).map(s => s.ok)));
  log('어둡고 노란 조명에서도 준비 유지(적응형 색 모델)', readyFrac(phase(9.5, 12.5)) >= 0.6, JSON.stringify(phase(9.5, 12.5).map(s => s.ok)));
  const fps = Math.min(...phase(2, 12.5).map(s => parseInt(s.hud)).filter(Number.isFinite));
  log('ALG-2에서도 실시간 분석 ≥ 8fps', fps >= 8, '최저 ' + fps + 'fps');
  await pg.click('#shot');
  const okShot = await pg.waitForSelector('#use', { timeout: 20000 }).then(() => true).catch(() => false);
  const rv = await pg.textContent('#review');
  log('방해물·저조도 상태에서 연속 촬영 성공', okShot, (rv.match(/연속 촬영[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' '));
  await pg.screenshot({ path: path.join(__dirname, 'shots', 't01-track-review.png'), fullPage: true });
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); srv.close();
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
