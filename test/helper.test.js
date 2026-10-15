// Tests for the privileged helper (packaging/singbox-gui-helper).
//
// The refusal cases need no privileges and always run. The write/read cases
// need root (they touch /etc/sing-box) and run only when this process is root,
// e.g. in CI:  sudo -E env "PATH=$PATH" node --test test/helper.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), '../packaging/singbox-gui-helper');
const run = (args, input = '') => spawnSync('sh', [helper, ...args], { input, encoding: 'utf8' });

test('refuses unknown commands and bad arguments', () => {
  for (const args of [
    [],
    ['bogus'],
    ['service', 'rm', 'sing-box'],
    ['service', 'start', '-x'],
    ['service', 'start', 'a b'],
    ['service', 'start'],
    ['logs', 'sing-box', '99999'],
    ['logs', 'sing-box', 'abc'],
    ['logs', '-n', '5'],
    ['passwordless', 'maybe'],
  ]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(' ')} -> ${r.stderr}`);
  }
});

test('refuses config paths outside the sing-box directories', () => {
  for (const p of [
    '/etc/passwd',
    '/etc/shadow.json',
    '/etc/sing-box/../shadow.json',
    '/etc/sing-box/./x.json',
    '/etc/sing-box//x.json',
    'relative.json',
    '/home/user/config.json',
    '/etc/sing-box/config.txt',
  ]) {
    assert.equal(run(['read', p]).status, 2, `read ${p}`);
    assert.equal(run(['write', p, 'sing-box.service', 'keep'], '{}').status, 2, `write ${p}`);
  }
});

test('passwordless needs pkexec and a normal user', () => {
  const r = run(['passwordless', 'on']);
  assert.equal(r.status, 2);
});

const root = typeof process.getuid === 'function' && process.getuid() === 0;
const haveSingbox = spawnSync('sing-box', ['version']).status === 0;
const dir = '/etc/sing-box';
const file = `${dir}/helper-test.json`;
const cleanup = () => {
  rmSync(file, { force: true });
  rmSync(`${file}.singbox-gui.bak`, { force: true });
};

test('write: validates, keeps a backup, and read returns the content', { skip: !root && 'needs root' }, () => {
  const created = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  cleanup();
  try {
    const good1 = JSON.stringify({ outbounds: [{ type: 'direct', tag: 'direct' }] });
    const good2 = JSON.stringify({ outbounds: [{ type: 'direct', tag: 'other' }] });
    let r = run(['write', file, 'sing-box.service', 'keep'], good1);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(file, 'utf8'), good1);
    r = run(['write', file, 'sing-box.service', 'keep'], good2);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(`${file}.singbox-gui.bak`, 'utf8'), good1);
    assert.equal(run(['read', file]).stdout, good2);
    assert.equal(run(['write', file, 'sing-box.service', 'keep'], '').status, 2, 'empty input is refused');
    assert.equal(readFileSync(file, 'utf8'), good2);
    if (haveSingbox) {
      r = run(['write', file, 'sing-box.service', 'keep'], '{"log":{"level":"nope"}}');
      assert.equal(r.status, 3, 'a config sing-box rejects is not written');
      assert.equal(readFileSync(file, 'utf8'), good2);
    }
  } finally {
    cleanup();
    if (created) rmSync(dir, { recursive: true, force: true });
  }
});

test('write keeps ownership and mode of an existing file', { skip: !root && 'needs root' }, () => {
  const created = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, '{}', { mode: 0o600 });
    const r = run(['write', file, 'sing-box.service', 'keep'], JSON.stringify({ outbounds: [{ type: 'direct', tag: 'direct' }] }));
    assert.equal(r.status, 0, r.stderr);
    const mode = spawnSync('stat', ['-c', '%a', file], { encoding: 'utf8' }).stdout.trim();
    assert.equal(mode, '600');
  } finally {
    cleanup();
    if (created) rmSync(dir, { recursive: true, force: true });
  }
});
