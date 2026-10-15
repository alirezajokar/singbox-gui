import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the version is the same everywhere', () => {
  const tiny = JSON.parse(read('tinyjs.json')).version;
  const pkg = JSON.parse(read('package.json')).version;
  const backend = /APP_VERSION = '([^']+)'/.exec(read('src/backend/main.js'))[1];
  assert.equal(pkg, tiny, 'package.json vs tinyjs.json');
  assert.equal(backend, tiny, 'backend APP_VERSION vs tinyjs.json');
});

test('tinyjs.json id matches the desktop file and polkit action', () => {
  const id = JSON.parse(read('tinyjs.json')).id;
  assert.match(read(`packaging/${id}.desktop`), new RegExp(`StartupWMClass=${id.replaceAll('.', '\\.')}`));
  assert.match(read('packaging/app.singboxgui.policy'), /app\.singboxgui\.helper/);
  assert.match(read('packaging/singbox-gui-helper'), /app\.singboxgui\.helper/);
});
