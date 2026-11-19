const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('client/index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('client/manifest.webmanifest', 'utf8'));
const worker = fs.readFileSync('client/sw.js', 'utf8');

assert.equal(manifest.name, 'Abidjan Life');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.start_url && manifest.scope);
assert.ok(manifest.icons.some(icon => icon.src === './icon.svg'));
assert.ok(html.includes('rel="manifest"'));
assert.ok(html.includes('apple-mobile-web-app-capable'));
assert.ok(html.includes("addEventListener('beforeinstallprompt'"));
assert.ok(html.includes("register('./sw.js'"));
assert.ok(html.includes('Sur l’écran d’accueil'));

const marker = '/* ABIDJAN LIFE — installation PWA (Android, ordinateur et iOS) */';
const start = html.indexOf(marker);
assert.notEqual(start, -1, 'PWA installer script exists');
const scriptStart = html.lastIndexOf('<script>', start);
const scriptEnd = html.indexOf('</script>', start);
assert.ok(scriptStart !== -1 && scriptEnd > start, 'PWA installer script is inside a script element');
assert.ok(html.indexOf('</body>') > scriptEnd, 'PWA script must be inside the document body');
new vm.Script(html.slice(scriptStart + '<script>'.length, scriptEnd), { filename: 'pwa-installer.js' });
new vm.Script(worker, { filename: 'sw.js' });
console.log('PWA checks passed: manifest, install hooks, iOS guidance, HTML placement and service-worker syntax.');
