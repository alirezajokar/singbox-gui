// Ready-made rules and rule-sets, so the common cases are one click.

import { emptyModel } from './rules.js';
import { outboundChoices, ruleSets } from './config.js';

// ---------------------------------------------------------------------------
// rule-sets (the .srs lists published by the sing-box authors)
// ---------------------------------------------------------------------------

const BASE = {
  geosite: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-',
  geoip: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-',
};

export function ruleSetUrl(kind, name) {
  return `${BASE[kind]}${name}.srs`;
}

/** A remote, binary rule-set entry for route.rule_set. */
export function remoteRuleSet(kind, name, { detour = '' } = {}) {
  const o = {
    type: 'remote',
    tag: `${kind}-${name}`,
    format: 'binary',
    url: ruleSetUrl(kind, name),
    update_interval: '7d',
  };
  if (detour) o.download_detour = detour;
  return o;
}

/** Popular lists shown as one-click chips (all verified to exist). */
export const RULE_SET_CATALOG = [
  { kind: 'geosite', name: 'category-ir', group: 'iran' },
  { kind: 'geoip', name: 'ir', group: 'iran' },
  { kind: 'geosite', name: 'category-ads-all', group: 'ads' },
  { kind: 'geosite', name: 'openai', group: 'ai' },
  { kind: 'geosite', name: 'anthropic', group: 'ai' },
  { kind: 'geosite', name: 'google', group: 'services' },
  { kind: 'geosite', name: 'youtube', group: 'services' },
  { kind: 'geosite', name: 'telegram', group: 'services' },
  { kind: 'geosite', name: 'github', group: 'services' },
  { kind: 'geosite', name: 'netflix', group: 'services' },
  { kind: 'geosite', name: 'spotify', group: 'services' },
  { kind: 'geosite', name: 'apple', group: 'services' },
  { kind: 'geosite', name: 'microsoft', group: 'services' },
  { kind: 'geosite', name: 'twitter', group: 'services' },
  { kind: 'geosite', name: 'instagram', group: 'services' },
  { kind: 'geosite', name: 'whatsapp', group: 'services' },
  { kind: 'geosite', name: 'cn', group: 'china' },
  { kind: 'geoip', name: 'cn', group: 'china' },
  { kind: 'geoip', name: 'ru', group: 'other' },
  { kind: 'geoip', name: 'tr', group: 'other' },
  { kind: 'geoip', name: 'us', group: 'other' },
];

/** Add a rule-set to the draft if its tag is not there yet. Returns the tag. */
export function addRuleSet(cfg, spec) {
  cfg.route = cfg.route || {};
  if (!Array.isArray(cfg.route.rule_set)) cfg.route.rule_set = [];
  if (!cfg.route.rule_set.some((r) => r.tag === spec.tag)) cfg.route.rule_set.push(spec);
  return spec.tag;
}

// ---------------------------------------------------------------------------
// inbound presets (how applications reach sing-box)
// ---------------------------------------------------------------------------

export const INBOUND_PRESETS = [
  { id: 'mixed', build: () => ({ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }) },
  { id: 'tun', build: () => ({ type: 'tun', tag: 'tun-in', address: ['172.19.0.1/30'], auto_route: true, strict_route: true, stack: 'mixed' }) },
  { id: 'socks', build: () => ({ type: 'socks', tag: 'socks-in', listen: '127.0.0.1', listen_port: 1080 }) },
  { id: 'http', build: () => ({ type: 'http', tag: 'http-in', listen: '127.0.0.1', listen_port: 8080 }) },
];

// ---------------------------------------------------------------------------
// outbound picking helpers
// ---------------------------------------------------------------------------

export function pickDirect(cfg) {
  const c = outboundChoices(cfg);
  const d = c.find((o) => o.type === 'direct');
  return d ? d.tag : 'direct';
}

/** The most likely "proxy" target: a group called proxy/select, else any non-direct outbound. */
export function pickProxy(cfg) {
  const c = outboundChoices(cfg).filter((o) => !['direct', 'block', 'dns'].includes(o.type));
  const named = c.find((o) => /^(proxy|select|auto|main)/i.test(o.tag));
  return (named || c[0] || { tag: '' }).tag;
}

// ---------------------------------------------------------------------------
// route rule templates
// ---------------------------------------------------------------------------

function model(cond, action, name = '') {
  const m = emptyModel({ kind: 'route' });
  m.name = name;
  m.conds = cond;
  m.action = action;
  return m;
}

/**
 * Templates for the "add rule" gallery. `build(cfg)` returns
 *   { model, ruleSets: [specs to add] }
 * `needsProxy` marks templates whose target outbound the user will usually
 * want to review (it is pre-filled with the best guess).
 */
export const ROUTE_TEMPLATES = [
  {
    id: 'sniff',
    icon: 'eye',
    build: () => ({ model: model([], { type: 'sniff' }) }),
  },
  {
    id: 'hijack-dns',
    icon: 'dns',
    build: () => ({ model: model([{ type: 'protocol', values: ['dns'] }], { type: 'hijack-dns' }) }),
  },
  {
    id: 'private-direct',
    icon: 'home',
    build: (cfg) => ({
      model: model([{ type: 'ip_is_private', values: [] }], { type: 'route', outbound: pickDirect(cfg) }),
    }),
  },
  {
    id: 'ir-tld-direct',
    icon: 'flag',
    build: (cfg) => ({
      model: model([{ type: 'tld', values: ['.ir'] }], { type: 'route', outbound: pickDirect(cfg) }),
    }),
  },
  {
    id: 'ir-lists-direct',
    icon: 'flag',
    build: (cfg) => ({
      model: model(
        [{ type: 'rule_set', values: ['geosite-category-ir', 'geoip-ir'] }],
        { type: 'route', outbound: pickDirect(cfg) },
      ),
      ruleSets: [remoteRuleSet('geosite', 'category-ir'), remoteRuleSet('geoip', 'ir')],
    }),
  },
  {
    id: 'ads-block',
    icon: 'shield',
    build: () => ({
      model: model([{ type: 'rule_set', values: ['geosite-category-ads-all'] }], { type: 'reject' }),
      ruleSets: [remoteRuleSet('geosite', 'category-ads-all')],
    }),
  },
  {
    id: 'ai-proxy',
    icon: 'spark',
    needsProxy: true,
    build: (cfg) => ({
      model: model(
        [{ type: 'rule_set', values: ['geosite-openai', 'geosite-anthropic'] }],
        { type: 'route', outbound: pickProxy(cfg) },
      ),
      ruleSets: [remoteRuleSet('geosite', 'openai'), remoteRuleSet('geosite', 'anthropic')],
    }),
  },
  {
    id: 'telegram-proxy',
    icon: 'send',
    needsProxy: true,
    build: (cfg) => ({
      model: model([{ type: 'rule_set', values: ['geosite-telegram'] }], { type: 'route', outbound: pickProxy(cfg) }),
      ruleSets: [remoteRuleSet('geosite', 'telegram')],
    }),
  },
  {
    id: 'quic-block',
    icon: 'ban',
    build: () => ({ model: model([{ type: 'protocol', values: ['quic'] }], { type: 'reject' }) }),
  },
  {
    id: 'torrent-direct',
    icon: 'download',
    build: (cfg) => ({
      model: model([{ type: 'protocol', values: ['bittorrent'] }], { type: 'route', outbound: pickDirect(cfg) }),
    }),
  },
];

/** Which rule-set tags a model refers to that the draft does not define yet. */
export function missingRuleSets(cfg, m) {
  const have = new Set(ruleSets(cfg).map((r) => r.tag));
  const out = [];
  for (const c of m.conds) if (c.type === 'rule_set') for (const t of c.values) if (!have.has(t)) out.push(t);
  return out;
}

/** Turn a tag like "geosite-openai" into a rule-set spec we know how to download. */
export function ruleSetFromTag(tag) {
  const m = /^(geosite|geoip)-(.+)$/.exec(tag);
  return m ? remoteRuleSet(m[1], m[2]) : null;
}
