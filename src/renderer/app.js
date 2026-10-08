'use strict';

const api = window.appCenter;

const state = {
  projects: [],
  procs: {},
  filterText: '',
  filterStatus: 'all',
  filterType: 'all',
  activeLog: null,
  showHidden: false,
  /** favori kart kimlikleri (proje id'si ya da grup id'si) */
  favorites: new Set(),
  /** daraltilmis kart kimlikleri */
  collapsed: new Set()
};

/* ----------------------------- yardimcilar ----------------------------- */

const $ = (sel) => document.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(message, isError = false) {
  const box = $('#toast');
  box.textContent = message;
  box.className = `toast${isError ? ' err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.add('hidden'), 3500);
}

async function guard(promise) {
  try {
    return await promise;
  } catch (err) {
    toast(String(err.message || err).replace(/^Error: /, ''), true);
    return null;
  }
}

function procOf(id) {
  return state.procs[id] || { status: 'stopped', task: null, url: null, taskLabel: '' };
}

const STATUS_LABEL = {
  stopped: 'Durdu',
  starting: 'Basliyor',
  running: 'Calisiyor',
  error: 'Hata'
};

const isRunning = (status) => status === 'running' || status === 'starting';

/** Log basliginda ve ayarlarda kullanilan tam ad (grup icindeyse "grup / ad"). */
function displayName(project) {
  return project.groupName ? `${project.groupName} / ${project.name}` : project.name;
}

/* ------------------------ kart parcalari (ortak) ------------------------ */

function statusNode(cls, label) {
  const status = el('div', 'status');
  status.append(el('span', `dot ${cls}`));
  status.append(el('span', null, label));
  return status;
}

function projectStatusNode(project) {
  const proc = procOf(project.id);
  if (proc.task) return statusNode('busy', proc.taskLabel);
  return statusNode(proc.status, STATUS_LABEL[proc.status] || proc.status);
}

function iconButton(className, text, title, onClick) {
  const btn = el('button', `icon-btn ${className}`, text);
  btn.title = title;
  btn.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return btn;
}

function favoriteButton(key) {
  const on = state.favorites.has(key);
  return iconButton(
    `star${on ? ' on' : ''}`,
    on ? '★' : '☆',
    on ? 'Favorilerden cikar' : 'Favorilere ekle',
    () => toggleFavorite(key)
  );
}

function collapseButton(key) {
  const collapsed = state.collapsed.has(key);
  return iconButton(
    'chevron',
    collapsed ? '▸' : '▾',
    collapsed ? 'Karti genislet' : 'Karti daralt',
    () => toggleCollapsed(key)
  );
}

/**
 * Kart ya da alt oge basligi.
 * @param {{collapseKey?: string, favoriteKey: string, icon: string, title: string,
 *          sub?: string, status: HTMLElement, extra?: HTMLElement}} opts
 */
function headNode({ collapseKey, favoriteKey, icon, title, sub, status, extra }) {
  const head = el('div', 'card-head');
  if (collapseKey) head.append(collapseButton(collapseKey));
  head.append(el('span', 'card-icon', icon || '\u{1F4E6}'));

  const titleBox = el('div', 'card-titlebox');
  const titleNode = el('div', 'card-title', title);
  if (collapseKey) {
    titleNode.classList.add('clickable');
    titleNode.onclick = () => toggleCollapsed(collapseKey);
  }
  titleBox.append(titleNode);
  if (sub) titleBox.append(el('div', 'card-sub', sub));
  head.append(titleBox);

  head.append(status);
  if (extra) head.append(extra);
  head.append(favoriteButton(favoriteKey));
  return head;
}

function badgesNode(project) {
  const proc = procOf(project.id);
  const badges = el('div', 'badges');
  badges.append(el('span', 'badge', project.typeLabel));
  if (project.customized) badges.append(el('span', 'badge custom', 'ozel komut'));
  if (project.needsInstall) badges.append(el('span', 'badge warn', 'kurulum gerekli'));
  if (project.hidden) badges.append(el('span', 'badge', 'gizli'));
  if (proc.url) badges.append(el('span', 'badge', proc.url.replace(/^https?:\/\//, '')));
  return badges;
}

function cmdNode(project) {
  if (!project.start) return el('div', 'cmd', 'Calistirma komutu tanimli degil');
  const command = project.start === '@static' ? 'dahili statik sunucu' : project.start;
  return el('div', 'cmd', `▶ ${command}`);
}

/** Baslat/Durdur butonu; compact=true ise daraltilmis kart basligi icin kucuk hali. */
function runButton(project, compact = false) {
  const running = isRunning(procOf(project.id).status);
  const label = compact ? (running ? '■' : '▶') : running ? '■ Durdur' : '▶ Baslat';
  const btn = el('button', `btn ${running ? 'danger' : 'primary'}${compact ? ' small' : ''}`, label);
  btn.title = running ? 'Durdur' : 'Baslat';
  btn.disabled = !running && !project.start;
  btn.onclick = (e) => {
    e.stopPropagation();
    guard(running ? api.proc.stop(project.id) : api.proc.start(project.id));
  };
  return btn;
}

function actionsNode(project) {
  const proc = procOf(project.id);
  const busy = Boolean(proc.task);
  const actions = el('div', 'card-actions');
  actions.append(runButton(project));

  if (project.build) {
    const buildBtn = el('button', 'btn', '\u{1F528} Build');
    buildBtn.disabled = busy;
    buildBtn.onclick = () => {
      openLog(project);
      guard(api.proc.build(project.id));
    };
    actions.append(buildBtn);
  }

  if (project.install) {
    const installBtn = el('button', 'btn', '⤓ Kur');
    installBtn.disabled = busy;
    installBtn.title = 'Bagimliliklari kur';
    installBtn.onclick = () => {
      openLog(project);
      guard(api.proc.install(project.id));
    };
    actions.append(installBtn);
  }

  if (proc.url) {
    const openBtn = el('button', 'btn success', '\u{1F310} Ac');
    openBtn.onclick = () => guard(api.shell.openUrl(proc.url));
    actions.append(openBtn);
  }

  const logBtn = el('button', 'btn icon', '\u{1F4C4}');
  logBtn.title = 'Log';
  logBtn.onclick = () => openLog(project);
  actions.append(logBtn);

  const folderBtn = el('button', 'btn icon', '\u{1F4C1}');
  folderBtn.title = 'Klasoru ac';
  folderBtn.onclick = () => guard(api.shell.openFolder(project.id));
  actions.append(folderBtn);

  const termBtn = el('button', 'btn icon', '>_');
  termBtn.title = 'Terminalde ac';
  termBtn.onclick = () => guard(api.shell.openTerminal(project.id));
  actions.append(termBtn);

  const gearBtn = el('button', 'btn icon', '⚙');
  gearBtn.title = 'Komutlari duzenle';
  gearBtn.onclick = () => openSettings(project);
  actions.append(gearBtn);

  return actions;
}

/* ------------------------------- kartlar -------------------------------- */

/** Tek projelik kart. Daraltilmissa sadece baslik + kucuk baslat/durdur. */
function buildSingleCard(card) {
  const project = card.project;
  const proc = procOf(project.id);
  const collapsed = state.collapsed.has(card.id);

  const node = el('article', 'card');
  node.classList.add(proc.task ? 'busy' : proc.status);
  if (collapsed) node.classList.add('collapsed');
  if (isFavoriteCard(card)) node.classList.add('favorite');

  node.append(headNode({
    collapseKey: card.id,
    favoriteKey: project.id,
    icon: project.icon,
    title: project.name,
    sub: project.path,
    status: projectStatusNode(project),
    extra: collapsed ? runButton(project, true) : null
  }));
  if (collapsed) return node;

  node.append(badgesNode(project));
  if (project.description) node.append(el('div', 'desc', project.description));
  node.append(cmdNode(project));
  node.append(actionsNode(project));
  return node;
}

/** Grup kartindaki tek bir uygulama. */
function buildSubItem(project) {
  const proc = procOf(project.id);
  const item = el('div', 'sub');
  item.classList.add(proc.task ? 'busy' : proc.status);

  item.append(headNode({
    favoriteKey: project.id,
    icon: project.icon,
    title: project.name,
    sub: project.subPath !== project.name ? project.subPath : '',
    status: projectStatusNode(project)
  }));
  item.append(badgesNode(project));
  item.append(cmdNode(project));
  item.append(actionsNode(project));
  return item;
}

/** Ayni ust klasordeki ic ice projeleri tek kartta toplar. */
function buildGroupCard(card) {
  const collapsed = state.collapsed.has(card.id);
  const procs = card.children.map((p) => procOf(p.id));
  const running = procs.filter((p) => isRunning(p.status)).length;
  const busy = procs.some((p) => p.task);
  const error = procs.some((p) => p.status === 'error');
  const cls = busy ? 'busy' : running ? 'running' : error ? 'error' : 'stopped';

  const node = el('article', 'card group');
  node.classList.add(cls);
  if (collapsed) node.classList.add('collapsed');
  if (isFavoriteCard(card)) node.classList.add('favorite');

  const count = `${card.children.length} uygulama`;
  node.append(headNode({
    collapseKey: card.id,
    favoriteKey: card.id,
    icon: '\u{1F4C2}',
    title: card.name,
    sub: card.path,
    status: statusNode(cls, running ? `${count} · ${running} calisiyor` : count)
  }));
  if (collapsed) return node;

  const list = el('div', 'sub-list');
  for (const project of card.children) list.append(buildSubItem(project));
  node.append(list);
  return node;
}

/* --------------------------- filtre ve siralama --------------------------- */

/**
 * Proje filtrelere uyuyor mu?
 * @param {boolean} groupHit arama metni grup adina uyuyorsa tum uyeler gosterilir
 */
function projectMatches(p, text, groupHit) {
  if (p.hidden && !state.showHidden) return false;
  if (state.filterType !== 'all' && p.type !== state.filterType) return false;

  const st = procOf(p.id).status;
  if (state.filterStatus === 'running' && !isRunning(st)) return false;
  if (state.filterStatus === 'stopped' && isRunning(st)) return false;

  if (!text || groupHit) return true;
  return [p.name, p.path, p.typeLabel, p.description, p.subPath]
    .some((v) => (v || '').toLowerCase().includes(text));
}

/** Grup, kendisi ya da icindeki herhangi bir uygulama favoriyse favori sayilir. */
function isFavoriteCard(card) {
  if (state.favorites.has(card.id)) return true;
  return card.kind === 'group' && card.children.some((p) => state.favorites.has(p.id));
}

function favoritesFirst(aFav, bFav, aName, bName) {
  if (aFav !== bFav) return aFav ? -1 : 1;
  return aName.localeCompare(bName, 'tr');
}

/** Projeleri kartlara donusturur: dogrudan kok altindakiler tekli, ic icedekiler grup. */
function visibleCards() {
  const text = state.filterText.trim().toLowerCase();
  const cards = [];
  const groups = new Map();

  for (const p of state.projects) {
    if (!p.groupId) {
      if (projectMatches(p, text, false)) cards.push({ kind: 'single', id: p.id, name: p.name, project: p });
      continue;
    }
    if (!groups.has(p.groupId)) {
      groups.set(p.groupId, {
        kind: 'group', id: p.groupId, name: p.groupName, path: p.groupPath, members: []
      });
    }
    groups.get(p.groupId).members.push(p);
  }

  for (const g of groups.values()) {
    const groupHit = Boolean(text) &&
      (g.name.toLowerCase().includes(text) || g.path.toLowerCase().includes(text));
    // favoriler, sonra klasorun kendi start.cmd'si, sonra ada gore
    g.children = g.members
      .filter((p) => projectMatches(p, text, groupHit))
      .sort((a, b) => {
        const aFav = state.favorites.has(a.id);
        const bFav = state.favorites.has(b.id);
        if (aFav === bFav && Boolean(a.isGroupRoot) !== Boolean(b.isGroupRoot)) {
          return a.isGroupRoot ? -1 : 1;
        }
        return favoritesFirst(aFav, bFav, a.name, b.name);
      });
    if (g.children.length) cards.push(g);
  }

  return cards.sort((a, b) => favoritesFirst(isFavoriteCard(a), isFavoriteCard(b), a.name, b.name));
}

const CARD_MIN_WIDTH = 330;
const GRID_GAP = 14;
let lastColumnCount = 0;

function columnCount() {
  const grid = $('#grid');
  const style = getComputedStyle(grid);
  const inner = grid.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.max(1, Math.floor((inner + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
}

/**
 * Kartlari sirayla o an en kisa sutuna yerlestirir. Siralama (favoriler once)
 * ust satirlarda korunur, farkli yukseklikteki kartlar arasinda bosluk kalmaz.
 */
function layoutCards(nodes) {
  const grid = $('#grid');
  grid.textContent = '';
  lastColumnCount = columnCount();

  const cols = Array.from({ length: lastColumnCount }, () => el('div', 'grid-col'));
  grid.append(...cols);
  const heights = cols.map(() => 0);

  for (const node of nodes) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].append(node);
    heights[i] = cols[i].offsetHeight;
  }
}

function render() {
  const grid = $('#grid');
  const cards = visibleCards();

  const noProjects = state.projects.length === 0;
  $('#empty').classList.toggle('hidden', !noProjects);
  grid.classList.toggle('hidden', noProjects);

  layoutCards(cards.map((card) =>
    card.kind === 'group' ? buildGroupCard(card) : buildSingleCard(card)
  ));

  const runningCount = state.projects.filter((p) => isRunning(procOf(p.id).status)).length;
  const shown = cards.reduce((n, c) => n + (c.kind === 'group' ? c.children.length : 1), 0);

  $('#subtitle').textContent =
    `${state.projects.length} proje bulundu · ${runningCount} calisiyor · ${shown} gosteriliyor`;

  const allCollapsed = cards.length > 0 && cards.every((c) => state.collapsed.has(c.id));
  const collapseAll = $('#btn-collapse-all');
  collapseAll.textContent = allCollapsed ? '▾ Tumunu Genislet' : '▸ Tumunu Daralt';
  collapseAll.dataset.mode = allCollapsed ? 'expand' : 'collapse';

  refreshTypeFilter();
}

/* ------------------------- favori ve daraltma -------------------------- */

function applyCardPrefs(cfg) {
  if (!cfg) return;
  state.favorites = new Set(cfg.favorites || []);
  state.collapsed = new Set(cfg.collapsed || []);
}

async function loadCardPrefs() {
  applyCardPrefs(await guard(api.config.get()));
}

// Arayuz aninda guncellenir; main'in dondurdugu config ile tekrar esitlenir.
async function toggleFavorite(key) {
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  render();
  const cfg = await guard(api.config.toggleFavorite(key));
  if (cfg) applyCardPrefs(cfg);
  else await loadCardPrefs();
  render();
}

async function setCollapsed(keys, collapsed) {
  for (const key of keys) {
    if (collapsed) state.collapsed.add(key);
    else state.collapsed.delete(key);
  }
  render();
  const cfg = await guard(api.config.setCollapsed(keys, collapsed));
  if (cfg) applyCardPrefs(cfg);
  else await loadCardPrefs();
  render();
}

function toggleCollapsed(key) {
  return setCollapsed([key], !state.collapsed.has(key));
}

function refreshTypeFilter() {
  const select = $('#filter-type');
  const types = [...new Set(state.projects.map((p) => `${p.type}|${p.typeLabel}`))].sort();
  const wanted = ['all', ...types.map((t) => t.split('|')[0])].join(',');
  if (select.dataset.signature === wanted) return;

  select.dataset.signature = wanted;
  const current = state.filterType;
  select.textContent = '';
  select.append(new Option('Tum tipler', 'all'));
  for (const t of types) {
    const [value, label] = t.split('|');
    select.append(new Option(label, value));
  }
  select.value = [...select.options].some((o) => o.value === current) ? current : 'all';
}

/* --------------------------------- log --------------------------------- */

function appendLogLine(entry) {
  const body = $('#log-body');
  const line = el('div', `log-line ${entry.kind}`, entry.line);
  body.append(line);
  if ($('#log-autoscroll').checked) body.scrollTop = body.scrollHeight;
  while (body.childElementCount > 1500) body.firstElementChild.remove();
}

async function openLog(project) {
  state.activeLog = project.id;
  $('#log-title').textContent = `Log — ${displayName(project)}`;
  $('#logpanel').classList.remove('hidden');
  const body = $('#log-body');
  body.textContent = '';
  const lines = (await guard(api.proc.logs(project.id))) || [];
  for (const entry of lines) appendLogLine(entry);
  body.scrollTop = body.scrollHeight;
}

/* ------------------------------- ayarlar ------------------------------- */

let settingsTarget = null;

function openSettings(project) {
  settingsTarget = project;
  $('#settings-title').textContent = `Ayarlar — ${displayName(project)}`;
  $('#settings-hide').textContent = project.hidden ? 'Listede Goster' : 'Listeden Gizle';
  $('#settings-path').textContent = `${project.path}  ·  algilanan tip: ${project.typeLabel}`;
  $('#f-name').value = project.name || '';
  $('#f-install').value = project.install || '';
  $('#f-build').value = project.build || '';
  $('#f-start').value = project.start === '@static' ? '' : project.start || '';
  $('#f-start').placeholder =
    project.detected.start === '@static'
      ? 'bos birak = dahili statik sunucu'
      : project.detected.start || 'orn. npm run dev';
  $('#f-env').value = project.env || '';
  $('#settings-modal').classList.remove('hidden');
}

function closeSettings() {
  settingsTarget = null;
  $('#settings-modal').classList.add('hidden');
}

async function saveSettings() {
  if (!settingsTarget) return;
  const patch = {
    name: $('#f-name').value.trim(),
    install: $('#f-install').value.trim(),
    build: $('#f-build').value.trim(),
    start: $('#f-start').value.trim(),
    env: $('#f-env').value
  };
  // Bos birakilan alanlar otomatik algilanan degere doner.
  const updated = await guard(api.config.setOverride(settingsTarget.id, patch));
  if (updated) {
    await reloadProjects();
    toast('Ayarlar kaydedildi.');
  }
  closeSettings();
}

/* ------------------------------ kok klasor ------------------------------ */

async function renderRoots() {
  const cfg = await guard(api.config.get());
  if (!cfg) return;
  const list = $('#roots-list');
  list.textContent = '';

  if (!cfg.roots.length) {
    list.append(el('li', null, 'Henuz kok klasor eklenmedi.'));
    return;
  }

  for (const root of cfg.roots) {
    const li = el('li');
    li.append(el('span', null, root));
    li.append(el('span', 'spacer'));
    const rm = el('button', 'btn small danger', 'Kaldir');
    rm.onclick = async () => {
      await guard(api.config.removeRoot(root));
      await renderRoots();
      await scan();
    };
    li.append(rm);
    list.append(li);
  }
}

/* -------------------------------- veri --------------------------------- */

async function reloadProjects() {
  const list = await guard(api.projects.list());
  if (list) state.projects = list;
  render();
}

async function scan() {
  $('#subtitle').textContent = 'Taraniyor...';
  const list = await guard(api.projects.scan());
  if (list) state.projects = list;
  state.procs = (await guard(api.proc.states())) || {};
  await loadCardPrefs();
  render();
}

/* ------------------------------- baglama ------------------------------- */

function bindUi() {
  $('#search').addEventListener('input', (e) => {
    state.filterText = e.target.value;
    render();
  });
  $('#filter-status').addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    render();
  });
  $('#filter-type').addEventListener('change', (e) => {
    state.filterType = e.target.value;
    render();
  });

  $('#btn-scan').onclick = scan;
  $('#btn-collapse-all').onclick = (e) => {
    const keys = visibleCards().map((c) => c.id);
    setCollapsed(keys, e.currentTarget.dataset.mode !== 'expand');
  };
  $('#btn-stop-all').onclick = async () => {
    await guard(api.proc.stopAll());
    toast('Calisan tum projeler durduruldu.');
  };

  $('#btn-roots').onclick = async () => {
    await renderRoots();
    $('#roots-modal').classList.remove('hidden');
  };
  $('#roots-close').onclick = () => $('#roots-modal').classList.add('hidden');
  $('#roots-add').onclick = async () => {
    await guard(api.config.pickRoot());
    await renderRoots();
    await scan();
  };
  $('#btn-empty-add').onclick = async () => {
    await guard(api.config.pickRoot());
    await scan();
  };

  $('#settings-cancel').onclick = closeSettings;
  $('#settings-save').onclick = saveSettings;
  $('#settings-reset').onclick = async () => {
    if (!settingsTarget) return;
    await guard(api.config.resetOverride(settingsTarget.id));
    await reloadProjects();
    closeSettings();
    toast('Otomatik algilanan komutlara donuldu.');
  };

  $('#settings-hide').onclick = async () => {
    if (!settingsTarget) return;
    const wasHidden = settingsTarget.hidden;
    await guard(api.config.toggleHidden(settingsTarget.id));
    await reloadProjects();
    closeSettings();
    toast(wasHidden ? 'Proje tekrar listeleniyor.' : 'Proje gizlendi ("Gizliler" ile gorebilirsin).');
  };

  $('#show-hidden').addEventListener('change', (e) => {
    state.showHidden = e.target.checked;
    render();
  });

  const startupBox = $('#launch-startup');
  startupBox.addEventListener('change', async (e) => {
    const wanted = e.target.checked;
    const applied = await guard(api.startup.set(wanted));
    startupBox.checked = applied === true;
    if (applied === wanted) {
      toast(wanted
        ? 'App Center, Windows acilisinda otomatik baslayacak.'
        : 'Otomatik baslatma kapatildi.');
    } else if (applied !== null) {
      toast('Otomatik baslatma ayari uygulanamadi.', true);
    }
  });

  $('#log-close').onclick = () => {
    state.activeLog = null;
    $('#logpanel').classList.add('hidden');
  };
  $('#log-clear').onclick = async () => {
    if (!state.activeLog) return;
    await guard(api.proc.clearLogs(state.activeLog));
    $('#log-body').textContent = '';
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('#settings-modal').classList.add('hidden');
      $('#roots-modal').classList.add('hidden');
    }
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      scan();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('#search').focus();
    }
  });

  // Pencere genisligi sutun sayisini degistirdiginde yeniden yerlestir.
  window.addEventListener('resize', () => {
    if (columnCount() !== lastColumnCount) render();
  });

  api.on.state((s) => {
    state.procs[s.id] = s;
    render();
  });

  api.on.log((entry) => {
    if (entry.id === state.activeLog) appendLogLine(entry);
  });

  api.on.scanProgress((dir) => {
    $('#subtitle').textContent = `Taraniyor: ${dir}`;
  });
}

async function loadStartupState() {
  const enabled = await guard(api.startup.get());
  $('#launch-startup').checked = enabled === true;
}

bindUi();
loadStartupState();
scan();
