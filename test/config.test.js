import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDraft, compileDraft, renameTag, removeOutbound, removeDnsServer, usages, getRules, starterConfig, parseConfig, serialize, outboundChoices } from '../src/frontend/js/config.js';
import { clone } from '../src/frontend/js/util.js';

const sample = () => ({
  dns: { servers: [{ type: 'udp', tag: 'g', server: '8.8.8.8' }, { type: 'local', tag: 'local', detour: 'proxy' }], rules: [{ domain_suffix: ['ir'], action: 'route', server: 'local' }], final: 'g' },
  outbounds: [
    { type: 'direct', tag: 'direct' },
    { type: 'vless', tag: 'p1', server: '1.2.3.4', server_port: 443, uuid: 'u' },
    { type: 'selector', tag: 'proxy', outbounds: ['p1', 'direct'], default: 'p1' },
  ],
  route: {
    rule_set: [{ type: 'remote', tag: 'geoip-ir', format: 'binary', url: 'https://x/y.srs', download_detour: 'proxy' }],
    rules: [
      { action: 'sniff' },
      { rule_set: ['geoip-ir'], action: 'route', outbound: 'direct' },
      { domain: ['a.com'], action: 'route', outbound: 'proxy' },
    ],
    final: 'proxy',
    default_domain_resolver: 'g',
  },
});

test('parse / serialize', () => {
  assert.equal(parseConfig('[1]').ok, false);
  assert.equal(parseConfig('{').ok, false);
  const r = parseConfig('{"a":1}');
  assert.ok(r.ok);
  assert.equal(serialize(r.value), '{\n  "a": 1\n}\n');
});

test('draft keeps names and disabled rules across compile/load', () => {
  const cfg = sample();
  const meta = {
    route: { names: { [JSON.stringify({ action: 'route', domain: ['a.com'], outbound: 'proxy' })]: 'A' }, disabled: [] },
    dns: { names: {}, disabled: [] },
  };
  // names are keyed by the sorted-key signature
  const draft = loadDraft(cfg, { route: { names: {}, disabled: [{ rule: { domain: ['off.com'], action: 'route', outbound: 'direct' }, at: 1, name: 'off' }] } });
  const rules = getRules(draft, 'route');
  assert.equal(rules.length, 4);
  assert.equal(rules[1].__off, true);
  assert.equal(rules[1].__name, 'off');
  const { config, meta: m2 } = compileDraft(draft);
  assert.equal(config.route.rules.length, 3, 'disabled rule is not written to sing-box');
  assert.ok(config.route.rules.every((r) => !Object.keys(r).some((k) => k.startsWith('__'))));
  assert.deepEqual(m2.route.disabled, [{ rule: { domain: ['off.com'], action: 'route', outbound: 'direct' }, at: 1, name: 'off' }]);
  // round trip
  const again = compileDraft(loadDraft(config, m2));
  assert.deepEqual(again.config, config);
  assert.deepEqual(again.meta, m2);
  void meta;
});

test('names survive when the rule is unchanged', () => {
  const cfg = sample();
  const draft = loadDraft(cfg, null);
  getRules(draft, 'route')[2].__name = 'Work';
  const { config, meta } = compileDraft(draft);
  const back = loadDraft(config, meta);
  assert.equal(getRules(back, 'route')[2].__name, 'Work');
});

test('rename outbound updates every reference', () => {
  const cfg = sample();
  renameTag(cfg, 'outbound', 'proxy', 'main');
  assert.equal(cfg.route.final, 'main');
  assert.equal(cfg.route.rules[2].outbound, 'main');
  assert.equal(cfg.dns.servers[1].detour, 'main');
  assert.equal(cfg.route.rule_set[0].download_detour, 'main');
  assert.ok(cfg.outbounds.some((o) => o.tag === 'main'));
  assert.ok(!cfg.outbounds.some((o) => o.tag === 'proxy'));
  renameTag(cfg, 'outbound', 'p1', 'p-one');
  assert.deepEqual(cfg.outbounds.find((o) => o.tag === 'main').outbounds, ['p-one', 'direct']);
  assert.equal(cfg.outbounds.find((o) => o.tag === 'main').default, 'p-one');
});

test('rename dns server and rule-set', () => {
  const cfg = sample();
  renameTag(cfg, 'dns', 'g', 'google');
  assert.equal(cfg.dns.final, 'google');
  assert.equal(cfg.route.default_domain_resolver, 'google');
  renameTag(cfg, 'ruleset', 'geoip-ir', 'ir-ip');
  assert.deepEqual(cfg.route.rules[1].rule_set, ['ir-ip']);
  assert.equal(cfg.route.rule_set[0].tag, 'ir-ip');
});

test('usages', () => {
  const cfg = sample();
  const u = usages(cfg, 'outbound', 'proxy');
  assert.ok(u.includes('route.final'));
  assert.ok(u.includes('route.rules[2]'));
  assert.ok(u.some((x) => x.startsWith('dns:local')));
  assert.deepEqual(usages(cfg, 'ruleset', 'geoip-ir'), ['route.rules[1]']);
});

test('remove outbound cleans up rules, groups and final', () => {
  const cfg = sample();
  const { removedRules } = removeOutbound(cfg, 'proxy');
  assert.equal(removedRules, 1);
  assert.equal(cfg.route.rules.length, 2);
  assert.equal(cfg.route.final, 'direct');
  assert.equal(cfg.dns.servers[1].detour, undefined);
  assert.ok(!cfg.route.rule_set[0].download_detour);

  const c2 = sample();
  removeOutbound(c2, 'p1');
  assert.deepEqual(c2.outbounds.find((o) => o.tag === 'proxy').outbounds, ['direct']);
  assert.equal(c2.outbounds.find((o) => o.tag === 'proxy').default, undefined);
});

test('remove dns server', () => {
  const cfg = sample();
  const { removedRules } = removeDnsServer(cfg, 'local');
  assert.equal(removedRules, 1);
  assert.equal(cfg.dns.rules.length, 0);
  const c2 = sample();
  removeDnsServer(c2, 'g');
  assert.equal(c2.dns.final, 'local');
  assert.equal(c2.route.default_domain_resolver, undefined);
});

test('starter config is plain JSON', () => {
  const s = starterConfig();
  assert.deepEqual(clone(s), s);
  assert.ok(outboundChoices(s).some((o) => o.tag === 'direct'));
});

test('validateRefs finds dangling references and ignores valid ones', async () => {
  const { validateRefs } = await import('../src/frontend/js/config.js');
  assert.deepEqual(validateRefs(sample()), []);
  const bad = sample();
  bad.route.final = 'nope';
  bad.route.rules.push({ domain: ['x.com'], action: 'route', outbound: 'gone' });
  bad.route.rules.push({ rule_set: ['missing-set'], inbound: ['no-in'], action: 'route', outbound: 'direct' });
  bad.dns.final = 'no-dns';
  bad.dns.rules.push({ domain: ['y.com'], action: 'route', server: 'no-dns' });
  bad.outbounds.find((o) => o.tag === 'proxy').outbounds.push('ghost');
  bad.dns.servers[1].detour = 'void';
  bad.route.rule_set[0].download_detour = 'nowhere';
  bad.route.default_domain_resolver = { server: 'nothing' };
  const tags = validateRefs(bad).map((p) => `${p.kind}:${p.tag}`).sort();
  assert.deepEqual(tags, [
    'dns:no-dns', 'dns:no-dns', 'dns:nothing', 'inbound:no-in', 'outbound:ghost', 'outbound:gone',
    'outbound:nowhere', 'outbound:nope', 'outbound:void', 'ruleset:missing-set',
  ].sort());
});

test('disabled rules are not validated (they are not written)', async () => {
  const { validateRefs, compileDraft, loadDraft } = await import('../src/frontend/js/config.js');
  const cfg = sample();
  const draft = loadDraft(cfg, { route: { names: {}, disabled: [{ rule: { domain: ['x'], action: 'route', outbound: 'gone' }, at: 0, name: '' }] } });
  assert.deepEqual(validateRefs(compileDraft(draft).config), []);
});
