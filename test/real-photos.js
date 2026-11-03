// 실제 사진(사용자 제공) 회귀 시험: 앱과 같은 640px 분석 해상도에서 스티커 3개 검출·라벨·가이드 통과·발 윤곽 분할
// node test/real-photos.js
const C = require('../src/core.js'); const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); let pass = 0, n = 0;
  const files = fs.readdirSync(path.join(__dirname, 'img/real')).filter(f => f.endsWith('.jpg'));
  for (const f of files) {
    const buf = fs.readFileSync(path.join(__dirname, 'img/real', f)).toString('base64');
    const px = await pg.evaluate(async b64 => { const im = new Image(); im.src = 'data:image/jpeg;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height); return { w: c.width, h: c.height, d: Array.from(d.data) }; }, buf);
    const img = { width: px.w, height: px.h, data: Uint8ClampedArray.from(px.d) };
    for (const toe of ['right', 'left']) { // 왼발·오른발 어느 쪽을 골라도
      n++; const det = C.detectStickers(img, { toeDirection: toe }), g = det.landmarks && C.guideCheck(det, toe);
      const heelRight = det.landmarks && det.landmarks.P3.x > det.landmarks.P1.x; // 사진은 모두 발가락이 왼쪽
      const ok = det.ok && g && g.ok && heelRight && det.quality.minAxisRatio >= 0.78;
      if (ok) pass++; console.log(ok ? 'PASS' : 'FAIL', f, '선택', toe, det.reasons.map(r => r.code).join(',') || '', g && g.code, '신뢰도', det.confidence);
    }
    // 카펫 바닥: 휴대폰이 바닥보다 조금 높은 사진(A·B)은 바닥선을 찾아야 함(바닥 높이 = 실측 범위)
    if (/^(A_|B_)/.test(f)) { n++; const det = C.detectStickers(img, { toeDirection: 'right' }), sole = det.sole, h = sole && sole.ok ? C.heightAboveSole(det.landmarks.P2, sole) / det.quality.diameterPx * 19 : null;
      const ok = !!(sole && sole.ok && h > 20 && h < 50); if (ok) pass++; console.log(ok ? 'PASS' : 'FAIL', f, '카펫 바닥선', sole && (sole.method || sole.reason), h && h.toFixed(1) + ' mm');
    }
  }
  await b.close(); console.log(`${pass}/${n} 통과`); process.exit(pass === n ? 0 : 1);
})();
