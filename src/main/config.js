'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  roots: [],
  // kok klasorden itibaren kac seviye asagi inilecegi (config.json'dan degistirilebilir)
  maxDepth: 3,
  // proje yolu -> { name, install, build, start, env, autoOpenBrowser }
  overrides: {},
  // gizlenen proje yollari
  hidden: [],
  // favori kart kimlikleri (proje ya da grup klasoru, normalize edilmis yol)
  favorites: [],
  // daraltilmis kart kimlikleri
  collapsed: [],
  settings: {
    stopAllOnQuit: true
  }
};

let cache = null;
let filePath = null;

function file() {
  if (!filePath) filePath = path.join(app.getPath('userData'), 'config.json');
  return filePath;
}

function normalizeKey(p) {
  return path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      ...DEFAULTS,
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}) },
      overrides: parsed.overrides || {},
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
      roots: Array.isArray(parsed.roots) ? parsed.roots : []
    };
  } catch {
    cache = JSON.parse(JSON.stringify(DEFAULTS));
    // Ilk acilista uygulamanin bulundugu klasorun ustunu kok olarak oner.
    const guess = path.resolve(app.getAppPath(), '..');
    if (fs.existsSync(guess)) cache.roots = [guess];
    write(cache);
  }
  return cache;
}

function write(cfg) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] kaydedilemedi:', err.message);
  }
  return cfg;
}

function save() {
  return write(load());
}

function get() {
  return load();
}

function addRoot(dir) {
  const cfg = load();
  if (typeof dir !== 'string' || !dir.trim()) return cfg;
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return cfg;
  if (!cfg.roots.some((r) => normalizeKey(r) === normalizeKey(abs))) cfg.roots.push(abs);
  return save();
}

function removeRoot(dir) {
  const cfg = load();
  cfg.roots = cfg.roots.filter((r) => normalizeKey(r) !== normalizeKey(dir));
  return save();
}

function setOverride(projectPath, patch) {
  const cfg = load();
  const key = normalizeKey(projectPath);
  const current = cfg.overrides[key] || {};
  const next = { ...current };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === null || v === '' || v === undefined) delete next[k];
    else next[k] = v;
  }
  if (Object.keys(next).length === 0) delete cfg.overrides[key];
  else cfg.overrides[key] = next;
  return save();
}

function resetOverride(projectPath) {
  const cfg = load();
  delete cfg.overrides[normalizeKey(projectPath)];
  return save();
}

function getOverride(projectPath) {
  return load().overrides[normalizeKey(projectPath)] || {};
}

function toggleHidden(projectPath) {
  const cfg = load();
  const key = normalizeKey(projectPath);
  const idx = cfg.hidden.findIndex((h) => normalizeKey(h) === key);
  if (idx >= 0) cfg.hidden.splice(idx, 1);
  else cfg.hidden.push(path.resolve(projectPath));
  return save();
}

function isHidden(projectPath) {
  const key = normalizeKey(projectPath);
  return load().hidden.some((h) => normalizeKey(h) === key);
}

/**
 * Kart kimligini favorilere ekler ya da cikarir.
 * @param {string} key normalize edilmis proje/grup yolu
 */
function toggleFavorite(key) {
  const cfg = load();
  const idx = cfg.favorites.indexOf(key);
  if (idx >= 0) cfg.favorites.splice(idx, 1);
  else cfg.favorites.push(key);
  return save();
}

/**
 * Verilen kartlari daraltilmis / acik olarak isaretler.
 * @param {string[]} keys normalize edilmis proje/grup yollari
 * @param {boolean} collapsed
 */
function setCollapsed(keys, collapsed) {
  const cfg = load();
  const set = new Set(cfg.collapsed);
  for (const key of keys) {
    if (collapsed) set.add(key);
    else set.delete(key);
  }
  cfg.collapsed = [...set];
  return save();
}

module.exports = {
  get,
  save,
  addRoot,
  removeRoot,
  setOverride,
  resetOverride,
  getOverride,
  toggleHidden,
  isHidden,
  toggleFavorite,
  setCollapsed,
  normalizeKey
};
