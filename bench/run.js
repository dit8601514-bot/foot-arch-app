// 벤치마크 실행: node bench/run.js [core 경로] [라벨]
// 조건별 검출 성공률, 기준점 중심 오차(px), P2 높이 오차(px), 잘못된 수용(오검출) 수를 계산한다.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const corePath = path.resolve(process.argv[2] || path.join(__dirname, '../src/core.js'));
const label = process.argv[3] || path.basename(corePath);
const C = require(corePath);
const dir = path.join(__dirname, process.env.BENCH_DIR || 'data');
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
function load(t) {
  const rgb = zlib.gunzipSync(fs.readFileSync(path.join(dir, t.file)));
  const data = new Uint8ClampedArray(t.w * t.h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { data[j] = rgb[i]; data[j + 1] = rgb[i + 1]; data[j + 2] = rgb[i + 2]; data[j + 3] = 255; }
  return { data, width: t.w, height: t.h };
}
const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };
const byCond = {};
let ms = 0;
for (const t of truth) {
  const img = load(t);
  const t0 = process.hrtime.bigint();
  const det = C.detectStickers(img, { toeDirection: t.toe });
  ms += Number(process.hrtime.bigint() - t0) / 1e6;
  const b = byCond[t.cond] || (byCond[t.cond] = { n: 0, ok: 0, wrong: 0, errs: [], herr: [], expect: t.expect, reasons: {} });
  b.n++;
  if (t.expect === 'reject') { if (det.ok) b.wrong++; else b.ok++; continue; }
  if (!det.ok) { const r = (det.reasons[0] || {}).code || '?'; b.reasons[r] = (b.reasons[r] || 0) + 1; continue; }
  const P = { P1: t.P1, P2: t.P2, P3: t.P3 };
  // 검출기는 픽셀 중심을 정수 좌표로 보고, 생성기는 픽셀 중심을 +0.5로 본다 → 0.5 보정
  const e = ['P1', 'P2', 'P3'].map(k => Math.hypot(det.landmarks[k].x + 0.5 - P[k][0], det.landmarks[k].y + 0.5 - P[k][1]));
  if (Math.max(...e) > t.radius * 0.6) { b.wrong++; continue; } // 라벨 오류 또는 엉뚱한 위치
  b.ok++; b.errs.push(Math.max(...e));
  b.herr.push(Math.abs(C.distanceToLine(det.landmarks.P2, det.landmarks.P1, det.landmarks.P3) - t.heightPx));
}
const rows = [];
let totOk = 0, totN = 0, totWrong = 0; const allE = [], allH = [];
for (const [cond, b] of Object.entries(byCond)) {
  totOk += b.ok; totN += b.n; totWrong += b.wrong; allE.push(...b.errs); allH.push(...b.herr);
  rows.push({ cond, expect: b.expect, success: b.ok / b.n, wrong: b.wrong, medErr: pct(b.errs, 0.5), p95Err: pct(b.errs, 0.95), medH: pct(b.herr, 0.5), p95H: pct(b.herr, 0.95), reasons: b.reasons });
}
const summary = { label, images: totN, successRate: totOk / totN, wrongAccepts: totWrong, medCenterErr: pct(allE, 0.5), p95CenterErr: pct(allE, 0.95), medHeightErr: pct(allH, 0.5), p95HeightErr: pct(allH, 0.95), msPerImage: ms / totN };
const f = (v, d) => (v == null || Number.isNaN(v) ? '  —  ' : v.toFixed(d == null ? 2 : d));
console.log(`\n[${label}] 조건별 결과 (성공 = 검출 조건은 정확한 라벨로 측정, 거부 조건은 측정 거부)`);
console.log('조건'.padEnd(20) + '성공률  오검출  중심오차 중앙/95%   높이오차 중앙/95%   실패 사유');
for (const r of rows) console.log(r.cond.padEnd(20) + `${(r.success * 100).toFixed(0).padStart(4)}%  ${String(r.wrong).padStart(4)}    ${f(r.medErr)} / ${f(r.p95Err)}      ${f(r.medH)} / ${f(r.p95H)}     ${Object.entries(r.reasons).map(([k, v]) => k + '×' + v).join(' ')}`);
console.log(`\n전체 ${(summary.successRate * 100).toFixed(1)}% 성공, 오검출 ${summary.wrongAccepts}건, 중심오차 중앙 ${f(summary.medCenterErr)}px / 95% ${f(summary.p95CenterErr)}px, 높이오차 중앙 ${f(summary.medHeightErr)}px / 95% ${f(summary.p95HeightErr)}px, ${f(summary.msPerImage, 0)}ms/장`);
fs.writeFileSync(path.join(__dirname, `result-${label}${process.env.BENCH_DIR ? '-' + process.env.BENCH_DIR : ''}.json`), JSON.stringify({ summary, rows }, null, 1));
// 품질 게이트(CI): BENCH_MIN_SUCCESS, BENCH_MAX_WRONG, BENCH_MAX_P95 환경변수로 기준을 정하면 미달 시 실패 코드로 종료
const minS = Number(process.env.BENCH_MIN_SUCCESS || 0), maxW = Number(process.env.BENCH_MAX_WRONG ?? Infinity), maxP = Number(process.env.BENCH_MAX_P95 || Infinity);
const fails = [];
if (summary.successRate < minS) fails.push(`성공률 ${(summary.successRate * 100).toFixed(1)}% < ${(minS * 100).toFixed(1)}%`);
if (summary.wrongAccepts > maxW) fails.push(`오검출 ${summary.wrongAccepts}건 > ${maxW}건`);
if (summary.p95HeightErr > maxP) fails.push(`높이오차 95% ${summary.p95HeightErr.toFixed(2)}px > ${maxP}px`);
if (fails.length) { console.error('품질 게이트 실패: ' + fails.join(', ')); process.exit(1); }
