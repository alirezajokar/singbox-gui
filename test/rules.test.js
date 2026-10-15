import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleToModel, modelToRule, classifyLines, parseValues, validateModel, emptyModel, isTld, normalizeTld } from '../src/frontend/js/rules.js';

const route = { kind: 'route' };
const dns = { kind: 'dns' };

test('tld detection and normalisation', () => {
  assert.ok(isTld('ir'));
  assert.ok(isTld('.ir'));
  assert.ok(isTld('*.cn'));
  assert.ok(!isTld('google.com'));
  assert.ok(!isTld('1.1.1.1'));
  assert.equal(normalizeTld('IR'), '.ir');
  assert.equal(normalizeTld('*.ru'), '.ru');
  assert.equal(normalizeTld('.cn'), '.cn');
});

test('rule -> model splits TLDs from domains and keeps everything else', () => {
  const rule = {
    domain_suffix: ['ir', 'example.com', '.cn'],
    domain_keyword: ['ads'],
    port: [80, 443],
    port_range: ['8000:9000'],
    action: 'route',
    outbound: 'direct',
    override_port: 8443,
    wifi_ssid: ['home'],
  };
  const m = ruleToModel(rule, route);
  assert.deepEqual(m.conds.find((c) => c.type === 'tld').values, ['ir', '.cn']);
  assert.deepEqual(m.conds.find((c) => c.type === 'domain_suffix').values, ['example.com']);
  assert.deepEqual(m.conds.find((c) => c.type === 'port').values, ['80', '443', '8000:9000']);
  assert.deepEqual(m.action, { type: 'route', outbound: 'direct' });
  assert.deepEqual(m.rest, { override_port: 8443, wifi_ssid: ['home'] });
});

test('model -> rule round trip is stable', () => {
  const rule = {
    domain_suffix: ['.ir', 'example.com'],
    ip_cidr: ['10.0.0.0/8'],
    port: [443],
    action: 'route',
    outbound: 'proxy',
    udp_connect: true,
  };
  const again = modelToRule(ruleToModel(rule, route), route);
  assert.deepEqual(again, rule);
});

test('legacy rule without action gets action:route', () => {
  const m = ruleToModel({ domain: ['a.com'], outbound: 'direct' }, route);
  assert.equal(m.action.type, 'route');
  assert.equal(modelToRule(m, route).action, 'route');
});

test('flags: ip_is_private, invert and non-true flags', () => {
  const m = ruleToModel({ ip_is_private: true, invert: true, action: 'route', outbound: 'direct' }, route);
  assert.ok(m.invert);
  assert.deepEqual(m.conds, [{ type: 'ip_is_private', values: [] }]);
  const r = modelToRule(m, route);
  assert.equal(r.ip_is_private, true);
  assert.equal(r.invert, true);
  // ip_is_private:false is not a condition we show; it must survive
  const keep = ruleToModel({ ip_is_private: false, domain: ['a'], action: 'route', outbound: 'x' }, route);
  assert.equal(modelToRule(keep, route).ip_is_private, false);
});

test('tld typed without dot is written with a dot', () => {
  const m = emptyModel(route);
  m.conds = [{ type: 'tld', values: parseValues('tld', 'ru .cn *.tr') }];
  m.action = { type: 'route', outbound: 'proxy' };
  assert.deepEqual(modelToRule(m, route).domain_suffix, ['.ru', '.cn', '.tr']);
});

test('a bare tld already in a config is left exactly as written', () => {
  const rule = { domain_suffix: ['ir'], action: 'route', outbound: 'direct' };
  assert.deepEqual(modelToRule(ruleToModel(rule, route), route), rule);
});

test('actions without outbound: reject, sniff, hijack-dns', () => {
  for (const a of ['reject', 'sniff', 'hijack-dns']) {
    const m = ruleToModel({ action: a }, route);
    assert.equal(m.action.type, a);
    assert.deepEqual(modelToRule(m, route), { action: a });
  }
});

test('dns rules use server', () => {
  const m = ruleToModel({ domain_suffix: ['ir'], server: 'local' }, dns);
  assert.deepEqual(m.action, { type: 'route', server: 'local' });
  assert.deepEqual(modelToRule(m, dns), { domain_suffix: ['ir'], action: 'route', server: 'local' });
});

test('private annotations ride along', () => {
  const m = ruleToModel({ __name: 'Iran', __off: true, domain: ['a'], action: 'route', outbound: 'direct' }, route);
  assert.equal(m.name, 'Iran');
  assert.equal(m.enabled, false);
  const r = modelToRule(m, route);
  assert.equal(r.__name, 'Iran');
  assert.equal(r.__off, true);
});

test('logical rules are kept verbatim', () => {
  const rule = { type: 'logical', mode: 'and', rules: [{ protocol: 'dns' }, { invert: true, domain: ['x'] }], action: 'reject' };
  const m = ruleToModel(rule, route);
  assert.equal(m.kind, 'logical');
  assert.deepEqual(modelToRule(m, route), rule);
});

test('smart paste classifies lines', () => {
  const got = classifyLines('google.com\nfull:www.x.org\nkeyword:ads\nregexp:^a+$\nir\n10.0.0.0/8, 1.1.1.1\n# comment\nhttps://example.net/path');
  const by = Object.fromEntries(got.map((g) => [g.type, g.values]));
  assert.deepEqual(by.domain_suffix, ['google.com', 'example.net']);
  assert.deepEqual(by.domain, ['www.x.org']);
  assert.deepEqual(by.domain_keyword, ['ads']);
  assert.deepEqual(by.domain_regex, ['^a+$']);
  assert.deepEqual(by.tld, ['.ir']);
  assert.deepEqual(by.ip_cidr, ['10.0.0.0/8', '1.1.1.1']);
});

test('parseValues cleans input per type', () => {
  assert.deepEqual(parseValues('domain_suffix', 'https://a.com/x, *.b.com  a.com'), ['a.com', 'b.com']);
  assert.deepEqual(parseValues('port', '80, 8000-9000'), ['80', '8000:9000']);
  assert.deepEqual(parseValues('process_name', 'Google Chrome, firefox'), ['Google Chrome', 'firefox']);
  assert.deepEqual(parseValues('tld', 'IR cn'), ['.ir', '.cn']);
});

test('validation', () => {
  const m = emptyModel(route);
  assert.equal(validateModel(m, route), 'outbound');
  m.action.outbound = 'direct';
  assert.equal(validateModel(m, route), null);
  m.conds = [{ type: 'domain', values: [] }];
  assert.equal(validateModel(m, route), 'empty');
  m.conds = [{ type: 'port', values: ['abc'] }];
  assert.equal(validateModel(m, route), 'port');
  m.conds = [{ type: 'domain_regex', values: ['('] }];
  assert.equal(validateModel(m, route), 'regex');
  const d = emptyModel(dns);
  assert.equal(validateModel(d, dns), 'server');
});
