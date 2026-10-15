// Lists every translation key used in the frontend (t('key'), dynamic ones expanded).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../src/frontend/js', import.meta.url).pathname;
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.endsWith('locales.js') && !p.endsWith('mock.js') && !p.endsWith('/i18n.js')) files.push(p);
  }
})(root);

const keys = new Set();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*`([^`$]+)`/g)) keys.add(m[1]);
  // dynamic: t(`cond.${...}`) -> prefix handled by dynamicPrefixes below
}
export const dynamicPrefixes = [...new Set(files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bt\(\s*`([^`]*)\$\{/g)].map((m) => m[1])))];
export const staticKeys = [...keys].sort();
if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) {
  console.log(JSON.stringify({ staticKeys, dynamicPrefixes }, null, 1));
}
