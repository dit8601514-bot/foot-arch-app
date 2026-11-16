// AI Footarch 촬영 방법 영상(고정촬영판 F2.12 기준) — 장면 상태별 HTML 생성 + 1920×1080 JPEG 촬영
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const A = 'file:///tmp/vid/assets/';
const OUT = '/tmp/vid/frames';

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;overflow:hidden;font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif;color:#fff;
 background:radial-gradient(900px 600px at 18% 12%,rgba(92,70,255,.55),transparent 70%),radial-gradient(900px 700px at 85% 85%,rgba(20,140,210,.45),transparent 70%),linear-gradient(160deg,#0b0d3d 0%,#14106a 45%,#0a1a4a 100%);position:relative}
body:after{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;pointer-events:none}
.head{position:absolute;left:64px;top:44px;display:flex;align-items:center;gap:18px;z-index:5}
.pill{background:linear-gradient(90deg,#5b6cff,#8a5cff);border-radius:999px;padding:6px 18px;font-size:22px;font-weight:800;letter-spacing:1px}
.title{font-size:40px;font-weight:800}
.cap{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);background:rgba(10,12,45,.82);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:16px 36px;font-size:31px;font-weight:700;white-space:nowrap;z-index:6}
.panel{position:absolute;border-radius:28px;overflow:hidden;box-shadow:0 30px 70px rgba(0,0,0,.45)}
.phone{position:absolute;background:#0d0f1e;border-radius:62px;padding:16px;box-shadow:0 34px 80px rgba(0,0,0,.55),0 0 0 2px rgba(255,255,255,.08)}
.screen{position:relative;width:100%;height:100%;border-radius:48px;overflow:hidden;background:#f4f3ff}
.screen img.shot{position:absolute;left:0;top:0;width:100%}
.lbl{position:absolute;background:rgba(10,14,40,.88);border:1.5px solid rgba(120,170,255,.55);border-radius:14px;padding:12px 20px;z-index:4}
.lbl b{display:block;font-size:30px;font-weight:800}.lbl span{display:block;font-size:22px;color:#c8d4ff;margin-top:4px}
.card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:22px;padding:24px 28px}
.num{display:inline-flex;width:40px;height:40px;border-radius:50%;background:#6d6bff;align-items:center;justify-content:center;font-weight:800;font-size:22px;margin-right:12px;flex:none}
.voice{position:absolute;background:#fff;color:#1a1f3c;border-radius:20px;padding:18px 26px 18px 70px;font-size:27px;font-weight:700;line-height:1.45;box-shadow:0 20px 40px rgba(0,0,0,.35);z-index:5}
.voice:before{content:'';position:absolute;left:22px;top:50%;width:34px;height:34px;margin-top:-17px;border-radius:50%;background:#5b6cff url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='white' d='M4 9h4l5-4v14l-5-4H4z'/><path d='M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round'/></svg>") center/22px no-repeat}
.side{position:absolute;left:64px;top:170px;width:470px;height:560px;border-radius:28px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);display:flex;flex-direction:column;align-items:center;padding-top:40px}
.side h3{font-size:40px;font-weight:800}.side p{font-size:23px;color:#c8d4ff;margin-top:8px}
`;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
const head = (n, t) => `<div class="head">${n ? `<span class="pill">STEP ${n}</span>` : ''}<span class="title">${t}</span></div>`;
const cap = t => t ? `<div class="cap">${t}</div>` : '';

// ── 발 사진 + 스티커(사진 원본 좌표 1384×818) ──
const PW = 1384, PH = 818, ST = { P1: [346, 556], P2: [658, 466], P3: [862, 488] }, ANK = [772, 302];
function sticker(x, y, s, glow) { const r = 34 * s; return `<div style="position:absolute;left:${x * s - r}px;top:${y * s - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;background:radial-gradient(circle at 38% 35%,#3f6dff,#1236c4 60%,#0b2490);box-shadow:${glow ? `0 0 0 ${6 * s}px rgba(90,200,255,.35),0 0 ${26 * s}px rgba(90,200,255,.7)` : '0 2px 6px rgba(0,0,0,.4)'};z-index:3"></div>`; }
function footPanel({ left, top, w, show = [], labels = [], ankle = false, extra = '' }) {
  const s = w / PW, h = PH * s;
  let inner = `<img src="${A}foot_clean.jpg" style="width:${w}px;height:${h}px;display:block">`;
  for (const k of show) inner += sticker(ST[k][0], ST[k][1], s, labels.includes(k));
  if (ankle) inner += `<div style="position:absolute;left:${ANK[0] * s - 44}px;top:${ANK[1] * s - 44}px;width:88px;height:88px;border-radius:50%;border:3px dashed rgba(255,255,255,.85)"></div>`;
  return `<div class="panel" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px">${inner}${extra}</div>`;
}
// 선 연결 라벨(절대 좌표, 화면 기준)
function callout(fromX, fromY, boxX, boxY, b, sp) {
  return `<svg style="position:absolute;left:0;top:0;z-index:3" width="1920" height="1080"><line x1="${fromX}" y1="${fromY}" x2="${boxX}" y2="${boxY}" stroke="#8fd3ff" stroke-width="3"/></svg><div class="lbl" style="left:${boxX - 20}px;top:${boxY - 92}px"><b>${b}</b><span>${sp}</span></div>`;
}

// ── 휴대폰(스크린샷) ──
function phone({ left, top, w, img, scrollCss = 0, dpr = 3, cssW = 390, extra = '' }) {
  const sw = w - 32, sh = sw * 844 / 390, k = sw / cssW;
  return `<div class="phone" style="left:${left}px;top:${top}px;width:${w}px;height:${sh + 32}px"><div class="screen"><img class="shot" src="${A}${img}" style="top:${-scrollCss * k}px">${extra}</div></div>`;
}
// 촬영 화면 합성: 카메라 영역(css 26,180 – 364,370)에 실제 발 사진 + 앱 스타일 표시
function captureScreen({ left, top, w, status, badge = '', chipTop = '1/2 앉은 자세', rec = false }) {
  const sw = w - 32, k = sw / 390;
  const cx = 26 * k, cy = 180 * k, cw = 338 * k, ch = 190 * k;
  // 사진을 카메라 영역에 cover로 배치
  const s = cw / PW, ph = PH * s, oy = (ch - ph) / 2;
  const P = n => [ST[n][0] * s, ST[n][1] * s + oy];
  const [x1, y1] = P('P1'), [x2, y2] = P('P2'), [x3, y3] = P('P3');
  const ring = (x, y) => `<div style="position:absolute;left:${x - 15 * k}px;top:${y - 15 * k}px;width:${30 * k}px;height:${30 * k}px;border-radius:50%;border:${3 * k}px solid #3ee39a"></div>`;
  const chip = (x, y, t, bg = '#1f6b4f') => `<div style="position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-100%);background:${bg};color:#fff;font-weight:800;font-size:${12.5 * k}px;padding:${3 * k}px ${8 * k}px;border-radius:${7 * k}px;white-space:nowrap">${t}</div>`;
  const cam = `<div style="position:absolute;left:${cx}px;top:${cy}px;width:${cw}px;height:${ch}px;border-radius:${16 * k}px;overflow:hidden">
    <img src="${A}foot_clean.jpg" style="position:absolute;left:0;top:${oy}px;width:${cw}px;height:${ph}px">
    <svg style="position:absolute;left:0;top:0" width="${cw}" height="${ch}"><line x1="${x1}" y1="${y1}" x2="${x3}" y2="${y3}" stroke="#ffd23f" stroke-width="${2.5 * k}"/><line x1="${x2}" y1="${y2}" x2="${x2}" y2="${y1 + (y3 - y1) * (x2 - x1) / (x3 - x1)}" stroke="#ffd23f" stroke-width="${2 * k}" stroke-dasharray="${4 * k} ${3 * k}"/></svg>
    ${ring(x1, y1)}${ring(x2, y2)}${ring(x3, y3)}
    ${chip(x1, y1 - 18 * k, 'P1 엄지 뿌리')}${chip(x2, y2 - 34 * k, 'P2 발배뼈')}${chip(x3, y3 - 18 * k, 'P3 뒤꿈치')}
    <div style="position:absolute;left:${8 * k}px;bottom:${8 * k}px;background:rgba(40,48,80,.85);color:#7ff0c0;font-weight:700;font-size:${11 * k}px;padding:${3 * k}px ${9 * k}px;border-radius:${10 * k}px">● 추적 고정 · 3/3 · 16 fps</div>
    ${rec ? `<div style="position:absolute;right:${10 * k}px;top:${10 * k}px;background:#e53935;color:#fff;font-weight:800;font-size:${15 * k}px;padding:${5 * k}px ${12 * k}px;border-radius:${10 * k}px">● 촬영 중</div>` : ''}
  </div>`;
  const cover = (y, hgt, html) => `<div style="position:absolute;left:0;top:${y * k}px;width:${sw}px;height:${hgt * k}px;background:#f5f4ff;display:flex;align-items:center;justify-content:center;color:#141938;font-weight:800;font-size:${17 * k}px">${html}</div>`;
  const chipTopHtml = `<div style="position:absolute;right:${15 * k}px;top:${131 * k}px;background:#eef0fb;color:#3a4064;font-weight:800;font-size:${12 * k}px;padding:${4 * k}px ${10 * k}px;border-radius:${12 * k}px">${chipTop}</div>`;
  const extra = cam + cover(395, 30, status) + chipTopHtml + badge;
  return phone({ left, top, w, img: 'capture.png', dpr: 2, extra });
}

// ── 사람 그림(앉음/섬) ──
const sitFig = `<svg width="300" height="360" viewBox="0 0 300 360"><g stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none"><circle cx="120" cy="60" r="26" fill="#fff" stroke="none"/><line x1="120" y1="100" x2="120" y2="200"/><line x1="120" y1="200" x2="210" y2="200"/><line x1="210" y1="200" x2="210" y2="300"/><line x1="120" y1="130" x2="180" y2="180"/></g><g stroke="#7f8cff" stroke-width="8" fill="none"><line x1="70" y1="215" x2="230" y2="215"/><line x1="80" y1="215" x2="80" y2="320"/><line x1="70" y1="120" x2="70" y2="215"/><line x1="220" y1="215" x2="220" y2="320"/></g><line x1="20" y1="324" x2="280" y2="324" stroke="#8fa0d8" stroke-width="4"/></svg>`;
const standFig = `<svg width="300" height="360" viewBox="0 0 300 360"><g stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none"><circle cx="150" cy="40" r="26" fill="#fff" stroke="none"/><line x1="150" y1="80" x2="150" y2="190"/><line x1="150" y1="190" x2="130" y2="320"/><line x1="150" y1="190" x2="170" y2="320"/><line x1="150" y1="110" x2="110" y2="180"/><line x1="150" y1="110" x2="190" y2="180"/></g><g fill="#ffd23f"><path d="M118 250 l12 0 l0 34 l10 0 l-16 22 l-16 -22 l10 0z"/><path d="M170 250 l12 0 l0 34 l10 0 l-16 22 l-16 -22 l10 0z"/></g><line x1="20" y1="324" x2="280" y2="324" stroke="#8fa0d8" stroke-width="4"/></svg>`;

// ── 관절 사람 그림: t=0 앉음 → t=1 섬 (의자 그대로, 옆모습 · 오른쪽을 봄) ──
const POSES = [
  { t: 0, head: [128, 88], sh: [126, 132], hip: [118, 232], knee: [210, 232], ank: [214, 330], toe: [246, 334], elb: [158, 190], hand: [196, 216] },
  { t: .42, head: [196, 120], sh: [178, 156], hip: [140, 230], knee: [214, 252], ank: [214, 330], toe: [246, 334], elb: [200, 206], hand: [222, 238] },
  { t: .72, head: [218, 72], sh: [212, 114], hip: [196, 210], knee: [216, 270], ank: [214, 330], toe: [246, 334], elb: [218, 168], hand: [220, 214] },
  { t: 1, head: [222, 46], sh: [222, 92], hip: [220, 196], knee: [219, 264], ank: [216, 330], toe: [246, 334], elb: [226, 146], hand: [224, 198] }];
const ease = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
function poseAt(t) { t = Math.max(0, Math.min(1, t)); let i = 0; while (i < POSES.length - 2 && t > POSES[i + 1].t) i++; const a = POSES[i], b = POSES[i + 1], u = ease((t - a.t) / (b.t - a.t)), o = {}; for (const k in a) if (k !== 't') o[k] = [a[k][0] + (b[k][0] - a[k][0]) * u, a[k][1] + (b[k][1] - a[k][1]) * u]; return o; }
function personFig(t, load) {
  const p = poseAt(t), L = (a, b, w, c) => `<line x1="${p[a][0]}" y1="${p[a][1]}" x2="${p[b][0]}" y2="${p[b][1]}" stroke="${c || '#fff'}" stroke-width="${w}" stroke-linecap="round"/>`;
  const neck = [(p.head[0] + p.sh[0]) / 2, (p.head[1] + p.sh[1]) / 2 + 8];
  return `<svg width="320" height="360" viewBox="0 0 320 360">
    <g stroke="#7f8cff" stroke-width="9" stroke-linecap="round" fill="none"><line x1="70" y1="246" x2="168" y2="246"/><line x1="78" y1="246" x2="78" y2="334"/><line x1="160" y1="246" x2="160" y2="334"/><line x1="70" y1="140" x2="70" y2="246"/></g>
    <line x1="30" y1="338" x2="300" y2="338" stroke="#8fa0d8" stroke-width="4"/>
    ${L('hip', 'knee', 22)}${L('knee', 'ank', 20)}${L('ank', 'toe', 14)}
    ${L('sh', 'hip', 26)}<line x1="${neck[0]}" y1="${neck[1]}" x2="${p.sh[0]}" y2="${p.sh[1]}" stroke="#fff" stroke-width="14" stroke-linecap="round"/>
    ${L('sh', 'elb', 15)}${L('elb', 'hand', 13)}
    <circle cx="${p.head[0]}" cy="${p.head[1]}" r="25" fill="#fff"/>
    ${load ? `<g fill="#ffd23f" opacity="${load}"><path d="M266 272 h14 v30 h11 l-18 22 l-18 -22 h11z"/></g><text x="262" y="262" fill="#ffd23f" font-size="20" font-weight="800" opacity="${load}">체중</text>` : ''}
  </svg>`;
}

// ── 위에서 본 배치도(휴대폰 25 cm) ──
const footTop = (x, y, flip, dim) => `<g transform="translate(${x},${y}) scale(${flip ? -1 : 1},1)" opacity="${dim ? .45 : 1}"><path d="M0 -150 C 48 -150 62 -95 58 -30 C 55 30 52 90 40 130 C 30 160 -30 160 -38 125 C -48 80 -42 20 -46 -40 C -50 -100 -45 -150 0 -150 Z" fill="#f2c4a0"/>${[[-30, -158, 13], [-6, -168, 11], [14, -166, 10], [32, -158, 9], [46, -146, 8]].map(([a, b, r]) => `<circle cx="${a}" cy="${b}" r="${r}" fill="#f2c4a0"/>`).join('')}</g>`;
function topView(stage) {
  return `<svg width="900" height="720" viewBox="0 0 900 720">
    <rect x="0" y="0" width="900" height="720" rx="30" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.14)"/>
    <text x="450" y="52" text-anchor="middle" fill="#c8d4ff" font-size="24" font-weight="700">위에서 본 모습 · 발가락은 위쪽</text>
    <rect x="160" y="610" width="580" height="40" rx="12" fill="rgba(140,150,255,.25)"/><text x="450" y="638" text-anchor="middle" fill="#dfe4ff" font-size="22" font-weight="700">의자</text>
    ${footTop(230, 330, true, true)}<text x="230" y="520" text-anchor="middle" fill="#9aa6d8" font-size="24" font-weight="700">왼발(쉬는 발)</text>
    ${footTop(680, 330, false, false)}<text x="680" y="520" text-anchor="middle" fill="#fff" font-size="26" font-weight="800">오른발(검사)</text>
    <g transform="translate(400,330)"><rect x="-14" y="-62" width="28" height="124" rx="8" fill="#20243d" stroke="#8b93c8" stroke-width="3"/><circle cx="8" cy="-44" r="5" fill="#5be0ff"/></g>
    <text x="400" y="430" text-anchor="middle" fill="#fff" font-size="22" font-weight="700">휴대폰</text><text x="400" y="456" text-anchor="middle" fill="#9aa6d8" font-size="19">(가로로 세움)</text>
    <path d="M414 330 L 622 270 L 622 390 Z" fill="rgba(91,224,255,.16)" stroke="rgba(91,224,255,.5)" stroke-width="2"/>
    ${stage >= 1 ? `<g><line x1="414" y1="235" x2="634" y2="235" stroke="#ffd23f" stroke-width="4"/><line x1="414" y1="220" x2="414" y2="250" stroke="#ffd23f" stroke-width="4"/><line x1="634" y1="220" x2="634" y2="250" stroke="#ffd23f" stroke-width="4"/><line x1="414" y1="250" x2="414" y2="268" stroke="#ffd23f" stroke-width="2" stroke-dasharray="5 5"/><rect x="454" y="168" width="140" height="44" rx="12" fill="#ffd23f"/><text x="524" y="199" text-anchor="middle" fill="#1a1f3c" font-size="26" font-weight="900">25 cm</text></g>` : ''}
  </svg>`;
}

// ── 장면 정의: [상태 이름, 유지 초, html] ──
const S = [];
const add = (scene, states) => S.push({ scene, states });

// S1 제목
add('s01', [['a', 4.5, page(`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="font-size:132px;font-weight:900;letter-spacing:-2px">AI Footarch</div>
  <div style="font-size:50px;font-weight:800;color:#a9bbff;margin-top:14px">오른발 유연성 평발 검사 · 촬영 방법</div>
  <div style="font-size:30px;color:#dbe2ff;margin-top:22px">휴대폰 하나로 앉은 자세 → 선 자세를 AI가 자동으로 촬영합니다</div></div>`)]]);

// S2 스티커
{ const L = 268, T = 168, W = 1384, s = W / PW, X = n => L + ST[n][0] * s, Y = n => T + ST[n][1] * s;
  const fp = (show, labels, ankle) => footPanel({ left: L, top: T, w: W, show, labels, ankle });
  const c3 = callout(X('P3'), Y('P3') - 30, 1150, 330, 'P3 · 발꿈치뼈', '뒤꿈치 뒤에서 4 cm · 바닥에서 2 cm');
  const c1 = callout(X('P1'), Y('P1') - 30, 380, 420, 'P1 · 엄지발가락 뿌리', '첫째발허리뼈머리 · 바닥에서 2 cm');
  const c2 = callout(X('P2'), Y('P2') - 30, 760, 300, 'P2 · 발배뼈거친면', '안쪽 복사뼈 앞아래, 튀어나온 뼈');
  const ank = `<div class="lbl" style="left:${L + ANK[0] * s + 60}px;top:${T + ANK[1] * s - 30}px;padding:8px 14px"><span style="margin:0;font-size:21px;color:#fff">안쪽 복사뼈 (부착 위치 아님)</span></div>`;
  const hd = head(1, '스티커 3개 붙이기 (오른발 안쪽)');
  add('s02', [
    ['a', 1.6, page(hd + fp([], []) + cap('오른발 안쪽 면에 파란 원형 스티커 3개를 붙입니다'))],
    ['b', 2.2, page(hd + fp(['P3'], ['P3']) + c3 + cap('첫 번째는 발꿈치뼈에 붙입니다'))],
    ['c', 2.2, page(hd + fp(['P3', 'P1'], ['P1']) + c3 + c1 + cap('두 번째는 엄지발가락 뿌리(첫째발허리뼈머리)에 붙입니다'))],
    ['d', 2.5, page(hd + fp(['P3', 'P1', 'P2'], ['P2'], true) + c3 + c1 + c2 + ank + cap('세 번째는 안쪽 복사뼈 앞아래, 툭 튀어나온 발배뼈거친면에 붙입니다'))],
    ['e', 2.5, page(hd + fp(['P3', 'P1', 'P2'], ['P1', 'P2', 'P3']) + c3 + c1 + c2 + cap('지름 19 mm 파란 원형 스티커 · 높이와 거리는 자로 재어 맞춥니다'))]]); }

// S3 휴대폰 놓기
{ const hd = head(2, '휴대폰 놓기 — 거리 25 cm 고정');
  const items = [['가로로 세우기', '두 발 사이 바닥에 휴대폰을 가로로 세웁니다'], ['뒷면 카메라 → 오른발 안쪽', '스티커 3개가 화면에 보이게 합니다'], ['발 안쪽에서 25 cm', '±2.5 cm · 벗어나면 앱이 음성으로 알려 줍니다']];
  const list = n => `<div style="position:absolute;left:1080px;top:200px;width:770px;display:flex;flex-direction:column;gap:24px">${items.slice(0, n).map(([b, s], i) => `<div class="card" style="display:flex;align-items:flex-start"><span class="num">${i + 1}</span><div><div style="font-size:32px;font-weight:800">${b}</div><div style="font-size:24px;color:#c8d4ff;margin-top:6px">${s}</div></div></div>`).join('')}</div>`;
  const tv = st => `<div style="position:absolute;left:110px;top:170px">${topView(st)}</div>`;
  add('s03', [
    ['a', 3.3, page(hd + tv(0) + list(2) + cap('휴대폰을 두 발 사이에 가로로 세우고, 뒷면 카메라가 오른발 안쪽을 향하게 합니다'))],
    ['b', 4.7, page(hd + tv(1) + list(3) + cap('거리는 25 cm로 고정 · 맞지 않으면 앱이 "조금 더 가까이/멀리" 알려 줍니다'))]]); }

// S4 촬영 버튼
{ const hd = head(3, '앱에서 촬영 버튼 누르기');
  const ph = img => phone({ left: 250, top: 105, w: 400, img });
  const txt = (extra) => `<div style="position:absolute;left:800px;top:230px;width:1050px"><div style="font-size:54px;font-weight:900;line-height:1.25">촬영 버튼을 누르면<br><span style="color:#8fb0ff">바로 시작합니다</span></div><div style="font-size:30px;color:#dbe2ff;margin-top:22px">타이머 없이 음성 안내가 차례로 알려 줍니다</div>${extra}</div>`;
  const v1 = `<div class="voice" style="position:relative;margin-top:40px;width:1000px">준비해 주세요. 휴대폰을 다리 사이에 세워 두고, 의자에 앉아 주십시오.</div>`;
  const tip = `<div class="card" style="margin-top:28px;width:1000px;font-size:27px;line-height:1.5"><b style="color:#ffd23f">소리가 안 들리면?</b> 화면의 <b>소리 확인</b>을 눌러 보세요.<br><span style="color:#c8d4ff;font-size:24px">갤럭시는 Chrome에서 열고 미디어 음량을 올려 주세요</span></div>`;
  add('s04', [
    ['a', 3.4, page(hd + ph('self.png') + txt(v1) + cap('측정 탭에서 촬영 방법을 확인합니다'))],
    ['b', 4.1, page(hd + ph('self-scroll.png') + txt(v1 + tip) + cap('촬영 버튼을 누르고 휴대폰을 놓은 뒤 의자에 앉습니다'))]]); }

// S5 앉은 자세
{ const hd = head(4, 'AI 자동 촬영 — 앉은 자세');
  const side = `<div class="side">${personFig(0)}<h3>앉은 자세</h3><p>체중을 싣지 않음(비체중부하)</p></div>`;
  const cs = (status, rec) => captureScreen({ left: 640, top: 105, w: 400, status, rec });
  const pts = `<div style="position:absolute;left:1150px;top:200px;width:700px;display:flex;flex-direction:column;gap:20px">${[['스티커 3개', 'P1·P2·P3를 AI가 찾습니다'], ['거리 25 cm', '25 cm ± 2.5 cm 안에서만 찍습니다'], ['움직임 없음', '세 스티커가 멈추면 자동 촬영']].map(([b, s]) => `<div class="card" style="padding:20px 26px"><div style="font-size:30px;font-weight:800;color:#7ff0c0">✓ ${b}</div><div style="font-size:23px;color:#c8d4ff;margin-top:4px">${s}</div></div>`).join('')}</div>`;
  const vb = t => `<div class="voice" style="left:1150px;top:770px;width:700px">${t}</div>`;
  add('s05', [
    ['a', 3.0, page(hd + side + cs('스티커 고정 확인 중… 그대로 계십시오') + pts + vb('스티커 세 개를 찾았습니다. 그대로 계십시오.') + cap('발 윤곽 가이드 없이, 스티커 3개만 보이면 됩니다'))],
    ['b', 3.5, page(hd + side + cs('촬영 중… 움직이지 마십시오', true) + pts + vb('앉은 자세를 촬영합니다.') + cap('세 스티커가 25 cm 거리에서 움직이지 않으면 자동으로 찍습니다'))],
    ['c', 3.5, page(hd + side + cs('촬영 중… 움직이지 마십시오', true) + pts + vb('촬영되었습니다.') + cap('여러 장을 연속으로 찍어 흔들린 사진은 버리고 평균을 냅니다'))]]); }

// S6 일어서기 — 앉음에서 서는 동작(0.4초 정지 → 1.6초 동작 → 선 자세)
{ const hd = head(5, '그대로 일어서기 — 선 자세 자동 촬영');
  const side = (t, load) => `<div class="side">${personFig(t, load)}<h3>${t < 1 ? '일어서는 중…' : '선 자세'}</h3><p>${t < 1 ? '휴대폰은 그대로 두고 일어섭니다' : '양발에 체중을 똑같이(체중부하)'}</p></div>`;
  const cs = status => captureScreen({ left: 640, top: 105, w: 400, status, chipTop: '2/2 선 자세' });
  const vb = t => `<div class="voice" style="left:1150px;top:300px;width:700px">${t}</div>`;
  const note = `<div class="card" style="position:absolute;left:1150px;top:620px;width:700px;font-size:27px;line-height:1.55"><b style="color:#ffd23f">타이머 없음</b><br>AI가 일어서는 동작과 발 모양 변화를 확인한 뒤 선 자세를 찍습니다</div>`;
  const A = (t, load) => page(hd + side(t, load) + cs('일어서서 체중부하 해주십시오') + vb('촬영을 마쳤습니다. 이제 일어서서, 체중부하 해주십시오. 양발에 체중을 똑같이 실어 주십시오.') + note + cap('휴대폰은 그대로 두고 일어섭니다'));
  const motion = []; const NF = 48; for (let i = 0; i < NF; i++) motion.push(A(i / (NF - 1), i > NF * .8 ? (i - NF * .8) / (NF * .2) : 0));
  S.push({ scene: 's06', motion: { before: 0.4, frames: motion, startHtml: A(0, 0) }, states: [
    ['a', 4.0, A(1, 1)],
    ['b', 4.0, page(hd + side(1, 1) + cs('선 자세 확인 중… 그대로 계십시오') + vb('일어서는 동작을 확인했습니다. 가만히 서 계십시오.') + note + cap('체중이 실려 발활이 내려간 것을 확인하면 자동으로 찍습니다'))]] }); }

// S7 측정 원리
{ const L = 90, T = 200, W = 1000, s = W / PW, x2 = L + ST.P2[0] * s, y2 = T + ST.P2[1] * s, dy = 70;
  const ghost = `<div style="position:absolute;left:${x2 - 25}px;top:${y2 + dy - 25}px;width:50px;height:50px;border-radius:50%;border:4px dashed #ffd23f;z-index:4"></div>
    <svg style="position:absolute;left:0;top:0;z-index:4" width="1920" height="1080"><line x1="${x2 + 46}" y1="${y2}" x2="${x2 + 46}" y2="${y2 + dy - 6}" stroke="#ffd23f" stroke-width="5"/><path d="M${x2 + 34} ${y2 + dy - 18} L${x2 + 46} ${y2 + dy} L${x2 + 58} ${y2 + dy - 18}" fill="none" stroke="#ffd23f" stroke-width="5"/></svg>
    <div class="lbl" style="left:${x2 + 74}px;top:${y2 + 4}px;border-color:#ffd23f;padding:8px 16px"><span style="margin:0;color:#ffd23f;font-size:24px;font-weight:800">내려간 높이</span></div>`;
  const hd = head(0, '무엇을 재나요?');
  const fp = footPanel({ left: L, top: T, w: W, show: ['P1', 'P2', 'P3'], labels: ['P2'] });
  const r1 = `<div class="card" style="font-size:30px;line-height:1.5"><b style="font-size:36px">앉음 → 섬</b><br>P2 스티커가 아래로 내려간 거리<br>= <b style="color:#8fb0ff">발배뼈 하강(NDT)</b></div>`;
  const r2 = `<div class="card" style="font-size:27px;line-height:1.5;margin-top:24px"><b style="color:#ffd23f">발꿈치(P3) 보정</b><br>일어설 때 휴대폰·발이 함께 움직인 만큼은 뺍니다<br><span style="color:#c8d4ff;font-size:23px">모든 사용자에게 같은 공식 · 개인별 보정 없음</span></div>`;
  const right = x => `<div style="position:absolute;left:1150px;top:220px;width:700px">${x}</div>`;
  add('s07', [
    ['a', 3.5, page(hd + fp + ghost + right(r1) + cap('치료사가 재는 방식과 같은 정의입니다'))],
    ['b', 3.5, page(hd + fp + ghost + right(r1 + r2) + cap('측정값은 mm로 계산해 정상·유연성 평발을 판정합니다'))]]); }

// S8 결과
{ const hd = head(6, '결과 확인');
  const ph = img => phone({ left: 250, top: 105, w: 400, img });
  const legend = `<div class="card" style="padding:30px 34px"><div style="font-size:28px;color:#c8d4ff;font-weight:700;margin-bottom:20px">AI 진단 결과는 두 가지</div>
    <div style="display:flex;align-items:center;gap:22px;margin-bottom:16px"><div style="font-size:40px;font-weight:900;color:#3ee39a">정상입니다</div><div style="font-size:26px;color:#3ee39a;font-weight:700">● 위험도 낮음</div></div>
    <div style="display:flex;align-items:center;gap:22px"><div style="font-size:40px;font-weight:900;color:#ff6b6b">유연성 평발입니다</div><div style="font-size:26px;color:#ff6b6b;font-weight:700">● 위험도 높음</div></div></div>`;
  const next = `<div class="card" style="margin-top:26px;padding:26px 34px;font-size:28px;line-height:1.6"><b style="color:#8fb0ff">결과 다음에는</b><br>· 결과에 맞는 <b>중재 운동 영상</b>이 바로 연결됩니다<br>· <b>기록</b> 탭에서 하강량 변화 추이를 볼 수 있습니다</div>`;
  const rd = `<div class="card" style="margin-top:26px;font-size:27px;line-height:1.55"><b style="color:#8fb0ff">회차에 저장</b> — 기본 측정·1~4회차를 골라 Y-balance와 함께 저장<br><span style="color:#c8d4ff;font-size:23px">담당 치료사(관리자)의 측정 시트·그래프에 바로 반영됩니다</span></div>`;
  const right = x => `<div style="position:absolute;left:800px;top:220px;width:1050px">${x}</div>`;
  add('s08', [
    ['a', 4.5, page(hd + ph('result-flat.png') + right(legend) + cap('하강된 mm에 맞게 AI 진단이 나옵니다'))],
    ['b', 4.5, page(hd + ph('result-normal.png') + right(legend + next) + cap('정상은 초록, 유연성 평발은 빨강으로 표시됩니다'))]]); }

// S9 운동·알람
{ const hd = head(7, '중재 운동과 운동 알람');
  const p1 = phone({ left: 300, top: 105, w: 400, img: 'exercises.png' }), p2 = phone({ left: 1200, top: 105, w: 400, img: 'reminder.png' });
  const t1 = `<div style="position:absolute;left:760px;top:300px;width:400px;font-size:30px;line-height:1.5;font-weight:700">중재 운동 영상 3개<br><span style="color:#c8d4ff;font-size:24px;font-weight:500">짧은 발 운동 · 수건 당기기 · 발가락 벌리기<br>각 10회 × 3세트</span></div>`;
  const t2 = `<div style="position:absolute;left:760px;top:600px;width:400px;font-size:30px;line-height:1.5;font-weight:700">운동 알람<br><span style="color:#c8d4ff;font-size:24px;font-weight:500">요일·시간을 정하면<br>그 시간에 앱 알림</span></div>`;
  add('s09', [
    ['a', 3.8, page(hd + p1 + p2 + t1 + cap('측정 결과에 맞춰 중재 운동 영상을 보여 줍니다'))],
    ['b', 4.2, page(hd + p1 + p2 + t1 + t2 + cap('운동할 요일·시간을 정하면 그 시간에 알려 드립니다'))]]); }

// S10 요령
{ const hd = head(0, '정확하게 찍는 요령');
  const cards = [['☀', '밝은 곳에서', '그림자 없이 발 안쪽이 잘 보이게'], ['📱', '휴대폰은 25 cm, 끝까지 그대로', '앉은 자세 → 선 자세 동안 움직이지 않기'], ['◎', '스티커는 정확한 위치에', '오른발 안쪽 · 발꿈치뼈 · 발배뼈거친면 · 엄지 뿌리'], ['👁', '스티커를 가리지 않기', '바지 끝단·손이 파란 스티커를 덮지 않게']];
  const grid = n => `<div style="position:absolute;left:160px;top:220px;width:1600px;display:grid;grid-template-columns:1fr 1fr;gap:34px">${cards.map((c, i) => `<div class="card" style="padding:34px 38px;display:flex;gap:26px;align-items:center;opacity:${i < n ? 1 : 0}"><div style="width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,#5b6cff,#8a5cff);display:flex;align-items:center;justify-content:center;font-size:40px;flex:none">${c[0]}</div><div><div style="font-size:38px;font-weight:800">${c[1]}</div><div style="font-size:25px;color:#c8d4ff;margin-top:8px">${c[2]}</div></div></div>`).join('')}</div>`;
  add('s10', [
    ['a', 2.5, page(hd + grid(2))],
    ['b', 3.5, page(hd + grid(4) + cap('이 네 가지만 지키면 측정 오차를 크게 줄일 수 있습니다'))]]); }

// S11 마무리
add('s11', [['a', 4.5, page(`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div style="font-size:120px;font-weight:900">AI Footarch</div>
  <div style="font-size:44px;font-weight:800;color:#a9bbff;margin-top:12px">오른발, 앉은 자세 → 선 자세 · 버튼 한 번이면 끝</div>
  <div style="font-size:32px;color:#fff;margin-top:34px;background:rgba(255,255,255,.08);padding:12px 30px;border-radius:14px">dit8601514-bot.github.io/foot-arch-app/fixed</div>
</div>`)]]);

module.exports = S;
if (require.main === module) (async () => {
  const only = process.argv[2];
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync('/tmp/vid/html', { recursive: true });
  const B = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const pg = await B.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const { scene, states } of S) {
    if (only && !only.split(',').includes(scene)) continue;
    const sc = S.find(x => x.scene === scene);
    if (sc.motion) { const all = [sc.motion.startHtml].concat(sc.motion.frames); for (let i = 0; i < all.length; i++) { const f = `/tmp/vid/html/${scene}_m.html`; fs.writeFileSync(f, all[i]); await pg.goto('file://' + f); await pg.evaluate(() => document.fonts.ready); await pg.screenshot({ path: `${OUT}/${scene}_m_${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 92 }); } }
    for (const [k, , html] of states) {
      const f = `/tmp/vid/html/${scene}_${k}.html`; fs.writeFileSync(f, html);
      await pg.goto('file://' + f); await pg.waitForTimeout(250); await pg.evaluate(() => document.fonts.ready);
      await pg.screenshot({ path: `${OUT}/${scene}_${k}.jpg`, type: 'jpeg', quality: 92 });
    }
    console.log('frames', scene);
  }
  if (!only) fs.writeFileSync('/tmp/vid/frames/plan.json', JSON.stringify(S.map(s => ({ scene: s.scene, motion: s.motion ? { before: s.motion.before, n: s.motion.frames.length } : null, states: s.states.map(([k, d]) => [k, d]) }))));
  await B.close();
})();
