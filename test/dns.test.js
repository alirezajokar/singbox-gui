import test from 'node:test';
import assert from 'node:assert/strict';
import { serverToModel, modelToServer, describeServer, hostNeedsResolver, emptyServerModel } from '../src/frontend/js/dns.js';

test('modern server round trip', () => {
  const s = { type: 'https', tag: 'cf', server: '1.1.1.1', detour: 'proxy', tls: { server_name: 'cloudflare-dns.com' } };
  const m = serverToModel(s);
  assert.equal(m.type, 'https');
  assert.deepEqual(m.rest, { tls: { server_name: 'cloudflare-dns.com' } });
  assert.deepEqual(modelToServer(m), { type: 'https', tag: 'cf', server: '1.1.1.1', detour: 'proxy', tls: { server_name: 'cloudflare-dns.com' } });
});

test('default ports and paths are omitted', () => {
  const m = { ...emptyServerModel('https'), tag: 'x', server: 'dns.google', port: 443, path: '/dns-query', resolver: 'local' };
  assert.deepEqual(modelToServer(m), { type: 'https', tag: 'x', server: 'dns.google', domain_resolver: 'local' });
  m.port = 8443;
  m.path = 'custom';
  assert.deepEqual(modelToServer(m), { type: 'https', tag: 'x', server: 'dns.google', server_port: 8443, path: '/custom', domain_resolver: 'local' });
});

test('legacy addresses are understood and converted', () => {
  const cases = [
    [{ tag: 'a', address: '8.8.8.8' }, { type: 'udp', tag: 'a', server: '8.8.8.8' }],
    [{ tag: 'a', address: 'tls://1.1.1.1:853' }, { type: 'tls', tag: 'a', server: '1.1.1.1' }],
    [{ tag: 'a', address: 'https://dns.google/dns-query', address_resolver: 'local', detour: 'p' }, { type: 'https', tag: 'a', server: 'dns.google', detour: 'p', domain_resolver: 'local' }],
    [{ tag: 'a', address: 'tcp://9.9.9.9:5353' }, { type: 'tcp', tag: 'a', server: '9.9.9.9', server_port: 5353 }],
    [{ tag: 'l', address: 'local' }, { type: 'local', tag: 'l' }],
  ];
  for (const [legacy, modern] of cases) {
    const m = serverToModel(legacy);
    assert.ok(m.legacy);
    assert.deepEqual(modelToServer(m), modern);
  }
});

test('unknown servers stay untouched (advanced)', () => {
  const raw = { type: 'tailscale', tag: 't', endpoint: 'ts' };
  const m = serverToModel(raw);
  assert.ok(m.advanced);
  assert.deepEqual(modelToServer(m), raw);
  const rc = serverToModel({ tag: 'block', address: 'rcode://success' });
  assert.ok(rc.advanced);
});

test('describe and resolver hint', () => {
  assert.equal(describeServer(serverToModel({ type: 'tls', tag: 'x', server: '1.1.1.1', server_port: 853 })), 'tls://1.1.1.1:853');
  assert.ok(hostNeedsResolver(serverToModel({ type: 'https', tag: 'x', server: 'dns.google' })));
  assert.ok(!hostNeedsResolver(serverToModel({ type: 'https', tag: 'x', server: '8.8.8.8' })));
});

test('fakeip gets a default range', () => {
  assert.deepEqual(modelToServer({ ...emptyServerModel('fakeip'), tag: 'f' }), { type: 'fakeip', tag: 'f', inet4_range: '198.18.0.0/15' });
});
