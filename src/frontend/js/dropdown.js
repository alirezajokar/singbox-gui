// A dropdown that looks the same everywhere and reads correctly in RTL.
// The native <select> popup is drawn by the toolkit (light, left-to-right,
// unstyled), so this one is a button + listbox following the ARIA "select-only
// combobox" pattern: focus stays on the button, arrow keys move the highlight,
// Enter/Space choose, Escape closes, typing jumps to a match.
//
// Same call as before: select({ options, value, onChange, placeholder }).
// Options are strings or { value, label, meta } (meta = quieter secondary text).
// The returned element has a `value` property and fires a `change` event.

import { h, icon } from './dom.js';

let openPopup = null; // { close, owner } — only one at a time
let seq = 0;

export function select({ options = [], value, onChange, placeholder, ...rest } = {}) {
  const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  if (placeholder !== undefined) items.unshift({ value: '', label: placeholder });
  const id = `dd${(seq += 1)}`;
  let current = value !== undefined ? value : items.length ? items[0].value : '';
  let active = -1;
  let popup = null;
  let typed = '';
  let typedAt = 0;
  let watcher = null;

  const valueEl = h('span', { class: 'dd-value' });
  const btn = h(
    'button',
    { type: 'button', class: 'select', role: 'combobox', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', ...rest },
    valueEl,
    icon('chevron', 'dd-chev'),
  );

  const indexOf = (v) => items.findIndex((i) => i.value === v);

  function paint() {
    valueEl.textContent = '';
    const it = items[indexOf(current)];
    // a value that is not in the list (a dangling reference) is shown as it is
    valueEl.append(h('bdi', { class: it ? '' : 'dd-unknown' }, it ? it.label : current));
    if (it && it.meta) valueEl.append(h('span', { class: 'dd-meta' }, h('bdi', null, it.meta)));
    if (!it && !current) valueEl.append(h('span', { class: 'dd-meta' }, '—'));
  }

  Object.defineProperty(btn, 'value', {
    get: () => current,
    set: (v) => {
      current = v;
      paint();
    },
  });

  function setActive(i, scroll = true) {
    if (!popup || !items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    for (const el of popup.children) el.classList.toggle('active', Number(el.dataset.i) === active);
    const el = popup.children[active];
    btn.setAttribute('aria-activedescendant', el.id);
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  function place() {
    const r = btn.getBoundingClientRect();
    const rtl = getComputedStyle(btn).direction === 'rtl';
    const margin = 8;
    popup.style.minWidth = `${r.width}px`;
    popup.style.maxHeight = '';
    const w = popup.offsetWidth;
    const natural = Math.min(popup.scrollHeight + 2, 320);
    const below = window.innerHeight - r.bottom - margin - 4;
    const above = r.top - margin - 4;
    const up = natural > below && above > below;
    const room = Math.max(120, up ? above : below);
    popup.style.maxHeight = `${Math.min(320, room)}px`;
    const h2 = Math.min(natural, room);
    popup.style.top = `${up ? r.top - h2 - 4 : r.bottom + 4}px`;
    let left = rtl ? r.right - w : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    popup.style.left = `${left}px`;
    popup.dataset.side = up ? 'up' : 'down';
  }

  function close(refocus = false) {
    if (!popup) return;
    popup.remove();
    popup = null;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
    btn.removeAttribute('aria-controls');
    document.removeEventListener('pointerdown', onOutside, true);
    window.removeEventListener('resize', onWindow);
    document.removeEventListener('scroll', onScroll, true);
    if (watcher) watcher.disconnect();
    if (openPopup && openPopup.owner === btn) openPopup = null;
    if (refocus) btn.focus();
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    const changed = it.value !== current;
    current = it.value;
    paint();
    close(true);
    if (changed) {
      btn.dispatchEvent(new Event('change', { bubbles: true }));
      if (onChange) onChange(current, btn);
    }
  }

  const onOutside = (e) => {
    if (popup && !popup.contains(e.target) && !btn.contains(e.target)) close();
  };
  const onWindow = () => close();
  // when something behind scrolls, the list follows its control; it closes once the control is scrolled out of sight
  const onScroll = (e) => {
    if (!popup || popup.contains(e.target)) return;
    const r = btn.getBoundingClientRect();
    const scroller = btn.closest('.view, .modal-body');
    const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    if (r.bottom < box.top + 4 || r.top > box.bottom - 4) close();
    else place();
  };

  function open() {
    if (btn.disabled || popup || !items.length) return;
    if (openPopup) openPopup.close();
    popup = h(
      'div',
      { class: 'dd-pop', role: 'listbox', onmousedown: (e) => e.preventDefault(), id: `${id}-list`, dir: getComputedStyle(btn).direction, 'aria-labelledby': btn.getAttribute('aria-labelledby') || undefined, 'aria-label': btn.getAttribute('aria-label') || undefined },
      items.map((it, i) =>
        h(
          'div',
          {
            class: 'dd-opt',
            role: 'option',
            id: `${id}-o${i}`,
            dataset: { i },
            'aria-selected': it.value === current ? 'true' : 'false',
            // keep focus on the button while the pointer is used
            onmousedown: (e) => e.preventDefault(),
            onmousemove: () => active !== i && setActive(i, false),
            onclick: () => choose(i),
          },
          h('span', { class: 'dd-lab' }, h('bdi', null, it.label)),
          it.meta ? h('span', { class: 'dd-meta' }, h('bdi', null, it.meta)) : null,
          icon('check', 'dd-check'),
        ),
      ),
    );
    document.body.append(popup);
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-controls', popup.id);
    place();
    setActive(Math.max(0, indexOf(current)));
    document.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('resize', onWindow);
    document.addEventListener('scroll', onScroll, true);
    // the page can be re-rendered under an open list; do not leave it behind
    watcher = new MutationObserver(() => {
      if (!btn.isConnected) close();
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    openPopup = { close, owner: btn };
  }

  btn.addEventListener('click', () => (popup ? close() : open()));
  btn.addEventListener('blur', () => {
    // clicking an option keeps focus here (mousedown is prevented); any other blur ends the interaction
    if (popup) close();
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ') e.preventDefault(); // the synthesized click would reopen what Space just closed
  });
  btn.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Tab') return;
    if (k === 'Escape') {
      if (popup) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
      return;
    }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      if (popup) choose(active);
      else open();
      return;
    }
    const move = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[k];
    if (move !== undefined || k === 'Home' || k === 'End') {
      e.preventDefault();
      if (!popup) return open();
      if (k === 'Home') setActive(0);
      else if (k === 'End') setActive(items.length - 1);
      else setActive(active + move);
      return;
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = now - typedAt > 700 ? k : typed + k;
      typedAt = now;
      const n = items.length;
      const from = popup ? active : indexOf(current);
      const q = typed.toLowerCase();
      for (let step = typed.length > 1 ? 0 : 1; step <= n; step += 1) {
        const i = (from + step + n) % n;
        if (String(items[i].label).toLowerCase().startsWith(q)) {
          e.preventDefault();
          if (!popup) open();
          setActive(i);
          break;
        }
      }
    }
  });

  paint();
  return btn;
}
