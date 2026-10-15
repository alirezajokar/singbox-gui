// Rules <-> friendly editor model.
//
// A sing-box rule is a flat bag of match fields plus an action. Humans think
// in "when <conditions> then <action>", so the editor works on:
//
//   {
//     kind: 'default' | 'logical',
//     name, enabled, invert,
//     conds:  [{ type, values: [...] }],      // all of them must match (AND)
//     action: { type, outbound?, server? },   // what to do
//     rest:   { ... }                         // every other field, kept untouched
//   }
//
// `ctx.kind` is 'route' (route.rules) or 'dns' (dns.rules).

import { isObj, arr, omit } from './util.js';
import { isPrivateKey } from './config.js';

// ---------------------------------------------------------------------------
// condition catalogue (order = order of fields in the written rule)
// ---------------------------------------------------------------------------

export const CONDITIONS = [
  { type: 'tld', field: 'domain_suffix', scopes: ['route', 'dns'], placeholder: 'ir  cn  ru' },
  { type: 'domain_suffix', field: 'domain_suffix', scopes: ['route', 'dns'], placeholder: 'example.com' },
  { type: 'domain', field: 'domain', scopes: ['route', 'dns'], placeholder: 'www.example.com' },
  { type: 'domain_keyword', field: 'domain_keyword', scopes: ['route', 'dns'], placeholder: 'google' },
  { type: 'domain_regex', field: 'domain_regex', scopes: ['route', 'dns'], placeholder: '^ads?\\d*\\.' },
  { type: 'ip_cidr', field: 'ip_cidr', scopes: ['route'], placeholder: '10.0.0.0/8  1.1.1.1' },
  { type: 'ip_is_private', field: 'ip_is_private', scopes: ['route'], flag: true },
  { type: 'rule_set', field: 'rule_set', scopes: ['route', 'dns'], picker: 'ruleset' },
  { type: 'port', field: 'port', scopes: ['route', 'dns'], placeholder: '443  8000:9000' },
  { type: 'protocol', field: 'protocol', scopes: ['route', 'dns'], picker: 'protocol' },
  { type: 'network', field: 'network', scopes: ['route', 'dns'], picker: 'network' },
  { type: 'query_type', field: 'query_type', scopes: ['dns'], picker: 'qtype' },
  { type: 'process_name', field: 'process_name', scopes: ['route', 'dns'], placeholder: 'firefox  telegram' },
  { type: 'inbound', field: 'inbound', scopes: ['route', 'dns'], picker: 'inbound' },
  { type: 'source_ip_cidr', field: 'source_ip_cidr', scopes: ['route', 'dns'], placeholder: '192.168.1.0/24' },
];

export const CONDITION_BY_TYPE = Object.fromEntries(CONDITIONS.map((c) => [c.type, c]));

export const PROTOCOLS = ['http', 'tls', 'quic', 'dns', 'bittorrent', 'stun', 'ssh', 'rdp', 'dtls', 'ntp'];
export const NETWORKS = ['tcp', 'udp'];
export const QUERY_TYPES = ['A', 'AAAA', 'HTTPS', 'SVCB', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV'];

// fields owned by the conditions above (and special-cased ones)
const CONDITION_FIELDS = new Set([
  ...CONDITIONS.map((c) => c.field),
  'port_range',
]);

// keys the model handles itself, so they never land in `rest`
const MODEL_KEYS = new Set(['invert', 'action', 'outbound', 'server', 'type', 'mode', 'rules']);

export const ROUTE_ACTIONS = ['route', 'reject', 'hijack-dns', 'sniff', 'resolve', 'route-options', 'bypass'];
export const DNS_ACTIONS = ['route', 'reject', 'predefined', 'route-options'];

// "ir", ".ir", "*.ir" -> single label, no inner dots
const TLD_RE = /^(?:\*?\.)?[^.\s/]+$/;

export function isTld(v) {
  return typeof v === 'string' && TLD_RE.test(v) && !v.includes(':');
}

export function normalizeTld(v) {
  const t = String(v).trim().toLowerCase().replace(/^\*/, '');
  return t.startsWith('.') ? t : `.${t}`;
}

// ---------------------------------------------------------------------------
// rule -> model
// ---------------------------------------------------------------------------

export function ruleToModel(rule, ctx = { kind: 'route' }) {
  const kind = ctx.kind || 'route';
  const base = {
    name: rule.__name || '',
    enabled: !rule.__off,
  };

  if (rule.type === 'logical') {
    return {
      ...base,
      kind: 'logical',
      invert: !!rule.invert,
      conds: [],
      action: readAction(rule, kind),
      rest: {},
      raw: omitPrivate(rule),
    };
  }

  const conds = [];
  const add = (type, values) => values.length && conds.push({ type, values });

  const suffixes = arr(rule.domain_suffix);
  add('tld', suffixes.filter(isTld));
  add('domain_suffix', suffixes.filter((v) => !isTld(v)));
  add('domain', arr(rule.domain));
  add('domain_keyword', arr(rule.domain_keyword));
  add('domain_regex', arr(rule.domain_regex));
  add('ip_cidr', arr(rule.ip_cidr));
  if (rule.ip_is_private === true) conds.push({ type: 'ip_is_private', values: [] });
  add('rule_set', arr(rule.rule_set));
  add('port', [...arr(rule.port).map(String), ...arr(rule.port_range).map(String)]);
  add('protocol', arr(rule.protocol));
  add('network', arr(rule.network));
  add('query_type', arr(rule.query_type).map(String));
  add('process_name', arr(rule.process_name));
  add('inbound', arr(rule.inbound));
  add('source_ip_cidr', arr(rule.source_ip_cidr));

  // keep a flag we do not model (e.g. ip_is_private: false) in `rest`
  const rest = {};
  for (const k of Object.keys(rule)) {
    if (isPrivateKey(k) || MODEL_KEYS.has(k)) continue;
    if (CONDITION_FIELDS.has(k)) {
      if (k === 'ip_is_private' && rule[k] === true) continue;
      if (k === 'ip_is_private') rest[k] = rule[k];
      continue;
    }
    rest[k] = rule[k];
  }

  return {
    ...base,
    kind: 'default',
    invert: !!rule.invert,
    conds,
    action: readAction(rule, kind),
    rest,
  };
}

function readAction(rule, kind) {
  let type = rule.action;
  if (!type) type = 'route'; // legacy rules without `action`
  const a = { type };
  if (kind === 'dns') {
    if (rule.server !== undefined) a.server = rule.server;
  } else {
    if (rule.outbound !== undefined) a.outbound = rule.outbound;
    if (rule.server !== undefined && (type === 'resolve' || type === 'route')) a.server = rule.server;
  }
  return a;
}

function omitPrivate(rule) {
  const out = {};
  for (const k of Object.keys(rule)) if (!isPrivateKey(k)) out[k] = rule[k];
  return out;
}

// ---------------------------------------------------------------------------
// model -> rule
// ---------------------------------------------------------------------------

function dedupe(list) {
  return [...new Set(list)];
}

function mergeValues(conds, type) {
  const out = [];
  for (const c of conds) if (c.type === type) out.push(...c.values);
  return out;
}

export function modelToRule(m, ctx = { kind: 'route' }) {
  const kind = ctx.kind || 'route';
  let rule;

  if (m.kind === 'logical') {
    rule = { ...m.raw };
  } else {
    rule = {};
    const put = (key, values) => values.length && (rule[key] = dedupe(values));

    put('inbound', mergeValues(m.conds, 'inbound'));
    put('network', mergeValues(m.conds, 'network'));
    put('protocol', mergeValues(m.conds, 'protocol'));
    put('query_type', mergeValues(m.conds, 'query_type').map((v) => (/^\d+$/.test(v) ? Number(v) : v)));
    put('domain', mergeValues(m.conds, 'domain'));
    put('domain_suffix', [...mergeValues(m.conds, 'tld'), ...mergeValues(m.conds, 'domain_suffix')]);
    put('domain_keyword', mergeValues(m.conds, 'domain_keyword'));
    put('domain_regex', mergeValues(m.conds, 'domain_regex'));
    put('ip_cidr', mergeValues(m.conds, 'ip_cidr'));
    if (m.conds.some((c) => c.type === 'ip_is_private')) rule.ip_is_private = true;
    put('source_ip_cidr', mergeValues(m.conds, 'source_ip_cidr'));

    const ports = mergeValues(m.conds, 'port');
    const single = ports.filter((p) => /^\d+$/.test(p)).map(Number);
    const ranges = ports.filter((p) => !/^\d+$/.test(p)).map((p) => p.replace('-', ':'));
    if (single.length) rule.port = dedupe(single);
    if (ranges.length) rule.port_range = dedupe(ranges);

    put('process_name', mergeValues(m.conds, 'process_name'));
    put('rule_set', mergeValues(m.conds, 'rule_set'));
  }

  if (m.invert) rule.invert = true;

  // action
  const a = m.action || { type: 'route' };
  rule.action = a.type;
  if (kind === 'dns') {
    if (a.type === 'route' && a.server) rule.server = a.server;
  } else {
    if (a.type === 'route' && a.outbound) rule.outbound = a.outbound;
    if (a.type === 'resolve' && a.server) rule.server = a.server;
  }

  Object.assign(rule, omit(m.rest || {}, Object.keys(rule)));

  if (m.name) rule.__name = m.name;
  if (m.enabled === false) rule.__off = true;
  return rule;
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

export function emptyModel(ctx = { kind: 'route' }) {
  return {
    kind: 'default',
    name: '',
    enabled: true,
    invert: false,
    conds: [],
    action:
      ctx.kind === 'dns' ? { type: 'route', server: '' } : { type: 'route', outbound: '' },
    rest: {},
  };
}

/** Problems that would make sing-box reject the rule (null if fine). */
export function validateModel(m, ctx = { kind: 'route' }) {
  const a = m.action || {};
  if (m.kind === 'logical') return null;
  if (a.type === 'route') {
    if (ctx.kind === 'dns' && !a.server) return 'server';
    if (ctx.kind !== 'dns' && !a.outbound) return 'outbound';
  }
  // conditions must carry values (a flag condition needs none)
  for (const c of m.conds) {
    const meta = CONDITION_BY_TYPE[c.type];
    if (meta && !meta.flag && !c.values.length) return 'empty';
  }
  for (const c of m.conds) {
    if (c.type === 'port') {
      for (const v of c.values) if (!/^\d+$/.test(v) && !/^\d*[:-]\d*$/.test(v)) return 'port';
    }
    if (c.type === 'domain_regex') {
      for (const v of c.values) {
        try {
          new RegExp(v);
        } catch {
          return 'regex';
        }
      }
    }
  }
  return null;
}

/** True when the rule matches everything (no conditions) and routes somewhere. */
export function isCatchAll(m) {
  return m.kind === 'default' && m.conds.length === 0 && !m.invert && m.action && m.action.type === 'route';
}

/** Parse what the user typed into a condition field into clean values. */
export function parseValues(type, text) {
  const sep = type === 'domain_regex' || type === 'process_name' ? /[\n,;،]+/ : /[\s,;،]+/;
  const raw = String(text ?? '')
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (let v of raw) {
    if (type === 'tld') v = normalizeTld(v);
    else if (type === 'domain_suffix' || type === 'domain') v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^\*\./, '');
    else if (type === 'port') v = v.replace(/-/g, ':');
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Smart paste: classify a bunch of mixed lines (domains, IPs, "keyword:x",
 * "full:x", "regexp:x", ".ir") into conditions.
 */
export function classifyLines(text) {
  const buckets = new Map();
  const put = (type, v) => {
    if (!buckets.has(type)) buckets.set(type, []);
    const list = buckets.get(type);
    if (!list.includes(v)) list.push(v);
  };
  const ipRe = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]+:[0-9a-f:]*(\/\d{1,3})?$/i;
  const body = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
  for (const line of body.split(/[\s,;،]+/)) {
    let v = line.trim();
    if (!v) continue;
    let m;
    if ((m = /^(full|domain-full):(.+)$/i.exec(v))) put('domain', m[2]);
    else if ((m = /^(keyword|domain-keyword):(.+)$/i.exec(v))) put('domain_keyword', m[2]);
    else if ((m = /^(regexp|regex):(.+)$/i.exec(v))) put('domain_regex', m[2]);
    else if ((m = /^(domain|suffix|domain-suffix):(.+)$/i.exec(v))) put('domain_suffix', m[2]);
    else if (ipRe.test(v)) put('ip_cidr', v);
    else {
      v = v.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      if (isTld(v)) put('tld', normalizeTld(v));
      else put('domain_suffix', v.replace(/^\*\./, ''));
    }
  }
  return [...buckets.entries()].map(([type, values]) => ({ type, values }));
}

/** Short fingerprint of an action for colouring badges. */
export function actionTone(action, choices = []) {
  if (!action) return 'neutral';
  if (action.type === 'reject') return 'danger';
  if (action.type === 'route') {
    const tag = action.outbound || action.server || '';
    const found = choices.find((c) => c.tag === tag);
    if (found && found.type === 'direct') return 'direct';
    if (found && (found.type === 'block' || found.type === 'dns')) return 'danger';
    if (tag === 'direct') return 'direct';
    return 'proxy';
  }
  return 'neutral';
}

export function isObject(v) {
  return isObj(v);
}
