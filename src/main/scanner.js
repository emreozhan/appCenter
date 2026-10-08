'use strict';

const fs = require('fs');
const path = require('path');
const { detect, IGNORED_DIRS } = require('./detector');
const config = require('./config');

function subDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => !e.name.startsWith('.'))
      .filter((e) => !IGNORED_DIRS.has(e.name.toLowerCase()))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Kok klasorler altinda maxDepth seviyeye kadar proje arar.
 * Teknoloji koklerinde durur; yalniz script iceren semsiye klasorleri de tarar.
 */
function scan(onProgress) {
  const cfg = config.get();
  const selfPath = config.normalizeKey(path.resolve(__dirname, '..', '..'));
  const found = new Map();

  const walk = (dir, depth) => {
    if (depth > cfg.maxDepth) return;
    for (const child of subDirs(dir)) {
      const key = config.normalizeKey(child);
      if (key === selfPath || found.has(key)) continue;
      if (onProgress) onProgress(child);

      const project = detect(child);
      if (project) {
        found.set(key, project);
      }
      if (!project || project.scanChildren) {
        walk(child, depth + 1);
      }
    }
  };

  for (const root of cfg.roots) {
    if (!fs.existsSync(root)) continue;
    walk(root, 1);
  }

  const projects = [...found.values()].map((p) => applyOverrides(p, cfg));
  mergeUmbrellas(projects);
  return projects.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/**
 * Kendi start.cmd'si olan ve alt projeleri de bulunan semsiye klasor
 * (ornek: homeTool) hem tekli kart hem grup karti olarak iki kez gorunmesin:
 * klasoru kendi grubunun ilk ogesi yapar.
 */
function mergeUmbrellas(projects) {
  const groupIds = new Set(projects.map((p) => p.groupId).filter(Boolean));
  for (const p of projects) {
    if (p.groupId || !groupIds.has(p.id)) continue;
    Object.assign(p, {
      groupId: p.id,
      groupName: path.basename(p.path),
      groupPath: p.path,
      subPath: 'klasor koku',
      isGroupRoot: true
    });
  }
}

/** Projeyi iceren en spesifik kok klasoru bulur. */
function findRoot(key, roots) {
  let best = '';
  let bestKey = '';
  for (const r of roots) {
    const rk = config.normalizeKey(r);
    const inside = key === rk || key.startsWith(rk + path.sep);
    if (inside && rk.length > bestKey.length) {
      best = r;
      bestKey = rk;
    }
  }
  return best;
}

/**
 * Kok klasorun dogrudan altinda olmayan (ic ice) projeleri, kokun altindaki
 * ilk klasor adina gore gruplar. Ornek: AiProjects/homeTool/yeelight-controller
 * -> grup "homeTool", alt yol "yeelight-controller".
 */
function groupOf(projectPath, root) {
  const empty = { groupId: null, groupName: null, groupPath: null, subPath: null };
  if (!root) return empty;
  const parts = path.relative(root, projectPath).split(path.sep).filter(Boolean);
  if (parts.length < 2) return empty;
  const groupPath = path.join(root, parts[0]);
  return {
    groupId: config.normalizeKey(groupPath),
    groupName: parts[0],
    groupPath,
    subPath: parts.slice(1).join(' / ')
  };
}

function applyOverrides(project, cfg) {
  const key = config.normalizeKey(project.path);
  const ov = cfg.overrides[key] || {};
  const root = findRoot(key, cfg.roots);
  return {
    ...project,
    id: key,
    detected: {
      install: project.install,
      build: project.build,
      start: project.start,
      name: project.name
    },
    name: ov.name || project.name,
    install: ov.install !== undefined ? ov.install : project.install,
    build: ov.build !== undefined ? ov.build : project.build,
    start: ov.start !== undefined ? ov.start : project.start,
    env: ov.env || '',
    customized: Object.keys(ov).length > 0,
    hidden: cfg.hidden.some((h) => config.normalizeKey(h) === key),
    root,
    ...groupOf(project.path, root)
  };
}

module.exports = { scan };
