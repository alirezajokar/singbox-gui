// Measures the colour pairs the UI really renders, for both themes, from the
// tokens in app.css (WCAG 2.2: 4.5:1 for text, 3:1 for control boundaries,
// focus rings and meaningful icons).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/frontend/css/app.css', import.meta.url), 'utf8');

function tokensOf(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, `${selectorStart} block not found`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const dark = tokensOf(':root {');
const light = { ...dark, ...tokensOf(':root[data-theme="light"] {') };

function parse(v) {
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)), a: 1 };
  }
  m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(v);
  assert.ok(m, `cannot parse colour "${v}"`);
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
}

const flat = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function solid(theme, name, over) {
  const c = parse(theme[name]);
  return over ? flat(c, over) : c.rgb;
}

for (const [themeName, theme] of [['dark', dark], ['light', light]]) {
  const surfaces = ['bg', 'bg-2', 'surface', 'surface-2', 'surface-3'];
  const check = (label, fg, bg, min) => {
    const r = ratio(fg, bg);
    assert.ok(r >= min, `${themeName}: ${label} is ${r.toFixed(2)}:1, needs ${min}:1`);
  };

  test(`${themeName}: body, secondary and muted text`, () => {
    for (const s of surfaces) {
      check(`text on ${s}`, solid(theme, 'text'), solid(theme, s), 4.5);
      check(`text-2 on ${s}`, solid(theme, 'text-2'), solid(theme, s), 4.5);
      check(`muted on ${s}`, solid(theme, 'muted'), solid(theme, s), 4.5);
    }
  });

  test(`${themeName}: status colours as text, alone and on their tint`, () => {
    for (const status of ['ok', 'warn', 'danger', 'info', 'proxy']) {
      for (const s of ['surface', 'surface-2', 'surface-3']) {
        const base = solid(theme, s);
        check(`${status} on ${s}`, solid(theme, status), base, 4.5);
        check(`${status} on its tint over ${s}`, solid(theme, status), solid(theme, `tint-${status}`, base), 4.5);
      }
    }
  });

  test(`${themeName}: control boundaries, focus ring and accent icons need 3:1`, () => {
    for (const s of ['bg', 'bg-2', 'surface', 'surface-2']) {
      check(`control-border on ${s}`, solid(theme, 'control-border'), solid(theme, s), 3);
      check(`focus ring on ${s}`, solid(theme, 'focus'), solid(theme, s), 3);
    }
    for (const s of ['surface', 'surface-2']) check(`accent on ${s}`, solid(theme, 'accent'), solid(theme, s), 3);
  });

  test(`${themeName}: white text on the primary button gradient`, () => {
    for (const stop of ['grad-a', 'grad-b']) check(`white on ${stop}`, [255, 255, 255], solid(theme, stop), 4.5);
  });
}
