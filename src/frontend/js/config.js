// The sing-box configuration "draft": parse, query, rename tags safely,
// and turn the draft back into the JSON that goes to disk.
//
// While editing, individual rules may carry two private annotations that never
// reach sing-box's own file:
//   __name  a friendly label the user gave the rule
//   __off   the rule is switched off (kept in the app's own metadata)

import { clone, stable, isObj, arr } from './util.js';

export const SCOPES = ['route', 'dns'];

// ---------------------------------------------------------------------------
// parse / serialize
// ---------------------------------------------------------------------------

export function parseConfig(text) {
  try {
    const value = JSON.parse(text);
    if (!isObj(value)) return { ok: false, error: 'The config must be a JSON object.' };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export function serialize(cfg) {
  return JSON.stringify(cfg, null, 2) + '\n';
}

/** A friendly starting point when no config file exists yet. */
export function starterConfig() {
  return {
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { type: 'local', tag: 'local' },
      ],
      final: 'local',
    },
    inbounds: [
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
    ],
    outbounds: [{ type: 'direct', tag: 'direct' }],
    route: {
      rules: [{ action: 'sniff' }, { protocol: 'dns', action: 'hijack-dns' }],
      final: 'direct',
      auto_detect_interface: true,
      default_domain_resolver: 'local',
    },
  };
}

// ---------------------------------------------------------------------------
// private annotations
// ---------------------------------------------------------------------------

export function isPrivateKey(k) {
  return k.startsWith('__');
}

export function stripPrivate(rule) {
  const out = {};
  for (const k of Object.keys(rule)) if (!isPrivateKey(k)) out[k] = rule[k];
  return out;
}

export function ruleSig(rule) {
  return stable(stripPrivate(rule));
}

export function getRules(cfg, scope) {
  const holder = cfg && cfg[scope];
  return holder && Array.isArray(holder.rules) ? holder.rules : null;
}

/** Config JSON + stored metadata  ->  editable draft. */
export function loadDraft(cfg, meta) {
  const d = clone(cfg);
  for (const scope of SCOPES) {
    const m = (meta && meta[scope]) || {};
    const rules = getRules(d, scope);
    if (rules) {
      for (const r of rules) {
        if (!isObj(r)) continue;
        const n = m.names && m.names[ruleSig(r)];
        if (n) r.__name = n;
      }
    }
    const off = Array.isArray(m.disabled) ? [...m.disabled].sort((a, b) => a.at - b.at) : [];
    if (off.length) {
      if (!isObj(d[scope])) d[scope] = {};
      if (!Array.isArray(d[scope].rules)) d[scope].rules = [];
      for (const item of off) {
        if (!isObj(item.rule)) continue;
        const r = { ...item.rule, __off: true };
        if (item.name) r.__name = item.name;
        d[scope].rules.splice(Math.min(Math.max(0, item.at | 0), d[scope].rules.length), 0, r);
      }
    }
  }
  return d;
}

/** Draft -> { config: JSON for sing-box, meta: what the app remembers }. */
export function compileDraft(draft) {
  const config = clone(draft);
  const meta = {};
  for (const scope of SCOPES) {
    const rules = getRules(config, scope);
    meta[scope] = { names: {}, disabled: [] };
    if (!rules) continue;
    const keep = [];
    rules.forEach((r, idx) => {
      if (!isObj(r)) {
        keep.push(r);
        return;
      }
      const clean = stripPrivate(r);
      if (r.__off) meta[scope].disabled.push({ rule: clean, at: idx, name: r.__name || '' });
      else {
        keep.push(clean);
        if (r.__name) meta[scope].names[ruleSig(clean)] = r.__name;
      }
    });
    config[scope].rules = keep;
  }
  return { config, meta };
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

export function outbounds(cfg) {
  return arr(cfg.outbounds).filter(isObj);
}

export function endpoints(cfg) {
  return arr(cfg.endpoints).filter(isObj);
}

/** Everything a rule can send traffic to: outbounds + endpoints (WireGuard…). */
export function outboundChoices(cfg) {
  return [...outbounds(cfg), ...endpoints(cfg)].filter((o) => o.tag).map((o) => ({ tag: o.tag, type: o.type }));
}

export function dnsServers(cfg) {
  return arr(cfg.dns && cfg.dns.servers).filter(isObj);
}

export function ruleSets(cfg) {
  return arr(cfg.route && cfg.route.rule_set).filter(isObj);
}

export function inbounds(cfg) {
  return arr(cfg.inbounds).filter(isObj);
}

/** Does any inbound use TUN? (drives hints such as "hijack DNS") */
export function hasTun(cfg) {
  return inbounds(cfg).some((i) => i.type === 'tun');
}

// ---------------------------------------------------------------------------
// reference check
// ---------------------------------------------------------------------------

/**
 * `sing-box check` accepts a config whose rules point at an outbound, DNS server
 * or rule-set that does not exist — the service then dies while starting.
 * This finds those dangling references up front.
 * Returns [{ kind: 'outbound'|'dns'|'ruleset'|'inbound', tag, where }].
 */
export function validateRefs(cfg) {
  const problems = [];
  const outTags = new Set([...outbounds(cfg), ...endpoints(cfg)].map((o) => o.tag));
  const dnsTags = new Set(dnsServers(cfg).map((s) => s.tag));
  const setTags = new Set(ruleSets(cfg).map((s) => s.tag));
  const inTags = new Set(inbounds(cfg).map((i) => i.tag));
  const need = (kind, set, tag, where) => {
    if (tag !== undefined && tag !== '' && !set.has(tag)) problems.push({ kind, tag, where });
  };
  const resolverTag = (v) => (typeof v === 'string' ? v : isObj(v) ? v.server : undefined);

  need('outbound', outTags, cfg.route && cfg.route.final, 'route.final');
  need('dns', dnsTags, resolverTag(cfg.route && cfg.route.default_domain_resolver), 'route.default_domain_resolver');
  need('dns', dnsTags, cfg.dns && cfg.dns.final, 'dns.final');

  const checkRule = (rule, scope, where) => {
    if (!isObj(rule)) return;
    if (scope === 'route') {
      need('outbound', outTags, rule.outbound, where);
      if (rule.action === 'resolve') need('dns', dnsTags, rule.server, where);
    } else need('dns', dnsTags, rule.server, where);
    for (const tag of arr(rule.rule_set)) need('ruleset', setTags, tag, where);
    for (const tag of arr(rule.inbound)) need('inbound', inTags, tag, where);
    if (Array.isArray(rule.rules)) rule.rules.forEach((r, i) => checkRule(r, scope, `${where}.rules[${i}]`));
  };
  for (const scope of SCOPES) (getRules(cfg, scope) || []).forEach((r, i) => checkRule(r, scope, `${scope}.rules[${i}]`));

  for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
    for (const m of arr(o.outbounds)) need('outbound', outTags, m, `${o.tag}.outbounds`);
    need('outbound', outTags, o.default, `${o.tag}.default`);
    need('outbound', outTags, o.detour, `${o.tag}.detour`);
    need('dns', dnsTags, resolverTag(o.domain_resolver), `${o.tag}.domain_resolver`);
  }
  for (const s of dnsServers(cfg)) {
    need('outbound', outTags, s.detour, `dns:${s.tag}.detour`);
    need('dns', dnsTags, resolverTag(s.domain_resolver), `dns:${s.tag}.domain_resolver`);
  }
  for (const s of ruleSets(cfg)) need('outbound', outTags, s.download_detour, `rule-set:${s.tag}.download_detour`);
  return problems;
}

// ---------------------------------------------------------------------------
// references: rename / usage / removal
// ---------------------------------------------------------------------------

/** Visit every rule object, including those nested in logical rules. */
function eachRule(cfg, scope, fn) {
  const walk = (rule) => {
    if (!isObj(rule)) return;
    fn(rule);
    if (Array.isArray(rule.rules)) rule.rules.forEach(walk);
  };
  (getRules(cfg, scope) || []).forEach(walk);
}

function mapDomainResolver(holder, key, fn) {
  const v = holder[key];
  if (typeof v === 'string') holder[key] = fn(v);
  else if (isObj(v) && typeof v.server === 'string') v.server = fn(v.server);
}

/**
 * Where is a tag used?  kind: 'outbound' | 'dns' | 'ruleset'
 * Returns a list of human-readable-ish locations, e.g. ["route.final", "route.rules[3]"].
 */
export function usages(cfg, kind, tag) {
  const out = [];
  const same = (v) => v === tag;
  if (kind === 'outbound') {
    if (cfg.route && same(cfg.route.final)) out.push('route.final');
    (getRules(cfg, 'route') || []).forEach((r, i) => {
      if (isObj(r) && same(r.outbound)) out.push(`route.rules[${i}]`);
    });
    for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
      if (same(o.detour)) out.push(`${o.tag}.detour`);
      if (Array.isArray(o.outbounds) && o.outbounds.includes(tag)) out.push(`${o.tag}.outbounds`);
    }
    dnsServers(cfg).forEach((s) => same(s.detour) && out.push(`dns:${s.tag}.detour`));
    ruleSets(cfg).forEach((s) => same(s.download_detour) && out.push(`rule-set:${s.tag}.download_detour`));
  } else if (kind === 'dns') {
    if (cfg.dns && same(cfg.dns.final)) out.push('dns.final');
    (getRules(cfg, 'dns') || []).forEach((r, i) => {
      if (isObj(r) && same(r.server)) out.push(`dns.rules[${i}]`);
    });
    const dr = cfg.route && cfg.route.default_domain_resolver;
    if (same(dr) || (isObj(dr) && same(dr.server))) out.push('route.default_domain_resolver');
    for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
      const r = o.domain_resolver;
      if (same(r) || (isObj(r) && same(r.server))) out.push(`${o.tag}.domain_resolver`);
    }
    dnsServers(cfg).forEach((s) => {
      const r = s.domain_resolver;
      if (same(r) || (isObj(r) && same(r.server))) out.push(`dns:${s.tag}.domain_resolver`);
    });
  } else if (kind === 'ruleset') {
    for (const scope of SCOPES) {
      (getRules(cfg, scope) || []).forEach((r, i) => {
        if (isObj(r) && arr(r.rule_set).includes(tag)) out.push(`${scope}.rules[${i}]`);
      });
    }
  }
  return out;
}

/** Rename a tag everywhere it is referenced. Mutates cfg. */
export function renameTag(cfg, kind, from, to) {
  if (from === to) return cfg;
  const swap = (v) => (v === from ? to : v);
  if (kind === 'outbound') {
    if (cfg.route && cfg.route.final === from) cfg.route.final = to;
    eachRule(cfg, 'route', (r) => r.outbound === from && (r.outbound = to));
    for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
      if (o.detour === from) o.detour = to;
      if (Array.isArray(o.outbounds)) o.outbounds = o.outbounds.map(swap);
      if (o.default === from) o.default = to;
    }
    dnsServers(cfg).forEach((s) => s.detour === from && (s.detour = to));
    ruleSets(cfg).forEach((s) => s.download_detour === from && (s.download_detour = to));
    for (const o of outbounds(cfg)) if (o.tag === from) o.tag = to;
    for (const o of endpoints(cfg)) if (o.tag === from) o.tag = to;
  } else if (kind === 'dns') {
    if (cfg.dns && cfg.dns.final === from) cfg.dns.final = to;
    eachRule(cfg, 'dns', (r) => r.server === from && (r.server = to));
    eachRule(cfg, 'route', (r) => r.action === 'resolve' && r.server === from && (r.server = to));
    if (cfg.route) mapDomainResolver(cfg.route, 'default_domain_resolver', swap);
    for (const o of [...outbounds(cfg), ...endpoints(cfg)]) mapDomainResolver(o, 'domain_resolver', swap);
    dnsServers(cfg).forEach((s) => {
      mapDomainResolver(s, 'domain_resolver', swap);
      if (s.tag === from) s.tag = to;
    });
  } else if (kind === 'ruleset') {
    for (const scope of SCOPES) {
      eachRule(cfg, scope, (r) => {
        if (r.rule_set === undefined) return;
        r.rule_set = Array.isArray(r.rule_set) ? r.rule_set.map(swap) : swap(r.rule_set);
      });
    }
    ruleSets(cfg).forEach((s) => s.tag === from && (s.tag = to));
  }
  return cfg;
}

/**
 * Remove an outbound and tidy everything that pointed at it:
 * selector/urltest members drop it, rules that routed to it are removed,
 * `route.final` falls back to the first remaining outbound.
 * Returns { removedRules }.
 */
export function removeOutbound(cfg, tag) {
  let removedRules = 0;
  cfg.outbounds = outbounds(cfg).filter((o) => o.tag !== tag);
  if (Array.isArray(cfg.endpoints)) cfg.endpoints = endpoints(cfg).filter((o) => o.tag !== tag);
  for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
    if (Array.isArray(o.outbounds)) o.outbounds = o.outbounds.filter((t) => t !== tag);
    if (o.default === tag) delete o.default;
    if (o.detour === tag) delete o.detour;
  }
  dnsServers(cfg).forEach((s) => s.detour === tag && delete s.detour);
  ruleSets(cfg).forEach((s) => s.download_detour === tag && delete s.download_detour);
  const rules = getRules(cfg, 'route');
  if (rules) {
    const before = rules.length;
    cfg.route.rules = rules.filter((r) => !(isObj(r) && r.outbound === tag));
    removedRules = before - cfg.route.rules.length;
  }
  if (cfg.route && cfg.route.final === tag) {
    const first = outboundChoices(cfg)[0];
    if (first) cfg.route.final = first.tag;
    else delete cfg.route.final;
  }
  return { removedRules };
}

/** Remove a DNS server and the rules / pointers that used it. */
export function removeDnsServer(cfg, tag) {
  let removedRules = 0;
  cfg.dns.servers = dnsServers(cfg).filter((s) => s.tag !== tag);
  const rules = getRules(cfg, 'dns');
  if (rules) {
    const before = rules.length;
    cfg.dns.rules = rules.filter((r) => !(isObj(r) && r.server === tag));
    removedRules = before - cfg.dns.rules.length;
  }
  if (cfg.dns.final === tag) {
    const first = dnsServers(cfg)[0];
    if (first) cfg.dns.final = first.tag;
    else delete cfg.dns.final;
  }
  const dr = cfg.route && cfg.route.default_domain_resolver;
  if (dr === tag || (isObj(dr) && dr.server === tag)) delete cfg.route.default_domain_resolver;
  for (const o of [...outbounds(cfg), ...endpoints(cfg)]) {
    const r = o.domain_resolver;
    if (r === tag || (isObj(r) && r.server === tag)) delete o.domain_resolver;
  }
  dnsServers(cfg).forEach((s) => {
    const r = s.domain_resolver;
    if (r === tag || (isObj(r) && r.server === tag)) delete s.domain_resolver;
  });
  return { removedRules };
}

// ---------------------------------------------------------------------------
// small ensure-helpers
// ---------------------------------------------------------------------------

export function ensure(cfg, key, init) {
  if (cfg[key] === undefined || cfg[key] === null) cfg[key] = init;
  return cfg[key];
}

export function ensureRoute(cfg) {
  return isObj(cfg.route) ? cfg.route : (cfg.route = {});
}

export function ensureDns(cfg) {
  return isObj(cfg.dns) ? cfg.dns : (cfg.dns = {});
}

/** Remote rule-sets are cached on disk only if cache_file is on. */
export function ensureCacheFile(cfg) {
  const exp = ensure(cfg, 'experimental', {});
  if (!isObj(exp.cache_file)) exp.cache_file = {};
  if (exp.cache_file.enabled !== true) exp.cache_file.enabled = true;
}
