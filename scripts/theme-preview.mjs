// Renders the app with each candidate dark palette and writes screenshots plus
// an overview sheet. Nothing here changes the app; the palettes are injected
// into the page after load.
//   PW_ROOT=$(npm root -g) OUT=/some/dir node scripts/theme-preview.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTES, css } from './theme-palettes.mjs';

const require = createRequire(`${process.env.PW_ROOT || process.cwd()}/`);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../src/frontend');
const out = process.env.OUT || path.join(here, '../build/theme-preview');
fs.mkdirSync(out, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const file = path.join(root, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

// What the app ships today, for comparison.
const CURRENT = {
  id: 'current', name: 'Current (navy)', note: 'What you have now',
  tokens: { bg: '#0a0c13', 'bg-2': '#0e111a', surface: '#141826', 'surface-2': '#1a2030', 'surface-3': '#212840', border: '#252c42', 'border-strong': '#353e5c', text: '#e9ecf6', 'text-2': '#b0b8cf', muted: '#939cb5', 'control-border': '#727c9c', 'code-bg': '#0d1018' },
  keep: true,
};

const SHOTS = [
  { key: 'dashboard', page: 'dashboard', h: 700 },
  { key: 'routing', page: 'routing', h: 820, steps: [{ click: '.item:nth-child(7) .body' }] },
  { key: 'dns', page: 'dns', h: 820 },
];

const browser = await chromium.launch();
const shots = {};
for (const p of [CURRENT, ...PALETTES]) {
  shots[p.id] = {};
  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: s.h }, colorScheme: 'dark', deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addInitScript((st) => {
      localStorage.setItem('sbgui:settings', JSON.stringify(st));
      localStorage.setItem('sbgui:configDetected', 'true');
    }, { lang: 'fa', theme: 'dark', unit: 'sing-box.service', configPath: '/etc/sing-box/config.json', restart: 'auto' });
    await page.goto(`${base}?mock=running#/${s.page}`);
    await page.waitForSelector('.shell .view-inner');
    if (!p.keep) await page.addStyleTag({ content: css(p.tokens) });
    await page.waitForTimeout(700);
    for (const step of s.steps || []) {
      if (step.click) await page.click(step.click);
      await page.waitForTimeout(500);
    }
    const file = path.join(out, `${p.id}-${s.key}.png`);
    await page.screenshot({ path: file });
    shots[p.id][s.key] = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    await ctx.close();
  }
  console.log('captured', p.id);
}

const swatches = (t) => ['bg', 'bg-2', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'control-border', 'muted', 'text-2', 'text']
  .map((k) => `<div class="sw"><i style="background:${t[k]}"></i><b>${k}</b><span>${t[k]}</span></div>`).join('');

async function sheet(name, html, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#202020;color:#eee;font:14px/1.4 system-ui,sans-serif;padding:24px}
    h2{margin:0 0 2px;font-size:20px} p{margin:0 0 12px;color:#aaa}
    .sws{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap}
    .sw{width:84px;font:11px/1.3 ui-monospace,monospace}
    .sw i{display:block;height:34px;border-radius:6px;border:1px solid #ffffff22;margin-bottom:4px}
    .sw b{display:block;font-weight:600;color:#ddd} .sw span{color:#999}
    img{display:block;border-radius:10px;border:1px solid #ffffff1f}
    .card{background:#2a2a2a;border-radius:14px;padding:18px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}
    .pair{display:flex;gap:16px}
  </style>${html}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  await ctx.close();
  console.log('wrote', name);
}

const all = [CURRENT, ...PALETTES];
await sheet('overview.png',
  `<div class="grid">${all.map((p) => `<div class="card"><h2>${p.name}</h2><p>${p.note}</p><div class="sws">${swatches(p.tokens)}</div><img width="560" src="${shots[p.id].dashboard}"></div>`).join('')}</div>`,
  1240);
for (const p of PALETTES) {
  await sheet(`${p.id}.png`,
    `<div class="card"><h2>${p.name}</h2><p>${p.note}</p><div class="sws">${swatches(p.tokens)}</div><div class="pair"><img width="760" src="${shots[p.id].dashboard}"><img width="760" src="${shots[p.id].routing}"></div></div>`,
    1640);
}
await browser.close();
server.close();
