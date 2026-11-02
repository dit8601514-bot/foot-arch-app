// E2E: 음성 안내 자가 검사 + 체중부하 인지
//  시나리오 A(self.y4m): 앉음 0~14초 → 일어서는 중 14~16초(스티커 안 보임) → 선 자세 16초~(아치 하강) ⇒ "체중부하 확인했습니다. 촬영합니다."
//  시나리오 B(self_nochange.y4m): 같은 흐름이지만 선 자세에서 형태 변화 없음 ⇒ 재안내 후 "현재 자세로 체중부하 상태를 촬영합니다."
// node test/e2e-self.js [A|B]   (영상 생성법은 README 참고)
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((q, s) => { let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html'; const f = path.join(root, 'dist', u); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); }).listen(8767);
const R = []; const log = (n, ok, d) => { R.push([n, ok ? 'PASS' : 'FAIL', d || '']); console.log(ok ? 'PASS' : 'FAIL', n, d || ''); };
fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });

async function scenario(tag, video, expectConfirmed) {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(__dirname, 'img', video)] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  await ctx.addInitScript(() => { window.__spoken = []; const sy = window.speechSynthesis; if (sy) { const orig = sy.speak.bind(sy); sy.speak = u => { if (u.text.trim()) window.__spoken.push(u.text); try { orig(u); } catch (e) {} }; } });
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
  await pg.waitForSelector('#vid'); await pg.waitForTimeout(4500); if (tag === 'A') await shot('s03-self-align');
  // 체중부하 단계 화면(인지 카드) 캡처
  await pg.waitForFunction(() => document.querySelector('#lcMove') && document.querySelector('#lcMove').textContent === '확인', null, { timeout: 45000 }).catch(() => {});
  await pg.waitForTimeout(1500); if (tag === 'A') await shot('s04-self-load');
  const ok = await pg.waitForFunction(() => location.hash.startsWith('#/result/'), null, { timeout: 60000 }).then(() => true).catch(() => false);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const spoken = await pg.evaluate(() => window.__spoken);
  log(`[${tag}] 손대지 않고 비체중부하·체중부하 자동 촬영 → 결과`, ok, secs + '초');
  log(`[${tag}] 음성: 정확한 정렬 안내`, spoken.some(s => s.includes('정확히 들어왔습니다')));
  log(`[${tag}] 음성: "비체중부하 상태를 촬영합니다"`, spoken.includes('비체중부하 상태를 촬영합니다.'));
  log(`[${tag}] 음성: "체중부하 해주십시오"`, spoken.some(s => s.includes('체중부하 해주십시오')));
  log(`[${tag}] 음성: 일어서는 동작 인지`, spoken.some(s => s.includes('일어서는 동작을 확인했습니다')));
  if (expectConfirmed) log(`[${tag}] 음성: "체중부하 확인했습니다. 촬영합니다."`, spoken.includes('체중부하 확인했습니다. 촬영합니다.'), spoken.join(' / '));
  else {
    log(`[${tag}] 형태 변화 없음 → 재안내`, spoken.some(s => s.includes('양발에 체중을 고르게 실어 주십시오') && s.includes('변화가 아직 작습니다')));
    log(`[${tag}] 확인 못 하면 "확인했습니다"라고 말하지 않음`, !spoken.includes('체중부하 확인했습니다. 촬영합니다.') && spoken.includes('현재 자세로 체중부하 상태를 촬영합니다.'), spoken.join(' / '));
  }
  log(`[${tag}] 음성: "촬영되었습니다" 2회`, spoken.filter(s => s === '촬영되었습니다.').length === 2);
  if (ok) {
    await pg.waitForSelector('.result-big'); await shot(`s05-result-${tag}`);
    const big = (await pg.textContent('.result-big')).trim(), main = await pg.textContent('main');
    if (expectConfirmed) {
      log(`[${tag}] 결과: 변화량 ≈7.14mm · 경증`, Math.abs(parseFloat(big) - 7.14) <= 0.15 && main.includes('경증 평발 의심'), big);
      log(`[${tag}] 결과: 체중부하 인지 기록(일어섬·아치 하강)`, main.includes('일어섬 확인') && main.includes('아치 하강 확인'));
      log(`[${tag}] 유연성 평발 양상 안내`, main.includes('유연성 평발 양상'));
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
  srv.close();
  fs.writeFileSync(path.join(__dirname, 'e2e-self-results.json'), JSON.stringify(R, null, 1));
  console.log(`\n${R.filter(r => r[1] === 'PASS').length}/${R.length} 통과`);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
