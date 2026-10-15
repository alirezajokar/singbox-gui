// General: logging, inbounds (how apps connect to sing-box), and a few switches.

import { h, icon, button, notice, select, toggle, mount, empty, modal, field, input, textarea, pill } from '../dom.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { inbounds, ensure, ensureRoute } from '../config.js';
import { confirmDelete } from '../ui/actions.js';
import { uniqueTag } from '../util.js';
import { INBOUND_PRESETS } from '../presets.js';

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'];

export const general = {
  id: 'general',
  icon: 'sliders',
  render(view, app) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);
    const draft = () => store.state.draft;

    function build() {
      if (!draft()) {
        mount(root, notice({ kind: 'danger', title: t('page.no-draft'), text: t('page.no-draft-hint'), actions: [button({ label: t('nav.advanced'), icon: 'code', onClick: () => app.go('advanced') })] }));
        return;
      }
      mount(root, loggingCard(), inboundsCard(), experimentalCard());
    }

    const row = (title, hint, control, auto = false) =>
      h('div', { class: 'setting' }, h('div', { class: 'txt' }, h('b', null, title), hint ? h('span', null, hint) : null), h('div', { class: `ctl ${auto ? 'auto' : ''}`.trim() }, control));

    // ------------------------------------------------------------ logging + network
    function loggingCard() {
      const cfg = draft();
      const log = cfg.log || {};
      return h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('gen.log')))),
        h(
          'div',
          { class: 'card-body' },
          row(t('gen.log-level'), t('gen.log-level-hint'), select({ options: LEVELS.map((l) => ({ value: l, label: l })), value: log.level || 'info', ltr: true, onChange: (v) => store.mutate((d) => { ensure(d, 'log', {}).level = v; }) })),
          row(t('gen.log-time'), t('gen.log-time-hint'), toggle({ checked: log.timestamp !== false, onChange: (v) => store.mutate((d) => { ensure(d, 'log', {}).timestamp = v; }) }), true),
          row(t('gen.auto-iface'), t('gen.auto-iface-hint'), toggle({ checked: !!(cfg.route && cfg.route.auto_detect_interface), onChange: (v) => store.mutate((d) => { const r = ensureRoute(d); if (v) r.auto_detect_interface = true; else delete r.auto_detect_interface; }) }), true),
        ),
      );
    }

    // ------------------------------------------------------------ inbounds
    function inboundsCard() {
      const list = inbounds(draft());
      const rows = h('div', { class: 'list' });
      list.forEach((i) => {
        const where = i.listen_port ? `${i.listen || '0.0.0.0'}:${i.listen_port}` : i.type === 'tun' ? (i.address || i.inet4_address || []).toString() : '';
        rows.append(
          h(
            'div',
            { class: 'item' },
            icon(i.type === 'tun' ? 'layers' : 'download'),
            h('div', { class: 'body', onclick: () => edit(i.tag), style: { cursor: 'pointer' } }, h('div', { class: 'row wrap', style: { gap: '8px' } }, h('span', { class: 'title ltr' }, i.tag || '(no tag)'), pill(i.type, 'info')), where ? h('div', { class: 'muted mono ltr' }, where) : null),
            h('div', { class: 'actions' },
              button({ iconOnly: true, icon: 'edit', variant: 'ghost', size: 'sm', label: t('common.edit'), onClick: () => edit(i.tag) }),
              button({ iconOnly: true, icon: 'trash', variant: 'ghost', size: 'sm', label: t('common.delete'), onClick: async () => {
                if (!(await confirmDelete(t('gen.inbound-delete', { tag: i.tag })))) return;
                store.mutate((d) => { d.inbounds = inbounds(d).filter((x) => x !== i && x.tag !== i.tag); });
                build();
              } })),
          ),
        );
      });
      const adds = h('div', { class: 'row wrap' }, INBOUND_PRESETS.map((p) => button({ label: t(`inb.${p.id}`), icon: 'plus', size: 'sm', onClick: () => addPreset(p) })), button({ label: t('ob.add-json'), icon: 'code', size: 'sm', onClick: () => edit(null) }));
      return h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('gen.inbounds')), h('div', { class: 'hint' }, t('gen.inbounds-hint')))),
        h('div', { style: { padding: '8px 0 6px' } }, list.length ? rows : empty({ icon: 'download', title: t('gen.no-inbounds'), text: t('gen.no-inbounds-hint') })),
        h('div', { class: 'card-body', style: { paddingTop: '4px' } }, adds),
      );
    }

    function addPreset(p) {
      store.mutate((d) => {
        const item = p.build();
        item.tag = uniqueTag(item.tag, inbounds(d).map((x) => x.tag));
        d.inbounds = inbounds(d);
        d.inbounds.push(item);
      });
      build();
    }

    function edit(tag) {
      const existing = tag ? inbounds(draft()).find((i) => i.tag === tag) : null;
      const area = textarea({ code: true, rows: 12 });
      area.value = JSON.stringify(existing || { type: 'mixed', tag: uniqueTag('mixed-in', inbounds(draft()).map((x) => x.tag)), listen: '127.0.0.1', listen_port: 2080 }, null, 2);
      const err = h('div', { style: { color: 'var(--danger)' } });
      const dlg = modal({
        title: existing ? t('gen.inbound-edit') : t('ob.add-json'),
        size: 'wide',
        body: [h('div', { class: 'muted' }, t('gen.inbound-json-hint')), area],
        footer: [err, h('span', { class: 'spacer' }), button({ label: t('common.cancel'), onClick: () => dlg.close() }), button({ label: t('common.save'), variant: 'primary', icon: 'check', onClick: () => {
          let parsed;
          try { parsed = JSON.parse(area.value); } catch (e) { return (err.textContent = String(e.message || e)); }
          if (!parsed || typeof parsed !== 'object' || !parsed.type) return (err.textContent = t('ob.err.type'));
          if (!parsed.tag) return (err.textContent = t('ob.err.tag'));
          const others = inbounds(draft()).map((x) => x.tag).filter((x) => x !== tag);
          if (others.includes(parsed.tag)) return (err.textContent = t('ob.err.tag-taken'));
          store.mutate((d) => {
            d.inbounds = inbounds(d);
            const i = d.inbounds.findIndex((x) => x.tag === tag);
            if (existing && i >= 0) d.inbounds[i] = parsed;
            else d.inbounds.push(parsed);
          });
          dlg.close();
          build();
        } })],
      });
    }

    // ------------------------------------------------------------ experimental
    function experimentalCard() {
      const cfg = draft();
      const exp = cfg.experimental || {};
      const clash = exp.clash_api || null;
      const body = h('div', { class: 'card-body' });
      body.append(
        row(t('gen.cache'), t('gen.cache-hint'), toggle({ checked: !!(exp.cache_file && exp.cache_file.enabled), onChange: (v) => store.mutate((d) => {
          const e = ensure(d, 'experimental', {});
          if (v) e.cache_file = { ...(e.cache_file || {}), enabled: true };
          else if (e.cache_file) e.cache_file.enabled = false;
        }) }), true),
        row(t('gen.clash'), t('gen.clash-hint'), toggle({ checked: !!clash, onChange: (v) => { store.mutate((d) => {
          const e = ensure(d, 'experimental', {});
          if (v) e.clash_api = { external_controller: '127.0.0.1:9090' };
          else delete e.clash_api;
        }); build(); } }), true),
      );
      if (clash) {
        body.append(
          h('div', { class: 'form-grid', style: { paddingTop: '8px' } },
            field(t('gen.clash-addr'), input({ value: clash.external_controller || '', ltr: true, placeholder: '127.0.0.1:9090', onChange: (v) => store.mutate((d) => { d.experimental.clash_api.external_controller = v.trim(); }) })),
            field(t('gen.clash-secret'), input({ value: clash.secret || '', ltr: true, placeholder: t('gen.clash-secret-ph'), onChange: (v) => store.mutate((d) => { const c = d.experimental.clash_api; if (v.trim()) c.secret = v.trim(); else delete c.secret; }) })),
          ),
        );
      }
      return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('gen.experimental')))), body);
    }

    build();
    return store.subscribe((kind) => {
      if (kind === 'config') build();
    });
  },
};

