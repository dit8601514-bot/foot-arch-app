// src/ → dist/ (index.html 단일 파일 + PWA 파일)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const r = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const safe = s => s.replace(/<\/script/gi, '<\\/script');
const core = r('core.js'), app = r('app-base.js') + '\n' + r('app-live.js') + '\n' + r('app-user.js') + '\n' + r('app-self.js') + '\n' + r('app-research.js');
let html = r('index.html')
  .replace('<!--CORE-->', () => '<script id="core-script">\n' + safe(core) + '\n</script>')
  .replace('<!--APP-->', () => '<script>\n' + safe(app) + '\n</script>');
const build = crypto.createHash('sha1').update(html).digest('hex').slice(0, 10);
html = html.replace('__BUILD__', build);
const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8').replace('__BUILD__', build));
fs.copyFileSync(path.join(__dirname, 'public', 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
for (const f of fs.readdirSync(path.join(__dirname, 'public', 'icons'))) fs.copyFileSync(path.join(__dirname, 'public', 'icons', f), path.join(out, 'icons', f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('built', build, html.length, 'bytes');
