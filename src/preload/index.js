'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Sandbox modunda calistigi icin bu dosya baska modul require edemez.
 * Kanal adlari src/shared/ipc-channels.js ile birebir ayni olmali.
 */
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('appCenter', {
  config: {
    get: () => invoke('config:get'),
    pickRoot: () => invoke('config:pick-root'),
    addRoot: (dir) => invoke('config:add-root', dir),
    removeRoot: (dir) => invoke('config:remove-root', dir),
    setOverride: (id, patch) => invoke('config:set-override', id, patch),
    resetOverride: (id) => invoke('config:reset-override', id),
    toggleHidden: (id) => invoke('config:toggle-hidden', id)
  },
  startup: {
    get: () => invoke('startup:get'),
    set: (enabled) => invoke('startup:set', enabled)
  },
  projects: {
    scan: () => invoke('projects:scan'),
    list: () => invoke('projects:list')
  },
  proc: {
    start: (id) => invoke('proc:start', id),
    stop: (id) => invoke('proc:stop', id),
    stopAll: () => invoke('proc:stop-all'),
    build: (id) => invoke('proc:build', id),
    install: (id) => invoke('proc:install', id),
    states: () => invoke('proc:state'),
    logs: (id) => invoke('proc:logs', id),
    clearLogs: (id) => invoke('proc:clear-logs', id)
  },
  shell: {
    openFolder: (id) => invoke('shell:open-folder', id),
    openUrl: (url) => invoke('shell:open-url', url),
    openTerminal: (id) => invoke('shell:open-terminal', id)
  },
  on: {
    state: (cb) => subscribe('evt:state', cb),
    log: (cb) => subscribe('evt:log', cb),
    scanProgress: (cb) => subscribe('evt:scan-progress', cb)
  }
});
