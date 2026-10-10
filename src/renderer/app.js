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
  collapsed: new Set(),
  /** proje id -> git durumu (main/git.js status() ciktisi) */
  git: {},
  /** surukle-birak sirasi (kart ve alt uygulama kimlikleri) ve hizli erisim icin indeksi */
  order: [],
  orderIndex: new Map(),
  /** suren surukleme: {kind: 'card'|'child', id, groupId?} */
  drag: null
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

function gitTooltip(info) {
  const lines = [
    `Depo: ${info.root}${info.nested ? ' (ust klasorun deposu, kapsam bu klasor)' : ''}`,
    `Dal: ${info.branch || '?'}`,
    info.upstream
      ? `Upstream: ${info.upstream}`
      : info.remotes.length
        ? `Remote: ${info.remotes.join(', ')} (upstream ayarlanmamis)`
        : 'Remote yok (yalnizca yerel)',
    info.changed ? `${info.changed} degisiklik` : 'Degisiklik yok'
  ];
  if (info.ahead) lines.push(`${info.ahead} commit push bekliyor`);
  if (info.behind) lines.push(`${info.behind} commit geride (son fetch'e gore)`);
  return lines.join('\n');
}

/** Basliktaki git rozeti: "git yok" ya da "⎇ dal ±degisiklik ↑ileri ↓geri". */
function gitChip(project) {
  const info = state.git[project.id];
  if (!info) return null;

  if (!info.isRepo) {
    const chip = el('span', 'git-chip none', 'git yok');
    chip.title = 'Bu klasor bir git deposunda degil';
    return chip;
  }
  if (info.error) {
    const chip = el('span', 'git-chip error', 'git ?');
    chip.title = info.error;
    return chip;
  }

  let text = `⎇ ${info.branch || '?'}`;
  if (info.changed) text += ` ±${info.changed}`;
  if (info.ahead) text += ` ↑${info.ahead}`;
  if (info.behind) text += ` ↓${info.behind}`;
  const chip = el('span', `git-chip ${info.changed ? 'dirty' : 'clean'}`, text);
  chip.title = gitTooltip(info);
  return chip;
}

/**
 * Kart ya da alt oge basligi.
 * @param {{collapseKey?: string, favoriteKey: string, icon: string, title: string,
 *          chip?: HTMLElement|null, sub?: string, status: HTMLElement, extra?: HTMLElement}} opts
 */
function headNode({ collapseKey, favoriteKey, icon, title, chip, sub, status, extra }) {
  const head = el('div', 'card-head');
  if (collapseKey) head.append(collapseButton(collapseKey));
  head.append(el('span', 'card-icon', icon || '\u{1F4E6}'));

  const titleBox = el('div', 'card-titlebox');
  const titleNode = el('div', 'card-title', title);
  if (collapseKey) {
    titleNode.classList.add('clickable');
    titleNode.onclick = () => toggleCollapsed(collapseKey);
  }
  const titleLine = el('div', 'card-titleline');
  titleLine.append(titleNode);
  if (chip) titleLine.append(chip);
  titleBox.append(titleLine);
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

  const gitInfo = state.git[project.id];
  if (gitInfo?.isRepo && !gitInfo.error) {
    const commitBtn = el('button', 'btn', gitInfo.changed ? `✔ Commit (${gitInfo.changed})` : '✔ Commit');
    commitBtn.disabled = busy || !gitInfo.changed;
    commitBtn.title = gitInfo.changed ? 'Degisiklikleri commit et' : 'Commit edilecek degisiklik yok';
    commitBtn.onclick = () => openCommit(project);
    actions.append(commitBtn);

    const hasRemote = gitInfo.remotes.length > 0;
    const upToDate = Boolean(gitInfo.upstream) && gitInfo.ahead === 0;
    const pushBtn = el('button', 'btn', gitInfo.ahead ? `⇡ Push (${gitInfo.ahead})` : '⇡ Push');
    pushBtn.disabled = busy || !hasRemote || upToDate;
    pushBtn.title = !hasRemote
      ? 'Remote tanimli degil'
      : upToDate
        ? 'Gonderilecek commit yok'
        : gitInfo.upstream
          ? `${gitInfo.upstream} dalina gonder`
          : 'Remote\'a gonder (upstream ayarlanir)';
    pushBtn.onclick = () => pushProject(project);
    actions.append(pushBtn);
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

  node.append(headNode({
    collapseKey: card.id,
    favoriteKey: project.id,
    icon: project.icon,
    title: project.name,
    chip: gitChip(project),
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
    chip: gitChip(project),
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
  for (const project of card.children) {
    const item = buildSubItem(project);
    makeChildDraggable(item, project);
    list.append(item);
  }
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

/**
 * Grup, kendisi ya da icindeki herhangi bir uygulama favoriyse favori sayilir.
 * Filtreden bagimsizdir (members), kart bolumu aramayla degismez.
 */
function isFavoriteCard(card) {
  if (state.favorites.has(card.id)) return true;
  return card.kind === 'group' && card.members.some((p) => state.favorites.has(p.id));
}

/** Surukle-birak sirasindaki yeri; elle siralanmamis olanlar sona. */
function orderRank(id) {
  const i = state.orderIndex.get(id);
  return i === undefined ? Infinity : i;
}

/**
 * Alt uygulama sirasi ayri anahtarla tutulur: semsiye klasorun kendi satiri grup kartiyla
 * ayni kimligi tasir; ayni anahtar kullanilsa grup ici siralama grup kartini da kaydirirdi.
 */
const childOrderKey = (id) => `c:${id}`;

/** Once elle verilen sira; sirasi olmayanlar kendi aralarinda `fallback` ile. */
function byManualOrder(fallback, keyOf = (item) => item.id) {
  return (a, b) => {
    const ra = orderRank(keyOf(a));
    const rb = orderRank(keyOf(b));
    if (ra !== rb) return ra < rb ? -1 : 1;
    return fallback(a, b);
  };
}

const compareCards = byManualOrder((a, b) => a.name.localeCompare(b.name, 'tr'));

// Elle siralanmamis alt uygulamalar: favoriler, klasorun kendi start.cmd'si, sonra ad.
const compareChildren = byManualOrder((a, b) => {
  const aFav = state.favorites.has(a.id);
  const bFav = state.favorites.has(b.id);
  if (aFav !== bFav) return aFav ? -1 : 1;
  if (Boolean(a.isGroupRoot) !== Boolean(b.isGroupRoot)) return a.isGroupRoot ? -1 : 1;
  return a.name.localeCompare(b.name, 'tr');
}, (p) => childOrderKey(p.id));

/**
 * Projeleri kartlara donusturur: dogrudan kok altindakiler tekli, ic icedekiler grup.
 * filtered=false iken arama/filtre uygulanmaz; surukle-birak tam listeyi siralar.
 */
function buildCards(filtered = true) {
  const text = filtered ? state.filterText.trim().toLowerCase() : '';
  const matches = (p, groupHit) => !filtered || projectMatches(p, text, groupHit);
  const cards = [];
  const groups = new Map();

  for (const p of state.projects) {
    if (!p.groupId) {
      if (matches(p, false)) cards.push({ kind: 'single', id: p.id, name: p.name, project: p });
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
    g.children = g.members.filter((p) => matches(p, groupHit)).sort(compareChildren);
    if (g.children.length) cards.push(g);
  }

  return cards.sort(compareCards);
}

/** Gorunen kartlar, favoriler ve digerleri olarak iki bolume ayrilmis. */
function visibleSections() {
  const cards = buildCards(true);
  return {
    favorites: cards.filter(isFavoriteCard),
    others: cards.filter((c) => !isFavoriteCard(c))
  };
}

function visibleCards() {
  const { favorites, others } = visibleSections();
  return [...favorites, ...others];
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
 * Kartlari sirayla o an en kisa sutuna yerlestirir. Siralama ust satirlarda korunur,
 * farkli yukseklikteki kartlar arasinda bosluk kalmaz. Bir kartin onune birakilan kart
 * tam olarak onun yerini alir (yerlesim, onceki kartlara gore belirlenir).
 * Kap DOM'a eklenmis olmali; yukseklikler olculur.
 */
function layoutColumns(container, nodes) {
  const cols = Array.from({ length: lastColumnCount }, () => el('div', 'grid-col'));
  container.append(...cols);
  const heights = cols.map(() => 0);

  for (const node of nodes) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].append(node);
    heights[i] = cols[i].offsetHeight;
  }
}

const appCount = (cards) => cards.reduce((n, c) => n + (c.kind === 'group' ? c.children.length : 1), 0);

/** Bolum basligi + sutun kabi. Bos bolum yalnizca surukleme sirasinda birakma alani olarak gorunur. */
function sectionNode(key, title, cards) {
  const section = el('section', `section ${key}`);
  if (!cards.length) section.classList.add('empty');

  const head = el('div', 'section-head');
  head.append(el('h2', 'section-title', title));
  head.append(el('span', 'section-count', String(appCount(cards))));
  section.append(head);

  if (!cards.length) {
    section.append(el('div', 'section-placeholder', key === 'favorites'
      ? '★ Favorilere eklemek icin buraya birak'
      : 'Favorilerden cikarmak icin buraya birak'));
  }
  const grid = el('div', 'section-grid');
  section.append(grid);
  bindSectionDrop(section, key === 'favorites');
  return { section, grid };
}

function buildCardNode(card) {
  const node = card.kind === 'group' ? buildGroupCard(card) : buildSingleCard(card);
  makeCardDraggable(node, card);
  return node;
}

let renderPending = false;

function render() {
  // Surukleme surerken DOM yenilenirse surukleme kopar; birakinca cizilir.
  if (state.drag) {
    renderPending = true;
    return;
  }
  renderPending = false;

  const grid = $('#grid');
  const { favorites, others } = visibleSections();
  const cards = [...favorites, ...others];

  const noProjects = state.projects.length === 0;
  $('#empty').classList.toggle('hidden', !noProjects);
  grid.classList.toggle('hidden', noProjects);

  grid.textContent = '';
  lastColumnCount = columnCount();
  for (const [key, title, list] of [
    ['favorites', '★ Favoriler', favorites],
    ['others', 'Uygulamalar', others]
  ]) {
    const { section, grid: columns } = sectionNode(key, title, list);
    grid.append(section);
    layoutColumns(columns, list.map(buildCardNode));
  }

  const runningCount = state.projects.filter((p) => isRunning(procOf(p.id).status)).length;
  const shown = appCount(cards);

  $('#subtitle').textContent =
    `${state.projects.length} proje bulundu · ${runningCount} calisiyor · ${shown} gosteriliyor`;

  const allCollapsed = cards.length > 0 && cards.every((c) => state.collapsed.has(c.id));
  const collapseAll = $('#btn-collapse-all');
  collapseAll.textContent = allCollapsed ? '▾ Tumunu Genislet' : '▸ Tumunu Daralt';
  collapseAll.dataset.mode = allCollapsed ? 'expand' : 'collapse';

  refreshTypeFilter();
}

/* ------------------------- favori ve daraltma -------------------------- */

function setOrderState(order) {
  state.order = order;
  state.orderIndex = new Map(order.map((id, i) => [id, i]));
}

function applyCardPrefs(cfg) {
  if (!cfg) return;
  state.favorites = new Set(cfg.favorites || []);
  state.collapsed = new Set(cfg.collapsed || []);
  setOrderState(cfg.order || []);
}

async function loadCardPrefs() {
  applyCardPrefs(await guard(api.config.get()));
}

/**
 * Bir listenin (bolum ya da grup ici) yeni sirasini genel siraya yazar; diger listelerin
 * kendi icindeki sirasi korunur, cunku yalnizca ayni listedeki ogeler karsilastirilir.
 * Arayuz aninda guncellenir, sonra main'in dondurdugu config ile esitlenir.
 * @param {string[]} ids listenin yeni sirasi
 * @param {{keys: string[], favorite: boolean}|null} favoriteChange
 */
async function saveOrder(ids, favoriteChange = null) {
  const moved = new Set(ids);
  setOrderState([...state.order.filter((id) => !moved.has(id)), ...ids]);
  if (favoriteChange) {
    for (const key of favoriteChange.keys) {
      if (favoriteChange.favorite) state.favorites.add(key);
      else state.favorites.delete(key);
    }
  }
  render();

  let cfg = await guard(api.config.setOrder(state.order));
  if (cfg && favoriteChange) {
    cfg = await guard(api.config.setFavorites(favoriteChange.keys, favoriteChange.favorite));
  }
  if (cfg) applyCardPrefs(cfg);
  else await loadCardPrefs();
  render();
}

async function saveFavorites(keys, favorite) {
  for (const key of keys) {
    if (favorite) state.favorites.add(key);
    else state.favorites.delete(key);
  }
  render();
  const cfg = await guard(api.config.setFavorites(keys, favorite));
  if (cfg) applyCardPrefs(cfg);
  else await loadCardPrefs();
  render();
}

/**
 * Ust duzey karti bir bolumde hedef kartin onune/arkasina tasir. Bolum degisirse
 * favori durumu da degisir (favoriden cikan grubun alt uygulamalari da cikar).
 * @param {string|null} targetId null ise bolumun sonuna
 */
async function moveCard(dragId, targetId, after, toFavorites) {
  const all = buildCards(false);
  const dragged = all.find((c) => c.id === dragId);
  if (!dragged) return;

  const ids = all.filter((c) => c.id !== dragId && isFavoriteCard(c) === toFavorites).map((c) => c.id);
  const at = targetId ? ids.indexOf(targetId) : -1;
  ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, dragId);

  let favoriteChange = null;
  if (isFavoriteCard(dragged) !== toFavorites) {
    const keys = toFavorites ? [dragId] : [dragId, ...(dragged.members || []).map((p) => p.id)];
    favoriteChange = { keys, favorite: toFavorites };
  }
  await saveOrder(ids, favoriteChange);
}

/** Grup icindeki bir uygulamayi ayni gruptaki hedefin onune/arkasina tasir. */
async function moveChild(groupId, dragId, targetId, after) {
  const group = buildCards(false).find((c) => c.id === groupId);
  if (!group) return;
  const ids = group.children.map((p) => p.id).filter((id) => id !== dragId);
  const at = ids.indexOf(targetId);
  ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, dragId);
  await saveOrder(ids.map(childOrderKey));
}

/** Yildiz: ust duzey kart bolum degistiriyorsa yeni bolumun sonuna gecer. */
async function toggleFavorite(key) {
  const favorite = !state.favorites.has(key);
  const card = buildCards(false).find((c) => c.id === key);
  if (card) {
    const willBeFavorite = favorite ||
      (card.kind === 'group' && card.members.some((p) => state.favorites.has(p.id)));
    if (willBeFavorite !== isFavoriteCard(card)) {
      await moveCard(key, null, false, willBeFavorite);
      return;
    }
  }
  await saveFavorites([key], favorite);
}

/* ---------------------------- surukle-birak ---------------------------- */

function clearDropMarks() {
  for (const node of document.querySelectorAll('.drop-before, .drop-after, .drop-end')) {
    node.classList.remove('drop-before', 'drop-after', 'drop-end');
  }
}

/** Fare hedefin alt yarisindaysa arkasina, ust yarisindaysa onune birakilir. */
function isAfter(e, node) {
  const rect = node.getBoundingClientRect();
  return e.clientY > rect.top + rect.height / 2;
}

function markDrop(e, node) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  const after = isAfter(e, node);
  if (node.classList.contains(after ? 'drop-after' : 'drop-before')) return;
  clearDropMarks();
  node.classList.add(after ? 'drop-after' : 'drop-before');
}

function startDrag(e, info, node) {
  state.drag = info;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', info.id);
  // Surukleme goruntusu alindiktan sonra soluklastir.
  requestAnimationFrame(() => {
    node.classList.add('dragging');
    document.body.classList.add(info.kind === 'card' ? 'dragging-card' : 'dragging-child');
  });
}

function endDrag() {
  state.drag = null;
  clearDropMarks();
  document.body.classList.remove('dragging-card', 'dragging-child');
  for (const node of document.querySelectorAll('.dragging')) node.classList.remove('dragging');
  if (renderPending) render();
}

function makeCardDraggable(node, card) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    if (e.target === node) startDrag(e, { kind: 'card', id: card.id }, node);
  });
  node.addEventListener('dragend', endDrag);
  node.addEventListener('dragover', (e) => {
    if (state.drag?.kind !== 'card') return;
    if (state.drag.id === card.id) {
      // kendi uzerine birakma bolum birakmasina donusmesin
      e.stopPropagation();
      clearDropMarks();
      return;
    }
    markDrop(e, node);
  });
  node.addEventListener('drop', (e) => {
    const drag = state.drag;
    if (drag?.kind !== 'card' || drag.id === card.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = isAfter(e, node);
    endDrag();
    moveCard(drag.id, card.id, after, isFavoriteCard(card));
  });
}

/** Grup icindeki uygulamalar yalnizca kendi gruplari icinde siralanir. */
function makeChildDraggable(node, project) {
  node.draggable = true;
  const sameGroup = () => state.drag?.kind === 'child' && state.drag.groupId === project.groupId;
  node.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    startDrag(e, { kind: 'child', id: project.id, groupId: project.groupId }, node);
  });
  node.addEventListener('dragend', (e) => {
    e.stopPropagation();
    endDrag();
  });
  node.addEventListener('dragover', (e) => {
    if (!sameGroup()) return;
    if (state.drag.id === project.id) {
      e.stopPropagation();
      clearDropMarks();
      return;
    }
    markDrop(e, node);
  });
  node.addEventListener('drop', (e) => {
    const drag = state.drag;
    if (!sameGroup() || drag.id === project.id) return;
    e.preventDefault();
    e.stopPropagation();
    const after = isAfter(e, node);
    endDrag();
    moveChild(project.groupId, drag.id, project.id, after);
  });
}

/** Bolumun bos alanina birakilan kart o bolumun sonuna gecer. */
function bindSectionDrop(section, favorites) {
  section.addEventListener('dragover', (e) => {
    if (state.drag?.kind !== 'card') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (section.classList.contains('drop-end')) return;
    clearDropMarks();
    section.classList.add('drop-end');
  });
  section.addEventListener('drop', (e) => {
    const drag = state.drag;
    if (drag?.kind !== 'card') return;
    e.preventDefault();
    endDrag();
    moveCard(drag.id, null, false, favorites);
  });
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

/* --------------------------------- git --------------------------------- */

const GIT_FOCUS_REFRESH_MS = 15000;
let gitRefreshing = false;
let lastGitRefresh = 0;

async function refreshAllGit() {
  if (gitRefreshing) return;
  gitRefreshing = true;
  try {
    const all = await guard(api.git.statusAll());
    if (all) {
      state.git = all;
      render();
    }
    lastGitRefresh = Date.now();
  } finally {
    gitRefreshing = false;
  }
}

/** Ayni depoyu paylasan kartlari tazeler (ic ice projeler tek depoda olabilir). */
async function refreshGitForRoot(root) {
  if (!root) return;
  const ids = state.projects.filter((p) => state.git[p.id]?.root === root).map((p) => p.id);
  const infos = await Promise.all(ids.map((id) => guard(api.git.status(id))));
  ids.forEach((id, i) => {
    if (infos[i]) state.git[id] = infos[i];
  });
  render();
}

async function applyGitResult(project, res, okMessage) {
  if (res.status) state.git[project.id] = res.status;
  toast(res.ok ? okMessage : res.error, !res.ok);
  await refreshGitForRoot(res.status?.root);
}

let commitTarget = null;

async function openCommit(project) {
  const info = await guard(api.git.status(project.id));
  if (!info) return;
  state.git[project.id] = info;
  render();
  if (!info.isRepo || info.error) {
    toast(info.error || 'Git deposu degil', true);
    return;
  }
  if (!info.changed) {
    toast('Commit edilecek degisiklik yok.');
    return;
  }

  commitTarget = project;
  $('#git-title').textContent = `Commit — ${displayName(project)}`;
  const scope = info.nested ? ` · kapsam yalnizca bu klasor (depo: ${info.root})` : '';
  $('#git-info').textContent = `Dal: ${info.branch} · ${info.changed} degisiklik${scope}`;

  const list = $('#git-files');
  list.textContent = '';
  for (const file of info.files) {
    const li = el('li');
    li.append(el('span', 'git-code', file.code));
    li.append(el('span', null, file.path));
    list.append(li);
  }
  if (info.changed > info.files.length) {
    list.append(el('li', 'muted', `... ve ${info.changed - info.files.length} dosya daha`));
  }

  const pushBox = $('#git-push');
  pushBox.checked = false;
  pushBox.disabled = info.remotes.length === 0;
  $('#git-push-label').title = pushBox.disabled ? 'Remote tanimli degil' : '';
  $('#git-message').value = '';
  $('#git-modal').classList.remove('hidden');
  $('#git-message').focus();
}

function closeCommit() {
  commitTarget = null;
  $('#git-modal').classList.add('hidden');
}

async function submitCommit() {
  if (!commitTarget) return;
  const message = $('#git-message').value.trim();
  if (!message) {
    toast('Commit mesaji yaz.', true);
    $('#git-message').focus();
    return;
  }
  const project = commitTarget;
  const alsoPush = $('#git-push').checked;
  closeCommit();
  openLog(project);
  const res = await guard(api.git.commit(project.id, message, alsoPush));
  if (res) await applyGitResult(project, res, alsoPush ? 'Commit ve push tamam.' : 'Commit tamam.');
}

async function pushProject(project) {
  openLog(project);
  const res = await guard(api.git.push(project.id));
  if (res) await applyGitResult(project, res, 'Push tamam.');
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
  // git durumu kartlari bekletmeden arkadan gelir
  refreshAllGit();
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

  $('#git-cancel').onclick = closeCommit;
  $('#git-commit').onclick = submitCommit;
  $('#git-message').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      submitCommit();
    }
  });

  // Terminalden yapilan commit'ler de yansisin: pencereye donuldugunde tazele.
  window.addEventListener('focus', () => {
    if (Date.now() - lastGitRefresh > GIT_FOCUS_REFRESH_MS) refreshAllGit();
  });

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
      closeCommit();
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
