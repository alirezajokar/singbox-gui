// Application state: settings, service status, the config draft, and the
// actions that load / save them. Pages read `state` and call these functions.

import * as api from './api.js';
import { setLang, t } from './i18n.js';
import { clone, stable, cmpVersion } from './util.js';
import { parseConfig, serialize, starterConfig, loadDraft, compileDraft, validateRefs } from './config.js';

export const DEFAULT_SETTINGS = {
  lang: 'fa',
  theme: 'dark', // dark | light | system
  unit: 'sing-box.service',
  configPath: '/etc/sing-box/config.json',
  restart: 'auto', // auto | yes | no
};

export const state = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  info: null,
  status: null,
  statusError: null,
  draft: null, // editable config (with private rule annotations)
  rawText: '', // what is on disk, as text
  loadError: '', // JSON problem in the file on disk
  fileExists: true,
  savedKey: '',
  busy: '', // '' | 'start' | 'stop' | 'restart' | 'save' …
  lastCheck: null, // { ok, output, at }
  readResult: null, // last cfg.read answer
};

// ---------------------------------------------------------------------------
// tiny event bus
// ---------------------------------------------------------------------------

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(kind) {
  for (const fn of listeners) fn(kind);
}

// ---------------------------------------------------------------------------
// derived
// ---------------------------------------------------------------------------

function keyOf(draft) {
  if (!draft) return '';
  const { config, meta } = compileDraft(draft);
  return stable({ config, meta });
}

export function isDirty() {
  return !!state.draft && keyOf(state.draft) !== state.savedKey;
}

export function singboxVersion() {
  return (state.info && state.info.singbox && state.info.singbox.version) || '';
}

/** True when the installed sing-box is older than `v` (false if unknown). */
export function versionBelow(v) {
  const cur = singboxVersion();
  return !!cur && cmpVersion(cur, v) < 0;
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export async function loadSettings() {
  const saved = await api.storage.get('settings', {});
  state.settings = { ...DEFAULT_SETTINGS, ...saved };
  applyAppearance();
}

export async function updateSettings(patch) {
  const prevPath = state.settings.configPath;
  const prevUnit = state.settings.unit;
  state.settings = { ...state.settings, ...patch };
  await api.storage.set('settings', state.settings);
  applyAppearance();
  emit('settings');
  if (patch.configPath !== undefined && patch.configPath !== prevPath) await loadConfig();
  if (patch.unit !== undefined && patch.unit !== prevUnit) {
    await refreshInfo();
    await refreshStatus();
  }
}

export function applyAppearance() {
  setLang(state.settings.lang);
  const theme = state.settings.theme === 'system' ? (api.systemPrefersDark() ? 'dark' : 'light') : state.settings.theme;
  document.documentElement.dataset.theme = theme;
}

// ---------------------------------------------------------------------------
// service
// ---------------------------------------------------------------------------

export async function refreshInfo() {
  try {
    state.info = await api.call('sys.info', { unit: state.settings.unit });
  } catch {
    state.info = null;
  }
  emit('info');
}

export async function refreshStatus() {
  try {
    state.status = await api.call('svc.status', { unit: state.settings.unit });
    state.statusError = null;
  } catch (e) {
    state.statusError = String((e && e.message) || e);
  }
  emit('status');
  return state.status;
}

/** start | stop | restart | enable | disable | reset-failed */
export async function serviceDo(action) {
  state.busy = action;
  emit('busy');
  try {
    const r = await api.call('svc.do', { unit: state.settings.unit, action });
    if (r.status) {
      state.status = r.status;
    }
    return r;
  } catch (e) {
    return { ok: false, reason: 'failed', message: String((e && e.message) || e) };
  } finally {
    state.busy = '';
    emit('status');
    emit('busy');
  }
}

let timer = null;
export function startPolling(ms = 3000) {
  stopPolling();
  timer = setInterval(() => {
    if (!document.hidden && !state.busy) refreshStatus();
  }, ms);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshStatus();
  });
}
export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

async function loadMeta() {
  return api.storage.get(`meta:${state.settings.configPath}`, {});
}

export async function loadConfig() {
  state.loadError = '';
  let r;
  try {
    r = await api.call('cfg.read', { path: state.settings.configPath, unit: state.settings.unit });
  } catch (e) {
    r = { ok: false, reason: 'failed', message: String((e && e.message) || e) };
  }
  state.readResult = r;
  if (!r.ok) {
    state.draft = null;
    state.rawText = '';
    state.fileExists = true;
    state.loadError = r.reason === 'denied' ? 'denied' : r.message || r.reason || 'failed';
    state.savedKey = '';
    emit('config');
    return;
  }
  state.fileExists = !!r.exists;
  state.rawText = r.text || '';
  if (!r.exists) {
    state.draft = loadDraft(starterConfig(), null);
    state.savedKey = ''; // brand new → dirty until saved
    emit('config');
    return;
  }
  const parsed = parseConfig(r.text);
  if (!parsed.ok) {
    state.draft = null;
    state.loadError = parsed.error;
    state.savedKey = '';
    emit('config');
    return;
  }
  state.draft = loadDraft(parsed.value, await loadMeta());
  state.savedKey = keyOf(state.draft);
  emit('config');
}

/** Change the draft. `fn(draft)` mutates it in place. */
export function mutate(fn) {
  if (!state.draft) return;
  fn(state.draft);
  emit('draft');
}

export function replaceDraft(draft) {
  state.draft = draft;
  emit('draft');
  emit('config');
}

/** Replace the draft from raw JSON text (Advanced page). Returns { ok, error }. */
export async function applyRawText(text) {
  const parsed = parseConfig(text);
  if (!parsed.ok) return parsed;
  const meta = state.draft ? compileDraft(state.draft).meta : await loadMeta();
  state.loadError = '';
  state.draft = loadDraft(parsed.value, meta);
  emit('draft');
  emit('config');
  return { ok: true };
}

export function discard() {
  return loadConfig();
}

/** Dangling references in what would be written (sing-box check does not see them). */
export function findProblems() {
  return state.draft ? validateRefs(compileDraft(state.draft).config) : [];
}

/** Current draft as the exact text that would be written. */
export function currentText() {
  return state.draft ? serialize(compileDraft(state.draft).config) : state.rawText;
}

export async function checkNow(text = currentText()) {
  try {
    const r = await api.call('cfg.check', { text });
    state.lastCheck = { ok: !!r.ok, output: r.output || '', skipped: !!r.skipped, at: Date.now() };
  } catch (e) {
    state.lastCheck = { ok: false, output: String((e && e.message) || e), at: Date.now() };
  }
  emit('check');
  return state.lastCheck;
}

/**
 * Save the draft: validate, write (asking for a password if needed) and restart
 * the service when it is running. Returns the backend result plus `ok`.
 */
export async function saveConfig() {
  if (!state.draft) return { ok: false, stage: 'parse', message: t('err.no-draft') };
  const { config, meta } = compileDraft(state.draft);
  const text = serialize(config);
  state.busy = 'save';
  emit('busy');
  try {
    const r = await api.call('cfg.write', {
      path: state.settings.configPath,
      unit: state.settings.unit,
      text,
      restart: state.settings.restart,
    });
    if (r.ok) {
      state.savedKey = stable({ config, meta });
      state.rawText = text;
      state.fileExists = true;
      state.loadError = '';
      await api.storage.set(`meta:${state.settings.configPath}`, meta);
      if (r.status) state.status = r.status;
      state.lastCheck = { ok: true, output: '', skipped: !!r.checkSkipped, at: Date.now() };
    }
    return r;
  } catch (e) {
    return { ok: false, stage: 'write', reason: 'failed', message: String((e && e.message) || e) };
  } finally {
    state.busy = '';
    emit('busy');
    emit('status');
    emit('draft');
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

export async function boot() {
  await loadSettings();
  // first run: ask the service where its config really is
  const known = await api.storage.get('configDetected', false);
  await refreshInfo();
  if (!known) {
    try {
      const d = await api.call('cfg.detect', { unit: state.settings.unit });
      if (d.found && d.candidates[0]) state.settings.configPath = d.candidates[0];
      await api.storage.set('settings', state.settings);
    } catch {
      /* keep the default path */
    }
    await api.storage.set('configDetected', true);
  }
  await Promise.all([refreshStatus(), loadConfig()]);
  state.ready = true;
  startPolling();
  emit('ready');
}

export function cloneDraft() {
  return clone(state.draft);
}
