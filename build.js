// src/ → dist/ (index.html 단일 파일 + PWA 파일)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const r = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const core = r('core.js'), app = r('app-base.js') + '\n' + r('app-live.js') + '\n' + r('app-account.js') + '\n' + r('app-user.js') + '\n' + r('app-self.js') + '\n' + r('app-design.js') + '\n' + r('app-research.js');
let html = r('index.html')
  .replace('<!--CORE-->', () => '<script id="core-script">\n' + safe(core) + '\n</script>')
  .replace('<!--APP-->', () => '<script>\n' + safe(app) + '\n</script>');
const build = crypto.createHash('sha1').update(html).update(fs.readFileSync(path.join(__dirname, 'public', 'config.js'))).update(fs.readFileSync(path.join(__dirname, 'public', 'sw.js'))).digest('hex').slice(0, 10); // 설정·캐시 규칙이 바뀌어도 새 버전으로 인식
html = html.replace('__BUILD__', build);
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8').replace('__BUILD__', build));
fs.copyFileSync(path.join(__dirname, 'public', 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
fs.copyFileSync(path.join(__dirname, 'public', 'config.js'), path.join(out, 'config.js'));
for (const f of fs.readdirSync(path.join(__dirname, 'public', 'icons'))) fs.copyFileSync(path.join(__dirname, 'public', 'icons', f), path.join(out, 'icons', f));
// 관리자 앱(/admin): 사용자 앱과 분리된 별도 페이지(핵심 계산 코드만 공유)
const admin = r('admin.html').replace('<!--CORE-->', () => '<script>\n' + safe(core) + '\n</script>').replace('<!--ADMIN-->', () => '<script>\n' + safe(r('admin.js')) + '\n</script>');
fs.mkdirSync(path.join(out, 'admin'), { recursive: true });
fs.writeFileSync(path.join(out, 'admin', 'index.html'), admin);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// 새 버전 확인용(앱이 열려 있는 동안에도 몇 분마다 확인 → 홈 화면에 둔 앱이 옛 버전에 머무르지 않게)
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ build, version: (r('app-base.js').match(/APP_VERSION = '([^']+)'/) || [])[1] || '', alg: (core.match(/ALGORITHM_VERSION = '([^']+)'/) || [])[1] || '' }));
console.log('built', build, html.length, 'bytes');

// ── 고정촬영판(별도 앱): fixed/src + fixed/public → dist/fixed/ (기존 앱과 코드·서버·기록 분리, 관리자 앱 없음) ──
{
  const FD = path.join(__dirname, 'fixed'), rf = f => fs.readFileSync(path.join(FD, 'src', f), 'utf8'), pf = f => path.join(FD, 'public', f);
  const fcore = rf('core.js'), fapp = ['app-base.js', 'app-live.js', 'app-account.js', 'app-user.js', 'app-self.js', 'app-design.js', 'app-research.js'].map(rf).join('\n');
  // 기본 보정 학습: 표본 파일 → learnSeedCorrection → 앱(BUILTIN_MODEL)·관리자(SEED_SAMPLES)에 넣기
  const seed = JSON.parse(fs.readFileSync(path.join(FD, 'calib', 'samples.json'), 'utf8')).samples;
  const L = require(path.join(FD, 'src', 'core.js')).learnSeedCorrection(seed);
  const sh = crypto.createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 6);
  const seedModel = L.ok && L.chosen !== 'identity' ? { id: 'seed-' + sh, version: `학습(${L.model.label} · 표본 ${L.model.n}개)`, builtin: true, data: L.model } : null;
  const fapp2 = fapp.replace('/*__SEED_MODEL__*/null', () => JSON.stringify(seedModel));
  if (fapp2 === fapp) throw new Error('fixed: __SEED_MODEL__ 자리를 찾지 못함');
  console.log('fixed seed model:', L.ok ? `${L.chosen} ${L.model.label} · 표본 ${L.model.n}/${L.model.nAll} · ${L.model.participants}명 · ${L.validation} MAE ${L.model.baseMae.toFixed(2)} → ${L.model.cvMae.toFixed(2)} mm` : L.reason);
  let fh = rf('index.html').replace('<!--CORE-->', () => '<script id="core-script">\n' + safe(fcore) + '\n</script>').replace('<!--APP-->', () => '<script>\n' + safe(fapp2) + '\n</script>');
  const fb = crypto.createHash('sha1').update(fh).update(fs.readFileSync(pf('config.js'))).update(fs.readFileSync(pf('sw.js'))).digest('hex').slice(0, 10);
  fh = fh.replace('__BUILD__', fb);
  const fo = path.join(out, 'fixed'); fs.mkdirSync(path.join(fo, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(fo, 'index.html'), fh);
  fs.writeFileSync(path.join(fo, 'sw.js'), fs.readFileSync(pf('sw.js'), 'utf8').replace('__BUILD__', fb));
  for (const f of ['manifest.webmanifest', 'config.js']) fs.copyFileSync(pf(f), path.join(fo, f));
  for (const f of fs.readdirSync(pf('icons'))) fs.copyFileSync(path.join(pf('icons'), f), path.join(fo, 'icons', f));
  fs.writeFileSync(path.join(fo, 'calib-model.json'), JSON.stringify({ trainedFrom: 'fixed/calib/samples.json', samples: seed.length, result: L }, null, 1));
  fs.writeFileSync(path.join(fo, 'version.json'), JSON.stringify({ build: fb, version: (rf('app-base.js').match(/APP_VERSION = '([^']+)'/) || [])[1] || '', alg: (fcore.match(/ALGORITHM_VERSION = '([^']+)'/) || [])[1] || '' }));
  const fadmin = rf('admin.html').replace('<!--CORE-->', () => '<script>\n' + safe(fcore) + '\n</script>').replace('<!--ADMIN-->', () => '<script>\n' + safe(rf('admin.js').replace('/*__SEED_SAMPLES__*/[]', () => JSON.stringify(seed.map(x => ({ id: x.id, participant: x.participant, ai: x.ai, ref: x.ref, floorDrop: x.floorDrop }))))) + '\n</script>');
  fs.mkdirSync(path.join(fo, 'admin'), { recursive: true }); fs.writeFileSync(path.join(fo, 'admin', 'index.html'), fadmin);
  console.log('built fixed', fb, fh.length, 'bytes');
}
