// Outbounds: the places traffic can go. Import share links, build groups.

import { h, icon, button, notice, select, mount, empty, modal, field, input, textarea, toggle, pill, toast, clear } from '../dom.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { outbounds, endpoints, renameTag, removeOutbound, usages, ensureRoute } from '../config.js';
import { parseLinks, describeOutbound, endpointOf } from '../links.js';
import * as api from '../api.js';
import { confirmDelete } from '../ui/actions.js';
import { clone, uniqueTag, debounce } from '../util.js';

const GROUP_TYPES = ['selector', 'urltest'];
const BUILTIN = ['direct', 'block', 'dns'];

function toneFor(type) {
  if (type === 'direct') return 'direct';
  if (type === 'block' || type === 'dns') return 'danger';
  if (GROUP_TYPES.includes(type)) return 'info';
  return 'proxy';
}

export const outboundsPage = {
  id: 'outbounds',
  icon: 'globe',
  render(view, app) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);
    const draft = () => store.state.draft;

    function allItems() {
      return [...outbounds(draft()).map((o) => ({ o, kind: 'outbounds' })), ...endpoints(draft()).map((o) => ({ o, kind: 'endpoints' }))];
    }

    function build() {
      if (!draft()) {
        mount(root, notice({ kind: 'danger', title: t('page.no-draft'), text: t('page.no-draft-hint'), actions: [button({ label: t('nav.advanced'), icon: 'code', onClick: () => app.go('advanced') })] }));
        return;
      }
      const items = allItems();
      const groups = items.filter((x) => GROUP_TYPES.includes(x.o.type));
      const servers = items.filter((x) => !GROUP_TYPES.includes(x.o.type) && !BUILTIN.includes(x.o.type));
      const builtin = items.filter((x) => BUILTIN.includes(x.o.type));

      const header = h(
        'div',
        { class: 'col', style: { gap: '12px' } },
        h('div', { class: 'muted' }, t('ob.intro')),
        h(
          'div',
          { class: 'row wrap' },
          button({ label: t('ob.import'), icon: 'link', variant: 'primary', onClick: openImport }),
          button({ label: t('ob.new-group'), icon: 'layers', onClick: () => editGroup(null) }),
          button({ label: t('ob.add-json'), icon: 'code', onClick: () => editJson(null) }),
        ),
      );

      const sections = [header];
      if (groups.length) sections.push(section(t('ob.groups'), groups));
      sections.push(servers.length ? section(t('ob.servers'), servers) : h('div', { class: 'card' }, empty({ icon: 'globe', title: t('ob.empty-title'), text: t('ob.empty-text'), actions: [button({ label: t('ob.import'), icon: 'link', variant: 'primary', onClick: openImport })] })));
      if (builtin.length) sections.push(section(t('ob.builtin'), builtin));
      mount(root, sections);
    }

    function section(title, list) {
      return h('div', { class: 'section' }, h('div', { class: 'section-title' }, title), h('div', { class: 'outbound-grid' }, list.map(card)));
    }

    function card({ o, kind }) {
      const final = draft().route && draft().route.final === o.tag;
      const isGroup = GROUP_TYPES.includes(o.type);
      const sub = isGroup ? t('ob.members', { n: (o.outbounds || []).length }) : endpointOf(o);
      return h(
        'div',
        { class: `card ob ${final ? 'is-final' : ''}`.trim() },
        h('div', { class: 'top' }, h('span', { class: 'name grow', title: o.tag }, o.tag || '(no tag)'), final ? pill(t('ob.default'), 'direct', 'star') : null),
        h('div', { class: 'row wrap', style: { gap: '6px' } }, pill(describeOutbound(o), toneFor(o.type))),
        sub ? h('div', { class: 'sub' }, isGroup ? sub : sub) : null,
        isGroup && o.outbounds ? h('div', { class: 'tag-list' }, o.outbounds.slice(0, 4).map((m) => pill(m, 'flat')), o.outbounds.length > 4 ? pill(`+${o.outbounds.length - 4}`, 'flat') : null) : null,
        h(
          'div',
          { class: 'actions' },
          button({ iconOnly: true, icon: 'star', variant: 'ghost', size: 'sm', label: t('ob.make-default'), onClick: () => { store.mutate((d) => { ensureRoute(d).final = o.tag; }); build(); } }),
          button({ iconOnly: true, icon: 'edit', variant: 'ghost', size: 'sm', label: t('common.edit'), onClick: () => (isGroup ? editGroup(o.tag) : editJson(o.tag)) }),
          button({ iconOnly: true, icon: 'copy', variant: 'ghost', size: 'sm', label: t('common.duplicate'), onClick: () => duplicate(o.tag, kind) }),
          button({ iconOnly: true, icon: 'trash', variant: 'ghost', size: 'sm', label: t('common.delete'), onClick: () => remove(o.tag) }),
        ),
      );
    }

    // ------------------------------------------------------------ actions
    function duplicate(tag, kind) {
      store.mutate((d) => {
        const list = d[kind];
        const src = list.find((x) => x.tag === tag);
        const copy = clone(src);
        copy.tag = uniqueTag(`${tag}-copy`, allItems().map((x) => x.o.tag));
        list.splice(list.indexOf(src) + 1, 0, copy);
      });
      build();
    }

    async function remove(tag) {
      const used = usages(draft(), 'outbound', tag);
      const msg = used.length ? t('ob.delete-used', { tag, n: used.length }) : t('ob.delete-confirm', { tag });
      if (!(await confirmDelete(msg))) return;
      let res;
      store.mutate((d) => (res = removeOutbound(d, tag)));
      if (res && res.removedRules) toast(t('ob.removed-rules', { n: res.removedRules }));
      build();
    }

    // ------------------------------------------------------------ JSON editor
    function editJson(tag) {
      const kindOf = (d, tg) => (endpoints(d).some((x) => x.tag === tg) ? 'endpoints' : 'outbounds');
      const existing = tag ? allItems().find((x) => x.o.tag === tag) : null;
      const area = textarea({ code: true, rows: 14 });
      area.value = JSON.stringify(existing ? existing.o : { type: 'direct', tag: uniqueTag('direct', allItems().map((x) => x.o.tag)) }, null, 2);
      const err = h('div', { style: { color: 'var(--danger)' } });
      const dlg = modal({
        title: existing ? t('ob.edit') : t('ob.add-json'),
        size: 'wide',
        body: [h('div', { class: 'muted' }, t('ob.json-hint')), area],
        footer: [err, h('span', { class: 'spacer' }), button({ label: t('common.cancel'), onClick: () => dlg.close() }), button({ label: t('common.save'), variant: 'primary', icon: 'check', onClick: () => {
          let parsed;
          try {
            parsed = JSON.parse(area.value);
          } catch (e) {
            return (err.textContent = String(e.message || e));
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.type) return (err.textContent = t('ob.err.type'));
          if (!parsed.tag) return (err.textContent = t('ob.err.tag'));
          const others = allItems().map((x) => x.o.tag).filter((x) => x !== tag);
          if (others.includes(parsed.tag)) return (err.textContent = t('ob.err.tag-taken'));
          store.mutate((d) => {
            if (existing) {
              const kind = kindOf(d, tag);
              if (parsed.tag !== tag) renameTag(d, 'outbound', tag, parsed.tag);
              const list = d[kind];
              const i = list.findIndex((x) => x.tag === parsed.tag);
              list[i] = parsed;
            } else {
              d.outbounds = outbounds(d);
              d.outbounds.push(parsed);
            }
          });
          dlg.close();
          build();
        } })],
      });
    }

    // ------------------------------------------------------------ groups
    function editGroup(tag) {
      const existing = tag ? outbounds(draft()).find((o) => o.tag === tag) : null;
      const g = existing ? clone(existing) : { type: 'selector', tag: uniqueTag('proxy', allItems().map((x) => x.o.tag)), outbounds: [] };
      const choices = allItems().map((x) => x.o).filter((o) => o.tag !== tag && !['block', 'dns'].includes(o.type));
      const body = h('div', { class: 'col', style: { gap: '16px' } });
      const err = h('div', { style: { color: 'var(--danger)' } });
      const dlg = modal({
        title: existing ? t('ob.edit-group') : t('ob.new-group'),
        body,
        footer: [err, h('span', { class: 'spacer' }), button({ label: t('common.cancel'), onClick: () => dlg.close() }), button({ label: t('common.save'), variant: 'primary', icon: 'check', onClick: () => {
          const tagVal = String(g.tag || '').trim();
          const others = allItems().map((x) => x.o.tag).filter((x) => x !== tag);
          if (!tagVal) return (err.textContent = t('ob.err.tag'));
          if (others.includes(tagVal)) return (err.textContent = t('ob.err.tag-taken'));
          if (!g.outbounds.length) return (err.textContent = t('ob.err.members'));
          g.tag = tagVal;
          if (g.type === 'selector') {
            if (g.default && !g.outbounds.includes(g.default)) delete g.default;
          } else {
            delete g.default;
            g.url = g.url || 'https://www.gstatic.com/generate_204';
            g.interval = g.interval || '3m';
          }
          store.mutate((d) => {
            if (existing) {
              if (tagVal !== tag) renameTag(d, 'outbound', tag, tagVal);
              const i = outbounds(d).findIndex((o) => o.tag === tagVal);
              d.outbounds[i] = { ...existing, ...g, tag: tagVal };
              if (g.type === 'urltest') delete d.outbounds[i].default;
            } else {
              d.outbounds = outbounds(d);
              // groups go first so they read naturally in the file
              d.outbounds.unshift(g);
            }
          });
          dlg.close();
          build();
        } })],
      });

      function render() {
        clear(body);
        body.append(
          h('div', { class: 'form-grid' },
            field(t('ob.group-tag'), input({ value: g.tag, ltr: true, onInput: (v) => (g.tag = v) })),
            field(t('ob.group-type'), select({ options: GROUP_TYPES.map((x) => ({ value: x, label: t(`obtype.${x}`) })), value: g.type, onChange: (v) => { g.type = v; render(); } }), t(`obtype.${g.type}.hint`)),
          ),
          h('div', { class: 'section' }, h('div', { class: 'section-title' }, t('ob.group-members')),
            h('div', { class: 'picker' }, choices.map((o) => {
              const on = g.outbounds.includes(o.tag);
              return h('button', { type: 'button', class: `opt ${on ? 'on' : ''}`, onclick: () => {
                g.outbounds = on ? g.outbounds.filter((x) => x !== o.tag) : [...g.outbounds, o.tag];
                render();
              } }, h('span', { class: 'ltr' }, o.tag), h('small', null, o.type));
            }))),
        );
        if (g.type === 'selector') {
          body.append(field(t('ob.group-default'), select({ options: [{ value: '', label: t('ob.group-default-first') }, ...g.outbounds.map((x) => ({ value: x, label: x }))], value: g.default || '', onChange: (v) => { if (v) g.default = v; else delete g.default; }, ltr: true })));
        } else {
          body.append(
            h('div', { class: 'form-grid' },
              field(t('ob.test-url'), input({ value: g.url || 'https://www.gstatic.com/generate_204', ltr: true, onInput: (v) => (g.url = v.trim()) })),
              field(t('ob.test-interval'), input({ value: g.interval || '3m', ltr: true, onInput: (v) => (g.interval = v.trim()) }), t('ob.test-interval-hint')),
            ),
          );
        }
      }
      render();
    }

    // ------------------------------------------------------------ import links
    function openImport() {
      const area = textarea({ rows: 6, code: true, placeholder: 'vless://…\nvmess://…\ntrojan://…\nss://…\nhysteria2://…' });
      const preview = h('div', { class: 'col', style: { gap: '8px' } });
      const groups = outbounds(draft()).filter((o) => o.type === 'selector' || o.type === 'urltest');
      let parsed = { outbounds: [], errors: [], warnings: [] };
      const chosen = new Set();
      let target = groups.find((g) => g.type === 'selector') ? groups.find((g) => g.type === 'selector').tag : groups[0] ? groups[0].tag : '';
      let createGroup = !groups.length;

      const addBtn = button({ label: t('ob.import-add', { n: 0 }), variant: 'primary', icon: 'plus', disabled: true, onClick: doImport });
      const dlg = modal({
        title: t('ob.import'),
        size: 'wide',
        body: [h('div', { class: 'muted' }, t('ob.import-hint')), area, preview],
        footer: [button({ label: t('ob.paste-clipboard'), icon: 'copy', size: 'sm', onClick: async () => {
          const text = await api.readClipboardText();
          if (!text) return toast(t('ob.clipboard-empty'), 'error');
          area.value = text;
          refresh();
        } }), h('span', { class: 'spacer' }), button({ label: t('common.cancel'), onClick: () => dlg.close() }), addBtn],
      });

      function refresh() {
        parsed = parseLinks(area.value, allItems().map((x) => x.o.tag));
        chosen.clear();
        parsed.outbounds.forEach((o) => chosen.add(o.tag));
        renderPreview();
      }

      function renderPreview() {
        clear(preview);
        if (!area.value.trim()) return updateBtn();
        for (const o of parsed.outbounds) {
          const warn = parsed.warnings.filter((w) => w.tag === o.tag).map((w) => t(`link.warn.${w.warning}`));
          preview.append(
            h('label', { class: 'preview-item' },
              toggle({ checked: chosen.has(o.tag), onChange: (v) => { if (v) chosen.add(o.tag); else chosen.delete(o.tag); updateBtn(); } }),
              h('div', { class: 'grow' }, h('div', { class: 'ltr', style: { fontWeight: 600 } }, o.tag), h('div', { class: 'muted ltr', style: { fontSize: '12px' } }, `${describeOutbound(o)} · ${endpointOf(o)}`)),
              warn.length ? pill(warn.join(' · '), 'warn', 'alert') : null),
          );
        }
        for (const e of parsed.errors) {
          const key = e.error.startsWith('unsupported-scheme') ? 'link.err.scheme' : e.error.startsWith('unsupported-transport') ? 'link.err.transport' : 'link.err.bad';
          preview.append(h('div', { class: 'preview-item bad' }, icon('alert'), h('div', { class: 'grow' }, h('div', null, t(key, { x: e.error.split(':')[1] || '' })), h('div', { class: 'muted ltr mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '560px' } }, e.link))));
        }
        if (parsed.outbounds.length) {
          const opts = [{ value: '', label: t('ob.import-no-group') }, ...groups.map((g) => ({ value: g.tag, label: g.tag }))];
          preview.append(
            h('div', { class: 'row wrap', style: { marginTop: '6px' } },
              h('span', { class: 'label' }, t('ob.import-group')),
              select({ options: opts, value: createGroup ? '' : target, onChange: (v) => { target = v; createGroup = false; } }),
              !groups.length ? h('label', { class: 'row', style: { cursor: 'pointer' } }, toggle({ checked: createGroup, onChange: (v) => (createGroup = v) }), h('span', null, t('ob.import-create-group'))) : null),
          );
        }
        updateBtn();
      }

      function updateBtn() {
        addBtn.disabled = chosen.size === 0;
        addBtn.lastChild.textContent = t('ob.import-add', { n: chosen.size });
      }

      function doImport() {
        const picked = parsed.outbounds.filter((o) => chosen.has(o.tag));
        if (!picked.length) return;
        store.mutate((d) => {
          d.outbounds = outbounds(d);
          // keep groups/direct at the end: servers go before them
          const firstGroup = d.outbounds.findIndex((o) => GROUP_TYPES.includes(o.type));
          if (firstGroup >= 0) d.outbounds.splice(firstGroup, 0, ...picked);
          else d.outbounds.push(...picked);
          const tags = picked.map((o) => o.tag);
          if (createGroup && !groups.length) {
            const gtag = uniqueTag('proxy', d.outbounds.map((o) => o.tag));
            d.outbounds.push({ type: 'selector', tag: gtag, outbounds: tags, default: tags[0] });
            const r = ensureRoute(d);
            if (!r.final || r.final === 'direct') r.final = gtag;
          } else if (target) {
            const g = d.outbounds.find((o) => o.tag === target);
            if (g) g.outbounds = [...new Set([...(g.outbounds || []), ...tags])];
          }
        });
        dlg.close();
        toast(t('ob.imported', { n: picked.length }));
        build();
      }

      area.addEventListener('input', debounce(refresh, 250));
      area.addEventListener('paste', () => setTimeout(refresh, 30));
    }

    build();
    return store.subscribe((kind) => {
      if (kind === 'config') build();
    });
  },
};

