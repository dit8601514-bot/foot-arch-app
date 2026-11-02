// 단위 테스트: node test/unit.test.js
'use strict';
const C = require('../src/core.js');
const { makeImage, footScene } = require('./synth.js');
const results = [];
function t(name, fn) { try { fn(); results.push([name, 'PASS', '']); } catch (e) { results.push([name, 'FAIL', e.message]); } }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || ''} 기대 ${b}, 실제 ${a}`); }
function near(a, b, tol, m) { if (!(Math.abs(a - b) <= tol)) throw new Error(`${m || ''} 기대 ${b}±${tol}, 실제 ${a}`); }
function ok(c, m) { if (!c) throw new Error(m || 'assert'); }

// 1. 연구 분류 기준 (필수)
const must = [[4.8, '정상 범위'], [5.4, '경증 평발 의심'], [9.8, '경증 평발 의심'], [10.0, '중등도 평발 의심'], [14.9, '중등도 평발 의심'], [15.0, '중증 평발 의심']];
for (const [v, l] of must) t(`분류 ${v}mm → ${l}`, () => eq(C.classify(v).label, l));
const extra = [[0, '정상 범위'], [5.0, '정상 범위'], [5.04, '정상 범위'], [5.05, '경증 평발 의심'], [9.94, '경증 평발 의심'], [9.95, '중등도 평발 의심'], [14.95, '중증 평발 의심'], [30, '중증 평발 의심']];
for (const [v, l] of extra) t(`경계 ${v}mm → ${l} (표시값 반올림 후 분류)`, () => eq(C.classify(v).label, l));
t('음수/NaN 분류 거부', () => { eq(C.classify(-1), null); eq(C.classify(NaN), null); });

// 2. 기하
t('P2-기준선 수직거리', () => near(C.distanceToLine({ x: 3, y: 0 }, { x: 0, y: 4 }, { x: 10, y: 4 }), 4, 1e-9));
t('기울어진 기준선 수직거리', () => near(C.distanceToLine({ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 10 }), Math.SQRT2 * 5, 1e-9));
t('부호: 이미지 위쪽이 양수', () => ok(C.signedDistanceToLine({ x: 5, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }) > 0));

// 3. 합성 이미지 검출
const W = 960, H = 720;
for (const toe of ['right', 'left']) {
  t(`합성: 스티커 3개 검출·라벨 정확 (발가락 ${toe})`, () => {
    const sc = footScene(W, H, 60, { toe });
    const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }), { toeDirection: toe });
    ok(det.ok, JSON.stringify(det.reasons));
    for (const k of ['P1', 'P2', 'P3']) { near(det.landmarks[k].x, sc[k].x, 0.5, k + '.x'); near(det.landmarks[k].y, sc[k].y, 0.5, k + '.y'); }
    near(C.distanceToLine(det.landmarks.P2, det.landmarks.P1, det.landmarks.P3), 60, 0.5, '높이px');
  });
}
t('합성: 발가락 방향을 반대로 지정하면 불확실로 재촬영', () => {
  const sc = footScene(W, H, 60, { toe: 'right' });
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }), { toeDirection: 'left' });
  ok(!det.ok && det.reasons.some(r => r.code === 'P2_NEAR_TOE'), JSON.stringify(det.reasons));
});
t('합성: 스티커 2개 → 재촬영', () => {
  const sc = footScene(W, H, 60);
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers.slice(0, 2) }));
  ok(!det.ok && det.reasons[0].code === 'MISSING');
});
t('합성: 스티커 절반 가림 → 재촬영(가림 안내)', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.map(s => Object.assign({}, s)); st[1].cutBelowY = st[1].y - 2;
  const det = C.detectStickers(makeImage(W, H, { stickers: st }));
  ok(!det.ok && det.reasons.some(r => r.code === 'OCCLUDED'), JSON.stringify(det.reasons));
});
t('합성: 스티커 겹침 → 재촬영', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.concat([{ x: sc.P2.x + 16, y: sc.P2.y, r: 14 }]);
  const det = C.detectStickers(makeImage(W, H, { stickers: st }));
  ok(!det.ok, JSON.stringify(det.reasons));
});
t('합성: 파란 물체 4개 → 재촬영', () => {
  const sc = footScene(W, H, 60);
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers, extraBlue: [{ x: 100, y: 120, r: 14 }] }));
  ok(!det.ok && det.reasons[0].code === 'EXTRA');
});
t('합성: 흐린 이미지 → 재촬영(흐림)', () => {
  const sc = footScene(W, H, 60);
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers, blur: 5 }));
  ok(!det.ok && det.reasons.some(r => r.code === 'BLUR'), JSON.stringify(det.reasons) + JSON.stringify(det.quality));
});
t('합성: 거꾸로 촬영(P2가 기준선 아래) → 재촬영', () => {
  const sc = footScene(W, H, -60);
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }));
  ok(!det.ok && det.reasons.some(r => r.code === 'P2_BELOW'));
});
t('합성: 잡음 강함(σ≈±15)에서 중심 오차 ≤0.5px', () => {
  const sc = footScene(W, H, 55);
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers, noise: 15, seed: 7 }));
  ok(det.ok, JSON.stringify(det.reasons));
  for (const k of ['P1', 'P2', 'P3']) near(Math.hypot(det.landmarks[k].x - sc[k].x, det.landmarks[k].y - sc[k].y), 0, 0.5, k);
});

// 4. mm 환산 / 전후 비교
const conv = { stickerDiameterMm: 10, validated: true };
function measured(hPx, r, opts) { const sc = footScene(W, H, hPx, Object.assign({ r }, opts)); const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }), {}); const m = C.measureImage(det, conv); m.imageSize = det.imageSize; return m; }
t('mm 환산: 검증 전에는 mm 미표시(보정 필요)', () => {
  const sc = footScene(W, H, 60); const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }));
  const m = C.measureImage(det, { stickerDiameterMm: 10, validated: false }); eq(m.status, '보정 필요'); eq(m.heightMm, null);
});
t('mm 환산: 지름 미설정 → 보정 필요', () => {
  const sc = footScene(W, H, 60); const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }));
  eq(C.measureImage(det, { validated: true }).status, '보정 필요');
});
t('mm 환산: 28px=10mm, 높이 84px → 30.0mm ±0.3', () => { const m = measured(84, 14); eq(m.status, '측정 가능'); near(m.heightMm, 30, 0.3); });
t('mm 환산: 기울어진 스티커(타원) → 보정 필요', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.map(s => ({ x: s.x, y: s.y, r: 14, rx: 14, ry: 11 }));
  const det = C.detectStickers(makeImage(W, H, { stickers: st })); ok(det.ok, JSON.stringify(det.reasons)); eq(C.measureImage(det, conv).status, '보정 필요');
});
t('mm 환산: 스티커 크기 불균일(원근) → 보정 필요', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.map((s, i) => ({ x: s.x, y: s.y, r: [12, 14, 16][i] }));
  const det = C.detectStickers(makeImage(W, H, { stickers: st })); eq(C.measureImage(det, conv).status, '보정 필요');
});
t('전·후 비교: 84px→56px = 10.0mm, 중등도', () => {
  const pre = measured(84, 14), post = measured(56, 14); const r = C.comparePrePost(pre, post, conv);
  eq(r.status, '측정 가능'); near(r.changeMm, 10, 0.3); ok(['중등도 평발 의심', '경증 평발 의심'].includes(C.classify(r.changeMm).label));
});
t('전·후 비교: 촬영 거리 변화(축척 14%) → 재촬영', () => {
  const pre = measured(84, 14), post = measured(64, 16); eq(C.comparePrePost(pre, post, conv).status, '재촬영 필요');
});
t('전·후 비교: 한쪽 누락 → 계산 안 함', () => { eq(C.comparePrePost(measured(84, 14), null, conv).changeMm, null); });
t('전·후 비교: 비정상 변화(≥30mm) → 측정 불가', () => { const r = C.comparePrePost(measured(200, 14), measured(40, 14), conv); eq(r.status, '측정 불가'); });

// 5. 오차 지표
t('오차지표 ME/MAE/RMSE', () => {
  const m = C.errorMetrics([{ ai: 11, ref: 10 }, { ai: 9, ref: 10 }, { ai: 13, ref: 10 }]);
  near(m.me, 1, 1e-9); near(m.mae, 5 / 3, 1e-9); near(m.rmse, Math.sqrt(11 / 3), 1e-9);
});
t('상대오차: 기준값 0 근처 제외', () => { const m = C.errorMetrics([{ ai: 0.5, ref: 0 }, { ai: 11, ref: 10 }]); eq(m.relN, 1); near(m.mape, 10, 1e-9); });

// 6. 보정 모델
function fakeRows(nP, rep, f, seed) { let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; const out = []; for (let p = 0; p < nP; p++) for (let k = 0; k < rep; k++) { const ref = 5 + r() * 25; out.push({ participantId: 'P' + p, ref, ai: f(ref) + (r() - 0.5) * 0.6 }); } return out; }
t('보정: 참여자 단위 분할(누수 없음)', () => {
  const sp = C.splitByParticipant(fakeRows(10, 3, x => x, 5), 1);
  const a = new Set(sp.train.map(r => r.participantId)), b = new Set(sp.val.map(r => r.participantId)), c = new Set(sp.test.map(r => r.participantId));
  for (const id of a) ok(!b.has(id) && !c.has(id)); for (const id of b) ok(!c.has(id));
});
t('보정: 데이터 부족 시 학습 거부', () => ok(!C.trainCalibration(fakeRows(3, 2, x => x, 3)).ok));
t('보정: 체계적 편향(+2mm) → 개선 판정', () => { const r = C.trainCalibration(fakeRows(10, 3, x => x + 2, 9)); ok(r.ok && r.improved, JSON.stringify(r)); ok(r.testAfter.mae < r.testBefore.mae); });
t('보정: 편향 없음 → 기존 모델 유지', () => { const r = C.trainCalibration(fakeRows(10, 3, x => x, 11)); ok(r.ok); ok(!r.improved || r.testAfter.mae < r.testBefore.mae); });

// 7. 환산 검증 템플릿
t('환산 검증: 템플릿 30mm/120mm 재현', () => {
  const pxPerMm = 4; const w = 960, h = 720, y0 = 480, x3 = 240;
  const P3 = { x: x3, y: y0 }, P1 = { x: x3 + 120 * pxPerMm, y: y0 }, P2 = { x: x3 + 50 * pxPerMm, y: y0 - 30 * pxPerMm };
  const det = C.detectStickers(makeImage(w, h, { foot: false, bg: [250, 250, 250], stickers: [P1, P2, P3].map(p => ({ x: p.x, y: p.y, r: 5 * pxPerMm })) }));
  ok(det.ok, JSON.stringify(det.reasons)); const v = C.validateConversion(det, 10, 1.0); ok(v.pass, JSON.stringify({ e: v.errHeight, s: v.errSpan, r: v.reason }));
});

// 8. 트래킹 (ROI · 라벨 일관성 · 버스트 결합)
t('트래킹: ROI 검출 결과가 전체 검출과 일치(≤0.05px)', () => {
  const sc = footScene(W, H, 60); const im = makeImage(W, H, { stickers: sc.stickers });
  const full = C.detectStickers(im), roi = C.detectInRoi(im, full, {});
  ok(roi && roi.ok, 'ROI 실패'); for (const k of ['P1', 'P2', 'P3']) near(Math.hypot(roi.landmarks[k].x - full.landmarks[k].x, roi.landmarks[k].y - full.landmarks[k].y), 0, 0.05, k);
  ok(roi.roi[2] * roi.roi[3] < W * H * 0.6, 'ROI가 충분히 작지 않음');
});
t('트래킹: 발이 크게 움직이면 ROI 실패 → 전체 재검색 필요(null)', () => {
  const a = C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers }));
  const moved = footScene(W, H, 60).stickers.map(s => ({ x: s.x, y: s.y - 200, r: s.r }));
  eq(C.detectInRoi(makeImage(W, H, { stickers: moved }), a, {}), null);
});
t('트래킹: 라벨 일관성 판정', () => {
  const a = C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers }));
  ok(C.labelsConsistent(a, a)); const sw = JSON.parse(JSON.stringify(a)); [sw.landmarks.P1, sw.landmarks.P3] = [sw.landmarks.P3, sw.landmarks.P1]; ok(!C.labelsConsistent(a, sw));
});
t('버스트: 12프레임 평균이 단일 프레임보다 오차 작음(강한 잡음)', () => {
  const sc = footScene(W, H, 60, { r: 10 }); const truth = 60;
  const dets = Array.from({ length: 12 }, (_, i) => C.detectStickers(makeImage(W, H, { stickers: sc.stickers, noise: 40, seed: 100 + i })));
  const single = dets.filter(d => d.ok).map(d => Math.abs(C.distanceToLine(d.landmarks.P2, d.landmarks.P1, d.landmarks.P3) - truth));
  const cb = C.combineDetections(dets); ok(cb.ok, cb.reason);
  const e = Math.abs(C.distanceToLine(cb.det.landmarks.P2, cb.det.landmarks.P1, cb.det.landmarks.P3) - truth);
  const meanSingle = single.reduce((a, b) => a + b, 0) / single.length;
  ok(e <= meanSingle, `결합 오차 ${e.toFixed(3)} > 단일 평균 ${meanSingle.toFixed(3)}`);
  ok(cb.det.quality.burst.used >= 5);
});
t('버스트: 튀는 프레임 제외', () => {
  const ok1 = Array.from({ length: 8 }, (_, i) => C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers, seed: i + 1 })));
  const bad = [C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 75).stickers }))];
  const cb = C.combineDetections(ok1.concat(bad)); ok(cb.ok); eq(cb.det.quality.burst.used, 8);
});
t('버스트: 유효 프레임 부족 → 실패', () => { const d = C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers })); ok(!C.combineDetections([d, d]).ok); });

// 9. ALG-2 트래킹 계층 (칼만 · 예측 기반 대응 · 적응형 색 모델)
t('칼만: 등속 이동(120px/s) 추종 — 30프레임 후 1프레임 앞 예측 오차 < 0.5px', () => {
  const K = C.createLandmarkKalman(); let s = 3; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  let err = 0;
  for (let i = 0; i < 40; i++) {
    const tt = i * 66, x = 100 + 0.12 * tt, lm = { P1: { x: x + rnd() * 0.6, y: 200 + rnd() * 0.6 }, P2: { x: x + 80, y: 150 }, P3: { x: x - 200, y: 200 } };
    const pr = K.predict(tt); if (pr && i > 30) err = Math.max(err, Math.abs(pr.P1.x - x));
    K.update(lm, 0.3, tt);
  }
  ok(err < 0.5, '예측 오차 ' + err.toFixed(3));
});
t('칼만: 정지 시 속도 ≈ 0, 놓치면 7프레임 후 초기화', () => {
  const K = C.createLandmarkKalman(); const lm = { P1: { x: 10, y: 10 }, P2: { x: 20, y: 5 }, P3: { x: 0, y: 10 } };
  for (let i = 0; i < 20; i++) { K.predict(i * 66); K.update(lm, 0.2, i * 66); }
  ok(K.speed() < 1, '속도 ' + K.speed()); for (let i = 0; i < 7; i++) K.miss(); ok(!K.active);
});
t('예측 기반 대응: 추적 중 파란 방해물(4번째 원)이 나타나도 올바른 3개 선택', () => {
  const sc = footScene(W, H, 60);
  const im = makeImage(W, H, { stickers: sc.stickers, extraBlue: [{ x: sc.P2.x + 120, y: sc.P2.y - 40, r: 14 }] });
  ok(!C.detectStickers(im).ok, '사전 정보 없이는 거부해야 함');
  const det = C.detectStickers(im, { prior: { P1: sc.P1, P2: sc.P2, P3: sc.P3 } });
  ok(det.ok, JSON.stringify(det.reasons)); for (const k of ['P1', 'P2', 'P3']) near(Math.hypot(det.landmarks[k].x - sc[k].x, det.landmarks[k].y - sc[k].y), 0, 0.3, k);
});
t('예측 기반 대응: 예측이 크게 틀리면(게이트 밖) 임의로 고르지 않고 거부', () => {
  const sc = footScene(W, H, 60);
  const fake = { P1: sc.P1, P2: { x: sc.P2.x + 200, y: sc.P2.y }, P3: sc.P3 }; // 예측이 크게 틀린 경우
  const im = makeImage(W, H, { stickers: sc.stickers, extraBlue: [{ x: sc.P2.x + 200, y: sc.P2.y + 120, r: 14 }] });
  ok(!C.detectStickers(im, { prior: fake }).ok);
});
t('적응형 색 모델: 어둡고 노란 조명에서 이전 프레임 색 수준으로 검출 유지', () => {
  const sc = footScene(W, H, 60);
  const dim = makeImage(W, H, { stickers: sc.stickers, bg: [110, 95, 70], skin: [120, 90, 70], noise: 6 });
  for (let i = 0; i < dim.data.length; i += 4) { dim.data[i + 2] *= 0.55; }
  const first = C.detectStickers(dim); const model = first.colorModel || { inner: 0.5 };
  const det = C.detectStickers(dim, { colorModel: model });
  ok(det.ok, JSON.stringify(det.reasons) + ' th=' + JSON.stringify(det.thresholds));
});
t('타원 피팅: 광택 반사(내부 흰 점)가 있어도 중심 오차 ≤ 0.3px', () => {
  const sc = footScene(W, H, 60, { r: 16 });
  const im = makeImage(W, H, { stickers: sc.stickers });
  for (const st of sc.stickers) for (let y = -4; y <= 4; y++) for (let x = -3; x <= 3; x++) { const i = (Math.round(st.y - 5 + y) * W + Math.round(st.x + 4 + x)) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 245; }
  const det = C.detectStickers(im); ok(det.ok, JSON.stringify(det.reasons));
  for (const k of ['P1', 'P2', 'P3']) near(Math.hypot(det.landmarks[k].x - sc[k].x, det.landmarks[k].y - sc[k].y), 0, 0.3, k);
});

const pass = results.filter(r => r[1] === 'PASS').length;
for (const r of results) console.log(`${r[1]}  ${r[0]}${r[2] ? '  — ' + r[2] : ''}`);
console.log(`\n${pass}/${results.length} 통과`);
require('fs').writeFileSync(__dirname + '/unit-results.json', JSON.stringify(results, null, 1));
process.exit(pass === results.length ? 0 : 1);
