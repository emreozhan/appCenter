'use strict';

const { app } = require('electron');

/**
 * Windows oturum acilisinda otomatik baslatma.
 * Kaynak dogruluk isletim sisteminde (HKCU\...\Run); config.json'da kopya tutulmaz.
 * Paketlenmemis calisirken kayit, electron.exe + proje klasoru seklinde olmali.
 */
function loginOptions() {
  if (app.isPackaged) return { path: process.execPath };
  return { path: process.execPath, args: [`"${app.getAppPath()}"`] };
}

function isEnabled() {
  try {
    return Boolean(app.getLoginItemSettings(loginOptions()).openAtLogin);
  } catch {
    return false;
  }
}

function setEnabled(enabled) {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), ...loginOptions() });
  return isEnabled();
}

module.exports = { isEnabled, setEnabled };
