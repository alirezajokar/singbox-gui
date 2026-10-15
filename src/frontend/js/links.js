// Share links (vless://, vmess://, trojan://, ss://, hysteria2://, tuic://)
// -> sing-box outbounds. Pure functions, no DOM.

import { uniqueTag } from './util.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// base64 helpers (standard and url-safe, padding optional)
// ---------------------------------------------------------------------------

export function b64decode(input) {
  let s = String(input).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

export function b64encode(text) {
  const bytes = enc.encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function looksBase64(s) {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(s.replace(/\s+/g, '')) && s.replace(/\s+/g, '').length >= 8;
}

function dc(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

class LinkError extends Error {}

function fail(msg) {
  throw new LinkError(msg);
}

/** Split "scheme://userinfo@host:port?query#fragment" without trusting URL() for odd schemes. */
function split(link) {
  const m = /^([a-z0-9+.-]+):\/\/(?:([^@/?#]*)@)?(\[[^\]]+\]|[^:/?#]*)(?::(\d+))?(?:\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/i.exec(link.trim());
  if (!m) fail('bad-link');
  const params = new URLSearchParams(m[5] || '');
  return {
    scheme: m[1].toLowerCase(),
    userinfo: m[2] === undefined ? '' : m[2],
    host: m[3].replace(/^\[|\]$/g, ''),
    port: m[4] ? Number(m[4]) : 0,
    params,
    name: m[6] ? dc(m[6]) : '',
  };
}

const truthy = (v) => v === '1' || v === 'true' || v === 'True';

function listOf(v) {
  return v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : [];
}

function buildTls(p, host, { force = false, security } = {}) {
  const sec = security !== undefined ? security : p.get('security') || '';
  if (!force && sec !== 'tls' && sec !== 'reality') return null;
  const tls = { enabled: true };
  const sni = p.get('sni') || p.get('peer') || p.get('serverName') || '';
  if (sni) tls.server_name = sni;
  else if (host && !/^[\d.]+$/.test(host) && !host.includes(':')) tls.server_name = host;
  if (truthy(p.get('allowInsecure')) || truthy(p.get('insecure')) || truthy(p.get('allow_insecure'))) tls.insecure = true;
  const alpn = listOf(p.get('alpn'));
  if (alpn.length) tls.alpn = alpn;
  const fp = p.get('fp');
  if (fp) tls.utls = { enabled: true, fingerprint: fp };
  if (sec === 'reality') {
    tls.reality = { enabled: true, public_key: p.get('pbk') || '', short_id: p.get('sid') || '' };
    if (!tls.utls) tls.utls = { enabled: true, fingerprint: 'chrome' };
  }
  return tls;
}

function buildTransport(kind, { path, host, service, mode } = {}) {
  switch ((kind || 'tcp').toLowerCase()) {
    case 'tcp':
    case 'raw':
    case '':
    case 'none':
      return null;
    case 'ws': {
      const t = { type: 'ws', path: path || '/' };
      if (host) t.headers = { Host: host };
      return t;
    }
    case 'grpc': {
      const t = { type: 'grpc' };
      if (service || path) t.service_name = service || path;
      return t;
    }
    case 'httpupgrade': {
      const t = { type: 'httpupgrade', path: path || '/' };
      if (host) t.host = host;
      return t;
    }
    case 'h2':
    case 'http': {
      const t = { type: 'http', path: path || '/' };
      if (host) t.host = listOf(host);
      return t;
    }
    default:
      return fail(`unsupported-transport:${kind}`);
  }
}

function transportFromParams(p) {
  const kind = p.get('type') || 'tcp';
  return buildTransport(kind, {
    path: p.get('path') ? dc(p.get('path')) : '',
    host: p.get('host') || '',
    service: p.get('serviceName') || p.get('service_name') || '',
  });
}

function finish(o, name, taken) {
  const base = (name || '').replace(/[\r\n]+/g, ' ').trim() || `${o.type}-${o.server}`;
  o.tag = uniqueTag(base, taken);
  return o;
}

// ---------------------------------------------------------------------------
// per-protocol parsers
// ---------------------------------------------------------------------------

function parseVless(link) {
  const u = split(link);
  if (!u.userinfo || !u.host || !u.port) fail('bad-link');
  const o = { type: 'vless', tag: '', server: u.host, server_port: u.port, uuid: dc(u.userinfo) };
  const flow = u.params.get('flow');
  if (flow) o.flow = flow;
  const tls = buildTls(u.params, u.host);
  if (tls) o.tls = tls;
  const tr = transportFromParams(u.params);
  if (tr) o.transport = tr;
  const pe = u.params.get('packetEncoding');
  if (pe) o.packet_encoding = pe;
  return { outbound: o, name: u.name };
}

function parseVmess(link) {
  const body = link.trim().replace(/^vmess:\/\//i, '');
  let j;
  try {
    j = JSON.parse(b64decode(body));
  } catch {
    // some apps use the vless-like URL form for vmess
    const u = split(link);
    if (!u.userinfo || !u.host || !u.port) fail('bad-link');
    const o = { type: 'vmess', tag: '', server: u.host, server_port: u.port, uuid: dc(u.userinfo), security: u.params.get('encryption') || 'auto' };
    const tls = buildTls(u.params, u.host);
    if (tls) o.tls = tls;
    const tr = transportFromParams(u.params);
    if (tr) o.transport = tr;
    return { outbound: o, name: u.name };
  }
  if (!j.add || !j.port || !j.id) fail('bad-link');
  const o = {
    type: 'vmess',
    tag: '',
    server: String(j.add),
    server_port: Number(j.port),
    uuid: String(j.id),
    security: j.scy || 'auto',
    alter_id: Number(j.aid) || 0,
  };
  const p = new URLSearchParams();
  if (j.sni) p.set('sni', j.sni);
  if (j.alpn) p.set('alpn', j.alpn);
  if (j.fp) p.set('fp', j.fp);
  const tls = buildTls(p, o.server, { security: j.tls === 'tls' ? 'tls' : '' });
  if (tls) o.tls = tls;
  const tr = buildTransport(j.net, { path: j.path || '', host: j.host || '', service: j.path || '' });
  if (tr) o.transport = tr;
  return { outbound: o, name: j.ps || '' };
}

function parseTrojan(link) {
  const u = split(link);
  if (!u.userinfo || !u.host || !u.port) fail('bad-link');
  const o = { type: 'trojan', tag: '', server: u.host, server_port: u.port, password: dc(u.userinfo) };
  // trojan is TLS by default unless explicitly security=none
  const sec = u.params.get('security');
  const tls = buildTls(u.params, u.host, { force: sec !== 'none', security: sec || 'tls' });
  if (tls) o.tls = tls;
  const tr = transportFromParams(u.params);
  if (tr) o.transport = tr;
  return { outbound: o, name: u.name };
}

function parseShadowsocks(link) {
  // ss://BASE64(method:password)@host:port#name   (SIP002)
  // ss://BASE64(method:password@host:port)#name   (legacy)
  const raw = link.trim().replace(/^ss:\/\//i, '');
  const hashAt = raw.indexOf('#');
  const name = hashAt >= 0 ? dc(raw.slice(hashAt + 1)) : '';
  let body = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  let query = '';
  const qAt = body.indexOf('?');
  if (qAt >= 0) {
    query = body.slice(qAt + 1);
    body = body.slice(0, qAt);
  }
  body = body.replace(/\/$/, '');

  let method;
  let password;
  let host;
  let port;
  const at = body.lastIndexOf('@');
  if (at >= 0) {
    const cred = body.slice(0, at);
    const hp = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(body.slice(at + 1));
    if (!hp) fail('bad-link');
    host = hp[1].replace(/^\[|\]$/g, '');
    port = Number(hp[2]);
    let decoded = cred;
    if (!cred.includes(':')) decoded = b64decode(cred);
    else decoded = dc(cred);
    const i = decoded.indexOf(':');
    if (i < 0) fail('bad-link');
    method = decoded.slice(0, i);
    password = decoded.slice(i + 1);
  } else {
    const decoded = b64decode(body);
    const m = /^([^:]+):(.*)@(\[[^\]]+\]|[^:@]+):(\d+)$/s.exec(decoded);
    if (!m) fail('bad-link');
    method = m[1];
    password = m[2];
    host = m[3].replace(/^\[|\]$/g, '');
    port = Number(m[4]);
  }
  const o = { type: 'shadowsocks', tag: '', server: host, server_port: port, method, password };
  const warnings = [];
  const q = new URLSearchParams(query);
  if (q.get('plugin')) warnings.push('ss-plugin');
  return { outbound: o, name, warnings };
}

function parseHysteria2(link) {
  const u = split(link);
  if (!u.host) fail('bad-link');
  const o = { type: 'hysteria2', tag: '', server: u.host, server_port: u.port || 443, password: dc(u.userinfo) };
  const tls = buildTls(u.params, u.host, { force: true });
  if (tls) o.tls = tls;
  const obfs = u.params.get('obfs');
  if (obfs) o.obfs = { type: obfs, password: u.params.get('obfs-password') || '' };
  const warnings = [];
  if (u.params.get('mport')) warnings.push('port-hopping');
  return { outbound: o, name: u.name, warnings };
}

function parseTuic(link) {
  const u = split(link);
  if (!u.host || !u.port) fail('bad-link');
  const [uuid, ...pw] = dc(u.userinfo).split(':');
  const o = { type: 'tuic', tag: '', server: u.host, server_port: u.port, uuid, password: pw.join(':') };
  const cc = u.params.get('congestion_control');
  if (cc) o.congestion_control = cc;
  const um = u.params.get('udp_relay_mode');
  if (um) o.udp_relay_mode = um;
  const tls = buildTls(u.params, u.host, { force: true });
  if (tls) o.tls = tls;
  return { outbound: o, name: u.name };
}

const PARSERS = {
  vless: parseVless,
  vmess: parseVmess,
  trojan: parseTrojan,
  ss: parseShadowsocks,
  hysteria2: parseHysteria2,
  hy2: parseHysteria2,
  tuic: parseTuic,
};

export const SUPPORTED_SCHEMES = Object.keys(PARSERS);

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** Parse one link. Returns { ok, outbound, warnings } or { ok:false, error }. */
export function parseLink(link, takenTags = []) {
  const scheme = /^([a-z0-9+.-]+):\/\//i.exec(link.trim());
  if (!scheme) return { ok: false, error: 'bad-link', link };
  const fn = PARSERS[scheme[1].toLowerCase()];
  if (!fn) return { ok: false, error: `unsupported-scheme:${scheme[1].toLowerCase()}`, link };
  try {
    const { outbound, name, warnings = [] } = fn(link);
    return { ok: true, outbound: finish(outbound, name, takenTags), warnings };
  } catch (e) {
    if (e instanceof LinkError) return { ok: false, error: e.message, link };
    return { ok: false, error: 'bad-link', link };
  }
}

/**
 * Parse pasted text: one link per line, or a base64 subscription blob.
 * Returns { outbounds, errors, warnings } with tags made unique.
 */
export function parseLinks(text, existingTags = []) {
  let body = String(text || '').trim();
  if (body && !body.includes('://') && looksBase64(body)) {
    try {
      body = b64decode(body);
    } catch {
      /* fall through: it will simply yield no links */
    }
  }
  const taken = new Set(existingTags);
  const outbounds = [];
  const errors = [];
  const warnings = [];
  for (const line of body.split(/[\r\n]+/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const r = parseLink(l, taken);
    if (r.ok) {
      taken.add(r.outbound.tag);
      outbounds.push(r.outbound);
      for (const w of r.warnings) warnings.push({ tag: r.outbound.tag, warning: w });
    } else {
      errors.push({ link: l, error: r.error });
    }
  }
  return { outbounds, errors, warnings };
}

/** One-line description of an outbound for lists: "vless · reality · ws". */
export function describeOutbound(o) {
  const bits = [o.type];
  if (o.tls && o.tls.reality && o.tls.reality.enabled) bits.push('reality');
  else if (o.tls && o.tls.enabled) bits.push('tls');
  if (o.transport && o.transport.type) bits.push(o.transport.type);
  return bits.join(' · ');
}

export function endpointOf(o) {
  if (o.server) return `${o.server}${o.server_port ? `:${o.server_port}` : ''}`;
  if (Array.isArray(o.outbounds)) return `${o.outbounds.length}`;
  return '';
}
