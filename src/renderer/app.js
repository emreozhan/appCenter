'use strict';

const api = window.appCenter;

const state = {
  projects: [],
  procs: {},
  filterText: '',
  filterStatus: 'all',
  filterType: 'all',
  activeLog: null,
  showHidden: false
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

/* -------------------------------- kartlar ------------------------------- */

function buildCard(project) {
  const proc = procOf(project.id);
  const busy = Boolean(proc.task);

  const card = el('article', 'card');
  card.classList.add(busy ? 'busy' : proc.status);
  card.dataset.id = project.id;

  /* baslik */
  const head = el('div', 'card-head');
  head.append(el('span', 'card-icon', project.icon || '\u{1F4E6}'));

  const titleBox = el('div');
  titleBox.style.minWidth = '0';
  titleBox.append(el('div', 'card-title', project.name));
  titleBox.append(el('div', 'card-sub', project.path));
  head.append(titleBox);

  const status = el('div', 'status');
  status.append(el('span', `dot ${busy ? 'busy' : proc.status}`));
  status.append(el('span', null, busy ? proc.taskLabel : STATUS_LABEL[proc.status] || proc.status));
  head.append(status);
  card.append(head);

  /* rozetler */
  const badges = el('div', 'badges');
  badges.append(el('span', 'badge', project.typeLabel));
  if (project.customized) badges.append(el('span', 'badge custom', 'ozel komut'));
  if (project.needsInstall) badges.append(el('span', 'badge warn', 'kurulum gerekli'));
  if (project.hidden) badges.append(el('span', 'badge', 'gizli'));
  if (proc.url) {
    const b = el('span', 'badge', proc.url.replace(/^https?:\/\//, ''));
    badges.append(b);
  }
  card.append(badges);

  if (project.description) card.append(el('div', 'desc', project.description));
  card.append(el('div', 'cmd', project.start ? `▶ ${project.start}` : 'Calistirma komutu tanimli degil'));

  /* butonlar */
  const actions = el('div', 'card-actions');
  const running = proc.status === 'running' || proc.status === 'starting';

  const runBtn = el('button', `btn ${running ? 'danger' : 'primary'}`, running ? '■ Durdur' : '▶ Baslat');
  runBtn.disabled = !running && !project.start;
  runBtn.onclick = () => guard(running ? api.proc.stop(project.id) : api.proc.start(project.id));
  actions.append(runBtn);

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

  card.append(actions);
  return card;
}

function visibleProjects() {
  const text = state.filterText.trim().toLowerCase();
  return state.projects.filter((p) => {
    if (p.hidden && !state.showHidden) return false;
    if (state.filterType !== 'all' && p.type !== state.filterType) return false;

    const st = procOf(p.id).status;
    if (state.filterStatus === 'running' && !(st === 'running' || st === 'starting')) return false;
    if (state.filterStatus === 'stopped' && (st === 'running' || st === 'starting')) return false;

    if (!text) return true;
    return (
      p.name.toLowerCase().includes(text) ||
      p.path.toLowerCase().includes(text) ||
      (p.typeLabel || '').toLowerCase().includes(text) ||
      (p.description || '').toLowerCase().includes(text)
    );
  });
}

function render() {
  const grid = $('#grid');
  grid.textContent = '';
  const items = visibleProjects();

  for (const project of items) grid.append(buildCard(project));

  const noProjects = state.projects.length === 0;
  $('#empty').classList.toggle('hidden', !noProjects);
  grid.classList.toggle('hidden', noProjects);

  const runningCount = state.projects.filter((p) => {
    const s = procOf(p.id).status;
    return s === 'running' || s === 'starting';
  }).length;

  $('#subtitle').textContent =
    `${state.projects.length} proje bulundu · ${runningCount} calisiyor · ${items.length} gosteriliyor`;

  refreshTypeFilter();
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
  $('#log-title').textContent = `Log — ${project.name}`;
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
  $('#settings-title').textContent = `Ayarlar — ${project.name}`;
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
