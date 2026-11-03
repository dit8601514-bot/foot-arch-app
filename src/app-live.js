'use strict';
/* ═════════════ 실시간 촬영 공통 모듈: 음성 안내 · 트래킹 루프 · 연속 촬영 ═════════════ */

// 음성 안내 (Web Speech API). iOS/Safari는 사용자가 버튼을 누른 순간에 한 번 말해야 이후에도 말할 수 있다.
const Voice = (() => {
  let enabled = true, unlocked = false, ctx = null, voice = null;
  const ok = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function pickVoice() {
    if (!ok()) return null;
    const vs = speechSynthesis.getVoices();
    return vs.find(v => /ko[-_]KR/i.test(v.lang)) || vs.find(v => /^ko/i.test(v.lang)) || null;
  }
  if (ok()) { voice = pickVoice(); speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); }; }
  function say(text, opts) {
    const o = Object.assign({ interrupt: true }, opts);
    showCaption(text);
    if (!enabled || !ok()) return Promise.resolve(false);
    return new Promise(res => {
      try {
        if (o.interrupt) speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; if (voice) u.voice = voice; u.rate = 1.0;
        const t = setTimeout(() => res(true), Math.min(9000, 1200 + text.length * 160)); // onend가 오지 않는 기기 대비
        u.onend = () => { clearTimeout(t); res(true); }; u.onerror = () => { clearTimeout(t); res(false); };
        speechSynthesis.speak(u);
      } catch (e) { res(false); }
    });
  }
  function beep(freq, ms) {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq || 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ms || 150) / 1000);
    } catch (e) { /* 소리 미지원 */ }
  }
  function unlock() { unlocked = true; beep(660, 60); if (ok()) { try { const u = new SpeechSynthesisUtterance(' '); u.lang = 'ko-KR'; u.volume = 0; speechSynthesis.speak(u); } catch (e) {} } }
  let capTimer = null;
  function showCaption(text) {
    const el = document.getElementById('voiceCap'); if (!el) return;
    el.textContent = '🔊 ' + text; el.classList.remove('hide'); clearTimeout(capTimer); capTimer = setTimeout(() => el.classList.add('hide'), 6000);
  }
  return { say, beep, unlock, get supported() { return ok(); }, get hasKorean() { return !!voice; }, get enabled() { return enabled; }, set enabled(v) { enabled = !!v; if (!v && ok()) speechSynthesis.cancel(); }, get unlocked() { return unlocked; } };
})();

// 화면 가이드(점선) — 판정에 쓰는 C.GUIDE와 같은 영역을 그린다
// 표준 발 가이드(안쪽 면 실루엣 · 바닥선 · 스티커 목표 영역)를 영상 위에 그린다. 판정(C.guideCheck)과 같은 기하를 쓴다.
function drawGuide(g, ox, oy, k, IW, IH, toe, st, hint, sole) {
  const G = C.guideGeometry(IW, IH, toe), M = C.FOOT_MODEL;
  const T = p => [ox + p.x * k, oy + p.y * k];
  const ok = st && st.ready, green = 'rgba(46,204,113,.95)', white = 'rgba(255,255,255,.85)', yellow = 'rgba(255,212,0,.95)';
  // 발 윤곽
  g.beginPath(); G.outline.forEach((p, i) => { const [x, y] = T(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
  g.fillStyle = ok ? 'rgba(46,204,113,.10)' : 'rgba(255,255,255,.07)'; g.fill();
  g.strokeStyle = ok ? green : white; g.lineWidth = 2; g.setLineDash([]); g.stroke();
  // 안쪽 복사뼈(부착 위치 아님)
  const [mx, my] = T(G.malleolus); g.setLineDash([3, 3]); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(mx, my, G.malleolus.r * k, 0, 7); g.stroke(); g.setLineDash([]);
  // 표준 바닥선
  const [fx0, fy] = T({ x: Math.min(G.heelX, G.toeX) - 0.03 * IW, y: G.floorY }), [fx1] = T({ x: Math.max(G.heelX, G.toeX) + 0.03 * IW, y: G.floorY });
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.setLineDash([10, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(fx0, fy); g.lineTo(fx1, fy); g.stroke(); g.setLineDash([]);
  // P2(발배뼈) 탐색 영역: 표준 위치 기준 사각형
  const Z = M.P2zone, cm = (t, h) => T({ x: G.X(M.P3.x + t * (M.P1.x - M.P3.x)), y: G.Y(h) });
  const q = [cm(Z.t[0], Z.hCm[0]), cm(Z.t[1], Z.hCm[0]), cm(Z.t[1], Z.hCm[1]), cm(Z.t[0], Z.hCm[1])];
  g.beginPath(); q.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
  g.setLineDash([5, 4]); g.lineWidth = 1.5; g.strokeStyle = st && st.inP2 ? green : 'rgba(255,255,255,.65)'; g.stroke(); g.setLineDash([]);
  // P3·P1 목표 원
  const ring = (P, inside, label) => { const [x, y] = T(P); g.lineWidth = inside ? 3 : 2; g.strokeStyle = inside ? green : st && st.seen ? yellow : white; g.beginPath(); g.arc(x, y, P.r * k, 0, 7); g.stroke(); g.font = 'bold 12px system-ui'; g.fillStyle = 'rgba(0,0,0,.55)'; const w2 = g.measureText(label).width + 8; g.fillRect(x - w2 / 2, y + P.r * k + 3, w2, 17); g.fillStyle = '#fff'; g.textAlign = 'center'; g.fillText(label, x, y + P.r * k + 16); g.textAlign = 'start'; };
  ring(G.P3, st && st.inP3, 'P3 발꿈치'); ring(G.P1, st && st.inP1, 'P1 엄지 뿌리');
  { const [x, y] = q[3]; g.font = 'bold 12px system-ui'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y - 18, 62, 16); g.fillStyle = '#fff'; g.fillText('P2 발배뼈', x + 4, y - 6); }
  // 검출된 실제 바닥선(발바닥 경계)
  if (sole && sole.ok) { const xa = 0.03 * IW, xb = 0.97 * IW, [ax, ay] = T({ x: xa, y: sole.slope * xa + sole.intercept }), [bx, by] = T({ x: xb, y: sole.slope * xb + sole.intercept }); g.strokeStyle = 'rgba(0,229,255,.95)'; g.lineWidth = 2; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); g.font = '11px system-ui'; g.fillStyle = '#00e5ff'; g.fillText('바닥선 검출', bx - 70, by - 5); }
  if (hint) {
    g.font = 'bold 15px system-ui'; const tw = g.measureText(hint).width + 20, W2 = IW * k;
    g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(ox + (W2 - tw) / 2, oy + 8, tw, 26);
    g.fillStyle = '#ffd400'; g.textAlign = 'center'; g.fillText(hint, ox + W2 / 2, oy + 26); g.textAlign = 'start';
  }
}
// 장면 움직임: 축소 회색 영상의 프레임 간 평균 절대 차이(0~255). 일어서는 동작처럼 화면 전체가 바뀌는 것을 잡는다.
function sceneThumb(img) {
  const { data, width: W, height: H } = img, sx = Math.max(1, Math.floor(W / 64)), sy = Math.max(1, Math.floor(H / 36)), out = [];
  for (let y = 0; y < H; y += sy) for (let x = 0; x < W; x += sx) { const i = (y * W + x) * 4; out.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); }
  return Float32Array.from(out);
}

/**
 * 실시간 트래킹: 약 15fps로 프레임을 분석하고, 준비 상태(스티커·선명도·움직임·범위)를 판정한다.
 * onFrame({det, c, ready, motion}) 콜백으로 결과를 넘긴다.
 */
function createTracker(opts) {
  const { video, overlay, wrap, getToe, onFrame } = opts;
  const st = { lastOk: null, smooth: null, hist: [], fpsT: [], inflight: false, paused: false, timer: null, stream: null, facing: opts.facing || 'environment', devices: [], kf: C.createLandmarkKalman(), colorModel: null, dia: null };
  function assess(det, now, pred) {
    const codes = det.reasons.map(r => r.code);
    const c = {};
    c.stickers = det.stickers.length === 3 && !!det.landmarks && !codes.some(x => ['MISSING', 'EXTRA', 'OCCLUDED', 'SIZE_MISMATCH', 'BORDER', 'P2_OUTSIDE', 'P2_NEAR_TOE', 'P2_BELOW', 'SPAN_SHORT', 'TOE_DIR'].includes(x));
    c.stickersMsg = c.stickers ? '' : (det.reasons[0] ? det.reasons[0].msg : '스티커를 찾는 중');
    c.stickersCode = c.stickers ? '' : (det.reasons[0] ? det.reasons[0].code : 'MISSING');
    // 라벨 일관성: 칼만 예측 위치와 비교(없으면 직전 검출)
    const consistent = C.labelsConsistent(pred ? { landmarks: pred } : st.lastOk, det);
    if (c.stickers && !consistent) { c.stickers = false; c.stickersMsg = '기준점 라벨이 흔들립니다 — 발을 고정하세요'; c.stickersCode = 'LABEL'; }
    c.sharp = !!(det.quality && det.quality.sharp); c.sharpMsg = c.sharp || !det.landmarks ? '' : '흐림 — 초점·조명 확인';
    if (det.ok) st.hist.push({ t: now, det }); else st.hist = [];
    st.hist = st.hist.filter(h => now - h.t < 600);
    const motion = st.hist.length >= 2 ? Math.max(...st.hist.map(h => C.motionBetween(h.det, det))) : Infinity;
    const speedDia = st.dia ? st.kf.speed() / st.dia : Infinity; // 칼만 추정 속도(스티커 지름/초)
    c.still = c.stickers && motion < 0.15 && speedDia < 0.6; c.stillMsg = c.stickers && !c.still ? (st.hist.length < 2 ? '안정 상태 확인 중' : '발이 움직이고 있습니다') : '';
    // 정렬: 가이드 안(가장자리 여유) + 목표 영역 정밀 정렬(중앙·크기·수평) + 정면 촬영(스티커가 원으로 보임)
    const fr = det.landmarks ? C.framingCheck(det) : { ok: false, msg: '', code: 'NONE' };
    const al = det.landmarks ? C.guideCheck(det, getToe()) : { ok: false, msg: '', code: 'NONE' };
    const faceOn = det.quality && det.quality.minAxisRatio >= 0.9;
    c.frame = fr.ok && al.ok && !!faceOn;
    c.frameMsg = !det.landmarks ? '' : !fr.ok ? fr.msg : !al.ok ? al.msg : !faceOn ? '휴대폰이 발 안쪽 면을 정면으로 향하게 해 주십시오' : '';
    c.frameCode = !det.landmarks ? 'NONE' : !fr.ok ? fr.code : !al.ok ? al.code : faceOn ? '' : 'FACE';
    const ready = det.ok && c.stickers && c.sharp && c.still && c.frame;
    st.lastOk = det.ok && consistent ? det : (det.ok && !st.lastOk ? det : null);
    // 칼만 갱신: 측정 잡음 = 타원 피팅 잔차. 실패 프레임은 '놓침'으로 처리(7회 연속이면 추적 초기화)
    if (det.ok && consistent) { st.kf.update(det.landmarks, Math.max(0.15, det.quality.fitRmsPx || 0.3), now); st.colorModel = det.colorModel || st.colorModel; st.dia = det.quality.diameterPx; }
    else if (det.ok && !pred) { st.kf.reset(); st.kf.update(det.landmarks, 0.3, now); st.colorModel = det.colorModel || null; st.dia = det.quality.diameterPx; }
    else { st.kf.miss(); if (!st.kf.active) { st.colorModel = null; st.dia = null; } }
    st.smooth = st.kf.positions() || (det.landmarks ? { P1: det.landmarks.P1, P2: det.landmarks.P2, P3: det.landmarks.P3 } : null);
    return { c, ready, motion, speedDia, guide: al };
  }
  async function tick() {
    const { img } = imageDataFromSource(video, 640);
    const IW = img.width, IH = img.height;
    const thumb = sceneThumb(img); // 워커로 넘기기 전에 계산(버퍼가 비워짐)
    let sceneMotion = 0;
    if (st.thumb && st.thumb.length === thumb.length) { let d = 0; for (let i = 0; i < thumb.length; i++) d += Math.abs(thumb[i] - st.thumb[i]); sceneMotion = d / thumb.length; }
    st.thumb = thumb;
    const t0 = performance.now();
    const pred = st.kf.predict(t0); // 칼만 예측 위치 → 탐색 영역·후보 대응·라벨 확인에 사용
    const roiPrev = pred && st.dia ? { ok: true, landmarks: pred, quality: { diameterPx: st.dia } } : st.lastOk;
    const det = await Detector.run(img, { toeDirection: getToe(), colorModel: st.colorModel, prior: pred }, roiPrev);
    if (st.paused || !st.stream) return;
    const now = performance.now(); st.fpsT.push(now); st.fpsT = st.fpsT.filter(t => now - t < 1000);
    st.liveW = IW;
    const a = assess(det, now, pred);
    const wr = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    overlay.width = wr.width * dpr; overlay.height = wr.height * dpr; const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = Math.min(wr.width / IW, wr.height / IH), ox = (wr.width - IW * k) / 2, oy = (wr.height - IH * k) / 2;
    drawGuide(g, ox, oy, k, IW, IH, getToe(), { ready: a.ready, seen: !!det.landmarks, inP3: a.guide.inP3, inP1: a.guide.inP1, inP2: a.guide.inP2 }, det.landmarks && !a.c.frame ? (a.c.frameMsg || '').replace(/ 주십시오| 주세요|십시오/g, '') : '', det.sole);
    drawOverlay(g, { stickers: det.stickers, rejected: det.rejected, landmarks: det.landmarks && st.smooth ? Object.assign({}, det.landmarks, st.smooth) : det.landmarks }, k, k, ox, oy);
    onFrame(Object.assign({ det, fps: st.fpsT.length, roi: !!det.roi, sceneMotion }, a));
  }
  function loop() {
    if (!st.stream) return;
    const t0 = performance.now();
    const next = () => { st.timer = setTimeout(loop, Math.max(0, 66 - (performance.now() - t0))); S.loopTimer = st.timer; };
    if (st.paused || st.inflight || !video.videoWidth) return next();
    st.inflight = true;
    tick().catch(e => console.warn(e)).finally(() => { st.inflight = false; next(); });
  }
  async function start() {
    stop();
    resetHistory();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error('이 브라우저(또는 보안 연결이 아닌 주소)에서는 카메라 API를 사용할 수 없습니다. 최신 Chrome·Safari에서 HTTPS 주소로 열거나, “사진 파일 불러오기”를 사용하세요.'); e.name = 'Unsupported'; throw e; }
    st.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: st.facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    if (!video.isConnected) { st.stream.getTracks().forEach(t => t.stop()); st.stream = null; const e = new Error('화면이 바뀌어 카메라를 시작하지 않았습니다.'); e.name = 'Stale'; throw e; }
    S.stream = st.stream;
    video.srcObject = st.stream; await video.play().catch(() => {});
    try { st.devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { st.devices = []; }
    await Detector.init();
    st.paused = false; loop();
  }
  function stop() { if (st.timer) clearTimeout(st.timer); st.timer = null; stopCamera(); st.stream = null; }
  function resetHistory() { st.hist = []; st.lastOk = null; st.smooth = null; st.kf.reset(); st.colorModel = null; st.dia = null; }
  // 현재 추적 위치(가로 폭 대비 비율) — 고해상도 연속 촬영에서 후보 대응에 사용
  function priorNorm() { const p = st.kf.positions(); if (!p || !st.liveW) return null; return Object.fromEntries(['P1', 'P2', 'P3'].map(k => [k, { x: p[k].x / st.liveW, y: p[k].y / st.liveW }])); }
  return { priorNorm, start, stop, resetHistory, pause() { st.paused = true; }, resume() { st.paused = false; resetHistory(); }, flip() { st.facing = st.facing === 'environment' ? 'user' : 'environment'; return start(); }, get deviceCount() { return st.devices.length; }, get running() { return !!st.stream; } };
}

/**
 * 연속 촬영: 12프레임을 찍어 흐린·튀는 프레임을 버리고 좌표를 평균한다(카메라는 끄지 않음).
 * 반환: { canvas, det, meas, combined }
 */
const BURST = 12, MAXSIDE = 1600;
async function burstCapture(video, toe, priorNorm) {
  const dets = new Array(BURST).fill(null), jobs = []; let keep = null; const mid = Math.floor(BURST / 2);
  for (let i = 0; i < BURST; i++) {
    if (!video.videoWidth) break;
    const { canvas, img } = imageDataFromSource(video, MAXSIDE);
    if (i === mid) keep = canvas;
    const prior = priorNorm ? Object.fromEntries(['P1', 'P2', 'P3'].map(k => [k, { x: priorNorm[k].x * img.width, y: priorNorm[k].y * img.width }])) : null;
    jobs.push(Detector.run(img, { toeDirection: toe, prior }).then(d => { dets[i] = d; }).catch(() => {}));
    if (i >= 2) await jobs[i - 2]; // 동시에 처리 중인 프레임을 3개 이하로 제한(메모리)
    await new Promise(r => setTimeout(r, 70));
  }
  await Promise.all(jobs);
  if (!keep) return { canvas: null, det: { ok: false, reasons: [{ msg: '카메라 프레임을 가져오지 못했습니다.' }], stickers: [], rejected: [] }, meas: null };
  const cb = C.combineDetections(dets.filter(Boolean), 5);
  if (!cb.ok) {
    const m = dets[mid] || {};
    const fail = { ok: false, reasons: [{ msg: cb.reason }].concat(m.ok === false ? m.reasons : []), stickers: m.stickers || [], rejected: m.rejected || [], landmarks: null, imageSize: m.imageSize };
    return { canvas: keep, det: fail, meas: C.measureImage(fail, convSettings()) };
  }
  return { canvas: keep, det: cb.det, meas: C.measureImage(cb.det, convSettings()) };
}

// 검출 결과를 검사 기록용으로 정리
function captureRecord(det, meas, mode, toe) {
  const pick = p => ({ x: p.x, y: p.y });
  return {
    capturedAt: Date.now(), mode, imageSize: det.imageSize, toeDirection: toe,
    landmarks: { P1: pick(det.landmarks.P1), P2: pick(det.landmarks.P2), P3: pick(det.landmarks.P3), axisAngleDeg: det.landmarks.axisAngleDeg, tFromHeel: det.landmarks.tFromHeel },
    stickers: det.stickers.map(s => ({ cx: s.cx, cy: s.cy, major: s.major, minor: s.minor, axisRatio: s.axisRatio, score: s.score })),
    confidence: det.confidence, detectionConfidence: det.detectionConfidence, labelConfidence: det.landmarks.labelConfidence, quality: det.quality,
    measure: Object.assign({}, meas, { imageSize: det.imageSize })
  };
}
function paintChecksInto(el, c) {
  el.innerHTML = [['stickers', '스티커 3개'], ['sharp', '선명도'], ['still', '움직임 없음'], ['frame', '가이드 안·각도']].map(([k, l]) => `<div class="${c[k] ? 'ok' : 'no'}">${c[k] ? '✓' : '•'} ${l}${c[k + 'Msg'] ? `<div class="tiny" style="color:inherit">${esc(c[k + 'Msg'])}</div>` : ''}</div>`).join('');
}
