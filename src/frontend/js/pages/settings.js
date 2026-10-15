// Settings: language, theme, where the service and its config live, privileges.

import { h, button, toggle, mount, segmented, input, toast, pill } from '../dom.js';
import { t } from '../i18n.js';
import * as api from '../api.js';
import * as store from '../store.js';
import { showFailure } from '../ui/actions.js';

const latin = (text) => h('bdi', { dir: 'ltr' }, text);
const REPO = 'https://github.com/alirezajokar/singbox-gui';
const DOCS = 'https://sing-box.sagernet.org/configuration/';

export const settings = {
  id: 'settings',
  icon: 'gear',
  render(view) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);
    let passwordless = false;
    let privLoaded = false;

    const row = (title, hint, control, auto = false) =>
      h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('b', null, title), hint ? h('span', null, hint) : null), h('div', { class: `ctl ${auto ? 'auto' : ''}`.trim() }, control));

    function build() {
      const s = store.state.settings;
      const info = store.state.info;

      const unitInput = input({ value: s.unit, ltr: true, onChange: (v) => store.updateSettings({ unit: v.trim() || 'sing-box.service' }) });
      const pathInput = input({ value: s.configPath, ltr: true, onChange: (v) => store.updateSettings({ configPath: v.trim() }) });

      const appearance = h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('set.appearance')))),
        h(
          'div',
          { class: 'card-body' },
          row(t('set.language'), null, segmented({ options: [{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }], value: s.lang, onChange: (v) => store.updateSettings({ lang: v }) }), true),
          row(t('set.theme'), null, segmented({ options: [{ value: 'dark', label: t('set.theme-dark') }, { value: 'light', label: t('set.theme-light') }, { value: 'system', label: t('set.theme-system') }], value: s.theme, onChange: (v) => { store.updateSettings({ theme: v }).then(build); } }), true),
        ),
      );

      const service = h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('set.service')))),
        h(
          'div',
          { class: 'card-body' },
          row(t('set.unit'), t('set.unit-hint'), unitInput),
          row(t('set.config-path'), t('set.config-path-hint'), h('div', { class: 'col', style: { gap: '8px' } }, pathInput, h('div', { class: 'row' },
            button({ label: t('set.detect'), icon: 'wand', size: 'sm', onClick: async () => {
              try {
                const d = await api.call('cfg.detect', { unit: store.state.settings.unit });
                if (d.candidates[0]) {
                  await store.updateSettings({ configPath: d.candidates[0] });
                  toast(d.found ? t('set.detected', { path: d.candidates[0] }) : t('set.detect-default'));
                  build();
                }
              } catch (e) { toast(String((e && e.message) || e), 'error'); }
            } }),
            button({ label: t('set.browse'), icon: 'folder', size: 'sm', onClick: async () => {
              const f = window.tiny && window.tiny.dialog ? await window.tiny.dialog.openFile({ types: ['json'] }) : null;
              if (f) { await store.updateSettings({ configPath: f }); build(); }
            } })))),
          row(t('set.restart'), t('set.restart-hint'), segmented({ options: [{ value: 'auto', label: t('set.restart-auto') }, { value: 'yes', label: t('set.restart-yes') }, { value: 'no', label: t('set.restart-no') }], value: s.restart, onChange: (v) => { store.updateSettings({ restart: v }).then(build); } }), true),
        ),
      );

      const sec = h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('set.security')), h('div', { class: 'hint' }, t('set.security-hint')))),
        h(
          'div',
          { class: 'card-body' },
          row(t('set.passwordless'), t('set.passwordless-hint'), toggle({
            checked: passwordless,
            disabled: !privLoaded || !(info && info.helperInstalled),
            onChange: async (on, el) => {
              el.disabled = true;
              const r = await api.call('priv.set', { on });
              if (!r.ok) {
                showFailure(r);
                el.checked = !on;
              } else {
                passwordless = r.passwordless;
                toast(passwordless ? t('set.passwordless-on') : t('set.passwordless-off'));
              }
              el.disabled = false;
            },
          }), true),
          info && !info.helperInstalled ? h('div', { class: 'muted', style: { fontSize: '12.5px' } }, t('set.dev-helper')) : null,
        ),
      );

      const about = h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('set.about')))),
        h(
          'div',
          { class: 'card-body' },
          row('Singbox GUI', null, pill(info ? `v${info.appVersion}` : '—', 'info'), true),
          row('sing-box', info && info.singbox.path ? latin(info.singbox.path) : t('set.not-installed'), pill(info && info.singbox.version ? info.singbox.version : '—', info && info.singbox.version ? 'direct' : 'warn'), true),
          row(t('set.helper'), info && info.helper ? latin(info.helper) : t('set.helper-missing'), pill(info && info.helper ? 'OK' : '—', info && info.helper ? 'direct' : 'warn'), true),
          row(t('set.user'), info ? latin(info.dataDir) : '', pill(info ? info.user : '—', 'neutral'), true),
          h('div', { class: 'row wrap', style: { paddingTop: '10px' } },
            button({ label: t('set.docs'), icon: 'globe', size: 'sm', onClick: () => api.openExternal(DOCS) }),
            button({ label: t('set.repo'), icon: 'code', size: 'sm', onClick: () => api.openExternal(REPO) })),
        ),
      );

      mount(root, appearance, service, sec, about);
    }

    build();
    api.call('priv.get').then((r) => { passwordless = !!r.passwordless; privLoaded = true; build(); }).catch(() => { privLoaded = true; });
    return store.subscribe((kind) => {
      if (kind === 'info') build();
    });
  },
};

