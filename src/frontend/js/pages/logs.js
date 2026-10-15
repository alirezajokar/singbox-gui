// Logs: the sing-box service output, with level filter and search.

import { h, button, notice, select, toggle, input, segmented, mount, clear, toast } from '../dom.js';
import { t } from '../i18n.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { showFailure } from '../ui/actions.js';
import { parseLog, filterLog } from '../logs.js';

// kept while the app runs, so coming back to the page keeps your filter
const prefs = { lines: 200, level: 'all', query: '', auto: true };

export const logs = {
  id: 'logs',
  icon: 'terminal',
  render(view) {
    const note = h('div');
    const logView = h('div', { class: 'logs tall', role: 'log', 'aria-live': 'off' });
    const count = h('div', { class: 'muted', style: { fontSize: '12px' } });
    const toolbar = h('div', { class: 'row wrap' });
    let entries = [];
    let denied = false;
    let loaded = false; // false until the first answer, so "no logs yet" does not flash
    let timer = null;

    mount(view, h('div', { class: 'view-inner' }, h('section', { class: 'card' }, h('div', { class: 'card-body col', style: { paddingTop: '16px' } }, toolbar, note, logView, count))));

    // ------------------------------------------------------------ toolbar
    function renderToolbar() {
      const search = input({ value: prefs.query, placeholder: t('logs.search'), 'aria-label': t('logs.search'), onInput: (v) => { prefs.query = v; paint(); } });
      search.style.minWidth = '200px';
      const lines = select({
        options: ['50', '200', '500', '1000'].map((n) => ({ value: n, label: n })),
        value: String(prefs.lines),
        onChange: (v) => { prefs.lines = Number(v); load(); },
        'aria-label': t('logs.lines'),
      });
      lines.style.width = '84px';
      lines.title = t('logs.lines');
      mount(
        toolbar,
        segmented({
          label: t('page.logs.title'),
          options: [{ value: 'all', label: t('logs.filter.all') }, { value: 'warn', label: t('logs.filter.warn') }, { value: 'error', label: t('logs.filter.error') }],
          value: prefs.level,
          onChange: (v) => { prefs.level = v; renderToolbar(); paint(); },
        }),
        h('div', { class: 'grow' }, search),
        lines,
        h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer' }, title: t('logs.auto') }, toggle({ checked: prefs.auto, onChange: (v) => (prefs.auto = v), label: t('logs.auto') }), h('span', { class: 'muted', style: { fontSize: '12px' } }, t('logs.auto'))),
        button({ iconOnly: true, icon: 'refresh', variant: 'ghost', size: 'sm', label: t('common.refresh'), onClick: () => load() }),
        button({ iconOnly: true, icon: 'copy', variant: 'ghost', size: 'sm', label: t('common.copy'), onClick: async () => {
          const ok = await api.copyText(logView.innerText);
          toast(ok ? t('common.copied') : t('common.copy-failed'), ok ? 'ok' : 'error');
        } }),
      );
    }

    // ------------------------------------------------------------ data
    function paint() {
      const shown = filterLog(entries, prefs);
      const stick = logView.scrollTop + logView.clientHeight >= logView.scrollHeight - 30;
      mount(
        logView,
        shown.length
          ? shown.map((e) => h('div', { class: `ln lv-${e.level}` }, e.time ? h('span', { class: 'ts' }, e.time) : null, e.msg))
          : h('div', { class: 'ln muted' }, !loaded ? '…' : entries.length ? t('logs.no-match') : t('logs.none')),
      );
      if (stick) logView.scrollTop = logView.scrollHeight;
      count.textContent = entries.length ? t('logs.count', { shown: shown.length, total: entries.length }) : '';
    }

    async function load(prompt = false) {
      const st = store.state.status;
      if (!st || !st.loaded) {
        entries = [];
        loaded = true;
        clear(note);
        paint();
        return;
      }
      let r;
      try {
        r = await api.call('logs.get', { unit: store.state.settings.unit, lines: prefs.lines, allowPrompt: prompt });
      } catch (e) {
        r = { ok: false, message: String((e && e.message) || e) };
      }
      loaded = true;
      denied = !r.ok && r.reason === 'permission';
      if (denied) {
        mount(note, notice({ kind: 'info', text: t('logs.denied'), actions: [button({ label: t('logs.allow'), icon: 'lock', size: 'sm', onClick: () => load(true) })] }));
        entries = [];
        paint();
        return;
      }
      clear(note);
      if (!r.ok) {
        if (r.reason) showFailure(r);
        return;
      }
      entries = parseLog(r.text);
      paint();
    }

    renderToolbar();
    paint();
    load();

    timer = setInterval(() => {
      if (prefs.auto && !document.hidden && !denied) load();
    }, 4000);
    // the service may start/stop while this page is open
    const off = store.subscribe((kind) => {
      if (kind === 'status') {
        const st = store.state.status;
        if (st && st.loaded && !entries.length) load();
      }
    });

    return () => {
      clearInterval(timer);
      off();
    };
  },
};
