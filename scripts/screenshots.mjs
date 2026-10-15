// Regenerate docs/screenshots/*.png from the mock backend (needs playwright):
//   PW_ROOT=$(npm root -g) node scripts/screenshots.mjs
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(`${process.env.PW_ROOT || process.cwd()}/`);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../src/frontend');
const out = path.join(here, '../docs/screenshots');
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

const shots = [
  { name: 'dashboard', page: 'dashboard', h: 820 },
  { name: 'routing', page: 'routing', h: 820 },
  { name: 'rule-editor', page: 'routing', h: 900, steps: [{ click: '.item:nth-child(7) .body' }] },
  { name: 'dns', page: 'dns', h: 1120 },
  { name: 'outbounds', page: 'outbounds', h: 820 },
  { name: 'import-links', page: 'outbounds', h: 760, steps: [{ click: '.btn-primary' }, { fill: ['textarea', 'vless://11111111-2222-3333-4444-555555555555@de.example.com:443?security=reality&sni=www.microsoft.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=ab12&type=grpc&serviceName=svc#Germany\ntrojan://secret@tr.example.com:443#Turkey'] }] },
  { name: 'dashboard-light-en', page: 'dashboard', h: 820, lang: 'en', theme: 'light', scheme: 'light' },
  { name: 'routing-en', page: 'routing', h: 820, lang: 'en' },
];

const browser = await chromium.launch();
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: s.h }, colorScheme: s.scheme || 'dark', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript((st) => {
    localStorage.setItem('sbgui:settings', JSON.stringify(st));
    localStorage.setItem('sbgui:configDetected', 'true');
  }, { lang: s.lang || 'fa', theme: s.theme || 'dark', unit: 'sing-box.service', configPath: '/etc/sing-box/config.json', restart: 'auto' });
  await page.goto(`${base}?mock=running#/${s.page}`);
  await page.waitForSelector('.shell .view-inner');
  await page.waitForTimeout(700);
  for (const step of s.steps || []) {
    if (step.click) await page.click(step.click);
    if (step.fill) await page.fill(step.fill[0], step.fill[1]);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(out, `${s.name}.png`) });
  await ctx.close();
  console.log('wrote', `${s.name}.png`);
}
await browser.close();
server.close();
