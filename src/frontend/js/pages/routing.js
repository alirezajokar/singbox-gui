// Routing: the heart of the app. A friendly, ordered list of rules.

import { h, button, notice, select, mount, empty, toast, nameControl, uid } from '../dom.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { getRules, outboundChoices, ensureRoute } from '../config.js';
import { ruleToModel, modelToRule } from '../rules.js';
import { ruleRow, sortable, openRuleEditor, newRuleModel, openTemplates, openRuleSets, confirmRuleDelete } from '../ui/rules-ui.js';
import { deleteWithUndo } from '../ui/actions.js';
import { clone } from '../util.js';

const CTX = { kind: 'route' };

export const routing = {
  id: 'routing',
  icon: 'route',
  render(view, app) {
    const root = h('div', { class: 'view-inner' });
    mount(view, root);

    function draft() {
      return store.state.draft;
    }

    function build() {
      if (!draft()) {
        mount(root, notice({ kind: 'danger', title: t('page.no-draft'), text: t('page.no-draft-hint'), actions: [button({ label: t('nav.advanced'), icon: 'code', onClick: () => app.go('advanced') })] }));
        return;
      }
      mount(root, finalCard(), rulesCard());
    }

    // ------------------------------------------------------------ default target
    function finalCard() {
      const cfg = draft();
      const choices = outboundChoices(cfg);
      const current = (cfg.route && cfg.route.final) || '';
      const sel = select({
        options: [{ value: '', label: t('route.final-first') }, ...choices.map((c) => ({ value: c.tag, label: c.tag, meta: c.type }))],
        value: current,
        onChange: (v) => {
          store.mutate((d) => {
            const r = ensureRoute(d);
            if (v) r.final = v;
            else delete r.final;
          });
          build();
        },
      });
      sel.style.width = '280px';
      const titleId = uid('final');
      nameControl(sel, titleId);
      return h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'default-row' },
          h('div', { class: 'grow' }, h('div', { id: titleId, style: { fontWeight: 600 } }, t('route.final-title')), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, t('route.final-hint'))),
          sel,
        ),
      );
    }

    // ------------------------------------------------------------ rules
    function rulesCard() {
      const cfg = draft();
      const rules = getRules(cfg, 'route') || [];
      const models = rules.map((r) => ruleToModel(r, CTX));

      const list = h('div', { class: 'list' });
      models.forEach((m, i) => {
        list.append(
          ruleRow({
            model: m,
            index: i,
            total: models.length,
            cfg,
            ctx: CTX,
            onToggle: (on) => {
              store.mutate((d) => {
                const r = getRules(d, 'route')[i];
                if (on) delete r.__off;
                else r.__off = true;
              });
              build();
            },
            onEdit: () => editRule(i),
            onDelete: async (anchor) => {
              if (!(await confirmRuleDelete(anchor))) return;
              deleteWithUndo({
                message: t('rule.deleted'),
                remove: () => {
                  let removed;
                  store.mutate((d) => ([removed] = getRules(d, 'route').splice(i, 1)));
                  build();
                  return removed;
                },
                restore: (rule) => {
                  store.mutate((d) => getRules(d, 'route').splice(i, 0, rule));
                  build();
                },
              });
            },
            onDuplicate: () => {
              store.mutate((d) => {
                const rs = getRules(d, 'route');
                const copy = clone(rs[i]);
                if (copy.__name) copy.__name = `${copy.__name} ${t('common.copy-suffix')}`;
                rs.splice(i + 1, 0, copy);
              });
              build();
            },
            onUp: () => move(i, i - 1),
            onDown: () => move(i, i + 1),
          }),
        );
      });
      sortable(list, (from, to) => move(from, to));

      const body = models.length
        ? h('div', { class: 'card list-card', style: { border: 0, boxShadow: 'none', background: 'none' } }, list)
        : empty({
            icon: 'route',
            title: t('route.empty-title'),
            text: t('route.empty-text'),
            actions: [button({ label: t('tpl.open'), icon: 'wand', onClick: openGallery }), button({ label: t('rule.add'), icon: 'plus', variant: 'primary', onClick: addRule })],
          });

      const c = h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'card-head' },
          h('div', { class: 'grow' }, h('h2', null, t('route.rules')), h('div', { class: 'hint' }, t('route.order-hint'))),
          h(
            'div',
            { class: 'row wrap' },
            button({ label: t('rs.open'), icon: 'list', size: 'sm', onClick: () => openRuleSets({ getCfg: draft, mutate: store.mutate }) }),
            button({ label: t('tpl.open'), icon: 'wand', size: 'sm', onClick: openGallery }),
            button({ label: t('rule.add'), icon: 'plus', variant: 'primary', size: 'sm', onClick: addRule }),
          ),
        ),
        h('div', { style: { padding: '8px 0 6px' } }, body),
      );
      return c;
    }

    function move(from, to) {
      const n = (getRules(draft(), 'route') || []).length;
      if (to < 0 || to >= n || from === to) return;
      store.mutate((d) => {
        const rs = getRules(d, 'route');
        const [r] = rs.splice(from, 1);
        rs.splice(to, 0, r);
      });
      build();
    }

    function ensureRules(d) {
      const r = ensureRoute(d);
      if (!Array.isArray(r.rules)) r.rules = [];
      return r.rules;
    }

    function addRule() {
      openRuleEditor({
        cfg: draft(),
        ctx: CTX,
        model: newRuleModel(draft(), CTX),
        title: t('rule.add'),
        onSave: (model, patch) => {
          store.mutate((d) => {
            patch(d);
            ensureRules(d).push(modelToRule(model, CTX));
          });
          build();
        },
      });
    }

    function editRule(i) {
      const rule = getRules(draft(), 'route')[i];
      openRuleEditor({
        cfg: draft(),
        ctx: CTX,
        model: ruleToModel(rule, CTX),
        title: t('rule.edit'),
        onSave: (model, patch) => {
          store.mutate((d) => {
            patch(d);
            getRules(d, 'route')[i] = modelToRule(model, CTX);
          });
          build();
        },
      });
    }

    function openGallery() {
      openTemplates({
        cfg: draft(),
        onPick: (built, tpl) => {
          // sniff / hijack-dns belong at the very top and need no review
          const top = tpl.id === 'sniff' || tpl.id === 'hijack-dns';
          const rule = modelToRule(built.model, CTX);
          store.mutate((d) => {
            for (const spec of built.ruleSets || []) {
              d.route = d.route || {};
              if (!Array.isArray(d.route.rule_set)) d.route.rule_set = [];
              if (!d.route.rule_set.some((x) => x.tag === spec.tag)) d.route.rule_set.push(spec);
            }
            if (built.ruleSets && built.ruleSets.length) {
              const exp = (d.experimental = d.experimental || {});
              exp.cache_file = exp.cache_file || {};
              exp.cache_file.enabled = true;
            }
            const rs = ensureRules(d);
            if (tpl.id === 'sniff') rs.unshift(rule);
            else if (tpl.id === 'hijack-dns') rs.splice(rs.length && rs[0].action === 'sniff' ? 1 : 0, 0, rule);
            else rs.push(rule);
          });
          build();
          toast(t('tpl.added'));
          // let the user review / adjust the freshly added rule
          if (!top) {
            const rs = getRules(draft(), 'route');
            editRule(rs.length - 1);
          }
        },
      });
    }

    build();
    const off = store.subscribe((kind) => {
      if (kind === 'config') build();
    });
    return off;
  },
};

