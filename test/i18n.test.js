import test from 'node:test';
import assert from 'node:assert/strict';
import { fa, en } from '../src/frontend/js/locales.js';
import { staticKeys } from '../scripts/i18n-keys.mjs';
import { CONDITIONS } from '../src/frontend/js/rules.js';
import { ROUTE_TEMPLATES } from '../src/frontend/js/presets.js';
import { DNS_TYPES } from '../src/frontend/js/dns.js';

const PAGES = ['dashboard', 'routing', 'dns', 'outbounds', 'general', 'logs', 'advanced', 'settings'];

// keys built at run time: t(`prefix.${x}`)
const dynamic = [
  ...PAGES.flatMap((p) => [`nav.${p}`, `page.${p}.title`, `page.${p}.sub`]),
  ...CONDITIONS.flatMap((c) => [`cond.${c.type}`, `cond.${c.type}.hint`]),
  ...['route', 'reject', 'hijack-dns', 'sniff', 'resolve', 'route-options', 'bypass', 'predefined'].map((a) => `act.${a}`),
  ...['reject', 'hijack-dns', 'sniff'].map((a) => `act.${a}.hint`),
  ...['server', 'outbound', 'empty', 'port', 'regex'].map((k) => `rule.err.${k}`),
  ...ROUTE_TEMPLATES.flatMap((x) => [`tpl.${x.id}.title`, `tpl.${x.id}.desc`]),
  ...DNS_TYPES.flatMap((x) => [`dnstype.${x}`, `dnstype.${x}.hint`]),
  ...['prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'].map((s) => `dns.strategy.${s}`),
  ...['mixed', 'tun', 'socks', 'http'].map((x) => `inb.${x}`),
  ...['selector', 'urltest'].flatMap((x) => [`obtype.${x}`, `obtype.${x}.hint`]),
  ...['bad', 'scheme', 'transport'].map((x) => `link.err.${x}`),
  ...['ss-plugin', 'port-hopping'].map((x) => `link.warn.${x}`),
  ...['started', 'stopped', 'restarted', 'enabled', 'disabled'].map((x) => `svc.${x}`),
  ...['outbound', 'dns', 'ruleset', 'inbound'].map((x) => `refs.kind.${x}`),
];

test('every key used in the code exists in both languages', () => {
  const missing = [];
  for (const k of [...staticKeys, ...dynamic]) {
    if (!(k in fa)) missing.push(`fa:${k}`);
    if (!(k in en)) missing.push(`en:${k}`);
  }
  assert.deepEqual(missing, []);
});

test('Persian and English have exactly the same keys', () => {
  const a = new Set(Object.keys(fa));
  const b = new Set(Object.keys(en));
  assert.deepEqual([...a].filter((k) => !b.has(k)), [], 'only in fa');
  assert.deepEqual([...b].filter((k) => !a.has(k)), [], 'only in en');
});

test('placeholders match between languages', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const k of Object.keys(en)) assert.equal(ph(fa[k]), ph(en[k]), k);
});

test('no unused translations', () => {
  const used = new Set([...staticKeys, ...dynamic]);
  const unused = Object.keys(en).filter((k) => !used.has(k));
  assert.deepEqual(unused, []);
});
