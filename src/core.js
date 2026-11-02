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

  const ALGORITHM_VERSION = 'ALG-1.1.0';

  // 기본 검출 파라미터 (휴리스틱 값 — 실제 사진으로 검증 후 연구자가 조정해야 함)
  const DEFAULT_DETECT = {
    hueMin: 190, hueMax: 255,      // 파란색 색상 범위(도)
    satMin: 0.40, valMin: 0.18,    // 채도·명도 하한
    blueMargin: 25,                // B 채널이 R,G 보다 커야 하는 최소 차이
    minDiaFrac: 0.012,             // 이미지 짧은 변 대비 최소 스티커 지름
    maxDiaFrac: 0.20,              // 최대 지름
    minAxisRatio: 0.75,            // 원형 판정 최소 단축/장축 비
    fillMin: 0.85, fillMax: 1.15,  // 모멘트 타원 대비 채움 비율
    bboxFillMin: 0.66, bboxFillMax: 0.90,
    sizeTolerance: 0.25,           // 3개 스티커 크기 허용 편차(중앙값 대비)
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
  function detectStickers(img, opts) {
    const p = Object.assign({}, DEFAULT_DETECT, opts && opts.detect);
    const toeDirection = (opts && opts.toeDirection) || 'right';
    const W = img.width, H = img.height, S = Math.min(W, H);
    const mask = blueMask(img, p);
    const comps = components(mask, W, H);
    const minA = Math.PI * (p.minDiaFrac * S / 2) ** 2, maxA = Math.PI * (p.maxDiaFrac * S / 2) ** 2;
    const candidates = [], rejected = [];
    for (const c of comps) {
      if (c.area < minA * 0.5) continue; // 잡음
      const d = describeComponent(c, W, H);
      const why = [];
      if (c.area < minA) why.push('너무 작음');
      if (c.area > maxA) why.push('너무 큼');
      if (d.touchesBorder) why.push('화면 가장자리에 걸림');
      if (d.axisRatio < p.minAxisRatio) why.push('원형이 아님(가림·겹침 의심)');
      if (d.fill < p.fillMin || d.fill > p.fillMax) why.push('형태 불량');
      if (d.bboxFill < p.bboxFillMin || d.bboxFill > p.bboxFillMax) why.push('형태 불량');
      d.score = scoreCandidate(d, p);
      if (why.length) { d.reject = [...new Set(why)]; rejected.push(d); } else candidates.push(d);
    }
    const result = { ok: false, reasons: [], stickers: candidates, rejected, landmarks: null, quality: {}, confidence: 0, imageSize: [W, H], algorithm: ALGORITHM_VERSION };

    if (candidates.length < 3) {
      result.reasons.push({ code: 'MISSING', msg: `스티커 ${candidates.length}개만 검출되었습니다(3개 필요).` });
      const big = rejected.filter(r => r.area >= minA);
      if (big.some(r => r.reject.includes('원형이 아님(가림·겹침 의심)'))) result.reasons.push({ code: 'OCCLUDED', msg: '일부 스티커가 가려졌거나 겹쳐 원형으로 검출되지 않았습니다.' });
      if (big.some(r => r.touchesBorder)) result.reasons.push({ code: 'BORDER', msg: '스티커가 화면 가장자리에 걸려 있습니다. 발 전체가 가이드 안에 들어오게 해 주세요.' });
      return result;
    }
    if (candidates.length > 3) {
      result.reasons.push({ code: 'EXTRA', msg: `파란색 원형 물체가 ${candidates.length}개 검출되었습니다. 배경의 파란 물체를 치워 주세요.` });
      return result;
    }
    const dias = candidates.map(c => c.major);
    const med = dias.slice().sort((a, b) => a - b)[1];
    if (dias.some(dd => Math.abs(dd - med) / med > p.sizeTolerance)) {
      result.reasons.push({ code: 'SIZE_MISMATCH', msg: '세 스티커의 크기가 서로 크게 다릅니다. 같은 스티커를 사용했는지, 카메라 각도가 바른지 확인해 주세요.' });
      return result;
    }
    // 서브픽셀 중심
    const pts = candidates.map(c => { const r = refineCenter(img, c); c.diameterPx = r.diameter; return { x: r.x, y: r.y, ref: c }; });
    const fineDias = candidates.map(c => c.diameterPx);
    const fineMed = fineDias.slice().sort((a, b) => a - b)[1];
    const lm = labelLandmarks(pts, toeDirection, med, { maxNavicularT: p.maxNavicularT });
    // 품질
    const radius = med / 2;
    const ew = pts.map(pt => edgeWidth(img, pt, radius)).filter(v => v != null);
    const edgePx = ew.length ? ew.reduce((a, b) => a + b, 0) / ew.length : null;
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const pad = med * 2;
    const roi = [Math.max(0, Math.floor(Math.min(...xs) - pad)), Math.max(0, Math.floor(Math.min(...ys) - pad))];
    roi.push(Math.min(W - roi[0], Math.ceil(Math.max(...xs) - Math.min(...xs) + 2 * pad)), Math.min(H - roi[1], Math.ceil(Math.max(...ys) - Math.min(...ys) + 2 * pad)));
    const lapVar = laplacianVariance(img, roi);
    const sharpLimit = Math.max(2.5, 0.22 * radius);
    const sharp = edgePx != null && edgePx <= sharpLimit;
    result.quality = { edgeWidthPx: edgePx, edgeLimitPx: sharpLimit, sharp, laplacianVar: lapVar, diameterPx: fineMed, sizeCv: cv(fineDias), minAxisRatio: Math.min(...candidates.map(c => c.axisRatio)) };
    if (!sharp) result.reasons.push({ code: 'BLUR', msg: '이미지가 흐립니다. 카메라를 고정하고 초점을 맞춘 뒤 다시 촬영해 주세요.' });

    const detConf = Math.min(...candidates.map(c => c.score)) * clamp01(1 - cv(dias) / 0.5);
    const sharpConf = edgePx == null ? 0 : clamp01(1.5 - edgePx / sharpLimit);
    result.landmarks = lm;
    result.detectionConfidence = round(detConf, 3);
    result.confidence = round(Math.min(detConf, lm.labelConfidence) * (0.6 + 0.4 * sharpConf), 3);
    for (const iss of lm.issues) result.reasons.push(iss);
    if (result.confidence < p.minConfidence && !result.reasons.length) result.reasons.push({ code: 'LOW_CONF', msg: `검출 신뢰도(${(result.confidence * 100).toFixed(0)}%)가 기준(${p.minConfidence * 100}%) 미만입니다.` });
    result.ok = result.reasons.length === 0;
    return result;
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
  function framingCheck(det) {
    if (!det.landmarks) return { ok: false, msg: '스티커를 찾는 중' };
    const [W, H] = det.imageSize; const { P1, P3 } = det.landmarks;
    const span = Math.abs(P1.x - P3.x) / W;
    const all = ['P1', 'P2', 'P3'].map(k => det.landmarks[k]);
    const m = det.quality.diameterPx * 1.5;
    if (all.some(p => p.x < m || p.y < m || p.x > W - m || p.y > H - m)) return { ok: false, msg: '발을 가이드 중앙으로 옮겨 주세요' };
    if (span < 0.35) return { ok: false, msg: '카메라를 조금 더 가까이 하세요' };
    if (span > 0.92) return { ok: false, msg: '카메라를 조금 더 멀리 하세요' };
    return { ok: true, msg: '촬영 범위 적절' };
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
    const det = detectStickers(cropImage(img, [x0, y0, w, h]), Object.assign({}, opts, { detect: Object.assign({}, base, { minDiaFrac: base.minDiaFrac * k, maxDiaFrac: Math.min(0.9, base.maxDiaFrac * k) }) }));
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
    const avg = k => ({ x: mean(keep.map(d => d.landmarks[k].x)), y: mean(keep.map(d => d.landmarks[k].y)) });
    const base = keep[Math.floor(keep.length / 2)];
    const out = Object.assign({}, base);
    const P1 = avg('P1'), P2 = avg('P2'), P3 = avg('P3');
    out.landmarks = Object.assign({}, base.landmarks, { P1, P2, P3, signedDistancePx: signedDistanceToLine(P2, P1, P3), spanPx: dist(P1, P3), axisAngleDeg: mean(keep.map(d => d.landmarks.axisAngleDeg)), tFromHeel: projectionT(P2, P3, P1) });
    const hk = keep.map(d => distanceToLine(d.landmarks.P2, d.landmarks.P1, d.landmarks.P3));
    out.quality = Object.assign({}, base.quality, {
      diameterPx: mean(keep.map(d => d.quality.diameterPx)), sizeCv: mean(keep.map(d => d.quality.sizeCv)), minAxisRatio: Math.min(...keep.map(d => d.quality.minAxisRatio)),
      burst: { total: dets.length, used: keep.length, heightSdPx: keep.length > 1 ? Math.sqrt(hk.reduce((s, v) => s + (v - mean(hk)) ** 2, 0) / (keep.length - 1)) : 0 }
    });
    out.confidence = median(keep.map(d => d.confidence)); out.detectionConfidence = median(keep.map(d => d.detectionConfidence));
    return { ok: true, det: out, baseIndex: dets.indexOf(base) };
  }
  function median(a) { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; }

  // ───────────────────────── 유틸 ─────────────────────────
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
  function cv(a) { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) / m; }
  function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }

  return {
    ALGORITHM_VERSION, DEFAULT_DETECT, DEFAULT_CONVERSION, CATEGORIES, TEMPLATE,
    rgbToHsv, detectStickers, labelLandmarks, signedDistanceToLine, distanceToLine, projectionT,
    measureImage, comparePrePost, classify, roundMm, errorMetrics,
    splitByParticipant, trainCalibration, applyCalibration, fitMethod, validateConversion,
    motionBetween, framingCheck, laplacianVariance, cropImage, detectInRoi, labelsConsistent, combineDetections
  };
});
