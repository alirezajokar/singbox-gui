// Tiny dependency-free helpers shared by every module.
// This file (and the other pure modules) must stay free of DOM and `tiny`
// access so they can be unit-tested with plain Node.

/** Deep clone of JSON-compatible data. */
export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** JSON.stringify with sorted keys: a stable signature for comparing values. */
export function stable(v) {
  return JSON.stringify(sortKeys(v));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function arr(v) {
  return Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
}

/** Split free text into clean unique tokens (newline, comma, space, semicolon). */
export function tokens(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text ?? '').split(/[\s,;،]+/)) {
    const t = raw.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Pick `keys` out of an object into a new one (only the present ones). */
export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Copy of obj without `keys`. */
export function omit(obj, keys) {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out[k] = obj[k];
  return out;
}

/** Return a tag that is not in `taken`, derived from `base` ("proxy", "proxy-2", …). */
export function uniqueTag(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  const root = String(base || 'item').trim() || 'item';
  if (!set.has(root)) return root;
  for (let i = 2; ; i++) {
    const t = `${root}-${i}`;
    if (!set.has(t)) return t;
  }
}

let idCounter = 0;
export function uid(prefix = 'id') {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter}`;
}

/** Compare dotted versions: returns -1 / 0 / 1. Missing parts count as 0. */
export function cmpVersion(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** "3d 4h", "12m 05s" … from seconds. `units` swaps the letters (and `digits` the numerals) for another language. */
export function formatDuration(sec, units = { d: 'd', h: 'h', m: 'm', s: 's' }, digits = String) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const two = (n) => digits(units.pad === false ? n : String(n).padStart(2, '0'));
  const sep = units.sep === undefined ? ' ' : units.sep;
  if (d) return `${digits(d)}${units.d}${sep}${digits(h)}${units.h}`;
  if (h) return `${digits(h)}${units.h}${sep}${two(m)}${units.m}`;
  if (m) return `${digits(m)}${units.m}${sep}${two(s)}${units.s}`;
  return `${digits(s)}${units.s}`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
