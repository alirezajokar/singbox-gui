// UI end-to-end test against the in-memory mock backend (no systemd, no root).
//
//   npm i -g playwright && npx playwright install chromium   (once)
//   node test/e2e/ui.e2e.mjs
//
// PW_ROOT can point at a node_modules directory that contains `playwright`.

import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(`${process.env.PW_ROOT || process.cwd()}/`);
const { chromium } = require('playwright');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/frontend');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  fs.readFile(p, (e, d) => {
    if (e) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(0);
await new Promise((r) => server.on('listening', r));
const base = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch();
let failed = 0;
const errors = [];

async function scenario(name, fn, { lang = 'en', mock = 'running' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] console: ${m.text()}`));
  await page.addInitScript((s) => {
    localStorage.setItem('sbgui:settings', JSON.stringify(s));
    localStorage.setItem('sbgui:configDetected', 'true');
  }, { lang, theme: 'dark', unit: 'sing-box.service', configPath: '/etc/sing-box/config.json', restart: 'auto' });
  try {
    await fn(page, (hash) => page.goto(`${base}?mock=${mock}#/${hash}`).then(() => page.waitForSelector('.shell .view-inner', { timeout: 8000 })));
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`);
    await page.screenshot({ path: `/tmp/e2e-fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  }
  await ctx.close();
}

const savedConfig = (page) => page.evaluate(() => JSON.parse(window.__sbguiMock.file));
const clickSave = async (page) => {
  await page.click('.savebar .btn-primary');
  await page.waitForFunction(() => !document.querySelector('.savebar.show'), null, { timeout: 5000 });
};

await scenario('dashboard shows the running service', async (page, open) => {
  await open('dashboard');
  await page.waitForSelector('.hero.on');
  assert.match(await page.textContent('.hero-text h2'), /running/);
});

await scenario('the dashboard no longer shows logs; they live on their own page', async (page, open) => {
  await open('dashboard');
  await page.waitForSelector('.hero.on');
  assert.equal(await page.locator('.logs').count(), 0, 'no log box on the dashboard');
  await page.click('.hero-actions button:has-text("View logs")');
  await page.waitForSelector('.logs.tall .ln.lv-INFO');
  assert.match(await page.textContent('.topbar h1'), /Logs/);
  assert.ok((await page.locator('.logs .ln').count()) >= 5);
});

await scenario('logs page: level filter and search', async (page, open) => {
  await open('logs');
  await page.waitForSelector('.logs .ln.lv-INFO');
  const total = await page.locator('.logs .ln').count();
  await page.click('.segmented button:has-text("Errors only")');
  assert.equal(await page.locator('.logs .ln').count(), 1);
  assert.equal(await page.locator('.logs .ln.lv-ERROR').count(), 1);
  await page.click('.segmented button:has-text("All")');
  assert.equal(await page.locator('.logs .ln').count(), total);
  await page.fill('input[placeholder="Search the log…"]', 'digikala');
  assert.equal(await page.locator('.logs .ln').count(), 1);
  await page.fill('input[placeholder="Search the log…"]', 'zzz-nothing');
  assert.match(await page.textContent('.logs'), /No line matches/);
  assert.match(await page.textContent('.card-body'), /0 of \d+ lines/);
});

await scenario('power button stops and starts the service', async (page, open) => {
  await open('dashboard');
  await page.click('.power');
  await page.waitForFunction(() => window.__sbguiMock.service.active === false, null, { timeout: 5000 });
  await page.waitForSelector('.hero:not(.on) .power:not(.busy)', { timeout: 5000 });
  await page.click('.power');
  await page.waitForFunction(() => window.__sbguiMock.service.active === true, null, { timeout: 5000 });
  await page.waitForSelector('.hero.on', { timeout: 5000 });
});

await scenario('missing service is explained', async (page, open) => {
  await open('dashboard');
  await page.waitForSelector('.notice.warn');
  assert.ok((await page.locator('.power').isDisabled()));
}, { mock: 'nounit' });

await scenario('first run without a config offers to create one', async (page, open) => {
  await open('dashboard');
  await page.waitForSelector('.savebar.show');
  assert.match(await page.textContent('.savebar'), /not created/);
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.route && cfg.inbounds);
}, { mock: 'nofile' });

await scenario('add a TLD rule and save', async (page, open) => {
  await open('routing');
  await page.click('button:has-text("New rule")');
  await page.click('.modal button.opt:has-text("Country suffix")');
  await page.fill('.modal .chips input', 'cn');
  await page.keyboard.press('Enter');
  await page.click('.modal .picker button.opt:has-text("proxy")');
  await page.click('.modal .modal-foot .btn-primary');
  await page.waitForSelector('.savebar.show');
  await clickSave(page);
  const cfg = await savedConfig(page);
  const rule = cfg.route.rules.find((r) => (r.domain_suffix || []).includes('.cn'));
  assert.ok(rule, 'rule was written');
  assert.deepEqual([rule.action, rule.outbound], ['route', 'proxy']);
});

await scenario('a disabled rule is not written to sing-box but is remembered', async (page, open) => {
  await open('routing');
  const before = (await savedConfig(page)).route.rules.length;
  await page.click('.item:nth-child(3) .switch');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.equal(cfg.route.rules.length, before - 1);
  await page.reload();
  await page.waitForSelector('.item.off');
});

await scenario('reorder with the arrow buttons', async (page, open) => {
  await open('routing');
  const first = await page.textContent('.item:nth-child(4) .conds');
  await page.click('.item:nth-child(4) button[aria-label="Move up"]');
  assert.equal(await page.textContent('.item:nth-child(3) .conds'), first);
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.route.rules[2].domain_suffix);
});

await scenario('template adds the rule and its rule-set', async (page, open) => {
  await open('routing');
  await page.click('button:has-text("Templates")');
  await page.click('.template:has-text("Telegram")');
  await page.waitForSelector('.modal');
  await page.click('.modal .modal-foot .btn-primary');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.route.rule_set.some((r) => r.tag === 'geosite-telegram'));
  assert.ok(cfg.route.rules.some((r) => (r.rule_set || []).includes('geosite-telegram')));
});

await scenario('deleting a rule is instant and can be undone', async (page, open) => {
  await open('routing');
  const n = await page.locator('.list .item').count();
  await page.click('.item:nth-child(2) button[aria-label="Delete"]');
  assert.equal(await page.locator('.list .item').count(), n - 1);
  await page.click('.toast button:has-text("Undo")');
  assert.equal(await page.locator('.list .item').count(), n);
  assert.equal(await page.locator('.toast').count(), 0, 'the undo toast goes away once used');
});

await scenario('paste a mixed list into a rule', async (page, open) => {
  await open('routing');
  await page.click('button:has-text("New rule")');
  await page.click('.modal button:has-text("Paste a list")');
  await page.fill('.modal textarea', 'google.com\nir\nkeyword:ads\n10.0.0.0/8');
  await page.click('.modal button:has-text("Add"):not(.modal-foot *)');
  assert.ok(await page.locator('.modal .cond-block').count() >= 4);
});

await scenario('DNS: add a server from a preset, edit the default', async (page, open) => {
  await open('dns');
  await page.click('button:has-text("New server")');
  await page.click('.modal button.opt:has-text("quad9-doh")');
  await page.click('.modal .modal-foot .btn-primary');
  await page.waitForSelector('.savebar.show');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.dns.servers.some((s) => s.tag === 'quad9-doh' && s.type === 'https' && s.server === '9.9.9.9'));
});

await scenario('DNS: renaming a server updates the rules', async (page, open) => {
  await open('dns');
  await page.click('.list .item:has-text("shecan") button[aria-label="Edit"]');
  await page.fill('.modal input[placeholder="google"]', 'shecan2');
  await page.click('.modal .modal-foot .btn-primary');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.dns.rules.some((r) => r.server === 'shecan2'));
  assert.ok(!JSON.stringify(cfg).includes('"shecan"'));
});

await scenario('import share links into a group', async (page, open) => {
  await open('outbounds');
  await page.click('button:has-text("Import from links")');
  await page.fill('.modal textarea', 'trojan://pw@t.example.com:443#new-trojan\nss://YWVzLTI1Ni1nY206c2VjcmV0@s.example.com:8388#new-ss\nfoo://bad');
  await page.waitForSelector('.preview-item.bad');
  await page.click('.modal .modal-foot .btn-primary');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.outbounds.some((o) => o.tag === 'new-trojan'));
  assert.ok(cfg.outbounds.find((o) => o.tag === 'proxy').outbounds.includes('new-ss'));
});

await scenario('renaming an outbound updates rules and groups', async (page, open) => {
  await open('outbounds');
  await page.click('.ob:has(.name:text-is("Germany-Reality")) button[aria-label="Edit"]');
  const area = page.locator('.modal textarea');
  const json = JSON.parse(await area.inputValue());
  json.tag = 'DE';
  await area.fill(JSON.stringify(json));
  await page.click('.modal .modal-foot .btn-primary');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(cfg.route.rules.some((r) => r.outbound === 'DE'));
  assert.ok(cfg.outbounds.find((o) => o.tag === 'proxy').outbounds.includes('DE'));
  assert.ok(!JSON.stringify(cfg).includes('Germany-Reality'));
});

await scenario('deleting an outbound removes the rules that pointed at it', async (page, open) => {
  await open('outbounds');
  await page.click('.ob:has(.name:text-is("Germany-Reality")) button[aria-label="Delete"]');
  await page.click('.modal-foot .btn-danger');
  await clickSave(page);
  const cfg = await savedConfig(page);
  assert.ok(!JSON.stringify(cfg).includes('Germany-Reality'));
});

await scenario('advanced: invalid JSON is flagged, valid JSON applies', async (page, open) => {
  await open('advanced');
  await page.fill('.textarea.code', '{ nope');
  await page.waitForSelector('.textarea.invalid');
  const cfg = JSON.parse(await page.evaluate(() => window.__sbguiMock.file));
  cfg.log.level = 'debug';
  await page.fill('.textarea.code', JSON.stringify(cfg));
  await page.click('button:has-text("Apply to editor")');
  await page.waitForSelector('.savebar.show');
  await clickSave(page);
  assert.equal((await savedConfig(page)).log.level, 'debug');
});

await scenario('dangling references ask for confirmation before saving', async (page, open) => {
  await open('advanced');
  const cfg = JSON.parse(await page.evaluate(() => window.__sbguiMock.file));
  cfg.route.rules.push({ domain: ['x.com'], action: 'route', outbound: 'ghost' });
  await page.fill('.textarea.code', JSON.stringify(cfg));
  await page.click('button:has-text("Apply to editor")');
  await page.click('.savebar .btn-primary');
  await page.waitForSelector('.modal');
  assert.match(await page.textContent('.modal'), /ghost/);
  await page.click('.modal-foot .btn:has-text("Go back")');
  assert.ok((await page.locator('.savebar.show').count()) > 0, 'nothing was saved');
  await page.click('.savebar .btn-primary');
  await page.click('.modal-foot .btn-danger');
  await page.waitForFunction(() => !document.querySelector('.savebar.show'), null, { timeout: 5000 });
  assert.ok(JSON.stringify(await savedConfig(page)).includes('ghost'));
});

await scenario('settings: switching language flips direction', async (page, open) => {
  await open('settings');
  await page.click('.segmented button:has-text("فارسی")');
  await page.waitForFunction(() => document.documentElement.dir === 'rtl');
  await page.click('.segmented button:has-text("English")');
  await page.waitForFunction(() => document.documentElement.dir === 'ltr');
});

// ---------------------------------------------------------------- accessibility

/** Names of interactive controls that have no accessible name (ignores anything behind an open modal). */
const unnamedControls = (page) =>
  page.evaluate(() => {
    const nameOf = (el) => {
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
        if (t) return t;
      }
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return al.trim();
      if (el.labels && el.labels.length) {
        const t = [...el.labels].map((l) => l.textContent.trim()).join(' ').trim();
        if (t) return t;
      }
      if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') {
        const t = el.textContent.trim();
        if (t) return t;
      }
      return (el.getAttribute('title') || '').trim();
    };
    const bad = [];
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea, button, a[href], summary')) {
      if (el.closest('[inert]')) continue;
      if (!nameOf(el)) bad.push(el.outerHTML.slice(0, 140));
    }
    return bad;
  });

await scenario('every control on every page has an accessible name', async (page, open) => {
  for (const p of ['dashboard', 'routing', 'dns', 'outbounds', 'general', 'logs', 'advanced', 'settings']) {
    await open(p);
    await page.waitForTimeout(250);
    assert.deepEqual(await unnamedControls(page), [], `unnamed controls on ${p}`);
  }
});

await scenario('dialogs: every control is named, focus is trapped and restored, background is inert', async (page, open) => {
  await open('routing');
  const trigger = page.locator('button:has-text("New rule")').first();
  await trigger.click();
  await page.waitForSelector('.modal');
  assert.equal(await page.evaluate(() => document.getElementById('app').hasAttribute('inert')), true, 'page behind is inert');
  assert.deepEqual(await unnamedControls(page), [], 'unnamed controls in the rule editor');
  assert.equal(await page.evaluate(() => document.querySelector('.modal').getAttribute('aria-modal')), 'true');
  assert.ok(await page.evaluate(() => document.querySelector('.modal').getAttribute('aria-labelledby')));
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.modal')), true, `focus left the dialog on Tab #${i + 1}`);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('.modal')), true, 'focus left the dialog on Shift+Tab');
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });
  assert.equal(await page.evaluate(() => document.getElementById('app').hasAttribute('inert')), false);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'New rule', 'focus returned to the trigger');
  // other dialogs
  await page.click('button:has-text("Templates")');
  assert.deepEqual(await unnamedControls(page), [], 'unnamed controls in the templates dialog');
  await page.keyboard.press('Escape');
  await open('dns');
  await page.click('button:has-text("New server")');
  assert.deepEqual(await unnamedControls(page), [], 'unnamed controls in the DNS dialog');
  await page.keyboard.press('Escape');
  await open('outbounds');
  await page.click('button:has-text("Import from links")');
  assert.deepEqual(await unnamedControls(page), [], 'unnamed controls in the import dialog');
});

await scenario('selected options and segments expose their state, not just a colour', async (page, open) => {
  await open('settings');
  assert.equal(await page.locator('.segmented button[aria-pressed="true"]').count(), 3, 'one pressed button per segmented control');
  await open('routing');
  await page.click('button:has-text("New rule")');
  assert.ok((await page.locator('.modal .opt[aria-pressed="true"]').count()) >= 1);
  const mark = await page.evaluate(() => getComputedStyle(document.querySelector('.modal .opt[aria-pressed="true"]'), '::before').content);
  assert.match(mark, /✓/, 'a check mark marks the selected option');
});

await scenario('navigation: title, current page and focus follow the route; skip link works', async (page, open) => {
  await open('dashboard');
  // first Tab on a fresh page lands on the skip link, which is only visible while focused
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
  assert.ok(await page.evaluate(() => document.activeElement.getBoundingClientRect().top >= 0), 'the skip link is visible when focused');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
  await page.click('.nav-item:has-text("Routing")');
  await page.waitForFunction(() => document.title.startsWith('Routing'));
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'H1');
  assert.equal(await page.getAttribute('.nav-item:has-text("Routing")', 'aria-current'), 'page');
  assert.equal(await page.locator('.nav-item[aria-current="page"]').count(), 1);
});

await scenario('keyboard focus is always visible', async (page, open) => {
  await open('routing');
  await page.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'none';
      const cs = getComputedStyle(el);
      const wrap = el.closest('.chips');
      const w = wrap ? getComputedStyle(wrap) : cs;
      const own = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
      const track = el.type === 'checkbox' ? getComputedStyle(el.nextElementSibling) : null;
      const viaTrack = !!track && track.outlineStyle !== 'none' && parseFloat(track.outlineWidth) >= 2;
      const viaWrap = !!wrap && w.outlineStyle !== 'none' && parseFloat(w.outlineWidth) >= 2;
      return own || viaTrack || viaWrap ? 'ok' : `${el.tagName}.${el.className}`;
    });
    assert.equal(ring, 'ok', `no visible focus ring on Tab #${i + 1}`);
  }
});

await scenario('errors stay until dismissed; confirmations fade', async (page, open) => {
  await open('dashboard');
  await page.evaluate(async () => {
    const m = await import('/js/dom.js');
    m.toast('boom', 'error', 'details');
    m.toast('fine', 'ok');
  });
  await page.waitForSelector('.toast.error');
  await page.waitForTimeout(4200);
  assert.equal(await page.locator('.toast.error').count(), 1, 'the error is still there');
  assert.equal(await page.locator('.toast.ok').count(), 0, 'the confirmation faded');
  assert.equal(await page.getAttribute('.toast.error', 'role'), 'alert');
  await page.click('.toast.error button[aria-label="Close"]');
  assert.equal(await page.locator('.toast').count(), 0);
});

await scenario('changing the theme does not animate every colour at once', async (page, open) => {
  await open('settings');
  await page.click('.segmented button:has-text("Light")');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('no-transitions')), true, 'transitions are paused during the swap');
  await page.waitForFunction(() => !document.documentElement.classList.contains('no-transitions'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
});

await scenario('persian UI renders without errors on every page', async (page, open) => {
  for (const p of ['dashboard', 'routing', 'dns', 'outbounds', 'general', 'logs', 'advanced', 'settings']) {
    await open(p);
    assert.ok((await page.textContent('.topbar h1')).length > 0);
  }
}, { lang: 'fa' });

await browser.close();
server.close();
if (errors.length) {
  failed += 1;
  console.log('\nbrowser errors:\n' + [...new Set(errors)].join('\n'));
}
console.log(failed ? `\n${failed} scenario(s) failed` : '\nall UI scenarios passed');
process.exit(failed ? 1 : 0);
