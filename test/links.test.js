import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLink, parseLinks, b64encode, describeOutbound } from '../src/frontend/js/links.js';

const uuid = '11111111-2222-3333-4444-555555555555';

test('vless + reality + grpc', () => {
  const r = parseLink(`vless://${uuid}@example.com:443?encryption=none&security=reality&sni=www.microsoft.com&fp=chrome&pbk=PUB&sid=ab12&type=grpc&serviceName=svc&flow=xtls-rprx-vision#My%20Node`);
  assert.ok(r.ok);
  assert.deepEqual(r.outbound, {
    type: 'vless',
    tag: 'My Node',
    server: 'example.com',
    server_port: 443,
    uuid,
    flow: 'xtls-rprx-vision',
    tls: { enabled: true, server_name: 'www.microsoft.com', utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'PUB', short_id: 'ab12' } },
    transport: { type: 'grpc', service_name: 'svc' },
  });
  assert.equal(describeOutbound(r.outbound), 'vless · reality · grpc');
});

test('vless + tls + ws', () => {
  const r = parseLink(`vless://${uuid}@1.2.3.4:8443?security=tls&sni=a.com&type=ws&path=%2Fws%3Fed%3D2048&host=a.com&alpn=h2,http/1.1&allowInsecure=1#n`);
  assert.ok(r.ok);
  assert.deepEqual(r.outbound.tls, { enabled: true, server_name: 'a.com', insecure: true, alpn: ['h2', 'http/1.1'] });
  assert.deepEqual(r.outbound.transport, { type: 'ws', path: '/ws?ed=2048', headers: { Host: 'a.com' } });
});

test('vmess base64 json', () => {
  const j = { v: '2', ps: 'vm', add: 'v.example.com', port: '443', id: uuid, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'v.example.com', path: '/p', tls: 'tls', sni: 'v.example.com' };
  const r = parseLink('vmess://' + b64encode(JSON.stringify(j)));
  assert.ok(r.ok);
  assert.equal(r.outbound.tag, 'vm');
  assert.equal(r.outbound.type, 'vmess');
  assert.equal(r.outbound.uuid, uuid);
  assert.equal(r.outbound.server_port, 443);
  assert.deepEqual(r.outbound.transport, { type: 'ws', path: '/p', headers: { Host: 'v.example.com' } });
  assert.equal(r.outbound.tls.server_name, 'v.example.com');
});

test('trojan defaults to tls', () => {
  const r = parseLink('trojan://pass%40word@t.example.com:443?sni=t.example.com#tj');
  assert.ok(r.ok);
  assert.equal(r.outbound.password, 'pass@word');
  assert.equal(r.outbound.tls.enabled, true);
  const plain = parseLink('trojan://p@h.com:80?security=none');
  assert.equal(plain.outbound.tls, undefined);
});

test('shadowsocks SIP002 and legacy', () => {
  const cred = b64encode('aes-256-gcm:secret');
  const a = parseLink(`ss://${cred}@s.example.com:8388#ss1`);
  assert.deepEqual(a.outbound, { type: 'shadowsocks', tag: 'ss1', server: 's.example.com', server_port: 8388, method: 'aes-256-gcm', password: 'secret' });
  const b = parseLink('ss://' + b64encode('chacha20-ietf-poly1305:pw:with:colons@1.2.3.4:443') + '#legacy');
  assert.equal(b.outbound.password, 'pw:with:colons');
  assert.equal(b.outbound.server, '1.2.3.4');
  const c = parseLink(`ss://${cred}@s.example.com:8388/?plugin=v2ray-plugin#p`);
  assert.deepEqual(c.warnings, ['ss-plugin']);
});

test('hysteria2 and tuic', () => {
  const h = parseLink('hy2://secret@h.example.com:8443?sni=h.example.com&insecure=1&obfs=salamander&obfs-password=ob#hy');
  assert.deepEqual(h.outbound, {
    type: 'hysteria2', tag: 'hy', server: 'h.example.com', server_port: 8443, password: 'secret',
    tls: { enabled: true, server_name: 'h.example.com', insecure: true },
    obfs: { type: 'salamander', password: 'ob' },
  });
  const t = parseLink(`tuic://${uuid}:pw@t.example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=t.example.com#tu`);
  assert.equal(t.outbound.uuid, uuid);
  assert.equal(t.outbound.password, 'pw');
  assert.equal(t.outbound.congestion_control, 'bbr');
  assert.deepEqual(t.outbound.tls.alpn, ['h3']);
});

test('errors', () => {
  assert.equal(parseLink('hello').ok, false);
  assert.equal(parseLink('foo://x').error, 'unsupported-scheme:foo');
  assert.equal(parseLink('vless://nope').ok, false);
  assert.equal(parseLink(`vless://${uuid}@h.com:443?type=xhttp`).error, 'unsupported-transport:xhttp');
});

test('many links, base64 subscription, unique tags', () => {
  const l1 = `vless://${uuid}@a.com:443?security=tls#same`;
  const l2 = `trojan://p@b.com:443#same`;
  const r = parseLinks([l1, l2, 'junk'].join('\n'), ['direct']);
  assert.deepEqual(r.outbounds.map((o) => o.tag), ['same', 'same-2']);
  assert.equal(r.errors.length, 1);
  const sub = parseLinks(b64encode([l1, l2].join('\n')));
  assert.equal(sub.outbounds.length, 2);
});
