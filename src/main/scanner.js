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
 * Bir klasor proje olarak taninirsa icine inilmez.
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
      } else {
        walk(child, depth + 1);
      }
    }
  };

  for (const root of cfg.roots) {
    if (!fs.existsSync(root)) continue;
    walk(root, 1);
  }

  return [...found.values()]
    .map((p) => applyOverrides(p, cfg))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

function applyOverrides(project, cfg) {
  const key = config.normalizeKey(project.path);
  const ov = cfg.overrides[key] || {};
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
    root: cfg.roots.find((r) => key.startsWith(config.normalizeKey(r))) || ''
  };
}

module.exports = { scan };
