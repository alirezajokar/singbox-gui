// Bridge to the TinyJS backend. Outside the app (plain browser: design work,
// screenshots, tests) it falls back to an in-memory mock so the UI still runs.

const native = typeof window !== 'undefined' && window.tiny && window.tiny.api;
export const isNative = !!native;

let mockPromise = null;
function mock() {
  mockPromise = mockPromise || import('./mock.js');
  return mockPromise;
}

export async function call(name, params = {}) {
  if (native) return window.tiny.api.call(name, params);
  const m = await mock();
  return m.call(name, params);
}

// ---------------------------------------------------------------------------
// persistent preferences (tiny.store in the app, localStorage in a browser)
// ---------------------------------------------------------------------------

export const storage = {
  async get(key, fallback = null) {
    try {
      if (native && window.tiny.store) {
        const v = await window.tiny.store.get(key);
        return v === undefined || v === null ? fallback : v;
      }
      const raw = localStorage.getItem(`sbgui:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    try {
      if (native && window.tiny.store) await window.tiny.store.set(key, value);
      else localStorage.setItem(`sbgui:${key}`, JSON.stringify(value));
    } catch {
      /* preferences are best-effort */
    }
  },
};

// ---------------------------------------------------------------------------
// files & links
// ---------------------------------------------------------------------------

export async function openExternal(url) {
  if (native && window.tiny.app && window.tiny.app.shell) return window.tiny.app.shell.open(url);
  window.open(url, '_blank', 'noopener');
  return true;
}

export async function revealPath(path) {
  if (native && window.tiny.app && window.tiny.app.shell) return window.tiny.app.shell.reveal(path);
  return false;
}

/** Ask the user for a file and return { name, text } (or null). */
export async function pickTextFile(types = ['json']) {
  if (native && window.tiny.dialog) {
    const path = await window.tiny.dialog.openFile({ types });
    if (!path) return null;
    const text = await call('file.read', { path });
    return { name: path.split('/').pop(), text };
  }
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = types.map((x) => `.${x}`).join(',');
    el.onchange = async () => {
      const f = el.files && el.files[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    el.click();
  });
}

/** Save text to a user-chosen file. Returns the path (or true in a browser). */
export async function saveTextFile(name, text) {
  if (native && window.tiny.dialog) {
    const path = await window.tiny.dialog.saveFile({ name: name.replace(/\.[^.]+$/, ''), types: [name.split('.').pop()] });
    if (!path) return null;
    await call('file.write', { path, text });
    return path;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function copyText(text) {
  try {
    if (native && window.tiny.clipboard) {
      await window.tiny.clipboard.write({ text });
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboardText() {
  try {
    if (native && window.tiny.clipboard && window.tiny.clipboard.read) {
      const c = await window.tiny.clipboard.read();
      return (c && c.text) || '';
    }
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

export function systemPrefersDark() {
  return !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
}
