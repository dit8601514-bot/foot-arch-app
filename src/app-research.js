'use strict';
/* ═════════════ 연구자 · 관리자 화면 ═════════════ */
const R = { researcher: true };
route('/r/login', '연구자 인증', async (v, p) => {
  const next = p.q.next || '/r/home';
  const isNew = !S.settings.researcherPinHash;
  v.innerHTML = `<h2>연구자·관리자 모드</h2>
    <div class="note info small">연구 데이터와 관리 기능은 PIN으로 보호됩니다. 이 보호는 이 기기 안에서만 동작하는 간이 접근 제어이며, 기기 자체에 접근할 수 있는 사람으로부터 데이터를 완전히 보호하지는 못합니다.</div>
    <div class="card">${isNew ? `<label class="f" for="p1">새 PIN (숫자 4~8자리)</label><input id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"><label class="f" for="p2">PIN 확인</label><input id="p2" type="password" inputmode="numeric" maxlength="8">`
      : `<label class="f" for="p1">PIN</label><input id="p1" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password">`}
    <button class="btn primary block" id="go" style="margin-top:12px">${isNew ? 'PIN 설정 후 들어가기' : '들어가기'}</button></div>`;
  $('#go', v).onclick = async () => {
    const a = $('#p1', v).value;
    if (!/^\d{4,8}$/.test(a)) return toast('PIN은 숫자 4~8자리입니다.', true);
    if (isNew) { if (a !== $('#p2', v).value) return toast('PIN이 일치하지 않습니다.', true); S.settings.researcherPinHash = await sha256('foot:' + a); if (!await saveSettings()) return; }
    else if (await sha256('foot:' + a) !== S.settings.researcherPinHash) return toast('PIN이 올바르지 않습니다.', true);
    S.researcherUnlocked = true; go('#' + next);
  };
});

route('/r/home', '연구자·관리자', async (v) => {
  const [errs, models, exams] = [await DB.all('errors'), await DB.all('models'), await DB.all('exams')];
  const cv = convSettings();
  v.innerHTML = `<h2>연구자·관리자</h2>
    <div class="card small"><dl class="kv"><dt>검사 기록</dt><dd>${exams.length}건</dd><dt>오차 분석 자료</dt><dd>${errs.length}건 (검토 완료 ${errs.filter(e => e.reviewStatus === 'reviewed').length})</dd><dt>mm 환산</dt><dd>${cv.validated ? '<span class="badge b-good">검증 통과</span>' : '<span class="badge b-warn">미검증</span>'}</dd><dt>배포 모델</dt><dd>${esc((models.find(m => m.id === S.settings.activeModelId) || {}).version || C.ALGORITHM_VERSION + ' (보정 없음)')}</dd></dl></div>
    <div class="card">${[
      ['#/r/errors', '측정 오차 자료 입력·관리', 'AI 측정값과 기준 측정값 입력, 검토 상태 관리'],
      ['#/r/compare', 'AI vs 기준 측정값 비교', 'ME · MAE · RMSE · Bland–Altman'],
      ['#/r/calib', '측정 알고리즘 보정', '스티커 지름, mm 환산 검증 템플릿, 검출 파라미터'],
      ['#/r/models', '모델 버전 및 성능 관리', '보정 모델 학습·평가·승인·배포'],
      ['#/r/content', '운동 중재 콘텐츠 관리', '운동·영상 등록, 분류별 연결'],
      ['#/r/data', '연구 데이터 관리', '내보내기 · 삭제 · PIN 변경']
    ].map(([h, t, d]) => `<a class="list-item" href="${h}"><span class="grow"><b>${t}</b><br><span class="tiny">${d}</span></span>›</a>`).join('')}</div>
    <button class="btn block" id="lock">연구자 모드 잠그기</button>`;
  $('#lock', v).onclick = () => { S.researcherUnlocked = false; go('#/home'); };
}, R);

// ───── 오차 자료 입력 ─────
function errorRowIncluded(r) { return r.reviewStatus === 'reviewed' && r.refConfirmed && isFinite(r.aiMm) && isFinite(r.refMm); }
route('/r/errors', '측정 오차 자료', async (v, p) => {
  const rows = (await DB.all('errors')).sort((a, b) => b.createdAt - a.createdAt);
  const exams = (await DB.all('exams')).sort((a, b) => b.createdAt - a.createdAt);
  const edit = p.q.edit ? rows.find(r => r.id === p.q.edit) : null;
  const e = edit || { participantId: S.settings.participantId || '', foot: 'left', phase: 'pre', aiMm: '', refMm: '', refConfirmed: false, date: new Date().toISOString().slice(0, 10), imageRef: '', detectionConfidence: '', conditions: '', reviewStatus: 'unreviewed', memo: '', examId: '' };
  const sel = (id, opts, val) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(val) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  v.innerHTML = `<h2>측정 오차 자료</h2>
    <div class="card"><b>${edit ? '자료 수정' : '새 자료 입력'}</b>
      <label class="f" for="fromExam">검사 기록에서 AI 측정값 가져오기(선택)</label>
      <select id="fromExam"><option value="">— 직접 입력 —</option>${exams.map(x => `<option value="${x.id}" ${e.examId === x.id ? 'selected' : ''}>${fmtDate(x.createdAt)} · ${FOOT[x.foot]} · ${esc(x.participantId || 'ID없음')}${x.comparison.rawPreMm == null ? ' (mm 없음)' : ''}</option>`).join('')}</select>
      <div class="grid2"><div><label class="f" for="pid">참여자 ID*</label><input id="pid" value="${esc(e.participantId)}" maxlength="20"></div><div><label class="f" for="date">측정 날짜*</label><input id="date" type="date" value="${esc(e.date)}"></div></div>
      <div class="grid2"><div><label class="f" for="foot">좌/우*</label>${sel('foot', [['left', '왼발'], ['right', '오른발']], e.foot)}</div><div><label class="f" for="phase">체중부하*</label>${sel('phase', [['pre', '전'], ['post', '후']], e.phase)}</div></div>
      <div class="grid2"><div><label class="f" for="ai">AI 측정값(mm)*</label><input id="ai" inputmode="decimal" value="${esc(e.aiMm)}"></div><div><label class="f" for="ref">기준 측정값(mm)</label><input id="ref" inputmode="decimal" value="${esc(e.refMm ?? '')}"></div></div>
      <label class="chk"><input type="checkbox" id="refOk" ${e.refConfirmed ? 'checked' : ''}><span class="small">기준값 확인됨(수동 측정 등으로 확인된 값). 확인되지 않은 자료는 정확도 검증에서 제외됩니다.</span></label>
      <div class="grid2"><div><label class="f" for="conf">검출 신뢰도(0~1)</label><input id="conf" inputmode="decimal" value="${esc(e.detectionConfidence)}"></div><div><label class="f" for="rev">검토 상태</label>${sel('rev', [['unreviewed', '미검토'], ['reviewed', '검토 완료'], ['excluded', '제외']], e.reviewStatus)}</div></div>
      <label class="f" for="img">이미지 또는 이미지 참조</label><input id="img" value="${esc(e.imageRef)}" placeholder="파일명, 검사 ID 등">
      <label class="f" for="cond">촬영 조건</label><input id="cond" value="${esc(e.conditions)}" placeholder="거리, 조명, 기기 등">
      <label class="f" for="memo">연구자 메모</label><textarea id="memo">${esc(e.memo)}</textarea>
      <button class="btn primary block" id="saveE" style="margin-top:10px">${edit ? '수정 저장' : '자료 추가'}</button>${edit ? '<a class="btn block" href="#/r/errors">취소</a>' : ''}</div>
    <h3>입력된 자료 (${rows.length}) · 정확도 검증 포함 ${rows.filter(errorRowIncluded).length}건</h3>
    <div class="card scroll-x">${rows.length ? `<table class="t"><tr><th>ID</th><th>발/단계</th><th>AI</th><th>기준</th><th>오차</th><th>상태</th><th></th></tr>${rows.map(r => `<tr><td>${esc(r.participantId)}<br><span class="tiny">${esc(r.date)}</span></td><td>${FOOT[r.foot]}<br>${r.phase === 'pre' ? '전' : '후'}</td><td>${r.aiMm.toFixed(2)}</td><td>${r.refMm != null ? r.refMm.toFixed(2) : '—'}${r.refConfirmed ? '' : '<br><span class="tiny">미확인</span>'}</td><td>${r.refMm != null ? (r.aiMm - r.refMm).toFixed(2) : '—'}</td><td>${{ unreviewed: '<span class="badge">미검토</span>', reviewed: '<span class="badge b-good">검토</span>', excluded: '<span class="badge b-bad">제외</span>' }[r.reviewStatus]}</td><td><a class="btn sm" href="#/r/errors?edit=${r.id}">수정</a> <button class="btn sm ghost" data-del="${r.id}">삭제</button></td></tr>`).join('')}</table>` : '<p class="muted">자료가 없습니다.</p>'}</div>
    <a class="btn block" href="#/r/compare">오차 분석 보기</a>`;
  $('#fromExam', v).onchange = async () => {
    const x = exams.find(z => z.id === $('#fromExam', v).value); if (!x) return;
    const ph = $('#phase', v).value, val = ph === 'pre' ? x.comparison.rawPreMm : x.comparison.rawPostMm;
    $('#pid', v).value = x.participantId || ''; $('#foot', v).value = x.foot; $('#date', v).value = new Date(x.createdAt).toISOString().slice(0, 10);
    $('#conf', v).value = x[ph].detectionConfidence?.toFixed(3) ?? ''; $('#img', v).value = `exam:${x.id}${x[ph].imageId ? ' image:' + x[ph].imageId : ''}`;
    $('#cond', v).value = `${modeLabel(x[ph].mode)}촬영, ${x[ph].imageSize.join('×')}, 스티커 ${x[ph].quality.diameterPx.toFixed(0)}px`;
    if (val != null) $('#ai', v).value = val.toFixed(2); else { $('#ai', v).value = ''; toast('이 검사는 mm 환산 값이 없어 AI 측정값을 가져올 수 없습니다.', true); }
  };
  $('#phase', v).onchange = () => { if ($('#fromExam', v).value) $('#fromExam', v).onchange(); };
  $('#saveE', v).onclick = async () => {
    const pid = $('#pid', v).value.trim(), ai = num($('#ai', v).value), ref = num($('#ref', v).value), conf = num($('#conf', v).value), refOk = $('#refOk', v).checked;
    const errs = [];
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(pid)) errs.push('참여자 ID는 영문·숫자·-·_ 20자 이내(실명 금지)');
    if (!$('#date', v).value) errs.push('측정 날짜 필요');
    if (ai == null || Number.isNaN(ai) || ai < 0 || ai > 100) errs.push('AI 측정값은 0~100mm 숫자');
    if (Number.isNaN(ref) || (ref != null && (ref < 0 || ref > 100))) errs.push('기준 측정값은 0~100mm 숫자');
    if (refOk && ref == null) errs.push('기준값이 없으면 “기준값 확인됨”을 선택할 수 없음');
    if (Number.isNaN(conf) || (conf != null && (conf < 0 || conf > 1))) errs.push('검출 신뢰도는 0~1');
    if ($('#rev', v).value === 'reviewed' && ref == null) errs.push('기준값 없는 자료는 검토 완료 처리 불가');
    if (errs.length) return toast('입력값 오류: ' + errs.join(' / '), true);
    const rec = Object.assign({}, edit || { id: uid(), createdAt: Date.now() }, { participantId: pid, date: $('#date', v).value, foot: $('#foot', v).value, phase: $('#phase', v).value, aiMm: ai, refMm: ref, refConfirmed: refOk, detectionConfidence: conf, imageRef: $('#img', v).value.trim(), conditions: $('#cond', v).value.trim(), reviewStatus: $('#rev', v).value, memo: $('#memo', v).value.trim(), examId: $('#fromExam', v).value || null, updatedAt: Date.now() });
    if (await save('errors', rec)) { toast('저장했습니다.'); go('#/r/errors'); }
  };
  $$('[data-del]', v).forEach(b => b.onclick = async () => { if (await confirmModal('이 자료를 삭제할까요?', '삭제', true)) { await DB.del('errors', b.dataset.del); render(); } });
}, R);

// ───── AI vs 기준 비교 / 오차 분석 ─────
route('/r/compare', 'AI vs 기준 측정값', async (v) => {
  const rows = await DB.all('errors'); const inc = rows.filter(errorRowIncluded);
  const groups = [['전체', inc], ['체중부하 전', inc.filter(r => r.phase === 'pre')], ['체중부하 후', inc.filter(r => r.phase === 'post')], ['왼발', inc.filter(r => r.foot === 'left')], ['오른발', inc.filter(r => r.foot === 'right')]];
  const f = x => x == null ? '—' : x.toFixed(2);
  v.innerHTML = `<h2>AI vs 기준 측정값</h2>
    <div class="note info small">정확도 계산에는 <b>검토 완료 + 기준값 확인</b> 자료만 포함합니다. 제외: 미검토 ${rows.filter(r => r.reviewStatus === 'unreviewed').length}건, 제외 처리 ${rows.filter(r => r.reviewStatus === 'excluded').length}건, 기준값 미확인 ${rows.filter(r => r.reviewStatus === 'reviewed' && !r.refConfirmed).length}건. 오차 = AI − 기준 (mm).</div>
    <div class="card scroll-x"><table class="t"><tr><th>집단</th><th>n</th><th>ME</th><th>MAE</th><th>RMSE</th><th>SD</th><th>95% LoA</th><th>MAPE*</th></tr>
      ${groups.map(([n, g]) => { const m = C.errorMetrics(g.map(r => ({ ai: r.aiMm, ref: r.refMm }))); return `<tr><td>${n}</td><td>${m.n}</td><td>${f(m.me)}</td><td>${f(m.mae)}</td><td>${f(m.rmse)}</td><td>${f(m.sd)}</td><td>${m.loaLow != null ? f(m.loaLow) + ' ~ ' + f(m.loaHigh) : '—'}</td><td>${m.mape != null ? m.mape.toFixed(1) + '%' : '—'}${m.relExcluded ? `<br><span class="tiny">${m.relExcluded}건 제외</span>` : ''}</td></tr>`; }).join('')}
    </table><p class="tiny">*상대오차율(MAPE)은 기준값이 1mm 이상인 자료에만 적용합니다(0 근처 기준값은 비율이 왜곡되므로 제외).</p></div>
    ${inc.length ? `<div class="card"><b>AI 측정값 vs 기준 측정값</b><div class="legend"><span><i style="background:var(--series-1)"></i>체중부하 전</span><span><i style="background:var(--series-2)"></i>체중부하 후</span><span>점선: 완전 일치(y=x)</span></div><canvas class="chart" id="sc"></canvas><p class="tiny">가로: 기준 측정값(mm), 세로: AI 측정값(mm)</p></div>
    <div class="card"><b>Bland–Altman</b><canvas class="chart" id="ba"></canvas><p class="tiny">가로: 두 측정의 평균(mm), 세로: 차이 AI−기준(mm). 실선: 평균오차, 점선: 95% 일치 한계</p></div>
    <div class="card scroll-x"><b>개별 측정 오차</b><table class="t"><tr><th>ID</th><th>발</th><th>단계</th><th>AI</th><th>기준</th><th>오차</th><th>절대오차</th></tr>${inc.map(r => `<tr><td>${esc(r.participantId)}</td><td>${FOOT[r.foot]}</td><td>${r.phase === 'pre' ? '전' : '후'}</td><td>${f(r.aiMm)}</td><td>${f(r.refMm)}</td><td>${f(r.aiMm - r.refMm)}</td><td>${f(Math.abs(r.aiMm - r.refMm))}</td></tr>`).join('')}</table></div>`
      : '<div class="placeholder">분석할 자료가 없습니다. 기준값이 확인되고 검토 완료된 자료를 입력하세요.<br><a class="btn sm" href="#/r/errors" style="margin-top:8px">자료 입력</a></div>'}`;
  if (inc.length) {
    const col = r => r.phase === 'pre' ? '#2a78d6' : '#eb6834';
    scatterChart($('#sc', v), inc.map(r => ({ x: r.refMm, y: r.aiMm, color: col(r), label: `${r.participantId} ${FOOT[r.foot]} ${r.phase === 'pre' ? '전' : '후'}: AI ${f(r.aiMm)} / 기준 ${f(r.refMm)}` })), { identity: true });
    const m = C.errorMetrics(inc.map(r => ({ ai: r.aiMm, ref: r.refMm })));
    const hl = [{ y: m.me, label: `ME ${f(m.me)}`, color: '#10201f' }]; if (m.sd != null) hl.push({ y: m.loaLow, label: f(m.loaLow), dash: true }, { y: m.loaHigh, label: f(m.loaHigh), dash: true });
    scatterChart($('#ba', v), inc.map(r => ({ x: (r.aiMm + r.refMm) / 2, y: r.aiMm - r.refMm, color: col(r), label: `${r.participantId}: 평균 ${f((r.aiMm + r.refMm) / 2)}, 차이 ${f(r.aiMm - r.refMm)}` })), { hlines: hl });
  }
}, R);

// ───── 알고리즘 보정(mm 환산 검증) ─────
function templateSvg(D) {
  const T = C.TEMPLATE, x3 = 20, y0 = 62, x1 = x3 + T.spanMm, x2 = x3 + T.p2FromHeelMm, y2 = y0 - T.heightMm;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="170mm" height="95mm" viewBox="0 0 170 95">
<rect width="170" height="95" fill="#fff"/>
<text x="4" y="6" font-size="3.2" font-family="sans-serif">발 아치 앱 mm 환산 검증 템플릿 — 반드시 "실제 크기(100%)"로 인쇄하고 아래 100mm 눈금을 자로 확인하세요. 원 지름 ${D}mm</text>
<circle cx="${x3}" cy="${y0}" r="${D / 2}" fill="#1f5fd1"/><circle cx="${x1}" cy="${y0}" r="${D / 2}" fill="#1f5fd1"/><circle cx="${x2}" cy="${y2}" r="${D / 2}" fill="#1f5fd1"/>
<text x="${x3 - 3}" y="${y0 + D / 2 + 5}" font-size="3.5" font-family="sans-serif">P3</text><text x="${x1 - 3}" y="${y0 + D / 2 + 5}" font-size="3.5" font-family="sans-serif">P1</text><text x="${x2 + D / 2 + 2}" y="${y2 + 1}" font-size="3.5" font-family="sans-serif">P2 (기준선에서 ${T.heightMm}mm)</text>
<line x1="20" y1="88" x2="120" y2="88" stroke="#000" stroke-width="0.3"/>${Array.from({ length: 11 }, (_, i) => `<line x1="${20 + i * 10}" y1="85.5" x2="${20 + i * 10}" y2="88" stroke="#000" stroke-width="0.3"/>`).join('')}<text x="122" y="89" font-size="3" font-family="sans-serif">100 mm</text>
</svg>`;
}
route('/r/calib', '측정 알고리즘 보정', async (v) => {
  const vals = (await DB.all('validations')).sort((a, b) => b.at - a.at);
  const cvs = convSettings(); const D = S.settings.stickerDiameterMm;
  v.innerHTML = `<h2>측정 알고리즘 보정</h2>
    <div class="card"><b>1. 스티커 실제 지름</b>
      <label class="f" for="dia">지름(mm) — 캘리퍼 등으로 실제 측정한 값</label><input id="dia" inputmode="decimal" value="${D ?? ''}">
      <button class="btn primary block" id="saveD" style="margin-top:8px">저장</button>
      <p class="tiny">지름을 바꾸면 기존 환산 검증은 무효가 되며 다시 시험해야 합니다.</p></div>
    <div class="card"><b>분류에 쓸 측정값</b>
      <div class="seg" id="pmSeg" style="margin-top:8px"><button data-v="line">P1–P3 기준선 하강</button><button data-v="floor">바닥 기준 하강</button></div>
      <p class="tiny">P1–P3 기준선 하강: 연구 정의(Nielsen 등 2009와 같은 방식)이며 바닥이 보이지 않아도 측정됩니다. 바닥 기준 하강: 표준 NDT처럼 바닥에서 발배뼈까지 높이의 변화이며, 바닥선이 전·후 모두 검출되어야 쓰입니다(아니면 기준선 방식으로 대체하고 결과에 표시). 두 값은 항상 함께 기록됩니다.</p></div>
    <div class="card"><b>2. mm 환산 검증 시험</b> ${cvs.validated ? '<span class="badge b-good">통과</span>' : '<span class="badge b-warn">미통과</span>'}
      <ol class="steps small"><li>템플릿을 내려받아 실제 크기(100%)로 인쇄하고 100mm 눈금을 자로 확인합니다.</li><li>템플릿을 평평한 곳에 두고 실제 검사와 같은 거리·높이에서 촬영합니다(P1이 화면 오른쪽).</li><li>사진을 불러오면 앱이 P2 높이(${C.TEMPLATE.heightMm}mm)와 P1–P3 거리(${C.TEMPLATE.spanMm}mm)를 재현하는지 확인합니다.</li></ol>
      <button class="btn block" id="tpl" ${D ? '' : 'disabled'}>템플릿 내려받기(SVG)</button>
      <label class="f" for="tol">허용 오차(mm)</label><input id="tol" inputmode="decimal" value="1.0">
      <label class="btn block" for="vf" style="margin-top:8px">${D ? '템플릿 사진 촬영/불러오기' : '먼저 지름을 저장하세요'}</label><input type="file" id="vf" accept="image/*" capture="environment" class="hide" ${D ? '' : 'disabled'}>
      <div id="vres"></div>
      <p class="tiny">한계: 평평한 템플릿 시험은 축척 환산을 확인할 뿐, 발의 곡면·피부 움직임·스티커 부착 오차까지 검증하지는 않습니다. 실제 정확도는 오차 분석(기준 측정값 비교)으로 확인해야 합니다.</p></div>
    <div class="card"><b>검증 이력</b>${vals.length ? `<table class="t"><tr><th>일시</th><th>지름</th><th>높이 오차</th><th>거리 오차</th><th>결과</th></tr>${vals.map(x => `<tr><td>${fmtDate(x.at)}</td><td>${x.diameterMm}</td><td>${x.errHeight != null ? x.errHeight.toFixed(2) : '—'}</td><td>${x.errSpan != null ? x.errSpan.toFixed(2) : '—'}</td><td>${x.pass ? '<span class="badge b-good">통과</span>' : '<span class="badge b-bad">실패</span>'}</td></tr>`).join('')}</table>` : '<p class="muted small">기록 없음</p>'}</div>
    <div class="card"><b>3. 합성 이미지 파이프라인 시험(테스트 전용)</b>
      <p class="small">검출·라벨링·거리 계산 코드가 동작하는지 알려진 좌표의 합성 이미지로 확인합니다. 결과는 <b>저장되지 않으며</b> 실제 측정 결과와 섞이지 않습니다.</p>
      <button class="btn block" id="syn">합성 이미지 시험 실행</button><div id="synres"></div></div>
    <div class="card small"><b>현재 검출·환산 파라미터 (${C.ALGORITHM_VERSION})</b><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify({ detect: C.DEFAULT_DETECT, conversion: C.DEFAULT_CONVERSION }, null, 1))}</pre><p class="tiny">이 값들은 초기 휴리스틱이며 실제 사진 자료로 검증·조정이 필요합니다.</p></div>`;
  const paintPm = () => $$('#pmSeg button', v).forEach(b => b.classList.toggle('on', b.dataset.v === (S.settings.primaryMeasure || 'line')));
  $$('#pmSeg button', v).forEach(b => b.onclick = async () => { S.settings.primaryMeasure = b.dataset.v; await saveSettings(); paintPm(); toast('분류 기준 측정값을 바꿨습니다(새 검사부터 적용).'); }); paintPm();
  $('#saveD', v).onclick = async () => { const d = num($('#dia', v).value); if (!(d > 2 && d < 50)) return toast('지름은 2~50mm 사이 숫자로 입력해 주세요.', true); S.settings.stickerDiameterMm = d; S.settings.diameterSource = 'user'; if (await saveSettings()) { toast('저장했습니다.'); render(); } };
  $('#tpl', v).onclick = () => download(`foot-arch-template-${D}mm.svg`, templateSvg(D), 'image/svg+xml');
  $('#vf', v).onchange = e => {
    const file = e.target.files[0]; if (!file) return; const tol = num($('#tol', v).value) || 1.0;
    const im = new Image(); im.onload = async () => {
      const { canvas, img } = imageDataFromSource(im, 1920);
      const det = C.detectStickers(img, { toeDirection: 'right', detect: { maxNavicularT: 0.6 } });
      const res = det.ok ? C.validateConversion(det, D, tol) : { pass: false, reason: det.reasons.map(r => r.msg).join(' ') };
      const rec = { id: uid(), at: Date.now(), diameterMm: D, tolerance: tol, pass: !!res.pass, errHeight: res.errHeight ?? null, errSpan: res.errSpan ?? null, heightMm: res.heightMm ?? null, spanMm: res.spanMm ?? null, reason: res.reason || null, imageSize: det.imageSize };
      await save('validations', rec);
      if (rec.pass) { S.settings.validation = { pass: true, diameterMm: D, at: rec.at, id: rec.id }; await saveSettings(); }
      $('#vres', v).innerHTML = `<canvas style="width:100%;aspect-ratio:${canvas.width}/${canvas.height};margin-top:8px"></canvas><div class="note ${rec.pass ? 'good' : 'bad'}">${rec.pass ? `통과: P2 높이 ${rec.heightMm.toFixed(2)}mm(오차 ${rec.errHeight.toFixed(2)}), P1–P3 ${rec.spanMm.toFixed(2)}mm(오차 ${rec.errSpan.toFixed(2)}). 이제 mm 값이 표시됩니다.` : '실패: ' + esc(rec.reason || `오차 높이 ${rec.errHeight?.toFixed(2)}mm, 거리 ${rec.errSpan?.toFixed(2)}mm — 허용치 초과`) + ' (기존 검증 상태는 바뀌지 않습니다)'}</div><button class="btn block" onclick="render()">이력 새로고침</button>`;
      const c2 = $('#vres canvas', v); const { g, w } = setupCanvas(c2); const k = w / canvas.width; g.drawImage(canvas, 0, 0, w, canvas.height * k); drawOverlay(g, det, k);
    }; im.onerror = () => toast('이미지를 읽을 수 없습니다.', true); im.src = URL.createObjectURL(file);
  };
  $('#syn', v).onclick = () => {
    const W = 960, H = 720, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    g.fillStyle = '#cdc8c0'; g.fillRect(0, 0, W, H); g.fillStyle = '#deb296'; g.beginPath(); g.ellipse(W / 2, H * 0.58, W * 0.4, H * 0.2, 0, 0, 7); g.fill();
    const truth = { P3: { x: 182.4, y: 475.2 }, P1: { x: 777.6, y: 475.2 }, P2: { x: 432.3, y: 391.2 } };
    g.fillStyle = '#1c56d6'; for (const k of ['P1', 'P2', 'P3']) { g.beginPath(); g.arc(truth[k].x, truth[k].y, 14, 0, 7); g.fill(); }
    const det = C.detectStickers(g.getImageData(0, 0, W, H), { toeDirection: 'right' });
    const err = det.landmarks ? Math.max(...['P1', 'P2', 'P3'].map(k => Math.hypot(det.landmarks[k].x - truth[k].x, det.landmarks[k].y - truth[k].y))) : null;
    const hp = det.landmarks ? C.distanceToLine(det.landmarks.P2, det.landmarks.P1, det.landmarks.P3) : null;
    $('#synres', v).innerHTML = `<span class="badge b-info">테스트 데이터</span><canvas style="width:100%;aspect-ratio:4/3;margin-top:6px"></canvas><div class="note ${det.ok && err < 0.5 && Math.abs(hp - 84) < 0.5 ? 'good' : 'bad'} small">검출 ${det.ok ? '성공' : '실패'} · 최대 중심 오차 ${err != null ? err.toFixed(2) + 'px' : '—'} · P2 높이 ${hp != null ? hp.toFixed(2) : '—'}px (정답 84.00px)</div>`;
    const c2 = $('#synres canvas', v); const s = setupCanvas(c2); const k = s.w / W; s.g.drawImage(cv, 0, 0, s.w, H * k); drawOverlay(s.g, det, k);
  };
}, R);

// ───── 모델 버전 및 성능 관리 ─────
route('/r/models', '모델 버전 및 성능', async (v) => {
  const models = (await DB.all('models')).sort((a, b) => b.createdAt - a.createdAt);
  const rows = (await DB.all('errors')).filter(errorRowIncluded);
  const f = x => x == null ? '—' : x.toFixed(3);
  v.innerHTML = `<h2>모델 버전 및 성능</h2>
    <div class="note info small">보정은 검토 완료·기준값 확인 자료(${rows.length}건, 참여자 ${new Set(rows.map(r => r.participantId)).size}명)로 <b>평균 편향 보정</b>과 <b>선형 회귀 보정</b>을 비교합니다. 참여자 단위로 학습/검증/시험(60/20/20%)을 나눠 같은 참여자가 여러 세트에 들어가지 않게 합니다. 딥러닝 학습은 하지 않습니다. 최소 조건: 자료 10건·참여자 5명.</div>
    <button class="btn primary block" id="train">보정 모델 학습·평가 실행</button>
    <div class="card"><b>${C.ALGORITHM_VERSION} (보정 없음, 기본)</b> ${!S.settings.activeModelId ? '<span class="badge b-good">사용 중</span>' : ''}<p class="tiny">검출된 좌표에서 계산한 값을 그대로 사용합니다.</p>${S.settings.activeModelId ? '<button class="btn sm" id="rollback">기본 모델로 되돌리기</button>' : ''}</div>
    ${models.map(m => `<div class="card"><div class="row"><b class="grow">${esc(m.version)}</b>${m.deployed ? '<span class="badge b-good">배포됨</span>' : ''}<span class="badge ${m.reviewStatus === '승인' ? 'b-good' : m.reviewStatus === '반려' ? 'b-bad' : ''}">${esc(m.reviewStatus)}</span></div>
      <dl class="kv small"><dt>생성</dt><dd>${fmtDate(m.createdAt)}</dd><dt>보정 방법</dt><dd>${{ bias: '평균 편향 보정', linear: '선형 회귀 보정', identity: '보정 없음' }[m.method]}</dd>
      <dt>파라미터</dt><dd>${m.method === 'bias' ? 'bias ' + f(m.params.bias) : m.method === 'linear' ? `기울기 ${f(m.params.slope)}, 절편 ${f(m.params.intercept)}` : '—'}</dd>
      <dt>사용 데이터</dt><dd>학습 ${m.dataInfo.train} / 검증 ${m.dataInfo.val} / 시험 ${m.dataInfo.test}건</dd>
      <dt>시험 MAE 전→후</dt><dd>${f(m.testBefore.mae)} → ${f(m.testAfter.mae)}</dd><dt>시험 RMSE 전→후</dt><dd>${f(m.testBefore.rmse)} → ${f(m.testAfter.rmse)}</dd><dt>시험 ME 전→후</dt><dd>${f(m.testBefore.me)} → ${f(m.testAfter.me)}</dd>
      <dt>독립 시험 결과</dt><dd>${m.improved ? '<span class="badge b-good">개선</span>' : '<span class="badge b-bad">개선 없음</span>'}</dd></dl>
      ${m.reviewMemo ? `<p class="tiny">검토 메모: ${esc(m.reviewMemo)}</p>` : ''}
      <div class="row">${m.reviewStatus === '검토 대기' ? `<button class="btn sm" data-approve="${m.id}" ${m.improved ? '' : 'disabled'}>승인</button><button class="btn sm" data-reject="${m.id}">반려</button>` : ''}${m.reviewStatus === '승인' && !m.deployed ? `<button class="btn sm primary" data-deploy="${m.id}">배포</button>` : ''}<button class="btn sm ghost" data-delm="${m.id}">삭제</button></div></div>`).join('')}`;
  $('#train', v).onclick = async () => {
    const res = C.trainCalibration(rows.map(r => ({ participantId: r.participantId, ai: r.aiMm, ref: r.refMm })));
    if (!res.ok) return toast('모델 보정 실패 — ' + res.reason, true);
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const m = { id: uid(), version: `CAL-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`, createdAt: Date.now(), baseAlgorithm: C.ALGORITHM_VERSION, method: res.model.method, params: res.model, dataInfo: res.split, validation: res.validation, testBefore: res.testBefore, testAfter: res.testAfter, improved: res.improved, reviewStatus: '검토 대기', deployed: false };
    if (await save('models', m)) { toast(res.recommendation, !res.improved); render(); }
  };
  const setModel = async (id, patch) => { const m = await DB.get('models', id); Object.assign(m, patch); return save('models', m); };
  $$('[data-approve]', v).forEach(b => b.onclick = async () => { await setModel(b.dataset.approve, { reviewStatus: '승인', reviewedAt: Date.now() }); render(); });
  $$('[data-reject]', v).forEach(b => b.onclick = async () => { await setModel(b.dataset.reject, { reviewStatus: '반려', reviewedAt: Date.now() }); render(); });
  $$('[data-deploy]', v).forEach(b => b.onclick = async () => {
    const m = await DB.get('models', b.dataset.deploy); if (!m.improved || m.reviewStatus !== '승인') return toast('개선이 확인되고 승인된 모델만 배포할 수 있습니다.', true);
    if (!await confirmModal(`${m.version}을(를) 배포할까요? 이후 새 검사의 mm 값에 보정이 적용됩니다(기존 기록은 바뀌지 않음).`, '배포')) return;
    for (const x of models) if (x.deployed) await setModel(x.id, { deployed: false });
    await setModel(m.id, { deployed: true, deployedAt: Date.now() }); S.settings.activeModelId = m.id; await saveSettings(); render();
  });
  if ($('#rollback', v)) $('#rollback', v).onclick = async () => { for (const x of models) if (x.deployed) await setModel(x.id, { deployed: false }); S.settings.activeModelId = null; await saveSettings(); render(); };
  $$('[data-delm]', v).forEach(b => b.onclick = async () => { if (!await confirmModal('이 모델 기록을 삭제할까요?', '삭제', true)) return; if (S.settings.activeModelId === b.dataset.delm) { S.settings.activeModelId = null; await saveSettings(); } await DB.del('models', b.dataset.delm); render(); });
}, R);

// ───── 운동 콘텐츠 관리 ─────
route('/r/content', '운동 콘텐츠 관리', async (v, p) => {
  const exs = await DB.all('exercises'); const x = p.q.edit === 'new' ? { id: uid(), name: '', purpose: '', posture: '', steps: [], cautions: [], reps: '', sets: '', holdSec: '', perWeek: '', source: '', reviewed: false, videoBlobId: null, videoUrl: '', createdAt: Date.now(), _new: true } : exs.find(e => e.id === p.q.edit);
  if (x && x.server) { toast('관리자 화면에서 올린 운동은 관리자 화면에서 고칠 수 있습니다.', true); return go('#/r/content'); }
  const map = S.settings.mapping;
  if (!x) {
    v.innerHTML = `<h2>운동 콘텐츠 관리</h2>
      <div class="card"><b>분류별 연결 운동</b><p class="tiny">각 분류 결과 화면에 표시할 운동을 지정합니다.</p>
      <div class="scroll-x"><table class="t"><tr><th>운동</th>${C.CATEGORIES.map(c => `<th>${c.label.replace(' 의심', '')}</th>`).join('')}</tr>
      ${exs.map(e => `<tr><td>${esc(e.name)}</td>${C.CATEGORIES.map(c => `<td><input type="checkbox" aria-label="${esc(e.name)} ${c.label}" data-map="${c.key}" data-ex="${e.id}" ${(map[c.key] || []).includes(e.id) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}</table></div>
      <button class="btn primary block" id="saveMap">연결 저장</button></div>
      <div class="note info small">관리자 화면(…/admin/ › 운동 영상)에서 올린 운동은 모든 사용자에게 자동으로 보이며, 여기서는 고칠 수 없습니다(☁ 표시).</div>
      <div class="card">${exs.map(e => `<a class="list-item" href="#/r/content?edit=${e.id}"><span class="grow"><b>${e.server ? '☁ ' : ''}${esc(e.name)}</b><br><span class="tiny">${e.videoBlobId || e.videoUrl ? '영상 있음' : '영상 등록 필요'} · ${hasPrescription(e) ? '처방 입력됨' : '처방 미입력'} · ${e.reviewed ? '검토 완료' : '검토 전'}</span></span>›</a>`).join('')}</div>
      <a class="btn block" href="#/r/content?edit=new">새 운동 추가</a>`;
    $('#saveMap', v).onclick = async () => { const m = { normal: [], mild: [], moderate: [], severe: [] }; $$('[data-map]', v).forEach(c => { if (c.checked) m[c.dataset.map].push(c.dataset.ex); }); S.settings.mapping = m; if (await saveSettings()) toast('연결을 저장했습니다.'); };
    return;
  }
  v.innerHTML = `<h2>${x._new ? '새 운동' : '운동 편집'}</h2>
    <div class="card">
      <label class="f" for="n">운동명*</label><input id="n" value="${esc(x.name)}" maxlength="60">
      <label class="f" for="pu">운동 목적</label><textarea id="pu">${esc(x.purpose)}</textarea>
      <label class="f" for="po">올바른 자세</label><textarea id="po">${esc(x.posture)}</textarea>
      <label class="f" for="st">단계별 수행 방법(한 줄에 한 단계)</label><textarea id="st">${esc((x.steps || []).join('\n'))}</textarea>
      <label class="f" for="ca">주의사항(한 줄에 하나)</label><textarea id="ca">${esc((x.cautions || []).join('\n'))}</textarea>
      <div class="note warn small">처방 수치는 <b>연구 프로토콜에 명시된 값만</b> 입력하세요. 모르는 값은 비워 두면 “미입력”으로 표시됩니다.</div>
      <div class="grid2"><div><label class="f" for="re">반복 횟수</label><input id="re" value="${esc(x.reps)}" maxlength="20"></div><div><label class="f" for="se">세트 수</label><input id="se" value="${esc(x.sets)}" maxlength="20"></div></div>
      <div class="grid2"><div><label class="f" for="ho">유지 시간(초)</label><input id="ho" value="${esc(x.holdSec)}" maxlength="20"></div><div><label class="f" for="pw">주당 빈도</label><input id="pw" value="${esc(x.perWeek)}" maxlength="20"></div></div>
      <label class="f" for="so">근거(프로토콜 문서·문헌)</label><input id="so" value="${esc(x.source)}">
      <label class="f">운동 영상</label>
      <div class="small">${x.videoBlobId ? '기기에 저장된 영상 파일 있음' : x.videoUrl ? '영상 주소 등록됨' : '<span class="badge b-warn">영상 등록 필요</span>'}</div>
      <label class="btn block" for="vf" style="margin-top:6px">영상 파일 등록(mp4 등)</label><input type="file" id="vf" accept="video/*" class="hide">
      <label class="f" for="vu">또는 영상 파일 주소(https, 직접 재생 가능한 파일)</label><input id="vu" value="${esc(x.videoUrl)}" placeholder="https://…/exercise.mp4">
      ${x.videoBlobId ? '<button class="btn sm ghost" id="rmv">저장된 영상 파일 삭제</button>' : ''}
      <label class="chk"><input type="checkbox" id="rv" ${x.reviewed ? 'checked' : ''}><span class="small">연구자 검토 완료</span></label>
      <button class="btn primary block" id="saveX">저장</button>
      ${x._new ? '' : '<button class="btn danger block" id="delX">이 운동 삭제</button>'}
    </div>`;
  let pendingVideo = null;
  $('#vf', v).onchange = e => { pendingVideo = e.target.files[0] || null; if (pendingVideo) toast(`선택됨: ${pendingVideo.name} (${(pendingVideo.size / 1048576).toFixed(1)}MB) — 저장을 누르세요.`); };
  if ($('#rmv', v)) $('#rmv', v).onclick = async () => { await DB.del('blobs', x.videoBlobId).catch(() => {}); x.videoBlobId = null; delete x._new; await save('exercises', x); render(); };
  $('#saveX', v).onclick = async () => {
    const name = $('#n', v).value.trim(); if (!name) return toast('운동명을 입력해 주세요.', true);
    const url = $('#vu', v).value.trim(); if (url && !/^https:\/\//.test(url)) return toast('영상 주소는 https:// 로 시작해야 합니다.', true);
    const lines = id => $(id, v).value.split('\n').map(s => s.trim()).filter(Boolean);
    Object.assign(x, { name, purpose: $('#pu', v).value.trim(), posture: $('#po', v).value.trim(), steps: lines('#st'), cautions: lines('#ca'), reps: $('#re', v).value.trim(), sets: $('#se', v).value.trim(), holdSec: $('#ho', v).value.trim(), perWeek: $('#pw', v).value.trim(), source: $('#so', v).value.trim(), videoUrl: url, reviewed: $('#rv', v).checked, draft: false, updatedAt: Date.now() });
    if (pendingVideo) { const bid = uid(); if (!await save('blobs', { id: bid, kind: 'video', blob: pendingVideo, name: pendingVideo.name, createdAt: Date.now() })) return; if (x.videoBlobId) await DB.del('blobs', x.videoBlobId).catch(() => {}); x.videoBlobId = bid; }
    delete x._new; if (await save('exercises', x)) { toast('저장했습니다.'); go('#/r/content'); }
  };
  if ($('#delX', v)) $('#delX', v).onclick = async () => {
    if (!await confirmModal('이 운동을 삭제할까요? 분류 연결에서도 제거됩니다.', '삭제', true)) return;
    if (x.videoBlobId) await DB.del('blobs', x.videoBlobId).catch(() => {});
    await DB.del('exercises', x.id); for (const k in map) map[k] = map[k].filter(i => i !== x.id); await saveSettings(); go('#/r/content');
  };
}, R);

// ───── 연구 데이터 관리 ─────
function toCsv(rows, cols) { const q = s => { s = s == null ? '' : String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return '﻿' + cols.map(c => q(c[0])).join(',') + '\n' + rows.map(r => cols.map(c => q(c[1](r))).join(',')).join('\n'); }
route('/r/data', '연구 데이터 관리', async (v) => {
  const counts = {}; for (const s of STORES) counts[s] = (await DB.all(s)).length;
  v.innerHTML = `<h2>연구 데이터 관리</h2>
    <div class="card small"><dl class="kv">${[['exams', '검사'], ['logs', '운동 기록'], ['errors', '오차 자료'], ['models', '보정 모델'], ['validations', '환산 검증'], ['exercises', '운동 콘텐츠'], ['blobs', '사진·영상 파일']].map(([k, l]) => `<dt>${l}</dt><dd>${counts[k]}</dd>`).join('')}</dl></div>
    <div class="card"><b>내보내기</b>
      <button class="btn block" id="j">전체 JSON (사진·영상 제외)</button>
      <button class="btn block" id="c1">검사 결과 CSV</button>
      <button class="btn block" id="c2">오차 분석 자료 CSV</button>
      <p class="tiny">내보낸 파일에는 연구 참여자 ID와 측정값이 포함됩니다. 연구 윤리 규정에 따라 안전하게 보관하세요.</p></div>
    <div class="card"><b>삭제</b>
      <button class="btn danger block" id="d1">오차 자료·모델·검증 이력 삭제</button>
      <button class="btn danger block" id="d2">앱 전체 초기화(모든 데이터·설정)</button></div>
    <div class="card"><b>서버(Supabase) 연결</b>
      <p class="tiny">기본값은 배포 파일 config.js에서 읽습니다. 여기에 입력하면 이 기기에서만 그 값을 씁니다. 현재: ${Account.configured() ? '연결 설정됨 · ' + esc(Account.cfg().supabaseUrl) : '미설정(로컬 전용 모드)'}</p>
      <label class="f" for="su">Project URL</label><input id="su" placeholder="https://xxxx.supabase.co" value="${esc(S.settings.serverUrl || '')}">
      <label class="f" for="sk">anon public key</label><input id="sk" placeholder="eyJ..." value="${esc(S.settings.serverKey || '')}">
      <div class="grid2" style="margin-top:8px"><button class="btn" id="saveSrv">저장</button><button class="btn ghost" id="clrSrv">기기 설정 지우기</button></div></div>
    <div class="card"><b>PIN 변경</b><label class="f" for="np">새 PIN(숫자 4~8자리)</label><input id="np" type="password" inputmode="numeric" maxlength="8"><button class="btn block" id="cp" style="margin-top:8px">변경</button></div>`;
  $('#j', v).onclick = async () => { const out = { exportedAt: new Date().toISOString(), app: APP_VERSION, algorithm: C.ALGORITHM_VERSION }; for (const s of STORES) if (s !== 'blobs') out[s] = (await DB.all(s)).map(x => s === 'settings' ? Object.assign({}, x, { researcherPinHash: undefined }) : x); download(`foot-arch-research-${Date.now()}.json`, JSON.stringify(out, null, 1)); };
  $('#c1', v).onclick = async () => { const ex = await DB.all('exams'); download(`exams-${Date.now()}.csv`, toCsv(ex, [['검사ID', e => e.id], ['일시', e => new Date(e.createdAt).toISOString()], ['참여자ID', e => e.participantId], ['발', e => e.foot], ['상태', e => e.comparison.status], ['전_px', e => e.pre.measure.heightPx?.toFixed(2)], ['후_px', e => e.post.measure.heightPx?.toFixed(2)], ['전_mm', e => e.comparison.preMm?.toFixed(2)], ['후_mm', e => e.comparison.postMm?.toFixed(2)], ['원시전_mm', e => e.comparison.rawPreMm?.toFixed(2)], ['원시후_mm', e => e.comparison.rawPostMm?.toFixed(2)], ['변화량_mm', e => e.comparison.changeMm?.toFixed(2)], ['기준선하강_mm', e => e.comparison.lineChangeMm?.toFixed(2)], ['바닥높이전_mm', e => e.comparison.floor?.preMm?.toFixed(2)], ['바닥높이후_mm', e => e.comparison.floor?.postMm?.toFixed(2)], ['바닥기준하강_mm', e => e.comparison.floor?.dropMm?.toFixed(2)], ['분류측정', e => e.comparison.primary], ['P1부착높이_mm', e => e.pre.measure.floor?.P1Mm?.toFixed(1)], ['P3부착높이_mm', e => e.pre.measure.floor?.P3Mm?.toFixed(1)], ['분류', e => e.category?.label], ['전_검출신뢰도', e => e.pre.detectionConfidence], ['후_검출신뢰도', e => e.post.detectionConfidence], ['측정신뢰도', e => e.measurementConfidence?.toFixed(3)], ['전_mm/px', e => e.pre.measure.mmPerPx], ['후_mm/px', e => e.post.measure.mmPerPx], ['해상도', e => e.pre.imageSize.join('x')], ['촬영방식', e => e.pre.mode + '/' + e.post.mode], ['알고리즘', e => e.algorithmVersion], ['보정모델', e => e.calibrationModel], ['테스트데이터', e => e.isTest ? 'Y' : 'N']]), 'text/csv'); };
  $('#c2', v).onclick = async () => { const er = await DB.all('errors'); download(`errors-${Date.now()}.csv`, toCsv(er, [['참여자ID', r => r.participantId], ['날짜', r => r.date], ['발', r => r.foot], ['단계', r => r.phase], ['AI_mm', r => r.aiMm], ['기준_mm', r => r.refMm], ['기준확인', r => r.refConfirmed ? 'Y' : 'N'], ['오차', r => r.refMm != null ? (r.aiMm - r.refMm).toFixed(3) : ''], ['검출신뢰도', r => r.detectionConfidence], ['검토상태', r => r.reviewStatus], ['이미지참조', r => r.imageRef], ['촬영조건', r => r.conditions], ['메모', r => r.memo]]), 'text/csv'); };
  $('#d1', v).onclick = async () => { if (!await confirmModal('오차 자료, 보정 모델, 환산 검증 이력을 모두 삭제합니다.', '삭제', true)) return; for (const s of ['errors', 'models', 'validations']) await DB.clear(s); S.settings.activeModelId = null; S.settings.validation = null; await saveSettings(); render(); };
  $('#d2', v).onclick = async () => { if (!await confirmModal('앱의 모든 데이터와 설정을 삭제하고 처음 상태로 되돌립니다. 되돌릴 수 없습니다.', '전체 초기화', true)) return; for (const s of STORES) await DB.clear(s); S.researcherUnlocked = false; S.lastResult = null; await loadSettings(); go('#/home'); };
  $('#saveSrv', v).onclick = async () => { const u = $('#su', v).value.trim(), k = $('#sk', v).value.trim(); if (u && !/^https:\/\//.test(u)) return toast('URL은 https:// 로 시작해야 합니다.', true); S.settings.serverUrl = u; S.settings.serverKey = k; await saveSettings(); toast('서버 설정을 저장했습니다.'); render(); };
  $('#clrSrv', v).onclick = async () => { S.settings.serverUrl = ''; S.settings.serverKey = ''; await saveSettings(); render(); };
  $('#cp', v).onclick = async () => { const a = $('#np', v).value; if (!/^\d{4,8}$/.test(a)) return toast('PIN은 숫자 4~8자리입니다.', true); S.settings.researcherPinHash = await sha256('foot:' + a); if (await saveSettings()) toast('PIN을 변경했습니다.'); };
}, R);
