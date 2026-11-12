'use strict';
/* ═════════════ 음성 안내 자가 검사 · 유연성 평발 자가 확인 · 관리 ═════════════ */

// 위에서 본 배치: 두 발 사이에 휴대폰을 가로로 세우고, 뒷면 카메라가 검사할 발 안쪽을 향함
function phoneSetupSvg(foot) {
  const left = foot !== 'right';
  const footShape = x => `<path d="M${x - 26} 150 C${x - 34} 110 ${x - 30} 60 ${x - 14} 34 C${x - 6} 20 ${x + 10} 20 ${x + 18} 34 C${x + 32} 60 ${x + 30} 110 ${x + 24} 150 C${x + 20} 170 ${x - 20} 172 ${x - 26} 150 Z" fill="#f1d3bf" stroke="#b98d72" stroke-width="2"/>`;
  const lx = 90, rx = 230, px = 160;
  const camX = left ? px - 10 : px + 10, arrowTo = left ? lx + 34 : rx - 34;
  return `<svg class="foot-svg" viewBox="0 0 320 200" role="img" aria-label="두 발 사이에 휴대폰을 세워 ${left ? '왼발' : '오른발'} 안쪽을 촬영하는 배치(위에서 본 모습)">
    <text x="160" y="16" font-size="11" text-anchor="middle" fill="#4a5a5c">위에서 본 모습 · 발가락 방향 ↑</text>
    ${footShape(lx)}${footShape(rx)}
    <text x="${lx}" y="190" font-size="11" text-anchor="middle" fill="#10201f" font-weight="${left ? 700 : 400}">왼발</text>
    <text x="${rx}" y="190" font-size="11" text-anchor="middle" fill="#10201f" font-weight="${left ? 400 : 700}">오른발</text>
    <rect x="${px - 8}" y="70" width="16" height="64" rx="4" fill="#10201f"/>
    <circle cx="${camX}" cy="84" r="3.5" fill="#7cb7ff"/>
    <line x1="${camX}" y1="102" x2="${arrowTo}" y2="102" stroke="#1f5fd1" stroke-width="2" stroke-dasharray="4 3" marker-end="url(#ar)"/>
    <defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#1f5fd1"/></marker></defs>
    <text x="160" y="150" font-size="10" text-anchor="middle" fill="#4a5a5c">휴대폰</text><text x="160" y="162" font-size="10" text-anchor="middle" fill="#4a5a5c">(가로로 세움)</text>
  </svg>`;
}

route('/self', '측정하기', async (v, p) => {
  const feetSel = 'right'; // 고정촬영판: 측정은 오른발로 통일
  const cv = convSettings();
  v.innerHTML = `${stepper(1)}
    <div class="card shoot-card">
      <h3>발 사진을 촬영해주세요</h3>
      <p class="sub">휴대폰을 두 발 사이에 가로로 세우고 아래 순서대로 진행합니다. 음성이 단계마다 알려 드립니다.</p>
      <ol class="flow">
        <li><b>촬영 버튼</b><span>누르면 “준비해 주세요” 음성 안내가 나옵니다. 휴대폰을 놓고 앉습니다</span></li>
        <li><b>스티커가 고정되면 촬영</b><span>25 cm 거리에서 P1·P2·P3가 움직이지 않으면 앉은 자세를 찍습니다</span></li>
        <li><b>일어서기</b><span>그대로 일어서면 AI가 체중부하를 확인하고 선 자세를 찍습니다</span></li>
      </ol>
      <div class="note info small" style="text-align:center">측정하는 발: <b>오른발</b> (측정·Y-balance 모두 오른발로 통일)</div>
      <div class="bracket"><i></i><div id="svgBox"></div></div>
      <button class="shutter" id="go" aria-label="촬영 시작">${ICON.camera}</button>
      <div class="tiny" id="goHint" style="margin-top:4px"></div>
      <div class="optrow"><span>음성 안내</span><label class="chk" style="margin:0"><input type="checkbox" id="voiceOn" ${Voice.enabled ? 'checked' : ''}><span class="small">켜기</span></label></div>
    </div>
    <details class="card"><summary>촬영 방법 보기</summary><ol class="steps small" style="margin-top:10px">
      <li>발 안쪽에 지름 ${esc(String(S.settings.stickerDiameterMm || 19))} mm 파란 스티커 3개를 붙입니다. <a href="#/stickers-info">부착 위치 보기</a></li>
      <li>의자에 앉아 두 발을 바닥에 편하게 둡니다.</li>
      <li>휴대폰을 <b>가로로 세워 두 발 사이 바닥</b>에 두고, <b>뒷면 카메라</b>가 검사할 발 안쪽을 향하게 합니다. 촬영 거리는 발 안쪽에서 <b>25 cm로 고정</b>합니다(±2.5 cm). 렌즈는 바닥에서 1~3 cm 띄우고 기본 1× 렌즈를 씁니다. 거리가 맞을 때까지 음성으로 안내하고, 맞으면 찍습니다. 처음 한 번은 자로 25 cm를 맞춘 뒤 촬영 화면의 <b>“자로 25 cm 맞췄어요”</b>를 눌러 이 휴대폰의 거리를 보정해 주세요.</li>
      <li><b>촬영 버튼</b>을 누릅니다. “준비해 주세요” 음성 안내가 나오면 휴대폰을 놓고 의자에 앉습니다. 25 cm 거리에서 스티커 세 개(P1·P2·P3)가 움직이지 않을 때까지 기다렸다가 찍으므로 서두르지 않아도 됩니다.</li>
      <li>AI가 스티커 3개의 색을 찾고, 실제 발 윤곽을 따라 선을 그립니다. 스티커가 모두 보이고 윤곽이 <b>초록색</b>이 되면 “발이 정확히 들어왔습니다 → 앉은 자세를 촬영합니다” 후 자동으로 찍습니다.</li>
      <li>“이제 일어서서, 체중부하 해주십시오” 안내가 나오면 <b>휴대폰은 그대로 두고</b> 일어섭니다. 앱이 일어서는 동작과 발 모양 변화를 확인한 뒤 “체중부하 확인했습니다. 촬영합니다”라고 말하고 선 자세를 찍습니다(타이머 없음).</li>
      <li>“검사가 끝났습니다” 안내 후 결과 화면이 열립니다. 다른 발도 검사하려면 결과 화면에서 따로 시작합니다.</li>
      <li>검사 중에는 <b>휴대폰을 움직이지 마세요.</b></li>
    </ol></details>
    <div class="links"><a href="#/guide">단계별 검사(직접 촬영)</a><a href="#/settings">스티커 지름 ${esc(String(S.settings.stickerDiameterMm || 19))} mm</a></div>
    <p class="tiny" style="text-align:center">${esc(DISCLAIMER)}</p>`;
  $('#goHint', v).textContent = '누르면 “준비해 주세요” 음성 안내 후 바로 시작합니다';
  let sel = feetSel;
  const paint = () => { $$('#feetSeg button', v).forEach(b => b.classList.toggle('on', b.dataset.v === sel)); $('#svgBox', v).innerHTML = phoneSetupSvg(sel === 'right' ? 'right' : 'left'); };
  $$('#feetSeg button', v).forEach(b => b.onclick = () => { sel = b.dataset.v; paint(); }); paint();
  $('#go', v).onclick = () => {
    S.settings.postMode = 'ai'; S.settings.privacyAck = true; saveSettings();
    Voice.enabled = $('#voiceOn', v).checked; Voice.unlock(); Orient.request();
    S.selfRun = { feet: [sel], results: [] };
    go('#/self/run');
  };
});

// 스티커 위치 안내(자가 검사에서 바로 볼 수 있게 별도 경로)
route('/stickers-info', '스티커 부착 위치', async (v) => {
  v.innerHTML = `<h2>스티커 부착 위치</h2>
    <div class="seg" id="fs"><button data-v="left" class="on">왼발</button><button data-v="right">오른발</button></div><div id="box" style="margin-top:10px"></div>
    ${STICKER_STANDARD_HTML}
    <a class="btn block" href="#/self">자가 검사로 돌아가기</a>`;
  bindRuler(v);
  const paint = f => { $$('#fs button', v).forEach(b => b.classList.toggle('on', b.dataset.v === f)); $('#box', v).innerHTML = footSvg(defaultToe(f)); };
  $$('#fs button', v).forEach(b => b.onclick = () => paint(b.dataset.v)); paint('left');
});

route('/self/run', '측정하기', async (v) => {
  const run = S.selfRun; if (!run) return go('#/self');
  v.innerHTML = `${stepper(1)}
    <div class="run"><div class="run-cam">
    <div class="row" style="margin-top:-4px"><span class="badge b-info" id="footBadge"></span><span class="grow"></span><span class="badge" id="phaseBadge"></span></div>
    <div class="bracket" style="margin-top:6px"><i></i><div class="camwrap" id="camwrap"><video id="vid" playsinline muted autoplay></video><canvas id="ov"></canvas><div class="countdown" id="cd"></div></div></div>
    </div><div class="run-side">
    <div class="statusline" id="status" aria-live="polite">카메라 준비 중…</div><div style="text-align:center;margin-top:4px"><div class="note warn small hide" id="calNote" style="margin:4px 0">처음 한 번: 자로 재서 휴대폰 렌즈를 발 안쪽에서 정확히 <b>${TARGET_DIST_CM} cm</b>에 두고 아래 <b>“자로 ${TARGET_DIST_CM} cm 맞췄어요”</b>를 눌러 주세요(휴대폰마다 화각이 달라요).</div><span class="badge hide" id="distBadge"></span> <button class="btn ghost small hide" id="distCal" style="padding:4px 10px">자로 ${TARGET_DIST_CM} cm 맞췄어요</button></div><div class="tiny" id="hud" style="text-align:center"></div>
    <div class="checks compact" id="checks"></div>
    <div style="text-align:center"><button class="shutter hide" id="postNow" aria-label="지금 선 자세 촬영">${ICON.camera}</button><div class="tiny hide" id="postNowHint">지금 선 자세 촬영</div></div>
    <div class="iconbar"><button id="mute">${Voice.enabled ? ICON.vol : ICON.volOff}<span>${Voice.enabled ? '음성 켬' : '음성 끔'}</span></button><button id="cam">${ICON.camera}<span>카메라</span></button><button id="rot">${ICON.rotate}<span>방향 자동</span></button><button id="stop">${ICON.stop}<span>중지</span></button></div>
    </div></div>
    <div class="card small" id="loadCard" style="display:none"><b>체중부하 인지</b><dl class="kv" style="margin-top:6px"><dt>일어서는 동작</dt><dd id="lcMove">대기</dd><dt>선 자세 안정</dt><dd id="lcStable">대기</dd><dt>발활 하강</dt><dd id="lcDrop">—</dd><dt>발 길이 변화</dt><dd id="lcSpan">—</dd></dl></div>
    <div id="camErr"></div>`;
  const vid = $('#vid', v), cd = $('#cd', v);
  // 상태: align(앉은 자세 정렬) → stand(체중부하 요청, 일어서는 동작 감지) → settle(선 자세 안정·형태 근거 확인) → 촬영
  const PHASE_LABEL = { align: '1/2 앉은 자세', stand: '일어서기', settle: '2/2 선 자세' };
  // 선 자세 촬영: 타이머 없이 AI가 일어서는 동작·체중부하 형태를 인지하면 찍는다
  let fi = 0, phase = 'align', phaseStart = 0, readySince = 0, busy = false, cur = null, lastHint = { t: 0, msg: '' }, announcedAlign = false, distSaid = 0, distCount = 0, lastDist = null, plateau = [], plateauSince = 0;
  let preLive = [], liveRef = null, lostFrames = 0, moveFrames = 0, transitionSeen = false, standPrompts = 0, settleWin = [], recheckAt = 0, reprompted = false, lastEv = null;
  const foot = () => run.feet[fi], toe = () => defaultToe(foot());
  let shapeFrames = 0, lastSpoke = 0;
  const T = { preSteady: 0.04, preMaxWait: 6000, plateauMin: 2500, plateauMax: 9000, plateauEps: 0.02, alignHold: 1200, settleHold: 1500, sceneMove: 6, lostMove: 5, standRepeat: 8000, standGiveUp: 30000, recheck: 4500 };
  const setPhase = ph => { phase = ph; phaseStart = performance.now(); readySince = 0; $('#phaseBadge', v).textContent = PHASE_LABEL[ph] || ''; $('#loadCard', v).style.display = ph === 'align' ? 'none' : ''; };
  const say = (t, o) => Voice.say(t, o);
  { const cb = $('#distCal', v); if (cb) cb.onclick = () => { const d = lastDist; if (!d) return toast('스티커 3개가 보이게 한 뒤 눌러 주세요.', true);
      const T = TARGET_DIST_CM, k = C.calibrateFovK(d.mmPerPx, d.side, T); if (!k) return;
      S.settings.fovK = +k.toFixed(4); saveSettings(); toast(`거리 보정 완료: 이 휴대폰에서 지금 거리를 ${T} cm로 기억합니다.`); say(`거리를 보정했습니다. 지금 거리가 ${T}센티미터입니다.`, { interrupt: false }); }; }
  const tracker = createTracker({ video: vid, overlay: $('#ov', v), wrap: $('#camwrap', v), getToe: toe, onFrame });
  const median = a => { const q = a.slice().sort((x, y) => x - y), n = q.length; return n % 2 ? q[n >> 1] : (q[n / 2 - 1] + q[n / 2]) / 2; };
  const medShape = arr => ({ heightPx: median(arr.map(s => s.heightPx / s.dia)), spanPx: median(arr.map(s => s.spanPx / s.dia)), dia: 1 });
  function beginFoot() {
    cur = { id: uid(), foot: foot(), toeDirection: toe(), participantId: S.settings.participantId || '', startedAt: Date.now(), pre: null, post: null, method: 'voice' };
    preLive = []; liveRef = null; announcedAlign = false; distSaid = 0; distCount = 0;
    $('#footBadge', v).textContent = FOOT[foot()]; setPhase('align'); tracker.lockRotation(false);
  }
  function hint(f, now) {
    if (now - phaseStart < 2500 || now - lastHint.t < 5000) return;
    const c = f.c; let msg;
    if (!c.stickers) msg = f.det.stickers.length === 0 ? `${FOOT[foot()]} 안쪽의 스티커 세 개가 화면에 보이게 해 주십시오` : c.stickersCode === 'EXTRA' ? '주변의 파란 물건을 치워 주십시오' : c.stickersCode === 'OCCLUDED' ? '스티커가 가려졌습니다. 바지나 손을 치워 주십시오' : '스티커 세 개가 모두 보이게 해 주십시오';
    else if (!c.sharp) msg = '화면이 흐립니다. 조명을 밝게 하고 잠시 그대로 계십시오';
    else if (!c.still) msg = c.stillCode === 'PHONE' ? '휴대폰이 흔들리고 있습니다. 휴대폰을 고정해 주십시오' : '발을 움직이지 마십시오';
    if (!msg || (msg === lastHint.msg && now - lastHint.t < 12000)) return;
    lastHint = { t: now, msg }; say(msg, { interrupt: false });
  }
  async function shoot(ph, intro) {
    busy = true; tracker.pause();
    await say(intro);
    cd.innerHTML = '<span class="recbadge">● 촬영 중</span>'; $('#status', v).textContent = '촬영 중… 움직이지 마십시오';
    const r = await burstCapture(vid, toe(), tracker.priorNorm(), tracker.rotation);
    cd.textContent = ''; Voice.beep(990, 120);
    if (!r.det.ok) {
      $('#status', v).textContent = '다시 촬영합니다';
      await say('잘 찍히지 않았습니다. 그대로 계시면, 다시 찍겠습니다.');
      busy = false; tracker.resume(); readySince = 0; phaseStart = performance.now(); return false;
    }
    await say('촬영되었습니다.');
    const rec = captureRecord(r.det, r.meas, 'voice', toe());
    if (S.settings.savePhotos) rec._blob = await blobFromCanvas(r.canvas);
    rec._shape = C.shapeOf(r.det);
    return rec;
  }
  // 촬영 단계에서 예외가 나도 화면이 멈추지 않게: 알리고 같은 단계를 다시 시도
  async function guarded(fn, label) {
    try { await fn(); }
    catch (e) {
      console.error(e); busy = false; tracker.resume(); readySince = 0; phaseStart = performance.now() + 1500;
      $('#status', v).textContent = label + ' 중 오류 — 다시 시도합니다';
      say('문제가 생겨서, 다시 시도하겠습니다. 그대로 계십시오.');
    }
  }
  async function shootPre() {
    tracker.lockRotation(true); // 앉은 자세·선 자세를 같은 방향으로 분석
    liveRef = medShape(preLive.slice(-10)); // 같은 해상도(실시간)의 비체중부하 기준 형태
    const rec = await shoot('pre', '앉은 자세를 촬영합니다.');
    if (!rec) return;
    cur.pre = rec; if (lastDist) cur.distance = { estCm: +lastDist.estCm.toFixed(1), targetCm: lastDist.targetCm, calibrated: !!S.settings.fovK };
    transitionSeen = false; lostFrames = 0; moveFrames = 0; shapeFrames = 0; lastSpoke = performance.now(); standPrompts = 1; settleWin = []; reprompted = false; lastEv = null;
    setPhase('stand'); updateLoadCard();
    $('#status', v).textContent = '일어서서 체중부하 해주십시오';
    // 안내를 말하는 동안에도 추적을 계속한다(말하는 도중에 일어서기 시작해도 동작을 놓치지 않도록)
    busy = false; tracker.resume(); phaseStart = performance.now();
    say('촬영을 마쳤습니다. 이제 일어서서, 체중부하 해주십시오. 양발에 체중을 똑같이 실어 주십시오.');
  }
  async function shootPost(confirmed, ev) {
    const rec = await shoot('post', confirmed ? '체중부하 확인했습니다. 촬영합니다.' : '현재 자세로 체중부하 상태를 촬영합니다.');
    if (!rec) return;
    cur.post = rec;
    const d1 = cur.pre.quality.diameterPx, d2 = cur.post.quality.diameterPx;
    if (Math.abs(d1 - d2) / ((d1 + d2) / 2) > C.DEFAULT_CONVERSION.maxScaleDiffPrePost) {
      await say('휴대폰이 움직였습니다. 다시 앉아 주십시오. 처음부터 다시 찍겠습니다.');
      cur.pre = cur.post = null; preLive = []; busy = false; tracker.resume(); setPhase('align'); announcedAlign = false; phaseStart = performance.now() + 3000; return;
    }
    // 최종 형태 근거: 두 연속 촬영(같은 고해상도)끼리 비교
    const fin = C.loadEvidence(cur.pre._shape, cur.post._shape);
    cur.loadRecognition = { transitionSeen, live: ev ? { drop: ev.drop, spanGain: ev.spanGain, by: ev.by } : null, final: { drop: fin.drop, spanGain: fin.spanGain, by: fin.by }, confirmed: !!confirmed, at: Date.now() };
    delete cur.pre._shape; delete cur.post._shape;
    $('#status', v).textContent = '분석 중…';
    const ov2 = document.createElement('div'); ov2.className = 'modal-bg'; ov2.style.alignItems = 'center';
    ov2.innerHTML = `<div class="modal" style="border-radius:22px;max-width:420px;margin:16px">${analyzingHtml()}</div>`; document.body.appendChild(ov2);
    let n = 0; const saved = await finalizeExam(cur, t => { const li = document.createElement('li'); li.innerHTML = t; $('#prog', ov2).appendChild(li); setRing(ov2, ++n / 6); });
    setRing(ov2, 1); await new Promise(r => setTimeout(r, 500)); ov2.remove();
    run.results.push(saved.id);
    if (fi + 1 < run.feet.length) {
      fi++;
      await say(`${FOOT[run.feet[fi - 1]]} 검사를 마쳤습니다. 다시 앉아 주십시오. 휴대폰을 돌려서, ${FOOT[foot()]} 안쪽을 비춰 주십시오.`);
      beginFoot(); phaseStart = performance.now() + 4000; busy = false; tracker.resume(); return;
    }
    tracker.stop();
    await say('검사가 끝났습니다. 화면에서 결과를 확인해 주십시오.');
    S.selfRun = null;
    go(run.results.length === 2 ? `#/pair/${run.results[0]}/${run.results[1]}` : `#/result/${run.results[0]}`);
  }
  const pctTxt = v2 => (v2 * 100).toFixed(1) + '%';
  function updateLoadCard(ev) {
    $('#lcMove', v).textContent = transitionSeen ? '확인' : '대기';
    $('#lcStable', v).textContent = phase === 'settle' && readySince ? '확인 중' : phase === 'settle' ? '정렬 대기' : '대기';
    $('#lcDrop', v).textContent = ev ? `${ev.drop >= C.LOAD.minDrop ? '✓ ' : ''}${ev.drop.toFixed(2)}×스티커 지름 (기준 ${C.LOAD.minDrop})` : '—';
    $('#lcSpan', v).textContent = ev ? `${ev.spanGain >= C.LOAD.minSpanGain ? '✓ ' : ''}${ev.spanGain >= 0 ? '+' : ''}${pctTxt(ev.spanGain)} (기준 +${pctTxt(C.LOAD.minSpanGain)})` : '—';
  }
  function onFrame(f) {
    { const show = !busy && !!(cur && cur.pre && !cur.post && (phase === 'stand' || phase === 'settle') && performance.now() - phaseStart > 15000); const pn = $('#postNow', v); if (pn) { pn.classList.toggle('hide', !show); $('#postNowHint', v).classList.toggle('hide', !show); } }
    if (busy) return;
    const now = performance.now();
    paintChecksInto($('#checks', v), f.c);
    $('#hud', v).textContent = `${f.fps} fps · ${f.roi ? '추적 모드' : '전체 검색'} · 장면 움직임 ${f.sceneMotion.toFixed(1)}`;
    { const db = $('#distBadge', v), d = f.dist; lastDist = d || lastDist; if (db) { db.classList.toggle('hide', !d); if (d) { db.textContent = d.targetCm ? `거리 약 ${d.estCm.toFixed(0)} cm · 목표 ${d.targetCm} cm` : `거리 ${d.label}${d.estCm ? ` · 약 ${Math.round(d.estCm / 5) * 5} cm` : ''}`; db.className = 'badge ' + (d.label === '적당' ? 'b-good' : 'b-warn'); } }
      const cb = $('#distCal', v); if (cb) cb.classList.toggle('hide', !(d && d.targetCm && phase === 'align')); const cn = $('#calNote', v); if (cn) cn.classList.toggle('hide', !(d && phase === 'align' && !S.settings.fovK)); }
    if (now < phaseStart) { $('#status', v).textContent = '음성 안내를 들어 주십시오…'; return; }
    if (phase === 'align') {
      const d = f.dist, off = d && d.code !== 'OK' && f.c.stickers, fixed = !!(d && d.targetCm);
      // 고정 모드: 8초마다 계속 안내(횟수 제한 없음) · 자유 모드: 최대 3번
      if (off && (!distSaid || (now - distSaid > 8000 && (fixed || distCount < 3)))) { distSaid = now; distCount++; lastHint = { t: now, msg: d.msg }; say(d.msg + '.', { interrupt: false }); }
      if (off && fixed) { readySince = 0; $('#status', v).textContent = `${d.code === 'FAR' ? '조금 더 가까이' : '조금 더 멀리'} · ${d.targetCm} cm에 맞춰 주세요 (지금 약 ${d.estCm.toFixed(0)} cm)`; if (!f.ready) hint(f, now); return; }
      if (f.ready) {
        preLive.push(C.shapeOf(f.det)); if (preLive.length > 20) preLive.shift();
        if (!readySince) { readySince = now; if (!announcedAlign) { announcedAlign = true; say('스티커 세 개를 찾았습니다. 그대로 계십시오.'); } }
        $('#status', v).textContent = '스티커 고정 확인 중… 그대로 계십시오';
        const hs = preLive.slice(-10).map(s => s.heightPx / s.dia), steady = hs.length >= 8 && Math.max(...hs) - Math.min(...hs) <= T.preSteady;
        if (now - readySince >= T.alignHold && preLive.length >= 8 && (steady || now - readySince > T.preMaxWait)) { busy = true; guarded(shootPre, '앉은 자세 촬영'); }
        else if (now - readySince >= T.alignHold && !steady) $('#status', v).textContent = '발에 힘을 빼고 그대로 계십시오';
      } else { readySince = 0; $('#status', v).textContent = (!f.c.stickers ? f.c.stickersMsg : !f.c.sharp ? f.c.sharpMsg : f.c.stillMsg) || '스티커 세 개가 보이게 해 주십시오'; hint(f, now); }
      return;
    }
    if (phase === 'stand') {
      // 일어서는 동작 인지: ① 장면 전체 움직임이 커지거나 ② 스티커 추적이 끊기거나 ③ 스티커가 크게 움직이거나
      // ④ 움직임이 작아도 발 모양이 체중부하 형태로 바뀜(발활 하강·발 길이 증가가 연속 4프레임)
      if (f.sceneMotion > T.sceneMove || f.motion > 1.0 || f.shapeMotion > 0.4) moveFrames++; else moveFrames = Math.max(0, moveFrames - 1);
      if (!f.det.ok) lostFrames++; else lostFrames = 0;
      const evNow = f.det.ok && liveRef ? C.loadEvidence(liveRef, C.shapeOf(f.det)) : null;
      shapeFrames = evNow && evNow.confirmed ? shapeFrames + 1 : 0;
      if (!transitionSeen && (moveFrames >= 2 || lostFrames >= T.lostMove || shapeFrames >= 4)) { transitionSeen = true; lastSpoke = now; updateLoadCard(); say('일어서는 동작을 확인했습니다. 가만히 서 계십시오.'); }
      const el = now - phaseStart;
      $('#status', v).textContent = transitionSeen ? (f.det.ok ? '가만히 서 계십시오' : '스티커가 보이지 않습니다') : '일어서서 체중부하 해주십시오';
      if (transitionSeen && moveFrames === 0 && f.det.ok) { setPhase('settle'); updateLoadCard(); return; }
      // 일어선 뒤 스티커가 계속 안 보이면 이유를 말해 준다(조용히 멈춰 있지 않게)
      if (transitionSeen && !f.det.ok && lostFrames > 45 && now - lastSpoke > 6000) { lastSpoke = now; say('스티커 세 개가 화면에 보이지 않습니다. 발을 원래 자리에 두고, 휴대폰은 그대로 두십시오.', { interrupt: false }); }
      if (!transitionSeen && el > T.standRepeat * standPrompts && el < T.standGiveUp) { standPrompts++; lastSpoke = now; say('일어서서 체중부하 해주십시오. 양발에 체중을 실어 주십시오.'); }
      if (!transitionSeen && el >= T.standGiveUp) { setPhase('settle'); updateLoadCard(); } // 동작을 못 봤어도 형태 근거로 판단
      return;
    }
    if (phase === 'settle') {
      // 같은 카메라 위치인지: 스티커 크기가 앉은 자세 때와 비슷해야 한다
      const preDia = preLive.length ? median(preLive.map(s => s.dia)) : 0, nowDia = f.det.quality && f.det.quality.diameterPx;
      const sameCam = !preDia || !nowDia || Math.abs(nowDia - preDia) / preDia <= 0.12;
      const okPost = f.readyLoose && sameCam;
      const settleFor = now - phaseStart;
      if (!okPost) {
        readySince = 0; settleWin = []; plateau = []; plateauSince = 0;
        const msg = !f.c.stickers ? f.c.stickersMsg : !sameCam ? '휴대폰이 움직인 것 같습니다. 휴대폰은 그대로 두십시오' : !f.c.sharp ? f.c.sharpMsg : f.c.stillMsg;
        $('#status', v).textContent = msg || '가만히 서 계십시오';
        // 오래 안 찍히면 무엇이 문제인지 말로 알려 준다(조용히 멈춰 있지 않게)
        if (settleFor > 3000 && now - lastSpoke > 6000) { lastSpoke = now; lastHint = { t: now, msg }; say((msg || '가만히 서 계십시오') + '.', { interrupt: false }); }
        else if (!f.c.stickers) hint(f, now);
        updateLoadCard(lastEv); return;
      }
      if (!readySince) { readySince = now; recheckAt = now + T.settleHold; }
      settleWin.push(C.shapeOf(f.det)); if (settleWin.length > 10) settleWin.shift();
      const ev = liveRef && settleWin.length >= 5 ? C.loadEvidence(liveRef, medShape(settleWin)) : null; lastEv = ev;
      updateLoadCard(ev);
      if (now < recheckAt) { $('#status', v).textContent = '선 자세 확인 중… 그대로 계십시오'; return; }
      if (ev && ev.confirmed) {
        // 체중이 다 실릴 때까지: 최근 1초 하강(중앙값)이 그 전 1초보다 더 커지지 않으면(정점) 촬영 — 덜 실린 상태에서 찍혀 값이 작게 나오는 것을 막는다
        plateau.push({ t: now, d: C.shapeOf(f.det) ? ev.drop : null }); plateau = plateau.filter(p => now - p.t < 2200 && p.d != null);
        const a1 = plateau.filter(p => now - p.t < 1000).map(p => p.d), a0 = plateau.filter(p => now - p.t >= 1000).map(p => p.d);
        const flat = a1.length >= 4 && a0.length >= 4 && median(a1) - median(a0) < T.plateauEps;
        if (!plateauSince) plateauSince = now;
        if ((flat && now - plateauSince >= T.plateauMin) || now - plateauSince >= T.plateauMax) { busy = true; plateau = []; plateauSince = 0; guarded(() => shootPost(true, ev), '선 자세 촬영'); return; }
        $('#status', v).textContent = '체중이 다 실릴 때까지 그대로 서 계십시오'; return;
      }
      if (!reprompted) {
        reprompted = true; recheckAt = now + T.recheck; settleWin = [];
        $('#status', v).textContent = '양발에 체중을 고르게 실어 주십시오';
        say('발 모양 변화가 아직 작습니다. 양발에 체중을 똑같이 실어 주십시오.');
        return;
      }
      busy = true; guarded(() => shootPost(false, ev), '선 자세 촬영'); // 정상 발활처럼 변화가 작은 발 — 촬영하되 "형태 근거 미확인"으로 기록
    }
  }
  $('#mute', v).onclick = () => { Voice.enabled = !Voice.enabled; $('#mute', v).innerHTML = `${Voice.enabled ? ICON.vol : ICON.volOff}<span>${Voice.enabled ? '음성 켬' : '음성 끔'}</span>`; };
  // 자동 촬영이 오래 안 되면(선 자세) 직접 찍을 수 있게
  $('#postNow', v).onclick = () => { if (busy || !cur || !cur.pre || cur.post) return; busy = true; guarded(async () => { await shootPost(false, lastEv); }, '선 자세 촬영'); };
  $('#cam', v).onclick = async () => {
    if (cur && cur.pre) return toast('촬영 중에는 카메라를 바꿀 수 없습니다.', true);
    try { const name = await tracker.nextCamera(); toast(name ? '카메라: ' + name : '바꿀 수 있는 후면 카메라가 없습니다.'); } catch (e) { toast(cameraErrorHelp(e), true); }
  };
  $('#rot', v).onclick = () => { if (cur && cur.pre) return toast('촬영 중에는 방향을 바꿀 수 없습니다.', true); const r = tracker.rotate(); $('#rot', v).innerHTML = `${ICON.rotate}<span>방향 ${r}°</span>`; };
  $('#stop', v).onclick = () => { stopRef.cancel = true; tracker.stop(); S.selfRun = null; go('#/self'); };
  const stopRef = { cancel: false };
  beginFoot();
  try {
    await tracker.start();
    // 시작 타이머 없음: 음성으로 "준비해 주세요"라고 알리고 바로 추적한다(스티커가 고정될 때까지 기다렸다 찍으므로 앉을 시간은 충분)
    $('#status', v).textContent = '준비해 주세요';
    say(`준비해 주세요. 휴대폰을 다리 사이에 세워 두고, 의자에 앉아 주십시오. 휴대폰은 발 안쪽에서 25센티미터에 두고, 발에 힘을 빼 주십시오. 스티커 세 개가 움직이지 않으면 자동으로 찍습니다.`);
    phaseStart = performance.now() + 2500;
  } catch (e) {
    if (e.name === 'Stale') return;
    $('#status', v).textContent = '카메라를 시작할 수 없습니다';
    $('#camErr', v).innerHTML = `<div class="note bad">${esc(e.name === 'Unsupported' ? e.message : cameraErrorHelp(e))}</div><button class="btn block" onclick="render()">다시 시도</button>`;
  }
});

// ───── 유연성 평발 자가 확인 (결과 화면에 삽입) ─────
const SELF_QUESTIONS = [
  ['restFlat', '앉아서 체중을 빼도 발 안쪽 발활이 거의 보이지 않는다'],
  ['pain', '발이나 발목에 통증·붓기가 있거나, 걷기 불편하다']
];
function flexSectionHtml(e) {
  const cat = e.category, c = e.comparison, sr = e.selfReport || {};
  let body;
  if (!cat) body = '<p class="small muted">길이 값과 분류가 있어야 유연성 평발 양상을 확인할 수 있습니다.</p>';
  else if (cat.key === 'normal') body = `<p class="small">체중을 실었을 때 발활 하강이 <b>${mm(c.changeMm)}</b>로, 본 연구 기준 <b>정상 범위(${cmTxt(C.CLASS_MM.normal)} 이하)</b>입니다. 체중에 따라 발활이 크게 무너지는 유연성 평발 양상은 보이지 않습니다.</p>`;
  else body = `<p class="small">앉았을 때(체중 없음) 발활 높이 <b>${mm(c.preMm)}</b> → 섰을 때 <b>${mm(c.postMm)}</b>로 <b>${mm(c.changeMm)}</b> 내려갔습니다. 체중을 빼면 발활이 다시 올라오는 <b>유연성 평발 양상</b>에 해당합니다(본 연구 기준: ${esc(cat.label)}).</p>
      <div class="grid2"><a class="btn primary" href="#/exercises">관리 운동 보기</a><a class="btn" href="#/manage">관리 현황</a></div>`;
  const warn = SELF_QUESTIONS.some(([k]) => sr[k]);
  return `<div class="card" id="flex"><b>유연성 평발 자가 확인</b>${body}
    <p class="tiny" style="margin-top:10px">아래에 해당하면 체크해 주세요. 이 검사만으로 구분할 수 없는 경우를 알려 드립니다.</p>
    ${SELF_QUESTIONS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-sq="${k}" ${sr[k] ? 'checked' : ''}><span class="small">${l}</span></label>`).join('')}
    <div id="flexWarn">${warn ? flexWarnHtml() : ''}</div></div>`;
}
function flexWarnHtml() { return '<div class="note bad small">이런 경우에는 경직성 평발이나 다른 원인일 수 있어, 이 앱의 하강 검사로는 판단할 수 없습니다. 전문가 상담을 권합니다.</div>'; }
function bindFlexSection(root, e) {
  $$('[data-sq]', root).forEach(cb => cb.onchange = async () => {
    e.selfReport = Object.assign({}, e.selfReport, { [cb.dataset.sq]: cb.checked, answeredAt: Date.now() });
    e.updatedAt = Date.now();
    await save('exams', e); Account.syncSoon();
    $('#flexWarn', root).innerHTML = SELF_QUESTIONS.some(([k]) => e.selfReport[k]) ? flexWarnHtml() : '';
  });
}

// ───── 양발 결과 요약 ─────
route('/pair/:a/:b', '양발 검사 결과', async (v, p) => {
  const A = await DB.get('exams', p.a), B = await DB.get('exams', p.b);
  if (!A || !B) { v.innerHTML = '<div class="note bad">결과를 찾을 수 없습니다.</div>'; return; }
  const card = e => `<a class="card" style="margin:0;text-decoration:none;color:inherit" href="#/result/${e.id}"><div class="tiny">${FOOT[e.foot]}</div>
    <div style="font-size:26px;font-weight:800">${e.comparison.changeMm != null ? mm(e.comparison.changeMm) : '—'}</div>${e.category ? catBadge(e.category) : statusBadge(e.comparison.status)}
    <div class="tiny" style="margin-top:6px">앉음 ${e.comparison.preMm != null ? mm(e.comparison.preMm) : px(e.pre.measure.heightPx)} → 섬 ${e.comparison.postMm != null ? mm(e.comparison.postMm) : px(e.post.measure.heightPx)}</div><div class="tiny">자세히 보기 ›</div></a>`;
  const flexFeet = [A, B].filter(e => e.category && e.category.key !== 'normal').map(e => FOOT[e.foot]);
  const both = A.category && B.category;
  v.innerHTML = `<h2>양발 검사 결과</h2><p class="tiny">${fmtDate(A.createdAt)} · 음성 안내 자가 검사</p>
    <div class="grid2">${card(A)}${card(B)}</div>
    <div class="card"><b>요약</b><p class="small">${!both ? '길이 환산 조건이 충족되지 않아 분류할 수 없습니다.' : flexFeet.length ? `<b>${flexFeet.join('·')}</b>에서 체중을 실을 때 발활이 연구 기준 이상으로 내려가는 유연성 평발 양상이 보입니다.` : '양발 모두 연구 기준 정상 범위입니다.'}
      ${both ? ` 좌우 차이 ${mm(Math.abs(A.comparison.changeMm - B.comparison.changeMm))}.` : ''}</p>
      ${flexFeet.length ? '<div class="grid2"><a class="btn primary" href="#/exercises">관리 운동 보기</a><a class="btn" href="#/manage">관리 현황</a></div>' : ''}
      <p class="tiny">각 발의 “자세히 보기”에서 자가 확인 질문에 답할 수 있습니다.</p></div>
    <p class="tiny">${esc(DISCLAIMER)}</p>
    <div class="grid2"><a class="btn" href="#/self">다시 검사</a><a class="btn" href="#/history">검사 이력</a></div>`;
});

// ───── 관리 현황 ─────
route('/manage', '유연성 평발 관리', async (v) => {
  const exams = (await DB.all('exams')).filter(e => !e.isTest && e.comparison.changeMm != null).sort((a, b) => a.createdAt - b.createdAt);
  const logs = (await DB.all('logs')).sort((a, b) => b.date - a.date);
  const err = await knownErrorMae();
  const week = logs.filter(l => l.date > Date.now() - 7 * 864e5).length;
  const footCard = f => {
    const list = exams.filter(e => e.foot === f); if (!list.length) return `<div class="card"><b>${FOOT[f]}</b><p class="small muted">유효한 측정이 아직 없습니다.</p></div>`;
    const first = list[0], last = list[list.length - 1], d = last.comparison.changeMm - first.comparison.changeMm;
    const interp = list.length < 2 ? '한 번 더 측정하면 변화를 비교할 수 있습니다.'
      : !err ? '측정 오차가 아직 검증되지 않아, 변화가 실제인지 판단하기 어렵습니다.'
      : Math.abs(d) <= err.mae ? `처음과의 차이(${mm(Math.abs(d))})가 알려진 측정 오차(${mm(err.mae)}) 이내입니다.`
      : `처음보다 ${mm(Math.abs(d))} ${d < 0 ? '줄었습니다' : '늘었습니다'}(측정 오차 ${mm(err.mae)}보다 큼). 촬영 조건 차이도 함께 고려하세요.`;
    return `<div class="card"><div class="row"><b class="grow">${FOOT[f]}</b>${catBadge(last.category)}</div>
      <dl class="kv"><dt>최근 하강</dt><dd>${mm(last.comparison.changeMm)}</dd><dt>처음 하강</dt><dd>${mm(first.comparison.changeMm)} (${fmtDate(first.createdAt, false)})</dd><dt>측정 횟수</dt><dd>${list.length}회</dd></dl>
      <p class="small">${esc(interp)}</p></div>`;
  };
  v.innerHTML = `<h2>유연성 평발 관리</h2>
    <p class="small muted">운동을 하면서 같은 방법(음성 자가 검사)으로 다시 측정해 발활 하강의 변화를 확인합니다.</p>
    ${footCard('left')}${footCard('right')}
    ${exams.length ? `<div class="card"><b>하강량 추이 (mm)</b><div class="legend"><span><i style="background:var(--series-1)"></i>왼발</span><span><i style="background:var(--series-2)"></i>오른발</span></div><canvas class="chart" id="ch"></canvas><p class="tiny">점선: 연구 분류 경계 2·4·6 mm</p></div>` : ''}
    ${programCardHtml(exams, logs)}
    <div class="card"><dl class="kv"><dt>최근 7일 운동</dt><dd>${week}회</dd><dt>누적 운동</dt><dd>${logs.length}회</dd></dl><a class="btn block" href="#/exercises">오늘의 운동</a></div>
    <a class="btn primary block big" href="#/self">다시 측정하기</a>
    <a class="btn block" href="#/history">검사 이력 전체 보기</a>
    <p class="tiny">측정값의 변화가 곧 발활 구조의 개선을 뜻하지는 않습니다. 측정 오차와 촬영 조건을 함께 고려하세요.</p>`;
  bindProgram(v);
  if (exams.length) {
    const ser = ['left', 'right'].map(f => ({ name: FOOT[f], color: f === 'left' ? '#2a78d6' : '#eb6834', points: exams.filter(e => e.foot === f).map(e => ({ x: e.createdAt, y: C.roundMm(e.comparison.changeMm), label: `${fmtDate(e.createdAt)} ${mm(e.comparison.changeMm)}` })) })).filter(s => s.points.length);
    lineChart($('#ch', v), ser, { yMin: 0, bands: CLASS_BANDS() });
  }
});

// ───── 6주 숏풋(짧은 발) 운동 프로그램 ─────
// 근거: 숏풋 운동을 매일 6주 하면 발배뼈 하강이 줄었다(Unver 등 2019 J Sport Rehabil; Zarali 등 2024 BMC Sports Sci Med Rehabil).
const PROGRAM = { weeks: 6, perWeek: 6, checkWeeks: [3, 6], cite: 'Unver 등 2019 · Zarali 등 2024 (숏풋 운동 6주 후 발배뼈 하강 감소)' };
function programState(exams, logs, start, now) {
  now = now || Date.now(); const W = 7 * 864e5;
  const week = Math.min(PROGRAM.weeks, Math.floor((now - start) / W) + 1), finished = now - start >= PROGRAM.weeks * W;
  const perWeek = Array.from({ length: PROGRAM.weeks }, (_, i) => logs.filter(l => l.date >= start + i * W && l.date < start + (i + 1) * W).length);
  const base = {}, last = {};
  for (const e of exams) { const f = e.foot, t = e.createdAt;
    if (t <= start + 3 * 864e5 && (!base[f] || Math.abs(t - start) < Math.abs(base[f].createdAt - start))) base[f] = e;
    if (t > start + 3 * 864e5 && (!last[f] || t > last[f].createdAt)) last[f] = e; }
  const checks = PROGRAM.checkWeeks.map(w => ({ week: w, done: exams.some(e => e.createdAt >= start + (w * 7 - 4) * 864e5) }));
  return { week, finished, perWeek, base, last, checks };
}
function programCardHtml(exams, logs) {
  const start = S.settings.programStart;
  if (!start) return `<div class="card" id="progCard"><b>6주 숏풋 운동 프로그램</b> <span class="badge b-info">NEW</span>
    <p class="small">연구에서 효과가 확인된 방식대로 <b>6주 동안 주 ${PROGRAM.perWeek}회 이상</b> 운동하고, <b>시작·3주·6주</b>에 다시 측정해 변화를 확인합니다.</p>
    <p class="tiny">근거: ${esc(PROGRAM.cite)}</p><button class="btn primary block" id="progStart">오늘부터 시작</button></div>`;
  const st = programState(exams, logs, start), pc = (() => { try { return C.personalCare(exams, { logs }); } catch (e) { return null; } })(), mdc = pc && pc.mdcMm;
  const bars = st.perWeek.map((n, i) => `<div style="flex:1;text-align:center"><div style="height:46px;display:flex;align-items:flex-end;justify-content:center"><div style="width:70%;height:${Math.min(100, n / PROGRAM.perWeek * 100)}%;min-height:3px;border-radius:4px;background:${n >= PROGRAM.perWeek ? 'var(--good,#2a9d5c)' : i + 1 === st.week ? 'var(--series-1,#3b6fd8)' : '#c9d2e3'}"></div></div><div class="tiny">${i + 1}주<br>${n}회</div></div>`).join('');
  const change = ['left', 'right'].filter(f => st.base[f] && st.last[f]).map(f => { const d = st.last[f].comparison.changeMm - st.base[f].comparison.changeMm;
    const real = mdc != null && Math.abs(d) >= mdc; return `<li>${FOOT[f]}: ${mm(st.base[f].comparison.changeMm)} → <b>${mm(st.last[f].comparison.changeMm)}</b> (${d <= 0 ? '' : '+'}${mm(d)}) ${mdc == null ? '' : real ? (d < 0 ? '<span class="badge b-good">의미 있는 개선</span>' : '<span class="badge b-bad">의미 있는 증가</span>') : '<span class="tiny">측정 흔들림 범위</span>'}</li>`; }).join('');
  return `<div class="card" id="progCard"><div class="row"><b class="grow">6주 숏풋 운동 프로그램</b><span class="badge ${st.finished ? 'b-good' : 'b-info'}">${st.finished ? '완료' : st.week + '/6주'}</span></div>
    <div style="display:flex;gap:4px;margin:8px 0">${bars}</div>
    <p class="small">재측정: ${st.checks.map(c => `${c.week}주 ${c.done ? '✓' : '대기'}`).join(' · ')}${st.finished ? '' : ` · 이번 주 목표 ${PROGRAM.perWeek}회 중 ${st.perWeek[st.week - 1]}회`}</p>
    ${change ? `<ul class="list small">${change}</ul>${mdc != null ? `<p class="tiny">의미 있는 변화 기준(내 MDC95): ±${mm(mdc)}</p>` : ''}` : '<p class="tiny">시작 무렵 측정과 3주 이후 측정이 있으면 변화가 표시됩니다.</p>'}
    <p class="tiny">근거: ${esc(PROGRAM.cite)}</p>
    <div class="grid2"><a class="btn primary" href="#/exercises">오늘 운동하기</a><button class="btn ghost" id="progReset">프로그램 다시 시작</button></div></div>`;
}
function bindProgram(v) {
  const st = $('#progStart', v), rs = $('#progReset', v);
  if (st) st.onclick = () => { S.settings.programStart = Date.now(); saveSettings(); render(); };
  if (rs) rs.onclick = async () => { if (await confirmModal('6주 프로그램을 오늘부터 다시 시작할까요? 운동·측정 기록은 그대로 남습니다.', '다시 시작')) { S.settings.programStart = Date.now(); saveSettings(); render(); } };
}
