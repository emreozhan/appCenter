'use strict';

/**
 * Tum IPC kanal adlari burada toplanir.
 * NOT: preload sandbox modunda calistigi icin bu dosyayi require edemez;
 * preload/index.js icindeki string'ler bu listeyle birebir ayni olmali.
 */
const CH = {
  // renderer -> main (invoke/handle)
  CONFIG_GET: 'config:get',
  CONFIG_ADD_ROOT: 'config:add-root',
  CONFIG_REMOVE_ROOT: 'config:remove-root',
  CONFIG_PICK_ROOT: 'config:pick-root',
  CONFIG_SET_OVERRIDE: 'config:set-override',
  CONFIG_RESET_OVERRIDE: 'config:reset-override',
  CONFIG_TOGGLE_HIDDEN: 'config:toggle-hidden',
  STARTUP_GET: 'startup:get',
  STARTUP_SET: 'startup:set',

  PROJECTS_SCAN: 'projects:scan',
  PROJECTS_LIST: 'projects:list',

  PROC_START: 'proc:start',
  PROC_STOP: 'proc:stop',
  PROC_BUILD: 'proc:build',
  PROC_INSTALL: 'proc:install',
  PROC_STOP_ALL: 'proc:stop-all',
  PROC_STATE: 'proc:state',
  PROC_LOGS: 'proc:logs',
  PROC_CLEAR_LOGS: 'proc:clear-logs',

  SHELL_OPEN_FOLDER: 'shell:open-folder',
  SHELL_OPEN_URL: 'shell:open-url',
  SHELL_OPEN_TERMINAL: 'shell:open-terminal',

  // main -> renderer (webContents.send)
  EVT_STATE: 'evt:state',
  EVT_LOG: 'evt:log',
  EVT_SCAN_PROGRESS: 'evt:scan-progress'
};

module.exports = { CH };
