// Singbox GUI — backend (txiki.js).
//
// The page holds all the configuration logic; the backend is deliberately thin.
// It only does the things a web page cannot: talk to systemd, read/write the
// sing-box config file, and ask for root through the polkit helper.

import { run, exists, firstExisting, errorCode, LONG_TIMEOUT } from './exec.js';

const APP_VERSION = '0.2.2';
const HELPER_INSTALLED = '/usr/lib/singbox-gui/helper';
const POLKIT_RULE = '/etc/polkit-1/rules.d/49-singbox-gui.rules';
const MAX_BACKUPS = 40;

const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function unitOf(p) {
  const u = String((p && p.unit) || 'sing-box.service');
  return /^[A-Za-z0-9@_.:-]+$/.test(u) && !u.startsWith('-') ? u : 'sing-box.service';
}

async function helperPath() {
  const env = tjs.env.SINGBOX_GUI_HELPER;
  return firstExisting([env, HELPER_INSTALLED, tjs.cwd + '/packaging/singbox-gui-helper']);
}

/** Run the polkit helper as root (asks for a password through the desktop). */
async function priv(args, opts = {}) {
  const helper = await helperPath();
  if (!helper) {
    return { ok: false, code: 127, reason: 'no-helper', message: 'helper-missing', stdout: '', stderr: '' };
  }
  const r = await run(['pkexec', helper, ...args], { timeout: LONG_TIMEOUT, ...opts });
  let reason = '';
  if (r.missing) reason = 'no-pkexec';
  else if (r.timedOut) reason = 'timeout';
  else if (r.code === 126 || r.code === 127) reason = 'denied';
  return { ...r, reason, message: (r.stderr || r.stdout || '').trim() };
}

function parseKV(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

async function singboxBinary() {
  const r = await run(['sh', '-c', 'command -v sing-box']);
  const path = r.ok ? r.stdout.trim().split('\n')[0] : '';
  if (!path) return { path: '', version: '' };
  const v = await run([path, 'version']);
  const m = /version\s+(\S+)/.exec(v.stdout);
  return { path, version: m ? m[1] : '' };
}

async function status(unit) {
  const props = 'LoadState,ActiveState,SubState,UnitFileState,ActiveEnterTimestamp,MainPID,MemoryCurrent,Result,NRestarts';
  let r = await run(['systemctl', 'show', unit, '--timestamp=unix', '-p', props]);
  if (!r.ok && /unrecognized|invalid option|unknown/i.test(r.stderr)) {
    r = await run(['systemctl', 'show', unit, '-p', props]);
  }
  if (r.missing) return { available: false, loaded: false, active: false, state: 'unavailable' };
  const kv = parseKV(r.stdout);
  const since = /^@(\d+)/.exec(kv.ActiveEnterTimestamp || '');
  const mem = Number(kv.MemoryCurrent);
  return {
    available: true,
    loaded: kv.LoadState === 'loaded',
    state: kv.ActiveState || 'unknown', // active | inactive | failed | activating | deactivating
    sub: kv.SubState || '',
    active: kv.ActiveState === 'active',
    enabled: kv.UnitFileState === 'enabled' || kv.UnitFileState === 'enabled-runtime',
    unitFileState: kv.UnitFileState || '',
    since: since ? Number(since[1]) : 0,
    pid: Number(kv.MainPID) || 0,
    memory: Number.isFinite(mem) && mem > 0 && mem < 2 ** 53 ? mem : 0,
    result: kv.Result || '',
    restarts: Number(kv.NRestarts) || 0,
  };
}

function tmpDir(app) {
  return (app && app.paths && app.paths.temp) || '/tmp';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function readTextFile(path) {
  return dec.decode(await tjs.readFile(path));
}

async function isWritable(path) {
  try {
    const f = await tjs.open(path, 'r+');
    await f.close();
    return true;
  } catch {
    return false;
  }
}

/** Run `sing-box check` on a text as the current user. */
async function checkConfig(text, app) {
  const bin = await singboxBinary();
  if (!bin.path) return { ok: true, skipped: true, output: '' };
  const tmp = `${tmpDir(app)}/singbox-gui-check-${tjs.pid}-${Date.now()}.json`;
  try {
    await tjs.writeFile(tmp, text, { mode: 0o600 });
    const r = await run([bin.path, 'check', '-c', tmp], { timeout: 20000 });
    const output = (r.stderr + r.stdout).replaceAll(tmp, '<config>').trim();
    // Permission problems (root-only certificates etc.) are not config errors;
    // the root-side check in the helper decides those.
    const permission = /permission denied|operation not permitted/i.test(output);
    return { ok: r.ok, output, permission, skipped: false };
  } finally {
    await tjs.remove(tmp).catch(() => {});
  }
}

async function saveBackup(app, text) {
  const dir = app.paths.data + '/backups';
  await tjs.makeDir(dir, { recursive: true });
  await tjs.writeFile(`${dir}/${stamp()}.json`, text, { mode: 0o600 });
  // keep the newest MAX_BACKUPS
  const names = [];
  for await (const e of await tjs.readDir(dir)) if (e.name.endsWith('.json')) names.push(e.name);
  names.sort();
  for (const old of names.slice(0, Math.max(0, names.length - MAX_BACKUPS))) {
    await tjs.remove(`${dir}/${old}`).catch(() => {});
  }
}

function privFailure(r) {
  if (r.reason === 'no-helper') return { reason: 'no-helper' };
  if (r.reason === 'no-pkexec') return { reason: 'no-pkexec' };
  if (r.reason === 'denied') return { reason: 'denied' };
  if (r.reason === 'timeout') return { reason: 'timeout' };
  return { reason: 'failed', message: r.message };
}

// ---------------------------------------------------------------------------
// API (called from the page with tiny.api.call(name, params))
// ---------------------------------------------------------------------------

export const api = {
  'sys.info': async (p, app) => {
    const unit = unitOf(p);
    const [bin, helper, pkexec, st] = await Promise.all([
      singboxBinary(),
      helperPath(),
      run(['sh', '-c', 'command -v pkexec']),
      status(unit),
    ]);
    return {
      appVersion: APP_VERSION,
      user: tjs.system.userInfo.userName,
      home: app.paths.home,
      dataDir: app.paths.data,
      singbox: bin,
      helper: helper || '',
      helperInstalled: helper === HELPER_INSTALLED,
      pkexec: pkexec.ok,
      unitFound: st.loaded,
      systemd: st.available,
    };
  },

  'svc.status': async (p) => status(unitOf(p)),

  'svc.do': async (p) => {
    const unit = unitOf(p);
    const action = String(p.action);
    const r = await priv(['service', action, unit]);
    if (!r.ok) return { ok: false, ...privFailure(r) };
    // give systemd a moment so the page sees the final state
    await new Promise((res) => setTimeout(res, action === 'start' || action === 'restart' ? 900 : 250));
    const st = await status(unit);
    let logs = '';
    if ((action === 'start' || action === 'restart') && !st.active) {
      const l = await run(['journalctl', '-u', unit, '-n', '15', '--no-pager', '-o', 'cat']);
      logs = l.stdout.trim();
    }
    return { ok: true, status: st, logs };
  },

  'cfg.read': async (p) => {
    const path = String(p.path);
    try {
      const text = await readTextFile(path);
      return { ok: true, exists: true, text, writable: await isWritable(path), viaHelper: false };
    } catch (e) {
      const code = errorCode(e);
      if (code === 'ENOENT') return { ok: true, exists: false, text: '', writable: false };
      if (code === 'EACCES' || code === 'EPERM') {
        const r = await priv(['read', path, unitOf(p)]);
        if (r.ok) return { ok: true, exists: true, text: r.stdout, writable: false, viaHelper: true };
        return { ok: false, ...privFailure(r) };
      }
      return { ok: false, reason: 'failed', message: String((e && e.message) || e) };
    }
  },

  'cfg.check': async ({ text }, app) => checkConfig(String(text), app),

  /**
   * Validate, back up, write and (optionally) restart.
   * params: { path, unit, text, restart: 'auto'|'yes'|'no' }
   */
  'cfg.write': async (p, app) => {
    const path = String(p.path);
    const unit = unitOf(p);
    const text = String(p.text);
    try {
      JSON.parse(text);
    } catch (e) {
      return { ok: false, stage: 'parse', message: String(e.message || e) };
    }

    const chk = await checkConfig(text, app);
    if (!chk.ok && !chk.permission) return { ok: false, stage: 'check', message: chk.output };

    // keep a copy of what is on disk right now
    let previous = null;
    try {
      previous = await readTextFile(path);
    } catch {
      previous = null; // unreadable or missing — the helper keeps a .bak anyway
    }
    if (previous !== null && previous !== text) await saveBackup(app, previous).catch(() => {});

    const before = await status(unit);
    const wantRestart = p.restart === 'yes' || (p.restart !== 'no' && before.active);

    // Try the plain write first (works when the file or its folder belongs to
    // the user). A permission problem means we need root: go through the helper.
    let wrote = false;
    try {
      await tjs.writeFile(path, text);
      wrote = true;
    } catch (e) {
      if (!['EACCES', 'EPERM', 'ENOENT', 'EROFS'].includes(errorCode(e))) {
        return { ok: false, stage: 'write', reason: 'failed', message: String((e && e.message) || e) };
      }
    }

    if (wrote) {
      if (wantRestart) {
        const r = await priv(['service', 'restart', unit]);
        if (!r.ok) return { ok: false, stage: 'restart', ...privFailure(r) };
      }
    } else {
      const tmp = `${tmpDir(app)}/singbox-gui-write-${tjs.pid}-${Date.now()}.json`;
      await tjs.writeFile(tmp, text, { mode: 0o600 });
      try {
        const r = await priv(['write', path, unit, wantRestart ? 'restart' : 'keep'], { stdinFile: tmp });
        if (!r.ok) {
          if (r.code === 3) return { ok: false, stage: 'check', message: r.message };
          if (r.code === 4) return { ok: false, stage: 'restart', reason: 'failed', message: r.message };
          return { ok: false, stage: 'write', ...privFailure(r) };
        }
      } finally {
        await tjs.remove(tmp).catch(() => {});
      }
    }

    await new Promise((res) => setTimeout(res, wantRestart ? 900 : 0));
    const after = await status(unit);
    let logs = '';
    if (wantRestart && !after.active) {
      const l = await run(['journalctl', '-u', unit, '-n', '15', '--no-pager', '-o', 'cat']);
      logs = l.stdout.trim();
    }
    return { ok: true, restarted: wantRestart, status: after, logs, checkSkipped: !!chk.skipped };
  },

  'logs.get': async (p) => {
    const unit = unitOf(p);
    const lines = Math.max(10, Math.min(1000, Number(p.lines) || 200));
    let r = await run(['journalctl', '-u', unit, '-n', String(lines), '--no-pager', '-o', 'short-iso'], { timeout: 10000 });
    const denied = /insufficient permissions|not seeing messages|No journal files/i.test(r.stdout + r.stderr);
    if ((!r.ok || denied) && p.allowPrompt) {
      const pr = await priv(['logs', unit, String(lines)]);
      if (pr.ok) return { ok: true, text: pr.stdout, viaHelper: true };
      return { ok: false, ...privFailure(pr) };
    }
    if (denied) return { ok: false, reason: 'permission', text: '' };
    return { ok: r.ok, text: r.stdout, message: r.ok ? '' : r.stderr.trim() };
  },

  /** Find the config file the service really uses (ExecStart -c / -C). */
  'cfg.detect': async (p) => {
    const unit = unitOf(p);
    const r = await run(['systemctl', 'show', '-p', 'ExecStart', '--value', unit]);
    const tokens = r.stdout.split(/[\s;]+/).filter(Boolean);
    const files = [];
    const dirs = [];
    tokens.forEach((t, i) => {
      if ((t === '-c' || t === '--config') && tokens[i + 1]) files.push(tokens[i + 1]);
      if ((t === '-C' || t === '--config-directory') && tokens[i + 1]) dirs.push(tokens[i + 1]);
    });
    const candidates = [...files];
    for (const d of dirs) {
      try {
        const found = [];
        for await (const e of await tjs.readDir(d)) if (e.name.endsWith('.json')) found.push(`${d.replace(/\/$/, '')}/${e.name}`);
        found.sort((a, b) => (a.endsWith('/config.json') ? -1 : 0) - (b.endsWith('/config.json') ? -1 : 0));
        candidates.push(...found);
        if (!found.length) candidates.push(`${d.replace(/\/$/, '')}/config.json`);
      } catch {
        candidates.push(`${d.replace(/\/$/, '')}/config.json`);
      }
    }
    if (!candidates.length) candidates.push('/etc/sing-box/config.json');
    return { candidates: [...new Set(candidates)], found: files.length + dirs.length > 0 };
  },

  'backup.list': async (p, app) => {
    const dir = app.paths.data + '/backups';
    const items = [];
    try {
      for await (const e of await tjs.readDir(dir)) {
        if (!e.name.endsWith('.json')) continue;
        const st = await tjs.stat(`${dir}/${e.name}`);
        items.push({ name: e.name, size: st.size });
      }
    } catch {
      /* no backups yet */
    }
    items.sort((a, b) => (a.name < b.name ? 1 : -1));
    return items;
  },

  'backup.read': async ({ name }, app) => {
    if (!/^[0-9]{8}-[0-9]{6}\.json$/.test(String(name))) throw new Error('bad backup name');
    return readTextFile(`${app.paths.data}/backups/${name}`);
  },

  /** Is the "no password" polkit rule installed? */
  'priv.get': async () => ({ passwordless: await exists(POLKIT_RULE) }),

  'priv.set': async ({ on }) => {
    const r = await priv(['passwordless', on ? 'on' : 'off']);
    if (!r.ok) return { ok: false, ...privFailure(r) };
    return { ok: true, passwordless: await exists(POLKIT_RULE) };
  },

  /** Export / import use native dialogs from the page; these two do the file IO. */
  'file.write': async ({ path, text }) => {
    await tjs.writeFile(String(path), String(text));
    return true;
  },
  'file.read': async ({ path }) => readTextFile(String(path)),
};

export function init() {
  // nothing to start: the page drives everything
}
