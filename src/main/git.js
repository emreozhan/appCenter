'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const STATUS_TIMEOUT = 15000;
const PUSH_TIMEOUT = 120000;
const MAX_FILES = 200;

/**
 * Klasorden yukari dogru .git arar (alt projeler ust klasorun deposunu paylasabilir).
 * @returns {string|null} depo koku
 */
function findRepoRoot(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * git'i shell olmadan calistirir; arguman dizisi sayesinde mesajlar kacis gerektirmez.
 * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
 */
function git(cwd, args, timeout = STATUS_TIMEOUT) {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      // kimlik bilgisi sorulursa terminalde asili kalma
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    }, (err, stdout, stderr) => {
      const missing = err && err.code === 'ENOENT';
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: missing ? 'git bulunamadi (PATH icinde degil)' : String(stderr || (err && err.message) || '')
      });
    });
  });
}

/** Hata ciktisindan en anlamli satir: fatal/error satiri, yoksa son dolu satir. */
function summary(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const important = lines.filter((l) => /^(fatal|error):/i.test(l));
  return (important.length ? important[important.length - 1] : lines[lines.length - 1]) || '';
}

/** `git status --porcelain=v2 --branch` ciktisini ozetler. */
function parseStatus(stdout) {
  const info = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0, files: [] };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      info.branch = line.slice(14);
    } else if (line.startsWith('# branch.upstream ')) {
      info.upstream = line.slice(18);
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        info.ahead = Number(m[1]);
        info.behind = Number(m[2]);
      }
    } else if (line.startsWith('? ')) {
      info.changed += 1;
      if (info.files.length < MAX_FILES) info.files.push({ code: '??', path: line.slice(2) });
    } else if (/^[12u] /.test(line)) {
      // "1 XY sub mH mI mW hH hI yol", "2 ... Xskor yol\teskiYol", "u ... yol"
      const fieldCount = { 1: 8, 2: 9, u: 10 }[line[0]];
      const parts = line.split(' ');
      const filePath = parts.slice(fieldCount).join(' ').split('\t')[0];
      info.changed += 1;
      if (info.files.length < MAX_FILES) {
        info.files.push({ code: parts[1].replace(/\./g, ' '), path: filePath });
      }
    }
  }
  return info;
}

/**
 * Proje klasorunun git durumu. Kapsam proje klasorudur (`-- .`);
 * ic ice projelerde ust deponun yalnizca bu klasore ait degisiklikleri sayilir.
 */
async function status(dir) {
  const root = findRepoRoot(dir);
  if (!root) return { isRepo: false };

  const [st, remotes] = await Promise.all([
    git(dir, ['status', '--porcelain=v2', '--branch', '--', '.']),
    git(dir, ['remote'])
  ]);
  const base = {
    isRepo: true,
    root,
    nested: root.toLowerCase() !== path.resolve(dir).toLowerCase(),
    remotes: remotes.stdout.split(/\r?\n/).filter(Boolean)
  };
  if (!st.ok) return { ...base, error: summary(st.stderr) || 'git status basarisiz' };
  return { ...base, ...parseStatus(st.stdout) };
}

/**
 * Proje klasorundeki tum degisiklikleri ekleyip commit eder.
 * Depoda baska yerde stage'lenmis dosyalar bu commit'e girmez.
 * @param {(kind: string, text: string) => void} log
 */
async function commit(dir, message, log) {
  log('sys', '> git add -A -- .');
  const add = await git(dir, ['add', '-A', '--', '.']);
  if (add.stderr) log(add.ok ? 'out' : 'err', add.stderr);
  if (!add.ok) return { ok: false, error: summary(add.stderr) };

  log('sys', '> git commit -m "..." -- .');
  const res = await git(dir, ['commit', '-m', message, '--', '.']);
  if (res.stdout) log('out', res.stdout);
  if (res.stderr) log(res.ok ? 'out' : 'err', res.stderr);
  if (!res.ok) {
    const reason = /nothing (added )?to commit|no changes added/i.test(res.stdout + res.stderr)
      ? 'Commit edilecek degisiklik yok'
      : summary(res.stderr) || summary(res.stdout) || 'git commit basarisiz';
    return { ok: false, error: reason };
  }
  return { ok: true };
}

/**
 * Upstream varsa `git push`, yoksa origin'e (ya da ilk remote'a) `push -u`.
 * @param {(kind: string, text: string) => void} log
 */
async function push(dir, log) {
  const st = await status(dir);
  if (!st.isRepo) return { ok: false, error: 'Git deposu degil' };
  if (!st.remotes.length) return { ok: false, error: 'Remote tanimli degil' };
  if (!st.branch || st.branch === '(detached)') return { ok: false, error: 'Dal secili degil (detached HEAD)' };

  const remote = st.remotes.includes('origin') ? 'origin' : st.remotes[0];
  const args = st.upstream ? ['push'] : ['push', '-u', remote, 'HEAD'];
  log('sys', `> git ${args.join(' ')}`);
  const res = await git(dir, args, PUSH_TIMEOUT);
  if (res.stdout) log('out', res.stdout);
  if (res.stderr) log(res.ok ? 'out' : 'err', res.stderr);
  return res.ok ? { ok: true } : { ok: false, error: summary(res.stderr) || 'git push basarisiz' };
}

module.exports = { findRepoRoot, status, commit, push, parseStatus };
