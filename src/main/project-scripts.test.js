'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detect, STATIC_SERVER } = require('./detector');

/** Sentetik projeler; gercek uygulama veya kullanici verisi calistirilmaz. */
function fixture(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appcenter scripts '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  return dir;
}

test('yapilandirmadaki komut start.cmd/build.cmd onune gecer', (t) => {
  const cases = [
    [{ vite: '1' }, { dev: 'vite', build: 'vite build' }, 'npm run dev', 'npm run build'],
    [{ electron: '1' }, { start: 'electron .', dist: 'electron-builder' }, 'npm start', 'npm run dist'],
    [{ next: '1' }, { dev: 'next dev', build: 'next build' }, 'npm run dev', 'npm run build'],
    [{}, { start: 'node index.js', build: 'tsc' }, 'npm start', 'npm run build']
  ];
  for (const [deps, scripts, start, build] of cases) {
    const dir = fixture(t, {
      'package.json': JSON.stringify({ dependencies: deps, scripts }),
      'build.cmd': '@echo off', 'start.cmd': '@echo off'
    });
    const project = detect(dir);
    assert.equal(project.start, start);
    assert.equal(project.build, build);
  }
});

test('yapilandirmada komut yoksa start.cmd/build.cmd kullanilir ve tahminin onune gecer', (t) => {
  for (const deps of [{ vite: '1' }, { electron: '1' }, { next: '1' }, {}]) {
    const dir = fixture(t, {
      'package.json': JSON.stringify({ dependencies: deps }),
      'build.cmd': '@echo off', 'start.cmd': '@echo off'
    });
    const project = detect(dir);
    assert.equal(project.start, '.\\start.cmd');
    assert.equal(project.build, '.\\build.cmd');
    assert.notEqual(project.type, 'batch');
    assert.equal(project.scanChildren, undefined);
    assert.equal('fallbackStart' in project, false);
  }
});

test('ne yapilandirma ne script varsa tahmin kullanilir', (t) => {
  const vite = fixture(t, { 'package.json': JSON.stringify({ devDependencies: { vite: '1' } }) });
  assert.equal(detect(vite).start, 'npx vite');
  const electron = fixture(t, { 'package.json': JSON.stringify({ devDependencies: { electron: '1' } }) });
  assert.equal(detect(electron).start, 'npx electron .');
  assert.equal(detect(electron).build, null);
});

test('cmd onceligi ve PowerShell komut bicimi', (t) => {
  const dir = fixture(t, { 'build.ps1': '', 'start.ps1': '', 'run.cmd': '' });
  assert.match(detect(dir).build, /powershell\.exe .* -File "\.\/build.ps1"$/);
  assert.match(detect(dir).start, /start\.ps1"$/);
  fs.writeFileSync(path.join(dir, 'start.bat'), '');
  assert.equal(detect(dir).start, '.\\start.bat');
  fs.writeFileSync(path.join(dir, 'start.cmd'), '');
  assert.equal(detect(dir).start, '.\\start.cmd');
});

test('yalniz build scripti de algilanir; script adli klasor algilanmaz', (t) => {
  const dir = fixture(t, { 'build.cmd': '' });
  assert.equal(detect(dir).start, null);
  assert.equal(detect(dir).scanChildren, true);
  const other = fixture(t);
  fs.mkdirSync(path.join(other, 'start.cmd'));
  assert.equal(detect(other), null);
});

test('standart scripti olmayan projelerin eski komutlari korunur', (t) => {
  const dir = fixture(t, { 'package.json': JSON.stringify({ scripts: { start: 'node index.js', build: 'compile' } }) });
  assert.equal(detect(dir).start, 'npm start');
  assert.equal(detect(dir).build, 'npm run build');
  const staticDir = fixture(t, { 'index.html': '<h1>Fixture</h1>' });
  assert.equal(detect(staticDir).start, STATIC_SERVER);
  fs.writeFileSync(path.join(staticDir, 'start.cmd'), '');
  assert.equal(detect(staticDir).type, 'static');
  assert.equal(detect(staticDir).start, '.\\start.cmd');
});

test('Python ve Tauri: giris/script yoksa kok scriptine duser', (t) => {
  const pythonDir = fixture(t, { 'pyproject.toml': '', 'start.cmd': '', 'build.cmd': '' });
  assert.equal(detect(pythonDir).type, 'python');
  assert.equal(detect(pythonDir).start, '.\\start.cmd');
  const pythonEntry = fixture(t, { 'app.py': '', 'start.cmd': '' });
  assert.equal(detect(pythonEntry).start, 'python app.py');

  const tauriDir = fixture(t, { 'package.json': '{}', 'src-tauri/Cargo.toml': '', 'start.cmd': '', 'build.cmd': '' });
  assert.equal(detect(tauriDir).type, 'tauri');
  assert.equal(detect(tauriDir).start, '.\\start.cmd');
  assert.equal(detect(tauriDir).build, '.\\build.cmd');
  const tauriScript = fixture(t, {
    'package.json': JSON.stringify({ scripts: { tauri: 'tauri' } }),
    'src-tauri/Cargo.toml': '', 'start.cmd': '', 'build.cmd': ''
  });
  assert.equal(detect(tauriScript).start, 'npm run tauri dev');
  assert.equal(detect(tauriScript).build, 'npm run tauri build');
});

test('sem­siye alt projeleri gorunur; derinlik, gruplar ve ozel komutlar korunur', (t) => {
  const root = fixture(t, {
    'umbrella/build.cmd': '', 'umbrella/start.cmd': '',
    'umbrella/child/package.json': '{"scripts":{"start":"node index.js"}}',
    'umbrella/category/deep/index.html': '',
    'umbrella/node_modules/ignored/package.json': '{}',
    'node/package.json': '{}', 'node/hidden-child/package.json': '{}'
  });
  const key = (value) => path.resolve(value).toLowerCase();
  const child = path.join(root, 'umbrella', 'child');
  const cfg = { roots: [root], maxDepth: 3, hidden: [], overrides: { [key(child)]: { start: 'custom-start' } } };
  const configPath = require.resolve('./config');
  const oldConfig = require.cache[configPath];
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { get: () => cfg, normalizeKey: key } };
  t.after(() => { if (oldConfig) require.cache[configPath] = oldConfig; else delete require.cache[configPath]; delete require.cache[require.resolve('./scanner')]; });
  delete require.cache[require.resolve('./scanner')];
  const { scan } = require('./scanner');
  const found = scan();
  assert.deepEqual(found.map((p) => p.name).sort(), ['child', 'deep', 'node', 'umbrella']);
  assert.equal(found.find((p) => p.name === 'child').start, 'custom-start');
  assert.equal(found.find((p) => p.name === 'child').groupName, 'umbrella');

  // Semsiye klasor ayri kart degil, kendi grubunun ilk ogesi olur (cift gorunmez).
  const umbrella = found.find((p) => p.name === 'umbrella');
  assert.equal(umbrella.groupId, umbrella.id);
  assert.equal(umbrella.isGroupRoot, true);
  assert.equal(umbrella.start, '.\\start.cmd');
  const singles = found.filter((p) => !p.groupId).map((p) => p.id);
  const groups = new Set(found.map((p) => p.groupId).filter(Boolean));
  assert.deepEqual(singles.filter((id) => groups.has(id)), []);
  cfg.maxDepth = 1;
  assert.deepEqual(scan().map((p) => p.name).sort(), ['node', 'umbrella']);
});
