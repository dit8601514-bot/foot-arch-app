/*
 * FootCore — 발활 측정 핵심 로직 (UI·저장소와 분리된 순수 함수)
 * 브라우저(window.FootCore)와 Node(module.exports) 양쪽에서 동작한다.
 * 측정 알고리즘 버전은 ALGORITHM_VERSION 으로 관리한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FootCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALGORITHM_VERSION = 'ALG-2.6.1';

  // 기본 검출 파라미터 (휴리스틱 값 — 실제 사진으로 검증 후 연구자가 조정해야 함)
  const DEFAULT_DETECT = {
    hueMin: 190, hueMax: 255,      // 파란색 색상 범위(도)
    satMin: 0.40, valMin: 0.18,    // 채도·명도 하한
    blueMargin: 25,                // B 채널이 R,G 보다 커야 하는 최소 차이
    minDiaFrac: 0.012,             // 이미지 짧은 변 대비 최소 스티커 지름
    maxDiaFrac: 0.36,              // 최대 지름(가까이 찍어도 되게)
    stickerHue: 214, hueTol: 24,   // 스티커 고유 색상(실측: 파란 원형 스티커 212~216°)과 허용 폭 — 추적 중에는 실제 색으로 갱신
    minAxisRatio: 0.66,            // 원형 판정 최소 단축/장축 비(발 곡면·가까운 촬영에서는 스티커가 약간 타원)
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
    minAxisRatioForMm: 0.75,       // 이 미만이면 촬영 각도 기울어짐 → 보정 필요(지름은 장축으로 재므로 곡면의 약한 타원은 허용)
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

  // 스티커 내부(반지름 60%)의 색상·채도 중앙값 — 피부·바닥·청바지처럼 파란 기운만 있는 것과 실제 스티커 색을 구분
  function innerHue(img, f) {
    const { data, width: W, height: H } = img, hs = [], ss = [], r = 0.6 * Math.min(f.a, f.b), st = Math.max(1, r / 6);
    for (let dy = -r; dy <= r; dy += st) for (let dx = -r; dx <= r; dx += st) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(f.cx + dx), y = Math.round(f.cy + dy); if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = (y * W + x) * 4, [h, sa, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (v > 0.93 && sa < 0.35) continue; // 광택 반사는 빼고
      hs.push(h); ss.push(sa);
    }
    return { hue: hs.length ? circMeanHue(hs) : 0, sat: ss.length ? median(ss) : 0, n: hs.length };
  }
  function circMeanHue(a) { let x = 0, y = 0; for (const h of a) { x += Math.cos(h * Math.PI / 180); y += Math.sin(h * Math.PI / 180); } let m = Math.atan2(y, x) * 180 / Math.PI; return m < 0 ? m + 360 : m; }
  function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

  /**
   * 발 윤곽 정밀 추적: 표준 발 모델을 스티커에 맞춰 놓은 윤곽(pts)의 각 점에서, 법선 방향으로 ±range 안의
   * 가장 뚜렷한 색 경계(피부 ↔ 바닥·벽)를 찾아 붙인다. 이웃끼리 중앙값·평균으로 다듬어 튀는 점을 없앤다.
   * rgb: {data(Uint8 RGB), w, h, s(원본→축소 배율)}. 반환 { pts, conf(0~1 각 점), score(평균) }
   */
  function snapOutline(rgb, pts, range, avoid) {
    const { data, w, h, s } = rgb, n = pts.length, off = new Float32Array(n), cf = new Float32Array(n);
    const px = (x, y, c) => { const xi = Math.max(0, Math.min(w - 1, Math.round(x))), yi = Math.max(0, Math.min(h - 1, Math.round(y))); return data[(yi * w + xi) * 3 + c]; };
    const R = Math.max(4, range * s);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, ty = b.y - a.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = -ty, ny = tx, x0 = pts[i].x * s, y0 = pts[i].y * s;
      if (avoid && avoid.some(q => Math.hypot(q.x - pts[i].x, q.y - pts[i].y) < q.r)) continue;
      let best = 0, bt = 0;
      for (let t = -R; t <= R; t += 1) {
        const xa = x0 + nx * (t - 2), ya = y0 + ny * (t - 2), xb = x0 + nx * (t + 2), yb = y0 + ny * (t + 2);
        let d = 0; for (let c = 0; c < 3; c++) d += Math.abs(px(xa, ya, c) - px(xb, yb, c));
        const sc = d * Math.exp(-(t * t) / (2 * (0.7 * R) ** 2));
        if (sc > best) { best = sc; bt = t; }
      }
      cf[i] = clamp01((best - 18) / 70); off[i] = cf[i] > 0.15 ? bt / s : 0;
    }
    // 다듬기: 5점 중앙값 → 3점 평균(신뢰도 가중)
    const med = new Float32Array(n);
    for (let i = 0; i < n; i++) { const w5 = []; for (let j = -2; j <= 2; j++) { const k = i + j; if (k >= 0 && k < n) w5.push(off[k]); } med[i] = median(w5); }
    const out = [], conf = [];
    for (let i = 0; i < n; i++) {
      let sw = 0, sv = 0; for (let j = -1; j <= 1; j++) { const k = i + j; if (k < 0 || k >= n) continue; const ww = 0.3 + cf[k]; sw += ww; sv += med[k] * ww; }
      const o = sv / sw, a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      out.push({ x: pts[i].x - (b.y - a.y) / L * o, y: pts[i].y + (b.x - a.x) / L * o }); conf.push(cf[i]);
    }
    return { pts: out, conf, score: conf.reduce((x, y) => x + y, 0) / n };
  }
  /**
   * 실제 발 영역 분할 v2(정밀 발 윤곽 추적, 2026-11 사용자 화면 보고 반영):
   * ① 발 좌표계(P3→P1 축)로 화면을 펴고, 해부학적으로 가능한 범위(뒤꿈치 P3 뒤 1.3지름, 발끝 P1 앞 0.5, 발목 높이 상한)
   *    안에서만 발을 찾는다 → 뒤꿈치 뒤 분홍 매트·벽·다리로 새지 않음
   * ② 피부 모델: 스티커 둘레 + P3–P1 사이 띠, 배경 모델: 범위 밖 픽셀을 6무리(k-평균)로 — 벽·카펫·매트를 각각 배움
   * ③ 특징에 질감(밝기 라플라시안)을 넣어 피부색과 비슷한 카펫·매트를 구분
   * ④ 열마다 기준선 근처에서 이어진 구간만(빈칸 2칸 허용) → 떨어진 덩어리는 버림
   * cache(선택): 색 모델을 8프레임마다 다시 배워 휴대폰 부담을 줄인다
   * 반환 { pts(분석 좌표: 발등·발목 → 발바닥), nTop, score(0~1), area, allIn } 또는 null
   */
  function segmentFoot(rgb, L, dia, cache, sole) {
    const { data, w, h, s } = rgb;
    // 특징: 색도 r, g, 채도, 밝기, 질감(카펫처럼 거친 면은 피부가 아님)
    const N = w * h, lum = new Float32Array(N), lap = new Float32Array(N), tex = new Float32Array(N);
    // 밝기·질감은 필요한 사각형에서만 계산(색 모델을 다시 배울 때만 화면 전체)
    const texRect = (xa, ya, xb, yb) => {
      xa = Math.max(0, xa | 0); ya = Math.max(0, ya | 0); xb = Math.min(w - 1, Math.ceil(xb)); yb = Math.min(h - 1, Math.ceil(yb));
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const i = y * w + x; lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2]; }
      for (let y = Math.max(1, ya); y <= Math.min(h - 2, yb); y++) for (let x = Math.max(1, xa); x <= Math.min(w - 2, xb); x++) { const i = y * w + x; lap[i] = Math.abs(4 * lum[i] - lum[i - 1] - lum[i + 1] - lum[i - w] - lum[i + w]); }
      for (let y = Math.max(2, ya + 1); y <= Math.min(h - 3, yb - 1); y++) for (let x = Math.max(2, xa + 1); x <= Math.min(w - 3, xb - 1); x++) { const i = y * w + x; tex[i] = (lap[i - w - 1] + lap[i - w] + lap[i - w + 1] + lap[i - 1] + lap[i] + lap[i + 1] + lap[i + w - 1] + lap[i + w] + lap[i + w + 1]) / 9; }
    };
    const D = 5, feat = (i, o) => { const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2], t = r + g + b + 1, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      o[0] = r / t; o[1] = g / t; o[2] = mx ? (mx - mn) / mx * 0.35 : 0; o[3] = lum[i] / 255 * 0.25; o[4] = Math.min(tex[i], 60) / 60 * 0.3; return o; };
    const isBlue = i => data[i * 3 + 2] > Math.max(data[i * 3], data[i * 3 + 1]) + 25;
    const inv = M => { const n = M.length, A = M.map((r, i) => r.concat(M.map((_, j) => +(i === j)))); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const v = A[c][c]; if (Math.abs(v) < 1e-12) return null; for (let k = 0; k < 2 * n; k++) A[c][k] /= v; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k]; } } return A.map(r => r.slice(n)); };
    const fit = X => { if (X.length < 12) return null; const m = new Array(D).fill(0); for (const x of X) for (let c = 0; c < D; c++) m[c] += x[c] / X.length;
      const S = Array.from({ length: D }, (_, a) => Array.from({ length: D }, (_, b) => a === b ? 4e-5 : 0)); for (const x of X) for (let a = 0; a < D; a++) for (let b = 0; b < D; b++) S[a][b] += (x[a] - m[a]) * (x[b] - m[b]) / X.length;
      const I = inv(S); return I ? { m, I } : null; };
    const md = (G, f) => { let s2 = 0; for (let a = 0; a < D; a++) { let r = 0; for (let b = 0; b < D; b++) r += G.I[a][b] * (f[b] - G.m[b]); s2 += (f[a] - G.m[a]) * r; } return s2; };
    // 발 좌표계: u = P3→P1(1 = 두 스티커 사이), v = 수직(발등 쪽 +). 단위: P1–P3 거리
    const P1 = { x: L.P1.x * s, y: L.P1.y * s }, P3 = { x: L.P3.x * s, y: L.P3.y * s }, P2 = { x: L.P2.x * s, y: L.P2.y * s }, R = dia * s;
    const span = Math.hypot(P1.x - P3.x, P1.y - P3.y); if (span < 8) return null;
    const eu = { x: (P1.x - P3.x) / span, y: (P1.y - P3.y) / span }; let ev = { x: -eu.y, y: eu.x };
    if ((P2.x - P3.x) * ev.x + (P2.y - P3.y) * ev.y < 0) ev = { x: -ev.x, y: -ev.y };
    const toImg = (u, v) => ({ x: P3.x + span * (u * eu.x + v * ev.x), y: P3.y + span * (u * eu.y + v * ev.y) });
    const toUV = (x, y) => { const dx = x - P3.x, dy = y - P3.y; return { u: (dx * eu.x + dy * eu.y) / span, v: (dx * ev.x + dy * ev.y) / span }; };
    const r = R / span; // 스티커 지름(발 단위)
    // 해부학 범위(봉투): 뒤꿈치는 P3 뒤 1.3지름, 발끝은 P1 앞 0.5, 발바닥은 기준선 아래 1.9지름, 발등 높이는 위치별 상한
    const u0 = -1.3 * r - 0.02, u1 = 1.5, vMin = -1.9 * r;
    const vMaxAt = u => { const T = [[-9, 0.62], [0.35, 0.62], [0.7, 0.38], [1.0, 0.26], [1.5, 0.1]]; for (let k = 1; k < T.length; k++) if (u <= T[k][0]) { const [a, va] = T[k - 1], [b, vb] = T[k]; return va + (vb - va) * (u - a) / (b - a); } return 0.1; };
    const inEnv = (u, v, m) => u >= u0 - m && u <= u1 + m && v >= vMin - m && v <= vMaxAt(u) * (1 + m) + m;
    const reuse = cache && cache.GS && cache.n < 8 && cache.w === w;
    if (reuse) { const cs = [[u0, vMin], [u0, 0.7], [u1, vMin], [u1, 0.7]].map(([u, v]) => toImg(u, v)); texRect(Math.min(...cs.map(p => p.x)) - 3, Math.min(...cs.map(p => p.y)) - 3, Math.max(...cs.map(p => p.x)) + 3, Math.max(...cs.map(p => p.y)) + 3); }
    else texRect(0, 0, w - 1, h - 1);
    // 피부 표본: 스티커 둘레 고리 + P3–P1 사이 띠(발 안쪽 면 = 확실한 피부)
    const fb = new Float32Array(D), skin = [];
    const push = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return; const i = y * w + x; if (!isBlue(i)) skin.push(Array.from(feat(i, fb))); };
    for (const P of [P1, P2, P3]) for (let a = 0; a < 48; a++) for (const rr of [0.8, 1.0, 1.2]) push(P.x + Math.cos(a / 48 * 6.283) * R * rr, P.y + Math.sin(a / 48 * 6.283) * R * rr);
    for (let u = 0.1; u <= 0.9; u += 0.02) for (let v = 0.02; v <= 0.08; v += 0.03) { const p = toImg(u, v); const q = [P1, P2, P3].every(P => Math.hypot(p.x - P.x, p.y - P.y) > 0.8 * R); if (q) push(p.x, p.y); }
    // 색 모델은 몇 프레임마다 한 번만 새로 배운다(휴대폰 부담 줄이기) — 조명·사람이 바뀌면 자동으로 다시
    const GS = reuse ? cache.GS : fit(skin); if (!GS) return null;
    // 배경 표본: 봉투 밖(여유 0.12) 픽셀 → k-평균 6무리
    let GB;
    if (reuse) { GB = cache.GB; cache.n++; }
    else {
      const bg = [];
      for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) { const q = toUV(x, y); if (!inEnv(q.u, q.v, 0.12)) bg.push(Array.from(feat(y * w + x, fb))); }
      const K = 6, cents = []; for (let k = 0; k < K && bg.length; k++) cents.push(bg[Math.floor((k + 0.5) * bg.length / K)].slice());
      const asg = new Int32Array(bg.length);
      for (let it = 0; it < 6; it++) {
        const sum = cents.map(() => new Float64Array(D)), cnt = new Int32Array(cents.length);
        for (let n = 0; n < bg.length; n++) { let bd = Infinity, bk = 0; for (let k = 0; k < cents.length; k++) { let d = 0; for (let c = 0; c < D; c++) d += (bg[n][c] - cents[k][c]) ** 2; if (d < bd) { bd = d; bk = k; } } asg[n] = bk; cnt[bk]++; for (let c = 0; c < D; c++) sum[bk][c] += bg[n][c]; }
        for (let k = 0; k < cents.length; k++) if (cnt[k]) for (let c = 0; c < D; c++) cents[k][c] = sum[k][c] / cnt[k];
      }
      const groups = cents.map(() => []); for (let n = 0; n < bg.length; n++) groups[asg[n]].push(bg[n]);
      GB = groups.map(fit).filter(Boolean);
      if (cache) Object.assign(cache, { GS, GB, n: 0, w });
    }
    // 펴진 격자에서 분류
    const NU = 120, du = (u1 - u0) / NU, vTop = 0.7, NV = Math.ceil((vTop - vMin) / du);
    const cell = new Uint8Array(NU * NV);
    for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
      const u = u0 + (iu + 0.5) * du, v = vMin + (iv + 0.5) * du; if (v > vMaxAt(u) * 1.12 + 0.02) continue;
      const p = toImg(u, v), x = Math.round(p.x), y = Math.round(p.y); if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i = y * w + x; if (isBlue(i)) { cell[iu * NV + iv] = 1; continue; }
      const f = feat(i, fb), dS = md(GS, f); if (dS > 20) continue;
      let dB = Infinity; for (const G of GB) dB = Math.min(dB, md(G, f));
      if (dS < dB) cell[iu * NV + iv] = 1;
    }
    // 스티커·기준선 띠에서 시작해 이어진 피부만
    const lab = new Uint8Array(NU * NV), q = []; const ivOf = v => Math.max(0, Math.min(NV - 1, Math.floor((v - vMin) / du))), iuOf = u => Math.max(0, Math.min(NU - 1, Math.floor((u - u0) / du)));
    for (let u = 0; u <= 1; u += du) { const k = iuOf(u) * NV + ivOf(0.02); if (cell[k] && !lab[k]) { lab[k] = 1; q.push(k); } }
    for (let qh = 0; qh < q.length; qh++) { const k = q[qh], iu = (k / NV) | 0, iv = k % NV; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ju = iu + a, jv = iv + b; if (ju < 0 || jv < 0 || ju >= NU || jv >= NV) continue; const j = ju * NV + jv; if (cell[j] && !lab[j]) { lab[j] = 1; q.push(j); } } }
    if (q.length < 40) return null;
    // 열마다: 기준선 근처에서 위·아래로 이어진 구간(빈칸 2칸까지 허용)
    const topV = new Float32Array(NU).fill(NaN), botV = new Float32Array(NU).fill(NaN);
    for (let iu = 0; iu < NU; iu++) {
      let best = null, cur = null, gap = 0;
      for (let iv = 0; iv < NV; iv++) { if (lab[iu * NV + iv]) { if (!cur) cur = { a: iv, b: iv, n: 0 }; cur.b = iv; cur.n++; gap = 0; } else if (cur && ++gap > 2) { if (!best || cur.n > best.n) best = cur; cur = null; gap = 0; } }
      if (cur && (!best || cur.n > best.n)) best = cur;
      if (best && best.n >= 3) { botV[iu] = vMin + best.a * du; topV[iu] = vMin + (best.b + 1) * du; }
    }
    // 앞·뒤 끝: u∈[0,1]에서 시작해 빈 열이 3개 이어지면 끝
    let a0 = iuOf(0.5), a1 = a0, miss = 0; while (a0 > 0 && miss < 3) { a0--; if (isNaN(topV[a0])) miss++; else miss = 0; } a0 += miss;
    miss = 0; while (a1 < NU - 1 && miss < 3) { a1++; if (isNaN(topV[a1])) miss++; else miss = 0; } a1 -= miss;
    if (a1 - a0 < 10) return null;
    const sm = (A, i, k) => { const v = []; for (let j = -k; j <= k; j++) { const t = A[i + j]; if (i + j >= a0 && i + j <= a1 && !isNaN(t)) v.push(t); } v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
    // 발바닥 쪽: 피부색과 비슷한 카펫으로 아래로 파고든 열을 바로잡는다 — 발바닥은 거의 직선이므로
    // 아래로 튄 점을 빼고 직선을 맞춘 뒤(3회), 그 직선보다 0.3지름 넘게 아래로 내려가지 못하게 한다. 바닥선이 있으면 그 선이 하한.
    const bu = [], bv = []; for (let iu = a0; iu <= a1; iu++) { const u = u0 + (iu + 0.5) * du, b = sm(botV, iu, 5); if (!isNaN(b) && u > -0.1 && u < 1.1) { bu.push(u); bv.push(b); } }
    let la = 0, lb = null; // v = la + lb·u
    if (bu.length >= 8) {
      let keep = bu.map(() => true);
      for (let it = 0; it < 3; it++) { const U = bu.filter((_, j) => keep[j]), V = bv.filter((_, j) => keep[j]); if (U.length < 6) break; const mu = mean(U), mv = mean(V);
        let sxx = 0, sxy = 0; for (let j = 0; j < U.length; j++) { sxx += (U[j] - mu) ** 2; sxy += (U[j] - mu) * (V[j] - mv); } lb = sxx > 1e-9 ? sxy / sxx : 0; la = mv - lb * mu;
        keep = bu.map((u, j) => bv[j] > la + lb * u - 0.25 * r); }
    }
    // 바닥선(분석 좌표 y = slope·x + intercept)이 있으면: 이 u에서 발바닥 방향으로 그 선과 만나는 v가 하한
    const floorV = u => { if (!(sole && isFinite(sole.slope) && isFinite(sole.intercept))) return -Infinity; const p0 = toImg(u, 0), p1 = toImg(u, -1);
      const f = t => (p0.y + (p1.y - p0.y) * t) / s - (sole.slope * (p0.x + (p1.x - p0.x) * t) / s + sole.intercept), fa = f(0), fb = f(1); return Math.abs(fb - fa) > 1e-9 ? -(fa / (fb - fa)) - 0.1 * r : -Infinity; };
    const top = [], bot = [];
    for (let iu = a0; iu <= a1; iu++) { const u = u0 + (iu + 0.5) * du, t = sm(topV, iu, 3); let b = sm(botV, iu, 5); if (!isNaN(t)) top.push(toImg(u, t));
      if (!isNaN(b)) { if (lb != null) b = Math.max(b, la + lb * u - 0.3 * r); b = Math.max(b, floorV(u), vMin); if (!isNaN(t)) b = Math.min(b, t - du); bot.push(toImg(u, b)); } }
    const pts = top.concat(bot.reverse()).map(p => ({ x: p.x / s, y: p.y / s }));
    const allIn = [L.P1, L.P2, L.P3].every(P => { const c = toUV(P.x * s, P.y * s), k = iuOf(c.u) * NV + ivOf(c.v); return lab[k]; });
    const capped = top.length ? top.filter((p, j) => { const c = toUV(p.x, p.y); return c.v < vMaxAt(c.u) * 1.08; }).length / top.length : 0;
    return { pts, nTop: top.length, score: Math.max(0, Math.min(1, 0.35 + 0.65 * capped)), area: q.length * du * du * span * span / s / s, allIn };
  }
  // 닫힌 윤곽을 길이 기준으로 n개 점으로 다시 나눈다(프레임 간 같은 번호 점끼리 부드럽게 잇기 위해)
  function resampleClosed(pts, n) {
    const P = pts.concat([pts[0]]), cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    const T = cum[cum.length - 1] || 1, out = []; let j = 1;
    for (let k = 0; k < n; k++) { const d = T * k / n; while (j < cum.length - 1 && cum[j] < d) j++; const a = P[j - 1], b = P[j], u = (d - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }); }
    return out;
  }
  // 점 사이를 촘촘하게(곡선 따라) 나눈다
  function densify(pts, step) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)); for (let j = 0; j < k; j++) out.push({ x: a.x + (b.x - a.x) * j / k, y: a.y + (b.y - a.y) * j / k }); }
    out.push(pts[pts.length - 1]); return out;
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
   * (2) P2가 기준선 위(발등 쪽)에 있는지, (3) 발배뼈가 첫째발허리뼈머리보다 발꿈치에 가까운지
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
    // 발가락 방향 자동 인지: 발배뼈(P2)는 해부학적으로 발꿈치 쪽(축의 0.2~0.5)에 있다 → 두 방향 중 P2가 발꿈치 쪽에 오는 쪽을 고른다.
    // (왼발/오른발 선택이나 휴대폰 방향이 안내와 달라도 라벨이 뒤바뀌지 않게) 애매하면(가운데) 안내 방향을 따른다.
    if (opts && opts.autoToe && Math.abs(axis.x) > 1e-6) {
      const tA = projectionT(mid, e1, e2); // e1을 발꿈치로 볼 때
      const right = axis.x > 0; // e1→e2가 화면 오른쪽
      const want = toeDirection === 'left' ? 'left' : 'right';
      if (Math.abs(tA - 0.5) > 0.06) { const heelIsE1 = tA < 0.5; toeDirection = (heelIsE1 === right) ? 'right' : 'left'; }
      else toeDirection = want;
    }
    const toeVec = toeDirection === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
    const dot = axis.x * toeVec.x + axis.y * toeVec.y;
    const P1 = dot >= 0 ? e2 : e1;   // 발가락 쪽 끝 = 첫째발허리뼈머리
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
    if (span < 5 * diaPx) issues.push({ code: 'SPAN_SHORT', msg: '스티커 간 거리가 너무 짧습니다. 부착 위치(첫째발허리뼈머리–발꿈치)를 확인해 주세요.' });

    // 라벨 신뢰도: 경계로부터의 여유
    conf *= clamp01((Math.min(tFromHeel, 0.88 - tFromHeel) ) / 0.2 + 0.2);
    conf *= clamp01(1 - Math.max(0, Math.abs(axisAngleDeg) - 15) / 20);
    conf *= Math.abs(signed) < 0.5 * diaPx ? 0.8 : 1;
    return { P1, P2, P3, axisAngleDeg, tFromHeel, signedDistancePx: signed, spanPx: span, labelConfidence: clamp01(conf), issues, toeDirection };
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
      const hs = innerHue(img, d.fit), refHue = (model && model.hue) || p.stickerHue;
      d.hue = hs.hue; d.sat = hs.sat;
      if (hs.n < 6 || hueDist(hs.hue, refHue) > p.hueTol || hs.sat < 0.45) { d.reject = ['스티커 색이 아님']; rejected.push(d); continue; }
      const f = d.fit;
      d.cx = f.cx; d.cy = f.cy; d.major = 2 * f.a; d.minor = 2 * f.b; d.axisRatio = f.b / f.a; d.diameterPx = 2 * f.a;
      // 점수: 원형(발 곡면의 약한 타원은 정상) · 가장자리 피팅 잔차 · 가장자리 덮임 · 대비 · 스티커 색 일치
      const hueOk = clamp01(1 - hueDist(d.hue || 0, (model && model.hue) || p.stickerHue) / p.hueTol);
      d.score = round(clamp01((d.axisRatio - 0.66) / 0.2) * 0.25 + clamp01(1 - f.rms / Math.max(0.6, 0.08 * f.a)) * 0.35 + clamp01(f.coverage / 0.95) * 0.15 + clamp01(f.contrast / 0.6) * 0.1 + (0.5 + 0.5 * hueOk) * 0.15, 3);
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
    const lm = labelLandmarks(pts, toeDirection, med, { maxNavicularT: p.maxNavicularT, autoToe: !(opts && opts.strictToe) });
    const ews = set.map(c => c.fit.edgeWidth).filter(v => v != null);
    const edgePx = ews.length ? median(ews) : null;
    const sharpLimit = Math.max(p.blurMinPx, p.blurRelR * med / 2);
    const sharp = edgePx != null && edgePx <= sharpLimit;
    result.quality = { edgeWidthPx: edgePx, edgeLimitPx: sharpLimit, sharp, diameterPx: med, sizeCv: cv(dias), minAxisRatio: Math.min(...set.map(c => c.axisRatio)), fitRmsPx: Math.max(...set.map(c => c.fit.rms)), minCoverage: Math.min(...set.map(c => c.fit.coverage)) };
    result.colorModel = { inner: median(set.map(c => c.fit.contrast + st.med)), hue: circMeanHue(set.map(c => c.hue)) };
    if (!sharp) result.reasons.push({ code: 'BLUR', msg: '이미지가 흐립니다. 카메라를 고정하고 초점을 맞춘 뒤 다시 촬영해 주세요.' });
    const detConf = Math.min(...set.map(c => c.score)) * clamp01(1 - Math.max(0, cv(dias) - 0.04) / 0.25); // 원근으로 생기는 5% 안팎의 크기 차이는 정상
    const sharpConf = edgePx == null ? 0 : clamp01(1.5 - edgePx / sharpLimit);
    result.landmarks = lm;
    result.detectionConfidence = round(detConf, 3);
    result.confidence = round(Math.min(detConf, lm.labelConfidence) * (0.6 + 0.4 * sharpConf), 3);
    for (const iss of lm.issues) result.reasons.push(iss);
    if (result.confidence < p.minConfidence && !result.reasons.length) result.reasons.push({ code: 'LOW_CONF', msg: `검출 신뢰도(${(result.confidence * 100).toFixed(0)}%)가 기준(${p.minConfidence * 100}%) 미만입니다.` });
    result.ok = result.reasons.length === 0;
    if (result.ok && !(opts && opts.skipSole)) result.sole = detectSoleLine(img, result);
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
    // 스티커 발활 각도: P2(발배뼈)에서 P3(발꿈치)·P1(첫째발허리뼈머리)로 향하는 두 선이 이루는 각. 발활이 낮아질수록 180°에 가까워진다.
    out.archAngleDeg = archAngle(P1, P2, P3);
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
    if (needs.length) { out.status = '보정 필요'; out.notes = needs; attachFloor(out, det, c); return out; }
    out.mmPerPx = c.stickerDiameterMm / q.diameterPx;
    out.heightMm = out.heightPx * out.mmPerPx;
    out.spanMm = out.spanPx * out.mmPerPx;
    out.status = '측정 가능';
    attachFloor(out, det, c);
    return out;
  }

  // 바닥 기준 높이(px, 가능하면 mm)와 스티커 부착 높이 점검(표준: P1·P3 바닥에서 20 mm)
  function attachFloor(out, det, c) {
    const so = det.sole;
    if (!so || !so.ok) { out.floor = { ok: false, reason: so ? so.reason : '바닥선 미검출' }; return; }
    const L = det.landmarks, f = { ok: true, P1Px: heightAboveSole(L.P1, so), P2Px: heightAboveSole(L.P2, so), P3Px: heightAboveSole(L.P3, so), soleFrames: so.frames || 1, soleSdPx: so.sdPx || 0 };
    if (out.mmPerPx) {
      for (const k of ['P1', 'P2', 'P3']) f[k + 'Mm'] = f[k + 'Px'] * out.mmPerPx;
      const std = c.standardStickerHeightMm || 20, tol = c.stickerHeightTolMm || 6;
      f.placement = ['P1', 'P3'].map(k => ({ key: k, mm: f[k + 'Mm'], ok: Math.abs(f[k + 'Mm'] - std) <= tol }));
      f.placementNotes = f.placement.filter(x => !x.ok).map(x => `${x.key === 'P1' ? 'P1(첫째발허리뼈머리)' : 'P3(발꿈치뼈)'} 스티커 높이 ${x.mm.toFixed(0)} mm — 표준 ${std} mm(바닥에서 2 cm)와 차이가 큽니다.`);
    }
    out.floor = f;
  }
  function archAngle(P1, P2, P3) {
    const a = { x: P3.x - P2.x, y: P3.y - P2.y }, b = { x: P1.x - P2.x, y: P1.y - P2.y };
    const c = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  }
  /** 체중부하 전·후 비교 */
  function comparePrePost(pre, post, conv, calibration) {
    const c = Object.assign({}, DEFAULT_CONVERSION, conv || {});
    const r = { status: '측정 불가', changeMm: null, changePx: null, notes: [], flags: [] };
    if (!pre || !post) { r.notes.push('체중부하 전·후 측정값이 모두 필요합니다.'); return r; }
    if (pre.heightPx == null || post.heightPx == null) { r.status = '재촬영 필요'; r.notes.push('전·후 중 측정되지 않은 사진이 있습니다.'); return r; }
    r.changePx = Math.abs(pre.heightPx - post.heightPx);
    if (pre.archAngleDeg != null && post.archAngleDeg != null) r.archAngle = { pre: pre.archAngleDeg, post: post.archAngleDeg, change: post.archAngleDeg - pre.archAngleDeg };
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
    // (사진별 지름 추정 잡음이 발활 높이 전체에 곱해져 변화량을 왜곡하는 것을 줄임)
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
    r.lineChangeMm = r.changeMm; r.primary = 'line';
    // 바닥 기준(표준 NDT 방식): 전·후 모두 바닥선이 확인된 경우
    if (pre.floor && pre.floor.ok && post.floor && post.floor.ok) {
      r.floor = { preMm: pre.floor.P2Px * common, postMm: post.floor.P2Px * common };
      r.floor.dropMm = r.floor.preMm - r.floor.postMm;
      r.floor.lineHeightChangeMm = ((pre.floor.P1Px + pre.floor.P3Px) - (post.floor.P1Px + post.floor.P3Px)) / 2 * common; // 스티커 기준선 자체의 내려앉음
      if (c.primaryMeasure === 'floor') { r.changeMm = Math.abs(r.floor.dropMm); r.primary = 'floor'; }
    } else if (c.primaryMeasure === 'floor') r.notes.push('바닥선이 확인되지 않아 P1–P3 기준선 방식으로 분류했습니다.');
    r.scaleDiff = sd;
    // 발 길이로 정규화한 지표(문헌: 정규화 발배뼈 높이 NNHt = 발배뼈 높이 ÷ 잘린 발 길이, Murley 등 2009)
    // 이 앱은 P1(첫째발허리뼈머리)–P3(발꿈치뼈) 스티커 거리로 발 길이를 근사한다 → 참고용
    if (pre.spanPx > 0 && post.spanPx > 0) {
      r.span = { preMm: pre.spanPx * common, postMm: post.spanPx * common };
      r.span.gainMm = r.span.postMm - r.span.preMm; // 체중부하 시 발이 길어진 정도(발활 늘어남)
      r.norm = normalizedIndices(r);
    }
    if (r.changeMm >= c.maxPlausibleChangeMm) { r.status = '측정 불가'; r.notes.push(`변화량(${r.changeMm.toFixed(1)}mm)이 비정상적으로 큽니다. 스티커 위치·자세를 확인하고 다시 검사해 주세요.`); r.changeMm = null; return r; }
    if (postMm - preMm > c.riseReviewMm) r.flags.push('체중부하 후 발활 높이가 오히려 높게 측정되었습니다. 자세·스티커 위치 검토가 필요합니다.');
    r.status = '측정 가능';
    return r;
  }

  // ───── 촬영 거리 안내(측정은 거리와 무관 — 스티커로 환산. 정밀도만 거리에 따라 달라짐) ─────
  // 추정 거리: 1픽셀 mm × 촬영 가로 픽셀 = 화면에 담긴 가로 폭. 일반 휴대폰 기본(1×) 카메라 가로 화각 약 69°(폭 ≈ 1.375 × 거리) 가정 → 참고값
  // 판정: 18 cm 미만 너무 가까움 · 45 cm 초과 멂(권장 25~35 cm). 1픽셀이 0.33 mm보다 크면 거리와 상관없이 '해상도 낮음' 표시
  // 거리 고정(v3.2, 연구자 결정): 기본 25 cm ± 2.5 cm. 25 cm와 30 cm에서 하강이 약 1 mm 달라 거리를 통일한다.
  // 기기마다 화각이 달라 추정이 어긋나면, 자로 25 cm를 맞춘 상태에서 '거리 보정'을 눌러 이 휴대폰의 계수(fovK)를 저장한다.
  // fovK 기본값 0.92(v3.4): 사용자 실측(2026-11-05) — 앱이 '25 cm'라고 한 자리가 실제로는 약 37.5 cm였음(아이폰 웹 카메라 영상은 화각이 좁음, 약 49°)
  const DIST = { nearCm: 18, farCm: 45, okCm: [20, 40], fovK: 0.92, coarseMmPx: 0.33, idealCm: [25, 35], targetCm: 25, tolCm: 2.5 };
  function distanceAdvice(mmPerPx, capSidePx, opt) {
    if (!(mmPerPx > 0)) return null;
    opt = opt || {};
    const side = capSidePx > 0 ? capSidePx : 1920, k = opt.fovK > 0 ? opt.fovK : DIST.fovK, estCm = mmPerPx * side / k / 10;
    const T = opt.targetCm, tol = opt.tolCm > 0 ? opt.tolCm : DIST.tolCm;
    let code, label, msg;
    if (T > 0) {
      code = estCm > T + tol ? 'FAR' : estCm < T - tol ? 'NEAR' : 'OK'; label = code === 'FAR' ? '멂' : code === 'NEAR' ? '가까움' : '적당';
      msg = code === 'FAR' ? `휴대폰을 발에 조금 더 가까이 두십시오. ${T}센티미터에 맞춰 주십시오` : code === 'NEAR' ? `휴대폰을 발에서 조금 멀리 두십시오. ${T}센티미터에 맞춰 주십시오` : `거리가 ${T}센티미터에 맞았습니다`;
    } else {
      code = estCm > DIST.farCm ? 'FAR' : estCm < DIST.nearCm ? 'NEAR' : 'OK';
      label = code === 'FAR' ? '멂' : code === 'NEAR' ? '가까움' : estCm > DIST.okCm[1] ? '조금 멂' : estCm < DIST.okCm[0] ? '조금 가까움' : '적당';
      msg = code === 'FAR' ? '휴대폰을 발에 조금 더 가까이 두십시오. 약 30센티미터가 좋습니다' : code === 'NEAR' ? '휴대폰을 발에서 조금 멀리 두십시오. 약 30센티미터가 좋습니다' : '거리가 적당합니다';
    }
    return { code, msg, label, mmPerPx, estCm, side, targetCm: T > 0 ? T : null, coarse: mmPerPx > DIST.coarseMmPx };
  }
  // 거리 보정: 지금 실제 거리가 trueCm일 때의 화각 계수
  function calibrateFovK(mmPerPx, capSidePx, trueCm) { return mmPerPx > 0 && trueCm > 0 ? mmPerPx * (capSidePx > 0 ? capSidePx : 1920) / (trueCm * 10) : null; }

  // 정규화 지표: 발 길이 대비 하강률(%), 정규화 발배뼈 높이(앉음·섬). 문헌 NNHt 참고 범위 0.22–0.31(평발 < 0.22)
  const NNH_REF = { low: 0.22, high: 0.31, source: 'Murley 등 2009 (J Foot Ankle Res) · 잘린 발 길이 기준' };
  function normalizedIndices(r) {
    if (!r.span || !(r.span.preMm > 0)) return null;
    const o = { dropPct: r.changeMm != null ? r.changeMm / r.span.preMm * 100 : null, footMm: r.span.preMm, gainPct: r.span.gainMm / r.span.preMm * 100 };
    if (r.floor) { o.nnhPre = r.floor.preMm / r.span.preMm; o.nnhPost = r.floor.postMm / r.span.postMm; o.nnhLow = o.nnhPost < NNH_REF.low; }
    return o;
  }

  // ═══════════════ 신뢰도·일치도 통계(논문용): ICC(2,1)·Bland–Altman·SEM·MDC95 ═══════════════
  // pairs: [{a, b}] — 같은 대상의 두 측정(검사-재검사, 또는 앱 vs 기준)
  // ICC(2,1): 이원 무선효과·절대 일치·단일 측정(Shrout & Fleiss 1979; Koo & Li 2016 해석: <0.5 낮음, 0.5–0.75 보통, 0.75–0.9 좋음, >0.9 매우 좋음)
  function reliabilityStats(pairs) {
    const ok = (pairs || []).filter(p => isFinite(p.a) && isFinite(p.b)), n = ok.length;
    if (n < 2) return { n };
    const k = 2, all = ok.flatMap(p => [p.a, p.b]), gm = mean(all);
    const rowM = ok.map(p => (p.a + p.b) / 2), colA = mean(ok.map(p => p.a)), colB = mean(ok.map(p => p.b));
    const ssR = k * rowM.reduce((s, m) => s + (m - gm) ** 2, 0), ssC = n * ((colA - gm) ** 2 + (colB - gm) ** 2);
    const ssT = all.reduce((s, x) => s + (x - gm) ** 2, 0), ssE = ssT - ssR - ssC;
    const msR = ssR / (n - 1), msC = ssC / (k - 1), msE = ssE / ((n - 1) * (k - 1));
    const den = msR + (k - 1) * msE + k * (msC - msE) / n;
    const icc = den > 0 ? (msR - msE) / den : null;
    const d = ok.map(p => p.b - p.a), bias = mean(d), sdD = Math.sqrt(d.reduce((s, x) => s + (x - bias) ** 2, 0) / (n - 1));
    const sa = Math.sqrt(ok.reduce((s, p) => s + (p.a - colA) ** 2, 0)), sb = Math.sqrt(ok.reduce((s, p) => s + (p.b - colB) ** 2, 0));
    const rr = sa > 0 && sb > 0 ? ok.reduce((s, p) => s + (p.a - colA) * (p.b - colB), 0) / (sa * sb) : null;
    const sem = sdD / Math.SQRT2, mdc95 = 1.96 * Math.SQRT2 * sem;
    const level = icc == null ? '—' : icc > 0.9 ? '매우 좋음' : icc >= 0.75 ? '좋음' : icc >= 0.5 ? '보통' : '낮음';
    return { n, meanA: colA, meanB: colB, icc, level, bias, sdDiff: sdD, loaLow: bias - 1.96 * sdD, loaHigh: bias + 1.96 * sdD, sem, mdc95, r: rr, mae: mean(d.map(Math.abs)) };
  }
  // 검사-재검사 짝: 같은 사람·같은 발에서 maxGapH 시간 안에 잇달아 잰 유효 검사
  function retestPairs(exams, maxGapH) {
    const gap = (maxGapH == null ? 24 : maxGapH) * 3600e3, by = {};
    for (const e of exams) { const v = e && e.comparison && e.comparison.changeMm; if (!isFinite(v) || e.isTest) continue; const k = (e.participantId || e.userId || '') + '|' + e.foot; (by[k] = by[k] || []).push(e); }
    const out = [];
    for (const list of Object.values(by)) { list.sort((x, y) => x.createdAt - y.createdAt); for (let i = 1; i < list.length; i++) if (list[i].createdAt - list[i - 1].createdAt <= gap) { out.push({ a: list[i - 1].comparison.changeMm, b: list[i].comparison.changeMm, key: list[i].id }); i++; } }
    return out;
  }

  // ───────────────────────── 연구 기준 분류 ─────────────────────────
  const CATEGORIES = [
    { key: 'normal', label: '정상 범위', range: '0 mm 이상 2 mm 이하' },
    { key: 'mild', label: '경증 평발 의심', range: '2 mm 초과 4 mm 미만' },
    { key: 'moderate', label: '중등도 평발 의심', range: '4 mm 이상 6 mm 미만' },
    { key: 'severe', label: '중증 평발 의심', range: '6 mm 이상' }
  ];
  // 분류 경계(mm, 내부 계산 단위). 연구자 지정 기준: 정상 ≤2 · 경증 2~4 · 중등도 4~6 · 중증 ≥6 mm
  const CLASS_MM = { normal: 2, mild: 4, moderate: 6 };
  /** 표시값(소수 첫째 자리 반올림)과 분류를 일치시키기 위해 반올림 후 분류한다. */
  function roundMm(mm) { return Math.round((mm + (mm >= 0 ? 1e-9 : -1e-9)) * 10) / 10; }
  function classify(mm) {
    if (typeof mm !== 'number' || !isFinite(mm) || mm < 0) return null;
    const v = roundMm(mm);
    let key;
    if (v <= CLASS_MM.normal) key = 'normal';
    else if (v < CLASS_MM.mild) key = 'mild';
    else if (v < CLASS_MM.moderate) key = 'moderate';
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


  // ═══════════════ 운동(중재) 콘텐츠 ═══════════════
  // 기본 운동 초안(이름·일반 설명) — 사용자 앱 첫 실행과 관리자 앱 '기본 운동 불러오기'에서 같이 쓴다
  const EXERCISE_DRAFTS = [
    { name: '짧은 발 운동(Short Foot Exercise)', purpose: '발바닥 내재근을 활성화하여 안쪽세로발활 지지를 돕는 운동', posture: '의자에 앉아 발바닥 전체를 바닥에 붙이고 발가락은 편안하게 둔다.', steps: ['발가락을 구부리지 않은 채 엄지발가락 뿌리(첫째발허리뼈머리)를 발꿈치 쪽으로 끌어당기듯 힘을 준다.', '발활이 살짝 높아지는 것을 확인하고 그 상태를 유지한다.', '천천히 힘을 풀고 처음 자세로 돌아온다.'], cautions: ['발가락을 말아 쥐지 않는다.', '통증이 생기면 즉시 중단한다.'] },
    { name: '수건 당기기(Towel Curl)', purpose: '발가락 굽힘근 사용을 연습하는 운동', posture: '의자에 앉아 발 아래 수건을 펼쳐 둔다.', steps: ['발꿈치를 바닥에 고정한다.', '발가락으로 수건을 움켜쥐어 몸쪽으로 끌어당긴다.', '수건을 다시 펴고 반복한다.'], cautions: ['미끄러운 바닥에서는 시행하지 않는다.', '발가락 경련이 생기면 쉬었다가 진행한다.'] },
    { name: '발꿈치 들기(Heel Raise)', purpose: '종아리 근육과 발목 주변 근육을 강화하는 운동', posture: '벽이나 의자를 잡고 양발을 골반 너비로 벌려 선다.', steps: ['체중을 엄지발가락 쪽에 고르게 싣고 발꿈치를 천천히 들어 올린다.', '꼭대기에서 잠시 멈춘다.', '천천히 발꿈치를 내린다.'], cautions: ['균형이 불안하면 반드시 지지물을 잡는다.', '발목이 바깥으로 꺾이지 않게 한다.'] }
  ];
  const EXERCISE_CATEGORIES = [['normal', '정상 범위'], ['mild', '경증'], ['moderate', '중등도'], ['severe', '중증']];
  // 유튜브 주소 → 영상 ID(youtu.be / watch?v= / shorts / embed). 아니면 null
  function youtubeId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }

  // ═══════════════ AI 오차 보정 모델: 앱 NDT → 임상 NDT(자로 잰 실제 값) 추정 ═══════════════
  /**
   * 학습 자료: 같은 사람·같은 발을 앱과 임상 NDT(전문가가 자로 측정)로 함께 잰 짝.
   * 특징: 앱이 이미 재는 값만 쓴다(새로 지어내는 값 없음). 없는 값은 학습 평균으로 채운다.
   */
  const AI_FEATURES = [
    { key: 'ai', label: '앱 NDT(기준선 하강, mm)' },
    { key: 'floorDrop', label: '바닥 기준 하강(mm)' },
    { key: 'preFloor', label: '앉은 자세 발배뼈 높이(mm)' },
    { key: 'angleChange', label: '스티커 발활 각도 변화(°)' },
    { key: 'spanGain', label: '체중부하 시 발 길이 변화(%)' },
    { key: 'diaPx', label: '스티커 크기(px · 촬영 거리)' },
    { key: 'tilt', label: '발 축 기울기(°)' },
    { key: 'sizeCv', label: '스티커 크기 편차(% · 원근)' },
    { key: 'placeErr', label: 'P1·P3 부착 높이 오차(mm)' }
  ];
  const fin = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  /** 검사 기록 1건 → 특징 값(없으면 null). ai(앱 NDT)가 없으면 null을 돌려준다. */
  function errorFeatures(e) {
    if (!e || !e.comparison || fin(e.comparison.changeMm) == null) return null;
    const c = e.comparison, fl = c.floor || {}, pm = (e.pre && e.pre.measure) || {}, pq = (e.pre && e.pre.quality) || {};
    const lr = e.loadRecognition && e.loadRecognition.final;
    const pl = pm.floor && pm.floor.placement;
    return {
      ai: c.changeMm,
      floorDrop: fin(fl.dropMm), preFloor: fin(fl.preMm),
      angleChange: fin(c.archAngle && c.archAngle.change),
      spanGain: lr && isFinite(lr.spanGain) ? lr.spanGain * 100 : null,
      diaPx: fin(pq.diameterPx), tilt: isFinite(pm.axisAngleDeg) ? Math.abs(pm.axisAngleDeg) : null,
      sizeCv: isFinite(pq.sizeCv) ? pq.sizeCv * 100 : null,
      placeErr: pl && pl.length ? mean(pl.map(x => Math.abs(x.mm - 20))) : null
    };
  }
  // ───────────────────────── AI 1:1 맞춤 케어(개인 학습) ─────────────────────────
  /**
   * 한 사람의 검사 기록만으로 '그 사람에게 맞춘' 오차 보정·추적·관리 계획을 만든다.
   *  ① 측정 품질 가중치: 스티커 검출·선명도·전후 축척 차이·체중부하 인지·각도로 이번 측정을 얼마나 믿을지 정한다
   *  ② 개인 반복 오차(σ): 같은 발을 가까운 날 다시 잰 값의 차이로 이 사람·이 환경의 측정 흔들림을 학습(사전값과 베이즈 혼합)
   *  ③ 개인 보정(편향): 병원·전문가가 잰 NDT 값을 입력하면 앱 값과의 차이를 학습해 수축 추정(적을수록 조심스럽게)
   *  ④ 시간 추적(칼만 평활): 측정마다 흔들려도 '지금 실제 상태'를 오차 범위와 함께 추정
   *  ⑤ 이상 측정 감지: 평소 상태와 통계적으로 너무 다르면 원인을 짚고 다시 찍기를 권함
   *  ⑥ 최소 의미 변화(MDC95)로 '진짜 변화'와 '측정 흔들림'을 구분, 추세(Theil–Sen)·좌우 차이
   *  ⑦ 위 결과와 자가 확인·운동 기록으로 개인 관리 계획(운동·횟수·다음 검사일)을 만든다
   * exams: 같은 사람의 검사 기록 전체, logs: 운동 기록. 반환: { feet: {left, right}, plan, ... }
   */
  const CARE = { priorSd: 1.4, priorN: 4, refSd: 1.0, refTau: 2.5, qDay: 0.04, outlierZ: 2.6, pairDays: 3 };
  function measurementWeight(e) {
    const c = e.comparison || {}, conf = isFinite(e.measurementConfidence) ? e.measurementConfidence : 0.6;
    let w = 0.35 + 0.65 * clamp01((conf - 0.4) / 0.5);
    const sharp = e.pre && e.post && e.pre.quality && e.post.quality ? (e.pre.quality.sharp && e.post.quality.sharp) : true;
    if (!sharp) w *= 0.6;
    if (isFinite(c.scaleDiff)) w *= 1 - 0.5 * clamp01(c.scaleDiff / 0.05);
    const lr = e.loadRecognition; if (lr && lr.confirmed === false) w *= 0.8;
    const tilt = e.pre && e.pre.measure && Math.abs(e.pre.measure.axisAngleDeg || 0); if (tilt > 12) w *= 0.8;
    return clamp01(Math.max(0.1, w));
  }
  function measurementIssues(e) {
    const c = e.comparison || {}, out = [];
    if (e.measurementConfidence < 0.6) out.push('스티커 검출 신뢰도가 낮았습니다');
    if (e.pre && e.post && e.pre.quality && e.post.quality && !(e.pre.quality.sharp && e.post.quality.sharp)) out.push('사진이 흐렸습니다(조명을 밝게)');
    if (isFinite(c.scaleDiff) && c.scaleDiff > 0.025) out.push('앉은 자세와 선 자세 사이에 휴대폰이 조금 움직였습니다');
    if (e.loadRecognition && e.loadRecognition.confirmed === false) out.push('선 자세에서 체중이 충분히 실리지 않았을 수 있습니다');
    const tilt = e.pre && e.pre.measure && Math.abs(e.pre.measure.axisAngleDeg || 0); if (tilt > 12) out.push('휴대폰이 기울어져 있었습니다');
    return out;
  }
  function theilSen(pts) {
    const sl = []; for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j].t !== pts[i].t) sl.push((pts[j].y - pts[i].y) / (pts[j].t - pts[i].t));
    return sl.length ? median(sl) : 0;
  }
  function personalCare(exams, opts) {
    opts = opts || {}; const DAY = 86400000, logs = opts.logs || [], now = opts.now || Date.now();
    const valid = (exams || []).filter(e => !e.isTest && e.comparison && isFinite(e.comparison.changeMm)).sort((a, b) => a.createdAt - b.createdAt);
    // 앱 측정값(전역 AI 보정이 있으면 그 값) — 개인 학습의 출발점
    const base = e => (e.aiCorrection && isFinite(e.aiCorrection.mm) ? Math.max(0, e.aiCorrection.mm) : e.comparison.changeMm);
    // ③ 개인 보정: 전문가 측정값이 있는 검사들의 잔차를 수축 평균(두 발 공통 — 같은 사람·같은 부착 습관)
    const refs = valid.filter(e => e.reference && isFinite(e.reference.ndtMm));
    const kShr = (CARE.refSd * CARE.refSd) / (CARE.refTau * CARE.refTau);
    // ③-1 앉은 자세·선 자세 높이를 따로 배운다(실측 전·후 높이를 넣었을 때): 체중이 실리면 스티커 기준선도 함께
    //      내려앉는 등 '선 자세에서만' 생기는 오차가 있어서, 하강량 하나로 배우는 것보다 정확하다. 측정 방식(바닥선/기준선)별로 따로.
    const last0 = valid[valid.length - 1], protocolCm = opts.protocolCm !== undefined ? opts.protocolCm : (last0 && last0.distance && last0.distance.targetCm) || null;
    const cal = personalHeightCalib(refs, kShr, protocolCm);
    // 보정이 있는 방식 중 학습 자료가 많은 쪽(같으면 바닥선) — 바닥선 검출 여부로 보정이 켜졌다 꺼지지 않게
    const corrected = e => { const hs = appHeightsAll(e).filter(h => cal[h.method] && cal[h.method].n).sort((a, b) => cal[b.method].wSum - cal[a.method].wSum || (a.method === 'floor' ? -1 : 1)); const h = hs[0]; if (!h) return null; const c2 = cal[h.method]; return Math.max(0, (h.pre + c2.bPre) - (h.post + c2.bPost)); };
    // ③-2 하강량만 넣은 기록(또는 높이 보정이 없는 측정 방식)은 하강량 잔차로 배운다
    const resRefs = refs.filter(e => !(isFinite(e.reference.preMm) && isFinite(e.reference.postMm) && appHeights(e))), RW = refWeights(resRefs, protocolCm);
    const res = resRefs.map(e => e.reference.ndtMm - base(e)), rw = resRefs.map(e => RW.get(e)), rwSum = rw.reduce((x, y) => x + y, 0);
    const bias = res.length ? res.reduce((x, y, i) => x + y * rw[i], 0) / (rwSum + Math.max(kShr, shrinkK(res, rw))) : 0;
    const nCal = Object.values(cal).reduce((n, c2) => n + c2.n, 0);
    const biasSe = res.length || nCal ? Math.sqrt(CARE.refSd * CARE.refSd / (res.length + nCal + kShr)) : null;
    const personal = e => { const c2 = corrected(e); return c2 != null ? c2 : base(e) + bias; };
    // ② 개인 반복 오차: 같은 발, pairDays 안의 연속 측정 차이(품질 가중)
    const diffs = [];
    for (const f of ['left', 'right']) { const a = valid.filter(e => e.foot === f); for (let i = 1; i < a.length; i++) if (a[i].createdAt - a[i - 1].createdAt <= CARE.pairDays * DAY) diffs.push(base(a[i]) - base(a[i - 1])); }
    // 이상치에 강하게: 차이의 중앙 절대값(MAD)으로 σ 추정(한 번 크게 틀린 측정이 '흔들림'을 부풀리지 않게)
    const nPair = diffs.length, sdObs = nPair ? Math.max(0.15, 1.4826 * median(diffs.map(Math.abs)) / Math.SQRT2) : null;
    const sd = Math.sqrt(((sdObs != null ? nPair * sdObs * sdObs : 0) + CARE.priorN * CARE.priorSd * CARE.priorSd) / (nPair + CARE.priorN));
    const mdc = 1.96 * Math.SQRT2 * sd;
    const feet = {};
    for (const f of ['left', 'right']) {
      const a = valid.filter(e => e.foot === f); if (!a.length) { feet[f] = null; continue; }
      // ④ 칼만 평활(국소 수준 모형): 상태 = 실제 하강량, 측정 분산 = σ²/가중치
      let x = null, P = null, tPrev = null; const series = [];
      for (const e of a) {
        // 전문가 값이 있는 검사는 그 값을 정밀 측정으로 쓴다(그날의 '정답')
        const hasRef = e.reference && isFinite(e.reference.ndtMm), y = hasRef ? e.reference.ndtMm : personal(e), w = hasRef ? 1 : measurementWeight(e), R = hasRef ? CARE.refSd * CARE.refSd : sd * sd / w;
        if (x == null) { x = y; P = R + (biasSe ? biasSe * biasSe : 0); }
        else {
          const dt = Math.max(0, (e.createdAt - tPrev) / DAY), Pp = P + CARE.qDay * dt * dt + 0.02;
          const z = (y - x) / Math.sqrt(Pp + R), out = !hasRef && Math.abs(z) > CARE.outlierZ && series.length >= 2;
          // ⑤ 이상 측정: 칼만 갱신 가중을 크게 낮춤(완전히 버리지는 않음)
          const Re = out ? R * 9 : R, K = Pp / (Pp + Re);
          x = x + K * (y - x); P = (1 - K) * Pp;
          series.push({ id: e.id, t: e.createdAt, raw: base(e), y, w: out ? w / 9 : w, z, outlier: out, ref: !!hasRef, est: x, sdEst: Math.sqrt(P) });
          tPrev = e.createdAt; continue;
        }
        series.push({ id: e.id, t: e.createdAt, raw: base(e), y, w, z: 0, outlier: false, ref: !!hasRef, est: x, sdEst: Math.sqrt(P) }); tPrev = e.createdAt;
      }
      const last = series[series.length - 1], first = series[0];
      const ok = series.filter(s => !s.outlier), span = (last.t - first.t) / DAY;
      const slope30 = ok.length >= 3 && span >= 14 ? theilSen(ok.map(s => ({ t: s.t / DAY, y: s.y }))) * 30 : null;
      const ci = 1.96 * Math.sqrt(last.sdEst * last.sdEst + (biasSe ? biasSe * biasSe : 0));
      const prev = series.length >= 2 ? series[series.length - 2] : null;
      const change = prev ? last.est - prev.est : null;
      feet[f] = { n: a.length, correctedLastMm: Math.max(0, personal(a[a.length - 1])), estimateMm: Math.max(0, last.est), ciMm: ci, lastRawMm: last.raw, lastPersonalMm: Math.max(0, last.y), lastWeight: last.w, lastOutlier: last.outlier, lastZ: last.z,
        changeSincePrevMm: change, realChange: change != null && Math.abs(change) >= mdc * 0.7, slopePer30: slope30,
        baselineMm: first.est, sinceBaselineMm: last.est - first.est, series, category: classify(Math.max(0, last.est)),
        lastIssues: measurementIssues(a[a.length - 1]), lastExamId: a[a.length - 1].id };
    }
    const both = feet.left && feet.right, asym = both ? Math.abs(feet.left.estimateMm - feet.right.estimateMm) : null;
    const plan = carePlan(feet, { asym, mdc, sd, logs, now, selfReport: opts.selfReport || {}, refs: refs.length });
    const biasAll = refs.length ? mean(refs.map(e => personal(e) - base(e))) : 0;
    return { feet, sdMm: sd, sdObsMm: sdObs, nPairs: nPair, mdcMm: mdc, biasMm: biasAll, biasSeMm: biasSe, nRefs: refs.length, heightCalib: cal, personalMm: e => Math.max(0, personal(e)), asymMm: asym, asymReal: asym != null && asym >= mdc, learnedFrom: valid.length, plan };
  }
  // 앱이 잰 전·후 높이(바닥선이 있으면 바닥 기준 = 표준 NDT, 없으면 P1–P3 기준선 기준)
  function appHeights(e) {
    const c = e && e.comparison; if (!c) return null;
    if (c.floor && isFinite(c.floor.preMm) && isFinite(c.floor.postMm)) return { method: 'floor', pre: c.floor.preMm, post: c.floor.postMm };
    if (isFinite(c.preMm) && isFinite(c.postMm)) return { method: 'line', pre: c.preMm, post: c.postMm };
    return null;
  }
  // 한 검사에서 쓸 수 있는 측정 방식 전부(바닥선·기준선). v3.5.1: 보정은 방식별로 배우므로, 바닥선이 잡혔다 안 잡혔다 해도
  // 같은 방식으로 보정되도록 실측 기록은 가능한 모든 방식에 넣고, 새 검사는 보정이 있는 방식을 고른다(재현성).
  function appHeightsAll(e) {
    const c = e && e.comparison, out = []; if (!c) return out;
    if (c.floor && isFinite(c.floor.preMm) && isFinite(c.floor.postMm)) out.push({ method: 'floor', pre: c.floor.preMm, post: c.floor.postMm });
    if (isFinite(c.preMm) && isFinite(c.postMm)) out.push({ method: 'line', pre: c.preMm, post: c.postMm });
    return out;
  }
  // 실측 전·후 높이와 앱 높이의 차이를 측정 방식별로 수축 평균(적을수록 조심스럽게)
  // 실측 기록 가중치(v3.3, 2026-11 사용자 사례: 예전 실측 오차 +4~5 mm로 배운 보정이 새 측정(실제 오차 +0.7 mm)을 9.0 mm로 과보정):
  // ① 최근 실측일수록 크게(한 번 오래될 때마다 ×0.6) ② 촬영 조건(거리 고정)이 지금과 같은 실측만 온전히, 다르면(예전·거리 미기록) ×0.5
  function refWeights(refs, protocolCm) {
    const order = refs.slice().sort((a, b) => (b.reference.at || b.createdAt) - (a.reference.at || a.createdAt)), w = new Map();
    order.forEach((e, i) => { const same = protocolCm == null ? true : !!(e.distance && e.distance.targetCm === protocolCm); w.set(e, Math.pow(0.6, i) * (same ? 1 : 0.5)); });
    return w;
  }
  // 수축 정도: 실측끼리 서로 어긋날수록(오차가 들쭉날쭉) 보정을 덜 믿는다 — k = max(기본 분산, 가중 분산)/τ²
  function shrinkK(vals, ws) {
    const W = ws.reduce((x, y) => x + y, 0); if (!(W > 0)) return (CARE.refSd * CARE.refSd) / (CARE.refTau * CARE.refTau);
    const m = vals.reduce((x, v, i) => x + v * ws[i], 0) / W, v2 = vals.reduce((x, v, i) => x + ws[i] * (v - m) ** 2, 0) / W;
    return Math.max(CARE.refSd * CARE.refSd, vals.length >= 2 ? v2 : 0) / (CARE.refTau * CARE.refTau);
  }
  // 실측 전·후 높이와 앱 높이의 차이를 측정 방식별로 가중 수축 평균(적을수록·어긋날수록 조심스럽게)
  function personalHeightCalib(refs, kShr, protocolCm) {
    const out = {}, W = refWeights(refs, protocolCm), groups = {};
    for (const e of refs) {
      const r = e.reference; if (!isFinite(r.preMm) || !isFinite(r.postMm)) continue;
      for (const h of appHeightsAll(e)) (groups[h.method] = groups[h.method] || []).push({ dPre: r.preMm - h.pre, dPost: r.postMm - h.post, w: W.get(e) });
    }
    for (const [k, g] of Object.entries(groups)) {
      const ws = g.map(x => x.w), sw = ws.reduce((x, y) => x + y, 0), kk = Math.max(kShr, shrinkK(g.map(x => x.dPre - x.dPost), ws));
      out[k] = { n: g.length, wSum: sw, k: kk, bPre: g.reduce((x, y) => x + y.w * y.dPre, 0) / (sw + kk), bPost: g.reduce((x, y) => x + y.w * y.dPost, 0) / (sw + kk) };
    }
    return out;
  }
  // ⑦ 개인 관리 계획(규칙 기반 · 연구 기준 분류 + 개인 추세·자가 확인·운동 기록)
  function carePlan(feet, o) {
    const DAY = 86400000, list = ['left', 'right'].filter(f => feet[f]);
    if (!list.length) return { level: 'start', headline: '첫 검사를 하면 AI가 나에게 맞춘 관리 계획을 만듭니다', actions: [], nextTestDays: null };
    const worst = list.reduce((a, b) => (feet[b].estimateMm > feet[a].estimateMm ? b : a));
    const W = feet[worst], est = W.estimateMm, cat = W.category && W.category.key;
    const recent = (o.logs || []).filter(l => l.completed && o.now - l.date < 7 * DAY), days = new Set(recent.map(l => new Date(l.date).toDateString())).size;
    const sr = o.selfReport || {}, actions = []; let level, headline, nextTestDays;
    const worsening = W.slopePer30 != null && W.slopePer30 > 0.5 * o.mdc, improving = W.slopePer30 != null && W.slopePer30 < -0.5 * o.mdc;
    if (sr.pain) { level = 'consult'; headline = '통증·붓기가 있어 전문가 상담을 먼저 권합니다'; nextTestDays = 14; actions.push({ kind: 'consult', text: '정형외과·재활의학과 등 전문가에게 발 상태를 확인받으세요. 통증이 있을 때는 운동 강도를 낮춥니다.' }); }
    else if (cat === 'normal') { level = 'keep'; headline = improving ? '좋아지고 있어요 · 지금 관리를 유지하세요' : '정상 범위 · 발활을 지키는 가벼운 관리'; nextTestDays = 28; }
    else if (cat === 'mild') { level = 'care'; headline = worsening ? '경증 · 최근 하강이 늘고 있어 관리를 강화합니다' : '경증 · 발바닥 근육을 깨우는 운동을 시작하세요'; nextTestDays = worsening ? 7 : 14; }
    else { level = 'intense'; headline = `${cat === 'severe' ? '중증' : '중등도'} 범위 · 꾸준한 운동과 전문가 확인을 권합니다`; nextTestDays = 7; actions.push({ kind: 'consult', text: '하강량이 큰 편입니다. 이 앱의 결과는 진단이 아니므로 전문가 확인을 함께 받으세요.' }); }
    const dose = { keep: '주 3회 · 1세트', care: '주 5회 · 2세트', intense: '매일 · 3세트', consult: '통증 없는 범위에서 주 3회' }[level];
    const ex = level === 'keep' ? ['짧은 발 운동(Short Foot Exercise)'] : level === 'care' ? ['짧은 발 운동(Short Foot Exercise)', '수건 당기기(Towel Curl)'] : ['짧은 발 운동(Short Foot Exercise)', '수건 당기기(Towel Curl)', '발꿈치 들기(Heel Raise)'];
    actions.push({ kind: 'exercise', text: `${ex.join(' · ')} — ${dose}`, exercises: ex });
    if (level !== 'keep') actions.push({ kind: 'adherence', text: days >= 3 ? `지난 7일 중 ${days}일 운동했어요. 좋은 흐름입니다.` : `지난 7일 운동 ${days}일 — 하루 10분부터 다시 시작해 보세요.` });
    if (o.asym != null && o.asym >= o.mdc) actions.push({ kind: 'asym', text: `좌우 차이 ${o.asym.toFixed(1)} mm — ${feet.left.estimateMm > feet.right.estimateMm ? '왼발' : '오른발'}에 운동을 한 세트 더 하세요.` });
    if (W.lastOutlier) actions.push({ kind: 'retake', text: `이번 측정은 평소 상태와 많이 달라 다시 찍기를 권합니다${W.lastIssues.length ? ' (' + W.lastIssues.join(', ') + ')' : ''}.` });
    if (!o.refs) actions.push({ kind: 'reference', text: '병원·전문가가 잰 발배뼈 하강 값이 있으면 입력해 주세요. AI가 내 측정 습관에 맞춰 오차를 보정합니다.' });
    if (sr.restFlat) actions.push({ kind: 'consult', text: '앉아서도 발활이 거의 보이지 않으면 경직성 평발일 수 있어 전문가 확인이 필요합니다.' });
    return { level, headline, actions, nextTestDays, nextTestAt: o.now + nextTestDays * DAY, focusFoot: worst, estimateMm: est };
  }

  // 작은 선형계 풀이(가우스 소거, 부분 피벗)
  function solveLinear(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  /** 릿지 회귀: 특징 표준화 후 (XᵀX + λI)β = Xᵀy. 결측·변화 없는 특징은 제외한다. */
  function fitRidge(rows, lambda, keys) {
    const ks = (keys || AI_FEATURES.map(f => f.key)).filter(k => {
      const vals = rows.map(r => r.f[k]).filter(v => v != null);
      if (vals.length < Math.max(3, rows.length * 0.5)) return false;
      const m = mean(vals); return Math.sqrt(mean(vals.map(v => (v - m) ** 2))) > 1e-9;
    });
    if (!ks.includes('ai')) return null;
    const mu = {}, sd = {};
    for (const k of ks) { const vals = rows.map(r => r.f[k]).filter(v => v != null); mu[k] = mean(vals); sd[k] = Math.sqrt(mean(vals.map(v => (v - mu[k]) ** 2))) || 1; }
    const X = rows.map(r => ks.map(k => r.f[k] == null ? 0 : (r.f[k] - mu[k]) / sd[k]));
    const ym = mean(rows.map(r => r.ref)), y = rows.map(r => r.ref - ym);
    const p = ks.length, A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? lambda : 0)));
    const b = Array.from({ length: p }, (_, i) => X.reduce((s, x, n) => s + x[i] * y[n], 0));
    const beta = solveLinear(A, b); if (!beta) return null;
    return { method: 'ridge', lambda, features: ks, mean: mu, std: sd, coef: Object.fromEntries(ks.map((k, i) => [k, beta[i]])), intercept: ym };
  }
  function fitErrorCandidate(method, rows, o) {
    if (method === 'identity') return { method };
    if (method === 'bias') return { method, bias: mean(rows.map(r => r.f.ai - r.ref)) };
    if (method === 'linear') { const m = fitMethod('linear', rows.map(r => ({ ai: r.f.ai, ref: r.ref }))); return m; }
    if (method === 'ridge') {
      // λ는 학습 자료 안에서만(참여자 단위 교차검증) 고른다 → 시험 자료로 새는 정보 없음
      const lams = (o && o.lambdas) || [0.3, 1, 3, 10, 30, 100];
      const ids = [...new Set(rows.map(r => r.participantId))];
      if (ids.length < 3) return fitRidge(rows, 10);
      let best = null;
      for (const lam of lams) {
        let err = 0, n = 0;
        for (const id of ids) {
          const tr = rows.filter(r => r.participantId !== id), te = rows.filter(r => r.participantId === id);
          const m = fitRidge(tr, lam); if (!m) continue;
          for (const r of te) { err += Math.abs(applyErrorModel(m, r.f) - r.ref); n++; }
        }
        if (n && (!best || err / n < best.mae)) best = { lam, mae: err / n };
      }
      return best ? fitRidge(rows, best.lam) : null;
    }
    return null;
  }
  /** 보정 모델 적용: 특징 → 임상 NDT 추정값(mm). */
  function applyErrorModel(m, f) {
    if (!m || !f || fin(f.ai) == null) return f ? f.ai : null;
    if (m.method === 'identity') return f.ai;
    if (m.method === 'bias') return f.ai - m.bias;
    if (m.method === 'linear') return m.slope * f.ai + m.intercept;
    if (m.method === 'ridge') { let y = m.intercept; for (const k of m.features) { const v = f[k]; if (v != null && isFinite(v)) y += m.coef[k] * (v - m.mean[k]) / m.std[k]; } return y; }
    return f.ai;
  }
  /**
   * AI 오차 보정 학습. rows: [{ participantId, f: errorFeatures(exam), ref: 임상 NDT(mm) }]
   * 평가: 참여자 한 명씩 빼고 학습해 그 사람을 예측(LOPO 교차검증) — 학습에 안 쓴 사람에 대한 오차로만 판단.
   * 배포 권고: 보정 없음 대비 평균 절대 오차(MAE)가 10% 이상 줄고 RMSE도 줄 때만.
   */
  // 참여자별 평균 절대 오차 차이(보정 없음 − 후보)를 참여자 단위로 재표집해 95% 구간을 구한다
  function bootstrapGain(ids, rows, pBase, pCand, seed) {
    const per = new Map(); rows.forEach((r, i) => { const d = Math.abs(pBase[i].ai - pBase[i].ref) - Math.abs(pCand[i].ai - pCand[i].ref); const a = per.get(r.participantId) || []; a.push(d); per.set(r.participantId, a); });
    const g = ids.map(id => mean(per.get(id))), rnd = mulberry32(seed), B = 2000, stats = [];
    for (let b = 0; b < B; b++) { let s = 0; for (let k = 0; k < g.length; k++) s += g[Math.floor(rnd() * g.length)]; stats.push(s / g.length); }
    stats.sort((a, b) => a - b);
    return { mean: mean(g), low: stats[Math.floor(B * 0.05)], high: stats[Math.floor(B * 0.975)] };
  }
  function trainErrorModel(rows, options) {
    const o = Object.assign({ minParticipants: 8, minRows: 16, minGain: 0.10, methods: ['identity', 'bias', 'linear', 'ridge'] }, options || {});
    const clean = rows.filter(r => r.participantId && r.f && fin(r.f.ai) != null && fin(r.ref) != null);
    const ids = [...new Set(clean.map(r => r.participantId))];
    if (clean.length < o.minRows || ids.length < o.minParticipants)
      return { ok: false, reason: `학습 자료가 부족합니다: 짝 자료 ${clean.length}건(최소 ${o.minRows}), 참여자 ${ids.length}명(최소 ${o.minParticipants}). 같은 사람을 앱과 임상 NDT로 함께 잰 자료를 더 모아 주세요.`, n: clean.length, participants: ids.length };
    const preds = Object.fromEntries(o.methods.map(m => [m, []]));
    for (const id of ids) {
      const tr = clean.filter(r => r.participantId !== id), te = clean.filter(r => r.participantId === id);
      for (const meth of o.methods) {
        const m = fitErrorCandidate(meth, tr, o);
        for (const r of te) preds[meth].push({ ai: m ? applyErrorModel(m, r.f) : r.f.ai, ref: r.ref });
      }
    }
    const cv = Object.fromEntries(o.methods.map(m => [m, errorMetrics(preds[m])]));
    const order = o.methods.slice().sort((a, b) => cv[a].mae - cv[b].mae);
    const chosen = order[0], base = cv.identity;
    // 우연한 개선 걸러내기: 참여자 단위 부트스트랩(2,000회)으로 '보정 없음 대비 오차 감소'가 95% 이상 유지되는지 확인
    const gainCi = chosen === 'identity' ? null : bootstrapGain(ids, clean, preds.identity, preds[chosen], o.seed || 42);
    const improved = chosen !== 'identity' && cv[chosen].mae <= base.mae * (1 - o.minGain) && cv[chosen].rmse < base.rmse && gainCi && gainCi.low > 0;
    const model = fitErrorCandidate(improved ? chosen : 'identity', clean, o);
    const resid = preds[improved ? chosen : 'identity'].map(p => p.ai - p.ref), rsd = Math.sqrt(mean(resid.map(e => e * e)));
    const weights = model && model.method === 'ridge' ? model.features.map(k => ({ key: k, label: (AI_FEATURES.find(f => f.key === k) || {}).label || k, coef: model.coef[k] })).sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef)) : [];
    return {
      ok: true, improved, chosen: improved ? chosen : 'identity', bestCandidate: chosen, cv, weights, gainCi,
      model: Object.assign({}, model, { kind: 'ndt-error', n: clean.length, participants: ids.length, piMm: 1.96 * rsd, cvMae: cv[improved ? chosen : 'identity'].mae, baseMae: base.mae, trainedAt: new Date().toISOString(), algorithm: ALGORITHM_VERSION }),
      recommendation: improved
        ? `교차검증에서 평균 오차가 ${base.mae.toFixed(2)} → ${cv[chosen].mae.toFixed(2)} mm로 ${((1 - cv[chosen].mae / base.mae) * 100).toFixed(0)}% 줄었습니다. 검토 후 배포할 수 있습니다.`
        : `교차검증에서 보정 없음(평균 오차 ${base.mae.toFixed(2)} mm)보다 확실하게(${(o.minGain * 100).toFixed(0)}% 이상, 참여자 재표집 95% 기준) 나아진 모델이 없습니다. 보정 없이 앱 값을 그대로 쓰는 것을 권합니다.`
    };
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
  const GUIDE = { x0: 0, y0: 0, x1: 1, y1: 1 };
  function framingCheck(det, guide) {
    if (!det.landmarks) return { ok: false, msg: '스티커를 찾는 중', code: 'NONE' };
    const g = guide || GUIDE;
    const [W, H] = det.imageSize; const { P1, P3 } = det.landmarks;
    const span = Math.abs(P1.x - P3.x) / W;
    const all = ['P1', 'P2', 'P3'].map(k => det.landmarks[k]);
    const m = det.quality.diameterPx * 0.7; // 스티커가 화면 안에 온전히 보이면 된다(거리 제한 없음)
    const gx0 = Math.max(m, g.x0 * W), gy0 = Math.max(m, g.y0 * H), gx1 = Math.min(W - m, g.x1 * W), gy1 = Math.min(H - m, g.y1 * H);
    if (all.some(p => p.x < gx0)) return { ok: false, msg: '발을 화면 오른쪽으로 조금 옮겨 주세요', code: 'LEFT_OUT' };
    if (all.some(p => p.x > gx1)) return { ok: false, msg: '발을 화면 왼쪽으로 조금 옮겨 주세요', code: 'RIGHT_OUT' };
    if (all.some(p => p.y < gy0 || p.y > gy1)) return { ok: false, msg: '발이 가이드 위아래 밖에 있습니다. 휴대폰 각도를 맞춰 주세요', code: 'VERT_OUT' };
    if (span < 0.12) return { ok: false, msg: '발이 너무 작게 보입니다. 휴대폰을 발에 더 가까이 두세요', code: 'FAR' };
    return { ok: true, msg: '촬영 범위 적절', code: 'OK' };
  }

  // ───────────────────────── 정밀 정렬 판정 ─────────────────────────
  // 발(세 스티커)이 목표 영역에 '정확히' 들어왔는지. 영상 비율 기준.
  const ALIGN = { cx: [0.38, 0.62], cy: [0.38, 0.82], span: [0.45, 0.85], maxAngleDeg: 10 };
  /**
   * 반환: { ok, code, msg, dx, dy } — msg는 사용자가 무엇을 하면 되는지(방향 포함).
   * toe: 발가락이 향하는 화면 방향. 발을 앞으로(발가락 쪽) 옮기면 화면에서 그 방향으로 움직인다.
   */
  function alignmentCheck(det, toe, align) {
    const A = align || ALIGN;
    if (!det || !det.landmarks) return { ok: false, code: 'NONE', msg: '발 안쪽의 스티커 세 개가 화면에 보이게 해 주십시오' };
    const [W, H] = det.imageSize, L = det.landmarks;
    const cx = (L.P1.x + L.P2.x + L.P3.x) / 3 / W, cy = (L.P1.y + L.P2.y + L.P3.y) / 3 / H;
    const span = Math.abs(L.P1.x - L.P3.x) / W, ang = Math.abs(L.axisAngleDeg || 0);
    const out = { cx, cy, span, ang, ok: false };
    if (span < A.span[0]) return Object.assign(out, { code: 'FAR', msg: '휴대폰을 발에 조금 더 가까이 두십시오' });
    if (span > A.span[1]) return Object.assign(out, { code: 'NEAR', msg: '휴대폰을 발에서 조금 더 멀리 두십시오' });
    if (cx < A.cx[0] || cx > A.cx[1]) {
      const needRight = cx < A.cx[0]; // 화면에서 오른쪽으로 옮겨야 함
      const forward = (toe === 'right') === needRight;
      return Object.assign(out, { code: needRight ? 'SHIFT_RIGHT' : 'SHIFT_LEFT', msg: forward ? '발을 조금 앞으로 옮겨 주십시오' : '발을 조금 뒤로 옮겨 주십시오' });
    }
    if (cy < A.cy[0]) return Object.assign(out, { code: 'TOO_HIGH', msg: '휴대폰 화면이 발보다 아래를 향하고 있습니다. 휴대폰을 똑바로 세워 주십시오' });
    if (cy > A.cy[1]) return Object.assign(out, { code: 'TOO_LOW', msg: '휴대폰 화면이 발보다 위를 향하고 있습니다. 휴대폰을 똑바로 세워 주십시오' });
    if (ang > A.maxAngleDeg) return Object.assign(out, { code: 'TILT', msg: '휴대폰이 기울어져 있습니다. 바닥과 수평이 되게 세워 주십시오' });
    return Object.assign(out, { ok: true, code: 'OK', msg: '발이 가이드에 정확히 들어왔습니다' });
  }

  // ═══════════════ 표준 발 가이드 모델 (안쪽 면, 발가락 오른쪽 기준, 단위 cm) ═══════════════
  /**
   * 스티커 부착 표준: Nielsen 등(2009, J Foot Ankle Res 2:12)의 3마커 방법
   *  - P3 발꿈치뼈 안쪽: 바닥에서 2 cm 위, 발꿈치 뒤끝에서 4 cm 앞
   *  - P1 첫째발허리뼈머리 안쪽: 바닥에서 2 cm 위
   *  - P2 발배뼈거친면(가장 튀어나온 곳)
   * 윤곽선 좌표는 화면 안내용 일반화 형상(성인 발 길이 약 25 cm 가정)이며 측정에는 쓰지 않는다.
   */
  const FOOT_MODEL = {
    lengthCm: 25.3, truncatedCm: 18.5,         // 발 길이, 발꿈치~첫째발허리발가락관절(대표값: 성인 평균 발 길이 25.3 cm 연구 참고)
    P3: { x: 4, y: 2 }, P1: { x: 18.5, y: 2 }, // 표준 부착 위치
    P2zone: { t: [0.18, 0.62], hCm: [1.8, 6.5] }, // 발배뼈거친면 탐색 범위: P3→P1 진행 비율 t, 바닥 위 높이(cm)
    malleolus: { x: 6.2, y: 7.2 },
    outline: [[0, 1.4], [0.25, 3.6], [1.0, 6.6], [2.2, 9.6], [2.8, 12.5], [8.6, 12.5], [9.6, 9.4], [12.5, 7.0], [16.0, 5.0], [19.5, 3.7], [22.5, 2.8], [24.6, 2.0], [25.3, 1.1], [25.0, 0.25], [22.5, 0], [18.0, 0], [15.6, 0.45], [12.5, 1.15], [9.5, 1.1], [7.2, 0.4], [5.8, 0], [2.0, 0], [0.5, 0.35]]
  };
  // 화면 배치: 표준 발을 이 비율로 놓았을 때 P3·P1이 목표 원의 중심. 모두 프레임 폭 W 단위(가로세로비와 무관).
  const GUIDE_LAYOUT = { p3x: 0.22, spanW: 0.52, floorY: 0.80, p3R: 0.065, p1R: 0.075 };
  /** 프레임 크기와 발가락 방향에 맞춘 가이드 기하(픽셀). */
  function guideGeometry(W, H, toe, layout) {
    const L = Object.assign({}, GUIDE_LAYOUT, layout || {}), M = FOOT_MODEL;
    const scale = (L.spanW * W) / (M.P1.x - M.P3.x);          // px / cm
    const floor = L.floorY * H, sgn = toe === 'left' ? -1 : 1;
    const ox = toe === 'left' ? W - L.p3x * W : L.p3x * W;     // P3 화면 x
    const X = cm => ox + sgn * (cm - M.P3.x) * scale, Y = cm => floor - cm * scale;
    return {
      scale, floorY: floor, toe,
      P3: { x: X(M.P3.x), y: Y(M.P3.y), r: L.p3R * W }, P1: { x: X(M.P1.x), y: Y(M.P1.y), r: L.p1R * W },
      outline: M.outline.map(([x, y]) => ({ x: X(x), y: Y(y) })), malleolus: { x: X(M.malleolus.x), y: Y(M.malleolus.y), r: 0.9 * scale },
      heelX: X(0), toeX: X(M.lengthCm), X, Y
    };
  }
  /**
   * 목표 원 정렬 판정: P3·P1이 각자의 원 안, P2가 발배뼈 범위 안(실제 P1·P3 기준).
   * 반환 { ok, code, msg, inP3, inP1, inP2 } — msg는 무엇을 하면 되는지(방향 포함).
   */
  // 표준 발 모델을 실제 P3·P1에 맞춰 놓는 닮음 변환(이동·확대·회전). 모델 (x cm, y cm) → 영상 좌표.
  function fitFootModel(L, toe) {
    const M = FOOT_MODEL, span = dist(L.P1, L.P3), s = span / (M.P1.x - M.P3.x);
    const u = { x: (L.P1.x - L.P3.x) / span, y: (L.P1.y - L.P3.y) / span };
    let nx = u.y, ny = -u.x; if (ny > 0) { nx = -nx; ny = -ny; } // 위쪽(바닥에서 멀어지는 방향)
    const X = (x, y) => ({ x: L.P3.x + u.x * (x - M.P3.x) * s + nx * (y - M.P3.y) * s, y: L.P3.y + u.y * (x - M.P3.x) * s + ny * (y - M.P3.y) * s });
    return { scale: s, u, X, outline: M.outline.map(([x, y]) => X(x, y)), heel: X(0.8, 1.2), toeTip: X(21.5, 1.6) /* 측정에 필요한 범위: 뒤꿈치 ~ 앞발 접지부(발가락 끝은 잘려도 됨) */, heelFloor: X(1.5, 0), toeFloor: X(22, 0), angleDeg: Math.atan2(u.y, Math.abs(u.x)) * 180 / Math.PI };
  }
  /**
   * 적응형 가이드(기본): 스티커가 보이면 표준 발 윤곽을 실제 발에 맞춰 놓고
   * ① 발 전체(뒤꿈치~발끝·발바닥)가 화면 안 ② 크기 적당(P1–P3가 화면 폭의 30~80%) ③ 발 축 수평(±10°) ④ P2가 발배뼈 범위
   * 를 확인한다. 휴대폰과 발의 거리가 사람마다 달라도 정확히 맞출 수 있게, 고정된 목표 원 대신 실제 발 기준으로 판정.
   * layout.mode === 'fixed' 이면 예전 방식(고정 목표 원)을 쓴다.
   */
  function guideCheck(det, toe, layout) {
    if (!det || !det.landmarks) return { ok: false, code: 'NONE', msg: '발 안쪽의 스티커 세 개가 화면에 보이게 해 주십시오' };
    if (!(layout && layout.mode === 'fixed')) return guideCheckAdaptive(det, toe);
    return guideCheckFixed(det, toe, layout);
  }
  const POS_TOL = 0.07; // 화면 폭의 7% (25 cm 거리에서 약 1.5 cm)
  function guideCheckAdaptive(det, toe) {
    const [W, H] = det.imageSize, L = det.landmarks, F = fitFootModel(L, toe), M = FOOT_MODEL;
    const span = dist(L.P1, L.P3);
    const t = projectionT(L.P2, L.P3, L.P1), hl = signedDistanceToLine(L.P2, L.P1, L.P3) / F.scale + M.P3.y;
    const Z = M.P2zone, inP2 = t >= Z.t[0] - 0.08 && t <= Z.t[1] + 0.08 && hl >= Z.hCm[0] - 0.6 && hl <= Z.hCm[1] + 0.8;
    const out = { inP3: true, inP1: true, inP2, t, p2HeightCm: hl, fit: F, adaptive: true, spanFrac: span / W };
    const fail = (code, msg) => Object.assign(out, { ok: false, code, msg });
    const frac = span / W;
    if (Math.abs(F.angleDeg) > 22) return fail('TILT', '휴대폰이 많이 기울어져 있습니다. 바닥과 수평이 되게 세워 주십시오');
    // 거리(크기)·발끝/뒤꿈치 잘림·바닥 잘림은 측정(세 스티커 기준선)에 필요 없으므로 촬영을 막지 않는다 → 참고 안내만
    const notes = [];
    if (frac < 0.18) notes.push('FAR');
    const floorY = Math.max(F.heelFloor.y, F.toeFloor.y); if (floorY > H) notes.push('FLOOR_CUT');
    out.notes = notes;
    // 앞뒤 위치(v3.5, 사용자 요청): 카메라 정면(화면 가로 가운데)에 발배뼈(P2)가 오게. '앞' = P1(발가락) 쪽.
    // 정면에서 벗어나면 원근 때문에 높이가 달라져 같은 발도 값이 흔들린다.
    { const fwd = Math.sign(L.P1.x - L.P3.x) || 1, off = (L.P2.x - W / 2) / W * fwd; out.posOff = off;
      out.posCode = off < -POS_TOL ? 'FWD' : off > POS_TOL ? 'BACK' : null; out.posMsg = out.posCode === 'FWD' ? '발을 조금 앞으로 옮겨 주십시오' : out.posCode === 'BACK' ? '발을 조금 뒤로 옮겨 주십시오' : ''; }
    if (!inP2) return fail('P2_ZONE', hl < Z.hCm[0] ? '가운데 스티커가 너무 낮습니다. 발배뼈거친면에 붙였는지 확인해 주십시오' : '가운데 스티커 위치를 확인해 주십시오. 발배뼈거친면에 붙여야 합니다');

    return Object.assign(out, { ok: true, code: 'OK', msg: '발이 가이드에 정확히 들어왔습니다' });
  }
  function guideCheckFixed(det, toe, layout) {
    const [W, H] = det.imageSize, g = guideGeometry(W, H, toe, layout), L = det.landmarks;
    const d3 = Math.hypot(L.P3.x - g.P3.x, L.P3.y - g.P3.y), d1 = Math.hypot(L.P1.x - g.P1.x, L.P1.y - g.P1.y);
    const inP3 = d3 <= g.P3.r, inP1 = d1 <= g.P1.r;
    // P2 범위: 실제 P3→P1 축에서의 진행 비율과, 축에서의 높이(바닥 기준 높이 범위 − 표준 2 cm)
    const span = dist(L.P1, L.P3), sc = span / (FOOT_MODEL.P1.x - FOOT_MODEL.P3.x);
    const t = projectionT(L.P2, L.P3, L.P1), hl = signedDistanceToLine(L.P2, L.P1, L.P3) / sc + FOOT_MODEL.P3.y;
    const Z = FOOT_MODEL.P2zone, inP2 = t >= Z.t[0] && t <= Z.t[1] && hl >= Z.hCm[0] && hl <= Z.hCm[1];
    const out = { inP3, inP1, inP2, d3: d3 / g.P3.r, d1: d1 / g.P1.r, t, p2HeightCm: hl, geom: g };
    if (inP3 && inP1) {
      if (!inP2) return Object.assign(out, { ok: false, code: 'P2_ZONE', msg: hl < Z.hCm[0] ? '가운데 스티커가 너무 낮습니다. 발배뼈거친면에 붙였는지 확인해 주십시오' : '가운데 스티커 위치를 확인해 주십시오. 발배뼈거친면에 붙여야 합니다' });
      return Object.assign(out, { ok: true, code: 'OK', msg: '발이 가이드에 정확히 들어왔습니다' });
    }
    // 코칭: 크기(거리) → 앞뒤 → 높이 순서로 가장 큰 어긋남부터
    const cur = Math.abs(L.P1.x - L.P3.x), want = Math.abs(g.P1.x - g.P3.x), sr = cur / want;
    if (sr < 0.88) return Object.assign(out, { code: 'FAR', msg: '휴대폰을 발에 조금 더 가까이 두십시오' });
    if (sr > 1.14) return Object.assign(out, { code: 'NEAR', msg: '휴대폰을 발에서 조금 더 멀리 두십시오' });
    const mx = (L.P1.x + L.P3.x) / 2 - (g.P1.x + g.P3.x) / 2, my = (L.P1.y + L.P3.y) / 2 - (g.P1.y + g.P3.y) / 2;
    if (Math.abs(mx) >= Math.abs(my) * 0.8) {
      const needRight = mx < 0, forward = (toe === 'right') === needRight;
      return Object.assign(out, { code: needRight ? 'SHIFT_RIGHT' : 'SHIFT_LEFT', msg: forward ? '발을 조금 앞으로 옮겨 주십시오' : '발을 조금 뒤로 옮겨 주십시오' });
    }
    if (my < 0) return Object.assign(out, { code: 'TOO_HIGH', msg: '발이 화면 위쪽에 있습니다. 휴대폰 렌즈가 발 높이를 똑바로 향하게 세워 주십시오' });
    return Object.assign(out, { code: 'TOO_LOW', msg: '발이 화면 아래쪽에 있습니다. 휴대폰 렌즈가 발 높이를 똑바로 향하게 세워 주십시오' });
  }

  // ═══════════════ 바닥선(발바닥–바닥 경계) 검출 ═══════════════
  /**
   * 발꿈치(P3)와 앞발(P1) 아래의 세로줄들을 아래로 훑어 피부가 끝나는 경계를 찾고, 두 구간의 경계점에 직선을 맞춘다.
   * 안쪽 면에서 발바닥이 바닥에 닿는 곳은 발꿈치와 앞발이므로 이 직선이 바닥선이다(발활 부분은 들려 있어 쓰지 않음).
   * 피부 기준색: 각 스티커 바로 아래(스티커 가장자리와 바닥 사이)에서 표본을 취한다.
   * 반환: { ok, a, b(직선 위 두 점), angleDeg, rms, n, reason } — 신뢰할 수 없으면 ok=false와 이유.
   */
  function detectSoleLine(img, det, opts) {
    const o = Object.assign({ cols: 9, maxRmsPx: 1.6, maxAbsAngleDeg: 12, minFrac: 0.6 }, opts || {});
    if (!det || !det.landmarks) return { ok: false, reason: '기준점 없음' };
    const { data, width: W, height: H } = img, L = det.landmarks, dia = det.quality.diameterPx, R = dia / 2;
    const px = (x, y) => { const i = ((y | 0) * W + (x | 0)) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const toward = Math.sign(L.P1.x - L.P3.x) || 1; // 발가락 방향(+x/-x)
    const pts = [], stats = {};
    for (const [key, P, c0, c1] of [['P3', L.P3, -0.7, 1.6], ['P1', L.P1, -1.4, 0.9]]) {
      let found = 0;
      // 기준 피부색: 스티커 좌우 옆(같은 높이)의 피부 — 스티커 아래가 피부인지 확인하는 데 쓴다
      const side = [0, 0, 0]; let sn = 0;
      const inward = key === 'P3' ? toward : -toward; // 두 스티커 사이(발 안쪽) 방향만 — 발꿈치 뒤·발가락 쪽 옆은 발 바깥일 수 있음
      for (const sx of [1.1 * inward, 1.6 * inward]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const X = Math.round(P.x + sx * dia + dx), Y = Math.round(P.y + dy); if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = px(X, Y); side[0] += q[0]; side[1] += q[1]; side[2] += q[2]; sn++;
      }
      if (!sn) continue; side[0] /= sn; side[1] /= sn; side[2] /= sn;
      for (let k = 0; k < o.cols; k++) {
        const x = Math.round(P.x + toward * dia * (c0 + (c1 - c0) * k / (o.cols - 1)));
        if (x < 2 || x >= W - 2) continue;
        // 색 기울기 프로파일: 아래 2행 평균과 위 2행 평균의 색 거리(3열 평균). 피부의 완만한 음영은 작고, 발바닥–바닥 경계는 크다.
        const yS = Math.round(P.y + R + 0.3 * dia), yE = Math.min(H - 4, Math.round(P.y + 4.5 * dia));
        if (yE - yS < 6) continue;
        const rowc = y => { const c = [0, 0, 0]; for (let dx = -1; dx <= 1; dx++) { const q = px(x + dx, y); c[0] += q[0] / 3; c[1] += q[1] / 3; c[2] += q[2] / 3; } return c; };
        const avg2 = (y1, y2) => { const a1 = rowc(y1), a2 = rowc(y2); return [(a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2, (a1[2] + a2[2]) / 2]; };
        const g = [];
        for (let y = yS; y <= yE; y++) g.push(cdist(avg2(y + 1, y + 2), avg2(y - 2, y - 1)));
        // 스티커 바로 아래가 피부인지(스티커 옆 피부색과 비슷한지). 스티커가 바닥에 너무 가까우면 바닥이 잡히므로 제외.
        const below = avg2(yS, yS + 1);
        if (cdist(below, side) > Math.max(22, 0.35 * Math.hypot(...side) * 0.25 + 18)) { if (o.debug) o.debug.push(['below', key, cdist(below, side)]); continue; }
        let im = 0; for (let i = 1; i < g.length; i++) if (g[i] > g[im]) im = i;
        const gMed = median(g);
        if (g[im] < Math.max(8, 3 * gMed) || im === 0 || im === g.length - 1) { if (o.debug) o.debug.push(['peak', key, g[im], gMed, im, g.length]); continue; }
        // 경계 위쪽은 피부(옆 피부색과 비슷), 아래쪽은 다른 색이어야 한다
        const yy = yS + im, upC = avg2(Math.max(yS, yy - 3), Math.max(yS, yy - 2)), dnC = avg2(Math.min(H - 2, yy + 3), Math.min(H - 2, yy + 4));
        if (cdist(upC, side) > cdist(dnC, side) || cdist(dnC, upC) < 12) { if (o.debug) o.debug.push(['side', key, cdist(upC, side), cdist(dnC, side), cdist(dnC, upC)]); continue; }
        // 포물선 보간으로 기울기 최대점(서브픽셀). 위 창(y-2,y-1)과 아래 창(y+1,y+2)의 경계는 y+0.5 → 이 열의 경계 y
        const d1 = g[im - 1], d2 = g[im], d3 = g[im + 1], den = d1 - 2 * d2 + d3;
        const off = den < 0 ? 0.5 * (d1 - d3) / den : 0;
        const edge = { y: yS + im + off + 1 }, fracUse = 0; // 위·아래 창의 중심 = y → 계단 경계 위치(pts에는 edge.y - 1)
        pts.push({ x, y: edge.y - 1 + fracUse, key }); found++;
      }
      stats[key] = found / o.cols;
    }
    let method = 'edge';
    if (stats.P3 < o.minFrac || stats.P1 < o.minFrac) {
      const q = det.quality || {}, crisp = q.edgeWidthPx != null && q.edgeLimitPx && q.edgeWidthPx <= 0.7 * q.edgeLimitPx; // 2차 방법은 사진이 선명할 때만(흐리면 경계 위치가 치우침)
      const m2 = o.noModel || !crisp ? null : detectSoleLineModel(img, det, o);
      if (!m2 || !m2.pts || m2.stats.P3 < 0.45 || m2.stats.P1 < 0.45) return { ok: false, reason: '발바닥 경계를 충분히 찾지 못함(바닥과 피부색이 비슷하거나 그림자)', stats, stats2: m2 && m2.stats };
      pts.length = 0; m2.pts.forEach(p => pts.push(p)); method = 'model'; stats.texS = m2.texS; stats.texF = m2.texF; Object.assign(stats, m2.stats); o.maxRmsPx = Math.min(o.maxRmsPx, 1.5);
    }
    // 무리 고르기(ALG-2.6.1, 2026-11 사용자 카펫 사진 U_ 7장): 촘촘한 카펫 무늬 때문에 열마다 '진짜 발바닥 선'과
    // 그 아래 무늬 경계가 섞여 잡힌다(두 무리, 12~18px 차이). 두 점 직선마다 1.5px 안의 점 수를 세고(양쪽 스티커에
    // 2개 이상씩), 최다의 75% 이상인 직선 중 가장 위(발에 가까운) 것을 고른다 — 발바닥 선은 발 아래 첫 바닥 경계이므로.
    // 결이 뚜렷한 바닥(카펫)에서만 — 발을 든 사진(바닥 대신 배경)은 결이 약해 여기서 걸러진다(표본 S_11~14: 결 4~13, 사용자 카펫 20~45)
    if (method === 'model' && pts.length >= 6 && stats.texF >= 18 && stats.texF >= 4 * stats.texS) {
      let cand = [];
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j]; if (a.key === b.key || Math.abs(b.x - a.x) < 1) continue;
        const mm = (b.y - a.y) / (b.x - a.x), cc = a.y - mm * a.x; if (Math.abs(mm) > Math.tan(o.maxAbsAngleDeg * Math.PI / 180)) continue;
        const inl = pts.filter(p => Math.abs(p.y - (mm * p.x + cc)) <= 1.5);
        if (inl.filter(p => p.key === 'P1').length < 2 || inl.filter(p => p.key === 'P3').length < 2) continue;
        cand.push({ n: inl.length, yMid: mm * (L.P1.x + L.P3.x) / 2 + cc, inl });
      }
      if (cand.length) {
        const nMax = Math.max(...cand.map(q => q.n)); cand = cand.filter(q => q.n >= Math.max(5, 0.75 * nMax, 0.3 * pts.length));
        if (cand.length) { cand.sort((p, q) => p.yMid - q.yMid || q.n - p.n); const keep = new Set(cand[0].inl), mm0 = cand[0].inl;
          const fitL = arr => { const n = arr.length, sx = arr.reduce((s, p) => s + p.x, 0), sy = arr.reduce((s, p) => s + p.y, 0), sxx = arr.reduce((s, p) => s + p.x * p.x, 0), sxy = arr.reduce((s, p) => s + p.x * p.y, 0), d = n * sxx - sx * sx; const k = d ? (n * sxy - sx * sy) / d : 0; return { k, c: (sy - k * sx) / n }; };
          const l0 = fitL(mm0); for (const p of pts) if (Math.abs(p.y - (l0.k * p.x + l0.c)) <= 2.5) keep.add(p);
          if (keep.size < pts.length) { const dropped = pts.length - keep.size; const kept = pts.filter(p => keep.has(p)); pts.length = 0; kept.forEach(p => pts.push(p)); stats.clusterDropped = dropped; }
        }
      }
    }
    // 견고한 직선 피팅(y = m x + c, Tukey 가중 반복)
    let m = 0, c = median(pts.map(p => p.y)), w = pts.map(() => 1);
    for (let it = 0; it < 10; it++) {
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      pts.forEach((p, i) => { sw += w[i]; sx += w[i] * p.x; sy += w[i] * p.y; sxx += w[i] * p.x * p.x; sxy += w[i] * p.x * p.y; });
      const den = sw * sxx - sx * sx; if (Math.abs(den) < 1e-9) break;
      m = (sw * sxy - sx * sy) / den; c = (sy - m * sx) / sw;
      const r = pts.map(p => p.y - (m * p.x + c)), s = Math.max(0.3, 1.4826 * median(r.map(Math.abs))), k = 4.685 * s;
      w = r.map(v => Math.abs(v) >= k ? 0 : (1 - (v / k) ** 2) ** 2);
    }
    const res = pts.map(p => p.y - (m * p.x + c)), inl = res.filter((_, i) => w[i] > 0);
    const rms = Math.sqrt(inl.reduce((s2, v) => s2 + v * v, 0) / Math.max(1, inl.length));
    const angleDeg = Math.atan(m) * 180 / Math.PI;
    const axisDeg = Math.atan2(L.P1.y - L.P3.y, L.P1.x - L.P3.x) * 180 / Math.PI;
    const axisFix = Math.abs(axisDeg) > 90 ? axisDeg - Math.sign(axisDeg) * 180 : axisDeg;
    const xa = Math.min(L.P1.x, L.P3.x), xb = Math.max(L.P1.x, L.P3.x);
    const out = { a: { x: xa, y: m * xa + c }, b: { x: xb, y: m * xb + c }, slope: m, intercept: c, angleDeg, rms, n: inl.length, stats, method };
    if (rms > o.maxRmsPx) return Object.assign(out, { ok: false, reason: `경계가 고르지 않음(잔차 ${rms.toFixed(2)}px)` });
    // 바닥선 자체의 기울기(휴대폰 롤)만 본다. 스티커 축과 비교하지 않는 이유: 부착 높이가 다르면 축이 기울어지는 것이 정상이며 그것을 점검해야 하므로.
    if (Math.abs(angleDeg) > o.maxAbsAngleDeg) return Object.assign(out, { ok: false, reason: `바닥선이 ${Math.abs(angleDeg).toFixed(1)}° 기울어짐(휴대폰 수평 확인)` });
    out.axisDiffDeg = Math.abs(angleDeg - axisFix);
    const below = ['P1', 'P3'].every(k => L[k].y < m * L[k].x + c - R);
    if (!below) return Object.assign(out, { ok: false, reason: '바닥선이 스티커보다 위에서 잡힘' });
    return Object.assign(out, { ok: true });
  }
  /**
   * 바닥선 2차 방법(실제 바닥용): 그 자리에서 피부색(스티커 둘레)과 바닥색(발바닥 아래)을 배워, 열마다
   * '위는 피부·아래는 바닥'이 가장 잘 갈리는 위치(계단 맞춤)를 찾고 색 기울기로 서브픽셀 보정한다.
   * 카펫·나무 바닥처럼 피부와 색이 비슷하거나 결이 있는 바닥에서 1차 방법이 실패할 때 쓴다.
   */
  function detectSoleLineModel(img, det, o) {
    const { data, width: W, height: H } = img, L = det.landmarks, dia = det.quality.diameterPx, R = dia / 2;
    const feat = i => { const r = data[i], g = data[i + 1], b = data[i + 2], t = r + g + b + 1, mx = Math.max(r, g, b), mn = Math.min(r, g, b); return [r / t, g / t, mx ? (mx - mn) / mx * 0.35 : 0, Math.log(t) * 0.08]; };
    const gauss = arr => {
      if (arr.length < 20) return null; const d = 4, m = new Array(d).fill(0);
      for (const f of arr) for (let k = 0; k < d; k++) m[k] += f[k] / arr.length;
      const S = []; for (let a = 0; a < d; a++) { S.push(new Array(d).fill(0)); S[a][a] = 4e-5; }
      for (const f of arr) for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) S[a][b] += (f[a] - m[a]) * (f[b] - m[b]) / arr.length;
      // 역행렬(가우스-조르당)
      const A = S.map((r, i) => r.concat(new Array(d).fill(0).map((_, j) => (i === j ? 1 : 0))));
      for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (Math.abs(A[p][c]) < 1e-14) return null; [A[c], A[p]] = [A[p], A[c]]; const v = A[c][c]; for (let k = 0; k < 2 * d; k++) A[c][k] /= v; for (let r = 0; r < d; r++) if (r !== c) { const f = A[r][c]; for (let k = 0; k < 2 * d; k++) A[r][k] -= f * A[c][k]; } }
      return { m, I: A.map(r => r.slice(d)) };
    };
    const md = (G, f) => { let s2 = 0; for (let a = 0; a < 4; a++) { let t = 0; for (let b = 0; b < 4; b++) t += G.I[a][b] * (f[b] - G.m[b]); s2 += (f[a] - G.m[a]) * t; } return s2; };
    const at = (x, y) => (Math.round(y) * W + Math.round(x)) * 4, inside = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
    const blue = i => data[i + 2] > Math.max(data[i], data[i + 1]) + 25;
    // 피부 표본: 스티커 둘레(0.75~1.3 지름) — 발 안쪽 면이 확실한 곳
    const sk = [];
    for (const P of [L.P1, L.P2, L.P3]) for (let a = 0; a < 48; a++) for (const rr of [0.8, 0.95, 1.1, 1.25]) {
      const x = P.x + Math.cos(a / 48 * 2 * Math.PI) * rr * dia, y = P.y + Math.sin(a / 48 * 2 * Math.PI) * rr * dia; if (!inside(x, y)) continue; const i = at(x, y); if (!blue(i)) sk.push(feat(i));
    }
    // 바닥 표본: 기준선(P1–P3)보다 2.4~4 지름 아래(발바닥은 약 1.25 지름 아래)
    const k13 = (L.P1.y - L.P3.y) / ((L.P1.x - L.P3.x) || 1e-6), base = x => L.P3.y + k13 * (x - L.P3.x);
    const fl = [], xa = Math.min(L.P1.x, L.P3.x) - dia, xb = Math.max(L.P1.x, L.P3.x) + dia;
    for (let x = xa; x <= xb; x += Math.max(1, dia / 8)) for (let t = 1.8; t <= 2.8; t += 0.1) { const y = base(x) + t * dia; if (inside(x, y)) fl.push(feat(at(x, y))); }
    const GS = gauss(sk), GF = gauss(fl); if (!GS || !GF) return { ok: false, reason: '바닥이 화면에 충분히 보이지 않음' };
    const lum = (x, y) => { const i = at(x, y); return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    const tex = (x, y) => { let t = 0, n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X = x + dx, Y = y + dy; if (!inside(X, Y) || !inside(X + 1, Y + 1)) continue; const l = lum(X, Y); t += Math.abs(l - lum(X + 1, Y)) + Math.abs(l - lum(X, Y + 1)); n++; } return n ? t / n : 0; };
    const tS = [], tF = [];
    for (const P of [L.P1, L.P2, L.P3]) for (let a = 0; a < 16; a++) { const x = Math.round(P.x + Math.cos(a / 16 * 2 * Math.PI) * 1.1 * dia), y = Math.round(P.y + Math.sin(a / 16 * 2 * Math.PI) * 1.1 * dia); if (inside(x, y) && !blue(at(x, y))) tS.push(tex(x, y)); }
    for (let x = xa; x <= xb; x += Math.max(2, dia / 4)) for (const t of [1.9, 2.2, 2.5]) { const y = Math.round(base(x) + t * dia), xx = Math.round(x); if (inside(xx, y)) tF.push(tex(xx, y)); }
    const mS = median(tS.length ? tS : [0]), mF = median(tF.length ? tF : [0]), tThr = (mS + mF) / 2, tSpan = Math.max(1, (mF - mS) / 2), tW = mF > 1.8 * mS + 2 ? 12 : 0; // 바닥 결이 뚜렷할 때만 결을 쓴다
    if (o.debug) o.debug.push(['tex', +mS.toFixed(1), +mF.toFixed(1)]);
    const toward = Math.sign(L.P1.x - L.P3.x) || 1, pts = [], stats = {};
    for (const [key, P, c0, c1] of [['P3', L.P3, -0.6, 1.6], ['P1', L.P1, -1.4, 0.9]]) {
      let found = 0;
      for (let k = 0; k < o.cols; k++) {
        const x = Math.round(P.x + toward * dia * (c0 + (c1 - c0) * k / (o.cols - 1))); if (x < 2 || x >= W - 2) continue;
        let y0 = Math.round(P.y + R * 1.04 + 1); while (y0 < H - 3 && blue(at(x, y0))) y0++; const y1 = Math.min(H - 3, Math.round(P.y + 2.6 * dia)); if (y1 - y0 < 8) continue;
        // 각 행의 '바닥다움'(3열 평균): + 이면 바닥, - 이면 피부
        // 바닥다움 = 결(질감) + 색: 피부는 매끈하고(결 작음) 카펫·나무 바닥은 결이 있다
        const v = []; for (let y = y0; y <= y1; y++) { let e = 0; for (let dx = -1; dx <= 1; dx++) { const f = feat(at(x + dx, y)); e += Math.max(-25, Math.min(25, md(GS, f) - md(GF, f))) * (tW ? 0.3 : 1); } v.push(e / 3 + (tW ? tW * Math.max(-1.5, Math.min(1.5, (tex(x, y) - tThr) / tSpan)) : 0)); }
        // 계단 맞춤: 위(피부)는 음수, 아래(바닥)는 양수가 되도록 경계 b를 고른다
        const pre = [0]; for (const e of v) pre.push(pre[pre.length - 1] + e);
        let best = -Infinity, bi = -1; const tot = pre[v.length];
        for (let b = 0; b <= v.length - 3; b++) { const sc = -(pre[b]) + (tot - pre[b]); if (sc > best) { best = sc; bi = b; } }
        if (bi < 0) continue;
        const up = bi ? pre[bi] / bi : -2, dn = (tot - pre[bi]) / (v.length - bi);
        if (!(up < -1 && dn > 1)) continue; // 위는 피부, 아래는 바닥이 분명해야
        // 서브픽셀: 경계 ±3px에서 위아래 색 차이가 가장 큰 곳
        // 서브픽셀: 경계 ±3px의 색 기울기(3열 평균, 위 2행·아래 2행 창) 최대점 + 포물선 보간
        const yb = y0 + bi, G = y => { let g = 0; for (let dx = -1; dx <= 1; dx++) { if (!inside(x + dx, y - 2) || !inside(x + dx, y + 2)) return 0; for (let c = 0; c < 3; c++) g += Math.abs(data[at(x + dx, y + 1) + c] + data[at(x + dx, y + 2) + c] - data[at(x + dx, y - 1) + c] - data[at(x + dx, y - 2) + c]); } return g; };
        let gb = -1, yy = yb; for (let y = yb - 3; y <= yb + 3; y++) { const g = G(y); if (g > gb) { gb = g; yy = y; } }
        const g1 = G(yy - 1), g3 = G(yy + 1), den = g1 - 2 * gb + g3, off = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (g1 - g3) / den)) : 0;
        pts.push({ x, y: yy + off, key }); found++; // 1차 방법과 같은 좌표 규약
      }
      stats[key] = found / o.cols;
    }
    return { pts, stats, texS: mS, texF: mF };
  }
  // 점에서 바닥선까지 수직 거리(px). 바닥선 위쪽(발 쪽)이 양수.
  function heightAboveSole(p, sole) {
    const n = Math.hypot(sole.slope, 1);
    return ((sole.slope * p.x + sole.intercept) - p.y) / n;
  }

  // ───────────────────────── 체중부하 인지(형태 근거) ─────────────────────────
  /**
   * 비체중부하 기록(ref)과 현재 검출(cur)을 스티커 지름 단위로 비교해 체중이 실렸다는 형태 근거를 계산한다.
   * - drop: P2 높이 감소(지름 배수) — 발활 하강
   * - spanGain: P1–P3 거리 증가율 — 체중으로 발이 길어짐
   * 거리·해상도와 무관하도록 모두 스티커 지름으로 정규화한다. 기준값은 초기 휴리스틱이며 실제 자료로 조정해야 한다.
   */
  const LOAD = { minDrop: 0.12, minSpanGain: 0.006 };
  function loadEvidence(ref, cur, load) {
    const T = load || LOAD;
    const r = x => ({ h: x.heightPx / x.dia, span: x.spanPx / x.dia });
    const a = r(ref), b = r(cur);
    const drop = a.h - b.h, spanGain = (b.span - a.span) / a.span;
    const confirmed = drop >= T.minDrop || spanGain >= T.minSpanGain;
    return { drop, spanGain, confirmed, by: drop >= T.minDrop ? 'drop' : spanGain >= T.minSpanGain ? 'span' : null };
  }
  function shapeOf(det) {
    if (!det || !det.landmarks) return null;
    const L = det.landmarks;
    return { heightPx: distanceToLine(L.P2, L.P1, L.P3), spanPx: dist(L.P1, L.P3), dia: det.quality.diameterPx };
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
    if (det.sole && det.sole.slope != null) { det.sole.intercept = det.sole.intercept + y0 - det.sole.slope * x0; if (det.sole.a) { shift(det.sole.a); shift(det.sole.b); } }
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
  /**
   * 형태 변화량(스티커 지름 단위): 세 점의 '서로에 대한' 배치만 비교한다.
   * 휴대폰이 흔들려 세 점이 함께 이동·회전하면 0에 가깝고, 발 자세가 바뀌면(발활 하강, 발 길이 변화) 커진다.
   */
  function shapeDelta(a, b) {
    if (!a || !b || !a.landmarks || !b.landmarks) return Infinity;
    const f = d => { const L = d.landmarks, span = dist(L.P1, L.P3), dia = (d.quality && d.quality.diameterPx) || 1;
      return { h: signedDistanceToLine(L.P2, L.P1, L.P3) / dia, s: span / dia, t: projectionT(L.P2, L.P3, L.P1) * span / dia }; };
    const A = f(a), B = f(b);
    return Math.max(Math.abs(A.h - B.h), Math.abs(A.s - B.s), Math.abs(A.t - B.t));
  }
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
      burst: (() => { const sdp = keep.length > 1 ? Math.sqrt(hk.reduce((s, v) => s + (v - mean(hk)) ** 2, 0) / (keep.length - 1)) : 0; return { total: dets.length, used: keep.length, heightSdPx: sdp, seHeightPx: sdp / Math.sqrt(keep.length) }; })()
    });
    out.confidence = median(keep.map(d => d.confidence)); out.detectionConfidence = median(keep.map(d => d.detectionConfidence));
    // 바닥선: 검출된 프레임이 절반 이상일 때만, 기준점 축 가운데에서의 높이와 기울기를 중앙값으로 결합
    const soles = keep.filter(d => d.sole && d.sole.ok);
    if (soles.length >= Math.ceil(keep.length / 2)) {
      // 프레임마다 '그 프레임의 P1·P3 중점'에서 바닥선까지의 높이를 재어 결합한다(휴대폰이 흔들려 영상 전체가 이동해도 영향 없음)
      const xm = (out.landmarks.P1.x + out.landmarks.P3.x) / 2, ymid = (out.landmarks.P1.y + out.landmarks.P3.y) / 2;
      const rel = soles.map(d => { const cx = (d.landmarks.P1.x + d.landmarks.P3.x) / 2, cy = (d.landmarks.P1.y + d.landmarks.P3.y) / 2; return d.sole.slope * cx + d.sole.intercept - cy; });
      const m = median(soles.map(d => d.sole.slope)), dy = median(rel), ym = ymid + dy;
      out.sole = { ok: true, slope: m, intercept: ym - m * xm, frames: soles.length, rms: median(soles.map(d => d.sole.rms)), sdPx: Math.sqrt(mean(rel.map(v => (v - dy) ** 2))) };
    } else out.sole = { ok: false, reason: `바닥선이 확인된 프레임이 부족함(${soles.length}/${keep.length})`, frames: soles.length };
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
      // 화면 지연 보정: 분석하는 동안 영상은 이미 앞으로 가 있다 → 속도 × 지연만큼 앞당긴 위치(최대 maxPx 이동)
      positionsAhead(dt, maxPx) { if (!st) return null; const m = maxPx > 0 ? maxPx : Infinity;
        return Object.fromEntries(keys.map(k => { let dx = st[k].x.v * dt, dy = st[k].y.v * dt; const L = Math.hypot(dx, dy); if (L > m) { dx *= m / L; dy *= m / L; } return [k, { x: st[k].x.x + dx, y: st[k].y.x + dy }]; })); },
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
    ALGORITHM_VERSION, CLASS_MM, GUIDE, DEFAULT_DETECT, DEFAULT_CONVERSION, CATEGORIES, TEMPLATE,
    rgbToHsv, detectStickers, labelLandmarks, signedDistanceToLine, distanceToLine, projectionT,
    measureImage, comparePrePost, classify, roundMm, errorMetrics,
    splitByParticipant, trainCalibration, applyCalibration, fitMethod, validateConversion,
    motionBetween, framingCheck, laplacianVariance, archAngle, cropImage, detectInRoi, labelsConsistent, combineDetections, shapeDelta, AI_FEATURES, errorFeatures, trainErrorModel, applyErrorModel, fitRidge, createLandmarkKalman, chromaMap, ALIGN, alignmentCheck, LOAD, loadEvidence, shapeOf, FOOT_MODEL, GUIDE_LAYOUT, guideGeometry, guideCheck, fitFootModel, snapOutline, densify, segmentFoot, appHeights, EXERCISE_DRAFTS, EXERCISE_CATEGORIES, youtubeId, resampleClosed, personalCare, measurementWeight, CARE, detectSoleLine, heightAboveSole, appHeightsAll, reliabilityStats, retestPairs, normalizedIndices, NNH_REF, distanceAdvice, calibrateFovK, DIST
  };
});
