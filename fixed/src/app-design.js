'use strict';
/* ═════════════ 시안 기반 화면: 기록보기(달력) · 발활 재활영상 · 분석 중 ═════════════ */
const pad2 = n => String(n).padStart(2, '0');
const ymd = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

route('/records', '기록보기', async (v, p) => {
  const exams = (await DB.all('exams')).filter(e => !e.isTest).sort((a, b) => b.createdAt - a.createdAt);
  const byDay = {}; for (const e of exams) (byDay[ymd(e.createdAt)] = byDay[ymd(e.createdAt)] || []).push(e);
  const now = new Date(), base = p.q.m ? new Date(p.q.m + '-01T00:00:00') : exams.length ? new Date(exams[0].createdAt) : now;
  const Y = base.getFullYear(), M = base.getMonth();
  const sel = p.q.d || (byDay[ymd(now)] ? ymd(now) : exams.length && new Date(exams[0].createdAt).getMonth() === M ? ymd(exams[0].createdAt) : null);
  const first = new Date(Y, M, 1).getDay(), days = new Date(Y, M + 1, 0).getDate();
  const mkey = (y, m) => `${y}-${pad2(m + 1)}`, prev = M === 0 ? mkey(Y - 1, 11) : mkey(Y, M - 1), next = M === 11 ? mkey(Y + 1, 0) : mkey(Y, M + 1);
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<span></span>');
  for (let d = 1; d <= days; d++) {
    const k = `${Y}-${pad2(M + 1)}-${pad2(d)}`, cls = ['d', byDay[k] ? 'has' : '', k === sel ? 'sel' : '', k === ymd(now) ? 'today' : ''].join(' ');
    cells.push(`<button class="${cls}" data-day="${k}" aria-label="${M + 1}월 ${d}일${byDay[k] ? ` 측정 ${byDay[k].length}건` : ''}">${d}</button>`);
  }
  const list = sel ? byDay[sel] || [] : exams.filter(e => { const d = new Date(e.createdAt); return d.getFullYear() === Y && d.getMonth() === M; });
  const dowTxt = ['일', '월', '화', '수', '목', '금', '토'];
  const line = e => { const d = new Date(e.createdAt); return `<a class="list-item" href="#/result/${e.id}"><span class="mi" style="color:var(--brand)">${ICON.calendar}</span>
    <span class="grow"><b>${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} (${dowTxt[d.getDay()]})</b> <span class="badge b-info">${FOOT[e.foot]}</span><br>
    <span class="tiny">발배뼈 하강 ${e.comparison.changeMm != null ? mm(e.comparison.changeMm) : '—'}${e.comparison.archAngle ? ` · 발활 각도 ${e.comparison.archAngle.post.toFixed(0)}°` : ''}${e.comparison.floor ? ` · 바닥 높이 ${mm(e.comparison.floor.postMm)}` : ''}</span></span>${e.category ? catBadge(e.category) : statusBadge(e.comparison.status)}</a>`; };
  v.innerHTML = `
    <div class="cal-head"><button id="prevM" aria-label="이전 달">‹</button><b>${Y}년 ${M + 1}월</b><button id="nextM" aria-label="다음 달">›</button></div>
    <div class="card"><div class="cal">${dowTxt.map(t => `<span class="dow">${t}</span>`).join('')}${cells.join('')}</div></div>
    <h3>측정 내역 ${sel ? `<span class="tiny">${sel.replace(/-/g, '.')}</span>` : `<span class="tiny">${M + 1}월 전체</span>`}</h3>
    <div class="card" style="padding:4px 16px">${list.length ? list.map(line).join('') : '<p class="muted small" style="padding:10px 0">측정 기록이 없습니다.</p>'}</div>
    <div class="grid2"><a class="btn" href="#/manage">${ICON.chart} 변화 추이</a><a class="btn" href="#/compare">중재 전·후 비교</a></div>
    <a class="btn ghost block" href="#/history">전체 기록 목록</a>`;
  $('#prevM', v).onclick = () => go('#/records?m=' + prev);
  $('#nextM', v).onclick = () => go('#/records?m=' + next);
  $$('[data-day]', v).forEach(b => b.onclick = () => go(`#/records?m=${mkey(Y, M)}&d=${b.dataset.day}`));
});

// 발활 재활영상: 시안 ⑧의 카드 목록. 등록된 영상만 재생 가능, 미등록은 그대로 표시한다.
async function videoInfo(x) {
  let src = null;
  if (x.videoBlobId) { const b = await DB.get('blobs', x.videoBlobId).catch(() => null); if (b) src = URL.createObjectURL(b.blob); }
  if (!src && x.videoUrl) src = x.videoUrl;
  return src;
}
function fmtDur(sec) { if (!isFinite(sec) || sec <= 0) return ''; const m = Math.floor(sec / 60), s2 = Math.round(sec % 60); return `${m}:${pad2(s2)}`; }
route('/exercises', '발활 재활영상', async (v) => {
  if (typeof Account !== 'undefined') await Promise.race([Account.syncContent(true), new Promise(r => setTimeout(r, 2500))]);
  const all = await DB.all('exercises'), hasSrv = all.some(x => x.server);
  // 관리자가 서버에 운동을 올렸으면 그것을 보여 준다(기기에만 있는 초안은 연구자가 영상을 넣은 것만 함께 표시)
  const exs = (hasSrv ? all.filter(x => x.server || x.videoBlobId || (x.videoUrl && !x.draft)) : all).sort((a, b) => (a.server ? a.order : 1e3) - (b.server ? b.order : 1e3));
  const exams = (await DB.all('exams')).filter(e => !e.isTest && e.category).sort((a, b) => b.createdAt - a.createdAt);
  const cats = [...new Set(exams.slice(0, 4).map(e => e.category.key))];
  const rec = exs.filter(x => cats.some(k => (S.settings.mapping[k] || []).includes(x.id)));
  const rest = exs.filter(x => !rec.includes(x));
  const card = x => `<a class="vcard" href="#/exercise/${x.id}"><span class="vthumb" data-vid="${x.id}"><span class="play">${ICON.play}</span><span class="dur hide"></span></span>
    <span class="vt"><b>${esc(x.name)}</b><span>${esc(x.purpose || '')}</span><br>${x.videoBlobId || x.videoUrl ? '' : '<span class="badge b-warn" style="margin-top:4px">영상 등록 필요</span>'}${hasPrescription(x) ? '' : ' <span class="badge">처방 미입력</span>'}</span><span style="color:var(--ink-3)">${ICON.chev}</span></a>`;
  v.innerHTML = `
    <h2>${rec.length ? '추천 운동 영상' : '운동 영상'}</h2>
    <p class="muted small">${rec.length ? '최근 측정 결과에 연결된 운동입니다. 발활 강화에 도움이 되는 운동을 따라해 보세요.' : '발활 강화에 도움이 되는 운동을 따라해 보세요.'}</p>
    ${rec.map(card).join('')}
    ${rec.length && rest.length ? '<h3>전체 운동</h3>' : ''}${rest.map(card).join('')}
    ${!exs.length ? '<div class="placeholder">등록된 운동이 없습니다.</div>' : ''}
    <a class="btn block" href="#/logs">${ICON.check} 운동 수행 기록</a>`;
  // 썸네일: 영상 첫 장면과 길이(메타데이터)를 비동기로 채운다
  for (const x of exs) {
    const src = await videoInfo(x); if (!src) continue;
    const box = $(`[data-vid="${x.id}"]`, v); if (!box) continue;
    const yt = C.youtubeId(src); if (yt) { const im = document.createElement('img'); im.src = `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`; im.alt = ''; im.loading = 'lazy'; im.style.cssText = 'width:100%;height:100%;object-fit:cover'; box.prepend(im); continue; }
    const vid = document.createElement('video'); vid.muted = true; vid.playsInline = true; vid.preload = 'metadata'; vid.src = src + (x.videoBlobId ? '' : '#t=0.5');
    vid.addEventListener('loadedmetadata', () => { const d = $('.dur', box); d.textContent = fmtDur(vid.duration); d.classList.toggle('hide', !d.textContent); });
    box.prepend(vid);
  }
});

// 분석 중 화면(시안 ⑤): 원형 진행 표시
function analyzingHtml(title) {
  const C2 = 2 * Math.PI * 88;
  return `${stepper(6)}<div class="ring"><svg class="r" viewBox="0 0 200 200"><circle cx="100" cy="100" r="88" fill="none" stroke="#dbe8ff" stroke-width="12"/><circle id="ringArc" cx="100" cy="100" r="88" fill="none" stroke="url(#rg)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C2}" stroke-dashoffset="${C2}"/><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#7fb2ff"/><stop offset="1" stop-color="#1a5fe0"/></linearGradient></defs></svg><div class="in">${footprintsSvg('a')}</div></div>
    <p style="text-align:center;font-weight:800;font-size:18px;margin:6px 0">${title || 'AI가 발 상태를<br>분석하고 있어요...'}</p>
    <div class="card"><ol class="steps small" id="prog"></ol></div>`;
}
function setRing(root, frac) { const a = $('#ringArc', root); if (!a) return; const C2 = 2 * Math.PI * 88; a.style.transition = 'stroke-dashoffset .35s'; a.setAttribute('stroke-dashoffset', String(C2 * (1 - Math.max(0, Math.min(1, frac))))); }
