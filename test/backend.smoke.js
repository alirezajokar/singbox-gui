// Backend smoke test. Runs on the txiki.js runtime that ships with TinyJS:
//
//   tjs run test/backend.smoke.js        (or: npm run test:backend, with TJS=/path/to/tjs)
//
// It talks to the real backend module (no TinyJS window needed). systemd and
// polkit are not required: the paths that need them are only checked for a
// clean failure.

import { api } from '../src/backend/main.js';

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures += 1;
    console.log(`  FAIL ${msg}`);
  }
}

const base = `/tmp/singbox-gui-smoke-${tjs.pid}`;
await tjs.makeDir(`${base}/data`, { recursive: true });
await tjs.makeDir(`${base}/tmp`, { recursive: true });
const app = { paths: { data: `${base}/data`, temp: `${base}/tmp`, home: base } };
const cfgPath = `${base}/config.json`;

const good = JSON.stringify({ log: { level: 'info' }, outbounds: [{ type: 'direct', tag: 'direct' }], route: { final: 'direct' } }, null, 2);
const bad = JSON.stringify({ log: { level: 'nope' } });

console.log('sys.info');
const info = await api['sys.info']({ unit: 'sing-box.service' }, app);
ok(typeof info.appVersion === 'string', 'reports the app version');
ok(typeof info.user === 'string' && info.user.length > 0, 'reports the user');

console.log('svc.status');
const st = await api['svc.status']({ unit: 'sing-box.service' });
ok(typeof st === 'object' && 'active' in st && 'loaded' in st, 'returns a status object');

console.log('cfg.read / cfg.write');
const missing = await api['cfg.read']({ path: cfgPath });
ok(missing.ok && missing.exists === false, 'a missing file is reported, not thrown');

const syntax = await api['cfg.write']({ path: cfgPath, unit: 'sing-box.service', text: '{ nope', restart: 'no' }, app);
ok(!syntax.ok && syntax.stage === 'parse', 'invalid JSON is refused before anything is written');

const w1 = await api['cfg.write']({ path: cfgPath, unit: 'sing-box.service', text: good, restart: 'no' }, app);
ok(w1.ok, `a valid config is written (${w1.ok ? 'ok' : JSON.stringify(w1)})`);
const r1 = await api['cfg.read']({ path: cfgPath });
ok(r1.ok && r1.exists && r1.text === good, 'the file on disk matches what was written');

if (info.singbox.path) {
  const w2 = await api['cfg.write']({ path: cfgPath, unit: 'sing-box.service', text: bad, restart: 'no' }, app);
  ok(!w2.ok && w2.stage === 'check', 'sing-box rejects a bad config and nothing is overwritten');
  const r2 = await api['cfg.read']({ path: cfgPath });
  ok(r2.text === good, 'the previous config is still intact');
} else {
  console.log('  skip sing-box validation (binary not installed)');
}

const good2 = good.replace('"info"', '"warn"');
const w3 = await api['cfg.write']({ path: cfgPath, unit: 'sing-box.service', text: good2, restart: 'no' }, app);
ok(w3.ok, 'a second write succeeds');
const backups = await api['backup.list']({}, app);
ok(backups.length >= 1, 'the previous version was backed up');
if (backups.length) {
  const text = await api['backup.read']({ name: backups[0].name }, app);
  ok(text === good, 'the backup holds the previous content');
}
let threw = false;
try {
  await api['backup.read']({ name: '../../etc/passwd' }, app);
} catch {
  threw = true;
}
ok(threw, 'backup names are validated (no path traversal)');

console.log('cfg.detect');
const det = await api['cfg.detect']({ unit: 'sing-box.service' });
ok(Array.isArray(det.candidates) && det.candidates.length > 0, 'always offers a candidate path');

console.log('logs.get');
const logs = await api['logs.get']({ unit: 'sing-box.service', lines: 20 });
ok(typeof logs === 'object' && 'ok' in logs, 'returns a result object even without a journal');

console.log('svc.do without a helper / pkexec fails cleanly');
const act = await api['svc.do']({ unit: 'sing-box.service', action: 'start' });
ok(act.ok === false && typeof act.reason === 'string', `start does not crash (${act.reason || 'ok'})`);

await tjs.remove(base, { recursive: true }).catch(() => {});
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
tjs.exit(failures ? 1 : 0);
