// Thin wrapper around the GitHub Contents API.
// Reads/writes a single JSON file (settings.path) in settings.owner/settings.repo.
//
// Namespaced by `appKey` so multiple apps on the same hub (Time Tracker,
// Hydration Tracker, ...) can each have their own localStorage settings,
// even though they may point at the same repo with different file paths.

function ghSettingsKey(appKey) {
  return `gh_settings_${appKey}`;
}

function ghGetSettings(appKey) {
  try {
    return JSON.parse(localStorage.getItem(ghSettingsKey(appKey))) || null;
  } catch {
    return null;
  }
}

function ghSaveSettings(appKey, settings) {
  localStorage.setItem(ghSettingsKey(appKey), JSON.stringify(settings));
}

function ghConfigured(appKey) {
  const s = ghGetSettings(appKey);
  return !!(s && s.token && s.owner && s.repo && s.path);
}

function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUnicode(str) {
  return decodeURIComponent(escape(atob(str)));
}

function ghApiUrl(s) {
  const branch = s.branch ? `?ref=${encodeURIComponent(s.branch)}` : '';
  return `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${s.path}${branch}`;
}

async function ghRequest(appKey, url, options = {}) {
  const s = ghGetSettings(appKey);
  if (!s || !s.token) throw new Error('GitHub is not configured yet.');
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${s.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  return res;
}

// Loads the data file. Returns { data, sha }.
// If the file doesn't exist yet, returns `emptyData` (a fresh structure) with sha = null.
async function ghLoad(appKey, emptyData) {
  const s = ghGetSettings(appKey);
  if (!s) throw new Error('GitHub is not configured yet.');
  const res = await ghRequest(appKey, ghApiUrl(s));

  if (res.status === 404) {
    return { data: emptyData, sha: null };
  }
  if (!res.ok) {
    throw new Error(`GitHub load failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const content = JSON.parse(b64DecodeUnicode(json.content.replace(/\n/g, '')));
  return { data: content, sha: json.sha };
}

// Saves the data file. Returns the new sha.
// Throws an Error with `.conflict = true` if the remote file has changed
// since `sha` was fetched (HTTP 409 or 422 sha mismatch).
async function ghSave(appKey, data, sha, message) {
  const s = ghGetSettings(appKey);
  if (!s) throw new Error('GitHub is not configured yet.');

  const body = {
    message: message || 'Update data',
    content: b64EncodeUnicode(JSON.stringify(data, null, 2)),
    branch: s.branch || undefined,
  };
  if (sha) body.sha = sha;

  const res = await ghRequest(appKey, ghApiUrl(s), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 409 || res.status === 422) {
    const err = new Error('GitHub save conflict: file changed remotely.');
    err.conflict = true;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `GitHub save failed: ${res.status} ${res.statusText} ${text}`,
    );
  }
  const json = await res.json();
  return json.content.sha;
}

// Tests credentials by fetching basic repo info.
async function ghTestConnection(appKey) {
  const s = ghGetSettings(appKey);
  if (!s) throw new Error('GitHub is not configured yet.');
  const res = await ghRequest(
    appKey,
    `https://api.github.com/repos/${s.owner}/${s.repo}`,
  );
  if (!res.ok) {
    throw new Error(`Could not access repo: ${res.status} ${res.statusText}`);
  }
  return true;
}
