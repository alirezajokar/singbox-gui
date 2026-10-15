// App shell: sidebar, page router, save bar, keyboard shortcuts.

import { h, icon, button, mount, toast } from './dom.js';
import { t } from './i18n.js';
import * as store from './store.js';
import { saveAndApply, discardChanges } from './ui/actions.js';
import { dashboard } from './pages/dashboard.js';
import { routing } from './pages/routing.js';
import { dnsPage } from './pages/dns.js';
import { outboundsPage } from './pages/outbounds.js';
import { general } from './pages/general.js';
import { logs } from './pages/logs.js';
import { advanced } from './pages/advanced.js';
import { settings } from './pages/settings.js';

const PAGES = [dashboard, routing, dnsPage, outboundsPage, general, logs, advanced, settings];
const NAV = [dashboard, routing, dnsPage, outboundsPage, general, logs, 'sep', advanced, settings];

let current = null;
let cleanup = null;

const app = {
  go(id) {
    location.hash = `#/${id}`;
  },
};

function pageFromHash() {
  const id = (location.hash || '').replace(/^#\/?/, '') || 'dashboard';
  return PAGES.find((p) => p.id === id) || dashboard;
}

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

const root = document.getElementById('app');
let sidebarEl;
let topbarEl;
let viewEl;
let savebarEl;
let statusPillEl;

function buildShell() {
  sidebarEl = h('aside', { class: 'sidebar' });
  topbarEl = h('header', { class: 'topbar' });
  viewEl = h('div', { class: 'view', id: 'view' });
  savebarEl = h('div', { class: 'savebar' });
  mount(root, h('div', { class: 'shell' }, sidebarEl, h('main', { class: 'main' }, topbarEl, viewEl)), savebarEl);
  renderSidebar();
  renderSavebar();
}

function renderSidebar() {
  const active = current ? current.id : 'dashboard';
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  for (const item of NAV) {
    if (item === 'sep') {
      nav.append(h('div', { class: 'nav-sep' }));
      continue;
    }
    nav.append(
      h(
        'button',
        { type: 'button', class: 'nav-item', 'aria-current': item.id === active ? 'page' : undefined, onclick: () => app.go(item.id), title: t(`nav.${item.id}`) },
        icon(item.icon),
        h('span', { class: 'lbl' }, t(`nav.${item.id}`)),
      ),
    );
  }

  statusPillEl = h('button', { type: 'button', class: 'status-pill', onclick: () => app.go('dashboard') });
  mount(
    sidebarEl,
    h('a', { class: 'skip-link', href: '#view', onclick: (e) => { e.preventDefault(); focusMain(); } }, t('a11y.skip')),
    h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }, icon('box')), h('div', null, h('div', { class: 'brand-name' }, 'Singbox GUI'), h('div', { class: 'brand-sub' }, t('app.tagline')))),
    nav,
    h('div', { class: 'sidebar-foot' }, statusPillEl),
  );
  renderStatusPill();
}

function renderStatusPill() {
  if (!statusPillEl) return;
  const s = store.state.status;
  let tone = '';
  let text = t('side.unknown');
  if (s && s.available && !s.loaded) text = t('side.not-found');
  else if (s && s.active) {
    tone = 'ok';
    text = t('side.running');
  } else if (s && s.state === 'failed') {
    tone = 'danger';
    text = t('side.failed');
  } else if (s && s.available) text = t('side.stopped');
  mount(statusPillEl, h('span', { class: `dot ${tone}`.trim() }), h('span', { class: 'txt' }, h('b', null, 'sing-box'), ' · ', text));
}

function renderTopbar() {
  const title = t(`page.${current.id}.title`);
  document.title = `${title} · Singbox GUI`;
  mount(topbarEl, h('div', null, h('h1', { tabindex: '-1' }, title), h('div', { class: 'sub' }, t(`page.${current.id}.sub`))));
}

/** Move focus to the page heading, so keyboard and screen-reader users land on the new view. */
function focusMain() {
  const heading = topbarEl && topbarEl.querySelector('h1');
  if (heading) heading.focus();
}

function renderSavebar() {
  if (!savebarEl) return;
  const dirty = store.isDirty();
  const busy = store.state.busy === 'save';
  const willRestart = store.state.status && store.state.status.active && store.state.settings.restart !== 'no';
  savebarEl.classList.toggle('show', dirty || busy);
  if (!dirty && !busy) return;
  mount(
    savebarEl,
    h(
      'div',
      { class: 'savebar-inner' },
      h('div', { class: 'msg' }, h('span', { class: 'badge-dot' }), h('span', null, store.state.fileExists ? t('save.unsaved') : t('save.create')), willRestart ? h('span', { class: 'muted', style: { fontWeight: 400 } }, `· ${t('save.will-restart')}`) : null),
      store.state.fileExists ? button({ label: t('save.discard'), icon: 'undo', variant: 'ghost', disabled: busy, onClick: discardChanges }) : null,
      button({ label: busy ? t('save.saving') : t('save.apply'), icon: busy ? 'refresh' : 'save', variant: 'primary', disabled: busy, onClick: saveAndApply }),
    ),
  );
  const ico = savebarEl.querySelector('.btn-primary .ico');
  if (ico && busy) ico.classList.add('spin');
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

function renderPage(moveFocus = true) {
  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* ignore */
    }
    cleanup = null;
  }
  current = pageFromHash();
  renderSidebar();
  renderTopbar();
  viewEl.scrollTop = 0;
  mount(viewEl);
  cleanup = current.render(viewEl, app) || null;
  if (moveFocus) focusMain();
}

window.addEventListener('hashchange', () => renderPage(true));

// ---------------------------------------------------------------------------
// store → shell
// ---------------------------------------------------------------------------

store.subscribe((kind) => {
  if (kind === 'status') renderStatusPill();
  if (kind === 'draft' || kind === 'config' || kind === 'busy' || kind === 'status') renderSavebar();
  if (kind === 'settings') {
    store.applyAppearance();
    renderSidebar();
    renderTopbar();
    renderSavebar();
    // re-render the page in the new language / theme
    if (cleanup) cleanup();
    cleanup = current.render(mount(viewEl), app) || null;
  }
});

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (store.isDirty()) saveAndApply();
  }
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function start() {
  try {
    if (window.tiny && window.tiny.win && window.tiny.win.setMinSize) window.tiny.win.setMinSize(900, 600);
  } catch {
    /* not fatal */
  }
  buildShell();
  mount(viewEl, h('div', { class: 'empty' }, icon('refresh', 'lg spin')));
  try {
    await store.boot();
  } catch (e) {
    toast(String((e && e.message) || e), 'error');
  }
  store.applyAppearance();
  buildShell();
  renderPage(false);
}

start();
