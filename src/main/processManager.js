'use strict';

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createStaticServer } = require('./staticServer');
const { STATIC_SERVER } = require('./detector');

const MAX_LOG_LINES = 1500;
const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s"'`<>)\]]*)/i;
const ANSI_RE = /\[[0-9;?]*[A-Za-z]/g;

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    /** id -> { status, task, pid, url, exitCode, startedAt, command } */
    this.states = new Map();
    /** id -> { run, task } calisan islemler */
    this.procs = new Map();
    /** id -> log satirlari */
    this.logs = new Map();
  }

  /* ----------------------------- durum ----------------------------- */

  state(id) {
    if (!this.states.has(id)) {
      this.states.set(id, {
        id,
        status: 'stopped',
        task: null,
        taskLabel: '',
        pid: null,
        url: null,
        exitCode: null,
        startedAt: null,
        command: null
      });
    }
    return this.states.get(id);
  }

  allStates() {
    return Object.fromEntries(this.states);
  }

  patch(id, changes) {
    const s = { ...this.state(id), ...changes };
    this.states.set(id, s);
    this.emit('state', s);
    return s;
  }

  /* ------------------------------ log ------------------------------ */

  log(id, kind, text) {
    const lines = String(text).replace(ANSI_RE, '').split(/\r?\n/).filter((l) => l.length);
    if (!lines.length) return;
    const buf = this.logs.get(id) || [];
    for (const line of lines) {
      const entry = { t: Date.now(), kind, line };
      buf.push(entry);
      this.emit('log', { id, ...entry });
    }
    if (buf.length > MAX_LOG_LINES) buf.splice(0, buf.length - MAX_LOG_LINES);
    this.logs.set(id, buf);
  }

  getLogs(id) {
    return this.logs.get(id) || [];
  }

  clearLogs(id) {
    this.logs.set(id, []);
  }

  /* ---------------------------- yardimci --------------------------- */

  parseEnv(text) {
    const env = {};
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return env;
  }

  spawnShell(command, cwd, envText) {
    return spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', ...this.parseEnv(envText) }
    });
  }

  /**
   * Sureci alt surecleriyle birlikte oldurur.
   * Windows'ta taskkill tam yol ile cagrilir (PATH'e guvenilmez);
   * basarisiz olursa en azindan kabuk sureci kapatilir.
   */
  killTree(child, id) {
    return new Promise((resolve) => {
      const pid = child?.pid;
      if (!pid) return resolve();

      const fallback = () => {
        try { child.kill('SIGKILL'); } catch { /* zaten olmus */ }
      };

      if (process.platform === 'win32') {
        const taskkill = path.join(
          process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'
        );
        execFile(taskkill, ['/PID', String(pid), '/T', '/F'], (err) => {
          if (err && !/not found|bulunamadi/i.test(err.message)) {
            if (id) this.log(id, 'err', `taskkill basarisiz: ${err.message.split('\n')[0]}`);
            fallback();
          }
          resolve();
        });
      } else {
        try { process.kill(pid, 'SIGTERM'); } catch { /* zaten olmus */ }
        setTimeout(() => { fallback(); resolve(); }, 2000);
      }
    });
  }

  /* ---------------------------- calistir --------------------------- */

  async start(project) {
    const id = project.id;
    if (this.procs.get(id)?.run) {
      this.log(id, 'sys', 'Zaten calisiyor.');
      return this.state(id);
    }
    if (!project.start) {
      this.log(id, 'err', 'Bu proje icin calistirma komutu tanimli degil. Ayarlar > Calistirma komutu.');
      return this.patch(id, { status: 'error' });
    }
    if (!fs.existsSync(project.path)) {
      this.log(id, 'err', `Klasor bulunamadi: ${project.path}`);
      return this.patch(id, { status: 'error' });
    }

    // Statik projeler dahili sunucuyla acilir
    if (project.start === STATIC_SERVER) {
      const srv = createStaticServer(project.path, { onLog: (m) => this.log(id, 'out', m) });
      try {
        const url = await srv.listen();
        this.procs.set(id, { ...(this.procs.get(id) || {}), run: { static: srv } });
        this.log(id, 'sys', `Dahili statik sunucu basladi: ${url}`);
        return this.patch(id, {
          status: 'running', pid: null, url, startedAt: Date.now(),
          command: 'dahili statik sunucu', exitCode: null
        });
      } catch (err) {
        this.log(id, 'err', `Sunucu baslatilamadi: ${err.message}`);
        return this.patch(id, { status: 'error' });
      }
    }

    this.patch(id, {
      status: 'starting', url: null, exitCode: null,
      startedAt: Date.now(), command: project.start
    });
    this.log(id, 'sys', `> ${project.start}   (${project.path})`);

    const child = this.spawnShell(project.start, project.path, project.env);
    this.procs.set(id, { ...(this.procs.get(id) || {}), run: { child } });
    this.patch(id, { pid: child.pid });

    const onData = (kind) => (chunk) => {
      const text = chunk.toString();
      this.log(id, kind, text);
      const s = this.state(id);
      if (!s.url) {
        const m = text.replace(ANSI_RE, '').match(URL_RE);
        if (m) {
          const url = m[1].replace('0.0.0.0', 'localhost').replace('[::1]', 'localhost').replace(/[.,]$/, '');
          this.patch(id, { url, status: 'running' });
        }
      }
    };
    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));

    const settle = setTimeout(() => {
      if (this.state(id).status === 'starting') this.patch(id, { status: 'running' });
    }, 1500);

    child.on('error', (err) => {
      clearTimeout(settle);
      this.log(id, 'err', `Baslatilamadi: ${err.message}`);
      this.procs.set(id, { ...(this.procs.get(id) || {}), run: null });
      this.patch(id, { status: 'error', pid: null });
    });

    child.on('close', (code, signal) => {
      clearTimeout(settle);
      const stopped = this.procs.get(id)?.stopping;
      this.procs.set(id, { ...(this.procs.get(id) || {}), run: null, stopping: false });
      this.log(id, code ? 'err' : 'sys', `Islem sonlandi (kod: ${code ?? signal}).`);
      this.patch(id, {
        status: !stopped && code ? 'error' : 'stopped',
        pid: null, url: null, exitCode: code
      });
    });

    return this.state(id);
  }

  async stop(id) {
    const entry = this.procs.get(id);
    if (!entry?.run) return this.patch(id, { status: 'stopped', pid: null, url: null });

    this.procs.set(id, { ...entry, stopping: true });

    if (entry.run.static) {
      await entry.run.static.close();
      this.procs.set(id, { ...this.procs.get(id), run: null, stopping: false });
      this.log(id, 'sys', 'Statik sunucu durduruldu.');
      return this.patch(id, { status: 'stopped', pid: null, url: null });
    }

    this.log(id, 'sys', 'Durduruluyor...');
    await this.killTree(entry.run.child, id);
    return this.state(id);
  }

  async stopAll() {
    await Promise.all([...this.procs.keys()].map((id) => this.stop(id)));
  }

  /* ------------------------ build / install ------------------------ */

  runTask(project, kind) {
    const id = project.id;
    const command = kind === 'build' ? project.build : project.install;
    const label = kind === 'build' ? 'Build' : 'Kurulum';

    if (!command) {
      this.log(id, 'err', `${label} komutu tanimli degil.`);
      return Promise.resolve(this.state(id));
    }
    if (this.procs.get(id)?.task) {
      this.log(id, 'sys', `${label} zaten calisiyor.`);
      return Promise.resolve(this.state(id));
    }

    this.patch(id, { task: kind, taskLabel: `${label} calisiyor` });
    this.log(id, 'sys', `> ${command}   (${label})`);

    const child = this.spawnShell(command, project.path, project.env);
    this.procs.set(id, { ...(this.procs.get(id) || {}), task: child });

    child.stdout.on('data', (c) => this.log(id, 'out', c.toString()));
    child.stderr.on('data', (c) => this.log(id, 'err', c.toString()));

    return new Promise((resolve) => {
      child.on('error', (err) => {
        this.log(id, 'err', `${label} baslatilamadi: ${err.message}`);
        this.procs.set(id, { ...(this.procs.get(id) || {}), task: null });
        resolve(this.patch(id, { task: null, taskLabel: `${label} hatasi` }));
      });
      child.on('close', (code) => {
        this.procs.set(id, { ...(this.procs.get(id) || {}), task: null });
        this.log(id, code ? 'err' : 'sys', `${label} bitti (kod: ${code}).`);
        resolve(this.patch(id, {
          task: null,
          taskLabel: code ? `${label} basarisiz (${code})` : `${label} tamam`
        }));
      });
    });
  }
}

module.exports = new ProcessManager();
