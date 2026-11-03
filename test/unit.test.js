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
t('합성: 발가락 방향을 반대로 지정해도 자동 인지로 P1·P3를 바르게 지정', () => {
  const sc = footScene(W, H, 60, { toe: 'right' });
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }), { toeDirection: 'left' });
  ok(det.ok && det.landmarks.toeDirection === 'right' && det.landmarks.P1.x > det.landmarks.P3.x, JSON.stringify(det.reasons));
});
t('합성: 방향 고정(strictToe)으로 반대 지정하면 불확실로 재촬영', () => {
  const sc = footScene(W, H, 60, { toe: 'right' });
  const det = C.detectStickers(makeImage(W, H, { stickers: sc.stickers }), { toeDirection: 'left', strictToe: true });
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
  const sc = footScene(W, H, 60); const st = sc.stickers.map(s => ({ x: s.x, y: s.y, r: 14, rx: 14, ry: 9.5 }));
  const det = C.detectStickers(makeImage(W, H, { stickers: st })); ok(det.ok, JSON.stringify(det.reasons)); eq(C.measureImage(det, conv).status, '보정 필요');
});
t('mm 환산: 발 곡면에서 약간 타원(단축/장축 0.82)은 그대로 측정', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.map(s => ({ x: s.x, y: s.y, r: 14, rx: 14, ry: 11.5 }));
  const det = C.detectStickers(makeImage(W, H, { stickers: st })); ok(det.ok, JSON.stringify(det.reasons)); ok(C.measureImage(det, conv).status !== '보정 필요', C.measureImage(det, conv).status);
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

// 10. 정밀 정렬 · 체중부하 형태 근거
t('정렬: 중앙·적정 크기·수평이면 통과', () => { const d = C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers })); ok(C.alignmentCheck(d, 'right').ok, JSON.stringify(C.alignmentCheck(d, 'right'))); });
t('정렬: 발이 화면 왼쪽에 치우침 → 발가락 오른쪽이면 "앞으로" 안내', () => {
  const sc = footScene(W, H, 60); const st = sc.stickers.map(s => ({ x: s.x - 120, y: s.y, r: s.r }));
  const a = C.alignmentCheck(C.detectStickers(makeImage(W, H, { stickers: st })), 'right'); ok(!a.ok && a.code === 'SHIFT_RIGHT' && a.msg.includes('앞으로'), JSON.stringify(a));
});
t('정렬: 같은 치우침이라도 발가락이 왼쪽이면 "뒤로" 안내', () => {
  const sc = footScene(W, H, 60, { toe: 'left' }); const st = sc.stickers.map(s => ({ x: s.x - 150, y: s.y, r: s.r }));
  const a = C.alignmentCheck(C.detectStickers(makeImage(W, H, { stickers: st }), { toeDirection: 'left' }), 'left'); ok(!a.ok && a.msg.includes('뒤로'), JSON.stringify(a));
});
t('정렬: 너무 작게 보이면 "가까이"', () => { const sc = footScene(W, H, 40, { span: 0.38 }); const a = C.alignmentCheck(C.detectStickers(makeImage(W, H, { stickers: sc.stickers })), 'right'); ok(a.code === 'FAR', JSON.stringify(a)); });
t('체중부하 근거: P2 높이 감소(지름 0.7배) → 확인', () => {
  const pre = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 80).stickers })));
  const post = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 60).stickers })));
  const e = C.loadEvidence(pre, post); ok(e.confirmed && e.by === 'drop', JSON.stringify(e));
});
t('체중부하 근거: 변화 없음 → 미확인', () => {
  const a = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70).stickers, seed: 1 })));
  const b = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70).stickers, seed: 2 })));
  ok(!C.loadEvidence(a, b).confirmed, JSON.stringify(C.loadEvidence(a, b)));
});
t('체중부하 근거: 발 길이 1% 증가(아치 변화 없음) → 확인', () => {
  const a = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70).stickers })));
  const b = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70, { span: 0.62 * 1.01 }).stickers })));
  const e = C.loadEvidence(a, b); ok(e.confirmed && e.by === 'span', JSON.stringify(e));
});
t('체중부하 근거: 거리(축척)만 달라지면 미확인(지름 정규화)', () => {
  const a = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70).stickers })));
  const b = C.shapeOf(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 70 * 1.1, { span: 0.62 * 1.1, r: 14 * 1.1 }).stickers })));
  ok(!C.loadEvidence(a, b).confirmed, JSON.stringify(C.loadEvidence(a, b)));
});

// 11. 표준 가이드 · 바닥선 · 바닥 기준 측정
function guideScene(Wg, Hg, opts) {
  const o = Object.assign({ toe: 'right', dx: 0, dy: 0, p2t: 0.42, p2Cm: 3.6, scaleMul: 1 }, opts);
  const g = C.guideGeometry(Wg, Hg, o.toe); const sc = g.scale * o.scaleMul;
  const sgn = o.toe === 'left' ? -1 : 1, base = { x: g.P3.x + o.dx, y: g.floorY - 2 * sc + o.dy };
  const P3 = base, P1 = { x: base.x + sgn * 14.5 * sc, y: base.y }, P2 = { x: base.x + sgn * 14.5 * sc * o.p2t, y: g.floorY + o.dy - o.p2Cm * sc };
  const r = 0.5 * sc; // 지름 1 cm 스티커
  return { P1, P2, P3, r, soleY: g.floorY + o.dy, sc, x0: Math.min(P3.x, P1.x) - 5 * sc, x1: Math.max(P3.x, P1.x) + 6 * sc, stickers: [P1, P2, P3].map(p => ({ x: p.x, y: p.y, r })) };
}
const GW = 1280, GH = 720;
const gimg = (sc, extra) => makeImage(GW, GH, Object.assign({ stickers: sc.stickers, soleY: sc.soleY, footX0: sc.x0, footX1: sc.x1, noise: 4 }, extra));
t('가이드: 표준 배치 그대로면 목표 원 정렬 통과', () => { const sc = guideScene(GW, GH); const d = C.detectStickers(gimg(sc)); ok(d.ok, JSON.stringify(d.reasons)); const a = C.guideCheck(d, 'right'); ok(a.ok, JSON.stringify(a)); });
t('가이드: 발가락 왼쪽(오른발)도 대칭 배치 통과', () => { const sc = guideScene(GW, GH, { toe: 'left' }); const d = C.detectStickers(gimg(sc), { toeDirection: 'left' }); ok(d.ok, JSON.stringify(d.reasons)); ok(C.guideCheck(d, 'left').ok); });
t('가이드: 발이 뒤로 치우치면 "앞으로" 코칭', () => { const sc = guideScene(GW, GH, { dx: -110 }); const a = C.guideCheck(C.detectStickers(gimg(sc)), 'right', { mode: 'fixed' }); ok(!a.ok && a.msg.includes('앞으로'), JSON.stringify(a)); });
t('가이드: 너무 멀면(작게 보임) "가까이" 코칭', () => { const sc = guideScene(GW, GH, { scaleMul: 0.8 }); const a = C.guideCheck(C.detectStickers(gimg(sc)), 'right', { mode: 'fixed' }); ok(!a.ok && a.code === 'FAR', JSON.stringify(a)); });
t('흔들림 구분: 세 점이 함께 이동·회전(휴대폰 흔들림)하면 형태 변화 ≈0, 발배뼈가 내려가면 큼', () => {
  const mk = (P1, P2, P3) => ({ landmarks: { P1, P2, P3 }, quality: { diameterPx: 20 } });
  const a = mk({ x: 400, y: 300 }, { x: 250, y: 240 }, { x: 100, y: 300 });
  const th = 0.03, R = p => ({ x: 512 + (p.x - 250) * Math.cos(th) - (p.y - 280) * Math.sin(th) + 9, y: 280 + (p.x - 250) * Math.sin(th) + (p.y - 280) * Math.cos(th) - 7 });
  const moved = mk(R(a.landmarks.P1), R(a.landmarks.P2), R(a.landmarks.P3));
  ok(C.shapeDelta(a, moved) < 0.02, 'rigid ' + C.shapeDelta(a, moved));
  const drop = mk({ x: 400, y: 300 }, { x: 250, y: 246 }, { x: 100, y: 300 });
  ok(C.shapeDelta(a, drop) > 0.25, 'drop ' + C.shapeDelta(a, drop));
});
t('연속 촬영 결합: 프레임마다 영상이 흔들려도 바닥선 높이는 그대로', () => {
  const fr = (dx, dy) => ({ ok: true, landmarks: { P1: { x: 400 + dx, y: 300 + dy }, P2: { x: 250 + dx, y: 240 + dy }, P3: { x: 100 + dx, y: 300 + dy }, axisAngleDeg: 0 }, quality: { sharp: true, diameterPx: 20, fitRmsPx: 0.2, sizeCv: 0.01, minAxisRatio: 0.98 }, sole: { ok: true, slope: 0, intercept: 340 + dy, rms: 0.3 }, confidence: 0.9, detectionConfidence: 0.9 });
  const dets = [[0, 0], [6, -5], [-7, 4], [3, 8], [-4, -6], [8, 2], [-2, 7]].map(([x, y]) => fr(x, y));
  const cb = C.combineDetections(dets, 5); ok(cb.ok);
  const L = cb.det.landmarks, mid = (L.P1.y + L.P3.y) / 2, soleY = cb.det.sole.slope * ((L.P1.x + L.P3.x) / 2) + cb.det.sole.intercept;
  ok(Math.abs(soleY - mid - 40) < 1e-9 && cb.det.sole.sdPx < 1e-9, (soleY - mid) + ' sd ' + cb.det.sole.sdPx);
});
// 12. AI 오차 보정(앱 NDT → 임상 NDT)
function synthPairs(nP, gen, seed) {
  let a = seed || 7; const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; // mulberry32
  const g = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
  const rows = [];
  for (let p = 0; p < nP; p++) for (let k = 0; k < 2; k++) {
    const ref = 4 + 10 * rnd(), tilt = 6 * rnd(), dia = 18 + 14 * rnd();
    rows.push(Object.assign({ participantId: 'P' + p, ref }, { f: gen(ref, tilt, dia, g) }));
  }
  return rows;
}
t('AI 보정: 앱이 체계적으로 틀리면(과대 추정 + 기울기 영향) 교차검증 오차가 크게 줄고 배포 권고', () => {
  const rows = synthPairs(24, (ref, tilt, dia, g) => ({ ai: ref * 1.18 + 0.35 * tilt - 0.8 + 0.35 * g(), floorDrop: ref * 1.05 + 0.5 * g(), tilt, diaPx: dia, preFloor: 40 + 2 * g(), angleChange: 8 + 2 * g(), spanGain: 1 + 0.5 * g(), sizeCv: 2 + g() * 0.5, placeErr: Math.abs(g()) }), 11);
  const r = C.trainErrorModel(rows);
  ok(r.ok && r.improved, JSON.stringify(r.recommendation));
  ok(r.cv[r.chosen].mae < r.cv.identity.mae * 0.5, `MAE ${r.cv.identity.mae.toFixed(2)} → ${r.cv[r.chosen].mae.toFixed(2)}`);
  ok(r.model.piMm > 0 && r.model.n === 48 && r.model.participants === 24);
  const f = rows[0].f, y = C.applyErrorModel(r.model, f); ok(isFinite(y) && Math.abs(y - rows[0].ref) < 2.5, y + ' vs ' + rows[0].ref);
});
t('AI 보정: 앱이 이미 정확하면(순수 잡음) 보정하지 않음을 권고', () => {
  const rows = synthPairs(20, (ref, tilt, dia, g) => ({ ai: ref + 0.5 * g(), tilt, diaPx: dia, preFloor: 40 + 2 * g() }), 5);
  const r = C.trainErrorModel(rows); ok(r.ok && !r.improved && r.model.method === 'identity', r.chosen + ' ' + r.recommendation);
});
t('AI 보정: 자료가 부족하면 학습하지 않고 이유를 알림', () => {
  const rows = synthPairs(5, (ref) => ({ ai: ref }), 3); const r = C.trainErrorModel(rows); ok(!r.ok && r.reason.includes('부족'), r.reason);
});
t('AI 보정: 검사 기록에서 특징 추출(없는 값은 null)', () => {
  const f = C.errorFeatures({ comparison: { changeMm: 8, floor: { dropMm: 8.1, preMm: 42 }, archAngle: { change: 12.1 } }, pre: { measure: { axisAngleDeg: -1.5, floor: { placement: [{ mm: 21 }, { mm: 19 }] } }, quality: { diameterPx: 24, sizeCv: 0.02 } }, loadRecognition: { final: { spanGain: 0.013 } } });
  ok(f.ai === 8 && f.floorDrop === 8.1 && f.tilt === 1.5 && Math.abs(f.spanGain - 1.3) < 1e-9 && f.placeErr === 1 && Math.abs(f.sizeCv - 2) < 1e-9);
  ok(C.errorFeatures({ comparison: { changeMm: null } }) === null);
});
t('적응형 가이드: 거리가 달라도(0.8배·1배) 발 전체가 보이면 통과', () => { for (const m of [0.8, 1.0]) { const sc = guideScene(GW, GH, { scaleMul: m }); const a = C.guideCheck(C.detectStickers(gimg(sc)), 'right'); ok(a.ok && a.adaptive, m + ' ' + a.msg); } });
t('적응형 가이드: 가까이 찍어 뒤꿈치가 화면 밖이어도 스티커 3개가 보이면 촬영 가능', () => { const sc = guideScene(GW, GH, { dx: -150 }); const a = C.guideCheck(C.detectStickers(gimg(sc)), 'right'); ok(a.ok, a.code + ' ' + a.msg); });
t('적응형 가이드: 거리는 촬영을 막지 않음(작게 보이면 참고 안내만)', () => { const sc = guideScene(GW, GH, { scaleMul: 0.5 }); const d = C.detectStickers(gimg(sc)), a = C.guideCheck(d, 'right'); ok(a.ok || a.code !== 'FAR', a.code); });
t('스티커 색: 파란 기운만 있는 원(청록·보라)은 스티커로 보지 않음', () => {
  const sc = footScene(W, H, 60), st = sc.stickers.map((s, i) => Object.assign({}, s, i === 1 ? { color: [120, 40, 200] } : {}));
  const det = C.detectStickers(makeImage(W, H, { stickers: st })); ok(!det.ok && det.rejected.some(r => (r.reject || []).includes('스티커 색이 아님')), JSON.stringify(det.reasons));
});
t('적응형 가이드: 표준 발 모델을 실제 P3·P1에 정확히 맞춤', () => { const L = { P3: { x: 100, y: 300 }, P1: { x: 390, y: 300 }, P2: { x: 230, y: 250 } }; const F = C.fitFootModel(L, 'right'); ok(Math.abs(F.scale - 20) < 1e-9 && Math.abs(F.X(4, 2).x - 100) < 1e-9 && Math.abs(F.X(4, 2).y - 300) < 1e-9 && Math.abs(F.X(4, 0).y - 340) < 1e-9 && Math.abs(F.X(0, 2).x - 20) < 1e-9); const G = C.fitFootModel({ P3: { x: 390, y: 300 }, P1: { x: 100, y: 300 } }, 'left'); ok(Math.abs(G.X(4, 0).y - 340) < 1e-9 && Math.abs(G.X(0, 2).x - 470) < 1e-9); });
t('가이드: 가운데 스티커가 너무 낮으면 발배뼈 위치 확인 안내', () => { const sc = guideScene(GW, GH, { p2Cm: 1.2 }); const d = C.detectStickers(gimg(sc)); const a = C.guideCheck(d, 'right'); ok(!a.ok && a.code === 'P2_ZONE', JSON.stringify(a)); });
t('바닥선: 평평한 발바닥 경계 검출, P2 바닥 높이 오차 ≤ 0.3px', () => {
  const sc = guideScene(GW, GH); const d = C.detectStickers(gimg(sc)); ok(d.sole && d.sole.ok, JSON.stringify(d.sole));
  near(C.heightAboveSole(d.landmarks.P2, d.sole), sc.soleY - 0.5 - sc.P2.y, 0.3, 'P2 바닥 높이');
});
t('바닥선: 바닥과 피부색이 같으면 검출 거부(오검출 방지)', () => { const sc = guideScene(GW, GH); const d = C.detectStickers(gimg(sc, { bg: [222, 178, 150] })); ok(!d.sole.ok, JSON.stringify(d.sole)); });
t('바닥 기준 측정: 표준 부착(20mm)이면 부착 높이 점검 통과, 36mm면 안내', () => {
  const conv = { stickerDiameterMm: 10, validated: true };
  const sc = guideScene(GW, GH); const m = C.measureImage(C.detectStickers(gimg(sc)), conv);
  ok(m.floor.ok && m.floor.placement.every(p => p.ok), JSON.stringify(m.floor)); near(m.floor.P3Mm, 20, 0.6, 'P3 높이 mm');
  const hi = guideScene(GW, GH, { dy: 0 }); const st = hi.stickers.map((p, i) => i === 2 ? { x: p.x, y: p.y - 1.6 * hi.sc, r: p.r } : p);
  const m2 = C.measureImage(C.detectStickers(makeImage(GW, GH, { stickers: st, soleY: hi.soleY, footX0: hi.x0, footX1: hi.x1, noise: 4 })), conv);
  ok(m2.floor.ok && m2.floor.placementNotes.length === 1 && m2.floor.placementNotes[0].includes('P3'), JSON.stringify(m2.floor));
});
t('바닥 기준 하강: 전·후 차이 계산 + 분류 기준을 바닥 방식으로 바꿀 수 있음', () => {
  const conv = { stickerDiameterMm: 10, validated: true };
  const A = guideScene(GW, GH, { p2Cm: 4.2 }), B = guideScene(GW, GH, { p2Cm: 3.4 });
  const ma = C.measureImage(C.detectStickers(gimg(A)), conv), mb = C.measureImage(C.detectStickers(gimg(B)), conv);
  ma.imageSize = mb.imageSize = [GW, GH];
  const r = C.comparePrePost(ma, mb, conv); ok(r.floor, JSON.stringify(r)); near(r.floor.dropMm, 8, 0.4, '바닥 기준 하강');
  const r2 = C.comparePrePost(ma, mb, Object.assign({ primaryMeasure: 'floor' }, conv)); eq(r2.primary, 'floor'); near(r2.changeMm, 8, 0.4);
});

t('아치 각도: 직각 배치 = 90°, 일직선 = 180°', () => { near(C.archAngle({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }), 90, 1e-9); near(C.archAngle({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: -10, y: 0 }), 180, 1e-9); });
// ── AI 1:1 맞춤 케어 ──
{
  const DAY = 86400000, t0 = Date.UTC(2026, 0, 1);
  const mk = (i, f, v, o) => Object.assign({ id: 'c' + i + f, foot: f, createdAt: t0 + i * DAY, comparison: { changeMm: v, scaleDiff: 0.005 }, measurementConfidence: 0.85, pre: { quality: { sharp: true }, measure: { axisAngleDeg: 2 } }, post: { quality: { sharp: true } } }, o || {});
  t('맞춤 케어: 반복 측정으로 내 측정 흔들림(σ)을 학습', () => {
    // 실제 6 mm, 매일 ±0.5 mm 정도 흔들림 → σ가 기본값(1.4)보다 작아져야 함
    const ex = [6.2, 5.7, 6.4, 5.9, 6.1, 5.8, 6.3, 6.0, 5.9, 6.2].map((v, i) => mk(i, 'left', v));
    const r = C.personalCare(ex); ok(r.nPairs === 9 && r.sdMm < 1.0 && r.sdMm > 0.2, 'σ=' + r.sdMm.toFixed(2));
    near(r.feet.left.estimateMm, 6.05, 0.5, '개인 추정');
  });
  t('맞춤 케어: 전문가 값으로 내 편향을 수축 학습(적으면 조심스럽게)', () => {
    const ex = [mk(0, 'left', 5, { reference: { ndtMm: 7 } })];
    const one = C.personalCare(ex).biasMm; ok(one > 1.0 && one < 2.0, '1회: ' + one.toFixed(2));
    const many = C.personalCare([0, 1, 2, 3, 4].map(i => mk(i * 10, 'left', 5, { reference: { ndtMm: 7 } }))).biasMm; ok(many > one && many < 2.0, '5회: ' + many.toFixed(2));
  });
  t('맞춤 케어: 평소와 크게 다른 측정은 이상치로 표시하고 적게 반영', () => {
    const ex = [6, 6.3, 5.8, 6.1, 13].map((v, i) => mk(i, 'left', v));
    const r = C.personalCare(ex), F = r.feet.left; ok(F.lastOutlier && F.estimateMm < 8, JSON.stringify({ est: F.estimateMm, z: F.lastZ }));
    ok(r.plan.actions.some(a => a.kind === 'retake'), '다시 찍기 권고');
  });
  t('맞춤 케어: 품질 낮은 측정(흐림·휴대폰 움직임)은 가중치가 낮음', () => {
    const good = C.measurementWeight(mk(0, 'left', 6)), bad = C.measurementWeight(mk(0, 'left', 6, { measurementConfidence: 0.5, comparison: { changeMm: 6, scaleDiff: 0.04 }, pre: { quality: { sharp: false }, measure: {} }, post: { quality: { sharp: true } } }));
    ok(good > 0.8 && bad < 0.4, good.toFixed(2) + ' / ' + bad.toFixed(2));
  });
  t('맞춤 케어: 분류·통증에 따라 관리 계획(운동 강도·다음 검사일)이 달라짐', () => {
    const n = C.personalCare([mk(0, 'left', 3)]).plan, m = C.personalCare([mk(0, 'left', 12)]).plan, p = C.personalCare([mk(0, 'left', 7)], { selfReport: { pain: true } }).plan;
    ok(n.level === 'keep' && n.nextTestDays === 28, n.level); ok(m.level === 'intense' && m.nextTestDays === 7 && m.actions.some(a => a.kind === 'consult'), m.level); ok(p.level === 'consult', p.level);
  });
  t('맞춤 케어: 실측 전·후 높이로 자세별 오차를 배워 다음 측정을 보정(사용자 실제 사례)', () => {
    // 앱 33.5→27.8 mm(하강 5.7) / 실측 34→24 mm(하강 10): 선 자세에서 앱이 높게 잼
    const e1 = mk(0, 'left', 5.7, { comparison: { changeMm: 5.7, preMm: 33.5, postMm: 27.8, scaleDiff: 0.005 }, reference: { ndtMm: 10, preMm: 34, postMm: 24 } });
    const e2 = mk(5, 'left', 5.5, { comparison: { changeMm: 5.5, preMm: 33.0, postMm: 27.5, scaleDiff: 0.005 } });
    const r = C.personalCare([e1, e2]), c = r.heightCalib.line;
    ok(c && c.n === 1 && c.bPre > 0.3 && c.bPre < 0.5 && c.bPost < -3 && c.bPost > -3.8, JSON.stringify(c));
    const p2 = r.personalMm(e2); ok(p2 > 8.5 && p2 < 10, '다음 측정 보정 ' + p2.toFixed(2));
    // 실측이 쌓일수록 차이를 더 믿는다
    const many = [0, 1, 2, 3].map(i => mk(i * 7, 'left', 5.7, { comparison: { changeMm: 5.7, preMm: 33.5, postMm: 27.8, scaleDiff: 0.005 }, reference: { ndtMm: 10, preMm: 34, postMm: 24 } }));
    ok(C.personalCare(many).heightCalib.line.bPost < c.bPost, '4회 학습이 더 강함');
  });
  t('맞춤 케어: 좌우 차이가 측정 흔들림보다 크면 약한 발에 운동 추가', () => {
    const r = C.personalCare([mk(0, 'left', 11), mk(0, 'right', 3)]); ok(r.asymReal && r.plan.actions.some(a => a.kind === 'asym' && a.text.includes('왼발')), JSON.stringify(r.plan.actions));
  });
}
t('아치 각도: 체중부하로 P2가 내려가면 각도 증가', () => {
  const conv = { stickerDiameterMm: 10, validated: true };
  const a = C.measureImage(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 84).stickers })), conv), b = C.measureImage(C.detectStickers(makeImage(W, H, { stickers: footScene(W, H, 56).stickers })), conv);
  a.imageSize = b.imageSize = [W, H]; const r = C.comparePrePost(a, b, conv); ok(r.archAngle && r.archAngle.change > 0, JSON.stringify(r.archAngle));
});

const pass = results.filter(r => r[1] === 'PASS').length;
for (const r of results) console.log(`${r[1]}  ${r[0]}${r[2] ? '  — ' + r[2] : ''}`);
console.log(`\n${pass}/${results.length} 통과`);
require('fs').writeFileSync(__dirname + '/unit-results.json', JSON.stringify(results, null, 1));
process.exit(pass === results.length ? 0 : 1);
