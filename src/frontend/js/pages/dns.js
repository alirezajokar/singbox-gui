// DNS: servers (tag / type / address), a few global switches, and DNS rules.

import { h, icon, button, notice, select, toggle, mount, empty, modal, field, input, pill, toast, clear, settingRow } from '../dom.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { dnsServers, getRules, outboundChoices, renameTag, removeDnsServer, usages, ensureDns, ensureRoute } from '../config.js';
import { DNS_TYPES, DEFAULT_PORTS, DNS_PRESETS, serverToModel, modelToServer, emptyServerModel, presetToModel, describeServer, needsServer, hasPath, hostNeedsResolver } from '../dns.js';
import { ruleToModel, modelToRule } from '../rules.js';
import { ruleRow, sortable, openRuleEditor, newRuleModel } from '../ui/rules-ui.js';
import { confirmDelete, deleteWithUndo } from '../ui/actions.js';
import { clone, uniqueTag } from '../util.js';

const CTX = { kind: 'dns' };
const STRATEGIES = ['', 'prefer_ipv4', 'prefer_ipv6', 'ipv4_only', 'ipv6_only'];

export const dnsPage = {
  id: 'dns',
  icon: 'dns',
  render(view, app) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);
    const draft = () => store.state.draft;

    function build() {
      if (!draft()) {
        mount(root, notice({ kind: 'danger', title: t('page.no-draft'), text: t('page.no-draft-hint'), actions: [button({ label: t('nav.advanced'), icon: 'code', onClick: () => app.go('advanced') })] }));
        return;
      }
      mount(root, settingsCard(), serversCard(), rulesCard());
    }

    // ------------------------------------------------------------ global settings
    function settingsCard() {
      const cfg = draft();
      const servers = dnsServers(cfg);
      const tags = servers.map((s) => s.tag).filter(Boolean);
      const dns = cfg.dns || {};
      const resolver = cfg.route && cfg.route.default_domain_resolver;
      const resolverTag = typeof resolver === 'string' ? resolver : resolver && resolver.server ? resolver.server : '';

      const finalSel = select({ options: [{ value: '', label: t('dns.first-server') }, ...tags.map((x) => ({ value: x, label: x }))], value: dns.final || '', onChange: (v) => store.mutate((d) => { const o = ensureDns(d); if (v) o.final = v; else delete o.final; }) });
      const stratSel = select({ options: STRATEGIES.map((s) => ({ value: s, label: s ? t(`dns.strategy.${s}`) : t('dns.strategy.default') })), value: dns.strategy || '', onChange: (v) => store.mutate((d) => { const o = ensureDns(d); if (v) o.strategy = v; else delete o.strategy; }) });
      const resSel = select({ options: [{ value: '', label: t('dns.resolver-none') }, ...tags.map((x) => ({ value: x, label: x }))], value: resolverTag, onChange: (v) => store.mutate((d) => { const r = ensureRoute(d); if (v) r.default_domain_resolver = v; else delete r.default_domain_resolver; }) });
      const cache = toggle({ checked: !dns.disable_cache, onChange: (v) => store.mutate((d) => { const o = ensureDns(d); if (v) delete o.disable_cache; else o.disable_cache = true; }) });
      const rev = toggle({ checked: !!dns.reverse_mapping, onChange: (v) => store.mutate((d) => { const o = ensureDns(d); if (v) o.reverse_mapping = true; else delete o.reverse_mapping; }) });
      for (const s of [finalSel, stratSel, resSel]) s.classList.add('ltr');

      return h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('dns.settings')))),
        h(
          'div',
          { class: 'card-body' },
          settingRow(t('dns.final'), t('dns.final-hint'), finalSel),
          settingRow(t('dns.strategy'), t('dns.strategy-hint'), stratSel),
          settingRow(t('dns.resolver'), t('dns.resolver-hint'), resSel),
          settingRow(t('dns.cache'), t('dns.cache-hint'), cache, true),
          settingRow(t('dns.reverse'), t('dns.reverse-hint'), rev, true),
        ),
      );
    }

    // ------------------------------------------------------------ servers
    function serversCard() {
      const cfg = draft();
      const servers = dnsServers(cfg);
      const list = h('div', { class: 'list' });
      const final = (cfg.dns && cfg.dns.final) || (servers[0] && servers[0].tag);
      servers.forEach((s) => {
        const m = serverToModel(s);
        list.append(
          h(
            'div',
            { class: 'item' },
            icon('dns'),
            h(
              'div',
              { class: 'body', onclick: () => editServer(s.tag), style: { cursor: 'pointer' } },
              h('div', { class: 'row wrap', style: { gap: '8px' } }, h('span', { class: 'title ltr' }, s.tag), pill(m.advanced ? m.type || 'legacy' : t(`dnstype.${m.type}`), 'info'), s.tag === final ? pill(t('dns.is-final'), 'direct') : null, m.legacy ? pill(t('dns.legacy'), 'warn') : null, m.detour ? pill(`↪ ${m.detour}`, 'proxy') : null),
              h('div', { class: 'muted mono ltr', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, describeServer(m)),
            ),
            h(
              'div',
              { class: 'actions' },
              button({ iconOnly: true, icon: 'edit', variant: 'ghost', size: 'sm', label: t('common.edit'), onClick: () => editServer(s.tag) }),
              button({ iconOnly: true, icon: 'trash', variant: 'ghost', size: 'sm', label: t('common.delete'), onClick: () => deleteServer(s.tag) }),
            ),
          ),
        );
      });

      return h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('dns.servers')), h('div', { class: 'hint' }, t('dns.servers-hint'))), button({ label: t('dns.add-server'), icon: 'plus', variant: 'primary', size: 'sm', onClick: () => editServer(null) })),
        h('div', { style: { padding: '8px 0 6px' } }, servers.length ? list : empty({ icon: 'dns', title: t('dns.no-servers'), text: t('dns.no-servers-hint'), actions: [button({ label: t('dns.add-server'), icon: 'plus', variant: 'primary', onClick: () => editServer(null) })] })),
      );
    }

    async function deleteServer(tag) {
      const cfg = draft();
      const used = usages(cfg, 'dns', tag);
      const msg = used.length ? t('dns.delete-used', { tag, n: used.length }) : t('dns.delete-confirm', { tag });
      if (!(await confirmDelete(msg, { title: t('dns.delete-title', { tag }), confirmLabel: t('dns.delete-action') }))) return;
      store.mutate((d) => removeDnsServer(d, tag));
      build();
    }

    function editServer(tag) {
      const cfg = draft();
      const existing = tag ? dnsServers(cfg).find((s) => s.tag === tag) : null;
      const m = existing ? serverToModel(existing) : emptyServerModel('udp');
      const originalTag = m.tag;
      if (m.advanced) return editAdvancedServer(existing);

      const body = h('div', { class: 'col', style: { gap: '16px' } });
      const err = h('div', { style: { color: 'var(--danger)', minHeight: '18px' } });
      const dlg = modal({
        title: existing ? t('dns.edit-server') : t('dns.add-server'),
        body,
        footer: [err, h('span', { class: 'spacer' }), button({ label: t('common.cancel'), onClick: () => dlg.close() }), button({ label: t('common.save'), variant: 'primary', icon: 'check', onClick: save })],
      });

      function save() {
        const tagVal = String(m.tag || '').trim();
        const taken = dnsServers(draft()).map((s) => s.tag).filter((x) => x !== originalTag);
        if (!tagVal) return (err.textContent = t('dns.err.tag'));
        if (taken.includes(tagVal)) return (err.textContent = t('dns.err.tag-taken'));
        if (needsServer(m.type) && !String(m.server || '').trim()) return (err.textContent = t('dns.err.server'));
        if (m.port && !(Number(m.port) > 0 && Number(m.port) < 65536)) return (err.textContent = t('dns.err.port'));
        m.tag = tagVal;
        m.legacy = false;
        store.mutate((d) => {
          const out = modelToServer(m);
          if (existing) {
            if (originalTag !== tagVal) renameTag(d, 'dns', originalTag, tagVal);
            const i = dnsServers(d).findIndex((s) => s.tag === tagVal);
            d.dns.servers[i] = out;
          } else {
            ensureDns(d);
            if (!Array.isArray(d.dns.servers)) d.dns.servers = [];
            d.dns.servers.push(out);
            if (!d.dns.final) d.dns.final = tagVal;
          }
        });
        dlg.close();
        build();
      }

      function render() {
        clear(body);
        if (!existing) {
          body.append(
            h('div', { class: 'section' }, h('div', { class: 'section-title' }, icon('star', 'sm'), t('dns.presets')),
              h('div', { class: 'picker' }, DNS_PRESETS.map((p) =>
                h('button', { type: 'button', class: 'opt', onclick: () => {
                  const taken = dnsServers(draft()).map((s) => s.tag);
                  Object.assign(m, presetToModel(p), { tag: uniqueTag(p.tag, taken) });
                  render();
                } }, p.tag)))),
          );
        }
        const rowTop = h('div', { class: 'form-grid' },
          field(t('dns.tag'), input({ value: m.tag, ltr: true, placeholder: 'google', onInput: (v) => (m.tag = v) }), t('dns.tag-hint')),
          field(t('dns.type'), select({ options: DNS_TYPES.map((x) => ({ value: x, label: t(`dnstype.${x}`) })), value: m.type, onChange: (v) => { m.type = v; render(); } }), t(`dnstype.${m.type}.hint`)),
        );
        body.append(rowTop);

        if (needsServer(m.type)) {
          body.append(
            h('div', { class: 'form-grid' },
              field(t('dns.server'), input({ value: m.server, ltr: true, placeholder: m.type === 'https' || m.type === 'h3' ? 'dns.google  /  8.8.8.8' : '8.8.8.8', onInput: (v) => (m.server = v.trim()) }), t('dns.server-hint')),
              field(t('dns.port'), input({ value: m.port ? String(m.port) : '', ltr: true, placeholder: String(DEFAULT_PORTS[m.type]), onInput: (v) => (m.port = v.trim()) })),
              hasPath(m.type) ? field(t('dns.path'), input({ value: m.path, ltr: true, placeholder: '/dns-query', onInput: (v) => (m.path = v.trim()) })) : null,
            ),
          );
        }

        const outs = outboundChoices(draft()).filter((o) => !['direct', 'block', 'dns'].includes(o.type));
        const dnsTags = dnsServers(draft()).map((s) => s.tag).filter((x) => x && x !== originalTag);
        const adv = h('details', { class: 'adv', open: !!(m.detour || m.resolver) },
          h('summary', null, icon('gear', 'sm'), t('dns.advanced')),
          h('div', { class: 'form-grid' },
            field(t('dns.detour'), select({ options: [{ value: '', label: t('dns.detour-none') }, ...outs.map((o) => ({ value: o.tag, label: o.tag }))], value: m.detour, onChange: (v) => (m.detour = v), ltr: true }), t('dns.detour-hint')),
            field(t('dns.resolver-for'), select({ options: [{ value: '', label: t('dns.resolver-auto') }, ...dnsTags.map((x) => ({ value: x, label: x }))], value: m.resolver, onChange: (v) => (m.resolver = v), ltr: true }), hostNeedsResolver(m) ? t('dns.resolver-needed') : t('dns.resolver-for-hint')),
          ),
        );
        body.append(adv);
      }
      render();
    }

    function editAdvancedServer(server) {
      const area = h('textarea', { class: 'textarea code', rows: 10, spellcheck: 'false', 'aria-label': t('dns.edit-json') });
      area.value = JSON.stringify(server, null, 2);
      const err = h('div', { style: { color: 'var(--danger)' } });
      const dlg = modal({
        title: t('dns.edit-json'),
        body: [h('div', { class: 'muted' }, t('dns.advanced-note')), area],
        footer: [err, h('span', { class: 'spacer' }), button({ label: t('dns.convert'), onClick: () => {
          try {
            const mdl = serverToModel(JSON.parse(area.value));
            if (mdl.advanced) return (err.textContent = t('dns.convert-fail'));
            area.value = JSON.stringify(modelToServer({ ...mdl, legacy: false }), null, 2);
            err.textContent = '';
          } catch (e) { err.textContent = String(e.message || e); }
        } }), button({ label: t('common.save'), variant: 'primary', onClick: () => {
          try {
            const parsed = JSON.parse(area.value);
            store.mutate((d) => {
              const i = dnsServers(d).findIndex((s) => s.tag === server.tag);
              if (parsed.tag && parsed.tag !== server.tag) renameTag(d, 'dns', server.tag, parsed.tag);
              d.dns.servers[i] = parsed;
            });
            dlg.close();
            build();
          } catch (e) { err.textContent = String(e.message || e); }
        } })],
      });
    }

    // ------------------------------------------------------------ DNS rules
    function rulesCard() {
      const cfg = draft();
      const rules = getRules(cfg, 'dns') || [];
      const models = rules.map((r) => ruleToModel(r, CTX));
      const list = h('div', { class: 'list' });
      models.forEach((m, i) => {
        list.append(
          ruleRow({
            model: m, index: i, total: models.length, cfg, ctx: CTX,
            onToggle: (on) => { store.mutate((d) => { const r = getRules(d, 'dns')[i]; if (on) delete r.__off; else r.__off = true; }); build(); },
            onEdit: () => editRule(i),
            onDelete: () => deleteWithUndo({
              message: t('rule.deleted'),
              remove: () => { let removed; store.mutate((d) => ([removed] = getRules(d, 'dns').splice(i, 1))); build(); return removed; },
              restore: (rule) => { store.mutate((d) => getRules(d, 'dns').splice(i, 0, rule)); build(); },
            }),
            onDuplicate: () => { store.mutate((d) => { const rs = getRules(d, 'dns'); rs.splice(i + 1, 0, clone(rs[i])); }); build(); },
            onUp: () => move(i, i - 1),
            onDown: () => move(i, i + 1),
          }),
        );
      });
      sortable(list, (a, b) => move(a, b));
      return h(
        'section',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, t('dns.rules')), h('div', { class: 'hint' }, t('dns.rules-hint'))), button({ label: t('rule.add'), icon: 'plus', variant: 'primary', size: 'sm', onClick: addRule })),
        h('div', { style: { padding: '8px 0 6px' } }, models.length ? list : empty({ icon: 'filter', title: t('dns.no-rules'), text: t('dns.no-rules-hint'), actions: [button({ label: t('rule.add'), icon: 'plus', variant: 'primary', onClick: addRule })] })),
      );
    }

    function move(from, to) {
      const n = (getRules(draft(), 'dns') || []).length;
      if (to < 0 || to >= n || from === to) return;
      store.mutate((d) => { const rs = getRules(d, 'dns'); const [r] = rs.splice(from, 1); rs.splice(to, 0, r); });
      build();
    }

    function addRule() {
      if (!dnsServers(draft()).length) return toast(t('dns.need-server'), 'error');
      openRuleEditor({
        cfg: draft(), ctx: CTX, model: newRuleModel(draft(), CTX), title: t('rule.add'),
        onSave: (model, patch) => {
          store.mutate((d) => {
            patch(d);
            ensureDns(d);
            if (!Array.isArray(d.dns.rules)) d.dns.rules = [];
            d.dns.rules.push(modelToRule(model, CTX));
          });
          build();
        },
      });
    }

    function editRule(i) {
      openRuleEditor({
        cfg: draft(), ctx: CTX, model: ruleToModel(getRules(draft(), 'dns')[i], CTX), title: t('rule.edit'),
        onSave: (model, patch) => {
          store.mutate((d) => { patch(d); getRules(d, 'dns')[i] = modelToRule(model, CTX); });
          build();
        },
      });
    }

    build();
    return store.subscribe((kind) => {
      if (kind === 'config') build();
    });
  },
};

