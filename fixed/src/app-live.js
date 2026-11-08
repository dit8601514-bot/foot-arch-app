'use strict';
/* ═════════════ 실시간 촬영 공통 모듈: 음성 안내 · 트래킹 루프 · 연속 촬영 ═════════════ */

// 음성 안내 (Web Speech API). iOS/Safari는 사용자가 버튼을 누른 순간에 한 번 말해야 이후에도 말할 수 있다.
// 알아듣기 쉽게: 기기에서 가장 자연스러운 한국어 목소리를 고르고, 조금 천천히, 문장마다 잠깐 쉬어 말한다.
// 안내 시작 전에 짧은 알림음을 내어 주의를 끈다. 화면 자막은 쓰지 않는다.
const Voice = (() => {
  let enabled = true, unlocked = false, ctx = null, voice = null, gen = 0, talking = false; const keep = [];
  const RATE = 0.88, PAUSE_MS = 350;
  const ok = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function score(v) {
    let s = 0;
    if (/ko[-_]KR/i.test(v.lang)) s += 10; else if (/^ko/i.test(v.lang)) s += 8; else return -1;
    if (/premium|enhanced|향상|neural|natural|고품질/i.test(v.name)) s += 5;
    if (/google/i.test(v.name)) s += 4;
    if (/yuna|유나|sora|heami|sunhi|injoon|jimin/i.test(v.name)) s += 2;
    if (/compact|eloquence|grandma|grandpa|rocko|shelley|sandy|flo|reed/i.test(v.name)) s -= 6; // 기계음이 강한 목소리
    return s;
  }
  function pickVoice() {
    if (!ok()) return null;
    const vs = speechSynthesis.getVoices().map(v => [score(v), v]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]);
    return vs.length ? vs[0][1] : null;
  }
  if (ok()) { voice = pickVoice(); speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); }; }
  // 화면용 문구를 듣기 좋은 말로: 괄호 속 보충 설명·기호·약어를 풀어 쓴다
  function speakable(t) {
    return String(t).replace(/\([^)]*\)/g, '').replace(/\bP2\b/g, '가운데 스티커').replace(/\bP1\b/g, '엄지발가락 쪽 스티커').replace(/\bP3\b/g, '뒤꿈치 스티커')
      .replace(/°/g, '도').replace(/%/g, '퍼센트').replace(/[–~]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const sentences = t => (speakable(t).match(/[^.!?]+[.!?]*/g) || []).map(x => x.trim()).filter(Boolean); // lookbehind 미사용(iOS 16.3 이하 호환)
  function speakOne(text, my) {
    return new Promise(res => {
      if (my !== gen) return res(false);
      const u = new SpeechSynthesisUtterance(text); u.lang = 'ko-KR'; if (voice) u.voice = voice; u.rate = RATE; u.pitch = 1; u.volume = 1;
      keep.push(u); if (keep.length > 8) keep.shift(); // Chrome: 참조가 없으면 말하는 도중 사라져 onend가 오지 않는 문제
      let started = false, tries = 0;
      const t = setTimeout(() => res(true), Math.min(10000, 1800 + text.length * 190)); // onend가 오지 않는 기기 대비
      u.onstart = () => { started = true; };
      u.onend = () => { clearTimeout(t); res(true); }; u.onerror = () => { clearTimeout(t); res(false); };
      const go = () => { try { if (speechSynthesis.paused) speechSynthesis.resume(); speechSynthesis.speak(u); } catch (e) { clearTimeout(t); res(false); } };
      go();
      // 음성 엔진이 멈춰 말을 시작하지 않으면 한 번 초기화하고 다시 말한다
      const kick = () => { if (started || my !== gen || tries >= 1 || speechSynthesis.speaking) return; tries++; try { speechSynthesis.cancel(); } catch (e) {} setTimeout(go, 120); };
      setTimeout(kick, 3000);
    });
  }
  async function say(text, opts) {
    const o = Object.assign({ interrupt: true, chime: true }, opts);
    if (!enabled || !ok()) return false;
    let my;
    if (o.interrupt) { my = ++gen; if (talking || speechSynthesis.speaking || speechSynthesis.pending) { try { speechSynthesis.cancel(); } catch (e) {} await wait(120); } } // iOS: 말하는 중이 아닐 때 cancel하면 다음 말이 묻히는 문제 회피 // 취소 직후 바로 말하면 무시하는 기기 대비
    else {
      // 보조 안내: 앞 안내가 끝날 때까지 최대 6초 기다렸다가 말한다(버리지 않음). 기기의 speaking 값은 믿지 않고 앱이 직접 추적.
      my = gen; const t0 = Date.now();
      while (talking && Date.now() - t0 < 6000) { await wait(150); if (my !== gen) return false; }
      if (talking) return false;
      my = ++gen;
    }
    talking = true;
    try { return await sayParts(text, o, my); } finally { if (my === gen) talking = false; }
  }
  async function sayParts(text, o, my) {
    if (o.chime) { chime(); await wait(260); }
    const parts = sentences(text);
    for (let i = 0; i < parts.length; i++) {
      if (my !== gen) return false;
      await speakOne(parts[i], my);
      if (i < parts.length - 1) await wait(PAUSE_MS);
    }
    return my === gen;
  }
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function tone(freq, ms, at, gain) {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + (at || 0), d = (ms || 150) / 1000;
    o.type = 'sine'; o.frequency.value = freq || 880;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain || 0.15, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }
  function beep(freq, ms) { try { tone(freq, ms); } catch (e) { /* 소리 미지원 */ } }
  function chime() { try { tone(784, 120, 0, 0.12); tone(1175, 160, 0.11, 0.12); } catch (e) {} }
  function unlock() { unlocked = true; beep(660, 60); if (ok()) { try { const u = new SpeechSynthesisUtterance(' '); u.lang = 'ko-KR'; u.volume = 0; speechSynthesis.speak(u); } catch (e) {} } }
  return { say, beep, unlock, speakable, get supported() { return ok(); }, get hasKorean() { return !!voice; }, get voiceName() { return voice ? voice.name : ''; }, get enabled() { return enabled; }, set enabled(v) { enabled = !!v; if (!v && ok()) { gen++; speechSynthesis.cancel(); } }, get unlocked() { return unlocked; } };
})();

// 휴대폰 방향: 화면이 세로로 고정된 채 휴대폰을 가로로 눕히면 카메라 영상이 세로로 들어온다.
// 중력 센서로 처음 방향을 추정하고, 스티커 배치(발배뼈 스티커가 위쪽)로 확정한다.
const Orient = (() => {
  let gx = 0, gy = 0, have = false, listening = false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function listen() {
    if (listening || !('DeviceMotionEvent' in window)) return; listening = true;
    window.addEventListener('devicemotion', e => { const a = e.accelerationIncludingGravity; if (a && a.x != null) { gx = gx * 0.7 + a.x * 0.3; gy = gy * 0.7 + a.y * 0.3; have = true; } });
  }
  // iOS는 버튼을 누른 순간에 권한을 요청해야 한다
  function request() {
    try {
      if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function') DeviceMotionEvent.requestPermission().then(r => { if (r === 'granted') listen(); }).catch(() => {});
      else listen();
    } catch (e) { /* 센서 없음 */ }
  }
  if (!(window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function')) listen();
  // 원본 영상(세로 화면 기준)에서 실제 위쪽이 어느 방향인지 → 필요한 회전(0/90/180/270)
  function guess(portraitFrame) {
    if (!have || Math.hypot(gx, gy) < 4) return portraitFrame ? 270 : 0;
    const x = ios ? -gx : gx, y = ios ? -gy : gy; // Android 기준: 세로로 세우면 y≈+9.8
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 270 : 90;
    return y > 0 ? 0 : 180;
  }
  return { request, guess, get available() { return have; } };
})();
// 회전된 분석 좌표 → 화면에 표시된 원본 영상 좌표로 그리기 위한 캔버스 변환
function setRotatedTransform(g, rot, ox, oy, k, rawW, rawH) {
  if (rot === 90) g.transform(0, -1, 1, 0, ox, oy + k * rawH);
  else if (rot === 180) g.transform(-1, 0, 0, -1, ox + k * rawW, oy + k * rawH);
  else if (rot === 270) g.transform(0, 1, -1, 0, ox + k * rawW, oy);
  else g.translate(ox, oy);
}
// 스티커 세 개의 배치로 방향 판정: 양 끝(P1·P3) 축이 수평이고 가운데(P2)가 축보다 위에 있어야 한다.
function orientVote(det) {
  const pts = det.landmarks ? [det.landmarks.P1, det.landmarks.P2, det.landmarks.P3] : det.stickers && det.stickers.length === 3 ? det.stickers.map(c => ({ x: c.cx, y: c.cy })) : null;
  if (!pts) return null;
  let bi = 0, bj = 1, bd = -1;
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) { const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y); if (d > bd) { bd = d; bi = i; bj = j; } }
  let a = pts[bi], b = pts[bj]; const m = pts[3 - bi - bj];
  if (b.x < a.x) [a, b] = [b, a];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dy) > Math.abs(dx)) return 'turn';
  const off = (dx * (m.y - a.y) - dy * (m.x - a.x)) / bd; // +: 가운데 스티커가 축보다 아래
  const dia = (det.quality && det.quality.diameterPx) || bd * 0.06;
  return off > 0.5 * dia ? 'flip' : 'ok';
}

function chip(g, x, y, text, bg, fg, align) {
  g.font = '600 12px -apple-system,system-ui,sans-serif'; const w = g.measureText(text).width + 14, h = 20, r = 10;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.fillStyle = bg; g.beginPath(); g.moveTo(x0 + r, y); g.arcTo(x0 + w, y, x0 + w, y + h, r); g.arcTo(x0 + w, y + h, x0, y + h, r); g.arcTo(x0, y + h, x0, y, r); g.arcTo(x0, y, x0 + w, y, r); g.fill();
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x0 + 7, y + h / 2 + 0.5); g.textBaseline = 'alphabetic';
}
// 촬영 거리: 25 cm 고정(설정으로 바꿀 수 없음, 사용자 결정 v3.3.2·v3.6.0)
const TARGET_DIST_CM = 25;
// 검출된 바닥선(발바닥 경계) 표시
function drawSoleLine(g, k, IW, sole) {
  const xa = 0.03 * IW, xb = 0.97 * IW, ay = sole.slope * xa + sole.intercept, by = sole.slope * xb + sole.intercept;
  g.strokeStyle = 'rgba(0,229,255,.9)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(xa * k, ay * k); g.lineTo(xb * k, by * k); g.stroke();
  chip(g, xb * k - 4, by * k - 24, '바닥선', 'rgba(0,150,190,.85)', '#fff', 'right');
}
// 전문가용 추적 표시: 스티커마다 잠금 조준선, P1–P3 기준선과 P2 수선, 실시간 P2 높이(mm), 추적 상태 막대
function drawTrackHud(g, det, smooth, k, hud) {
  const T = p => [p.x * k, p.y * k], lm = det.landmarks;
  const locked = hud.locked, col = locked ? '#34d399' : '#7dd3fc';
  // 후보(라벨 전) 스티커
  if (!lm) for (const c of det.stickers || []) { const r = (c.major / 2) * k + 6; g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.setLineDash([3, 4]); g.beginPath(); g.arc(c.cx * k, c.cy * k, r, 0, 7); g.stroke(); g.setLineDash([]); }
  for (const c of det.rejected || []) if (c.area > 30) { g.strokeStyle = 'rgba(251,191,36,.9)'; g.setLineDash([4, 3]); g.lineWidth = 1.2; g.strokeRect(c.bbox[0] * k, c.bbox[1] * k, c.bbox[2] * k, c.bbox[3] * k); g.setLineDash([]); }
  if (lm) {
    const P = smooth ? Object.assign({}, lm, smooth) : lm, R = ((det.quality && det.quality.diameterPx) || 20) / 2 * k;
    const [a1, b1] = T(P.P1), [a3, b3] = T(P.P3), [a2, b2] = T(P.P2);
    g.strokeStyle = 'rgba(255,216,77,.95)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a1, b1); g.lineTo(a3, b3); g.stroke();
    const t = C.projectionT(P.P2, P.P1, P.P3), fx = P.P1.x + (P.P3.x - P.P1.x) * t, fy = P.P1.y + (P.P3.y - P.P1.y) * t, [ff, fg] = T({ x: fx, y: fy });
    g.strokeStyle = 'rgba(0,229,255,.95)'; g.setLineDash([5, 4]); g.lineWidth = 1.6; g.beginPath(); g.moveTo(a2, b2); g.lineTo(ff, fg); g.stroke(); g.setLineDash([]);
    if (hud.heightMm != null) chip(g, (a2 + ff) / 2 + 8, (b2 + fg) / 2 - 10, `P2 ${hud.heightMm.toFixed(1)} mm`, 'rgba(0,150,190,.9)', '#fff');
    const NAME = { P1: 'P1 엄지 뿌리', P2: 'P2 발배뼈', P3: 'P3 뒤꿈치' };
    for (const [n, x, y] of [['P1', a1, b1], ['P2', a2, b2], ['P3', a3, b3]]) {
      // 잠금 조준선: 원 + 네 방향 눈금, 잠기면 초록
      const r = R + 5; g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      g.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(x + dx * (r + 2), y + dy * (r + 2)); g.lineTo(x + dx * (r + 9), y + dy * (r + 9)); } g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(x, y, 2.2, 0, 7); g.fill();
      chip(g, x, y - r - 30, NAME[n], locked ? 'rgba(6,95,70,.85)' : 'rgba(13,27,61,.75)', '#fff', 'center');
    }
  }
  // 추적 상태 막대(왼쪽 아래)
  const txt = `${locked ? '● 추적 고정' : lm ? '◐ 추적 중' : '○ 스티커 찾는 중'}  ·  ${hud.n}/3  ·  ${hud.fps} fps${hud.sigma != null ? `  ·  ±${hud.sigma.toFixed(2)} px` : ''}`;
  chip(g, 8 / 1, hud.h - 28, txt, 'rgba(13,27,61,.72)', locked ? '#6ee7b7' : '#e2e8f0');
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
    // 움직임 판정을 둘로 나눈다: ① 형태 변화(세 점의 상대 배치) = 발이 실제로 움직임 → 촬영 보류
    // ② 세 점이 함께 이동 = 휴대폰 흔들림(측정값은 상대 배치라 영향이 거의 없음) → 크게 흔들릴 때만 보류(흐림은 선명도 검사가 따로 잡음)
    const shapeMotion = st.hist.length >= 2 ? Math.max(...st.hist.map(h => C.shapeDelta(h.det, det))) : Infinity;
    const footStill = shapeMotion < 0.12, phoneStill = motion < 0.8 && speedDia < 2.0;
    c.still = c.stickers && footStill && phoneStill;
    c.stillCode = !c.stickers || c.still ? '' : st.hist.length < 2 ? 'WAIT' : !footStill ? 'FOOT' : 'PHONE';
    c.stillMsg = { WAIT: '안정 상태 확인 중', FOOT: '발이 움직이고 있습니다', PHONE: '휴대폰이 흔들리고 있습니다. 휴대폰을 고정해 주십시오', '': '' }[c.stillCode];
    // v3.6.0(사용자 결정): 발 윤곽 가이드·정렬 판정으로 촬영을 막지 않는다.
    // 스티커 P1·P2·P3가 모두 보이고(가장자리에 걸리지 않음) 선명하며 움직이지 않으면(고정) 준비 완료. 거리는 25 cm 고정(app-self에서 확인).
    const ready = det.ok && c.stickers && c.sharp && c.still;
    const readyLoose = ready;
    st.lastOk = det.ok && consistent ? det : (det.ok && !st.lastOk ? det : null);
    // 칼만 갱신: 측정 잡음 = 타원 피팅 잔차. 실패 프레임은 '놓침'으로 처리(7회 연속이면 추적 초기화)
    if (det.ok && consistent) { st.kf.update(det.landmarks, Math.max(0.15, det.quality.fitRmsPx || 0.3), now); st.colorModel = det.colorModel || st.colorModel; st.dia = det.quality.diameterPx; }
    else if (det.ok && !pred) { st.kf.reset(); st.kf.update(det.landmarks, 0.3, now); st.colorModel = det.colorModel || null; st.dia = det.quality.diameterPx; }
    else { st.kf.miss(); if (!st.kf.active) { st.colorModel = null; st.dia = null; } }
    st.smooth = st.kf.positions() || (det.landmarks ? { P1: det.landmarks.P1, P2: det.landmarks.P2, P3: det.landmarks.P3 } : null);
    return { c, ready, readyLoose, motion, shapeMotion, speedDia };
  }
  // 영상 회전(0/90/180/270): 처음엔 중력 센서로 추정, 이후 스티커 배치로 보정. 촬영이 시작되면 고정.
  function autoRotation() { return Orient.guess(video.videoHeight > video.videoWidth); }
  function orientUpdate(det) {
    if (st.rotLock || st.rotManual) return;
    const v = orientVote(det);
    if (v === 'turn' || v === 'flip') st.rotVotes = st.rotVotes && st.rotVotes.v === v ? { v, n: st.rotVotes.n + 1 } : { v, n: 1 };
    else if (v === 'ok') { st.rotVotes = null; st.rotConfirmed = true; }
    if (st.rotVotes && st.rotVotes.n >= 3) {
      st.rot = (st.rot + (st.rotVotes.v === 'flip' ? 180 : 90)) % 360; st.rotVotes = null; st.rotConfirmed = false; resetHistory();
    } else if (!st.rotConfirmed && !(det.stickers && det.stickers.length)) {
      const g = autoRotation(); if (g !== st.rot) { st.rot = g; resetHistory(); }
    }
  }
  async function tick() {
    if (st.rot == null) st.rot = autoRotation();
    const rot = st.rot;
    const tGrab = performance.now();
    const { img } = imageDataFromSource(video, 640, rot);
    const IW = img.width, IH = img.height, turned = rot === 90 || rot === 270, rawW = turned ? IH : IW, rawH = turned ? IW : IH;

    const thumb = sceneThumb(img); // 워커로 넘기기 전에 계산(버퍼가 비워짐)
    let sceneMotion = 0;
    if (st.thumb && st.thumb.length === thumb.length) { let d = 0; for (let i = 0; i < thumb.length; i++) d += Math.abs(thumb[i] - st.thumb[i]); sceneMotion = d / thumb.length; }
    st.thumb = thumb;
    const t0 = performance.now();
    const pred = st.kf.predict(t0); // 칼만 예측 위치 → 탐색 영역·후보 대응·라벨 확인에 사용
    const roiPrev = pred && st.dia ? { ok: true, landmarks: pred, quality: { diameterPx: st.dia } } : st.lastOk;
    const det = await Detector.run(img, { toeDirection: getToe(), colorModel: st.colorModel, prior: pred }, roiPrev);
    if (st.paused || !st.stream) return;
    if (rot !== st.rot) return; // 처리 중에 방향이 바뀜
    const now = performance.now(); st.fpsT.push(now); st.fpsT = st.fpsT.filter(t => now - t < 1000);
    st.liveW = IW;
    const a = assess(det, now, pred);
    const wr = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    overlay.width = wr.width * dpr; overlay.height = wr.height * dpr; const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = Math.min(wr.width / rawW, wr.height / rawH), ox = (wr.width - rawW * k) / 2, oy = (wr.height - rawH * k) / 2;
    const ar = rawW + ' / ' + rawH; if (wrap.style.aspectRatio !== ar) wrap.style.aspectRatio = ar;
    setRotatedTransform(g, rot, ox, oy, k, rawW, rawH);
    // 스티커 표시 지연 보정(2026-11 사용자 화면: 앉는 동안 원이 실제 스티커보다 뒤처짐):
    // 프레임을 잡은 뒤 분석·그리기까지 걸린 시간 + 화면 표시 1프레임만큼, 칼만 속도로 앞당겨 그린다. 거의 멈춰 있으면(흔들림 잡음) 보정하지 않음.
    const lagS = Math.min(0.35, (performance.now() - tGrab) / 1000 + 0.033), sp = st.kf.speed(), diaPx = (det.quality && det.quality.diameterPx) || st.dia || 20;
    const lead = st.kf.active && sp > 0.6 * diaPx ? Math.min(1, (sp - 0.6 * diaPx) / (1.4 * diaPx)) : 0;
    const drawSmooth = lead > 0 ? st.kf.positionsAhead(lagS * lead, 1.5 * diaPx) : st.smooth;
    let gdx = 0, gdy = 0; if (drawSmooth && st.smooth) { for (const n of ['P1', 'P2', 'P3']) { gdx += (drawSmooth[n].x - st.smooth[n].x) / 3; gdy += (drawSmooth[n].y - st.smooth[n].y) / 3; } }
    // 발 윤곽 가이드는 그리지 않는다(v3.6.0). 검출된 바닥선만 참고로 표시.
    if (det.sole && det.sole.ok) drawSoleLine(g, k, IW, det.sole);
    { const cs = typeof convSettings === 'function' ? convSettings() : null, dia = det.quality && det.quality.diameterPx, P = st.smooth || (det.landmarks && det.landmarks);
      const hMm = det.landmarks && P && cs && cs.validated && dia ? C.distanceToLine(P.P2, P.P1, P.P3) * cs.stickerDiameterMm / dia : null;
      st.lockN = det.ok && st.kf.active ? (st.lockN || 0) + 1 : 0;
      drawTrackHud(g, det, drawSmooth, k, { locked: st.lockN >= 4, heightMm: hMm, n: det.landmarks ? 3 : Math.min(3, (det.stickers || []).length), fps: st.fpsT.length, sigma: det.quality && det.quality.fitRmsPx, h: IH * k }); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    orientUpdate(det);
    // 촬영 거리: 실시간(640px) 스티커 지름을 촬영 해상도로 환산 → 최근 9프레임 중앙값으로 흔들림 제거
    let dist = null;
    if (det.landmarks && det.quality && det.quality.diameterPx > 0) {
      const capSide = Math.min(MAXSIDE, Math.max(video.videoWidth || 0, video.videoHeight || 0) || MAXSIDE), liveSide = Math.max(IW, IH);
      const cs = typeof convSettings === 'function' ? convSettings() : null, mmD = (cs && cs.stickerDiameterMm) || (S.settings && S.settings.stickerDiameterMm) || 19;
      st.mmpx = (st.mmpx || []).concat(mmD / (det.quality.diameterPx * capSide / liveSide) * (window.FOOTARCH_MMPX_SCALE || 1)).slice(-9); // 시험용 배율
      const q = st.mmpx.slice().sort((x, y) => x - y), Sg = (S && S.settings) || {};
      dist = C.distanceAdvice(q[q.length >> 1], capSide, { targetCm: TARGET_DIST_CM, fovK: window.FOOTARCH_FOVK || Sg.fovK });
    }
    a.c.dist = !!(dist && dist.code === 'OK'); a.c.distMsg = !det.landmarks || a.c.dist || !dist ? '' : `지금 약 ${dist.estCm.toFixed(0)} cm`;
    onFrame(Object.assign({ det, fps: st.fpsT.length, roi: !!det.roi, sceneMotion, rotation: rot, dist }, a));
  }
  function loop() {
    if (!st.stream) return;
    const t0 = performance.now();
    const next = () => { st.timer = setTimeout(loop, Math.max(0, 66 - (performance.now() - t0))); S.loopTimer = st.timer; };
    if (st.inflight && performance.now() - st.inflightAt > 9000) st.inflight = false; // 감시: 한 프레임 처리가 멈추면 풀어 준다
    if (st.paused || st.inflight || !video.videoWidth) return next();
    st.inflight = true; st.inflightAt = performance.now();
    tick().catch(e => console.warn(e)).finally(() => { st.inflight = false; next(); });
  }
  async function start() {
    stop();
    resetHistory();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error('이 브라우저(또는 보안 연결이 아닌 주소)에서는 카메라 API를 사용할 수 없습니다. 최신 Chrome·Safari에서 HTTPS 주소로 열거나, “사진 파일 불러오기”를 사용하세요.'); e.name = 'Unsupported'; throw e; }
    const vc = st.deviceId ? { deviceId: { exact: st.deviceId } } : { facingMode: st.facing };
    st.stream = await navigator.mediaDevices.getUserMedia({ video: Object.assign(vc, { width: { ideal: 1920 }, height: { ideal: 1080 } }), audio: false });
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
  // 후면 카메라 순환(아이폰: 기본 1× → 0.5× 울트라 와이드 → …). 발이 가까워 다 안 보이면 광각을 쓴다.
  function backCams() { return st.devices.filter(d => !/front|전면|user|facetime/i.test(d.label || '')); }
  async function nextCamera() {
    const cams = backCams(); if (cams.length < 2) return null;
    const curId = st.stream && st.stream.getVideoTracks()[0] && st.stream.getVideoTracks()[0].getSettings ? st.stream.getVideoTracks()[0].getSettings().deviceId : st.deviceId;
    const i = cams.findIndex(d => d.deviceId === curId), nx = cams[(i + 1) % cams.length];
    st.deviceId = nx.deviceId; st.rot = null; await start(); return nx.label || '카메라 ' + ((i + 1) % cams.length + 1);
  }
  return { priorNorm, start, stop, resetHistory, nextCamera, get backCameraCount() { return backCams().length; },
    get rotation() { return st.rot || 0; },
    lockRotation(v) { st.rotLock = !!v; },
    rotate() { st.rotManual = true; st.rot = ((st.rot || 0) + 90) % 360; resetHistory(); return st.rot; },
    autoRotate() { st.rotManual = false; st.rotConfirmed = false; st.rot = null; resetHistory(); }, pause() { st.paused = true; }, resume() { st.paused = false; resetHistory(); }, flip() { st.facing = st.facing === 'environment' ? 'user' : 'environment'; return start(); }, get deviceCount() { return st.devices.length; }, get running() { return !!st.stream; } };
}

/**
 * 연속 촬영: 12프레임을 찍어 흐린·튀는 프레임을 버리고 좌표를 평균한다(카메라는 끄지 않음).
 * 반환: { canvas, det, meas, combined }
 */
const BURST = 16, MAXSIDE = 1920; // 촬영 사진은 카메라 해상도 그대로(1920) 분석 → 1픽셀당 mm가 작아져 더 세밀하게 // 16장 연속 → 흔들린 장면 제외 후 가중 평균(반복 오차 ↓)
async function burstCapture(video, toe, priorNorm, rot) {
  const dets = new Array(BURST).fill(null), jobs = []; let keep = null; const mid = Math.floor(BURST / 2);
  for (let i = 0; i < BURST; i++) {
    if (!video.videoWidth) break;
    const { canvas, img } = imageDataFromSource(video, MAXSIDE, rot || 0);
    if (i === mid) keep = canvas;
    const prior = priorNorm ? Object.fromEntries(['P1', 'P2', 'P3'].map(k => [k, { x: priorNorm[k].x * img.width, y: priorNorm[k].y * img.width }])) : null;
    jobs.push(Detector.run(img, { toeDirection: toe, prior }).then(d => { dets[i] = d; }).catch(() => {}));
    if (i >= 2) await jobs[i - 2]; // 동시에 처리 중인 프레임을 3개 이하로 제한(메모리)
    await new Promise(r => setTimeout(r, 55));
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
  el.innerHTML = [['stickers', '스티커 3개'], ['sharp', '선명도'], ['still', '움직임 없음'], ['dist', `거리 ${TARGET_DIST_CM} cm`]].map(([k, l]) => `<div class="${c[k] ? 'ok' : 'no'}">${c[k] ? '✓' : '•'} ${l}${c[k + 'Msg'] ? `<div class="tiny" style="color:inherit">${esc(c[k + 'Msg'])}</div>` : ''}</div>`).join('');
}
