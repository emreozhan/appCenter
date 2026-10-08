'use strict';

const { ipcMain, dialog, shell, BrowserWindow } = require('electron');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const { CH } = require('../../shared/ipc-channels');
const config = require('../config');
const { scan } = require('../scanner');
const pm = require('../processManager');
const startup = require('../startup');
const gitOps = require('../git');

const GIT_CONCURRENCY = 6;
const MAX_COMMIT_MESSAGE = 5000;

/** fn'i ayni anda en fazla `limit` oge icin calistirir; sirayi korur. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Git islemini projenin "mesgul" durumu ve log paneliyle sarar.
 * Ayni projede build/kurulum surerken baslatilmaz.
 */
async function runGitTask(project, label, fn) {
  const id = project.id;
  if (pm.state(id).task) throw new Error('Bu projede baska bir islem suruyor');
  pm.patch(id, { task: 'git', taskLabel: `${label} calisiyor` });
  const log = (kind, text) => pm.log(id, kind, text);
  try {
    const res = await fn(log);
    if (!res.ok) log('err', res.error);
    pm.patch(id, { task: null, taskLabel: res.ok ? `${label} tamam` : `${label} basarisiz` });
    return { ...res, status: await gitOps.status(project.path) };
  } catch (err) {
    pm.patch(id, { task: null, taskLabel: `${label} hatasi` });
    throw err;
  }
}

/** Son taramanin sonucu; id -> proje. Renderer'dan gelen id'ler buradan dogrulanir. */
const projects = new Map();

function list() {
  return [...projects.values()];
}

function refresh(win) {
  const found = scan((dir) => {
    if (win && !win.isDestroyed()) win.webContents.send(CH.EVT_SCAN_PROGRESS, dir);
  });
  projects.clear();
  for (const p of found) projects.set(p.id, p);
  return list();
}

function requireProject(id) {
  if (typeof id !== 'string') throw new Error('Gecersiz proje kimligi');
  const p = projects.get(id);
  if (!p) throw new Error('Proje bulunamadi (yeniden tarama gerekebilir)');
  return p;
}

/** Kart kimligi bilinen bir proje ya da grup klasoru mu? */
function isKnownCardKey(key) {
  if (typeof key !== 'string' || !key) return false;
  for (const p of projects.values()) {
    if (p.id === key || p.groupId === key) return true;
  }
  return false;
}

/** Bir override degisikligi sonrasi ilgili projeyi tazeler. */
function reloadProject(id) {
  const win = BrowserWindow.getAllWindows()[0];
  refresh(win);
  return projects.get(id) || null;
}

function register(getWindow) {
  const win = () => getWindow?.() || BrowserWindow.getAllWindows()[0];

  /* --------------------------- config --------------------------- */
  ipcMain.handle(CH.CONFIG_GET, () => config.get());

  ipcMain.handle(CH.CONFIG_PICK_ROOT, async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: 'Projelerin bulundugu kok klasoru sec',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return config.get();
    return config.addRoot(res.filePaths[0]);
  });

  ipcMain.handle(CH.CONFIG_ADD_ROOT, (_e, dir) => config.addRoot(String(dir || '')));
  ipcMain.handle(CH.CONFIG_REMOVE_ROOT, (_e, dir) => config.removeRoot(String(dir || '')));

  ipcMain.handle(CH.CONFIG_SET_OVERRIDE, (_e, id, patch) => {
    const p = requireProject(id);
    const clean = {};
    for (const key of ['name', 'install', 'build', 'start', 'env']) {
      if (patch && key in patch) clean[key] = typeof patch[key] === 'string' ? patch[key] : '';
    }
    config.setOverride(p.path, clean);
    return reloadProject(id);
  });

  ipcMain.handle(CH.CONFIG_RESET_OVERRIDE, (_e, id) => {
    const p = requireProject(id);
    config.resetOverride(p.path);
    return reloadProject(id);
  });

  ipcMain.handle(CH.CONFIG_TOGGLE_HIDDEN, (_e, id) => {
    const p = requireProject(id);
    config.toggleHidden(p.path);
    return reloadProject(id);
  });

  ipcMain.handle(CH.CONFIG_TOGGLE_FAVORITE, (_e, key) => {
    if (!isKnownCardKey(key)) throw new Error('Gecersiz kart kimligi');
    return config.toggleFavorite(key);
  });

  ipcMain.handle(CH.CONFIG_SET_COLLAPSED, (_e, keys, collapsed) => {
    if (!Array.isArray(keys) || keys.length > 1000) throw new Error('Gecersiz kart listesi');
    return config.setCollapsed(keys.filter(isKnownCardKey), collapsed === true);
  });

  /* -------------------------- baslangic -------------------------- */
  ipcMain.handle(CH.STARTUP_GET, () => startup.isEnabled());
  ipcMain.handle(CH.STARTUP_SET, (_e, enabled) => startup.setEnabled(enabled === true));

  /* -------------------------- projeler -------------------------- */
  ipcMain.handle(CH.PROJECTS_SCAN, () => refresh(win()));
  ipcMain.handle(CH.PROJECTS_LIST, () => list());

  /* -------------------------- islemler -------------------------- */
  ipcMain.handle(CH.PROC_START, (_e, id) => pm.start(requireProject(id)));
  ipcMain.handle(CH.PROC_STOP, (_e, id) => pm.stop(requireProject(id).id));
  ipcMain.handle(CH.PROC_STOP_ALL, () => pm.stopAll());
  ipcMain.handle(CH.PROC_BUILD, (_e, id) => pm.runTask(requireProject(id), 'build'));
  ipcMain.handle(CH.PROC_INSTALL, (_e, id) => pm.runTask(requireProject(id), 'install'));
  ipcMain.handle(CH.PROC_STATE, () => pm.allStates());
  ipcMain.handle(CH.PROC_LOGS, (_e, id) => pm.getLogs(requireProject(id).id));
  ipcMain.handle(CH.PROC_CLEAR_LOGS, (_e, id) => {
    pm.clearLogs(requireProject(id).id);
    return true;
  });

  /* ----------------------------- git ---------------------------- */
  ipcMain.handle(CH.GIT_STATUS, (_e, id) => gitOps.status(requireProject(id).path));

  ipcMain.handle(CH.GIT_STATUS_ALL, async () => {
    const all = list();
    const infos = await mapLimit(all, GIT_CONCURRENCY, (p) => gitOps.status(p.path));
    return Object.fromEntries(all.map((p, i) => [p.id, infos[i]]));
  });

  ipcMain.handle(CH.GIT_COMMIT, (_e, id, message, alsoPush) => {
    const p = requireProject(id);
    const msg = typeof message === 'string' ? message.trim() : '';
    if (!msg) throw new Error('Commit mesaji bos olamaz');
    if (msg.length > MAX_COMMIT_MESSAGE) throw new Error('Commit mesaji cok uzun');
    const withPush = alsoPush === true;

    return runGitTask(p, withPush ? 'Commit + push' : 'Commit', async (log) => {
      const committed = await gitOps.commit(p.path, msg, log);
      if (!committed.ok || !withPush) return committed;
      const pushed = await gitOps.push(p.path, log);
      return pushed.ok ? pushed : { ok: false, error: `Commit yapildi, push basarisiz: ${pushed.error}` };
    });
  });

  ipcMain.handle(CH.GIT_PUSH, (_e, id) => {
    const p = requireProject(id);
    return runGitTask(p, 'Push', (log) => gitOps.push(p.path, log));
  });

  /* ---------------------------- shell --------------------------- */
  ipcMain.handle(CH.SHELL_OPEN_FOLDER, (_e, id) => {
    const p = requireProject(id);
    if (!fs.existsSync(p.path)) throw new Error('Klasor bulunamadi');
    return shell.openPath(p.path);
  });

  ipcMain.handle(CH.SHELL_OPEN_URL, (_e, url) => {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) throw new Error('Sadece http/https adresleri acilabilir');
    return shell.openExternal(value);
  });

  ipcMain.handle(CH.SHELL_OPEN_TERMINAL, (_e, id) => {
    const p = requireProject(id);
    if (process.platform === 'win32') {
      const cmd = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
      spawn(cmd, ['/c', 'start', '""', cmd, '/K', 'cd', '/d', p.path], { detached: true }).unref();
    } else {
      exec(`x-terminal-emulator --working-directory="${p.path}"`);
    }
    return true;
  });

  /* --------------------- main -> renderer ----------------------- */
  const send = (channel, payload) => {
    const w = win();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };
  pm.on('state', (s) => send(CH.EVT_STATE, s));
  pm.on('log', (l) => send(CH.EVT_LOG, l));
}

module.exports = { register, refresh, list };
