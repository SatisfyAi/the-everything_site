// ===================== State =====================

const APP_KEY = 'hydrationtracker';
const PRESET_AMOUNTS = [100, 200, 400, 500, 800, 1000];

const state = {
  data: { categories: DEFAULT_CATEGORIES.slice(), entries: [] },
  sha: null,
  dashboard: { period: 'day', offset: 0 },
  editingId: null,
};

let entrySelectedCategory = null;
let entryAmount = null;

// ===================== Init =====================

document.addEventListener('DOMContentLoaded', init);

// Global error reporting (shows file + line number)
window.addEventListener('error', (event) => {
  const file = event.filename || 'unknown file';
  const line = event.lineno || '?';
  const column = event.colno || '?';
  const message = event.message || 'Unknown error';

  console.error(`[${file}:${line}:${column}] ${message}`, event.error);

  try {
    setStatus(
      `Error in ${file} at line ${line}:${column} - ${message}`,
      'error',
    );
  } catch (_) {}
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message =
    reason?.message ||
    (typeof reason === 'string' ? reason : 'Unhandled Promise rejection');

  const stackLine = reason?.stack?.split('\n')?.[1]?.trim() || '';

  console.error('Unhandled Promise Rejection:', reason);

  try {
    setStatus(
      `Unhandled Promise Rejection: ${message}${
        stackLine ? ` (${stackLine})` : ''
      }`,
      'error',
    );
  } catch (_) {}
});

async function init() {
  setupTabs();
  setupSettingsForm();
  setupEntryTab();
  setupDashboardNav();
  setupHistoryTab();
  setupCategoriesTab();
  updateConfigBanner();

  if (ghConfigured(APP_KEY)) {
    setStatus('Loading…', 'busy');
    try {
      await loadFromGitHub();
      setStatus('Synced', 'ok');
    } catch (e) {
      setStatus('Load failed: ' + e.message, 'error');
    }
  }

  renderAll();
}

function updateConfigBanner() {
  const banner = document.getElementById('config-banner');
  banner.hidden = ghConfigured(APP_KEY);
}

// ===================== Date / format helpers =====================

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTimeInputValue(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function cryptoRandomId() {
  if (window.crypto && window.crypto.randomUUID)
    return window.crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// ===================== Status / sync =====================

let statusTimeout;
function setStatus(message, type = 'info') {
  const el = document.getElementById('sync-status');
  el.textContent = message;
  el.className = 'sync-status ' + type;
  clearTimeout(statusTimeout);
  if (type === 'ok') {
    statusTimeout = setTimeout(() => {
      el.textContent = '';
      el.className = 'sync-status';
    }, 3000);
  }
}

function setSettingsStatus(message, isError = false) {
  const el = document.getElementById('settings-status');
  el.textContent = message;
  el.className = isError ? 'settings-status error' : 'settings-status';
}

async function loadFromGitHub() {
  const emptyData = { categories: DEFAULT_CATEGORIES.slice(), entries: [] };
  const { data, sha } = await ghLoad(APP_KEY, emptyData);
  state.data = data;
  state.sha = sha;
  if (!state.data.categories || !state.data.categories.length) {
    state.data.categories = DEFAULT_CATEGORIES.slice();
  }
  if (!state.data.entries) state.data.entries = [];
}

// Merge strategy used after a save conflict: union entries/categories by id/key,
// with local (in-memory) values winning over remote for matching ids/keys.
// Note: if an entry is deleted on one device at the exact moment another device
// pushes an unrelated change, the merge can resurrect the deleted entry. If that
// ever happens, just delete it again.
function mergeData(local, remote) {
  const entryMap = new Map();
  (remote.entries || []).forEach((e) => entryMap.set(e.id, e));
  (local.entries || []).forEach((e) => entryMap.set(e.id, e));

  const catMap = new Map();
  (remote.categories || []).forEach((c) => catMap.set(c.key, c));
  (local.categories || []).forEach((c) => catMap.set(c.key, c));

  return {
    categories: Array.from(catMap.values()),
    entries: Array.from(entryMap.values()),
  };
}

async function trySave(message, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await ghSave(APP_KEY, state.data, state.sha, message);
    } catch (e) {
      if (e.conflict && i < attempts - 1) {
        const fresh = await ghLoad(APP_KEY, {
          categories: DEFAULT_CATEGORIES.slice(),
          entries: [],
        });
        state.data = mergeData(state.data, fresh.data);
        state.sha = fresh.sha;
        continue;
      }
      throw e;
    }
  }
}

// Applies a local mutation, re-renders optimistically, then syncs to GitHub
// (with conflict-merge retries). If GitHub isn't configured, the change is
// kept locally only (in memory for this session).
async function persist(mutateFn, message) {
  mutateFn(state.data);

  if (!ghConfigured(APP_KEY)) {
    setStatus(
      'Not synced - set up GitHub in Settings to save permanently.',
      'warn',
    );
    return;
  }

  setStatus('Saving…', 'busy');
  try {
    state.sha = await trySave(message);
    setStatus('Saved', 'ok');
  } catch (e) {
    setStatus('Save failed: ' + e.message, 'error');
  }
}

// ===================== Tabs =====================

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });
}

function switchTab(tab) {
  document
    .querySelectorAll('.tab-btn')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document
    .querySelectorAll('.tab-panel')
    .forEach((p) => p.classList.toggle('active', p.id === 'tab-' + tab));
}

function renderAll() {
  renderEntryTab();
  renderDashboardTab();
  renderHistoryTab();
  renderCategoriesTab();
}

// ===================== Category picker (shared widget) =====================

function renderCategoryPicker(
  container,
  selectedKey,
  onSelect,
  disabled = false,
) {
  container.innerHTML = '';
  state.data.categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip' + (cat.key === selectedKey ? ' selected' : '');
    btn.style.setProperty('--cat-color', cat.color);
    btn.textContent = cat.label;
    btn.disabled = disabled;
    btn.onclick = () => onSelect(cat.key);
    container.appendChild(btn);
  });
}

// ===================== Add / edit entry tab =====================

function setupEntryTab() {
  document.getElementById('entry-date').valueAsDate = new Date();
  document.getElementById('entry-time').value = toTimeInputValue(new Date());

  renderPresetButtons();

  document.getElementById('entry-amount').addEventListener('input', (e) => {
    entryAmount = e.target.value ? Number(e.target.value) : null;
    updatePresetSelection();
  });

  document.getElementById('entry-save').onclick = saveManualEntry;
  document.getElementById('entry-cancel-edit').onclick = resetEntryForm;
}

function renderPresetButtons() {
  const container = document.getElementById('entry-presets');
  container.innerHTML = '';
  PRESET_AMOUNTS.forEach((amount) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.textContent = `${amount}ml`;
    btn.dataset.amount = String(amount);
    btn.onclick = () => {
      entryAmount = amount;
      document.getElementById('entry-amount').value = amount;
      updatePresetSelection();
    };
    container.appendChild(btn);
  });
}

function updatePresetSelection() {
  document.querySelectorAll('.preset-chip').forEach((btn) => {
    btn.classList.toggle(
      'selected',
      Number(btn.dataset.amount) === entryAmount,
    );
  });
}

function renderEntryTab() {
  if (!entrySelectedCategory && state.data.categories.length) {
    entrySelectedCategory = state.data.categories[0].key;
  }
  renderCategoryPicker(
    document.getElementById('entry-category-picker'),
    entrySelectedCategory,
    (key) => {
      entrySelectedCategory = key;
      renderEntryTab();
    },
  );
}

async function saveManualEntry() {
  const dateStr = document.getElementById('entry-date').value;
  const timeStr = document.getElementById('entry-time').value;
  const amountInput = document.getElementById('entry-amount').value;
  const amount = amountInput ? Number(amountInput) : null;

  if (!dateStr || !timeStr || !entrySelectedCategory) {
    setStatus('Fill in category, date and time.', 'error');
    return;
  }
  if (!amount || amount <= 0) {
    setStatus('Enter an amount greater than 0ml, or pick a preset.', 'error');
    return;
  }

  const when = new Date(`${dateStr}T${timeStr}`);

  if (state.editingId) {
    const id = state.editingId;
    await persist((d) => {
      const idx = d.entries.findIndex((e) => e.id === id);
      if (idx >= 0) {
        d.entries[idx] = {
          id,
          category: entrySelectedCategory,
          date: when.toISOString(),
          amount,
        };
      }
    }, `Edit entry ${id}`);
    resetEntryForm();
  } else {
    const entry = {
      id: cryptoRandomId(),
      category: entrySelectedCategory,
      date: when.toISOString(),
      amount,
    };
    await persist((d) => d.entries.push(entry), `Add entry: ${entry.category}`);

    // Reset amount only, keep category/date/time so logging several drinks in a row is fast.
    entryAmount = null;
    document.getElementById('entry-amount').value = '';
    updatePresetSelection();
    document.getElementById('entry-date').valueAsDate = new Date();
    document.getElementById('entry-time').value = toTimeInputValue(new Date());
  }

  renderDashboardTab();
  renderHistoryTab();
}

function resetEntryForm() {
  state.editingId = null;
  entryAmount = null;
  document.getElementById('entry-save').textContent = 'Save entry';
  document.getElementById('entry-cancel-edit').hidden = true;
  document.getElementById('entry-date').valueAsDate = new Date();
  document.getElementById('entry-time').value = toTimeInputValue(new Date());
  document.getElementById('entry-amount').value = '';
  updatePresetSelection();
}

// ===================== Dashboard tab =====================

function setupDashboardNav() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.onclick = () => {
      state.dashboard.period = btn.dataset.period;
      state.dashboard.offset = 0;
      document
        .querySelectorAll('.period-btn')
        .forEach((b) => b.classList.toggle('active', b === btn));
      renderDashboardTab();
    };
  });

  document.getElementById('dashboard-prev').onclick = () => {
    state.dashboard.offset++;
    renderDashboardTab();
  };
  document.getElementById('dashboard-next').onclick = () => {
    if (state.dashboard.offset > 0) {
      state.dashboard.offset--;
      renderDashboardTab();
    }
  };

  document.getElementById('download-donut').onclick = () => {
    const canvas = document.getElementById('donut-canvas');
    const range = getDashboardRange();
    const slug = range.title
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const link = document.createElement('a');
    link.download = `Hydration-${slug}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
}

// Start-of-period helpers, used for the dashboard range.
function startOfPeriod(date, period) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    d.setDate(d.getDate() - dow);
  } else if (period === 'month') {
    d.setDate(1);
  } else if (period === 'year') {
    d.setMonth(0, 1);
  }
  return d;
}

function addPeriods(date, period, n) {
  const d = new Date(date);
  if (period === 'day') d.setDate(d.getDate() + n);
  else if (period === 'week') d.setDate(d.getDate() + n * 7);
  else if (period === 'month') d.setMonth(d.getMonth() + n);
  else if (period === 'year') d.setFullYear(d.getFullYear() + n);
  return d;
}

// Computes { start, end, title } for the current dashboard period + offset.
// start/end are null for "all" (no date filtering).
function getDashboardRange() {
  const { period, offset } = state.dashboard;

  if (period === 'all') {
    return { start: null, end: null, title: 'All time' };
  }

  const base = startOfPeriod(new Date(), period);
  const start = addPeriods(base, period, -offset);
  const end = addPeriods(start, period, 1);
  return { start, end, title: formatRangeTitle(start, end, period) };
}

function formatRangeTitle(start, end, period) {
  if (period === 'day') {
    return start.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }
  if (period === 'month') {
    return start.toLocaleDateString(undefined, {
      month: 'long',
      year: 'numeric',
    });
  }
  if (period === 'year') {
    return String(start.getFullYear());
  }

  // week: end is exclusive, so the last day shown is end - 1 day
  const lastDay = new Date(end.getTime() - 24 * 3600 * 1000);
  const sameMonth =
    start.getMonth() === lastDay.getMonth() &&
    start.getFullYear() === lastDay.getFullYear();
  const sameYear = start.getFullYear() === lastDay.getFullYear();

  if (sameMonth) {
    return `${start.getDate()} – ${lastDay.getDate()} ${lastDay.toLocaleDateString(undefined, { month: 'long' })} ${lastDay.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${lastDay.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${lastDay.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} – ${lastDay.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function renderDashboardTab() {
  const range = getDashboardRange();

  const totals = {};
  state.data.entries.forEach((e) => {
    const d = new Date(e.date);
    if (range.start && (d < range.start || d >= range.end)) return;
    totals[e.category] = (totals[e.category] || 0) + e.amount;
  });

  const segments = state.data.categories.map((c) => ({
    label: c.label,
    color: c.color,
    value: totals[c.key] || 0,
  }));
  drawDonutChart(document.getElementById('donut-canvas'), {
    title: range.title,
    segments,
  });

  document.getElementById('dashboard-range-label').textContent = range.title;

  const isAll = state.dashboard.period === 'all';
  document.getElementById('dashboard-prev').hidden = isAll;
  document.getElementById('dashboard-next').hidden = isAll;
  if (!isAll) {
    document.getElementById('dashboard-next').disabled =
      state.dashboard.offset === 0;
  }
}

// ===================== History tab =====================

function setupHistoryTab() {
  document.getElementById('history-month-select').onchange = renderHistoryTab;
}

function getMonthsWithData() {
  const months = new Set(
    state.data.entries.map((e) => monthKey(new Date(e.date))),
  );
  months.add(monthKey(new Date()));
  return Array.from(months).sort().reverse();
}

function renderHistoryTab() {
  const monthSelect = document.getElementById('history-month-select');
  const months = getMonthsWithData();
  const current = monthSelect.value || monthKey(new Date());

  monthSelect.innerHTML =
    `<option value="all">All time</option>` +
    months
      .map((m) => `<option value="${m}">${monthLabel(m)}</option>`)
      .join('');
  monthSelect.value = months.includes(current) ? current : 'all';

  const filterMonth = monthSelect.value;
  let entries = [...state.data.entries];
  if (filterMonth !== 'all') {
    entries = entries.filter((e) => monthKey(new Date(e.date)) === filterMonth);
  }
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const catMap = {};
  state.data.categories.forEach((c) => (catMap[c.key] = c));

  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty">No entries for this period.</td></tr>`;
    return;
  }

  entries.forEach((e) => {
    const cat = catMap[e.category] || { label: e.category, color: '#666666' };
    const when = new Date(e.date);

    const tr = document.createElement('tr');

    const dateTd = document.createElement('td');
    dateTd.textContent = when.toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });

    const catTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'cat-badge';
    badge.style.setProperty('--cat-color', cat.color);
    badge.textContent = cat.label;
    catTd.appendChild(badge);

    const timeTd = document.createElement('td');
    timeTd.textContent = when.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });

    const amountTd = document.createElement('td');
    amountTd.textContent = formatMl(e.amount);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = '✎';
    editBtn.onclick = () => editEntry(e.id);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = 'Delete';
    delBtn.textContent = '🗑';
    delBtn.onclick = () => deleteEntry(e.id);

    actionsTd.append(editBtn, delBtn);
    tr.append(dateTd, catTd, timeTd, amountTd, actionsTd);
    tbody.appendChild(tr);
  });
}

function editEntry(id) {
  const e = state.data.entries.find((x) => x.id === id);
  if (!e) return;

  state.editingId = id;
  entrySelectedCategory = e.category;
  entryAmount = e.amount;

  const when = new Date(e.date);

  document.getElementById('entry-date').value = toDateInputValue(when);
  document.getElementById('entry-time').value = toTimeInputValue(when);
  document.getElementById('entry-amount').value = e.amount;
  document.getElementById('entry-save').textContent = 'Update entry';
  document.getElementById('entry-cancel-edit').hidden = false;

  switchTab('entry');
  renderEntryTab();
  updatePresetSelection();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  await persist((d) => {
    d.entries = d.entries.filter((e) => e.id !== id);
  }, `Delete entry ${id}`);
  renderHistoryTab();
  renderDashboardTab();
}

// ===================== Categories tab =====================

function setupCategoriesTab() {
  document.getElementById('add-category-btn').onclick = async () => {
    const labelInput = document.getElementById('new-category-label');
    const colorInput = document.getElementById('new-category-color');
    const label = labelInput.value.trim();
    if (!label) {
      setStatus('Enter a name for the new category.', 'error');
      return;
    }
    const key = categoryKeyFromLabel(
      label,
      state.data.categories.map((c) => c.key),
    );
    await persist(
      (d) => d.categories.push({ key, label, color: colorInput.value }),
      `Add category ${key}`,
    );
    labelInput.value = '';
    renderCategoriesTab();
    renderEntryTab();
  };
}

function renderCategoriesTab() {
  const list = document.getElementById('categories-list');
  list.innerHTML = '';

  state.data.categories.forEach((cat) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.draggable = true;
    row.dataset.key = cat.key;

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';

    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.className = 'cat-color-picker';
    colorPicker.value = cat.color;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'cat-hex-input';
    hexInput.value = cat.color;
    hexInput.maxLength = 7;

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'cat-label-input';
    labelInput.value = cat.label;

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.title = 'Delete category';
    delBtn.textContent = '🗑';

    colorPicker.oninput = () => {
      hexInput.value = colorPicker.value;
      commitCategory(cat.key, { color: colorPicker.value });
    };
    hexInput.onchange = () => {
      const v = hexInput.value.trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
        hexInput.value = cat.color;
        return;
      }
      colorPicker.value = v;
      commitCategory(cat.key, { color: v });
    };
    labelInput.onchange = () => {
      const v = labelInput.value.trim();
      if (v) commitCategory(cat.key, { label: v });
      else labelInput.value = cat.label;
    };
    delBtn.onclick = () => deleteCategory(cat.key);

    // ---- Drag-and-drop reordering ----
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cat.key);
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list
        .querySelectorAll('.category-row')
        .forEach((r) => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list
        .querySelectorAll('.category-row')
        .forEach((r) => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const fromKey = e.dataTransfer.getData('text/plain');
      const toKey = cat.key;
      if (fromKey === toKey) return;
      await persist((d) => {
        const fromIdx = d.categories.findIndex((c) => c.key === fromKey);
        const toIdx = d.categories.findIndex((c) => c.key === toKey);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = d.categories.splice(fromIdx, 1);
        d.categories.splice(toIdx, 0, moved);
      }, `Reorder categories`);
      renderAll();
    });

    row.append(handle, colorPicker, hexInput, labelInput, delBtn);
    list.appendChild(row);
  });
}

async function commitCategory(key, changes) {
  await persist((d) => {
    const c = d.categories.find((c) => c.key === key);
    if (c) Object.assign(c, changes);
  }, `Update category ${key}`);
  renderDashboardTab();
  renderHistoryTab();
  renderEntryTab();
}

async function deleteCategory(key) {
  const cat = state.data.categories.find((c) => c.key === key);
  if (!cat) return;
  const inUse = state.data.entries.some((e) => e.category === key);
  if (inUse) {
    alert(
      `"${cat.label}" is used by existing entries, so it can't be deleted. You can still rename it or change its color.`,
    );
    return;
  }
  if (!confirm(`Delete category "${cat.label}"?`)) return;
  await persist((d) => {
    d.categories = d.categories.filter((c) => c.key !== key);
  }, `Delete category ${key}`);
  renderCategoriesTab();
  renderEntryTab();
}

// ===================== Settings tab =====================

function setupSettingsForm() {
  const s = ghGetSettings(APP_KEY) || {};
  document.getElementById('settings-token').value = s.token || '';
  document.getElementById('settings-owner').value = s.owner || '';
  document.getElementById('settings-repo').value = s.repo || '';
  document.getElementById('settings-path').value =
    s.path || 'hydration-data.json';
  document.getElementById('settings-branch').value = s.branch || 'main';

  document.getElementById('settings-save').onclick = async () => {
    const settings = {
      token: document.getElementById('settings-token').value.trim(),
      owner: document.getElementById('settings-owner').value.trim(),
      repo: document.getElementById('settings-repo').value.trim(),
      path:
        document.getElementById('settings-path').value.trim() ||
        'hydration-data.json',
      branch: document.getElementById('settings-branch').value.trim() || 'main',
    };
    if (!settings.token || !settings.owner || !settings.repo) {
      setSettingsStatus('Token, owner and repo are required.', true);
      return;
    }
    ghSaveSettings(APP_KEY, settings);
    updateConfigBanner();
    setSettingsStatus('Testing connection…');
    try {
      await ghTestConnection(APP_KEY);
      setSettingsStatus('Connected - loading data…');
      await loadFromGitHub();
      setSettingsStatus('Connected and synced.');
      setStatus('Synced', 'ok');
      renderAll();
    } catch (e) {
      setSettingsStatus('Error: ' + e.message, true);
    }
  };

  document.getElementById('settings-reload').onclick = async () => {
    setSettingsStatus('Reloading…');
    try {
      await loadFromGitHub();
      setSettingsStatus('Reloaded from GitHub.');
      setStatus('Synced', 'ok');
      renderAll();
    } catch (e) {
      setSettingsStatus('Error: ' + e.message, true);
    }
  };

  document.getElementById('config-banner-link').onclick = () =>
    switchTab('settings');
}
