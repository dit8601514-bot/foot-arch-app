// 고정촬영판 기본 보정 학습 보고서: node fixed/calib/learn.js
// 표본 파일(fixed/calib/samples.json)로 학습해 결과를 보여 준다. 빌드(node build.js)도 같은 학습을 해서 앱에 넣는다.
const path = require('path');
const C = require(path.join(__dirname, '..', 'src', 'core.js'));
const S = require(path.join(__dirname, 'samples.json')).samples;
const LP = C.learnPopulationCalib(S); const r = LP.line;
console.log(`측정 정의: 치료사 방식 — 앉았다 일어섰을 때 P2 스티커가 아래로 움직인 거리(p2Drop)`);
console.log(`P2 이동 보정: ${LP.calib.p2.label} (P2 이동 표본 ${LP.calib.nP2}개${LP.calib.nP2 < 5 ? ', 5개 이상 모이면 남은 계통 오차 학습' : LP.p2 && LP.p2.ok ? `, 평균 오차 ${LP.p2.model.baseMae.toFixed(2)} → ${LP.p2.model.cvMae.toFixed(2)} mm` : ''})`);
console.log('[P2 이동을 못 잰 경우 대체: 기준선 방식 보정계수]');
if (!r.ok) { console.log(r.reason); process.exit(0); }
const m = r.model, f = v => (v == null ? '—' : v.toFixed(2));
console.log(`표본 ${m.nAll}개(학습 ${m.n}개, 이상치 ${r.outliers.length}개${r.outliers.length ? ': ' + r.outliers.join(', ') : ''}) · 참여자 ${m.participants}명 · 검증 ${r.validation}`);
console.log('방법별 평균 오차(학습에 안 쓴 자료 기준):', Object.entries(r.cv).map(([k, v]) => `${k} ${f(v.mae)} mm`).join(' · '));
console.log(`선택: ${r.chosen} → ${m.label}  (평균 오차 ${f(m.baseMae)} → ${f(m.cvMae)} mm, 90%가 ±${f(m.piMm)} mm 안)`);
if (r.warning) console.log('주의:', r.warning);
console.log('\n표본별(실측 / 앱 → 보정 후):');
for (const s of S) { const p = C.applyErrorModel(m, { ai: s.ai }); console.log(`  ${s.id} ${s.participant} ${s.foot || '-'}  실측 ${s.ref.toFixed(1)} / 앱 ${s.ai.toFixed(1)} → ${p.toFixed(1)}  (차이 ${(p - s.ref >= 0 ? '+' : '')}${(p - s.ref).toFixed(1)})${r.outliers.includes(s.id) ? '  ← 이상치(학습 제외)' : ''}`); }
