// E2E: 가상 카메라(합성 영상)로 전체 흐름 검증. node test/e2e.js
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, 'dist', u); if (!f.startsWith(path.join(root, 'dist')) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8765);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img/pre.y4m')] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  const pg = await ctx.newPage(); const errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  pg.on('dialog', d => d.accept(''));
  const shot = n => pg.screenshot({ path: path.join(__dirname, 'shots', n + '.png'), fullPage: true });
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  const U = 'http://localhost:8765/';
  await pg.goto(U + '#/home'); await pg.waitForSelector('text=측정하기'); await shot('01-home');
  log('홈: 기본 스티커 지름 16 mm로 mm 환산(미검증 경고 없음)', !(await pg.isVisible('text=mm 환산이 아직 검증되지 않았습니다')));
  await pg.goto(U + '#/settings'); await pg.waitForSelector('#dia');
  log('설정: 스티커 지름 16 mm 기본값·환산 기준 표시', (await pg.inputValue('#dia')) === '16' && (await pg.textContent('main')).includes('스티커 지름 16 mm 기준'));
  // 연구자: PIN 설정 → 지름 → 템플릿 검증
  await pg.goto(U + '#/r/calib'); await pg.fill('#p1', '1234'); await pg.fill('#p2', '1234'); await pg.click('#go');
  await pg.waitForSelector('#dia'); await pg.fill('#dia', '10'); await pg.click('#saveD'); await pg.waitForTimeout(400);
  await pg.setInputFiles('#vf', path.join(__dirname, 'img/template.png')); await pg.waitForSelector('#vres .note', { timeout: 10000 });
  const vt = await pg.textContent('#vres .note'); log('환산 검증 템플릿 통과', vt.includes('통과'), vt.trim()); await shot('02-calib');
  await pg.click('#syn'); await pg.waitForSelector('#synres .note'); const st = await pg.textContent('#synres .note'); log('합성 파이프라인 시험(브라우저)', st.includes('성공'), st.trim());
  // 검사 흐름: 왼발
  await pg.goto(U + '#/guide?foot=left'); await pg.check('#ack'); await shot('03-guide'); await pg.click('#next');
  await pg.waitForSelector('.foot-svg'); await shot('04-stickers'); await pg.click('#next');
  await pg.waitForSelector('#toeSeg'); await shot('05-posture'); await pg.click('#next');
  // 자동 촬영(카운트다운) 대기
  await pg.waitForSelector('#vid'); await pg.waitForTimeout(1500); await shot('06-capture-live');
  await pg.waitForTimeout(1500);
  const hud = await pg.textContent('#hud'); const fps = parseInt(hud);
  log('트래킹: 추적 모드(ROI) 동작', hud.includes('추적 모드'), hud);
  log('트래킹: 백그라운드(Web Worker) 분석', hud.includes('백그라운드'), hud);
  log('트래킹: 분석 속도 ≥8fps (기존 약 3fps)', fps >= 8, fps + 'fps');
  const sawCountdown = await pg.waitForFunction(() => /^[123]$/.test(document.querySelector('#cd')?.textContent || ''), null, { timeout: 15000 }).then(() => true).catch(() => false);
  log('자동 촬영: 준비 확인 후 3초 카운트다운 시작', sawCountdown);
  const auto = await pg.waitForSelector('#use', { timeout: 15000 }).then(() => true).catch(() => false);
  log('자동 촬영 완료 및 검출 결과 미리보기', auto); await shot('07-review-pre');
  const preTxt = await pg.textContent('#review'); log('체중부하 전: mm 측정 가능', preTxt.includes('측정 가능'), (preTxt.match(/P2–기준선 거리([^m]*mm[^m]*mm)/) || [])[1]);
  log('연속 촬영(버스트) 결합 정보 표시', /연속 촬영\s*\d+\/12 프레임 사용/.test(preTxt), (preTxt.match(/연속 촬영[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' '));
  await pg.click('#use');
  // 후: 파일 업로드
  await pg.waitForSelector('#autoSeg'); await pg.click('#autoSeg button[data-v="0"]'); await pg.setInputFiles('#file', path.join(__dirname, 'img/post.png'));
  await pg.waitForSelector('#use', { timeout: 10000 }); await shot('08-review-post'); await pg.click('#use');
  await pg.waitForSelector('.result-big', { timeout: 15000 }).catch(async e => { await shot('ERR'); console.log(errors, await pg.evaluate(() => location.hash + ' ' + document.querySelector('main').innerText.slice(0, 600))); throw e; }); await shot('09-result');
  const big = (await pg.textContent('.result-big')).trim(); const cat = await pg.textContent('.card .badge.b-warn, .card .badge.b-bad, .card .badge.b-good');
  log('결과: 변화량 ≈7.14mm(허용 ±0.15) · 경증 평발 의심', Math.abs(parseFloat(big) - 7.14) <= 0.15 && (await pg.isVisible('text=경증 평발 의심')), big);
  log('결과: 확정 진단 아님 고지', await pg.isVisible('text=확정 진단하지 않으며'));
  // 새로고침 후 유지
  await pg.reload(); await pg.goto(U + '#/history'); await pg.waitForSelector('text=전체 기록').catch(async e => { console.log('DEBUG', await pg.evaluate(() => [location.href, document.title, S.booted, document.querySelector('#title').textContent, document.querySelector('main').innerText.slice(0, 300)])); throw e; }); await pg.waitForTimeout(300); await shot('10-history');
  log('새로고침 후 이력 유지', (await pg.locator('a.list-item[href^="#/result/"]').count()) === 1);
  // 운동: 연결 지정 → 완료 기록
  await pg.goto(U + '#/r/content'); await pg.fill('#p1', '1234').catch(() => {}); if (await pg.isVisible('#go')) await pg.click('#go');
  await pg.waitForSelector('[data-map="mild"]'); await pg.locator('[data-map="mild"]').first().check(); await pg.click('#saveMap'); await pg.waitForTimeout(300);
  const id = await pg.evaluate(async () => (await DB.all('exams'))[0].id);
  await pg.goto(U + '#/result/' + id); await pg.waitForSelector('a[href^="#/exercise/"]'); await pg.click('a[href^="#/exercise/"]');
  await pg.waitForSelector('#done'); await shot('11-exercise'); log('운동: 영상 미등록 시 등록 필요 표시', await pg.isVisible('text=영상 등록 필요')); log('운동: 처방 미입력 표시', await pg.isVisible('text=연구 프로토콜 값 미입력'));
  await pg.fill('#aSets', '2'); await pg.click('#done'); await pg.waitForSelector('text=운동 수행 기록'); await pg.waitForTimeout(300); await shot('12-logs');
  log('운동 완료 기록 저장', (await pg.evaluate(async () => (await DB.all('logs')).length)) === 1);
  // 오차 자료 입력 + 보정 모델
  await pg.evaluate(async () => { let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; for (let p = 0; p < 10; p++) for (let k = 0; k < 2; k++) { const ref = 15 + r() * 20; await DB.put('errors', { id: uid(), createdAt: Date.now(), participantId: 'T' + p, date: '2026-11-01', foot: 'left', phase: k ? 'post' : 'pre', aiMm: ref + 1.5 + (r() - .5) * .6, refMm: ref, refConfirmed: true, reviewStatus: 'reviewed', memo: '[E2E 테스트 자료]', imageRef: '', conditions: '' }); } });
  await pg.goto(U + '#/r/errors'); await pg.fill('#pid', 'P900'); await pg.fill('#ai', '200'); await pg.click('#saveE'); log('연구자 입력값 오류 차단', await pg.waitForSelector('.toast.err', { timeout: 3000 }).then(() => true).catch(() => false));
  await pg.goto(U + '#/r/compare'); await pg.waitForSelector('#ba'); await shot('13-r-compare'); log('오차 분석 표·그래프', (await pg.locator('table.t tr').count()) > 5);
  await pg.goto(U + '#/r/models'); await pg.click('#train'); await pg.waitForSelector('[data-approve]'); await pg.click('[data-approve]'); await pg.waitForSelector('[data-deploy]'); await pg.click('[data-deploy]');
  await pg.click('.modal [data-a="ok"]'); await pg.waitForSelector('text=배포됨'); await shot('14-r-models'); log('보정 모델 학습→승인→배포', true);
  await pg.goto(U + '#/r/home'); await pg.click('#lock');
  // PWA: 매니페스트·서비스 워커·오프라인
  const man = await pg.evaluate(async () => { const r = await fetch('manifest.webmanifest'); return r.ok ? (await r.json()).name : null; });
  log('PWA: 매니페스트 제공', man === 'AI Footarch — 발 아치 분석', man);
  const swOk = await pg.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  log('PWA: 서비스 워커 활성화', swOk);
  await pg.reload(); await pg.waitForTimeout(500); await ctx.setOffline(true);
  const off = await pg.goto(U + '#/home').then(() => pg.waitForSelector('text=측정하기', { timeout: 5000 })).then(() => true).catch(() => false);
  log('PWA: 오프라인에서도 앱 열림', off); await ctx.setOffline(false);
  // 카메라 권한 거부 처리
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await ctx2.newPage();
  await p2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
  await p2.goto(U + '#/guide?foot=right'); await p2.check('#ack'); await p2.click('#next'); await p2.click('#next'); await p2.click('#next');
  log('카메라 권한 거부 안내', await p2.waitForSelector('text=카메라 권한이 거부되었습니다', { timeout: 5000 }).then(() => true).catch(() => false)); await p2.screenshot({ path: path.join(__dirname, 'shots', '15-cam-denied.png') });
  log('페이지 스크립트 오류 없음', errors.length === 0, errors.join(' | '));
  await b.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'e2e-results.json'), JSON.stringify(R, null, 1));
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
