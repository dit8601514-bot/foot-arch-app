// 기본 보정 학습 시험: node fixed/calib/test.js
const path = require('path'), fs = require('fs');
const C = require(path.join(__dirname, '..', 'src', 'core.js'));
const S = require(path.join(__dirname, 'samples.json')).samples;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra != null ? ' — ' + extra : ''}`); };
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) * Math.SQRT2; };

// 1) 사용자 표본: 더하기 보정, 약 +4.2 mm, 같은 사람 안에서만 검증됐다는 경고
{ const r = C.learnSeedCorrection(S);
  ok('사용자 표본 → 더하기 보정', r.ok && r.chosen === 'bias', r.model && r.model.label);
  ok('보정량 +3.8~+4.6 mm', -r.model.bias > 3.8 && -r.model.bias < 4.6, (-r.model.bias).toFixed(2));
  ok('보정 없음보다 평균 오차 50% 이상 감소', r.model.cvMae < r.model.baseMae * 0.5, `${r.model.baseMae.toFixed(2)} → ${r.model.cvMae.toFixed(2)}`);
  ok('1명 표본 경고', !!r.warning && r.validation === 'LOO'); }

// 2) 이상치 하나(차이 +20)는 학습에서 빠지고 보정이 거의 그대로
{ const r0 = C.learnSeedCorrection(S), r = C.learnSeedCorrection(S.concat([{ id: 'X', participant: 'U01', ai: 2, ref: 22 }]));
  ok('이상치 감지·제외', r.outliers.includes('X') && Math.abs(r.model.bias - r0.model.bias) < 0.3, r.model.label); }

// 3) 사람 단위 공정성: 10명은 +3 mm, 한 사람이 표본 30개로 +8 mm → 결과는 +3 쪽
{ const rows = [];
  for (let p = 0; p < 10; p++) { const pb = 3 + 0.4 * gauss(); for (let i = 0; i < 3; i++) { const ai = 2 + 6 * rnd(); rows.push({ participant: 'A' + p, ai, ref: ai + pb + 0.5 * gauss() }); } }
  for (let i = 0; i < 30; i++) { const ai = 2 + 6 * rnd(); rows.push({ participant: 'BIG', ai, ref: ai + 8 + 0.5 * gauss() }); }
  const r = C.learnSeedCorrection(rows);
  ok('한 사람이 많이 보내도 전체를 끌지 못함', r.chosen === 'bias' && -r.model.bias > 2.4 && -r.model.bias < 4.0, r.model.label);
  ok('여러 사람이면 한 사람씩 빼는 검증(LOPO)', r.validation === 'LOPO' && !r.warning); }

// 4) 계통 오차가 없으면(흔들림만) 보정하지 않음
{ const rows = []; for (let p = 0; p < 8; p++) for (let i = 0; i < 3; i++) { const t = 3 + 7 * rnd(); rows.push({ participant: 'N' + p, ai: t + 1.2 * gauss(), ref: t }); }
  const r = C.learnSeedCorrection(rows); ok('계통 오차 없음 → 보정 없음', r.chosen === 'identity', r.model.label); }

// 5) 실제로 비율 오차(실측 = 앱 × 2)가 넓은 범위에서 뚜렷하면 선형 선택
{ const rows = []; for (let p = 0; p < 10; p++) for (let i = 0; i < 3; i++) { const ai = 1 + 7 * rnd(); rows.push({ participant: 'L' + p, ai, ref: 2 * ai + 0.3 * gauss() }); }
  const r = C.learnSeedCorrection(rows); ok('비율 오차 → 선형', r.chosen === 'linear' && r.model.slope > 1.6, r.model.label); }

// 6) 표본 부족
ok('표본 1개 → 학습 안 함', C.learnSeedCorrection([{ ai: 3, ref: 7 }]).ok === false);

// 7) 측정 정의 = 치료사 방식(앉음→섬 P2 이동). P2 이동이 있으면 그 값(표본 적으면 보정 없음), 없으면 기준선+계수
{ const L0 = C.learnPopulationCalib(S); const P0 = Object.assign({ id: 't' }, L0.calib);
  ok('기본 = P2 이동(치료사 방식), 표본 부족 시 보정 없음', L0.prefer === 'p2' && L0.calib.p2.method === 'identity');
  const a = C.populationCorrect({ p2Mm: 8.3, lineMm: 4 }, P0), b = C.populationCorrect({ p2Mm: null, lineMm: 3.6 }, P0);
  ok('P2 이동 있음 → 그대로', a && a.method === 'p2' && Math.abs(a.mm - 8.3) < 1e-9, a && a.mm.toFixed(1));
  ok('P2 이동 없음 → 기준선 + 공통 계수 추정', b && b.method === 'line' && b.mm > 7.4 && b.mm < 8.2, b && b.mm.toFixed(1));
  const rows = []; for (let p = 0; p < 8; p++) for (let i = 0; i < 2; i++) { const ref = 5 + 6 * rnd(); rows.push({ participant: 'F' + p, ref, ai: ref - 4 + 0.4 * gauss(), p2Drop: ref - 1.5 + 0.3 * gauss() }); }
  const L = C.learnPopulationCalib(rows), c2 = C.populationCorrect({ p2Mm: 6, lineMm: 3 }, Object.assign({ id: 't' }, L.calib));
  ok('P2 이동에 계통 오차가 있으면 표본으로 학습해 보정', L.calib.p2.method === 'bias' && c2.method === 'p2' && Math.abs(c2.mm - 7.5) < 0.6, `${L.calib.p2.label} → ${c2.mm.toFixed(1)}`); }

// 7-2) P2 이동 계산: 앉음 P1(100,300) P3(500,300) P2(300,260) → 섬 P2(300,268): 8 px 아래, 1 px = 1 mm
{ const pre = { pts: { P1: { x: 100, y: 300 }, P2: { x: 300, y: 260 }, P3: { x: 500, y: 300 } } }, post = { pts: { P1: { x: 102, y: 300 }, P2: { x: 300, y: 268 }, P3: { x: 500, y: 300.5 } } };
  const r = C.p2Movement(pre, post, 1); ok('P2 이동 = 8 mm', r && Math.abs(r.dropMm - 8) < 1e-6 && Math.abs(r.p3MoveMm - 0.5) < 1e-6, r && r.dropMm);
  const rot = (p, a) => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }), R = o => ({ pts: Object.fromEntries(Object.entries(o.pts).map(([k, v]) => [k, rot(v, 10 * Math.PI / 180)])) });
  const r2 = C.p2Movement(R(pre), R(post), 1); ok('휴대폰 10° 기울어도 같은 값', Math.abs(r2.dropMm - 8) < 1e-6, r2.dropMm.toFixed(3));
  const sole = (y) => ({ slope: 0, intercept: y });
  const pre2 = Object.assign({}, pre, { floor: { ok: true, sole: sole(330) } }), post2 = { pts: { P1: { x: 102, y: 297 }, P2: { x: 300, y: 265 }, P3: { x: 500, y: 297.5 } }, floor: { ok: true, sole: sole(327) } };
  const r3 = C.p2Movement(pre2, post2, 1); ok('카메라 흔들림(바닥선 이동) 보정', Math.abs(r3.dropMm - 8) < 1e-6 && r3.floorCompensated, `${r3.rawMoveMm.toFixed(1)} → ${r3.dropMm.toFixed(1)}`); }

// 7-3) P2 이동만 있는 표본(ai: null)은 기준선 학습에 0으로 섞이지 않음
{ const L = C.learnPopulationCalib(S); ok('ai: null 표본은 기준선 학습에서 제외', L.line.model.nAll === S.filter(x => Number.isFinite(x.ai)).length, `${L.line.model.nAll}개`); }

// 8) 측정 알고리즘 안에서 적용: 같은 입력이면 누구에게나 같은 값(개인 기록과 무관)
{ const P = Object.assign({ id: 't' }, C.learnPopulationCalib(S).calib);
  const v1 = C.populationCorrect({ lineMm: 3.6, floorMm: null }, P).mm, v2 = C.populationCorrect({ lineMm: 3.6, floorMm: null }, P).mm;
  ok('공통 보정: 3.6 mm → 약 7.8 mm, 사람과 무관하게 동일', Math.abs(v1 - v2) < 1e-9 && v1 > 7.4 && v1 < 8.2, v1.toFixed(2));
  const ex = [{ id: 'a', foot: 'right', createdAt: 1, comparison: { changeMm: 5, status: '측정 가능' }, reference: { ndtMm: 9 } }, { id: 'b', foot: 'right', createdAt: 2e6, comparison: { changeMm: 5, status: '측정 가능' } }];
  const pc = C.personalCare(ex, {}); ok('개인별 오차 보정 없음', pc.biasMm === 0 && pc.personalMm(ex[1]) === 5); }

// 9) 빌드 결과에 학습 모델이 들어갔는지
{ const d = path.join(__dirname, '..', '..', 'dist', 'fixed');
  if (fs.existsSync(path.join(d, 'index.html'))) {
    const h = fs.readFileSync(path.join(d, 'index.html'), 'utf8');
    ok('빌드: 측정 엔진에 공통 보정계수', /const POP_CALIB = \{"id":"C\d+-/.test(h) && h.includes('const BUILTIN_MODEL = null'));
    ok('빌드: 관리자 앱 없음', !fs.existsSync(path.join(d, 'admin')));
  } else console.log('(dist 없음 — node build.js 후 빌드 확인)'); }

console.log(`\n${pass}/${pass + fail} 통과`); if (fail) process.exit(1);
