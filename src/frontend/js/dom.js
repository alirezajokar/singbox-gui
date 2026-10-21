// DOM helpers and reusable UI building blocks. No framework: plain elements.

import { t } from './i18n.js';

// ---------------------------------------------------------------------------
// element builder
// ---------------------------------------------------------------------------

/**
 * h('div', { class: 'x', onclick: fn, dataset: {a: 1} }, child, 'text', [more])
 * Text is always inserted as text nodes (never innerHTML) — safe by construction.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const FOCUS_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), summary, [role="combobox"]:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Replace the contents of `el`. Pages rebuild themselves after every change, which would
 * throw away the keyboard focus; if it was inside `el`, it goes back to the control that
 * now sits in the same place.
 */
export function mount(el, ...children) {
  const active = document.activeElement;
  let slot = -1;
  if (active && active !== document.body && el.contains(active)) slot = [...el.querySelectorAll(FOCUS_SELECTOR)].indexOf(active);
  clear(el);
  append(el, children);
  if (slot >= 0) {
    const next = el.querySelectorAll(FOCUS_SELECTOR)[slot];
    if (next) next.focus({ preventScroll: true });
  }
  return el;
}

// ---------------------------------------------------------------------------
// icons (24x24 stroke icons, paths hand-picked)
// ---------------------------------------------------------------------------

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  route: '<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
  dns: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-3.5L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 3.5L20 15"/><path d="M20 20v-5h-5"/>',
  restart: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  save: '<path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7L19 16Z"/>',
  send: '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="m10 13 4.5-4.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  box: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  invert: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor"/>',
  wand: '<path d="m4 20 11-11"/><path d="m14 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM19 12l.7 1.3L21 14l-1.3.7L19 16l-.7-1.3L17 14l1.3-.7L19 12Z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.style.display = 'contents';
  // paths above are static strings authored in this file — never user data
  span.innerHTML = `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
  return span.firstChild;
}

// ---------------------------------------------------------------------------
// small controls
// ---------------------------------------------------------------------------

export function button({ label, icon: ic, variant = '', size = '', title, onClick, disabled, iconOnly } = {}) {
  const b = h(
    'button',
    {
      type: 'button',
      class: `btn ${variant ? `btn-${variant}` : ''} ${size ? `btn-${size}` : ''} ${iconOnly ? 'btn-icon' : ''}`.trim(),
      title: title || (iconOnly ? label : undefined),
      'aria-label': iconOnly ? label : undefined,
      disabled,
      onclick: (e) => {
        e.stopPropagation();
        if (onClick) onClick(e);
      },
    },
    ic ? icon(ic, size === 'sm' ? 'sm' : '') : null,
    iconOnly ? null : label,
  );
  return b;
}

let uidCounter = 0;
const nextId = (p) => `${p}${(uidCounter += 1)}`;
export const uid = nextId;

/** The control a label should point at: the element itself or the first native control inside it. */
function nativeControl(control) {
  if (!control || !control.matches) return null;
  if (control.matches('input, select, textarea, [role="combobox"]')) return control;
  return control.querySelector('input:not([type="hidden"]), select, textarea, [role="combobox"]');
}

/**
 * Give a control its accessible name (and description). Native controls are named
 * with aria-labelledby; anything else (a row of buttons) becomes a labelled group.
 */
export function nameControl(control, labelId, hintId) {
  const target = nativeControl(control);
  if (target) {
    target.setAttribute('aria-labelledby', labelId);
    if (hintId) target.setAttribute('aria-describedby', hintId);
  } else if (control && control.setAttribute) {
    control.setAttribute('role', 'group');
    control.setAttribute('aria-labelledby', labelId);
    if (hintId) control.setAttribute('aria-describedby', hintId);
  }
}

export function field(label, control, hint) {
  const labelId = nextId('lbl');
  const hintId = hint ? nextId('hint') : null;
  const native = label ? nativeControl(control) : null;
  const labelEl = label ? h('label', { id: labelId }, label) : null;
  if (native && labelEl) {
    native.id = native.id || nextId('ctl');
    labelEl.htmlFor = native.id;
    if (hintId) native.setAttribute('aria-describedby', hintId);
  } else if (label) {
    nameControl(control, labelId, hintId);
  }
  return h('div', { class: 'field' }, labelEl, control, hint ? h('div', { class: 'hint', id: hintId }, hint) : null);
}

/** One row of a settings card: title + hint on one side, the control on the other. */
export function settingRow(title, hint, control, auto = false) {
  const titleId = nextId('set');
  const hintId = hint ? nextId('hint') : null;
  // read-only rows (a value pill) have nothing to name
  const interactive = control.matches('input, select, textarea, [role="combobox"], .segmented, .picker, .switch') || !!control.querySelector('input, select, textarea, button');
  if (interactive) nameControl(control, titleId, hintId);
  return h(
    'div',
    { class: 'setting' },
    h('div', { class: 'txt' }, h('b', { id: titleId }, title), hint ? h('span', { id: hintId }, hint) : null),
    h('div', { class: `ctl ${auto ? 'auto' : ''}`.trim() }, control),
  );
}

export function input({ value = '', placeholder = '', onInput, onChange, type = 'text', ltr = false, mono = false, invalid = false, ...rest } = {}) {
  const el = h('input', {
    class: `input ${ltr ? 'ltr' : ''} ${mono ? 'mono' : ''} ${invalid ? 'invalid' : ''}`.trim(),
    type,
    value,
    placeholder,
    spellcheck: 'false',
    autocomplete: 'off',
    ...rest,
  });
  if (onInput) el.addEventListener('input', () => onInput(el.value, el));
  if (onChange) el.addEventListener('change', () => onChange(el.value, el));
  return el;
}

export function textarea({ value = '', placeholder = '', onInput, code = false, rows = 5, ...rest } = {}) {
  const el = h('textarea', { class: `textarea ${code ? 'code' : ''}`.trim(), placeholder, rows, spellcheck: 'false', ...rest });
  el.value = value;
  if (onInput) el.addEventListener('input', () => onInput(el.value, el));
  return el;
}

/** options: [{ value, label }] or strings */
// The dropdown lives in its own file; it is re-exported so pages keep importing it from here.
export { select } from './dropdown.js';

export function toggle({ checked = false, onChange, disabled = false, label } = {}) {
  const cb = h('input', { type: 'checkbox', checked, disabled, 'aria-label': label });
  cb.addEventListener('change', () => onChange && onChange(cb.checked, cb));
  return h('label', { class: 'switch' }, cb, h('span', { class: 'track' }));
}

export function segmented({ options, value, onChange, label }) {
  const wrap = h('div', { class: 'segmented', role: 'group', 'aria-label': label });
  for (const o of options) {
    const on = o.value === value;
    wrap.append(h('button', { type: 'button', class: on ? 'on' : '', 'aria-pressed': on ? 'true' : 'false', onclick: () => onChange(o.value) }, o.label));
  }
  return wrap;
}

/** A row of selectable options. multi=true → toggles in `value` (array). */
export function picker({ options, value, onChange, multi = false, tone }) {
  const wrap = h('div', { class: 'picker' });
  const sel = new Set(multi ? value : [value]);
  const render = () => {
    clear(wrap);
    for (const o of options) {
      const on = sel.has(o.value);
      wrap.append(
        h(
          'button',
          {
            type: 'button',
            class: `opt ${on ? 'on' : ''} ${o.tone || tone ? `tone-${o.tone || tone}` : ''}`.trim(),
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => {
              if (multi) {
                if (on) sel.delete(o.value);
                else sel.add(o.value);
                onChange([...sel]);
              } else {
                sel.clear();
                sel.add(o.value);
                onChange(o.value);
              }
              render();
            },
          },
          o.icon ? icon(o.icon, 'sm') : null,
          o.label,
          o.hint ? h('small', null, o.hint) : null,
        ),
      );
    }
  };
  render();
  return wrap;
}

/**
 * Tag-style input. Enter / comma / space / paste create chips.
 * parse(text) -> string[] normalises what was typed.
 */
export function chipsInput({ values, onChange, placeholder = '', parse, suggestions, rtl = false, label }) {
  const state = [...values];
  const box = h('div', { class: `chips ${rtl ? 'rtl-input' : ''}`.trim() });
  const listId = suggestions && suggestions.length ? `dl-${Math.random().toString(36).slice(2, 8)}` : null;
  const inp = h('input', { type: 'text', placeholder, spellcheck: 'false', autocomplete: 'off', list: listId, 'aria-label': label });
  const dl = listId ? h('datalist', { id: listId }, suggestions.map((s) => h('option', { value: s }))) : null;

  const commit = (text) => {
    const add = parse ? parse(text) : [text.trim()].filter(Boolean);
    let changed = false;
    for (const v of add) {
      if (v && !state.includes(v)) {
        state.push(v);
        changed = true;
      }
    }
    inp.value = '';
    if (changed) {
      onChange([...state]);
      render();
    }
  };

  const render = () => {
    clear(box);
    for (const v of state) {
      box.append(
        h(
          'span',
          { class: 'chip' },
          h('span', { title: v }, v),
          h(
            'button',
            {
              type: 'button',
              class: 'chip-btn',
              'aria-label': `${t('common.remove')}: ${v}`,
              onclick: (e) => {
                e.stopPropagation();
                state.splice(state.indexOf(v), 1);
                onChange([...state]);
                render();
              },
            },
            icon('x', 'sm'),
          ),
        ),
      );
    }
    box.append(inp);
    if (dl) box.append(dl);
  };

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && !e.isComposing && parse)) {
      if (inp.value.trim()) {
        e.preventDefault();
        commit(inp.value);
      } else if (e.key === 'Enter') e.preventDefault();
    } else if (e.key === 'Backspace' && !inp.value && state.length) {
      state.pop();
      onChange([...state]);
      render();
      inp.focus();
    }
  });
  inp.addEventListener('paste', (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/[\s,;\n]/.test(text.trim())) {
      e.preventDefault();
      commit(text);
    }
  });
  inp.addEventListener('blur', () => inp.value.trim() && commit(inp.value));
  inp.addEventListener('change', () => {
    // datalist selections arrive as a change event
    if (inp.value.trim() && suggestions && suggestions.includes(inp.value.trim())) commit(inp.value);
  });
  box.addEventListener('click', () => inp.focus());
  render();
  return box;
}

// ---------------------------------------------------------------------------
// overlays: modal, confirm, toast
// ---------------------------------------------------------------------------

/**
 * modal({ title, body, footer: [buttons], size: 'wide'|'narrow'|'' , onClose })
 * returns { el, close }
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
let openModals = 0;

/** The page behind a modal must not be reachable: `inert` removes it from focus and from assistive tech. */
function setBackgroundInert(on) {
  const app = document.getElementById('app');
  if (!app) return;
  if (on) app.setAttribute('inert', '');
  else app.removeAttribute('inert');
}

/**
 * modal({ title, body, footer: [buttons], size: 'wide'|'narrow'|'' , onClose })
 * returns { el, close }
 * Focus moves inside, Tab stays inside, Escape closes, focus returns to the trigger.
 */
export function modal({ title, body, footer, size = '', onClose, closable = true }) {
  const prevFocus = document.activeElement;
  const titleId = nextId('dlg');
  const close = (result) => {
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    openModals -= 1;
    if (openModals <= 0) setBackgroundInert(false);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
    if (onClose) onClose(result);
  };
  const onKey = (e) => {
    // only the top-most modal reacts
    if (overlay !== lastOverlay()) return;
    if (e.key === 'Escape' && closable) {
      if (document.querySelector('.dd-pop, .popconfirm')) return; // an open dropdown or popconfirm takes the key first
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      const items = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        box.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!box.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const box = h(
    'div',
    { class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'modal-head' }, h('h3', { id: titleId }, title), closable ? button({ iconOnly: true, icon: 'x', variant: 'ghost', size: 'sm', label: t('common.close'), onClick: () => close() }) : null),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-foot' }, footer) : null,
  );
  const overlay = h('div', {
    class: 'overlay',
    onmousedown: (e) => {
      if (e.target === overlay && closable) close();
    },
  }, box);
  document.body.append(overlay);
  openModals += 1;
  setBackgroundInert(true);
  document.addEventListener('keydown', onKey, true);
  // first field if there is one, otherwise the dialog itself (so it is announced and Escape works)
  const first = box.querySelector('input:not([type=checkbox]):not([type=hidden]), textarea, select');
  (first || box).focus();
  return { el: box, close };
}

function lastOverlay() {
  const all = document.querySelectorAll('.overlay');
  return all[all.length - 1];
}

export function confirmDialog({ title, message, confirmLabel, danger = false, cancelLabel }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      m.close();
      resolve(v);
    };
    const m = modal({
      title,
      size: 'narrow',
      body: h('div', { class: 'col' }, typeof message === 'string' ? h('p', { style: { margin: 0, color: 'var(--text-2)' } }, message) : message),
      footer: [
        h('span', { class: 'spacer' }),
        button({ label: cancelLabel || t('common.cancel'), onClick: () => finish(false) }),
        button({ label: confirmLabel || t('common.ok'), variant: danger ? 'danger' : 'primary', onClick: () => finish(true) }),
      ],
      onClose: () => finish(false),
    });
  });
}

/**
 * toast(message, 'ok' | 'error', detail, { action: { label, onClick }, key })
 * Errors and toasts that carry an action stay until dismissed; plain confirmations fade after a few seconds.
 * A toast with the same `key` replaces the previous one.
 */
export function toast(message, kind = 'ok', detail, opts = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const { action, key } = opts;
  if (key) host.querySelectorAll(`[data-key="${key}"]`).forEach((n) => n.remove());
  const el = h(
    'div',
    { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status', dataset: key ? { key } : undefined },
    icon(kind === 'error' ? 'alert' : 'check'),
    h(
      'div',
      { class: 'grow' },
      h('div', null, message),
      detail ? h('pre', null, detail) : null,
      action
        ? h('div', { style: { marginTop: '8px' } }, button({ label: action.label, size: 'sm', onClick: () => { action.onClick(); el.remove(); } }))
        : null,
    ),
    button({ iconOnly: true, icon: 'x', variant: 'ghost', size: 'sm', label: t('common.close'), onClick: () => el.remove() }),
  );
  el.lastChild.classList.add('close');
  host.append(el);
  if (kind !== 'error' && !action) setTimeout(() => el.remove(), 3600);
}

export function notice({ kind = 'info', title, text, detail, actions }) {
  return h(
    'div',
    { class: `notice ${kind}` },
    icon(kind === 'info' ? 'info' : 'alert'),
    h('div', { class: 'grow' }, title ? h('h4', null, title) : null, text ? h('p', null, text) : null, detail ? h('pre', null, detail) : null, actions ? h('div', { class: 'row wrap', style: { marginTop: '10px' } }, actions) : null),
  );
}

export function card(title, hint, body, { actions } = {}) {
  return h(
    'section',
    { class: 'card' },
    title ? h('div', { class: 'card-head' }, h('div', { class: 'grow' }, h('h2', null, title), hint ? h('div', { class: 'hint' }, hint) : null), actions ? h('div', { class: 'row' }, actions) : null) : null,
    h('div', { class: 'card-body' }, body),
  );
}

export function empty({ icon: ic = 'layers', title, text, actions }) {
  return h('div', { class: 'empty' }, icon(ic, 'lg'), h('h3', null, title), text ? h('div', null, text) : null, actions ? h('div', { class: 'row wrap', style: { justifyContent: 'center' } }, actions) : null);
}

export function pill(text, tone = 'neutral', ic, opts = {}) {
  return h('span', { class: `pill ${tone}`, dir: opts.ltr ? 'ltr' : undefined }, ic ? icon(ic, 'sm') : null, text);
}
