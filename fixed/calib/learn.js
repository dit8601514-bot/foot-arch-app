// 고정촬영판 기본 보정 학습 보고서: node fixed/calib/learn.js
// 표본 파일(fixed/calib/samples.json)로 학습해 결과를 보여 준다. 빌드(node build.js)도 같은 학습을 해서 앱에 넣는다.
const path = require('path');
const C = require(path.join(__dirname, '..', 'src', 'core.js'));
const S = require(path.join(__dirname, 'samples.json')).samples;
const LP = C.learnPopulationCalib(S); const r = LP.line;
console.log(`사용 방식: ${LP.prefer === 'floor' ? '바닥 기준(바닥선이 잡힌 측정)' : 'P1–P3 기준선'} · 바닥 기준 표본 ${LP.calib.nFloor}개${LP.floor && LP.floor.ok ? ` → 바닥 보정 ${LP.floor.model.label}, 평균 오차 ${LP.floor.model.cvMae.toFixed(2)} mm (같은 표본의 기준선 ${LP.lineOnFloorSet.model.cvMae.toFixed(2)} mm)` : ' (5개 이상 모이면 바닥 기준도 학습·비교)'}\n[기준선 방식 보정계수]`);
if (!r.ok) { console.log(r.reason); process.exit(0); }
const m = r.model, f = v => (v == null ? '—' : v.toFixed(2));
console.log(`표본 ${m.nAll}개(학습 ${m.n}개, 이상치 ${r.outliers.length}개${r.outliers.length ? ': ' + r.outliers.join(', ') : ''}) · 참여자 ${m.participants}명 · 검증 ${r.validation}`);
console.log('방법별 평균 오차(학습에 안 쓴 자료 기준):', Object.entries(r.cv).map(([k, v]) => `${k} ${f(v.mae)} mm`).join(' · '));
console.log(`선택: ${r.chosen} → ${m.label}  (평균 오차 ${f(m.baseMae)} → ${f(m.cvMae)} mm, 90%가 ±${f(m.piMm)} mm 안)`);
if (r.warning) console.log('주의:', r.warning);
console.log('\n표본별(실측 / 앱 → 보정 후):');
for (const s of S) { const p = C.applyErrorModel(m, { ai: s.ai }); console.log(`  ${s.id} ${s.participant} ${s.foot || '-'}  실측 ${s.ref.toFixed(1)} / 앱 ${s.ai.toFixed(1)} → ${p.toFixed(1)}  (차이 ${(p - s.ref >= 0 ? '+' : '')}${(p - s.ref).toFixed(1)})${r.outliers.includes(s.id) ? '  ← 이상치(학습 제외)' : ''}`); }
