// Validates what the app generates with the real `sing-box check`.
// Skipped automatically when sing-box is not installed (set SINGBOX_BIN to point at one).

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { starterConfig, serialize, compileDraft, loadDraft, getRules, validateRefs } from '../src/frontend/js/config.js';
import { ROUTE_TEMPLATES, INBOUND_PRESETS, addRuleSet, remoteRuleSet } from '../src/frontend/js/presets.js';
import { modelToRule, ruleToModel } from '../src/frontend/js/rules.js';
import { DNS_PRESETS, presetToModel, modelToServer, DNS_TYPES, emptyServerModel } from '../src/frontend/js/dns.js';
import { parseLinks, b64encode } from '../src/frontend/js/links.js';
import { ensureCacheFile } from '../src/frontend/js/config.js';

const BIN = process.env.SINGBOX_BIN || 'sing-box';
const have = spawnSync(BIN, ['version']).status === 0;
const opts = { skip: have ? false : 'sing-box binary not found' };

function check(cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'sbgui-'));
  const file = join(dir, 'config.json');
  try {
    writeFileSync(file, serialize(cfg));
    const r = spawnSync(BIN, ['check', '-c', file], { encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const KEY = 'A'.repeat(43);
const uuid = '11111111-2222-3333-4444-555555555555';

test('starter config is valid', opts, () => {
  const r = check(starterConfig());
  assert.ok(r.ok, r.out);
});

test('links turn into outbounds sing-box accepts', opts, () => {
  const links = [
    `vless://${uuid}@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${KEY}&sid=ab12&type=grpc&serviceName=svc&flow=xtls-rprx-vision#reality`,
    `vless://${uuid}@1.2.3.4:8443?security=tls&sni=a.com&type=ws&path=%2Fws&host=a.com#ws`,
    'vmess://' + b64encode(JSON.stringify({ v: '2', ps: 'vm', add: 'v.example.com', port: '443', id: uuid, aid: '0', scy: 'auto', net: 'ws', host: 'v.example.com', path: '/p', tls: 'tls', sni: 'v.example.com' })),
    'trojan://secret@t.example.com:443?sni=t.example.com#tj',
    `ss://${b64encode('aes-256-gcm:secret')}@s.example.com:8388#ss`,
    'hy2://secret@h.example.com:8443?sni=h.example.com&obfs=salamander&obfs-password=ob#hy',
    `tuic://${uuid}:pw@t.example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=t.example.com#tu`,
  ];
  const { outbounds, errors } = parseLinks(links.join('\n'), ['direct']);
  assert.equal(errors.length, 0);
  const cfg = starterConfig();
  cfg.outbounds.push(...outbounds);
  cfg.outbounds.push({ type: 'selector', tag: 'proxy', outbounds: outbounds.map((o) => o.tag) });
  cfg.route.final = 'proxy';
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('every route template produces a valid rule', opts, () => {
  const cfg = starterConfig();
  cfg.outbounds.push({ type: 'vless', tag: 'proxy', server: '1.2.3.4', server_port: 443, uuid });
  const draft = loadDraft(cfg, null);
  for (const t of ROUTE_TEMPLATES) {
    const built = t.build(draft);
    for (const rs of built.ruleSets || []) addRuleSet(draft, rs);
    draft.route.rules.push(modelToRule(built.model, { kind: 'route' }));
  }
  ensureCacheFile(draft);
  const { config } = compileDraft(draft);
  const r = check(config);
  assert.ok(r.ok, r.out + '\n' + JSON.stringify(config.route.rules, null, 1));
});

test('rules survive a model round trip and stay valid', opts, () => {
  const cfg = starterConfig();
  cfg.route.rules.push(
    { domain_suffix: ['.ir', 'example.com'], domain_keyword: ['ads'], port: [80, 443], port_range: ['8000:9000'], network: ['tcp'], action: 'route', outbound: 'direct' },
    { ip_cidr: ['10.0.0.0/8'], invert: true, action: 'reject' },
  );
  const back = getRules(cfg, 'route').map((r) => modelToRule(ruleToModel(r, { kind: 'route' }), { kind: 'route' }));
  cfg.route.rules = back;
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('dns server types and rules are accepted', opts, () => {
  const cfg = starterConfig();
  cfg.dns.servers = [];
  for (const p of DNS_PRESETS) cfg.dns.servers.push(modelToServer(presetToModel(p)));
  for (const type of ['tcp', 'tls', 'quic', 'h3']) {
    cfg.dns.servers.push(modelToServer({ ...emptyServerModel(type), tag: `x-${type}`, server: '9.9.9.9' }));
  }
  cfg.dns.servers.push(modelToServer({ ...emptyServerModel('fakeip'), tag: 'fake' }));
  assert.ok(DNS_TYPES.length >= 9);
  cfg.dns.rules = [{ domain_suffix: ['.ir'], action: 'route', server: 'local' }, { query_type: ['HTTPS'], action: 'reject' }];
  cfg.dns.final = 'google-doh';
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('remote rule-set entries are accepted', opts, () => {
  const cfg = starterConfig();
  ensureCacheFile(cfg);
  cfg.route.rule_set = [remoteRuleSet('geoip', 'ir', { detour: 'direct' }), remoteRuleSet('geosite', 'openai')];
  cfg.route.rules.push({ rule_set: ['geoip-ir'], action: 'route', outbound: 'direct' });
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('every inbound preset is accepted', opts, () => {
  const cfg = starterConfig();
  cfg.inbounds = INBOUND_PRESETS.map((p) => p.build());
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('groups built by the app are accepted', opts, () => {
  const cfg = starterConfig();
  cfg.outbounds.push(
    { type: 'vless', tag: 'a', server: '1.2.3.4', server_port: 443, uuid },
    { type: 'vless', tag: 'b', server: '1.2.3.5', server_port: 443, uuid },
    { type: 'urltest', tag: 'auto', outbounds: ['a', 'b'], url: 'https://www.gstatic.com/generate_204', interval: '3m' },
    { type: 'selector', tag: 'proxy', outbounds: ['auto', 'a', 'b', 'direct'], default: 'auto' },
  );
  cfg.route.final = 'proxy';
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('dns rules that use rule-sets are accepted', opts, () => {
  const cfg = starterConfig();
  ensureCacheFile(cfg);
  cfg.route.rule_set = [remoteRuleSet('geosite', 'category-ads-all'), remoteRuleSet('geosite', 'category-ir')];
  cfg.dns.rules = [
    { rule_set: ['geosite-category-ads-all'], action: 'reject' },
    { rule_set: ['geosite-category-ir'], action: 'route', server: 'local' },
  ];
  const r = check(cfg);
  assert.ok(r.ok, r.out);
});

test('sing-box check misses dangling references; the app catches them', opts, () => {
  const cfg = starterConfig();
  cfg.route.rules.push({ domain: ['a.com'], action: 'route', outbound: 'does-not-exist' });
  assert.equal(check(cfg).ok, true, 'if this starts failing, sing-box got stricter and validateRefs may be redundant');
  assert.deepEqual(validateRefs(cfg).map((p) => p.tag), ['does-not-exist']);
});

test('check is not vacuous: a genuinely broken config is rejected', opts, () => {
  const cfg = starterConfig();
  cfg.outbounds.push({ type: 'direct', tag: 'direct' });
  assert.equal(check(cfg).ok, false);
});
