import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLogLine, parseLog, filterLog, levelRank } from '../src/frontend/js/logs.js';

const sample = [
  '-- Journal begins at Mon 2026-10-12 --',
  '2026-10-15T08:11:11+0330 host sing-box[2417]: \x1b[36mINFO\x1b[0m[0000] router: found rule-set geosite-category-ir',
  '2026-10-15T08:12:00+0330 host sing-box[2417]: WARN [1991 0ms] dns: exchange failed for cdn.example.org',
  '',
  '2026-10-15T08:13:05+0330 host sing-box[2417]: ERROR [0 0ms] connection: connection reset by peer',
  '2026-10-15T08:14:00+0330 host sing-box[2417]: outbound/direct[direct]: outbound connection to digikala.com:443',
  'plain line without a timestamp but with FATAL inside',
].join('\n');

test('parses a journal line', () => {
  const e = parseLogLine('2026-10-15T08:11:11+0330 host sing-box[2417]: INFO [4021990001 12ms] router: ready');
  assert.deepEqual(e, { date: '2026-10-15', time: '08:11:11', msg: 'INFO [4021990001 12ms] router: ready', level: 'INFO' });
});

test('strips colour codes and finds the level', () => {
  const e = parseLogLine('2026-10-15T08:11:11+0330 host sing-box[2417]: \x1b[31mERROR\x1b[0m[0000] boom');
  assert.equal(e.level, 'ERROR');
  assert.ok(!e.msg.includes('\x1b'));
});

test('lines without a level default to INFO; lines without a timestamp still work', () => {
  assert.equal(parseLogLine('2026-10-15T08:14:00+0330 host sing-box[1]: outbound/direct: ok').level, 'INFO');
  const e = parseLogLine('plain line with FATAL inside');
  assert.equal(e.level, 'FATAL');
  assert.equal(e.time, '');
});

test('parseLog drops blanks and journal markers', () => {
  assert.equal(parseLog(sample).length, 5);
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog(null), []);
});

test('level filter', () => {
  const all = parseLog(sample);
  assert.equal(filterLog(all, { level: 'all' }).length, 5);
  assert.deepEqual(filterLog(all, { level: 'warn' }).map((e) => e.level), ['WARN', 'ERROR', 'FATAL']);
  assert.deepEqual(filterLog(all, { level: 'error' }).map((e) => e.level), ['ERROR', 'FATAL']);
  assert.ok(levelRank('ERROR') > levelRank('WARN'));
});

test('search is case-insensitive and combines with the level filter', () => {
  const all = parseLog(sample);
  assert.equal(filterLog(all, { query: 'DIGIKALA' }).length, 1);
  assert.equal(filterLog(all, { query: 'connection', level: 'error' }).length, 1);
  assert.equal(filterLog(all, { query: '  ' }).length, 5);
  assert.equal(filterLog(all, { query: 'nothing-like-this' }).length, 0);
});
