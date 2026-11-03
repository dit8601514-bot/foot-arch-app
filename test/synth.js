// 합성 테스트 이미지 생성기 (실제 사용자 측정과 구분되는 테스트 전용 데이터)
'use strict';
function makeImage(w, h, opts) {
  const o = Object.assign({ bg: [205, 200, 192], skin: [222, 178, 150], noise: 6, blur: 0, seed: 1, stickers: [], extraBlue: [], foot: true }, opts);
  const data = new Uint8ClampedArray(w * h * 4);
  let s = o.seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const fx = w / 2, fy = h * 0.58, fa = w * 0.40, fb = h * 0.20;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = o.bg;
    if (o.soleY != null) { if (x >= o.footX0 && x <= o.footX1 && y >= o.soleY - h * 0.32 && y + 0.5 <= o.soleY) c = o.skin; } // 평평한 발바닥(경계 y = soleY)
    else if (o.foot && ((x - fx) / fa) ** 2 + ((y - fy) / fb) ** 2 <= 1) c = o.skin;
    const i = (y * w + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
  }
  const blue = [28, 86, 214];
  const circles = o.stickers.map(st => Object.assign({ color: blue, rx: st.r, ry: st.r }, st)).concat(o.extraBlue.map(st => Object.assign({ color: blue, rx: st.r, ry: st.r }, st)));
  for (const c of circles) {
    const x0 = Math.floor(c.x - c.rx - 2), x1 = Math.ceil(c.x + c.rx + 2), y0 = Math.floor(c.y - c.ry - 2), y1 = Math.ceil(c.y + c.ry + 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      let cov = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4; // 픽셀 중심 = x+0.5
        let inside = ((px - 0.5 - c.x) / c.rx) ** 2 + ((py - 0.5 - c.y) / c.ry) ** 2 <= 1;
        if (inside && c.cutBelowY != null && py - 0.5 > c.cutBelowY) inside = false;
        if (inside) cov++;
      }
      if (!cov) continue;
      const a = cov / 16, i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) data[i + k] = data[i + k] * (1 - a) + c.color[k] * a;
    }
  }
  if (o.blur > 0) boxBlur(data, w, h, o.blur);
  if (o.noise) for (let i = 0; i < data.length; i += 4) { const n = (rnd() - 0.5) * 2 * o.noise; for (let k = 0; k < 3; k++) data[i + k] = data[i + k] + n; }
  return { data, width: w, height: h };
}
function boxBlur(d, w, h, r) {
  for (let pass = 0; pass < 2; pass++) {
    const src = new Float32Array(d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = pass ? x : Math.min(w - 1, Math.max(0, x + k)), yy = pass ? Math.min(h - 1, Math.max(0, y + k)) : y;
        const i = (yy * w + xx) * 4; s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2]; n++;
      }
      const i = (y * w + x) * 4; d[i] = s0 / n; d[i + 1] = s1 / n; d[i + 2] = s2 / n;
    }
  }
}
// 표준 발 장면: 발가락이 화면 오른쪽(toe='right'), P2 높이 hPx
function footScene(w, h, hPx, opts) {
  const o = Object.assign({ toe: 'right', r: 14, span: 0.62 }, opts);
  const yBase = h * 0.66, half = w * o.span / 2;
  const toeX = o.toe === 'right' ? w / 2 + half : w / 2 - half, heelX = o.toe === 'right' ? w / 2 - half : w / 2 + half;
  const P1 = { x: toeX, y: yBase }, P3 = { x: heelX, y: yBase };
  const P2 = { x: heelX + (toeX - heelX) * 0.42, y: yBase - hPx };
  return { P1, P2, P3, stickers: [P1, P2, P3].map(p => ({ x: p.x, y: p.y, r: o.r })) };
}
module.exports = { makeImage, footScene };
