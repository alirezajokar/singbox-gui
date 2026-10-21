// UI for rules (shared by the Routing page and the DNS page):
//   ruleRow        one row of the rule list
//   sortable       drag & drop reordering
//   openRuleEditor the "add / edit rule" dialog
//   openTemplates  the gallery of ready-made rules
//   openRuleSets   manage rule-set lists (geosite / geoip …)

import { h, icon, button, field, input, textarea, select, toggle, picker, chipsInput, modal, toast, pill, empty, clear, nameControl, uid } from '../dom.js';
import { t, num } from '../i18n.js';
import {
  CONDITIONS, CONDITION_BY_TYPE, PROTOCOLS, NETWORKS, QUERY_TYPES,
  ruleToModel, modelToRule, emptyModel, validateModel, parseValues, classifyLines, actionTone, isCatchAll,
} from '../rules.js';
import { outboundChoices, dnsServers, ruleSets, inbounds, ensureCacheFile } from '../config.js';
import { ROUTE_TEMPLATES, RULE_SET_CATALOG, remoteRuleSet, addRuleSet, ruleSetFromTag } from '../presets.js';
import { clone } from '../util.js';
import { popconfirm } from '../popconfirm.js';

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

const COND_ICON = {
  tld: 'flag', domain_suffix: 'globe', domain: 'globe', domain_keyword: 'filter', domain_regex: 'code',
  ip_cidr: 'cpu', ip_is_private: 'home', rule_set: 'list', port: 'zap', protocol: 'layers', network: 'link',
  query_type: 'dns', process_name: 'terminal', inbound: 'download', source_ip_cidr: 'cpu',
};

export function toneOf(tag, cfg) {
  return actionTone({ type: 'route', outbound: tag }, outboundChoices(cfg));
}

function valuesText(values) {
  const shown = values.slice(0, 3).join(', ');
  return values.length > 3 ? `${shown} +${num(values.length - 3)}` : shown;
}

function actionPill(model, cfg, ctx) {
  const a = model.action || {};
  if (a.type === 'route') {
    const target = ctx.kind === 'dns' ? a.server : a.outbound;
    const tone = ctx.kind === 'dns' ? 'info' : toneOf(target, cfg);
    return pill(target || '?', target ? tone : 'danger', ctx.kind === 'dns' ? 'dns' : tone === 'direct' ? 'zap' : 'globe');
  }
  if (a.type === 'reject') return pill(t('act.reject'), 'danger', 'ban');
  if (a.type === 'hijack-dns') return pill(t('act.hijack-dns'), 'info', 'dns');
  if (a.type === 'sniff') return pill(t('act.sniff'), 'info', 'eye');
  return pill(t(`act.${a.type}`) === `act.${a.type}` ? a.type : t(`act.${a.type}`), 'neutral');
}

export function ruleSummary(model, cfg, ctx) {
  const when = h('div', { class: 'conds-when' });
  if (model.kind === 'logical') {
    when.append(h('span', { class: 'cond-pill' }, icon('layers', 'sm'), h('b', null, t('rule.logical')), h('span', { class: 'v' }, `${model.raw.mode || 'and'} · ${(model.raw.rules || []).length}`)));
  } else if (!model.conds.length) {
    when.append(h('span', { class: 'cond-pill' }, icon('globe', 'sm'), h('span', { class: 'v', style: { direction: 'inherit' } }, t('rule.all-traffic'))));
  } else {
    model.conds.forEach((c, i) => {
      if (i > 0) when.append(h('span', { class: 'cond-and', 'aria-hidden': 'true' }, '+'));
      when.append(
        h(
          'span',
          { class: `cond-pill ${model.invert ? 'invert' : ''}`.trim() },
          icon(COND_ICON[c.type] || 'filter', 'sm'),
          h('b', null, (model.invert && i === 0 ? `${t('rule.not')} ` : '') + t(`cond.${c.type}`)),
          c.values.length ? h('span', { class: 'v', title: c.values.join('\n') }, valuesText(c.values)) : null,
        ),
      );
    });
  }
  // the arrow and its target always stay together, on the same line
  const then = h('div', { class: 'conds-then' }, h('span', { class: 'arrow' }, icon('arrow', 'sm')), actionPill(model, cfg, ctx));
  const restKeys = Object.keys(model.rest || {});
  if (restKeys.length) then.append(h('span', { class: 'pill flat', title: restKeys.join(', ') }, `+${num(restKeys.length)}`));
  return h('div', { class: 'conds' }, when, then);
}

/** Ask before a rule is deleted: a small question on top of the delete button, with the row marked. */
export function confirmRuleDelete(anchor) {
  return popconfirm({ anchor, title: t('rule.delete-title'), confirmLabel: t('common.delete'), mark: anchor.closest('.item') });
}

/** One row of a rule list. */
export function ruleRow({ model, index, total, cfg, ctx, onToggle, onEdit, onDelete, onDuplicate, onUp, onDown }) {
  const row = h(
    'div',
    { class: `item ${model.enabled ? '' : 'off'}`.trim(), draggable: 'true', dataset: { index } },
    h('span', { class: 'handle', title: t('rule.drag') }, icon('grip', 'sm')),
    h('span', { class: 'idx' }, num(index + 1)),
    toggle({ checked: model.enabled, onChange: onToggle, label: t('rule.enabled') }),
    h(
      'div',
      { class: 'body', onclick: onEdit, style: { cursor: 'pointer' } },
      model.name ? h('div', { class: 'title' }, model.name) : null,
      ruleSummary(model, cfg, ctx),
      isCatchAll(model) && ctx.kind === 'route' ? h('div', { class: 'muted', style: { fontSize: '12px' } }, t('rule.catchall-hint')) : null,
    ),
    h(
      'div',
      { class: 'actions' },
      button({ iconOnly: true, icon: 'up', variant: 'ghost', size: 'sm', label: t('rule.up'), disabled: index === 0, onClick: onUp }),
      button({ iconOnly: true, icon: 'down', variant: 'ghost', size: 'sm', label: t('rule.down'), disabled: index === total - 1, onClick: onDown }),
      button({ iconOnly: true, icon: 'edit', variant: 'ghost', size: 'sm', label: t('common.edit'), onClick: onEdit }),
      button({ iconOnly: true, icon: 'copy', variant: 'ghost', size: 'sm', label: t('common.duplicate'), onClick: onDuplicate }),
      button({ iconOnly: true, icon: 'trash', variant: 'ghost', size: 'sm', label: t('common.delete'), onClick: (e) => onDelete(e.currentTarget) }),
    ),
  );
  return row;
}

/** HTML5 drag & drop reordering for `.item` rows inside `listEl`. */
export function sortable(listEl, onReorder) {
  let from = -1;
  const clearMarks = () => listEl.querySelectorAll('.item').forEach((e) => e.classList.remove('drop-before', 'drop-after', 'dragging'));
  listEl.addEventListener('dragstart', (e) => {
    const item = e.target.closest && e.target.closest('.item');
    if (!item) return;
    from = Number(item.dataset.index);
    item.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(from));
    }
  });
  listEl.addEventListener('dragover', (e) => {
    const item = e.target.closest && e.target.closest('.item');
    if (!item || from < 0) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    listEl.querySelectorAll('.item').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    item.classList.add(after ? 'drop-after' : 'drop-before');
  });
  listEl.addEventListener('drop', (e) => {
    const item = e.target.closest && e.target.closest('.item');
    if (!item || from < 0) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    let to = Number(item.dataset.index) + (after ? 1 : 0);
    if (from < to) to -= 1;
    const f = from;
    from = -1;
    clearMarks();
    if (to !== f) onReorder(f, to);
  });
  listEl.addEventListener('dragend', () => {
    from = -1;
    clearMarks();
  });
}

// ---------------------------------------------------------------------------
// rule editor
// ---------------------------------------------------------------------------

const ROUTE_ACTION_ORDER = ['route', 'reject', 'hijack-dns', 'sniff'];
const DNS_ACTION_ORDER = ['route', 'reject'];

/**
 * openRuleEditor({ cfg, ctx, model, title, onSave })
 *  - `model` is edited on a copy; onSave(model, cfgPatch) is called with the result.
 *  - cfgPatch(draft) adds the rule-sets the rule needs.
 */
export function openRuleEditor({ cfg, ctx, model: initial, title, onSave }) {
  const model = clone(initial);
  const body = h('div', { class: 'col', style: { gap: '18px' } });
  const errorBox = h('div', { class: 'muted', style: { color: 'var(--danger)', minHeight: '18px' } });
  const choices = outboundChoices(cfg);
  const ruleSetTags = ruleSets(cfg).map((r) => r.tag);
  const inboundTags = inbounds(cfg).map((i) => i.tag).filter(Boolean);
  const dnsTags = dnsServers(cfg).map((s) => s.tag).filter(Boolean);
  const available = CONDITIONS.filter((c) => c.scopes.includes(ctx.kind));

  const m = modal({
    title,
    size: 'wide',
    body,
    footer: [
      errorBox,
      h('span', { class: 'spacer' }),
      button({ label: t('common.cancel'), onClick: () => m.close() }),
      button({ label: t('common.apply'), variant: 'primary', icon: 'check', onClick: save }),
    ],
  });

  function save() {
    // finish a half-typed chip
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    const problem = validateModel(model, ctx);
    if (problem) {
      errorBox.textContent = t(`rule.err.${problem}`);
      return;
    }
    // rule-sets referenced but not defined: add the well-known ones, refuse unknown names
    const defined = new Set(ruleSetTags);
    const toAdd = [];
    for (const c of model.conds) {
      if (c.type !== 'rule_set') continue;
      for (const tag of c.values) {
        if (defined.has(tag)) continue;
        const spec = ruleSetFromTag(tag);
        if (!spec) {
          errorBox.textContent = t('rule.err.ruleset', { tag });
          return;
        }
        toAdd.push(spec);
        defined.add(tag);
      }
    }
    onSave(model, (draft) => {
      for (const spec of toAdd) addRuleSet(draft, spec);
      if (toAdd.length) ensureCacheFile(draft);
    });
    m.close();
  }

  function render() {
    clear(body);
    errorBox.textContent = '';

    // name
    body.append(
      field(
        t('rule.name'),
        input({ value: model.name, placeholder: t('rule.name-ph'), onInput: (v) => (model.name = v) }),
      ),
    );

    if (model.kind === 'logical') {
      body.append(
        h('div', { class: 'notice info' }, icon('info'), h('div', null, h('p', null, t('rule.logical-note')))),
      );
    } else {
      body.append(conditionsSection());
    }
    body.append(actionSection());
    body.append(advancedSection());
  }

  // -- conditions ------------------------------------------------------------

  function conditionsSection() {
    const sec = h('div', { class: 'section' });
    sec.append(h('div', { class: 'section-title' }, icon('filter', 'sm'), t('rule.when')));

    if (!model.conds.length) sec.append(h('div', { class: 'muted' }, t('rule.no-conds')));

    model.conds.forEach((c, i) => {
      if (i > 0) sec.append(h('div', { class: 'and-sep' }, t('rule.and')));
      sec.append(condBlock(c, i));
    });

    // add-condition buttons
    const used = new Set(model.conds.map((c) => c.type));
    const addRow = h('div', { class: 'picker' });
    for (const meta of available) {
      if (used.has(meta.type)) continue;
      addRow.append(
        h(
          'button',
          {
            type: 'button',
            class: 'opt',
            onclick: () => {
              model.conds.push({ type: meta.type, values: [] });
              render();
            },
          },
          icon('plus', 'sm'),
          t(`cond.${meta.type}`),
        ),
      );
    }
    addRow.setAttribute('role', 'group');
    addRow.setAttribute('aria-label', t('rule.add-cond'));
    sec.append(h('div', { class: 'label', style: { marginTop: '6px' } }, t('rule.add-cond')), addRow);

    // smart paste
    const paste = textarea({ rows: 4, placeholder: t('rule.paste-ph'), code: true, 'aria-label': t('rule.paste') });
    const pasteBox = h(
      'div',
      { class: 'col', hidden: true },
      paste,
      h('div', { class: 'row' }, button({ label: t('rule.paste-add'), variant: 'primary', size: 'sm', onClick: () => addPasted(paste.value) }), h('span', { class: 'muted' }, t('rule.paste-hint'))),
    );
    sec.append(
      h(
        'div',
        { class: 'row wrap' },
        button({ label: t('rule.paste'), icon: 'wand', size: 'sm', onClick: () => (pasteBox.hidden = !pasteBox.hidden) }),
        h('label', { class: 'row', style: { marginInlineStart: 'auto', cursor: 'pointer' } }, toggle({ checked: model.invert, onChange: (v) => { model.invert = v; } }), h('span', null, t('rule.invert'))),
      ),
      pasteBox,
    );
    return sec;
  }

  function addPasted(text) {
    const groups = classifyLines(text).filter((g) => available.some((a) => a.type === g.type));
    if (!groups.length) return;
    for (const g of groups) {
      const existing = model.conds.find((c) => c.type === g.type);
      if (existing) existing.values = [...new Set([...existing.values, ...g.values])];
      else model.conds.push({ type: g.type, values: g.values });
    }
    render();
  }

  function condBlock(c, i) {
    const meta = CONDITION_BY_TYPE[c.type];
    const headId = uid('cond');
    const head = h(
      'div',
      { class: 'head' },
      icon(COND_ICON[c.type] || 'filter', 'sm'),
      h('b', { class: 'grow', id: headId }, t(`cond.${c.type}`)),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, t(`cond.${c.type}.hint`)),
      button({ iconOnly: true, icon: 'x', variant: 'ghost', size: 'sm', label: t('common.remove'), onClick: () => { model.conds.splice(i, 1); render(); } }),
    );
    let editor = null;
    if (meta.flag) editor = null;
    else if (meta.picker === 'protocol') editor = picker({ multi: true, options: PROTOCOLS.map((p) => ({ value: p, label: p })), value: c.values, onChange: (v) => (c.values = v) });
    else if (meta.picker === 'network') editor = picker({ multi: true, options: NETWORKS.map((p) => ({ value: p, label: p.toUpperCase() })), value: c.values, onChange: (v) => (c.values = v) });
    else if (meta.picker === 'qtype') editor = picker({ multi: true, options: QUERY_TYPES.map((p) => ({ value: p, label: p })), value: c.values, onChange: (v) => (c.values = v) });
    else if (meta.picker === 'inbound' && inboundTags.length) editor = picker({ multi: true, options: inboundTags.map((p) => ({ value: p, label: p })), value: c.values, onChange: (v) => (c.values = v) });
    else if (meta.picker === 'ruleset') {
      editor = h(
        'div',
        { class: 'col', style: { gap: '8px' } },
        chipsInput({ values: c.values, onChange: (v) => (c.values = v), placeholder: t('rule.ruleset-ph'), suggestions: [...new Set([...ruleSetTags, ...RULE_SET_CATALOG.map((r) => `${r.kind}-${r.name}`)])], parse: (s) => parseValues('rule_set', s) }),
        h('div', { class: 'muted', style: { fontSize: '12px' } }, t('rule.ruleset-hint')),
      );
    } else {
      editor = chipsInput({
        values: c.values,
        onChange: (v) => (c.values = v),
        placeholder: meta.placeholder || '',
        parse: (s) => parseValues(c.type, s),
      });
    }
    if (editor) nameControl(editor, headId);
    return h('div', { class: 'cond-block' }, head, editor);
  }

  // -- action ----------------------------------------------------------------

  function actionSection() {
    const sec = h('div', { class: 'section' });
    sec.append(h('div', { class: 'section-title' }, icon('arrow', 'sm flip-rtl'), t('rule.then')));
    const order = ctx.kind === 'dns' ? DNS_ACTION_ORDER : ROUTE_ACTION_ORDER;
    const types = order.includes(model.action.type) ? order : [...order, model.action.type];
    const typePicker = picker({
        options: types.map((a) => ({ value: a, label: t(`act.${a}`) === `act.${a}` ? a : t(`act.${a}`), tone: a === 'reject' ? 'danger' : undefined })),
        value: model.action.type,
        onChange: (v) => {
          model.action = { type: v };
          if (v === 'route') {
            if (ctx.kind === 'dns') model.action.server = dnsTags[0] || '';
            else model.action.outbound = '';
          }
          render();
        },
      });
    typePicker.setAttribute('role', 'group');
    typePicker.setAttribute('aria-label', t('rule.then'));
    sec.append(typePicker);
    if (model.action.type === 'route') {
      if (ctx.kind === 'dns') {
        const serverPicker = dnsTags.length
          ? picker({ options: dnsTags.map((tag) => ({ value: tag, label: tag })), value: model.action.server, onChange: (v) => (model.action.server = v) })
          : null;
        if (serverPicker) serverPicker.setAttribute('aria-label', t('rule.use-server'));
        sec.append(h('div', { class: 'label' }, t('rule.use-server')), serverPicker || h('div', { class: 'muted' }, t('rule.no-dns')));
      } else {
        const outPicker = choices.length
          ? picker({
              options: choices.map((o) => ({ value: o.tag, label: o.tag, hint: o.type, tone: toneOf(o.tag, cfg) })),
              value: model.action.outbound,
              onChange: (v) => (model.action.outbound = v),
            })
          : null;
        if (outPicker) {
          outPicker.setAttribute('role', 'group');
          outPicker.setAttribute('aria-label', t('rule.send-to'));
        }
        sec.append(h('div', { class: 'label' }, t('rule.send-to')), outPicker || h('div', { class: 'muted' }, t('rule.no-outbounds')));
      }
    }
    const hint = t(`act.${model.action.type}.hint`);
    if (hint !== `act.${model.action.type}.hint`) sec.append(h('div', { class: 'muted', style: { fontSize: '12.5px' } }, hint));
    return sec;
  }

  // -- raw JSON --------------------------------------------------------------

  function advancedSection() {
    const jsonArea = textarea({ code: true, rows: 9, 'aria-label': t('rule.json') });
    const msg = h('div', { class: 'muted' });
    const details = h(
      'details',
      { class: 'adv' },
      h('summary', null, icon('code', 'sm'), t('rule.json')),
      h('div', { class: 'col' },
        h('div', { class: 'muted', style: { fontSize: '12.5px' } }, t('rule.json-hint')),
        jsonArea,
        h('div', { class: 'row' },
          button({ label: t('rule.json-apply'), size: 'sm', onClick: () => {
            try {
              const parsed = JSON.parse(jsonArea.value);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected');
              const next = ruleToModel({ ...parsed, ...(model.name ? { __name: model.name } : {}), ...(model.enabled === false ? { __off: true } : {}) }, ctx);
              Object.keys(model).forEach((k) => delete model[k]);
              Object.assign(model, next);
              render();
            } catch (e) {
              msg.textContent = String(e.message || e);
              msg.style.color = 'var(--danger)';
            }
          } }),
          msg,
        ),
      ),
    );
    details.addEventListener('toggle', () => {
      if (details.open) {
        const r = modelToRule(model, ctx);
        delete r.__name;
        delete r.__off;
        jsonArea.value = JSON.stringify(r, null, 2);
        msg.textContent = '';
      }
    });
    return details;
  }

  render();
  return m;
}

/** Build a fresh model for "Add rule". */
export function newRuleModel(cfg, ctx) {
  const mdl = emptyModel(ctx);
  if (ctx.kind === 'route') {
    const direct = outboundChoices(cfg).find((o) => o.type === 'direct');
    mdl.action.outbound = direct ? direct.tag : '';
  } else {
    const first = dnsServers(cfg)[0];
    mdl.action.server = first ? first.tag : '';
  }
  return mdl;
}

// ---------------------------------------------------------------------------
// templates gallery
// ---------------------------------------------------------------------------

/** onPick(built, template) where built = { model, ruleSets } */
export function openTemplates({ cfg, onPick }) {
  const grid = h('div', { class: 'template-grid' });
  const m = modal({ title: t('tpl.title'), size: 'wide', body: [h('div', { class: 'muted' }, t('tpl.intro')), grid] });
  for (const tpl of ROUTE_TEMPLATES) {
    grid.append(
      h(
        'button',
        {
          type: 'button',
          class: 'template',
          onclick: () => {
            m.close();
            onPick(tpl.build(cfg), tpl);
          },
        },
        h('span', { class: 'ic' }, icon(tpl.icon)),
        h('span', null, h('b', null, t(`tpl.${tpl.id}.title`)), h('span', null, t(`tpl.${tpl.id}.desc`))),
      ),
    );
  }
  return m;
}

// ---------------------------------------------------------------------------
// rule-set manager
// ---------------------------------------------------------------------------

export function openRuleSets({ getCfg, mutate }) {
  const body = h('div', { class: 'col', style: { gap: '18px' } });
  const m = modal({ title: t('rs.title'), size: 'wide', body, footer: [h('span', { class: 'spacer' }), button({ label: t('common.done'), variant: 'primary', onClick: () => m.close() })] });
  let detour = '';

  function render() {
    clear(body);
    const cfg = getCfg();
    const sets = ruleSets(cfg);
    const choices = outboundChoices(cfg);

    body.append(h('div', { class: 'muted' }, t('rs.intro')));

    // current list
    const list = h('div', { class: 'list card list-card' });
    if (!sets.length) list.append(empty({ icon: 'list', title: t('rs.none') }));
    for (const s of sets) {
      list.append(
        h(
          'div',
          { class: 'item' },
          icon('list'),
          h('div', { class: 'body' }, h('div', { class: 'title ltr' }, s.tag), h('div', { class: 'muted ltr', style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.url || s.path || t('rs.inline'))),
          pill(s.type || 'remote', 'neutral'),
          button({ iconOnly: true, icon: 'trash', variant: 'ghost', size: 'sm', label: t('common.delete'), onClick: () => { mutate((d) => { d.route.rule_set = d.route.rule_set.filter((x) => x.tag !== s.tag); }); render(); } }),
        ),
      );
    }
    body.append(list);

    // download route
    body.append(
      field(
        t('rs.detour'),
        select({
          options: [{ value: '', label: t('rs.detour-direct') }, ...choices.filter((c) => !['direct', 'block', 'dns'].includes(c.type)).map((c) => ({ value: c.tag, label: c.tag }))],
          value: detour,
          onChange: (v) => (detour = v),
        }),
        t('rs.detour-hint'),
      ),
    );

    // catalog
    const have = new Set(sets.map((s) => s.tag));
    const cat = h('div', { class: 'picker' });
    for (const r of RULE_SET_CATALOG) {
      const tag = `${r.kind}-${r.name}`;
      if (have.has(tag)) continue;
      cat.append(
        h('button', { type: 'button', class: 'opt', onclick: () => { addSet(remoteRuleSet(r.kind, r.name, { detour })); } }, icon('plus', 'sm'), h('span', { class: 'ltr' }, tag)),
      );
    }
    body.append(h('div', { class: 'section' }, h('div', { class: 'section-title' }, icon('star', 'sm'), t('rs.catalog')), cat.children.length ? cat : h('div', { class: 'muted' }, t('rs.all-added'))));

    // custom
    let kind = 'geosite';
    let name = '';
    const nameInput = input({ placeholder: 'category-ir', ltr: true, 'aria-label': t('rs.custom'), onInput: (v) => (name = v.trim()) });
    const urlInput = input({ placeholder: 'https://…/list.srs', ltr: true, 'aria-label': t('rs.add-url') });
    body.append(
      h(
        'div',
        { class: 'section' },
        h('div', { class: 'section-title' }, icon('plus', 'sm'), t('rs.custom')),
        h('div', { class: 'row wrap' },
          select({ options: ['geosite', 'geoip'], value: kind, onChange: (v) => (kind = v), 'aria-label': t('rs.custom') }),
          h('div', { class: 'grow' }, nameInput),
          button({ label: t('common.add'), onClick: () => { if (name) { addSet(remoteRuleSet(kind, name, { detour })); } } }),
        ),
        h('div', { class: 'row wrap' },
          h('div', { class: 'grow' }, urlInput),
          button({ label: t('rs.add-url'), onClick: () => {
            const url = urlInput.value.trim();
            if (!/^https?:\/\//.test(url)) return toast(t('rs.bad-url'), 'error');
            const base = url.split('/').pop().replace(/\.(srs|json)$/i, '') || 'custom';
            const spec = { type: 'remote', tag: base, format: /\.json$/i.test(url) ? 'source' : 'binary', url, update_interval: '7d' };
            if (detour) spec.download_detour = detour;
            addSet(spec);
          } }),
        ),
      ),
    );
  }

  function addSet(spec) {
    mutate((d) => {
      addRuleSet(d, spec);
      ensureCacheFile(d);
    });
    render();
  }

  render();
  return m;
}
