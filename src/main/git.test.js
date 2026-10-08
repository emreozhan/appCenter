'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const gitOps = require('./git');

/** Gecici, kimligi ayarli bir git deposu; gercek projelere dokunulmaz. */
function repo(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appcenter git '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  write(dir, files);
  return { dir, run };
}

function write(dir, files) {
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
}

const noLog = () => {};

test('porcelain v2 ciktisi ozetlenir (bosluklu yol, yeniden adlandirma, ileri/geri)', () => {
  const info = gitOps.parseStatus([
    '# branch.oid abc',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaa aaa src/app.js',
    '1 A. N... 000000 100644 100644 000 bbb dosya adi.txt',
    '2 R. N... 100644 100644 100644 ccc ccc R100 yeni.js\teski.js',
    '? notlar/'
  ].join('\n'));
  assert.equal(info.branch, 'main');
  assert.equal(info.upstream, 'origin/main');
  assert.equal(info.ahead, 2);
  assert.equal(info.behind, 1);
  assert.equal(info.changed, 4);
  assert.deepEqual(info.files.map((f) => f.path), ['src/app.js', 'dosya adi.txt', 'yeni.js', 'notlar/']);
  assert.equal(info.files[0].code, ' M');
  assert.equal(info.files[3].code, '??');
});

test('depo olmayan klasor, depo koku ve ic ice kapsam', async (t) => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'appcenter nogit '));
  t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
  assert.deepEqual(await gitOps.status(plain), { isRepo: false });

  const { dir, run } = repo(t, { 'a.txt': '1', 'sub/b.txt': '1' });
  run('add', '-A');
  run('commit', '-qm', 'init');
  write(dir, { 'a.txt': '2', 'sub/b.txt': '2', 'sub/yeni.txt': 'x' });

  const rootInfo = await gitOps.status(dir);
  assert.equal(rootInfo.isRepo, true);
  assert.equal(rootInfo.nested, false);
  assert.equal(rootInfo.branch, 'main');
  assert.equal(rootInfo.changed, 3);
  assert.deepEqual(rootInfo.remotes, []);

  const subInfo = await gitOps.status(path.join(dir, 'sub'));
  assert.equal(subInfo.nested, true);
  assert.equal(subInfo.root, dir);
  assert.equal(subInfo.changed, 2, 'ust klasordeki a.txt sayilmamali');
});

test('commit yalniz proje klasorunu kapsar ve mesaji aynen saklar', async (t) => {
  const { dir, run } = repo(t, { 'kok.txt': '1', 'sub/s.txt': '1' });
  run('add', '-A');
  run('commit', '-qm', 'init');
  write(dir, { 'kok.txt': '2', 'sub/s.txt': '2', 'sub/yeni.txt': 'x', 'baska.txt': 'x' });
  run('add', 'baska.txt'); // depoda baska yerde stage'lenmis dosya

  const message = 'Duzeltme "tirnak" & | > %PATH% $(whoami)';
  const res = await gitOps.commit(path.join(dir, 'sub'), message, noLog);
  assert.equal(res.ok, true);
  assert.equal(run('log', '-1', '--format=%B').trim(), message);
  assert.deepEqual(run('show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort(),
    ['sub/s.txt', 'sub/yeni.txt']);
  assert.match(run('status', '--porcelain'), /A {2}baska\.txt/);
  assert.match(run('status', '--porcelain'), / M kok\.txt/);

  const again = await gitOps.commit(path.join(dir, 'sub'), 'bos', noLog);
  assert.equal(again.ok, false);
  assert.equal(again.error, 'Commit edilecek degisiklik yok');
});

test('push: remote yoksa hata, varsa upstream ayarlanir', async (t) => {
  const { dir, run } = repo(t, { 'a.txt': '1' });
  run('add', '-A');
  run('commit', '-qm', 'init');
  assert.deepEqual(await gitOps.push(dir, noLog), { ok: false, error: 'Remote tanimli degil' });

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'appcenter bare '));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  run('remote', 'add', 'origin', bare);

  const first = await gitOps.push(dir, noLog);
  assert.equal(first.ok, true, first.error);
  let info = await gitOps.status(dir);
  assert.equal(info.upstream, 'origin/main');
  assert.equal(info.ahead, 0);

  write(dir, { 'a.txt': '2' });
  await gitOps.commit(dir, 'ikinci', noLog);
  info = await gitOps.status(dir);
  assert.equal(info.ahead, 1);
  assert.equal((await gitOps.push(dir, noLog)).ok, true);
  assert.equal((await gitOps.status(dir)).ahead, 0);
});
