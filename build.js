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
