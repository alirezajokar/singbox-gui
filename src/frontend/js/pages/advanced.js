// Advanced: the full JSON, validation, import / export and backups.

import { h, icon, button, card, notice, mount, textarea, toast, empty } from '../dom.js';
import { t } from '../i18n.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { parseConfig, serialize } from '../config.js';
import { showFailure } from '../ui/actions.js';
import { formatBytes } from '../util.js';

function backupDate(name) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json$/.exec(name);
  if (!m) return name;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  try {
    return d.toLocaleString();
  } catch {
    return d.toISOString();
  }
}

export const advanced = {
  id: 'advanced',
  icon: 'code',
  render(view) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);

    const area = textarea({ code: true, rows: 26, spellcheck: false });
    area.style.minHeight = '420px';
    area.style.fontSize = '12.5px';
    const status = h('div', { class: 'row', style: { minHeight: '24px' } });
    let edited = false;

    function load() {
      area.value = store.currentText();
      edited = false;
      setStatus('');
    }

    function setStatus(msg, kind = 'muted') {
      mount(status, msg ? h('span', { class: kind === 'error' ? '' : 'muted', style: kind === 'error' ? { color: 'var(--danger)' } : kind === 'ok' ? { color: 'var(--ok)' } : null }, msg) : null);
    }

    function validateSyntax() {
      const r = parseConfig(area.value);
      if (!r.ok) {
        area.classList.add('invalid');
        setStatus(r.error, 'error');
      } else {
        area.classList.remove('invalid');
        setStatus(edited ? t('adv.syntax-ok') : '', 'ok');
      }
      return r;
    }

    area.addEventListener('input', () => {
      edited = true;
      validateSyntax();
    });

    const toolbar = h(
      'div',
      { class: 'row wrap' },
      button({ label: t('adv.format'), icon: 'wand', size: 'sm', onClick: () => {
        const r = parseConfig(area.value);
        if (!r.ok) return validateSyntax();
        area.value = serialize(r.value);
        validateSyntax();
      } }),
      button({ label: t('adv.validate'), icon: 'shield', size: 'sm', onClick: async () => {
        const r = parseConfig(area.value);
        if (!r.ok) return validateSyntax();
        setStatus(t('adv.checking'));
        const c = await store.checkNow(area.value);
        if (c.ok) setStatus(c.skipped ? t('dash.check-skipped') : t('adv.check-ok'), 'ok');
        else {
          setStatus('');
          showFailure({ stage: 'check', message: c.output });
        }
      } }),
      button({ label: t('adv.apply'), icon: 'check', variant: 'primary', size: 'sm', onClick: async () => {
        const r = await store.applyRawText(area.value);
        if (!r.ok) return validateSyntax();
        toast(t('adv.applied'));
        load();
      } }),
      h('span', { class: 'grow' }),
      button({ label: t('adv.reload'), icon: 'refresh', size: 'sm', variant: 'ghost', onClick: load }),
      button({ label: t('adv.import'), icon: 'upload', size: 'sm', onClick: async () => {
        const f = await api.pickTextFile(['json']);
        if (!f) return;
        area.value = f.text;
        edited = true;
        validateSyntax();
      } }),
      button({ label: t('adv.export'), icon: 'download', size: 'sm', onClick: async () => {
        const r = await api.saveTextFile('config.json', area.value);
        if (r) toast(t('adv.exported'));
      } }),
      button({ label: t('common.copy'), icon: 'copy', size: 'sm', variant: 'ghost', onClick: async () => { const ok = await api.copyText(area.value); toast(ok ? t('common.copied') : t('common.copy-failed'), ok ? 'ok' : 'error'); } }),
    );

    const backupsBox = h('div');
    async function loadBackups() {
      let list = [];
      try {
        list = await api.call('backup.list');
      } catch {
        list = [];
      }
      const body = list.length
        ? h('div', { class: 'list' }, list.map((b) =>
            h('div', { class: 'item' }, icon('clock'),
              h('div', { class: 'body' }, h('div', { class: 'title' }, backupDate(b.name)), h('div', { class: 'muted mono ltr' }, `${b.name} · ${formatBytes(b.size)}`)),
              button({ label: t('adv.restore'), icon: 'undo', size: 'sm', onClick: async () => {
                try {
                  const text = await api.call('backup.read', { name: b.name });
                  const r = await store.applyRawText(text);
                  if (!r.ok) return toast(r.error, 'error');
                  load();
                  toast(t('adv.restored'));
                } catch (e) {
                  toast(String((e && e.message) || e), 'error');
                }
              } }))))
        : empty({ icon: 'clock', title: t('adv.no-backups'), text: t('adv.no-backups-hint') });
      mount(backupsBox, card(t('adv.backups'), t('adv.backups-hint'), body));
    }

    mount(
      root,
      store.state.loadError ? notice({ kind: 'warn', title: t('adv.broken'), text: t('adv.broken-hint'), detail: store.state.loadError === 'denied' ? '' : store.state.loadError }) : null,
      h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('adv.title')), h('div', { class: 'hint' }, t('adv.hint')))), h('div', { class: 'card-body col' }, toolbar, area, status)),
      backupsBox,
    );
    load();
    if (!store.state.draft && store.state.rawText) {
      area.value = store.state.rawText;
      validateSyntax();
    }
    loadBackups();

    return store.subscribe((kind) => {
      if (kind === 'config' && !edited) load();
    });
  },
};

