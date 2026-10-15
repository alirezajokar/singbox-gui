// User-facing flows that combine the store with toasts and dialogs.

import { t } from '../i18n.js';
import { toast, confirmDialog, h } from '../dom.js';
import * as store from '../store.js';

/** Turn a backend failure into { title, detail }. */
export function describeFailure(r) {
  const detail = (r && (r.message || r.output)) || '';
  switch (r && r.reason) {
    case 'denied':
      return { title: t('err.denied'), detail: '' };
    case 'no-helper':
      return { title: t('err.no-helper'), detail: '' };
    case 'no-pkexec':
      return { title: t('err.no-pkexec'), detail: '' };
    case 'timeout':
      return { title: t('err.timeout'), detail: '' };
    default:
  }
  if (r && r.stage === 'check') return { title: t('err.check'), detail };
  if (r && r.stage === 'parse') return { title: t('err.parse'), detail };
  if (r && r.stage === 'restart') return { title: t('err.restart'), detail };
  return { title: t('err.generic'), detail };
}

export function showFailure(r) {
  const f = describeFailure(r);
  toast(f.title, 'error', f.detail);
}

/** Start / stop / restart with feedback. Returns true on success. */
export async function runService(action) {
  const r = await store.serviceDo(action);
  if (!r.ok) {
    showFailure(r);
    return false;
  }
  const st = r.status || store.state.status;
  if ((action === 'start' || action === 'restart') && st && !st.active) {
    toast(t('svc.failed-start'), 'error', r.logs || '');
    return false;
  }
  const done = { start: 'svc.started', stop: 'svc.stopped', restart: 'svc.restarted', enable: 'svc.enabled', disable: 'svc.disabled' }[action];
  if (done) toast(t(done));
  return true;
}

export function problemsNode(problems) {
  const shown = problems.slice(0, 8);
  return h(
    'div',
    { class: 'col', style: { gap: '8px' } },
    h('p', { style: { margin: 0, color: 'var(--text-2)' } }, t('refs.msg')),
    h(
      'div',
      { class: 'col', style: { gap: '4px' } },
      shown.map((p) => h('div', { class: 'row', style: { gap: '8px', fontSize: '12.5px' } }, h('b', null, t(`refs.kind.${p.kind}`)), h('span', { class: 'mono ltr' }, `«${p.tag}»`), h('span', { class: 'muted mono ltr' }, `← ${p.where}`))),
      problems.length > shown.length ? h('div', { class: 'muted' }, t('refs.more', { n: problems.length - shown.length })) : null,
    ),
  );
}

/** Check references, validate + write + restart. */
export async function saveAndApply() {
  if (store.state.busy) return false;
  const problems = store.findProblems();
  if (problems.length) {
    const go = await confirmDialog({ title: t('refs.title'), message: problemsNode(problems), confirmLabel: t('refs.save-anyway'), cancelLabel: t('refs.back'), danger: true });
    if (!go) return false;
  }
  const r = await store.saveConfig();
  if (!r.ok) {
    showFailure(r);
    return false;
  }
  const st = r.status || store.state.status;
  if (r.restarted && st && !st.active) {
    toast(t('save.saved-but-down'), 'error', r.logs || '');
    return true;
  }
  toast(r.restarted ? t('save.done-restarted') : t('save.done'));
  return true;
}

export async function discardChanges() {
  const ok = await confirmDialog({ title: t('save.discard-title'), message: t('save.discard-msg'), confirmLabel: t('save.discard'), danger: true });
  if (ok) {
    await store.discard();
    toast(t('save.discarded'));
  }
}

/** Confirm a destructive action: the title names the action and the object, the button repeats it. */
export function confirmDelete(message, { title, confirmLabel } = {}) {
  return confirmDialog({ title: title || t('common.delete'), message, confirmLabel: confirmLabel || t('common.delete'), danger: true });
}

/**
 * Delete at once and offer Undo (edits are drafts until Save, so this is safe and quick).
 * remove() performs the deletion and returns what it removed; restore(item) puts it back.
 */
export function deleteWithUndo({ message, remove, restore }) {
  const item = remove();
  toast(message, 'ok', undefined, { key: 'undo', action: { label: t('common.undo'), onClick: () => restore(item) } });
}

export function noteNode(text) {
  return h('p', { style: { margin: 0, color: 'var(--text-2)' } }, text);
}
