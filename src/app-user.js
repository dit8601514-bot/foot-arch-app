'use strict';
/* ═════════════ 일반 사용자 화면 ═════════════ */
// mm 환산: 스티커의 실제 지름(기본 16 mm)을 기준 길이로 쓴다. 보정 템플릿(테스트 시트) 시험을 통과하면 '시트 검증'으로 표시한다.
function convSettings() {
  const v = S.settings.validation, D = S.settings.stickerDiameterMm;
  const sheet = !!(v && v.pass && v.diameterMm === D);
  return { stickerDiameterMm: D, validated: D > 0 && (sheet || !!S.settings.diameterSource), basis: sheet ? 'sheet' : 'diameter', primaryMeasure: S.settings.primaryMeasure || 'line' };
}
function convBasisText() { const c = convSettings(); return `스티커 지름 ${c.stickerDiameterMm} mm 기준${c.basis === 'sheet' ? ' · 테스트 시트 검증 통과' : ''}`; }
function defaultToe(foot) { return foot === 'left' ? 'right' : 'left'; } // 안쪽 면 촬영 시 자연스러운 발가락 방향
function stepper(n) { const k = n <= 5 ? 1 : n === 6 ? 2 : 3; const st = (i, l) => `<div class="st ${i <= k ? 'on' : ''}"><b>${i}</b>${l}</div>`; return `<div class="stepper" aria-label="검사 ${k}/3단계">${st(1, '촬영')}<div class="ln ${k > 1 ? 'on' : ''}"></div>${st(2, '분석')}<div class="ln ${k > 2 ? 'on' : ''}"></div>${st(3, '결과')}</div>`; }
const DISCLAIMER = '개인 건강관리용 앱입니다. 이 결과는 자가 확인과 관리를 위한 참고 정보입니다. 이 애플리케이션만으로 평발을 확정 진단하지 않으며, 본 측정은 연구에서 정의한 기준점 간 거리 변화 방식으로 표준 임상 발배뼈 하강 검사(Navicular Drop Test)와 동일하다고 검증되지 않았습니다. 통증이나 불편이 있으면 전문가와 상담하세요.';

// ───── 홈 ─────
route('/home', 'AI Footarch', async (v) => {
  const exams = (await DB.all('exams')).filter(e => !e.isTest).sort((a, b) => b.createdAt - a.createdAt);
  const latest = f => exams.find(e => e.foot === f);
  const cv = convSettings(), me = typeof Account !== 'undefined' ? Account.user() : null;
  const mgmt = ['left', 'right'].map(f => exams.find(e => e.foot === f && e.category)).filter(e => e && e.category.key !== 'normal').map(e => FOOT[e.foot]).join('·');
  v.innerHTML = `
    <section class="home-hero">
      <div class="bar">${logoHtml(false)}<a href="#/settings" aria-label="설정·알림">${ICON.bell}</a></div>
      <h2>${me && me.name ? esc(me.name) + '님, ' : ''}안녕하세요!</h2>
      <p>발 건강 관리를 시작해볼까요? 👣</p>
      <a class="menu-pill" href="#/self"><span class="mi">${ICON.scan}</span>측정하기<span class="chev">${ICON.chev}</span></a>
      <a class="menu-pill" href="#/records"><span class="mi">${ICON.listFill}</span>기록보기<span class="chev">${ICON.chev}</span></a>
      <a class="menu-pill" href="#/exercises"><span class="mi">${ICON.playFill}</span>족궁재활영상<span class="chev">${ICON.chev}</span></a>
    </section>
    <div class="sec-title">최근 결과</div>
    <div class="grid2">${['left', 'right'].map(f => { const e = latest(f); return `<a class="mini" href="${e ? '#/result/' + e.id : '#/self?feet=' + f}">
      <div class="tiny" style="font-weight:700">${FOOT[f]}</div>
      ${e ? `<div style="font-size:20px;font-weight:800;margin:2px 0">${e.comparison.changeMm != null ? mm(e.comparison.changeMm) : statusBadge(e.comparison.status)}</div><div>${catBadge(e.category)}</div><div class="tiny" style="margin-top:4px">${fmtDate(e.createdAt)}</div>` : '<div class="muted small" style="margin-top:4px">기록 없음 · 측정하기 ›</div>'}
    </a>`; }).join('')}</div>
    ${mgmt ? `<a class="mini" style="margin-top:10px" href="#/manage"><div class="row"><b class="grow small">유연성 평발 관리 중</b><span class="badge b-warn">${esc(mgmt)}</span></div></a>` : ''}
    ${!isStandalone() && location.protocol === 'https:' ? `<div class="mini small" style="margin-top:10px"><b>홈 화면에 앱으로 추가</b><div class="tiny">${installEvt ? '<button class="btn sm primary" id="install" style="margin-top:6px">앱 설치</button>' : /iPhone|iPad/.test(navigator.userAgent) ? 'Safari 아래쪽 공유 버튼 → “홈 화면에 추가”' : '브라우저 메뉴 → “앱 설치” 또는 “홈 화면에 추가”'}</div></div>` : ''}
    <div class="links"><a href="#/stickers-info">스티커 부착 위치</a><a href="#/guide?foot=left">단계별 검사</a><a href="#/r/home">연구자 모드</a></div>
    <p class="tiny" style="text-align:center;margin:4px 8px 0">개인 건강관리용 참고 정보이며 진단이 아닙니다.</p>`;
  $$('[data-foot]', v).forEach(b => b.onclick = () => go('#/guide?foot=' + b.dataset.foot));
  if ($('#install', v)) $('#install', v).onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; render(); };
}, { bare: true });

// ───── 검사 안내 ─────
route('/guide', '검사 안내', async (v, p) => {
  const foot = p.q.foot || (S.exam && S.exam.foot) || 'left';
  v.innerHTML = `${stepper(1)}
    <h2>발 기능 검사 안내</h2>
    <div class="card">
      <ol class="steps">
        <li>발 안쪽 면에 파란색 원형 스티커 3개를 붙입니다.</li>
        <li>카메라를 발 높이에 고정하고 발 안쪽 면을 수직으로 비춥니다.</li>
        <li><b>체중부하 전</b>(앉아서 체중을 싣지 않은 자세) 사진을 찍습니다.</li>
        <li>카메라 위치를 그대로 두고 <b>체중부하 후</b>(서서 체중을 실은 자세) 사진을 찍습니다.</li>
        <li>앱이 P2(발배뼈 부위)와 P1–P3 기준선 사이 거리 변화를 계산합니다.</li>
      </ol>
      <p class="small muted">왼발과 오른발은 각각 따로 검사합니다. 한쪽 결과는 다른 쪽에 적용되지 않습니다.</p>
    </div>
    <label class="f">검사할 발</label>
    <div class="seg" id="footSeg"><button data-v="left">왼발</button><button data-v="right">오른발</button></div>
    <div class="card">
      <b>사진 저장 안내</b>
      <p class="small">현재 설정: <b>${S.settings.savePhotos ? '촬영 사진을 이 기기에 저장함' : '사진은 저장하지 않고 스티커 좌표와 측정값만 저장함'}</b>. 모든 데이터는 이 기기의 브라우저 저장소에만 보관되며 서버로 전송되지 않습니다. 설정에서 언제든 바꿀 수 있습니다.</p>
      <label class="chk"><input type="checkbox" id="ack" ${S.settings.privacyAck ? 'checked' : ''}><span class="small">위 내용을 확인했습니다.</span></label>
    </div>
    <p class="tiny">${esc(DISCLAIMER)}</p>
    <button class="btn primary block big" id="next">다음: 스티커 부착 위치</button>`;
  let sel = foot;
  const paint = () => $$('#footSeg button', v).forEach(b => b.classList.toggle('on', b.dataset.v === sel));
  $$('#footSeg button', v).forEach(b => b.onclick = () => { sel = b.dataset.v; paint(); }); paint();
  $('#next', v).onclick = async () => {
    if (!$('#ack', v).checked) return toast('사진 저장 안내를 확인해 주세요.', true);
    S.settings.privacyAck = true; await saveSettings();
    S.exam = { id: uid(), foot: sel, toeDirection: defaultToe(sel), participantId: S.settings.participantId || '', startedAt: Date.now(), pre: null, post: null };
    go('#/stickers');
  };
});

// 해부학적 그림(발 안쪽 면) — 촬영 가이드와 같은 표준 발 모델(C.FOOT_MODEL)로 그린다. toe: 'right'|'left'
function footSvg(toe, highlight) {
  const W = 320, H = 196, G = C.guideGeometry(W, H, toe, { p3x: 0.17, spanW: 0.52, floorY: 0.78 }), M = C.FOOT_MODEL, left = toe === 'left';
  const pt = p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const P2 = { x: G.X(M.P3.x + 0.42 * (M.P1.x - M.P3.x)), y: G.Y(3.8) };
  const heel = { x: G.heelX, y: G.Y(M.P3.y) };
  const mk = (p, k) => `<circle cx="${p.x}" cy="${p.y}" r="${highlight === k ? 7.5 : 6}" fill="#1f5fd1" stroke="#fff" stroke-width="2"/>`;
  const anchor = left ? 'end' : 'start', sg = left ? -1 : 1;
  return `<svg class="foot-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${left ? '오른발' : '왼발'} 안쪽 면 표준 스티커 부착 위치: P1·P3는 바닥에서 2 cm, P3는 발꿈치 뒤끝에서 4 cm">
    <line x1="4" y1="${G.floorY}" x2="${W - 4}" y2="${G.floorY}" stroke="#8a9799" stroke-width="2"/>
    <text x="${W - 6}" y="${G.floorY + 13}" font-size="9.5" fill="#4a5a5c" text-anchor="end">바닥</text>
    <polygon points="${G.outline.map(pt).join(' ')}" fill="#f1d3bf" stroke="#b98d72" stroke-width="2"/>
    <circle cx="${G.malleolus.x}" cy="${G.malleolus.y}" r="${G.malleolus.r}" fill="none" stroke="#8d6e5e" stroke-width="1.3" stroke-dasharray="3 2"/>
    <text x="${G.malleolus.x + sg * 13}" y="${G.malleolus.y - 9}" font-size="9.5" fill="#6b5345" text-anchor="${anchor}">안쪽 복사뼈(부착 위치 아님)</text>
    <line x1="${G.P1.x}" y1="${G.P1.y}" x2="${G.P3.x}" y2="${G.P3.y}" stroke="#e0a800" stroke-width="1.5"/>
    <line x1="${P2.x}" y1="${P2.y}" x2="${P2.x}" y2="${G.P3.y}" stroke="#0aa3b5" stroke-width="1.3" stroke-dasharray="3 2"/>
    <!-- 치수: 바닥에서 2 cm, 발꿈치 뒤끝에서 4 cm -->
    <line x1="${G.P3.x - sg * 10}" y1="${G.floorY}" x2="${G.P3.x - sg * 10}" y2="${G.P3.y}" stroke="#c0392b" stroke-width="1.2"/>
    <text x="${G.P3.x - sg * 13}" y="${(G.floorY + G.P3.y) / 2 + 3}" font-size="9.5" fill="#c0392b" text-anchor="${left ? 'start' : 'end'}">2 cm</text>
    <line x1="${G.P1.x + sg * 10}" y1="${G.floorY}" x2="${G.P1.x + sg * 10}" y2="${G.P1.y}" stroke="#c0392b" stroke-width="1.2"/>
    <text x="${G.P1.x + sg * 13}" y="${(G.floorY + G.P1.y) / 2 + 3}" font-size="9.5" fill="#c0392b" text-anchor="${anchor}">2 cm</text>
    <line x1="${heel.x}" y1="${G.floorY + 6}" x2="${G.P3.x}" y2="${G.floorY + 6}" stroke="#c0392b" stroke-width="1.2"/>
    <text x="${(heel.x + G.P3.x) / 2}" y="${G.floorY + 17}" font-size="9.5" fill="#c0392b" text-anchor="middle">4 cm</text>
    ${mk(G.P3, 'P3')}${mk(P2, 'P2')}${mk(G.P1, 'P1')}
    <text x="${G.P3.x}" y="${G.P3.y - 11}" font-size="11" font-weight="700" fill="#10201f" text-anchor="middle">P3</text>
    <text x="${P2.x}" y="${P2.y - 11}" font-size="11" font-weight="700" fill="#10201f" text-anchor="middle">P2</text>
    <text x="${G.P1.x}" y="${G.P1.y - 11}" font-size="11" font-weight="700" fill="#10201f" text-anchor="middle">P1</text>
    <text x="${left ? 12 : W - 12}" y="14" font-size="10" fill="#4a5a5c" text-anchor="${left ? 'start' : 'end'}">발가락 쪽 ${left ? '←' : '→'}</text>
  </svg>`;
}
// 인쇄용 부착 자(실제 크기): 바닥에 세워 2 cm 높이와 발꿈치에서 4 cm 지점을 표시
function placementRulerSvg() {
  const ticks = [];
  for (let mm = 0; mm <= 60; mm++) ticks.push(`<line x1="8" y1="${70 - mm}" x2="${mm % 10 === 0 ? 16 : mm % 5 === 0 ? 13 : 11}" y2="${70 - mm}" stroke="#000" stroke-width="0.2"/>`);
  for (let mm = 0; mm <= 100; mm++) ticks.push(`<line x1="${8 + mm}" y1="70" x2="${8 + mm}" y2="${mm % 10 === 0 ? 66 : mm % 5 === 0 ? 67.5 : 68.5}" stroke="#000" stroke-width="0.2"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="150mm" height="95mm" viewBox="0 0 150 95">
<rect width="150" height="95" fill="#fff"/>
<rect x="8" y="10" width="110" height="60" fill="none" stroke="#000" stroke-width="0.4"/>
${ticks.join('')}
<line x1="8" y1="50" x2="118" y2="50" stroke="#d00" stroke-width="0.6"/>
<text x="20" y="48" font-size="3.6" font-family="sans-serif" fill="#d00">← 바닥에서 2 cm: P1·P3 스티커 중심 높이</text>
<line x1="48" y1="10" x2="48" y2="70" stroke="#00f" stroke-width="0.5" stroke-dasharray="2 1"/>
<text x="50" y="16" font-size="3.4" font-family="sans-serif" fill="#00f">발꿈치 뒤끝에서 4 cm: P3 중심</text>
<circle cx="48" cy="50" r="2" fill="none" stroke="#d00" stroke-width="0.5"/>
<text x="8" y="6" font-size="3.6" font-family="sans-serif">발 아치 앱 스티커 부착 자 — "실제 크기(100%)"로 인쇄 후 아래 100 mm 눈금을 자로 확인하세요</text>
<text x="8" y="77" font-size="3.1" font-family="sans-serif">사용법: ① 아래 선(0)을 바닥에 대고 카드를 발 안쪽에 세웁니다. ② 왼쪽 끝을 발꿈치 뒤끝에 맞춥니다.</text>
<text x="8" y="82" font-size="3.1" font-family="sans-serif">③ 파란 점선과 빨간 선이 만나는 ○ 위치에 P3 스티커 중심을 붙입니다. ④ 제1중족골두 안쪽에도 빨간 선 높이(2 cm)로 P1을 붙입니다.</text>
<text x="8" y="87" font-size="3.1" font-family="sans-serif">⑤ P2는 발배뼈 결절(안쪽 복사뼈 아래 앞쪽의 가장 튀어나온 뼈)에 붙입니다. 기준: Nielsen 등(2009) 3마커 방법.</text>
<line x1="8" y1="91" x2="108" y2="91" stroke="#000" stroke-width="0.3"/><text x="110" y="92" font-size="3" font-family="sans-serif">100 mm</text>
</svg>`;
}

const STICKER_STANDARD_HTML = `
    <div class="card">
      <b>표준 부착 위치</b> <span class="tiny">(Nielsen 등, 2009 · J Foot Ankle Res 2:12의 3마커 방법)</span>
      <dl class="kv" style="grid-template-columns:auto 1fr;margin-top:6px">
        <dt>P1</dt><dd style="text-align:left">제1중족골두(엄지발가락 뿌리 안쪽 뼈) 안쪽 면, <b>바닥에서 2 cm 위</b></dd>
        <dt>P2</dt><dd style="text-align:left">발배뼈 결절 — 안쪽 복사뼈 <b>아래 앞쪽</b>에서 가장 튀어나온 뼈. 안쪽 복사뼈 자체가 아닙니다.</dd>
        <dt>P3</dt><dd style="text-align:left">발꿈치뼈 안쪽 면, <b>바닥에서 2 cm 위</b>, <b>발꿈치 뒤끝에서 4 cm 앞</b></dd>
      </dl>
      <p class="tiny">앱은 P2에서 P1–P3 기준선까지의 수직거리 변화를 잽니다(위 논문과 같은 정의). 바닥선이 보이면 바닥 기준 발배뼈 높이(표준 NDT 방식)도 함께 계산하고, P1·P3가 2 cm 높이에 붙었는지 점검합니다.</p>
      <button class="btn block" id="rulerBtn">인쇄용 부착 자 내려받기(SVG)</button>
    </div>
    <h3>부착 방법</h3>
    <ol class="steps">
      <li>피부의 땀·로션을 닦고 말립니다.</li>
      <li>의자에 앉아 발을 바닥에 편하게 둡니다(체중을 싣지 않음).</li>
      <li><b>발배뼈 결절 찾기:</b> 안쪽 복사뼈에서 엄지발가락 쪽 아래로 손가락을 미끄러뜨리면 처음 만져지는 단단한 돌출부입니다. 발을 안쪽으로 살짝 돌리면 더 잘 튀어나옵니다.</li>
      <li>부착 자를 발 안쪽에 세워 <b>P3</b>(발꿈치 뒤끝에서 4 cm, 높이 2 cm)와 <b>P1</b>(제1중족골두, 높이 2 cm)을 붙입니다.</li>
      <li><b>P2</b>는 스티커 중심이 발배뼈 결절의 가장 튀어나온 곳에 오도록 붙입니다.</li>
      <li>세 스티커는 같은 크기의 파란색 원형 스티커를 씁니다(지름은 연구자 설정과 같아야 합니다).</li>
    </ol>`;
function bindRuler(root) { const b = $('#rulerBtn', root); if (b) b.onclick = () => download('foot-arch-placement-ruler.svg', placementRulerSvg(), 'image/svg+xml'); }
// ───── 스티커 부착 위치 안내 ─────
route('/stickers', '스티커 부착 위치', async (v) => {
  if (!S.exam) return go('#/guide');
  const toe = defaultToe(S.exam.foot);
  v.innerHTML = `${stepper(2)}
    <h2>${FOOT[S.exam.foot]} 스티커 부착</h2>
    <p class="muted small">${FOOT[S.exam.foot]}의 <b>안쪽 면</b>을 옆에서 본 그림입니다. ${S.exam.foot === 'left' ? '왼발 안쪽을 보면 발가락이 화면 오른쪽' : '오른발 안쪽을 보면 발가락이 화면 왼쪽'}을 향합니다.</p>
    ${footSvg(toe)}
    ${STICKER_STANDARD_HTML}
    <h3>주의사항</h3>
    <ul class="list small">
      <li>스티커가 구겨지거나 접히면 원형으로 인식되지 않습니다.</li>
      <li>양말·바지 밑단·손가락 등으로 스티커가 가려지지 않게 합니다.</li>
      <li>배경과 주변에 파란색 둥근 물체를 두지 마세요.</li>
      <li>검사 중(체중부하 전·후 사이)에는 스티커를 떼거나 옮기지 않습니다.</li>
      <li><b>위치가 잘못되었다면</b> 스티커를 떼고 다시 붙인 후 처음부터 촬영하세요. 촬영 후 앱이 위치가 이상하다고 안내하는 경우에도 다시 부착하세요.</li>
    </ul>
    <button class="btn primary block big" id="next">다음: 촬영 자세 안내</button>`;
  bindRuler(v);
  $('#next', v).onclick = () => go('#/posture');
});

// ───── 촬영 자세·카메라 위치 안내 ─────
route('/posture', '촬영 자세 안내', async (v) => {
  if (!S.exam) return go('#/guide');
  v.innerHTML = `${stepper(3)}
    <h2>촬영 자세와 카메라 위치</h2>
    <div class="card">
      <ol class="steps">
        <li>스마트폰을 바닥 가까이, 발 높이에 <b>고정</b>합니다(거치대·책 더미 등). 손으로 들고 찍지 않는 것이 좋습니다.</li>
        <li>카메라 렌즈가 발 <b>안쪽 면과 수직</b>이 되도록 놓습니다. 비스듬하면 스티커가 타원으로 보여 mm 환산이 불가합니다.</li>
        <li>반대쪽 발은 카메라 시야에서 비켜 둡니다.</li>
        <li>발 전체(발꿈치~엄지발가락)가 화면 가이드 안에 들어오도록 거리를 맞춥니다.</li>
        <li><b>체중부하 전·후 촬영 사이에 카메라를 움직이지 마세요.</b> 거리·각도가 달라지면 결과가 무효 처리됩니다.</li>
        <li>밝고 그림자가 적은 곳에서 촬영합니다.</li>
      </ol>
      <p class="small muted">자세의 세부 기준(무릎 각도·체중 분배 등)은 연구 프로토콜에 따르세요.</p>
    </div>
    <label class="f">화면에서 발가락이 향하는 방향</label>
    <div class="seg" id="toeSeg"><button data-v="left">← 왼쪽</button><button data-v="right">오른쪽 →</button></div>
    <p class="tiny">${FOOT[S.exam.foot]} 안쪽 면을 촬영하면 보통 ${S.exam.foot === 'left' ? '오른쪽' : '왼쪽'}입니다. 이 방향과 스티커 배치(가운데 점의 위치·높이)를 함께 사용해 P1·P2·P3를 구분합니다.</p>
    <div id="svgBox"></div>
    <button class="btn primary block big" id="next">체중부하 전 촬영 시작</button>`;
  const paint = () => { $$('#toeSeg button', v).forEach(b => b.classList.toggle('on', b.dataset.v === S.exam.toeDirection)); $('#svgBox', v).innerHTML = footSvg(S.exam.toeDirection); };
  $$('#toeSeg button', v).forEach(b => b.onclick = () => { S.exam.toeDirection = b.dataset.v; paint(); }); paint();
  $('#next', v).onclick = () => go('#/capture/pre');
});

// ───── 촬영 ─────
function stopCamera() {
  if (S.loopTimer) { clearInterval(S.loopTimer); S.loopTimer = null; }
  if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; }
}
function cameraErrorHelp(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '카메라 권한이 거부되었습니다. 브라우저 주소창의 자물쇠(또는 설정) 메뉴에서 카메라를 “허용”으로 바꾼 뒤 이 화면을 새로고침하세요. 앱 안 브라우저(메신저 등)에서는 권한이 막힐 수 있으니 Chrome·Safari로 열어 주세요.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '사용할 수 있는 카메라를 찾지 못했습니다. 카메라가 있는 기기에서 열거나 아래의 “사진 파일 불러오기”를 사용하세요.';
  if (n === 'NotReadableError' || n === 'AbortError') return '다른 앱이 카메라를 사용 중이거나 카메라를 열 수 없습니다. 다른 앱을 종료한 뒤 다시 시도하세요.';
  return '카메라를 시작할 수 없습니다: ' + (e && e.message || e);
}
route('/capture/:phase', '촬영', async (v, p) => {
  const phase = p.phase === 'post' ? 'post' : 'pre';
  if (!S.exam) return go('#/guide');
  if (phase === 'post' && !S.exam.pre) return go('#/capture/pre');
  $('#title').textContent = `${FOOT[S.exam.foot]} · ${PHASE[phase]} 촬영`;
  v.innerHTML = `${stepper(phase === 'pre' ? 4 : 5)}
    <div class="note info small">${phase === 'pre' ? '<b>체중부하 전</b>: 앉은 자세에서 발을 바닥에 가볍게 올리고 체중을 싣지 않습니다.' : '<b>체중부하 후</b>: 카메라를 움직이지 말고, 일어서서 양발에 체중을 고르게 싣습니다.'}</div>
    <div id="live">
      <div class="camwrap" id="camwrap"><video id="vid" playsinline muted autoplay></video><canvas id="ov"></canvas><div class="countdown" id="cd"></div></div>
      <div class="statusline" id="status" aria-live="polite">카메라 준비 중…</div><div class="tiny" id="hud" style="text-align:center"></div>
      <div class="checks" id="checks"></div>
      <div class="seg" id="autoSeg" style="margin:8px 0"><button data-v="1">3초 자동 촬영</button><button data-v="0">수동 촬영만</button></div>
      <button class="btn primary block big" id="shot">수동 촬영 (타이머)</button>
      <div class="grid2"><button class="btn" id="flip">카메라 전환</button><label class="btn" for="file">사진 파일 불러오기</label></div>
      <input type="file" id="file" accept="image/*" capture="environment" class="hide">
      <div id="camErr"></div>
    </div>
    <div id="review" class="hide"></div>`;
  let auto = true, readySince = 0, badFrames = 0, cdStart = 0, busy = false;
  const vid = $('#vid', v), ov = $('#ov', v), cd = $('#cd', v);
  const paintAuto = () => $$('#autoSeg button', v).forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === auto));
  $$('#autoSeg button', v).forEach(b => b.onclick = () => { auto = b.dataset.v === '1'; cancelCountdown(); paintAuto(); }); paintAuto();
  const tracker = createTracker({ video: vid, overlay: ov, wrap: $('#camwrap', v), getToe: () => S.exam.toeDirection, onFrame });
  async function start() {
    $('#camErr', v).innerHTML = ''; busy = false; cancelCountdown();
    try { await tracker.start(); $('#flip', v).disabled = tracker.deviceCount < 2; }
    catch (e) {
      $('#status', v).textContent = e.name === 'Unsupported' ? '카메라 사용 불가' : '카메라 오류';
      $('#camErr', v).innerHTML = `<div class="note bad">${esc(e.name === 'Unsupported' ? e.message : cameraErrorHelp(e))}</div>${e.name === 'Unsupported' ? '' : '<button class="btn block" id="retryCam">다시 시도</button>'}`;
      if ($('#retryCam', v)) $('#retryCam', v).onclick = start;
    }
  }
  function cancelCountdown(msg) { if (cdStart) { cdStart = 0; cd.textContent = ''; if (msg) toast(msg); } readySince = 0; badFrames = 0; }
  function onFrame(f) {
    if (busy) return;
    paintChecksInto($('#checks', v), f.c);
    $('#hud', v).textContent = `${f.fps} fps · ${f.roi ? '추적 모드' : '전체 검색'} · ${Detector.usingWorker ? '백그라운드 분석' : '기본 분석'}`;
    const now = performance.now();
    if (!auto) { $('#status', v).textContent = f.ready ? '준비 완료 — 수동 촬영 버튼을 누르세요' : '준비 상태 확인 중'; return; }
    if (cdStart) {
      badFrames = f.ready ? 0 : badFrames + 1;
      if (badFrames >= 2) return cancelCountdown('움직임·가림·품질 저하가 감지되어 촬영을 취소했습니다. 다시 준비 상태를 확인합니다.');
      const left = 3 - Math.floor((Date.now() - cdStart) / 1000);
      if (left <= 0) { cd.textContent = ''; cdStart = 0; capture('auto'); } else { cd.textContent = left; $('#status', v).textContent = '움직이지 마세요'; }
      return;
    }
    if (f.ready) { if (!readySince) readySince = now; $('#status', v).textContent = '준비 확인 중…'; if (now - readySince >= 500) { cdStart = Date.now(); cd.textContent = '3'; badFrames = 0; } }
    else { readySince = 0; $('#status', v).textContent = '가이드 안에 발을 맞춰 주세요'; }
  }
  // 단일 이미지(파일) 분석
  async function analyzeSource(src, mode) {
    busy = true;
    const { canvas, img } = imageDataFromSource(src, MAXSIDE);
    tracker.stop();
    await Detector.init();
    const det = await Detector.run(img, { toeDirection: S.exam.toeDirection });
    showReview(canvas, det, C.measureImage(det, convSettings()), mode);
  }
  // 연속 촬영(12프레임 평균)
  async function capture(mode) {
    if (!vid.videoWidth) return toast('카메라 영상이 아직 준비되지 않았습니다.', true);
    busy = true; tracker.pause(); cancelCountdown(); cd.innerHTML = '<span class="recbadge">● 촬영 중</span>'; $('#status', v).textContent = '연속 촬영 중… 움직이지 마세요';
    const r = await burstCapture(vid, S.exam.toeDirection, tracker.priorNorm(), tracker.rotation);
    cd.textContent = ''; tracker.stop();
    if (!r.canvas) { toast('카메라 프레임을 가져오지 못했습니다.', true); return start(); }
    showReview(r.canvas, r.det, r.meas, mode);
  }
  function showReview(canvas, det, meas, mode) {
    $('#live', v).classList.add('hide'); const r = $('#review', v); r.classList.remove('hide');
    const W = canvas.width, H = canvas.height;
    r.innerHTML = `<div class="camwrap" style="aspect-ratio:${W}/${H}"><canvas id="rv"></canvas></div>
      <div class="statusline">${det.ok ? '✓ 스티커 3개 검출 완료' : '✕ 측정을 진행할 수 없습니다'}</div>
      ${det.ok ? '' : `<div class="note bad"><b>재촬영이 필요합니다.</b><ul class="list">${det.reasons.map(x => `<li>${esc(x.msg)}</li>`).join('')}</ul></div>`}
      ${det.landmarks ? `<div class="card"><dl class="kv">
        <dt>검출 신뢰도</dt><dd>${pct(det.detectionConfidence)}</dd>
        <dt>종합 신뢰도(휴리스틱)</dt><dd>${pct(det.confidence)}</dd>
        <dt>경계 선명도</dt><dd>${det.quality.edgeWidthPx != null ? det.quality.edgeWidthPx.toFixed(1) + ' px' : '—'} ${det.quality.sharp ? '(선명)' : '(흐림)'}</dd>
        <dt>스티커 지름</dt><dd>${px(det.quality.diameterPx)}</dd>
        ${det.quality.burst ? `<dt>연속 촬영</dt><dd>${det.quality.burst.used}/${det.quality.burst.total} 프레임 사용 · 높이 SD ${det.quality.burst.heightSdPx.toFixed(2)} px</dd>` : ''}
        <dt>P2–기준선 거리</dt><dd>${px(meas.heightPx)}${meas.heightMm != null ? ' / ' + mm(meas.heightMm) : ''}</dd>
        <dt>mm 환산 상태</dt><dd>${statusBadge(meas.status)}</dd>
        <dt>바닥선</dt><dd>${meas.floor && meas.floor.ok ? `검출 · P2 높이 ${meas.floor.P2Mm != null ? mm(meas.floor.P2Mm) : px(meas.floor.P2Px)}` : '미확인'}</dd>
        ${meas.floor && meas.floor.P1Mm != null ? `<dt>P1·P3 부착 높이</dt><dd>${mm(meas.floor.P1Mm, 0)} / ${mm(meas.floor.P3Mm, 0)} <span class="tiny">(표준 20 mm)</span></dd>` : ''}
      </dl>${meas.status !== '측정 가능' && meas.notes.length ? `<ul class="list tiny">${meas.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p class="tiny">빨간 십자가 실제 검출된 스티커 중심, 노란 선이 P1–P3 기준선, 하늘색 점선이 P2에서 기준선까지의 수직거리입니다. 표시된 P1·P2·P3 위치가 실제 스티커와 다르면 다시 촬영하세요.</p></div>` : ''}
      ${det.ok ? '<button class="btn primary block big" id="use">이 사진 사용</button>' : ''}
      <button class="btn block" id="again">다시 촬영</button>`;
    const rv = $('#rv', r); const rr = rv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    rv.width = rr.width * dpr; rv.height = rr.height * dpr; const g = rv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = rr.width / W; g.drawImage(canvas, 0, 0, rr.width, H * k); drawOverlay(g, det, k);
    $('#again', r).onclick = () => { r.classList.add('hide'); $('#live', v).classList.remove('hide'); start(); };
    if (det.ok) $('#use', r).onclick = async () => {
      const rec = captureRecord(det, meas, mode, S.exam.toeDirection);
      if (S.settings.savePhotos) rec._blob = await blobFromCanvas(canvas);
      S.exam[phase] = rec;
      go(phase === 'pre' ? '#/capture/post' : '#/analyze');
    };
  }
  // 수동 촬영: 버튼을 누르면 타이머 후 촬영(다시 누르면 취소)
  let shotRef = null;
  $('#shot', v).onclick = async () => {
    if (shotRef) { shotRef.cancel = true; shotRef = null; $('#shot', v).textContent = '수동 촬영 (타이머)'; busy = false; return; }
    if (busy) return;
    busy = true; cancelCountdown(); shotRef = { cancel: false }; const my = shotRef;
    $('#shot', v).textContent = '타이머 취소';
    const okGo = await shutterCountdown(cd, null, null, my);
    if (shotRef === my) { shotRef = null; $('#shot', v).textContent = '수동 촬영 (타이머)'; }
    if (!okGo) { busy = false; return; }
    busy = false; capture('manual');
  };
  $('#flip', v).onclick = () => { tracker.flip().catch(e => toast(cameraErrorHelp(e), true)); };
  $('#file', v).onchange = e => {
    const f = e.target.files[0]; if (!f) return; tracker.stop();
    const im = new Image(); im.onload = () => { analyzeSource(im, 'upload'); URL.revokeObjectURL(im.src); };
    im.onerror = () => toast('이미지를 읽을 수 없습니다.', true); im.src = URL.createObjectURL(f);
  };
  start();
});

// ───── 분석 진행 ─────
async function activeModel() {
  if (!S.settings.activeModelId) return null;
  const m = await DB.get('models', S.settings.activeModelId).catch(() => null);
  return m && m.deployed ? m : null;
}
// 전·후 촬영으로 결과를 계산하고 저장한다(단계별 검사·음성 자가 검사 공용)
async function finalizeExam(ex, log) {
  log = log || (() => {});
  log(`기준점 좌표 확인: 전 신뢰도 ${pct(ex.pre.confidence)}, 후 신뢰도 ${pct(ex.post.confidence)}`);
  log(`픽셀 거리: 전 ${px(ex.pre.measure.heightPx)}, 후 ${px(ex.post.measure.heightPx)}`);
  const model = await activeModel();
  const cmp = C.comparePrePost(ex.pre.measure, ex.post.measure, convSettings(), model ? Object.assign({ version: model.version }, model.params) : null);
  log(`mm 환산 및 전·후 촬영 조건 비교: ${statusBadge(cmp.status)}`);
  const category = cmp.status === '측정 가능' ? C.classify(cmp.changeMm) : null;
  log(category ? `연구 기준 분류: ${catBadge(category)}` : '연구 기준 분류: mm 값이 없어 분류하지 않음');
  const sdPenalty = cmp.scaleDiff != null ? 1 - Math.min(1, cmp.scaleDiff / 0.05) * 0.3 : 1;
  const rec = {
    id: ex.id, createdAt: Date.now(), participantId: ex.participantId, foot: ex.foot, toeDirection: ex.toeDirection, method: ex.method || 'stepwise',
    pre: strip(ex.pre), post: strip(ex.post), comparison: cmp, category,
    measurementConfidence: Math.min(ex.pre.confidence, ex.post.confidence) * sdPenalty,
    algorithmVersion: C.ALGORITHM_VERSION, appVersion: APP_VERSION, calibrationModel: model ? model.version : null,
    conversion: convSettings(), isTest: false, selfReport: {}, loadRecognition: ex.loadRecognition || null
  };
  for (const ph of ['pre', 'post']) if (ex[ph]._blob) {
    const bid = uid(); if (await save('blobs', { id: bid, kind: 'image', examId: rec.id, phase: ph, blob: ex[ph]._blob, createdAt: Date.now() })) rec[ph].imageId = bid;
  }
  rec._saved = await save('exams', rec);
  if (rec._saved && typeof Account !== 'undefined') Account.syncSoon();
  log(rec._saved ? '검사 결과 저장 완료' : '<b>저장 실패</b> — 결과는 표시되지만 이력에 남지 않습니다.');
  S.lastResult = rec;
  return rec;
}
route('/analyze', 'AI 분석 및 측정', async (v) => {
  const ex = S.exam; if (!ex || !ex.pre || !ex.post) return go('#/guide');
  v.innerHTML = analyzingHtml();
  let n = 0;
  const rec = await finalizeExam(ex, t => { const li = document.createElement('li'); li.innerHTML = t; $('#prog', v).appendChild(li); setRing(v, ++n / 6); });
  setRing(v, 1);
  S.exam = null;
  await new Promise(r => setTimeout(r, 400)); go('#/result/' + rec.id);
});
function strip(r) { const o = Object.assign({}, r); delete o._blob; return o; }

// ───── 결과 ─────
async function examById(id) { return (S.lastResult && S.lastResult.id === id) ? S.lastResult : await DB.get('exams', id); }
route('/result/:id', '측정 결과', async (v, p) => {
  const e = await examById(p.id); if (!e) { v.innerHTML = '<div class="note bad">결과를 찾을 수 없습니다.</div>'; return; }
  const c = e.comparison, cat = e.category;
  const exs = cat ? (await DB.all('exercises')).filter(x => (S.settings.mapping[cat.key] || []).includes(x.id)) : [];
  const valOrPx = (m) => m.heightMm != null ? mm(m.heightMm) : px(m.heightPx);
  const preV = c.preMm != null ? mm(c.preMm) : valOrPx(e.pre.measure), postV = c.postMm != null ? mm(c.postMm) : valOrPx(e.post.measure);
  const explain = cat ? `체중부하 전·후 P2(발배뼈 부위)와 P1–P3 기준선 사이 거리가 ${mm(c.changeMm)} 변했습니다. 본 연구에서 설정한 기준(${cat.range})에 따라 “${cat.label}”으로 분류됩니다. 이 기준은 본 연구의 분류 기준이며 모든 임상 환경에서 검증된 진단 기준이 아닙니다.`
    : c.status === '보정 필요' ? `mm 환산 조건이 충족되지 않아 mm 값과 분류를 표시하지 않습니다. 픽셀 변화량(${px(c.changePx)})은 기록되었으며, 카메라 거리·해상도에 따라 달라지므로 다른 검사와 비교할 수 없습니다.`
    : '측정을 완료하지 못했습니다. 아래 원인을 확인하고 다시 검사해 주세요.';
  const ang = c.archAngle, fl = c.floor, deg = x => x == null ? '—' : x.toFixed(1) + '°';
  const metric = (icon, label, sub, val) => `<div class="metric"><span class="mi">${icon}</span><span class="lab">${label}${sub ? `<small>${sub}</small>` : ''}</span><span class="val">${val}</span></div>`;
  v.innerHTML = `${stepper(7)}
    <div class="row"><span class="badge b-info">${FOOT[e.foot]}</span><span class="tiny grow" style="color:rgba(255,255,255,.92);font-weight:600">${fmtDate(e.createdAt)} · ${esc(e.algorithmVersion)}${e.calibrationModel ? ' + ' + esc(e.calibrationModel) : ''}</span>${statusBadge(c.status)}</div>
    <div class="card hero-result">
      <span class="feet">${footprintsSvg('r')}</span>
      <div class="grow">
        <div class="tiny" style="font-weight:700;color:var(--ink-2)">발배뼈 하강 ${c.primary === 'floor' ? '(바닥 기준)' : ''}</div>
        <div class="result-big">${c.changeMm != null ? mm(c.changeMm) : '—'}</div>
        <div>${catBadge(cat)}</div>
        ${c.changeMm == null && c.changePx != null ? `<div class="tiny">픽셀 변화량 ${px(c.changePx)} (mm 아님)</div>` : ''}
      </div>
    </div>
    ${c.flags && c.flags.length ? `<div class="note warn">${c.flags.map(esc).join('<br>')}</div>` : ''}
    ${c.notes && c.notes.length ? `<div class="note ${c.status === '측정 가능' ? 'info' : 'warn'}"><ul class="list">${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
    <h3>분석 결과</h3>
    <div class="card" style="padding:6px 16px">
      ${metric(ICON.drop, 'P1–P3 기준선 하강', '연구 정의 · Nielsen 등 2009', c.lineChangeMm != null ? mm(c.lineChangeMm) : c.changePx != null ? px(c.changePx) : '—')}
      ${metric(ICON.height, '발배뼈 높이(바닥 기준)', '앉음 → 섬 · 표준 NDT 방식', fl ? `${mm(fl.preMm)} → ${mm(fl.postMm)}` : '<span class="tiny">바닥선 미확인</span>')}
      ${fl ? metric(ICON.drop, '바닥 기준 하강', '', mm(fl.dropMm)) : ''}
      ${metric(ICON.angle, '스티커 아치 각도', 'P3–P2–P1 · 앉음 → 섬', ang ? `${deg(ang.pre)} → ${deg(ang.post)}` : '—')}
      ${metric(ICON.check, '측정 신뢰도', '검출·선명도 기반 휴리스틱', pct(e.measurementConfidence))}
    </div>
    <button class="btn primary block big" id="detailBtn">상세 리포트 보기</button>
    <div id="detail" class="hide">
    <div class="card"><dl class="kv">
      <dt>체중부하 전</dt><dd>${preV}</dd>
      <dt>체중부하 후</dt><dd>${postV}</dd>
      <dt>이미지 품질</dt><dd>${e.pre.quality.sharp && e.post.quality.sharp ? '양호' : '흐림 있음'} (경계 ${e.pre.quality.edgeWidthPx?.toFixed(1)} / ${e.post.quality.edgeWidthPx?.toFixed(1)} px)</dd>
      <dt>스티커 검출 신뢰도</dt><dd>${pct(e.pre.detectionConfidence)} / ${pct(e.post.detectionConfidence)}</dd>
      <dt>측정 신뢰도(휴리스틱)</dt><dd>${pct(e.measurementConfidence)}</dd>
      <dt>전·후 축척 차이</dt><dd>${c.scaleDiff != null ? (c.scaleDiff * 100).toFixed(1) + '%' : '—'}</dd>
      <dt>촬영 방식</dt><dd>${modeLabel(e.pre.mode)} / ${modeLabel(e.post.mode)}</dd>
      ${e.loadRecognition ? `<dt>체중부하 인지</dt><dd>${loadRecText(e.loadRecognition)}</dd>` : ''}
    </dl><p class="tiny">신뢰도 값은 검출 형태·선명도에서 계산한 휴리스틱 지표이며, 실제 측정 정확도로 검증된 값이 아닙니다.</p></div>
    <div class="card"><b>발배뼈 하강 측정값</b><dl class="kv" style="margin-top:6px">
      <dt>P1–P3 기준선 하강<div class="tiny">연구 정의 · Nielsen 등 2009</div></dt><dd>${c.lineChangeMm != null ? mm(c.lineChangeMm) : c.changePx != null ? px(c.changePx) : '—'}</dd>
      <dt>바닥 기준 발배뼈 높이<div class="tiny">표준 NDT 방식</div></dt><dd>${c.floor ? `${mm(c.floor.preMm)} → ${mm(c.floor.postMm)}` : '<span class="tiny">바닥선 미확인</span>'}</dd>
      <dt>바닥 기준 하강</dt><dd>${c.floor ? mm(c.floor.dropMm) : '—'}</dd>
      ${c.floor ? `<dt>기준선 자체 내려앉음</dt><dd>${mm(c.floor.lineHeightChangeMm)}</dd>` : ''}
      <dt>분류에 쓴 값</dt><dd>${c.primary === 'floor' ? '바닥 기준 하강' : 'P1–P3 기준선 하강'}</dd>
    </dl>${(() => { const pl = (e.pre.measure.floor && e.pre.measure.floor.placementNotes) || []; const why = !c.floor ? [e.pre.measure.floor, e.post.measure.floor].filter(f => f && !f.ok).map(f => f.reason)[0] : null; return (pl.length ? `<div class="note warn small">${pl.map(esc).join('<br>')} 다음 검사에서는 부착 자로 위치를 맞춰 주세요.</div>` : '') + (why ? `<p class="tiny">바닥선을 쓰지 못한 이유: ${esc(why)}</p>` : ''); })()}
    </div>
    </div>
    <div class="card"><b>결과 설명</b><p class="small">${esc(explain)}</p></div>
    ${flexSectionHtml(e)}
    <div id="imgs"></div>
    <h3>운동 중재</h3>
    ${cat ? (exs.length ? exs.map(x => `<a class="list-item card" style="margin:6px 0" href="#/exercise/${x.id}?exam=${e.id}"><span class="grow"><b>${esc(x.name)}</b><br><span class="tiny">${x.videoBlobId || x.videoUrl ? '영상 있음' : '영상 등록 필요'}</span></span>›</a>`).join('')
      : `<div class="note warn small">“${esc(cat.label)}” 분류에 연결된 운동이 아직 지정되지 않았습니다. 관리자가 운동 콘텐츠 관리 화면에서 지정해야 합니다.</div><a class="btn block" href="#/exercises">전체 운동 목록 보기</a>`)
      : '<p class="small muted">유효한 분류 결과가 있을 때 맞춤 운동이 연결됩니다.</p>'}
    <p class="tiny">${esc(DISCLAIMER)}</p>
    <div class="grid2"><button class="btn primary" id="other">${FOOT[e.foot === 'left' ? 'right' : 'left']} 검사</button><a class="btn" href="#/history">검사 이력</a></div>
    <button class="btn ghost block" id="del">이 결과 삭제</button>`;
  bindFlexSection(v, e);
  $('#detailBtn', v).onclick = () => { const d = $('#detail', v); d.classList.toggle('hide'); $('#detailBtn', v).textContent = d.classList.contains('hide') ? '상세 리포트 보기' : '상세 리포트 접기'; };
  $('#other', v).onclick = () => go(e.method === 'voice' ? '#/self?feet=' + (e.foot === 'left' ? 'right' : 'left') : '#/guide?foot=' + (e.foot === 'left' ? 'right' : 'left'));
  $('#del', v).onclick = async () => { if (await confirmModal('이 검사 결과를 삭제할까요? 되돌릴 수 없습니다.', '삭제', true)) { await deleteExam(e); toast('삭제했습니다.'); go('#/history'); } };
  // 저장된 사진이 있으면 저장된 좌표와 함께 표시
  for (const ph of ['pre', 'post']) if (e[ph].imageId) {
    const b = await DB.get('blobs', e[ph].imageId).catch(() => null); if (!b) continue;
    const im = new Image(); im.src = URL.createObjectURL(b.blob); await im.decode().catch(() => {});
    const box = document.createElement('div'); box.className = 'card'; box.innerHTML = `<div class="tiny">${PHASE[ph]} 사진 (저장된 검출 좌표 표시)</div><canvas style="width:100%;aspect-ratio:${im.naturalWidth}/${im.naturalHeight}"></canvas>`;
    $('#imgs', v).appendChild(box); const cvs = $('canvas', box); const { g, w } = setupCanvas(cvs); const k = w / im.naturalWidth;
    g.drawImage(im, 0, 0, w, im.naturalHeight * k);
    drawOverlay(g, { stickers: e[ph].stickers, landmarks: e[ph].landmarks }, k);
  }
});
function loadRecText(r) {
  const f = r.final || {}, pc = x => (x * 100).toFixed(1) + '%';
  const shape = r.confirmed ? (f.by === 'drop' || (r.live && r.live.by === 'drop') ? '아치 하강 확인' : '발 길이 변화 확인') : '형태 변화 작음';
  return `${r.transitionSeen ? '일어섬 확인' : '동작 미확인'} · ${shape}<div class="tiny">아치 하강 ${(f.drop || 0).toFixed(2)}×스티커 지름 · 발 길이 ${f.spanGain >= 0 ? '+' : ''}${pc(f.spanGain || 0)}</div>`;
}
function modeLabel(m) { return { auto: '자동', manual: '수동', upload: '파일', voice: '음성 자동' }[m] || m; }
async function deleteExam(e, localOnly) {
  for (const ph of ['pre', 'post']) if (e[ph] && e[ph].imageId) await DB.del('blobs', e[ph].imageId).catch(() => {});
  await DB.del('exams', e.id);
  if (!localOnly && e._syncedAt && typeof Account !== 'undefined' && Account.loggedIn) await Account.removeRemote('exams', e.id).catch(err => toast('서버 기록 삭제 실패: ' + err.message, true));
}

// ───── 운동 목록 · 상세 ─────
function hasPrescription(x) { return [x.reps, x.sets, x.holdSec, x.perWeek].some(v => v !== '' && v != null); }
route('/exercise/:id', '운동', async (v, p) => {
  const x = await DB.get('exercises', p.id); if (!x) { v.innerHTML = '<div class="note bad">운동을 찾을 수 없습니다.</div>'; return; }
  let src = null;
  if (x.videoBlobId) { const b = await DB.get('blobs', x.videoBlobId).catch(() => null); if (b) src = URL.createObjectURL(b.blob); }
  if (!src && x.videoUrl) src = x.videoUrl;
  const pv = (val, unit) => val === '' || val == null ? '<span class="badge b-warn">연구 프로토콜 값 미입력</span>' : esc(val) + (unit ? ' ' + unit : '');
  v.innerHTML = `<h2>${esc(x.name)}</h2>
    ${x.reviewed ? '' : '<div class="note warn small">이 콘텐츠는 초안이며 아직 연구자 검토를 거치지 않았습니다.</div>'}
    ${src ? `<video class="ex" id="vid" src="${esc(src)}" controls playsinline preload="metadata"></video><div class="grid2" style="margin-top:6px"><button class="btn" id="play">재생</button><button class="btn" id="replay">처음부터 다시 보기</button></div><p class="tiny" id="watch">시청 시간 0초</p>`
      : '<div class="placeholder"><b>영상 등록 필요</b><br><span class="small">관리자가 아직 이 운동의 영상을 등록하지 않았습니다.</span></div>'}
    <div class="card"><dl class="kv">
      <dt>반복 횟수</dt><dd>${pv(x.reps, '회')}</dd><dt>세트 수</dt><dd>${pv(x.sets, '세트')}</dd>
      <dt>유지 시간</dt><dd>${pv(x.holdSec, '초')}</dd><dt>주당 빈도</dt><dd>${pv(x.perWeek, '회/주')}</dd>
    </dl>${x.source ? `<p class="tiny">근거: ${esc(x.source)}</p>` : ''}</div>
    <div class="card"><b>운동 목적</b><p class="small">${esc(x.purpose || '—')}</p><b>올바른 자세</b><p class="small">${esc(x.posture || '—')}</p>
      <b>수행 방법</b><ol class="steps small">${(x.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <b>주의사항</b><ul class="list small">${(x.cautions || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    <div class="card"><b>수행 기록</b>
      <div class="grid2"><div><label class="f" for="aSets">실제 세트 수(선택)</label><input id="aSets" inputmode="numeric"></div><div><label class="f" for="aReps">세트당 반복(선택)</label><input id="aReps" inputmode="numeric"></div></div>
      <label class="f" for="memo">메모(선택)</label><input id="memo" maxlength="200">
      <button class="btn primary block big" id="done" style="margin-top:12px">운동 완료</button></div>`;
  let watched = 0, last = null;
  const vid = $('#vid', v);
  if (vid) {
    vid.addEventListener('timeupdate', () => { if (!vid.paused && last != null) { const d = vid.currentTime - last; if (d > 0 && d < 1.5) watched += d; } last = vid.currentTime; $('#watch', v).textContent = `시청 시간 ${Math.round(watched)}초`; });
    vid.addEventListener('seeking', () => { last = null; });
    vid.addEventListener('error', () => { vid.replaceWith(Object.assign(document.createElement('div'), { className: 'note bad', textContent: '영상을 재생할 수 없습니다. 파일 형식이나 주소를 관리자에게 확인해 주세요.' })); });
    $('#play', v).onclick = () => vid.play().catch(() => toast('재생할 수 없습니다.', true));
    $('#replay', v).onclick = () => { vid.currentTime = 0; vid.play().catch(() => {}); };
  }
  $('#done', v).onclick = async () => {
    const sets = num($('#aSets', v).value), reps = num($('#aReps', v).value);
    if (Number.isNaN(sets) || Number.isNaN(reps) || (sets != null && sets < 0) || (reps != null && reps < 0)) return toast('세트·반복 수는 0 이상의 숫자로 입력해 주세요.', true);
    const linked = p.q.exam ? await DB.get('exams', p.q.exam).catch(() => null) : null;
    const ok = await save('logs', { id: uid(), date: Date.now(), exerciseId: x.id, exerciseName: x.name, completed: true, watchedSec: Math.round(watched), actualSets: sets, actualReps: reps, memo: $('#memo', v).value.trim(), examId: linked ? linked.id : null, foot: linked ? linked.foot : null, participantId: S.settings.participantId || '' });
    if (ok) { Account.syncSoon(); toast('운동 완료 기록을 저장했습니다.'); go('#/logs'); }
  };
});

// ───── 운동 수행 기록 ─────
route('/logs', '운동 수행 기록', async (v) => {
  const logs = (await DB.all('logs')).sort((a, b) => b.date - a.date);
  const days = new Set(logs.map(l => fmtDate(l.date, false)));
  v.innerHTML = `<h2>운동 수행 기록</h2>
    <div class="card"><dl class="kv"><dt>완료한 운동</dt><dd>${logs.length}회</dd><dt>운동한 날</dt><dd>${days.size}일</dd><dt>최근 7일</dt><dd>${logs.filter(l => l.date > Date.now() - 7 * 864e5).length}회</dd></dl></div>
    <div class="card">${logs.length ? logs.map(l => `<div class="list-item"><span class="grow"><b>${esc(l.exerciseName)}</b> <span class="badge b-good">완료</span><br><span class="tiny">${fmtDate(l.date)} · 시청 ${l.watchedSec || 0}초${l.actualSets != null ? ` · ${l.actualSets}세트` : ''}${l.actualReps != null ? ` × ${l.actualReps}회` : ''}${l.foot ? ' · ' + FOOT[l.foot] + ' 결과 연계' : ''}${l.memo ? ' · ' + esc(l.memo) : ''}</span></span><button class="btn sm ghost" data-del="${l.id}" aria-label="기록 삭제">삭제</button></div>`).join('') : '<p class="muted">아직 기록이 없습니다. 운동 화면에서 “운동 완료”를 누르면 저장됩니다.</p>'}</div>`;
  $$('[data-del]', v).forEach(b => b.onclick = async () => { if (await confirmModal('이 운동 기록을 삭제할까요?', '삭제', true)) { await DB.del('logs', b.dataset.del); render(); } });
});

// ───── 검사 이력 ─────
route('/history', '검사 이력', async (v, p) => {
  const f = p.q.foot || 'all';
  const all = (await DB.all('exams')).filter(e => !e.isTest).sort((a, b) => b.createdAt - a.createdAt);
  const list = all.filter(e => f === 'all' || e.foot === f);
  const valid = all.filter(e => e.comparison.changeMm != null);
  const latest = ft => valid.find(e => e.foot === ft);
  const L = latest('left'), R = latest('right');
  v.innerHTML = `<h2>검사 이력</h2>
    <div class="seg" id="fseg">${[['all', '전체'], ['left', '왼발'], ['right', '오른발']].map(([k, l]) => `<button data-v="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card"><b>발 아치 높이 변화량 추이 (mm)</b>
      ${valid.length ? `<div class="legend"><span><i style="background:var(--series-1)"></i>왼발</span><span><i style="background:var(--series-2)"></i>오른발</span></div><canvas class="chart" id="ch" aria-label="변화량 그래프"></canvas><p class="tiny">mm 환산이 유효한 검사만 표시합니다. 점선은 연구 분류 경계(5·10·15mm)입니다.</p>`
      : '<p class="muted small">mm 값이 확보된 검사가 아직 없어 그래프를 그릴 수 없습니다.</p>'}</div>
    <div class="card"><b>좌우 발 비교(가장 최근 유효 결과)</b>
      <div class="grid2" style="margin-top:8px">${[['left', L], ['right', R]].map(([ft, e]) => `<div><div class="tiny">${FOOT[ft]}</div>${e ? `<div style="font-size:22px;font-weight:800">${mm(e.comparison.changeMm)}</div>${catBadge(e.category)}<div class="tiny">${fmtDate(e.createdAt, false)}</div>` : '<div class="muted small">유효 결과 없음</div>'}</div>`).join('')}</div>
      ${L && R ? `<p class="small">좌우 차이 ${mm(Math.abs(L.comparison.changeMm - R.comparison.changeMm))}. 측정 오차와 촬영 조건 차이를 함께 고려하세요.</p>` : ''}</div>
    <a class="btn block" href="#/compare">중재 전·후 결과 비교</a>
    <h3>전체 기록 (${list.length})</h3>
    <div class="card">${list.length ? list.map(e => `<a class="list-item" href="#/result/${e.id}"><span class="badge b-info">${FOOT[e.foot]}</span><span class="grow small">${fmtDate(e.createdAt)}<br>${e.comparison.changeMm != null ? '<b>' + mm(e.comparison.changeMm) + '</b> ' + catBadge(e.category) : statusBadge(e.comparison.status)}</span>›</a>`).join('') : '<p class="muted">검사 기록이 없습니다.</p>'}</div>`;
  $$('#fseg button', v).forEach(b => b.onclick = () => go('#/history?foot=' + b.dataset.v));
  if (valid.length) {
    const ser = ['left', 'right'].filter(ft => f === 'all' || f === ft).map(ft => ({ name: FOOT[ft], color: ft === 'left' ? '#2a78d6' : '#eb6834', points: valid.filter(e => e.foot === ft).map(e => ({ x: e.createdAt, y: C.roundMm(e.comparison.changeMm), label: `${fmtDate(e.createdAt)} ${mm(e.comparison.changeMm)}` })) })).filter(s => s.points.length);
    if (ser.length) lineChart($('#ch', v), ser, { yMin: 0, bands: [{ y: 5, label: '5' }, { y: 10, label: '10' }, { y: 15, label: '15' }] });
  }
});

// ───── 중재 전·후 비교 ─────
async function knownErrorMae() {
  const m = await activeModel(); if (m && m.testAfter) return { mae: m.testAfter.mae, src: `배포된 보정 모델 ${m.version}의 독립 시험 MAE` };
  const rows = (await DB.all('errors')).filter(r => r.reviewStatus === 'reviewed' && r.refConfirmed);
  if (rows.length >= 5) { const met = C.errorMetrics(rows.map(r => ({ ai: r.aiMm, ref: r.refMm }))); return { mae: met.mae, src: `연구자 검토 자료 ${met.n}건의 MAE` }; }
  return null;
}
route('/compare', '중재 전·후 비교', async (v, p) => {
  const foot = p.q.foot || 'left';
  const valid = (await DB.all('exams')).filter(e => !e.isTest && e.foot === foot && e.comparison.changeMm != null).sort((a, b) => a.createdAt - b.createdAt);
  const logs = await DB.all('logs');
  const err = await knownErrorMae();
  const a = valid.find(e => e.id === p.q.a) || valid[0], b = valid.find(e => e.id === p.q.b) || valid[valid.length - 1];
  const opt = (sel) => valid.map(e => `<option value="${e.id}" ${sel && sel.id === e.id ? 'selected' : ''}>${fmtDate(e.createdAt)} · ${mm(e.comparison.changeMm)}</option>`).join('');
  let body = '<p class="muted">비교하려면 같은 발의 유효(mm) 검사가 2건 이상 필요합니다.</p>';
  if (valid.length >= 2 && a && b && a.id !== b.id) {
    const d = b.comparison.changeMm - a.comparison.changeMm;
    const between = logs.filter(l => l.date > a.createdAt && l.date < b.createdAt).length;
    const interp = !err ? '측정 오차가 아직 검증되지 않아 이 차이가 실제 변화인지 판단할 수 없습니다.'
      : Math.abs(d) <= err.mae ? `차이(${mm(Math.abs(d))})가 알려진 측정 오차(${err.src}: ${mm(err.mae)}) 이내이므로 실제 변화라고 보기 어렵습니다.`
      : `차이가 알려진 측정 오차(${mm(err.mae)})보다 크지만, 촬영 조건·스티커 재부착 위치의 차이도 영향을 줄 수 있어 해부학적 개선으로 단정할 수 없습니다.`;
    body = `<div class="grid2"><div class="card" style="margin:0"><div class="tiny">중재 전</div><b style="font-size:20px">${mm(a.comparison.changeMm)}</b><br>${catBadge(a.category)}</div><div class="card" style="margin:0"><div class="tiny">중재 후</div><b style="font-size:20px">${mm(b.comparison.changeMm)}</b><br>${catBadge(b.category)}</div></div>
      <div class="card"><dl class="kv"><dt>변화량 차이</dt><dd>${d > 0 ? '+' : ''}${mm(d)}</dd><dt>두 검사 사이 운동 완료</dt><dd>${between}회</dd><dt>검사 간 축척(촬영 조건)</dt><dd>${(a.pre.measure.mmPerPx * 1000).toFixed(1)} / ${(b.pre.measure.mmPerPx * 1000).toFixed(1)} µm/px</dd></dl></div>
      <div class="note info small">${esc(interp)}</div>`;
  }
  v.innerHTML = `<h2>중재 전·후 비교</h2>
    <div class="seg" id="fseg">${['left', 'right'].map(k => `<button data-v="${k}" class="${foot === k ? 'on' : ''}">${FOOT[k]}</button>`).join('')}</div>
    ${valid.length >= 2 ? `<label class="f">중재 전 검사</label><select id="sa">${opt(a)}</select><label class="f">중재 후 검사</label><select id="sb">${opt(b)}</select>` : ''}
    <div style="margin-top:12px">${body}</div>`;
  $$('#fseg button', v).forEach(bt => bt.onclick = () => go('#/compare?foot=' + bt.dataset.v));
  if (valid.length >= 2) { const upd = () => go(`#/compare?foot=${foot}&a=${$('#sa', v).value}&b=${$('#sb', v).value}`); $('#sa', v).onchange = upd; $('#sb', v).onchange = upd; }
});

// ───── 설정 · 개인정보 ─────
route('/settings', '설정 및 개인정보', async (v) => {
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const accHtml = await accountCardHtml();
  v.innerHTML = `<h2>설정 및 개인정보</h2>${accHtml}
    ${DB.persistentFailed ? `<div class="note bad"><b>영구 저장소를 사용할 수 없습니다.</b> (${esc(DB.persistentFailed)}) 기록이 새로고침 시 사라집니다. 사생활 보호(시크릿) 모드를 끄거나 다른 브라우저를 사용하세요.</div>` : ''}
    <div class="card"><label class="f" for="pid">연구 참여자 ID (익명)</label>
      <input id="pid" value="${esc(S.settings.participantId)}" placeholder="예: P001" maxlength="20" autocomplete="off">
      <p class="tiny">이름·연락처 등 실명 정보를 넣지 마세요. 영문·숫자·-·_ 만 사용할 수 있습니다.</p>
      <label class="f" for="dia">스티커 실제 지름 (mm)</label>
      <input id="dia" type="number" inputmode="decimal" step="0.1" min="3" max="40" value="${esc(String(S.settings.stickerDiameterMm || 16))}">
      <p class="tiny">mm 값은 이 지름을 기준으로 계산합니다. 자로 잰 실제 지름을 넣으세요(지금 쓰는 스티커: 16 mm).</p>
      <label class="chk"><input type="checkbox" id="photos" ${S.settings.savePhotos ? 'checked' : ''}><span class="small"><b>촬영 사진을 이 기기에 저장</b><br>끄면 사진은 분석 직후 버려지고 스티커 좌표·측정값만 저장됩니다. 연구자 검토(이미지 참조)를 위해서는 켜야 합니다.</span></label>
      <button class="btn primary block" id="saveS">저장</button></div>
    <div class="card"><b>데이터 보관 방식</b>
      <p class="small">기록은 먼저 이 기기(브라우저)에 저장됩니다. 로그인하면 측정값이 서버와 동기화되고, 사진은 올리지 않습니다. 로그인하지 않으면 브라우저 데이터를 지울 때 기록도 삭제됩니다.</p>
      ${est ? `<p class="tiny">사용 중 ${(est.usage / 1048576).toFixed(1)}MB / 허용 ${(est.quota / 1048576).toFixed(0)}MB</p>` : ''}
      <button class="btn block" id="exp">내 데이터 내보내기(JSON)</button>
      <button class="btn danger block" id="wipe">내 검사·운동 기록 모두 삭제</button></div>
    <div class="card small"><dl class="kv"><dt>앱 버전</dt><dd>${APP_VERSION}</dd><dt>측정 알고리즘</dt><dd>${C.ALGORITHM_VERSION}</dd><dt>스티커 지름 설정</dt><dd>${S.settings.stickerDiameterMm ? S.settings.stickerDiameterMm + ' mm' : '미설정'}</dd><dt>mm 환산</dt><dd>${esc(convBasisText())}</dd></dl></div>
    <a class="btn block" href="#/r/home">연구자·관리자 모드</a>`;
  bindAccountCard(v);
  $('#saveS', v).onclick = async () => {
    const pid = $('#pid', v).value.trim();
    if (pid && !/^[A-Za-z0-9_-]{1,20}$/.test(pid)) return toast('참여자 ID는 영문·숫자·-·_ 20자 이내로 입력해 주세요.', true);
    const d = parseFloat($('#dia', v).value);
    if (!(d >= 3 && d <= 40)) return toast('스티커 지름은 3~40 mm 사이로 입력해 주세요.', true);
    if (d !== S.settings.stickerDiameterMm) { S.settings.stickerDiameterMm = d; S.settings.diameterSource = 'user'; }
    S.settings.participantId = pid; S.settings.savePhotos = $('#photos', v).checked;
    if (await saveSettings()) toast('설정을 저장했습니다.');
  };
  $('#exp', v).onclick = async () => { const data = { exportedAt: new Date().toISOString(), app: APP_VERSION, exams: await DB.all('exams'), logs: await DB.all('logs') }; download(`foot-arch-my-data-${Date.now()}.json`, JSON.stringify(data, null, 1)); };
  $('#wipe', v).onclick = async () => {
    if (!await confirmModal('이 기기에 저장된 모든 검사 결과, 사진, 운동 기록을 삭제합니다. 되돌릴 수 없습니다.', '모두 삭제', true)) return;
    for (const e of await DB.all('exams')) await deleteExam(e, true);
    await DB.clear('logs'); S.lastResult = null; toast(Account.loggedIn ? '이 기기의 기록을 삭제했습니다(서버 기록은 회원 탈퇴 시 삭제).' : '삭제했습니다.'); render();
  };
});
