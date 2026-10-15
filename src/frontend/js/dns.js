// DNS servers <-> friendly editor model.
//
// sing-box >= 1.12 describes servers as { type, tag, server, server_port, ... }.
// Older configs use { tag, address: "tls://1.1.1.1" }. We read both, and always
// write the modern form (saving a legacy server converts it).

import { isObj, omit } from './util.js';

export const DNS_TYPES = ['udp', 'tcp', 'tls', 'https', 'quic', 'h3', 'local', 'dhcp', 'fakeip'];

export const DEFAULT_PORTS = { udp: 53, tcp: 53, tls: 853, https: 443, quic: 853, h3: 443 };

const NEEDS_SERVER = new Set(['udp', 'tcp', 'tls', 'https', 'quic', 'h3']);
const HAS_PATH = new Set(['https', 'h3']);

export function needsServer(type) {
  return NEEDS_SERVER.has(type);
}

export function hasPath(type) {
  return HAS_PATH.has(type);
}

// ---------------------------------------------------------------------------
// legacy "address" parsing
// ---------------------------------------------------------------------------

function parseLegacyAddress(address) {
  const a = String(address || '').trim();
  if (!a) return null;
  if (a === 'local') return { type: 'local' };
  if (a === 'fakeip') return { type: 'fakeip' };
  if (a.startsWith('rcode://')) return null;
  if (/^dhcp:\/\//.test(a)) return { type: 'dhcp', rest: a.slice(7) && a.slice(7) !== 'auto' ? { interface: a.slice(7) } : {} };
  const m = /^(?:(udp|tcp|tls|https|quic|h3):\/\/)?(\[[^\]]+\]|[^/:?#]+)(?::(\d+))?(\/[^?#]*)?$/i.exec(a);
  if (!m) return null;
  return {
    type: (m[1] || 'udp').toLowerCase(),
    server: m[2].replace(/^\[|\]$/g, ''),
    port: m[3] ? Number(m[3]) : undefined,
    path: m[4] || undefined,
  };
}

// ---------------------------------------------------------------------------
// server -> model
// ---------------------------------------------------------------------------

/**
 * model = { tag, type, server, port, path, detour, resolver, legacy, advanced, rest }
 * `advanced` servers (hosts, tailscale, rcode, …) are shown read-only.
 */
export function serverToModel(s) {
  if (!isObj(s)) return { tag: '', type: 'udp', advanced: true, rest: {}, raw: s };

  // modern
  if (s.type) {
    const known = DNS_TYPES.includes(s.type);
    const m = {
      tag: s.tag || '',
      type: s.type,
      server: s.server || '',
      port: s.server_port || '',
      path: s.path || '',
      detour: s.detour || '',
      resolver: typeof s.domain_resolver === 'string' ? s.domain_resolver : '',
      legacy: false,
      advanced: !known,
      rest: omit(s, ['type', 'tag', 'server', 'server_port', 'path', 'detour', ...(typeof s.domain_resolver === 'string' ? ['domain_resolver'] : [])]),
    };
    return m;
  }

  // legacy
  const parsed = parseLegacyAddress(s.address);
  if (!parsed) {
    return { tag: s.tag || '', type: 'udp', advanced: true, legacy: true, rest: {}, raw: s };
  }
  return {
    tag: s.tag || '',
    type: parsed.type,
    server: parsed.server || '',
    port: parsed.port || '',
    path: parsed.path || '',
    detour: s.detour || '',
    resolver: s.address_resolver || '',
    legacy: true,
    advanced: false,
    rest: {
      ...(parsed.rest || {}),
      ...omit(s, ['tag', 'address', 'detour', 'address_resolver', 'address_strategy', 'strategy', 'client_subnet']),
    },
  };
}

// ---------------------------------------------------------------------------
// model -> server
// ---------------------------------------------------------------------------

export function modelToServer(m) {
  if (m.advanced && m.raw) return m.raw;
  const o = { type: m.type, tag: m.tag };
  if (needsServer(m.type)) {
    o.server = String(m.server || '').trim();
    const port = Number(m.port);
    if (port && port !== DEFAULT_PORTS[m.type]) o.server_port = port;
    if (hasPath(m.type)) {
      const path = String(m.path || '').trim();
      if (path && path !== '/dns-query') o.path = path.startsWith('/') ? path : `/${path}`;
    }
  }
  if (m.detour) o.detour = m.detour;
  if (m.resolver) o.domain_resolver = m.resolver;
  for (const [k, v] of Object.entries(m.rest || {})) if (!(k in o)) o[k] = v;
  if (m.type === 'fakeip' && !o.inet4_range && !o.inet6_range) o.inet4_range = '198.18.0.0/15';
  return o;
}

export function emptyServerModel(type = 'udp') {
  return { tag: '', type, server: '', port: '', path: '', detour: '', resolver: '', legacy: false, advanced: false, rest: {} };
}

/** "tls://1.1.1.1:853" style one-liner for lists. */
export function describeServer(m) {
  if (m.advanced) return m.raw && m.raw.address ? String(m.raw.address) : m.type;
  if (!needsServer(m.type)) return m.type === 'dhcp' ? 'dhcp' : m.type;
  const port = m.port ? `:${m.port}` : '';
  const path = hasPath(m.type) && m.path && m.path !== '/dns-query' ? m.path : '';
  return `${m.type}://${m.server}${port}${path}`;
}

/** Is this server's host a name (needs a bootstrap resolver) rather than an IP? */
export function hostNeedsResolver(m) {
  if (!needsServer(m.type) || !m.server) return false;
  return !/^[\d.]+$/.test(m.server) && !m.server.includes(':');
}

// ---------------------------------------------------------------------------
// handy presets for the "quick add" chips
// ---------------------------------------------------------------------------

export const DNS_PRESETS = [
  { id: 'local', tag: 'local', type: 'local' },
  { id: 'google', tag: 'google', type: 'udp', server: '8.8.8.8' },
  { id: 'google-doh', tag: 'google-doh', type: 'https', server: '8.8.8.8' },
  { id: 'cloudflare', tag: 'cloudflare', type: 'udp', server: '1.1.1.1' },
  { id: 'cloudflare-doh', tag: 'cloudflare-doh', type: 'https', server: '1.1.1.1' },
  { id: 'quad9', tag: 'quad9-doh', type: 'https', server: '9.9.9.9' },
  { id: 'adguard', tag: 'adguard', type: 'udp', server: '94.140.14.14' },
  { id: 'shecan', tag: 'shecan', type: 'udp', server: '178.22.122.100' },
  { id: 'electro', tag: 'electro', type: 'udp', server: '78.157.42.100' },
  { id: '403', tag: '403-online', type: 'udp', server: '10.202.10.202' },
];

export function presetToModel(p) {
  return { ...emptyServerModel(p.type), tag: p.tag, server: p.server || '' };
}
