// In-memory stand-in for the backend, used only when the page runs outside
// the TinyJS app (a normal browser). It makes design work and automated UI
// tests possible without systemd or root.

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const MODE = params.get('mock') || 'running'; // running | stopped | failed | nounit | nofile

const SAMPLE = {
  log: { level: 'info', timestamp: true },
  dns: {
    servers: [
      { type: 'https', tag: 'cloudflare-doh', server: '1.1.1.1', detour: 'proxy' },
      { type: 'udp', tag: 'shecan', server: '178.22.122.100' },
      { type: 'local', tag: 'local' },
    ],
    rules: [
      { domain_suffix: ['.ir'], action: 'route', server: 'shecan' },
      { rule_set: ['geosite-category-ads-all'], action: 'reject' },
    ],
    final: 'cloudflare-doh',
    strategy: 'prefer_ipv4',
  },
  inbounds: [
    { type: 'tun', tag: 'tun-in', address: ['172.19.0.1/30'], auto_route: true, strict_route: true, stack: 'mixed' },
    { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
  ],
  outbounds: [
    { type: 'direct', tag: 'direct' },
    { type: 'vless', tag: 'Germany-Reality', server: 'de.example.com', server_port: 443, uuid: '11111111-2222-3333-4444-555555555555', flow: 'xtls-rprx-vision', tls: { enabled: true, server_name: 'www.microsoft.com', utls: { enabled: true, fingerprint: 'chrome' }, reality: { enabled: true, public_key: 'A'.repeat(43), short_id: 'ab12' } } },
    { type: 'trojan', tag: 'Turkey-WS', server: 'tr.example.com', server_port: 443, password: 'secret', tls: { enabled: true, server_name: 'tr.example.com' }, transport: { type: 'ws', path: '/ws' } },
    { type: 'hysteria2', tag: 'Finland-HY2', server: 'fi.example.com', server_port: 8443, password: 'secret', tls: { enabled: true, server_name: 'fi.example.com' } },
    { type: 'urltest', tag: 'auto', outbounds: ['Germany-Reality', 'Turkey-WS', 'Finland-HY2'], url: 'https://www.gstatic.com/generate_204', interval: '3m' },
    { type: 'selector', tag: 'proxy', outbounds: ['auto', 'Germany-Reality', 'Turkey-WS', 'Finland-HY2'], default: 'auto' },
  ],
  route: {
    rule_set: [
      { type: 'remote', tag: 'geoip-ir', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ir.srs', update_interval: '7d' },
      { type: 'remote', tag: 'geosite-category-ir', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ir.srs', update_interval: '7d' },
      { type: 'remote', tag: 'geosite-category-ads-all', format: 'binary', url: 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ads-all.srs', update_interval: '7d' },
    ],
    rules: [
      { action: 'sniff' },
      { protocol: 'dns', action: 'hijack-dns' },
      { ip_is_private: true, action: 'route', outbound: 'direct' },
      { domain_suffix: ['ir', 'ایران.com', 'digikala.com'], action: 'route', outbound: 'direct' },
      { rule_set: ['geosite-category-ir', 'geoip-ir'], action: 'route', outbound: 'direct' },
      { rule_set: ['geosite-category-ads-all'], action: 'reject' },
      { domain_suffix: ['openai.com', 'chatgpt.com'], domain_keyword: ['openai'], action: 'route', outbound: 'Germany-Reality' },
      { protocol: ['quic'], action: 'reject' },
    ],
    final: 'proxy',
    auto_detect_interface: true,
    default_domain_resolver: 'local',
  },
  experimental: { cache_file: { enabled: true }, clash_api: { external_controller: '127.0.0.1:9090' } },
};

const LOG = [
  'INFO  [3182945091 0ms] inbound/tun[tun-in]: started at tun0',
  'INFO  [4021990001 12ms] router: found rule-set geosite-category-ir (4821 rules)',
  'INFO  [1129841200 0ms] outbound/urltest[auto]: using Germany-Reality (143ms)',
  'INFO  [2312000012 55ms] inbound/tun[tun-in]: inbound connection from 172.19.0.1:51122',
  'INFO  [2312000012 55ms] outbound/direct[direct]: outbound connection to digikala.com:443',
  'WARN  [1991200111 0ms] dns: exchange failed for cdn.example.org. IN A: context deadline exceeded',
  'INFO  [9821111201 20ms] outbound/vless[Germany-Reality]: outbound connection to chatgpt.com:443',
  'ERROR [0000000000 0ms] connection: connection reset by peer',
  'INFO  [7711100021 0ms] sing-box started (1.4s)',
];

let service = {
  loaded: MODE !== 'nounit',
  active: MODE === 'running',
  state: MODE === 'running' ? 'active' : MODE === 'failed' ? 'failed' : 'inactive',
  enabled: true,
  since: Math.floor(Date.now() / 1000) - 3 * 3600 - 421,
};
let fileText = MODE === 'nofile' ? null : JSON.stringify(SAMPLE, null, 2) + '\n';
const backups = [{ name: '20261014-211503.json', size: 4120 }, { name: '20261012-093011.json', size: 3977 }];
let passwordless = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// handle for automated UI tests
if (typeof window !== 'undefined') {
  window.__sbguiMock = {
    get file() { return fileText; },
    get service() { return { ...service }; },
    calls: [],
  };
}

function statusObj() {
  return {
    available: true,
    loaded: service.loaded,
    state: service.state,
    sub: service.active ? 'running' : service.state === 'failed' ? 'failed' : 'dead',
    active: service.active,
    enabled: service.enabled,
    unitFileState: service.enabled ? 'enabled' : 'disabled',
    since: service.active ? service.since : 0,
    pid: service.active ? 2417 : 0,
    memory: service.active ? 58 * 1024 * 1024 : 0,
    result: service.state === 'failed' ? 'exit-code' : 'success',
    restarts: 0,
  };
}

export async function call(name, p = {}) {
  if (typeof window !== 'undefined') window.__sbguiMock.calls.push(name);
  await sleep(60);
  switch (name) {
    case 'sys.info':
      return { appVersion: '0.1.0', user: 'demo', home: '/home/demo', dataDir: '/home/demo/.local/share/singbox-gui', singbox: { path: '/usr/bin/sing-box', version: '1.14.3' }, helper: '/usr/lib/singbox-gui/helper', helperInstalled: true, pkexec: true, unitFound: service.loaded, systemd: true };
    case 'svc.status':
      return statusObj();
    case 'svc.do': {
      await sleep(700);
      if (p.action === 'start' || p.action === 'restart') {
        service.active = true;
        service.state = 'active';
        service.since = Math.floor(Date.now() / 1000);
      } else if (p.action === 'stop') {
        service.active = false;
        service.state = 'inactive';
      } else if (p.action === 'enable') service.enabled = true;
      else if (p.action === 'disable') service.enabled = false;
      return { ok: true, status: statusObj(), logs: '' };
    }
    case 'cfg.read':
      return fileText === null ? { ok: true, exists: false, text: '', writable: false } : { ok: true, exists: true, text: fileText, writable: false };
    case 'cfg.check':
      return { ok: true, output: '', skipped: false };
    case 'cfg.write':
      await sleep(500);
      fileText = p.text;
      return { ok: true, restarted: p.restart !== 'no' && service.active, status: statusObj(), logs: '' };
    case 'cfg.detect':
      return { candidates: ['/etc/sing-box/config.json'], found: true };
    case 'logs.get':
      return { ok: true, text: LOG.map((l, i) => `2026-10-15T08:${String(10 + i).padStart(2, '0')}:11+0330 host sing-box[2417]: ${l}`).join('\n') };
    case 'backup.list':
      return backups;
    case 'backup.read':
      return fileText || '{}';
    case 'priv.get':
      return { passwordless };
    case 'priv.set':
      passwordless = !!p.on;
      return { ok: true, passwordless };
    case 'file.write':
      return true;
    case 'file.read':
      return '{}';
    default:
      throw new Error(`mock: unknown call ${name}`);
  }
}
