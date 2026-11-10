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

// 7) 빌드 결과에 학습 모델이 들어갔는지
{ const d = path.join(__dirname, '..', '..', 'dist', 'fixed');
  if (fs.existsSync(path.join(d, 'index.html'))) {
    const h = fs.readFileSync(path.join(d, 'index.html'), 'utf8'), a = fs.readFileSync(path.join(d, 'admin', 'index.html'), 'utf8');
    ok('빌드: 앱에 학습 모델', /const BUILTIN_MODEL = \{"id":"seed-/.test(h));
    ok('빌드: 관리자에 표본', a.includes('const SEED_SAMPLES = [{"id":"S01"'));
  } else console.log('(dist 없음 — node build.js 후 빌드 확인)'); }

console.log(`\n${pass}/${pass + fail} 통과`); if (fail) process.exit(1);
