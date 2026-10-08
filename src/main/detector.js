'use strict';

const fs = require('fs');
const path = require('path');

/** Icinde proje aramanin anlamsiz oldugu klasorler. */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '.vite', '.turbo', 'coverage', '__pycache__',
  'venv', '.venv', 'env', '.idea', '.vscode', 'bin', 'obj', 'vendor',
  'release', 'releases', 'src-tauri', 'data', 'secrets', 'private-backups', 'external'
]);

const STATIC_SERVER = '@static'; // processManager icindeki dahili http sunucusu

function exists(...parts) {
  return fs.existsSync(path.join(...parts));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function firstExisting(dir, candidates) {
  return candidates.find((c) => exists(dir, c)) || null;
}

function pythonBin(dir) {
  if (exists(dir, '.venv', 'Scripts', 'python.exe')) return '.venv\\Scripts\\python.exe';
  if (exists(dir, 'venv', 'Scripts', 'python.exe')) return 'venv\\Scripts\\python.exe';
  return 'python';
}

/* ------------------------------------------------------------------ */
/* Komut onceligi                                                      */
/*   1. start / build      : projenin yapilandirmasindan (package.json  */
/*                           script'i, csproj, pom, Cargo, giris dosyasi) */
/*   2. start.cmd/build.cmd : yapilandirmada komut yoksa                */
/*   3. fallbackStart/Build : salt tahmin (npx vite, dahili sunucu ...) */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Node / package.json                                                 */
/* ------------------------------------------------------------------ */

function detectNode(dir, pkg) {
  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = (name) => Object.prototype.hasOwnProperty.call(deps, name);
  const script = (...names) => names.find((n) => scripts[n]) || null;

  const npm = (name) => (name === 'start' ? 'npm start' : `npm run ${name}`);
  const result = {
    install: exists(dir, 'package.json') ? 'npm install' : null,
    needsInstall: !exists(dir, 'node_modules'),
    build: null,
    start: null,
    type: 'node',
    typeLabel: 'Node.js',
    icon: '⬢'
  };

  const buildScript = script('build', 'compile');
  if (buildScript) result.build = npm(buildScript);

  if (exists(dir, 'src-tauri')) {
    result.type = 'tauri';
    result.typeLabel = 'Tauri';
    result.icon = '\u{1F980}';
    if (scripts['tauri:dev']) result.start = npm('tauri:dev');
    else if (scripts.tauri) result.start = 'npm run tauri dev';
    if (scripts['tauri:build']) result.build = npm('tauri:build');
    else if (scripts.tauri) result.build = 'npm run tauri build';
    if (has('@tauri-apps/cli')) {
      result.fallbackStart = 'npx tauri dev';
      result.fallbackBuild = 'npx tauri build';
    }
    return result;
  }

  if (has('electron') || has('electron-vite') || has('electron-builder')) {
    result.type = 'electron';
    result.typeLabel = 'Electron';
    result.icon = '⚡';
    const s = script('dev', 'start', 'electron:dev');
    if (s) result.start = npm(s);
    result.fallbackStart = 'npx electron .';
    const dist = script('dist', 'build:win', 'package');
    if (dist) result.build = npm(dist);
    return result;
  }

  if (has('next')) {
    result.type = 'next';
    result.typeLabel = 'Next.js';
    result.icon = '▲';
    const s = script('dev', 'start');
    if (s) result.start = npm(s);
    result.fallbackStart = 'npx next dev';
    return result;
  }

  if (has('vite')) {
    result.type = 'vite';
    result.typeLabel = has('react') ? 'Vite + React' : 'Vite';
    result.icon = '\u{1F53A}';
    const s = script('dev', 'start', 'serve');
    if (s) result.start = npm(s);
    result.fallbackStart = 'npx vite';
    return result;
  }

  // Duz Node sunucu / CLI
  const s = script('start', 'dev', 'serve');
  if (s) {
    result.start = npm(s);
  } else if (pkg.main && exists(dir, pkg.main)) {
    result.start = `node ${pkg.main}`;
  } else {
    const entry = firstExisting(dir, ['index.js', 'server.js', 'app.js', 'main.js']);
    if (entry) result.start = `node ${entry}`;
  }
  if (has('express') || has('fastify') || has('koa')) {
    result.typeLabel = 'Node Server';
    result.icon = '\u{1F310}';
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Diger diller                                                        */
/* ------------------------------------------------------------------ */

function detectPython(dir) {
  const py = pythonBin(dir);
  const entry = firstExisting(dir, [
    'manage.py', 'app.py', 'main.py', 'serve.py', 'server.py', 'run.py', '__main__.py'
  ]);
  if (!entry && !exists(dir, 'requirements.txt') && !exists(dir, 'pyproject.toml')) return null;

  const start = entry === 'manage.py'
    ? `${py} manage.py runserver`
    : entry
      ? `${py} ${entry}`
      : null;

  return {
    type: 'python',
    typeLabel: 'Python',
    icon: '\u{1F40D}',
    install: exists(dir, 'requirements.txt') ? `${py} -m pip install -r requirements.txt` : null,
    needsInstall: false,
    build: null,
    start
  };
}

function detectDotnet(dir) {
  const files = listFiles(dir);
  const csproj = files.find((f) => f.endsWith('.csproj') || f.endsWith('.sln'));
  const buildCmd = firstExisting(dir, ['build.cmd', 'build.bat']);
  const hasCs = files.some((f) => f.endsWith('.cs'));
  if (!csproj && !(buildCmd && hasCs)) return null;

  const exe = files.find((f) => f.endsWith('.exe'));
  return {
    type: 'dotnet',
    typeLabel: csproj ? '.NET' : 'C#',
    icon: '\u{1F537}',
    install: null,
    needsInstall: false,
    build: buildCmd ? `.\\${buildCmd}` : 'dotnet build',
    start: exe ? `.\\${exe}` : csproj ? 'dotnet run' : null
  };
}

function detectJava(dir) {
  if (exists(dir, 'pom.xml')) {
    return {
      type: 'java',
      typeLabel: 'Java / Maven',
      icon: '☕',
      install: null,
      needsInstall: false,
      build: 'mvn -B package -DskipTests',
      start: 'mvn spring-boot:run'
    };
  }
  if (exists(dir, 'build.gradle') || exists(dir, 'build.gradle.kts')) {
    const w = exists(dir, 'gradlew.bat') ? '.\\gradlew.bat' : 'gradle';
    return {
      type: 'java',
      typeLabel: 'Java / Gradle',
      icon: '☕',
      install: null,
      needsInstall: false,
      build: `${w} build`,
      start: `${w} bootRun`
    };
  }
  return null;
}

function detectGo(dir) {
  if (!exists(dir, 'go.mod')) return null;
  return {
    type: 'go',
    typeLabel: 'Go',
    icon: '\u{1F439}',
    install: 'go mod download',
    needsInstall: false,
    build: 'go build ./...',
    start: 'go run .'
  };
}

function detectRust(dir) {
  if (!exists(dir, 'Cargo.toml')) return null;
  return {
    type: 'rust',
    typeLabel: 'Rust',
    icon: '\u{1F980}',
    install: null,
    needsInstall: false,
    build: 'cargo build --release',
    start: 'cargo run'
  };
}

/**
 * Proje kokundeki start/build script'leri. Yapilandirmadan komut
 * bulunamadiginda kullanilir; salt tahminlerden ise onceliklidir.
 */
function rootScripts(dir) {
  const command = (names) => {
    const file = names.find((name) => {
      try { return fs.statSync(path.join(dir, name)).isFile(); }
      catch { return false; }
    });
    if (!file) return null;
    return file.endsWith('.ps1')
      ? 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "./' + file + '"'
      : '.\\' + file;
  };
  return {
    build: command(['build.cmd', 'build.bat', 'build.ps1']),
    start: command(['start.cmd', 'start.bat', 'start.ps1', 'run.cmd', 'run.bat', 'run.ps1'])
  };
}

function detectStatic(dir) {
  if (!exists(dir, 'index.html')) return null;
  return {
    type: 'static',
    typeLabel: 'Statik Web',
    icon: '\u{1F310}',
    install: null,
    needsInstall: false,
    build: null,
    start: null,
    // index.html bir calistirma yapilandirmasi degil; start.cmd varsa o kazanir
    fallbackStart: STATIC_SERVER
  };
}

/* ------------------------------------------------------------------ */

function readme(dir) {
  const f = listFiles(dir).find((n) => /^readme(\.[a-z]+)?\.(md|txt)$/i.test(n));
  if (!f) return '';
  try {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const line = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('![') && !l.startsWith('<'));
    // kalin/kod isaretlerini (** ve `) temizle; kart duz metin gosterir
    return line ? line.replace(/\*\*|`/g, '').slice(0, 160) : '';
  } catch {
    return '';
  }
}

/**
 * Bir klasoru inceleyip proje tanimi uretir. Proje degilse null doner.
 */
function detect(dir) {
  let base = null;
  let description = '';

  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg) {
      base = detectNode(dir, pkg);
      description = pkg.description || '';
    }
  }

  if (!base) base = detectDotnet(dir);
  if (!base) base = detectJava(dir);
  if (!base) base = detectRust(dir);
  if (!base) base = detectGo(dir);
  if (!base) base = detectPython(dir);
  if (!base) base = detectStatic(dir);
  const scripts = rootScripts(dir);
  if (!base && (scripts.build || scripts.start)) {
    base = {
      type: 'batch', typeLabel: 'Script', icon: '\u{1F4DC}',
      install: null, needsInstall: false, build: null, start: null,
      // Bir semsiye klasore script eklemek alt projelerini gizlememeli.
      scanChildren: true
    };
  }
  if (!base) return null;

  const { fallbackStart, fallbackBuild, ...rest } = base;
  return {
    path: path.resolve(dir),
    name: path.basename(dir),
    description: description || readme(dir),
    ...rest,
    start: base.start || scripts.start || fallbackStart || null,
    build: base.build || scripts.build || fallbackBuild || null
  };
}

module.exports = { detect, IGNORED_DIRS, STATIC_SERVER };
