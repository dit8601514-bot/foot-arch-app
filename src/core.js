/*
 * FootCore — 발 아치 측정 핵심 로직 (UI·저장소와 분리된 순수 함수)
 * 브라우저(window.FootCore)와 Node(module.exports) 양쪽에서 동작한다.
 * 측정 알고리즘 버전은 ALGORITHM_VERSION 으로 관리한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FootCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALGORITHM_VERSION = 'ALG-2.0.0';

  // 기본 검출 파라미터 (휴리스틱 값 — 실제 사진으로 검증 후 연구자가 조정해야 함)
  const DEFAULT_DETECT = {
    hueMin: 190, hueMax: 255,      // 파란색 색상 범위(도)
    satMin: 0.40, valMin: 0.18,    // 채도·명도 하한
    blueMargin: 25,                // B 채널이 R,G 보다 커야 하는 최소 차이
    minDiaFrac: 0.012,             // 이미지 짧은 변 대비 최소 스티커 지름
    maxDiaFrac: 0.20,              // 최대 지름
    minAxisRatio: 0.72,            // 원형 판정 최소 단축/장축 비
    fillMin: 0.8, fillMax: 1.2,    // 모멘트 타원 대비 채움 비율
    bboxFillMin: 0.62, bboxFillMax: 0.92,
    sizeTolerance: 0.25,           // 3개 스티커 크기 허용 편차(중앙값 대비)
    chromaStrong: 0.55,            // ALG-2: 파란 정도 강한 임계(씨앗)
    chromaWeak: 0.32,              // ALG-2: 파란 정도 약한 임계(성장)
    minLum: 6,                     // 너무 어두운 픽셀 제외(밝기 0~255)
    minEdgeCoverage: 0.6,          // 가장자리 점이 잡힌 방사선 비율 하한
    maxEdgeGapDeg: 75,             // 가장자리 점 사이 최대 각도 공백(가림 판정)
    blurMinPx: 6.5, blurRelR: 0.45,// 흐림 판정: 가장자리 10–90% 폭 ≤ max(6.5px, 0.45×반지름) (3×3 평활 포함)
    priorGate: 1.5,                // 추적 중 예측 위치 허용 거리(스티커 지름 배수)
    useLumEdges: false,            // 밝기 가장자리 보조(벤치마크에서 색 가장자리만 쓰는 편이 더 정확해 기본 끔)
    preAxisRatio: 0.5,             // 1차 거르기 축비(느슨)
    rawEdges: true,                // 가장자리 탐색은 평활 전 지표 맵에서(광택 반사 근처 번짐 감소)
    tukey: true,                   // 후반 반복에서 Tukey 가중(이상치 강하게 배제)
    minConfidence: 0.60,           // 이 미만이면 재촬영
    maxNavicularT: 0.55            // 발꿈치→P1 방향 P2 위치 상한(해부학 휴리스틱, 미검증)
  };

  const DEFAULT_CONVERSION = {
    minAxisRatioForMm: 0.90,       // 이 미만이면 촬영 각도 기울어짐 → 보정 필요
    maxSizeCv: 0.06,               // 3개 스티커 지름 변동계수 상한(원근/회전)
    minDiameterPx: 20,             // 해상도 하한
    maxScaleDiffPrePost: 0.05,     // 전·후 축척 차이 허용
    maxAxisAngleDiffDeg: 10,       // 전·후 발 축 각도 차이 허용
    maxPlausibleChangeMm: 30,      // 이 이상은 측정 불가(비정상)
    riseReviewMm: 3                // 체중부하 후 오히려 높아진 경우 검토 필요
  };

  // ───────────────────────── 색상 / 마스크 ─────────────────────────
  function rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, max === 0 ? 0 : d / max, max / 255];
  }

  function blueMask(img, p) {
    const { data, width, height } = img;
    const mask = new Uint8Array(width * height);
    for (let i = 0, j = 0; j < mask.length; i += 4, j++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (b < r + p.blueMargin || b < g + p.blueMargin * 0.4) continue;
      const [h, s, v] = rgbToHsv(r, g, b);
      if (h >= p.hueMin && h <= p.hueMax && s >= p.satMin && v >= p.valMin) mask[j] = 1;
    }
    return mask;
  }

  // 픽셀의 "파란 정도" (0~1) — 가중 중심/경계 선명도 계산용
  function blueness(data, idx) {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const v = (b - Math.max(r, g)) / 255;
    return v <= 0 ? 0 : Math.min(1, v * 1.6);
  }

  // ───────────────────────── 연결 요소 ─────────────────────────
  function components(mask, width, height) {
    const labels = new Int32Array(mask.length);
    const comps = [];
    const queue = new Int32Array(mask.length);
    let next = 1;
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const id = next++;
      let qh = 0, qt = 0;
      queue[qt++] = start; labels[start] = id;
      let area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, perim = 0;
      let minx = width, miny = height, maxx = 0, maxy = 0;
      while (qh < qt) {
        const p = queue[qh++];
        const x = p % width, y = (p / width) | 0;
        area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        let edge = false;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= height) { edge = true; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx; if (nx < 0 || nx >= width) { edge = true; continue; }
            const q = ny * width + nx;
            if (!mask[q]) { if (!dx || !dy) edge = true; continue; }
            if (!labels[q]) { labels[q] = id; queue[qt++] = q; }
          }
        }
        if (edge) perim++;
      }
      comps.push({ id, area, sx, sy, sxx, syy, sxy, perim, minx, miny, maxx, maxy });
    }
    return comps;
  }

  function describeComponent(c, imgW, imgH) {
    const cx = c.sx / c.area, cy = c.sy / c.area;
    const mxx = c.sxx / c.area - cx * cx, myy = c.syy / c.area - cy * cy, mxy = c.sxy / c.area - cx * cy;
    const tr = mxx + myy, det = mxx * myy - mxy * mxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-9, tr / 2 - disc);
    const major = 4 * Math.sqrt(l1), minor = 4 * Math.sqrt(l2); // 꽉 찬 타원의 지름
    const ellipseArea = Math.PI * (major / 2) * (minor / 2);
    const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
    const touchesBorder = c.minx <= 0 || c.miny <= 0 || c.maxx >= imgW - 1 || c.maxy >= imgH - 1;
    return {
      cx, cy, area: c.area, major, minor,
      axisRatio: minor / major,
      fill: c.area / ellipseArea,
      bboxFill: c.area / (bw * bh),
      eqDiameter: 2 * Math.sqrt(c.area / Math.PI),
      bbox: [c.minx, c.miny, bw, bh], touchesBorder
    };
  }

  function scoreCandidate(d, p) {
    const s1 = clamp01((d.axisRatio - 0.6) / 0.3);
    const s2 = clamp01(1 - Math.abs(d.fill - 1) / 0.15);
    const s3 = clamp01(1 - Math.abs(d.bboxFill - Math.PI / 4) / 0.12);
    return 0.5 * s1 + 0.25 * s2 + 0.25 * s3;
  }

  // 파란 정도 가중 중심 (서브픽셀 정밀도)
  function refineCenter(img, d) {
    const { data, width, height } = img;
    const R = d.major / 2 * 1.3;
    const x0 = Math.max(0, Math.floor(d.cx - R)), x1 = Math.min(width - 1, Math.ceil(d.cx + R));
    const y0 = Math.max(0, Math.floor(d.cy - R)), y1 = Math.min(height - 1, Math.ceil(d.cy + R));
    let sw = 0, sx = 0, sy = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if ((x - d.cx) ** 2 + (y - d.cy) ** 2 > R * R) continue;
      const w = blueness(data, (y * width + x) * 4);
      sw += w; sx += w * x; sy += w * y;
    }
    if (sw <= 0) return { x: d.cx, y: d.cy, diameter: d.major };
    const x = sx / sw, y = sy / sw;
    // 부분 피복(안티앨리어싱) 반영 지름: 내부 파란 정도 대비 각 픽셀의 피복률 합 → 면적
    const inner = [];
    const r0 = d.major / 2 * 0.5;
    for (let yy = Math.floor(y - r0); yy <= Math.ceil(y + r0); yy++) for (let xx = Math.floor(x - r0); xx <= Math.ceil(x + r0); xx++) {
      if (xx < 0 || yy < 0 || xx >= width || yy >= height || (xx - x) ** 2 + (yy - y) ** 2 > r0 * r0) continue;
      inner.push(blueness(data, (yy * width + xx) * 4));
    }
    inner.sort((a, b) => a - b);
    const bIn = inner.length ? inner[inner.length >> 1] : 0;
    let cov = 0;
    if (bIn > 0.1) for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if ((xx - d.cx) ** 2 + (yy - d.cy) ** 2 > R * R) continue;
      cov += clamp01(blueness(data, (yy * width + xx) * 4) / bIn);
    }
    const covDia = cov > 0 ? 2 * Math.sqrt(cov / Math.PI) : d.major;
    // 기울어진(타원) 스티커는 장축이 실제 지름에 가깝다 → 면적 지름을 축비로 보정
    return { x, y, diameter: covDia / Math.sqrt(Math.max(0.5, d.axisRatio)) };
  }

  // 경계 전이 폭(px): 흐린 사진일수록 넓다
  function edgeWidth(img, c, radius) {
    const { data, width, height } = img;
    const widths = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const prof = [];
      for (let r = radius * 0.4; r <= radius * 1.6; r += 0.5) {
        const x = Math.round(c.x + ca * r), y = Math.round(c.y + sa * r);
        if (x < 0 || y < 0 || x >= width || y >= height) { prof.length = 0; break; }
        prof.push(blueness(data, (y * width + x) * 4));
      }
      if (prof.length < 6) continue;
      const hi = Math.max(...prof.slice(0, 4)), lo = Math.min(...prof.slice(-4));
      if (hi - lo < 0.15) continue;
      const t90 = lo + 0.9 * (hi - lo), t10 = lo + 0.1 * (hi - lo);
      let i90 = -1, i10 = -1;
      for (let i = 0; i < prof.length; i++) {
        if (i90 < 0 && prof[i] < t90) i90 = i;
        if (i10 < 0 && prof[i] < t10) { i10 = i; break; }
      }
      if (i90 >= 0 && i10 >= 0) widths.push((i10 - i90 + 1) * 0.5);
    }
    if (!widths.length) return null;
    widths.sort((a, b) => a - b);
    return widths[widths.length >> 1];
  }

  // 회색조 라플라시안 분산 (전체 선명도 참고 지표)
  function laplacianVariance(img, roi) {
    const { data, width } = img;
    const [rx, ry, rw, rh] = roi || [0, 0, img.width, img.height];
    const step = Math.max(1, Math.floor(Math.min(rw, rh) / 300));
    const g = (x, y) => { const i = (y * width + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    let n = 0, s = 0, s2 = 0;
    for (let y = ry + step; y < ry + rh - step; y += step) for (let x = rx + step; x < rx + rw - step; x += step) {
      const l = 4 * g(x, y) - g(x - step, y) - g(x + step, y) - g(x, y - step) - g(x, y + step);
      n++; s += l; s2 += l * l;
    }
    if (!n) return 0;
    return s2 / n - (s / n) ** 2;
  }

  // ───────────────────────── 기하 ─────────────────────────
  function signedDistanceToLine(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) return NaN;
    // 이미지 좌표계(y 아래 방향)에서 "위쪽"을 양수로 만들기 위한 법선 선택
    let nx = -dy / L, ny = dx / L;
    if (ny > 0) { nx = -nx; ny = -ny; }
    return (p.x - a.x) * nx + (p.y - a.y) * ny;
  }
  function distanceToLine(p, a, b) { return Math.abs(signedDistanceToLine(p, a, b)); }
  function projectionT(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    return ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  /**
   * 해부학적 기준점 라벨링.
   * toeDirection: 'right' | 'left' — 촬영 안내에 따라 발가락이 향하는 화면 방향.
   * 화면 좌우 순서만이 아니라 (1) 세 점의 배치(가장 먼 두 점=기준선 양끝, 사이 점=P2),
   * (2) P2가 기준선 위(발등 쪽)에 있는지, (3) 발배뼈가 제1중족골두보다 발꿈치에 가까운지
   * (해부학적 배치 휴리스틱), (4) 발 축 기울기를 함께 확인한다.
   */
  function labelLandmarks(pts, toeDirection, diaPx, opts) {
    const issues = [];
    const pairs = [[0, 1, 2], [0, 2, 1], [1, 2, 0]];
    let best = null;
    for (const [i, j, k] of pairs) {
      const d = dist(pts[i], pts[j]);
      if (!best || d > best.d) best = { i, j, k, d };
    }
    const e1 = pts[best.i], e2 = pts[best.j], mid = pts[best.k];
    const axis = { x: e2.x - e1.x, y: e2.y - e1.y };
    // 발가락 방향 벡터
    const toeVec = toeDirection === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const dot = axis.x * toeVec.x + axis.y * toeVec.y;
    const P1 = dot >= 0 ? e2 : e1;   // 발가락 쪽 끝 = 제1중족골두
    const P3 = dot >= 0 ? e1 : e2;   // 발꿈치 쪽 끝 = 발꿈치뼈
    const P2 = mid;

    const axisAngleDeg = Math.atan2(P1.y - P3.y, Math.abs(P1.x - P3.x)) * 180 / Math.PI;
    const tFromHeel = projectionT(P2, P3, P1);
    const signed = signedDistanceToLine(P2, P1, P3);
    const span = dist(P1, P3);
    let conf = 1;

    if (Math.abs(axisAngleDeg) > 30) issues.push({ code: 'AXIS_TILT', msg: `발 축이 ${Math.abs(axisAngleDeg).toFixed(0)}° 기울어져 있습니다. 발을 화면 가로 방향으로 맞춰 주세요.` });
    if (Math.abs(dot) < span * 0.7) issues.push({ code: 'TOE_DIR', msg: '발가락 방향이 안내와 다릅니다. 발가락이 화면의 지정된 쪽을 향하게 해 주세요.' });
    if (tFromHeel < 0.12 || tFromHeel > 0.88) issues.push({ code: 'P2_OUTSIDE', msg: '가운데 스티커(P2)가 두 스티커 사이에 있지 않습니다. 부착 위치를 확인해 주세요.' });
    else if (tFromHeel > (opts && opts.maxNavicularT || 0.55)) issues.push({ code: 'P2_NEAR_TOE', msg: 'P2가 발꿈치보다 발가락 쪽에 치우쳐 있어 발 방향 또는 부착 위치가 불확실합니다.' });
    if (signed < -0.5 * diaPx) issues.push({ code: 'P2_BELOW', msg: 'P2가 기준선 아래에 있습니다. 카메라가 거꾸로 되었거나 부착 위치가 잘못되었을 수 있습니다.' });
    if (span < 5 * diaPx) issues.push({ code: 'SPAN_SHORT', msg: '스티커 간 거리가 너무 짧습니다. 부착 위치(제1중족골두–발꿈치)를 확인해 주세요.' });

    // 라벨 신뢰도: 경계로부터의 여유
    conf *= clamp01((Math.min(tFromHeel, 0.88 - tFromHeel) ) / 0.2 + 0.2);
    conf *= clamp01(1 - Math.max(0, Math.abs(axisAngleDeg) - 15) / 20);
    conf *= Math.abs(signed) < 0.5 * diaPx ? 0.8 : 1;
    return { P1, P2, P3, axisAngleDeg, tFromHeel, signedDistancePx: signed, spanPx: span, labelConfidence: clamp01(conf), issues };
  }

  /**
   * 이미지에서 파란색 원형 스티커 3개를 검출하고 P1/P2/P3를 지정한다.
   * 반환: { ok, reasons[], stickers[], landmarks, quality, confidence }
   */
  // ═══════════════ ALG-2 검출: 조명 불변 색 지표 → 히스테리시스 → 구멍 메움 → 서브픽셀 타원 피팅 ═══════════════
  /**
   * 파란 정도(조명 세기 불변 반대색 지표): o = (B − (R+G)/2) / (밝기 + 10)
   * 밝기로 나누므로 어두운 곳·밝은 곳에서 같은 스티커가 비슷한 값을 갖고, 색온도가 바뀌어도 배경 대비 순위가 유지된다.
   * 반환: 3×3 평균으로 잡음을 줄인 지표 맵(Float32Array)과 밝기 맵
   */
  function chromaMap(img) {
    const { data, width: W, height: H } = img, n = W * H;
    const o = new Float32Array(n), lum = new Float32Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const r = data[i], g = data[i + 1], b = data[i + 2], m = (r + g + b) / 3;
      lum[j] = m; o[j] = (b - (r + g) / 2) / (m + 10);
    }
    // 분리형 3×3 상자 필터
    const tmp = new Float32Array(n), sm = new Float32Array(n);
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { const a = x > 0 ? x - 1 : x, c = x < W - 1 ? x + 1 : x; tmp[row + x] = (o[row + a] + o[row + x] + o[row + c]) / 3; } }
    for (let y = 0; y < H; y++) { const a = (y > 0 ? y - 1 : y) * W, b = y * W, c = (y < H - 1 ? y + 1 : y) * W; for (let x = 0; x < W; x++) sm[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 3; }
    const tl = new Float32Array(n), sl = new Float32Array(n);
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { const a = x > 0 ? x - 1 : x, c = x < W - 1 ? x + 1 : x; tl[row + x] = (lum[row + a] + lum[row + x] + lum[row + c]) / 3; } }
    for (let y = 0; y < H; y++) { const a = (y > 0 ? y - 1 : y) * W, b = y * W, c = (y < H - 1 ? y + 1 : y) * W; for (let x = 0; x < W; x++) sl[b + x] = (tl[a + x] + tl[b + x] + tl[c + x]) / 3; }
    return { o: sm, oRaw: o, lum, lumS: sl, W, H };
  }
  // 프로파일(바깥→안 방향 탐색)에서 수준 t를 지나는 반지름(서브픽셀). up=true면 안쪽 값이 큰 경우.
  function crossing(prof, rAt, t, innerHigh) {
    for (let i = prof.length - 1; i > 0; i--) {
      const a = prof[i - 1], b = prof[i];
      if (innerHigh ? (a >= t && b < t) : (a <= t && b > t)) return rAt(i - 1) + 0.25 * (a - t) / (a - b);
    }
    return null;
  }
  // 영상 전체 지표 분포(중앙값·MAD)로 배경 수준을 추정 — 표본 추출로 빠르게
  function robustStats(arr, step) {
    const s = []; for (let i = 0; i < arr.length; i += step) s.push(arr[i]);
    s.sort((a, b) => a - b); const med = s[s.length >> 1];
    const dev = s.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    return { med, mad: dev[dev.length >> 1] * 1.4826 };
  }
  // 히스테리시스 이진화: 강한 씨앗 픽셀에서 출발해 약한 픽셀까지만 자란다(가장자리 음영·그라데이션 대응)
  function hysteresis(cm, strong, weak, minLum) {
    const { o, lum, W, H } = cm, n = W * H, mask = new Uint8Array(n), q = new Int32Array(n);
    let qt = 0;
    for (let j = 0; j < n; j++) if (o[j] >= strong && lum[j] >= minLum) { mask[j] = 1; q[qt++] = j; }
    let qh = 0;
    while (qh < qt) {
      const p = q[qh++], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= H) continue; for (let dx = -1; dx <= 1; dx++) { const nx = x + dx; if (nx < 0 || nx >= W) continue; const k = ny * W + nx; if (!mask[k] && o[k] >= weak) { mask[k] = 1; q[qt++] = k; } } }
    }
    return mask;
  }
  // 성분 내부의 구멍(광택 반사 등)을 메운다: 경계상자 바깥에서 닿지 않는 비마스크 픽셀 = 구멍
  function fillHoles(mask, labels, comp, W, H) {
    const x0 = Math.max(0, comp.minx - 1), y0 = Math.max(0, comp.miny - 1), x1 = Math.min(W - 1, comp.maxx + 1), y1 = Math.min(H - 1, comp.maxy + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, seen = new Uint8Array(bw * bh), q = new Int32Array(bw * bh);
    let qt = 0;
    const inside = (x, y) => labels[y * W + x] === comp.id;
    for (let x = 0; x < bw; x++) for (const y of [0, bh - 1]) { const k = y * bw + x; if (!seen[k] && !inside(x0 + x, y0 + y)) { seen[k] = 1; q[qt++] = k; } }
    for (let y = 0; y < bh; y++) for (const x of [0, bw - 1]) { const k = y * bw + x; if (!seen[k] && !inside(x0 + x, y0 + y)) { seen[k] = 1; q[qt++] = k; } }
    let qh = 0;
    while (qh < qt) { const k = q[qh++], x = k % bw, y = (k / bw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue; const kk = ny * bw + nx; if (!seen[kk] && !inside(x0 + nx, y0 + ny)) { seen[kk] = 1; q[qt++] = kk; } } }
    let filled = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const k = y * bw + x, X = x0 + x, Y = y0 + y;
      if (!seen[k] && !inside(X, Y)) { labels[Y * W + X] = comp.id; mask[Y * W + X] = 1; filled++; comp.area++; comp.sx += X; comp.sy += Y; comp.sxx += X * X; comp.syy += Y * Y; comp.sxy += X * Y; }
    }
    return filled;
  }
  function labelComponents(mask, W, H) {
    const labels = new Int32Array(mask.length), comps = [], q = new Int32Array(mask.length);
    let next = 1;
    for (let s = 0; s < mask.length; s++) {
      if (!mask[s] || labels[s]) continue;
      const id = next++; let qh = 0, qt = 0; q[qt++] = s; labels[s] = id;
      const c = { id, area: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, perim: 0, minx: W, miny: H, maxx: 0, maxy: 0 };
      while (qh < qt) {
        const p = q[qh++], x = p % W, y = (p / W) | 0;
        c.area++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
        if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x; if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
        for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= H) continue; for (let dx = -1; dx <= 1; dx++) { const nx = x + dx; if (nx < 0 || nx >= W) continue; const k = ny * W + nx; if (mask[k] && !labels[k]) { labels[k] = id; q[qt++] = k; } } }
      }
      comps.push(c);
    }
    return { labels, comps };
  }
  function bilinear(arr, W, H, x, y) {
    if (x < 0 || y < 0 || x > W - 1.001 || y > H - 1.001) return NaN;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return arr[i] * (1 - fx) * (1 - fy) + arr[i + 1] * fx * (1 - fy) + arr[i + W] * (1 - fx) * fy + arr[i + W + 1] * fx * fy;
  }
  /**
   * 서브픽셀 가장자리 + 타원 피팅.
   * 각 방사선(64개)마다 안쪽·바깥쪽 수준의 중간값을 지나는 위치를 바깥에서 안쪽으로 찾는다(내부 광택에 속지 않음).
   * 가장자리 점들에 타원(중심·장단축·각도)을 Huber 가중 반복 재가중 가우스–뉴턴으로 맞춘다.
   */
  function fitEllipse(cm, d) {
    const { lumS, W, H } = cm, o = cm.rawEdges ? cm.oRaw : cm.o, R = d.major / 2, N = 64, pts = [], widths = [], contrasts = [];
    let lumUsed = 0;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), prof = [], lp = [], sp = [];
      // 방사선 양옆 ±0.75px 평행선 3개를 평균해 잡음을 줄인다
      const px = -sa * 0.75, py = ca * 0.75;
      for (let r = 0.3 * R; r <= 1.85 * R; r += 0.25) {
        const x = d.cx + ca * r, y = d.cy + sa * r;
        prof.push((bilinear(o, W, H, x, y) + bilinear(o, W, H, x + px, y + py) + bilinear(o, W, H, x - px, y - py)) / 3);
        sp.push(bilinear(cm.o, W, H, x, y));
        lp.push((bilinear(lumS, W, H, x, y) + bilinear(lumS, W, H, x + px, y + py) + bilinear(lumS, W, H, x - px, y - py)) / 3);
      }
      if (prof.some(Number.isNaN)) continue;
      const rAt = i => 0.3 * R + i * 0.25;
      const inIdx = (_, i) => rAt(i) >= 0.35 * R && rAt(i) <= 0.65 * R, outIdx = (_, i) => rAt(i) >= 1.4 * R;
      const inner = median(prof.filter(inIdx)), outer = median(prof.filter(outIdx));
      const ctr = inner - outer; if (ctr < 0.15) continue;
      const ec = crossing(prof, rAt, (inner + outer) / 2, true);
      if (ec === null) continue;
      // 밝기 가장자리(전체 해상도): 색 채널은 카메라·JPEG에서 해상도가 절반(4:2:0)이라 가장자리가 넓고 흐리다.
      // 밝기 대비가 충분하고 색 가장자리와 일치하면 밝기 가장자리를 쓴다. 바깥→안 탐색이라 내부 광택에 속지 않는다.
      const lOut = lp.filter(outIdx), li = median(lp.filter(inIdx)), lo = median(lOut), lc = li - lo;
      const loMad = median(lOut.map(v => Math.abs(v - lo)));
      let edge = ec, prf = prof, inr = inner, otr = outer, hi = true;
      // 조건: 충분한 밝기 대비 + 바깥(피부) 밝기가 고른 방향 + 색 가장자리와 0.8px 이내로 일치
      if (cm.useLum !== false && Math.abs(lc) >= Math.max(10, 0.12 * Math.max(li, lo)) && loMad <= 0.15 * Math.abs(lc)) {
        const el = crossing(lp, rAt, (li + lo) / 2, lc > 0);
        if (el !== null && Math.abs(el - ec) <= 0.8) { edge = el; prf = lp; inr = li; otr = lo; hi = lc > 0; lumUsed++; }
      }
      // 10–90% 전이 폭(흐림 지표) — 잡음에 덜 민감한 평활 맵에서 측정(밝기 가장자리를 쓴 경우는 밝기 맵)
      const wprof = prf === prof ? sp : prf;
      const winr = prf === prof ? median(sp.filter(inIdx)) : inr, wotr = prf === prof ? median(sp.filter(outIdx)) : otr;
      const span = winr - wotr, r10 = crossing(wprof, rAt, wotr + 0.1 * span, hi), r90 = crossing(wprof, rAt, wotr + 0.9 * span, hi);
      if (r90 !== null && r10 !== null) widths.push(Math.max(0, r10 - r90));
      pts.push({ x: d.cx + ca * edge, y: d.cy + sa * edge, ang: a }); contrasts.push(ctr);
    }
    if (pts.length < 24) return null;
    // 매개변수: cx, cy, a, b, th — 방사 거리 잔차 모델(원에 가까운 타원에 정확)
    let P = [d.cx, d.cy, d.major / 2, d.minor / 2, 0.5 * Math.atan2(2 * d.mxy, d.mxx - d.myy)];
    const resid = (Q, p) => { const dx = p.x - Q[0], dy = p.y - Q[1], c = Math.cos(Q[4]), s = Math.sin(Q[4]); const u = dx * c + dy * s, v = -dx * s + dy * c, rr = Math.hypot(u, v) || 1e-9; const re = Q[2] * Q[3] / Math.hypot(Q[3] * u / rr, Q[2] * v / rr); return rr - re; };
    let w = pts.map(() => 1), scale = 1;
    for (let it = 0; it < 14; it++) {
      const r0 = pts.map(p => resid(P, p));
      scale = Math.max(0.15, 1.4826 * median(r0.map(Math.abs)));
      if (cm.tukey && it >= 6) { const c = 4.685 * scale; w = r0.map(r => Math.abs(r) >= c ? 0 : (1 - (r / c) ** 2) ** 2); } // Tukey(재하강): 큰 이상치는 0
      else w = r0.map(r => Math.abs(r) <= 1.5 * scale ? 1 : (1.5 * scale) / Math.abs(r)); // Huber
      const J = pts.map(p => P.map((_, j) => { const h = j === 4 ? 1e-4 : 1e-3; const Q = P.slice(); Q[j] += h; return (resid(Q, p) - resid(P, p)) / h; }));
      const A = [...Array(5)].map(() => new Array(5).fill(0)), g = new Array(5).fill(0);
      for (let i = 0; i < pts.length; i++) for (let a = 0; a < 5; a++) { g[a] += w[i] * J[i][a] * r0[i]; for (let b = 0; b < 5; b++) A[a][b] += w[i] * J[i][a] * J[i][b]; }
      for (let a = 0; a < 5; a++) A[a][a] *= 1.001; A[4][4] += 1e-6;
      const step = solve5(A, g.map(v => -v)); if (!step) break;
      P = P.map((v, j) => v + step[j]);
      if (Math.hypot(step[0], step[1], step[2], step[3]) < 1e-4) break;
    }
    if (P[3] > P[2]) { [P[2], P[3]] = [P[3], P[2]]; P[4] += Math.PI / 2; }
    const rf = pts.map(p => resid(P, p));
    const inl = rf.map(r => Math.abs(r) <= Math.max(0.6, 2.5 * scale));
    const nIn = inl.filter(Boolean).length;
    // 각도 범위: 정상 가장자리 점이 없는 가장 큰 각도 공백(가림 판정)
    const angs = pts.filter((_, i) => inl[i]).map(p => p.ang).sort((a, b) => a - b);
    let gap = 0; for (let i = 0; i < angs.length; i++) gap = Math.max(gap, ((i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI) - angs[i]));
    const rms = Math.sqrt(rf.filter((_, i) => inl[i]).reduce((s, r) => s + r * r, 0) / Math.max(1, nIn));
    return { cx: P[0], cy: P[1], a: P[2], b: P[3], th: P[4], rms, inlierFrac: nIn / pts.length, coverage: nIn / N, maxGapDeg: gap * 180 / Math.PI, edgeWidth: widths.length ? median(widths) : null, contrast: median(contrasts), nEdges: pts.length, lumFrac: lumUsed / pts.length };
  }
  function solve5(A, b) {
    const n = 5, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null; [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  /**
   * 이미지에서 파란색 원형 스티커 3개를 검출하고 P1/P2/P3를 지정한다 (ALG-2).
   * opts: { toeDirection, detect, colorModel(이전 프레임에서 학습한 스티커 색 수준), prior(예측 위치 {P1,P2,P3}) }
   */
  function detectStickers(img, opts) {
    const p = Object.assign({}, DEFAULT_DETECT, opts && opts.detect);
    const toeDirection = (opts && opts.toeDirection) || 'right';
    const W = img.width, H = img.height, S = Math.min(W, H);
    const cm = chromaMap(img); cm.useLum = p.useLumEdges; cm.rawEdges = p.rawEdges; cm.tukey = p.tukey;
    const st = robustStats(cm.o, Math.max(1, Math.floor(W * H / 20000)));
    // 임계값: 배경 분포 + 하한. 이전 프레임의 스티커 색 수준을 알면(적응형 색 모델) 그에 맞춘다.
    const model = opts && opts.colorModel;
    let strong = Math.max(p.chromaStrong, st.med + 8 * st.mad), weak = Math.max(p.chromaWeak, st.med + 4 * st.mad);
    if (model && model.inner > 0) { strong = Math.max(st.med + 4 * st.mad, Math.min(strong, 0.6 * model.inner)); weak = Math.max(st.med + 2.5 * st.mad, Math.min(weak, 0.4 * model.inner)); }
    const mask = hysteresis(cm, strong, weak, p.minLum);
    const { labels, comps } = labelComponents(mask, W, H);
    const minA = Math.PI * (p.minDiaFrac * S / 2) ** 2, maxA = Math.PI * (p.maxDiaFrac * S / 2) ** 2;
    const candidates = [], rejected = [];
    for (const c of comps) {
      if (c.area < minA * 0.5 || c.area > maxA * 4) continue;
      const holes = fillHoles(mask, labels, c, W, H);
      const d = describeComponent(c, W, H);
      d.mxx = c.sxx / c.area - d.cx * d.cx; d.myy = c.syy / c.area - d.cy * d.cy; d.mxy = c.sxy / c.area - d.cx * d.cy;
      d.holeFrac = holes / c.area;
      const why = [];
      if (c.area < minA) why.push('너무 작음');
      if (c.area > maxA) why.push('너무 큼');
      if (d.touchesBorder) why.push('화면 가장자리에 걸림');
      // 1차(느슨한) 형태 거르기 — 최종 판정은 타원 피팅 품질로 한다(광택 반사가 가장자리에 닿아 생긴 홈 등 허용)
      if (d.axisRatio < p.preAxisRatio) why.push('원형이 아님(가림·겹침 의심)');
      if (d.fill < 0.65 || d.fill > 1.35 || d.bboxFill < 0.5 || d.bboxFill > 0.95) why.push('형태 불량');
      if (!why.length) {
        const f = fitEllipse(cm, d);
        if (!f) why.push('가장자리를 찾지 못함');
        else {
          d.fit = f;
          if (f.maxGapDeg > p.maxEdgeGapDeg || f.coverage < p.minEdgeCoverage) why.push('원형이 아님(가림·겹침 의심)');
          else if (f.b / f.a < p.minAxisRatio) why.push('원형이 아님(가림·겹침 의심)');
          else if (f.rms > Math.max(0.6, 0.08 * f.a)) why.push('형태 불량');
          else if (Math.hypot(f.cx - d.cx, f.cy - d.cy) > 0.35 * f.a) why.push('형태 불량');
        }
      }
      if (why.length) { d.reject = [...new Set(why)]; rejected.push(d); continue; }
      const f = d.fit;
      d.cx = f.cx; d.cy = f.cy; d.major = 2 * f.a; d.minor = 2 * f.b; d.axisRatio = f.b / f.a; d.diameterPx = 2 * f.a;
      d.score = round(clamp01((d.axisRatio - 0.6) / 0.3) * 0.35 + clamp01(1 - f.rms / Math.max(0.6, 0.08 * f.a)) * 0.35 + clamp01(f.coverage / 0.95) * 0.15 + clamp01(f.contrast / 0.6) * 0.15, 3);
      candidates.push(d);
    }
    const result = { ok: false, reasons: [], stickers: candidates, rejected, landmarks: null, quality: {}, confidence: 0, imageSize: [W, H], algorithm: ALGORITHM_VERSION, thresholds: { strong, weak, bgMed: st.med, bgMad: st.mad } };
    let set = candidates;
    // 3개 초과: 예측 위치가 있으면(추적 중) 예측과 가장 잘 맞는 3개를 고르고, 없으면 크기가 크게 다른 것부터 제외
    if (set.length > 3 && opts && opts.prior) set = pickByPrior(set, opts.prior, p.priorGate);
    if (set.length > 3) {
      const md = median(set.map(c => c.diameterPx));
      const same = set.filter(c => Math.abs(c.diameterPx - md) / md <= 0.35);
      if (same.length === 3) set = same;
    }
    result.stickers = set;
    if (set.length < 3) {
      result.reasons.push({ code: 'MISSING', msg: `스티커 ${set.length}개만 검출되었습니다(3개 필요).` });
      const big = rejected.filter(r => r.area >= minA);
      if (big.some(r => r.reject.includes('원형이 아님(가림·겹침 의심)'))) result.reasons.push({ code: 'OCCLUDED', msg: '일부 스티커가 가려졌거나 겹쳐 원형으로 검출되지 않았습니다.' });
      if (big.some(r => r.touchesBorder)) result.reasons.push({ code: 'BORDER', msg: '스티커가 화면 가장자리에 걸려 있습니다. 발 전체가 가이드 안에 들어오게 해 주세요.' });
      return result;
    }
    if (set.length > 3) { result.reasons.push({ code: 'EXTRA', msg: `파란색 원형 물체가 ${set.length}개 검출되었습니다. 배경의 파란 물체를 치워 주세요.` }); return result; }
    const dias = set.map(c => c.diameterPx), med = median(dias);
    if (dias.some(dd => Math.abs(dd - med) / med > p.sizeTolerance)) { result.reasons.push({ code: 'SIZE_MISMATCH', msg: '세 스티커의 크기가 서로 크게 다릅니다. 같은 스티커를 사용했는지, 카메라 각도가 바른지 확인해 주세요.' }); return result; }
    const pts = set.map(c => ({ x: c.cx, y: c.cy, ref: c }));
    const lm = labelLandmarks(pts, toeDirection, med, { maxNavicularT: p.maxNavicularT });
    const ews = set.map(c => c.fit.edgeWidth).filter(v => v != null);
    const edgePx = ews.length ? median(ews) : null;
    const sharpLimit = Math.max(p.blurMinPx, p.blurRelR * med / 2);
    const sharp = edgePx != null && edgePx <= sharpLimit;
    result.quality = { edgeWidthPx: edgePx, edgeLimitPx: sharpLimit, sharp, diameterPx: med, sizeCv: cv(dias), minAxisRatio: Math.min(...set.map(c => c.axisRatio)), fitRmsPx: Math.max(...set.map(c => c.fit.rms)), minCoverage: Math.min(...set.map(c => c.fit.coverage)) };
    result.colorModel = { inner: median(set.map(c => c.fit.contrast + st.med)) };
    if (!sharp) result.reasons.push({ code: 'BLUR', msg: '이미지가 흐립니다. 카메라를 고정하고 초점을 맞춘 뒤 다시 촬영해 주세요.' });
    const detConf = Math.min(...set.map(c => c.score)) * clamp01(1 - cv(dias) / 0.5);
    const sharpConf = edgePx == null ? 0 : clamp01(1.5 - edgePx / sharpLimit);
    result.landmarks = lm;
    result.detectionConfidence = round(detConf, 3);
    result.confidence = round(Math.min(detConf, lm.labelConfidence) * (0.6 + 0.4 * sharpConf), 3);
    for (const iss of lm.issues) result.reasons.push(iss);
    if (result.confidence < p.minConfidence && !result.reasons.length) result.reasons.push({ code: 'LOW_CONF', msg: `검출 신뢰도(${(result.confidence * 100).toFixed(0)}%)가 기준(${p.minConfidence * 100}%) 미만입니다.` });
    result.ok = result.reasons.length === 0;
    return result;
  }
  // 예측 위치와 후보의 최적 대응(3개 선택 × 순서) — 모든 조합 중 총거리 최소, 각 거리 ≤ 게이트
  function pickByPrior(cands, prior, gate) {
    const keys = ['P1', 'P2', 'P3'], md = median(cands.map(c => c.diameterPx)), lim = gate * md;
    let best = null;
    for (let i = 0; i < cands.length; i++) for (let j = 0; j < cands.length; j++) for (let k = 0; k < cands.length; k++) {
      if (i === j || j === k || i === k) continue;
      const ch = [cands[i], cands[j], cands[k]];
      const ds = ch.map((c, n) => Math.hypot(c.cx - prior[keys[n]].x, c.cy - prior[keys[n]].y));
      if (ds.some(v => v > lim)) continue;
      const tot = ds.reduce((a, b) => a + b, 0);
      if (!best || tot < best.tot) best = { tot, ch };
    }
    return best ? best.ch : cands;
  }

  // ───────────────────────── 단일 이미지 측정 ─────────────────────────
  /**
   * conv: { stickerDiameterMm, validated(bool), ...DEFAULT_CONVERSION 덮어쓰기 }
   * 반환 status: '측정 가능' | '보정 필요' | '측정 불가' | '재촬영 필요'
   */
  function measureImage(det, conv) {
    const c = Object.assign({}, DEFAULT_CONVERSION, conv || {});
    const out = { status: '측정 불가', heightPx: null, heightMm: null, mmPerPx: null, notes: [] };
    if (!det || !det.ok || !det.landmarks) { out.status = '재촬영 필요'; out.notes.push('스티커 검출 또는 기준점 확인에 실패했습니다.'); return out; }
    const { P1, P2, P3 } = det.landmarks;
    if (dist(P1, P3) < 1) { out.notes.push('P1과 P3 위치가 부적절합니다.'); return out; }
    out.heightPx = distanceToLine(P2, P1, P3);
    out.signedHeightPx = det.landmarks.signedDistancePx;
    out.spanPx = det.landmarks.spanPx;
    out.axisAngleDeg = det.landmarks.axisAngleDeg;
    const q = det.quality;
    const needs = [];
    if (!(c.stickerDiameterMm > 0)) needs.push('스티커 실제 지름(mm)이 설정되지 않았습니다.');
    if (!c.validated) needs.push('mm 환산 검증(보정 템플릿 시험)이 통과되지 않았습니다.');
    if (q.minAxisRatio < c.minAxisRatioForMm) needs.push(`스티커가 타원으로 보입니다(단축/장축 ${q.minAxisRatio.toFixed(2)}). 카메라를 발 안쪽 면과 수직으로 맞춰 주세요.`);
    if (q.sizeCv > c.maxSizeCv) needs.push(`세 스티커의 겉보기 크기 차이(${(q.sizeCv * 100).toFixed(1)}%)가 커서 원근 왜곡 또는 발 회전이 의심됩니다.`);
    if (q.diameterPx < c.minDiameterPx) needs.push(`스티커가 너무 작게 찍혔습니다(${q.diameterPx.toFixed(0)}px). 카메라를 조금 더 가까이 두세요.`);
    if (needs.length) { out.status = '보정 필요'; out.notes = needs; return out; }
    out.mmPerPx = c.stickerDiameterMm / q.diameterPx;
    out.heightMm = out.heightPx * out.mmPerPx;
    out.spanMm = out.spanPx * out.mmPerPx;
    out.status = '측정 가능';
    return out;
  }

  /** 체중부하 전·후 비교 */
  function comparePrePost(pre, post, conv, calibration) {
    const c = Object.assign({}, DEFAULT_CONVERSION, conv || {});
    const r = { status: '측정 불가', changeMm: null, changePx: null, notes: [], flags: [] };
    if (!pre || !post) { r.notes.push('체중부하 전·후 측정값이 모두 필요합니다.'); return r; }
    if (pre.heightPx == null || post.heightPx == null) { r.status = '재촬영 필요'; r.notes.push('전·후 중 측정되지 않은 사진이 있습니다.'); return r; }
    r.changePx = Math.abs(pre.heightPx - post.heightPx);
    if (pre.imageSize && post.imageSize && (pre.imageSize[0] !== post.imageSize[0] || pre.imageSize[1] !== post.imageSize[1])) {
      r.status = '재촬영 필요'; r.notes.push('전·후 사진의 해상도가 다릅니다. 같은 카메라 설정으로 촬영해 주세요.'); return r;
    }
    if (pre.axisAngleDeg != null && Math.abs(pre.axisAngleDeg - post.axisAngleDeg) > c.maxAxisAngleDiffDeg) {
      r.status = '재촬영 필요'; r.notes.push('전·후 사진의 발 각도가 달라졌습니다. 같은 위치·각도에서 촬영해 주세요.'); return r;
    }
    if (pre.status !== '측정 가능' || post.status !== '측정 가능') {
      r.status = (pre.status === '재촬영 필요' || post.status === '재촬영 필요') ? '재촬영 필요' : '보정 필요';
      r.notes.push('mm 환산 조건이 충족되지 않아 픽셀 값만 기록합니다.');
      r.notes.push(...(pre.notes || []).map(n => '[전] ' + n), ...(post.notes || []).map(n => '[후] ' + n));
      return r;
    }
    const sd = Math.abs(pre.mmPerPx - post.mmPerPx) / ((pre.mmPerPx + post.mmPerPx) / 2);
    if (sd > c.maxScaleDiffPrePost) {
      r.status = '재촬영 필요'; r.notes.push(`전·후 촬영 거리가 달라 축척 차이(${(sd * 100).toFixed(1)}%)가 허용치(${c.maxScaleDiffPrePost * 100}%)를 넘었습니다.`); return r;
    }
    // 카메라가 고정되었음이 축척 비교로 확인되면 두 사진의 평균 축척을 공통으로 사용한다
    // (사진별 지름 추정 잡음이 아치 높이 전체에 곱해져 변화량을 왜곡하는 것을 줄임)
    const common = (pre.mmPerPx + post.mmPerPx) / 2;
    r.mmPerPx = common;
    let preMm = pre.heightPx * common, postMm = post.heightPx * common;
    r.rawPreMm = preMm; r.rawPostMm = postMm;
    if (calibration && calibration.method && calibration.method !== 'identity') {
      preMm = applyCalibration(calibration, preMm); postMm = applyCalibration(calibration, postMm);
      r.calibrationVersion = calibration.version;
    }
    r.preMm = preMm; r.postMm = postMm;
    r.changeMm = Math.abs(preMm - postMm);
    r.scaleDiff = sd;
    if (r.changeMm >= c.maxPlausibleChangeMm) { r.status = '측정 불가'; r.notes.push(`변화량(${r.changeMm.toFixed(1)}mm)이 비정상적으로 큽니다. 스티커 위치·자세를 확인하고 다시 검사해 주세요.`); r.changeMm = null; return r; }
    if (postMm - preMm > c.riseReviewMm) r.flags.push('체중부하 후 아치 높이가 오히려 높게 측정되었습니다. 자세·스티커 위치 검토가 필요합니다.');
    r.status = '측정 가능';
    return r;
  }

  // ───────────────────────── 연구 기준 분류 ─────────────────────────
  const CATEGORIES = [
    { key: 'normal', label: '정상 범위', range: '0mm 이상 5mm 이하' },
    { key: 'mild', label: '경증 평발 의심', range: '5mm 초과 10mm 미만' },
    { key: 'moderate', label: '중등도 평발 의심', range: '10mm 이상 15mm 미만' },
    { key: 'severe', label: '중증 평발 의심', range: '15mm 이상' }
  ];
  /** 표시값(소수 첫째 자리 반올림)과 분류를 일치시키기 위해 반올림 후 분류한다. */
  function roundMm(mm) { return Math.round((mm + (mm >= 0 ? 1e-9 : -1e-9)) * 10) / 10; }
  function classify(mm) {
    if (typeof mm !== 'number' || !isFinite(mm) || mm < 0) return null;
    const v = roundMm(mm);
    let key;
    if (v <= 5) key = 'normal';
    else if (v < 10) key = 'mild';
    else if (v < 15) key = 'moderate';
    else key = 'severe';
    return Object.assign({ value: v }, CATEGORIES.find(c => c.key === key));
  }

  // ───────────────────────── 오차 지표 ─────────────────────────
  function errorMetrics(pairs, minRefForRelative) {
    const minRef = minRefForRelative == null ? 1.0 : minRefForRelative;
    const ok = pairs.filter(p => isFinite(p.ai) && isFinite(p.ref));
    const n = ok.length;
    if (!n) return { n: 0 };
    const errs = ok.map(p => p.ai - p.ref);
    const me = mean(errs), mae = mean(errs.map(Math.abs)), rmse = Math.sqrt(mean(errs.map(e => e * e)));
    const sd = n > 1 ? Math.sqrt(errs.reduce((s, e) => s + (e - me) ** 2, 0) / (n - 1)) : null;
    const rel = ok.filter(p => Math.abs(p.ref) >= minRef);
    const mape = rel.length ? mean(rel.map(p => Math.abs((p.ai - p.ref) / p.ref))) * 100 : null;
    return { n, me, mae, rmse, sd, loaLow: sd != null ? me - 1.96 * sd : null, loaHigh: sd != null ? me + 1.96 * sd : null, mape, relN: rel.length, relExcluded: n - rel.length };
  }

  // ───────────────────────── 보정 모델 ─────────────────────────
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /** 참여자 단위 분할: 동일 참여자의 반복 측정이 서로 다른 세트에 들어가지 않는다. */
  function splitByParticipant(rows, seed, fractions) {
    const fr = fractions || [0.6, 0.2, 0.2];
    const ids = [...new Set(rows.map(r => r.participantId))].sort();
    const rnd = mulberry32(seed || 42);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const nTest = Math.max(1, Math.round(ids.length * fr[2]));
    const nVal = Math.max(1, Math.round(ids.length * fr[1]));
    const test = new Set(ids.slice(0, nTest)), val = new Set(ids.slice(nTest, nTest + nVal));
    const train = new Set(ids.slice(nTest + nVal));
    const pick = s => rows.filter(r => s.has(r.participantId));
    return { train: pick(train), val: pick(val), test: pick(test), ids: { train: [...train], val: [...val], test: [...test] } };
  }

  function fitMethod(method, rows) {
    if (method === 'identity') return { method };
    if (method === 'bias') return { method, bias: mean(rows.map(r => r.ai - r.ref)) };
    if (method === 'linear') {
      const n = rows.length; if (n < 3) return null;
      const mx = mean(rows.map(r => r.ai)), my = mean(rows.map(r => r.ref));
      let sxx = 0, sxy = 0;
      for (const r of rows) { sxx += (r.ai - mx) ** 2; sxy += (r.ai - mx) * (r.ref - my); }
      if (sxx < 1e-9) return null;
      const slope = sxy / sxx; return { method, slope, intercept: my - slope * mx };
    }
    return null;
  }
  function applyCalibration(m, ai) {
    if (!m || m.method === 'identity') return ai;
    if (m.method === 'bias') return ai - m.bias;
    if (m.method === 'linear') return m.slope * ai + m.intercept;
    return ai;
  }
  const evalModel = (m, rows) => errorMetrics(rows.map(r => ({ ai: applyCalibration(m, r.ai), ref: r.ref })));

  /**
   * rows: [{participantId, ai, ref}] — 연구자가 검토 완료하고 기준값이 확인된 자료만.
   * 데이터가 부족하면 실패 사유를 반환하고 모델을 만들지 않는다.
   */
  function trainCalibration(rows, options) {
    const o = Object.assign({ seed: 42, minParticipants: 5, minRows: 10, minTestRows: 3 }, options || {});
    const clean = rows.filter(r => r.participantId && isFinite(r.ai) && isFinite(r.ref));
    const nP = new Set(clean.map(r => r.participantId)).size;
    if (clean.length < o.minRows || nP < o.minParticipants)
      return { ok: false, reason: `데이터 부족: 유효 자료 ${clean.length}건(최소 ${o.minRows}), 참여자 ${nP}명(최소 ${o.minParticipants}).` };
    const sp = splitByParticipant(clean, o.seed);
    if (sp.test.length < o.minTestRows || sp.train.length < 3 || !sp.val.length)
      return { ok: false, reason: `분할 후 자료 부족: 학습 ${sp.train.length} / 검증 ${sp.val.length} / 시험 ${sp.test.length}건.` };
    const cands = ['identity', 'bias', 'linear'].map(m => fitMethod(m, sp.train)).filter(Boolean);
    const scored = cands.map(m => ({ model: m, val: evalModel(m, sp.val) }));
    scored.sort((a, b) => a.val.mae - b.val.mae);
    const chosen = scored[0].model;
    const before = evalModel({ method: 'identity' }, sp.test), after = evalModel(chosen, sp.test);
    const improved = chosen.method !== 'identity' && after.mae < before.mae && after.rmse <= before.rmse;
    return {
      ok: true, model: chosen, improved,
      split: { train: sp.train.length, val: sp.val.length, test: sp.test.length, participants: sp.ids, seed: o.seed },
      validation: scored.map(s => ({ method: s.model.method, mae: s.val.mae, rmse: s.val.rmse, me: s.val.me })),
      testBefore: before, testAfter: after,
      recommendation: improved ? '독립 시험 데이터에서 성능이 개선되었습니다. 연구자 검토 후 배포 여부를 결정하세요.' : '독립 시험 데이터에서 개선되지 않았습니다. 기존 모델을 유지합니다.'
    };
  }

  // ───────────────────────── 환산 검증(보정 템플릿) ─────────────────────────
  // 인쇄용 템플릿 정의: 지름 D mm 원 3개, P1–P3 간격 120mm, P2는 기준선에서 30mm 위, P3로부터 50mm 지점
  const TEMPLATE = { spanMm: 120, heightMm: 30, p2FromHeelMm: 50 };
  function validateConversion(det, diameterMm, toleranceMm) {
    const tol = toleranceMm || 1.0;
    const m = measureImage(det, { stickerDiameterMm: diameterMm, validated: true });
    if (m.status !== '측정 가능') return { pass: false, reason: m.notes.join(' ') || m.status, measure: m };
    const eH = m.heightMm - TEMPLATE.heightMm, eS = m.spanMm - TEMPLATE.spanMm;
    return { pass: Math.abs(eH) <= tol && Math.abs(eS) <= tol * 2, heightMm: m.heightMm, spanMm: m.spanMm, errHeight: eH, errSpan: eS, tolerance: tol, measure: m };
  }

  // ───────────────────────── 촬영 준비 상태(실시간) ─────────────────────────
  /** 연속 프레임의 검출 결과로 움직임을 판정한다. */
  function motionBetween(a, b) {
    if (!a || !b || !a.landmarks || !b.landmarks) return Infinity;
    const k = ['P1', 'P2', 'P3'];
    const d = Math.max(...k.map(n => dist(a.landmarks[n], b.landmarks[n])));
    return d / (a.quality.diameterPx || 1); // 스티커 지름 대비 이동량
  }
  // 화면 가이드 영역(이미지 비율). 화면에 그리는 점선 가이드와 같은 값을 쓴다.
  const GUIDE = { x0: 0.04, y0: 0.12, x1: 0.96, y1: 0.92 };
  function framingCheck(det, guide) {
    if (!det.landmarks) return { ok: false, msg: '스티커를 찾는 중', code: 'NONE' };
    const g = guide || GUIDE;
    const [W, H] = det.imageSize; const { P1, P3 } = det.landmarks;
    const span = Math.abs(P1.x - P3.x) / W;
    const all = ['P1', 'P2', 'P3'].map(k => det.landmarks[k]);
    const m = det.quality.diameterPx * 1.5;
    const gx0 = Math.max(m, g.x0 * W), gy0 = Math.max(m, g.y0 * H), gx1 = Math.min(W - m, g.x1 * W), gy1 = Math.min(H - m, g.y1 * H);
    if (all.some(p => p.x < gx0)) return { ok: false, msg: '발을 화면 오른쪽으로 조금 옮겨 주세요', code: 'LEFT_OUT' };
    if (all.some(p => p.x > gx1)) return { ok: false, msg: '발을 화면 왼쪽으로 조금 옮겨 주세요', code: 'RIGHT_OUT' };
    if (all.some(p => p.y < gy0 || p.y > gy1)) return { ok: false, msg: '발이 가이드 위아래 밖에 있습니다. 휴대폰 각도를 맞춰 주세요', code: 'VERT_OUT' };
    if (span < 0.35) return { ok: false, msg: '휴대폰을 발에 조금 더 가까이 두세요', code: 'FAR' };
    if (span > 0.92) return { ok: false, msg: '휴대폰을 발에서 조금 더 멀리 두세요', code: 'NEAR' };
    return { ok: true, msg: '촬영 범위 적절', code: 'OK' };
  }

  // ───────────────────────── 트래킹 보조 ─────────────────────────
  function cropImage(img, roi) {
    const [x0, y0, w, h] = roi, out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
    return { data: out, width: w, height: h };
  }
  /** 직전 프레임 기준점 주변만 검색한다. 실패하면 null → 호출자가 전체 검색. */
  function detectInRoi(img, prev, opts) {
    if (!prev || !prev.ok || !prev.landmarks) return null;
    const pts = ['P1', 'P2', 'P3'].map(k => prev.landmarks[k]);
    const pad = prev.quality.diameterPx * 3;
    const x0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.x)) - pad)), y0 = Math.max(0, Math.floor(Math.min(...pts.map(p => p.y)) - pad));
    const x1 = Math.min(img.width, Math.ceil(Math.max(...pts.map(p => p.x)) + pad)), y1 = Math.min(img.height, Math.ceil(Math.max(...pts.map(p => p.y)) + pad));
    const w = x1 - x0, h = y1 - y0; if (w < 20 || h < 20) return null;
    const k = Math.min(img.width, img.height) / Math.min(w, h);
    const base = Object.assign({}, DEFAULT_DETECT, opts && opts.detect);
    const shiftPrior = opts && opts.prior ? Object.fromEntries(['P1', 'P2', 'P3'].map(n => [n, { x: opts.prior[n].x - x0, y: opts.prior[n].y - y0 }])) : null;
    const det = detectStickers(cropImage(img, [x0, y0, w, h]), Object.assign({}, opts, { prior: shiftPrior, detect: Object.assign({}, base, { minDiaFrac: base.minDiaFrac * k, maxDiaFrac: Math.min(0.9, base.maxDiaFrac * k) }) }));
    const shift = p => { p.x += x0; p.y += y0; };
    for (const s of det.stickers.concat(det.rejected)) { s.cx += x0; s.cy += y0; s.bbox[0] += x0; s.bbox[1] += y0; }
    if (det.landmarks) ['P1', 'P2', 'P3'].forEach(n => shift(det.landmarks[n]));
    det.imageSize = [img.width, img.height]; det.roi = [x0, y0, w, h];
    if (!det.ok || det.reasons.some(r => r.code === 'BORDER')) return null;
    return det;
  }
  /** 이전 프레임과 라벨이 일치하는지(가장 가까운 점끼리 같은 이름인지) */
  function labelsConsistent(prev, cur) {
    if (!prev || !prev.landmarks || !cur || !cur.landmarks) return true;
    const ks = ['P1', 'P2', 'P3'];
    return ks.every(k => { const p = cur.landmarks[k]; let best = null, bd = Infinity; for (const q of ks) { const d = dist(p, prev.landmarks[q]); if (d < bd) { bd = d; best = q; } } return best === k; });
  }
  /**
   * 연속 촬영(버스트) 결합: 검출 성공·선명 프레임만 쓰고, P2 높이가 중앙값에서 크게 벗어난 프레임을 제외한 뒤
   * 기준점 좌표와 스티커 지름을 평균한다. 우연한 잡음 오차를 줄이고 프레임 간 반복성(SD)을 함께 보고한다.
   */
  function combineDetections(dets, minFrames) {
    const need = minFrames || 5;
    const good = dets.filter(d => d && d.ok && d.quality && d.quality.sharp);
    if (good.length < need) return { ok: false, reason: `유효 프레임이 ${good.length}개뿐입니다(최소 ${need}개). 발과 카메라를 고정하고 다시 촬영하세요.`, used: good.length, total: dets.length };
    const h = good.map(d => distanceToLine(d.landmarks.P2, d.landmarks.P1, d.landmarks.P3));
    const med = median(h), mad = median(h.map(v => Math.abs(v - med))) || 0.1;
    const keep = good.filter((d, i) => Math.abs(h[i] - med) <= Math.max(1.0, 3 * 1.4826 * mad));
    if (keep.length < need) return { ok: false, reason: '프레임마다 측정값이 크게 달라 결과가 불안정합니다. 움직임 없이 다시 촬영하세요.', used: keep.length, total: dets.length };
    // 프레임 가중치: 타원 피팅 잔차가 작을수록(가장자리가 깨끗할수록) 크게
    const wts = keep.map(d => 1 / ((d.quality.fitRmsPx != null ? d.quality.fitRmsPx : 0.3) ** 2 + 0.01));
    const wsum = wts.reduce((a, b) => a + b, 0);
    const wmean = f => keep.reduce((s, d, i) => s + wts[i] * f(d), 0) / wsum;
    const avg = k => ({ x: wmean(d => d.landmarks[k].x), y: wmean(d => d.landmarks[k].y) });
    const base = keep[Math.floor(keep.length / 2)];
    const out = Object.assign({}, base);
    const P1 = avg('P1'), P2 = avg('P2'), P3 = avg('P3');
    out.landmarks = Object.assign({}, base.landmarks, { P1, P2, P3, signedDistancePx: signedDistanceToLine(P2, P1, P3), spanPx: dist(P1, P3), axisAngleDeg: mean(keep.map(d => d.landmarks.axisAngleDeg)), tFromHeel: projectionT(P2, P3, P1) });
    const hk = keep.map(d => distanceToLine(d.landmarks.P2, d.landmarks.P1, d.landmarks.P3));
    out.quality = Object.assign({}, base.quality, {
      diameterPx: wmean(d => d.quality.diameterPx), sizeCv: mean(keep.map(d => d.quality.sizeCv)), minAxisRatio: Math.min(...keep.map(d => d.quality.minAxisRatio)),
      burst: { total: dets.length, used: keep.length, heightSdPx: keep.length > 1 ? Math.sqrt(hk.reduce((s, v) => s + (v - mean(hk)) ** 2, 0) / (keep.length - 1)) : 0 }
    });
    out.confidence = median(keep.map(d => d.confidence)); out.detectionConfidence = median(keep.map(d => d.detectionConfidence));
    return { ok: true, det: out, baseIndex: dets.indexOf(base) };
  }
  /**
   * 기준점 칼만 필터(축별 등속 모델). 예측 위치로 탐색 영역과 라벨 대응을 정하고, 화면 표시를 부드럽게 한다.
   * q: 가속 잡음(px/s²)², 측정 잡음은 update 시 타원 피팅 잔차로 정한다.
   */
  function createLandmarkKalman(q) {
    const Q = q || 4000; const keys = ['P1', 'P2', 'P3'];
    let st = null, lastT = null, misses = 0;
    const axis = () => ({ x: 0, v: 0, P: [[1e4, 0], [0, 1e4]] });
    function predictAxis(a, dt) {
      a.x += a.v * dt;
      const [[p00, p01], [p10, p11]] = a.P;
      const n00 = p00 + dt * (p10 + p01) + dt * dt * p11 + Q * dt ** 3 / 3, n01 = p01 + dt * p11 + Q * dt * dt / 2, n11 = p11 + Q * dt;
      a.P = [[n00, n01], [n01, n11]];
    }
    function updateAxis(a, z, R) {
      const S = a.P[0][0] + R, k0 = a.P[0][0] / S, k1 = a.P[1][0] / S, y = z - a.x;
      a.x += k0 * y; a.v += k1 * y;
      const [[p00, p01], [p10, p11]] = a.P;
      a.P = [[(1 - k0) * p00, (1 - k0) * p01], [p10 - k1 * p00, p11 - k1 * p01]];
    }
    return {
      predict(t) {
        if (!st) return null;
        const dt = Math.max(0, Math.min(0.5, (t - lastT) / 1000)); lastT = t;
        for (const k of keys) { predictAxis(st[k].x, dt); predictAxis(st[k].y, dt); }
        return this.positions();
      },
      update(lm, rPx, t) {
        const R = Math.max(0.01, rPx * rPx);
        if (!st) { st = {}; for (const k of keys) { st[k] = { x: axis(), y: axis() }; st[k].x.x = lm[k].x; st[k].y.x = lm[k].y; st[k].x.P = [[R, 0], [0, 400]]; st[k].y.P = [[R, 0], [0, 400]]; } lastT = t; misses = 0; return; }
        for (const k of keys) { updateAxis(st[k].x, lm[k].x, R); updateAxis(st[k].y, lm[k].y, R); }
        misses = 0;
      },
      miss() { misses++; if (misses > 6) st = null; },
      positions() { return st ? Object.fromEntries(keys.map(k => [k, { x: st[k].x.x, y: st[k].y.x }])) : null; },
      speed() { return st ? Math.max(...keys.map(k => Math.hypot(st[k].x.v, st[k].y.v))) : Infinity; }, // px/s
      get active() { return !!st; },
      reset() { st = null; misses = 0; }
    };
  }
  function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }

  // ───────────────────────── 유틸 ─────────────────────────
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function cv(a) { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) / m; }
  function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }

  return {
    ALGORITHM_VERSION, GUIDE, DEFAULT_DETECT, DEFAULT_CONVERSION, CATEGORIES, TEMPLATE,
    rgbToHsv, detectStickers, labelLandmarks, signedDistanceToLine, distanceToLine, projectionT,
    measureImage, comparePrePost, classify, roundMm, errorMetrics,
    splitByParticipant, trainCalibration, applyCalibration, fitMethod, validateConversion,
    motionBetween, framingCheck, laplacianVariance, cropImage, detectInRoi, labelsConsistent, combineDetections, createLandmarkKalman, chromaMap
  };
});
