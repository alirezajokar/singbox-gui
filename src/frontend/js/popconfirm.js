// A small confirmation that opens on top of the control that asked for it
// ("Popconfirm"): lighter than a dialog because it keeps the page and the
// pointer where they are, and the question sits right next to the thing it is
// about. Meant for quick, low-stakes actions such as removing a row; bigger
// consequences still get a dialog (see confirmDialog in dom.js).
//
//   if (await popconfirm({ anchor: button, title: 'Delete this rule?', confirmLabel: 'Delete', mark: row })) …
//
// Behaviour: opens above the control (below when there is no room), arrow on the
// control, focus on the safe choice (Cancel), Tab stays inside, Escape or a click
// outside cancels, and it follows the control when the page scrolls.

import { h, icon, button } from './dom.js';
import { t } from './i18n.js';

let current = null; // { anchor, finish }
let seq = 0;

export function popconfirm({ anchor, title, message, confirmLabel, cancelLabel, danger = true, mark }) {
  // clicking the control that already has one open closes it
  if (current && current.anchor === anchor) {
    current.finish(false);
    return Promise.resolve(false);
  }
  if (current) current.finish(false);

  return new Promise((resolve) => {
    const id = `pc${(seq += 1)}`;
    let done = false;
    let watcher = null;

    const cancel = button({ label: cancelLabel || t('common.cancel'), size: 'sm', onClick: () => finish(false) });
    const ok = button({ label: confirmLabel || t('common.ok'), size: 'sm', variant: danger ? 'danger' : 'primary', onClick: () => finish(true) });
    const el = h(
      'div',
      { class: 'popconfirm', role: 'alertdialog', tabindex: '-1', 'aria-labelledby': `${id}-t`, 'aria-describedby': message ? `${id}-m` : undefined },
      h(
        'div',
        { class: 'pc-body' },
        icon('alert', 'pc-icon'),
        h('div', { class: 'pc-text' }, h('div', { id: `${id}-t`, class: 'pc-title' }, title), message ? h('div', { id: `${id}-m`, class: 'pc-msg' }, message) : null),
      ),
      h('div', { class: 'pc-actions' }, cancel, ok),
      h('span', { class: 'pc-arrow', 'aria-hidden': 'true' }),
    );

    function place() {
      const r = anchor.getBoundingClientRect();
      const margin = 8;
      const gap = 10;
      const w = el.offsetWidth;
      const hh = el.offsetHeight;
      const above = r.top - gap - hh >= margin;
      const side = above || window.innerHeight - r.bottom - gap - hh < margin ? 'top' : 'bottom';
      el.dataset.side = side;
      el.style.top = `${side === 'top' ? Math.max(margin, r.top - gap - hh) : r.bottom + gap}px`;
      const center = r.left + r.width / 2;
      const left = Math.max(margin, Math.min(center - w / 2, window.innerWidth - w - margin));
      el.style.left = `${left}px`;
      // the arrow keeps pointing at the control even when the box had to slide to stay on screen
      el.style.setProperty('--arrow-x', `${Math.max(16, Math.min(center - left, w - 16))}px`);
    }

    function finish(result) {
      if (done) return;
      done = true;
      current = null;
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      if (watcher) watcher.disconnect();
      el.remove();
      anchor.removeAttribute('aria-expanded');
      if (mark) mark.classList.remove('confirming');
      // a deleted row takes its button with it; otherwise focus goes back where it was
      if (anchor.isConnected) anchor.focus();
      resolve(result);
    }

    const onOutside = (e) => {
      if (!el.contains(e.target) && !anchor.contains(e.target)) finish(false);
    };
    const onScroll = (e) => {
      if (el.contains(e.target)) return;
      const r = anchor.getBoundingClientRect();
      const scroller = anchor.closest('.view, .modal-body');
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      if (r.bottom < box.top + 4 || r.top > box.bottom - 4) finish(false);
      else place();
    };

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Tab') {
        // two buttons: keep the focus between them
        const first = cancel;
        const last = ok;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    document.body.append(el);
    place();
    anchor.setAttribute('aria-expanded', 'true');
    if (mark) mark.classList.add('confirming');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    // the page can be rebuilt under an open popconfirm; do not leave it behind
    watcher = new MutationObserver(() => {
      if (!anchor.isConnected) finish(false);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    current = { anchor, finish };
    // the least destructive choice gets the focus (WAI-ARIA alertdialog)
    cancel.focus();
  });
}
